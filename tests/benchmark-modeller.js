'use strict';
// ============================================================================
//  MODEL KARŞILAŞTIRMA BENCHMARK'I (fast-plate-ocr rehberi §4 ve §9)
// ----------------------------------------------------------------------------
//  Bu betik NEDEN var?
//    fast-plate-ocr deposu üç hazır model sunuyor ve Avrupa modeli için
//    "belgelenmiş ~%92,5 plaka doğruluğu" diyor. Rehber doğru şunu söylüyor:
//    bu sayıya GÜVENME, "kendi test setinizde ölçün". Biz de ölçtük ve
//    belgelenen sıralama TERSİNDE çıktı (bkz. aşağıdaki özet):
//
//      cct_xs_v2_global          12/15  (%80,0)   p50   6 ms
//      cct_s_v2_global           15/15  (%100,0)  p50  31 ms
//      european_mobile_vit_v2     5/15  (%33,3)   p50  11 ms   <-- en kötü
//
//    Bu yüzden üretimde cct_s_v2_global kullanılacak (bkz. VARSAYILAN).
//
//  Kırpmalar GERÇEK akıştan gelir: sahne karesi -> ipucu bandı + bolge.js
//  adayları -> %12 paylı kırpım -> model. Model Tesseract'a özgü ön işleme
//  (ikilileştirme/ters çevirme/agresif büyütme) GÖRMEZ (rehber §13.2);
//  yalnızca doğal piksel değerlerini yeniden boyutlandırır.
//
//  Çalıştırma:  node tests/benchmark-modeller.js
// ============================================================================

const { kareUret } = require('./ara/sahne-uret.js');
const G = require('../companion/ocr/gorsel.js');
const B = require('../companion/ocr/bolge.js');
const { FpoMotoru } = require('../companion/ocr/plaka-fpo.js');

const FIKSTUR = __dirname + '/fixtures/plaka-temiz.png';
const GERCEK = '34ABC123';
const ZEMIN = { zemin: 120, koyuZemin: 20 };

const norm = (x) => String(x || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// --- Koşul listesi (rehber §9.2: tek bir "%X doğruluk" sayısı gizler) ---
const KOSULLAR = [
  { ad: 'temiz, tipik mesafe', sec: {} },
  { ad: 'araç yakında', sec: { olcek: 0.45 } },
  { ad: 'araç uzakta', sec: { olcek: 0.18 } },
  { ad: 'gölgede', sec: { karartma: 0.35, zemin: 40, koyuZemin: 12 } },
  { ad: 'gece', sec: { karartma: 0.18, zemin: 30, koyuZemin: 8, gurultu: 4 } },
  { ad: 'yüksek ISO gürültüsü', sec: { gurultu: 22 } },
  { ad: 'eğik -9 derece', sec: { egim: -9 } },
  { ad: 'sol üst kadraj', sec: { plakaX: 30, plakaY: 90 } },
  { ad: 'sağ alt kadraj', sec: { plakaX: 1050, plakaY: 560 } },
  { ad: 'HDR zemin', sec: { zemin: 250, koyuZemin: 8 } },
  { ad: 'küçük+karartma+gürültü', sec: { ...ZEMIN, bogucu: 3, olcek: 0.12, karartma: 0.30, gurultu: 18 } },
  { ad: 'kalabalık otopark', sec: { ...ZEMIN, bogucu: 7, olcek: 0.12, karartma: 0.30, gurultu: 18 } },
  { ad: 'kalabalık + karanlık', sec: { ...ZEMIN, bogucu: 7, olcek: 0.18, karartma: 0.45, gurultu: 30 } },
  { ad: 'gürültülü uzak araç', sec: { ...ZEMIN, bogucu: 5, olcek: 0.16, karartma: 0.30, gurultu: 30 } },
  { ad: 'çok gürültülü karanlık', sec: { ...ZEMIN, karartma: 0.45, gurultu: 30 } },
  // --- YANLIŞ-KABUL ÖLÇÜMÜ (rehber §9.1: en önemli güvenlik metriği) ---
  // plakasiz:true -> üretici kareye plika KOYMAZ (varsayılan olarak koyar).
  { ad: 'PLAKASIZ boş duvar', sec: { plakasiz: true, zemin: 200, koyuZemin: 190 }, plakasiz: true },
  { ad: 'PLAKASIZ gürültülü', sec: { plakasiz: true, zemin: 120, koyuZemin: 20, gurultu: 40 }, plakasiz: true },
  { ad: 'PLAKASIZ karanlık gürültü', sec: { plakasiz: true, karartma: 0.5, zemin: 60, koyuZemin: 20, gurultu: 35 }, plakasiz: true },
];

const MODELLER = ['cct_xs_v2_global', 'cct_s_v2_global', 'european_mobile_vit_v2_ocr'];

// --- Yardımcılar (gerçek akışla aynı) ---
function adayBolgeler(k) {
  const c = G.pngCoz(k.gorsel);
  const gri = G.griTaraf(c.veri, c.genislik, c.yukseklik);
  const adaylar = [];
  if (!k.plakasiz) {
    // Kullanıcının kırpma ipucu bandı
    const p = k.plaka, S = k.sahneBoyut;
    const y0 = Math.max(0, Math.round((p.y / S.y) * c.yukseklik) - 8);
    const y1 = Math.min(c.yukseklik, y0 + Math.round(((p.y2 + 16) / S.y) * c.yukseklik) + 8);
    const bant = { x: 0, y: y0, g: c.genislik, y2: Math.max(8, y1 - y0) };
    if (bant.y2 >= 8) {
      const kirp = new Uint8ClampedArray(bant.g * bant.y2);
      for (let j = 0; j < bant.y2; j++) {
        kirp.set(gri.subarray((bant.y + j) * c.genislik, (bant.y + j) * c.genislik + bant.g), j * bant.g);
      }
      try {
        B.bul(kirp, bant.g, bant.y2, 3).forEach((b) => adaylar.push({ ...b, x: b.x + bant.x, y: b.y + bant.y, tur: 'ipucu' }));
      } catch { /* tek aday hatası ölçümü bozmasın */ }
    }
  }
  try {
    B.bul(gri, c.genislik, c.yukseklik, 5).forEach((b) => adaylar.push({ ...b, tur: 'bolge' }));
  } catch { /* yoksay */ }
  return { gri, g: c.genislik, y: c.yukseklik, adaylar };
}

/** Rehber §12.2: kırpımın çevresine %10-15 pay bırak (harf kenarları kesilmesin). */
function payliKirp(gri, g, y, b) {
  const px = Math.max(6, Math.round(b.g * 0.12));
  const py = Math.max(4, Math.round(b.y2 * 0.12));
  const x0 = Math.max(0, b.x - px), y0 = Math.max(0, b.y - py);
  const x1 = Math.min(g, b.x + b.g + px), y1 = Math.min(y, b.y + b.y2 + py);
  const ng = x1 - x0, ny = y1 - y0;
  if (ng < 16 || ny < 8) return null;
  const veri = new Uint8ClampedArray(ng * ny);
  for (let j = 0; j < ny; j++) veri.set(gri.subarray((y0 + j) * g + x0, (y0 + j) * g + x1), j * ng);
  return { veri, genislik: ng, yukseklik: ny };
}

const yuzde = (x) => (x * 100).toFixed(1) + '%';
function persentil(dizi, q) {
  if (!dizi.length) return 0;
  const s = dizi.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

(async () => {
  const motorler = {};
  for (const ad of MODELLER) {
    const m = new FpoMotoru({ model: ad });
    if (!(await m.hazirla())) { console.log('ATLANDI ' + ad + ': ' + m.durum.sebep); continue; }
    motorler[ad] = m;
  }
  const adlar = Object.keys(motorler);
  if (!adlar.length) {
    console.error('HİÇBİR MODEL YÜKLENEMEDİ. Model dosyalarını indirin: tools\\model-indir.ps1');
    process.exit(1);
  }

  const bos = () => ({
    tam: 0, karakterHata: 0, karakterToplam: 0, sureler: [],
    dogruGuven: [], yanlisGuven: [], yanlisKabul: 0, yanlisKabulOlan: [], bosOkuma: 0,
  });
  const sonuc = {};
  for (const ad of adlar) sonuc[ad] = bos();

  const okunacak = KOSULLAR.filter((k) => !k.plakasiz).length;
  const plakasizSayisi = KOSULLAR.filter((k) => k.plakasiz).length;

  console.log('\n=== fast-plate-ocr MODEL KARŞILAŞTIRMASI — ' + KOSULLAR.length + ' koşul ===\n');
  console.log('  (karşılaştırma modelden bağımsızdır: her model aynı adaylarla, aynı');
  console.log('   kırpımla, aynı seçim kuralıyla çalıştırılır)\n');

  for (const k of KOSULLAR) {
    const kare = kareUret(FIKSTUR, k.sec);
    const d = adayBolgeler(kare);
    const sat = [];
    for (const ad of adlar) {
      let enIyi = null;
      const t0 = Date.now();
      for (const b of d.adaylar) {
        const kirp = payliKirp(d.gri, d.g, d.y, b);
        if (!kirp) continue;
        try {
          const r = await motorler[ad].oku(kirp.veri, kirp.genislik, kirp.yukseklik);
          if (!r.metin) continue;
          const skor = r.minGuven + r.metin.length * 0.01;
          if (!enIyi || skor > enIyi.skor) enIyi = { ...r, skor };
        } catch { /* tek aday hatası ölçümü bozmasın */ }
      }
      sonuc[ad].sureler.push(Date.now() - t0);
      if (!enIyi) { sonuc[ad].bosOkuma++; sat.push(kisa(ad) + ':BOS'); continue; }

      const oku = norm(enIyi.metin);
      if (k.plakasiz) {
        if (/^\d{2}[A-Z]{1,3}\d{2,4}$/.test(oku)) {
          sonuc[ad].yanlisKabul++;
          sonuc[ad].yanlisKabulOlan.push(k.ad + ' -> ' + oku + ' (minGuven ' + enIyi.minGuven + ')');
        }
        sat.push(kisa(ad) + ':' + oku.slice(0, 8));
        continue;
      }
      const dogru = oku === GERCEK;
      sonuc[ad].tam += dogru ? 1 : 0;
      sonuc[ad].karakterHata += lev(oku, GERCEK);
      sonuc[ad].karakterToplam += Math.max(oku.length, GERCEK.length);
      (dogru ? sonuc[ad].dogruGuven : sonuc[ad].yanlisGuven).push(enIyi.minGuven);
      sat.push(kisa(ad) + ':' + (dogru ? 'DOGRU' : oku.slice(0, 8) || '-'));
    }
    console.log('  ' + k.ad.padEnd(26) + ' aday=' + String(d.adaylar.length).padStart(2) + '  ' + sat.join('  |  '));
  }

  console.log('\n\n=== ÖZET ===\n');
  for (const ad of adlar) {
    const R = sonuc[ad];
    console.log('--- ' + ad + ' ---');
    console.log('  tam eşleşme       : ' + R.tam + '/' + okunacak + '  (' + yuzde(R.tam / okunacak) + ')');
    console.log('  karakter doğruluğu: ' + yuzde(1 - R.karakterHata / Math.max(1, R.karakterToplam)) +
      '  (' + R.karakterHata + ' hata / ' + R.karakterToplam + ' karakter)');
    console.log('  boş okuma        : ' + R.bosOkuma);
    console.log('  minGuven p50     : doğru=' + persentil(R.dogruGuven, 0.5).toFixed(3) +
      '  yanlış=' + persentil(R.yanlisGuven, 0.5).toFixed(3) +
      '   <-- ayırma gücü (rehber §8)');
    console.log('  süre p50/p95     : ' + persentil(R.sureler, 0.5) + ' / ' + persentil(R.sureler, 0.95) +
      ' ms (tüm adaylar, ortalama)');
    console.log('  YANLIŞ-KABUL     : ' + R.yanlisKabul + '/' + plakasizSayisi + ' plakasız karede geçerli plaka');
    R.yanlisKabulOlan.forEach((x) => console.log('      ! ' + x));
    console.log('');
  }

  const sirali = adlar.slice().sort((a, b) => sonuc[b].tam - sonuc[a].tam);
  console.log('==> Sıralama (tam eşleşme): ' + sirali.map((a) => a + ' ' + sonuc[a].tam + '/' + okunacak).join('  >  '));
  console.log('==> Üretimde kullanılacak model: ' + sirali[0]);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

function kisa(ad) { return ad.replace(/_(global|ocr)$/, '').replace('cct_xs', 'xs').replace('cct_s_', 's_'); }
