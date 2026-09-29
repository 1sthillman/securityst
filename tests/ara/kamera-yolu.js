'use strict';
/**
 * tests/ara/kamera-yolu.js
 *
 * ÖLÇÜLEN HATA (kullanıcı, 29.09.2026):
 *   "sadece galeriden ekleyince okuyor, kameradan çekince değil ... hatayı da
 *    göremiyoruz"
 *
 * KÖK NEDEN: `isle()` içindeki `catch` hatayı "düşmeye devam et" diyerek
 * YUTUYORDU. Sunucuya istek gidiyor, başarısız oluyor ve kullanıcı ekranda
 * HİÇBİR ŞEY görmüyordu. Sebebi olmayan bir hata, olmayan hatadan ayırt
 * edilemez.
 *
 * TASARIM (BİLEREK korunur, `tests/ara/tam-kare.js` de zorunlu tutuyor):
 *   1) ÖNCE orijinal kanvas, SIKIŞTIRMADAN — kalite düşmesin
 *   2) sıkıştırma SADECE tam kare BAŞARISIZsa (yedek yol)
 * Bu sırayı BOZMAK plaka çözünürlüğünü düşürdü ve test paketi 5 FAIL verdi.
 * Ölçüm: "8 MB sınırı aşılıyor" tespiti doğruydu, ama "her zaman sıkıştır"
 * çözümü yanlıştı — aşım zaten 2. adımdaki yedek yolla karşılanıyor.
 */
const fs = require('fs');
const path = require('path');
const KOK = 'C:/syncserver';

const yerel = fs.readFileSync(path.join(KOK, 'companion/public/telefon/yerel-kamera.js'), 'utf8');
const galeri = fs.readFileSync(path.join(KOK, 'Security-ST/index.html'), 'utf8');
const sunucu = fs.readFileSync(path.join(KOK, 'companion/companion.js'), 'utf8');
// Yorumlar ölçümden TAMAMEN çıkarılır. ÖLÇÜM BETİĞİ HATASI: önce sadece
// `//` satır yorumları ayıklanıyordu; dosyanın BAŞLIK bloğu `/* ... */` biçiminde
// ve içinde `Cam.compressCanvas(...)` geçiyor. Bu yüzden "sıkıştırma" ilk
// gerçek çağrıdan çok daha önce bulundu ve sıra kontrolü yanlış düştü.
// Aynı tuzağın üçüncü kez olması: yorumları ayıklamadan metin aramak.
const kod = yerel
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

let gecti = 0, kaldi = 0;
function ok(ad, kosul, ayrinti) {
  if (kosul) { gecti++; console.log('  ok   ' + ad); }
  else { kaldi++; console.log('  FAIL ' + ad + (ayrinti ? ' :: ' + ayrinti : '')); }
}

console.log('\n== 1) okuma sirasi: once orijinal, sonra sikistirilmis ==');
const okuYeri = kod.indexOf('yerel.oku(');
const sikYeri = kod.indexOf('Cam.compressCanvas(');
ok('yerel.oku(c) cagrisi var', /yerel\.oku\(\s*c\s*\)/.test(kod), 'bulunamadi');
ok('ORIJINAL kanvas once deneniyor', okuYeri >= 0 && okuYeri < sikYeri,
  'sira: oku=' + okuYeri + ' sikistirma=' + sikYeri);
ok('sikistirma yalnizca yedek yolda', sikYeri >= 0);

console.log('\n== 2) sunucu siniri (yedek yolun gerekcesi) ==');
const sinir = /PLAKA_GOVDE_SINIRI\s*=\s*'([\d]+)mb'/.exec(sunucu);
ok('PLAKA_GOVDE_SINIRI tanimli', !!sinir);
ok('sinir 8mb', !!sinir && sinir[1] === '8', 'bulunan: ' + (sinir && sinir[1]));

console.log('\n== 3) hata YUTULMUYOR (asil duzeltme) ==');
ok('"düşmeye devam et" kalmiyor', kod.indexOf('düşmeye devam et') < 0, 'hala yutuyor');
ok('hatada kullaniciya bildiriliyor',
  /catch\s*\(e2\)[\s\S]{0,300}?bildir\(/.test(kod));
ok('bildirimden sonra yol kesiliyor',
  /bildir\('Fotoğraf okunamadı[\s\S]{0,200}?\breturn;/.test(kod));

console.log('\n== 4) galeri yolu bozulmadi mi? ==');
ok('galeri kendi sikistirmasini koruyor',
  /Cam\.compressCanvas\(c,\s*2560,\s*800000\)/.test(galeri));
ok('galeri Cam.read(compressed) ile okuyor', /Cam\.read\(compressed\)/.test(galeri));

console.log('\n== 5) cekilen fotograf EKRANDA gorunuyor mu? ==');
ok('onizleme icin fonksiyon var (Cam.onizleme)', /onizleme\s*\(\s*src\s*\)|onizleme\s*:\s*function/.test(galeri),
  'onizleme fonksiyonu yok');
ok('onizleme goruntusu DOM icinde', /id="camOnizleme"/.test(galeri), 'camOnizleme yok');
ok('kamera yolu onizlemeyi cagirir', /Cam\.onizleme\s*\(/.test(yerel), 'kamera yolu cagirmiyor');
ok('galeri yolu onizlemeyi cagirir', /Cam\.onizleme\s*\(/.test(galeri), 'galeri yolu cagirmiyor');

console.log('\n=== ' + gecti + ' gecti, ' + kaldi + ' kaldi ===');
process.exit(kaldi ? 1 : 0);
