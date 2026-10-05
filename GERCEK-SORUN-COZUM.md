# 🎯 GERÇEK SORUN VE ÇÖZÜM

## ❌ SORUN
Kullanıcı kameradan plaka okutup "Kullan" butonuna bastığında plaka **YAZILIYORDU AMA GÖRÜNMÜYORDU!**

## 🔍 KÖK NEDEN

### `P.autoPlate` Ayarı
Kullanıcının ayarlarında `autoPlate: false` olduğunda:

```javascript
$('#courierPlateBox').style.display = P.autoPlate ? 'block' : 'none';
```

Bu satır plaka kutusunu **GİZLİYOR**! Yani:
- Plaka input alanı **MEVCUT** ✅
- Plaka değeri **YAZILIYOR** ✅  
- AMA `display: none` olduğu için **GÖRÜNMÜYOR** ❌

## ✅ ÇÖZÜM

### companion/public/telefon/index.html - Satır ~6508

```javascript
if(r.plate) {
  $('#courierPlateInput').value = r.plate;
  
  // KRİTİK FİX: Plaka geldi, kutuyu görünür yap (autoPlate false olsa bile)
  const plateBox = $('#courierPlateBox');
  if(plateBox && plateBox.style.display === 'none') {
    plateBox.style.display = 'block';
  }
  
  console.log('[KAMERA] courierPlateInput set:', $('#courierPlateInput').value);
}
```

### Mantık
- Kameradan plaka geliyorsa kullanıcı **AÇIKÇA** plaka istiyor demektir
- `autoPlate` ayarı **genel tercih** içindir (form açılırken)
- Ama kameradan plaka okutulduğunda bu tercih **override edilmeli**

## 🧪 Test

### Senaryo 1: autoPlate=true (varsayılan)
1. QR ile blok seç → "Girişi Kaydet" ✅
2. Modal açılır, plaka kutusu GÖRÜNÜR ✅
3. Kamera ile plaka okut → Plaka YAZILIR ve GÖRÜNÜR ✅

### Senaryo 2: autoPlate=false (kullanıcı kapattı)
1. QR ile blok seç → "Girişi Kaydet" ✅
2. Modal açılır, plaka kutusu GİZLİ ✅ (kullanıcı istememiş)
3. **AMA** kamera ile plaka okutulursa:
   - Plaka kutusu GÖRÜNÜR hale gelir ✅
   - Plaka YAZILIR ve GÖRÜNÜR ✅
   - **Mantıklı:** Kullanıcı kameradan okutuyor = plaka istiyor!

## 📊 Sonuç

**BU TEK SATIRLIK FIX SORUNU ÇÖZDÜ:**
```javascript
if(plateBox && plateBox.style.display === 'none') {
  plateBox.style.display = 'block';
}
```

✅ Plaka YAZILIYOR  
✅ Plaka GÖRÜNÜYOR  
✅ Kullanıcı deneyimi MÜKEMMEL!
