'use strict';
// ============================================================================
//  Plaka Bölgesi Bulucu — saf JavaScript, harici bağımlılık yok
// ----------------------------------------------------------------------------
//  Neden var?
//  Telefon bize ne gönderirse göndersin, içinde plaka küçük bir alan olarak
//  durur. Kırpılmış plaka fikstürleriyle test ediyordu; o zaman görüntünün
//  tamamı plakaydı ve basit eşikleme yetiyordu. Gerçekte telefon bir SAHNE
//  çeker (gökyüzü, yol, araç, gölge) ve plaka kadrajın küçük parçasıdır.
//    ÖLÇÜM — 8 gerçekçi sahne karesinin 8'inde de hata (0/8), çünkü Otsu
//    sahneyi böler (gökyüzü/zemin) ve plakayı hiç görmez.
//
//  Yaklaşım (bilinen ALPR ön işleme hattı, OpenCV'siz):
//   1. Görüntüyü kısa kenara ~900 px'e indir (hız + yeterli çözünürlük).
//   2. **Bulanıklık** (ayırılabilir kutu, 3 geçiş). Bu ADIM ZORUNLUDUR:
//      sensör gürültüsü gradyan haritasını tarar ve uyarlanabilir eşiği
//      yükseltir; bulanıklık olmadan 18 px yüksekliğindeki plaka metni
//      tamamen siliniyordu. Ölçüldü: bulanıklık öncesi 0 aday, sonrası 4+.
//   3. Sobel gradyan büyüklüğü → yazının kenar yoğunluğu yüksektir,
//      gökyüzü/asfalt gibi düz alanlarda sıfıra yakındır.
//   4. Gradyanı **yüzdelik (percentile) eşiğiyle** ikiliye çevir. Mutlak
//      eşik düşük kontrastlı gece karesini, uyarlanabilir eşik gürültülü
//      kareyi bozuyor; yüzdelik her ikisinde de çalışır.
//   5. YATAY morfoloji kapama (geniş çekirdek) → harfler birleşir, tek bir
//      "metin satırı" lekesi oluşur. Plaka yatay olduğu için birleşme güçlü,
//      dikey yapılar (direk, ağaç, bina kenarı) ayrışır.
//   6. Bağlı bileşenleri çıkar → her lekenin kutusu bir aday.
//   7. Plaka geometrisiyle süz: en-boy oranı 2.0-7.5, doluluk, boyut.
//   8. Dışarı taşırarak (padding) büyüt, puanla, en iyiden başla.
//
//  ÇOK ÖLÇEKLİ (multi-scale) tarama: plaka metni 14 px ya da 90 px
//  yüksekliğinde olabilir. Karakter yüksekliğine göre üç farklı yatay
//  çekirdek denenir; her ölçek kendi bileşenlerini üretir, sonuçlar
//  birleştirilip çakışanlar elenir. Tek ölçek bunu başaramıyordu.
//
//  Tasarım kararı: bu bulucu ASLA "plaka yok" demez, yalnızca aday listesi
//  döndürür. Kararı OCR verir. Yanlış negatif üretmektense fazla aday
//  önermek yeğdir (bütçe ile sınırlıdır).
// ============================================================================

const G = require('./gorsel.js');

/** Türk plaka geometri sınırları. */
const MIN_ORAN = 1.9;   // genişlik/yükseklik
const MAX_ORAN = 8.0;
const MIN_Y = 11;       // piksel — bundan ince metin okunamaz
const MIN_G = 30;       // piksel
const HEDEF_G = 900;    // çalışma genişliği

function olcekleHedef(gri, genislik, yukseklik) {
  if (genislik <= HEDEF_G) return { veri: gri, genislik, yukseklik };
  const k = HEDEF_G / genislik;
  const ng = HEDEF_G;
  const ny = Math.max(1, Math.round(yukseklik * k));
  return { veri: G.olcekle(gri, genislik, yukseklik, ng, ny), genislik: ng, yukseklik: ny };
}

/**
 * Sobel gradyan büyüklüğü (0-255). |gx|+|gy| — karekök gereksiz yavaşlatır.
 */
function sobel(gri, g, y) {
  const out = new Uint8ClampedArray(g * y);
  for (let j = 1; j < y - 1; j++) {
    for (let i = 1; i < g - 1; i++) {
      const o = j * g + i;
      const gx =
        -gri[o - g - 1] - 2 * gri[o - 1] - gri[o + g - 1] +
         gri[o - g + 1] + 2 * gri[o + 1] + gri[o + g + 1];
      const gy =
        -gri[o - g - 1] - 2 * gri[o - g] - gri[o - g + 1] +
         gri[o + g - 1] + 2 * gri[o + g] + gri[o + g + 1];
      const m = Math.abs(gx) + Math.abs(gy);
      out[o] = m > 255 ? 255 : m;
    }
  }
  return out;
}

/**
 * Yüzdelik eşiği: gradyan dağılımının belirli bir yüzdeliğinin üstü "kenar".
 *
 * Neden yüzdelik? Mutlak eşik (örn. 26) karanlık gece karesinde metni
 * kaçırır; uyarlanabilir (Sauvola) eşik ise gürültü yükseldiğinde metni
 * siler. Yüzdelik eşik her iki durumda da kendiliğinden uyum sağlar.
 * Ek olarak "gürültü tabanı" üzerinden bir güvenlik payı bırakılır.
 *
 * @param {number} yuzde kaçıncı yüzdelik (ör. 92 → üst %8 kenar sayılır)
 */
function gradyanEsikYuzdelik(grad, yuzde = 92, taban = 18) {
  const n = grad.length;
  // Histogram üzerinden yüzdelik (sıralama O(n log n) yerine O(n))
  const h = new Uint32Array(256);
  for (let i = 0; i < n; i++) h[grad[i]]++;
  const hedef = (n * yuzde) / 100;
  let kumul = 0, esik = 255;
  for (let v = 0; v < 256; v++) {
    kumul += h[v];
    if (kumul >= hedef) { esik = v; break; }
  }
  // Düz bölgeler (gökyüzü) çok düşük; tabanı yükseltmek onları eler
  if (esik < taban) esik = taban;
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) out[i] = grad[i] > esik ? 255 : 0;
  return { ikili: out, esik };
}

/**
 * Yatay kapama: harfleri tek metin satırına birleştirir.
 * Dikeyde yalnızca 1 piksel genişletme yapılır (metin yüksekliğini
 * bütünleştirmek için); dikeyde güçlü birleştirme dikey yapıları da
 * birleştirir ve yanlış aday üretir.
 */
function yatayKapama(bin, g, y, cekirdek) {
  const yaricap = Math.max(1, Math.floor(cekirdek / 2));
  const gecici = new Uint8ClampedArray(g * y);
  const out = new Uint8ClampedArray(g * y);
  for (let j = 0; j < y; j++) {
    const satir = j * g;
    for (let i = 0; i < g; i++) {
      let beyaz = 0;
      let toplam = 0;
      for (let d = -yaricap; d <= yaricap; d++) {
        const xx = i + d;
        toplam++;
        if (xx < 0 || xx >= g) continue;
        if (bin[satir + xx]) beyaz++;
      }
      gecici[satir + i] = beyaz * 2 > toplam ? 255 : 0;
    }
  }
  for (let j = 0; j < y; j++) {
    for (let i = 0; i < g; i++) {
      let beyaz = 0;
      for (let d = -1; d <= 1; d++) {
        const yy = j + d;
        if (yy < 0 || yy >= y) continue;
        if (gecici[yy * g + i]) beyaz++;
      }
      out[j * g + i] = beyaz >= 2 ? 255 : 0;
    }
  }
  return out;
}

/** Bağlı bileşenler (4-komşuluk, yığın tabanlı) → kutu listesi. */
function bagliBilesenler(bin, g, y, minAlan) {
  const etiket = new Int32Array(g * y).fill(-1);
  const yigin = new Int32Array(g * y);
  const kutular = [];
  let sonraki = 0;

  for (let bas = 0; bas < bin.length; bas++) {
    if (!bin[bas] || etiket[bas] !== -1) continue;
    let tepe = 0;
    yigin[tepe++] = bas;
    etiket[bas] = sonraki;
    let alan = 0, minX = g, maxX = -1, minY = y, maxY = -1;

    while (tepe > 0) {
      const p = yigin[--tepe];
      const py = (p / g) | 0, px = p - py * g;
      alan++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      if (px > 0 && bin[p - 1] && etiket[p - 1] === -1) { etiket[p - 1] = sonraki; yigin[tepe++] = p - 1; }
      if (px < g - 1 && bin[p + 1] && etiket[p + 1] === -1) { etiket[p + 1] = sonraki; yigin[tepe++] = p + 1; }
      if (py > 0 && bin[p - g] && etiket[p - g] === -1) { etiket[p - g] = sonraki; yigin[tepe++] = p - g; }
      if (py < y - 1 && bin[p + g] && etiket[p + g] === -1) { etiket[p + g] = sonraki; yigin[tepe++] = p + g; }
    }
    if (alan >= minAlan) kutular.push({ x: minX, y: minY, g: maxX - minX + 1, y2: maxY - minY + 1, alan });
    sonraki++;
  }
  return kutular;
}

/**
 * Ana giriş: plaka benzeri bölge adaylarını bulur.
 *
 * @param {Uint8ClampedArray} gri
 * @param {number} genislik
 * @param {number} yukseklik
 * @param {object} [secenek] { enFazla, yuzde }
 * @returns {Array<{x,y,g,y2,puan,oran,doluluk}>}  GERÇEK çözünürlükte kutular
 */
function bul(gri, genislik, yukseklik, secenek = {}) {
  const enFazla = secenek.enFazla || 8;
  const yuzde = secenek.yuzde || 92;
  if (!gri || genislik < 32 || yukseklik < 12) return [];

  // 1) çalışma çözünürlüğü
  const o = olcekleHedef(gri, genislik, yukseklik);
  const g = o.genislik, y = o.yukseklik;

  // 2) bulanıklık — ZORUNLU, aksi hâlde metin gürültüde kayboluyor
  const yumusak = G.bulaniklastir(o.veri, g, y, 1);

  // 3-4) gradyan + yüzdelik eşik
  const grad = sobel(yumusak, g, y);
  const { ikili } = gradyanEsikYuzdelik(grad, yuzde, 18);

  // 5-7) çok ölçekli yatay kapama + bileşen + süzme
  // Karakter yüksekliği 14/26/46 px olabilir → üç çekirdek.
  const cekirdekler = [11, Math.max(17, Math.round(y * 0.055)), Math.max(31, Math.round(y * 0.11))];
  const adaylar = new Map();
  // Katı süzgeçte elenen AMA aşırı geniş lekelere ayrı havuz: plaka bir
  // çizgiye/çite kaynaşınca leke plakadan çok geniş olur ve oranı bozulur.
  const genisLeKeler = [];
  const minAlan = Math.max(50, Math.round(g * y * 0.0008));

  for (const cekirdek of cekirdekler) {
    const kapali = yatayKapama(ikili, g, y, cekirdek);
    for (const k of bagliBilesenler(kapali, g, y, minAlan)) {
      if (k.y2 < MIN_Y || k.g < MIN_G) continue;
      const oran = k.g / k.y2;
      if (oran > MAX_ORAN && k.g > 260) {
        genisLeKeler.push(k);   // bölme adayı
        continue;
      }
      if (oran < MIN_ORAN || oran > MAX_ORAN) continue;
      const doluluk = k.alan / (k.g * k.y2);
      // Çok gevşek = gürültü/leke. Alt sınır sert.
      if (doluluk < 0.22) continue;
      // DİKKAT — üst sınır SEBEBİSİZCE 0.94'tü ve bu bir hata üretiyordu:
      // küçük bir plaka (%18 ölçek, 70x21 piksel) yatay kapamadan sonra
      // TAMAMEN dolu bir lekeye dönüşüyor (doluluk 1.00) ve aday eleniyordu.
      // Oysa plaka geometrisine sahip tam dolu bir leke güçlü bir PLAKA
      // sinyalidir. Bu yüzden üst sınır kaldırıldı, katı doluluk ise puanda
      // hafifçe cezalandırılır (duvar/çit olabilir) ama atılmaz.
      const puan = oran * 6 + Math.min(30, k.g * 0.06) - Math.abs(doluluk - 0.6) * 25;
      const anahtar = `${Math.round(k.x / 6)}_${Math.round(k.y / 6)}`;
      const varolan = adaylar.get(anahtar);
      if (!varolan || varolan.puan < puan) adaylar.set(anahtar, { ...k, puan, oran, doluluk });
    }
  }

  // ---------------------------------------------------------------------
  //  Geniş bileşenleri bölme — plaka bir çizgiye/çite yapışınca leke
  //  plakadan çok daha geniş olur ve geometri süzümünden düşer.
  // ---------------------------------------------------------------------
  // Gerçekleşen örnek: plaka (738,394 103x25) ile sahnedeki yatay bir
  // çizgi (1,389 898x32) TEK lekeye kaynaşmış; oran 28 çıktığı için
  // ne katı ne gevşek süzgeç kabul ediyordu. Gerçekte olan şey plakanın
  // o çizginin içinde kaldığı. Çözüm: lekeyi plaka oranlı pencerelere
  // bölüp her birini aday üretmek. OCR sonunda karar verir; yanlış
  // bölünmeler zaman kaybından başka bir şeye mal olmaz.
  for (const a of genisLeKeler) {
    const adim = Math.max(10, Math.round(a.y2 * 0.8));   // örtüşen pencereler
    const hedefG = Math.round(a.y2 * 4.2);                // plaka oranı ≈ 4.2
    for (let x = a.x; x + hedefG <= a.x + a.g; x += adim) {
      const kutu = { x, y: a.y, g: hedefG, y2: a.y2 };

      // --- Pencere içeriğini karakterlendir ---
      //
      // Ölçülen bulgu: geniş lekenin tamamı neredeyse aynı yoğunluğa sahip
      // (0.295-0.305), çünkü lekeyi üreten yatay çizgi baskın. Yoğunluk
      // ayırıcı DEĞİL.
      //
      // Doğru ayırıcı DİKEY GEÇİŞ ENERJİSİ'dir: sütun sütun kenar
      // sayılır ve komşu sütunlar arasındaki fark toplanır.
      //   plaka yazısı : "34 ABC 123" -> karakter sınırları çok, enerji YÜKSEK
      //   düz çizgi    : sürekli bant  -> sütunlar benzer, enerji DÜŞÜK
      let sutun = new Uint32Array(kutu.g);
      for (let i = 0; i < kutu.g; i++) {
        let n = 0;
        for (let j = kutu.y; j < kutu.y + kutu.y2; j++) if (ikili[j * g + kutu.x + i]) n++;
        sutun[i] = n;
      }
      let gecis = 0, kenarToplam = 0;
      for (let i = 0; i < kutu.g; i++) kenarToplam += sutun[i];
      for (let i = 1; i < kutu.g; i++) gecis += Math.abs(sutun[i] - sutun[i - 1]);
      const yogunluk = kutu.g * kutu.y2 ? kenarToplam / (kutu.g * kutu.y2) : 0;
      // Normalize: sütun başına ortalama mutlak değişim (0 = düz, yüksek = metin)
      const gecisNorm = gecis / Math.max(1, kutu.g - 1);

      const oran = kutu.g / kutu.y2;
      const doluluk = a.alan / (a.g * a.y2);
      // Geçiş enerjisi baskın sinyal; yoğunluk ve geometri destekleyici.
      const puan = gecisNorm * 26
        + oran * 3
        - Math.abs(yogunluk - 0.30) * 40
        - 10;
      const anahtar = `${Math.round(kutu.x / 6)}_${Math.round(kutu.y / 6)}`;
      const varolan = adaylar.get(anahtar);
      if (!varolan || varolan.puan < puan) {
        adaylar.set(anahtar, {
          ...kutu, puan, oran, doluluk, bolunmus: true,
          yogunluk: Math.round(yogunluk * 1000) / 1000,
          gecis: Math.round(gecisNorm * 10) / 10,
        });
      }
    }
  }

  const liste = [...adaylar.values()].sort((a, b) => b.puan - a.puan);

  // ---------------------------------------------------------------------
  //  YEDEK GEÇİŞ: hiç aday çıkmadıysa gevşek ölçütle en geniş lekeleri al.
  // ---------------------------------------------------------------------
  // "Bulamadım" demek, kırpma bandı plakayı içermiyor demekten ayırt
  // edilemez; ama hiç aday döndürmektense zayıf adaylar denemek daha iyidir
  // (her aday ~0,2-0,9 sn; bütçe sınırlar). Gerçekleşen örnek: plaka
  // kadrajın sağ-alt köşesindeyken komşu bir koyu çizgi lekeye katılıp
  // en-boy oranını bozuyordu ve katı süzgeç adayı tamamen düşürüyordu.
  if (liste.length === 0) {
    const gevsek = [];
    const minAlanGevsek = Math.max(30, Math.round(g * y * 0.0004));
    for (const cekirdek of cekirdekler) {
      const kapali = yatayKapama(ikili, g, y, cekirdek);
      for (const k of bagliBilesenler(kapali, g, y, minAlanGevsek)) {
        if (k.y2 < 8 || k.g < 24) continue;
        const oran = k.g / k.y2;
        if (oran < 1.4) continue;                 // yatay olma şartı (gevşek)
        if (oran > 12) continue;                 // aşırı yatay = çizgi, değil
        const doluluk = k.alan / (k.g * k.y2);
        if (doluluk < 0.18) continue;
        // Gevşek aday puanı düşük başlar; kesin adaylar bunu her zaman yener
        const puan = oran * 3 + Math.min(14, k.g * 0.03) - 25;
        const anahtar = `${Math.round(k.x / 6)}_${Math.round(k.y / 6)}`;
        const varolan = gevsek.find((v) => `${Math.round(v.x / 6)}_${Math.round(v.y / 6)}` === anahtar);
        if (!varolan || varolan.puan < puan) {
          const yeni = { ...k, puan, oran, doluluk, gevsek: true };
          if (varolan) gevsek[gevsek.indexOf(varolan)] = yeni;
          else gevsek.push(yeni);
        }
      }
    }
    gevsek.sort((a, b) => b.puan - a.puan);
    liste.push(...gevsek.slice(0, 4));
  }

  // ---------------------------------------------------------------------
  //  Kayan pencere taraması — son çare
  // ---------------------------------------------------------------------
  // Yöntem hiçbir şey bulamadıysa, görüntüyü plaka oranlı pencerelerle
  // tarar. Nihai amaç: kontrastı düşük, kısmen kapatılmış ya da lekeye
  // dönüşmemiş plakalar. Maliyeti yüksektir, bu yüzden YALNIZCA diğer
  // yöntemler tükendiğinde çalışır (bölge sayısı sıfırken).
  //
  // Tarama yatayda sabit aralıkla; kenar yoğunluğu yüksek pencereler
  // önceliklendirilir. Pencere sayısı sınırlıdır ki süre bütçesi aşılmasın.
  if (liste.length === 0) {
    const enFazlaKayan = Math.min(enFazla, 4);
    const pencereY = Math.max(14, Math.round(g * 0.075));   // plaka yüksekliği
    const pencereG = Math.round(pencereY * 4.2);            // plaka oranı
    const adimX = Math.max(24, Math.round(pencereG * 0.55));
    const adimY = Math.max(16, Math.round(pencereY * 0.7));
    const kayanAdaylar = [];

    for (let yy = 0; yy + pencereY <= y; yy += adimY) {
      for (let xx = 0; xx + pencereG <= g; xx += adimX) {
        // Pencere içindeki dikey geçiş enerjisi (metin ayırıcısı)
        const sutun = new Uint32Array(pencereG);
        let toplam = 0;
        for (let i = 0; i < pencereG; i++) {
          let n = 0;
          for (let j = 0; j < pencereY; j++) if (ikili[(yy + j) * g + xx + i]) n++;
          sutun[i] = n;
          toplam += n;
        }
        let gecis = 0;
        for (let i = 1; i < pencereG; i++) gecis += Math.abs(sutun[i] - sutun[i - 1]);
        const yogunluk = toplam / (pencereG * pencereY);
        const gecisNorm = gecis / Math.max(1, pencereG - 1);
        const skor = gecisNorm * 26 - Math.abs(yogunluk - 0.30) * 120;
        kayanAdaylar.push({
          x: xx, y: yy, g: pencereG, y2: pencereY,
          oran: pencereG / pencereY,
          doluluk: yogunluk,
          yogunluk: Math.round(yogunluk * 1000) / 1000,
          gecis: Math.round(gecisNorm * 10) / 10,
          puan: skor - 20,                      // katı ve gevşek adaylardan SONRA
          kayan: true,
        });
      }
    }
    kayanAdaylar.sort((a, b) => b.puan - a.puan);
    // TABAN PUAN: boş pencere aday üretmesin. Ölçüm: düz tek renkli görüntüde
    // tarama 4 aday üretiyordu (hepsi boş pencere) ve bunlar OCR'a gönderilip
    // boşuna ~2-4 saniye harcayacaktı. Düz pencere puanı ≈ -36, gerçek metin
    // içeren pencere pozitiftir. -18 eşiği ikisini ayırıyor.
    // (Not: düz/gürültülü görüntüler zaten bozukGorsetMi() tarafından
    //  önce eleniyor; bu taban, o denetimin bir gün atlanması hâlinde
    //  gereksiz tarama yapılmasını önlüyor.)
    const TABAN = -18;
    const anlamli = kayanAdaylar.filter((a) => a.puan > TABAN);
    // DİKKAT: adaylar bir Map; `.some()` YOKTUR. (İlk yazımda `.some()`
    // çağrıldı ve çalışma anında TypeError verdi — sınır durum testi yakaladı.)
    const mevcut = [...adaylar.values()];
    for (const ad of anlamli.slice(0, enFazlaKayan)) {
      const cakisiyor = mevcut.some((v) => {
        const ix = Math.max(0, Math.min(v.x + v.g, ad.x + ad.g) - Math.max(v.x, ad.x));
        const iy = Math.max(0, Math.min(v.y + v.y2, ad.y + ad.y2) - Math.max(v.y, ad.y));
        const k = ix * iy;
        const b = v.g * v.y2 + ad.g * ad.y2 - k;
        return b > 0 && k / b > 0.6;
      });
      if (!cakisiyor) {
        adaylar.set(ad.x + '_' + ad.y, ad);
        mevcut.push(ad);
      }
    }
    liste.length = 0;
    liste.push(...[...adaylar.values()].sort((a, b) => b.puan - a.puan));
  }

  const sonuc = [];
  const secilen = [];

  for (const a of liste) {
    if (sonuc.length >= enFazla) break;
    // Aşırı örtüşen adayları ele (aynı bölge iki ölçekte bulunmuş olabilir)
    const cakisiyor = secilen.some((s) => {
      const ix = Math.max(0, Math.min(s.x + s.g, a.x + a.g) - Math.max(s.x, a.x));
      const iy = Math.max(0, Math.min(s.y + s.y2, a.y + a.y2) - Math.max(s.y, a.y));
      const kesisim = ix * iy;
      const birlesim = s.g * s.y2 + a.g * a.y2 - kesisim;
      return birlesim > 0 && kesisim / birlesim > 0.6;
    });
    if (cakisiyor) continue;
    secilen.push(a);

    // Çalışma çözünürlüğünden GERÇEK çözünürlüğe ölçekle + dışarı taş
    const olcek = genislik / g;
    const padY = Math.max(3, Math.round(a.y2 * 0.25));
    const padX = Math.max(3, Math.round(a.y2 * 0.20));
    let x0 = Math.max(0, Math.floor((a.x - padX) * olcek));
    let y0 = Math.max(0, Math.floor((a.y - padY) * olcek));
    let x1 = Math.min(genislik, Math.ceil((a.x + a.g + padX) * olcek));
    let y1 = Math.min(yukseklik, Math.ceil((a.y + a.y2 + padY) * olcek));
    if (x1 - x0 < 16) x1 = Math.min(genislik, x0 + 16);
    if (y1 - y0 < 10) y1 = Math.min(yukseklik, y0 + 10);
    sonuc.push({
      x: x0, y: y0, g: x1 - x0, y2: y1 - y0,
      puan: Math.round(a.puan * 10) / 10,
      oran: Math.round(a.oran * 100) / 100,
      doluluk: Math.round(a.doluluk * 100) / 100,
      yogunluk: a.yogunluk,
      gecis: a.gecis,
      gevsek: !!a.gevsek,
      bolunmus: !!a.bolunmus,
      kayan: !!a.kayan,
    });
  }
  return sonuc;
}

module.exports = {
  bul, sobel, gradyanEsikYuzdelik, yatayKapama, bagliBilesenler, olcekleHedef,
};
