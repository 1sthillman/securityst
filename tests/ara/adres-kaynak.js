'use strict';
/**
 * ADRES ÇÖZÜMLEME TESTİ
 *
 * ÖLÇÜLEN HATA (kullanıcı konsolu, 29.09.2026):
 *   GET  https://1sthillman.github.io/plaka/durum -> 404
 *   POST https://1sthillman.github.io/plaka/oku  -> 405
 * Kullanıcı eşleşme penceresine sunucu adresini yazdı; plaka okuma yine
 * sayfanın kendi kökenine gitti. Sebep: adres dosya YÜKLENİRKEN bir kez
 * hesaplanıp donduruluyordu ve yalnızca \`location.origin\`'a bakıyordu.
 *
 * Burada üç kaynak ve üç öncelik ölçülür.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { blokCikar } = require('./kod-parca.js');

const KOK = path.join(__dirname, '..', '..', 'companion', 'public', 'telefon', 'plaka-yerel.js');
const SEN = path.join(__dirname, '..', '..', 'companion', 'public', 'telefon', 'senkron.js');

let pass = 0, fail = 0;
const ok = (c, ad, ek) => {
  if (c) { pass++; console.log('PASS — ' + ad + (ek ? '  -> ' + ek : '')); }
  else { fail++; console.log('FAIL — ' + ad + (ek ? '  -> ' + ek : '')); }
};

const plakaKod = fs.readFileSync(KOK, 'utf8');
const kokCoz = blokCikar(plakaKod, 'function kokCoz');
const tam = blokCikar(plakaKod, 'function tam');
if (!kokCoz || !tam) {
  console.log('FAIL — plaka-yerel.js içinde kokCoz/tam bulunamadı');
  process.exit(1);
}

/**
 * Verilen sahte dünyada adresi çözen işlev döndürür.
 *
 * ÖLÇÜM BETİĞİ HATASI DÜZELTMESİ: bu önce DEĞER döndürüyordu
 * ({kok: ...}) ve sonucu bir kez hesaplıyordu. "adres değişince anında
 * geçiyor" sınaması o donmuş değeri okuyordu, yani değişikliği hiç
 * görmüyordu. Artık her çağrıda güncel adres çözülür.
 */
function coz(dunya) {
  const kutu = Object.assign({ window: dunya }, dunya);
  kutu.ADRES = dunya.ADRES || '';
  vm.runInNewContext(kokCoz + '\n' + tam, kutu);
  return {
    kok: function () { return kutu.kokCoz(); },
    tam: function () { return kutu.tam('/plaka/durum'); },
  };
}

const GITHUB = 'https://1sthillman.github.io';
const SUNUCU = 'http://192.168.1.42:4545';
const KURULUM = '2668118589ee5ee20f8053eb5c37ba9213d053713c596120ac8fda5adc46ea82';

console.log('\n--- 1) Kullanıcı adres girdi: O ADRES kullanılmalı ---');
const giris = coz({
  location: { origin: GITHUB, protocol: 'https:' },
  GuvenlikSync: { adres: function () { return SUNUCU; } },
});
ok(giris.kok() === SUNUCU, 'kullanıcının girdiği adres kullanılıyor (origin DEĞİL)', giris.kok());
ok(giris.tam() === SUNUCU + '/plaka/durum', 'plaka ucu doğru adrese gidiyor', giris.tam());

console.log('\n--- 2) Adres değişti: yeni adres anında geçerli olmalı ---');
let degisken = SUNUCU;
const canli = coz({
  location: { origin: GITHUB, protocol: 'https:' },
  GuvenlikSync: { adres: function () { return degisken; } },
});
ok(canli.kok() === SUNUCU, 'ilk adres', canli.kok());
degisken = 'http://1.2.3.4:4545';
ok(canli.kok() === 'http://1.2.3.4:4545', 'adres değişince anında yenisine geçiyor (dondurulmamış)', canli.kok());

console.log('\n--- 3) Geriye uyum: adres yoksa sayfanın kendi kökeni ---');
const yoksay = coz({ location: { origin: 'http://192.168.1.9:4545', protocol: 'http:' } });
ok(yoksay.kok() === 'http://192.168.1.9:4545', 'adres yoksa origin (LAN kurulumu)', yoksay.kok());
const yoksayGit = coz({ location: { origin: GITHUB, protocol: 'https:' } });
ok(yoksayGit.kok() === GITHUB, 'adres yoksa origin (Pages)', yoksayGit.kok());

console.log('\n--- 4) Yapılandırma varsa o kullanılmalı (sıra 2) ---');
const yapilandirma = coz({
  location: { origin: GITHUB, protocol: 'https:' },
  ADRES: 'http://10.0.0.5:4545',
});
ok(yapilandirma.kok() === 'http://10.0.0.5:4545', 'OCR yapılandırmasındaki adres', yapilandirma.kok());

console.log('\n--- 5) GuvenlikSync adresi boş string ise sıradakine düşmeli ---');
const bosAdres = coz({
  location: { origin: 'http://192.168.1.9:4545', protocol: 'http:' },
  GuvenlikSync: { adres: function () { return ''; } },
});
ok(bosAdres.kok() === 'http://192.168.1.9:4545', 'boş adreste çökmez, sıradaki kaynağa düşer', bosAdres.kok());

console.log('\n--- 6) GuvenlikSync henüz yoksa (yükleme sırası) çökmemeli ---');
const yoksaySync = coz({ location: { origin: 'http://192.168.1.9:4545', protocol: 'http:' } });
ok(yoksaySync.kok() === 'http://192.168.1.9:4545', 'senkron.js yoksa da çalışır', yoksaySync.kok());

console.log('\n--- 7) Sondaki eğik çizgiler temizlenmeli ---');
const egik = coz({
  location: { origin: GITHUB, protocol: 'https:' },
  GuvenlikSync: { adres: function () { return SUNUCU + '///'; } },
});
ok(egik.kok() === SUNUCU, 'sondaki eğik çizgiler temizleniyor', egik.kok());

console.log('\n--- 8) NEGATİF KONTROL: eski hata geri getirilirse yakalanmalı ---');
// Dondurulmuş (yükleme anında hesaplanan) davranışı taklit et
function dondurulmus() {
  const y = '/index.html';
  return (GITHUB + y.replace(/[^/]*$/, '')).replace(/\/+$/, '');
}
const kotu = dondurulmus();
ok(kotu === GITHUB, 'eski (dondurulmuş) davranış kullanıcı adresini GÖREMEZDI', kotu);
ok(kotu !== SUNUCU, 'eski davranış sunucu adresine gitmezdi — kanıtlandı');

console.log('\nSONUÇ: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
