'use strict';
/**
 * Yaprak sertifika üreticisini TEK BAŞINA ölçer.
 * Amaç: SAN boşluğunun ÜRETECİDE mi yoksa ÇAĞRI NOKTASINDA mı olduğunu
 * ayırmak. Tahmin etmiyoruz — ölçüyoruz.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const s = require('C:/syncserver/companion/net/sertifika.js');

const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-san-'));
// API: kokUretVeyaYukle() -> { kok: {pemDer, anahtarPem, parmakIzi}, kaynak }
// yaprakUret() kok NESNESINI bekler, tum ciktiyi degil.
// (Ilk denemede tum ciktiyi gecirdim -> kokAdi() undefined hatasi verdi.)
const kok = s.kokUretVeyaYukle({ cert: path.join(gecici, 'kok.pem'), key: path.join(gecici, 'kok.key') }).kok;

console.log('=== A) BEKLENEN SAN ile uret (bilinen degerler) ===');
const dns = ['cinarkoy-sync.local', 'localhost'];
const ip = ['192.168.1.235', '127.0.0.1'];
const y = s.yaprakUret(kok, dns, ip);
const c = new crypto.X509Certificate(y.pemDer);
console.log('  konu      :', c.subject.replace(/\n/g, ' | '));
console.log('  SAN       :', JSON.stringify(c.subjectAltName));
console.log('  IP 192.168.1.235 iceriyor mu:', /IP Address:192\.168\.1\.235/.test(c.subjectAltName || ''));
console.log('  DNS cinarkoy-sync.local    :', /DNS:cinarkoy-sync\.local/.test(c.subjectAltName || ''));
console.log('  Node dogrulama (dogrula()) :', JSON.stringify(s.dogrula(kok.pemDer, y.pemDer, dns, ip)));

console.log('');
console.log('=== B) BOS SAN ile uret (cagri noktasi bos gelirse) ===');
const y2 = s.yaprakUret(kok, [], []);
const c2 = new crypto.X509Certificate(y2.pemDer);
console.log('  SAN       :', JSON.stringify(c2.subjectAltName), '(bos ise BOZUK)');

console.log('');
console.log('=== C) TLS UZERINDE SAN GELIYOR MU? ===');
// Canli sunucudan alinan sertifikayi dogrudan cozelim
try {
  const canli = fs.readFileSync('C:/syncserver/companion/data/sunucu.pem');
  const cl = new crypto.X509Certificate(canli);
  console.log('  canli SAN :', JSON.stringify(cl.subjectAltName));
  console.log('  canli konu:', cl.subject.replace(/\n/g, ' | '));
  const san = fs.existsSync('C:/syncserver/companion/data/sunucu-san.json')
    ? fs.readFileSync('C:/syncserver/companion/data/sunucu-san.json', 'utf8') : '(yok)';
  console.log('  san.json  :', san.substring(0, 300));
} catch (e) {
  console.log('  canli sertifika okunamadi:', e.message);
}
