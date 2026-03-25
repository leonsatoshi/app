@echo off
setlocal

set "SHORTCUT_NAME=NOVA Command Center.lnk"
set "TARGET=%~dp0start-nova-local.bat"
set "DESKTOP=%USERPROFILE%\Desktop\%SHORTCUT_NAME%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$WshShell = New-Object -ComObject WScript.Shell;" ^
  "$Shortcut = $WshShell.CreateShortcut('%DESKTOP%');" ^
  "$Shortcut.TargetPath = '%TARGET%';" ^
  "$Shortcut.WorkingDirectory = '%~dp0';" ^
  "$Shortcut.IconLocation = '%SystemRoot%\System32\SHELL32.dll,220';" ^
  "$Shortcut.Save()"

if exist "%DESKTOP%" (
  echo Desktop shortcut created: %DESKTOP%
) else (
  echo Shortcut creation may have failed. Try running this script as a normal desktop user.
)

pause
