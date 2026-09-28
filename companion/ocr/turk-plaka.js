'use strict';
// ============================================================================
//  TÜRK PLAKA KURALLARI — TEK KAYNAK
// ----------------------------------------------------------------------------
//  Bu dosya NEDEN var?
//    Plaka kuralları iki yerde gerekiyordu: Tesseract hattı (plaka.js) ve
//    fast-plate-ocr hattı (hat-fpo.js). Kuralları iki yere kopyalarsak zamanla
//    AYRIŞIRLAR — birinde il kodu 81'e kadar, diğerinde 99'a kadar kabul
//    edilir ve "hangi doğru?" sorusu cevapsız kalır. Bu yüzden kurallar burada
//    bir kez yazılır, iki hattı da buradan alır.
//
//  Buradaki kuralların neyi kapsadığı (rehber §7.1, §14):
//    * Biçim: İL(2 rakam) + HARF(1-3) + RAKAM(2-4)
//    * İl kodu 01-81
//    * Q ve W Türk plakasında kullanılmaz
//    * Karakter SINIFINA göre karışıklık çözümü
//  DOĞRULANMASI GEREKEN (resmi kaynakla teyit edilmedi, §14):
//    * "İkinci hane tek sayı olmalı" yaygın bir SEZGİDİR ve resmî dayanağı
//      yoktur. Bu yüzden UYGULANMAZ — `CINSIYET` bilinçli olarak null'dur.
//    * Harf sayısı ↔ rakam sayısı resmî tablosu. Şimdilik YAYGINLIK cezası
//      olarak uygulanıyor (ağır ceza değil), tablo doğrulanınca kesinleşecek.
// ============================================================================

// Türkiye'de plaka "CINSIYET" ayrımı yoktur (yaygın yanlış inanış).
// Doğrulanana kadar kural UYGULANMAZ.
const CINSIYET = null;

const isDig = (c) => c >= '0' && c <= '9';
const isLet = (c) => c >= 'A' && c <= 'Z';

// Karışan çiftler (rehber §7.2 tablosu)
const CH2DIG = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', G: '6', B: '8', A: '4', T: '7' };
const CH2LET = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '6': 'G', '8': 'B', '4': 'A', '7': 'T' };
const HARFLER = 'ABCDEFGHİJKLMNOPRSTUVYZ';

/** Metni plaka karakterlerine indirger: TR yazısını, boşlukları, noktalama işaretlerini atar. */
function temizle(s) {
  return String(s == null ? '' : s)
    .toLocaleUpperCase('tr-TR')
    .replace(/[^0-9A-Z]/g, '')
    .replace(/^TR(?=\d)/, '')      // sol şeritten sızan "TR"
    .replace(/^C(?=\d)/, '');      // sol üst köşeden sızan ülke kodu
}

/** Biçimlendirilmiş plaka: "34 ABC 123" */
function bicimlendir(s) {
  const t = temizle(s);
  const m = t.match(/^(\d{2})([A-Z]{0,3})(\d{0,5})$/);
  if (m) return (m[1] + (m[2] ? ' ' + m[2] : '') + (m[3] ? ' ' + m[3] : '')).trim();
  return t;
}

/**
 * Karşılaştırma anahtarı: harf/rakam karışıklığını giderir.
 * DİKKAT: karakter sınıfı DOĞRU yazılmalı. `[IL]` yerine `/IL]/` yazılmıştı;
 * bu görünürde çalışıyor gibi görünse de I harfini eşlemiyordu.
 */
function anahtar(s) {
  return temizle(s)
    .replace(/[OQD]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/Z/g, '2')
    .replace(/G/g, '6')
    .replace(/B/g, '8')
    .replace(/A/g, '4')
    .replace(/T/g, '7');
}

/** Levenshtein uzaklığı (kısa diziler için bellek dostu). */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let önceki = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const şimdi = [i + 1];
    for (let j = 0; j < b.length; j++) {
      şimdi.push(Math.min(
        önceki[j + 1],
        şimdi[j] + 1,
        önceki[j] + (a[i] === b[j] ? 0 : 1)
      ));
    }
    önceki = şimdi;
  }
  return önceki[b.length];
}

/**
 * Yapısal geçerlilik puanı (0 = geçersiz, yüksek = güçlü).
 * Türk plaka yapısı: 2 rakam + 1-3 harf + 2-4 rakam.
 *   "06 TL 5001" gibi 5 rakamlı okumalar geçersizdir; eski kod bunları
 *   yüksek puanla geçiriyordu, en sık hata kaynağıydı.
 *
 * >= 10 eşiği "yapı geçerli" sayılır; 10'un altı reddedilir.
 */
function yapiPuani(plaka) {
  const ham = temizle(plaka);
  const m = ham.match(/^(\d{2})([A-Z]{1,3})(\d{2,4})$/);
  if (!m) return 0;

  // İl kodu Türkiye'de 01-81 arasındadır (Kuzey Kıbrıs 90-99 hariç,
  // trafikte "TR" bandıyla ayrılır). Aralık dışı KESİNLİKLE Türk plakası
  // değildir: 84/99 gibi kodlar puanla değil, tamamen elenmelidir — yoksa
  // "B4" -> "84" gibi bir OCR hatası geçerli sonuç gibi sunulur.
  const ilKodu = parseInt(m[1], 10);
  if (ilKodu < 1 || ilKodu > 81) return 0;

  let ceza = 0;
  if (CINSIYET && CINSIYET.test(m[1][1])) ceza += 3;   // kullanılmıyor (efsane)

  if (/[QW]/.test(m[2])) ceza += 8;            // TR plakasında yok
  // 3 harf + 4 rakam kombinasyonu Türkiye'de çok nadir (çoğu 2 harflidir).
  if (m[2].length === 3 && m[3].length >= 4) ceza += 4;
  else if (m[2].length === 3) ceza += 1;
  if (m[3].length === 2) ceza += 2;            // 2 haneli seri daha az yaygın
  if (m[2].length === 1) ceza += 1;
  if (ham.length > 10) ceza += 3;

  return Math.max(0, 15 - ceza);
}

/**
 * Yapısal geçerlilik eşiği.
 *
 * Neden 10 değil 12? ÖLÇÜLEN OLAY: fast-plate-ocr bir plakayı %97 GÜVENLE
 * "34 ABC 1223" olarak okudu — 9 karakter, 3 harf + 4 rakam. Bu, standart
 * Türk özel plaka biçimi DEĞİLDİR ve model yüksek güvenle yanlış okudu
 * (rehber §13.5: "yüksek güven = doğru demez").
 *
 *   34 ABC 123  (2 harf + 3 rakam)  yapiPuani 15  -> kabul
 *   34 AB 1234  (2 harf + 4 rakam)  yapiPuani 15  -> kabul
 *   34 A 1234   (1 harf  + 4 rakam) yapiPuani 14  -> kabul
 *   34 ABC 12   (3 harf + 2 rakam)  yapiPuani 12  -> kabul
 *   34 ABC 1223 (3 harf + 4 rakam)  yapiPuani 11  -> REDDEDİLİR
 *
 * Yani eşik 12 iken TÜM standart biçimler geçer, yalnızca 3 harf + 4 rakam
 * elenir. Bu, plaka formatındaki yaygın yapıyı yansıtır.
 *
 * DOĞRULANMASI GEREKEN (rehber §14): harf sayısı ↔ rakam sayısının resmî
 * tablosu. Şu an bu eşik YAYGINLIK yorumuna dayanıyor. Resmî tablo
 * doğrulanırsa sayılar resmî kaynağa göre güncellenmelidir.
 */
const YAPI_ESIK = 12;

function yapiGecerli(plaka) {
  return yapiPuani(plaka) >= YAPI_ESIK;
}

module.exports = {
  CINSIYET, isDig, isLet,
  CH2DIG, CH2LET, HARFLER,
  temizle, bicimlendir, anahtar, levenshtein,
  yapiPuani, yapiGecerli, YAPI_ESIK,
};
