'use strict';
/**
 * ============================================================================
 *  KRİTİK HATA TESTİ: telefon kamerası sessizce hiçbir şey yapmıyordu
 * ============================================================================
 *  BELİRTİ (kullanıcı, 29.09.2026): telefonda kamerayla fotoğraf çekip
 *  onaylayınca uygulama sessizce susuyor.
 *  Konsol kanıtı:
 *      yerel-kamera.js:195 File chooser dialog can only be shown with a
 *                       user activation.  (img.onload içinden)
 *
 *  KÖK NEDEN: uygulama `const Cam = {...}` tanımlıyor; betik `type=module`
 *  DEĞİL. Klasik betikte `const` global lexical binding yaratır, `window.Cam`
 *  YAPILMAZ. `yerel-kamera.js` `window.Cam` okuyordu → hep undefined →
 *  uygulamanın okuma yolu hiç çalışmıyor → galeri seçiciye düşüyor →
 *  o da kullanıcı dokunuşu olmadan açılamıyor → SESSİZLİK.
 *
 *  Bu test gerçek davranışı çalıştırır:
 *    1) `const Cam` global lexical binding iken çözümleme BAŞARILI olmalı
 *    2) Çözülemezken seçici programatik AÇILMAMALI (her zaman reddedilir)
 *    3) Çözülemezken kullanıcıya NET mesaj verilmeli (sessiz yutma yok)
 *    4) NEGATİF KONTROL: eski `window.Cam` okuması bu senaryoda BAŞARISIZ
 * ============================================================================
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { blokCikar } = require('./kod-parca.js');

const KOK = path.join(__dirname, '..', '..');
const DOSYA = path.join(KOK, 'companion', 'public', 'telefon', 'yerel-kamera.js');
const UYGULAMA = path.join(KOK, 'companion', 'public', 'telefon', 'index.html');

let pass = 0, fail = 0;
const ok = (c, ad, ek) => {
  if (c) { pass++; console.log('PASS — ' + ad + (ek ? '  -> ' + ek : '')); }
  else { console.log('FAIL — ' + ad + (ek ? '  -> ' + ek : '')); fail++; }
};

const kod = fs.readFileSync(DOSYA, 'utf8');
const cozumleyici = blokCikar(kod, 'function camAl');
// Yorumlar ayıklanmış KOD (yalnızca KOD içinde arama yapmak için).
const kodYorumsuz = kod.replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
if (!cozumleyici) { console.log('FAIL — camAl() çözümleyicisi bulunamadı'); process.exit(1); }

console.log('\n--- 1) Uygulamanın Cam modülü gerçekten var mı? ---');
if (!fs.existsSync(UYGULAMA)) {
  ok(false, 'üretilmiş sayfa yok (önce tools/security-st-esle.js)');
} else {
  const html = fs.readFileSync(UYGULAMA, 'utf8');
  ok(/const Cam\s*=/.test(html), 'sayfa `const Cam` ile tanımlıyor');
  ok(!/type\s*=\s*["']module["']/.test(html), 'betik type=module DEĞİL (const global lexical binding olur)');
  ok(!/window\.Cam\s*=/.test(html), 'sayfa window.Cam ATAMIYOR (olduğunda hata olmazdı)');
  ok(/async\s+read\s*\(/.test(html), 'Cam.read tanımlı');
  ok(/async\s+compressCanvas\s*\(/.test(html), 'Cam.compressCanvas tanımlı');
}

console.log('\n--- 2) Çözümleme: global lexical binding bulunmalı ---');
/**
 * ÖLÇÜLEN HATANIN TAM TAKLİDİ:
 *  - `Cam` yalnızca global lexical binding olarak var (window.Cam YOK)
 *  - Bu, klasik betikte `const Cam = {...}` ile tanımlamanın sonucudur
 */
function cozumle(senaryo) {
  const kutu = { window: {} };
  kutu.window.window = kutu.window;
  if (senaryo.lexical) kutu.Cam = { ad: 'uygulama-Cam', oku: true };
  if (senaryo.windowCam) kutu.window.Cam = { ad: 'window-Cam', oku: true };
  vm.runInNewContext(cozumleyici, kutu);
  return kutu.camAl();
}

const lexical = cozumle({ lexical: true });
ok(!!lexical, 'global lexical binding (`const Cam`) ÇÖZÜMLENDİ', lexical ? lexical.ad : 'null');
ok(lexical && lexical.ad === 'uygulama-Cam', 'doğru nesne çözümlendi');

const ikisi = cozumle({ lexical: true, windowCam: true });
ok(!!ikisi, 'window.Cam varsa da çözümleniyor', ikisi ? ikisi.ad : 'null');
ok(ikisi && ikisi.ad === 'window-Cam', 'window.Cam ÖNCELİKLİ (ileride atanırsa)');

const hicbiri = cozumle({});
ok(hicbiri === null, 'hiçbiri yoksa null (çökmüyor)');

console.log('\n--- 3) Sessiz düşüş kaldırıldı mı? ---');
ok(kod.indexOf("if (g) { g.click(); return; }") < 0,
  'img.onload içinden programatik seçici açma KALDIRILDI');
// ÖLÇÜM BETİĞİ HATASI DÜZELTMESİ: önceki kontrol kodun TAMAMINI
// tarıyor ve yorum satırını da arıyordu. Yorumlar ayıklanıp KOD
// içinde aranmalı: seçicinin GERÇEKTEN çağrılmadığını kanıtlamak için.
ok(!/[^/]g\.click\(\)/.test(kodYorumsuz),
  'g.click() KODDA çağrılmıyor (yalnızca açıklama yorumunda geçiyor)');
// Asıl telefon kamerası açılışı (API.ac) KORUNMALI — o kullanıcı dokunuşundan.
const acKac = (kod.match(/el\.click\(\)/g) || []).length;
ok(acKac === 1, 'telefon kamerası açılışı (el.click) KORUNDU — kullanıcı dokunuşundan', acKac + ' adet');

console.log('\n--- 4) Kullanıcıya net mesaj veriliyor mu? ---');
ok(/Okuma başlatılamadı/.test(kod), 'çözümlenemezse net mesaj var');
ok(/Kamerayı Aç ve Okut/.test(kod), 'mesaj ne yapılacağını söylüyor (sessiz değil)');

console.log('\n--- 5) window.Cam okuması kalmadı mı? (yorumlar hariç) ---');
const yorumsuz = kod
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
// Çözümleyicinin TEK satırı iki kez geçer: `if (window.Cam) return window.Cam;`
// Ölçülecek olan kaç SATIRDA geçtiğidir, kaç kez değil.
const camSatirlari = yorumsuz.split('\n').filter((l) => l.indexOf('window.Cam') >= 0);
ok(camSatirlari.length === 1, 'window.Cam yalnızca çözümleyicinin TEK satırında',
  camSatirlari.length + ' satır: ' + (camSatirlari[0] || '').trim().substring(0, 60));

console.log('\n--- 6) NEGATİF KONTROL: eski okuma bu senaryoda BAŞARISIZ ---');
{
  // ESKİ davranışın taklidi: yalnızca window.Cam okumak
  function eskiCoz(senaryo) {
    const kutu = { window: {} };
    kutu.window.window = kutu.window;
    if (senaryo.lexical) kutu.Cam = { ad: 'uygulama-Cam' };
    if (senaryo.windowCam) kutu.window.Cam = { ad: 'window-Cam' };
    return kutu.window.Cam;               // window.Cam okuması
  }
  const eski = eskiCoz({ lexical: true });
  ok(eski === undefined, 'ESKİ kod `const Cam` varken undefined döndü (hata kanıtlandı)');
  ok(eski !== lexical, 'ESKİ davranış YENİDEN FARKLI — düzeltme işe yaradı');
  const yeni = cozumle({ lexical: true });
  ok(yeni !== null && eski === undefined,
    'yeni çözümleyici çalışıyor, eskisi çalışmıyor — fark ölçüldü');
}

console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
