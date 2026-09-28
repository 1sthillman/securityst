'use strict';
// Sertifika ureticisinin BAGIMSIZ dogrulamasi. Node'un kendi X509Certificate
// ayristiricisi kullanilir; bu dosya uretir, o dogrular.
const S = require('../../companion/net/sertifika.js');
const os = require('os');

const dns = ['cinarkoy-sync.local', os.hostname().toLowerCase(), 'localhost'];
const ips = [];
for (const list of Object.values(os.networkInterfaces())) {
  for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
}
ips.push('127.0.0.1');

console.log('DNS:', dns.join(', '));
console.log('IP :', ips.join(', '));

const { kok } = S.kokUretVeyaYukle(null);   // disk yok -> bellekte uret
console.log('\nkok kaynagi:', 'bellek');
console.log('kok parmagi:', kok.parmakIzi);

const y = S.yaprakUret(kok, dns, ips);

const d = S.dogrula(kok.pemDer, y.pemDer, dns, ips);
console.log('\n--- BAGIMSIZ DOGRULAMA ---');
console.log('konu        :', d.konu.replace(/\n/g, ' | '));
console.log('kok gecerli  :', d.kokGecerlilik);
console.log('yaprak gecerli:', d.yaprakGecerlilik);
console.log('yaprak parmagi:', d.yaprakParmakIzi);
console.log('tamam       :', d.tamam);
if (d.hatalar.length) { console.log('HATALAR:'); d.hatalar.forEach((h) => console.log('  -', h)); }

// Certutil / Windows "Kok Yazma Deposu" kontrolu: PEM'i CER'e cevirip dogrula
const { execFileSync } = require('child_process');
const fs = require('fs');
const os2 = require('os');
const gecici = [];
try {
  const p = os2.tmpdir();
  const cer = p + '\\ck-test.cer';
  fs.writeFileSync(cer, kok.pemDer);
  const out = execFileSync('certutil', ['-dump', cer], { encoding: 'latin1' });
  gecici.push(cer);
  const dogru = /Subject:/i.test(out) && /Signature matches Public Key/i.test(out);
  console.log('\ncertutil -dump ayristirdi ve imzayi dogruladi:', dogru);
  const ozet = out.split('\n').filter((l) => /Subject:|Issuer:|NotBefore|NotAfter|Signature matches/.test(l));
  ozet.forEach((l) => console.log('  ', l.trim()));
  if (!dogru) { console.log('certutil ciktisi:', out.substring(0, 900)); }
} catch (e) {
  console.log('certutil kontrolu yapilamadi:', e.message);
}

// --- DOGRULAYICININ KENDISI SINANIR -------------------------------------
// "Her şey doğrulandı" çıktısı, doğru çalıştığını KANITLAMAZ. Doğrulayıcı
// yanlış girdide de hata bulmalıdır.
//
// ÖLÇÜLEN HATA (bu satırlar yazılırken): ilk hâlde iki kontrol
// YANLIŞ BEKLENİŞ ile yazılmıştı ve doğrulayıcı suçlanmıştı — oysa
// doğrulayıcı doğruydu:
//   - "IP listesi boş" denetimi YAPILACAK IP OLMADIĞI anlamına gelir,
//     hata bulunmaması doğrudur (denetleyicinin değil testin kusuru).
//   - PEM'in sonuna rastgele karakter eklemek Node'un ayrıştırıcısında
//     HATA VERMEZ; ayrıştırıcı sondaki artık veriyi yok sayar.
// Yani o iki kontrol, gerçek bir hatayı ölçmüyordu. Aşağıdaki hâlleri
// gerçekten bozan girdilerle değiştirildi.
const S2 = require('C:/syncserver/companion/net/sertifika.js');
const { X509Certificate } = require('crypto');
const kokA = S2.kokUretVeyaYukle(null).kok;
const kokB = S2.kokUretVeyaYukle(null).kok;   // FARKLI bir kök
const dogruYaprak = S2.yaprakUret(kokA, ['ornek.local'], ['10.0.0.1']);

const negatifler = [
  // a) Yanlış DNS adı iddia etmek -> kapsam hatası bulunmalı
  { ad: 'yanlış DNS', gecti: S2.dogrula(kokA.pemDer, dogruYaprak.pemDer, ['baska.local'], ['10.0.0.1']).tamam,
    kontrol: (r) => r.hatalar.some((h) => /baska\.local/.test(h)) },
  // b) Yanlış IP iddia etmek -> kapsam hatası bulunmalı
  { ad: 'yanlış IP', gecti: S2.dogrula(kokA.pemDer, dogruYaprak.pemDer, ['ornek.local'], ['10.0.0.2']).tamam,
    kontrol: (r) => r.hatalar.some((h) => /10\.0\.0\.2/.test(h)) },
  // c) BAŞKA KÖK -> imza doğrulanmamalı (en kritik kontrol)
  { ad: 'başka kök', gecti: S2.dogrula(kokB.pemDer, dogruYaprak.pemDer, ['ornek.local'], ['10.0.0.1']).tamam,
    kontrol: (r) => r.hatalar.some((h) => /DO.RULANMADI/.test(h)) },
];

let negatifHata = 0;
for (const n of negatifler) {
  const sonuc = n.gecti ? null : null;
  if (n.gecti) { negatifHata++; console.log('  HATA bulunamadı: ' + n.ad); }
  else console.log('  doğru reddedildi: ' + n.ad);
}
// d) Gerçekten bozuk girdi ayrıştırılamamalı
try {
  new X509Certificate('bu bir sertifika degil');
  negatifHata++;
  console.log('  HATA: bozuk girdi ayrıştırıldı');
} catch (e) { console.log('  doğru reddedildi: bozuk PEM'); }

if (negatifHata === 0) {
  console.log('dogrulayici negatif kontrolleri GECTI (yanlış girdide hata buluyor)');
} else {
  console.log('HATA: doğrulayıcı yanlış girdide hata BULAMADI (' + negatifHata + '). ' +
              'Bu doğrulayıcı güvenilmezdir.');
  process.exit(1);
}
process.exit(d.tamam ? 0 : 1);
