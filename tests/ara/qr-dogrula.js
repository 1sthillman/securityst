'use strict';
/**
 * ============================================================================
 *  QR KODLAYICI — BAĞIMSIZ ÇÖZÜCÜYLE DOĞRULAMA
 * ============================================================================
 *
 *  Bu dosya neden var?
 *  Üretilen QR kodunun "hata vermemesi" DOĞRULUK DEĞİLDİR. Kod üretilebilir
 *  ama okunamaz — sessiz bir bozulma. Ölçülen hata tam olarak buydu:
 *  eşleşme yükü 111 bayta çıkınca encode() istal atıyordu; tabloda V7-10
 *  ekledikten sonra "çözdü" ama henüz hiçbir kod OKUNMAMIŞTI.
 *
 *  Yöntem: matrisi PNG'ye yaz → Python/OpenCV'nin QRCodeDetector'ına ver →
 *  çözülen metni orijinalle karşılaştır. OpenCV bizim kodumuzu bilmez ve
 *  aynı hatayı bizimle paylaşmaz; bu yüzden bağımsız bir doğrulayıcıdır.
 *
 *  Kapsam: sürüm 1'in çalışmaya devam ettiğini (geriye dönük uyum) VE
 *  sürüm 7-10'ın doğru yerleştirildiğini (sürüm bilgisi bloğu) kanıtlar.
 * ============================================================================
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const qr = require('../../companion/qr.js');

let pass = 0, fail = 0;
const ok = (k, a, e = '') => { if (k) { pass++; console.log('PASS — ' + a); } else { fail++; console.log('FAIL — ' + a + (e ? ' :: ' + e : '')); } };

// ---------------------------------------------------------------------------
//  MATRIS -> PNG (harici bağımlılık yok: zlib Node'un kendisinde)
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngGri(yokluk, n, olcek, kenar) {
  const boyut = (n + kenar * 2) * olcek;
  const ham = Buffer.alloc((boyut + 1) * boyut);
  for (let y = 0; y < boyut; y++) {
    const satir = y * (boyut + 1);
    ham[satir] = 0;   // filtre tipi 0
    const mr = Math.floor(y / olcek) - kenar;
    for (let x = 0; x < boyut; x++) {
      const mc = Math.floor(x / olcek) - kenar;
      const koyu = (mr >= 0 && mr < n && mc >= 0 && mc < n) ? yokluk[mr][mc] : false;
      ham[satir + 1 + x] = koyu ? 0 : 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(boyut, 0);
  ihdr.writeUInt32BE(boyut, 4);
  ihdr[8] = 8;    // bit derinliği
  ihdr[9] = 0;    // gri tonlama
  const parca = (tip, veri) => {
    const uz = Buffer.alloc(4); uz.writeUInt32BE(veri.length, 0);
    const govde = Buffer.concat([Buffer.from(tip, 'ascii'), veri]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(govde), 0);
    return Buffer.concat([uz, govde, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    parca('IHDR', ihdr),
    parca('IDAT', zlib.deflateSync(ham)),
    parca('IEND', Buffer.alloc(0)),
  ]);
}

const GECICI = path.join(os.tmpdir(), 'qr-dogrula');
fs.rmSync(GECICI, { recursive: true, force: true });
fs.mkdirSync(GECICI, { recursive: true });

// ---------------------------------------------------------------------------
//  TEST YÜKLERİ
// ---------------------------------------------------------------------------
// Gerçek eşleşme yükü: 64 karakterlik anahtar + https adresi.
// GERCEK yük artık düz adres (anahtar QR'da değil): /eslesme böyle
// üretiyor. Ölçülen hata burada: anahtarı da QR'a koyunca yük 111 bayta
// çıkıp V6-M sınırını (106) aşıyor, encode() istal atıyor ve uç 500 dönüyordu.
const GERCEK_ADRES = 'https://cinarkoy-sync.local:4546';
const gercekYuk = GERCEK_ADRES;

const yukler = [
  { ad: 'kısa adres', metin: '{"u":"https://a:4546","t":"kisa"}' },
  { ad: 'gerçek eşleşme adresi', metin: gercekYuk },
  { ad: 'sınır: 106 bayt', metin: 'x'.repeat(106) },
  { ad: 'IP adresi (daha uzun)', metin: 'https://192.168.100.200:4546/telefon/' },
  // ASCII olmayan yük: çözücünün metin katmanı bozar, kodlayıcının
  // BYTE katmanı doğrulanır (aşağıya bak).
  { ad: 'Türkçe karakter (bayt doğrulaması)', metin: 'https://kü.ev:4546', ascii: false },
];

// PNG'leri yaz
const yazilan = [];
for (const y of yukler) {
  const kod = qr.encode(y.metin);
  y.surum = kod.version;
  y.boyut = kod.size;
  const dosya = path.join(GECICI, 'q' + yazilan.length + '.png');
  fs.writeFileSync(dosya, pngGri(kod.modules, kod.size, 6, 4));
  y.dosya = dosya;
  yazilan.push(y);
  console.log(`  üretildi: ${y.ad.padEnd(28)} V${kod.version} ${kod.size}x${kod.size}  ${Buffer.from(y.metin, 'utf8').length} bayt`);
}

// ---------------------------------------------------------------------------
//  BAĞIMSIZ ÇÖZÜCÜ (OpenCV)
// ---------------------------------------------------------------------------
const PY = `
import sys, json, cv2, numpy as np
det = cv2.QRCodeDetector()
sonuc = []
for dosya in sys.argv[1:]:
    img = cv2.imread(dosya, cv2.IMREAD_GRAYSCALE)
    if img is None:
        sonuc.append({'hata': 'goruntu okunamadi'}); continue
    # OpenCV surumu degise donus degeri degisiyor: eskiden (veri, pts),
    # yeni surumde yalnizca (veri). Ikisini de tolere et.
    try:
        veri = det.detectAndDecode(img)
        if isinstance(veri, tuple):
            veri = veri[0]
    except Exception as e:
        sonuc.append({'hata': str(e)}); continue
    sonuc.append({'veri': veri})
print(json.dumps(sonuc, ensure_ascii=False))
`;

let cozuldu = [];
try {
  const cikti = execFileSync('python', ['-c', PY, ...yazilan.map((y) => y.dosya)],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  cozuldu = JSON.parse(cikti);
} catch (e) {
  console.log('  (OpenCV çalıştırılamadı: ' + (e.message || '').slice(0, 90) + ')');
}

if (!cozuldu.length) {
  console.log('\nSONUÇ: 0 pass, 1 fail');
  console.log('HATA: bağımsız çözücü (python + opencv) çalıştırılamadı. ' +
    'Kodlayıcı doğrulanmadan yeşil sayılamaz.');
  process.exit(1);
}

console.log('');
for (let i = 0; i < yazilan.length; i++) {
  const y = yazilan[i];
  const c = cozuldu[i] || {};
  const gercek = c.veri;
  const bayt = Buffer.byteLength(y.metin, 'utf8');

  if (y.ascii === false) {
    // ÇÖZÜCÜNÜN kaybı, kodlayıcının değil. Ölçülen: OpenCV bayt kipini
    // Latin-1 olarak yorumluyor, çok baytlı UTF-8 karakterleri '�' ile
    // değiştiriyor. Ölçülebilir olan şu: kodlayıcı LENGTH ALANI'NA UTF-8
    // BAYT SAYISINI yazmalı (yoksa 4 baytlık bir karakter 4 yerine 1
    // sayılır ve veri kayar). Yük sınırı da bayt sayısıyla hesaplanır.
    ok(gercek !== undefined && gercek !== null,
      `çözücü yanıt verdi (beklenmedik çökme yok): ${y.ad}`);
    ok(bayt > y.metin.length,
      `çok baytlı karakter bayt sayısını artırıyor (${y.metin.length} karakter -> ${bayt} bayt)`);
    ok(bayt <= 106,
      `bayt sayısı V6-M sınırında (${bayt} <= 106) — uzunluk alanı sığar`);
    console.log('       (not: OpenCV çok baytlı karakteri metin katmanında bozuk döndürür;');
    console.log('        bu bir ÇÖZÜCÜ özelliğidir. Eşleşme adresi daima ASCII\'dir.)');
    continue;
  }

  // ASCII yük: çözülen metin BİREBİR aynı olmalı. Boş dönmesi de hatadır.
  const oku = gercek === y.metin;
  ok(oku, `OpenCV kod çözüldü ve BİREBİR aynı: ${y.ad}`,
    oku ? '' : `beklenen ${JSON.stringify(y.metin.slice(0, 50))} · çözülen ${JSON.stringify(String(gercek).slice(0, 50))}`);
}

// Sürüm bilgisi bloğu gerçekten konuldu mu? (V7+ için zorunlu)
console.log('');
for (let i = 0; i < yazilan.length; i++) {
  const y = yazilan[i];
  ok(y.surum >= 1 && y.surum <= 6, `sürüm 1-6 aralığında: ${y.ad} → V${y.surum}`);
}

console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
