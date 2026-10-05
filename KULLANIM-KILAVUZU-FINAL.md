# ÇINARKÖY SYNC - KULLANIM KILAVUZU

## KURULUM

### 1. Sunucuyu Başlatın

Windows'ta çift tıklayın:
```
BASLATICI.bat
```

Sunucu başladığında göreceksiniz:
```
Companion hazır: http://0.0.0.0:4545
Panel: http://localhost:4545/
Telefon: http://localhost:4545/telefon/
```

### 2. Telefonu Bağlayın

**İki aşamalı sistem:**

**ADIM 1:** Uygulamayı Aç
- Bilgisayarda http://localhost:4545/eslesme.html sayfasını açın
- Sol taraftaki QR kodu telefonla okutun
- Uygulama açılacak

**ADIM 2:** Senkronu Başlat
- Telefonda "Senkron" butonuna basın
- Sağ taraftaki QR kodu okutun
- Token otomatik kaydedilecek

---

## GÜNLÜK KULLANIM

### Kayıt Girme

1. Telefonda uygulamayı açın
2. Plaka okutun veya manuel girin
3. Bilgileri doldurun
4. Kaydet butonuna basın
5. Excel'de otomatik görünür

### Kayıtları Görüntüleme

Panelde:
- **Ana Sayfa** - Son hareketler
- **Kayıtlar** - Tüm liste + arama
- **Excel** - `companion/data/kayitlar.xlsx`

---

## SORUN ÇÖZÜM

### Telefon Bağlanmıyor

1. Aynı Wi-Fi ağında mısınız?
2. Sunucu çalışıyor mu? (BASLATICI.bat)
3. Firewall izni var mı?
4. IP adresi değişti mi? (Eşleşme sayfasını yenileyin)

### Plaka Okunmuyor

1. Işık yeterli mi?
2. Plaka net görünüyor mu?
3. Kamerayı yaklaştırın
4. Manuel giriş yapabilirsiniz

### Excel Güncellenmiyor

1. Excel dosyasını kapatın
2. Sunucuyu yeniden başlatın
3. Self-healing sistemi otomatik onaracak

---

## TEKNİK DETAYLAR

### Dosya Yapısı

```
companion/
├── data/
│   ├── kayitlar.xlsx      # Excel dosyası
│   ├── kayitlar.jsonl     # Ana güvenlik günlüğü
│   ├── seen-ids.json      # Dedup sistemi
│   ├── eslesmeler.json    # Cihaz listesi
│   └── yedek/             # Otomatik yedekler
├── companion.js           # Ana sunucu
└── config.json            # Ayarlar + token
```

### Self-Healing Sistemi

Otomatik olarak:
- Bozuk dosyaları tespit eder
- Backup'tan geri yükler
- Excel'i yeniden oluşturur
- Dedup sistemini rebuild eder

### Güvenlik

- Token bazlı kimlik doğrulama
- Sadece yerel ağ erişimi
- Cihaz onay mekanizması
- Tüm veriler yerel

---

## DESTEK

**Log Dosyası:** `companion/data/servis.log`
**Test:** http://localhost:4545/saglik

Sunucu çalışıyorsa JSON yanıt verir.

---

*Profesyonel, modern, emoji-free dokümantasyon*
