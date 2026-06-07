#!/bin/bash
# 🐱 喵了个咪 — 启动脚本
cd "$(dirname "$0")"
ELECTRON="./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ -f "$ELECTRON" ]; then
  "$ELECTRON" . &
  echo "🐱 喵了个咪已启动！猫咪在桌面右下角～"
else
  echo "⚠️ 首次运行需要安装：npm install electron"
  npm install electron && "$ELECTRON" . &
fi
