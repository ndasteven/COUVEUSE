@echo off
echo ========================================
echo    🥚 COUVEUSE MANAGER - DEMARRAGE
echo ========================================
echo.

echo [1/3] Demarrage de Django...
start "Django Backend" cmd /k "cd backend_django && ..\venv\Scripts\activate && python manage.py runserver"
timeout /t 3 /nobreak > nul

echo [2/3] Demarrage de Node.js...
start "Node.js Notifier" cmd /k "cd notifier && npm start"
timeout /t 3 /nobreak > nul

echo [3/3] Ouverture du navigateur...
timeout /t 5 /nobreak > nul
start http://127.0.0.1:8000/

echo.
echo ========================================
echo    ✅ APPLICATION DEMARREE
echo ========================================
echo.
echo Django: http://127.0.0.1:8000/
echo Admin:  http://127.0.0.1:8000/admin/
echo Node.js: Port 3001 (WebSocket)
echo.
echo Appuyez sur une touche pour fermer ce message...
pause > nul
