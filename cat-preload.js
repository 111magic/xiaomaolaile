const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getWindowPos: () => ipcRenderer.invoke('get-window-pos'),
  dragMove: (x, y) => ipcRenderer.send('drag-move', { x, y }),
  wanderMove: (x, y) => ipcRenderer.send('wander-move', { x, y }),
  getScreenSize: () => ipcRenderer.invoke('get-screen-size'),
  resize: (w, h) => ipcRenderer.send('resize', w, h),
  pullOut: () => ipcRenderer.send('resize', 420, 330),
  putBack: () => ipcRenderer.send('resize', 120, 120),
  // LLM API Key
  getLLMKey: () => ipcRenderer.invoke('get-llm-key'),
  onPlayAnimation: (cb) => ipcRenderer.on('play-animation', (_, d) => cb(d.name)),
});
