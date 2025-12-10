# FalaVIP Music Player - Build Script (PowerShell)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FalaVIP Music Player - Build Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verificar Python
try {
    $pythonVersion = python --version
    Write-Host "[OK] $pythonVersion" -ForegroundColor Green
}
catch {
    Write-Host "[ERRO] Python nao encontrado! Instale Python 3.11+" -ForegroundColor Red
    exit 1
}

# Instalar dependências
Write-Host ""
Write-Host "[1/3] Instalando dependencias..." -ForegroundColor Yellow
pip install -r requirements.txt
pip install pyinstaller

# Compilar
Write-Host ""
Write-Host "[2/3] Compilando executavel..." -ForegroundColor Yellow
python -m PyInstaller --onefile --windowed --name "FalaVIPMusicPlayer" main.py

# Copiar settings.json
Write-Host "[2.5/3] Copiando arquivos de configuracao..." -ForegroundColor Yellow
Copy-Item "settings.json" "dist/settings.json" -Force

# Limpar
Write-Host ""
Write-Host "[3/3] Limpando arquivos temporarios..." -ForegroundColor Yellow
Remove-Item -Recurse -Force build -ErrorAction SilentlyContinue
Remove-Item -Force *.spec -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Build concluido!" -ForegroundColor Green
Write-Host "  Executavel: dist\FalaVIPMusicPlayer.exe" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
