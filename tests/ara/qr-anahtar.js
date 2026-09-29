'use strict';
/**
 * tests/ara/qr-anahtar.js
 *
 * KULLANICI BILDIRIMI (29.09.2026):
 *   "Adres bulundu ama anahtar alınamadı ... aynı Wi-Fi'ye bağlı mısınız diyor
 *    ama aynı Wi-Fi'ye bağlıyız ... sonra QR'ı okuttum, şimdi bağlandı,
 *    çok garip ya"
 *
 * KÖK NEDEN (phone/guvenlik-sync.js, `qrAdresAyikla`):
 *   // #token=... veya ?token=... kısmını at
 *   s = s.split('#')[0].split('?')[0];
 *   QR kurulum anahtarını TAŞIYOR (ölçüldü, tarayıcıda çözüldü):
 *       http://192.168.1.235:4577#token=<64 haneli>
 *   ama adres ayıklarken anahtar SİLİNİYORDU. Eşleşme penceresi sonra
 *   anahtarı AĞDAN istiyordu (fetch(adres + '/eslesme')). Bu istek https
 *   sayfadan http adrese yapıldığı için tarayıcı HİÇ GÖNDERMEDEN
 *   engelliyordu (karşılaştırmalı içerik) → "anahtar alınamadı". Aynı Wi-Fi
 *   olmak bu sonucu DEĞİŞTİRMEZ; o yüzden mesaj yanıltıcıydı.
 *
 * ---------------------------------------------------------------------------
 * ÖLÇÜM BETİĞİ TUZAĞI — YORUM AYIKLAMA (3. kez, artık kural):
 *   Bu test önce `kod = kaynak.replace(/\/\*[\s\S]*?\*\//g, '')` ile
 *   yorumları siliyordu. Ölçüldü: 50.991 karakterlik dosyadan 16.502
 *   karakter SİLİNDİ — yani GERÇEK KOD yutuldu. Sonuç: `fetch` kayboldu,
 *   `gsync-tok` kaldı; test kod VARKEN "yok" dedi.
 *   Neden: dosyada bir dizge/regex içinde geçen blok yorum başlaticısı
 *   sahte bir blok yorum açıyor, bir sonraki bitişe kadar GERÇEK kod
 *   siliniyor.
 *   KURAL: bu testte yorum ayıklanmaz. Yapısal denetimler yalnızca KODA
 *   ÖZGÜ işaretlerle yapılır (yorumlarda geçmeyen dizeler).
 *   Fonksiyon gövdesi çıkarımı `blokCikar` ile HAM metin üzerinden yapılır.
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const { blokCikar } = require('./kod-parca.js');
const KOK = 'C:/syncserver';
const KAYNAK = path.join(KOK, 'phone/guvenlik-sync.js');
const URETILEN = path.join(KOK, 'companion/public/telefon/senkron.js');

let gecti = 0, kaldi = 0;
function ok(ad, kosul, ayrinti) {
  if (kosul) { gecti++; console.log('  ok   ' + ad); }
  else { kaldi++; console.log('  FAIL ' + ad + (ayrinti ? ' :: ' + ayrinti : '')); }
}

const kaynak = fs.readFileSync(KAYNAK, 'utf8');   // HAM — yorum ayıklanmaz

console.log('\n== 1) qrTokenAyikla gercek QR metninden anahtar cikarıyor ==');
const govde = blokCikar(kaynak, 'function qrTokenAyikla');
ok('qrTokenAyikla tanimli', !!govde);
if (govde) {
  const fn = new Function(govde + '\nreturn qrTokenAyikla;')();
  const GERCEK = 'http://192.168.1.235:4577#token=dc8f50062623206d9f3e81bd0c9684ad119e1e0176c5a078f0223b297a7dae3f';
  const ANAHTAR = 'dc8f50062623206d9f3e81bd0c9684ad119e1e0176c5a078f0223b297a7dae3f';
  const cikan = fn(GERCEK);
  ok('gercek QR metninden 64 haneli anahtar cikti', cikan === ANAHTAR, 'cikan: ' + cikan);
  ok('anahtar uzunlugu 64', cikan.length === 64, 'uzunluk: ' + cikan.length);
  // --- NEGATİF KONTROLLER ---
  ok('NEGATIF: anahtarsiz metin bos doner', fn('http://192.168.1.235:4577') === '');
  ok('NEGATIF: ilgisiz metin bos doner', fn('merhaba') === '');
  ok('NEGATIF: bos girdi bos doner', fn('') === '');
  ok('NEGATIF: ?token= biçimi de calisir', fn('http://a:1?token=abc123') === 'abc123');
}

console.log('\n== 2) eslesme penceresi QR\'daki anahtari dogrudan kullanıyor ==');
ok('qrSonHam (ham metin) saklaniyor', /qrSonHam\s*=\s*String\(r\.data\)/.test(kaynak),
  'qrCokluDeneme ham metni saklamiyor');
ok('qrCoz metni donduruyor', /metin:\s*qrSonHam/.test(kaynak),
  'qrCoz yalnizca adres donduruyor olabilir');

const elde = kaynak.indexOf('var qrToken = qrTokenAyikla');
const agCagi = kaynak.indexOf("fetch(adres + '/eslesme'");
ok('qrCoz sonucundan anahtar okunuyor', elde >= 0, 'qrToken satiri yok');
ok('anahtar okunduktan SONRA ağ isteği yapılıyor (sıra doğru)',
  elde >= 0 && agCagi > elde, 'el=' + elde + ' ag=' + agCagi);

// Anahtar varsa erken dönüş: alan doldurulup return edilmeli.
const sonraki = kaynak.slice(elde, elde + 400);
ok('anahtar varsa alan dolduruluyor', /#gsync-tok[\s\S]{0,120}?=\s*qrToken/.test(sonraki) ||
  /=\s*qrToken/.test(sonraki), 'token alani doldurulmuyor');
ok('anahtar varsa ERKEN DÖNÜLÜYOR (ağ isteği yapılmıyor)',
  /if \(qrToken\) \{[\s\S]{0,300}?\breturn;/.test(sonraki), 'erken donus yok');

console.log('\n== 3) hata mesaji gercekci (ağ suclamiyor) ==');
ok('"Aynı Wi-Fi üzerinde misiniz" suylemesi kaldirildi',
  !/Aynı Wi-Fi üzerinde misiniz/.test(kaynak), 'yaniltici mesaj duruyor');
ok('basarisizlikta QR okutma oneriliyor',
  /anahtar alınamadı[^']*QR kodu okutun/.test(kaynak),
  'cifiriden bir tirnak ya da satir sonu noktalamasi degismis olabilir');

console.log('\n== 4) uretilen senkron.js guncel ==');
const uret = fs.readFileSync(URETILEN, 'utf8');
ok('senkron.js icinde qrTokenAyikla var', /function qrTokenAyikla/.test(uret),
  'uretilmis dosya guncel degil - donusturucuyu calistir');
ok('senkron.js icinde erken donus var',
  /if \(qrToken\) \{[\s\S]{0,300}?\breturn;/.test(uret), 'uretilmede eksik');
ok('senkron.js qrSonHam sakliyor', /qrSonHam\s*=\s*String\(r\.data\)/.test(uret));

console.log('\n== 5) adres ayiklama davranisi DEGISMEDI ==');
const adresGovde = blokCikar(kaynak, 'function qrAdresAyikla');
ok('qrAdresAyikla hala var', !!adresGovde);
if (adresGovde) {
  const af = new Function(adresGovde + '\nreturn qrAdresAyikla;')();
  ok('anahtarli QR adres olarak temiz adres doner',
    af('http://192.168.1.235:4577#token=abc') === 'http://192.168.1.235:4577',
    'donen: ' + af('http://192.168.1.235:4577#token=abc'));
  ok('NEGATIF: gecersiz metin null doner', af('merhaba') === null);
  ok('NEGATIF: son tire kirpilir', af('http://a:1/') === 'http://a:1');
}

console.log('\n=== ' + gecti + ' gecti, ' + kaldi + ' kaldi ===');
process.exit(kaldi ? 1 : 0);
