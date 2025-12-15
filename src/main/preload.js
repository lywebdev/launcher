const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherApi', {
  getConfig: () => ipcRenderer.invoke('launcher:get-config'),
  launch: (payload) => ipcRenderer.invoke('launcher:launch', payload),
  openMods: () => ipcRenderer.invoke('launcher:open-mods'),
  onLog: (callback) => {
    ipcRenderer.on('launcher:log', (_event, message) => callback(message));
  },
  onModsStatus: (callback) => {
    ipcRenderer.on('mods:status', (_event, status) => callback(status));
  },
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close')
});
