@echo off
setlocal
cd /d "%~dp0"
echo Re:Connection prototype - http://127.0.0.1:5173/
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS first.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
powershell.exe -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2; if ($response.Content -match 'Re:Connection') { exit 0 }; exit 1 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo The prototype is already running. Open the URL above.
  pause
  exit /b 0
)
echo Keep this window open while playing. Ctrl+C stops the server.
call npm.cmd run dev
if errorlevel 1 pause
