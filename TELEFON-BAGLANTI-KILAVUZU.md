# 📱 TELEFON BAĞLANTI KILAVUZU

## 🔴 KRİTİK SORUN: ESKİ KURULUM ÇALIŞIYORDU!

Bilgisayarınızda `C:\Users\minif\AppData\Local\Programs\CinarkoySync\` konumunda ESKİ bir kurulum vardı ve o çalışıyordu! Eski kurulum **4577** portunu kullanıyordu, yeni sistem **4545** portunu kullanıyor.

**ÇÖZÜM: ESKİ KURULUMU TEMİZLEDİK, YENİ SİSTEMİ BAŞLATTIK**

---

## ✅ ŞİMDİ YAPMANIZ GEREKENLER

### 1. WINDOWS FIREWALL İZNİ VERİN

İki seçenek:

#### SEÇENEK A: PowerShell Script (ÖNERİLEN - HIZLI)

1. `firewall-ekle.ps1` dosyasına SAĞ TIKLAYIN
2. **"PowerShell ile Çalıştır (Yönetici Olarak)"** seçin
3. UAC penceresi açılırsa **"Evet"** deyin
4. Script çalışacak ve firewall kurallarını ekleyecek

#### SEÇENEK B: Launcher Penceresinden

1. Launcher penceresinde **"Windows iznini ver"** düğmesine basın
2. UAC penceresi açılacak (ARKA PLANDA AÇILABİLİR - görev çubuğuna bakın!)
3. **"Evet"** deyin
4. Birkaç saniye bekleyin

### 2. TELEFONDA DOĞRU ADRESİ KULLANIN

**❌ YANLIŞ:**
- `localhost:4545/telefon/` ← Telefon kendi localhost'una bakar!
- `http://192.168.1.129:4577/telefon/` ← Eski port!

**✅ DOĞRU:**
```
http://192.168.1.129:4545/telefon/
```

### 3. QR KOD İLE BAĞLANIN (EN KOLAY)

1. Bilgisayarda paneli açın: `http://localhost:4545/`
2. **"Eşleşme"** sekmesine tıklayın
3. QR kodu telefon kamerasıyla okutun
4. Telefon otomatik olarak doğru adrese gidecek

---

## 🔧 SORUN GİDERME

### "Bağlantı kurulamadı" hatası alıyorsanız:

1. **Firewall kontrolü:**
   ```powershell
   netsh advfirewall firewall show rule name="Çınarköy Excel Sync"
   ```
   
   Kural yoksa yukarıdaki Script'i çalıştırın.

2. **Servis çalışıyor mu:**
   ```powershell
   netstat -ano | findstr ":4545"
   ```
   
   `LISTENING` görmüyorsanız launcher'ı yeniden başlatın.

3. **Aynı Wi-Fi ağında mısınız:**
   - Telefon ve bilgisayar AYNI ağda olmalı
   - Misafir ağı kullanmayın

### Telefondan hala eski port (4577) görünüyorsa:

1. Telefon tarayıcısının önbelleğini temizleyin
2. Gizli mod/incognito modda açın
3. QR'ı tekrar okutun

---

## 📊 TEST KOMUTU

Bilgisayarda şunu çalıştırın:

```powershell
node test-telefon-baglanti.js
```

4/5 test başarılı olmalı. Panel 403 vermeli (korunuyor), ama `/telefon/`, `/eslesme`, `/saglik` 200 dönmeli.

---

## 🎯 ÖZET

1. ✅ Eski kurulum durduruldu (4577 portu)
2. ✅ Yeni sistem başlatıldı (4545 portu)  
3. ⚠ Firewall kuralı eklenmeli (`firewall-ekle.ps1`)
4. 📱 Telefon: `http://192.168.1.129:4545/telefon/`

**İLK TELEFON OTOMATİK KABUL EDİLİR!**
İkinci telefonlar için `http://localhost:4545/cihazlar.html` adresinden onay verin.
