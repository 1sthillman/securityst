# KAMERA OKUMA OPTİMİZASYONU - TEST PLANI

## 🔧 YAPILAN DEĞİŞİKLİKLER

### 1. İstemci Tarafı (Telefon)

#### `companion/public/telefon/yerel-kamera.js` (Satır 230-260)
- **DEĞİŞİKLİK**: Kameradan çekilen fotoğraf artık göndermeden ÖNCE boyutlandırılıyor
- **DETAY**: 
  - Maksimum genişlik: 1920px
  - Yükseklik orantılı olarak küçültülüyor
  - Smoothing quality: 'high'
- **HEDEF**: 3+ MB görseli ~200-500 KB'a düşürmek

#### `companion/public/telefon/plaka-yerel.js` (Satır 168-180, 220-230)
- **DEĞİŞİKLİK**: PNG yerine JPEG sıkıştırma
- **DETAY**:
  - JPEG kalitesi: 0.85 (yüksek kalite, makul boyut)
  - Fallback: JPEG başarısızsa PNG'ye düş
- **İKİ FONKSIYON**:
  1. `tuvalHazirla()` - kamera dosya girişi için
  2. `tamKareYakala()` - canlı kamera akışı için
- **HEDEF**: PNG'nin %90 küçük boyut, aynı görsel kalite

### 2. Sunucu Tarafı

#### `companion/companion.js` (Satır 179-190)
- **DEĞİŞİKLİK**: Log fonksiyonu artık objeleri JSON'a çeviriyor
- **DETAY**: `[object Object]` yerine gerçek değerleri gösteriyor
- **HEDEF**: Debug ve problem tespiti için detaylı log

#### `companion/companion.js` (Satır 1583-1593)
- **DEĞİŞİKLİK**: Büyük görsel uyarısı
- **DETAY**: 2+ MB görsel gelirse log'a uyarı yazıyor
- **HEDEF**: İstemci sıkıştırma problemlerini tespit etmek

---

## 📊 BEKLENEN SONUÇLAR

### ÖNCE (Optimizasyon öncesi)
```
KAMERA:
- Boyut: 3,115 KB (3.1 MB)
- Format: PNG
- Süre: 8,493 ms (~8.5 saniye)
- Sonuç: BAŞARISIZ (neden: dusuk-guven)

GALERİ:
- Boyut: 38 KB
- Format: PNG
- Süre: 360 ms
- Sonuç: BAŞARILI
```

### SONRA (Beklenen)
```
KAMERA:
- Boyut: ~200-500 KB
- Format: JPEG
- Süre: ~500-1500 ms
- Sonuç: BAŞARILI ✅

GALERİ:
- Boyut: ~50-100 KB (JPEG'e çevrildi)
- Format: JPEG
- Süre: ~300-500 ms
- Sonuç: BAŞARILI ✅
```

---

## 🧪 TEST ADIMLARI

### 1. Sunucuyu Yeniden Başlat
```
- Terminal'den mevcut sunucuyu durdur
- BASLATICI.bat ile yeniden başlat
- http://192.168.1.129:4545/telefon/ açık olduğunu doğrula
```

### 2. Telefondan Test Et
```
a) Telefon tarayıcıda sayfayı YENİLE (cache temizlemek için)
   - CTRL+F5 veya "Clear Cache and Hard Reload"
   
b) KAMERA İLE ÇEK:
   - Plakayı kameraya tut
   - Fotoğraf çek
   - Sonucu bekle
   
c) Log'ları kontrol et:
   - Görsel boyutuna bak (KB cinsinden)
   - Formatı kontrol et (JPEG olmalı)
   - Süreyi ölç (ms cinsinden)
   - Sonucu gör (basarili: true/false)
   - Neden alanını kontrol et
```

### 3. Galeriden Test Et
```
a) Aynı plaka fotoğrafını galeriden seç
b) Log'ları kontrol et
c) İki yöntemi karşılaştır
```

---

## 🔍 LOG'LARDA ARANACAK BİLGİLER

### Başarı Kriterleri:
1. ✅ Görsel boyutu < 1 MB (ideal: 200-500 KB)
2. ✅ Format: JPEG
3. ✅ Süre < 2000 ms (ideal: 500-1500 ms)
4. ✅ Sonuç: basarili: true
5. ✅ Plaka doğru okunmuş

### Başarısızlık İşaretleri:
1. ❌ Görsel boyutu > 2 MB (sıkıştırma çalışmamış)
2. ❌ Format: PNG (JPEG'e çevrilememiş)
3. ❌ Süre > 5000 ms (hala yavaş)
4. ❌ Sonuç: basarili: false, neden: "dusuk-guven"
5. ❌ UYARI logu: "Görsel çok büyük"

---

## 🐛 SORUN GİDERME

### Sorun: Hala PNG geliyor
**Neden**: Tarayıcı cache'i
**Çözüm**: 
- Telefonda sayfayı tamamen kapat
- Tarayıcı cache'ini temizle
- Sayfayı yeniden aç

### Sorun: Hala 3+ MB geliyor
**Neden**: Kod güncellenmemiş
**Çözüm**:
- Sunucuyu durdur
- Dosyaları kontrol et
- Sunucuyu tekrar başlat
- Hard refresh yap

### Sorun: JPEG ama hala başarısız
**Neden**: Görsel kalitesi veya OCR ayarları
**Çözüm**:
- JPEG kalitesini 0.90'a yükselt
- Maksimum genişliği 2560px'e çıkar
- Log'larda "neden" alanını kontrol et

---

## 📝 TEST SONUÇLARINI KAYDET

Test sonrasında şu bilgileri topla:
1. Kamera görsel boyutu
2. Kamera formatı
3. Kamera süresi
4. Kamera sonucu (başarılı/başarısız)
5. Galeri görsel boyutu
6. Galeri formatı
7. Galeri süresi
8. Galeri sonucu

Bu bilgilerle başarı/başarısızlık durumunu değerlendireceğiz.
