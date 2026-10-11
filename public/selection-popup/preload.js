const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['translate', 'close', 'pin', 'copy-source', 'copy-result', 'retry', 'engine', 'settings', 'ai-settings', 'main']);
contextBridge.exposeInMainWorld('selectionPopup', {
  state: () => ipcRenderer.invoke('selection-popup:state'),
  action: (action, value) => actions.has(action) ? ipcRenderer.invoke('selection-popup:action', action, value) : Promise.resolve(),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('selection-popup:update', listener);
    return () => ipcRenderer.removeListener('selection-popup:update', listener);
  },
});
