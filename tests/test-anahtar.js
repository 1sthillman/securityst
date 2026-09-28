'use strict';
/**
 * ============================================================================
 *  API ANAHTARI TESTİ — iki kopyanın AYNI olduğunu ve sunucunun
 *  doğruladığını ÖLÇER.
 * ============================================================================
 *  Anahtar iki yerde yaşar (tarayıcıda require olmadığı için):
 *    1) shared/anahtar.js                (kanonik kopya)
 *    2) phone/guvenlik-sync.js          (telefon uygulaması)
 *    3) companion/public/telefon/senkron.js (üretilmiş çıktı)
 *
 *  "İki yerde ayrı ayrı yazıp birini unutma" riskini ölçerek kapatıyoruz.
 *  Ayrıca sunucunun anahtarı gerçekten doğruladığını canlı istekle kanıtlıyor.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const COMP = path.join(ROOT, 'companion');
const PORT = 4609;
const TOKEN = 'anahtar-test-token';
const AD = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const ok = (c, ad, extra = '') => {
  if (c) { pass++; console.log('PASS — ' + ad); }
  else { fail++; console.log('FAIL — ' + ad + (extra ? ' :: ' + extra : '')); }
};
const bolum = (a) => console.log('\n--- ' + a + ' ---');
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

function oku(yol) {
  return fs.existsSync(yol) ? fs.readFileSync(yol, 'utf8') : '';
}

function istek(yol, hd, method) {
  return new Promise((c) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: yol, method: method || 'GET', timeout: 6000, headers: hd || {} }, (res) => {
      let b = '';
      res.on('data', (x) => { b += x; });
      res.on('end', () => c({ s: res.statusCode, b }));
    });
    r.on('error', (e) => c({ s: 0, b: e.message }));
    r.end();
  });
}

(async () => {
  const kanonik = require(path.join(ROOT, 'shared', 'anahtar.js'));
  const ANAHTAR = kanonik.ANAHTAR;

  bolum('1) Anahtar tanimli ve yeterince guclu mu');
  ok(typeof ANAHTAR === 'string' && ANAHTAR.length >= 24, 'anahtar en az 24 karakter', String(ANAHTAR && ANAHTAR.length));
  ok(/^[a-z0-9_]+$/.test(ANAHTAR), 'anahtar kucuk harf/ rakam/ alt cizgi (URL ve baslikta sorun cikmaz)');
  ok(!/^\d+$/.test(ANAHTAR), 'anahtar saf rakam degil (tahmin edilebilir olmasin)');

  bolum('2) Iki kopya AYNI mi (unutma riski olcumu)');
  const telefon = oku(path.join(ROOT, 'phone', 'guvenlik-sync.js'));
  const uretilmis = oku(path.join(COMP, 'public', 'telefon', 'senkron.js'));
  const cikar = (metin) => { const m = /API_ANAHTARI\s*=\s*'([^']+)'/.exec(metin); return m ? m[1] : null; };
  const t = cikar(telefon);
  const g = cikar(uretilmis);
  ok(!!t, 'telefon kaynaginda anahtar var');
  ok(t === ANAHTAR, 'telefon kaynagi kanonik kopyayla AYNI', `${t} != ${ANAHTAR}`);
  ok(!!g, 'uretilmis senkron.js icinde anahtar var');
  ok(g === ANAHTAR, 'uretilmis senkron.js kanonik kopyayla AYNI', `${g} != ${ANAHTAR}`);

  bolum('3) Sunucu anahtari dogru mu kabul ediyor / yanlisa reddediyor');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-anahtar-'));
  const cocuk = spawn(process.execPath, [path.join(COMP, 'companion.js')], {
    env: Object.assign({}, process.env, {
      SYNC_TOKEN: TOKEN, PORT: String(PORT), DATA_DIR: tmp, CK_KOK_GUVENME: '0',
    }),
    cwd: COMP, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let cikti = '';
  cocuk.stdout.on('data', (x) => { cikti += x; });
  cocuk.stderr.on('data', (x) => { cikti += x; });

  let ayakta = false;
  for (let i = 0; i < 40; i++) { const r = await istek('/saglik'); if (r.s === 200) { ayakta = true; break; } await bekle(500); }
  ok(ayakta, 'sunucu ayakta');
  if (!ayakta) { console.log(cikti); cocuk.kill(); process.exit(1); }
  await bekle(1200);

  {
    const r = await istek('/durum');
    ok(r.s === 401, 'anahtarsiz istek reddedildi', `HTTP ${r.s}`);
  }
  {
    const r = await istek('/durum', { Authorization: 'Bearer ' + ANAHTAR });
    ok(r.s === 200, 'Authorization: Bearer <anahtar> kabul edildi', `HTTP ${r.s}`);
  }
  {
    const r = await istek('/durum', { Authorization: ANAHTAR });
    ok(r.s === 200, 'Authorization: <duz anahtar> da kabul edildi', `HTTP ${r.s}`);
  }
  {
    const r = await istek('/durum', { 'X-Sync-Token': TOKEN });
    ok(r.s === 200, 'X-Sync-Token (kurulum anahtari) da calisiyor — geriye uyum', `HTTP ${r.s}`);
  }
  {
    const r = await istek('/durum', { Authorization: 'Bearer yanlis-anahtar' });
    ok(r.s === 401, 'YANLIS anahtar reddedildi', `HTTP ${r.s}`);
  }

  bolum('4) Plaka okuma ucu anahtarla calisiyor (uydurma sonuc YOK)');
  {
    const govde = JSON.stringify({ gorsel: '', bilinenPlakalar: [] });
    const r = await istek('/plaka/oku', {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(govde),
      Authorization: 'Bearer ' + ANAHTAR,
    }, 'POST');
    // Anahtar gecerliyse 400/422 olabilir (gorsel bos) ama 401 DEGIL.
    ok(r.s !== 401, 'anahtarli plaka okuma istegi yetki katmanini gecti', `HTTP ${r.s}`);
    ok(!/34KCH810/.test(r.b), 'sabit/uydurma plaka donulmedi (gercek motor kullaniliyor)', r.b.slice(0, 90));
  }

  bolum('5) Ortam degiskeni anahtari eziyor mu (CK_ANAHTAR)');
  {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-anahtar2-'));
    // ÖLÇÜLEN HATA: companion HTTPS portunu da PORT+1'den açar; ikinci sunucu
    // burada çakışır (EADDRINUSE). Portlar birbirinden uzaklaştırıldı.
    const P2 = PORT + 10;
    const OZEL = 'ck_yk_ortam_degiskeni_testi';
    let c2cikti = '';
    const c2 = spawn(process.execPath, [path.join(COMP, 'companion.js')], {
      env: Object.assign({}, process.env, {
        SYNC_TOKEN: TOKEN, PORT: String(P2), DATA_DIR: tmp2, CK_KOK_GUVENME: '0', CK_ANAHTAR: OZEL,
      }),
      cwd: COMP, stdio: ['ignore', 'pipe', 'pipe'],
    });
    c2.stdout.on('data', (x) => { c2cikti += x; });
    c2.stderr.on('data', (x) => { c2cikti += x; });
    c2.on('exit', (kod) => { c2cikti += '\n[c2 cikis kodu ' + kod + ']\n'; });
    const istek2 = (yol, hd) => new Promise((c) => {
      const r = http.request({ host: '127.0.0.1', port: P2, path: yol, timeout: 6000, headers: hd || {} }, (res) => {
        res.resume(); res.on('end', () => c({ s: res.statusCode }));
      });
      r.on('error', () => c({ s: 0 })); r.end();
    });
    let a2 = false;
    for (let i = 0; i < 40; i++) { const r = await istek2('/saglik'); if (r.s === 200) { a2 = true; break; } await bekle(500); }
    ok(a2, 'CK_ANAHTAR ile baslatilan sunucu ayakta',
      c2cikti.split('\n').filter((l) => l.trim()).slice(0, 3).join(' | ').substring(0, 300));
    if (a2) {
      const gomulu = await istek2('/durum', { Authorization: 'Bearer ' + ANAHTAR });
      ok(gomulu.s === 401, 'CK_ANAHTAR verilince GOMULU anahtar gecersiz oldu (beklenen)', `HTTP ${gomulu.s}`);
      const ozel = await istek2('/durum', { Authorization: 'Bearer ' + OZEL });
      ok(ozel.s === 200, 'CK_ANAHTAR degeri gecerli', `HTTP ${ozel.s}`);
    }
    c2.kill();
    await bekle(600);
  }

  console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
  cocuk.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST ÇÖKTÜ:', e); process.exit(1); });
