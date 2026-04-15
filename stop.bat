@echo off
echo ========================================
echo    🥚 COUVEUSE MANAGER - ARRET
echo ========================================
echo.

echo Arret des serveurs en cours...

echo [1/2] Arret de Django...
taskkill /FI "WindowTitle eq Django Backend*" /F 2>nul

echo [2/2] Arret de Node.js...
taskkill /FI "WindowTitle eq Node.js Notifier*" /F 2>nul

timeout /t 2 /nobreak > nul

echo.
echo ========================================
echo    ✅ SERVEURS ARRETES
echo ========================================
echo.
echo Appuyez sur une touche pour fermer...
pause > nul
