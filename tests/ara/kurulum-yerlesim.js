'use strict';
/**
 * Kurulum yerleşimi doğrulaması (paket kurmadan).
 *
 * ÖLÇÜLEN HATA: companion.js `require('../shared/anahtar.js')` diyor.
 * Geliştirmede companion/ yanındaki shared/ doğru; kurulumda ise dosya
 * {app}\app\companion.js oluyor ve '../shared/' = {app}\shared\ demek.
 * O klasör paketlenmediği için kurulu sürüm açılışta patlıyordu.
 *
 * Bu betik {app} yerleşimini GEÇİCİ olarak kurup sunucuyu oradan başlatır.
 * Böylece "paket doğru mu" sorusu PAKET ÜRETMEYE GEREK KALMADAN ölçülür.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const KOK = path.join(__dirname, '..', '..');
const GECICI = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-app-'));
const APP = path.join(GECICI, 'app');
const SHARED = path.join(GECICI, 'shared');
const PORT = 4611;
const TOKEN = 'kurulum-test-token';

function kopyala(kaynak, hedef) {
  fs.mkdirSync(path.dirname(hedef), { recursive: true });
  fs.copyFileSync(kaynak, hedef);
}

console.log('=== Kurulum yerleşimi kuruluyor: ' + GECICI + ' ===');
// {app}\app\... (companion.js'in require yolları buna göre)
for (const f of ['companion.js', 'qr.js', 'package.json']) {
  kopyala(path.join(KOK, 'companion', f), path.join(APP, f));
}
kopyala(path.join(KOK, 'companion', 'config.example.json'), path.join(APP, 'config.json'));
for (const f of ['sertifika.js', 'tls.js']) {
  kopyala(path.join(KOK, 'companion', 'net', f), path.join(APP, 'net', f));
}
// {app}\shared\anahtar.js
kopyala(path.join(KOK, 'shared', 'anahtar.js'), path.join(SHARED, 'anahtar.js'));
fs.symlinkSync(path.join(KOK, 'companion', 'node_modules'), path.join(APP, 'node_modules'), 'junction');
fs.symlinkSync(path.join(KOK, 'companion', 'public'), path.join(APP, 'public'), 'junction');
fs.symlinkSync(path.join(KOK, 'companion', 'ocr'), path.join(APP, 'ocr'), 'junction');

const kok = path.join(KOK, 'shared', 'anahtar.js');
const A = require(kok).ANAHTAR;

function istek(yol, hd) {
  return new Promise((c) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: yol, headers: hd || {}, timeout: 8000 }, (res) => {
      const p = [];
      res.on('data', (x) => p.push(x));
      res.on('end', () => c({ s: res.statusCode, b: Buffer.concat(p).toString('utf8') }));
    });
    r.on('error', (e) => c({ s: 0, b: e.message }));
    r.end();
  });
}

const cocuk = spawn(process.execPath, [path.join(APP, 'companion.js')], {
  env: Object.assign({}, process.env, {
    SYNC_TOKEN: TOKEN, PORT: String(PORT), DATA_DIR: path.join(GECICI, 'data'), CK_KOK_GUVENME: '0',
  }),
  cwd: APP, stdio: ['ignore', 'pipe', 'pipe'],
});
let cikti = '';
cocuk.stdout.on('data', (x) => { cikti += x; });
cocuk.stderr.on('data', (x) => { cikti += x; });

let ok = 0, kotu = 0;
const y = (c, ad, ek = '') => { if (c) { ok++; console.log('  GECTI  ' + ad); } else { kotu++; console.log('  KALDI  ' + ad + (ek ? ' :: ' + ek : '')); } };
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let ayakta = false;
  for (let i = 0; i < 40; i++) { const r = await istek('/saglik'); if (r.s === 200) { ayakta = true; break; } await bekle(500); }

  console.log('');
  console.log('=== Kurulu yerlesimde dogrulama ===');
  y(ayakta, 'servis KURULU yerlesimden ayaga kalkti', 'acilis hatasi olabilir');
  if (!ayakta) { console.log(cikti.split('\n').slice(-8).join('\n')); cocuk.kill(); process.exit(1); }
  await bekle(1200);

  const d = await istek('/durum', { Authorization: 'Bearer ' + A });
  y(d.s === 200, 'API anahtari kurulu yerlesimde calisiyor (shared/anahtar.js bulundu)', 'HTTP ' + d.s);
  try {
    const j = JSON.parse(d.b);
    y(j.agGuvenligi && j.agGuvenligi.anahtarVar === true, 'anahtar tanimli', JSON.stringify(j.agGuvenligi));
    y(j.agGuvenligi && j.agGuvenligi.anahtarKaynak === 'shared/anahtar.js', 'anahtar dogru yerden okundu', j.agGuvenligi && j.agGuvenligi.anahtarKaynak);
  } catch (e) { y(false, 'durum JSON okunamadı', e.message); }

  const t = await istek('/telefon/');
  y(t.s === 200, 'telefon uygulamasi kurulu yerlesimde sunuluyor', 'HTTP ' + t.s);
  const k = await istek('/kurulum/kok.cer');
  y(k.s === 200, 'kok sertifika sunuluyor', 'HTTP ' + k.s);

  console.log('');
  console.log('SONUÇ: ' + ok + ' gecti, ' + kotu + ' kaldi');
  cocuk.kill();
  await bekle(400);
  try { fs.rmSync(GECICI, { recursive: true, force: true }); } catch (e) {}
  process.exit(kotu ? 1 : 0);
})();
