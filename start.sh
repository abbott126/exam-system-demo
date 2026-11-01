#!/bin/sh
# 考试系统 v1.0 一键启动（macOS / Linux）
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请先安装 Node.js 18 或更高版本：https://nodejs.org"
  exit 1
fi
echo "考试系统 v1.0 启动中……请在浏览器打开 http://localhost:3000（Ctrl+C 停止）"
node server.js
