'use strict';
// KULLANICI KONSOLUNDAN GELEN HATA: panellerde /kayitlar 401 aliyor.
// Neden? index.html ve kayitlar.html CK.istek'e cevrildi ama core.js
// icindeki CK.istek /olay (SSE) ve baska yerler icin de kullanilmiyor olabilir.
// Bu betik: panelde kalan TUM veri ucu cagrilarini envantere cikarir.
const fs = require('fs');
const path = require('path');

const kok = 'C:/syncserver/companion/public';
const dosyalar = [];
(function gez(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) gez(p);
    else if (/\.(html|js)$/.test(e.name)) dosyalar.push(p);
  }
})(kok);

const VERI_UC = /\/(durum|kayitlar|olay|plaka\/durum|plaka\/hazirla|eslesme\/cihazlar)\b/;
let bulunan = 0;

for (const f of dosyalar) {
  const sat = fs.readFileSync(f, 'utf8').split('\n');
  sat.forEach((l, i) => {
    // fetch/EventSource cagrisi yapan satirlari
    if (!/fetch\(|EventSource\(/.test(l)) return;
    // Bu satirda ya da bir sonraki 2 satırda veri ucu var mı?
    const pencere = [l, sat[i + 1] || '', sat[i + 2] || ''].join(' ');
    const m = VERI_UC.exec(pencere);
    if (!m) return;
    // ÖLÇÜLEN HATA (bu betik): ckBasliklar() tanınmadığı için doğru çağrılar
    // "EKSİK" görünüyordu — yani test KENDİSİ yanlış negatif üretiyordu.
    // Yanlış test, test olmayan şeyden daha kötüdür: insanı var olmayan bir
    // arızaya inandırır.
    const anahtarli = /CK\.istek|istekBasliklari|ckBasliklar|Authorization/.test(pencere);
    const uyari = anahtarli ? 'OK  ' : 'EKSİK';
    if (!anahtarli) bulunan++;
    console.log(`  ${uyari} ${path.relative(kok, f)}:${i + 1}  ${m[0]}  ${l.trim().substring(0, 70)}`);
  });
}
console.log(`\nAnahtarsız veri ucu çağrısı: ${bulunan}`);
process.exit(bulunan ? 1 : 0);
