@echo off
chcp 65001 >nul
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 18 或更高版本：https://nodejs.org
  pause
  exit /b 1
)
echo 考试系统 v1.0 启动中……
echo 浏览器将自动打开 http://localhost:3000 ，关闭本窗口即停止服务。
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
node server.js
pause
