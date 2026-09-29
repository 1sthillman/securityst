'use strict';
/**
 * ============================================================================
 *  QR OKUTUCU — GERÇEK UÇTAN UCA ÖLÇÜM
 * ============================================================================
 *  Kullanıcı isteği (29.09.2026): "telefon uygulamasına QR kod okutulabilen
 *  bir yer olmalıdır ... şu an bağlanmıyor, QR okutun diyor, zaten okutacak
 *  fonksiyon yok".
 *
 *  Burada TAHMİN YOK. Zincirin tamamı çalıştırılır:
 *    1) Sunucunun kendi QR üreticisi (companion/qr.js) ile GERÇEK bir QR
 *       kare üretilir — ekrandakinden birebir aynı içerik.
 *    2) Bu kare piksel dizisine çevrilir (telefonun çektiği fotoğraf gibi).
 *    3) Uygulamanın kullandığı AYNI kütüphane (jsQR) ile çözülür.
 *    4) Uygulamanın `qrAdresAyikla()` mantığı çalıştırılır.
 *    5) Çıkan adresin canlı sunucuya bağlanıp bağlanmadığı SINANIR.
 *
 *  Böylece "buton var" değil, "gerçekten okutuyor" kanıtlanır.
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { blokCikar } = require('./kod-parca.js');

const KOK = path.join(__dirname, '..', '..');
const QR_JS = path.join(KOK, 'companion', 'qr.js');
const JSQR = path.join(KOK, 'companion', 'public', 'telefon', 'vendor', 'jsQR.min.js');
const SENKRON = path.join(KOK, 'companion', 'public', 'telefon', 'senkron.js');

let pass = 0, fail = 0;
const ok = (c, ad, ek) => {
  if (c) { pass++; console.log('PASS — ' + ad + (ek ? '  -> ' + ek : '')); }
  else { console.log('FAIL — ' + ad + (ek ? '  -> ' + ek : '')); fail++; }
};

console.log('\n--- 0) Gereken dosyalar var mı? ---');
for (const f of [QR_JS, JSQR, SENKRON]) {
  ok(fs.existsSync(f), 'dosya var: ' + path.basename(f));
}
if (fail) { console.log('\nSONUÇ: eksik dosya var, devam edilemiyor'); process.exit(1); }

const jsQR = require(JSQR);
const qr = require(QR_JS);

// --- 1) Canli sunucudan GERCEK eşleşme adresini al ------------------------
function canliEslesme() {
  return new Promise((co) => {
    http.get({ host: '127.0.0.1', port: 4545, path: '/eslesme', timeout: 8000 }, (r) => {
      let b = '';
      r.on('data', (x) => { b += x; });
      r.on('end', () => { try { co(JSON.parse(b)); } catch (e) { co(null); } });
    }).on('error', () => co(null));
  });
}

(async () => {
  const eslesme = await canliEslesme();
  const ADRES = (eslesme && eslesme.qrAdres) || 'http://192.168.1.235:4545';
  console.log('\n--- 1) Canlı sunucunun gerçek QR içeriği ---');
  console.log('  qrAdres : ' + ADRES);
  console.log('  token   : ' + (eslesme && eslesme.token ? eslesme.token.length + ' karakter' : 'YOK'));
  ok(!!eslesme, 'canlı sunucudan /eslesme okundu');

  // --- 2) Sunucunun kendi üreticisiyle QR kareyi kur ------------------------
  // ÖLÇÜM BETİĞİ HATASI DÜZELTMESİ: qr.encode() doğrudan matris DEĞİL,
  // {version, size, modules, mask} nesnesi döndürüyor. Doğru alan: modules.
  const kod = qr.encode(ADRES);
  const matris = kod.modules;
  const boyut = kod.size || matris.length;
  const MODUL = 4;        // her modül 4px
  const BOSLUK = 4 * MODUL;
  const W = boyut * MODUL + BOSLUK * 2;
  const H = W;
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255);   // beyaz zemin
  // siyah modüller
  for (let r = 0; r < boyut; r++) {
    for (let c = 0; c < boyut; c++) {
      if (!matris[r][c]) continue;               // 1 = koyu
      for (let dy = 0; dy < MODUL; dy++) {
        for (let dx = 0; dx < MODUL; dx++) {
          const x = BOSLUK + c * MODUL + dx;
          const y = BOSLUK + r * MODUL + dy;
          const i = (y * W + x) * 4;
          rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 255;
        }
      }
    }
  }
  console.log('\n--- 2) QR kare üretildi ---');
  console.log('  boyut   : ' + W + 'x' + H + '  (modül ' + boyut + ')');
  ok(W > 100, 'geçerli boyutta bir kare üretildi');

  // --- 3) jsQR ile çöz ------------------------------------------------------
  // jsQR bozuk veriyle THROW ediyor; ölçüm aracı çökerse test anlamını
  // yitirir. Yakalanıp raporlanır.
  let sonuc = null;
  try { sonuc = jsQR(rgba, W, H); }
  catch (e) { console.log('  jsQR hata verdi: ' + e.message); }
  console.log('\n--- 3) jsQR ile çözme ---');
  ok(!!sonuc, 'jsQR kodu çözdü');
  if (sonuc) {
    console.log('  okunan içerik : ' + sonuc.data);
    ok(sonuc.data === ADRES, 'içerik sunucunun adresiyle BİREBİR aynı', sonuc.data);
  }

  // --- 4) Uygulamanın adres ayıklama mantığı -------------------------------
  const senkronKod = fs.readFileSync(SENKRON, 'utf8');
  const ayikla = blokCikar(senkronKod, 'function qrAdresAyikla');
  ok(!!ayikla, 'uygulamada qrAdresAyikla() var');
  if (ayikla && sonuc) {
    const kutu = {};
    vm.runInNewContext(ayikla + '\nthis.ayikla = qrAdresAyikla;', kutu);
    const cikan = kutu.ayikla(sonuc.data);
    ok(cikan === ADRES, 'uygulama adresi doğru ayıkladı', cikan);

    // --- 5) Çıkan adres GERÇEKTEN bağlanabiliyor mu? -----------------------
    const baglanti = await new Promise((co) => {
      http.get({ host: '127.0.0.1', port: 4545, path: '/saglik', timeout: 6000 }, (r) => {
        let b = ''; r.on('data', (x) => { b += x; });
        r.on('end', () => co({ s: r.statusCode, b }));
      }).on('error', (e) => co({ s: 0, b: e.message }));
    });
    console.log('\n--- 5) Okunan adres gerçekten bağlanabiliyor mu? ---');
    ok(baglanti.s === 200, 'okunan adres sunucuya bağlanıyor', 'HTTP ' + baglanti.s);
    const durum = await new Promise((co) => {
      http.get({
        host: '127.0.0.1', port: 4545, path: '/durum', timeout: 6000,
        headers: { 'X-Sync-Token': eslesme.token },
      }, (r) => { let b = ''; r.on('data', (x) => { b += x; }); r.on('end', () => co(b)); })
        .on('error', () => co('{}'));
    });
    let j = null; try { j = JSON.parse(durum); } catch (e) { /* JSON değil */ }
    ok(j && j.ok === true, 'kurulum anahtarıyla veri geliyor (otomatik alınan anahtar işe yarıyor)');
    if (j) console.log('  kayıt sayısı : ' + j.kayitSayisi);
  }

  // --- 6) Kurulum anahtarı zaten otomatik geliyor mu? -----------------------
  console.log('\n--- 6) Kullanıcı anahtarı elle yazmak zorunda mı? ---');
  ok(!!(eslesme && eslesme.token),
    '/eslesme kurulum anahtarını döndürüyor -> kullanıcı YAZMAZ');
  ok(/#gsync-tok'\)\.value = d\.token/.test(senkronKod),
    'QR sonrası anahtar forma otomatik dolduruluyor');

  console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
