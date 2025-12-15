const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');

const config = require('./config');
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

  const createWindow = () => {
    const win = new BrowserWindow({
      width: 1100,
      height: 700,
      frame: false,
      resizable: false,
      show: false,
      backgroundColor: '#080808',
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

  const sendLog = (message) => {
    mainWindow && mainWindow.webContents.send('launcher:log', message);
  };

  const emitEngineProgress = (payload) => {
    if (mainWindow) {
      mainWindow.webContents.send('engine:install-progress', payload);
    }
  };

  const isEngineReady = () => {
    const appData = app.getPath('appData');
    const minecraftDir = path.join(appData, '.minecraft');
    const tlauncherDir = path.join(appData, '.tlauncher');
    return fs.existsSync(minecraftDir) && fs.existsSync(tlauncherDir);
  };

  const downloadEngineArchive = async (onProgress) => {
    const response = await fetch(ENGINE_URL);
    if (!response.ok) {
      throw new Error(`Failed to download engine archive (HTTP ${response.status})`);
    }
    const totalBytes = Number(response.headers.get('content-length') || 0);
    const tempZipPath = path.join(app.getPath('temp'), `leo-engine-${Date.now()}.zip`);
    await new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(tempZipPath);
      let downloaded = 0;
      response.body.on('data', (chunk) => {
        downloaded += chunk.length;
        if (typeof onProgress === 'function') {
          const percent = totalBytes ? Math.min(100, (downloaded / totalBytes) * 100) : 0;
          onProgress({ phase: 'download', downloaded, total: totalBytes, percent });
        }
      });
      response.body.on('error', (error) => {
        fileStream.destroy();
        reject(error);
      });
      fileStream.on('finish', resolve);
      response.body.pipe(fileStream);
    });
    return tempZipPath;
  };

  const installEngine = async (onProgress) => {
    const archivePath = await downloadEngineArchive(onProgress);
    try {
      onProgress && onProgress({ phase: 'extract', percent: 5 });
      const zip = new AdmZip(archivePath);
      zip.extractAllTo(app.getPath('appData'), false);
      onProgress && onProgress({ phase: 'extract', percent: 100 });
    } finally {
      await fs.promises.unlink(archivePath).catch(() => {});
    }
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

  ipcMain.handle('launcher:get-config', async () => ({
    server: config.server,
    forge: config.forge,
    java: config.java,
    lastUsername: store.get('lastUsername', ''),
    status: await modManager.getStatuses(),
    engineReady: isEngineReady()
  }));

  ipcMain.handle('launcher:open-mods', async () => {
    const modsFolder = path.join(config.minecraftDir, 'mods');
    await shell.openPath(modsFolder);
    return true;
  });

  ipcMain.handle('engine:install', async () => {
    try {
      sendLog('Загрузка компонентов лаунчера...');
      emitEngineProgress({ phase: 'start', percent: 0, active: true });
      await installEngine((progress) => emitEngineProgress({ ...progress, active: true }));
      emitEngineProgress({ phase: 'done', percent: 100, active: false });
      sendLog('Компоненты лаунчера установлены.');
      mainWindow && mainWindow.webContents.send('engine:status', { ready: isEngineReady() });
      return { ok: true };
    } catch (error) {
      console.error('Engine installation error:', error);
      sendLog(`Ошибка установки компонентов: ${error.message}`);
      emitEngineProgress({ phase: 'error', percent: 0, active: false });
      dialog.showErrorBox('LeoLauncher', error.message);
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
    store.set('lastUsername', payload.username);
    const pushLog = (message) => sendLog(message);

    try {
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
