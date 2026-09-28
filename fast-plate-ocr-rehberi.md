# fast-plate-ocr Entegrasyon Rehberi (Plaka Okuma Projesi İçin)

> Bu rehber, mevcut projenizdeki (`plaka.js`, `bolge.js`, `gorsel.js`) Tesseract tabanlı hattın yerine
> **fast-plate-ocr** modelini nasıl, hangi sırayla ve hangi tuzaklara dikkat ederek kullanacağınızı anlatır.
>
> **Dürüstlük notu:** fast-plate-ocr'ın Türk plakalarındaki doğruluğunu ben ölçmedim ve model/API
> ayrıntıları sürümler arasında değişiyor (ör. v1.1.0'da çıktı `PlatePrediction` nesnesine geçti).
> Kodlar **iskelet**tir; kurduğunuz sürümün README'sine ve model yapılandırma dosyalarına göre doğrulayın.
> "Doğrulanması gerekenler" bölümü sonda listelenmiştir.

---

## İçindekiler

1. [fast-plate-ocr nedir, ne değildir](#1-fast-plate-ocr-nedir-ne-değildir)
2. [Projeniz için mimari karar](#2-projeniz-için-mimari-karar)
3. [Yol haritası (aşamalar)](#3-yol-haritası-aşamalar)
4. [Model seçimi](#4-model-seçimi)
5. [Node.js entegrasyon iskeleti](#5-nodejs-entegrasyon-iskeleti)
6. [Mevcut kodla birleştirme](#6-mevcut-kodla-birleştirme)
7. [Türk plakasına özel son işleme](#7-türk-plakasına-özel-son-işleme)
8. [Güven skoru ve karar akışı](#8-güven-skoru-ve-karar-akışı)
9. [Test ve değerlendirme](#9-test-ve-değerlendirme)
10. [Fine-tune (ince ayar)](#10-fine-tune-ince-ayar)
11. [Güvenlik, gizlilik, lisans](#11-güvenlik-gizlilik-lisans)
12. [YAPILMALI listesi](#12-yapılmalı)
13. [YAPILMAMALI listesi](#13-yapılmamalı)
14. [Doğrulanması gerekenler](#14-doğrulanması-gerekenler)
15. [Kontrol listesi](#15-kontrol-listesi)

---

## 1. fast-plate-ocr nedir, ne değildir

**Nedir**
- Plaka **metnini** okumak için eğitilmiş küçük, hızlı bir sinir ağı ailesi (CCT, MobileViT, CNN mimarileri).
- ONNX olarak çalışır; CPU'da milisaniyeler düzeyinde sonuç verir.
- "Global" modeller çok sayıda ülke plakasıyla eğitilmiştir; v1.1.0 ile bazı modeller **bölge/ülke tahmini** de yapar.
- Eğitim ve fine-tune araçları (CLI) ile birlikte gelir.

**Ne değildir**
- **Plaka dedektörü değildir.** Girdi olarak *zaten kırpılmış plaka* bekler. Sahne fotoğrafında plakayı bulmak ayrı bir iştir.
- Genel amaçlı OCR değildir; yalnızca plaka biçimli kısa metni okur.
- Hatasız değildir. Yanlış okuyabilir ve yanlış okuduğunda bile yüksek güven verebilir.

**Tesseract'tan farkı**
| | Tesseract (şu an) | fast-plate-ocr |
|---|---|---|
| Amaç | Genel metin | Sadece plaka |
| Girdi hazırlığı | Çok ağır (ikilileştirme, ters çevirme, büyütme) | Neredeyse hiç (kırp ve ver) |
| Süre | 0,1–4 sn / geçiş | Birkaç ms / plaka |
| Adaylar | Az, çok geçiş gerekir | Çok bölgeyi ucuzca deneyebilirsiniz |
| Karakter güveni | Kelime/satır düzeyi | Karakter başına |

---

## 2. Projeniz için mimari karar

Projenizin şartları: **çevrimdışı**, **Python/C++ derleyicisi kurulmayacak**, kurulum paketiyle dağıtım, Node sunucu.

### Seçenek A — Node içinde ONNX (önerilen)
`onnxruntime-node` ile `.onnx` modeli doğrudan Node'da çalıştırırsınız.
- (+) Python yok, tek süreç, mevcut mimariye en uygun.
- (+) Modeller küçük, pakete girer.
- (−) Ön işleme ve çıktı çözmeyi (argmax) JS'te sizin yazmanız gerekir (basit ama dikkat ister).
- (−) `onnxruntime-node` yerel ikili dosya içerir (önceden derlenmiş gelir, derleme gerekmez ama pakete eklenmeli).
- Alternatif: `onnxruntime-web` (WASM) tamamen saf çalışır, biraz daha yavaş.

### Seçenek B — Python yan hizmeti (sidecar)
`fast-alpr`/`fast-plate-ocr` Python'da bir yerel HTTP servisi olarak çalışır, Node ona istek atar.
- (+) Kütüphaneyi olduğu gibi kullanırsınız, dedektör dahil hazır.
- (−) Python gerekir; "kurulumda Python olmayacak" şartını bozar. PyInstaller ile tek `.exe` yapılabilir ama paket büyür.

### Seçenek C — OCR'ı telefona taşımak
Yalnızca uygulamanız native ise anlamlı; bu rehberin kapsamı dışında.

> **Öneri:** Önce **Seçenek A**. Referans doğruluğu karşılaştırmak için geliştirme makinesinde Python sürümünü
> "altın standart" olarak kullanın (bkz. §9, "Eşdeğerlik testi").

### Dedektör sorunu
fast-plate-ocr kırpılmış plaka ister. Sizde üç kaynak var:

1. **Nöbetçinin çizdiği dikdörtgen** (`ipucu`) — en güçlü sinyal, sıfır maliyet.
2. **`bolge.js` adayları** — mevcut heuristik bölge bulucu.
3. **Bir ONNX plaka dedektörü** (ör. FastALPR'ın kullandığı YOLO tabanlı dedektörler) — sonraki aşama.

İlk aşamada 1 + 2 yeterlidir. OCR ucuz olduğundan `bolge.js`'in görevi "en doğru kutuyu seçmek" olmaktan
çıkıp **"doğru kutuyu adaylar arasında bulundurmak"** (recall) olur; hepsini okuyup sonucu birlikte seçersiniz.

---

## 3. Yol haritası (aşamalar)

**Aşama 0 — Test seti (1–3 gün)**
- 200–500 gerçek telefon fotoğrafı topla (gündüz/gece, açı, uzaklık, kirli/ıslak plaka, farlı).
- Her fotoğrafın doğru plakasını CSV'ye yaz. Plakanın konumunu (kutu) de işaretle.
- Bu set olmadan hiçbir iyileştirmeyi ölçemezsiniz.

**Aşama 1 — Çevrimdışı deney (Python, geliştirme makinesi)**
- `fast-plate-ocr` modellerini test setindeki **elle kırpılmış** plakalarla çalıştır → OCR'ın tavan doğruluğu.
- Farklı modelleri karşılaştır (§4). Mavi TR şeridi dahil/hariç dene.

**Aşama 2 — Node'a taşıma**
- `onnxruntime-node` ile aynı modeli çalıştır, Python çıktısıyla birebir eşleştir (§9).

**Aşama 3 — Mevcut hatta bağlama**
- `plaka.js` arayüzünü koru (`oku(tampon, secenek)`), içeriği yeni motorla değiştir. Özellik bayrağıyla aç/kapa.

**Aşama 4 — Uçtan uca ölçüm**
- Sahne fotoğraflarıyla (kırpma yok) tam hattı ölç; hata türlerini sınıflandır.

**Aşama 5 — Fine-tune / dedektör**
- Hata analizi "Türk fontu/format" gösteriyorsa fine-tune; "plaka bulunamıyor" gösteriyorsa dedektör.

**Aşama 6 — Pilot**
- Nöbetçiyle gerçek kullanım, tüm sonuçlar **onaylı** akışta; yanlışlar kaydedilip test setine eklenir.

---

## 4. Model seçimi

Repodaki model ailesi (sürüme göre değişir, güncel listeyi README'den alın):

| Model | Not |
|---|---|
| `cct-xs-v1-global-model` / `cct-s-v1-global-model` | Global, v1 |
| `cct-xs-v2-global-model` / `cct-s-v2-global-model` | Global, v2; bölge tahmini destekli (v1.1.0+) |
| `european-plates-mobile-vit-v2-model` | Avrupa plakaları (+40 ülke), belgelenmiş ~%92,5 plaka doğruluğu (kendi doğrulama setleriyle) |

**Seçim kuralı:** "hangisi daha iyi" sorusunu **kendi test setinizde** ölçerek cevaplayın. Türkiye'nin bu modellerin
eğitim verisinde yeterince temsil edilip edilmediğini bilmiyoruz; Avrupa modeli ile global modeli mutlaka yan yana deneyin.

Karşılaştırma tablosu şablonu:

| Model | Plaka doğruluğu (tam eşleşme) | Karakter doğruluğu | Ortalama ms | Notlar |
|---|---|---|---|---|
| cct-xs-v2-global | ? | ? | ? | |
| cct-s-v2-global | ? | ? | ? | |
| european-mobile-vit-v2 | ? | ? | ? | |
| (fine-tune edilmiş) | ? | ? | ? | |

---

## 5. Node.js entegrasyon iskeleti

> **Uyarı:** Girdi adı, dtype (uint8/float32), şekil (NHWC/NCHW), yükseklik/genişlik, alfabe ve yuva sayısı
> **modelin `plate_config.yaml` dosyasından ve `session.inputNames/outputNames` çıktısından** alınmalıdır.
> Aşağıdaki değerler tipik örneklerdir; kendi model dosyanızla doğrulayın.

### 5.1 Kurulum

```bash
npm install onnxruntime-node
```

Model dosyalarını **önceden indirin** ve projeye koyun (çalışma anında ağ isteği yapılmayacak):

```
models/
  cct-xs-v2-global.onnx
  cct-xs-v2-global.plate_config.yaml   # alfabe, yuva sayısı, görüntü boyutu burada
```

### 5.2 Motor sınıfı iskeleti

```js
'use strict';
// plaka-fpo.js — fast-plate-ocr'ı Node içinde çalıştıran ince motor
const path = require('path');
const ort = require('onnxruntime-node');
const G = require('./gorsel.js');

// plate_config.yaml'dan okunmalı; burada örnek değerler:
const CFG = {
  yukseklik: 64,
  genislik: 128,
  kanal: 1,                                   // 1 = gri, 3 = RGB (config'e bakın)
  alfabe: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_', // '_' dolgu karakteri (config'e bakın)
  yuvaSayisi: 9,
};

class FpoMotoru {
  constructor(modelYolu) {
    this.modelYolu = modelYolu || path.join(__dirname, 'models', 'cct-xs-v2-global.onnx');
    this.oturum = null;
  }

  async hazirla() {
    if (this.oturum) return;
    this.oturum = await ort.InferenceSession.create(this.modelYolu, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });
    // GİRİŞ/ÇIKIŞ ADLARINI DOĞRULAYIN:
    // console.log(this.oturum.inputNames, this.oturum.outputNames);
  }

  /** gri kırpım (Uint8ClampedArray) -> { metin, karakterGuven[], minGuven, ortGuven } */
  async oku(gri, g, y) {
    await this.hazirla();

    // 1) Yeniden boyutlandır (sadece bilineer; ikilileştirme/ters çevirme YOK)
    const boyut = G.olcekle(gri, g, y, CFG.genislik, CFG.yukseklik);

    // 2) Tensör: [1, H, W, C] uint8 (model içinde normalize ediyorsa)
    const tensor = new ort.Tensor('uint8', Uint8Array.from(boyut), [1, CFG.yukseklik, CFG.genislik, CFG.kanal]);

    // 3) Çalıştır
    const girisAdi = this.oturum.inputNames[0];
    const cikti = await this.oturum.run({ [girisAdi]: tensor });
    const ham = cikti[this.oturum.outputNames[0]];   // bölge çıktısı varsa ikinci çıktı ayrı

    // 4) Çöz: her yuva için argmax (çıktı yuva*alfabe düz vektörse yeniden şekillendir)
    return this.coz(ham.data);
  }

  coz(veri) {
    const V = CFG.alfabe.length;
    let metin = '';
    const guven = [];
    for (let s = 0; s < CFG.yuvaSayisi; s++) {
      let en = 0, enDeger = -Infinity;
      for (let k = 0; k < V; k++) {
        const d = veri[s * V + k];
        if (d > enDeger) { enDeger = d; en = k; }
      }
      const c = CFG.alfabe[en];
      if (c !== '_') { metin += c; guven.push(enDeger); }   // dolgu atlanır
    }
    const min = guven.length ? Math.min(...guven) : 0;
    const ort_ = guven.length ? guven.reduce((a, b) => a + b, 0) / guven.length : 0;
    return { metin, karakterGuven: guven, minGuven: min, ortGuven: ort_ };
  }
}

module.exports = { FpoMotoru };
```

**Dikkat edilecekler**
- Çıktının softmax'lı olup olmadığını kontrol edin (değilse `argmax` güveni olasılık değildir; softmax uygulayın).
- Dolgu karakterinin yeri modelden modele değişebilir.
- Oturumu **bir kez** oluşturun, sıcak tutun (yükleme yüzlerce ms sürebilir).
- Eşzamanlı çağrılar için basit bir kuyruk kullanın (mevcut `kuyruk` deseniniz uygundur).

---

## 6. Mevcut kodla birleştirme

Mevcut dış arayüzü **bozmayın**: `oku(tampon, secenek)` aynı şekilde sonuç dönsün. Sadece içi değişir.

### Önerilen akış

```
tampon (PNG/JPEG)
  └─ griyeCevir (EXIF yönünü düzelt!)         ← gorsel/plaka.js
      └─ bozukGorsetMi                         ← mevcut
          └─ bölge adayları:
               1) ipucu dikdörtgeni (bant içinde bolge.js)
               2) bolge.js adayları (en fazla ~8)
               3) yoksa tam kare (yalnızca yedek)
              └─ her aday için: kenar payı ekle → gri kırp → FpoMotoru.oku()
                  └─ Türk plaka doğrulama/onarımı (§7)
                      └─ puanla: yapı + karakter güveni + bölge önceliği
                          └─ en iyi + alternatifler → nöbetçiye ÖNERİ
```

### Kod iskeleti (karar mantığı)

```js
async function fpoIleOku(gri, g, y, bolgeler, motor, bilinenler) {
  const sonuclar = [];
  for (const b of bolgeler) {
    const kirp = bolgeKirp(gri, g, y, kenarPayiEkle(b, g, y));   // %10-15 pay
    if (!kirp) continue;
    const r = await motor.oku(kirp.veri, kirp.genislik, kirp.yukseklik);
    const dogr = plakaDogrula(r.metin);          // §7: yapı + il kodu + harf/rakam konumu
    if (!dogr.gecerli) { sonuclar.push({ ...r, gecerli: false, bolge: b }); continue; }
    sonuclar.push({ ...r, plaka: dogr.plaka, gecerli: true, bolge: b });
  }
  // Sıralama: geçerli yapı > min karakter güveni > ortalama güven > bölge önceliği (ipucu)
  sonuclar.sort((a, b) =>
    (b.gecerli - a.gecerli) || (b.minGuven - a.minGuven) || (b.ortGuven - a.ortGuven));
  return sonuclar;
}
```

### Kalkacaklar / kalacaklar
| Bileşen | Karar |
|---|---|
| `onIsle` (Otsu/Sauvola/ters çevirme/büyütme) | **Kaldır** (Tesseract'a özgü) |
| PSM planları, `planKur`, `planTam` | **Kaldır** |
| `sessizCagri` | **Kaldır** (Tesseract WASM çıktısı için vardı) |
| `bolge.js` | **Kalsın** (aday üretimi); ama `enFazla` hatasını düzeltin |
| `gorsel.js` (PNG/JPEG çöz, gri, ölçekle, kırp) | **Kalsın**; EXIF yönü ekleyin |
| `bozukGorsetMi` | **Kalsın** |
| Kuyruk, tembel yükleme, boşta kapanma | **Kalsın** |
| `adayUret` içindeki karakter **ekleme** | **Kaldır** (bkz. §13) |
| Tesseract yolu | Özellik bayrağıyla **yedek** olarak kalabilir |

---

## 7. Türk plakasına özel son işleme

Model global olduğu için çıktısı Türk kurallarına uymayabilir. Son işleme **doğrulama** yapar, **uydurma yapmaz**.

### 7.1 Doğrulama kuralları
- Biçim: `İL(2 rakam) + HARF(1–3) + RAKAM(2–4)`
- İl kodu: `01–81`
- Harf bloğu: Türk plakasında kullanılmayan harfler elenir (`Q`, `W`, `X` kesin; `I`/`O`/`T` gibi ek kısıtları resmi kaynaktan doğrulayın — bkz. §14)
- Harf sayısı ile rakam sayısı ilişkisini bir **tabloyla** tanımlayın (ör. 1 harf → 4 rakam; 2 harf → 3–4; 3 harf → 2–3). Tabloyu resmi kaynaktan doğrulayıp kodlayın; sezgiyle ceza puanı vermeyin.
- Mavi TR şeridinden sızan `TR`/`T`/`R` karakterlerini başta temizleyin.

### 7.2 Konuma duyarlı karakter düzeltme (yalnızca **değiştirme**)
Karışan çiftler yalnızca **konuma göre** ve **modelin ikinci en yüksek olasılığı** destekliyorsa değiştirilir:

| Konum | Beklenen | Sık karışanlar |
|---|---|---|
| İl (ilk 2) | Rakam | O→0, I→1, Z→2, S→5, B→8 |
| Harf bloğu | Harf | 0→O/D, 1→I, 5→S, 8→B, 2→Z |
| Son blok | Rakam | aynı liste |

Her değiştirme bir "düzeltme" olarak sayılıp sonucun güveni **düşürülür** ve arayüzde belirtilir.

### 7.3 Ne yapılmaz
- OCR'ın görmediği karakter **eklenmez** (eksik okuma = "eksik", uydurma tamamlama yok).
- Kurye listesi karakter üretmek için kullanılmaz (§8).

---

## 8. Güven skoru ve karar akışı

fast-plate-ocr karakter başına güven verebilir. Bunu şöyle kullanın:

- **`minGuven`** (en zayıf karakter) plaka güveninin en dürüst göstergesidir. Ortalama, tek yanlış karakteri gizler.
- Eşikleri **kendi test setinizde** kalibre edin. Örnek yaklaşım:
  - Yeşil: geçerli yapı **ve** `minGuven` ≥ T1 (T1'i, bu banttaki okumaların ≥%99'unun doğru olduğu değerden seçin)
  - Sarı: geçerli yapı ama `minGuven` T2–T1 arası → nöbetçi dikkatle onaylar
  - Kırmızı: geçersiz yapı veya düşük güven → "tekrar çekin / elle girin"

### Kurye (bilinen plaka) listesi kullanımı
Mevcut kodda en tehlikeli hata buydu (uydurma adayı listeyle eşleştirip öne çıkarma). Doğrusu:

1. Listeyle karşılaştırmayı **ham/doğrulanmış OCR okumasına** göre yapın, üretilmiş adaya göre değil.
2. Yalnızca **Levenshtein ≤ 1** ise "*Listedeki 34 ABC 123 olabilir*" önerisi gösterin.
3. Öneri **asla otomatik kabul** olmasın; nöbetçi onaylasın.
4. Listeyle eşleşme, OCR güvenini **artırmaz**; sadece sıralamada ikincil ipucudur.
5. Farklı okunan ama listeye yakın plaka için arayüz açıkça "**okunan ≠ listedeki**" farkını göstersin.

### Nihai karar
Sistem **karar vermez, öneri sunar.** Kapı/giriş kararı insana aittir. Otomatik geçiş düşünülüyorsa
önce büyük bir gerçek veri setinde yanlış-kabul (false accept) oranını ölçüp iş riskiyle karşılaştırın.

---

## 9. Test ve değerlendirme

### 9.1 Metrikler
- **Plaka doğruluğu (tam eşleşme)** — asıl metrik.
- **Karakter doğruluğu** (Levenshtein tabanlı).
- **Yanlış-kabul oranı:** sistem "yeşil" dediğinde yanlış olma yüzdesi (en önemli güvenlik metriği).
- **Reddetme oranı:** "okunamadı" denilen kareler.
- **Süre:** p50 / p95 (uçtan uca, decode dahil).

### 9.2 Koşul kırılımı
Sonuçları şu eksenlerde ayrı raporlayın: gündüz/gece, yakın/uzak, açılı, kirli, ıslak, farlı, hareketli, eski/yeni format, 2 harfli/3 harfli.
Tek bir "%X doğruluk" sayısı sorunları gizler.

### 9.3 Eşdeğerlik testi (Python ↔ Node)
Node portunun doğruluğu için:
1. 50 kırpılmış plakayı hem Python `fast-plate-ocr` hem Node motoruyla oku.
2. Metinlerin **birebir aynı** olduğunu doğrula (ufak sayısal farklar güven değerinde olabilir, metinde olmamalı).
3. Farklıysa: ön işleme (boyutlandırma yöntemi, gri dönüşümü, dtype, kanal sırası) hatalıdır.

### 9.4 Regresyon
Her değişiklikte test seti otomatik koşsun; doğruluk düşerse birleştirme yapılmasın.

### 9.5 `fizibilite.js` yerine
`fizibilite.js`'i, test klasöründeki tüm görüntüleri okuyup CSV rapor üreten bir **benchmark betiğine** dönüştürün:
`dosya, gercek, okunan, dogru_mu, minGuven, sure_ms`.

---

## 10. Fine-tune (ince ayar)

Ne zaman? Test setinde hatalar **Türk plakasına özgü** çıkıyorsa (font, TR şeridi, format, belirli harf karışıklıkları).

**Veri**
- Gerçek: birkaç yüz–birkaç bin etiketli Türk plakası kırpımı (CSV: görüntü yolu + doğru metin; bölge alanı isteğe bağlı).
- Sentetik: Türk plaka fontu ve arka planıyla üretilmiş plakalar; **gerçekle karıştırın**, tek başına sentetik yetmez.
- Zor örnekler: en çok hata yapılan koşullardan ekstra örnek.

**Sınırlar**
- Eğitim/doğrulama/test ayrımı **araç bazında** yapılmalı (aynı aracın farklı karelerini hem eğitime hem teste koymayın).
- Etiketler elle **iki kişi tarafından** kontrol edilmeli; yanlış etiket modeli bozar.
- Fine-tune sonrası **eski test setinde gerileme** olmadığını kontrol edin.

**Araç:** fast-plate-ocr'ın kendi eğitim CLI'ı (Keras 3 backend'li). Eğitim geliştirici makinede yapılır; üretime yalnızca `.onnx` + config gider.

---

## 11. Güvenlik, gizlilik, lisans

**Çevrimdışı çalışma**
- Modelleri ve config dosyalarını kurulum paketine koyun; çalışma anında indirme yapılmasın.
- Model dosyalarının **SHA-256** özetini kaydedip başlangıçta doğrulayın.

**Sunucu**
- Sadece `127.0.0.1`/iç ağa bağlayın, kimlik doğrulaması ekleyin.
- Yüklenen görüntüye **bayt ve piksel sınırı** koyun (dev JPEG'lerle bellek tüketimini önleyin).
- Yalnızca beklenen dosya türleri (PNG/JPEG).

**Kişisel veri**
- Plaka, kişiyle ilişkilendirilebildiğinde kişisel veri sayılabilir. Görüntü saklama süresi, erişim yetkisi ve silme politikası
  belirleyin; mümkünse görüntüleri okuma sonrası saklamayın. (KVKK uyumu için hukuk/uyum sorumlusuna danışın; bu bir hukuki tavsiye değildir.)
- Test seti için toplanan gerçek plaka fotoğraflarını korumalı, sınırlı erişimli bir yerde tutun.

**Lisans**
- fast-plate-ocr deposunun ve kullanacağınız **model dosyalarının** lisansını ticari kullanım için doğrulayın.
- Dedektör kullanırsanız (ör. YOLO türevleri) onun lisansını da ayrıca kontrol edin (bazı YOLO sürümleri AGPL'dir).

---

## 12. YAPILMALI

1. **Önce ölçün.** Gerçek telefon fotoğraflarından test seti oluşturmadan modeli değiştirmeyin.
2. **Modeli kırpılmış plakayla besleyin**; kırpımın çevresine %10–15 pay bırakın (harf kenarları kesilmesin).
3. **Doğal görüntüyü verin:** gri/RGB kırpım, sadece yeniden boyutlandırma. Modeller bu şekilde eğitilmiştir.
4. **Tüm adayları okuyun.** OCR ucuz olduğu için ipucu bölgesi + `bolge.js` adaylarının hepsini deneyin, en iyiyi seçin.
5. **Karakter başına güveni kullanın**, özellikle `minGuven`.
6. **Yapı doğrulaması yapın** (il kodu 01–81, harf/rakam blokları, yasak harfler).
7. **Konuma duyarlı, sınırlı düzeltme yapın** ve her düzeltmeyi kayda geçirin/güveni düşürün.
8. **Sonucu öneri olarak sunun**; nöbetçi onaylasın.
9. **EXIF yönünü uygulayın** (telefon fotoğrafları yan gelebilir).
10. **Oturumu sıcak tutun**, kuyrukla seri çağırın, boştayken kapatın.
11. **Modelleri pakete koyun**, özet (hash) ile doğrulayın.
12. **Python ↔ Node eşdeğerlik testi** yapın.
13. **Her yanlış okumayı kaydedin** (görüntü + doğru plaka) ve test/eğitim setine ekleyin.
14. **Yeni modelleri özellik bayrağıyla açın**, eskisini yedekte tutun, karşılaştırmalı çalıştırın (gölge mod).
15. **Sürümleri sabitleyin** (`onnxruntime-node` ve model dosyası sürümü) ve değişiklik günlüğü tutun.

## 13. YAPILMAMALI

1. **Tüm sahne fotoğrafını doğrudan modele vermeyin.** Model plaka *bulmaz*, kırpılmış plaka *okur*.
2. **Tesseract'a özgü ön işlemeyi taşımayın:** Otsu/Sauvola ikilileştirme, ters çevirme, agresif büyütme, PSM planları. Bunlar bu modelde zarar verir.
3. **OCR'ın görmediği karakter eklemeyin.** (Mevcut `adayUret` içindeki rakam ekleme döngüsü sahte plakalar üretiyor; yeni hatta taşımayın.)
4. **Kurye listesini karakter üretmek veya güven artırmak için kullanmayın.**
5. **Yüksek güven = doğru demeyin.** Eşikleri kendi verinizle kalibre edin.
6. **Ortalama güvene bakıp bırakmayın**; tek zayıf karakter plakayı yanlış yapar.
7. **Sonucu otomatik kabul edip kapıyı/işlemi tetiklemeyin** (yanlış-kabul oranını ölçmeden).
8. **Tek bir doğruluk yüzdesine güvenmeyin**; koşul kırılımı olmadan pilot kararı vermeyin.
9. **Aynı aracı hem eğitim hem test setine koymayın.**
10. **Sentetik veriyle tek başına eğitip gerçek dünyada çalışır saymayın.**
11. **Model/kütüphaneyi çalışma anında internetten indirmeyin.**
12. **Hataları `try { } catch { }` ile sessizce yutmayın** (bölge bulucu eksikliğinde yaşadığınız olay). Eksik model/modül **durum ekranında görünür** olsun.
13. **İlk okumada yeterli sanıp durmayın**, ama gereksiz yere de uzatmayın: adaylar ucuz, hepsini okuyun; süre bütçesini koruyun.
14. **Yüklenen görüntüyü sınırsız kabul etmeyin** (boyut/piksel sınırı olmadan JPEG çözmek belleği tüketebilir).
15. **Gerçek plaka fotoğraflarını korumasız klasörlerde/depolarda bırakmayın.**
16. **İki satırlı, kare veya özel plakaları (motosiklet, resmi, diplomatik) "çalışıyor" varsaymayın**; ayrıca test edin ve gerekirse kapsam dışı ilan edin.

---

## 14. Doğrulanması gerekenler

Bu rehberde kesin olmayan, **sizin kontrol etmeniz gereken** noktalar:

- [ ] Kurduğunuz fast-plate-ocr sürümünün README'sindeki güncel API (v1.1.0'da çıktı `PlatePrediction`'a geçti).
- [ ] Her modelin `plate_config.yaml` dosyası: görüntü boyutu, kanal sayısı, alfabe, yuva sayısı, dolgu karakteri.
- [ ] ONNX girişinin dtype ve şekli (uint8 NHWC mi, float32 NCHW mi), çıktının softmax'lı olup olmadığı.
- [ ] Modellerin Türk plakalarındaki gerçek doğruluğu (kendi test setinizde).
- [ ] Mavi TR şeridinin dahil/hariç kırpılmasının etkisi.
- [ ] Türk plakasında hangi harflerin kullanılmadığı (`I`, `O`, `T` kısıtları dahil) ve harf sayısı ↔ rakam sayısı tablosu (resmi kaynak).
- [ ] Depo ve model dosyası lisansları (ticari kullanım), dedektör lisansı.
- [ ] `onnxruntime-node`'un hedef işletim sistemlerinde (Windows x64/arm64, Linux, macOS) sorunsuz kurulup paketlenebildiği.
- [ ] Modelin iki satırlı/özel plakalardaki davranışı.

---

## 15. Kontrol listesi

**Hazırlık**
- [ ] Test seti (≥200 gerçek foto, etiketli, kutulu)
- [ ] Model karşılaştırma tablosu dolduruldu
- [ ] Lisanslar kontrol edildi

**Geliştirme**
- [ ] `FpoMotoru` yazıldı, Python çıktısıyla eşleşiyor
- [ ] EXIF yönü uygulanıyor
- [ ] `bolge.js` `enFazla` hatası düzeltildi, adaylar okunuyor
- [ ] Türk plaka doğrulaması ve sınırlı düzeltme eklendi
- [ ] Sahte karakter ekleme kodu kaldırıldı
- [ ] Kurye listesi yalnızca öneri/ikincil ipucu olarak kullanılıyor
- [ ] Hata/eksik bileşen durum ekranında görünüyor

**Doğrulama**
- [ ] Uçtan uca doğruluk ve yanlış-kabul oranı ölçüldü (koşul kırılımıyla)
- [ ] Süre p50/p95 kabul edilebilir
- [ ] Gölge modda eski hatla karşılaştırıldı

**Yayın**
- [ ] Modeller pakette, hash doğrulanıyor
- [ ] Görüntü boyut sınırı ve saklama politikası tanımlı
- [ ] Nöbetçi onay akışı devrede, otomatik geçiş yok
- [ ] Yanlış okumaları toplayan geri bildirim döngüsü çalışıyor
