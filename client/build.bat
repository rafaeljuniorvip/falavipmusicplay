@echo off
echo ========================================
echo   FalaVIP Music Player - Build Script
echo ========================================
echo.

REM Verificar se Python está instalado
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Python nao encontrado! Instale Python 3.11+
    pause
    exit /b 1
)

echo [1/3] Instalando dependencias...
pip install -r requirements.txt
pip install pyinstaller

echo.
echo [2/3] Compilando executavel...
python -m PyInstaller --onefile --windowed --name "FalaVIPMusicPlayer" main.py

echo.
echo [2.5/3] Copiando arquivos de configuracao...
copy settings.json dist\settings.json >nul

echo.
echo [3/3] Limpando arquivos temporarios...
rmdir /s /q build 2>nul
del /q *.spec 2>nul

echo.
echo ========================================
echo   Build concluido!
echo   Executavel: dist\FalaVIPMusicPlayer.exe
echo ========================================
echo.
pause
