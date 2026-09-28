'use strict';
/**
 * KANIT TESTİ: dönüştürücü kirli diskte değil, TAZE ortamda da geçmeli.
 *
 * Ölçülen hata tam olarak bu yüzden kaçmıştı: üretilmiş dosyalar diskte
 * durduğu için denetim onları buluyor, sorun görünmüyordu.
 *
 * Bu betik:
 *   1) üretilmiş dosyaları YEDEKLER (siler),
 *   2) dönüştürücüyü çalıştırır,
 *   3) sonucu ölçer,
 *   4) yedeği siler.
 *
 * Ayrıca NEGATİF KONTROL yapar: bilerek bir betiği siler, dönüştürücünün
 * bunu YAKALADIĞINI kanıtlar. Yakalamıyorsa denetim işe yaramaz.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const KOK = 'C:/syncserver';
const DIZIN = path.join(KOK, 'companion', 'public', 'telefon');
const URETILEN = ['index.html', 'senkron.js', 'ocr-config.js'];

let pass = 0, fail = 0;
const ok = (c, ad, ek) => {
  if (c) { pass++; console.log('PASS — ' + ad + (ek ? '  -> ' + ek : '')); }
  else { fail++; console.log('FAIL — ' + ad + (ek ? '  -> ' + ek : '')); }
};

function yedekle() {
  const y = {};
  for (const f of URETILEN) {
    const p = path.join(DIZIN, f);
    if (fs.existsSync(p)) { y[f] = fs.readFileSync(p); fs.unlinkSync(p); }
  }
  return y;
}
function geriKoy(y) {
  for (const f of URETILEN) {
    if (y[f]) fs.writeFileSync(path.join(DIZIN, f), y[f]);
    else if (fs.existsSync(path.join(DIZIN, f))) fs.unlinkSync(path.join(DIZIN, f));
  }
}
function calistir() {
  try {
    const out = execFileSync(process.execPath, [path.join(KOK, 'tools', 'security-st-esle.js')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { kod: 0, out };
  } catch (e) {
    return { kod: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

console.log('\n--- 1) TAZE ORTAM DENEMESI (kirli dosya yok) ---');
let y = yedekle();
let r = calistir();
console.log('    cikis kodu: ' + r.kod + (r.kod === 0 ? '' : '  <-- HATA'));
const kesin = /kesin denetim: sayfa diskte (\d+) harici/.exec(r.out);
ok(r.kod === 0, 'dönüştürücü üretilmiş dosya YOKKEN basarili', 'kod ' + r.kod);
ok(!!kesin, 'kesin denetim çalıştı ve raporladı', kesin ? kesin[0] : 'rapor yok');
ok(!/VAR OLMAYAN harici betik/.test(r.out), 'taze ortamda "eksik betik" hatası YOK');

console.log('\n--- 2) NEGATİF KONTROL: elle yazilan betik silinir ---');
y = yedekle();
const kurban = path.join(DIZIN, 'yapilandirma.js');
const kurbanYedek = fs.readFileSync(kurban);
fs.unlinkSync(kurban);
r = calistir();
const yakaladi = r.kod !== 0 && /yapilandirma\.js/.test(r.out);
ok(yakaladi, 'denetim SİLİNEN betiği yakalıyor (denetim işe yarıyor mu?)', 'kod ' + r.kod);
fs.writeFileSync(kurban, kurbanYedek);

console.log('\n--- 3) NEGATİF KONTROL: üretilen betiğin ÜSTÜ YAZILAMAZ ---');
y = yedekle();
fs.mkdirSync(DIZIN, { recursive: true });
// index.html'i yazmayı engelle: dizini okunabilir ama hedef bir klasör yap
const engel = path.join(DIZIN, 'ocr-config.js');
fs.mkdirSync(engel, { recursive: true });
let kodHatasi = false;
try { execFileSync(process.execPath, [path.join(KOK, 'tools', 'security-st-esle.js')], { stdio: 'pipe' }); }
catch (e) { kodHatasi = true; }
fs.rmdirSync(engel); // boş klasörü kaldır
ok(kodHatasi, 'üretim engellenince dönüştürücü BAŞARISIZ oluyor (sessiz geçme yok)', kodHatasi ? 'hata verdi' : 'sessizce gecti - HATA');

console.log('\n--- 4) TEMIZ ORTAM: son hali ---');
fs.rmSync(engel, { recursive: true, force: true });
y = yedekle();
r = calistir();
ok(r.kod === 0, 'dönüştürücü temiz ortamda basarili', 'kod ' + r.kod);
for (const f of URETILEN) ok(fs.existsSync(path.join(DIZIN, f)), 'üretildi: ' + f);

console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
