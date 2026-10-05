#!/usr/bin/env pwsh
# Windows Guvenlik Duvari Kontrolu

$RuleName = "Cinarkoy Excel Sync"
$RuleNameHTTPS = "Cinarkoy Excel Sync HTTPS"
$HttpPort = 4545
$HttpsPort = 4546

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  WINDOWS GUVENLIK DUVARI KONTROLU" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Mevcut kurallari kontrol et
Write-Host "Mevcut kurallar kontrol ediliyor..." -ForegroundColor Yellow

$httpRule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
$httpsRule = Get-NetFirewallRule -DisplayName $RuleNameHTTPS -ErrorAction SilentlyContinue

$httpOk = $null -ne $httpRule -and $httpRule.Enabled -eq 'True'
$httpsOk = $null -ne $httpsRule -and $httpsRule.Enabled -eq 'True'

Write-Host ""
if ($httpOk) {
    Write-Host "OK HTTP kurali ($HttpPort) var ve aktif" -ForegroundColor Green
} else {
    Write-Host "EKSIK HTTP kurali ($HttpPort) yok veya devre disi" -ForegroundColor Red
}

if ($httpsOk) {
    Write-Host "OK HTTPS kurali ($HttpsPort) var ve aktif" -ForegroundColor Green
} else {
    Write-Host "EKSIK HTTPS kurali ($HttpsPort) yok veya devre disi" -ForegroundColor Red
}

# Eksikler varsa ekle
$needFix = (-not $httpOk) -or (-not $httpsOk)

if ($needFix) {
    Write-Host ""
    Write-Host "----------------------------------------------------------------" -ForegroundColor Yellow
    Write-Host "Eksik kurallar ekleniyor..." -ForegroundColor Yellow
    Write-Host "YONETICI IZNI GEREKLI - UAC penceresi acilacak" -ForegroundColor Yellow
    Write-Host ""
    
    # Yonetici kontrolu
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    
    if (-not $isAdmin) {
        Write-Host "HATA Bu script yonetici olarak calistirilmali" -ForegroundColor Red
        Write-Host ""
        Write-Host "Cozum:" -ForegroundColor Cyan
        Write-Host "  1. PowerShell'i 'Yonetici olarak calistir' ile acin" -ForegroundColor White
        Write-Host "  2. Komutu tekrar calistirin" -ForegroundColor White
        Write-Host ""
        exit 1
    }
    
    try {
        # HTTP kurali
        if (-not $httpOk) {
            if ($httpRule) {
                Write-Host "  HTTP kurali etkinlestiriliyor..." -ForegroundColor Cyan
                Set-NetFirewallRule -DisplayName $RuleName -Enabled True
            } else {
                Write-Host "  HTTP kurali ekleniyor..." -ForegroundColor Cyan
                New-NetFirewallRule -DisplayName $RuleName `
                    -Direction Inbound `
                    -Action Allow `
                    -Protocol TCP `
                    -LocalPort $HttpPort `
                    -Profile Private,Domain `
                    -Description "Cinarkoy Excel Sync telefon baglantisi (HTTP)" | Out-Null
            }
            Write-Host "  OK HTTP kurali hazir" -ForegroundColor Green
        }
        
        # HTTPS kurali
        if (-not $httpsOk) {
            if ($httpsRule) {
                Write-Host "  HTTPS kurali etkinlestiriliyor..." -ForegroundColor Cyan
                Set-NetFirewallRule -DisplayName $RuleNameHTTPS -Enabled True
            } else {
                Write-Host "  HTTPS kurali ekleniyor..." -ForegroundColor Cyan
                New-NetFirewallRule -DisplayName $RuleNameHTTPS `
                    -Direction Inbound `
                    -Action Allow `
                    -Protocol TCP `
                    -LocalPort $HttpsPort `
                    -Profile Private,Domain `
                    -Description "Cinarkoy Excel Sync telefon baglantisi (HTTPS)" | Out-Null
            }
            Write-Host "  OK HTTPS kurali hazir" -ForegroundColor Green
        }
        
        Write-Host ""
        Write-Host "================================================================" -ForegroundColor Green
        Write-Host "OK TUM KURALLAR HAZIR - Telefonlar baglanabilir!" -ForegroundColor Green
        Write-Host "================================================================" -ForegroundColor Green
        Write-Host ""
        
    } catch {
        Write-Host ""
        Write-Host "HATA: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""
        Write-Host "Alternatif: Baslaticidaki 'Windows iznini ver' butonunu kullanin" -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
    
} else {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "OK TUM KURALLAR MEVCUT - Telefonlar baglanabilir!" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host ""
}

# Port dinleme kontrolu
Write-Host "Port dinleme durumu:" -ForegroundColor Yellow
$listening = Get-NetTCPConnection -LocalPort $HttpPort -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    Write-Host "OK Port $HttpPort dinleniyor (Servis calisiyor)" -ForegroundColor Green
} else {
    Write-Host "UYARI Port $HttpPort dinlenmiyor (Servis calismiyor olabilir)" -ForegroundColor Yellow
}

$listeningHttps = Get-NetTCPConnection -LocalPort $HttpsPort -State Listen -ErrorAction SilentlyContinue
if ($listeningHttps) {
    Write-Host "OK Port $HttpsPort dinleniyor (HTTPS aktif)" -ForegroundColor Green
} else {
    Write-Host "UYARI Port $HttpsPort dinlenmiyor" -ForegroundColor Yellow
}

Write-Host ""
