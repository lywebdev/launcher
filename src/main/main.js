const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, BrowserWindow, ipcMain, shell, dialog, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');

const APP_USER_MODEL_ID = 'com.leolauncher.app';
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

const config = require('./config');
const APP_VERSION = app.getVersion();
const gotInstanceLock = app.requestSingleInstanceLock();

if (!gotInstanceLock) {
  app.whenReady().then(() => {
    if (Notification.isSupported()) {
      const duplicateNotification = new Notification({
        title: 'LeoLauncher',
        body: 'Лаунчер уже запущен.'
      });
      duplicateNotification.show();
    }
    app.quit();
  });
  return;
}
const ensureDirSync = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};
config.appDataPath = config.appDataPath || app.getPath('appData');
const runtimeRoot = path.join(config.appDataPath, 'LeoLauncher');
  config.runtimeDir = path.join(runtimeRoot, 'runtime');
  ensureDirSync(config.runtimeDir);
const ModManager = require('./modManager');
const ForgeManager = require('./forgeManager');
const LauncherService = require('./launcherService');
const ServerListManager = require('./serverListManager');

const ENGINE_URL = 'https://storage.lyweb.dev/.engine.zip';

const bootstrap = async () => {
  const Store = (await import('electron-store')).default;
  const store = new Store({ name: 'launcher-state' });
  const modManager = new ModManager(config.minecraftDir, config.runtimeDir, config.modsRepo);
  const forgeManager = new ForgeManager(config.forge, config.runtimeDir, config.java);
  const launcherService = new LauncherService(config);
  const serverListManager = new ServerListManager(config.minecraftDir);
  const DEFAULT_JAVA_DOWNLOAD_URL =
    'https://www.oracle.com/java/technologies/downloads/#jdk17-windows';
  const javaDownloadUrl = config.java?.downloadUrl || DEFAULT_JAVA_DOWNLOAD_URL;

  const createWindow = () => {
    const win = new BrowserWindow({
      width: 1100,
      height: 700,
      minWidth: 960,
      minHeight: 600,
      frame: false,
      resizable: true,
      fullscreenable: true,
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
    win.on('enter-full-screen', () => {
      win.webContents.send('window:fullscreen', { fullScreen: true });
    });
    win.on('leave-full-screen', () => {
      win.webContents.send('window:fullscreen', { fullScreen: false });
    });
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
    return win;
  };

  let mainWindow;
  let engineInstallAbortController = null;
  let modStatusesCache = [];
  const ENGINE_ABORT_ERROR = 'ENGINE_INSTALL_ABORTED';
  const isEngineAbortError = (error) =>
    error &&
    (error.message === ENGINE_ABORT_ERROR ||
      error.code === ENGINE_ABORT_ERROR ||
      error.name === 'AbortError');

  const sendLog = (message) => {
    mainWindow && mainWindow.webContents.send('launcher:log', message);
  };

  const emitUpdaterStatus = (payload) => {
    if (!mainWindow || !payload) return;
    mainWindow.webContents.send('updater:status', payload);
  };

  const emitEngineProgress = (payload) => {
    if (mainWindow) {
      mainWindow.webContents.send('engine:install-progress', payload);
    }
  };

  const broadcastModsStatus = async () => {
    const statuses = await getModStatusesSafe();
    modStatusesCache = statuses;
    mainWindow && mainWindow.webContents.send('mods:status', statuses);
    return statuses;
  };

  const isEngineReady = () => {
    const appData = app.getPath('appData');
    const minecraftDir = path.join(appData, '.minecraft');
    const tlauncherDir = path.join(appData, '.tlauncher');
    return fs.existsSync(minecraftDir) && fs.existsSync(tlauncherDir);
  };

  const ensureServerEntryIfReady = async () => {
    if (!isEngineReady()) {
      return;
    }
    try {
      await serverListManager.ensureServer(config.server);
    } catch (error) {
      console.error('Failed to ensure server entry:', error);
    }
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
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('checking-for-update', () => {
      sendLog('Проверяем обновления лаунчера...');
      emitUpdaterStatus({ state: 'checking', message: 'Проверка обновлений...' });
    });
    autoUpdater.on('update-available', () => {
      sendLog('Найдена новая версия лаунчера. Скачиваем обновление...');
      emitUpdaterStatus({ state: 'downloading', message: 'Скачиваем обновление...' });
    });
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.round(progress.percent);
      sendLog(`Обновление лаунчера: ${percent}%`);
      emitUpdaterStatus({
        state: 'downloading',
        message: `Скачиваем обновление... ${percent}%`,
        progress: percent
      });
    });
    autoUpdater.on('update-not-available', () => {
      sendLog('Используется актуальная версия лаунчера.');
      emitUpdaterStatus({ state: 'idle' });
    });
    autoUpdater.on('update-downloaded', () => {
      sendLog('Обновление скачано. Перезапуск для установки...');
      emitUpdaterStatus({ state: 'installing', message: 'Устанавливаем обновление...' });
      autoUpdater.quitAndInstall(true, true);
    });
    autoUpdater.on('error', (err) => {
      sendLog(`Ошибка обновления лаунчера: ${err.message}`);
      emitUpdaterStatus({ state: 'error', message: 'Ошибка проверки обновлений' });
    });
    autoUpdater.checkForUpdates().catch((error) => {
      sendLog(`Ошибка проверки обновлений: ${error.message}`);
      emitUpdaterStatus({ state: 'error', message: 'Ошибка проверки обновлений' });
    });
  };

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
      if (Notification.isSupported()) {
        new Notification({
          title: 'LeoLauncher',
          body: 'Лаунчер уже запущен. Окно активировано.'
        }).show();
      }
    }
  });

  app.whenReady().then(() => {
    mainWindow = createWindow();
    setupAutoUpdater();

    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('engine:status', { ready: isEngineReady() });
      ensureServerEntryIfReady();
      broadcastModsStatus().catch((error) =>
        sendLog(`Ошибка синхронизации модов: ${error.message || error}`)
      );
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
    return {
      server: config.server,
      forge: config.forge,
      java: config.java,
      lastUsername: store.get('lastUsername', ''),
      lastMemory: store.get('lastMemory', null),
      status: modStatusesCache,
      engineReady: isEngineReady(),
      javaDownloadUrl,
      appVersion: APP_VERSION
    };
  });

  ipcMain.handle('system:info', () => {
    const toGb = (value) => Math.round((value / (1024 ** 3)) * 10) / 10;
    const totalMemGB = os.totalmem ? toGb(os.totalmem()) : 0;
    const freeMemGB = os.freemem ? toGb(os.freemem()) : 0;
    return { totalMemGB, freeMemGB };
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

  ipcMain.handle('mods:install-one', async (_event, fileName) => {
    try {
      ensureEngineReadyForMods();
      const statuses = await modManager.installMod(fileName, (payload) =>
        mainWindow && mainWindow.webContents.send('mods:install-progress', payload)
      );
      modStatusesCache = statuses;
      mainWindow && mainWindow.webContents.send('mods:status', statuses);
      return { ok: true };
    } catch (error) {
      console.error('Install mod error:', error);
      sendLog(`Ошибка установки мода: ${error.message}`);
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
      modStatusesCache = statuses;
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
      await ensureServerEntryIfReady();
      await broadcastModsStatus();
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

  ipcMain.handle('window:toggle-fullscreen', () => {
    if (!mainWindow) {
      return { ok: false, error: 'Окно недоступно' };
    }
    const targetState = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(targetState);
    mainWindow.webContents.send('window:fullscreen', { fullScreen: targetState });
    return { ok: true, fullScreen: targetState };
  });

  ipcMain.handle('window:get-state', () => {
    if (!mainWindow) {
      return { ok: false, fullScreen: false };
    }
    return { ok: true, fullScreen: mainWindow.isFullScreen() };
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
      store.set('lastUsername', payload.username);
      if (payload.minMemory && payload.maxMemory) {
        store.set('lastMemory', {
          min: payload.minMemory,
          max: payload.maxMemory
        });
      }
      pushLog('Синхронизация модов');
      const modStatuses = await modManager.sync();
      mainWindow && mainWindow.webContents.send('mods:status', modStatuses);
      pushLog('Forge проверен');
      await forgeManager.ensureInstalled(config.minecraftDir, pushLog);
      await ensureServerEntryIfReady();
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

  ipcMain.handle('launcher:store-memory', (_event, payload) => {
    if (payload && payload.minMemory && payload.maxMemory) {
      store.set('lastMemory', {
        min: payload.minMemory,
        max: payload.maxMemory
      });
      return { ok: true };
    }
    return { ok: false };
  });
};

bootstrap().catch((err) => {
  console.error('Launcher bootstrap failed', err);
  app.quit();
});
