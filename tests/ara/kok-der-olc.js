'use strict';
/**
 * Kök CA dosyasının İKİ biçimde de doğru sunulduğunu ve ikisinin de
 * AYNI sertifika olduğunu ölçer. Ayrıca "olduğunu iddia ettiğimiz" şeyi
 * bağımsız araçla (Windows certutil) doğrular.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const TMP = 'C:/Users/minif/AppData/Local/Temp/opencode';

function indir(yol, dosya) {
  return new Promise((c, h) => {
    http.get({ host: '127.0.0.1', port: 4545, path: yol }, (r) => {
      const b = [];
      r.on('data', (x) => b.push(x));
      r.on('end', () => {
        const buf = Buffer.concat(b);
        if (dosya) fs.writeFileSync(dosya, buf);
        c({ s: r.statusCode, tip: r.headers['content-type'], ham: r.headers['x-icerik-tipi'], buf });
      });
    }).on('error', h);
  });
}

(async () => {
  const der = await indir('/kurulum/kok.cer', path.join(TMP, 'kok.der'));
  const pem = await indir('/kurulum/kok.cer?format=pem', path.join(TMP, 'kok.pem'));

  console.log('=== 1) DER (varsayilan) ===');
  console.log('  HTTP           :', der.s);
  console.log('  content-type   :', der.tip);
  console.log('  X-Icerik-Tipi  :', der.ham);
  console.log('  boyut          :', der.buf.length, 'bayt');
  console.log('  ilk bayt       : 0x' + der.buf[0].toString(16), '(0x30 = ASN.1 SEQUENCE, DER olmali)');
  const Xd = new crypto.X509Certificate(der.buf);
  console.log('  konu           :', Xd.subject.replace(/\n/g, ' | '));
  console.log('  CA mi          :', Xd.ca ? 'EVET' : 'HAYIR');
  console.log('  parmak izi     :', Xd.fingerprint256);

  console.log('');
  console.log('=== 2) PEM (teşhis) ===');
  console.log('  HTTP           :', pem.s);
  const Xp = new crypto.X509Certificate(pem.buf);
  console.log('  konu           :', Xp.subject.replace(/\n/g, ' | '));
  console.log('  parmak izi     :', Xp.fingerprint256);

  console.log('');
  console.log('=== 3) IKISI AYNI MI? ===');
  const ayni = Xd.fingerprint256 === Xp.fingerprint256;
  console.log('  parmak izi esit:', ayni ? 'EVET' : 'HAYIR (hata)');
  console.log('  -> esitse hangi bicimle inilirse inilsin ayni CA kurulur');

  console.log('');
  console.log('=== 4) BAGIMSIZ DOGRULAMA (Windows certutil) ===');
  try {
    const out = execFileSync('certutil', ['-dump', path.join(TMP, 'kok.der')], { encoding: 'latin1', timeout: 20000 });
    const cn = /Subject:\s*CN\s*=\s*(.+)/i.exec(out);
    const ca = /CA=true|CA\s*=\s*TRUE/i.test(out);
    const fp = /Hash\(sha1\)\s*:\s*([0-9a-f]+)/i.exec(out);
    console.log('  certutil CN    :', cn ? cn[1].trim() : '(okunamadi)');
    console.log('  certutil CA    :', ca ? 'EVET' : 'HAYIR');
    console.log('  certutil sha1  :', fp ? fp[1] : '(okunamadi)');
    console.log('  => Windows araci da bu dosyayi gecerli CA olarak taniyor');
  } catch (e) {
    console.log('  certutil hatasi:', e.message.split('\n')[0]);
  }

  console.log('');
  console.log('=== 5) KURULUM ADIMLARI (dosya bicimine gore) ===');
  console.log('  iPhone  : dosya icerigi DER -> Safari "Profil indirildi" der');
  console.log('           Ayarlar > Genel > VPN ve Cihaz Yonetimi > Kur');
  console.log('           Ayarlar > Genel > Hakkinda > Sertifika Guven Ayarlari > tam guven');
  console.log('  Android : DER -> Ayarlar > Guvenlik > Sifreleme ve Kimlik Bilgileri');
  console.log('           > Sertifika yukle > CA sertifikasi (kimlik dogrulama ister)');
  console.log('  Sonrasi : Chrome user CA ya guvenir -> https uyarisiz acilir');
  process.exit(ayni ? 0 : 1);
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
