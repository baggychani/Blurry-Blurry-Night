@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title Blurry Blurry Night

echo.
echo  Blurry Blurry Night - local dev server
echo  ----------------------------------------
echo.

set "NODEPATH=%ProgramFiles%\nodejs"
if exist "%NODEPATH%\node.exe" set "PATH=%PATH%;%NODEPATH%;%APPDATA%\npm"
set "NODEPATH=%LOCALAPPDATA%\Programs\nodejs"
if exist "%NODEPATH%\node.exe" set "PATH=%PATH%;%NODEPATH%;%APPDATA%\npm"

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install LTS from https://nodejs.org
    echo.
    pause
    exit /b 1
)

pushd "%~dp0" || (
    echo [ERROR] Cannot cd to project folder.
    pause
    exit /b 1
)

netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo Server already running. Opening browser...
    timeout /t 1 >nul
    start "" "http://localhost:3000"
    goto DONE
)

echo Starting dev server in background...
start /min "BBN dev server" /D "%CD%" cmd /c "npm run dev"

echo Waiting for port 3000 (up to ~30 sec)...
set /a BBN_COUNT=0
:WAIT_LOOP
timeout /t 2 >nul
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto OPEN_BROWSER
set /a BBN_COUNT+=1
if %BBN_COUNT% lss 15 goto WAIT_LOOP

echo [WARN] Server slow to start. Opening browser anyway.

:OPEN_BROWSER
start "" "http://localhost:3000"

:DONE
popd
echo.
echo  URL: http://localhost:3000
echo  Closing this window does not always stop the server.
echo  To stop: Task Manager - end node.exe
echo.
pause
endlocal
