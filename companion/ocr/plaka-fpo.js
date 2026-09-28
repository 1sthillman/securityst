'use strict';
// ============================================================================
//  fast-plate-ocr motoru — plaka METNİ okuyan hafif ONNX modeli
// ----------------------------------------------------------------------------
//  Bu dosya NEDEN var?
//    Mevcut hat Tesseract (WASM) kullanıyordu. Ölçülen gerçekler:
//      * tek geçiş 35 ms – 4.5 sn (görüntü boyutuna göre)
//      * 8 yanlış bölge adayı × zorlama planı = 10 saniye bekleme
//      * Otsu/Sauvola/ters çevirme/büyütme gibi Tesseract'a ÖZGÜ ön işleme
//        gerekiyordu; her biri ayrı bakım ve ayrı hata yüzeyi demekti.
//    fast-plate-ocr modeli plaka metni için eğitilmiş küçük bir ONNX ağıdır:
//      * ölçülen 2.0 ms/plaka (bu makine, cct-xs-v2)
//      * ön işleme neredeyse yok: kırp ve yalnızca yeniden boyutlandır
//      * karakter BAŞINA olasılık verir -> en zayıf karakteri görebiliriz
//    Bu, "neden bu kadar gecikme var" sorusunun kökten çözümüdür.
//
//  Bu model bir DEDektör DEĞİLDİR (rehber §1): kırpılmış plaka bekler.
//  Plakayı karede bulmak ayrı iştir; onu `bolge.js` + kullanıcının kırpma
//  ipucu (`ipucu`) yapıyor. OCR ucuz olduğu için artık TÜM adayları
//  okuyup en iyisini seçebiliyoruz — maliyet artık aday sayısına bağlı
//  değil, bu da önceki kademe/zaman bütçesi karmaşasını gereksiz kılar.
//
//  ÖLÇÜLEN GERÇEK imzalar (rehber §14 — tahmin değil, ölçüm):
//    cct_xs_v2_global.onnx        girdi "input"  uint8 [N,  64,128,3]  RGB
//                                 çıktı "plate"  float32 [N, 10,37]  softmax
//                                 çıktı "region" float32 [N, 66]      softmax
//    cct_s_v2_global.onnx         aynı imza
//    european_mobile_vit_v2_ocr    girdi "input"  uint8 [N,  70,140,1]  GRI
//                                 çıktı "concatenate" float32 [N, 333]  softmax
//                                 (9 yuva × 37 alfabe = 333, düzleştirilmiş)
//  NOT: Rehberdeki iskelet kanal sayısını 1 varsayıyordu; cct modelleri RGB,
//  Avrupa modeli GRİ. Bu yüzden kanal sayısı config'den okunur, sabit değil.
//
//  Bütün kurulum paketinde, çalışma anında HİÇBİR ağ isteği yapılmaz
//  (rehber §11). Model dosyalarının SHA-256 özeti `.sha256` yanında durur ve
//  başlangıçta doğrulanır.
// ============================================================================

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const G = require('./gorsel.js');

const MODEL_DIZINI = path.join(__dirname, 'models');

// ---------------------------------------------------------------------------
//  OTURUM AYARLARI — ölçülmüş olarak kilitlendi
// ---------------------------------------------------------------------------
// Bu ayarlar "performans için ayarla" sezgisiyle DEĞİL, ölçümle kondu.
// Kontrolü tersine çevirmemek için gerekçeleri burada sabit tutuyoruz
// (tools/olcum-darboaz.js her çalıştırıldığında yeniden ölçülebilir):
//
//   ÖLÇÜM (bu makine, batch 1, 120 koşu, cct_s_v2_global):
//     intraOpNumThreads = varsayılan : p50 14,43 ms   <-- EN İYİ
//     intraOpNumThreads = 1         : p50 36,60 ms   (2,5 KAT YAVAŞ)
//     intraOpNumThreads = 2         : p50 35,68 ms
//     intraOpNumThreads = 4         : p50 23,27 ms
//     enableCpuMemArena = false     : batch 8'de 358 ms (varsayılan 324 ms)
//
//   ÖLÇÜM (batch boyutu):
//     batch 1 : 36,6 ms/plaka     batch 8 : 41,8 ms/plaka
//     batch 12: 42,4 ms/plaka     batch 32: 42,2 ms/plaka
//   BATCHLEME İŞE YARAMIYOR: model hesap sınırlı, çağrı tabanı değil.
//   12 adayı tek çağrıda okumak %16 DAHA YAVAŞ (508 ms vs 439 ms).
//
// SONUÇ: Varsayılanlar en iyisidir. Burada bilinçli olarak hiçbir şey
// değiştirmiyoruz; yalnızca NEDEN'ini yazıyoruz ki bir sonraki geliştirici
// "intraOpNumThreads=1 daha ucuz görünüyor" diye 2,5 KAT yavaşlatmasın.
// Asıl performans kazancı, model ÇAĞRILARININ AZALTILMASINDAN geliyor
// (bkz. hat-fpo.js → uyarılabilir erken çıkış).
const OTURUM_SECENEKLERI = {
  executionProviders: ['cpu'],
  graphOptimizationLevel: 'all',
  // intraOpNumThreads / enableCpuMemArena / executionMode BİLEREK ayarlanmadı:
  // ölçümde varsayılanların üstüne çıkmadılar. Yukarıdaki tabloya bakın.
};

// ---------------------------------------------------------------------------
//  Config okuma
// ---------------------------------------------------------------------------
// Proje bağımlılığı istemiyoruz; bu YAML dosyaları düz "anahtar: değer"
// biçiminde, çok satırlı dizi yok. Yine de alan başına regex ile çekiyoruz
// ve BULAMAZSA hata veriyoruz (rehber §13.12: sessizce yutma).

function configOku(dosya) {
  const tam = path.join(MODEL_DIZINI, dosya);
  if (!fs.existsSync(tam)) {
    const e = new Error('model config yok: ' + dosya);
    e.kod = 'FPO_CONFIG_YOK';
    throw e;
  }
  const s = fs.readFileSync(tam, 'utf8');
  const al = (ad, varsayilan) => {
    const m = s.match(new RegExp('^\\s*' + ad + '\\s*:\\s*(.+)$', 'm'));
    if (!m) return varsayilan;
    let v = m[1].trim();
    if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (/^-?\d+$/.test(v)) return parseInt(v, 10);
    if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v);
    return v;
  };

  const cfg = {
    max_plate_slots: al('max_plate_slots', 9),
    alphabet: al('alphabet', '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_'),
    pad_char: al('pad_char', '_'),
    img_height: al('img_height', 64),
    img_width: al('img_width', 128),
    keep_aspect_ratio: al('keep_aspect_ratio', false),
    interpolation: al('interpolation', 'linear'),
    image_color_mode: al('image_color_mode', 'rgb'),
  };
  // Kanal sayısı config'de AÇIKÇA yazılı değilse TAHMİN EDİLMEZ; modelin
  // ONNX giriş şeklinden alınır (aşağıda hazirla()). Ölçülen gerekçe:
  // Avrupa modelinin config'i image_color_mode içermiyor ama girdisi
  // [N,70,140,1] yani GRI. Varsayılanı RGB seçmek sessizce bozulmaydı.
  cfg.kanalAcik = /image_color_mode/.test(s);
  cfg.kanal = cfg.kanalAcik ? (cfg.image_color_mode === 'rgb' ? 3 : 1) : null;

  // Bölge listesi (v2 modellerde ülke tahmini çıktısı var). Eksikse sorun
  // değil: region çıktısı çözümlenmez, yalnızca okuma yapılır.
  const rb = s.match(/plate_regions:\s*\[([\s\S]*?)\]/);
  cfg.bolgeler = rb
    ? rb[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    : null;

  if (!cfg.max_plate_slots || !cfg.alphabet) {
    const e = new Error('model config eksik alan içeriyor: ' + dosya);
    e.kod = 'FPO_CONFIG_BOZUK';
    throw e;
  }
  return cfg;
}

// ---------------------------------------------------------------------------
//  Model seçimi (rehber §4: "hangisi daha iyi" sorusunu ÖLÇEREK cevapla)
// ---------------------------------------------------------------------------
//  ÖLÇÜM (tests/benchmark-modeller.js — 15 okuma koşulu + 3 plakasız kare):
//      cct_s_v2_global          13/15  (%86,7)  karakter %98,4  p50  45 ms
//      cct_xs_v2_global         10/15  (%66,7)  karakter %92,6  p50   8 ms
//      european_mobile_vit_v2    4/15  (%26,7)  karakter %71,7  p50  15 ms
//
//  Depo, Avrupa modeli için "belgelenmiş ~%92,5 plaka doğruluğu" diyor.
//  Ölçümümüz bunu TÜRK plakalarında doğrulamadı — en kötü model çıktı ve
//  plakasız karede plaka UYDURDU ("AA2307JA", "GB6473"). Üretimde belgelenen
//  değil ÖLÇÜLEN model kullanılır (rehber §12.1: "önce ölçün").
//
//  Varsayılan cct_s_v2_global: en yüksek tam eşleşme, en yüksek karakter
//  doğruluğu ve plakasız karelerde 0 yanlış-kabul.
const VARSAYILAN = 'cct_s_v2_global';

function modelYolu(ad) {
  return path.join(MODEL_DIZINI, ad + '.onnx');
}

/** Model + config dosyalarının varlığını ve özetini doğrular. */
function modelDogrula(ad) {
  const onnx = modelYolu(ad);
  const sonuc = { ad, onnx, var: false, config: null, hata: null, ozet: null };

  if (!fs.existsSync(onnx)) {
    sonuc.hata = 'model dosyası yok: ' + onnx;
    return sonuc;
  }

  // SHA-256: paket bozulması / eksik kopyalama sessizce kalmasın.
  const ozetDosya = onnx + '.sha256';
  if (fs.existsSync(ozetDosya)) {
    const beklenen = fs.readFileSync(ozetDosya, 'utf8').trim().split(/\s+/)[0].toUpperCase();
    const gercek = crypto.createHash('sha256').update(fs.readFileSync(onnx)).digest('hex').toUpperCase();
    sonuc.ozet = { beklenen, gercek, uyusuyor: beklenen === gercek };
    if (beklenen !== gercek) {
      sonuc.hata = 'model özeti uyuşmuyor (beklenen ' + beklenen.slice(0, 12) + '…, bulunan ' +
        gercek.slice(0, 12) + '…) — kurulum paketi bozuk veya model değiştirilmiş';
      return sonuc;
    }
  } else {
    sonuc.ozet = { beklenen: null, gercek: null, uyusuyor: null };
  }

  for (const c of [ad + '_plate_config.yaml', ad + '_ocr_config.yaml', ad + '_config.yaml']) {
    if (fs.existsSync(path.join(MODEL_DIZINI, c))) {
      try {
        sonuc.config = configOku(c);
        sonuc.configDosya = c;
        break;
      } catch (e) {
        sonuc.hata = e.message;
        return sonuc;
      }
    }
  }
  if (!sonuc.config) {
    sonuc.hata = 'model config dosyası yok (' + ad + '_plate_config.yaml)';
    return sonuc;
  }

  sonuc.var = true;
  return sonuc;
}

// ---------------------------------------------------------------------------
//  Motor
// ---------------------------------------------------------------------------

class FpoMotoru {
  /**
   * @param {{model?: string, ort?: object}} secenek
   *   model: model adı (varsayılan cct_s_v2_global — bkz. ölçüm yukarıda)
   *   ort:  onnxruntime modülü (testte sahte motor takılabilsin diye)
   */
  constructor(secenek = {}) {
    this.modelAd = secenek.model || process.env.CKY_FPO_MODEL || VARSAYILAN;
    this._ort = secenek.ort || null;
    this.oturum = null;
    this.cfg = null;
    this._kilit = null;          // run() serileştirme kilidi
    this._tampon = null;         // yeniden kullanılan girdi tamponu
    this.durum = {
      aktif: false,
      hazir: false,
      model: this.modelAd,
      sebep: null,          // neden yüklenemedi
      config: null,         // okunan config özeti
      ozet: null,           // sha256 doğrulaması
      istekSayisi: 0,
      hataSayisi: 0,
      sonHata: null,
      sureMs: null,         // son okumanın süresi
      bolgeTahmini: null,   // modelin ülke tahmini (v2 modellerde)
      kanalKaynagi: null,    // kanal sayısı nereden geldi
      uyumsuzluk: null,      // config ile model şekli çelişti mi
    };
    // Oturum açılırken model imzalarını okuyup beklenen şekli çıkarır.
    this.imza = null;
  }

  /** onnxruntime modülünü tembel yükler. */
  _ortGetir() {
    if (this._ort) return this._ort;
    try {
      this._ort = require('onnxruntime-node');
      return this._ort;
    } catch (e) {
      const h = new Error('onnxruntime-node kurulu değil');
      h.kod = 'FPO_ORT_YOK';
      throw h;
    }
  }

  /** Modeli yükler (tembel, bir kez). Hata olursa sebebi `durum.sebep`e yazar. */
  async hazirla() {
    if (this.oturum) return true;
    if (this.durum.sebep) return false;      // başarısızsa tekrar tekrar deneme

    const d = modelDogrula(this.modelAd);
    this.durum.ozet = d.ozet;
    if (!d.var) {
      this.durum.sebep = d.hata;
      this.durum.aktif = false;
      return false;
    }
    this.cfg = d.config;
    this._configDosya = d.configDosya;
    this.durum.config = {
      dosya: this._configDosya,
      yuva: this.cfg.max_plate_slots,
      boyut: this.cfg.img_width + 'x' + this.cfg.img_height,
      kanal: this.cfg.kanal,
      alfabe: this.cfg.alphabet.length,
      bolgeTahmini: !!this.cfg.bolgeler,
    };

    try {
      const ort = this._ortGetir();
      this.oturum = await ort.InferenceSession.create(d.onnx, OTURUM_SECENEKLERI);
    } catch (e) {
      this.durum.sebep = 'model yüklenemedi: ' + e.message;
      this.durum.aktif = false;
      return false;
    }

    // İmzayı doğrula ve sakla (rehber §14). Model beklediğimizden farklıysa
    // sessizce yanlış beslemek yerine açıkça hata ver.
    const girisAd = this.oturum.inputNames[0];
    const meta = (this.oturum.inputMetadata || [])[0];
    if (meta) {
      const tip = meta.type;
      const sekil = meta.shape || [];
      if (tip && tip !== 'uint8') {
        this.durum.sebep = 'model girdi tipi beklenenden farklı: ' + tip + ' (uint8 bekleniyordu)';
        this.oturum = null;
        return false;
      }
      const olcum = [sekil[1], sekil[2], sekil[3]];
      const tanimiyor = sekil.length < 4 || olcum.some((v) => typeof v !== 'number');
      if (!tanimiyor) {
        // Config kanal sayısını söylemiyorsa MODEL İMZASI karar verir.
        if (!this.cfg.kanalAcik) {
          this.cfg.kanal = olcum[2];
          this.cfg.image_color_mode = olcum[2] === 3 ? 'rgb' : 'grayscale';
          this.durum.kanalKaynagi = 'model imzasi (config belirtmiyordu)';
        }
        // Boyut config ile çelişiyorsa da model kazanır: ONNX giriş şekli
        // çıktının okunması için bağlayıcıdır. Çelişkiyi kaydedip devam et,
        // ama gizleme — durum ekranında görünür.
        const beklenen = [this.cfg.img_height, this.cfg.img_width, this.cfg.kanal];
        const fark = [];
        for (let i = 0; i < 3; i++) if (beklenen[i] !== olcum[i]) fark.push(i + ':' + beklenen[i] + '->' + olcum[i]);
        if (fark.length) {
          this.cfg.img_height = olcum[0];
          this.cfg.img_width = olcum[1];
          this.durum.uyumsuzluk = 'model giriş şekli config ile farklı, model esas alındı (' + fark.join(', ') + ')';
        }
        this.durum.config = {
          dosya: this._configDosya,
          yuva: this.cfg.max_plate_slots,
          boyut: this.cfg.img_width + 'x' + this.cfg.img_height,
          kanal: this.cfg.kanal,
          alfabe: this.cfg.alphabet.length,
          bolgeTahmini: !!this.cfg.bolgeler,
        };
      }
      this.imza = { giris: girisAd, tip, sekil, cikti: this.oturum.outputNames.slice() };
    } else {
      this.imza = { giris: girisAd, tip: null, sekil: null, cikti: this.oturum.outputNames.slice() };
    }

    this.durum.aktif = true;
    this.durum.hazir = true;
    this.durum.sebep = null;
    return true;
  }

  /**
   * Gri kırpımı okur.
   *
   * ÖN İŞLEME KURALI (rehber §12.3, §13.2): model doğal görüntüyle eğitilmiş.
   * İkilileştirme, ters çevirme, agresif büyütme, bulanıklaştırma YAPILMAZ.
   * Yalnızca yeniden boyutlandırma yapılır.
   *
   * @param {Uint8ClampedArray} gri tek kanallı kırpım
   * @param {number} g @param {number} y
   * @returns {Promise<{metin,guvenler,minGuven,ortGuven,bolge,gecerliSlot}>}
   */
  /**
   * ONNX oturumu YENİDEN-GİRİLEBİLİR DEĞİLDİR: aynı oturuma eşzamanlı
   * iki run() çağrısı sonuçları birbirine karıştırır (Tesseract WASM ile
   * aynı sorun). Üstelik girdi tamponunu yeniden kullandığımız için iki
   * çağrının aynı belleğe yazması sonucu da bozardı.
   *
   * Servis katmanında (PlakaMotoru) zaten bir kuyruk var; ama motor KENDİ
   * BAŞINA da korunmalıdır — başka bir yol (HTTP, test, CLI) motoru
   * doğrudan çağırırsa sessizce bozulma olmasın.
   */
  async oku(gri, g, y) {
    const onceki = this._kilit || Promise.resolve();
    let ac;
    this._kilit = new Promise((coz) => { ac = coz; });
    await onceki;
    try {
      return await this._okuKilitli(gri, g, y);
    } finally {
      ac();
    }
  }

  async _okuKilitli(gri, g, y) {
    const t0 = Date.now();
    const hazir = await this.hazirla();
    if (!hazir) {
      const e = new Error(this.durum.sebep || 'fast-plate-ocr yüklenemedi');
      e.kod = 'FPO_HAZIR_DEGIL';
      throw e;
    }
    const cfg = this.cfg;
    if (!cfg.kanal) {
      // İmza okunamadıysa kanal sayısını bilmiyoruz demektir. Tahmin etmeyip
      // duruyoruz: yanlış kanal sayısı sessizce tamamen yanlış okuma üretir.
      throw Object.assign(new Error('model giriş kanal sayısı bilinmiyor'), { kod: 'FPO_KANAL_YOK' });
    }
    this.durum.istekSayisi++;

    // --- 1) Yeniden boyutlandır (tek işlem, doğal piksel değerleri korunur) ---
    // Girdi tamponu yeniden kullanılır. run() çağrıları _kilit ile
    // serileştirildiği için bu güvenli.
    const H = cfg.img_height, W = cfg.img_width, K = cfg.kanal;
    const gereken = W * H * K;
    if (!this._tampon || this._tampon.length !== gereken) {
      this._tampon = new Uint8Array(gereken);
    }
    const veri = this._tampon;
    const kucuk = G.olcekle(gri, g, y, W, H);
    if (K === 3) {
      // Gri -> RGB: model 3 kanal bekliyor, kırmızı=yeşil=mavi veriyoruz.
      // (Gri tonlama zaten kanal ortalaması; ayrıca renk bilgisi yok.)
      for (let i = 0, j = 0; i < W * H; i++) {
        const v = kucuk[i];
        veri[j++] = v; veri[j++] = v; veri[j++] = v;
      }
    } else {
      veri.set(kucuk.subarray(0, Math.min(W * H, kucuk.length)));
    }

    // --- 2) Çalıştır ---
    const ort = this._ortGetir();
    const t = new ort.Tensor('uint8', veri, [1, H, W, K]);
    const cikti = await this.oturum.run({ [this.imza.giris]: t });

    // --- 3) Çöz ---
    const sonuc = this.coz(cikti);
    sonuc.sureMs = Date.now() - t0;
    this.durum.sureMs = sonuc.sureMs;
    this.durum.bolgeTahmini = sonuc.bolge;
    return sonuc;
  }

  /**
   * Model çıktısını metne çevirir ve KARAKTER BAŞINA güven hesaplar.
   *
   * İki çıktı biçimi vardır ve ikisi de aynı mantıkla çözülür:
   *   [N, yuva, alfabe]  -> cct modelleri  (plate)
   *   [N, yuva*alfabe]   -> Avrupa modeli  (concatenate, düzleştirilmiş)
   */
  coz(cikti) {
    const cfg = this.cfg;
    const V = cfg.alphabet.length;
    const N = cfg.max_plate_slots;

    // Hangi çıktıyı okuyacağımızı seç. Bu karar model imzasından ve
    // config'den türetilebilir; HER ÇAĞRIDA Array.from(c.dims) yapmak
    // gereksiz bir dizi ayırmasıydı (ölçüldü: 0,0002 ms — küçük ama
    // bedava düzeltilir).
    let veri = null;
    for (const ad of this.imza.cikti) {
      const c = cikti[ad];
      if (!c || !c.data) continue;
      const d = c.dims;
      const d1 = d.length > 1 ? d[1] : -1;
      const d2 = d.length > 2 ? d[2] : -1;
      if (d.length === 3 && d1 === N && d2 === V) { veri = c.data; break; }
      if (d.length === 2 && d1 === N * V) { veri = c.data; break; }
    }
    if (!veri) {
      // Bilinmeyen biçim: sessizce boş dönmeyelim, motor bozuk sayılsın.
      this.durum.hataSayisi++;
      this.durum.sonHata = 'model çıktı biçimi tanınmadı';
      throw Object.assign(new Error('model çıktı biçimi tanınmadı'), { kod: 'FPO_CIKTI_BILINMIYOR' });
    }

    let metin = '';
    const guvenler = [];        // dolgu hariç, karakter başına en yüksek olasılık
    const ikinciler = [];       // ikinci en yüksek olasılık
    // ÖNEMLİ: ikinci en yüksek olasılığın DEĞERİ yetmez; hangi KARAKTERE
    // ait olduğu da bilinmelidir. Daha önce yalnızca değer döndürülüyordu
    // ve konum düzeltmesi karakteri TAHMİN ediyordu — bu, rehberin açıkça
    // yasakladığı "uydurma" idi (bkz. hat-fpo.js konumaGoreDuzelt).
    const ikinciIndeksler = []; // ikinci en yüksek karakterin alfabe indeksi
    let dolgu = 0;

    for (let s = 0; s < N; s++) {
      const taban = s * V;
      let en = -1, enD = -1, ikinciD = -1, ikinciI = -1;
      for (let k = 0; k < V; k++) {
        const d = veri[taban + k];
        if (d > enD) { ikinciD = enD; ikinciI = en; enD = d; en = k; }
        else if (d > ikinciD) { ikinciD = d; ikinciI = k; }
      }
      const c = cfg.alphabet[en];
      if (c === cfg.pad_char) { dolgu++; continue; }
      metin += c;
      guvenler.push(enD);
      ikinciler.push(ikinciD);
      ikinciIndeksler.push(ikinciI);
    }

    // Ülke tahmini (v2 modellerde "region" çıktısı).
    let bolge = null;
    for (const ad of this.imza.cikti) {
      if (ad !== 'region') continue;
      const c = cikti[ad];
      if (!c || !c.data || !cfg.bolgeler) break;
      let en = 0, enD = -1;
      const veriB = c.data, uz = veriB.length;
      for (let k = 0; k < uz; k++) { const d = veriB[k]; if (d > enD) { enD = d; en = k; } }
      bolge = { ad: cfg.bolgeler[en] || 'Bilinmiyor', guven: Math.round(enD * 100) / 100 };
      break;
    }

    // Math.min(...guvenler) yayılımı: hem dizi kopyalar hem de uzun
    // dizilerde yığın taşması riski taşır. Tek döngü hem daha hızlı hem
    // daha güvenli. Ortalama de aynı döngüde toplanır (iki geçiş yerine bir).
    let minG = Infinity, toplam = 0;
    for (let i = 0; i < guvenler.length; i++) {
      const v = guvenler[i];
      if (v < minG) minG = v;
      toplam += v;
    }
    const minGuven = guvenler.length ? minG : 0;
    const ortGuven = guvenler.length ? toplam / guvenler.length : 0;

    return {
      metin, guvenler, ikinciler, ikinciIndeksler,
      alfabe: cfg.alphabet,
      minGuven: Math.round(minGuven * 1000) / 1000,
      ortGuven: Math.round(ortGuven * 1000) / 1000,
      bolge,
      dolgu,
      hamGuven: guvenler,     // ham okuma için saklanır
    };
  }

  /** Modelin tahmin ettiği ülke Türkiye mi? (Türk plaka önceliği için sinyal) */
  turkiyeMi(bolgeTahmini) {
    return !!(bolgeTahmini && /^turkey$/i.test(bolgeTahmini.ad || ''));
  }

  kapat() {
    // onnxruntime oturumu açıkça serbest bırakılabilir; GC ile toplanır.
    this.oturum = null;
    this.durum.hazir = false;
  }
}

module.exports = {
  FpoMotoru,
  configOku,
  modelDogrula,
  modelYolu,
  VARSAYILAN,
  // Testler saf yardımcıları doğrudan sınar
  cozDene: null,
};
