@echo off
setlocal
chcp 65001 >nul

set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if exist "%NODE_EXE%" goto run_tool

set "NODE_EXE=node.exe"
where node.exe >nul 2>nul
if not errorlevel 1 goto run_tool

echo Node.js was not found. Install Node.js 22.5 or newer and try again.
pause
exit /b 1

:run_tool
"%NODE_EXE%" --no-warnings "%~dp0lid-kc.js" %*
echo.
pause
