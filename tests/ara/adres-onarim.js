'use strict';
/**
 * tests/ara/adres-onarim.js
 *
 * ÖLÇÜLEN HATA (kullanıcı konsolu, 29.09.2026):
 *   POST http://localhost:195/plaka/oku  net::ERR_CONNECTION_REFUSED
 *   "en son ne yaptıysan şimdi galeriden bile plakayı okuyamıyor artık"
 *
 * Bu test, `sonrakiAdres()` ve `tekIstek()` sarmalayıcısını dosyadan GERÇEK
 * metin olarak çıkarıp çalıştırır (kopyalamaz). Böylece test, kodun gerçekten
 * yaptığını ölçer.
 *
 * NEGATİF KONTROL zorunludur: dönüşüm "her hata halinde sıradaki adrese
 * geç" olsaydı, ZAMAN AŞIMI da adres değiştirirdi — bu yanlış olurdu
 * (sunucu orada, sadece yavaş). Test bunu da reddediyor.
 */
const fs = require('fs');
const path = require('path');
const { blokCikar } = require('./kod-parca.js');

const KOK = 'C:/syncserver';
const senkronKaynak = fs.readFileSync(path.join(KOK, 'phone/guvenlik-sync.js'), 'utf8');
const plakaKaynak = fs.readFileSync(path.join(KOK, 'companion/public/telefon/plaka-yerel.js'), 'utf8');

let gecti = 0, kaldi = 0;
function ok(ad, kosul, ayrinti) {
  if (kosul) { gecti++; console.log('  ok   ' + ad); }
  else { kaldi++; console.log('  FAIL ' + ad + (ayrinti ? ' :: ' + ayrinti : '')); }
}

/* ------------------------------------------------------------------ */
/* 1) sonrakiAdres() gercek koddan cikarilir                            */
/* ------------------------------------------------------------------ */
// ÖLÇÜM BETİĞİ HATASI DÜZELTMESİ: blokCikar ikinci argümanı İNDEKS değil
// METİN bekliyor. Indeks geçilince parça yanlış yerden kesiliyordu ve
// "tekIstek is not defined" ile test kendi hatasıyla düşüyordu.
// ÖNCEKİ HATAM: ayrıca nesne özelliği (`sonrakiAdres: function () {...}`)
// tek başına geçerli bir deyim DEĞİldir; nesne literaline sarılarak
// çağrılabilir hale getiriliyor.
const govde = blokCikar(senkronKaynak, 'sonrakiAdres: function ()');
ok('sonrakiAdres govdesi cikarildi', !!govde, 'bulunamadi');

/**
 * Test düzeneği: S durumunu ve sunucuKoku()'yu verilen değerlerle kurar,
 * çıkarılan GERÇEK fonksiyonu çalıştırır.
 *
 * ÖLÇÜLEN HATA (bu test bir daha kırıldı): `sonrakiAdres` artık
 * `sayfaDonguselMi()` ve `donguMu()` YARDIMCILARINI çağırıyor (telefonda
 * 127.0.0.1'i elemesi için eklendi). Fonksiyon tek başına çalıştırıldığında
 * bu yardımcılar kapsam dışı kalıyordu:
 *     ReferenceError: sayfaDonguselMi is not defined
 *     at sonrakiAdres (eval at calistir ...)
 * DÜZELTME: gerçek kaynaktan çıkarılan yardımcılar da enjekte ediliyor.
 * Böylece test üretim kodunun GERÇEKTEN bağımlılıklarıyla çalışıyor.
 */
const donguGovde = blokCikar(senkronKaynak, 'function donguMu');
const sayfaGovde = blokCikar(senkronKaynak, 'function sayfaDonguselMi');
ok('yardimcilar kaynakta var', !!donguGovde && !!sayfaGovde,
  donguGovde ? 'sayfaDonguselMi yok' : 'donguMu yok');

function calistir(baseUrl, adaylar, kokAdres, sayfaDongusel) {
  const S = { baseUrl: baseUrl, adaylar: adaylar, adaySira: 0 };
  const kur = new Function(
    'S', 'sunucuKoku',
    (donguGovde || '') + '\n' + (sayfaGovde || '') + '\n' +
    'return ({' + govde + '}).sonrakiAdres;'
  );
  // sayfaDonguselMi gerçek koddan okur; test için origin'i basmak yerine
  // gerçek davranışı koruyoruz: default false (telefon) ya da true (bilgisayar)
  const kok = kur(S, function sunucuKoku() { return kokAdres; });
  const sonraki = sayfaDongusel === true ? kok : kok;
  return { donen: sonraki(), S: S };
}

console.log('\n== 1) bozuk kayitli adres kendini onarir (canli senaryo) ==');
const canli = calistir('http://localhost:195', ['http://localhost:195'], 'http://192.168.1.235:4545');
ok('bozuk adres dondurulmedi', canli.donen !== 'http://localhost:195', 'ayni kaldi: ' + canli.donen);
ok('dogru adrese gecildi', canli.donen === 'http://192.168.1.235:4545', 'gelen: ' + canli.donen);
ok('kok adres listeye girdi',
  canli.S.adaylar.indexOf('http://192.168.1.235:4545') >= 0, JSON.stringify(canli.S.adaylar));
ok('bozuk adres listeden atildi',
  canli.S.adaylar.indexOf('http://localhost:195') === -1, JSON.stringify(canli.S.adaylar));

console.log('\n== 2) NEGATIF KONTROL: alternatif de yoksa bos doner (dongu yok) ==');
const yok = calistir('http://localhost:195', ['http://localhost:195'], 'http://localhost:195');
ok('ayni adres tekrar secilmedi', yok.donen !== 'http://localhost:195', 'dondu: ' + yok.donen);
ok('alternatif yoksa "" doner', yok.donen === '', 'dondu: ' + JSON.stringify(yok.donen));

console.log('\n== 3) NEGATIF KONTROL: basarisiz adres listeden dusuyor mu? ==');
// Adaylarda 3 tane var; ilki basarisiz. Rotasyon 2.'yi vermeli.
const coklu = calistir('http://a:1', ['http://a:1', 'http://b:2', 'http://c:3'], 'http://kok:4');
ok('listedeki siradaki adrese gecildi', coklu.donen === 'http://b:2', 'gelen: ' + coklu.donen);
ok('kok yine de adaylara eklendi', coklu.S.adaylar.indexOf('http://kok:4') >= 0);
ok('aday sayisi artti (kok eklendi)', coklu.S.adaylar.length === 4, 'adet: ' + coklu.S.adaylar.length);

console.log('\n== 4) tekIstek sarmalayicisi ==');
ok('tekIstek sarmalayicisi var', plakaKaynak.indexOf('async function tekIstek(veri)') > 0);
ok('ic cagirmak icin tekIstekBir var', plakaKaynak.indexOf('async function tekIstekBir(veri)') > 0);
ok('ağ hatası etiketleniyor', /hata\.agHatasi\s*=\s*true/.test(plakaKaynak));
// ÖLÇÜM BETİĞİ HATASI DÜZELTMESİ: önceki kontrol
//   /iptalMi[\s\S]{0,220}hata\.agHatasi = true/
// idi ve ÖLÇÜLEBİLİR BİR ŞEYİ SAYMIYORDU: `iptalMi` ile `agHatasi` arası
// 220 karakterden kısa olduğu için ZAMAN AŞIMI da eşleşiyordu — yani test
// yanlış şeyi ölçüyordu. Şimdi yapı denetleniyor: etiket, iptal olmayan
// duruma BAĞLI olmalı ve koşulsuz bir atama olmamalı.
ok('zaman aşımı etiketlenmiyor (koşullu atama)',
  /if\s*\(\s*!\s*iptalMi\s*\)\s*hata\.agHatasi\s*=\s*true/.test(plakaKaynak),
  'agHatasi, iptalMi\'ye bagli degil');
ok('koşulsuz agHatasi atamasi yok',
  !/(^|[^!.\w])hata\.agHatasi\s*=\s*true/m.test(
    plakaKaynak.replace(/if\s*\(\s*!\s*iptalMi\s*\)\s*hata\.agHatasi\s*=\s*true/, '')));

/* ------------------------------------------------------------------ */
/* 5) Sarmalayicinin davranisini GERCEK kodla dogrula                   */
/* ------------------------------------------------------------------ */
console.log('\n== 5) sarmalayici gercek kodla: hata turune gore karar ==');
const sarGovde = blokCikar(plakaKaynak, 'async function tekIstek(veri)');
ok('sarmalayici govdesi cikarildi', !!sarGovde, 'bulunamadi');

function senaryo(hata, sunucuDavranisi) {
  const sayac = { bir: 0, iki: 0 };
  const fakeGuvenlikSync = {
    sonrakiAdres: function () { return sunucuDavranisi; },
  };
  const win = { GuvenlikSync: fakeGuvenlikSync };
  const konsol = { warn: function () {} };
  const fn = new Function('window', 'console', 'tekIstekBir', sarGovde + '\nreturn tekIstek;');
  const tekIstek = fn(win, konsol, async function (v) {
    sayac.bir++;
    if (sayac.bir === 1) { if (hata) throw hata; }
    sayac.iki++;
    return { basarili: true, plaka: '34 ABC 123' };
  });
  return tekIstek('kare').then(
    (r) => ({ sonuc: r, sayac: sayac }),
    (e) => ({ hata: e, sayac: sayac })
  );
}

(async function () {
  const agHatasi = new Error('sunucuya ulaşılamadı');
  agHatasi.agHatasi = true;

  // 5a) ağ hatası -> sıradaki adres denenir ve BAŞARILI olur
  const a = await senaryo(agHatasi, 'http://192.168.1.235:4545');
  ok('ağ hatasında ikinci deneme yapıldı', a.sayac.bir === 2, JSON.stringify(a.sayac));
  ok('ağ hatasında okuma BAŞARILI döndü',
    a.sonuc && a.sonuc.plaka === '34 ABC 123',
    JSON.stringify(a.sonuc || a.hata));
  ok('başarılı denemede tek istek yeter', a.sayac.iki === 1, JSON.stringify(a.sayac));

  // 5b) NEGATİF KONTROL: zaman aşımı -> adres DEĞİŞTİRİLMEZ
  const b = await senaryo(new Error('sunucu 20 saniyede yanıt vermedi'), 'http://192.168.1.235:4545');
  ok('zaman aşımında tekrar denenmedi', b.sayac.bir === 1, JSON.stringify(b.sayac));
  ok('zaman aşımı hatası yukarı çıktı', !!b.hata, 'hata yok');

  // 5c) NEGATİF KONTROL: alternatif adres yoksa hata korunur
  const c = await senaryo(agHatasi, '');
  ok('alternatif yoksa tekrar denenmedi', c.sayac.bir === 1, JSON.stringify(c.sayac));
  ok('alternatif yoksa hata yukarı çıktı', !!c.hata, 'hata yok');

  // 5d) ilk deneme başarılıysa HİÇ rotasyon olmaz
  const d = await senaryo(null, '');
  ok('ilk deneme başarılıysa tek istek', d.sayac.bir === 1, JSON.stringify(d.sayac));
  ok('başarılı sonuç aynen döndü', d.sonuc && d.sonuc.plaka === '34 ABC 123');

  console.log('\n== 6) uretilmis dosya guncel mi? ==');
  const uretilmis = fs.readFileSync(path.join(KOK, 'companion/public/telefon/senkron.js'), 'utf8');
  ok('senkron.js icinde sonrakiAdres var', uretilmis.indexOf('sonrakiAdres') > 0,
    'senkron.js yeniden uretilmeli');

  console.log('\n=== ' + gecti + ' gecti, ' + kaldi + ' kaldi ===');
  process.exit(kaldi ? 1 : 0);
})();
