# Plaka Kamera Akışı - Düzeltme Özeti

## 🎯 Sorun
Kullanıcı QR ile blok seçip "Girişi Kaydet" → plaka kamera ikonu → plaka okut → "Kullan" butonuna bastığında plaka **kurye kaydı formuna YAZILMIYORDU**, sadece navigasyonda "Plakalar" sayfasına gidiyordu.

## ✅ Çözüm
**3 kritik nokta** düzeltildi:

### 1️⃣ `companion/public/telefon/index.html` - Satır ~4560 (`Cam.open`)
```javascript
// Modal açıksa currentUnit kontrolü ATLA
const modalAcik = $('#courierModal') && $('#courierModal').classList.contains('show');
if((c.mode==='fill'||c.mode==='log') && !currentUnit && !modalAcik) {
  c.mode='scan'; // Sadece modal KAPALI ve currentUnit YOK ise scan yap
}
```

### 2️⃣ `companion/public/telefon/index.html` - Satır ~6498 (`camUse` click handler)
```javascript
if(mode==='fill'||mode==='log'){
  const modalAcik = $('#courierModal') && $('#courierModal').classList.contains('show');
  
  // Modal açıksa currentUnit olmasa da DEVAM ET
  if(!currentUnit && !modalAcik){ 
    toast('Önce bir daire seçin','err'); 
    return; 
  }
  
  // Input alanlarını doldur
  $('#courierPlateInput').value=r.plate;
  $('#courierNameInput').value=r.courier?.name||'';
  $('#courierCompanyInput').value=r.courier?.company||'';
  
  // Modal ZATEN açıksa TEKRAR AÇMA!
  if(modalAcik){
    toast((r.courier ? r.courier.name + ' · ' : '') + r.plate, 'ok');
    return; // ← Modalı tekrar açma, sadece alanları doldur
  }
  
  openCourierModal({...}); // Modal kapalıysa aç
}
```

### 3️⃣ `companion/public/telefon/index.html` - Satır ~3220 (`openCourierModal`)
```javascript
// Modal zaten açıksa currentUnit kontrolü ATLA
const modalZatenAcik = $('#courierModal') && $('#courierModal').classList.contains('show');
if(!currentUnit && !pre.unit && !modalZatenAcik){ 
  toast('Önce bir daire seçin','err'); 
  return; 
}
```

## 🧪 Test Edilmesi Gereken Senaryolar

### ✅ Temel Akış
1. QR ile blok seç (örn: Cevahir 563-13 · A1)
2. "Girişi Kaydet" butonuna tıkla
3. Kurye kaydı modalı açılır
4. Plaka alanının yanındaki kamera ikonuna tıkla
5. Plaka okut (örn: 31 ATM 325)
6. "Kullan" butonuna bas
7. **Beklenen:** Plaka "31 ATM 325" kurye kaydı formunda görünür ✅
8. **Önceki hata:** Plaka Plakalar sayfasına gidiyordu ❌

### ✅ Bilinen Kurye
- Plaka: 31 ATM 325 → Sedat · UBER EATS
- **Beklenen:** Hem plaka hem ad soyad hem firma otomatik doluyor ✅

### ✅ Bilinmeyen Plaka
- Plaka: 34 XYZ 999 (yeni)
- **Beklenen:** Sadece plaka doluyor, ad soyad boş (kullanıcı girer) ✅

### ✅ Edge Case: currentUnit Kaybı
- Modal açıkken bile `currentUnit` null olsa
- **Beklenen:** Plaka yine de forma yazılır ✅

## 🐛 Debug
Konsola şu loglar yazılacak:
```
[KAMERA DEBUG] courierCamBtn tıklandı - currentUnit: {site:{...}, code:'A1'}
[CAM.OPEN DEBUG] Final mode: fill
[KULLAN DEBUG] Mode: fill currentUnit: {...}
[KAMERA] Modal zaten açık - sadece alanlar güncellendi
```

## 📝 Değiştirilen Dosyalar
- ✅ `companion/public/telefon/index.html` (3 değişiklik)

## 🚀 Sonuç
Artık kullanıcı **nerede plaka okutuyorsa oraya yazılıyor**:
- ✅ Kurye kaydı modalından → Kurye kaydı formuna
- ✅ Plakalar sayfasından → Plaka kayıt formuna
- ✅ Hepsi mantıklı ve tutarlı!
