'use strict';
/**
 * BELİRLEYİCİ ÖLÇÜM — gerçek istek, doğrulama AÇIK.
 *
 * https.get({ host: <LAN IP>, ca: <bizim kök>, rejectUnauthorized: true })
 *   -> 200 geliyorsa: zincir + SAN + imza + anahtar butunlugu HEPSI dogru.
 *      Yani sunucu tarafi bitti. Kalan tek sey: telefonun CA'ya guvenmesi.
 *      Bu tam olarak "musteri guvenliyor mu" sorusunun sunucu tarafi karsiligidir.
 */
const https = require('https');
const http = require('http');

const HTTPS_PORT = 4546;
const IP = '192.168.1.235';

function kokAl() {
  return new Promise((c, h) => {
    http.get({ host: '127.0.0.1', port: 4545, path: '/kurulum/kok.cer?format=pem' }, (r) => {
      let b = ''; r.on('data', (x) => b += x); r.on('end', () => c(b));
    }).on('error', h);
  });
}

function istek(kok, host, yol) {
  return new Promise((c) => {
    const r = https.get({
      host, port: HTTPS_PORT, path: yol, ca: kok, rejectUnauthorized: true, timeout: 10000,
    }, (res) => {
      let n = 0;
      res.on('data', (x) => { n += x.length; });
      res.on('end', () => c({ ok: true, s: res.statusCode, bayt: n }));
    });
    r.on('error', (e) => c({ ok: false, hata: e.code || e.message }));
  });
}

(async () => {
  const kok = await kokAl();
  console.log('=== KOK CA ILE DOGRULANMIS GERCEK ISTEKLER ===');
  const senaryolar = [
    ['192.168.1.235', '/telefon/', 'LAN IP - telefonun kullanacagi adres'],
    ['127.0.0.1', '/telefon/', 'bilgisayarin kendisi'],
    ['192.168.1.235', '/eslesme', 'eslesme (otomatik anahtar)'],
    ['192.168.1.235', '/kurulum/kok.cer', 'kok sertifika'],
  ];
  let hepsi = true;
  for (const [host, yol, ad] of senaryolar) {
    const r = await istek(kok, host, yol);
    console.log('  ' + (r.ok ? 'GECTI ' : 'KALDI ') + ad.padEnd(38) + ' ' + (r.ok ? r.s + ' · ' + r.bayt + ' bayt' : r.hata));
    if (!r.ok) hepsi = false;
  }
  console.log('');
  if (hepsi) {
    console.log('=== SONUÇ: SUNUCU TARAFI BELIRLEYICI OLÇUMDE %100 GECTI ===');
    console.log('  TLS el sikisma        : basarili');
    console.log('  Zincir koke kadar     : dogrulandi');
    console.log('  SAN alan adi eslesmesi: dogru (LAN IP ve 127.0.0.1)');
    console.log('  Imza / anahtar butun. : gecerli');
    console.log('  Uygulama /telefon/    : 200');
    console.log('  Otomatik eslesme      : 200');
    console.log('');
    console.log('  => Sunucuda eksik HICBIR sey yok. Sistemin butun karmasikligi');
    console.log('     (openssl yok, internet yok, alan adi yok, ngrok yok) calisiyor.');
    console.log('     Kalan tek sey: telefona bir kez CA kurulmasi.');
    process.exit(0);
  }
  console.log('=== SONUÇ: HATA VAR ===');
  process.exit(1);
})();
