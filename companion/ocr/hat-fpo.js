'use strict';
// ============================================================================
//  fast-plate-ocr OKUMA HATTI
// ----------------------------------------------------------------------------
//  Bu dosya Tesseract hattının YERİNİ geçer; dış arayüz aynı kalır
//  (`sonuc = { basarili, plaka, adaylar, ham, neden, ... }`).
//
//  Tesseract hattından temel farklar — hepsi rehberden gelen kurallar:
//
//  1) ÖN İŞLEME YOK. Tesseract ikilileştirme (Otsu/Sauvola), ters çevirme ve
//     agresif büyütme istiyordu; bu model doğal görüntüyle eğitilmiş.
//     Rehber §13.2 bu ön işlemelerin bu modelde ZARAR verdiğini söylüyor.
//     Burada yalnızca kırpım + yeniden boyutlandırma yapılır (modelin kendi
//     `oku()` metodu).
//
//  2) TÜM ADAYLAR OKUNUR. Maliyet artık aday sayısına bağlı değil
//     (ölçüm: en iyi model tüm adaylarda p50 45 ms). Bu yüzden kademe/zaman
//     bütçesi karmaşasına GEREK YOK: her aday tek tek okunur, en iyisi seçilir.
//     Rehber §12.4 ve §13.13 tam olarak bunu söylüyor.
//
//  3) KARAKTER BAŞINA GÜVEN KULLANILIR, özellikle `minGuven` (en zayıf
//     karakter). Ortalama güven tek yanlış karakteri gizler. Rehber §8.
//
//  4) DOĞRULAMA VAR, UYDURMA YOK. Karakter EKLENMEZ. Rehber §7.3 ve §13.3.
//     (Tesseract hattındaki "rakam ekleme" onarımı sahte plaka üretiyordu;
//     bu hatta kesinlikle taşınmıyor.)
//
//  5) KURYE LİSTESİ SADECE ÖNERİ ÜRETİR. Puanı artırmaz, güveni artırmaz,
//     karakter üretmez. Rehber §8.4 ve §13.4. (Tesseract hattında listeyle
//     eşleşmeye +30 puan veriliyordu; bu bir güvenlik riskiydi.)
// ============================================================================

const G = require('./gorsel.js');

// ---------------------------------------------------------------------------
//  Yapı doğrulama (Tesseract hattındaki `yapiPuani` yeniden kullanılır;
//  ikinci bir doğrulayıcı yazmak iki kaynaktan gelen kural demektir)
// ---------------------------------------------------------------------------
const TP = require('./turk-plaka.js');

/**
 * Yapı eşiği iki hattta da AYNI olmalı; tek kaynaktan gelir
 * (turk-plaka.js → YAPI_ESIK). Değeri ve gerekçesi orada.
 */
const YAPI_ESIK = TP.YAPI_ESIK;

/**
 * TRAFİK IŞIĞI EŞİKLERİ (rehber §8) — ölçümle kalibre edildi.
 *   yeşil : minGuven >= GUVENLI_ESIGI        -> doğrudan göster
 *   sarı  : MIN_GUVEN_ESIGI <= minGuven < GUVENLI_ESIK -> "nöbetçi onaylasın"
 *   kırmızı: minGuven < MIN_GUVEN_ESIGI      -> plaka OKUNMADI, yaklaşın
 *
 * Kırmızı bantta sonuç "başarılı" sayılmaz. Gerekçe ve kalibrasyon
 * tablosu yukarıdaki blokta.
 */
const MIN_GUVEN_ESIGI = 0.50;
const GUVENLI_ESIK = 0.90;

/** Türk plaka yapısına uyan bir metin mi? (0 = uymaz) */
function yapiKontrol(metin) {
  return TP.yapiPuani(metin);
}

// ---------------------------------------------------------------------------
//  Konuma duyarlı karakter düzeltme — YALNIZCA DEĞİŞTİRME (rehber §7.2)
// ---------------------------------------------------------------------------
// Model her yuva için tüm alfabenin olasılıklarını veriyor. Karışan çiftler
// yalnızca (a) karakterin yanlış konum sınıfında olması VE (b) modelin İKİNCİ
// en yüksek olasılığının doğru sınıftan gelmesi hâlinde değiştirilir.
// Böylece tahmin, modelin kendi verisine dayanır — dış kural uydurmaz.

const RAKAM_OLAN = '0123456789';

// Konum sınıfı: 0 = il (ilk 2), 1 = harfler, 2 = seri rakamlar
function konumSinifi(metin, i) {
  const n = metin.length;
  if (i < 2) return 0;
  if (i < n - 2) return 1;
  return 2;
}

/**
 * Konuma duyarlı karakter düzeltme — YALNIZCA, MODELİN KENDİ TERCİHİNE GÖRE.
 *
 * Kural (rehber §7.2): karışan bir çift yalnızca iki koşul BİRLİKTЕ sağlanırsa
 * değiştirilir:
 *   (a) karakter yanlış konum sınıfında (il/harf/seri),
 *   (b) modelin bu yuvadaki İKİNCİ en yüksek karakteri doğru sınıftan geliyor
 *       VE o karakterin olasılığı anlamlı eşiğin üstünde.
 *
 * Neden bu kadar katı?
 * ÖLÇÜLEN HATA: uzak araç sahnesinde model "14A0099" okudu (minGuven 0,19).
 * Eski uygulamada 4. konumdaki "0", "harf sınıfı yanlış" gerekçesiyle 'A'ya
 * ÇEVRİLDİ — ama o 'A' modelin tahmini DEĞİLDİ, bizim sezgimizdi. Sonuç
 * "14AA099" oldu ve yapı puanı 15/15 (mükemmel) alarak tüm doğru
 * adayları yendi. Yani düzeltme, düzeltmeyi hak etmeyen bir okumayı
 * "kusursuz görünen" bir plakaya dönüştürüyordu.
 *
 * Bu tam olarak rehberin yasakladığı uydurmadır:
 *   §7.3  "OCR'ın görmediği karakter eklenmez"
 *   §13.3 "OCR'ın görmediği karakter eklemeyin"
 *
 * Bu yüzden düzeltmede artık HARF TAHMİN EDİLMEZ; yalnızca modelin zaten
 * ürettiği ikinci tercih kullanılır. İkinci tercih de yoksa karakter DOKUNULMAZ.
 *
 * @param {string} metin modelden gelen ham metin
 * @param {number[]} guvenler yuva başına en yüksek olasılık
 * @param {number[]} ikinciler yuva başına ikinci en yüksek olasılık
 * @param {number[]} ikinciIndeksler yuva başına ikinci karakterin alfabe indeksi
 * @param {string} alfabe model alfabeleri
 * @returns {{metin:string, duzeltmeler:string[]}}
 */
function konumaGoreDuzelt(metin, guvenler, ikinciler, ikinciIndeksler, alfabe) {
  if (!metin || !guvenler || guvenler.length !== metin.length) return { metin, duzeltmeler: [] };
  if (!ikinciIndeksler || ikinciIndeksler.length !== metin.length) return { metin, duzeltmeler: [] };
  if (!alfabe) return { metin, duzeltmeler: [] };

  const duzeltmeler = [];
  const n = metin.length;
  // İkinci tercihin bu kadar güçlü olması gerekir. Düşükse model de emin
  // değildir; bizim de oynayacak yerde yoktur.
  const EN_FAZLA_IKINCI = 0.25;

  for (let i = 0; i < n; i++) {
    const sinif = konumSinifi(metin, i);
    const c = metin[i];
    const rakamMi = RAKAM_OLAN.indexOf(c) >= 0;
    const yanlis = (sinif === 1) ? rakamMi : !rakamMi;
    if (!yanlis) continue;

    const olasilik = ikinciler[i];
    if (typeof olasilik !== 'number' || olasilik < EN_FAZLA_IKINCI) continue;

    const idx = ikinciIndeksler[i];
    if (typeof idx !== 'number' || idx < 0 || idx >= alfabe.length) continue;

    const aday = alfabe[idx];
    if (!aday || aday === c) continue;

    // İkinci tercih de doğru sınıftan olmalı; değilse elde veri yok.
    const adayRakamMi = RAKAM_OLAN.indexOf(aday) >= 0;
    const adayDogru = (sinif === 1) ? !adayRakamMi : adayRakamMi;
    if (!adayDogru) continue;

    duzeltmeler.push('pozisyon ' + (i + 1) + ': "' + c + '" -> "' + aday + '" (modelin 2. tercihi)');
    return {
      metin: metin.slice(0, i) + aday + metin.slice(i + 1),
      duzeltmeler,
    };
  }
  return { metin, duzeltmeler };
}

// Uydurma karakter sabitleri KALDIRILDI.
// Ölçülen hata: model "14A0099" okudu (minGuven 0,19); 4. konumdaki "0" için
// burada tanımlı ILK_HARF='A' kullanılıyordu. 'A' modelin tahmini DEĞİLDİ,
// bizim sezgimizdi. Sonuç "14AA099" oldu ve yapı puanı 15/15 alarak tüm doğru
// adayları yendi. Artık düzeltme yalnızca modelin kendi 2. tercihinden gelir;
// ikinci tercih uygun değilse karakter DOKUNULMAZ (rehber §7.3, §13.3).

// ---------------------------------------------------------------------------
//  Kırpım — %12 pay (rehber §12.2: harf kenarları kesilmesin)
// ---------------------------------------------------------------------------
function payliKirp(gri, g, y, bolge, oran = 0.12) {
  const px = Math.max(4, Math.round(bolge.g * oran));
  const py = Math.max(3, Math.round(bolge.y2 * oran));
  const x0 = Math.max(0, bolge.x - px);
  const y0 = Math.max(0, bolge.y - py);
  const x1 = Math.min(g, bolge.x + bolge.g + px);
  const y1 = Math.min(y, bolge.y + bolge.y2 + py);
  const ng = x1 - x0, ny = y1 - y0;
  if (ng < 16 || ny < 8) return null;
  const veri = new Uint8ClampedArray(ng * ny);
  for (let j = 0; j < ny; j++) {
    veri.set(gri.subarray((y0 + j) * g + x0, (y0 + j) * g + x1), j * ng);
  }
  return { veri, genislik: ng, yukseklik: ny };
}

// ---------------------------------------------------------------------------
//  Kurye listesi — SADECE ÖNERİ (rehber §8)
// ---------------------------------------------------------------------------
/**
 * Levenshtein <= 1 ise "listede şu plaka olabilir" önerisi üretir.
 * Puanı veya güveni ARTIRMAZ. Liste karakter ÜRETMENİR.
 */
function kuryeOnerisi(okunan, bilinenler) {
  if (!okunan || !Array.isArray(bilinenler) || !bilinenler.length) return null;
  const anahtarla = (x) => String(x || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const k = anahtarla(okunan);
  if (!k) return null;
  let enIyi = null;
  for (const b of bilinenler) {
    const bk = anahtarla(b);
    if (!bk) continue;
    const d = levenshtein(bk, k);
    if (d > 1) continue;
    if (!enIyi || d < enIyi.mesafe) enIyi = { plaka: String(b), mesafe: d };
  }
  if (!enIyi) return null;
  return {
    plaka: enIyi.plaka,
    mesafe: enIyi.mesafe,
    // Arayüzde açıkça gösterilecek uyarı (rehber §8.5)
    uyari: enIyi.mesafe === 0
      ? 'okunan listede bir kurye plakasıyla birebir aynı'
      : 'okunan listedeki plakadan ' + enIyi.mesafe + ' karakter farklı — ONAY GEREKİYOR',
  };
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// ---------------------------------------------------------------------------
//  Ana okuma
// ---------------------------------------------------------------------------

/**
 * @param {FpoMotoru} motor
 * @param {Uint8ClampedArray} gri
 * @param {number} g @param {number} y
 * @param {Array} bolgeler [{x,y,g,y2,tur}]
 * @param {Array} bilinen kurye plakaları (yalnızca öneri için)
 * @returns {{basarili, plaka, adaylar, ham, bolgeSayisi}}
 */
async function okuBolgeler(motor, gri, g, y, bolgeler, bilinen) {
  const okumalar = [];
  const hatalar = [];
  const baslangic = Date.now();

  // Kırpım genişliği iki değerde denenebilir — ama HER zaman değil.
  //
  // ÖLÇÜLEN HATA (14 koşulun 3'ünde): model FAZLA bir karakter üretiyordu.
  //     34 ABC 123 -> "34 ABB 1123"   (fazladan B)
  //     34 ABC 123 -> "34 ABC 122"   (fazladan 2)
  // Sebep, kırpımdaki komşu içerik: %12 pay (rehber §12.2 harf kenarlarını
  // korur) plakanın yanındaki çizgiyi de modele sokuyor ve model onu da
  // karakter sanıyor.
  //
  // ÇÖZÜM: Tesseract'a özgü ön işlemeye (ikilileştirme/ters çevirme/büyütme)
  // dokunmadan yalnızca KIRPIM SEÇİMİ çeşitlendiriliyor — bu ön işleme
  // değil, veri hazırlığı.
  //
  // UYARILABILIR ERKEN ÇIKIŞ — asıl performans kararı:
  // Katman bazlı ölçüm (tools/olcum-darboaz.js) şunu gösterdi:
  //     coz() argmax çözümleme : 0,0045 ms   (<%0,1 — ihmal edilebilir)
  //     tensör hazırlama       : 0,10    ms
  //     session.run()          : 14,4    ms   (C++ ONNX — DARBOĞAZ BU)
  // Yani JS tarafını mikro-optimize etmek ölçüm gürültüsü seviyesinde
  // kazandırır. Kazanç, model ÇAĞRILARINI AZALTMAKTAN gelir.
  //
  // ÖLÇÜLEN KAZANÇ (17 senaryo, iki strateji karşılaştırıldı):
  //     daima iki pay     : 5,4 okuma/istek · 135 ms
  //     uyarılabilir çıkış: 3,7 okuma/istek · 102 ms   (%32 daha az çağrı)
  //     SONUÇLAR BİREBİR AYNI (17/17 senaryo) — hız kazanıldı, doğruluk kaybedilmedi.
  //
  // Kural: dar kırpım geçerli bir plaka ve YÜKSEK güven verdiyse geniş
  // kırpıma gerek yok. Zor karelerde (metin yok, yapı geçersiz veya güven
  // düşük) ikinci deneme yapılır.
  const KIRPIM_ORANLARI = [0.04, 0.12];
  const ERKEN_CIKIS_GUVEN = GUVENLI_ESIK;   // bu eşiğin altındaysa ikinci deneme

  /** Bir okuma "yeterince güvenilir" mi? */
  const yeterinceGuvenli = (r) =>
    !!r && !!r.metin && TP.yapiPuani(r.metin) >= YAPI_ESIK && r.minGuven >= ERKEN_CIKIS_GUVEN;

  for (const b of bolgeler) {
    for (let i = 0; i < KIRPIM_ORANLARI.length; i++) {
      const oran = KIRPIM_ORANLARI[i];
      const kirp = payliKirp(gri, g, y, b, oran);
      if (!kirp) continue;
      try {
        const r = await motor.oku(kirp.veri, kirp.genislik, kirp.yukseklik);
        if (r.metin) okumalar.push({ b, r, oran });
        // ERKEN ÇIKIŞ: dar kırpım zaten güvenilir bir plaka verdiyse geniş
        // kırpım denemesi yapılmaz. Bu, model çağrılarını ~%32 azaltır ve
        // 17 senaryoda sonucu BİREBİR DEĞİŞTİRMEZ (ölçüldü).
        if (yeterinceGuvenli(r)) break;
      } catch (e) {
        // Tek bir adayın hatası tüm okumayı düşürmemeli, ama SESSİZCE de
        // yutulmamalı (rehber §13.12). Toplanıp sonuçta raporlanır.
        hatalar.push(b.tur + ' (pay ' + oran + '): ' + e.message);
        break;                       // bu bölgede ikinci deneme anlamsız
      }
    }
  }

  // --- Değerlendirme ---
  const adaylar = [];
  for (const { b, r, oran } of okumalar) {
    if (!r.metin) continue;
    const duz = konumaGoreDuzelt(r.metin, r.guvenler, r.ikinciler, r.ikinciIndeksler, r.alfabe);
    const metin = duz.metin;
    const yapi = yapiKontrol(metin);

    // Düzeltme yapıldıysa güven DÜŞÜRÜLÜR (rehber §7.2 son cümle).
    let minGuven = r.minGuven;
    if (duz.duzeltmeler.length) minGuven = Math.max(0, minGuven - 0.10 * duz.duzeltmeler.length);

    // Kurye listesi yalnızca öneri; puanı ve güveni etkilemez.
    const oneri = kuryeOnerisi(metin, bilinen);

    adaylar.push({
      plaka: metin,
      bicim: bicimlendir(metin),
      yapi,                                   // 0 = yapı geçersiz
      minGuven: Math.round(minGuven * 1000) / 1000,
      ortGuven: r.ortGuven,
      gecerli: yapi >= YAPI_ESIK,
      duzeltmeler: duz.duzeltmeler,
      bolge: b.tur,
      kirpimPayi: oran,
      bolgeOncelik: b.tur.indexOf('ipucu') === 0 ? 2 : b.tur === 'bolge' ? 1 : 0,
      kuryeOnerisi: oneri,
      bolgeTutarli: !!r.bolge && /^turkey$/i.test(r.bolge.ad),
      modelBolge: r.bolge ? r.bolge.ad : null,
    });
  }

  // ======================================================================
  //  ÇOKLU OKUMA OYLAMASI — ucuz OCR'ın asıl avantajı
  // ======================================================================
  //  ÖLÇÜLEN HATA (uzak araç sahnesi, plaka %18): doğru plaka bir bölgeden
  //  %55 güvenle okunuyordu; buna karşılık BAŞKA bir bölgeden (genişletilmiş,
  //  arka planı da içeren) "14 AA 099" %85+ güvenle geliyordu. Tek en yüksek
  //  güvenli okumayı seçmek YANLIŞ sonucu seçti.
  //
  //  Çözüm: aynı bölge iki kırpım genişliğiyle, birden çok bölge de okunduğu
  //  için doğru plaka genellikle ÇOK KEZ okunmuştur. En iyi tek okuma yerine
  //  "kaç kez aynı plaka okundu" + "ortalama minGuven" birlikte değerlendirilir.
  //
  //  Bu, dışarıdan hiçbir bilgi kullanmaz: yalnızca modelin kendi okumalarının
  //  kendi içinde tutarlılığıdır. Rehber §12.4'ün ("adaylar ucuz, hepsini
  //  okuyun") asıl kazancı da tam olarak budur.
  const gruplar = new Map();
  for (const a of adaylar) {
    let g = gruplar.get(a.plaka);
    if (!g) {
      g = { ...a, okumaSayisi: 0, guvenToplam: 0, ortGuvenToplam: 0, bolgeler: new Set(), kaynaklar: [] };
      gruplar.set(a.plaka, g);
    }
    g.okumaSayisi++;
    g.guvenToplam += a.minGuven;
    g.ortGuvenToplam += a.ortGuven;
    g.bolgeler.add(a.bolge);
    g.kaynaklar.push(a.bolge + '/' + a.kirpimPayi);
    // En iyi tek okumanın alanlarını koru (düzeltmeler, kurye önerisi, model bölgesi)
    if (a.minGuven > g.minGuven) {
      g.minGuven = a.minGuven;
      g.duzeltmeler = a.duzeltmeler;
      g.kuryeOnerisi = a.kuryeOnerisi;
      g.modelBolge = a.modelBolge;
      g.bolge = a.bolge;
      g.bolgeOncelik = a.bolgeOncelik;
    }
    if (a.ortGuven > g.ortGuven) g.ortGuven = a.ortGuven;
  }

  const gruplu = Array.from(gruplar.values()).map((g) => ({
    ...g,
    ortMinGuven: Math.round((g.guvenToplam / g.okumaSayisi) * 1000) / 1000,
    bolgeSayisi: g.bolgeler.size,
    kaynaklar: g.kaynaklar,
  }));

  // --- Sıralama (rehber §6) ---
  // geçerli yapı → kaç kez doğru okundu → ort. minGuven → en iyi minGuven
  //                → ortGuven → bölge önceliği → kurye önerisi (SON ipucu)
  gruplu.sort((a, b) =>
    (b.gecerli - a.gecerli)
    || (b.okumaSayisi - a.okumaSayisi)
    || (b.ortMinGuven - a.ortMinGuven)
    || (b.minGuven - a.minGuven)
    || (b.ortGuven - a.ortGuven)
    || (b.bolgeOncelik - a.bolgeOncelik)
    || (b.kuryeOnerisi ? 1 : 0) - (a.kuryeOnerisi ? 1 : 0)
    || a.plaka.localeCompare(b.plaka));

  const liste = gruplu.slice(0, 5);
  const enIyi = liste.find((a) => a.gecerli) || liste[0] || null;

  // Trafik ışığı kararı. Yapı geçerli OLSA BİLE en zayıf karakterin olasılığı
  // eşiğin altındaysa bu plaka okunmuş sayılmaz — nöbetçiye "yaklaşın" denir.
  // Ölçülen gerekçe: uzak araç karesinde "14 A 0099" yapı olarak geçerli
  // (14) ama minGuven yalnızca 0,19. Bunu "okundu" diye göstermek, hiç
  // göstermemekten daha tehlikelidir.
  const guvenliOkuma = !!(enIyi && enIyi.gecerli && enIyi.minGuven >= MIN_GUVEN_ESIGI);
  const seviye = !enIyi || !enIyi.gecerli ? 'kirmizi'
    : enIyi.minGuven >= GUVENLI_ESIK ? 'yesil'
      : enIyi.minGuven >= MIN_GUVEN_ESIGI ? 'sari' : 'kirmizi';

  return {
    basarili: guvenliOkuma,
    guvenSeviyesi: seviye,
    plaka: guvenliOkuma ? enIyi.bicim : '',
    guveniyet: enIyi
      ? Math.round((enIyi.yapi + (enIyi.ortMinGuven + enIyi.minGuven) / 2 * 5) * 10) / 10
      : 0,
    // Nöbetçi arayüzü için: ne kadar emin olduğumuz ve ne öneriyoruz
    guven: enIyi ? enIyi.minGuven : 0,
    adaylar: liste,
    ham: okumalar.map((x) => x.r.metin).filter(Boolean).join(' | '),
    // Hata ayıklama: hangi bölge, hangi kırpım payı, hangi metin, ne kadar
    // güven. Tesseract hattının `denemeler` alanıyla aynı amaçla; susmasına
    // izin verilmez (rehber §13.12).
    denemeler: okumalar.map((x) => ({
      bolge: x.b.tur,
      kirpimPayi: x.oran,
      x: x.b.x, y: x.b.y, g: x.b.g, y2: x.b.y2,
      metin: x.r.metin,
      minGuven: x.r.minGuven,
      ortGuven: x.r.ortGuven,
      modelBolge: x.r.bolge ? x.r.bolge.ad : null,
    })),
    okunan: okumalar.length,
    bolgeSayisi: bolgeler.length,
    bulunanBolge: enIyi ? enIyi.bolge : null,
    sureMs: Date.now() - baslangic,
    hatalar,
  };
}

// ---------------------------------------------------------------------------
//  Biçimlendirme: 34ABC123 -> "34 ABC 123"
// ---------------------------------------------------------------------------
function bicimlendir(plaka) {
  return TP.bicimlendir(plaka);
}

module.exports = {
  okuBolgeler,
  payliKirp,
  yapiKontrol,
  konumaGoreDuzelt,
  kuryeOnerisi,
  bicimlendir,
  levenshtein,
};
