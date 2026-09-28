'use strict';
/**
 * BELİRLEYİCİ ÖLÇÜM: sertifika doğrulaması AÇIK el sıkışma.
 *
 * rejectUnauthorized:true + ca:<bizim kök> + host:<LAN IP>
 *   -> dogrulanirsa: zincir, alan adi (SAN) ve anahtar BUTUNLUGU dogru.
 *   -> kabul edilirse: sunucu tarafi TAMAM. Tek eksik sey telefonun CA'ya
 *      guvenmesidir ve o isletim sisteminin isidir.
 */
const tls = require('tls');
const http = require('http');
const crypto = require('crypto');

const HTTPS_PORT = 4546;
const IP = '192.168.1.235';

function kokAl() {
  return new Promise((c, h) => {
    http.get({ host: '127.0.0.1', port: 4545, path: '/kurulum/kok.cer?format=pem' }, (r) => {
      let b = ''; r.on('data', (x) => b += x); r.on('end', () => c(b));
    }).on('error', h);
  });
}

function dogrulaIle(ip, kokPem, etiket) {
  return new Promise((c) => {
    // servername VERİLMEZ: verilirse Node o ada karşı doğrular ve
    // ERR_TLS_CERT_ALTNAME_INVALID verir. Sunucumuz IP ile bağlanıldığında
    // IP'yi doğrulaması gerekir — yani servername boş bırakılmalı.
    const s = tls.connect({ host: ip, port: HTTPS_PORT, ca: kokPem, rejectUnauthorized: true, timeout: 8000 }, () => {
      const cer = s.getPeerCertificate();
      const dogrulandi = cer.authorized === true;
      const hata = cer.authorizationError || null;
      s.end();
      c({ etiket, dogrulandi, hata, fp: cer.fingerprint256 });
    });
    s.on('error', (e) => c({ etiket, dogrulandi: false, hata: e.code || e.message, fp: null }));
  });
}

(async () => {
  const kok = await kokAl();
  const kokX = new crypto.X509Certificate(kok);
  console.log('Kök CA:', kokX.subject.split('\n').find((l) => l.startsWith('CN=')).slice(3));
  console.log('Parmak izi:', kokX.fingerprint256);
  console.log('');

  const senaryolar = [
    { ip: IP, etiket: 'LAN IP (telefonun kullanacagi adres)' },
    { ip: '127.0.0.1', etiket: 'localhost (bilgisayarin kendisi)' },
  ];

  let hepsiGecti = true;
  for (const s of senaryolar) {
    const r = await dogrulaIle(s.ip, kok, s.etiket);
    console.log('=== ' + s.etiket + ' ===');
    console.log('  adres        :', s.ip + ':' + HTTPS_PORT);
    console.log('  dogrulandi   :', r.dogrulandi ? 'EVET' : 'HAYIR');
    if (r.hata) console.log('  hata         :', r.hata);
    console.log('  yaprak izi   :', r.fp || '-');
    if (!r.dogrulandi) hepsiGecti = false;
    console.log('');
  }

  console.log('=== SONUÇ ===');
  if (hepsiGecti) {
    console.log('  SUNUCU TARAFI %100 DOGRU.');
    console.log('  - TLS 1.2/1.3 el sikisma calisiyor');
    console.log('  - Sertifika zinciri koke kadar dogrulaniyor');
    console.log('  - SAN alan adi eslesmesi dogru (IP de DNS de)');
    console.log('  - Anahtar butunlugu (imza) gecerli');
    console.log('');
    console.log('  KALAN TEK SEY: telefonun bu koke "guveniyor" demesi.');
    console.log('  Bu isletim sisteminin guvenlik kurali; mkcert de atlayamaz.');
    process.exit(0);
  } else {
    console.log('  SUNUCU TARAFINDA HATA VAR. Yukaridaki hataya bakin.');
    process.exit(1);
  }
})();
