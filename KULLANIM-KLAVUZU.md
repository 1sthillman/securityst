# 📱 Çınarköy Sync - Kullanım Kılavuzu

## 🚀 HIZLI BAŞLANGIÇ

### 1. Server'ı Başlatma

**Windows'ta:**
```
BASLATICI.bat dosyasını çift tıklayın
```

Server çalışınca şu adresleri göreceksiniz:
- **Panel:** http://localhost:4545
- **Telefon:** http://192.168.1.129:4545/telefon/

### 2. Telefonu Bağlama

1. **Paneli Açın:** Tarayıcıda http://localhost:4545
2. **QR Kod Alın:** "Eşleşme" sekmesinden QR kodu göreceksiniz
3. **QR Okutun:** Telefon kamerasıyla QR'ı okutun
4. **Uygulamaya Girin:** Telefon otomatik olarak uygulamayı açacak

### 3. İlk Cihaz Onayı

- **İLK telefon** otomatik olarak kabul edilir
- **Sonraki telefonlar** için:
  1. Panelde "Cihazlar" sekmesine gidin
  2. Bekleyen cihazları göreceksiniz
  3. "Onayla" düğmesine tıklayın

## 🔧 TEKNİK BİLGİLER

### Port'lar
- **4545:** HTTP (panel + telefon)
- **4546:** HTTPS (canlı kamera önizleme - opsiyonel)

### Eski Kurulum Temizliği

Eğer **eski kurulum** (port 4577) çalışıyorsa:

```powershell
# PowerShell ile kapat
Get-Process -Name "CinarkoySync" | Stop-Process -Force
```

veya

```cmd
# CMD ile kapat
taskkill /F /IM "CinarkoySync.exe"
```

### Windows Firewall

İlk çalıştırmada Windows Firewall izni isteyebilir:
- **"Erişime İzin Ver"** düğmesine tıklayın
- Veya manuel olarak: `firewall-ekle.ps1` dosyasını **Yönetici olarak** çalıştırın

## 📂 DOSYA YAPISI

```
C:\syncserver\
├── BASLATICI.bat          # ← BU DOSYAYI ÇALIŞTIRIN
├── companion/
│   ├── companion.js       # Server kodu
│   ├── config.json        # Port ve token ayarları
│   └── data/
│       ├── kayitlar.xlsx  # Excel kayıtları
│       ├── kayitlar.jsonl # Log dosyası
│       └── eslesmeler.json # Bağlı cihazlar
└── phone/                 # Telefon uygulaması (static files)
```

## ❓ SORUN GİDERME

### Telefon Bağlanamıyor

1. **IP Adresini Kontrol Edin:**
   ```cmd
   ipconfig | findstr "IPv4"
   ```
   Panelde gösterilen IP ile eşleşmeli

2. **Aynı WiFi Ağında Olun:**
   - Telefon ve bilgisayar aynı WiFi'de olmalı

3. **Firewall'ı Kontrol Edin:**
   - Windows Güvenlik Duvarı → İzin verilen uygulamalar
   - "Node.js" için izin olmalı

### "Port 4545 Already in Use" Hatası

Başka bir process port'u kullanıyor:

```cmd
netstat -ano | findstr ":4545"
taskkill /F /PID [PROCESS_ID]
```

### QR Kod Okutunca "Okunaklı Hale Getir" Yazıyor

**ÇÖZÜM:** Bu sorun artık düzeltildi! Eğer hâlâ görüyorsanız:
- Server'ı kapatıp BASLATICI.bat ile yeniden başlatın
- Tarayıcı cache'ini temizleyin (Ctrl+Shift+Delete)

## 🎯 İPUÇLARI

1. **Otomatik Başlatma:** BASLATICI.bat dosyasının kısayolunu Windows Başlangıç klasörüne atabilirsiniz
2. **Uzaktan Erişim:** Güvenlik için panel yalnızca bilgisayardan açılır - telefonlar sadece kayıt yapabilir
3. **Yedekleme:** `companion/data/` klasörünü düzenli yedekleyin

## 📞 DESTEK

Sorun yaşıyorsanız:
1. `companion/data/servis.log` dosyasını kontrol edin
2. BASLATICI.bat penceresindeki hata mesajlarını okuyun
3. GitHub Issues'a rapor edin
