# ============================================================================
#  Çınarköy Excel Sync — Paketleme betiği
# ----------------------------------------------------------------------------
#  Tek komutla dağıtılabilir kurulum .exe'i üretir:
#     powershell -ExecutionPolicy Bypass -File paketle.ps1
#
#  Adımlar:
#     0) Telefon uygulamasını sunucu sürümüne dönüştür  -> public/telefon/
#     1) Node.js motorunu hazırla                     -> node\node.exe
#     2) Servis bağımlılıklarını kur (üretim modu)
#     3) Uygulama simgesini üret                      -> launcher\app.ico
#     4) Başlatıcıyı Windows'un kendi csc.exe'siyle derle -> launcher\CinarkoySync.exe
#     5) Inno Setup ile kurulum paketini derle         -> ..\release\CinarkoySync-Kur-<sürüm>.exe
#
#  Inno Setup 6 kurulu değilse 5. adım atlanır ve yalnızca taşınabilir
#  klasör hazırlanır (geliştirme için).
# ============================================================================

$ErrorActionPreference = 'Stop'
$kok = $PSScriptRoot
$ust = Split-Path $kok -Parent
Set-Location $kok

function Adim($no, $metin) { Write-Host ""; Write-Host "[$no] $metin" -ForegroundColor Cyan }

# --- 0) Telefon uygulamasını sunucu sürümüne dönüştür ----------------------
# Security-ST/index.html -> companion/public/telefon/
# Harici CDN bağımlılıkları yerelleştirilir, bulut OCR kapatılır, yerel
# eklentiler (plaka-yerel.js, senkron.js) eklenir. Her paketlemede çalışır ki
# uygulama güncel kalsın.
Adim "0/5" "Telefon uygulaması sunucu sürümüne dönüştürülüyor"
$securitySt = Join-Path $ust "Security-ST\index.html"
if (Test-Path $securitySt) {
    & node (Join-Path $ust "tools\security-st-esle.js")
    if ($LASTEXITCODE -ne 0) { throw "Telefon uygulaması dönüştürülemedi" }
} else {
    Write-Warning "Security-ST/index.html bulunamadı; telefon uygulaması güncellenmedi."
}

# --- 1) Node.js motoru -------------------------------------------------------
Adim "1/5" "Node.js motoru hazırlanıyor"
$nodeHedef = Join-Path $kok "node\node.exe"
if (Test-Path $nodeHedef) {
    Write-Host "    zaten var: $nodeHedef"
} else {
    $kaynak = $null
    foreach ($p in @(
        (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) "nodejs\node.exe"),
        (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) "nodejs\node.exe"))) {
        if ($p -and (Test-Path $p)) { $kaynak = $p; break }
    }
    if ($kaynak) {
        Write-Host "    kopyalanıyor: $kaynak"
        New-Item -ItemType Directory -Force -Path (Join-Path $kok "node") | Out-Null
        Copy-Item $kaynak $nodeHedef -Force
    } else {
        Write-Warning "Bu bilgisayarda Node.js bulunamadı."
        Write-Warning "Kurulum paketi Node.js'siz üretilemez. https://nodejs.org adresinden"
        Write-Warning "LTS sürümünü kurup betiği yeniden çalıştırın."
        exit 1
    }
}

# --- 2) Bağımlılıklar --------------------------------------------------------
Adim "2/5" "Servis bağımlılıkları kuruluyor (üretim)"
& npm install --omit=dev --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { throw "npm install başarısız ($LASTEXITCODE)" }

# --- 3) Simge ----------------------------------------------------------------
Adim "3/5" "Uygulama simgesi üretiliyor"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kok "launcher\ikon-uret.ps1")
if (-not (Test-Path (Join-Path $kok "launcher\app.ico"))) { throw "app.ico üretilemedi" }

# --- 4) Başlatıcı ------------------------------------------------------------
Adim "4/5" "Başlatıcı derleniyor"
$csc = $null
foreach ($p in @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe")) {
    if (Test-Path $p) { $csc = $p; break }
}
if (-not $csc) { throw "Windows C# derleyicisi (csc.exe) bulunamadı" }

# Önce konsol sürümü: derleme hataları görünür olsun.
& $csc /nologo /target:exe /platform:anycpu /warnaserror- `
    /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll /reference:System.Management.dll `
    "/out:$kok\launcher\derleme-deneme.exe" (Join-Path $kok "launcher\Baslatici.cs")
if ($LASTEXITCODE -ne 0) { throw "Başlatıcı derlenemedi" }
Remove-Item (Join-Path $kok "launcher\derleme-deneme.exe") -Force

# Sonra asıl sürüm: konsol penceresi açılmasın, simge gömülü olsun.
& $csc /nologo /target:winexe /platform:anycpu /optimize+ `
    /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll /reference:System.Management.dll `
    "/win32icon:$kok\launcher\app.ico" "/out:$kok\launcher\CinarkoySync.exe" `
    (Join-Path $kok "launcher\Baslatici.cs")
if ($LASTEXITCODE -ne 0) { throw "Başlatıcı derlenemedi" }
Write-Host "    -> launcher\CinarkoySync.exe"

# --- 5) Kurulum paketi -------------------------------------------------------
Adim "5/5" "Kurulum paketi derleniyor"
$iscc = $null
$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$programFiles = [Environment]::GetFolderPath('ProgramFiles')
foreach ($p in @(
    (Join-Path $programFilesX86 "Inno Setup 6\ISCC.exe"),
    (Join-Path $programFiles "Inno Setup 6\ISCC.exe"))) {
    if ($p -and (Test-Path $p)) { $iscc = $p; break }
}
if (-not $iscc) {
    Write-Warning "Inno Setup 6 bulunamadı; kurulum paketi üretilmedi."
    Write-Warning "https://jrsoftware.org/isdl.php adresinden kurup betiği yeniden çalıştırın."
    Write-Host ""
    Write-Host "Taşınabilir klasör hazır: $kok" -ForegroundColor Green
    exit 0
}
& $iscc (Join-Path $kok "kurulum.iss")
if ($LASTEXITCODE -ne 0) { throw "Kurulum paketi derlenemedi ($LASTEXITCODE)" }

$cikti = Join-Path $ust "release"
Get-ChildItem $cikti -Filter "CinarkoySync-Kur-*.exe" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 |
    ForEach-Object { Write-Host "    -> $($_.FullName)  ($([math]::Round($_.Length/1MB,1)) MB)" -ForegroundColor Green }

Write-Host ""
Write-Host "Paketleme tamam." -ForegroundColor Green
