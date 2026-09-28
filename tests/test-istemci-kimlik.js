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
 *  ÖLÇÜLEN HATA: bu denetim boşluğu vardı ve gerçek bir hatayı KAÇIRDI.
 *  ============================================================================
 *  tests/test-guven-tekrar.js düştü (9 pass, 3 fail): "servis ayakta" kontrolü
 *  başarısız oldu. Sebep sunucu değildi — test /durum'u ÇIPLAK curl ile
 *  çağırıyordu ve sunucu doğru şekilde 401 döndürüyordu. Test eskiydi.
 *
 *  Bu denetim bunu YAKALAYAMADI, çünkü:
 *    1) Yalnızca `fetch(` ve `EventSource(` desenlerine bakıyordu.
 *       Test ise `exec('curl …')` kullanıyordu — desen tanınmıyordu.
 *    2) Yalnızca ÜRETİCİ dosyaları tarıyordu; test dosyalarını hiç
 *       tar Amıyordu.
 *  Yani koruma, koruması gereken çağrı yönteminin bir kısmına bakmıyordu.
 *  Bir denetimin görmediği yöntem, denetlenmemiş demektir.
 *
 *  DÜZELTME:
 *    - Çağrı desenleri genişletildi: fetch, EventSource, curl, http(s).get,
 *      http(s).request.
 *    - Test dosyaları da taranıyor.
 *    - 401'yi BEKLEYEN denetimler muaf tutuldu (onlar korumayı sınıyor;
 *      anahtarsız çağrı orada kasıtlıdır).
 *    - En önemlisi: denetim KENDİSİ sınanır. Aşağıda kasıtlı olarak bozuk
 *      bir örnek taranır; yakalayamazsa bu dosya BAŞARISIZ olur. Yani
 *      "denetim çalışıyor" beyanı değil, kanıtı vardır.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..');

// Denetlenecek dosyalar: hem KAYNAK hem ÜRETİLMİŞ çıktı.
// (Üretilen dosya unutulursa hata paketlenmiş üründe çıkar.)
const DOSYALAR = [
  'phone/guvenlik-sync.js',
  'companion/public/telefon/senkron.js',            // ÜRETİLMİŞ
  'companion/public/telefon/plaka-yerel.js',
  'companion/public/assets/core.js',
  'companion/public/index.html',
  'companion/public/kayitlar.html',
  'companion/public/eslesme.html',
];

// Test dosyaları da taranır. ÖLÇÜLEN HATA: burası boştu ve anahtarsız bir
// çağrı testlere sızdı; sunucu doğru davranıp 401 döndüğü için hata
// "kapalı servis" gibi göründü.
function testDosyalari() {
  const kok = path.join(__dirname);
  const cik = [];
  for (const d of [kok, path.join(kok, 'ara')]) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (/^test-.*\.m?js$/.test(f)) cik.push(path.join('tests', path.basename(d) === 'ara' ? 'ara' : '', f));
    }
  }
  return cik;
}

// --- TESPİT KURALLARI ------------------------------------------------------

// Korumalı uçlar
// ÖLÇÜLEN HATA: `/kayitlar\b` deseni `/kayitlar.html` dosyasını da
// eşleştiriyordu (`\b`, `s` ile `.` arasındadır). O bir veri ucu DEĞİL,
// panelin sayfasıdır. Sonraki karakterin harf/rakam/alt çizgi OLMADIĞI
// uçlar sayılır; böylece .html/.json uzantıları eşleşmez.
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

// Anahtarı taşıyan yardımcılar / başlıklar.
//
// ÖLÇÜLEN HATA (denetimin kendi kusuru): burada yalnızca Authorization
// sayılıyordu. Oysa sunucu ÜÇ kimlik biçimini de kabul ediyor
// (companion.js, anahtarGecerliMi):
//     a) Authorization: Bearer <API anahtarı>
//     b) Authorization: <API anahtarı>            (düz)
//     c) X-Sync-Token: <kurulum anahtarı>
// Testler (c) biçimini kullanıyor ve bu GEÇERLİDİR. X-Sync-Token sayılmayınca
// 16 geçerli çağrı "eksik" diye raporlandı — yani denetim yanlış alarm
// veriyordu. Böyle bir denetime güvenilmez; önce denetimi düzeltiyoruz.
const YARDIMCI = /CK\.istek|istekBasliklari|ckBasliklar|Authorization|X-Sync-Token|YETKI|ANAHKTAR_BASLIK|baslikDegeri/;

// ÖLÇÜLEN BOŞLUK: yalnızca fetch/EventSource bakılıyordu. curl ve Node http
// çağrıları GÖRÜLMÜYORDU — korumasız kalan yöntem.
const CAGRI = /fetch\s*\(|EventSource\s*\(|curl\s+[-\w]|https?\.(get|request)\s*\(/;

// 401'yi bekleyen, kimliğin KASITLI olmadığı denetimler (korumayı sınıyorlar)
const BEKLENEN_401 = /401|Yetkisiz|anahtarsiz|anahtarsız|KORUMASIZ_IZN|reddedil/i;

/**
 * Basit başlık nesnesi değişkenlerini çözer.
 *
 * ÖLÇÜLEN HATA: denetim `headers: H` yazan bir çağrıyı 3 satırlık pencereyle
 * inceliyordu. `H` ise dosyanın 50. satırında tanımlıydı:
 *     const H = { 'Content-Type': 'application/json', 'X-Sync-Token': 'full-token' };
 * Geçerli bir çağrıydı ama denetim göremedi ve 12 yanlış alarm üretti.
 * Düzeltme: dosya genelinde `{...}` ile tanımlanan değişkenler taranır ve
 * kimlik taşıyıp taşımadıkları eşlenir.
 *
 * @returns {Map<string, boolean>} değişken adı -> kimlik taşıyor mu
 */
function baslikCoz(kod) {
  const m = new Map();
  for (const mm of kod.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*\{([^}]*)\}/g)) {
    m.set(mm[1], YARDIMCI.test(mm[2]));
  }
  return m;
}

/**
 * İSTEK YAPAN YARDIMCI FONKSİYONLARI çözer.
 *
 * ÖLÇÜLEN HATA (negatif kontrolle bulundu): gerçek hata geri getirildiğinde
 * denetim onu YAKALAMADI. Sebep yapısaldı:
 *
 *     const curl = (yol) => exec(`curl -s http://...${yol}`);   <- istek burada
 *     const d = await curl('/durum');                           <- uç burada
 *
 * Uç nokta çağrı yerinde, HTTP satırında değil. 3 satırlık pencere
 * `/durum`'u hiç görmüyordu. Yani denetim "hangi uca gidiyorsun" sorusunu
 * yanlış yerde arıyordu.
 *
 * Çözüm: istek yapan yardımcılar bulunur. Yardımcının KENDİSİ kimlik
 * taşıyorsa (ör. `curl -s ${YETKI} …`) çağrı yerleri güvenlidir. Taşımıyorsa
 * korumalı bir uca giden HER çağrı yeri gerçek eksiktir.
 *
 * @returns {{istekYapan:Set<string>, kimlikli:Set<string>}}
 */
function yardimciCoz(kod) {
  const sat = kod.split('\n');
  const istekYapan = new Set();
  const kimlikli = new Set();
  // ÖLÇÜLEN HATA: bu desen /g bayraklıydı ve satır satır exec() ile
  // çağrılıyordu. /g bir desenin exec() çağrıları arasında lastIndex
  // BİRİKİR; sonraki satırlar yanlış konumdan aranır ve tanımların
  // çoğu bulunamaz. /g bayrağı kaldırıldı (her çağrı baştan arar).
  const tanim = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|(?:async\s+)?function\s+(\w+)\s*\(/;
  sat.forEach((l, i) => {
    // Gövde, JS'te tanım satırından sonraki satırlarda olabilir.
    const evrensel = tanim.exec(l);
    if (!evrensel) return;
    const ad = evrensel[1] || evrensel[2];
    if (!ad || ad === 'function') return;
    const govde = sat.slice(i, i + 20).join('\n');
    if (!CAGRI.test(govde)) return;           // istek yapmıyor, ilgili değil
    istekYapan.add(ad);
    if (YARDIMCI.test(govde)) kimlikli.add(ad);
  });
  return { istekYapan, kimlikli };
}

/**
 * Kodu tarar, kimlik göndermeyen korumalı uç çağrılarını döndürür.
 * @returns {Array<{satir:number, metin:string}>}
 */
/**
 * İsteğin hemen ardından gelen DEVRİMİ döndürür (401 bekleyen negatif
 * testlerde doğrulama buradadır).
 */
function sonrakiDeyim(sat, i) {
  for (let k = i; k < Math.min(sat.length, i + 5); k++) {
    if (/^\s*(ok|assert|if\s*\()/.test(sat[k])) return sat.slice(k, k + 3).join('\n');
  }
  return '';
}

/**
 * Bir istek satırının kapsadığı GERÇEK ifade penceresini kurar.
 * Sabit 3 satır yerine ifade sınırı kullanılır; aksi halde yardımcı
 * tanımındaki istek, bir sonraki deyimin ucunu (ör. `/durum`) yanlışlıkla
 * alır ve aynı eksiği iki kez raporlar.
 */
function pencereKur(sat, i) {
  let p = sat[i];
  for (let k = i + 1; k < sat.length && k <= i + 6; k++) {
    if (/;\s*$/.test(p)) break;                       // iftek bitti
    if (/^\s*(const|let|var|return|if|for|\/\/|\*)/.test(sat[k])) break;  // yeni deyim
    p += '\n' + sat[k];
  }
  return p;
}

function araKorumasiz(kod, cik) {
  const coz = baslikCoz(kod);
  const yrd = yardimciCoz(kod);
  const sat = kod.split('\n');
  sat.forEach((l, i) => {
    // --- Yol 1: istek satırın kendisinde (fetch / curl / EventSource) ---
    if (CAGRI.test(l)) {
      const pencere = pencereKur(sat, i);
      if (!KORUMASIZ_UC.find((r) => r.test(pencere))) return;
      if (YARDIMCI.test(pencere)) return;
      if (BEKLENEN_401.test(pencere)) return;
      // ÖLÇÜLEN HATA: 401 bekleyen negatif testlerin doğrulaması çağrıdan
      // SONRAKİ deyimde yazılır. Pencerenin bir deyim daha ilerisi de
      // bakılır; aksi halde kasıtlı negatif testler "eksik kimlik" diye
      // raporlanır ve denetim kullanılamaz hale gelir.
      if (BEKLENEN_401.test(sonrakiDeyim(sat, i))) return;
      const hv = /headers\s*:\s*([A-Za-z_$][\w$]*)/.exec(pencere);
      if (hv && coz.get(hv[1]) === true) return;
      cik.push({ satir: i + 1, metin: l.trim().substring(0, 90) });
      return;
    }
    // --- Yol 2: istek bir yardımcıdaysa, uç CAĞRI YERİNDEDİR ---
    const cagri = /\b(\w+)\s*\(\s*['"`]([^'"`]+)['"`]/.exec(l);
    if (!cagri) return;
    const ad = cagri[1];
    if (!yrd.istekYapan.has(ad)) return;
    if (!KORUMASIZ_UC.find((r) => r.test(cagri[2]))) return;
    if (yrd.kimlikli.has(ad)) return;   // yardımcının kendisi kimlik gönderiyor
    // ÖLÇÜLEN HATA: Yol 2 yalnızca tek satıra bakıyordu. Nesne argümanı
    // çok satırlı olduğunda kimlik başlığı 2.-3. satırda gelir:
    //     await istek('/plaka/oku', {
    //       'Content-Type': 'application/json',
    //       Authorization: 'Bearer ' + ANAHTAR,      <-- burada
    //     }, 'POST');
    // Bu yüzden çağrının ifade penceresi de taranır.
    if (YARDIMCI.test(l) || YARDIMCI.test(pencereKur(sat, i))) return;
    if (BEKLENEN_401.test(l) || BEKLENEN_401.test(sonrakiDeyim(sat, i))) return;
    cik.push({ satir: i + 1, metin: l.trim().substring(0, 90) });
  });
  return cik;
}

let hata = 0;
let kontrol = 0;

console.log('=== DENETİMİN KENDİSİ SINANIYOR (kanıt) ===');
// Negatif kontrol: kırık örnek YAKALANMALI.
const kirik = araKorumasiz(
  ['const r = await fetch("/durum");'].join('\n'), []);
const kirikYakalandi = kirik.length === 1;
// Negatif kontrol 2: curl ile kırık örnek (ölçülen boşluk tam olarak buydu)
const kirikCurl = araKorumasiz(
  ['exec(`curl -s http://127.0.0.1:4545/durum`)'].join('\n'), []);
// Pozitif kontrol: doğru örnek TESPİT EDİLMEMELİ
const dogru = araKorumasiz(
  ['const r = await fetch("/durum", CK.istek());'].join('\n'), []);
const dogruSessiz = araKorumasiz(
  ['fetch("/durum", { headers: { Authorization: ANAHTAR } })'].join('\n'), []);
// ÖLÇÜLEN HATA düzeltmesinin kanıtı: X-Sync-Token da geçerli kimliktir
const dogruToken = araKorumasiz(
  ['fetch("/durum", { headers: TH })  // TH = {"X-Sync-Token": "abc"}'].join('\n'), []);
// Ölçülen hatanın kaynağı: `headers: H` ile tanımı dosyanın başında olan çağrı
const dogruDegisken = araKorumasiz([
  "const H = { 'Content-Type': 'application/json', 'X-Sync-Token': 'full-token' };",
  "const r = await fetch(base + '/kayit/batch', { method: 'POST', headers: H });",
].join('\n'), []);
// Aynı biçim ama KİMLİKSİZ tanım: bu yakalanmalı
const kirikDegisken = araKorumasiz([
  "const H = { 'Content-Type': 'application/json' };",
  "const r = await fetch(base + '/kayit/batch', { method: 'POST', headers: H });",
].join('\n'), []);


// --- Yol 2 sinamasi: istek bir YARDIMCI icindeyse uc, cagri yerindedir ---
// (olculen hata tam olarak bu yoldu: uç nokta HTTP satırında değil,
//  curl('/durum') çağrısındaydı.)
const yardimciKirik = araKorumasiz([
  'const curl = (yol) => exec(`curl -s http://127.0.0.1:4545${yol}`);',
  "const d = await curl('/durum');",
].join('\n'), []);
const yardimciDuz = araKorumasiz([
  "const YETKI = 1;",
  'const curl = (yol) => exec(`curl -s ${YETKI} http://127.0.0.1:4545${yol}`);',
  "const d = await curl('/durum');",
].join('\n'), []);
function isaret(k, ad) {
  if (k) { console.log('  GECTI  ' + ad); return 0; }
  console.log('  KALDI  ' + ad + '  <-- denetim işe yaramıyor, yukarıdaki denetim anlamsız');
  return 1;
}
hata += isaret(kirikYakalandi, 'kırık fetch örneği yakalandı');
hata += isaret(kirikCurl.length === 1, 'kırık curl örneği yakalandı (ölçülen boşluk)');
hata += isaret(dogru.length === 0, 'doğru fetch örneği yanlış alarm vermiyor');
hata += isaret(dogruSessiz.length === 0, 'doğru Authorization örneği yanlış alarm vermiyor');
hata += isaret(dogruToken.length === 0, 'X-Sync-Token örneği yanlış alarm vermiyor (ölçülen kusurun kanıtı)');
hata += isaret(dogruDegisken.length === 0, 'kimlikli `headers: H` değişkeni yanlış alarm vermiyor');
hata += isaret(kirikDegisken.length === 1, 'kimlikSİZ `headers: H` değişkeni yakalandı');
hata += isaret(yardimciKirik.length === 1, 'kimliksİZ curl yardımcısı çağrısı yakalandı (olçülen hata)');
hata += isaret(yardimciDuz.length === 0, 'kimlikli curl yardımcısı çağrısı yanlış alarm vermiyor');

console.log('');
console.log('=== DOSYA TARAMASI ===');
// Bu dosya KENDİSİ taranmaz. İçindeki kasıtlı bozuk örnekler ("kırık fetch
// örneği") denetimi sınar; taransa kendi kanıtını kendi hatası sanardı.
// (Ölçülen yanlış alarm: 3 bulgu bu yüzden çıktı.)
const hepsi = [...DOSYALAR, ...testDosyalari()].filter((d) => !/test-istemci-kimlik/.test(d));
for (const d of hepsi) {
  const yol = path.join(KOK, d);
  if (!fs.existsSync(yol)) { console.log('  EKSİK  ' + d); hata++; continue; }
  const bulunan = [];
  araKorumasiz(fs.readFileSync(yol, 'utf8'), bulunan);
  kontrol += (fs.readFileSync(yol, 'utf8').match(CAGRI) || []).length;
  if (bulunan.length) {
    for (const b of bulunan) {
      console.log('  EKSİK   ' + d + ':' + b.satir + '  ' + b.metin);
      hata++;
    }
  }
}
console.log('  (taranan dosya: ' + hepsi.length + ')');

console.log('');
console.log('Denetlenen çağrı deseni: ' + kontrol);
console.log('Sorun: ' + hata);
if (hata === 0) {
  console.log('SONUÇ: geçerli — tüm korumalı uç çağrıları kimlik gönderiyor');
  process.exit(0);
}
console.log('SONUÇ: sorun var — kimlik göndermeyen istek(ler) bulundu');
process.exit(1);
