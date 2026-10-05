# Windows Firewall Kuralı Ekle - Çınarköy Excel Sync
# Bu script'i ADMINISTRATOR olarak çalıştırın

Write-Host "Firewall kuralı ekleniyor..." -ForegroundColor Yellow

# HTTP Portu (4545)
netsh advfirewall firewall add rule name="Çınarköy Excel Sync" dir=in action=allow protocol=TCP localport=4545 profile=private,domain

# HTTPS Portu (4546)
netsh advfirewall firewall add rule name="Çınarköy Excel Sync HTTPS" dir=in action=allow protocol=TCP localport=4546 profile=private,domain

Write-Host ""
Write-Host "Firewall kuralları eklendi!" -ForegroundColor Green
Write-Host ""
Write-Host "Kontrol:" -ForegroundColor Cyan
netsh advfirewall firewall show rule name="Çınarköy Excel Sync"

Write-Host ""
Write-Host "Şimdi telefondan bağlanmayı deneyin:" -ForegroundColor Yellow
Write-Host "  http://192.168.1.129:4545/telefon/" -ForegroundColor White
Write-Host ""

pause
