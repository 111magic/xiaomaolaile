#!/bin/bash
# 打开两个 Agent 测试窗口
cd "$(dirname "$0")"

MODE="${1:-action}"
echo "🐱 正在打开 Agent A 和 Agent B 窗口 (模式: $MODE)..."
if [ "$MODE" = "action" ]; then
  open "http://localhost:3000?agent=A&demo=action"
  sleep 1
  open "http://localhost:3000?agent=B&demo=action"
else
  open "http://localhost:3000?agent=A"
  sleep 1
  open "http://localhost:3000?agent=B"
fi
echo "✅ 两个窗口已打开"
