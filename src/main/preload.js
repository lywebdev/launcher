const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherApi', {
  getConfig: () => ipcRenderer.invoke('launcher:get-config'),
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  launch: (payload) => ipcRenderer.invoke('launcher:launch', payload),
  openMods: () => ipcRenderer.invoke('launcher:open-mods'),
  installEngine: () => ipcRenderer.invoke('engine:install'),
  cancelEngineInstall: () => ipcRenderer.invoke('engine:cancel'),
  reinstallMods: () => ipcRenderer.invoke('mods:reinstall-all'),
  deleteAllMods: () => ipcRenderer.invoke('mods:delete-all'),
  deleteMod: (fileName) => ipcRenderer.invoke('mods:delete', fileName),
  installMod: (fileName) => ipcRenderer.invoke('mods:install-one', fileName),
  openExternal: (url) => ipcRenderer.invoke('app:open-url', url),
  onLog: (callback) => {
    ipcRenderer.on('launcher:log', (_event, message) => callback(message));
  },
  onModsStatus: (callback) => {
    ipcRenderer.on('mods:status', (_event, status) => callback(status));
  },
  onEngineStatus: (callback) => {
    ipcRenderer.on('engine:status', (_event, status) => callback(status));
  },
  onEngineProgress: (callback) => {
    ipcRenderer.on('engine:install-progress', (_event, payload) => callback(payload));
  },
  onJavaStatus: (callback) => {
    ipcRenderer.on('java:status', (_event, payload) => callback(payload));
  },
  onModsInstallProgress: (callback) => {
    ipcRenderer.on('mods:install-progress', (_event, payload) => callback(payload));
  },
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close')
});
