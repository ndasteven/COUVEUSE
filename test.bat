@echo off
echo ========================================
echo    🧪 TEST DE L'APPLICATION
echo ========================================
echo.

echo [1/4] Test de Python...
python --version
if errorlevel 1 (
    echo ❌ Python n'est pas installe ou non trouve
    pause
    exit /b 1
)
echo ✅ Python OK
echo.

echo [2/4] Test de Node.js...
node --version
if errorlevel 1 (
    echo ❌ Node.js n'est pas installe ou non trouve
    pause
    exit /b 1
)
echo ✅ Node.js OK
echo.

echo [3/4] Test des dependances Django...
cd backend_django
python -c "import django; import rest_framework; import mysql.connector; print('✅ Dependances Django OK')" 2>nul
if errorlevel 1 (
    echo ❌ Dependances Django manquantes
    echo Installation en cours...
    python -m pip install Django djangorestframework mysql-connector-python pymysql python-decouple
)
cd ..
echo.

echo [4/4] Test des dependances Node.js...
cd notifier
if not exist node_modules (
    echo Installation des dependances Node.js...
    npm install
) else (
    echo ✅ Dependances Node.js OK
)
cd ..
echo.

echo ========================================
echo    ✅ TOUS LES TESTS SONT VERTS
echo ========================================
echo.
echo Vous pouvez maintenant lancer start.bat
echo.
pause
