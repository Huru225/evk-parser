@echo off
chcp 65001 >nul
title 唤境资源解析器

echo.
echo ==============================
echo   唤境资源解析器 启动器
echo ==============================
echo.

cd /d "%~dp0"

:: 检查端口占用并清理
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTEN"') do (
    echo 终止占用3000端口的进程: %%a
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: 检查node是否安装
node -v >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装 Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

:: 检查依赖是否安装
if not exist node_modules\express (
    echo 安装依赖中...
    npm install
)

:: 启动服务器
echo 启动服务器...
echo 浏览器打开: http://localhost:3000
echo.
start "" "http://localhost:3000"
node server.js
pause
