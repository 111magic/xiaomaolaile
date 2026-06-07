/**
 * 猫咪桌面宠物 — Electron 主进程 (fixed)
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let catWindow = null;
let tray = null;
let isQuitting = false;

// 安全取数：确保是有效整数
function safeInt(v, fallback) {
  const n = Math.round(Number(v));
  return isNaN(n) ? fallback : n;
}

function createCatWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  // 读取 LLM API Key
  let llmKey = '';
  const keyPath = path.join(__dirname, 'llm-key.txt');
  try { llmKey = fs.readFileSync(keyPath, 'utf-8').trim(); } catch (_) {}

  catWindow = new BrowserWindow({
    width: 120, height: 120,
    x: Math.max(0, sw - 140),
    y: Math.max(0, sh - 200),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    type: 'toolbar',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'cat-preload.js'),
    },
  });

  // 用 IPC 提供 API Key（比 executeJavaScript 更可靠）
  ipcMain.handle('get-llm-key', () => llmKey);

  catWindow.loadFile(path.join(__dirname, 'cat-window.html'));
  catWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  catWindow.setAlwaysOnTop(true, 'screen-saver');

  catWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); catWindow.hide(); }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  if (!fs.existsSync(iconPath)) return;
  try {
    tray = new Tray(nativeImage.createFromPath(iconPath));
    tray.setToolTip('🐱 猫咪桌面宠物');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '🐱 显示猫咪', click: () => { if (catWindow) { catWindow.show(); catWindow.focus(); } } },
      { label: '❌ 退出', click: () => { isQuitting = true; app.quit(); } },
    ]));
  } catch (_) {}
}

// ====== IPC（所有位置参数都做 safeInt 保护） ======

// 拖拽：即时移动
ipcMain.on('drag-move', (_, obj) => {
  if (!catWindow) return;
  const x = safeInt(obj?.x, 100);
  const y = safeInt(obj?.y, 100);
  catWindow.setPosition(x, y);
});

// 溜达：平滑移动
let wanderAnim = null;
ipcMain.on('wander-move', (_, obj) => {
  if (!catWindow) return;
  const tx = safeInt(obj?.x, 200);
  const ty = safeInt(obj?.y, 200);
  const [sx, sy] = catWindow.getPosition();
  const steps = 8;
  const dx = (tx - sx) / steps;
  const dy = (ty - sy) / steps;

  if (wanderAnim) clearInterval(wanderAnim);
  let s = 0;
  wanderAnim = setInterval(() => {
    s++;
    if (s >= steps || !catWindow) {
      clearInterval(wanderAnim);
      wanderAnim = null;
      if (catWindow) catWindow.setPosition(tx, ty);
      return;
    }
    catWindow.setPosition(
      Math.round(sx + dx * s),
      Math.round(sy + dy * s)
    );
  }, 60);
});

// 大小切换
ipcMain.on('resize', (_, w, h) => {
  if (!catWindow) return;
  const nw = safeInt(w, 120);
  const nh = safeInt(h, 120);
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  const [cx, cy] = catWindow.getPosition();
  catWindow.setSize(nw, nh);

  if (nw > 200) {
    // 拎出：屏幕底部居中
    catWindow.setPosition(
      Math.round((sw - nw) / 2),
      Math.max(0, sh - nh - 20)
    );
  } else {
    // 收回：保持在可视范围
    let nx = safeInt(cx, sw - 140);
    let ny = safeInt(cy, sh - 200);
    if (nx + nw > sw) nx = sw - nw - 10;
    if (ny + nh > sh) ny = sh - nh - 40;
    if (nx < 0) nx = 10;
    catWindow.setPosition(nx, ny);
  }
});

ipcMain.handle('get-window-pos', () => {
  if (!catWindow) return { x: 0, y: 0 };
  const [x, y] = catWindow.getPosition();
  return { x, y };
});

ipcMain.handle('get-screen-size', () => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return { width, height };
});

ipcMain.on('cat-animation', (_, obj) => {
  catWindow?.webContents.send('play-animation', { name: obj?.name || '' });
});

// ====== 启动 ======
app.whenReady().then(() => {
  createCatWindow();
  createTray();
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => { isQuitting = true; });
app.on('activate', () => {
  if (!catWindow) createCatWindow();
  else catWindow.show();
});
