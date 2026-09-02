@echo off
chcp 65001 >nul
cd /d "%~dp0"
title התרופות שלי - שרת מקומי

echo.
echo   ============================================
echo    התרופות שלי  -  pillApp
echo   ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo   Python not found. Install Python or open index.html directly.
  pause
  exit /b 1
)

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=1" %%b in ("%%a") do set LANIP=%%b
)

echo   Local:  http://localhost:8899
if defined LANIP echo   Phone:  http://%LANIP%:8899   (preview only - no notifications/camera over plain http)
echo.
echo   Close this window to stop the server.
echo.

start "" http://localhost:8899
python -m http.server 8899
