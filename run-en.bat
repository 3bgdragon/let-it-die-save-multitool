@echo off
setlocal
chcp 65001 >nul
set "LID_NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%LID_NODE%" goto run_tool
set "LID_NODE=node.exe"
where node.exe >nul 2>nul
if not errorlevel 1 goto run_tool
echo Node.js 22.5 or newer is required. Install it from https://nodejs.org/
pause
exit /b 1
:run_tool
"%LID_NODE%" --no-warnings "%~dp0lid-kc.js" --lang en %*
set "LID_EXIT=%ERRORLEVEL%"
if not "%LID_EXIT%"=="0" echo Review the error above. If file access was denied, close the game and run this launcher as administrator.
pause
exit /b %LID_EXIT%
