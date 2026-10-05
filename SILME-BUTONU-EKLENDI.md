# Silme Butonları Eklendi

## ✅ KAYITLAR Sayfası

### Eklenen Özellik
Her kayıt satırına **SİL butonu** eklendi.

### Görünüm
```
Kayıt Satırı:
[Adres]  [Kurye]  [Plaka]  [Firma]  [Saat]  [🔊 Sesli]  [🗑️ SİL]
```

### Çalışma
1. Kayıt satırındaki çöp kutusu ikonuna tıkla
2. Onay sorusu çıkar: "Bu kaydı silmek istediğinize emin misiniz?"
3. **Evet** → Kayıt silindi, liste güncellendi
4. **Hayır** → İptal

### Kod
```javascript
+'<div class="icon-mini" data-a="delete" title="Sil" style="color:var(--danger)">
  <svg>...</svg>
</div>'

if(a && a.dataset.a==='delete'){ 
  const ok=await ask('Bu kaydı silmek istediğinize emin misiniz?', ...);
  if(!ok) return;
  v.deleted=true; 
  v.updatedAt=Date.now(); 
  await dbPut(S_V,v); 
  await refresh(); 
  renderLog(); 
  renderStats(); 
  toast('Kayıt silindi','ok'); 
}
```

## ✅ PLAKALAR Sayfası

### Eklenen Özellik
Her plaka satırında **ZATEN silme butonu vardı**, sadece `renderCouriers()` çağrısı eklendi.

### Görünüm
```
Plaka Satırı:
[Plaka]  [Kurye Adı]  [Firma]  [Giriş Sayısı]  [✓ Kullan]  [✏️ Düzenle]  [🗑️ Sil]
```

### Çalışma
1. Plaka satırındaki çöp kutusu ikonuna tıkla
2. Onay sorusu: "Kurye silinsin mi? Plaka — Ad listeden kaldırılacak. Geçmiş kayıtlar silinmez."
3. **Evet** → Plaka silindi, liste güncellendi
4. **Hayır** → İptal

### Önemli
- Plaka silinse bile **geçmiş kayıtlar korunur**
- Sadece kurye listesinden kaldırılır
- Sunucuya da `deleted=true` olarak gönderilir

## 📊 Sonuç

### Kayıtlar
- ✅ Her kayıt silinebilir
- ✅ Onay sorusu var
- ✅ Silinen kayıt listeden kaldırılır
- ✅ İstatistikler güncellenir

### Plakalar
- ✅ Her plaka silinebilir
- ✅ Onay sorusu var
- ✅ Geçmiş kayıtlar korunur
- ✅ Liste hemen güncellenir

**Tamamlandı!** 🎉
