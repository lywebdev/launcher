const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');

const config = require('./config');
config.appDataPath = config.appDataPath || app.getPath('appData');
const ModManager = require('./modManager');
const ForgeManager = require('./forgeManager');
const LauncherService = require('./launcherService');

const ENGINE_URL = 'https://storage.lyweb.dev/.engine.zip';

const bootstrap = async () => {
  const Store = (await import('electron-store')).default;
  const store = new Store({ name: 'launcher-state' });
  const modManager = new ModManager(config.minecraftDir, config.runtimeDir, config.modsRepo);
  const forgeManager = new ForgeManager(config.forge, config.runtimeDir, config.java);
  const launcherService = new LauncherService(config);
  const DEFAULT_JAVA_DOWNLOAD_URL =
    'https://www.oracle.com/java/technologies/downloads/#jdk17-windows';
  const javaDownloadUrl = config.java?.downloadUrl || DEFAULT_JAVA_DOWNLOAD_URL;

  const createWindow = () => {
    const win = new BrowserWindow({
      width: 1100,
      height: 700,
      frame: false,
      resizable: false,
      show: false,
      backgroundColor: '#080808',
      icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        devTools: process.env.NODE_ENV === 'development',
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    win.once('ready-to-show', () => win.show());
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
    return win;
  };

  let mainWindow;
  let engineInstallAbortController = null;
  const ENGINE_ABORT_ERROR = 'ENGINE_INSTALL_ABORTED';
  const isEngineAbortError = (error) =>
    error &&
    (error.message === ENGINE_ABORT_ERROR ||
      error.code === ENGINE_ABORT_ERROR ||
      error.name === 'AbortError');

  const sendLog = (message) => {
    mainWindow && mainWindow.webContents.send('launcher:log', message);
  };

  const emitEngineProgress = (payload) => {
    if (mainWindow) {
      mainWindow.webContents.send('engine:install-progress', payload);
    }
  };

  const parseJavaMajor = (versionString = '') => {
    if (!versionString) {
      return null;
    }
    const parts = versionString.split('.');
    if (parts[0] === '1' && parts.length > 1) {
      return parseInt(parts[1], 10);
    }
    return parseInt(parts[0], 10);
  };

  const normalizeForwardSlashes = (value) => (value ? value.replace(/\\/g, '/') : value);

  const renderConfigPlaceholders = (value) => {
    if (typeof value !== 'string') {
      return value;
    }
    const appDataDir = config.appDataPath || app.getPath('appData');
    const replacements = {
      minecraftDir: config.minecraftDir,
      minecraftDirForward: normalizeForwardSlashes(config.minecraftDir || ''),
      appData: appDataDir,
      appDataForward: normalizeForwardSlashes(appDataDir || '')
    };
    return value.replace(/\{(\w+)\}/g, (_, key) => replacements[key] ?? '');
  };

  const resolveCustomCommandJavaPath = () => {
    const custom = config.customLaunch || {};
    if (custom.javaPath) {
      const renderedPath = renderConfigPlaceholders(custom.javaPath).trim();
      return renderedPath || null;
    }
    if (custom.command) {
      const renderedCommand = renderConfigPlaceholders(custom.command).trim();
      if (!renderedCommand) {
        return null;
      }
      if (renderedCommand.startsWith('"')) {
        const closing = renderedCommand.indexOf('"', 1);
        if (closing > 1) {
          return renderedCommand.slice(1, closing);
        }
      }
      const [firstToken] = renderedCommand.split(/\s+/);
      return firstToken;
    }
    return null;
  };

  const probeJavaExecutable = (execPath) => {
    if (!execPath) {
      return null;
    }
    try {
      if (path.isAbsolute(execPath) && !fs.existsSync(execPath)) {
        return null;
      }
      const result = spawnSync(execPath, ['-version'], {
        encoding: 'utf-8',
        windowsHide: true
      });
      if (result.error || result.status !== 0) {
        return null;
      }
      const output = `${result.stdout || ''}\n${result.stderr || ''}`;
      const versionMatch = output.match(/version\s+"([^"]+)"/i);
      const version = versionMatch ? versionMatch[1] : '';
      const major = parseJavaMajor(version);
      const ready = typeof major === 'number' && major >= 17;
      return { ready, execPath, version };
    } catch {
      return null;
    }
  };

  const checkJavaAvailability = () => {
    const candidates = [];
    const customPath = resolveCustomCommandJavaPath();
    if (customPath) {
      candidates.push(customPath);
    }
    if (config.java?.executable) {
      candidates.push(config.java.executable);
    }
    candidates.push('java');
    const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
    let lastProbe = null;
    for (const candidate of uniqueCandidates) {
      const probe = probeJavaExecutable(candidate);
      if (probe && probe.ready) {
        return { ready: true, path: probe.execPath, version: probe.version };
      }
      if (probe) {
        lastProbe = probe;
      }
    }
    if (lastProbe) {
      return { ready: false, path: lastProbe.execPath, version: lastProbe.version };
    }
    return { ready: false };
  };

  const getJavaStatusPayload = () => {
    const status = checkJavaAvailability();
    return {
      ready: Boolean(status.ready),
      version: status.version || '',
      path: status.path || '',
      downloadUrl: javaDownloadUrl
    };
  };

  const sendJavaStatus = () => {
    const payload = getJavaStatusPayload();
    if (mainWindow) {
      mainWindow.webContents.send('java:status', payload);
    }
    return payload;
  };

  const broadcastModsStatus = async () => {
    const statuses = await getModStatusesSafe();
    mainWindow && mainWindow.webContents.send('mods:status', statuses);
    return statuses;
  };

  const isEngineReady = () => {
    const appData = app.getPath('appData');
    const minecraftDir = path.join(appData, '.minecraft');
    const tlauncherDir = path.join(appData, '.tlauncher');
    return fs.existsSync(minecraftDir) && fs.existsSync(tlauncherDir);
  };

  const downloadEngineArchive = async (onProgress, signal) => {
    if (signal?.aborted) {
      throw new Error(ENGINE_ABORT_ERROR);
    }
    const response = await fetch(ENGINE_URL, { signal });
    if (!response.ok) {
      throw new Error(`Failed to download engine archive (HTTP ${response.status})`);
    }
    const totalBytes = Number(response.headers.get('content-length') || 0);
    const tempZipPath = path.join(app.getPath('temp'), `leo-engine-${Date.now()}.zip`);
    await new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(tempZipPath);
      let downloaded = 0;
      const cleanup = () => {
        signal && signal.removeEventListener('abort', abortHandler);
      };
      const abortHandler = () => {
        fileStream.destroy();
        cleanup();
        reject(new Error(ENGINE_ABORT_ERROR));
      };
      if (signal) {
        signal.addEventListener('abort', abortHandler);
      }
      response.body.on('data', (chunk) => {
        downloaded += chunk.length;
        if (typeof onProgress === 'function') {
          const percent = totalBytes ? Math.min(100, (downloaded / totalBytes) * 100) : 0;
          onProgress({ phase: 'download', downloaded, total: totalBytes, percent });
        }
      });
      response.body.on('error', (error) => {
        fileStream.destroy();
        cleanup();
        reject(error);
      });
      fileStream.on('finish', () => {
        cleanup();
        resolve();
      });
      response.body.pipe(fileStream);
    });
    return tempZipPath;
  };

  const installEngine = async (onProgress, signal) => {
    if (signal?.aborted) {
      throw new Error(ENGINE_ABORT_ERROR);
    }
    const archivePath = await downloadEngineArchive(onProgress, signal);
    try {
      if (signal?.aborted) {
        throw new Error(ENGINE_ABORT_ERROR);
      }
      onProgress && onProgress({ phase: 'extract', percent: 5 });
      const zip = new AdmZip(archivePath);
      zip.extractAllTo(app.getPath('appData'), false);
      onProgress && onProgress({ phase: 'extract', percent: 100 });
    } finally {
      await fs.promises.unlink(archivePath).catch(() => {});
    }
  };

  const ensureEngineReadyForMods = () => {
    if (!isEngineReady()) {
      throw new Error('Компоненты лаунчера не установлены');
    }
  };

  const getModStatusesSafe = async () => {
    if (!isEngineReady()) {
      return [];
    }
    return modManager.getStatuses();
  };

  const setupAutoUpdater = () => {
    if (process.env.NODE_ENV === 'development') {
      return;
    }
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-available', () => sendLog('Найдена новая версия лаунчера. Скачиваем обновление...'));
    autoUpdater.on('download-progress', (progress) => {
      sendLog(`Обновление лаунчера: ${Math.round(progress.percent)}%`);
    });
    autoUpdater.on('update-downloaded', () => sendLog('Обновление скачано и будет установлено после перезапуска.'));
    autoUpdater.on('error', (err) => sendLog(`Ошибка обновления лаунчера: ${err.message}`));
    autoUpdater.checkForUpdatesAndNotify();
  };

  app.whenReady().then(() => {
    mainWindow = createWindow();
    setupAutoUpdater();

    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('engine:status', { ready: isEngineReady() });
      sendJavaStatus();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  ipcMain.handle('launcher:get-config', async () => {
    const javaStatus = getJavaStatusPayload();
    return {
      server: config.server,
      forge: config.forge,
      java: config.java,
      lastUsername: store.get('lastUsername', ''),
      status: await getModStatusesSafe(),
      engineReady: isEngineReady(),
      javaReady: javaStatus.ready,
      javaDownloadUrl: javaStatus.downloadUrl,
      javaVersion: javaStatus.version
    };
  });

  ipcMain.handle('launcher:open-mods', async () => {
    const modsFolder = path.join(config.minecraftDir, 'mods');
    await shell.openPath(modsFolder);
    return true;
  });

  ipcMain.handle('mods:delete', async (_event, fileName) => {
    try {
      ensureEngineReadyForMods();
      await modManager.deleteMod(fileName);
      const statuses = await broadcastModsStatus();
      return { ok: true, statuses };
    } catch (error) {
      console.error('Delete mod error:', error);
      sendLog(`Ошибка удаления мода: ${error.message}`);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('mods:delete-all', async () => {
    try {
      ensureEngineReadyForMods();
      await modManager.deleteAllMods();
      const statuses = await broadcastModsStatus();
      return { ok: true, statuses };
    } catch (error) {
      console.error('Delete all mods error:', error);
      sendLog(`Ошибка удаления модов: ${error.message}`);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('mods:reinstall-all', async () => {
    try {
      ensureEngineReadyForMods();
      sendLog('Переустановка модов...');
      const statuses = await modManager.sync({
        force: true,
        onProgress: (payload) => mainWindow && mainWindow.webContents.send('mods:install-progress', payload)
      });
      mainWindow && mainWindow.webContents.send('mods:status', statuses);
      return { ok: true };
    } catch (error) {
      console.error('Reinstall mods error:', error);
      sendLog(`Ошибка переустановки модов: ${error.message}`);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('engine:install', async () => {
    if (engineInstallAbortController) {
      return { ok: false, error: 'Установка уже выполняется' };
    }
    engineInstallAbortController = new AbortController();
    try {
      sendLog('Загрузка компонентов лаунчера...');
      emitEngineProgress({ phase: 'start', percent: 0, active: true });
      await installEngine(
        (progress) => emitEngineProgress({ ...progress, active: true }),
        engineInstallAbortController.signal
      );
      emitEngineProgress({ phase: 'done', percent: 100, active: false });
      sendLog('Компоненты лаунчера установлены.');
      mainWindow && mainWindow.webContents.send('engine:status', { ready: isEngineReady() });
      return { ok: true };
    } catch (error) {
      if (isEngineAbortError(error)) {
        sendLog('Установка компонентов отменена.');
        emitEngineProgress({ phase: 'cancelled', percent: 0, active: false });
        return { ok: false, cancelled: true };
      }
      console.error('Engine installation error:', error);
      sendLog(`Ошибка установки компонентов: ${error.message}`);
      emitEngineProgress({ phase: 'error', percent: 0, active: false });
      dialog.showErrorBox('LeoLauncher', error.message);
      return { ok: false, error: error.message };
    } finally {
      engineInstallAbortController = null;
    }
  });

  ipcMain.handle('engine:cancel', async () => {
    if (engineInstallAbortController) {
      engineInstallAbortController.abort();
      return { ok: true };
    }
    return { ok: false, error: 'Нет активной установки' };
  });

  ipcMain.handle('app:open-url', async (_event, targetUrl) => {
    if (!targetUrl) {
      return { ok: false, error: 'URL не указан' };
    }
    try {
      await shell.openExternal(targetUrl);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('window:minimize', () => {
    if (mainWindow) {
      mainWindow.minimize();
    }
  });

  ipcMain.handle('window:close', () => {
    if (process.platform === 'darwin') {
      app.hide();
    } else {
      app.quit();
    }
  });

  ipcMain.handle('launcher:launch', async (_event, payload) => {
    const pushLog = (message) => sendLog(message);

    try {
      if (!isEngineReady()) {
        pushLog('Ошибка: компоненты лаунчера не установлены.');
        return { ok: false, error: 'Компоненты лаунчера не установлены' };
      }
      const javaStatus = checkJavaAvailability();
      if (!javaStatus.ready) {
        pushLog('Ошибка: Java 17 не найдена.');
        sendJavaStatus();
        return {
          ok: false,
          error: 'JAVA_MISSING',
          javaMissing: true,
          downloadUrl: javaDownloadUrl
        };
      }
      store.set('lastUsername', payload.username);
      pushLog('Синхронизация модов');
      const modStatuses = await modManager.sync();
      mainWindow && mainWindow.webContents.send('mods:status', modStatuses);
      pushLog('Forge проверен');
      await forgeManager.ensureInstalled(config.minecraftDir, pushLog);
      pushLog('Запуск Minecraft');
      await launcherService.launch(
        {
          username: payload.username,
          minMemory: payload.minMemory,
          maxMemory: payload.maxMemory
        },
        config.forge.profileName,
        pushLog
      );
      return { ok: true };
    } catch (error) {
      pushLog(`Ошибка: ${error.message}`);
      return { ok: false, error: error.message };
    }
  });
};

bootstrap().catch((err) => {
  console.error('Launcher bootstrap failed', err);
  app.quit();
});
