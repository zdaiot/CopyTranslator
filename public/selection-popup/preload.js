const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['translate', 'close', 'pin', 'incremental', 'clear-accumulated', 'copy-source', 'copy-result', 'retry', 'engine', 'settings', 'ai-settings', 'main', 'drag-start', 'drag-move', 'drag-end', 'resize-start', 'resize-move', 'resize-end', 'size-preset', 'pane', 'chat-send', 'chat-stop', 'chat-clear', 'chat-retry', 'chat-engine']);
contextBridge.exposeInMainWorld('selectionPopup', {
  state: () => ipcRenderer.invoke('selection-popup:state'),
  action: (action, value) => actions.has(action) ? ipcRenderer.invoke('selection-popup:action', action, value) : Promise.resolve(),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('selection-popup:update', listener);
    return () => ipcRenderer.removeListener('selection-popup:update', listener);
  },
});
