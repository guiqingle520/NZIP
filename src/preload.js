const { contextBridge, ipcRenderer, webUtils } = require('electron');
const events = new Set(['jobs', 'state', 'open-archive', 'launch-request']);
contextBridge.exposeInMainWorld('nzip', {
  init: () => ipcRenderer.invoke('init'),
  window: action => ipcRenderer.invoke('window', action),
  choose: (kind, defaultPath) => ipcRenderer.invoke('choose', kind, defaultPath),
  list: (archive, password) => ipcRenderer.invoke('list', archive, password),
  describe: paths => ipcRenderer.invoke('describe', paths),
  startJob: (type, payload) => ipcRenderer.invoke('start-job', type, payload),
  cancelJob: id => ipcRenderer.invoke('cancel-job', id),
  settings: settings => ipcRenderer.invoke('settings', settings),
  integration: enabled => ipcRenderer.invoke('integration', enabled),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  reveal: p => ipcRenderer.invoke('reveal', p),
  openResult: id => ipcRenderer.invoke('open-result', id),
  preview: payload => ipcRenderer.invoke('preview', payload),
  filePath: file => webUtils.getPathForFile(file),
  on: (name, callback) => {
    if (!events.has(name)) return;
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(name, listener);
    return () => ipcRenderer.removeListener(name, listener);
  }
});
