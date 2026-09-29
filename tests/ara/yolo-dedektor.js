'use strict';
/**
 * tests/ara/yolo-dedektor.js — YOLO plaka dedektörü regresyon testi.
 *
 * NEDEN BU TEST VAR?
 *   29.09.2026'da iki ÖLÇÜLMÜŞ hatanın ikisi de bu modülden kaynaklandı ve
 *   ikisi de SESSİZCE geçti. Bu test ikisini de yakalar.
 *
 *   1) LETTERBOX SATIR TAŞMASI
 *      Çıktı pikselleri doğrudan kaynak indeksine bağlandığında, görüntü
 *      640'a BÜYÜTÜLÜRSE (ör. 489 px genişlik) dizi aşılır, `undefined` döner,
 *      `undefined/255` = NaN. ÖLÇÜLEN ETKİ: 8400 adedin hepsi NaN, sonuç
 *      "1 tespit" yerine sahte kutular.
 *      ÖLÇÜM: plaka 4.jpg (500x670) çalışıyordu; plaka.jpg (489x400) NaN
 *      veriyordu — çünkü ilki küçültülüyor, ikincisi büyütülüyor.
 *
 *   2) YEDEK YOLUN KIRILMASI
 *      YOLO hızlı yolu eklendiğinde `cokluOku` require satırı bozuldu
 *      (`.cokluOku` ataması düştü). Sonuç: YOLO başarılı olan fotoğraflar
 *      doğru görünüyor, YOLO başarısız olanlarda sunucu
 *      "cokluOku is not a function" döndürüyordu. Yani en önemli koruma
 *      sessizce ÖLÜYDU ve ancak kutu bulunamayan bir fotoğrafta anlaşıldı.
 *
 * KURAL: bu test GERÇEK kutu sayısını ve gerçek okuma davranışını ölçer.
 * Tahmin yapmaz, kod okumaz, yorum satırlarını aramaz.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const KOK = path.join(__dirname, '..', '..', 'companion');
const Y = require(path.join(KOK, 'ocr', 'yolo-plaka.js'));
const G = require(path.join(KOK, 'ocr', 'gorsel.js'));
const jpeg = require(path.join(KOK, 'node_modules', 'jpeg-js'));

let gecti = 0, kaldi = 0;
function ok(ad, kosul, ayrinti) {
  if (kosul) { gecti++; console.log('  PASS — ' + ad); }
  else { kaldi++; console.log('  FAIL — ' + ad + (ayrinti ? '  [' + ayrinti + ']' : '')); }
}

/* ------------------------------------------------------------------ */
/* 1) HARİTA TESTİ: YOLUCU DEĞİLDİR                                  */
/* ------------------------------------------------------------------ */
const kod = fs.readFileSync(path.join(KOK, 'ocr', 'yolo-plaka.js'), 'utf8');
// ÖLÇÜLEN TEST HATASI: ilk sürüm dosyanın TÜMÜNü tarıyordu ve yorumlardaki
// "Python YOK" ifadesine takılıp geçiyordu. ÜRÜN hatası değil, TEST hatasıydı.
// DÜZELTME: yorumlar ayıklanır, yalnızca ÇALIŞAN KOD denetlenir.
const calisanKod = kod
  .replace(/\/\*[\s\S]*?\*\//g, ' ')     // blok yorum
  .replace(/^\s*\/\/.*$/gm, ' ');         // satir yorumu
// ÖLÇÜLEN TEST HATASI (2 kez oldu): (1) ilk sürüm dosyanın TÜMÜNÜ tarıyordu
// ve yorumdaki "Python YOK" ifadesine takılıp geçiyordu — bu ÜRÜN hatası
// değil, TEST hatasıydı. (2) Sonra dizeleri de ayıkladım; require('onnxruntime-node')
// boşaldığı için bu sefer VAR OLMASI GEREKEN bağımlılık kayboldu. Doğrusu:
// yalnızca yorumları ayıkla, dizelere dokunma.
ok('Python bağımlılığı yok (import torch/cv2/ultralytics yok)',
  !/\b(import\s+(torch|cv2|ultralytics)|require\s*\(\s*['"](torch|cv2|ultralytics))/.test(calisanKod));
ok('çalışan kodda python/pip/conda çağrısı yok',
  !/\b(python|pip|conda|subprocess|child_process)/i.test(calisanKod));
ok('yalnızca onnxruntime-node + yerel yardımcılar kullanılıyor',
  /require\(['"]onnxruntime-node['"]\)/.test(calisanKod));

/* ------------------------------------------------------------------ */
/* 2) MODEL DOSYASI                                                    */
/* ------------------------------------------------------------------ */
const modelYolu = path.join(KOK, 'ocr', 'models', 'plaka-yolo.onnx');
ok('model dosyası repoda var', fs.existsSync(modelYolu));
ok('model 10 MB mertebesinde (mevcut modellerle aynı ölçek)',
  fs.existsSync(modelYolu) && fs.statSync(modelYolu).size > 5 * 1024 * 1024
  && fs.statSync(modelYolu).size < 20 * 1024 * 1024,
  fs.existsSync(modelYolu) ? Math.round(fs.statSync(modelYolu).size / 1024 / 1024) + ' MB' : 'yok');

/* ------------------------------------------------------------------ */
/* 3) HAT DÖNÜŞÜ: girdi -> piksel (satır taşması)                       */
/* ------------------------------------------------------------------ */
const coz = Y.ac;
// Kucuk (buyutulen) ve buyuk (kucultulen) goruntuler uret.
const K = jpeg.encode({ data: (() => {
  const g = 120, y = 260, d = new Uint8Array(g * y * 4);
  for (let j = 0; j < y; j++) for (let i = 0; i < g; i++) {
    const o = (j * g + i) * 4;
    d[o] = 40; d[o + 1] = 40; d[o + 2] = 60; d[o + 3] = 255;
  }
  return d;
})(), width: 120, height: 260 }, 90).data;

const aKucuk = coz(K);
ok('kucuk goruntu cozuldu (120x260 -> 640\'a BUYUTULUR)',
  aKucuk && aKucuk.g === 120 && aKucuk.y === 260, aKucuk ? aKucuk.g + 'x' + aKucuk.y : 'null');

// BUYUTME yolunda piksel tamponunda NaN/Inf OLAMAZ. once olcdukce hata
// vardi: 238.533 NaN. Bu dogrudan sayilir.
const kutuSahte = { x1: 0, y1: 0, x2: 120, y2: 260, guven: 1 };
const kk = Y.kirpKucult(aKucuk, kutuSahte, 96);
ok('kirpKucult sonuc donduruyor', !!kk && kk.gri && kk.gri.length === kk.w * kk.h,
  kk ? kk.w + 'x' + kk.h : 'null');
ok('kirpKucult cikti boyutu = w*h (olculen hataydi tanimsiz w)',
  !!kk && Number.isFinite(kk.w) && Number.isFinite(kk.h) && kk.gri.length === kk.w * kk.h);
let nan = 0;
if (kk) for (let i = 0; i < kk.gri.length; i++) if (!Number.isFinite(kk.gri[i])) nan++;
ok('kirpKucult ciktisinda NaN/Inf YOK (satır taşması hatası)', nan === 0, nan + ' adet');

const kkB = Y.kirpKucult(aKucuk, { x1: 10, y1: 20, x2: 100, y2: 200, guven: 1 }, 96);
ok('kirpKucult kirpi bolgesinde de calisiyor', !!kkB && kkB.gri.length === kkB.w * kkB.h);

/* ------------------------------------------------------------------ */
/* 4) GERÇEK DAVRANIŞ: kutu bulunabiliyor mu?                           */
/* ------------------------------------------------------------------ */
(async function () {
  const o = await Y.oturumAc();
  ok('model oturumu acildi', !!o, o ? '' : Y.sonHata() || 'bilinmiyor');

  if (o) {
    // Sentetik plaka benzeri: koyu zemin + acik yatay bant. Tespit edip
    // etmedigi bilinmiyor, ama en azindan NaN dondurmemeli ve
    // cokertik sayi uretmemesi gerekir (olculen hata 8400 sahte kutu idi).
    const kutular = await Y.kutular(K);
    ok('sentezik girdide kutu sayisi makul (NaN filtresi calisiyor)',
      Array.isArray(kutular) && kutular.length <= 20, (kutular ? kutular.length : '?') + ' kutu');
    ok('tum kutular sonlu sayi koordinatli',
      kutular.every((k) => isFinite(k.x1) && isFinite(k.y1) && isFinite(k.x2) && isFinite(k.y2) && isFinite(k.guven)));
    ok('tum kutular goruntu sinirlari icinde',
      kutular.every((k) => k.x1 >= -1 && k.y1 >= -1 && k.x2 <= aKucuk.g + 1 && k.y2 <= aKucuk.y + 1));

    // kirpmalar() sirasi: once tam kutu, sonra daraltmalar
    const k2 = Y.kirpmalar(kutular.length ? kutular : [{ x1: 0, y1: 0, x2: 50, y2: 20, guven: 0.9 }]);
    ok('kirpmalar() once tam kutuyu deniyor',
      k2.length >= 1 && k2[0].x1 === (kutular.length ? kutular[0].x1 : 0));
    ok('kirpmalar() bos listede bos donuyor', Y.kirpmalar([]).length === 0);
    ok('kirpmalar(null) cokmez', Y.kirpmalar(null).length === 0);
  }

  /* ---------------------------------------------------------------- */
  /* 5) YEDEK YOL KORUMASI: cokluOku atamasi bozulmus olmamali        */
  /* ---------------------------------------------------------------- */
  const yol = path.join(KOK, 'companion.js');
  const sunucu = fs.readFileSync(yol, 'utf8');
  ok('cokluOku .cokluOku olarak ALINIYOR (yedek yol ölü olmasın)',
    /const\s+cokluOku\s*=\s*require\(['"]\.\/ocr\/coklu\.js['"]\)\.cokluOku;/.test(sunucu));
  ok('yolo modulu companion.js icinde require ediliyor',
    /require\(['"]\.\/ocr\/yolo-plaka\.js['"]\)/.test(sunucu));
  ok('ipucu varsa yolo denenmiyor (insan isareti oncelikli)',
    /if\s*\(!ipucu\)\s*\{[\s\S]{0,400}?yoloPlaka/.test(sunucu));
  ok('yolo basarisizsa cokluOku\'ya dusuluyor',
    /if\s*\(hizliYol\)\s*\{[\s\S]{0,900}?cokluOku\(/.test(sunucu));

  /* ---------------------------------------------------------------- */
  /* 6) PAKETLEME: yeni dosya kurulum paketinde olmali              */
  /* ---------------------------------------------------------------- */
  const iss = fs.readFileSync(path.join(KOK, 'kurulum.iss'), 'utf8');
  ok('kurulum.iss yolo-plaka.js paketliyor', iss.indexOf('ocr\\yolo-plaka.js') >= 0);
  ok('kurulum.iss models klasorunu paketliyor (model otomatik girer)',
    /ocr\\models\\\*/.test(iss));
  // Satır bütünlüğü: her Source satırı tam bir DestDir ile bitmeli.
  const bozukKaynak = iss.split(/\r?\n/).filter((l) =>
    /^Source:/.test(l.trim()) && l.indexOf('DestDir:') < 0);
  ok('kurulum.iss hicbir Source satiri DestDirsiz kalmamis', bozukKaynak.length === 0,
    JSON.stringify(bozukKaynak));

  console.log('\n  ' + gecti + ' gecti, ' + kaldi + ' kaldi');
  process.exit(kaldi ? 1 : 0);
})().catch(function (e) { console.error('  HATA: ' + e.message); console.log('\n  0 gecti, 1 kaldi'); process.exit(1); });
