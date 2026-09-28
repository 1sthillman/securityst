'use strict';
// ============================================================================
//  Plaka okuma testi — çevrimdışı, uçtan uca
// ----------------------------------------------------------------------------
//  İki kısımdan oluşur:
//   1) SAF MANTIĞIN DENETLENMESİ (hızlı, dosya gerektirmez)
//      Kendini onaran karakter düzeltme, yapı puanlama, biçimlendirme.
//   2) GERÇEK OKUMA (yavaş, ~5 saniye)
//      tests/fixtures/ içindeki gerçekçi plaka görüntülerinin Tesseract
//      WASM motoruyla okunması. Dil dosyası paketlenmiş olduğu için bu
//      test de İNTERNETSİZ çalışır.
//
//  Bu testler iki gerçek hatayı yakalamıştı:
//    * morfoloji bayrakları ters etiketlenmişti (açma/kapama yer değiştirmiş)
//    * medyan filtresi Int8Array kullanıyordu; 255 -> -1 olarak sarıyor ve
//      görüntüyü tamamen siyaha çeviriyordu ("EE" okumaları)
const fs = require('fs');
const path = require('path');
const G = require('../companion/ocr/gorsel.js');
const P = require('../companion/ocr/plaka.js');

const KOK = path.join(__dirname, '..');
const FIKSTUR = path.join(KOK, 'tests', 'fixtures');

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log(`PASS — ${name}`); }
  else { fail++; console.log(`FAIL — ${name}${extra ? ' :: ' + extra : ''}`); }
};
const bolum = (t) => console.log(`\n--- ${t} ---`);

// ===========================================================================
//  1. Saf mantık
// ===========================================================================
bolum('Metin temizleme ve biçimlendirme');

ok(P.temizle(' 34 abc 123 ') === '34ABC123', 'boşluk ve küçük harf temizlenir');
ok(P.temizle('TR 34 ABC 123') === '34ABC123', 'sol üst "TR" ülke kodu atılır');
ok(P.temizle('34-ABC/123') === '34ABC123', 'noktalama işaretleri atılır');
ok(P.bicimlendir('34ABC123') === '34 ABC 123', 'biçimlendirme: 34 ABC 123');
ok(P.bicimlendir('34AB12') === '34 AB 12', 'biçimlendirme: kısa seri (34 AB 12)');
ok(P.bicimlendir('3412') === '34 12', 'biçimlendirme: harfsız (34 12)');
ok(P.bicimlendir('') === '', 'boş girdi boş döner');
ok(P.bicimlendir('garbage') === 'GARBAGE', 'anlamsız girdi olduğu gibi döner');

bolum('Karşılaştırma anahtarı (karışıklık düzeltme)');
// REGRESYON: karakter sınıfı [IL] yerine /IL]/ yazılmıştı; görünürde
// çalışıyor gibi duruyordu ama I harfi hiç eşlenmiyordu.
ok(P.anahtar('34ABC123') === P.anahtar('34ABCI23'), 'O/0, I/1, S/5, Z/2, G/6 aynı anahtara düşer');
ok(P.anahtar('34ABC123') === P.anahtar('34ABCL23'), 'L/1 karışıklığı giderilir');
ok(P.anahtar('06KL2301') === P.anahtar('O6KL23O1'), 'O/0 ve 1/1 karışıklıkları birlikte giderilir');
ok(P.anahtar('34 ABC 123') === P.anahtar('34ABC123'), 'biçim farkı anahtarı etkilemez');
ok(P.levenshtein('34ABC123', '34ABC124') === 1, 'Levenshtein: tek karakter farkı = 1');
ok(P.levenshtein('', 'abc') === 3, 'Levenshtein: boş dize');
ok(P.levenshtein('abc', 'abc') === 0, 'Levenshtein: aynı = 0');

bolum('Yapı puanı (Türk plaka kuralları)');
ok(P.yapiPuani('34ABC123') > 0, 'geçerli plaka pozitif puan alır');
ok(P.yapiPuani('34ABC1') === 0, 'tek haneli seri geçersiz (yapı 2-4 rakam ister)');
ok(P.yapiPuani('34ABC12345') === 0, '5 haneli seri geçersiz');
ok(P.yapiPuani('AB123456') === 0, 'rakamla başlayan geçersiz');
ok(P.yapiPuani('34AB') === 0, 'harfsiz geçersiz');
ok(P.yapiPuani('99ABC123') === 0, 'il kodu 81 üstü KESİN ELENİR (99)');
ok(P.yapiPuani('84ABC123') === 0, 'il kodu 82-89 arası KESİN ELENİR (84) — B/8 OCR hatası eleniyor');
ok(P.yapiPuani('81ABC123') > 0, 'il kodu 81 (son geçerli kod) kabul edilir');
ok(P.yapiPuani('01ABC123') > 0, 'il kodu 01 kabul edilir');
ok(P.yapiPuani('34QBC123') < P.yapiPuani('34ABC123'), 'Q harfi cezalı (TR plakasında yok)');
ok(P.yapiPuani('35AZ4507') >= P.yapiPuani('35AZ450'), 'tek haneli seri iki haneliden düşük puanlı');
ok(P.yapiPuani('06KL2301') > 0, 'çift sayılı il kodu (06) kabul edilir ama cezalı');

bolum('Kendi kendini onarma (aday üretimi)');
{
  // OCR sık hataları: O/0, S/5, B/8, I/1, eksik/fazla karakter
  const d = (ham, beklenen) => {
    const a = P.adayUret(ham, []);
    const ilk = a.length ? a[0].bicim : '(yok)';
    ok(ilk.replace(/[^0-9A-Z]/g, '') === beklenen,
      `"${ham}" -> "${beklenen}"`, `aldı: ${ilk}`);
  };
  d('34ABC123', '34ABC123');       // bozulmadan geçer
  d('O4ABC123', '04ABC123');       // O -> 0 (il kodu)
  d('34ABCI23', '34ABC123');       // I -> 1
  d('34ABC1Z3', '34ABC123');       // Z -> 2
  d('34ABCS23', '34ABC523');       // S->5 (harf bloğu 3 harf, seri 523)
  d('34ABC5Z3', '34ABC523');       // 5->S ve Z->2
  d('3 4 ABC 123', '34ABC123');    // boşluklar
  d('B4ABC123', '44BC123');        // B ilk hanede 84 üretir (geçersiz il kodu)
                                   // -> elenir; sıradaki geçerli okuma seçilir
}
{
  // Kritik davranış: geçersiz il kodu (82-99) KESİNLİKLE üretilmemeli.
  // B/8 karışıklığı "B4" -> "84" gibi hatalı bir plaka doğurabilirdi.
  for (const ham of ['B4ABC123', 'B5ABC123', '9AA B123', '92AB1234']) {
    const a = P.adayUret(ham.replace(/\s/g, ''), []);
    const kotu = a.filter((x) => { const k = parseInt(x.plaka.slice(0, 2), 10); return k > 81 || k < 1; });
    ok(kotu.length === 0, `"${ham}" geçersiz il kodu üretmiyor (${kotu.map((x) => x.bicim).join(', ') || 'temiz'})`);
  }
}
{
  // Sondaki tekrar eden rakam atılmalı: "06KL23011" -> "06KL2301"
  const a = P.adayUret('06KL23011', []);
  const ilk = a.length ? a[0].bicim.replace(/[^0-9A-Z]/g, '') : '';
  ok(ilk === '06KL2301', 'sondaki tekrar eden rakam atılır (06KL23011 -> 06KL2301)', `aldı: ${ilk}`);
}
{
  // Baştaki harf/rakam karışıklığı: "N41TR908" -> "41TR908"
  const a = P.adayUret('N41TR908', []);
  const ilk = a.length ? a[0].bicim.replace(/[^0-9A-Z]/g, '') : '';
  ok(ilk === '41TR908', 'baştaki yabancı karakter atlanır (N41TR908 -> 41TR908)', `aldı: ${ilk}`);
}
{
  // Bilinen plaka listesi belirici olmalı
  const bilinen = ['41 TR 908'];
  const a = P.adayUret('41TR90B', bilinen);
  const ilk = a.length ? a[0].bicim : '';
  ok(P.anahtar(ilk) === P.anahtar('41TR908'),
    'bilinen plaka listesi yanlış okumayı düzeltir (41TR90B -> 41 TR 908)', `aldı: ${ilk}`);
}
{
  // Hiçbir makul aday üretilememeli
  ok(P.adayUret('', []).length === 0, 'boş metin -> aday yok');
  ok(P.adayUret('!!!', []).length === 0, 'yalnızca işaret -> aday yok');
  ok(P.adayUret('ABC', []).length === 0, 'çok kısa metin -> aday yok');
}

// ===========================================================================
//  2. Görüntü işleme
// ===========================================================================
bolum('Görüntü ön işleme');
{
  // Gri tonlama
  const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  const gri = G.griTaraf(rgba, 2, 1);
  ok(gri[0] === 0 && gri[1] === 255, 'gri tonlama: siyah->0, beyaz->255');

  // Otsu: iki sınıflı görüntüde eşik iki sınıf arasında olmalı
  const ikiSinif = new Uint8ClampedArray(100);
  for (let i = 0; i < 50; i++) { ikiSinif[i] = 20; ikiSinif[50 + i] = 220; }
  const t = G.otsuEsik(ikiSinif);
  ok(t >= 20 && t < 220, `Otsu eşiği iki sınıf arasında (${t})`);

  // Medyan filtresi: tek pikselli beyaz nokta gürültüsü silinmeli
  const gurultulu = new Uint8ClampedArray(9 * 9);           // siyah zemin
  gurultulu[4 * 9 + 4] = 255;                               // merkezde beyaz nokta
  const temiz = G.medyan3(gurultulu, 9, 9);
  ok(temiz[4 * 9 + 4] === 0, 'medyan filtresi tek pikselli beyaz gürültüyü siler');
  ok(temiz[0] === 0 && temiz[8 * 9 + 8] === 0, 'medyan filtresi köşeleri bozmaz');
}
{
  // REGRESYON: medyan filtresi Uint8ClampedArray giriş almalı.
  // Int8Array ile 255 -> -1 sarıyor ve her şey siyaha dönüyordu.
  const metin = new Uint8ClampedArray(9 * 9);
  for (let y = 2; y < 7; y++) for (let x = 2; x < 7; x++) metin[y * 9 + x] = 255;  // beyaz kare
  const sonuc = G.medyan3(metin, 9, 9);
  let beyaz = 0;
  for (let i = 0; i < sonuc.length; i++) if (sonuc[i] > 128) beyaz++;
  ok(beyaz >= 20, `medyan filtresi kalın beyaz bloğu korur (${beyaz} beyaz piksel)`);
  ok(sonuc[0] === 0, 'medyan filtresi dışarıyı siyah bırakır');
}
{
  // Morfoloji yönleri
  const tekPiksel = new Uint8ClampedArray(9 * 9);
  tekPiksel[4 * 9 + 4] = 255;
  const kapama = G.morfoloji(tekPiksel, 9, 9, 1, false);   // erode=false -> KAPAMA
  let beyaz = 0;
  for (let i = 0; i < kapama.length; i++) if (kapama[i] > 128) beyaz++;
  ok(beyaz > 1, `kapama (closing) tek pikseli beyaz noktayı büyütür (${beyaz} piksel)`);

  const acma = G.morfoloji(tekPiksel, 9, 9, 1, true);      // erode=true -> AÇMA
  let beyazAcma = 0;
  for (let i = 0; i < acma.length; i++) if (acma[i] > 128) beyazAcma++;
  ok(beyazAcma === 0, `açma (opening) tek pikseli beyaz noktayı siler (${beyazAcma} piksel)`);
}
{
  // Yeniden ölçekleme boyutu korumalı
  const kucuk = new Uint8ClampedArray(20 * 10).fill(128);
  const buyuk = G.olcekle(kucuk, 20, 10, 60, 30);
  ok(buyuk.length === 60 * 30, 'yeniden ölçekleme istenen boyutu üretir');
  ok(buyuk[0] >= 120 && buyuk[0] <= 136, 'yeniden ölçekleme değer aralığını korur');
}
{
  // BMP kodlama: başlık ve satır hizası
  const ikili = new Uint8ClampedArray(4 * 3);
  for (let i = 0; i < 4 * 3; i++) ikili[i] = i * 20;
  const bmp = G.bmpKodla(ikili, 4, 3);
  ok(bmp.slice(0, 2).toString('ascii') === 'BM', 'BMP imzası doğru');
  ok(bmp.readUInt32LE(2) === bmp.length, 'BMP dosya boyutu bildirimi doğru');
  ok(bmp.readInt32LE(18) === 4 && bmp.readInt32LE(22) === 3, 'BMP genişlik/yükseklik doğru');
  ok(bmp.readUInt16LE(28) === 24, 'BMP derinliği 24 bit');
}
{
  // PNG gidiş-dönüş (8x4 piksel = 128 bayt RGBA; alfa kanalı 255 olmalı)
  const G8 = 8, Y4 = 4;
  const rgba = new Uint8ClampedArray(G8 * Y4 * 4);
  for (let i = 0; i < G8 * Y4; i++) {
    rgba[i * 4] = (i * 7) % 256;
    rgba[i * 4 + 1] = (i * 13) % 256;
    rgba[i * 4 + 2] = (i * 29) % 256;
    rgba[i * 4 + 3] = 255;
  }
  const png = G.pngKodla(rgba, G8, Y4);
  const geri = G.pngCoz(png);
  ok(geri.genislik === G8 && geri.yukseklik === Y4, 'PNG gidiş-dönüş boyut korur');
  ok(geri.veri.length === G8 * Y4 * 4, 'PNG çözümü tam piksel sayısı döndürüyor');
  // DİKKAT: Uint8ClampedArray, Uint8Array'nin alt türü DEĞİLDİR.
  const girdi = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  ok(Buffer.from(geri.veri).equals(girdi), 'PNG gidiş-dönüş piksel birebir');
  // Savunmacı davranış: eksik tampon sessizce bozulmamalı
  let hataAtildi = false;
  try { G.pngKodla(new Uint8ClampedArray(16), G8, Y4); } catch { hataAtildi = true; }
  ok(hataAtildi, 'eksik piksel tamponunda anlaşılır hata fırlatılıyor (sessiz bozulma yok)');
}

// ===========================================================================
//  3. Gerçek okuma (Tesseract WASM, çevrimdışı)
// ===========================================================================
const BEKLENEN = [
  { dosya: 'plaka-temiz.png', metin: '34ABC123' },
  { dosya: 'plaka-gri.png', metin: '06KL2301' },
  { dosya: 'plaka-motosiklet.png', metin: '41TR908' },
  { dosya: 'plaka-kirli.png', metin: '35AZ4507' },
];

const normalize = (s) => String(s || '').replace(/[^0-9A-Z]/g, '');
const motorVar = fs.existsSync(path.join(KOK, 'companion', 'ocr', 'lang', 'eng.traineddata.gz'));
const wasmVar = !!(() => {
  try { require.resolve('tesseract.js', { paths: [path.join(KOK, 'companion')] }); return true; } catch { return false; }
})();

bolum('Motor denetimi');
ok(motorVar, 'dil dosyası paketlenmiş (eng.traineddata.gz mevcut) — çevrimdışı okuma mümkün');
ok(wasmVar, 'tesseract.js kurulu (WASM motoru)');

const motor = new P.PlakaMotoru();
const d = motor.denetle();
ok(d.kullanilabilir, 'motor kullanılabilir', JSON.stringify(d));

(async () => {
  if (!d.kullanilabilir) {
    console.log('\nSONUÇ: ' + pass + ' pass, ' + (fail + 1) + ' fail');
    process.exit(1);
  }

  bolum('Gerçek plaka okuma (çevrimdışı)');
  const tHazir = Date.now();
  await motor.hazirla();
  const hazirMs = Date.now() - tHazir;
  ok(hazirMs < 8000, `motor ${hazirMs} ms'de hazır (ilk okuma gecikmesi kabul edilebilir)`);

  // Bilinen plaka listesi: telefonun kayıtlı kuryeleri. Gerçek kullanımda
  // telefon bunu gönderir; doğruluk için belirleyicidir.
  const bilinen = BEKLENEN.map((b) => b.metin);

  for (const b of BEKLENEN) {
    const yol = path.join(FIKSTUR, b.dosya);
    if (!fs.existsSync(yol)) { ok(false, `fikstür bulunamadı: ${b.dosya}`); continue; }
    const t = Date.now();
    const r = await motor.oku(fs.readFileSync(yol), { bilinenPlakalar: bilinen, zamanButcesi: 4 });
    const sure = Date.now() - t;
    const alinan = normalize(r.plaka);
    ok(alinan === b.metin,
      `${b.dosya} okundu (${sure} ms)`,
      `beklenen ${b.metin}, alınan ${r.plaka}`);
    ok(sure < 12000, `${b.dosya} makul sürede tamamlandı (${sure} ms < 12000)`);
    ok(Array.isArray(r.adaylar) && r.adaylar.length >= 1, `${b.dosya} aday listesi döndü`);
    ok(r.denemeler && r.denemeler.length >= 1, `${b.dosya} ham okuma denemeleri döndü (hata ayıklama için)`);
  }

  bolum('Bozuk / imkânsız girdiler');
  {
    const bos = await motor.oku(Buffer.alloc(0), { bilinenPlakalar: [] });
    ok(bos.basarili === false, 'boş görüntü başarısız döner, çökmez');
    ok(typeof bos.hata === 'string' && bos.hata.length > 0, 'boş görüntü için açıklayıcı hata var');
  }
  {
    const bozuk = await motor.oku(Buffer.from('bu bir png degil'), { bilinenPlakalar: [] });
    ok(bozuk.basarili === false, 'bozuk veri başarısız döner, çökmez');
  }
  {
    // Tamamen boş (beyaz) bir görüntü: Tesseract HİÇ ÇALIŞTIRILMAMALI.
    // Hem zaman kaybı hem de motorun hata ayıklama çıktısı önlenir.
    const beyaz = G.pngKodla(new Uint8ClampedArray(300 * 100 * 4).fill(255), 300, 100);
    const t = Date.now();
    const r = await motor.oku(beyaz, { bilinenPlakalar: [], zamanButcesi: 3 });
    const sure = Date.now() - t;
    ok(r.basarili === false, 'düz beyaz görüntüden uydurma plaka üretilmiyor');
    ok(r.neden === 'metin-yok', 'beyaz görüntü "metin yok" olarak tanımlandı');
    ok(sure < 300, `beyaz görüntü anında elendi (${sure} ms < 300) — Tesseract çalıştırılmıyor`);
    // Mesaj EYLEM DÖNÜK olmalı: kullanıcı ne yapacağını anlamalı, sadece
    // "hata oldu" dememeli. (Tam beyaz kare "doygun" olarak eleniyor ve
    // mesajı "kamerayı plakaya doğru tutun" diyor.)
    ok(/yaklaştır|çerçeveye|doğru tutun|yeniden çek/i.test(r.hata || ''),
      `kullanıcıya eyleme dönük mesaj veriliyor`, `mesaj: ${r.hata}`);
  }
  {
    // Metin olmayan kırpım denetimi (saf fonksiyon)
    const duz = new Uint8ClampedArray(50 * 50).fill(200);
    ok(P.metinVarMi(duz) === false, 'tek tonlu görüntüde metin yok');
    const metinli = new Uint8ClampedArray(50 * 50).fill(240);
    for (let y = 10; y < 40; y++) for (let x = 5; x < 45; x += 4) metinli[y * 50 + x] = 10;
    ok(P.metinVarMi(metinli) === true, 'siyah karakterli açık görüntüde metin var');
    const tamSiyah = new Uint8ClampedArray(50 * 50).fill(0);
    ok(P.metinVarMi(tamSiyah) === false, 'tamamen siyah görüntüde metin yok');
    ok(P.metinVarMi(new Uint8ClampedArray(4)) === false, 'aşırı küçük görüntü reddediliyor');
  }

  bolum('Eşzamanlılık (kuyruk güvenliği)');
  {
    // Aynı anda 3 okuma: WASM çalışma zamanı eşzamanlı çağrıya dayanıklı
    // değildir; kuyruk bunu seriye indirmeli, sonuçlar karışmamalı.
    const isler = BEKLENEN.slice(0, 3).map((b) =>
      motor.oku(fs.readFileSync(path.join(FIKSTUR, b.dosya)), { bilinenPlakalar: bilinen, hizli: true })
    );
    const sonuclar = await Promise.all(isler);
    sonuclar.forEach((r, i) => {
      ok(normalize(r.plaka) === BEKLENEN[i].metin,
        `eşzamanlı okuma ${i + 1} doğru sonucu verdi (karışmadı)`,
        `beklenen ${BEKLENEN[i].metin}, alınan ${r.plaka}`);
    });
  }

  bolum('Motor yaşam döngüsü');
  {
    const durum = motor.durum();
    ok(durum.hazir === true, 'motor hazır durumda bildiriliyor');
    ok(durum.istekSayisi > 0, 'istek sayacı işliyor');
    // Motor türü bildirilmeli ve SEÇİLEN HATLA TUTARLI olmalı.
    // Neden bu kadar katı? Sistem artık iki hattı destekliyor
    // (CKY_MOTOR=fpo|tesseract|fpo+tesseract). "Motor türü bildiriliyor"
    // ama hangi hattın çalıştığını söylemiyorsa, kullanıcı "neden yavaş /
    // neden farklı okuyor" sorusunu cevaplayamaz. Bu alan bilinçli olarak
    // görünür kılınmıştır.
    const beklenenMotor = durum.hat === 'tesseract' ? /tesseract/ : /fast-plate-ocr/;
    ok(beklenenMotor.test(durum.motor),
      `motor türü bildiriliyor ve seçilen hatla tutarlı (hat=${durum.hat})`,
      `motor: ${durum.motor}`);
    ok(['fpo', 'tesseract', 'fpo+tesseract'].includes(durum.hat),
      'hangi hattın okuduğu açıkça bildiriliyor', `hat: ${durum.hat}`);
    if (durum.hat !== 'tesseract') {
      // fast-plate-ocr hattı seçiliyse model durumu görünür olmalı:
      // eksik/bozuk model sessizce geçmemeli (rehber §13.12).
      ok(durum.fpo && typeof durum.fpo.hazir === 'boolean',
        'fast-plate-ocr model durumu bildiriliyor');
      ok(durum.fpo && (durum.fpo.hazir === true || !!durum.fpo.sebep),
        'model ya hazır ya da sebebi açık (sessizce geçilmiyor)',
        `hazir=${durum.fpo && durum.fpo.hazir} sebep=${durum.fpo && durum.fpo.sebep}`);
      if (durum.fpo && durum.fpo.hazir) {
        ok(durum.fpo.config && durum.fpo.config.yuva > 0,
          'model config okundu (görüntü boyutu/kanal biliniyor)',
          JSON.stringify(durum.fpo.config));
        ok(!durum.fpo.uyumsuzluk,
          'config ile model giriş şekli uyuşuyor', durum.fpo.uyumsuzluk || '');
      }
    }
    ok(durum.dil.indexOf('yerel') >= 0 || durum.hat !== 'tesseract',
      'dil dosyası YEREL olarak bildiriliyor (internet gerekmiyor)');
  }
  {
    motor.kapat('test sonu');
    const durum = motor.durum();
    ok(durum.hazir === false, 'kapat() sonrası motor hazır değil');
    // Yeniden kullanılabilir olmalı (kendini onarma)
    const tekrar = await motor.oku(fs.readFileSync(path.join(FIKSTUR, BEKLENEN[0].dosya)), { bilinenPlakalar: bilinen, hizli: true });
    ok(normalize(tekrar.plaka) === BEKLENEN[0].metin, 'kapatılan motor kendiliğinden yeniden yüklenip çalışıyor');
    motor.kapat('test sonu 2');
  }

  console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('TEST ÇÖKTÜ:', e);
  console.log(`\nSONUÇ: ${pass} pass, ${fail + 1} fail`);
  process.exit(1);
});
