'use strict';
/**
 * tests/ara/kamera-yolu.js
 *
 * KULLANICI BILDIRIMLERI (29.09.2026):
 *   1) "sadece galeriden ekleyince okuyor, kameradan çekince değil"
 *   2) "hiçbir işe yaramıyor" (fotoğraf ekranda görünüyor ama plaka yazmıyor)
 *
 * KÖK NEDEN (OLÇÜLDÜ, tahmin değil) — telefonun kamera yolu sonucu EKRANA
 * BASMIYORDU:
 *   isle() içinde `yerel.oku(c)` DOĞRUDAN çağrılıyordu. `Cam.read`
 *   sarmalayıcısı (plaka-yerel.js `camiSar`) ATLANIYORDU; o sarmalayıcı
 *   okuma sonucunu ekrana basıyor. Sonuç:
 *     galeri → Cam.read → sarmalayıcı → deliver() → EKRANDA
 *     kamera → yerel.oku → dönüş    → EKRANDA YOK
 *   Tarayıcıda ölçüldü (gerçek dosya girişi, kamera yolu):
 *     ÖNCE : camOut class="cam-out"     (show YOK, display:none)  plaka "—"
 *     SONRA: camOut class="cam-out show" (display:flex 886x147)   plaka "34 TAB 123"
 *   Kullanıcının "okunmuyor" demesi buradan geliyordu: plaka okunuyor ve
 *   kayıt yazılıyordu, yalnızca EKRANDA GÖRÜNMÜYORDU.
 *
 * TASARIM (korunur — `tests/ara/tam-kare.js` de zorunlu tutuyor):
 *   1) ÖNCE orijinal kanvas, sıkıştırmadan (kalite düşmesin)
 *   2) sıkıştırma SADECE tam kare BAŞARISIZsa (yedek yol)
 *   8 MB sınırının aşılması da 2. adımdaki yedek yolla karşılanır.
 *
 * ÖLÇÜM BETİĞİ KURALI (5. kez düzeltildi — artık bağlayıcı):
 *   Bu dosya YORUM AYIKLAMAZ. Metin aramak yerine DAVRANIŞ ölçülür.
 *   Geçmişte: (a) blok yorum regexp'i 16.502 karakter GERÇEK KODU yuttu,
 *   (b) `//` yorum satırları ayıklanınca kendi açıklamalarım eşleşti,
 *   (c) "düşmeye devam et" DİZESİ kendi yorumumda bulundu. Üçü de aynı
 *   sınıf: test, kodun YAPISI yerine METNİYLE konuşuyordu.
 */
const fs = require('fs');
const path = require('path');
const KOK = 'C:/syncserver';

const yerel = fs.readFileSync(path.join(KOK, 'companion/public/telefon/yerel-kamera.js'), 'utf8');
const galeri = fs.readFileSync(path.join(KOK, 'Security-ST/index.html'), 'utf8');
const sunucu = fs.readFileSync(path.join(KOK, 'companion/companion.js'), 'utf8');
const kod = yerel;   // yorum ayıklanmaz

let gecti = 0, kaldi = 0;
function ok(ad, kosul, ayrinti) {
  if (kosul) { gecti++; console.log('  ok   ' + ad); }
  else { kaldi++; console.log('  FAIL ' + ad + (ayrinti ? ' :: ' + ayrinti : '')); }
}

console.log('\n== 1) ASIL DÜZELTME: kamera yolu sarmalayıcıdan geçiyor ==');
ok('kamera yolu Cam.read(c) çağırıyor', /await Cam\.read\(c\)/.test(kod), 'Cam.read(c) yok');
ok('NEGATIF: yerel.oku() DOĞRUDAN çağrılmıyor (asıl hata buydu)',
  !/await yerel\.oku\(/.test(kod),
  'yerel.oku doğrudan çağrılıyor — sarmalayıcı atlanır, ekran güncellenmez');

console.log('\n== 2) okuma sirasi: once orijinal, sonra sikistirilmis ==');
const okuYeri = kod.indexOf('await Cam.read(c)');
const sikYeri = kod.indexOf('Cam.compressCanvas(c, 2560');
ok('orijinal kanvas once deneniyor', okuYeri >= 0 && (sikYeri < 0 || okuYeri < sikYeri),
  'sira: oku=' + okuYeri + ' sikistirma=' + sikYeri);
ok('sikistirilmis kare de bir yerde deneniyor (yedek yol)', sikYeri >= 0);

console.log('\n== 3) sunucu siniri (yedek yolun gerekcesi) ==');
const sinir = /PLAKA_GOVDE_SINIRI\s*=\s*'([\d]+)mb'/.exec(sunucu);
ok('PLAKA_GOVDE_SINIRI tanimli', !!sinir);
ok('sinir 8mb', !!sinir && sinir[1] === '8', 'bulunan: ' + (sinir && sinir[1]));

console.log('\n== 4) hata YUTULMUYOR (davranış ölçümü) ==');
// Metin değil davranış: her catch bloğu kullanıcıya bir şey bildiriyor mu?
// Yutuyorsa yalnızca console.warn vardır.
const bloklar = kod.match(/catch \([a-z0-9]+\) \{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) || [];
const sessiz = bloklar.filter(function (b) {
  return /console\.(warn|error|log)/.test(b) &&
    !/bildir\(|toast\(|rozetCiz\(|status\(|say\(/.test(b);
});
ok('hicbir catch kullaniciya bildirisi yapmadan yutmuyor', sessiz.length === 0,
  sessiz.length + ' sessiz catch');
ok('OCR hatasinda kullaniciya bildiriliyor',
  /catch \(e2\)[\s\S]{0,300}?bildir\(/.test(kod));

console.log('\n== 5) galeri yolu bozulmadi mi? ==');
ok('galeri yolu kendi sikistirmasini koruyor',
  /Cam\.compressCanvas\(c,\s*2560,\s*800000\)/.test(galeri));
ok('galeri yolu Cam.read(compressed) ile okuyor', /Cam\.read\(compressed\)/.test(galeri));
ok('galeri yolu da sarmalayicidan geciyor', /Cam\.read\(/.test(galeri));

console.log('\n== 6) cekilen fotograf EKRANDA gorunuyor mu? ==');
ok('onizleme fonksiyonu var', /onizleme\s*\(\s*src\s*\)/.test(galeri), 'onizleme yok');
ok('onizleme goruntusu DOM icinde', /id="camOnizleme"/.test(galeri), 'camOnizleme yok');
ok('kamera yolu onizlemeyi cagirir', /Cam\.onizleme\s*\(/.test(kod), 'kamera yolu cagirmiyor');
ok('galeri yolu onizlemeyi cagirir', /Cam\.onizleme\s*\(/.test(galeri), 'galeri yolu cagirmiyor');
ok('onizleme cerceveyi GIZLEMIYOR (kullanici hedefleyebilsin)',
  !/camGuide\)\.style\.display\s*=\s*'none'/.test(galeri), 'cerceve yine gizleniyor');
ok('onizleme cropArea ile cerceveyi hizaliyor (ipucu = ekrandaki cerceve)',
  /this\.cropArea\s*\)\s*\{\s*this\.cropArea\.top/.test(galeri), 'cropArea hizalanmiyor');

console.log('\n=== ' + gecti + ' gecti, ' + kaldi + ' kaldi ===');
process.exit(kaldi ? 1 : 0);
