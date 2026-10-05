# Çınarköy Sync Sunucusunu Yeniden Başlat
# ========================================
# Bu script sunucuyu yeniden başlatır ve güncellemeleri uygular

Write-Host "🔄 Sunucu yeniden başlatılıyor..." -ForegroundColor Cyan

# Mevcut Node.js işlemlerini bul ve durdur
$processes = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*companion*" }

if ($processes) {
    Write-Host "⏹️  Mevcut sunucu durdurulu yor..." -ForegroundColor Yellow
    $processes | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# Sunucuyu başlat
Write-Host "▶️  Sunucu başlatılıyor..." -ForegroundColor Green
Set-Location companion
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node companion.js"
Set-Location ..

Write-Host ""
Write-Host "✅ TAMAMLANDI!" -ForegroundColor Green
Write-Host ""
Write-Host "📍 Sunucu adresi: http://localhost:4545" -ForegroundColor White
Write-Host "📱 Telefon adresi: http://192.168.1.129:4545/telefon/" -ForegroundColor White
Write-Host "⚙️  Panel: http://localhost:4545" -ForegroundColor White
Write-Host ""
Write-Host "💡 ŞİMDİ NE YAPMALI?" -ForegroundColor Yellow
Write-Host "   1. Telefon tarayıcısını KAPAT ve YENİDEN AÇ" -ForegroundColor White
Write-Host "   2. QR kodu yeniden okut VEYA adresi yeniden gir" -ForegroundColor White
Write-Host "   3. Token otomatik alınacak (30 saniye içinde)" -ForegroundColor White
Write-Host ""
