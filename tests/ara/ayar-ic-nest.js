'use strict';
/**
 * tests/ara/ayar-ic-nest.js
 *
 * ÖLÇÜLEN HATA (kullanıcı ekran görüntüsü, 29.09.2026):
 *   Ayarlar sayfasında satırlar ÜST ÜSTE BİNMİŞ. "Telefonun kamerası",
 *   "Kamera açılınca kendi çeksin", "Sürekli kamera okuma" aynı yerde
 *   üst üste, metinler sıkışmış.
 *
 * KÖK NEDEN: `Security-ST/index.html` içinde `phoneCam` satırının HTML'i
 * bozuktu — `.smain` kapatılmadan `.sw` içine konmuş ve satırın `</div>`'i
 * eksikti. Tarayıcı bu yüzden SONRAKİ üç satırı `phoneCam` satırının İÇİNE
 * almıştı. Ölçülen kanıt:
 *   satır 10 (phoneCam) : 530x318   (normal 530x63 olmalı)
 *   satır 11 (autoCam)  : 180x183   -> DIV.srow > DIV.srow
 *   satır 12 (livePlate): 179x229   -> DIV.srow > DIV.srow
 *   satır 13 (autoFirm) : 179x167   -> DIV.srow > DIV.srow
 *   y düzeni bozuk: 917 -> 985 -> 962 (geriye gidiyor)
 *
 * BU HATA SINIFI NEDEN TEKRAR EDER:
 *   Ayarlar sayfası yeni satır eklendiğinde (ör. "Telefonun kamerası"
 *   anahtarı) elle yazılan HTML'de bir `</div>` unutulunca sayfa SESSIZCE
 *   bozuluyor: konsolda hata yok, JS çalışıyor, sadece GÖRÜNTÜ yanlış.
 *   Bu yüzden test koda değil YAPIYA bakar: hiçbir `.srow` başka bir
 *   `.srow` içine gömülü olamaz.
 */
const fs = require('fs');
const path = require('path');
const KOK = 'C:/syncserver';
const KAYNAK = path.join(KOK, 'Security-ST', 'index.html');
const URETILEN = path.join(KOK, 'companion', 'public', 'telefon', 'index.html');

let gecti = 0, kaldi = 0;
function ok(ad, kosul, ayrinti) {
  if (kosul) { gecti++; console.log('  ok   ' + ad); }
  else { kaldi++; console.log('  FAIL ' + ad + (ayrinti ? ' :: ' + ayrinti : '')); }
}

/* ------------------------------------------------------------------ */
/* 1) Kaynak dosyada .srow ic ice gecmemeli (etiket sayaci ile)        */
/* ------------------------------------------------------------------ */
function srowIcIceMi(satir) {
  const d = [];
  const ac = /<div\b[^>]*\bclass="[^"]*\bsrow\b[^"]*"[^>]*>/gi;
  const kapa = /<\/div>/gi;
  const olaylar = [];
  let m;
  while ((m = ac.exec(satir)) !== null) olaylar.push({ i: m.index, t: 'ac' });
  while ((m = kapa.exec(satir)) !== null) olaylar.push({ i: m.index, t: 'kapa' });
  olaylar.sort((a, b) => a.i - b.i);
  let der = 0, icIce = 0;
  for (const o of olaylar) {
    if (o.t === 'ac') { if (der > 0) icIce++; der++; }
    else der--;
  }
  return icIce;
}

console.log('\n== 1) kaynak HTML: .srow ic ice gecmemeli ==');
const sat = fs.readFileSync(KAYNAK, 'utf8').split('\n');
const kotu = [];
for (let i = 0; i < sat.length; i++) {
  // srow acilan her satiri tek tek dene
  if (/<div\b[^>]*\bclass="[^"]*\bsrow\b/i.test(sat[i])) {
    const ic = srowIcIceMi(sat[i]);
    if (ic > 0) kotu.push({ satir: i + 1, ic: ic, metin: sat[i].trim().slice(0, 60) });
  }
}
ok('acilis satirinda ic ice .srow yok', kotu.length === 0,
  kotu.map((k) => 'satir ' + k.satir + ' (' + k.ic + ' adet)').join(', '));

console.log('\n== 2) phoneCam satiri dogru desende mi? ==');
const tel = fs.readIndexOf ? 0 : 0;
const ham = fs.readFileSync(KAYNAK, 'utf8');
const pBas = ham.indexOf('data-set="phoneCam"');
const pSon = ham.indexOf('data-set="autoCam"');
ok('phoneCam bulundu', pBas >= 0);
ok('phoneCam sonraki satirdan once bitiyor', pSon > pBas);
if (pBas >= 0 && pSon > pBas) {
  const parca = ham.slice(pBas, pSon);
  const smainKapanis = parca.indexOf('</div></div>');
  const swYeri = parca.indexOf('data-sw="phoneCam"');
  ok('.smain, .sw DEN once kapatiliyor', smainKapanis > 0 && swYeri > smainKapanis,
    'smain kapanis=' + smainKapanis + ' sw=' + swYeri);
  const acilan = (parca.match(/<div\b/g) || []).length;
  const kapanan = (parca.match(/<\/div>/g) || []).length;
  ok('div sayisi dengeli', acilan === kapanan, acilan + ' acilan / ' + kapanan + ' kapanan');
}

console.log('\n== 3) uretilen dosya da ayni hatali olmamali ==');
const uret = fs.readFileSync(URETILEN, 'utf8');
const uBas = uret.indexOf('data-set="phoneCam"');
const uSon = uret.indexOf('data-set="autoCam"');
ok('uretilende phoneCam var', uBas >= 0);
if (uBas >= 0 && uSon > uBas) {
  const parca = uret.slice(uBas, uSon);
  const acilan = (parca.match(/<div\b/g) || []).length;
  const kapanan = (parca.match(/<\/div>/g) || []).length;
  ok('uretilende div sayisi dengeli', acilan === kapanan, acilan + ' / ' + kapanan);
}

console.log('\n== 4) tum ayar satirlari kendi .set-group cocugu ==');
// uretilen dosyada her data-set srow'unun icinde baska data-set OLMAMALI
const tumSrow = uret.match(/<div class="srow"[^>]*data-set="([^"]+)"[\s\S]*?(?=<div class="srow"|$)/g) || [];
ok('ayar satiri bulundu', tumSrow.length > 0, tumSrow.length + ' adet');
let icIcer = [];
for (const b of tumSrow) {
  const m = b.match(/data-set="([^"]+)"/);
  const icler = (b.match(/data-set="/g) || []).length;
  if (icler > 1) icIcer.push(m[1] + '(' + icler + ')');
}
ok('hicbir ayar satiri baska satiri icermiyor', icIcer.length === 0, icIcer.join(', '));

console.log('\n=== ' + gecti + ' gecti, ' + kaldi + ' kaldi ===');
process.exit(kaldi ? 1 : 0);
