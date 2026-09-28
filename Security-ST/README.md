# 🚗 Çınarköy Güvenlik - Plaka Tanıma Sistemi

Modern web teknolojileri ile geliştirilmiş, kamera tabanlı plaka okuma ve nöbet takip sistemi.

## ✨ Özellikler

- 📸 **Kamera ile Plaka Okuma**: OCR.space API + Tesseract.js dual system
- 🔄 **Otomatik Key Rotation**: 3 API key ile 75,000 istek/ay kapasite
- 🗺️ **İnteraktif Site Haritası**: Gerçek fotoğraf üzerinde hotspot seçimi
- 📊 **Gelişmiş Raporlama**: Excel export, QR kod, istatistikler
- 🔍 **Akıllı Arama**: Plaka, isim, firma filtreleme
- 🎯 **Responsive Tasarım**: Mobil ve desktop uyumlu
- 🔒 **Güvenli**: API key'ler GitHub'da asla açıkta değil

## 🚀 Kurulum

### 1. Repository'yi Klonlayın
```bash
git clone https://github.com/1sthillman/g-venlik.git
cd g-venlik
```

### 2. OCR API Key'lerini Yapılandırın

#### Local Geliştirme İçin:
```bash
cp ocr-config.example.js ocr-config.js
```

`ocr-config.js` dosyasını açın ve kendi API key'lerinizi ekleyin:
```javascript
apiKeys: [
  'KENDI_KEY_1',
  'KENDI_KEY_2',
  'KENDI_KEY_3'
]
```

**API Key Almak İçin:**
- https://ocr.space/ocrapi
- Ücretsiz: 25,000 istek/ay per email
- 3 email ile 75,000 istek/ay toplam

#### GitHub Pages İçin:
1. Repository Settings → Secrets and variables → Actions
2. 3 secret ekleyin:
   - `OCR_KEY_1`
   - `OCR_KEY_2`
   - `OCR_KEY_3`

Detaylı kurulum: `GITHUB_SECRETS_KURULUM.example.md`

### 3. Local Test
```bash
# Basit HTTP server başlatın
python -m http.server 8000
# veya
npx serve
```

Tarayıcıda açın: `http://localhost:8000`

## 📂 Proje Yapısı

```
g-venlik/
├── index.html                          # Ana uygulama
├── ocr-config.example.js              # API config template
├── .gitignore                         # API key'leri koru
├── .github/workflows/deploy.yml       # GitHub Pages deployment
└── README.md                          # Bu dosya
```

## 🔐 Güvenlik

### API Key Koruması
- ✅ `ocr-config.js` → `.gitignore`'da (GitHub'a asla yüklenmesin)
- ✅ GitHub Secrets kullanımı (deployment için)
- ✅ Dokümantasyon dosyaları → `.gitignore`'da
- ❌ API key'ler asla kodda olmamalı

### .gitignore İçeriği
```
# API Keys
ocr-config.js

# Documentation with keys
OCR_SPACE_ENTEGRASYON_DOKUMANI.md
GITHUB_PAGES_KURULUM.md
GITHUB_SECRETS_KURULUM.md
OCR_ENTEGRASYON_DOKUMANI.md
```

## 🛠️ Teknolojiler

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **OCR**: OCR.space API (primary) + Tesseract.js (fallback)
- **QR**: QRCode.js
- **Excel**: SheetJS (xlsx)
- **Deployment**: GitHub Pages + GitHub Actions

## 📊 OCR Sistemi

### Dual OCR Engine
1. **OCR.space** (Primary)
   - 3 API key rotation
   - 75,000 istek/ay toplam
   - Engine 2 (plaka için optimize)
   
2. **Tesseract.js** (Fallback)
   - OCR.space başarısız olursa
   - Offline çalışma desteği
   - 3 farklı model (opencv, opencv-light, basic)

### Akıllı Özellikler
- 📏 Otomatik plaka bölgesi tespiti
- 🧹 Gereksiz yazı filtreleme (TR, logo, çerçeve yazıları)
- 🎯 Türk plaka format tespiti: `[2 rakam] [1-3 harf] [2-4 rakam]`
- 🔄 Otomatik key rotation (rate limit durumunda)
- ✅ Plausibility scoring (geçerli plaka kontrolü)

## 🚀 Deployment

### GitHub Pages (Otomatik)
```bash
git add .
git commit -m "Update"
git push
```

GitHub Actions otomatik olarak:
1. Secrets'lerden `ocr-config.js` oluşturur
2. GitHub Pages'e deploy eder
3. 2-3 dakika içinde live olur

URL: `https://KULLANICI_ADI.github.io/REPO_ADI/`

## 📖 Kullanım

### Plaka Okuma
1. "Kamera" sekmesine gidin
2. Kamera iznini verin
3. Plakayı çerçeveye hizalayın
4. Deklanşöre basın
5. OCR otomatik okur
6. Sonucu onaylayın veya düzeltin

### Nöbet Takibi
1. "Liste" sekmesinde arama yapın
2. Site seçin
3. Plaka okutun veya manuel girin
4. Nöbetçi bilgilerini kaydedin

### Raporlama
1. "İstatistik" sekmesine gidin
2. Excel export veya QR kod oluşturun
3. Zaman aralığı filtreleyin

## 🤝 Katkıda Bulunma

1. Fork yapın
2. Feature branch oluşturun (`git checkout -b feature/amazing`)
3. Commit yapın (`git commit -m 'Add amazing feature'`)
4. Push edin (`git push origin feature/amazing`)
5. Pull Request açın

**Not**: API key'lerinizi asla commit etmeyin!

## 📝 Lisans

Bu proje özel kullanım için geliştirilmiştir.

## 📧 İletişim

Sorularınız için GitHub Issues kullanın.

---

**⚠️ UYARI**: `ocr-config.js` ve dokümantasyon dosyalarını `.gitignore`'da tutun. API key'lerinizi asla paylaşmayın!
