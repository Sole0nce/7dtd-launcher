'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel) {
  return function (handler) {
    const listener = function (_event, payload) { handler(payload); };
    ipcRenderer.on(channel, listener);
    return function () { ipcRenderer.removeListener(channel, listener); };
  };
}

contextBridge.exposeInMainWorld('launcher', {
  meta: function () { return ipcRenderer.invoke('meta'); },
  settings: {
    get: function () { return ipcRenderer.invoke('settings:get'); },
    set: function (patch) { return ipcRenderer.invoke('settings:set', patch); }
  },
  game: {
    detect: function () { return ipcRenderer.invoke('game:detect'); },
    setPath: function (target) { return ipcRenderer.invoke('game:set-path', target); },
    pick: function () { return ipcRenderer.invoke('game:pick'); },
    launch: function (payload) { return ipcRenderer.invoke('game:launch', payload); },
    open: function (kind) { return ipcRenderer.invoke('shell:open', { kind: kind }); }
  },
  window: {
    minimize: function () { return ipcRenderer.invoke('window:action', 'minimize'); },
    maximize: function () { return ipcRenderer.invoke('window:action', 'maximize'); },
    close: function () { return ipcRenderer.invoke('window:action', 'close'); }
  },
  onDetectProgress: subscribe('detect:progress'),
  onGameExited: subscribe('game:exited'),
  onGameError: subscribe('game:error')
});
