@echo off
setlocal EnableExtensions

set "INSTALL_ROOT=%LOCALAPPDATA%\LunaTV Local Service"
set "LEGACY_INSTALL_ROOT=%USERPROFILE%\.lunatv"
set "BIN_DIR=%INSTALL_ROOT%\bin"
set "DATA_DIR=%INSTALL_ROOT%\data"
set "TARGET=%BIN_DIR%\lunatv-server.exe"
set "CONFIG_PATH=%INSTALL_ROOT%\config.json"
set "LAUNCHER_PATH=%INSTALL_ROOT%\run-local-service.vbs"
set "RUN_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"

taskkill /IM lunatv-server.exe /F >nul 2>nul
if exist "%LEGACY_INSTALL_ROOT%" rmdir /s /q "%LEGACY_INSTALL_ROOT%"

mkdir "%BIN_DIR%" 2>nul
mkdir "%DATA_DIR%" 2>nul

copy /Y "%~dp0lunatv-server.exe" "%TARGET%" >nul
if not exist "%CONFIG_PATH%" (
  copy /Y "%~dp0config.json" "%CONFIG_PATH%" >nul
)
copy /Y "%~dp0run-local-service.vbs" "%LAUNCHER_PATH%" >nul

reg add "%RUN_KEY%" /v LunaTVLocalService /t REG_SZ /d "\"%SystemRoot%\System32\wscript.exe\" \"%LAUNCHER_PATH%\"" /f >nul

start "" "%SystemRoot%\System32\wscript.exe" "%LAUNCHER_PATH%"

echo LunaTV local service installed.
echo Refresh LunaTV in your browser to use local acceleration.

endlocal
