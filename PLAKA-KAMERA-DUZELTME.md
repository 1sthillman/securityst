# Plaka Kamera Akışı Düzeltmesi

## Sorun
Kullanıcı QR ile blok seçip "Girişi Kaydet" butonuna tıkladığında kurye kaydı modalı açılıyor. Modal içindeki plaka alanının yanındaki kamera ikonuna tıklayıp plakayı okuttuğunda "Kullan" butonuna basıldığında plaka **kurye kaydı formuna değil, navigasyon menüsündeki Plakalar sayfasına** gidiyordu.

## Kök Neden
1. `Cam.open({ mode:'fill' })` çağrıldığında `currentUnit` kontrolü yapılıyordu
2. Eğer `currentUnit` null ise mode otomatik olarak `'scan'`e çevriliyordu
3. `mode='scan'` olunca "Kullan" butonu plakayı Plakalar sayfasına yönlendiriyordu

**Ama modal zaten açık!** Plaka input alanı modalda görünür durumda ve kullanıcı oraya yansımasını bekliyor.

## Çözüm
3 kritik değişiklik yapıldı:

### 1. `Cam.open()` - Modal Kontrolü Eklendi
```javascript
// ÖNCE: currentUnit yoksa mode='scan' yapılıyordu
if((c.mode==='fill'||c.mode==='log') && !currentUnit) c.mode='scan';

// SONRA: Modal açıksa currentUnit olmasa bile mode='fill' kalıyor
const modalAcik = $('#courierModal') && $('#courierModal').classList.contains('show');
if((c.mode==='fill'||c.mode==='log') && !currentUnit && !modalAcik) {
  c.mode='scan';
}
```

### 2. `camUse()` - Modal Açıksa Tekrar Açma
```javascript
if(mode==='fill'||mode==='log'){
  const modalAcik = $('#courierModal') && $('#courierModal').classList.contains('show');
  
  // currentUnit yoksa ama modal açıksa DEVAM ET
  if(!currentUnit && !modalAcik){ 
    toast('Önce bir daire seçin','err'); 
    return; 
  }
  
  // Input alanlarını doldur
  if(r.plate) $('#courierPlateInput').value=r.plate;
  if(r.courier){ 
    $('#courierNameInput').value=r.courier.name||''; 
    $('#courierCompanyInput').value=r.courier.company||''; 
  }
  
  plateLookup(); paintCourierFirm();
  
  // Modal ZATEN açıksa TEKRAR açma!
  if(modalAcik){
    toast((r.courier ? r.courier.name + ' · ' : '') + (r.plate || 'Plaka okundu'), 'ok');
    return;
  }
  
  // Modal kapalıysa aç
  openCourierModal({ plate:r.plate||'', ... });
}
```

### 3. `openCourierModal()` - Modal Açıkken Hata Verme
```javascript
// ÖNCE: currentUnit yoksa hata veriyordu
if(!currentUnit && !pre.unit){ toast('Önce bir daire seçin','err'); return; }

// SONRA: Modal zaten açıksa kontrolü atla
const modalZatenAcik = $('#courierModal') && $('#courierModal').classList.contains('show');
if(!currentUnit && !pre.unit && !modalZatenAcik){ 
  toast('Önce bir daire seçin','err'); 
  return; 
}
```

## Test Senaryoları

### ✅ Senaryo 1: Normal Akış (currentUnit var)
1. QR ile blok seç → `currentUnit` set edilir
2. "Girişi Kaydet" → Modal açılır
3. Plaka kamera ikonuna tıkla → Kamera `mode='fill'` ile açılır
4. Plaka okut → "Kullan" butonu → Plaka modalda görünür ✓

### ✅ Senaryo 2: currentUnit Kaybolmuş (edge case)
1. QR ile blok seç
2. "Girişi Kaydet" → Modal açılır
3. (Bir şekilde `currentUnit = null` oluyor - örn: başka bir sayfa geçişi)
4. Plaka kamera ikonuna tıkla → **Modal açık olduğu için mode='fill' kalır**
5. Plaka okut → "Kullan" butonu → **Modal açık olduğu için plaka modalda görünür** ✓

### ✅ Senaryo 3: Bilinen Plaka
1. QR ile blok seç → "Girişi Kaydet" → Modal açılır
2. Plaka kamera ikonuna tıkla → Kamera açılır
3. Bilinen plaka okut (örn: 31 ATM 325 → Sedat · UBER EATS)
4. "Kullan" butonu:
   - Plaka: 31 ATM 325
   - Ad Soyad: Sedat
   - Firma: UBER EATS
   - **Hepsi modalda görünür** ✓

### ✅ Senaryo 4: Bilinmeyen Plaka
1. QR ile blok seç → "Girişi Kaydet" → Modal açılır
2. Plaka kamera ikonuna tıkla → Kamera açılır
3. Yeni plaka okut (örn: 34 XYZ 999)
4. "Kullan" butonu:
   - Plaka: 34 XYZ 999
   - Ad Soyad: (boş - kullanıcı girer)
   - Firma: (boş - kullanıcı girer)
   - **Plaka modalda görünür** ✓

## Debug Logları
Sorun tekrar oluşursa konsola bakılacak loglar:

```
[KAMERA DEBUG] courierCamBtn tıklandı - currentUnit: {...}
[CAM.OPEN DEBUG] ctx: {mode:'fill'} ctxMode: fill currentUnit: {...}
[CAM.OPEN DEBUG] Final mode: fill
[KULLAN DEBUG] Mode: fill currentUnit: {...} Result: {plate:'31 ATM 325', ...}
[KAMERA] Modal zaten açık - sadece alanlar güncellendi
```

Eğer mode `'scan'` olarak değişiyorsa:
```
[CAM.OPEN] Mode değiştirildi: fill/log → scan (currentUnit yok ve modal kapalı)
```

## Sonuç
✅ Plaka kameradan okunduğunda **MUTLAKA** kurye kaydı formuna yansıyor
✅ Modal açıksa TEKRAR açılmıyor
✅ currentUnit yoksa bile modal açıkken plaka çalışıyor
✅ Kullanıcı deneyimi mükemmel - plaka nerede okutuluyorsa oraya yazılıyor
