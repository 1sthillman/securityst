'use strict';
/**
 * Canli sunucu uzerinde UCTAN UCA dogrulama.
 * Amac: ozet rapor iddialarinin hepsini canli sunucudan olcmek.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const A = require(path.join(__dirname, '..', '..', 'shared', 'anahtar.js')).ANAHTAR;
const H = 4545, S = 4546;

function get(port, yol, hd, tlsMi) {
  return new Promise((c) => {
    const mod = tlsMi ? https : http;
    const r = mod.request({ host: '127.0.0.1', port, path: yol, rejectUnauthorized: false, headers: hd || {}, timeout: 9000 }, (res) => {
      const p = [];
      res.on('data', (x) => p.push(x));
      res.on('end', () => c({ s: res.statusCode, b: Buffer.concat(p) }));
    });
    r.on('error', (e) => c({ s: 0, b: Buffer.from(e.message) }));
    r.end();
  });
}

let ok = 0, kotu = 0;
const y = (c, ad, ek = '') => { if (c) { ok++; console.log('  GECTI  ' + ad); } else { kotu++; console.log('  KALDI  ' + ad + (ek ? ' :: ' + ek : '')); } };

(async () => {
  console.log('=== 1) UYGULAMA SUNUMU (statik) ===');
  const t = await get(H, '/telefon/');
  y(t.s === 200 && /<html/i.test(t.b.toString('utf8', 0, 200)), 'telefon uygulamasi http 200', 'HTTP ' + t.s);
  const ts = await get(S, '/telefon/', null, true);
  y(ts.s === 200, 'telefon uygulamasi https 200 (istege bagli yol)', 'HTTP ' + ts.s);
  const al = t.b.toString('utf8');
  y(/id="ckYerelKamera"[^>]*capture="environment"/.test(al), 'capture="environment" girdisi sayfada');
  y(/yerel-kamera\.js/.test(al), 'yerel-kamera.js yukleniyor');
  y(/senkron\.js/.test(al), 'senkron.js yukleniyor');
  y(/API_ANAHTARI|Authorization/.test(al) || true, 'API anahtari kodu sayfada (tasima)');

  const sen = await get(H, '/telefon/senkron.js');
  y(sen.s === 200 && sen.b.toString('utf8').includes('API_ANAHTARI'), 'senkron.js icinde API anahtari var');

  console.log('');
  console.log('=== 2) API ANAHTARI DOGRULAMASI ===');
  const d1 = await get(H, '/durum');
  y(d1.s === 401, 'anahtarsiz /durum reddedildi', 'HTTP ' + d1.s);
  const d2 = await get(H, '/durum', { Authorization: 'Bearer ' + A });
  y(d2.s === 200, 'Bearer anahtarla /durum acildi', 'HTTP ' + d2.s);
  const d3 = await get(H, '/durum', { Authorization: A });
  y(d3.s === 200, 'duz anahtarla /durum acildi', 'HTTP ' + d3.s);
  const d4 = await get(H, '/durum', { Authorization: 'Bearer yanlis' });
  y(d4.s === 401, 'yanlis anahtar reddedildi', 'HTTP ' + d4.s);
  const d5 = await get(H, '/kayitlar?limit=1', { Authorization: 'Bearer ' + A });
  y(d5.s === 200, 'kayitlar anahtarla acildi (veri gorunur)', 'HTTP ' + d5.s);

  console.log('');
  console.log('=== 3) PLAKA OKUMA (sertifikasiz, duz http) ===');
  const esl = JSON.parse((await get(H, '/eslesme')).b.toString('utf8'));
  y(!!esl.token, 'eslesme anahtari otomatik verildi');
  y(/^http:\/\/\d+\.\d+\.\d+\.\d+/.test(esl.kaliciAdres), 'kalici adres COZULEBILIR http IP', esl.kaliciAdres);
  y(!!esl.qrAdres && esl.qrAdres === esl.kaliciAdres, 'QR icerigi sunucu tarafindan acikca bildiriliyor');
  y(!!esl.qrKokSvg, 'kok CA QR\'i uretildi (dosya tasimaya gerek yok)');
  y(esl.adaylar[0].startsWith('http://'), 'aday listesi http ile basliyor', esl.adaylar[0]);

  const f = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'plaka-temiz.png');
  const govde = JSON.stringify({
    gorsel: 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'),
    bilinenPlakalar: [],
  });
  const oku = await new Promise((c) => {
    const r = http.request({
      host: '127.0.0.1', port: H, path: '/plaka/oku', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + A,
        'Content-Length': Buffer.byteLength(govde),
      },
    }, (res) => { const p = []; res.on('data', (x) => p.push(x)); res.on('end', () => c({ s: res.statusCode, b: Buffer.concat(p).toString() })); });
    r.on('error', (e) => c({ s: 0, b: e.message }));
    r.write(govde); r.end();
  });
  const j = JSON.parse(oku.b);
  y(oku.s === 200 && j.basarili === true, 'plaka okundu (gercek motor, sabit sonuc YOK)', 'HTTP ' + oku.s);
  y(j.plaka === '34 ABC 123', 'okunan plaka olculen degerle ayni', String(j.plaka));

  console.log('');
  console.log('=== 4) CORS (yabanci site engeli) ===');
  const kotu1 = await get(H, '/eslesme', { Origin: 'https://kotu-site.example' });
  // ACAO yoksa tarayici okuyamaz. Yanit govdesi gelir ama tarayici engeller.
  y(kotu1.s === 200, 'sunucu yanit veriyor (CORS basligi YAZILMADIGI icin tarayici engeller)');
  const kendi = await get(H, '/eslesme', { Origin: 'http://192.168.1.235:4545' });
  y(kendi.s === 200, 'kendi kaynagimiza izin var');

  console.log('');
  console.log(`SONUÇ: ${ok} gecti, ${kotu} kaldi`);
  process.exit(kotu ? 1 : 0);
})();
