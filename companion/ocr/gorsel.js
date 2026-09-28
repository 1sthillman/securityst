'use strict';
// ============================================================================
//  Görüntü yardımcıları — saf JavaScript, hiçbir yerel bağımlılık yok
// ----------------------------------------------------------------------------
//  Neden var? Plaka okuma hattının her bilgisayarda, her işletim sisteminde
//  çalışabilmesi için. Python, OpenCV, C++ derleyicisi ya da hazır bir .exe
//  kurmak gerekmez. Yalnızca Node'in kendi kütüphanesi + saf JS paketleri.
//
//  Bu dosya:
//    * PNG çözer (phone.js bağımlılığı, ~60 KB, saf JS)
//    * PNG kodlar (test görüntüsü üretmek ve hata ayıklamak için)
//    * BMP kodlar (tesseract.js'in beklediği, piksel başına 4 bayt düz format)
//    * Gri tonlama, kontrast germe, Otsu eşikleme, Sauvola yerel eşikleme,
//      3x3 medyan filtre, morfoloji ve yeniden ölçekleme yapar
//
//  Tüm renk çalışmaları tek bir gri tonlama kanalında (luma) yapılır; plaka
//  okumada renk bilgisi işe yaramaz ve gri taramak işi 3 kat hızlandırır.
// ============================================================================

const zlib = require('zlib');
const { PNG } = require('pngjs');

/** RGBA tamponundan gri tonlama (luma) kanalı üretir. */
function griTaraf(rgba, genislik, yukseklik) {
  const n = genislik * yukseklik;
  const g = new Uint8ClampedArray(n);
  for (let i = 0, p = 0; p < n; p++, i += 4) {
    // Rec.601 luma — plaka okumada algısal olarak en iyi ayrımı verir.
    g[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return g;
}

/** Gri tamponu Uint8ClampedArray'e çevirir (BMP kodlama için). */
function griyiRgba( gri) {
  const n = gri.length;
  const out = new Uint8ClampedArray(n * 4);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    out[i] = out[i + 1] = out[i + 2] = gri[p];
    out[i + 3] = 255;
  }
  return out;
}

/** Histogram (0..255). */
function histogram(gri) {
  const h = new Uint32Array(256);
  for (let i = 0; i < gri.length; i++) h[gri[i]]++;
  return h;
}

/**
 * Yüzde dayalı kontrast germe.
 * Karanlık gölgeli plakaları açar, güneş alanını koyulaştırır — OCR'ın
 * asıl düşmanı "eşik değerini tutturamamak"tır. Histogramı iki yüzdeye
 * germek, her ışık koşulunda otomatik çalışır.
 */
function kontrastGerme(gri, altYuzde = 2, ustYuzde = 2) {
  const h = histogram(gri);
  const n = gri.length;
  let altSinir = 0, ustSinir = 255, toplam = 0;
  for (let v = 0; v < 256; v++) { toplam += h[v]; if (toplam >= n * (altYuzde / 100)) { altSinir = v; break; } }
  toplam = 0;
  for (let v = 255; v >= 0; v--) { toplam += h[v]; if (toplam >= n * (ustYuzde / 100)) { ustSinir = v; break; } }
  if (ustSinir <= altSinir) return { veri: gri, alt: 0, ust: 255 };

  const aralik = ustSinir - altSinir;
  const cikti = new Uint8ClampedArray(gri.length);
  for (let i = 0; i < gri.length; i++) {
    const v = ((gri[i] - altSinir) * 255) / aralik;
    cikti[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return { veri: cikti, alt: altSinir, ust: ustSinir };
}

/** Otsu eşiği — histogramdaki iki sınıfı en iyi ayıran değer. */
function otsuEsik(gri) {
  const h = histogram(gri);
  const toplam = gri.length;
  let toplamPiksel = 0, toplamAgirlik = 0;
  for (let t = 0; t < 256; t++) { toplamPiksel += t * h[t]; toplamAgirlik += h[t]; }
  if (toplamAgirlik === 0) return 128;

  let wB = 0, sumB = 0, enIyi = 0, enIyiVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += h[t];
    if (wB === 0) continue;
    const wF = toplamAgirlik - wB;
    if (wF === 0) break;
    sumB += t * h[t];
    const mB = sumB / wB;
    const mF = (toplamPiksel - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > enIyi) { enIyi = between; enIyiVar = t; }
  }
  return enIyiVar === -1 ? 128 : enIyiVar;
}

/**
 * Sauvola yerel (adaptif) eşikleme.
 * Ön plaka karanlık zemin üzerinde beyaz harf olduğu için ters çeviri
 * seçeneği sunar. Gölgeli/grimli plakalarda global eşikten çok daha iyi.
 */
function sauvolaEsik(gri, genislik, yukseklik, kare = 0.34, R = 128, p = 0.20) {
  const n = genislik * yukseklik;
  const out = new Uint8ClampedArray(n);
  // Kutu genişletilmiş integral görüntüsü -> her piksel için O(1) ortalama/varyans
  const W = genislik + 1;
  const I = new Float64Array(W * (yukseklik + 1));
  const I2 = new Float64Array(W * (yukseklik + 1));
  for (let y = 0; y < yukseklik; y++) {
    let satirToplam = 0, satirToplam2 = 0;
    for (let x = 0; x < genislik; x++) {
      const v = gri[y * genislik + x];
      satirToplam += v; satirToplam2 += v * v;
      I[(y + 1) * W + (x + 1)] = I[y * W + (x + 1)] + satirToplam;
      I2[(y + 1) * W + (x + 1)] = I2[y * W + (x + 1)] + satirToplam2;
    }
  }
  const yaricap = Math.max(8, Math.round(Math.min(genislik, yukseklik) * kare));
  const dinamik = R * (1 - (1 / Math.sqrt(R)));
  for (let y = 0; y < yukseklik; y++) {
    const y0 = Math.max(0, y - yaricap), y1 = Math.min(yukseklik - 1, y + yaricap);
    for (let x = 0; x < genislik; x++) {
      const x0 = Math.max(0, x - yaricap), x1 = Math.min(genislik - 1, x + yaricap);
      const alan = (x1 - x0 + 1) * (y1 - y0 + 1);
      const toplam = I[(y1 + 1) * W + (x1 + 1)] - I[y0 * W + (x1 + 1)] - I[(y1 + 1) * W + x0] + I[y0 * W + x0];
      const toplam2 = I2[(y1 + 1) * W + (x1 + 1)] - I2[y0 * W + (x1 + 1)] - I2[(y1 + 1) * W + x0] + I2[y0 * W + x0];
      const ortalama = toplam / alan;
      const varyans = Math.max(0, toplam2 / alan - ortalama * ortalama);
      const std = Math.sqrt(varyans);
      // Sauvola: T = m * (1 + k * (std/R - 1)), k = p
      const T = ortalama * (1 + p * (std / dinamik - 1));
      out[y * genislik + x] = gri[y * genislik + x] > T ? 255 : 0;
    }
  }
  return out;
}

/**
 * 3x3 medyan filtre — nokta gürültüsünü siler, kenarları korur.
 *
 * DİKKAT: tampon MUTLAKA Uint8Array olmalı. Daha önce Int8Array kullanılıyordu
 * ve 255 değeri -1'e sarıldığı için medyan daima 0 (siyah) çıkıyor,
 * görüntü tamamen siyaha dönüyordu.
 */
function medyan3(bin, genislik, yukseklik) {
  const n = genislik * yukseklik;
  const out = new Uint8ClampedArray(n);
  const p = new Uint8Array(9);
  const siral = new Array(9);
  for (let y = 0; y < yukseklik; y++) {
    for (let x = 0; x < genislik; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= yukseklik) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= genislik) continue;
          p[k++] = bin[yy * genislik + xx];
        }
      }
      for (let i = 0; i < k; i++) siral[i] = p[i];
      siral.length = k;
      siral.sort((a, b) => a - b);
      out[y * genislik + x] = siral[k >> 1];
    }
  }
  return out;
}

/**
 * İkili görüntü üzerinde morfoloji (3x3 komşuluk, iki geçiş: yatay + dikey).
 *
 *   erode=true  → AÇMA (opening): beyaz noktaları siler, ince gürültüyü
 *                 yok eder ama ince detayları da kısar.
 *   erode=false → KAPAMA (closing): siyah noktaları doldurur, yazı
 *                 karakterlerindeki kopuklukları birleştirir. OCR için
 *                 genellikle bu yararlıdır.
 *
 * DİKKAT: "genişletme" adı yanıltıcıydı — AÇMA beyazları küçültür,
 * KAPAMA büyütür. Parametre adı `erode` olarak düzeltildi.
 */
function morfoloji(bin, genislik, yukseklik, tur, erode) {
  const n = genislik * yukseklik;
  let src = bin;
  let dst = new Uint8ClampedArray(n);
  const birlestir = (a, b, c) => (erode
    ? ((a && b && c) ? 255 : 0)      // AÇMA: üçü de beyazsa beyaz kalsın
    : ((a || b || c) ? 255 : 0));    // KAPAMA: biri beyazsa beyaz olsun

  for (let t = 0; t < tur; t++) {
    for (let y = 0; y < yukseklik; y++) {
      for (let x = 0; x < genislik; x++) {
        dst[y * genislik + x] = birlestir(
          src[y * genislik + Math.max(0, x - 1)],
          src[y * genislik + x],
          src[y * genislik + Math.min(genislik - 1, x + 1)]
        );
      }
    }
    src = dst; dst = new Uint8ClampedArray(n);
    for (let y = 0; y < yukseklik; y++) {
      for (let x = 0; x < genislik; x++) {
        dst[y * genislik + x] = birlestir(
          src[Math.max(0, y - 1) * genislik + x],
          src[y * genislik + x],
          src[Math.min(yukseklik - 1, y + 1) * genislik + x]
        );
      }
    }
    src = dst; dst = new Uint8ClampedArray(n);
  }
  return src;
}

/**
 * Yeniden ölçekleme (bilineer). Tesseract küçük metinlerde zayıftır;
 * plaka kırpımını en az 3x büyütmek doğruluğu ciddi biçimde artırır.
 */
function olcekle(gri, genislik, yukseklik, yeniG, yeniY) {
  const out = new Uint8ClampedArray(yeniG * yeniY);
  const sx = genislik / yeniG, sy = yukseklik / yeniY;
  for (let y = 0; y < yeniY; y++) {
    const fy = Math.min(yukseklik - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(yukseklik - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < yeniG; x++) {
      const fx = Math.min(genislik - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(genislik - 1, x0 + 1), tx = fx - x0;
      const a = gri[y0 * genislik + x0], b = gri[y0 * genislik + x1];
      const c = gri[y1 * genislik + x0], d = gri[y1 * genislik + x1];
      out[y * yeniG + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

/**
 * Kenar boşluğunu kırp.
 *
 * DİKKAT — eski sürüm "piksel 128'den koyu mu" diye bakıyordu. Bu, kırpılmış
 * plaka görüntülerinde doğruydu ama SAHNE görüntülerinde felaketti: bir
 * bulutlu gökyüzünün gri tonu (118) 128'den koyudur, dolayısıyla kırpma
 * kenarları "dolu" sayıyor ve hiçbir şeyi kırpmıyordu. Sonuç: Tesseract'ın
 * gördüğü görüntüde plakanın çevresinde gürültü kalıyordu ve okuma çöküyordu
 * (ölçüm: 94x23'lük plakada 12 saniye sonra bile sonuç yok).
 *
 * Artık MUTLAK seviye değil KONTRAST ölçülüyor: kenar şeridi, içindeki
 * piksellerin çoğu kendi ortalamasından uzak değilse boş sayılır. Bu hem
 * açık plakayı hem de karanlık sahneyi doğru tanır.
 *
 * @param {number} esik yüzde (varsayılan 14) — "dolu" sayılan asgari oran
 */
function kirp(bin, genislik, yukseklik, esik = 14) {
  let ust = 0, alt = yukseklik - 1, sol = 0, sag = genislik - 1;

  /** Bir şerit yeterince "dolu" mu? (kontrasta göre) */
  const kenarBos = (x0, y0, x1, y1) => {
    const n = (x1 - x0) * (y1 - y0);
    if (n <= 0) return true;
    let toplam = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) toplam += bin[y * genislik + x];
    }
    const ortalama = toplam / n;
    // Ortalamadan 22 pikselden fazla sapma = gerçek içerik
    let sapma = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const f = bin[y * genislik + x] - ortalama;
        if (f > 22 || f < -22) sapma++;
      }
    }
    return (sapma * 100) / n < esik;
  };

  // En fazla sınırın yarısı kadar kırp: görüntünün kendisi düzse abartılı
  // kırpma yapıp her şeyi atmayalım.
  const enFazlaUst = Math.max(0, yukseklik >> 1);
  const enFazlaSol = Math.max(0, genislik >> 2);
  let sayac = 0;
  while (ust < alt && sayac < enFazlaUst && kenarBos(0, ust, genislik, ust + 2)) { ust++; sayac++; }
  sayac = 0;
  while (alt > ust && sayac < enFazlaUst && kenarBos(0, alt - 1, genislik, alt + 1)) { alt--; sayac++; }
  sayac = 0;
  while (sol < sag && sayac < enFazlaSol && kenarBos(sol, ust, sol + 2, alt + 1)) { sol++; sayac++; }
  sayac = 0;
  while (sag > sol && sayac < enFazlaSol && kenarBos(sag - 1, ust, sag + 1, alt + 1)) { sag--; sayac++; }

  if (sag <= sol || alt <= ust) return null;
  return { x: sol, y: ust, g: sag - sol + 1, y2: alt - ust + 1 };
}

/** PNG kodla (tesseract.js'e vermek için). */
function pngKodla(rgba, genislik, yukseklik) {
  const gerekli = genislik * yukseklik * 4;
  if (!rgba || rgba.length < gerekli) {
    // Sessizce bozuk görüntü üretmektense açıkça hata ver: hatayı yerinde
    // yakalamak, tonlama hattının neden bozulduğunu anlamaktan kolaydır.
    throw new Error(`piksel tamponu yetersiz: ${rgba ? rgba.length : 0} bayt, ${gerekli} gerekiyor (${genislik}x${yukseklik})`);
  }
  return PNG.sync.write({
    data: Buffer.from(rgba.buffer, rgba.byteOffset, gerekli),
    width: genislik,
    height: yukseklik,
  });
}

/** PNG çöz. */
function pngCoz(buffer) {
  const p = PNG.sync.read(buffer);
  return { veri: p.data, genislik: p.width, yukseklik: p.height };
}

/** BMP kodla (tesseract.js'in beklediği 24-bit biçim). */
function bmpKodla(bin, genislik, yukseklik) {
  const satir = (genislik * 3 + 3) & ~3;              // 4 bayta hizala
  const veriBoyutu = satir * yukseklik;
  const dosyaBoyutu = 54 + veriBoyutu;
  const buf = Buffer.alloc(dosyaBoyutu);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(dosyaBoyutu, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);                        // BITMAPINFOHEADER
  buf.writeInt32LE(genislik, 18);
  buf.writeInt32LE(yukseklik, 22);                   // pozitif = aşağıdan yukarı
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(veriBoyutu, 34);
  for (let y = 0; y < yukseklik; y++) {
    let o = 54 + (yukseklik - 1 - y) * satir;
    for (let x = 0; x < genislik; x++) {
      const v = bin[y * genislik + x];
      buf[o++] = v; buf[o++] = v; buf[o++] = v;      // BMP sırası B,G,R
    }
  }
  return buf;
}

/**
 * Ayırılabilir (separable) kutu bulanıklığı — Gauss'a yakın, O(n).
 *
 * Neden var? Plaka bölgesi bulmada gradyandan ÖNCE uygulanır. Sensör
 * gürültüsü (ISO, JPEG artefaktı) gradyan haritasını tarayarak hem sahte
 * kenar üretir hem de uyarlanabilir eşiği yükseltir; sonuçta 18 piksel
 * yüksekliğindeki gerçek plaka metni SİLİNİR. Ölçüldü: bulanıklık öncesi
 * sahne karesinde metin hiç görünmüyordu, sonrasında net görünüyor.
 * Üç geçiş kutu bulanıklığı Gauss'a çok yakın sonuç verir.
 */
function bulaniklastir(gri, g, y, yaricap = 1) {
  if (yaricap < 1) return gri;
  const n = g * y;
  const gecici = new Float64Array(n);
  const ikiy = 2 * yaricap + 1;
  for (let j = 0; j < y; j++) {
    const satir = j * g;
    let toplam = 0;
    for (let d = -yaricap; d <= yaricap; d++) {
      toplam += gri[satir + Math.min(g - 1, Math.max(0, d))];
    }
    for (let i = 0; i < g; i++) {
      gecici[satir + i] = toplam / ikiy;
      const cikis = Math.min(g - 1, Math.max(0, i - yaricap));
      const giris = Math.min(g - 1, Math.max(0, i + yaricap + 1));
      toplam += gri[satir + giris] - gri[satir + cikis];
    }
  }
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < g; i++) {
    let toplam = 0;
    for (let d = -yaricap; d <= yaricap; d++) {
      toplam += gecici[Math.min(y - 1, Math.max(0, d)) * g + i];
    }
    for (let j = 0; j < y; j++) {
      out[j * g + i] = Math.round(toplam / ikiy);
      const cikis = Math.min(y - 1, Math.max(0, j - yaricap));
      const giris = Math.min(y - 1, Math.max(0, j + yaricap + 1));
      toplam += gecici[giris * g + i] - gecici[cikis * g + i];
    }
  }
  return out;
}

module.exports = {
  griTaraf, griyiRgba, histogram, kontrastGerme, otsuEsik, sauvolaEsik,
  medyan3, bulaniklastir, morfoloji, olcekle, kirp, pngKodla, pngCoz, bmpKodla,
};
