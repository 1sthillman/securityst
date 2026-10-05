# 🎉 Yeni Özellikler ve Kullanım Kılavuzu

## ✨ EKLENENEN ÖZELLİKLER

### 1. 📅 Gelişmiş Tarih Filtreleme (Kayıtlar Sayfası)

**Kullanım:**
- Kayıtlar sayfasını açın
- Üstteki tarih filtresinden seçin:
  - **Bugün**: Sadece bugünkü kayıtlar (varsayılan)
  - **Dün**: Dünkü kayıtlar
  - **Son 7 Gün**: Son 1 haftanın kayıtları
  - **Son 30 Gün**: Son ayın kayıtları
  - **Bu Ay**: Mevcut ayın tüm kayıtları
  - **Özel Tarih**: Başlangıç-bitiş tarihi seçin

**Özellikler:**
- Filtre değiştiğinde sayfa otomatik yenilenir
- Site istatistikleri de seçili tarihe göre güncellenir
- "Bugünkü Site/Blok Girişleri" başlığı seçili tarihe göre değişir

### 2. 🎯 Tür Filtresi (Kayıtlar Sayfası)

**Kullanım:**
- Tür dropdown'ından seçin:
  - Tüm Türler
  - Kurye
  - Ziyaretçi
  - Servis
  - Tedarikçi

**Kombinasyon:**
- Site + Tarih + Tür filtrelerini aynı anda kullanabilirsiniz
- Örnek: "Cevahir 561-13" + "Bugün" + "Kurye" = Bugün bu siteye gelen kuryeler

### 3. 📊 Dinamik Site İstatistikleri

**Panel Sayfası:**
- Sağ üstte tarih filtresi var (Bugün, Dün, Son 7 Gün, Bu Ay)
- Seçilen tarihe göre site istatistikleri güncellenir
- Site kartlarına tıklayınca o siteye filtrelenmiş Kayıtlar sayfası açılır

**Kayıtlar Sayfası:**
- Alt kısımda site kartları
- Aktif tarih filtresine göre güncellenir
- Karta tıklayınca o siteye filtre uygulanır ve yukarı kaydırır

### 4. 📥 Filtrelenmiş Export (CSV)

**Kullanım:**
1. İstediğiniz filtreleri uygulayın (Tarih + Site + Tür + Arama)
2. "Seçilenleri Export" butonuna tıklayın
3. CSV dosyası otomatik indirilir

**Dosya Formatı:**
- UTF-8 BOM (Türkçe karakterler düzgün)
- Virgül ayıraçlı
- Excel'de açılmaya hazır
- Dosya adı: `kayitlar-[filtre].csv`

### 5. 🔄 Real-Time Güncelleme (Tüm Sayfalar)

**Nasıl Çalışır:**
- Telefondan yeni kayıt geldiğinde:
  - Panel: Tablolar ve site istatistikleri otomatik güncellenir
  - Kayıtlar: Hem tablo hem site kartları güncellenir
  - Refresh'e basmaya gerek YOK!

### 6. 🎨 Tutarlı Navigasyon

**Tüm Sayfalarda:**
- Panel
- Kayıtlar
- Plakalar
- Siteler
- Ayarlar

**Eski "Eşleşme" ve "Cihazlar" sayfaları kaldırıldı** (gereksiz)

### 7. 📝 Excel Ayarları (Düzeltildi)

**Kullanım:**
1. Ayarlar sayfasını açın
2. Excel Modu seçin:
   - **Günlük Excel (Önerilen)**: Her gün ayrı dosya (`kayitlar-2026-10-04.xlsx`)
   - **Tek Excel**: Tüm kayıtlar tek dosyada (`kayitlar.xlsx`)
   - **Vardiya Excel**: Saat aralıklarına göre ayrı dosyalar

**Vardiya Ekleme:**
1. Vardiya Excel seç
2. Vardiya adı, başlangıç ve bitiş saati gir
3. "Ekle" butonuna tıkla
4. "Kaydet" ile uygula
5. Sunucuyu yeniden başlat

**Örnek Vardiyalar:**
- Sabah: 08:00 - 16:00
- Akşam: 16:00 - 00:00
- Gece: 00:00 - 08:00

### 8. 🗺️ Google Maps Koordinat Parse (Siteler)

**Kullanım:**
1. Siteler sayfasını aç
2. Site seç veya yeni ekle
3. Koordinat alanına şunlardan birini yapıştır:
   - Google Maps tam URL: `https://www.google.com/maps/@41.023,29.173,...`
   - Directions URL: `https://www.google.com/maps/dir/41.023,29.173/...`
   - Decimal: `41.023, 29.173`
   - DMS: `41°01'24.5"N 29°10'00.2"E`
   - Tek koordinat: `41.023`

**Sonuç:**
- Otomatik enlem-boylam alanlarına dağıtılır
- Harita önizlemesi görünür
- Google Maps short linkleri desteklenmiyor (güvenlik)

## 🎯 KULLANIM SENARYOLARı

### Senaryo 1: Bugün X sitesine kim geldi?
1. Kayıtlar sayfası
2. Tarih: "Bugün" (zaten seçili)
3. Site: "X Sitesi" seç
4. Liste görünür, "Seçilenleri Export" ile CSV indir

### Senaryo 2: Bu hafta hangi site en çok ziyaret edildi?
1. Panel sayfası
2. Tarih filtresi: "Son 7 Gün" seç
3. Site kartlarına bak, en büyük sayı = en popüler site

### Senaryo 3: Geçen ay kuryeler hariç tüm kayıtlar
1. Kayıtlar sayfası
2. Tarih: "Bu Ay" (önceki ay için "Özel Tarih" kullan)
3. Tür: "Kurye" dışındaki seçenekleri manuel filtrele
   (Not: "Kurye Hariç" özelliği eklenebilir)

### Senaryo 4: Belirli bir plakayı ara
1. Kayıtlar sayfası
2. Arama kutusuna plakayı yaz
3. Sonuçlar anlık filtrelenir

## ⚡ PERFORMANS İPUÇLARI

1. **Büyük Tarih Aralıkları**: "Son 30 Gün" yerine "Bu Ay" kullanın (daha hızlı)
2. **Export**: Çok fazla kayıt varsa (1000+) biraz bekleyin
3. **Real-Time**: Çok fazla sekme açık olursa yavaşlayabilir
4. **Filtreler**: Birden fazla filtre kombinasyonu yavaşlatabilir

## 🐛 BİLİNEN SORUNLAR VE ÇÖZÜMLER

### Sorun: Site istatistikleri gösterilmiyor
**Çözüm:** Sayfayı yenileyin (Ctrl+Shift+R), sunucu çalıştığından emin olun

### Sorun: Export boş dosya indiriyor
**Çözüm:** Filtre sonucu kayıt var mı kontrol edin, "Tüm Tarihler" deneyin

### Sorun: Tarih filtresi çalışmıyor
**Çözüm:** Kayıtların `ts` veya `date` alanı var mı kontrol edin

### Sorun: Koordinat yapıştırma çalışmıyor
**Çözüm:** Google Maps full URL kullanın, short link değil

## 🚀 GELECEKTEKİ ÖZELLİKLER (Planlanan)

1. **Dashboard Grafikleri**: Chart.js ile görsel raporlar
2. **Plaka Detay Modal**: Tıklayınca geçmiş kayıtlar
3. **Bildirim Sistemi**: Yeni kayıt bildirimi
4. **Offline Mod**: İnternet yokken kayıt yap
5. **Kullanıcı Rolleri**: Admin, Görevli, Görüntüleme
6. **Toplu İşlemler**: Seçili kayıtları sil/export
7. **Klavye Kısayolları**: Hızlı navigasyon
8. **Plaka Kara Liste**: Yasaklı plakalar

## 📞 DESTEK

Sorun yaşarsanız:
1. Console'u açın (F12 > Console)
2. Hata mesajlarını kontrol edin
3. Sunucu loglarına bakın
4. Tarayıcı cache'ini temizleyin (Ctrl+Shift+Delete)

## 🎉 TAMAMLANDI!

Sistem artık tam fonksiyonel ve kullanıma hazır!
