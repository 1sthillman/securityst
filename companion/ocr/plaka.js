'use strict';
// ============================================================================
//  Plaka Okuma Motoru — tamamen yerel, çevrimdışı, saf JavaScript/WASM
// ----------------------------------------------------------------------------
//  Neden bu dosya var?
//    Kulübede internet olmayabilir. Nöbetçinin plakasının fotoğrafı bulut
//    OCR servislerine gönderilmemeli. Bilgisayarda Python/OpenCV/C++
//    derleyicisi kurulmamalı. Motor Node'un kendi içinde, WebAssembly olarak
//    çalışır; tüm platformlarda (x64/arm64, Win10/11, Linux, macOS) aynıdır.
//
//  Nasıl çalışır?
//    [telefon kırpılmış plaka PNG'si] -> [çoklu ön işleme] -> [Tesseract WASM]
//      -> [kendini onaran karakter düzeltme] -> [puanlama] -> [en iyi aday]
//
//  Tasarım kararları:
//   * Dil paketi (eng.traineddata) KURULUM PAKETİNDE gelir; çalışma anında
//     hiçbir ağ isteği yapılmaz.
//   * Motor tembel yüklenir (ilk plaka okumada ~2 sn), sonra sıcak tutulur.
//   * Hiç kullanılmazsa kendiliğinden kapanır (RAM'i geri verir).
//   * Tüm işler tek bir kuyruktan geçer: WASM çalışma zamanı eşzamanlı
//     çağrıya dayanıklı değildir, sıra bozulursa sonuçlar birbirine girer.
//   * Üstüne birden fazla ön işleme denenir (normal, ters, yüksek kontrast,
//     Otsu, Sauvola) ve puanı en yüksek sonuç seçilir. Tek bir eşik
//     değerine güvenmek ışık koşulları değişince başarısızlık demektir.
// ============================================================================

const path = require('path');
const fs = require('fs');
const jpeg = require('jpeg-js');
const G = require('./gorsel.js');
// Türk plaka kuralları TEK KAYNAKTA (turk-plaka.js). fast-plate-ocr hattı
// da aynı doğrulayıcıyı kullanır; iki yerde kural kopyalanırsa zamanla
// ayrışırlar.
const TP = require('./turk-plaka.js');
const FPO = require('./plaka-fpo.js');
const HAT_FPO = require('./hat-fpo.js');

let TESSERACT = null;
try { TESSERACT = require('tesseract.js'); } catch { /* kurulu değil */ }

const PSM = TESSERACT ? TESSERACT.PSM : { SINGLE_LINE: '7', SINGLE_WORD: '8', SINGLE_BLOCK: '6', SPARSE_TEXT: '11' };

const DIL = path.join(__dirname, 'lang');

// ---------------------------------------------------------------------------
//  MOTOR SEÇİMİ — hangi hattın okuduğu
// ---------------------------------------------------------------------------
//  CKY_MOTOR ortam değişkeni veya seçenek ile belirlenir:
//    'fpo'         fast-plate-ocr (ÖNERİLEN — ölçüldü: %86,7 tam eşleşme,
//                  karakter başına güven, plakasız karede dürüst boş dönüş)
//    'tesseract'   eski hat (yedek)
//    'fpo+tesseract'  GÖLGE MOD: ikisini de çalıştırır, cevap hızlı olanın,
//                  karşılaştırma günlüğe yazılır. Üretim kararını ölçerek
//                  vermek için (rehber §12.14).
//  Bilinmeyen değer 'fpo'ya düşer ve durum ekranında hangisinin seçildiği
//  görünür — sessizce başka bir hatta düşmemek için.
const MOTOR_SECENEKLERI = ['fpo', 'tesseract', 'fpo+tesseract'];
const VARSAYILAN_MOTOR = 'fpo';

function motorSec() {
  const ham = String(process.env.CKY_MOTOR || VARSAYILAN_MOTOR).toLowerCase().trim();
  return MOTOR_SECENEKLERI.includes(ham) ? ham : VARSAYILAN_MOTOR;
}

// ---------------------------------------------------------------------------
//  Türk plaka yapısı
// ---------------------------------------------------------------------------
// Türk plaka kuralları TEK KAYNAKTA yaşıyor: turk-plaka.js
//   (temizle, bicimlendir, anahtar, levenshtein, yapiPuani,
//    CH2DIG, CH2LET, HARFLER, CINSIYET)
//
// Neden ayrıldı? fast-plate-ocr hattı (hat-fpo.js) da aynı doğrulayıcıyı
// kullanıyor. Kurallar iki yerde kopyalansaydı zamanla AYRIŞIRDI: birinde
// il kodu 81'e kadar, diğerinde 99'a kadar kabul edilir ve "hangisi doğru?"
// sorusu cevapsız kalır. Ayrıca buradaki "Q/W kullanılmaz" ve il kodu
// 01-81 kurallarının gerekçeleri turk-plaka.js içinde belgelidir.
const CINSIYET = TP.CINSIYET;
const isDig = TP.isDig;
const isLet = TP.isLet;
const CH2DIG = TP.CH2DIG;
const CH2LET = TP.CH2LET;
const HARFLER = TP.HARFLER;
const temizle = TP.temizle;
const bicimlendir = TP.bicimlendir;
const anahtar = TP.anahtar;
const levenshtein = TP.levenshtein;
const yapiPuani = TP.yapiPuani;

/**
 * Ham OCR metninden makul plaka adayları üretir.
 *
 * Kendini onarma stratejisi (konuma duyarlı):
 *   1. Metni temizle.
 *   2. İlk iki karakter zorunlu olarak rakam olmalı → harfse en yakın rakama çevir.
 *   3. Harf bloğu zorunlu olarak harf olmalı → rakamse en yakın harfe çevir.
 *   4. Sondaki rakam bloğu rakam olmalı → harfse rakama çevir.
 *   5. Uzunluk düzeltmeleri: fazladan/eksik karakter denemeleri.
 * Her aday cezasıyla birlikte üretilir; en yüksek puanlı olan kazanır.
 */
function adayUret(hamMetin, bilinenler = []) {
  const tohumlar = [];
  const ham = temizle(hamMetin);
  if (!ham) return [];
  tohumlar.push({ s: ham, ceza: 0 });

  // Uzunluk düzeltmeleri: tek karakter silme / sondaki tekrarı atma
  for (let j = 2; j < ham.length - 1; j++) tohumlar.push({ s: ham.slice(0, j) + ham.slice(j + 1), ceza: 3 });
  for (let j = 3; j < ham.length; j++) {
    if (ham[j] !== ham[j - 1]) continue;
    tohumlar.push({ s: ham.slice(0, j) + ham.slice(j + 1), ceza: 2 });
  }

  // RAKAM EKLEME. ÖLÇÜLEN OLAY: Tesseract "34ABC1" okudu (güven %94) —
  // plakayı neredeyse mükemmel, yalnızca serinin son rakamı düşmüş. Mevcut
  // onarım sadece SİLME yapıyordu; "34ABC1" yapı denetiminde (seri 2-4
  // hane) tamamen elendi ve %94 güvenli doğru okuma kayboldu. Plaka
  // okumada en sık görülen OCR hatası, ince karakterlerin kaybolmasıdır.
  // Yalnızca seri kısa olduğunda denenir (3-7 rakam); aksi hâlde yapay
  // olarak uzun plaka uydurur.
  {
    const rakamSayisi = (ham.match(/\d/g) || []).length;
    if (rakamSayisi >= 3 && rakamSayisi <= 7) {
      for (let i = 0; i < ham.length; i++) {
        for (const d of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
          tohumlar.push({ s: ham.slice(0, i) + d + ham.slice(i), ceza: 4 });
        }
      }
    }
  }

  // DİKKAT: Tohumlar ucuzdan pahalıya SIRALANMALI. Aksi hâlde aynı plakayı
  // üreten pahalı tohum (tek karakter silme, ceza 3) ucuz tohumdan (sondaki
  // tekrarı atma, ceza 2) önce gelir; `gorulen` kümesi zaten iyisini eler ve
  // doğru onarım kaybolur — "06KL23011" yerine "06KL2011" gibi hatalı bir
  // sonuç çıkıyordu.
  tohumlar.sort((a, b) => a.ceza - b.ceza);

  const cikti = [];
  const gorulen = new Set();

  for (const tohum of tohumlar) {
    for (let atla = 0; atla <= 2; atla++) {
      const s = tohum.s.slice(atla);
      if (s.length < 5 || s.length > 12) continue;

      // 1) ilk iki hane rakam olmalı
      let il = '', ilDuzeltme = 0;
      for (let k = 0; k < 2; k++) {
        const c = s[k];
        if (isDig(c)) il += c;
        else if (CH2DIG[c]) { il += CH2DIG[c]; ilDuzeltme++; }
        else { il = ''; break; }
      }
      if (!/^\d{2}$/.test(il)) continue;

      // 2) harf bloğu 1-3 harf
      for (let L = 1; L <= 3; L++) {
        const numLen = s.length - 2 - L;
        if (numLen < 2 || numLen > 4) continue;
        let harfler = '', harfDuzeltme = 0, bozuk = false;
        for (let k = 0; k < L; k++) {
          const c = s[2 + k];
          if (isLet(c)) { harfler += c; continue; }
          if (c === 'W' || c === 'X') { harfler += 'V'; harfDuzeltme++; continue; }
          if (CH2LET[c]) { harfler += CH2LET[c]; harfDuzeltme++; continue; }
          bozuk = true; break;
        }
        if (bozuk || !harfler) continue;

        // 3) son blok rakam olmalı
        const rakamHam = s.slice(2 + L);
        let rakamlar = '', rakamDuzeltme = 0;
        for (const c of rakamHam) {
          if (isDig(c)) { rakamlar += c; continue; }
          if (CH2DIG[c]) { rakamlar += CH2DIG[c]; rakamDuzeltme++; continue; }
          rakamlar = ''; break;
        }
        if (rakamlar.length < 2 || rakamlar.length > 4) continue;

        const plaka = il + harfler + rakamlar;
        if (gorulen.has(plaka)) continue;
        gorulen.add(plaka);

        // Kaç karakterde tahmin yaptık? Her düzeltme bir bahistir; az olan kazanır.
        // DİKKAT: Daha önce burada `(6 - toplamUzunluk)` gibi bir UZUNLUK ÖDÜLÜ
        // vardı; negatif çıkıp puanı YÜKSELTİyordu ve 9 karakterli hatalı
        // adayları 8 karakterli doğruların önüne geçiriyordu.
        const duzeltme = tohum.ceza + atla + ilDuzeltme + harfDuzeltme + rakamDuzeltme;
        let puan = yapiPuani(plaka) - duzeltme;
        if (puan < 0) puan = 0;

        // Bilinen kurye listesinde eşleşme: EN YÜKSEK puan
        const k = anahtar(plaka);
        for (const b of bilinenler) {
          const bk = anahtar(b);
          if (!bk) continue;
          if (bk === k) { puan += 30; break; }
          const d = levenshtein(bk, k);
          if (d === 1) { puan += 14; break; }
          if (d === 2 && bk.length === k.length) { puan += 6; break; }
        }

        cikti.push({ plaka, bicim: bicimlendir(plaka), puan, duzeltme, yapi: yapiPuani(plaka) });
      }
    }
  }

  // Puan eşitse az düzeltme yapan kazanır; o da eşitse alfabetik sıra
  // (böylece sıralama kararlı olur, testler ve arayüz tekrarlanabilir olur).
  cikti.sort((a, b) => (b.puan - a.puan) || (a.duzeltme - b.duzeltme) || a.plaka.localeCompare(b.plaka));
  // Aynı biçimlendirilmiş plakadan yalnızca en iyisi kalsın
  const tekil = new Map();
  for (const a of cikti) if (!tekil.has(a.bicim)) tekil.set(a.bicim, a);
  return Array.from(tekil.values()).slice(0, 6);
}

// ---------------------------------------------------------------------------
//  Ön işleme varyantları
// ---------------------------------------------------------------------------
/** Kenar boşluğunu kırpıp yeni bir tampona yazar (kontrast tabanlı — gorsel.js). */
function kirpla(gri, genislik, yukseklik, esik = 12) {
  const k = G.kirp(gri, genislik, yukseklik, esik);
  if (!k) return { veri: gri, genislik: genislik, yukseklik };
  const t = new Uint8ClampedArray(k.g * k.y2);
  for (let yy = 0; yy < k.y2; yy++) {
    for (let xx = 0; xx < k.g; xx++) t[yy * k.g + xx] = gri[(k.y + yy) * genislik + (k.x + xx)];
  }
  return { veri: t, genislik: k.g, yukseklik: k.y2 };
}

/**
 * Verilen dikdörtgeni gri tondan keser (bölge araması için).
 * @param {{x,y,g,y2}} bolge gerçek çözünürlükte dikdörtgen
 * @returns {{veri, genislik, yukseklik}|null} geçersizse null
 */
function bolgeKirp(gri, genislik, yukseklik, bolge) {
  if (!bolge) return null;
  const x0 = Math.max(0, Math.min(genislik - 1, bolge.x | 0));
  const y0 = Math.max(0, Math.min(yukseklik - 1, bolge.y | 0));
  const g0 = Math.max(1, Math.min(genislik - x0, bolge.g | 0));
  const h0 = Math.max(1, Math.min(yukseklik - y0, bolge.y2 | 0));
  if (g0 < 8 || h0 < 6) return null;
  const t = new Uint8ClampedArray(g0 * h0);
  for (let j = 0; j < h0; j++) {
    const kaynak = (y0 + j) * genislik + x0;
    t.set(gri.subarray(kaynak, kaynak + g0), j * g0);
  }
  return { veri: t, genislik: g0, yukseklik: h0 };
}

/**
 * Plaka bölgelerini arar (companion/ocr/bolge.js).
 *
 * DİKKAT — BURADA sessizce yutulan hata, ÜRETİMDEKİ EN PAHALI HATA SINIFINI
 * oluşturdu. `try { require } catch { }` deseni, geliştirmekte dosya yanında
 * durduğu için hiç tetiklenmedi; kurulum paketine eklenmeyince (Inno Setup
 * dosyaları tek tek listeler) modül yüklenemedi ve bölge bulucu devre dışı
 * kaldı. Ölçülen sonuç:
 *     geliştirmede 10/10 sahne okundu, kurulu sürümde 2/10.
 * Hiçbir hata mesajı yoktu — çünkü hata yutulmuştu.
 *
 * Şimdi eksiklik KAYDA GEÇER ve durumda bildirilir; ayrıca bölge bulucu
 * çalışmasa bile okuma sürer (tam kare yedeği), ama bu durum ARTık görünür.
 */
let bolgeBul = () => [];
let bolgeBulucuHatasi = null;
try {
  ({ bul: bolgeBul } = require('./bolge.js'));
} catch (e) {
  bolgeBulucuHatasi = e.message || String(e);
  bolgeBul = () => [];
}

/**
 * Kullanıcının kırpma dikdörtgeninden sunucu çözünürlüğünde bölge üretir.
 *
 * Neden var? ÖLÇÜLEN OLAY: nöbetçi plakanın etrafına dikdörtgen çiziyor,
 * biz o bilgiyi hiç kullanmıyorduk. Sahne fotoğrafında bölge bulucu 8 aday
 * buluyor ama hiçbiri plaka değil:
 *     bolge=8 -> ham okuma: "TR | TR | TR | TR"   (mavi TR şeridi!)
 * Kullanıcının niyetini bilen sistem o niyeti kullanmalıdır. Dikdörtgen
 * %100 genişlikte yatay bant olduğu için doğrudan okuma bölgesi olur.
 *
 * @param {{ust:number, yukseklik:number}} ipucu yüzde değerleri
 * @returns {{x,y,g,y2}|null} görüntü çözünürlüğünde bölge
 */
function ipucuBolgesi(ipucu, genislik, yukseklik) {
  if (!ipucu || typeof ipucu !== 'object') return null;
  const ust = Number(ipucu.ust);
  const yuk = Number(ipucu.yukseklik);
  if (!isFinite(ust) || !isFinite(yuk)) return null;
  if (yuk < 2 || yuk > 100) return null;              // anlamsız bant
  const y0 = Math.max(0, Math.min(yukseklik - 4, Math.round((ust / 100) * yukseklik)));
  const y1 = Math.max(y0 + 8, Math.min(yukseklik, y0 + Math.round((yuk / 100) * yukseklik)));
  return { x: 0, y: y0, g: genislik, y2: y1 - y0 };
}

/**
 * Kullanıcının kırpma bandı içinde plaka benzeri bölgeleri arar.
 *
 * @param {Uint8ClampedArray} gri tüm karenin gri tonu
 * @param {{x,y,g,y2}} bant ipucu bandı (tam kare koordinatı)
 * @param {number} g, y tüm karenin ölçüleri
 * @param {number} enFazla en çok aday
 * @returns {Array} tam kare koordinatında bölgeler, puandan başa doğru
 */
function ipucuIcindeBolgeler(gri, bant, g, y, enFazla) {
  if (!bant || bant.y2 < 8) return [];
  // Bandı ayrı bir tampona kopyala (bolgeBul kendi ölçeklemesini yapar).
  const kirp = { veri: new Uint8ClampedArray(bant.g * bant.y2), genislik: bant.g, yukseklik: bant.y2 };
  for (let j = 0; j < bant.y2; j++) {
    const kaynak = (bant.y + j) * g;
    kirp.veri.set(gri.subarray(kaynak, kaynak + bant.g), j * bant.g);
  }
  let bulunan = [];
  try {
    bulunan = bolgeBul(kirp.veri, kirp.genislik, kirp.yukseklik, enFazla);
  } catch {
    return [];                       // ipucu bozuksa sessizce vazgeç
  }
  // Tam kare koordinatına geri çevir.
  return (bulunan || [])
    .map((b) => ({ ...b, x: b.x + bant.x, y: b.y + bant.y, ipucuIcinde: true }))
    .filter((b) => b.g > 20 && b.y2 >= 8);
}
/**
 * Bir Tesseract geçişinin tahmini maliyeti (saniye) — BOYUT DUYARLI.
 *
 * ÖLÇÜM (bu makine, y18 sahnesi, 11 geçiş, gerçek zamanlama):
 *     369x96    ->   35 ms
 *     461x234   ->  127 ms
 *     2048x611  -> 2265 ms
 *     1978x1112 -> 4459 ms
 * Doğrusal uyum: süre_ms ≈ 2.04e-3 x piksel.
 *
 * Neden bu kadar önemli? Sabit bir eşik işe yaramıyordu. Önceden
 * "kalan süre > 0.3 sn" denetimi vardı; kalan 0.3 sn iken başlatılan bir
 * tam kare geçişi 4.5 saniye sürüyor ve 5 saniyelik bütçe 7.4 saniyeye
 * çıkıyordu. NÖBETÇİ 10 SANİYE BEKLİYORDU ve yine de plaka okunmuyordu.
 *
 * Tahmin, onIsle()'in gerçek büyütme kuralını taklit eder; kirpma
 * varyantları yalnızca küçülttüğü için tahmin daima üst sıra kalır.
 */
function tahminiPiksel(genislik, yukseklik) {
  const MAKS_PIKSEL = 2_200_000, MAKS_KENAR = 2200;
  let carpan = Math.min(4.5, Math.max(96, yukseklik * 3.2) / Math.max(1, yukseklik));
  if (genislik * yukseklik * carpan * carpan > MAKS_PIKSEL) {
    carpan = Math.sqrt(MAKS_PIKSEL / Math.max(1, genislik * yukseklik));
  }
  carpan = Math.max(1, carpan);
  const en = Math.max(genislik * carpan, yukseklik * carpan);
  if (en > MAKS_KENAR) carpan *= MAKS_KENAR / en;
  return Math.max(1, Math.round(genislik * carpan * yukseklik * carpan));
}

/** Ölçülen katsayı: 4459 ms / 2.2 Mpx = 2.03 us/piksel. Emniyet için 2.6. */
const GECIS_US_PIKSEL = 2.6e-6;

/** Bir bölgenin tek geçişinin tahmini süresi (saniye). */
function gecisMaliyetiSn(genislik, yukseklik) {
  return Math.max(0.05, tahminiPiksel(genislik, yukseklik) * GECIS_US_PIKSEL);
}
/** Bölgeyi iki yana doğru genişletir (kenarı kesilmiş harfleri toparlar). */
function genisletBolge(bolge, genislik, yukseklik) {
  const px = Math.max(6, Math.round(bolge.y2 * 0.35));
  const py = Math.max(4, Math.round(bolge.y2 * 0.30));
  const x0 = Math.max(0, bolge.x - px);
  const y0 = Math.max(0, bolge.y - py);
  const x1 = Math.min(genislik, bolge.x + bolge.g + px);
  const y1 = Math.min(yukseklik, bolge.y + bolge.y2 + py);
  if (x1 - x0 < 16 || y1 - y0 < 10) return null;
  return { x: x0, y: y0, g: x1 - x0, y2: y1 - y0 };
}

/**
 * Ters çevirir: koyu yazı/açık zemin -> açık yazı/koyu zemin.
 * Tesseract koyu metni açık zeminde de okur, ancak ÖLÇÜLEN tutarlılık
 * ters çevrilmiş (beyaz yazı) hâlde çok daha yüksek: %96'ya karşı %14.
 * Bu yüzden tüm hatlar ters çevirme ile biter.
 */
function tersCevir(kaynak) {
  const o = new Uint8ClampedArray(kaynak.length);
  for (let i = 0; i < kaynak.length; i++) o[i] = 255 - kaynak[i];
  return o;
}

/**
 * Ön işleme varyantı üretir.
 *
 * ÖNEMLİ DÜZELTME 1 — büyütme SIRASI değişti.
 * Önce ikili (0/255) görüntü yapılıp sonra büyütülüyordu; bilineer
 * interpolasyon 0/255 değerleri arasında gri kenar üretti ve Tesseract
 * merdiven basamağı kenarları okuyamıyordu. Küçük plakada ölçülen hata:
 *   "34 ABC 123" -> "34 ANC 127" (B→N, C→A, 3→7)
 * Artık önce GRİ tonlama büyütülüyor, sonra ikilileştiriliyor.
 *
 * ÖNEMLİ DÜZELTME 2 — kırpma bir SEÇENEK, bir kural değil.
 * "Kırpmak mı kırpmamak mı?" sorusu senaryodan senaryoya değişiyordu:
 *   küçük plaka  bölge 112x45 -> kirpsiz oran 2.49, guven 0   (METİN YOK)
 *                kirpli  94x23 -> oran 3.84,   guven 71  (DOĞRU)
 *   büyük plaka  kirpma harflerin kenarını kırpıyordu (34 ABC 123 -> 34 ARC 123)
 * Tahmin yürütmenin yerine ölçtürüyoruz: varyant adının "-k" eki
 * kontrast tabanlı kırpma uygular, ekis yoksa uygulamaz. İkisi de denenir,
 * motorun güven puanı kazananı seçer.
 *
 *   normal   HIZLI YOL: kırp -> germe -> 3-4x büyüt -> ters çevir.
 *   otsu     ZORLU YOL: aynı + Otsu eşiği.
 *   sauvola  ZORLU YOL: aynı ama yerel (adaptif) eşik.
 *   *-k      Kenar boşlukları kontrast tabanlı kirp() ile atılır.
 */
function onIsle(gri, genislik, yukseklik, varyantAdi) {
  const kirpVaryanti = /-k$/.test(varyantAdi);
  const varyant = varyantAdi.replace(/-k$/, '');
  const k = kirpVaryanti
    ? kirpla(gri, genislik, yukseklik, 10)
    : { veri: gri, genislik, yukseklik };
  const g = k.genislik, y = k.yukseklik;
  const germe = G.kontrastGerme(k.veri, 1, 1);

  // 1) Büyütme faktörü — hem küçük metni yeterince büyüt, hem de
  //    piksel bütçesini ASLA aşma (aşmak Tesseract'ı çökertiyor:
  //    1280x720 kare 3x -> 3840x2160 -> "Too many properties to enumerate").
  const hedefY = Math.max(96, y * 3.2);
  let carpan = Math.min(4.5, hedefY / Math.max(1, y));
  // Güvenlik: çıktı en fazla MAKS_PIKSEL ve MAKS_KENAR
  const MAKS_PIKSEL = 2_200_000;
  const MAKS_KENAR = 2200;
  if (g * y * carpan * carpan > MAKS_PIKSEL) carpan = Math.sqrt(MAKS_PIKSEL / (g * y));
  carpan = Math.max(1, carpan);
  const ng0 = g * carpan, ny0 = y * carpan;
  if (Math.max(ng0, ny0) > MAKS_KENAR) {
    carpan = MAKS_KENAR / Math.max(ng0, ny0);
  }

  if (carpan <= 1.02) {
    // Büyütme gerekmiyor: doğrudan işle
    return bittiMi(germe.veri, g, y, varyant);
  }

  const ng = Math.max(24, Math.round(g * carpan));
  const ny = Math.max(24, Math.round(y * carpan));
  // 2) GRİ TONLAMA büyüt (yumuşak kenarlar — Tesseract için daha okunur)
  const buyuk = G.olcekle(germe.veri, g, y, ng, ny);
  // 3) Küçük metinde ek yumuşatma: interpolasyonun bıraktığı merdiveni al
  const yumusak = ny < 200 ? G.bulaniklastir(buyuk, ng, ny, 1) : buyuk;
  return bittiMi(yumusak, ng, ny, varyant);
}

/** Büyütülmüş görüntüye ikilileştirme uygular ve ters çevirir. */
function bittiMi(veri, g, y, varyant) {
  if (varyant === 'normal') return { veri: tersCevir(veri), genislik: g, yukseklik: y };

  let ikili;
  if (varyant === 'otsu') {
    ikili = veri.slice();
    const t = G.otsuEsik(ikili);
    for (let i = 0; i < ikili.length; i++) ikili[i] = ikili[i] > t ? 255 : 0;
  } else {
    ikili = G.sauvolaEsik(veri, g, y);
  }
  return { veri: tersCevir(ikili), genislik: g, yukseklik: y };
}

/**
 * Görüntüde okunabilir metin var mı?
 *
 * Neden önemli? Üç neden birden:
 *  1) Boş/gürültülü görüntüde Tesseract 1-4 saniye harcar ve yine de
 *     sonuç döndürmez. Kullanıcı o süre boyunca kamerayı bekler.
 *  2) Tesseract'ın WASM çekirdeği metin bulamadığında konsola kendi hata
 *     ayıklama çıktısını basıyordu ( servis günlüğünü kirletiyordu).
 *  3) Nöbetçinin en sık yaptığı hata: plakayı değil, manzarayı çekmek.
 *     Erken ve anlaşılır bir mesaj ("çerçeveye plakayı alın") işe yarar.
 *
 * Ölçüt: Otsu eşiğine göre koyu piksel oranı. Plaka metni bir kırpımın
 * %2-55'ini kaplar; altı gürültü, üstü ise dolu/görüntü bozuk.
 */
function metinVarMi(gri) {
  return bozukGorsetMi(gri) === null;
}

/**
 * Görüntü GERÇEKTEN kullanılamaz mı? (durable bozuk-görüntü tespiti)
 *
 * DİKKAT — bu fonksiyon bilinçli olarak ÇOK TUTUCUDUR. Önceki sürüm Otsu
 * eşiğini tüm görüntüye uygulayıp "koyu piksel oranı %2-55 aralığında olmalı"
 * diyordu. Bu, kırpılmış plaka görüntüleri için doğruydu ama SAHNE
 * görüntülerinde tam olarak yanlıştı: Otsu sahneyi böler (gökyüzü / zemin),
 * oran %99'a çıkar ve GERÇEK plaka içeren kare "metin yok" diye elenir.
 * Ölçüm: 8 gerçekçi sahnenin 8'inde de hata.
 *
 * Şimdi yalnızca "kimsenin okuyamayacağı" durumları eleniyoruz:
 *   - çok küçük görüntü
 *   - tek renkli / kapalı kamera / siyah ekran (dinamik aralık ~0)
 *   - tamamen doymuş (beyaz patlama) ya da tamamen boş (siyah)
 * Kararı artık OCR verir; bu fonksiyon sadece zaman kaybını önler.
 *
 * @returns {null|string} sorun yoksa null, yoksa kısa bir kod
 */
function bozukGorsetMi(gri, genislik, yukseklik) {
  if (!gri || gri.length < 64) return 'kucuk';
  if (genislik && yukseklik && (genislik < 24 || yukseklik < 10)) return 'kucuk';

  // Dinamik aralık: kapalı kamera / tek renkli karede ~0
  let enKoyu = 255, enAcik = 0;
  for (let i = 0; i < gri.length; i++) {
    const v = gri[i];
    if (v < enKoyu) enKoyu = v;
    if (v > enAcik) enAcik = v;
  }
  if (enAcik - enKoyu < 12) return 'tek-renk';
  // Aşırı doymuş (lens kapağı açık / beyaz patlama) veya tamamen boş
  if (enKoyu > 244 || enAcik < 11) return 'doygun';

  // Aşırı gürültü: YÜKSEK FREKANSLI gürültü enerjisi ölçülür.
  //
  // DİKKAT — daha önce standart sapma kullanılıyordu ve bu YANLIŞTI.
  // Ölçüm: temiz, yüksek kontrastlı plakaların std'si 78-80 çıkıyordu
  // (beyaz plaka + siyah yazı = doğal olarak yüksek sapma) ve "asiri
  // gürültülü" sanılıp eleniyorlardı. Oysa gerçek bir gürültülü SAHNE
  // yalnızca 58'e çıkıyordu. Yani ölçüt, gürültüyü değil kontrastı ölçüyordu.
  //
  // Doğru ölçüt: görüntünün bulanıklaştırılmış hâlinden farkı. Bulanıklık
  // kenarları korur ama gürültüyü siler; farkı alınca gürültü ayrışır.
  // Kalibrasyon (bu makine):
  //   temiz plaka fikstürleri   7.5 - 14.1
  //   okunabilir gürültülü sahne 10.3
  //   aşırı gürültülü sahne      42.3
  //   rastgele gürültü          63.6
  //   düz tek renk               0.0
  // Eşik 45: okunabilir her şeyi geçirir, umutsuz olanı eler.
  if (gri.length >= 1024) {
    const yumusak = G.bulaniklastir(gri, genislik, yukseklik, 1);
    let enerji = 0;
    for (let i = 0; i < gri.length; i++) {
      const d = gri[i] - yumusak[i];
      enerji += d < 0 ? -d : d;
    }
    if (enerji / gri.length > 45) return 'asiri-gurultulu';
  }
  return null;
}

const VARYANTLAR = ['normal', 'otsu', 'sauvola'];
const PSM_SIRASI = [PSM.SINGLE_LINE, PSM.SINGLE_WORD, PSM.SPARSE_TEXT, PSM.SINGLE_BLOCK];

/**
 * Kademeli zorlama planı.
 *
 * Ölçüm: tek Tesseract geçişi ≈ 1.0 sn; ön işleme 1-10 ms.
 * 12 geçişin tamamı koşmak 12 saniye sürüyordu; oysa ilk geçiş zaten
 * %96 güvenle doğru okuyordu. Bu yüzden kademeli ilerleniyor.
 *
 * Kırpma seçeneği artık bir KURAL değil, ölçülen bir VARYANT (`-k` eki).
 * Hangi sıranın doğru olduğu senaryodan senaryoya değiştiği için tahmin
 * yürütmüyoruz: ikisi de denenir, motorun güven puanı kazananı seçer.
 */
/**
 * Metin küçük mü? (bölge 26 pikselden kısa)
 *
 * Ölçülen fark çok büyük. 83x24'lük bir bölgede (telefonun kırpma bandı):
 *   normal-k psm7  -> guven 85  "34ARC123"  YANLIŞ (ve kabul ediliyordu)
 *   otsu-k   psm7  -> guven 93  "34ABC123"  DOĞRU
 * Küçük metinde İKİLİLEŞTİRME (Otsu) belirleyici; renkli/gri tonlamada
 * interpolasyon kenarları yumuşatıp harfleri birbirine katıyor. Bu yüzden
 * küçük metinde plan ikilileştirilmiş varyantla başlar.
 */
const KUCUK_METIN_PIKSEL = 26;

/**
 * Okuma kuyruğunun izin verilen derinliği.
 *
 * Neden şart? Sürekli okuma modu (telefon AYARLARINDAN açılabilir) kareyi
 * arka arkaya gönderir. Kuyruk sınırsız olsaydı: istemci hızlı gönderir,
 * sunucu yavaş işler, birikme başlar ve gecikme KARE SAYISIYLA büyür.
 * 30 kare birikirse nöbetçi 10 saniyelik gecikmeli tarayıcı görür ve "çok
 * yavaş" der — oysa TEK okuma ölçülen 0,35 sn'dir. Yani kullanıcıya
 * yanlış tanı verilmiş olur.
 *
 * Çözüm: kuyruk doluysa isteği HEMEN reddet ve nedenini açıkça söyle. Böylece
 * telefon bir sonraki turda bekler, birikme olmaz, kullanıcı gerçekçi bir
 * mesaj alır.
 *
 * Değer neden 3? Ölçülen okuma 0,35-1,2 sn. 3 derinlik, istemci hata
 * yaptığında (ağ koptu, istek tekrarlanıyor) sunucuyu ~4 saniyeden fazla
 * meşgul etmez; meşru ardışık okumaları da reddetmez.
 */
const KUYRUK_DERINLIGI = 3;
function kucukMetin(metinY) {
  return metinY > 0 && metinY <= KUCUK_METIN_PIKSEL;
}

/**
 * Bir bölge üzerinde denenecek geçişler.
 *
 * "otsu-k + PSM 8" NEDEN AYRI SATIR? ÖLÇÜM (uzak araç sahnesi, plaka
 * karede 94x23 piksel, 50 varyant/PSM birleşimi tarandı):
 *     otsu-k  PSM  7  ->  ""               (boş!)
 *     otsu-k  PSM  8  ->  "J 34 ABC 123"  guven 38   <== DOĞRU
 *     normal-k PSM 8  ->  "JB 34 A8C 123" guven 24
 * Aynı varyant (otsu-k) PSM 7'de hiçbir şey okumazken PSM 8'de plakayı
 * buluyor. Tek satır modu (PSM 7) kırpma yapıldığında kenardaki dolgu
 * karakterleri satırın başına yapışıyor ("J 34 ABC 123"); kelime modu
 * (PSM 8) bu yapışmayı engelliyor. Maliyet 50 ms.
 */
function planKur(hizli, metinY = 0) {
  const kucuk = kucukMetin(metinY);
  if (hizli) return [{ varyant: kucuk ? 'otsu-k' : 'normal-k', psm: PSM.SINGLE_LINE }];
  return kucuk
    ? [
      { varyant: 'otsu-k', psm: PSM.SINGLE_LINE },
      { varyant: 'otsu-k', psm: PSM.SINGLE_WORD },
      { varyant: 'normal-k', psm: PSM.SINGLE_LINE },
      { varyant: 'otsu', psm: PSM.SINGLE_LINE },
      { varyant: 'sauvola-k', psm: PSM.SINGLE_LINE },
    ]
    : [
      { varyant: 'normal-k', psm: PSM.SINGLE_LINE },
      { varyant: 'otsu-k', psm: PSM.SINGLE_WORD },
      { varyant: 'normal', psm: PSM.SINGLE_LINE },
      { varyant: 'otsu-k', psm: PSM.SINGLE_LINE },
      { varyant: 'normal', psm: PSM.SINGLE_WORD },
    ];
}
function planTam() {
  const plan = [];
  for (const varyant of VARYANTLAR) {
    for (const psm of PSM_SIRASI) {
      plan.push({ varyant, psm });
      plan.push({ varyant: varyant + '-k', psm });
    }
  }
  return plan;
}

/**
 * Tesseract'ın WASM çekirdeği bazı hâllarda kendi hata ayıklama
 * çıktısını doğrudan stdout'a basıyor ("Bottom=0, top=330, base=0" gibi).
 * Bu, servis konsolunu kirlettiği için konsolu geçici olarak susturuyoruz.
 * Yalnızca Tesseract çağrısı sırasında etkilidir, uygulamanın kendi
 * loglarını etkilemez ve hata durumunda da geri yüklenir.
 */
async function sessizCagri(fn) {
  const yaz = process.stdout.write.bind(process.stdout);
  const hataYaz = process.stderr.write.bind(process.stderr);
  const sustur = (chunk, ...rest) => {
    // Gerçek uygulama loglarını (bilgi/uyarı) yine geçir, yalnızca
    // Tesseract'ın ham hata ayıklama satırlarını yut.
    const s = typeof chunk === 'string' ? chunk : String(chunk);
    if (/^\s*(Total count=|Min=|Median=|Mean=|Bottom=|Lower quartile=|Upper quartile=|SD=|Range=|Max=)/.test(s)) {
      const cb = rest.find((r) => typeof r === 'function');
      if (cb) cb();
      return true;
    }
    return yaz(chunk, ...rest);
  };
  process.stdout.write = sustur;
  process.stderr.write = sustur;
  try {
    return await fn();
  } finally {
    process.stdout.write = yaz;
    process.stderr.write = hataYaz;
  }
}

/** Aday listesinden en yüksek puanlı benzersiz sonuçları seçer. */
function EnIyiyiSec(toplanan) {
  const sirali = toplanan.slice().sort((a, b) => b.puan - a.puan);
  const gorulen = new Set();
  const adaylar = [];
  for (const a of sirali) {
    if (gorulen.has(a.bicim)) continue;
    gorulen.add(a.bicim);
    adaylar.push(a);
    if (adaylar.length >= 5) break;
  }
  return { adaylar };
}

/**
 * Sonuç yeterince güvenilir mi? — ÖLÇÜMDE KALİBRE EDİLDİ.
 *
 * Mutlak puan eşiği işe yaramıyordu: doğru okunan plakalar 35-39 puan alıyordu,
 * eşik 40'ta kalınca doğru cevaplar bile "yetersiz" sayılıp gereksiz yere
 * 12 geçişlik tam tarama çalışıyordu (13 saniye).
 *
 * Gerçek belirteçler:
 *   - Yapı geçerli mi? (2 rakam + 1-3 harf + 2-4 rakam, il kodu 1-81)
 *   - Tesseract'ın kendi güveni yeterli mi?
 *   - En iyi aday ikinci adaydan belirgin şekilde mi ayrılıyor?
 * Belirsizlik varsa daha çok denemeye geçmek doğru davranıştır.
 */
function yeterli(sonuc, metinY = 0) {
  if (!sonuc || !sonuc.adaylar.length) return false;
  const enIyi = sonuc.adaylar[0];
  const ikinci = sonuc.adaylar[1];
  // Eşik TEK KAYNAKTAN gelir (turk-plaka.js → YAPI_ESIK). İki hattın farklı
  // eşik kullanması, "aynı plaka neden bir hatta geçerli diğerinde değil"
  // sorusunu cevapsız bırakırdı.
  if (enIyi.yapi < TP.YAPI_ESIK) return false;                    // yapı geçersiz
  const guven = typeof enIyi.ocrGuven === 'number' ? enIyi.ocrGuven : 0;
  // METİN BOYUTUNA GÖRE EŞİK. Küçük plakalarda Tesseract hem daha gürültülü
  // hem de kendinden daha emin oluyor. Ölçülen olay: 73x18'lik plakada ilk
  // geçiş %85+ güvenle "34 ARC 123" dedi ve arama hemen durdu; oysa doğru
  // okuma "34 ABC 123" idi. Küçük metin daha yüksek eşik ister.
  const esik = kucukMetin(metinY) ? 92 : 85;
  if (guven >= esik) return true;
  if (guven < 55) return false;
  if (ikinci && (enIyi.puan - ikinci.puan) < 3) return false;
  return true;
}

// ---------------------------------------------------------------------------
//  Motor
// ---------------------------------------------------------------------------
class PlakaMotoru {
  constructor() {
    this.isci = null;
    this.hazirMi = false;
    this.hazirlaniyor = null;
    this.kuyruk = Promise.resolve();
    this.istekSayisi = 0;
    this.hataSayisi = 0;
    // Sürekli okuma modu için: kuyruk doluyken reddedilen istek sayısı ve
    // şu anda bekleyen okuma sayısı. Durum ekranında görünür olmalı — yoksa
    // kullanıcı "tarayıcı yavaş" sanır, oysa asıl neden kuyruktur.
    this.reddedilenIstek = 0;
    this._kuyrukDerinligi = 0;
    this.sonHata = null;
    this.sonOkuma = 0;
    this.kapanmaZamanlayici = null;
    this.bosTasmaDakika = 5;      // bu süre kullanılmazsa motor kapanır
    this.aktif = true;            // OCR teslim edilemezse servis kendi kendini kapatır
    this.erisimHatasi = null;     // engellendi ise sebebi burada

    // fast-plate-ocr hattı
    this.motor = motorSec();
    this.fpo = null;              // tembel yüklenir
    this.fpoHatasi = null;
    // Gölge modda karşılaştırma sayacı (rehber §12.14: kararlar ÖLÇÜMLE verilir)
    this.golge = { calisti: 0, fpoBasarili: 0, tessBasarili: 0, ayni: 0, fpoDahaIyi: 0, tessDahaIyi: 0, ornekler: [] };
  }

  /** fast-plate-ocr modelini tembel yükler. */
  fpoHazirla() {
    if (this.fpo) return Promise.resolve(this.fpo);
    if (this.fpoHatasi) return Promise.reject(new Error(this.fpoHatasi));
    const m = new FPO.FpoMotoru();
    return m.hazirla().then((ok) => {
      if (!ok) {
        // Sessizce yutma (rehber §13.12): sebep durum ekranında görünür.
        this.fpoHatasi = m.durum.sebep || 'fast-plate-ocr yüklenemedi';
        throw new Error(this.fpoHatasi);
      }
      this.fpo = m;
      this.kapanmayiErtele();
      return m;
    });
  }

  /** Kullanılabilir mi? (bağımlılık + dil dosyası yerinde mi) */
  denetle() {
    if (!TESSERACT) {
      this.erisimHatasi = 'tesseract.js kurulu değil (npm install)';
      return { kullanilabilir: false, sebep: this.erisimHatasi };
    }
    const dilDosyasi = path.join(DIL, 'eng.traineddata.gz');
    if (!fs.existsSync(dilDosyasi)) {
      this.erisimHatasi = 'dil dosyası eksik: ' + dilDosyasi;
      return { kullanilabilir: false, sebep: this.erisimHatasi };
    }
    return { kullanilabilir: true };
  }

  /** Tembel yükleme. Aynı anda birden çok istek gelirse tek sefer yükler. */
  hazirla() {
    if (this.hazirMi) return Promise.resolve(this.isci);
    if (this.hazirlaniyor) return this.hazirlaniyor;

    const d = this.denetle();
    if (!d.kullanilabilir) return Promise.reject(new Error(d.sebep));

    this.hazirlaniyor = (async () => {
      const isci = await TESSERACT.createWorker('eng', 1, {
        langPath: DIL,
        cachePath: DIL,
        gzip: true,
        cacheMethod: 'none',        // yalnızca paketlenmiş dosyayı oku
        logger: () => {},
        errorHandler: () => {},
      });
      await isci.setParameters({
        // TR plakasında kullanılmayan harfler listede yok
        tessedit_char_whitelist: HARFLER.replace(/İ/g, 'I') + '0123456789 ',
        user_defined_dpi: '300',    // sahte DPI uyarısını ve ölçüm hatasını önler
        preserve_interword_spaces: '1',
      });
      this.isci = isci;
      this.hazirMi = true;
      this.erisimHatasi = null;
      this.kapanmayiErtele();
      return isci;
    })();

    this.hazirlaniyor.catch(() => { this.hazirMi = false; })
      .finally(() => { this.hazirlaniyor = null; });
    return this.hazirlaniyor;
  }

  /** Boşta kalınca motoru kapat (RAM ve pil için). */
  kapanmayiErtele() {
    if (this.kapanmaZamanlayici) clearTimeout(this.kapanmaZamanlayici);
    this.kapanmaZamanlayici = setTimeout(() => { this.kapat('bos durma'); }, this.bosTasmaDakika * 60000);
    if (this.kapanmaZamanlayici.unref) this.kapanmaZamanlayici.unref();
  }

  kapat( sebep ) {
    if (this.kapanmaZamanlayici) { clearTimeout(this.kapanmaZamanlayici); this.kapanmaZamanlayici = null; }
    const isci = this.isci;
    this.isci = null; this.hazirMi = false;
    if (this.fpo) { try { this.fpo.kapat(); } catch { /* yoksay */ } this.fpo = null; }
    this.fpoHatasi = null;
    if (!isci) return;
    try { isci.terminate(); } catch { /* yoksay */ }
  }

  durum() {
    const fpoDurum = this.fpo ? this.fpo.durum : {
      aktif: false, hazir: false,
      sebep: this.fpoHatasi || 'henüz yüklenmedi',
      model: FPO.VARSAYILAN,
    };
    return {
      aktif: this.aktif,
      hazir: this.hazirMi || !!(this.fpo && this.fpo.durum.hazir),
      // Hangi hat okuyor? Kullanıcı "neden yavaş" diye sorduğunda bu tek
      // satır cevabı vermeli; belirsiz bırakılmaz.
      hat: this.motor,
      motor: this.motor === 'tesseract'
        ? (TESSERACT ? 'tesseract.js (WASM, çevrimdışı)' : 'yok')
        : 'fast-plate-ocr (' + (fpoDurum.model || FPO.VARSAYILAN) + ', ONNX, çevrimdışı)',
      // Model ayrıntısı: eksik/bozuk model sessizce geçmemeli (rehber §13.12)
      fpo: {
        model: fpoDurum.model,
        hazir: !!fpoDurum.hazir,
        sebep: fpoDurum.sebep || null,
        config: fpoDurum.config || null,
        ozet: fpoDurum.ozet || null,
        kanalKaynagi: fpoDurum.kanalKaynagi || null,
        uyumsuzluk: fpoDurum.uyumsuzluk || null,
        istekSayisi: fpoDurum.istekSayisi || 0,
        hataSayisi: fpoDurum.hataSayisi || 0,
        sureMs: fpoDurum.sureMs || null,
      },
      // Gölge mod ölçümü
      golge: this.motor === 'fpo+tesseract' ? this.golge : null,
      dil: fs.existsSync(path.join(DIL, 'eng.traineddata.gz')) ? 'yerel (paketlenmiş)' : 'eksik',
      // Bölge bulucu ayrıca bildirilir: eksikse okuma yine de çalışır ama
      // SAHNE karelerinde başarısız olur. Sessiz kalmaması şart (bkz. yukarı).
      bolgeBulucu: bolgeBulucuHatasi ? 'YOK — ' + bolgeBulucuHatasi : 'aktif',
      istekSayisi: this.istekSayisi,
      hataSayisi: this.hataSayisi,
      sonOkuma: this.sonOkuma || null,
      sonHata: this.sonHata,
      sebep: this.erisimHatasi,
    };
  }

  /**
   * Ana okuma girişi.
   * @param {Buffer} tampon  PNG veya JPEG baytları
   * @param {object} secenek { bilinenPlakalar: string[], hizli: boolean }
   * @returns {Promise<object>}
   */
  oku(tampon, secenek = {}) {
    this.istekSayisi++;
    this.kapanmayiErtele();

    // Kuyruk DERİNLİK SINIRI — yukarıdaki gerekçeye bakın. Sınırsız
    // kuyruk, sürekli okuma modunda eski bilgisayarı kilitlerdi.
    const derinlik = this._kuyrukDerinligi || 0;
    if (derinlik >= KUYRUK_DERINLIGI) {
      this.reddedilenIstek = (this.reddedilenIstek || 0) + 1;
      return Promise.resolve({
        basarili: false,
        neden: 'kuyruk-dolu',
        hata: 'sistem yoğun — okuma kuyruğu dolu, lütfen biraz bekleyin',
        adaylar: [], ham: '', bolgeler: 0,
        kuyrukDerinligi: derinlik,
      });
    }

    this._kuyrukDerinligi = derinlik + 1;
    // ONNX oturumu ve WASM çalışma zamanı YENİDEN-GİRİLEBİLİR DEĞİLDİR:
    // eşzamanlı iki çıkarım sonuçları birbirine karıştırır. Sıraya al.
    // (Ölçüldü: eşzamanlı 8 istek sırayla işlendi, sonuçlar karışmadı.)
    const is = this.kuyruk
      .then(() => this.okuSira(tampon, secenek))
      .finally(() => {
        this._kuyrukDerinligi = Math.max(0, (this._kuyrukDerinligi || 1) - 1);
      });
    this.kuyruk = is.catch(() => {});
    return is;
  }

  async okuSira(tampon, secenek) {
    const bilinen = Array.isArray(secenek.bilinenPlakalar) ? secenek.bilinenPlakalar : [];

    // ------------------------------------------------------------------
    //  MOTOR YÖNLENDİRMESİ
    // ------------------------------------------------------------------
    // fast-plate-ocr hattı seçiliyse Tesseract'ı hiç yüklemeye gerek yok.
    // (Ölçüm: FPO tüm adayları ~45 ms'de okuyor; Tesseract tek geçişte
    //  35 ms - 4.5 sn, zorlu plakada toplam 10 sn idi.)
    const fpoSecili = this.motor === 'fpo' || this.motor === 'fpo+tesseract';
    if (fpoSecili) {
      try {
        await this.fpoHazirla();
      } catch (e) {
        // Model yoksa/bozuksa: Tesseract'a düş, ama SEBEBİ kaybolmasın.
        this.fpoHatasi = e.message;
        if (this.motor === 'fpo') {
          // Salt fpo modunda bile sessizce boş sonuç dönmüyoruz; Tesseract
          // eldeyse kullanılır, yoksa açık hata verilir.
          if (!this.denetle().kullanilabilir) {
            this.hataSayisi++;
            this.sonHata = 'fast-plate-ocr yüklenemedi: ' + e.message;
            return { basarili: false, hata: this.sonHata, neden: 'motor-yok', adaylar: [], ham: '' };
          }
        }
      }
      if (this.fpo) {
        return this.okuSiraFpo(tampon, secenek, bilinen);
      }
    }

    try {
      await this.hazirla();
    } catch (e) {
      this.hataSayisi++;
      this.sonHata = 'motor yüklenemedi: ' + e.message;
      return { basarili: false, hata: this.sonHata, neden: 'motor-yok', adaylar: [], ham: '' };
    }

    // Görüntüyü gri tona çevir. PNG'yi kendimiz çözüyoruz; JPEG'i de
    // saf-JS çözücüyle çözüyoruz (sunucuda hiçbir yerel bağımlılık yok).
    let gri, g, y;
    try {
      ({ veri: gri, genislik: g, yukseklik: y } = this.griyeCevir(tampon));
    } catch (e) {
      this.hataSayisi++;
      this.sonHata = 'görüntü okunamadı: ' + e.message;
      return { basarili: false, hata: this.sonHata, neden: 'bozuk-gorsel', adaylar: [], ham: '' };
    }

    // Yalnızca GERÇEKTEN bozuk görüntüleri ele. Bu kontrol yalnızca kapalı
    // kamera / siyah ekran / tek renkli kare gibi DURUM tespiti içindir.
    const bozuk = bozukGorsetMi(gri, g, y);
    if (bozuk) {
      return {
        basarili: false,
        hata: bozuk === 'kucuk' ? 'görüntü çok küçük — yeniden çekin' : 'görüntü boş veya tek renkli — kamerayı plakaya doğru tutun',
        neden: bozuk === 'kucuk' ? 'gorsel-kucuk' : 'metin-yok',
        adaylar: [], ham: '', bolgeler: 0,
      };
    }

    const hizli = !!secenek.hizli;
    // Bütçe, DENENECEK ŞEY SAYISINA göre ölçeklenir.
    //
    // Ölçülen olay: plakasız ama içerikli bir karede (telefon yanlış kadraj)
    // tarama tam 10 saniye sürüp hiçbir şey bulamıyordu. Nöbetçi o süre
    // boyunca kamerayı bekliyor ve sonunda yine de plaka okunmadı.
    // Bölge bulunamadıysa denenecek fazla bir şey yoktur; kısa bir bütçe
    // yeterlidir. Bölge bulunduysa birden çok aday vardır ve zaman harcanır.
    const varsayilanButce = secenek.zamanButcesi;
        // Varsayılan bütçe 4 saniye. Ölçülen: 10 saniyelik bütçe nöbetçiye
    // hiçbir şey kazandırmıyordu (sure=9999ms) ve her geçiş maliyeti
    // ölçülmediği için gerçekte 10 saniyeyi aşıyordu.
    let butceSn = Number.isFinite(varsayilanButce) ? varsayilanButce : 4;
    const baslangic = Date.now();
    const kalanSn = () => butceSn - (Date.now() - baslangic) / 1000;

    // ------------------------------------------------------------------
    //  ADIM A: plaka bölgelerini bul
    // ------------------------------------------------------------------
    // Telefon bir SAHNE çeker, plaka onun küçük bir parçasıdır. Tüm kareye
    // doğrudan OCR uygulamak yerine önce plaka benzeri bölgeleri arıyoruz.
    // (Ölçüm: bölge araması olmadan 8 gerçekçi sahnenin 8'i de başarısızdı.)
    const bolgeler = bolgeBul(gri, g, y, hizli ? 3 : 5);

    // Bölge yoksa kısa bütçe: sadece tam kare denenecek, üstelik
    // tam karenin okunabilir bir metni olmadığı ölçüldü (sahnenin PSM 6
    // çıktısı binlerce rastgele karakter). Kısa bütçe nöbetçiyi 10 saniye
    // bekletmekten kurtarır ve telefonu erkenden uyarır.
    if (!Number.isFinite(varsayilanButce)) {
      butceSn = bolgeler.length === 0 ? 2.5 : 4;
    }

    // Çalışma listesi: bulunan bölgeler (iyi puandan başla) + TAM KARE.
    //
    // ÖLÇÜM: tam kareyi denemek hiçbir zaman işe yaramadı (8 sahnenin
    // hiçbirinde doğru sonuç üretmedi) ama 1-3 saniye harcadı — sahne
    // görüntüsünde tek bir metin satırı yoktur, Tesseract'ın PSM 6
    // çıktısı binlerce rastgele karakter olur. Bu yüzden tam kare YALNIZCA
    // bölge bulunamadığında denenir (sıkı plaka kırpımı gibi durumlar).
    // Kullanıcının kırpma dikdörtgeni HER ZAMAN önce denenir: nöbetçi
    // plakayı işaretlemiş, bu en güçlü bilgidir ve en ucuz yoldur.
    const ipucuB = ipucuBolgesi(secenek.ipucu, g, y);
    const isler = [];
    if (ipucuB) {
      // ÖLÇÜM: bandın KENDİSİNİ okumak boşa kürek — plaka 1280 px'lik bir
      // satırın içinde ~104 px genişlikte, PSM 7 bu oranı okuyamıyor.
      //     6 araç, bandın kendisi önce : 2464 ms  (isabetsiz)
      //     6 araç, önce içerideki bölge:  ~800 ms  (doğru okuma)
      // Bu yüzden önce bandın İÇİNDE sıkı bölgeler aranır; bölge bulunamazsa
      // (çok dar kırpma gibi) bandın kendisine düşülür.
      const icBolgeler = ipucuIcindeBolgeler(gri, ipucuB, g, y, 3);
      if (icBolgeler.length) {
        // ÖNCE GENİŞ, SONRA DAR. Ölçüm (9 derece eğik plaka):
        //     dar  ipucu bandı -> "34 ABC 155"  YANLIŞ (plaka kırpılıyor)
        //     geniş ipucu bandı -> "34 ABC 123"  DOĞRU
        // Dar kırpım hiçbir ölçümde genişten iyi çıkmadı; genişletilmiş bölge
        // zaten dar olanı İÇERİR, yani bilgi kaybı yok, yalnızca biraz daha
        // fazla bağlam var. Bağlam ise Tesseract'ın ayırt etmesine yardım eder.
        for (const b of icBolgeler) {
          const genis = genisletBolge(b, g, y);
          if (genis && (genis.g !== b.g || genis.y2 !== b.y2)) {
            isler.push({ ...genis, tur: 'ipucu-bolge-genis' });
          }
        }
        for (const b of icBolgeler) isler.push({ ...b, tur: 'ipucu-bolge' });
        // Dar kırpım EĞİK plakayı keser. Ölçülen karşılaştırma:
        //     ipucusuz         -> "34 ABC 123" (kaynak bolge-genis)        DOGRU
        //     ipucu, dar bant  -> "34 ABC 155" (kaynak ipucu-bolge)        YANLIŞ
        //     ipucu, geniş bant-> "34 ABC 123" (kaynak ipucu-bolge-genis)  DOĞRU
        // Bu yüzden genişletilmiş bölge ÖNCE denenir: dar olanı zaten içerir,
        // yani bilgi kaybı yok; yalnızca biraz bağlam var.
        // (Eğik plaka gerçek hayatın normali — araç yan çekimde çekilir.)
      } else {
        isler.push({ ...ipucuB, tur: 'ipucu' });
        const genisBant = genisletBolge(ipucuB, g, y);
        if (genisBant) isler.push({ ...genisBant, tur: 'ipucu-genis' });
      }
    }
    for (const b of bolgeler) isler.push({ ...b, tur: 'bolge' });
    const tamKareGerekli = isler.length === 0;
    if (tamKareGerekli) isler.push({ x: 0, y: 0, g, y2: y, tur: 'tam' });

    const toplanan = [];
    const hamlar = [];
    let enIyi = { adaylar: [] };
    let denenenBolge = 0;

    // Son psm'nin ayarını tekrarlamamak için izleyici tutuyoruz.
    let sonPsm = null;

    // Bir bölge için ön işleme varyantlarını üret (önbellekli).
    // Varyant adı hem ön işlemeyi hem kırpma seçimini taşır ("otsu", "otsu-k").
    const onIsleOnbellek = new Map();
    const onIsleHazirla = (bolge, varyant) => {
      const anahtar = `${bolge.x},${bolge.y},${bolge.g},${bolge.y2}|${varyant}`;
      if (!onIsleOnbellek.has(anahtar)) {
        try {
          const kirp = bolgeKirp(gri, g, y, bolge);
          onIsleOnbellek.set(anahtar,
            kirp ? onIsle(kirp.veri, kirp.genislik, kirp.yukseklik, varyant) : null);
        } catch {
          onIsleOnbellek.set(anahtar, null);
        }
      }
      return onIsleOnbellek.get(anahtar);
    };

    /** Bir bölge üzerinde verilen planı çalıştırır. */
    // Ölçülen son geçişin gerçek süresi. Sonraki geçişlerde tahmin yerine
    // bu ölçüm kullanılır: aynı boyuttaki bir sonraki geçişin maliyeti
    // öncekininkine çok yakındır.
    let olculenGecisSn = 0;

    const gecisleriCalistir = async (plan, bolge) => {
      // Metin yüksekliği küçükse kabul eşiği yükselir (bkz. yeterli()).
      const metinY = bolge.y2;
      // Bu bölgede bir geçiş ne kadara mal olur? Ölçüm varsa onu kullan,
      // yoksa piksel sayısından hesapla.
      const beklenen = Math.max(olculenGecisSn, gecisMaliyetiSn(bolge.g, bolge.y2));
      for (const adim of plan) {
        if (yeterli(EnIyiyiSec(toplanan), metinY)) return;   // yeterince iyi sonuç var
        // Bütçenin büyük bölümü harcandıysa ve elimizde ZATEN geçerli bir
        // plaka varsa devam etmeyelim. Nöbetçi 12 saniye beklememeli;
        // küçük bir doğruluk kazancı bu gecikmenin karşılığını vermez.
        // (Ölçüm: küçük plakada 12.3 sn süren bir tarama vardı, sonuç
        //  buna rağmen "yeterli" eşiğine takılıp sürekli zorlanıyordu.)
        if (kalanSn() < butceSn * 0.4) {
          const mevcut = EnIyiyiSec(toplanan);
          if (mevcut.adaylar.length && mevcut.adaylar[0].yapi >= TP.YAPI_ESIK) return;
        }
        // Bütçe denetimi: bu geçişin maliyeti kadar yer kalmıyorsa
        // BAŞLATMA. Sabit eşik bütçeyi 5 sn yerine 7.4 snye çıkarıyordu.
        if (kalanSn() < beklenen) return;
        const gecisBaslangic = Date.now();

        const hazir = onIsleHazirla(bolge, adim.varyant);
        if (!hazir) continue;
        const bmp = G.bmpKodla(hazir.veri, hazir.genislik, hazir.yukseklik);

        let sonuc;
        try {
          if (sonPsm !== adim.psm) {
            await this.isci.setParameters({ tessedit_pageseg_mode: String(adim.psm) });
            sonPsm = adim.psm;
          }
          sonuc = await sessizCagri(() => this.isci.recognize(bmp));
        } catch (e) {
          this.hataSayisi++;
          this.sonHata = 'okuma hatası: ' + e.message;
          this.kapat('okuma hatası');     // bir sonraki istekte taze motorla
          sonPsm = null;
          return;
        }

        const metin = (sonuc && sonuc.data && sonuc.data.text) || '';
        const guven = (sonuc && sonuc.data && typeof sonuc.data.confidence === 'number') ? sonuc.data.confidence : 0;
        // Bu geçişin GERÇEK süresini ölç: sonraki geçişlerde tahmin yerine
        // bu ölçüm kullanılır, böylece tahmin hatası birikmez.
        {
          const gecen = (Date.now() - gecisBaslangic) / 1000;
          olculenGecisSn = Math.min(Math.max(olculenGecisSn, gecen), 5);
        }
        if (!metin.trim()) continue;
        if (guven > (bolge.enGuven || 0)) bolge.enGuven = Math.round(guven * 10) / 10;
        hamlar.push({
          bolge: bolge.tur, x: bolge.x, y: bolge.y, g: bolge.g, y2: bolge.y2,
          varyant: adim.varyant, psm: adim.psm, metin: metin.trim(), guven: Math.round(guven * 10) / 10,
        });

        for (const aday of adayUret(metin, bilinen)) {
          aday.ocrGuven = Math.round(guven * 10) / 10;
          // Bölge puanı küçük bir ağırlıkla katkı sağlar: gerçek plaka
          // bölgesinden gelen okuma, tam kareden gelene göre önceliklidir.
          // Bölge puanı küçük bir ağırlıkla katkı sağlar: kullanıcının
          // işaretlediği bölgeden gelen okuma, kendi kendine bulunan
          // bölgeden gelene göre önceliklidir.
          const bolgeBonusu = bolge.tur.indexOf('ipucu') === 0 ? 2.5 : bolge.tur === 'bolge' ? 1.5 : 0;
          aday.puan = Math.round((aday.puan + guven / 12 + bolgeBonusu) * 10) / 10;
          aday.kaynak = adim.varyant + '/' + bolge.tur;
          aday.kaynakEnBolge = bolge;
          toplanan.push(aday);
        }
      }
    };

    // ------------------------------------------------------------------
    //  ADIM B: bölgeleri sırayla dene
    // ------------------------------------------------------------------
    // KADEME 1 — HER adayda TEK hızlı geçiş (~35-130 ms ölçüldü).
    // İlk yeterli okumada DUR. N aday = en kötü N * 0.13 sn.
    for (const bolge of isler) {
      if (yeterli(enIyi, bolge.y2)) break;
      if (kalanSn() < 0.5) break;
      denenenBolge++;

      await gecisleriCalistir(planKur(true, bolge.y2), bolge);
      enIyi = EnIyiyiSec(toplanan);
    }

    // KADEME 2 — hızlı tarama yetmediyse bölgeleri EN İYİDEN BAŞLAYARAK
    // sırayla derinleştir ve bütçe bitene kadar devam et.
    //
    // Neden sıra + bütçe, neden puanlama değil? Puanlamayı denedik; iki
    // gerçek senaryoda YANLIŞ bölgeyi seçti. Oysa sıra zaten doğru:
    // ipucu önce, sonra bölge bulucunun puan sırası.
    //
    // Neden planTam (24 geçiş) yok? Ölçüm: 24 geçişlik tam tarama tek
    // bölgede ~13 saniye sürüyordu ve gecikmenin büyük kaynağı buydu.
    // Normal plan (4 geçiş) zorlu plakaları okumak için yeterli.
    if (!yeterli(enIyi, 0) && !hizli) {
      for (const bolge of isler) {
        if (yeterli(enIyi, bolge.y2)) break;
        if (kalanSn() < 0.8) break;
        denenenBolge++;
        await gecisleriCalistir(planKur(false, bolge.y2), bolge);
        enIyi = EnIyiyiSec(toplanan);

        // Genişletilmiş hâl: harfler kesilmiş olabilir. (Ölçüldü: dar
        // kırpımda "24 ARC 123" okunurken, genişletilmiş hâli "34 ABC 123"
        // verdi.)
        if (!yeterli(enIyi, bolge.y2) && bolge.tur !== 'tam' && kalanSn() > 1.6) {
          const genis = genisletBolge(bolge, g, y);
          if (genis && (genis.g !== bolge.g || genis.y2 !== bolge.y2)) {
            denenenBolge++;
            await gecisleriCalistir(planKur(false, genis.y2), { ...genis, tur: bolge.tur + '-genis' });
            enIyi = EnIyiyiSec(toplanan);
          }
        }
      }
    }

    // ------------------------------------------------------------------
    //  TAM KARE NEDEN TEKRAR DENENMİYOR?
    // ------------------------------------------------------------------
    // Bu blok bilinçli olarak boş. ÖLÇÜLEN OLAY (y18 sahnesi, 11 geçiş):
    //     psm=7  2048x611   2265 ms  guven=16  "AEE LS TT A GEE HS SA EB I PRT"
    //     psm=7  1978x1112  4459 ms  guven=18  "ET TR RRC"
    // Tam kare geçişleri TEK BAŞINA 6.7 saniye harcıyor ve 8 sahnenin
    // HİÇBİRİNDE doğru plaka üretmiyor: sahne görüntüsünde tek satır plaka
    // metni yoktur, Tesseract PSM çıktısı rastgele karakter yığınıdır.
    // Nöbetçinin 10 saniye beklemesinin TAMAMEN kaynağı buydu.
    //
    // Tam kare artık YALNIZCA hiç bölge bulunamadığında denenir; o durumda
    // çalışma listesine tur=tam olarak eklenir (yukarıda).
    // Kaybedilen doğruluk: ölçülen 0/8. Kazanılan hız: 6.7 saniye.

    this.sonOkuma = Date.now();

    const adaylar = enIyi.adaylar;
    if (!adaylar.length) {
      return {
        basarili: false,
        // Neden ayrımı önemli: telefon bu kodu görünce eldeki TAM KAREyi
        // yeniden gönderebilir (kırpma plakayı içermiyor olabilir).
        neden: denenenBolge > 1 ? 'kirpma-plaka-icermiyor' : 'plaka-bulunamadi',
        hata: denenenBolge > 1
          ? 'plaka kırpma alanının dışında — telefonu plakaya yaklaştırın veya kırpma yapmayın'
          : 'plaka okunamadı — kamerayı plakaya yaklaştırıp yeniden çekin',
        adaylar: [],
        ham: hamlar.map((h) => h.metin).join(' | '),
        denemeler: hamlar,
        bolgeler: bolgeler.length,
      };
    }

    return {
      basarili: true,
      plaka: adaylar[0].bicim,
      guveniyet: adaylar[0].puan,
      adaylar,
      ham: hamlar.map((h) => h.metin).join(' | '),
      denemeler: hamlar,
      sure: this.sonOkuma,
      bulunanBolge: adaylar[0].kaynak ? adaylar[0].kaynak.split('/')[1] : null,
      bolgeler: bolgeler.length,
    };
  }

  /** PNG/JPEG baytlarını gri piksel dizisine çevirir. */
  griyeCevir(tampon) {
    if (!tampon || tampon.length === 0) throw new Error('boş görüntü');

    // PNG imzası: 89 50 4E 47
    if (tampon[0] === 0x89 && tampon[1] === 0x50 && tampon[2] === 0x4e && tampon[3] === 0x47) {
      const c = G.pngCoz(tampon);
      return { veri: G.griTaraf(c.veri, c.genislik, c.yukseklik), genislik: c.genislik, yukseklik: c.yukseklik };
    }

    // JPEG imzası: FF D8
    if (tampon[0] === 0xff && tampon[1] === 0xd8) {
      const d = jpeg.decode(tampon, { useTArray: true, formatAsRGBA: true });
      return { veri: G.griTaraf(d.data, d.width, d.height), genislik: d.width, yukseklik: d.height };
    }

    // WebP / diğer: son çare olarak PNG çözücüyü dene
    const c = G.pngCoz(tampon);
    return { veri: G.griTaraf(c.veri, c.genislik, c.yukseklik), genislik: c.genislik, yukseklik: c.yukseklik };
  }

// ===========================================================================
//  fast-plate-ocr OKUMA YOLU
// ===========================================================================
//  Neden ayrı yöntem? İki hat farklı çalışıyor ve Tesseract'a ÖZGÜ bütün
//  ön işleme bu hatta ZARAR veriyor (rehber §13.2). Birbirinin içine
//  karıştırılmaması için ayrı tutuldu; dış arayüz ve dönüş biçimi AYNI kaldı
//  (rehber §6: "mevcut dış arayüzü bozmayın").
//
//  Maliyet modeli değişti: artık aday sayısı gecikme demek DEĞİL
//  (ölçüm: tüm adaylar p50 45 ms). Bu yüzden zaman bütçesi, eşik kademesi,
//  PSM planları gibi Tesseract'a özgü karmaşaya GEREK YOK: her aday tek
//  tek okunur ve en iyi sonuç seçilir (rehber §12.4).

  /**
   * @param {Buffer} tampon PNG/JPEG baytları
   * @param {object} secenek { bilinenPlakalar, ipucu, hizli }
   * @returns {Promise<object>} Tesseract hattıyla AYNI biçimde sonuç
   */
  async okuSiraFpo(tampon, secenek, bilinen) {
    let gri, g, y;
    try {
      ({ veri: gri, genislik: g, yukseklik: y } = this.griyeCevir(tampon));
    } catch (e) {
      this.hataSayisi++;
      this.sonHata = 'görüntü okunamadı: ' + e.message;
      return { basarili: false, hata: this.sonHata, neden: 'bozuk-gorsel', adaylar: [], ham: '' };
    }

    const bozuk = bozukGorsetMi(gri, g, y);
    if (bozuk) {
      return {
        basarili: false,
        hata: bozuk === 'kucuk' ? 'görüntü çok küçük — yeniden çekin' : 'görüntü boş veya tek renkli — kamerayı plakaya doğru tutun',
        neden: bozuk === 'kucuk' ? 'gorsel-kucuk' : 'metin-yok',
        adaylar: [], ham: '', bolgeler: 0,
      };
    }

    this.istekSayisi++;
    const baslangic = Date.now();

    // --- Aday bölgeler: ipucu önce, sonra kendi bulduklarımız ---
    const ipucuB = ipucuBolgesi(secenek.ipucu, g, y);
    const bolgeBulucu = bolgeBul(gri, g, y, 5);
    const isler = [];
    if (ipucuB) {
      const ic = ipucuIcindeBolgeler(gri, ipucuB, g, y, 3);
      if (ic.length) {
        for (const b of ic) {
          const genis = genisletBolge(b, g, y);
          if (genis && (genis.g !== b.g || genis.y2 !== b.y2)) {
            isler.push({ ...genis, tur: 'ipucu-bolge-genis' });
          }
        }
        for (const b of ic) isler.push({ ...b, tur: 'ipucu-bolge' });
      } else {
        isler.push({ ...ipucuB, tur: 'ipucu' });
        const gb = genisletBolge(ipucuB, g, y);
        if (gb) isler.push({ ...gb, tur: 'ipucu-genis' });
      }
    }
    for (const b of bolgeBulucu) {
      isler.push({ ...b, tur: 'bolge' });
      const genis = genisletBolge(b, g, y);
      if (genis && (genis.g !== b.g || genis.y2 !== b.y2)) {
        isler.push({ ...genis, tur: 'bolge-genis' });
      }
    }
    // Hiç aday yoksa tam kare — çıplak plaka kırpımı nadirdir ama mümkündür.
    if (!isler.length) isler.push({ x: 0, y: 0, g, y2: y, tur: 'tam' });

    const r = await HAT_FPO.okuBolgeler(this.fpo, gri, g, y, isler, bilinen);

    // --- Gölge mod: eski hatla karşılaştır, kararı ÖLÇÜMLE ver (rehber §12.14) ---
    if (this.motor === 'fpo+tesseract') {
      try {
        const t0 = Date.now();
        const t = await this.tesseractOkuSade(gri, g, y, isler, bilinen, secenek);
        this.golge.calisti++;
        if (t.basarili) this.golge.tessBasarili++;
        if (r.basarili) this.golge.fpoBasarili++;
        if (r.basarili && t.basarili && r.plaka === t.plaka) this.golge.ayni++;
        if (r.basarili && !t.basarili) this.golge.fpoDahaIyi++;
        if (!r.basarili && t.basarili) this.golge.tessDahaIyi++;
        if (this.golge.ornekler.length < 20) {
          this.golge.ornekler.push({
            fpo: r.plaka || null, tess: t.plaka || null,
            fpoSure: r.sureMs, tessSure: Date.now() - t0,
          });
        }
      } catch (e) {
        this.golge.hata = e.message;
      }
    }

    this.sonOkuma = Date.now();
    const sureMs = this.sonOkuma - baslangic;

    if (!r.basarili) {
      // Dürüst red: neden ayrımı telefonun davranışını belirler.
      //
      // ÖNEMLİ: guvenSeviyesi "kirmizi" ise bu "plaka YOK" demek değildir;
      // "plaka orada ama EMİN DEĞİLİM" demektir. Nöbetçiye "yaklaşın" demek,
      // yapısı geçerli görünen bir plaka göstermekten daha güvenlidir —
      // ölçülen örnek: uzak araç karesinde "14 A 0099" yapı olarak geçerli
      // (puan 14) ama en zayıf karakterin olasılığı yalnızca 0,19.
      const yakinlastir = r.guvenSeviyesi === 'kirmizi' && (r.okunan || 0) > 0;
      return {
        basarili: false,
        guvenSeviyesi: r.guvenSeviyesi || 'kirmizi',
        hata: !r.okunan
          ? 'plaka bulunamadı — kamerayı plakaya yaklaştırın veya plakanın etrafını işaretleyin'
          : yakinlastir
            ? 'plaka okundu ama emin değilim — kamerayı plakaya biraz daha yaklaştırıp tekrar çekin'
            : 'plaka okunamadı — yeniden çekin veya elle girin',
        neden: !r.okunan ? 'plaka-bulunamadi' : yakinlastir ? 'dusuk-guven' : 'yapi-gecersiz',
        adaylar: [],
        ham: r.ham,
        denemeler: r.denemeler || [],
        bolgeler: r.bolgeSayisi,
        bulunanBolge: null,
        sureMs,
        minGuven: r.guven || 0,
        // "Emin değilim" dediğimizde adaylar görünür olmalı: bazen doğru
        // okuma ikinci sıradadır ve nöbetçi onu tanır (rehber §8.3).
        oneriler: (r.adaylar || []).filter((a) => a.gecerli).slice(0, 3).map((a) => ({
          plaka: a.bicim, minGuven: a.minGuven, kaynak: a.bolge,
        })),
        hatalar: r.hatalar || [],
      };
    }

    return {
      basarili: true,
      plaka: r.plaka,
      guveniyet: r.guveniyet,
      // ALAN SÖZLEŞMESİ: `bicim` okunmuş metnin biçimlendirilmiş hâlidir ve
      // Tesseract hattı da bu adı kullanır. İki hattın aynı sözleşmeyi
      // taşıması ZORUNLUDUR: companion.js yanıtı birleştirirken `bicim`
      // okuyor. Ölçülen hata: FPO hattı yalnızca `plaka` alanını doldurdu,
      // companion.js `bicim` aradı ve aday listesi `undefined` oldu —
      // yani nöbetçiye aday listesi BOŞ GÖRÜNÜRDÜ.
      // Bu yüzden ikisi de yazılır: `bicim` sözleşme, `plaka` okunabilirlik.
      adaylar: r.adaylar.map((a) => ({
        bicim: a.bicim,
        plaka: a.bicim,
        ham: a.plaka,
        puan: a.yapi, yapi: a.yapi,
        ocrGuven: a.minGuven,            // karakter BAŞINA en zayıf güven
        ortGuven: a.ortGuven,
        duzeltmeler: a.duzeltmeler,      // konuma duyarlı düzeltme kaydı
        kuryeOnerisi: a.kuryeOnerisi,    // yalnızca öneri (puanı ETKİLEMEZ)
        kaynak: a.bolge,
        modelBolge: a.modelBolge,
      })),
      ham: r.ham,
      hata: null,
      neden: null,
      bolgeler: r.bolgeSayisi,
      bulunanBolge: r.bulunanBolge,
      sureMs,
      okunan: r.okunan,
      // En zayıf karakterin olasılığı. "Ortalama güven tek yanlış karakteri
      // gizler" (rehber §8) — nöbetçi en zayıf karakteri görmelidir.
      minGuven: r.guven || 0,
      guvenSeviyesi: r.guvenSeviyesi || 'yesil',
      hatalar: r.hatalar || [],
      // Hata ayıklama: hangi bölge, hangi kırpım payı okundu. Tesseract
      // hattındaki `denemeler` ile aynı amaçla tutulur.
      denemeler: r.denemeler || [],
      // Karakter başına güven dökümü: nöbetçi hangi karakterden emin
      // olmadığımızı görebilsin (rehber §8)
      karakterGuven: (r.adaylar[0] && r.adaylar[0].karakterGuven) || null,
    };
  }

  /**
   * Gölge mod için: Tesseract hattını aynı adaylarla çalıştırır.
   * Sonuç kararına KARIŞMAZ, yalnızca karşılaştırma için döner.
   */
  async tesseractOkuSade(gri, g, y, isler, bilinen, secenek) {
    await this.hazirla();
    const toplanan = [];
    for (const b of isler.slice(0, 6)) {          // gölge modda maliyeti sınırlı
      const kirp = bolgeKirp(gri, g, y, b);
      if (!kirp) continue;
      for (const varyant of ['normal-k', 'otsu-k']) {
        const h = onIsle(kirp.veri, kirp.genislik, kirp.yukseklik, varyant);
        const bmp = G.bmpKodla(h.veri, h.genislik, h.yukseklik);
        let sonuc;
        try {
          sonuc = await sessizCagri(() => this.isci.recognize(bmp));
        } catch { return { basarili: false, plaka: null }; }
        const metin = (sonuc && sonuc.data && sonuc.data.text) || '';
        if (!metin.trim()) continue;
        for (const aday of adayUret(metin, bilinen)) {
          aday.kaynak = varyant + '/' + b.tur;
          aday.ocrGuven = sonuc.data.confidence || 0;
          toplanan.push(aday);
        }
        if (toplaman.length) break;
      }
    }
    const enIyi = EnIyiyiSec(toplanan);
    const ilk = enIyi.adaylar[0];
    return { basarili: !!(ilk && ilk.yapi >= TP.YAPI_ESIK), plaka: ilk ? ilk.bicim : null };
  }



}


module.exports = {
  PlakaMotoru,
  // dışa açılan saf yardımcılar (testler bunları doğrudan doğrular)
  temizle, bicimlendir, anahtar, yapiPuani, adayUret, levenshtein,
  onIsle, metinVarMi, bozukGorsetMi, bolgeKirp, sessizCagri, yeterli,
  CH2DIG, CH2LET, HARFLER,
};


