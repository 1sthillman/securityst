'use strict';
/**
 * HTTPS yolunu UÇTAN UCA ÖLÇER.
 * Hiçbir şey varsayılmaz: her şey canlı sunucudan okunur.
 */
const https = require('https');
const http = require('http');
const tls = require('tls');

const HTTP_PORT = 4545;
const HTTPS_PORT = 4546;

function get(port, yol, tlsMi) {
  return new Promise((c, h) => {
    const mod = tlsMi ? https : http;
    const r = mod.request({ host: '127.0.0.1', port, path: yol, rejectUnauthorized: false, timeout: 8000 }, (res) => {
      let b = Buffer.alloc(0);
      res.on('data', (x) => { b = Buffer.concat([b, x]); });
      res.on('end', () => c({ s: res.statusCode, b, tip: res.headers['content-type'] }));
    });
    r.on('error', h); r.end();
  });
}

(async () => {
  console.log('=== 1) TLS EL SIKIŞMASI (düz IP, kendi sertifikamız) ===');
  const ham = await new Promise((c, h) => {
    const s = tls.connect({ host: '127.0.0.1', port: HTTPS_PORT, rejectUnauthorized: false, servername: '192.168.1.235' }, () => {
      const x = s.getPeerCertificate();
      s.end();
      c(x);
    });
    s.on('error', h);
  });
  console.log('  el sıkışma      : BAŞARILI');
  console.log('  konu (CN)       :', ham.subject && ham.subject.CN);
  console.log('  veren (CN)      :', ham.issuer && ham.issuer.CN);
  console.log('  geçerli mi      :', ham.valid_to ? 'var' : 'YOK');
  console.log('  SAN IP          :', JSON.stringify((ham.subjectAltName || '').split(',').map((s) => s.trim()).filter((s) => /^IP:/.test(s))));
  console.log('  SAN DNS         :', JSON.stringify((ham.subjectAltName || '').split(',').map((s) => s.trim()).filter((s) => /^DNS:/.test(s))));

  console.log('');
  console.log('=== 2) HTTPS ÜZERİNDEN UYGULAMA ===');
  const tel = await get(HTTPS_PORT, '/telefon/', true);
  console.log('  /telefon/       :', tel.s, tel.b.length, 'bayt');
  const durum = await get(HTTPS_PORT, '/durum', true);
  const dj = JSON.parse(durum.b);
  console.log('  https.dogrulandi:', dj.https && dj.https.dogrulandi);
  console.log('  birincilIp       :', dj.https && dj.https.birincilIp);
  console.log('  surum            :', dj.surum);

  console.log('');
  console.log('=== 3) KÖK SERTİFİKA (telefonun kuracağı) ===');
  const kok = await get(HTTP_PORT, '/kurulum/kok.cer');
  console.log('  HTTP durumu     :', kok.s);
  console.log('  content-type    :', kok.tip);
  console.log('  boyut           :', kok.b.length, 'bayt');
  const ilkBayt = kok.b[0];
  const tur = ilkBayt === 0x30 ? 'PEM/DER içinde ASN.1 SEQUENCE' : '?';
  console.log('  ilk bayt        : 0x' + ilkBayt.toString(16), '(' + tur + ')');
  // PEM mi DER mi? iOS DER(=.cer) tercih eder; PEM de çalışır ama uyarı verir.
  const metin = kok.b.toString('latin1');
  const pemMi = metin.indexOf('-----BEGIN') === 0;
  console.log('  format          :', pemMi ? 'PEM' : 'DER (iOS/Android için doğru)');
  // X.509 olarak ayrıştır
  const X = new (require('crypto').X509Certificate)(pemMi ? kok.b.toString('utf8') : kok.b);
  console.log('  konu (CN)       :', X.subject.replace(/\n/g, ' | '));
  console.log('  CA mi           :', X.ca ? 'EVET (kök CA)' : 'HAYIR');
  console.log('  geçerlilik      :', X.validFrom, '->', X.validTo);
  console.log('  parmak izi      :', X.fingerprint256);

  console.log('');
  console.log('=== 4) KARAR: KULLANICIYA NE YAPTIRILIYOR? ===');
  console.log('  Sunucu hazır    : EVET (el sıkışma çalışıyor, sertifika üretilmiş)');
  console.log('  Kök indirilebilir:', kok.s === 200 && X.ca ? 'EVET' : 'HAYIR');
  console.log('  iPhone adımı    : 1) dosyayı aç 2) Ayarlar>Genel>Hakkında>');
  console.log('                     Sertifika Güven Ayarları > tam güven  (2 dokunuş)');
  console.log('  Android adımı   : 1) dosyayı aç 2) Kur  (Chrome user CA\'ya güvenir)');
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
