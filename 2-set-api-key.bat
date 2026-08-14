@echo off
cd /d "%~dp0"
echo Paste your DeepSeek API key when it asks, then press Enter.
echo.
"C:\Program Files\nodejs\node.exe" "C:\Users\VANSH\AppData\Roaming\npm\node_modules\wrangler\bin\wrangler.js" secret put DEEPSEEK_API_KEY
echo.
echo Done. You can close this window.
pause
