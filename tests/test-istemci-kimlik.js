'use strict';
/**
 * ============================================================================
 *  İSTEMCİ KİMLİK DENETİMİ
 * ============================================================================
 *  Korumalı veri uçlarına (/durum, /kayitlar, /olay, /plaka/* …) yapılan
 *  HER çağrı kimlik (API anahtarı) göndermelidir. Göndermezse sunucu 401
 *  döner ve istemci sessizce boş veri görür.
 *
 *  ============================================================================
 *  BU DENETİMİN GEÇMİŞTE KAÇIRDIĞI ÜÇ HATA
 *  ============================================================================
 *  1) tests/test-guven-tekrar.js düştü (9 pass, 3 fail).
 *     Test /durum'u çıplak curl ile çağırıyordu; sunucu doğru şekilde 401
 *     döndürdü, test eskiydi.
 *
 *  2) Denetim onu KAÇIRDI: yalnızca `fetch(` ve `EventSource(` desenlerine
 *     bakıyordu. Test `exec('curl …')` kullanıyordu. Golge edilen yöntem
 *     denetlenmemis demektir.
 *
 *  3) tests/e2e-live.js düştü:
 *       E2E — /kayitlar: HATA {"ok":false,"error":"Yetkisiz (API anahtarı gerekli)"}
 *     Ve denetim yine KAÇIRDI: tarama deseni `^test-.*\.m?js$` idi;
 *     `e2e-live.js` / `e2e-telefon.js` bu desene uymuyordu.
 *
 *  DÜZELTMELER: geniş çağrı desenleri, TÜM test betiklerinin taranması,
 *  başlık değişkeni çözümlemesi, çok satırlı argüman penceresi, 401 niyetinin
 *  tanınması, istek yapan yardımcıların çağrı yerlerinin denetlenmesi.
 *
 *  EN ÖNEMLİSİ: denetim KENDİSİ sınanır. Kasıtlı bozuk örnekler taranır;
 *  yakalayamazsa bu dosya başarısız olur. "Denetim çalışıyor" beyanı değil,
 *  kanıtı vardır.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..');

// --- Taranacak dosyalar ----------------------------------------------------
// Üretici dosyalar: hem KAYNAK hem ÜRETİLMİŞ çıktı. (Üretilen dosya
// unutulursa hata paketlenmiş üründe çıkar.)
const URETICI = [
  'phone/guvenlik-sync.js',
  'companion/public/telefon/senkron.js',            // ÜRETİLMİŞ
  'companion/public/telefon/plaka-yerel.js',
  'companion/public/telefon/canli-okuma.js',
  'companion/public/assets/core.js',
  'companion/public/index.html',
  'companion/public/kayitlar.html',
  'companion/public/eslesme.html',
];

// Test betikleri: tests/ ve tests/ara/ altındaki TÜM .js/.mjs.
// ÖLÇÜLEN HATA: önceki sürüm `^test-` deseniyle eşleştiriyordu; e2e-*.js
// dosyaları kapsam DIŞINDA kalıp anahtarsız çağrıyı denetimden geçirdi.
function testDosyalari() {
  const cik = [];
  for (const [d, etiket] of [[__dirname, 'tests'], [path.join(__dirname, 'ara'), 'tests/ara']]) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!/\.m?js$/i.test(f)) continue;
      // Bu dosya kendi kırık örneklerini içerir; tararsa kendi kanıtını
      // kendi hatası sanar (ölçülen yanlış alarm: 3 bulgu).
      if (/^test-istemci-kimlik/.test(f)) continue;
      cik.push(etiket + '/' + f);
    }
  }
  return cik;
}

// --- Kurallar ---------------------------------------------------------------
const KORUMASIZ_UC = [
  /\/durum(?!\.\w)/,
  /\/kayitlar(?!\.\w)/,
  /\/olay(?!\.\w)/,
  /\/plaka\/durum(?!\.\w)/,
  /\/plaka\/oku(?!\.\w)/,
  /\/plaka\/hazirla(?!\.\w)/,
  /\/eslesme\/cihazlar(?!\.\w)/,
  /\/kayit\/batch(?!\.\w)/,
];

// Sunucunun KABUL ETTİĞİ üç kimlik biçimi:
//   a) Authorization: Bearer <API anahtarı>
//   b) Authorization: <API anahtarı>
//   c) X-Sync-Token: <kurulum anahtarı>
// (companion.js, anahtarGecerliMi — ölçülerek doğrulandı)
// ÖLÇÜLEN HATA: burada yalnızca Authorization sayılıyordu; X-Sync-Token
// kullanılan 16 GEÇERLİ çağrı "eksik" diye raporlandı.
const YARDIMCI = /CK\.istek|istekBasliklari|ckBasliklar|Authorization|X-Sync-Token|YETKI|ANAHKTAR_BASLIK|baslikDegeri/;

// İstek çağrısı desenleri.
// ÖLÇÜLEN BOŞLUK: yalnızca fetch/EventSource bakılıyordu; curl ve Node http
// çağrıları GÖRÜLMÜYORDU — korumasız kalan yöntem.
const CAGRI = /fetch\s*\(|EventSource\s*\(|curl\s+[-\w]|https?\.(get|request)\s*\(/;

// 401 bekleyen negatif testler kimliği KASITLI olarak göndermez.
const BEKLENEN_401 = /401|Yetkisiz|anahtarsiz|anahtarsız|KORUMASIZ_IZN|reddedil/i;

/**
 * Basit başlık nesnesi değişkenlerini çözer.
 * ÖLÇÜLEN HATA: `headers: TH` yazan çağrıda kimlik 3 satır dışında tanımlıydı
 * (`const TH = { 'X-Sync-Token': … }`); 3 satırlık pencere onu göremedi ve 12
 * geçerli çağrı yanlış alarm üretti.
 */
function baslikCoz(kod) {
  const m = new Map();
  for (const mm of kod.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*\{([^}]*)\}/g)) {
    m.set(mm[1], YARDIMCI.test(mm[2]));
  }
  return m;
}

/**
 * İstek yapan YARDIMCI fonksiyonları çözer.
 * ÖLÇÜLEN HATA: uç nokta HTTP satırında değil, ÇAĞRI YERİNDEydi
 * (`curl('/durum')`). Yardımcının kendisi kimlik taşıyorsa çağrı yerleri
 * güvenlidir; taşımıyorsa korumalı uca giden her çağrı gerçek eksiktir.
 * (/g bayrağı YOK: exec() çağrıları arasında lastIndex birikir ve
 *  tanımların çoğu bulunamaz — ölçülen hata.)
 */
function yardimciCoz(kod) {
  const sat = kod.split('\n');
  const istekYapan = new Set();
  const kimlikli = new Set();
  const tanim = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|(?:async\s+)?function\s+(\w+)\s*\(/;
  sat.forEach((l, i) => {
    const m = tanim.exec(l);
    if (!m) return;
    const ad = m[1] || m[2];
    if (!ad) return;
    const govde = sat.slice(i, i + 20).join('\n');
    if (!CAGRI.test(govde)) return;
    istekYapan.add(ad);
    if (YARDIMCI.test(govde)) kimlikli.add(ad);
  });
  return { istekYapan, kimlikli };
}

/** İsteğin kapsadığı GERÇEK ifade penceresi (sabit 3 satır değil). */
function pencereKur(sat, i) {
  let p = sat[i];
  for (let k = i + 1; k < sat.length && k <= i + 6; k++) {
    if (/;\s*$/.test(p)) break;
    if (/^\s*(const|let|var|return|if|for|\/\/|\*)/.test(sat[k])) break;
    p += '\n' + sat[k];
  }
  return p;
}

/** İsteğin hemen ardından gelen doğrulama deyimi (401 beklentisi burada). */
function sonrakiDeyim(sat, i) {
  for (let k = i; k < Math.min(sat.length, i + 5); k++) {
    if (/^\s*(ok|assert|if\s*\()/.test(sat[k])) return sat.slice(k, k + 3).join('\n');
  }
  return '';
}

/**
 * Kodu tarar, kimlik göndermeyen korumalı uç çağrılarını döndürür.
 * @returns {Array<{satir:number, metin:string}>}
 */
function araKorumasiz(kod, cik) {
  const coz = baslikCoz(kod);
  const yrd = yardimciCoz(kod);
  const sat = kod.split('\n');
  sat.forEach((l, i) => {
    // Yol 1: istek satırın kendisinde
    if (CAGRI.test(l)) {
      const pencere = pencereKur(sat, i);
      if (!KORUMASIZ_UC.find((r) => r.test(pencere))) return;
      if (YARDIMCI.test(pencere)) return;
      if (BEKLENEN_401.test(pencere)) return;
      if (BEKLENEN_401.test(sonrakiDeyim(sat, i))) return;
      const hv = /headers\s*:\s*([A-Za-z_$][\w$]*)/.exec(pencere);
      if (hv && coz.get(hv[1]) === true) return;
      cik.push({ satir: i + 1, metin: l.trim().substring(0, 90) });
      return;
    }
    // Yol 2: istek bir yardımcıdaysa, uç çağrı yerindedir
    const cagri = /\b(\w+)\s*\(\s*['"`]([^'"`]+)['"`]/.exec(l);
    if (!cagri) return;
    if (!yrd.istekYapan.has(cagri[1])) return;
    if (!KORUMASIZ_UC.find((r) => r.test(cagri[2]))) return;
    if (yrd.kimlikli.has(cagri[1])) return;
    if (YARDIMCI.test(l) || YARDIMCI.test(pencereKur(sat, i))) return;
    if (BEKLENEN_401.test(l) || BEKLENEN_401.test(sonrakiDeyim(sat, i))) return;
    cik.push({ satir: i + 1, metin: l.trim().substring(0, 90) });
  });
  return cik;
}

let hata = 0;
let kontrol = 0;
function isaret(k, ad) {
  if (k) { console.log('  GECTI  ' + ad); return 0; }
  console.log('  KALDI  ' + ad + '  <-- denetim ise yaramıyor');
  return 1;
}

// --- DENETİMİN KENDİSİ SINANIYOR (kanıt) ----------------------------------
console.log('=== DENETIMIN KENDISI SINANIYOR (kanit) ===');
const O = (...satirlar) => araKorumasiz(satirlar.join('\n'), []);

hata += isaret(O('const r = await fetch("/durum");').length === 1, 'kırık fetch yakalandı');
hata += isaret(O('exec(`curl -s http://127.0.0.1:4545/durum`)').length === 1, 'kırık curl yakalandı (ölçülen boşluk)');
hata += isaret(O('const r = await fetch("/durum", CK.istek());').length === 0, 'doğru fetch yanlış alarm vermiyor');
hata += isaret(O('fetch("/durum", { headers: { Authorization: ANAHTAR } })').length === 0, 'doğru Authorization yanlış alarm vermiyor');
hata += isaret(O('fetch("/durum", { headers: TH }) // TH = {"X-Sync-Token":"a"}').length === 0, 'X-Sync-Token yanlış alarm vermiyor');
hata += isaret(O(
  "const H = { 'Content-Type': 'application/json', 'X-Sync-Token': 't' };",
  "const r = await fetch(base + '/kayit/batch', { method: 'POST', headers: H });").length === 0,
  'kimlikli headers:H değişkeni yanlış alarm vermiyor');
hata += isaret(O(
  "const H = { 'Content-Type': 'application/json' };",
  "const r = await fetch(base + '/kayit/batch', { method: 'POST', headers: H });").length === 1,
  'kimlikSİZ headers:H değişkeni yakalandı');
hata += isaret(O(
  'const curl = (yol) => exec(`curl -s http://127.0.0.1:4545${yol}`);',
  "const d = await curl('/durum');").length === 1,
  'kimliksİZ curl YARDIMCISI yakalandı (ölçülen hata)');
hata += isaret(O(
  'const YETKI = 1;',
  'const curl = (yol) => exec(`curl -s ${YETKI} http://127.0.0.1:4545${yol}`);',
  "const d = await curl('/durum');").length === 0,
  'kimlikli curl YARDIMCISI yanlış alarm vermiyor');
hata += isaret(O(
  'const istek = (yol) => fetch("http://x" + yol);',
  "const r = await istek('/durum');",
  "ok(r.s === 401, 'anahtarsiz reddedildi');").length === 0,
  '401 bekleyen negatif test muaf (sessiz bozulma yok)');
hata += isaret(O('fetch("/kayitlar.html")').length === 0, '/kayitlar.html veri ucu DEĞİL (yanlış alarm yok)');

// --- Dosya taraması ---------------------------------------------------------
console.log('');
console.log('=== DOSYA TARAMASI ===');
const hepsi = [...URETICI, ...testDosyalari()];

// Kapsam kanıtı: e2e betikleri GERÇEKTEN taranıyor mu? (ölçülen kaçırma)
for (const gerekli of ['tests/e2e-live.js', 'tests/e2e-telefon.js']) {
  hata += isaret(hepsi.indexOf(gerekli) >= 0, 'kapsam: ' + gerekli + ' taranıyor');
}

for (const d of hepsi) {
  const yol = path.join(KOK, d);
  if (!fs.existsSync(yol)) { console.log('  EKSİK  ' + d); hata++; continue; }
  const kod = fs.readFileSync(yol, 'utf8');
  kontrol += (kod.match(CAGRI) || []).length;
  const bulunan = araKorumasiz(kod, []);
  for (const b of bulunan) {
    console.log('  EKSİK   ' + d + ':' + b.satir + '  ' + b.metin);
    hata++;
  }
}
console.log('  (taranan dosya: ' + hepsi.length + ')');

console.log('');
console.log('Denetlenen istek deseni: ' + kontrol);
console.log('Sorun: ' + hata);
if (hata === 0) {
  console.log('SONUÇ: geçerli — tüm korumalı uç çağrıları kimlik gönderiyor');
  process.exit(0);
}
console.log('SONUÇ: sorun var — kimlik göndermeyen istek(ler) bulundu');
process.exit(1);
