/**
 * 主窗口 preload 脚本
 * 主窗口可以通过 electronAPI 控制猫咪悬浮窗
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 控制猫咪窗口
  showCat: () => ipcRenderer.send('show-cat'),
  hideCat: () => ipcRenderer.send('hide-cat'),
  playCatAnimation: (name) => ipcRenderer.send('cat-animation', { name }),
  catToBubble: () => ipcRenderer.send('cat-to-bubble'),
  catReturn: () => ipcRenderer.send('cat-return'),

  // 接收猫咪窗口事件
  onCatPulledOut: (callback) => {
    ipcRenderer.on('cat-pulled-out', () => callback());
  },
  onCatSingleTap: (callback) => {
    ipcRenderer.on('cat-single-tap', () => callback());
  },
  onCatReturned: (callback) => {
    ipcRenderer.on('cat-returned', () => callback());
  },

  // 平台信息
  isElectron: true,
  platform: 'desktop',
});
