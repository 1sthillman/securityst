'use strict';
// ============================================================================
//  SAHNE ÜRETECİ — plaka testlerini gerçek dünyaya yaklaştırır
// ----------------------------------------------------------------------------
//  Neden gerekli?
//  İlk plaka fikstürleri "temiz, dolgu plaka görüntüsüydü" (520x130, kırpılmış).
//  Gerçekte telefon kamerası 1280x720'lik bir SAHNE çeker, kullanıcının
//  kırpma dikdörtgeni uygulanır ve gönderilen görüntü:
//     * çok küçük olabilir (plaka karenin %5'i)
//     * düşük kontrastlı olabilir (gölge, ters ışık, gece)
//     * eğik olabilir
//     * gürültülü olabilir (ISO, jpeg artefaktı)
//     * plaka bazen kadrajın DIŞINDA kalabilir
//
//  Bu modül, telefonun gönderdiği bu tür kareleri üretir. Testler bunları
//  sunucuya POST edip "plaka okundu mu" diye sorar. Ölçüm, 10 KB'lık
//  "düz" karelerin sistemin metinVarMi() filtresinde elendiği gerçek hatayı
//  yakalamak için yapıldı.
// ============================================================================

const G = require('../../companion/ocr/gorsel.js');
const fs = require('fs');
const path = require('path');

// Deterministik rastgelelik: testler tekrarlanabilir olmalı.
function tohumla(tohum) {
  let s = tohum >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Gri tonlamalı bir sahne oluşturur (zemin gradyanı + gürültü + nesneler). */
function sahne(g, y, secenek) {
  const rnd = tohumla(secenek.tohum || 1);
  const px = new Uint8ClampedArray(g * y);
  const zemin = secenek.zemin === undefined ? 118 : secenek.zemin;
  const koyu = secenek.koyuZemin === undefined ? 26 : secenek.koyuZemin;

  // Dikey gradyan (gökyüzü -> zemin)
  for (let j = 0; j < y; j++) {
    const t = j / Math.max(1, y - 1);
    for (let i = 0; i < g; i++) {
      px[j * g + i] = zemin + (koyu - zemin) * t;
    }
  }

  // Metin dışı gürültü: birkaç yatay çizgi (boru, kenar, gölge)
  const cizgiSayisi = secenek.cizgi === undefined ? 5 : secenek.cizgi;
  for (let n = 0; n < cizgiSayisi; n++) {
    const yy = Math.floor(rnd() * y);
    const kalinlik = 2 + Math.floor(rnd() * 26);
    const deger = koyu + rnd() * 40;
    for (let j = yy; j < Math.min(y, yy + kalinlik); j++) {
      for (let i = 0; i < g; i++) px[j * g + i] = deger;
    }
  }

  // Sensör gürültüsü
  const gurultu = secenek.gurultu === undefined ? 6 : secenek.gurultu;
  if (gurultu > 0) {
    for (let i = 0; i < px.length; i++) {
      px[i] = Math.max(0, Math.min(255, px[i] + (rnd() - 0.5) * 2 * gurultu));
    }
  }
  return px;
}

/**
 * Plaka fikstürünü sahneye yerleştirir.
 * @param {Uint8ClampedArray} sahnePx  sahne pikselleri (gri)
 * @param {object} fikstur  { veri: RGBA, genislik, yukseklik } (plaka PNG'si)
 * @param {object} yer      { x, y, genislik, yukseklik }
 * @param {object} secenek  { karartma, egimDeg, esik }  (ışık/ geometri bozulması)
 */
function plakaYerlestir(sahnePx, g, y, fikstur, yer, secenek = {}) {
  const egim = secenek.egimDeg || 0;
  const karartma = secenek.karartma === undefined ? 1 : secenek.karartma;
  const rad = (egim * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);

  // Dönüşüm merkezi: hedef alanın merkezi (sahne koordinatında)
  const cx = yer.x + yer.genislik / 2;
  const cy = yer.y + yer.yukseklik / 2;

  // ÖLÇEK: hedef alanın her pikseli, fikstürün kaç pikseline karşılık gelir?
  // DİKKAT — bu faktör olmadan plaka küçültülürken yalnızca fikstürün ORTASINDAKİ
  // bant örneklenir (ölçüldü: 520x130 fikstür 146x36 yapılınca yalnızca "ABC"
  // çiziliyordu, "34" ve "123" kayboluyordu). Bu, üreticinin en sinsi hatasıydı.
  const olcekX = yer.genislik / fikstur.genislik;
  const olcekY = yer.yukseklik / fikstur.yukseklik;

  for (let j = 0; j < yer.yukseklik; j++) {
    for (let i = 0; i < yer.genislik; i++) {
      const dx = i - yer.genislik / 2;
      const dy = j - yer.yukseklik / 2;
      // Dönüş (eğim) — hedef-uzayda
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      // Dönüşümü tersine alıp fikstür koordinatına ÖLÇEKLE
      const sx = Math.floor((rx + yer.genislik / 2) / olcekX);
      const sy = Math.floor((ry + yer.yukseklik / 2) / olcekY);
      if (sx < 0 || sx >= fikstur.genislik || sy < 0 || sy >= fikstur.yukseklik) continue;
      const k = (sy * fikstur.genislik + sx) * 4;
      // Plaka gri tonu (luma)
      let v = (fikstur.veri[k] * 77 + fikstur.veri[k + 1] * 150 + fikstur.veri[k + 2] * 29) >> 8;
      v = v * karartma;
      const tx = Math.round(cx + dx);
      const ty = Math.round(cy + dy);
      if (tx < 0 || tx >= g || ty < 0 || ty >= y) continue;
      sahnePx[ty * g + tx] = Math.max(0, Math.min(255, v));
    }
  }
}

/**
 * Kamera karesi üretir.
 *
 * İki kiBi vardır ve İKİSİ DE test edilmelidir:
 *
 *  - `tam`: 1280x720'lik kameranın TAM karesi. Telefon artık bunu
 *    gönderiyor (sunucu bölge bulucu devrede). Bu asıl senaryodur.
 *  - `kirp`: kullanıcının kırpma dikdörtgeni. Plaka bu bantta kalıyorsa
 *    okunur; kesiliyorsa okunamaz — sistem bunu dürüstçe bildirmelidir.
 *
 * @returns {{ gorsel: Buffer, kirp: {x,y,g,y2}, sahneBoyut:{g,y}, plaka:{x,y,g,y2}, tamMi:boolean }}
 */
function kareUret(fiksturYolu, secenek = {}) {
  const ham = fs.readFileSync(fiksturYolu);
  const f = G.pngCoz(ham);

  const G0 = secenek.sahneG || 1280;
  const Y0 = secenek.sahneY || 720;
  const px = sahne(G0, Y0, {
    tohum: secenek.tohum,
    zemin: secenek.zemin,
    koyuZemin: secenek.koyuZemin,
    gurultu: secenek.gurultu,
    cizgi: secenek.cizgi,
  });

  // Plakayı sahneye koy — "plakasiz" seçeneğiyle HİÇ konmaz.
  //
  // Neden şart? Yanlış-kabul oranı (plaka yokken sistem "plaka var" derse)
  // güvenlik açısından en kritik metriktir. Ölçebilmek için gerçekten plakasız
  // kare gerekir. Daha önce her kareye plaka konuyordu; "plakasız" etiketi
  // yanlış güven veriyordu ve model karşılaştırmasının son satırları
  // anlamsızlaşıyordu.
  const plakasiz = !!secenek.plakasiz;
  const olcek = secenek.olcek === undefined ? 0.28 : secenek.olcek;
  const pgW = Math.round(f.genislik * olcek);
  const pgH = Math.round(f.yukseklik * olcek);
  const px0 = secenek.plakaX === undefined
    ? Math.round(G0 * 0.5 - pgW / 2)
    : Math.round(secenek.plakaX);
  const py0 = secenek.plakaY === undefined
    ? Math.round(Y0 * 0.55 - pgH / 2)
    : Math.round(secenek.plakaY);
  if (!plakasiz) {
    plakaYerlestir(px, G0, Y0, f,
      { x: px0, y: py0, genislik: pgW, yukseklik: pgH },
      { egimDeg: secenek.egim, karartma: secenek.karartma });
  }

  // BOGUCU PLAKALAR (birden çok araç).
  //
  // Neden var? Kullanıcının gerçek telefonundan gelen tanı şuydu:
  //     bolge=8  ->  ham okuma: "TR | TR | TR | TR"   (mavi TR şeritleri!)
  // Yani sahnede birden çok plaka varken bölge bulucu hepsini aday sayıyor
  // ve HİÇBİRİNİ seçemiyordu. Bu seçenek tam olarak o sahneyi üretir.
  // Kullanıcının kırpma ipucu olmadan ve onunla ayrımı test edilir.
  const bogucular = [];
  for (let i = 0; i < (plakasiz ? 0 : (secenek.bogucu || 0)); i++) {
    // Deterministik, birbirinden uzak konumlar (sahne kadrajı)
    const bx = Math.round(G0 * (0.06 + 0.26 * i));
    const by = Math.round(Y0 * (0.12 + 0.30 * (i % 3)));
    const bOlcek = olcek * 0.85;
    const bW = Math.round(f.genislik * bOlcek);
    const bH = Math.round(f.yukseklik * bOlcek);
    if (bx + bW >= G0 || by + bH >= Y0) continue;
    plakaYerlestir(px, G0, Y0, f,
      { x: bx, y: by, genislik: bW, yukseklik: bH },
      { egimDeg: 0, karartma: secenek.bogucuKarartma || 0 });
    bogucular.push({ x: bx, y: by, g: bW, y2: bH });
  }

  // --- hangi görüntü üretilecek? ---
  let kirp;
  let tamMi = secenek.tam !== false;
  if (secenek.kirp) {
    kirp = secenek.kirp;
    tamMi = false;
  } else if (tamMi) {
    kirp = { x: 0, y: 0, g: G0, y2: Y0 };            // TAM KARE
  } else {
    // Telefonun varsayılan kırpma bandı: orta-alt yatay bant
    const bantH = Math.round(Y0 * 0.30);
    const bantY = Math.round(Y0 * 0.42);
    kirp = { x: 0, y: bantY, g: G0, y2: bantH };
  }

  // Gönderilen çözünürlük: tam kare 1280, kırpma 640 (telefonun davranışı)
  const hedefG = tamMi ? Math.min(1280, G0) : 640;
  const k = hedefG / kirp.g;
  const outG = Math.max(1, Math.round(kirp.g * k));
  const outY = Math.max(1, Math.round(kirp.y2 * k));
  const out = new Uint8ClampedArray(outG * outY);
  for (let j = 0; j < outY; j++) {
    for (let i = 0; i < outG; i++) {
      const sxi = Math.min(G0 - 1, Math.max(0, Math.floor(kirp.x + i / k)));
      const syi = Math.min(Y0 - 1, Math.max(0, Math.floor(kirp.y + j / k)));
      out[j * outG + i] = px[syi * G0 + sxi];
    }
  }

  const rgba = new Uint8ClampedArray(outG * outY * 4);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    rgba[i] = rgba[i + 1] = rgba[i + 2] = out[p];
    rgba[i + 3] = 255;
  }

  // Plaka kırpma bandının İÇİNDE mi?
  const tamGorunur = px0 >= kirp.x && py0 >= kirp.y &&
    px0 + pgW <= kirp.x + kirp.g && py0 + pgH <= kirp.y + kirp.y2;

  return {
    gorsel: G.pngKodla(rgba, outG, outY),
    kirp: { ...kirp, g: outG, y2: outY },
    sahneBoyut: { g: G0, y: Y0 },
    plaka: { x: px0, y: py0, g: pgW, y2: pgH },
    bogucular,
    tamMi,
    plakasiz,
    plakaGorunur: plakasiz ? false : tamGorunur,
  };
}

module.exports = { kareUret, sahne, plakaYerlestir, tohumla };

if (require.main === module) {
  // Görsel denetim: üretilen kareleri diske yaz
  const cikti = process.argv[2] || path.join(__dirname, '..', 'fixtures', 'sahne');
  fs.mkdirSync(cikti, { recursive: true });
  const fikstur = path.join(__dirname, '..', 'fixtures', 'plaka-temiz.png');
  const senaryolar = [
    ['sahne-normal', {}],
    ['sahne-kucuk', { olcek: 0.12 }],
    ['sahne-karanlik', { karartma: 0.35, zemin: 40, koyuZemin: 12 }],
    ['sahne-gurultulu', { gurultu: 22 }],
    ['sahne-eik', { egim: -9 }],
  ];
  for (const [ad, sec] of senaryolar) {
    const k = kareUret(fikstur, sec);
    const p = path.join(cikti, ad + '.png');
    fs.writeFileSync(p, k.gorsel);
    console.log(`${ad}: ${k.kirp.g}x${k.kirp.y2} plaka ${k.plaka.g}x${k.plaka.y2} @(${k.plaka.x},${k.plaka.y}) -> ${p}`);
  }
}
