const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KOK = 'C:/syncserver';
const SITE = path.join(KOK, 'site');

// ============================================================================
//  KORUMA DENETİMİ (bayt düzeyinde, KESİN)
// ============================================================================
//  ÖLÇÜLEN HATA: ilk koruma denemesi İÇERİK işaretlerine bakıyordu
//  (/kart-bas/ gibi) ve telefon uygulamasını da "panel" sanıp iptal etti.
//  Yani denetim yanlış pozitif verdi — daha kötüsü, gerçek bir sızıntıyı
//  yakalayamazdı.
//
//  DOĞRU YÖNTEM: kopyalanan dosya HANGİ kaynaktan geldi? Bayt bayt aynı mı?
//  Bu, "panel kopyalanmış mı" sorusunu varsayımla değil KANITLA yanıtlar.
function parmakOzu(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

const siteIndex = path.join(SITE, 'index.html');
const telefonKaynak = path.join(KOK, 'companion', 'public', 'telefon', 'index.html');
const panelKaynak = path.join(KOK, 'companion', 'public', 'index.html');

const s = parmakOzu(siteIndex);
const t = parmakOzu(telefonKaynak);
const p = parmakOzu(panelKaynak);

console.log('=== YAYIN KORUMASI (kanit) ===');
console.log('  site/index.html        ' + s.slice(0, 16));
console.log('  telefon/index.html     ' + t.slice(0, 16));
console.log('  panel/index.html       ' + p.slice(0, 16));

let hata = 0;
if (s === t) console.log('  GECTI  site/index.html TELEFON kaynagindan geldi');
else { console.error('  KALDI  site/index.html telefon kaynagindan DEGIL'); hata++; }

if (s === p) { console.error('  KALDI  site/index.html PANEL dosyasi (sizinti!)'); hata++; }
else console.log('  GECTI  site/index.html PANEL degil (sizinti yok)');

// Panelin diger dosyalari da yanlislikla kopyalanmis olabilir
for (const f of ['kayitlar.html', 'ayar.html', 'eslesme.html']) {
  if (fs.existsSync(path.join(SITE, f))) {
    console.error('  KALDI  PANEL dosyasi site/ icinde: ' + f);
    hata++;
  }
}
if (!hata) console.log('  GECTI  diger panel dosyalari site/ icinde YOK');

// Uygulamanin ihtiyac duydugu dosyalar gercekten var mi
const GEREKEN = ['index.html', 'senkron.js', 'plaka-yerel.js', 'canli-okuma.js',
  'yerel-kamera.js', 'yapilandirma.js', 'guvenli-kaynak.js', 'ocr-config.js',
  'vendor/qrcode.min.js', 'vendor/xlsx.full.min.js'];
for (const f of GEREKEN) {
  if (!fs.existsSync(path.join(SITE, f))) {
    console.error('  KALDI  eksik dosya: ' + f);
    hata++;
  }
}
if (!hata) console.log('  GECTI  uygulamanin ' + GEREKEN.length + ' dosyasi tam');

console.log('');
console.log(hata ? 'SONUÇ: ' + hata + ' sorun' : 'SONUÇ: yayin klasoru guvenli');
process.exit(hata ? 1 : 0);
