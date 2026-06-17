@echo off
setlocal EnableExtensions

set "INSTALL_ROOT=%LOCALAPPDATA%\LunaTV Local Service"
set "LEGACY_INSTALL_ROOT=%USERPROFILE%\.lunatv"
set "RUN_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
set "UNINSTALL_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\LunaTVLocalService"

taskkill /IM lunatv-server.exe /F >nul 2>nul
reg delete "%RUN_KEY%" /v LunaTVLocalService /f >nul 2>nul
reg delete "%UNINSTALL_KEY%" /f >nul 2>nul

start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ^
  "Start-Sleep -Seconds 1; " ^
  "$installRoot = Join-Path $env:LOCALAPPDATA 'LunaTV Local Service'; " ^
  "$legacyInstallRoot = Join-Path $env:USERPROFILE '.lunatv'; " ^
  "if (Test-Path $installRoot) { Remove-Item -Recurse -Force $installRoot -ErrorAction SilentlyContinue }; " ^
  "if (Test-Path $legacyInstallRoot) { Remove-Item -Recurse -Force $legacyInstallRoot -ErrorAction SilentlyContinue }"

echo LunaTV local service uninstalled.
echo Refresh LunaTV in your browser to use the default route.

endlocal
