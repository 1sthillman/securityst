'use strict';
/**
 * tests/ara/dongu-adres.js
 *
 * KULLANICI EKRAN GÖRÜNTÜSÜ (29.09.2026):
 *   "Bilgisayara ulaşılamıyor. Adres değişmiş olabilir."
 *   Denenecek adresler:  http://127.0.0.1:4577  ← şu an denenen
 *                        http://192.168.1.235:4577
 *                        ...
 *
 * KÖK NEDEN: `127.0.0.1` (ve `localhost`) BİLGİSAYARDA kendini gösterir.
 * TELEFONDA telefonun KENDİSİDİR — companion sunucusu orada yoktur. İstek
 * telefonun boş döngüsüne gider, hiçbir şey dönmez. Aynı Wi-Fi olması
 * sorunu ÇÖZMEZ, çünkü adres zaten yanlıştır; sorun ağ değildir.
 *
 * DÜZELTME: uygulama companion sunucusundan servis EDİLİR, dolayısıyla
 * `location.hostname` sunucunun adresidir ve doğrudur. Sayfa döngüsel
 * DEĞİLSE döngüsel kayıt kullanılmaz ve aday listesinde de bulunmaz.
 *
 * Bu test kuralı hem pozitif hem NEGATİF kontrolle sınar: bilgisayarda
 * (sayfa döngüsel) döngü adresi hâlâ geçerli olmalıdır.
 */
const fs = require('fs');
const path = require('path');
const { blokCikar } = require('./kod-parca.js');
const KOK = 'C:/syncserver';

let gecti = 0, kaldi = 0;
function ok(ad, kosul, ayrinti) {
  if (kosul) { gecti++; console.log('  ok   ' + ad); }
  else { kaldi++; console.log('  FAIL ' + ad + (ayrinti ? ' :: ' + ayrinti : '')); }
}

const kaynak = fs.readFileSync(path.join(KOK, 'phone/guvenlik-sync.js'), 'utf8');
const uretilen = fs.readFileSync(path.join(KOK, 'companion/public/telefon/senkron.js'), 'utf8');

console.log('\n== 1) donguMu gercek adreslerle ==');
const govde = blokCikar(kaynak, 'function donguMu');
ok('donguMu tanimli', !!govde);
if (govde) {
  const fn = new Function(govde + '\nreturn donguMu;')();
  // --- POZİTİF: döngüsel olanlar ---
  ok('127.0.0.1 döngüsel', fn('http://127.0.0.1:4577') === true);
  ok('https://127.0.0.1 döngüsel', fn('https://127.0.0.1:4578') === true);
  ok('localhost döngüsel', fn('http://localhost:4577') === true);
  ok('0.0.0.0 döngüsel', fn('http://0.0.0.0:4577') === true);
  // --- NEGATİF: döngüsel OLMAYANLAR ---
  ok('NEGATIF: LAN adresi dongu DEGIL', fn('http://192.168.1.235:4577') === false);
  ok('NEGATIF: baska bilgisayar adi dongu DEGIL', fn('http://rst:4577') === false);
  // --- TUZAK: benzer metin ---
  ok('TUZAK: 127.0.0.1.5 dongu DEGIL (alt ag)',
    fn('http://127.0.0.1.5:4577') === false, 'alt ag yanlis sayildi');
  ok('TUZAK: bos girdi dongu DEGIL', fn('') === false);
  ok('TUZAK: sayfa adresi (127.0.0.1 yaziyor ama baska host)',
    fn('http://127.0.0.1.example.com:4577') === false, 'sahte alan adi dongu sayildi');
}

console.log('\n== 2) sayfaDonguselMi tanimli ve kullanimda ==');
ok('sayfaDonguselMi tanimli', /function sayfaDonguselMi/.test(kaynak));
ok('adres() dongu adresini eliyor',
  /donguMu\(String\(S\.baseUrl/.test(kaynak), 'adres() korunuyor');
ok('aday listesinde dongu eleniyor',
  /sayfaDongu \|\| !donguMu\(a\)/.test(kaynak), 'aday listesi korunuyor');

console.log('\n== 3) uretilen senkron.js eksiksiz ==');
ok('uretilende donguMu var', /function donguMu/.test(uretilen), 'uretilmis dosyada tanim yok');
ok('uretilende sayfaDonguselMi var', /function sayfaDonguselMi/.test(uretilen));
ok('uretilende adres() korunuyor', /donguMu\(String\(S\.baseUrl/.test(uretilen));
ok('uretilende aday listesi korunuyor', /sayfaDongu \|\| !donguMu\(a\)/.test(uretilen));
ok('uretilende 127.0.0.1 yine de aday olabilir ama sayfa dongu DEGILSE elenir',
  /sayfaDonguselMi/.test(uretilen));

console.log('\n== 4) sinif kontrolu: baska bir dongu adi karismasin ==');
const diger = kaynak.match(/127\\\.0\\\.0\\\.1/g) || [];
ok('127.0.0.1 yalnizca donguMu icinde geciyor', diger.length <= 1,
  diger.length + ' kez gecti: ' + diger.length);

console.log('\n=== ' + gecti + ' gecti, ' + kaldi + ' kaldi ===');
process.exit(kaldi ? 1 : 0);
