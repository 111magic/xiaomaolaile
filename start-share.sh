#!/bin/bash
# 喵了个咪 — 一键启动
cd "$(dirname "$0")"

# 杀干净
lsof -ti :8765 2>/dev/null | xargs kill -9 2>/dev/null
pkill -9 -f "ssh.*8765" 2>/dev/null
pkill -9 -f "serveo" 2>/dev/null
sleep 1

echo "🐱 启动服务器..."
python3 share-server.py > /tmp/meow-server.log 2>&1 &
sleep 2

if ! lsof -ti :8765 > /dev/null 2>&1; then
  echo "❌ 服务器启动失败"; cat /tmp/meow-server.log; exit 1
fi
echo "✅ 本地: http://localhost:8765"

# 隧道
rm -f /tmp/meow-tunnel.log /tmp/meow-url.txt
> /tmp/meow-tunnel.log

while true; do
  echo "🔗 建立公网隧道..."
  ssh -o StrictHostKeyChecking=no \
      -o ConnectTimeout=15 \
      -o ServerAliveInterval=30 \
      -o TCPKeepAlive=yes \
      -T -R 80:localhost:8765 \
      serveo.net 2>&1 | while IFS= read -r line; do
    echo "$line" >> /tmp/meow-tunnel.log
    clean=$(echo "$line" | sed 's/\x1b\[[0-9;]*m//g')
    echo "$clean"
    # 匹配 serveousercontent URL
    URL=$(echo "$clean" | sed -n 's/.*\(http:\/\/[a-z0-9\.\-]*\.serveousercontent\.com\).*/\1/p')
    if [ -n "$URL" ]; then
      echo "$URL" > /tmp/meow-url.txt
      echo ""
      echo " ============================================="
      echo "  ✅ 链接就绪，复制发给朋友："
      echo "  🔗 $URL"
      echo " ============================================="
      echo ""
    fi
  done
  echo "⚠️ 隧道断开，3秒后重连..."
  sleep 3
done
