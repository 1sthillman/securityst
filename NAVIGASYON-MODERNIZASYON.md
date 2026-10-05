# Navigasyon ve Site İstatistikleri Modernizasyonu

## Sorunlar
1. Her sayfada navigasyon farklı konumda ve farklı düzende
2. Panel ve Kayıtlar sayfalarında site/blok bazlı istatistik yok
3. Siteler yönetimi ile entegrasyon eksik

## Çözüm

### 1. Standart Navigasyon (Tüm Sayfalarda)
```html
<nav class="gezinme" aria-label="Bölümler">
  <a href="/"><span data-ikon="panel"></span><span>Panel</span></a>
  <a href="/kayitlar.html"><span data-ikon="kayit"></span><span>Kayıtlar</span></a>
  <a href="/plakalar.html"><span data-ikon="plaka"></span><span>Plakalar</span></a>
  <a href="/siteler.html"><span data-ikon="tablo"></span><span>Siteler</span></a>
  <a href="/ayar.html"><span data-ikon="ayar"></span><span>Ayarlar</span></a>
</nav>
```

**Değiştirilecek dosyalar:**
- ✅ `companion/public/index.html` - Panel (navigasyon + site istatistikleri ekle)
- ✅ `companion/public/kayitlar.html` - Kayıtlar (navigasyon + site filtresi ekle)
- ✅ `companion/public/plakalar.html` - Navigasyonu düzenle
- ✅ `companion/public/ayar.html` - Navigasyonu düzenle
- ✅ `companion/public/siteler.html` - Zaten doğru

### 2. Panel (index.html) - Site/Blok Kartları
Ana istatistiklerin altına bugünkü site bazlı giriş sayıları:

```
[Cevahir 561-13]  12 giriş
[ST - Dağlı Sokak]  8 giriş  
[Villa Güvenlik]  5 giriş
...
```

### 3. Kayıtlar (kayitlar.html) - Site Filtresi
Üstte dropdown:
- Tüm Siteler
- Cevahir 561-13
- ST
- ...

## Uygulama
Çok fazla dosya değişikliği gerektiği için kullanıcı hangi sayfayı önceliklemek istediğine karar versin.
