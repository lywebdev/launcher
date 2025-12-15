const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const config = require('./config');
const ModManager = require('./modManager');
const ForgeManager = require('./forgeManager');
const LauncherService = require('./launcherService');

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

  app.whenReady().then(() => {
    mainWindow = createWindow();

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
    status: await modManager.getStatuses()
  }));

  ipcMain.handle('launcher:open-mods', async () => {
    const modsFolder = path.join(config.minecraftDir, 'mods');
    await shell.openPath(modsFolder);
    return true;
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
    const pushLog = (message) => {
      mainWindow && mainWindow.webContents.send('launcher:log', message);
    };

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

