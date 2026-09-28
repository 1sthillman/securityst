'use strict';
// QR kapalı-devre testi: qr.js ile üret → jsQR ile çöz → birebir karşılaştır.
// Sürümler 1-6 arası farklı yüklerle zorlanır (hizalama deseni + çok blok dahil).
const path = require('path');
const qr = require(path.join(__dirname, '..', 'companion', 'qr.js'));
const jsQR = require(path.join(__dirname, '..', 'phone', 'jsqr.min.js'));

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log(`PASS — ${name}`); }
  else { fail++; console.log(`FAIL — ${name}${extra ? ' :: ' + extra : ''}`); }
};

function toImage(qrRes, scale = 5, quiet = 4) {
  const side = qrRes.size + quiet * 2;
  const W = side * scale;
  const data = new Uint8ClampedArray(W * W * 4);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < qrRes.size && my < qrRes.size ? qrRes.modules[my][mx] : false;
      const v = dark ? 0 : 255;
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: W };
}

function roundtrip(text) {
  const q = qr.encode(text);
  const img = toImage(q);
  const out = jsQR(img.data, img.width, img.height);
  return { q, decoded: out && out.data };
}

// Gerçek eşleşme yükü (V6 civarı) + sürümleri zorlayan boylar
const pairing = JSON.stringify({ u: 'http://192.168.1.235:4545', t: Buffer.from('ab'.repeat(32), 'utf8').toString('base64url').slice(0, 43) });
const cases = [
  ['kısa (V1)', 'HELLO'],
  ['V2 bandı', 'A'.repeat(20)],
  ['V3 bandı', 'B'.repeat(35)],
  ['V4 bandı (2 blok)', 'C'.repeat(55)],
  ['V5 bandı (2 blok)', 'D'.repeat(75)],
  ['V6 bandı (4 blok)', 'E'.repeat(100)],
  ['gerçek eşleşme yükü', pairing],
  ['Türkçe bayt yükü', 'Çınarköy Sitesi Blok 12 Daire 34 - ğüşöçı'],
];

for (const [name, text] of cases) {
  let res;
  try {
    res = roundtrip(text);
  } catch (e) {
    ok(false, name, 'üretim hatası: ' + e.message);
    continue;
  }
  ok(res.decoded === text, `${name} çözüldü (V${res.q.version})`, `beklenen ${text.length}B, çözülen: ${res.decoded === null ? 'null' : res.decoded.length + 'B'}`);
}

// Yapısal kontroller: bulucu desenler + boyut + maske aralığı
{
  const q = qr.encode('TEST');
  const n = q.size;
  ok(n === 21 && q.version === 1, 'V1 boyutu 21x21');
  const finder = (r0, c0) => {
    for (let dr = 0; dr < 7; dr++) {
      for (let dc = 0; dc < 7; dc++) {
        const border = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        if (q.modules[r0 + dr][c0 + dc] !== (border || core)) return false;
      }
    }
    return true;
  };
  ok(finder(0, 0) && finder(0, n - 7) && finder(n - 7, 0), 'üç bulucu desen doğru');
  ok(q.modules[n - 8][8] === true, 'karanlık modül yerinde');
  ok(q.mask >= 0 && q.mask <= 7, 'maske 0-7 aralığında');
  ok(!q.modules.flat().some((v) => v === null || v === undefined), 'boş modül yok');
}

// Kapasite sınırı: 107+ bayt V6-M sonrası hata vermeli (kontrollü)
{
  let threw = false;
  try { qr.encode('X'.repeat(200)); } catch { threw = true; }
  ok(threw, 'aşırı yük kontrollü hata verir');
}

// SVG çıktısı geçerli mi
{
  const svg = qr.toSvg(qr.encode('SVG'));
  ok(svg.startsWith('<svg') && svg.includes('<rect') && svg.includes('viewBox'), 'SVG çıktısı geçerli');
}

console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
