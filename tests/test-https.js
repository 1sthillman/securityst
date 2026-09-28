'use strict';
// HTTPS'i GERCEKTEN denet: sunucuyu baslat, TLS el sikisini yap, sertifika
// zincirini bagimsiz dogrulayiciyla kontrol et, /eslesme adreslerini ve
// kok.cer indirmesini olc.
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const tlsMod = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { X509Certificate } = require('crypto');

const VERI = path.join(os.tmpdir(), 'ck-https-test');
fs.rmSync(VERI, { recursive: true, force: true });
fs.mkdirSync(VERI, { recursive: true });

const HTTP_PORT = 47311;
const HTTPS_PORT = 47312;
const TOKEN = 'test-token-123';
const COMPANION = path.join(__dirname, '..', 'companion', 'companion.js');

let pass = 0, fail = 0;
const ok = (k, a, e = '') => { if (k) { pass++; console.log('PASS — ' + a); } else { fail++; console.log('FAIL — ' + a + (e ? ' :: ' + e : '')); } };
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

let gunluk = '';
function baslat() {
  const c = spawn(process.execPath, [COMPANION], {
    env: {
      ...process.env, PORT: String(HTTP_PORT), HTTPS_PORT: String(HTTPS_PORT),
      DATA_DIR: VERI, SYNC_TOKEN: TOKEN, CK_KOK_GUVENME: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  c.stdout.on('data', (d) => { gunluk += d.toString(); });
  c.stderr.on('data', (d) => { gunluk += d.toString(); });
  return c;
}
async function ayaktaOle(c) {
  for (let i = 0; i < 60; i++) {
    try { const r = await istek('http', HTTP_PORT, '/saglik'); if (r.status === 200) return true; } catch { /* henuz degil */ }
    await bekle(500);
  }
  return false;
}

// İkili (DER) gövde için: metin birleştirme bozar, Buffer gerekir.
// ÖLÇÜLEN HATA: /kurulum/kok.cer DER döndüğü için istek() gövdeyi
// bozuyordu (ilk bayt 0x0, "no start line" hatası).
function istekHam(protokol, port, yol, opts = {}) {
  return new Promise((c, h) => {
    const mod = protokol === 'https' ? https : http;
    const req = mod.request({
      host: '127.0.0.1', port, path: yol, method: opts.method || 'GET',
      rejectUnauthorized: false, headers: opts.headers || {},
    }, (res) => {
      const parcalar = [];
      res.on('data', (x) => parcalar.push(x));
      res.on('end', () => c({ status: res.statusCode, basliklar: res.headers, govde: Buffer.concat(parcalar) }));
    });
    req.on('error', h);
    req.setTimeout(15000, () => { req.destroy(new Error('zaman asimi')); });
    if (opts.govde) req.write(opts.govde);
    req.end();
  });
}

function istek(protokol, port, yol, opts = {}) {
  return new Promise((c, h) => {
    const mod = protokol === 'https' ? https : http;
    const req = mod.request({
      host: '127.0.0.1', port, path: yol, method: opts.method || 'GET',
      rejectUnauthorized: false, headers: opts.headers || {},
    }, (res) => {
      let govde = '';
      res.on('data', (x) => { govde += x; });
      res.on('end', () => c({ status: res.statusCode, basliklar: res.headers, govde }));
    });
    req.on('error', h);
    req.setTimeout(15000, () => { req.destroy(new Error('zaman asimi')); });
    if (opts.govde) req.write(opts.govde);
    req.end();
  });
}

/** TLS soketinden sunucunun YAPRAK sertifikasını ham olarak al. */
function yaprakAl(port) {
  return new Promise((c, h) => {
    const s = tlsMod.connect({ host: '127.0.0.1', port, rejectUnauthorized: false, servername: 'localhost' }, () => {
      const p = s.getPeerCertificate();
      s.destroy();
      if (!p || !p.raw) { h(new Error('peer sertifika alinamadi (authorized=' + s.authorized + ')')); return; }
      c(p.raw.toString('base64'));
    });
    s.on('error', h);
    s.setTimeout(10000, () => { s.destroy(new Error('zaman asimi')); });
  });
}

(async () => {
  let cocuk = baslat();
  const ayakta = await ayaktaOle(cocuk);
  ok(ayakta, 'HTTP sunucusu ayakta (geriye donuk uyum bozulmadi)');
  if (!ayakta) { console.log(gunluk); try { cocuk.kill(); } catch {} process.exit(1); }
  await bekle(2500);

  // --- 1) TLS EL SIKISI -------------------------------------------------
  let s;
  try { s = await istek('https', HTTPS_PORT, '/saglik'); }
  catch (e) { ok(false, 'HTTPS el sikisi basarili', e.message); console.log(gunluk); try { cocuk.kill(); } catch {} process.exit(1); }
  ok(s.status === 200, 'HTTPS el sikisi basarili ve uygulama yanit veriyor', 'HTTP ' + s.status);
  let saglik = null;
  try { saglik = JSON.parse(s.govde); } catch {}
  ok(saglik && saglik.ok === true, 'HTTPS uzerinden gecerli JSON geliyor');

  // --- 2) SERTIFIKA ZINCIRI (bagimsiz dogrulayici) --------------------
  // ÖLÇÜLEN DEĞİŞİKLİK: /kurulum/kok.cer artık VARSAYILAN olarak DER
  // (ikili) döndürüyor — iOS/Android kurulumu DER ile güvenilir çalışıyor,
  // PEM gövdeli .cer dosyası kurulum profilinden ayırt edilemeyebiliyordu.
  // Bu test PEM bekliyordu ve patladı. Doğrusu: ikisini de doğrulamak.
  const kokCevap = await istekHam('http', HTTP_PORT, '/kurulum/kok.cer');
  const kokDer = kokCevap.govde;
  ok(kokDer.length > 0 && kokDer[0] === 0x30,
    'kok sertifika DER olarak sunuluyor (ilk bayt 0x30)',
    'ilk bayt: 0x' + kokDer[0].toString(16));
  const kok = new X509Certificate(kokDer);
  // PEM de ayrıca sunulmalı (teşhis/denetim için).
  const kokPemCevap = await istekHam('http', HTTP_PORT, '/kurulum/kok.cer?format=pem');
  const kokPem = new X509Certificate(kokPemCevap.govde.toString('utf8'));
  ok(kokPem.fingerprint256 === kok.fingerprint256,
    'DER ve PEM AYNI sertifika (parmak izi esit) — hangi bicimle inilirse ayni CA');
  ok(kok.ca === true, 'indirilen kok sertifika bir CA olarak işaretli');

  // TLS sırasından gelen sertifika DER'dir; X509Certificate PEM bekler.
  const yaprakB64 = await yaprakAl(HTTPS_PORT);
  const yaprakPem = '-----BEGIN CERTIFICATE-----\n'
    + yaprakB64.replace(/(.{64})/g, '$1\n').replace(/\n$/, '')
    + '\n-----END CERTIFICATE-----\n';
  const yaprak = new X509Certificate(yaprakPem);
  ok(!!yaprak.raw, 'sunucu yaprak sertifikasını sunuyor');
  ok(yaprak.verify(kok.publicKey), 'yaprak sertifika kok tarafindan DOGRULANDI');
  ok(yaprak.issuer.replace(/\s+/g, ' ') === kok.subject.replace(/\s+/g, ' '),
    'yaprak issuer\'i kok subject ile birebir ayni',
    `yaprak: ${yaprak.issuer.replace(/\n/g, ' ')} | kok: ${kok.subject.replace(/\n/g, ' ')}`);

  // --- 3) KAMERA ON KOSULU ---------------------------------------------
  const uygulama = await istek('https', HTTPS_PORT, '/telefon/');
  ok(uygulama.status === 200 && /<!doctype html>/i.test(uygulama.govde),
    'telefon uygulamasi https uzerinden sunuluyor (güvenli kaynak)');
  ok(/canli-okuma\.js/.test(uygulama.govde), 'uygulama canli okuma eklentisini iceriyor');
  const eklenti = await istek('https', HTTPS_PORT, '/telefon/canli-okuma.js');
  ok(eklenti.status === 200 && /canliAc/.test(eklenti.govde), 'canli okuma eklentisi https uzerinden yukleniyor');

  // --- 4) ESLESME -------------------------------------------------------
  const es = JSON.parse((await istek('http', HTTP_PORT, '/eslesme')).govde);
  const httpsAdet = es.adaylar.filter((u) => u.startsWith('https://')).length;
  const ilkHttp = es.adaylar.findIndex((u) => u.startsWith('http://'));
  const ilkHttps = es.adaylar.findIndex((u) => u.startsWith('https://'));
  ok(httpsAdet > 0, 'eslesme https adresleri sunuyor', `${httpsAdet} adet`);
  // SIRA: http ONCE. Sertifika gerekmiyor; guvenilmeyen https ise
  // tarayicida korkutucu uyari sayfasi acyip uygulamayi engelliyor.
  ok(ilkHttp === 0,
    'http adresleri en basta (sertifika gerekmiyor, uyari sayfasi olmaz)',
    `ilk http: ${ilkHttp}, ilk https: ${ilkHttps}`);
  ok(ilkHttps > ilkHttp,
    "https adresleri http'den SONRA (yalnizca istege bagli canli onizleme)",
    `ilk https: ${ilkHttps}, ilk http: ${ilkHttp}`);

  // KALICI ADRES (QR) — olcumle dogrulanan kural:
  //   1) http olmali: sertifika gerekmiyor
  //   2) COZULEBILIR olmali: IP bicimli. Yoksa QR okutan musteri
  //      'sunucu bulunamadi' alir ve sistemi kullanamaz.
  ok(es.kaliciAdres.startsWith('http://'), 'kalici adres http (sertifika gerekmiyor)', es.kaliciAdres);
  ok(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/.test(es.kaliciAdres),
    'kalici adres COZULEBILIR bir IP (olu adres kodlanmiyor)',
    es.kaliciAdres);
  ok(!/cinarkoy-sync\.local|\.local:/.test(es.kaliciAdres),
    'kalici adres olu bir ana bilgisayar adi DEGIL (olculdu: cozulmuyor)');
  ok(es.adaylar.indexOf(es.kaliciAdres) !== -1,
    'kalici adres aday listesinde GERCEKTEN var (QR ise yarar)',
    es.kaliciAdres);
  ok(!!es.qrAdres && es.qrAdres === es.kaliciAdres,
    'sunucu QR icerigini ACIKCA bildiriyor (olculebilir, tahmin yok)',
    String(es.qrAdres));
  ok(!!es.https && es.https.dogrulandi === true, 'eslesme sertifika dogrulama sonucunu bildiriyor', JSON.stringify(es.https && es.https.dogrulamaHatalari));
  ok(!!es.qrSvg && es.qrSvg.includes('svg'), 'eslesme QR hala uretiliyor');

  // --- 5) DURUM ---------------------------------------------------------
  const du = JSON.parse((await istek('http', HTTP_PORT, '/durum', { headers: { 'X-Sync-Token': TOKEN } })).govde);
  ok(du.https && du.https.aktif === true, 'durum https sunucusunu aktif bildiriyor');
  ok(du.https.port === HTTPS_PORT, 'durum https portunu bildiriyor', String(du.https && du.https.port));
  ok(typeof du.https.kokParmakIzi === 'string' && du.https.kokParmakIzi.length > 20, 'durum kok parmak izini bildiriyor');
  ok(Array.isArray(du.adresler) && du.adresler.every((u) => u.startsWith('http://')), 'eski http adresleri durumda duruyor (uyumluluk)');

  // --- 6) KOK.cer -------------------------------------------------------
  // ÖLÇÜLEN DEĞİŞİKLİK: bu uç varsayılan olarak DER (ikili) döndürüyor;
  // PEM gövdeli .cer dosyası iOS'ta kurulum profilinden ayırt edilemiyordu.
  // İkisi de sunulur ve aynı sertifikadır.
  const cer = await istekHam('http', HTTP_PORT, '/kurulum/kok.cer');
  ok(cer.status === 200, 'kok sertifika indirilebiliyor', 'HTTP ' + cer.status);
  ok(/attachment/.test(cer.basliklar['content-disposition'] || ''), 'dosya olarak indiriliyor (telefona kurulacak)');
  ok(cer.basliklar['content-type'] === 'application/x-x509-ca-cert', 'dogru icerik turu', cer.basliklar['content-type']);
  ok(cer.basliklar['x-icerik-tipi'] === 'DER', 'varsayilan bicim DER olarak bildiriliyor', cer.basliklar['x-icerik-tipi']);
  const kok1 = new X509Certificate(cer.govde).fingerprint256;
  const cerPem = await istekHam('http', HTTP_PORT, '/kurulum/kok.cer?format=pem');
  ok(cerPem.govde.includes('BEGIN CERTIFICATE'), 'PEM bicimi ?format=pem ile sunuluyor');
  const kokPemDer = new X509Certificate(cerPem.govde).fingerprint256;
  ok(kok1 === kokPemDer, 'DER ve PEM ayni sertifika (parmak izi esit)');

  // --- 7) VERI KLASORU --------------------------------------------------
  for (const f of ['kok-ca.pem', 'kok-ca.key', 'sunucu.pem', 'sunucu.key', 'sunucu-san.json']) {
    ok(fs.existsSync(path.join(VERI, f)), `veri klasorunde ${f} var`);
  }
  ok(fs.readFileSync(path.join(VERI, 'kok-ca.key'), 'utf8').includes('PRIVATE KEY'), 'kok anahtari gecerli PEM');
  const sanKayit = JSON.parse(fs.readFileSync(path.join(VERI, 'sunucu-san.json'), 'utf8'));
  ok(sanKayit.dns.includes('cinarkoy-sync.local'), 'SAN listesinde kalici DNS adi var (IP degisince bozulmaz)', JSON.stringify(sanKayit.dns));
  ok(sanKayit.ip.includes('127.0.0.1'), 'SAN listesinde 127.0.0.1 var');
  // Yaprak gercekten kayitli SAN'lari kapsiyor mu?
  ok(yaprak.subjectAltName.includes('IP Address:127.0.0.1'), 'yaprak SAN listesinde 127.0.0.1 var', yaprak.subjectAltName);
  ok(/DNS:cinarkoy-sync\.local/.test(yaprak.subjectAltName), 'yaprak SAN listesinde cinarkoy-sync.local var', yaprak.subjectAltName);

  // --- 8) YENIDEN BASLAT: KOK AYNI KALMALI ----------------------------
  try { cocuk.kill(); } catch {}
  await bekle(1800);
  cocuk = baslat();
  await ayaktaOle(cocuk);
  await bekle(1500);
  const kok2 = new X509Certificate((await istekHam('http', HTTP_PORT, '/kurulum/kok.cer')).govde);
  ok(kok2.fingerprint256 === kok1,
    'yeniden baslatma sonrasi kok CA BIREBIR AYNI (telefonda tekrar kurulum GEREKMEZ)',
    `${kok1} != ${kok2.fingerprint256}`);
  const s2 = await istek('https', HTTPS_PORT, '/saglik');
  ok(s2.status === 200, 'yeniden baslatma sonrasi https yine calisiyor');
  try { cocuk.kill(); } catch {}

  console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
  console.log('\n--- sunucu günlüğü (https/kök satırları) ---');
  gunluk.split('\n').filter((l) => /HTTPS|[Kk][öo]k/.test(l)).slice(0, 12).forEach((l) => console.log('  ' + l.trim()));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('TEST ÇÖKTÜ:', e.stack || e);
  console.log(gunluk);
  process.exit(1);
});
