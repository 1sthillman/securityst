# Çınarköy Excel Sync - Kurulum ve Test Kılavuzu

## ✅ SİSTEM DURUMU

### Servis Testleri
```bash
# Tüm testleri çalıştır
node test-connection.js
```

**✓ Başarılı Testler:**
- HTTP sağlık endpoint'i
- Eşleşme endpoint'i
- Token alma
- CORS başlıkları
- Panel erişimi

### Eşleşme Durumu
```bash
# Bekleyen cihazları onayla
node onay-ver.js
```

## 🔧 GÜVENLİK DUVARI KURULUMU

### Otomatik Kurulum (Önerilen)

**Yöntem 1: Başlatıcı ile (En Kolay)**
1. `CinarkoySync.exe` dosyasını çalıştırın
2. "Windows iznini ver" butonuna basın
3. UAC onayında "Evet" deyin
4. ✓ Hazır!

**Yöntem 2: PowerShell ile**
```powershell
# PowerShell'i YÖNETİCİ olarak açın
powershell -ExecutionPolicy Bypass -File test-firewall.ps1
```

### Manuel Kurulum

Eğer otomatik yöntemler çalışmazsa:

```powershell
# PowerShell'i YÖNETİCİ olarak açın ve çalıştırın:

# HTTP Kuralı (4545)
New-NetFirewallRule -DisplayName "Cinarkoy Excel Sync" `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 4545 `
    -Profile Private,Domain `
    -Description "Cinarkoy Excel Sync telefon baglantisi (HTTP)"

# HTTPS Kuralı (4546)
New-NetFirewallRule -DisplayName "Cinarkoy Excel Sync HTTPS" `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 4546 `
    -Profile Private,Domain `
    -Description "Cinarkoy Excel Sync telefon baglantisi (HTTPS)"
```

### Kurulum Kontrolü
```powershell
# Kuralların olup olmadığını kontrol et
Get-NetFirewallRule -DisplayName "Cinarkoy*"

# Port dinleme kontrolü
Get-NetTCPConnection -LocalPort 4545,4546 -State Listen
```

## 📱 TELEFON BAĞLANTI

### Adım 1: Bilgisayarı Hazırla
```bash
# Servisi başlat
cd companion
node companion.js
```

### Adım 2: QR Kodu Al
1. Tarayıcıda aç: `http://localhost:4545/eslesme.html`
2. QR kodu göreceksiniz

### Adım 3: Telefonla Bağlan
1. Telefonu **aynı Wi-Fi ağına** bağlayın
2. QR kodu telefonun kamerasıyla okutun
3. Veya manuel: `http://[BILGISAYAR-IP]:4545/telefon/` adresini açın

### Bağlantı Adresleri
- **Panel:** http://localhost:4545/
- **Telefon:** http://localhost:4545/telefon/
- **HTTPS (isteğe bağlı):** https://localhost:4546/telefon/

## 🔍 SORUN GİDERME

### Telefon Bağlanamıyor?

**1. Ağ Kontrolü**
```bash
# IP adresinizi bulun
ipconfig | findstr IPv4
```
- Telefon ve bilgisayar aynı ağda mı?
- Misafir ağı kullanmayın

**2. Güvenlik Duvarı**
```bash
# Test et
node test-firewall.ps1
```
- Kurallar var mı?
- Portlar dinleniyor mu?

**3. Servis Çalışıyor mu?**
```bash
# Test et
node test-connection.js
```
- Tüm testler geçmeli

**4. Eşleşme Durumu**
```bash
# Kontrol et
curl http://localhost:4545/eslesme
```
- `token` var mı?
- `onayBekliyor: false` olmalı

**5. Bekleyen Cihazları Onayla**
```bash
node onay-ver.js
```

### Hata Mesajları

**"Panel yalnızca bu bilgisayardan açılabilir"**
- ✓ Normal! Panel güvenlik için yerel
- Telefon için `/telefon/` adresi kullan

**"Token alınamadı"**
```bash
# Cihazları onayla
node onay-ver.js
```

**"Bağlantı yok"**
- Güvenlik duvarını kontrol et
- Aynı ağda mısınız?
- IP adresi doğru mu?

## 🎯 SELF-HEALING ÖZELLİKLER

Sistem otomatik olarak:
- ✓ Servis düşerse yeniden başlatır (10 deneme)
- ✓ Excel bozulursa log'dan yeniden oluşturur
- ✓ Tmp dosyalarını temizler
- ✓ İlk cihazı otomatik kabul eder
- ✓ Bellek kullanımını izler
- ✓ Her 5 dakikada dosya bütünlüğünü kontrol eder

## 📊 İZLEME

### Loglar
- **Servis:** `companion/data/servis.log`
- **Konsol:** Terminal çıktısı
- **Watchdog:** Her 10 saniyede kontrol

### Metrikler
```bash
# Anlık durum
curl http://localhost:4545/durum
```

## 🚀 ÜRETİME ALMA

1. **Servisi test et:** `node test-connection.js`
2. **Güvenlik duvarını kur:** Başlatıcı ile veya PowerShell
3. **Cihazları onayla:** `node onay-ver.js`
4. **Başlatıcıyı çalıştır:** `CinarkoySync.exe`
5. **Otomatik başlatmayı aç:** Başlatıcıdaki checkbox

## 📞 DESTEK

Sorun devam ediyorsa:
1. Logları kontrol edin: `companion/data/servis.log`
2. Test sonuçlarını kaydedin: `node test-connection.js > test-sonuc.txt`
3. Sistem bilgilerini toplayın
