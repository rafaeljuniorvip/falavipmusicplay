# FalaVIP Music Player - Build Otimizado
# Gera executavel compactado e instalador

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FalaVIP - Build Otimizado" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Limpar builds anteriores
Remove-Item -Recurse -Force build -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
Remove-Item -Force *.spec -ErrorAction SilentlyContinue

# Instalar dependencias
Write-Host "`n[1/4] Instalando dependencias..." -ForegroundColor Yellow
pip install -r requirements.txt -q
pip install pyinstaller -q

# Build otimizado
Write-Host "`n[2/4] Compilando executavel otimizado..." -ForegroundColor Yellow
python -m PyInstaller `
    --onefile `
    --windowed `
    --name "FalaVIPMusicPlayer" `
    --add-data "settings.json;." `
    --exclude-module matplotlib `
    --exclude-module numpy `
    --exclude-module scipy `
    --exclude-module pandas `
    --exclude-module PIL.ImageTk `
    --exclude-module unittest `
    --exclude-module pydoc `
    --exclude-module doctest `
    --noupx `
    main.py

# Verificar se build funcionou
if (Test-Path "dist\FalaVIPMusicPlayer.exe") {
    $size = (Get-Item "dist\FalaVIPMusicPlayer.exe").Length / 1MB
    Write-Host "`n[3/4] Build concluido! Tamanho: $([math]::Round($size, 1)) MB" -ForegroundColor Green
} else {
    Write-Host "`n[ERRO] Build falhou!" -ForegroundColor Red
    exit 1
}

# Criar pasta de distribuicao
Write-Host "`n[4/4] Preparando distribuicao..." -ForegroundColor Yellow
$distFolder = "dist\FalaVIP"
New-Item -ItemType Directory -Force -Path $distFolder | Out-Null
Copy-Item "dist\FalaVIPMusicPlayer.exe" "$distFolder\FalaVIPMusicPlayer.exe"
Copy-Item "settings.json" "$distFolder\settings.json"

# Criar README
@"
FalaVIP Music Player
====================

REQUISITOS:
- Windows 10 ou 11 (64-bit)
- Conexao com o servidor FalaVIP

INSTALACAO:
1. Execute FalaVIPMusicPlayer.exe
2. Configure o servidor em settings.json se necessario

CONFIGURACAO (settings.json):
{
    "server_url": "http://SEU_IP:8000"
}

Desenvolvido para Natal Iluminado 2025
"@ | Out-File -FilePath "$distFolder\LEIA-ME.txt" -Encoding UTF8

# Criar ZIP
Write-Host "`nCriando arquivo ZIP..." -ForegroundColor Yellow
Compress-Archive -Path "$distFolder\*" -DestinationPath "dist\FalaVIP-Player.zip" -Force

$zipSize = (Get-Item "dist\FalaVIP-Player.zip").Length / 1MB
Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Build Concluido!" -ForegroundColor Green
Write-Host "  Executavel: dist\FalaVIP\FalaVIPMusicPlayer.exe" -ForegroundColor Green
Write-Host "  ZIP: dist\FalaVIP-Player.zip ($([math]::Round($zipSize, 1)) MB)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
