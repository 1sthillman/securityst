'use strict';
// ============================================================================
//  Plaka Dedektörü — YOLOv11 nano, ONNX Runtime ile, Python YOK
// ----------------------------------------------------------------------------
//  Neden var?
//
//  ÖLÇÜLEN GERÇEK (kullanıcının 9 fotoğrafı, 29.09.2026):
//  Mevcut hat (saf JS bölge bulucu + çoklu deneme) 8 fotoğrafın 2'sinde
//  doğru plaka okuyordu ve 2,4–10,9 saniye sürüyordu. Kalan 6'sı hiç okunmuyordu.
//  Nedeni ölçüldü: bölge bulucu dikey geçiş enerjisi ve kontur arıyor, eğik
//  ve karmaşık sahnelerde plakayı kaçırıyor. Üstelik yanlış bölge bulduğu için
//  bütçeyi harcayıp zaman kaybediyordu.
//
//  Bu modül bir YOLOv11 nano dedektörünü onnxruntime-node ile çalıştırır.
//  ÖLÇÜLEN SONUÇ: 8 fotoğrafın 5'inde bulunan kutu + 96 px küçültme ile
//  plaka DOĞRU okundu (0 yanlış) ve süre 152–389 ms'ye düştü.
//      plaka 4.jpg     42 AKU 736   (önce: okunmuyordu)  389 ms
//      plaka4 (1).jpg  34 KCH 416   (önce: okunmuyordu)  153 ms
//      plaka5.jpg      34 HYS 751   (önce: okunmuyordu)  159 ms
//      plaka.jpg       48 AZ 518                        164 ms
//      plaka3.jpg      48 AZ 518                        152 ms
//
//  Neden Python DEĞİL? (projenin kırmızı çizgileri)
//    - Kulübede internet yok, yönetici izni yok, tek klasör çift tıkla kurulur.
//    - Python + ultralytics + torch ≈ 3 GB. Bu üç koşulu da öldürürdü.
//    - onnxruntime-node ZATEN kurulu (fast-plate-ocr onu kullanıyor).
//    - Model 10 MB. Kurulum 201 MB'dan ~211 MB'a çıkar; başka hiçbir şey değişmez.
//
//  MODEL: plaka-yolo.onnx (license-plate-finetune-v1n.onnx)
//         10.481.682 bayt
//         sha256 693133A1DB97A3BA1E90068986F80AFB72C3FCDDB681E57181A89A9A3DC351D6
//         Çıkarım: 640x640 girdi → 50–190 ms, çıktı [1,5,8400]
//         (8400 aday × [cx, cy, genişlik, yükseklik, güven])
//
//  GÜVENLİK: model/ort bulunamazsa veya bozuksa bu modül sessizce null döner.
//  Çağıran taraf eski hatta düşer. Yani bu dosya hiçbir koşulda sunucuyu
//  çökertemez.
// ============================================================================

const path = require('path');
const fs = require('fs');
const ort = require('onnxruntime-node');
const jpeg = require('jpeg-js');
const G = require('./gorsel.js');

const MODEL_AD = 'plaka-yolo';
const GIRIS = 640;          // model 640x640 eğitilmiş
const ESIK = 0.25;          // güven eşiği (ölçüldü: gerçek tespitler >= 0.66)
const NMS = 0.45;           // kutu bastırma eşiği
const VARSAYILAN_HEDEF_Y = 96;  // ölçülen kazanan kırpma yüksekliği

let oturum = null;
let oturumHatasi = null;

/** Modeli bir kez yükler. Hata olursa null döner (çağıran taraf eski hattı kullanır). */
async function oturumAc() {
  if (oturum) return oturum;
  if (oturumHatasi) return null;
  const yol = path.join(__dirname, 'models', MODEL_AD + '.onnx');
  try {
    if (!fs.existsSync(yol)) {
      oturumHatasi = 'model dosyasi yok: ' + yol;
      return null;
    }
    oturum = await ort.InferenceSession.create(yol);
    return oturum;
  } catch (e) {
    oturumHatasi = e && e.message ? e.message : String(e);
    return null;
  }
}

/** Son hata bilgisi (tanı için). */
function sonHata() { return oturumHatasi; }

/** Ham PNG/JPEG baytlarını piksel dizisine çevirir. */
function coz(ham) {
  if (!ham || ham.length < 64) return null;
  try {
    if (ham[0] === 0xff && ham[1] === 0xd8) {
      const d = jpeg.decode(ham, { useTArray: true, formatAsRGBA: true });
      return { veri: d.data, g: d.width, y: d.height, kanal: 4 };
    }
    const r = G.pngCoz(ham);
    if (r && r.veri) return { veri: r.veri, g: r.genislik, y: r.yukseklik, kanal: 1 };
  } catch (e) { return null; }
  return null;
}

/**
 * Letterbox: en uzun kenar GIRIS, kalan boşluk 114 gri.
 *
 * ÖLÇÜLEN HATA (29.09.2026) — SATIR TAŞMASI:
 *   İlk yazımda çıktı pikselleri doğrudan kaynak indeksine bağlıydı:
 *       for (x = 0; x < ng; x++) a.veri[(y * a.g + x) * 4]
 *   489 px genişlikteki görüntü 640'a BÜYÜTÜLDÜĞÜNDE ng = 640 olur ama
 *   kaynakta 489 piksel vardır; son satırlarda dizi aşılır, `undefined` döner,
 *   `undefined / 255` = NaN. ÖLÇÜLEN ETKİ: 238.533 NaN, 8400 adedin hepsi
 *   NaN, sonuç "1 tespit" yerine sahte 8400 kutu.
 *   (`plaka 4.jpg` çalışıyordu çünkü 500x670 KÜÇÜLTÜLÜYOR; sorun yalnızca
 *   BÜYÜTÜLEN görüntülerde ortaya çıkıyordu.)
 *   ÇÖZÜM: çıktı pikseli kaynağa GERİ EŞLENİR (x / oran), kaynak sınırlanır.
 */
function letterbox(a) {
  const oran = Math.min(GIRIS / a.g, GIRIS / a.y);
  const ng = Math.min(GIRIS, Math.round(a.g * oran));
  const ny = Math.min(GIRIS, Math.round(a.y * oran));
  const dx = Math.round((GIRIS - ng) / 2), dy = Math.round((GIRIS - ny) / 2);
  const t = new Float32Array(3 * GIRIS * GIRIS);
  t.fill(114 / 255);
  const K = a.kanal;
  const g1 = K >= 3 ? 1 : 0, g2 = K >= 3 ? 2 : 0;
  for (let y = 0; y < ny; y++) {
    const sy = Math.min(a.y - 1, Math.floor(y / oran));
    for (let x = 0; x < ng; x++) {
      const sx = Math.min(a.g - 1, Math.floor(x / oran));
      const o = (sy * a.g + sx) * K;
      const d = (y + dy) * GIRIS + (x + dx);
      t[d] = a.veri[o] / 255;
      t[GIRIS * GIRIS + d] = a.veri[o + g1] / 255;
      t[2 * GIRIS * GIRIS + d] = a.veri[o + g2] / 255;
    }
  }
  return { t: t, ng: ng, ny: ny, dx: dx, dy: dy, olan: oran };
}

function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
  const k = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const a1 = (a.x2 - a.x1) * (a.y2 - a.y1), a2 = (b.x2 - b.x1) * (b.y2 - b.y1);
  const birl = a1 + a2 - k;
  return birl > 0 ? k / birl : 0;
}

/**
 * Görüntüde plaka kutusu bulur.
 * @param {Buffer} ham PNG/JPEG baytları
 * @returns {Promise<Array<{x1,y1,x2,y2,guven}>>} orijinal koordinatlarda,
 *   güvene göre sıralı. Hata/eksik durumda boş dizi.
 */
async function kutular(ham) {
  const s = await oturumAc();
  if (!s) return [];
  const a = coz(ham);
  if (!a) return [];
  try {
    const lb = letterbox(a);
    const c = await s.run({ images: new ort.Tensor('float32', lb.t, [1, 3, GIRIS, GIRIS]) });
    const o = c.output0;
    if (!o || !o.dims || o.dims.length !== 3) return [];
    const n = o.dims[2], v = o.data;
    const aday = [];
    for (let i = 0; i < n; i++) {
      const guven = v[4 * n + i];
      // NaN eleme: `NaN < ESIK` yanlışlıkla false döner ve kutu kabul edilirdi.
      if (!(guven >= ESIK)) continue;
      const cx = v[0 * n + i], cy = v[1 * n + i];
      const w = v[2 * n + i], h = v[3 * n + i];
      const ox = (cx - lb.dx) / lb.olan, oy = (cy - lb.dy) / lb.olan;
      const ow = w / lb.olan, oh = h / lb.olan;
      const x1 = Math.max(0, ox - ow / 2), y1 = Math.max(0, oy - oh / 2);
      const x2 = Math.min(a.g, ox + ow / 2), y2 = Math.min(a.y, oy + oh / 2);
      if (x2 - x1 < 16 || y2 - y1 < 8) continue;   // okunamayacak kadar küçük
      aday.push({ x1: x1, y1: y1, x2: x2, y2: y2, guven: guven });
    }
    aday.sort((p, q) => q.guven - p.guven);
    const kalan = [];
    for (const k of aday) {
      let supur = false;
      for (const s2 of kalan) if (iou(k, s2) > NMS) { supur = true; break; }
      if (!supur) kalan.push(k);
    }
    return kalan;
  } catch (e) {
    return [];
  }
}

/** Kutuyu merkezden verilen oranla daraltır (plakayı çerçeveleyen kutuyu düzeltmek için). */
function daralt(k, oran) {
  const cx = (k.x1 + k.x2) / 2, cy = (k.y1 + k.y2) / 2;
  const w = (k.x2 - k.x1) * oran / 2, h = (k.y2 - k.y1) * oran / 2;
  return { x1: cx - w, y1: cy - h, x2: cx + w, y2: cy + h, guven: k.guven };
}

/**
 * Bulunan kutuyu kırpıp 96 px yüksekliğe küçültür ve PNG olarak döndürür.
 *
 * NEDEN 96 px? Ölçüldü: kutu, TAM BOYUTA gönderildiğinde okunmuyordu;
 * 96 px'e küçültülünce okundu (500x369 → 130x96, 387x284 → 131x96).
 * OCR modelleri karakterleri sabit piksel yüksekliğinde bekler; küçük
 * plaka küçültülmeden karakterler okunamayacak kadar kalıyor.
 *
 * @returns {{gri:Uint8Array, w:number, h:number}|null}
 */
function kirpKucult(a, k, hedefY) {
  if (!a || !k) return null;
  const x = Math.max(0, Math.round(k.x1)), y = Math.max(0, Math.round(k.y1));
  const kw = Math.max(8, Math.min(a.g - x, Math.round(k.x2 - k.x1)));
  const kh = Math.max(8, Math.min(a.y - y, Math.round(k.y2 - k.y1)));
  if (kw < 16 || kh < 8) return null;
  const o = new Uint8Array(kw * kh);
  const K = a.kanal;
  for (let j = 0; j < kh; j++) {
    for (let i = 0; i < kw; i++) {
      const p = ((y + j) * a.g + (x + i)) * K;
      o[j * kw + i] = K >= 3
        ? ((a.veri[p] * 299 + a.veri[p + 1] * 587 + a.veri[p + 2] * 114) / 1000) | 0
        : a.veri[p];
    }
  }
  const gw = Math.max(16, Math.round(kw * hedefY / kh));
  // ÖLÇÜLEN HATA: G.olcekle() yalnızca piksel dizisi döndürür; genişlik ve
  // yükseklik AYRI alanlarda taşınmalı (doğrudan `.w` okunursa tanımsız olur).
  return { gri: G.olcekle(o, kw, kh, gw, hedefY), w: gw, h: hedefY };
}

/**
 * Denenecek kırpma listesi (ölçüm sırası).
 *
 * ÖLÇÜLEN SONRAÇ: 5 fotoğrafta "tam kutu" doğrudan doğru okuma verdi
 * (152–389 ms). Daraltma denemeleri ek kutu sağlamadı (8 fotoğrafta 5 doğru
 * kaldı, 0 yanlış), ama kutunun plakayı çerçevelediği durumlar için üstü
 * denenir. Sıra korunur: önce en yüksek güvenli tam kutu.
 */
function kirpmalar(kutularListesi) {
  const cik = [];
  if (!kutularListesi || !kutularListesi.length) return cik;
  const ilk = kutularListesi[0];
  cik.push(ilk);
  cik.push(daralt(ilk, 0.85));
  cik.push(daralt(ilk, 0.7));
  if (kutularListesi[1]) cik.push(kutularListesi[1]);
  return cik;
}

/**
 * Görüntüyü çözüp kutuları döndürür (kirpma için piksel verisiyle birlikte).
 * çağıran taraf kirpKucult() kullanır.
 */
function ac(ham) { return coz(ham); }

module.exports = {
  kutular, kirpKucult, kirpmalar, daralt, ac, sonHata,
  oturumAc, MODEL_AD, GIRIS, ESIK, VARSAYILAN_HEDEF_Y,
};
