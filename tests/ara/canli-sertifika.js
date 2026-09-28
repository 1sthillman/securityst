'use strict';
/**
 * Canli sunucunun GERCEKTEN servis ettigi sertifikayi olcer.
 * Onceki olcum hataliydi: getPeerCertificate() tek sertifika icin
 * subjectAltName alanini dondurmeyebiliyor. Bu yuzden ham DER alinip
 * X509Certificate ile ayristiriliyor.
 */
const tls = require('tls');
const crypto = require('crypto');
const fs = require('fs');

const PORT = 4546;
const IP = '192.168.1.235';

function olc(host, port) {
  return new Promise((c, h) => {
    const s = tls.connect({ host, port, rejectUnauthorized: false }, () => {
      // Sunucunun gonderdigi ham sertifika (PEM)
      const pem = s.getPeerCertificate().raw ? null : null;
      s.end();
      c({ s, pem });
    });
    s.on('error', h);
  });
}

(async () => {
  // 1) openssl ile ham zinciri yaz (bagimsiz arac, en guvenilir yol)
  const { execFileSync } = require('child_process');
  const s = tls.connect({ host: IP, port: PORT, rejectUnauthorized: false }, () => {
    const cer = s.getPeerCertificate();
    console.log('=== CANLI SUNUCUNUN SERVIS ETTIGI SERTIFIKA ===');
    console.log('  konu        :', JSON.stringify(cer.subject));
    console.log('  veren       :', JSON.stringify(cer.issuer));
    console.log('  subjectAltName alani:', JSON.stringify(cer.subjectAltName));
    console.log('  (yukaridaki bos ise alan gelmiyor demektir; asil olcum bir sonraki blok)');
    s.end();
  });
  s.on('error', (e) => { console.error('TLS HATASI:', e.message); process.exit(1); });

  s.on('close', () => {
    // 2) Bagimsiz dogrulama: openssl yok -> Windows certutil ile dogrula,
    //    sertifikayi diske yazip X509Certificate ile ayristir.
    const s2 = tls.connect({ host: IP, port: PORT, rejectUnauthorized: false }, () => {
      const cer = s2.getPeerCertificate();
      if (!cer || !cer.raw) { console.log('  sertifika alinamadi'); s2.end(); return; }
      const pem = '-----BEGIN CERTIFICATE-----\n'
        + cer.raw.toString('base64').replace(/(.{64})/g, '$1\n')
        + '\n-----END CERTIFICATE-----\n';
      fs.writeFileSync('C:/Users/minif/AppData/Local/Temp/opencode/canli-yaprak.pem', pem, 'utf8');
      const X = new crypto.X509Certificate(pem);
      console.log('');
      console.log('=== AYRIŞTIRILMIŞ SERTİFİKA (ham DER\'den) ===');
      console.log('  konu :', X.subject.replace(/\n/g, ' | '));
      console.log('  veren:', X.issuer.replace(/\n/g, ' | '));
      console.log('  SAN  :', JSON.stringify(X.subjectAltName));
      const ipler = (X.subjectAltName || '').split(',').map((t) => t.trim()).filter((t) => /^IP Address:/.test(t));
      const dnsler = (X.subjectAltName || '').split(',').map((t) => t.trim()).filter((t) => /^DNS:/.test(t));
      console.log('  IP   :', JSON.stringify(ipler));
      console.log('  DNS  :', JSON.stringify(dnsler));
      console.log('');
      console.log('=== SONUÇ: ' + IP + ' ADRESİ İÇİN GEÇERLİ Mİ? ===');
      console.log('  IP SAN içinde:', ipler.includes('IP Address:' + IP) ? 'EVET' : 'HAYIR');
      console.log('  -> Bu olmadan tarayıcı ERR_CERT_COMMON_NAME_INVALID verir.');
      s2.end();
    });
    s2.on('error', (e) => { console.error('TLS HATASI 2:', e.message); process.exit(1); });
  });
})();
