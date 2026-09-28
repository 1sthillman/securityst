'use strict';
// ============================================================================
//  UÇTAN UCA: sertifikasız akistan plaka okuma
// ============================================================================
//  Beklenen: anahtarsız /eslesme → /plaka/oku → okuma. Yani telefonun
//  kamera düğmesiyle çekip gönderdiği yol. HİÇBİR sertifika, https veya
//  özel adım yok. Doğrulama iki uçta da http üzerinden yapılır.
// ============================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');

function istek(yol, secenek) {
  return new Promise((c, h) => {
    const r = http.request(Object.assign({
      host: '127.0.0.1', port: 4545, path: yol, method: 'GET',
    }, secenek || {}), (res) => {
      let b = '';
      res.on('data', (x) => b += x);
      res.on('end', () => c({ s: res.statusCode, b }));
    });
    r.on('error', h);
    if (secenek && secenek.govde) r.write(secenek.govde);
    r.end();
  });
}

(async () => {
  console.log('=== EŞLEŞME (anahtarsız, düz http) ===');
  const e = await istek('/eslesme');
  const esl = JSON.parse(e.b);
  console.log('  http durumu     :', e.s);
  console.log('  anahtar var mı  :', !!esl.token ? 'EVET (otomatik)' : 'HAYIR');
  console.log('  ilk http adresi :', esl.adaylar.find((a) => a.startsWith('http://')) || '-');
  console.log('  ilk https adresi:', esl.adaylar.find((a) => a.startsWith('https://')) || '-');
  console.log('  QR üretildi mi  :', !!esl.qrSvg, '· hata:', esl.qrHata || '(yok)');

  console.log('');
  console.log('=== /plaka/oku (telefonun gönderdiği yol) ===');
  const f = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'plaka-temiz.png');
  const govde = JSON.stringify({
    gorsel: 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'),
    bilinenPlakalar: [],
  });
  const r = await istek('/plaka/oku', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Token': esl.token,
      // Uygulamanın gönderdiği API anahtarı da eklenir (Authorization).
      Authorization: 'Bearer ' + require('../../shared/anahtar.js').ANAHTAR,
      'Content-Length': Buffer.byteLength(govde),
    },
    govde,
  });
  const j = JSON.parse(r.b);
  console.log('  http durumu   :', r.s);
  console.log('  başarılı      :', j.basarili);
  console.log('  plaka         :', j.plaka);
  console.log('  güven         :', j.guvenSeviyesi, '· minGuven', j.minGuven);
  console.log('  kaynak        :', j.bulunanBolge, '·', j.sureMs, 'ms');
  const motorCevap = await istek('/plaka/durum', { headers: { 'X-Sync-Token': esl.token } });
  const motor = JSON.parse(motorCevap.b);
  console.log('  motor         :', motor.motor, '| hat:', motor.hat, '| hazır:', motor.hazir);

  console.log('');
  const tamam = r.s === 200 && j.basarili === true;
  console.log('  => SERTİFİKASIZ AKIŞTA UÇTAN UCA ÇALIŞIYOR:',
    tamam ? 'EVET' : 'HAYIR');
  process.exit(tamam ? 0 : 1);
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
