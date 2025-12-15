const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherApi', {
  getConfig: () => ipcRenderer.invoke('launcher:get-config'),
  launch: (payload) => ipcRenderer.invoke('launcher:launch', payload),
  openMods: () => ipcRenderer.invoke('launcher:open-mods'),
  installEngine: () => ipcRenderer.invoke('engine:install'),
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
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close')
});
