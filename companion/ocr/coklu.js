'use strict';
/**
 * ============================================================================
 *  ÇOKLU DENEME — plaka okuma sağlamlaştırması
 * ============================================================================
 *  Kullanıcı ölçümü (29.09.2026): "Kamerayla dönüyoruz ama plaka okunamadı,
 *  plakayı çerçeveye alıp tekrar deneyin diyor ama olmuyor."
 *
 *  ÖLÇÜLEN DURUM (sunucuya gönderilen görüntüler denendi):
 *      kırpılmış 640x101 ......................... BOS
 *      TAM KARE 1280x720, plaka 640px içinde ..... "34 ABC 12"  (eksik)
 *      plaka tek başına 489px ..................... BOS
 *      plaka tek başına 1920px ................... "34 ABC 123"  TANI
 *      489px'i 1920px'e BÜYÜTMEK ................. BOS
 *
 *  ÇIKARILAN SONUÇ: motor tek bir işlemle okumaya çalışıyor ve tutarsa
 *  tutmuyor. QR'da bu sorunu ÇOKLU DENEME ile çözdük (ölçüldü: tek deneme
 *  6/8 senaryo, çoklu deneme kalanları da kurtarıyor). Plakada da aynı
 *  yaklaşım: TEK istek, birden çok hazırlık, ilk tutanı döndür.
 *
 *  NEDEN SUNUCUDA? Çünkü:
 *   1) Görüntü işleme (gri, kontrast, eşik, ölçek) sunucunun işi; telefonda
 *      yapmak görüntüyü 8-10 kez ağa göndermek demek (yavaş, pahalı).
 *   2) Sunucuda tek istek = tek gidiş-dönüş. Nöbetçi bekler, telefon ısınmaz.
 *   3) Modeller sunucuda; işlem orada zaten yapılıyor.
 *
 *  DENENEN SIRA (ölçümle sıralandı — pahalıdan ucuza değil, en çok
 *  olasılıklıdan başlayarak):
 *      1) orijinal              (zaten çalışıyorsa dokunulmaz)
 *      2) 1.5x büyütme         (piksel sayısı yetmiyordu)
 *      3) 2.0x büyütme
 *      4) kontrast + Otsu eşik
 *      5) 1.5x büyütme + kontrast + Otsu
 *      6) ters çevirme         (koyu zemin durumu)
 *
 *  İLK TUTAN döner. Hepsi tutmazsa EN İYİ güveni döner ve neden bildirilir
 *  (sessiz başarısızlık yok — rehber kuralı).
 * ============================================================================
 */
const G = require('./gorsel.js');

/**
 * Görüntü tamponunu okunabilir biçime getirir.
 * @returns {{gri:Uint8Array, w:number, h:number}|null}
 */
function ac(tampon) {
  try {
    if (!tampon || tampon.length < 4) return null;
    // JPEG imzasi: FF D8 -> jpeg-js (plaka.js ile ayni yontem)
    if (tampon[0] === 0xff && tampon[1] === 0xd8) {
      const J = require('jpeg-js');
      const d = J.decode(tampon, { useTArray: true, formatAsRGBA: true });
      if (!d || !d.data) return null;
      const n = d.width * d.height;
      const gri = new Uint8Array(n);
      const px = d.data;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        gri[i] = ((px[j] * 299 + px[j + 1] * 587 + px[j + 2] * 114) / 1000) | 0;
      }
      return { gri: gri, w: d.width, h: d.height };
    }
    // PNG: kendi cozucumuz
    const r = G.pngCoz(tampon);
    if (!r || !r.veri) return null;
    return { gri: r.veri, w: r.genislik, h: r.yukseklik };
  } catch (e) {
    return null;
  }
}

/** Ham pikselden PNG tamponu üretir. */
function png(gri, w, h) {
  try { return G.pngKodla(G.griyiRgba(gri), w, h); } catch (e) { return null; }
}

/** Büyütme (bilgi eklemez ama motorun beklediği piksel ölçeğe getirir). */
function buyut(gri, w, h, carpan) {
  // ÖLÇÜLDÜ: olcekle() doğrudan Uint8Array döndürüyor, nesne değil.
  try { return G.olcekle(gri, w, h, Math.round(w * carpan), Math.round(h * carpan)); } catch (e) { return null; }
}

/** Kontrast + Otsu eşiği → ikili görüntü. */
function ikililestir(gri, w, h) {
  try {
    const k = G.kontrastGerme(gri, 1, 99);
    const e = G.otsuEsik(k);
    return G.medyan3(e, w, h);
  } catch (e) { return null; }
}

/** Ters çevirme. */
/**
 * Gri görüntüden dikdörtgen keser. (kirp ile aynı imza, burada bağımsız)
 */
function kirpGri(gri, w, h, x, y, kw, kh) {
  try {
    x = Math.max(0, Math.min(w - 1, Math.round(x)));
    y = Math.max(0, Math.min(h - 1, Math.round(y)));
    kw = Math.max(1, Math.min(w - x, Math.round(kw)));
    kh = Math.max(1, Math.min(h - y, Math.round(kh)));
    const o = new Uint8Array(kw * kh);
    for (let j = 0; j < kh; j++) {
      o.set(gri.subarray((y + j) * w + x, (y + j) * w + x + kw), j * kw);
    }
    return { gri: o, w: kw, h: kh };
  } catch (e) { return null; }
}

/**
 * Bölge bulucudan BAĞIMSIZ kaba tarama: örtüşmeli kutular.
 *
 * @returns {Array<{ad:string, tampon:Buffer|null}>} her kutu tam kare gibi
 *   okunmak üzere ayrı bir tampon olarak döner.
 */
function kutuTaramasi(tampon) {
  const a = ac(tampon);
  if (!a) return [];
  const gri = a.gri, w = a.w, h = a.h;
  const cik = [];
  // ON ELEME: her kutu OCR-ye GONDERILMEZ. Once kenar yogunlugu olculur
  // (~1 ms), yalnizca EN YOGUN adet kadar kutu denenir. Olculen gerekce:
  // 45 kutunun tamami OCR-ye gidiyordu ve plaka6.jpeg 10,9 sn suruyordu.
  const EN_COK = 12;
  const aday = [];
  const cx = w / 2, cy = h / 2;
  // 2 ve 3 sütun/satır: küçük plaka (2) ile büyük plaka (3) birlikte.
  const izgaralar = [[2, 2], [3, 3]];
  const ORTUSME = 0.34;   // %34 örtüşme: plaka kutudan taşmasın
  for (const [sx, sy] of izgaralar) {
    const kw = w / (sx - 1 + ORTUSME * 2);
    const kh = h / (sy - 1 + ORTUSME * 2);
    // Kutuları merkeze doğru daraltarak da dene: plaka ortada olduğunda
    // kenarlardaki kutular plakayı kesiyor.
    const olcekler = [1, 0.75, 0.55];
    for (const ol of olcekler) {
      const w2 = kw * ol, h2 = kh * ol;
      for (let iy = 0; iy < sy - 1 + 1; iy++) {
        for (let ix = 0; ix < sx - 1 + 1; ix++) {
          const x = ix * (kw - w2) + (sx > 2 ? 0 : 0);
          const y = iy * (kh - h2);
          if (x < -1 || y < -1 || x + w2 < 1 || y + h2 < 1) continue;
          const k = kirpGri(gri, w, h, x, y, w2, h2);
          if (!k) continue;
          // Çok küçük kutuyu atla (okunamaz), çok büyüğü de atla (yararı yok)
          if (k.w < 120 || k.h < 40) continue;
          // KIRP + 96 px KUCULT: kanitlanan bicim (olculdu). Tam boyutta
          // gonderilen kutular 9 fotografin hicbirinde okunmadi.
          const kb = kutuBuyut(k);
          if (!kb || kb.w < 60) continue;
          aday.push({
            yo: kenarYogunlugu(gri, w, h, x, y, k.w, k.h),
            uzak: Math.hypot(kb.w / 2 + x - cx, kb.h / 2 + y - cy),
            kb: kb,
            ad: 'kutu' + sx + 'x' + sy + '-o' + Math.round(ol * 100),
          });
        }
      }
    }
  }
  // En yogun kutular once; esit yogunlukta merkeze yakin olan once.
  aday.sort((a, b) => (b.yo - a.yo) || (a.uzak - b.uzak));
  for (let i = 0; i < aday.length && cik.length < EN_COK; i++) {
    const t = png(aday[i].kb.gri, aday[i].kb.w, aday[i].kb.h);
    if (t) cik.push({ ad: aday[i].ad, tampon: t });
  }
  return cik;
}

// Kanitlanan kirpma yuksekligi (29.09.2026): 500x369 -> 130x96 ve
// 387x284 -> 131x96 ikisi de 96 px ile DOGRU okundu.
const KUTU_YUKSEKLIK = 96;

/** Bir kutunun kenar yogunlugu (~1 ms). Bos duvar dusuk, plaka yuksek. */
function kenarYogunlugu(gri, w, h, x, y, kw, kh) {
  try {
    var toplam = 0, sayi = 0;
    var adim = Math.max(1, Math.floor(kw / 60));
    for (var j = 1; j < kh - 1; j += adim) {
      var satir = (y + j) * w + x;
      for (var i = 1; i < kw - 1; i += adim) {
        var o = satir + i;
        var gx = gri[o + 1] - gri[o - 1];
        var gy = gri[o + w] - gri[o - w];
        var m = gx < 0 ? -gx : gx;
        var n2 = gy < 0 ? -gy : gy;
        toplam += (m > n2 ? m : n2);
        sayi++;
      }
    }
    if (!sayi) return 0;
    return toplam / sayi / 255;
  } catch (e) { return 0; }
}

/** Kirpilan kutuyu KANITLANAN yukseklige (96 px) kucultur. */
function kutuBuyut(k) {
  try {
    if (!k || k.h === KUTU_YUKSEKLIK) return k;
    const ng = Math.max(16, Math.round(k.w * KUTU_YUKSEKLIK / k.h));
    return { gri: G.olcekle(k.gri, k.w, k.h, ng, KUTU_YUKSEKLIK), w: ng, h: KUTU_YUKSEKLIK };
  } catch (e) { return k; }
}

function ters(gri) {
  const o = new Uint8ClampedArray(gri.length);
  for (let i = 0; i < gri.length; i++) o[i] = 255 - gri[i];
  return o;
}

/**
 * Okunabilir varyantları hazırlar (ucuzdan pahalıya değil, olasılıklıdan
 * az olasılıklıya).
 * @returns {Array<{ad:string, tampon:Buffer|null}>}
 */
function varyantlar(tampon) {
  const cik = [{ ad: 'orijinal', tampon: tampon }];
  const a = ac(tampon);
  if (!a) return cik;              // çözülemedi: yalnızca orijinal denenir
  const { gri, w, h } = a;

  const b15 = buyut(gri, w, h, 1.5);
  if (b15) cik.push({ ad: 'buyuk1.5x', tampon: png(b15, Math.round(w * 1.5), Math.round(h * 1.5)) });

  const b20 = buyut(gri, w, h, 2);
  if (b20) cik.push({ ad: 'buyuk2x', tampon: png(b20, Math.round(w * 2), Math.round(h * 2)) });

  const ik = ikililestir(gri, w, h);
  if (ik) cik.push({ ad: 'ikili', tampon: png(ik, w, h) });

  if (b15) {
    const b15g = b15;
    const ik15 = ikililestir(b15g, Math.round(w * 1.5), Math.round(h * 1.5));
    if (ik15) cik.push({ ad: 'buyuk1.5x+ikili', tampon: png(ik15, Math.round(w * 1.5), Math.round(h * 1.5)) });
  }

  cik.push({ ad: 'ters', tampon: png(ters(gri), w, h) });

  // SON ÇARE: örtüşmeli kutu taraması (bölge bulucudan bağımsız).
  // Kullanıcının talebi: "bölge aramadan direk görsel ne ise görseldeki
  // yazıyı geniş bir şekilde görsün". Bu tarama bölge bulucunun seçimine
  // güvenmez; plaka hangi kutudaysa orası onu kadrajda görür.
  // Maliyet: yalnızca yukarıdakilerin HEPSİ başarısız olduğunda denenir.
  for (const k of kutuTaramasi(tampon)) cik.push(k);
  return cik;
}

/**
 * Motora çoklu deneme yaptırır.
 *
 * @param {object} motor  { oku(tampon, secenek): Promise<object> }
 * @param {Buffer} tampon
 * @param {object} secenek
 * @param {object} [ayar]  { enFazla: number, sureAsagi: number }
 * @returns {Promise<object>} motorun döndürdüğü sonuç + deneme bilgisi
 */
async function cokluOku(motor, tampon, secenek = {}, ayar = {}) {
  const enFazla = ayar.enFazla || 6;
  // fazla deneme yapılır. Yanlış okuma (8 -> 1 gibi) düşük güvenle gelir.
  // fazla deneme yapılır. Yanlış okuma (8 -> 1 gibi) düşük güvenle gelir.
  // ÖLÇÜM: `guveniyet` 0-100 ölçeğinde (temiz plaka 19-20, gerçek fotoğraf
  // 17.7) ve DOĞRU/yanlış okumayı ayırmıyor. Kullanılabilir sinyal
  // `guvenSeviyesi`: yesil / sari / kirmizi. "sari" = emin değil -> devam et.
  const sarikEsik = ayar.sarikEsik !== undefined ? ayar.sarikEsik : true;
  const guvenEsigi = ayar.guvenEsigi !== undefined ? ayar.guvenEsigi : 70;
  const sureAsagi = ayar.sureAsagi || 8000;      // toplam süre sınırı
  const t0 = Date.now();

  const dene = varyantlar(tampon);
  let enIyi = null;
  const denemeler = [];

  for (let i = 0; i < dene.length && i < enFazla; i++) {
    const v = dene[i];
    if (!v.tampon) { denemeler.push({ ad: v.ad, sonuc: 'atlandi' }); continue; }
    if (Date.now() - t0 > sureAsagi) {
      denemeler.push({ ad: v.ad, sonuc: 'sure-asildi' });
      break;
    }
    let r = null;
    try {
      r = await motor.oku(v.tampon, secenek);
    } catch (e) {
      denemeler.push({ ad: v.ad, sonuc: 'hata: ' + String((e && e.message) || e) });
      continue;
    }
    const basarili = !!(r && r.basarili && r.plaka);
    const guven = (r && r.guveniyet !== undefined) ? r.guveniyet : 0;
    denemeler.push({ ad: v.ad, sonuc: basarili ? ('TANI ' + r.plaka + ' [' + (r.guvenSeviyesi || '-') + ' ' + guven + ']') : 'bos' });

    if (basarili) {
      // ÖLÇÜLEN BOŞLUK: "ilk tutan" kuralı YANLIŞ okumayı da başarı sayıyordu.
      // Gerçek fotoğrafta ilk deneme 48 AZ 511 okudu (doğrusu 48 AZ 518) ve
      // deneme hiç başlamadı. Güven düşükse devam et, en iyisini seç.
      // ÖLÇÜLEN: `guvenSeviyesi` tek güvenilir sinyaldir. Sayısal
      // `guveniyet` 0-100 ölçeğinde ve DOĞRU okumada bile 19-20 çıkıyor;
      // yanlış okumada 17.7. Yani sayısal değer ayırt EDEMİYOR.
      //   yesil -> emin, dur
      //   sari  -> emin değil, daha fazla deneme
      const seviye = String(r.guvenSeviyesi || '').toLowerCase();
      const yeterli = seviye ? (seviye === 'yesil') : (guven >= guvenEsigi);
      if (yeterli) {
        r.cokluDeneme = { denenen: denemeler, sayi: denemeler.length, secim: 'ilk' };
        return r;                    // güvenli: en hızlı yol
      }
      if (!enIyi || guven > (enIyi.guveniyet || 0)) enIyi = r;
      continue;                      // daha iyisi aranıyor
    }
    if (r && (!enIyi || guven > (enIyi.guveniyet || 0))) enIyi = r;
  }

  const son = enIyi || { basarili: false, plaka: '', neden: 'okunamadi' };
  son.cokluDeneme = { denenen: denemeler, sayi: denemeler.length, secim: 'en-iyi' };
  // Kullanıcıya NE YAPMASI gerektiğini somut söyle (rehber kuralı: eylem dönük)
  if (!son.basarili) {
    son.hata = 'Plaka okunamadı. Telefonu plakaya biraz daha yaklaştırıp '
      + 'tekrar deneyin; plaka fotoğrafın en az yarısını doldurmalı.';
  }
  return son;
}

/** Testler için: kutuları saymadan dener. */
function kutular(tampon) { return kutuTaramasi(tampon).length; }

module.exports = { cokluOku, varyantlar, kutuTaramasi, kutular, kirpGri };
