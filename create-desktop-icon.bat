@echo off
cd /d "%~dp0"
echo Creating the BookT desktop shortcut...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$desktop = [Environment]::GetFolderPath('Desktop');" ^
  "$lnk = $ws.CreateShortcut((Join-Path $desktop 'BookT.lnk'));" ^
  "$lnk.TargetPath = Join-Path '%~dp0' 'start-bookt.bat';" ^
  "$lnk.WorkingDirectory = '%~dp0';" ^
  "$ico = Join-Path '%~dp0' 'bookt.ico';" ^
  "if (-not (Test-Path $ico)) { $ico = Join-Path '%~dp0' 'src\app\favicon.ico' };" ^
  "if (Test-Path $ico) { $lnk.IconLocation = $ico } else { $lnk.IconLocation = 'shell32.dll,13' };" ^
  "$lnk.Description = 'Start BookT (app + local AI service)';" ^
  "$lnk.Save()"

echo.
echo Done. Look for the "BookT" icon on your Desktop.
echo Double-click it to start everything and open the app.
echo.
ping -n 5 127.0.0.1 >nul
