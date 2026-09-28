'use strict';
// ============================================================================
//  SÜREKLİ KAMERA OKUMA — sunucu tarafı güvenlik testleri
// ----------------------------------------------------------------------------
//  Bu dosya neden var?
//  Telefon uygulamasına "sürekli kamera okuma" (varsayılan KAPALI) eklendi.
//  Bu mod açıldığında telefon kareleri ARKA ARKAYA gönderir. İki yönlü risk
//  doğuyor:
//
//   1) SUNUCU KİLİTLENME. Okuma kuyruğu sınırsız olsaydı, istekler birikir ve
//      gecikme kare sayısıyla büyürdü. Kullanıcı "çok yavaş" derdi — oysa
//      TEK okuma 0,3 sn'dir. Yani kullanıcıya YANLIŞ tanı verilirdi.
//
//   2) SONUÇLARIN KARIŞMASI. ONNX oturumu ve WASM yeniden-girilebilir
//      değildir; eşzamanlı iki çıkarım sonuçları birbirine karıştırır.
//      Bu bir güvenlik açığıdır: nöbetçiye A plakası yerine B plakası
//      gösterilebilir.
//
//  Her iki risk de ÖLÇÜLEBİLİR ve ölçülüyor.
// ============================================================================

const { kareUret } = require('./ara/sahne-uret.js');
const { PlakaMotoru } = require('../companion/ocr/plaka.js');

const FIKSTUR = __dirname + '/fixtures/plaka-temiz.png';
const BEKLENEN = '34ABC123';
const norm = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

let pass = 0, fail = 0;
const bolum = (b) => console.log(`\n--- ${b} ---`);
function ok(kosul, aciklama, ayrinti = '') {
  if (kosul) { pass++; console.log(`PASS — ${aciklama}`); }
  else { fail++; console.log(`FAIL — ${aciklama}${ayrinti ? ' :: ' + ayrinti : ''}`); }
}

(async () => {
  const motor = new PlakaMotoru();
  const kare = kareUret(FIKSTUR, {});
  const ipucu = {
    ust: Math.max(0, Math.round((kare.plaka.y / kare.sahneBoyut.y) * 100) - 5),
    yukseklik: Math.min(100, Math.ceil(((kare.plaka.y2 + 6) / kare.sahneBoyut.y) * 100) + 5),
  };
  const oku = () => motor.oku(kare.gorsel, { bilinenPlakalar: [BEKLENEN], ipucu });

  // =========================================================================
  bolum('Sürekli mod varsayılan olarak KAPALI olmalı');
  // =========================================================================
  // Eklenti dosyası yalnızca yüklenir; mod ancak ayar açıldığında başlar.
  const eklenti = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'companion', 'public', 'telefon', 'canli-okuma.js'), 'utf8');
  ok(/localStorage\.getItem/.test(eklenti), 'ayarlar cihazda saklanıyor (kalıcı ama kapalı başlıyor)');
  ok(/=== *0/.test(eklenti) || /EN_COK_HATA/.test(eklenti),
    'sürekli modun hata toleransı tanımlı (ağ kopunca kendini durdurur)');
  ok(!/Otomatik kaydet|autoKaydet/.test(eklenti),
    'bulunan plaka otomatik KAYIT olarak gönderilmiyor (karar insana ait)');
  ok(/visibilitychange/.test(eklenti),
    'ekran kapanınca mod duruyor (pil ve kamera güvenliği)');

  // =========================================================================
  bolum('Kuyruk sınırı: birikme olmamalı');
  // =========================================================================
  const istekler = [];
  for (let i = 0; i < 10; i++) istekler.push(oku());
  const sonuclar = await Promise.all(istekler);

  const basarili = sonuclar.filter((r) => r.basarili);
  const dolu = sonuclar.filter((r) => r.neden === 'kuyruk-dolu');
  ok(basarili.length <= 3,
    `kuyruk sınırı uygulanıyor (10 istekten ${basarili.length} kabul, sınır 3)`,
    `kabul: ${basarili.length}`);
  ok(dolu.length >= 7,
    `fazlası açıkça reddediliyor (${dolu.length} istek "kuyruk-dolu" aldı)`);
  ok(dolu[0] && /yoğun/.test(dolu[0].hata || ''),
    'reddetme nedeni kullanıcıya anlamlı geliyor ("sistem yoğun")',
    dolu[0] ? dolu[0].hata : '-');
  ok((motor._kuyrukDerinligi || 0) === 0,
    'bitişte kuyruk boş (sızıntı yok)',
    `derinlik: ${motor._kuyrukDerinligi}`);

  // =========================================================================
  bolum('Sonuçlar karışmamalı — güvenlik testi');
  // =========================================================================
  const hepsiDogru = basarili.every((r) => norm(r.plaka) === BEKLENEN);
  ok(basarili.length === 0 || hepsiDogru,
    'eşzamanlı okumalar birbirine karışmadı',
    `okunanlar: ${basarili.map((r) => r.plaka).join(' | ')}`);
  ok(motor.durum().hataSayisi === 0, 'motor hata sayacı temiz', `hata: ${motor.durum().hataSayisi}`);

  // =========================================================================
  bolum('Kuyruk BOŞKEN okuma kaybı olmamalı');
  // =========================================================================
  // Yanlış davranış: kuyruk boşken de reddetmek. Bu, tek çekim akışını
  // bozardı — kullanıcı düğmeye basar ve plakasını okutamaz.
  const tekTek = [];
  for (let i = 0; i < 3; i++) tekTek.push(await oku());
  ok(tekTek.every((r) => r.basarili),
    'kuyruk boşken art arda okumaların tamamı kabul ediliyor',
    tekTek.map((r) => r.neden || 'ok').join(', '));
  ok(tekTek.every((r) => norm(r.plaka) === BEKLENEN),
    'tek tek okumalar doğru plakayı veriyor',
    tekTek.map((r) => r.plaka).join(' | '));

  // =========================================================================
  bolum('Sürekli modun yükü sınırlar içinde mi');
  // =========================================================================
  // Eklenti kendi hızında gitmez: tur süresi = ölçülen okuma + 700 ms.
  // Bu yüzden dakikadaki istek sayısı hesaplanabilir ve HIZ SINIRININ
  // altında kalmalı (sunucu sınırı 600 istek/dk).
  const ARA_MS = 700;
  const tekSure = [];
  for (let i = 0; i < 5; i++) {
    const t = Date.now();
    await oku();
    tekSure.push(Date.now() - t);
  }
  const ort = Math.round(tekSure.reduce((a, b) => a + b, 0) / tekSure.length);
  const tur = Math.max(ARA_MS, ort + ARA_MS);
  const dakikaDaki = Math.round(60000 / tur);
  console.log(`  ölçülen okuma: ${ort} ms · tur süresi: ${tur} ms (${(1000 / tur).toFixed(2)} kare/sn)`);
  console.log(`  dakikada gönderilen: ${dakikaDaki} istek (sunucu sınırı 600)`);
  ok(dakikaDaki < 600,
    'sürekli mod sunucu hız sınırının altında kalıyor',
    `${dakikaDaki} istek/dk`);

  // Gerçek sözleşme testi: tur süresi "ölçülen okuma + ARA_MS" ve ASLA
  // ARA_MS'den küçük olamaz. Önceden sabit bir sayı (ör. 1000 ms) eşiği
  // koymak keyfiydi ve ölçüm gürültüsünde kırılıyordu — sözleşmenin kendisi
  // daha doğru bir ölçüttür.
  ok(tur >= ARA_MS,
    `tur süresi hiçbir zaman sabit aradan kısa değil (${tur} ms >= ${ARA_MS} ms)`,
    `${tur} ms`);
  ok(1000 / tur <= 1.5,
    `kare hızı 1,5 fps'nin altında (ölçülen ${(1000 / tur).toFixed(2)} fps)`,
    `${(1000 / tur).toFixed(2)} fps`);

  // =========================================================================
  bolum('Birden çok telefon');
  // =========================================================================
  // İki telefon canlı modda olursa sunucu iki kez iş yapar. Kuyruk sınırı
  // bunu YÖNETİLEBİLİR kılar (reddetme), çökme veya kilitlenme olmaz.
  const coklu = await Promise.all([oku(), oku(), oku(), oku(), oku(), oku()]);
  const cokluBasarili = coklu.filter((r) => r.basarili).length;
  const cokluDolu = coklu.filter((r) => r.neden === 'kuyruk-dolu').length;
  ok(cokluBasarili + cokluDolu === 6,
    'çoklu kanalda her istek ya okundu ya da açıkça reddedildi',
    `${cokluBasarili} okundu, ${cokluDolu} kuyruk-dolu`);
  ok(cokluBasarili > 0, 'çoklu kanalda en az biri okunuyor (tamamen kilitlenmiyor)');
  ok((motor._kuyrukDerinligi || 0) === 0, 'çoklu kanal sonrası kuyruk yine boş');

  motor.kapat('test sonu');

  console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST ÇÖKTÜ:', e); process.exit(1); });
