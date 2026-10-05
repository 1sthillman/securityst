# Plaka Veritabanı Sistemi - Tasarım Dökümanı

## 🎯 HEDEFLER

1. **Merkezi Plaka Veritabanı**: Tüm plakalar sunucuda saklanır
2. **Otomatik Senkronizasyon**: Telefon → Sunucu → Diğer telefonlar
3. **Excel Yönetimi**: Plakalar ayrı Excel'de (plakalar.xlsx)
4. **Web Panel Yönetimi**: Plakalar web panelinde görüntülenir ve düzenlenir
5. **Otomatik Tamamlama**: Telefonda plaka okununca sunucudan bilgi gelir

## 📊 VERİ YAPISI

### Plaka Kaydı (Courier/Plate)
```javascript
{
  id: "uuid",              // Benzersiz kimlik
  plate: "34 ABC 123",     // Plaka (formatlanmış)
  key: "34ABC123",         // Arama anahtarı (normalize)
  name: "Ahmet Yılmaz",    // Sürücü adı
  company: "Yurtiçi Kargo",// Firma
  type: "Kurye",           // Tür (Kurye/Ziyaretçi/Servis/Tedarikçi)
  note: "Sabah vardiyası", // Not
  phone: "+905551234567",  // Telefon (opsiyonel)
  ts: 1234567890,          // Oluşturma zamanı
  updatedAt: 1234567890,   // Son güncelleme
  dev: "telefon-123",      // Hangi cihaz kaydetti
  seen: 5,                 // Kaç kez görüldü
  deleted: false           // Silinmiş mi
}
```

## 🔄 VERİ AKIŞI

```
1. Telefon (Yeni Plaka)
   ↓
2. Yerel DB'ye kaydet (COURIERS)
   ↓
3. Senkron kuyruğuna al
   ↓
4. POST /plaka (sunucuya gönder)
   ↓
5. Sunucu: plakalar.jsonl'e yaz
   ↓
6. Sunucu: plakalar.xlsx güncelle
   ↓
7. Sunucu: Diğer telefonlara bildir (WebSocket)
   ↓
8. Diğer telefonlar: Otomatik senkronize

OKUMA:
--------
1. Telefon: Plaka okut
   ↓
2. Yerel COURIERS'da ara
   ↓
3. Bulunamadıysa: GET /plaka/:plate
   ↓
4. Sunucu: plaka bilgisini döndür
   ↓
5. Telefon: Bilgiyi göster + yerel DB'ye cache
```

## 📁 DOSYA YAPISI

### Sunucu (companion/)
```
data/
  ├── plakalar.jsonl       # Ana plaka logu (append-only)
  ├── plakalar.xlsx        # Plaka Excel'i
  ├── kayitlar.jsonl       # Giriş kayıtları (mevcut)
  ├── kayitlar.xlsx        # Giriş Excel'i (mevcut)
  └── seen-plate-ids.json  # Plaka dedup
```

### Excel Yapısı (plakalar.xlsx)
```
| Plaka      | Tür        | Ad Soyad     | Firma         | Telefon       | Not           | Son Görülme    | Görülme Sayısı |
|------------|------------|--------------|---------------|---------------|---------------|----------------|----------------|
| 34 ABC 123 | Kurye      | Ahmet Yılmaz | Yurtiçi Kargo | 0555 123 4567 | Sabah vardiya | 15.01.2025 ... | 12             |
| 06 XYZ 789 | Ziyaretçi  | Mehmet Kaya  | -             | -             | Daimi izinli  | 14.01.2025 ... | 3              |
```

## 🔌 API ENDPOINTS

### POST /plaka
Yeni plaka ekle veya güncelle

**Request:**
```json
{
  "id": "uuid",
  "plate": "34 ABC 123",
  "name": "Ahmet Yılmaz",
  "company": "Yurtiçi Kargo",
  "type": "Kurye",
  "note": "",
  "phone": "",
  "ts": 1234567890,
  "updatedAt": 1234567890,
  "dev": "telefon-123",
  "seen": 1,
  "deleted": false
}
```

**Response:**
```json
{
  "ok": true,
  "result": "created|updated|duplicate",
  "plate": { ...plaka_bilgisi }
}
```

### POST /plaka/batch
Toplu plaka senkronizasyonu

**Request:**
```json
{
  "plates": [ ...plaka_listesi ]
}
```

### GET /plaka/:plate
Plaka bilgisi sorgula

**Response:**
```json
{
  "ok": true,
  "plate": { ...plaka_bilgisi }
}
```

### GET /plakalar
Tüm plakalar (web panel için)

**Query:**
```
?limit=50&offset=0&q=ahmet&type=Kurye
```

**Response:**
```json
{
  "ok": true,
  "total": 150,
  "records": [ ...plakalar ]
}
```

### PUT /plaka/:id
Plaka güncelle (web panel)

### DELETE /plaka/:id
Plaka sil (soft delete)

## 🌐 WEB PANELİ

### Plakalar Sayfası (companion/public/plakalar.html)

**Özellikler:**
- Tablo görünümü (inline düzenleme)
- Filtreleme (tür, firma, ad)
- Arama (plaka, ad, firma)
- Yeni plaka ekleme
- Düzenleme (satıra tıklama)
- Silme (soft delete)
- Excel indirme

**Sütunlar:**
1. Plaka
2. Tür (badge)
3. Ad Soyad
4. Firma
5. Telefon
6. Not
7. Son Görülme
8. Görülme Sayısı
9. Düzenle/Sil

**Inline Düzenleme:**
- Satıra tıklayınca düzenleme modu
- Tür dropdown
- Kaydet/İptal butonları
- Panel ve kayıtlar sayfası ile aynı UX

## 📱 TELEFON UYGULAMASI

### Plaka Okuma Akışı

**MEVCUT:**
```javascript
1. Kamera aç
2. Plaka oku
3. Yerel COURIERS'da ara
4. Bulunamadıysa "yeni plaka" göster
5. Manuel girişle kaydet
```

**YENİ:**
```javascript
1. Kamera aç
2. Plaka oku
3. Yerel COURIERS'da ara
4. Bulunamadıysa:
   a. Sunucuya sor: GET /plaka/:plate
   b. Sunucu yanıt:
      - Bulundu → Bilgiyi göster, yerel cache'e al
      - Bulunamadı → "yeni plaka" göster
5. Bilgilerle modalı doldur
6. Kaydet → Sunucuya gönder
```

### Senkronizasyon Sistemi

**Plaka Kuyruğu (senkron.js):**
```javascript
// Mevcut kayıt kuyruğuna ek olarak:
function enqueuePlate(plate) {
  var payload = {
    id: plate.uid || plate.id,
    plate: plate.plate,
    name: plate.name,
    company: plate.company,
    type: plate.type || 'Kurye',
    note: plate.note || '',
    phone: plate.phone || '',
    ts: plate.ts,
    updatedAt: plate.updatedAt,
    dev: plate.dev,
    seen: plate.seen || 0,
    deleted: plate.deleted === true
  };
  return qPutPlate(payload);
}
```

**Otomatik Sorgulama:**
```javascript
// Plaka okununca sunucuya sor
function fetchPlateFromServer(plate) {
  return fetch(baseUrl + '/plaka/' + encodeURIComponent(plate), {
    headers: requestHeaders()
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok && data.plate) {
      // Sunucudan geldi, yerel cache'e al
      cachePlate(data.plate);
      return data.plate;
    }
    return null;
  });
}
```

## 🔧 UYGULAMA

### 1. Sunucu (companion.js)

**Yeni fonksiyonlar:**
```javascript
// Plaka normalleştirme
function sanitizePlate(p) { ... }

// Plaka logu
function appendPlateLog(plate) { ... }

// Plaka Excel rebuild
function rebuildPlateExcel() { ... }

// Plaka dedup
var seenPlateIds = new Set();
```

**Endpoint'ler:**
```javascript
app.post('/plaka', authMiddleware, (req, res) => { ... });
app.post('/plaka/batch', authMiddleware, (req, res) => { ... });
app.get('/plaka/:plate', authMiddleware, (req, res) => { ... });
app.get('/plakalar', authMiddleware, (req, res) => { ... });
app.put('/plaka/:id', authMiddleware, (req, res) => { ... });
app.delete('/plaka/:id', authMiddleware, (req, res) => { ... });
```

### 2. Telefon (senkron.js)

**Plaka sarma:**
```javascript
function wrapPlateDbPut() {
  var orig = window.dbPut;
  window.dbPut = function(store, rec) {
    return orig.apply(this, arguments).then(function(r) {
      if (store === 'couriers' && r && r.plate) {
        enqueuePlate(r).catch(function(){});
      }
      return r;
    });
  };
}
```

### 3. Web Paneli (plakalar.html)

**Yeni sayfa oluştur:**
```html
<!doctype html>
<html lang="tr" data-tema="koyu">
<head>
  <title>Plakalar · Çınarköy Sync</title>
  <!-- ... -->
</head>
<body>
  <!-- Inline düzenleme tablosu -->
  <!-- Filtreleme -->
  <!-- Arama -->
  <!-- Excel indirme -->
</body>
</html>
```

## 🎨 KULLANICI DENEYİMİ

### Güvenlik Görevlisi (Telefon)

**Senaryo 1: Tanıdık Plaka**
```
1. Plakayı okut
2. ✅ "34 ABC 123 - Ahmet Yılmaz (Yurtiçi Kargo)" göster
3. Onaylayıp kaydet
```

**Senaryo 2: Yeni Plaka (Başka Telefonda Kayıtlı)**
```
1. Plakayı okut
2. Yerel bulunamadı, sunucuya sor...
3. ✅ Sunucudan geldi: "34 ABC 123 - Ahmet Yılmaz"
4. Onaylayıp kaydet
5. ℹ️ Yerel cache'e kaydedildi (çevrimdışı çalışır)
```

**Senaryo 3: İlk Kez Görülen Plaka**
```
1. Plakayı okut
2. Yerel bulunamadı, sunucuya sor...
3. ⚠️ Sunucuda yok: "Bu plaka ilk kez görülüyor"
4. Ad ve firma gir
5. Kaydet → Sunucuya gönderilir
6. ℹ️ Diğer telefonlar otomatik öğrenir
```

### Yönetici (Web Panel)

**Plakalar Sayfası:**
```
1. "Plakalar" sekmesine tıkla
2. Tüm plakalar listesi görünür
3. Satıra tıklayarak düzenle:
   - Adı düzelt
   - Firmayı güncelle
   - Tür değiştir
   - Not ekle
4. Kaydet → Tüm cihazlar güncellenir
```

## 🚀 AVANTAJLAR

1. **Merkezi Yönetim**: Plakalar tek yerden yönetilir
2. **Otomatik Öğrenme**: Bir telefon kaydeder, hepsi bilir
3. **Çevrimdışı Çalışma**: Cache sayesinde internet olmadan çalışır
4. **Veri Bütünlüğü**: Sunucu tek doğruluk kaynağı
5. **Kolay Düzeltme**: Web panelinden toplu düzenleme
6. **Raporlama**: Excel ile analiz ve raporlama
7. **Geçmişe Dönük**: Plaka geçmişi ve istatistikleri

## 📋 UYGULAMA PLANI

### Faz 1: Sunucu Altyapısı (30 dk)
- [ ] Plaka dedup sistemi
- [ ] Plaka log (plakalar.jsonl)
- [ ] Plaka Excel (plakalar.xlsx)
- [ ] API endpoint'leri

### Faz 2: Telefon Senkronizasyonu (20 dk)
- [ ] Plaka kuyruğu (senkron.js)
- [ ] Sunucu sorgulama
- [ ] Cache sistemi
- [ ] dbPut sarma

### Faz 3: Web Paneli (25 dk)
- [ ] Plakalar sayfası (plakalar.html)
- [ ] Tablo + inline düzenleme
- [ ] Filtreleme + arama
- [ ] Excel indirme

### Faz 4: Test ve Entegrasyon (15 dk)
- [ ] Telefon → Sunucu → Excel
- [ ] Web panel düzenleme
- [ ] Çoklu telefon senkronizasyonu
- [ ] Çevrimdışı mod testi

## ⚠️ DİKKAT EDİLECEKLER

1. **Backwards Compatibility**: Eski telefonlar yeni sistemi desteklemese de çalışmalı
2. **Conflict Resolution**: Aynı plakayı iki telefon farklı güncelleyebilir (updatedAt öncelikli)
3. **Privacy**: Plaka verileri hassastır, güvenlik kritik
4. **Performance**: Büyük plaka listelerinde pagination gerekli
5. **Offline-First**: Telefon her zaman çevrimdışı çalışabilmeli

## 🎯 SONUÇ

Bu sistem ile:
- ✅ Plakalar merkezi yönetilir
- ✅ Yeni güvenlik görevlisi tüm plakaları bilir
- ✅ Web panelinden toplu düzenleme
- ✅ Otomatik tamamlama ve öğrenme
- ✅ Excel raporlama
- ✅ Çevrimdışı çalışma

**ŞİMDİ UYGULAMAYA BAŞLIYORUM! 🚀**
