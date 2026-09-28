'use strict';
// ============================================================================
//  SÜREKLİ KAMERA OKUMA EKLENTİSİ — davranışsal test (sahte DOM)
// ----------------------------------------------------------------------------
//  Bu dosya neden ayrı?
//  test-canli-okuma.js SUNUCU tarafını ölçer (kuyruk sınırı, sonuç karışmaması).
//  test-ui-static.js ise BAĞLANTIYI ve mevcut özelliklerin kaybolmadığını
//  denetler. İkisi de bu eklentinin ÇALIŞMA DAVRANIŞINI ölçmez.
//
//  Ölçülen hata tam olarak buradaydı: "ayarlardan sürekli kamera taramasını
//  etkinleştirsek de bu çalışmıyor, yine çekim butonuna tıklamamız gerekiyor."
//  Kök neden: eklenti kamera akışını DIŞARIDAN bekliyordu, oysa kullanıcı
//  Ayarlar ekranındaydı ve kamera sayfası kapalıydı. Hiçbir test bunu
//  yakalayamazdı — çünkü davranış hiç çalıştırılmıyordu.
//
//  Burada eklenti GERÇEKTEN çalıştırılır: sahte bir DOM/Cam/fetch ortamında,
//  senkronize edilmiş bir saatle. Böylece "kamera açılana kadar bekliyor mu",
//  "hata yutulunca ne kadar bekliyor", "kullanıcı sayfayı kapatınca ne
//  oluyor" gibi sorular ÖLÇÜLEBİLİR cevap alır.
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EKLENTI = path.join(__dirname, '..', 'companion', 'public', 'telefon', 'canli-okuma.js');
const KOD = fs.readFileSync(EKLENTI, 'utf8');

// --- SESSIZ ÇIKIŞ KORUMASI ---------------------------------------------
// Bir bölüm takılırsa (ya da bir söz hiç çözülmezse) dünya döngüsü boşalır
// ve Node SESSIZCE 0 koduyla çıkar. Test suite'i yeşil görünür ama aslında
// ölçüm yapılmamıştır. Ölçülen hata: düzeltmeler geri alındığında tam olarak
// bu oldu — 5 kontrolden 4'ü hiç çalışmadı ve kimse fark etmedi.
// Bu bekçi sayesinde takılma KIRMIZI ve gürültülü olur.
const BEKCI = setTimeout(() => {
  console.error('\nFAIL — test dosyasi ZAMAN ASIMINA ugradi (sessiz cikis olmamali)');
  process.exit(2);
}, 120000);

let pass = 0, fail = 0;
const bolum = (b) => console.log(`\n--- ${b} ---`);
function ok(kosul, aciklama, ayrinti = '') {
  if (kosul) { pass++; console.log(`PASS — ${aciklama}`); }
  else { fail++; console.log(`FAIL — ${aciklama}${ayrinti ? ' :: ' + ayrinti : ''}`); }
}

// ---------------------------------------------------------------------------
//  SAHTE ORTAM
// ---------------------------------------------------------------------------
// Saat kontrollü: `Date.now()` ileri atılabiliyor, böylece "12 saniye bekledi"
// gibi iddiaları GERÇEKTEN ölçebiliyoruz (beklemeden).
function ortamYap(secenek = {}) {
  const A = {
    camAcik: secenek.camAcik !== false,
    streamVar: secenek.streamVar !== false,   // Cam.stream atanmış mı
    openHatasi: secenek.openHatasi || null,   // Cam.open reddederse
    fetchCevabi: secenek.fetchCevabi || { basarili: true, plaka: '34 ABC 123', neden: null },
    fetchHatasi: !!secenek.fetchHatasi,
  };

  let saniye = 1000;                     // kontrollü sanal saat
  const geriCalan = [];

  // --- video öğesi ---------------------------------------------------------
  const video = {
    videoWidth: 0, videoHeight: 0,
    get srcObject() { return A.streamVar ? { kacir: true } : null; },
    set srcObject(v) { if (!v) { this.videoWidth = 0; this.videoHeight = 0; } },
  };
  if (A.camAcik && A.streamVar) { video.videoWidth = 1920; video.videoHeight = 1080; }

  // --- canvas --------------------------------------------------------------
  const ctx2d = {
    drawImage() { },
    // toDataURL gerçek bir JPEG data URL'si dönmeli (uzunluk denetimi var)
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => ctx2d,
    toDataURL: () => 'data:image/jpeg;base64,' + 'A'.repeat(4000),
  };

  // --- document ------------------------------------------------------------
  const elemanlar = {
    '#camVideo': video,
    video: video,
    '#camSheet': { classList: { _s: new Set(A.camAcik ? ['show'] : []), add(x) { this._s.add(x); }, remove(x) { this._s.delete(x); }, contains(x) { return this._s.has(x); } } },
    '#camSub': { textContent: '' },
    '#camStatus': { textContent: '', classList: { toggle() { } } },
  };
  const document = {
    hidden: false,
    body: { classList: { add() { }, remove() { }, contains: () => A.camAcik } },
    querySelector(sec) { return elemanlar[sec] || null; },
    createElement: (ad) => (ad === 'canvas' ? canvas : { classList: { add() { }, remove() { } } }),
    addEventListener() { },
  };

  // --- Cam (uygulamanın kamera modülü) -------------------------------------
  const cagriLog = [];
  const Cam = {
    ctxMode: 'fill',
    stream: (A.streamVar && A.camAcik) ? { kacir: true } : null,
    cropArea: { top: 36, height: 28 },
    openCalls: 0,
    async open(ctx) {
      this.openCalls++;
      cagriLog.push('open:' + this.openCalls);
      if (A.openHatasi) throw new Error(A.openHatasi);
      // SAYFA AÇILIR (uygulamanın yaptığı gibi)
      elemanlar['#camSheet'].classList.add('show');
      // ... sonra akış denenir.
      if (A.streamVar) {
        this.stream = { kacir: true };
        video.videoWidth = 1920; video.videoHeight = 1080;
      } else {
        // ÖLÇÜLEN TUZAK: uygulama hatayı YUTAR ve yeniden fırlatmaz.
        // Yani open() "başarılı" görünür ama akış hiç oturmamıştır.
        this.stream = null;
        video.videoWidth = 0; video.videoHeight = 0;
        elemanlar['#camStatus'].textContent = 'Kamera izni verilmedi.';
      }
      return undefined;
    },
    close() {
      cagriLog.push('close');
      this.stream = null;
      video.videoWidth = 0; video.videoHeight = 0;
      elemanlar['#camSheet'].classList.remove('show');
    },
  };

  // --- fetch ---------------------------------------------------------------
  const istekLog = [];
  const fetchFn = (url, sec) => {
    istekLog.push({ url, body: sec && sec.body ? JSON.parse(sec.body) : null });
    if (A.fetchHatasi) return Promise.reject(new Error('ağ yok'));
    return Promise.resolve({
      status: 200,
      json: () => Promise.resolve(A.fetchCevabi),
    });
  };

  // --- localStorage --------------------------------------------------------
  const depolama = {};
  const localStorage = {
    getItem: (k) => (k in depolama ? depolama[k] : null),
    setItem: (k, v) => { depolama[k] = String(v); },
  };

  // --- sanal zaman ---------------------------------------------------------
  const GerCagirma = function (fn, ms) {
    const kalan = Math.max(0, ms);
    geriCalan.push({ fn, kalan, son: saniye + kalan, bitti: false });
    return geriCalan.length;
  };
  // Sanal saati ileri al.
  //
  // Ã–NEMLÄ°: bu ASENKRON olmak zorunda. canli-okuma.js tur() fonksiyonu
  // `await fetch(...)` ve `await bekle(...)` kullanÄ±yor; bunlar GERÃ‡EK sÃ¶z
  // vermelerdir. ZamanlayÄ±cÄ±yÄ± senkron ateÅŸlersek sÃ¶zÃ¼n devamÄ± gerÃ§ek olay
  // dÃ¶ngÃ¼sÃ¼nde Ã§alÄ±ÅŸmadÄ±ÄŸÄ± iÃ§in tur() ilerleyemez ve test "hiÃ§bir ÅŸey olmadÄ±"
  // diye SAHTE biÃ§imde kÄ±rmÄ±zÄ± verir. Ä°lk yazÄ±mda tam olarak bu oldu â€” 5 kontrol
  // yanlÄ±ÅŸlÄ±kla FAIL idi.
  //
  // DoÄŸrusu: her adÄ±mdan Ã–NCE gerÃ§ek olay dÃ¶ngÃ¼sÃ¼nÃ¼ boÅŸalt (setImmediate),
  // sonra o an tetiklenmesi gereken en erken zamanlayÄ±cÄ±yÄ± ateÅŸle.
  async function ilerlet(ms) {
    const hedef = saniye + ms;
    const gercekBas = Date.now();
    for (let adim = 0; adim < 20000; adim++) {
      await new Promise((r) => setImmediate(r));   // sÃ¶zler + zamanlayÄ±cÄ±lar Ã§Ã¶zÃ¼lsÃ¼n
      if (Date.now() - gercekBas > 15000) break;     // gÃ¼venlik tavanÄ± (donma korumasÄ±)
      let sonraki = -1, enKucuk = Infinity;
      for (let i = 0; i < geriCalan.length; i++) {
        const g = geriCalan[i];
        if (g.bitti) continue;
        if (g.son < enKucuk) { enKucuk = g.son; sonraki = i; }
      }
      if (sonraki < 0 || enKucuk > hedef) break;
      const g = geriCalan[sonraki];
      g.bitti = true;
      saniye = Math.max(saniye, g.son);
      try { g.fn(); } catch (e) { /* test ortamÄ±: zamanlayÄ±cÄ± hatasÄ± yutulur */ }
    }
    saniye = hedef;
    await new Promise((r) => setImmediate(r));
  }

  const CKYerel = {
    istekSayisi: 0, basariliSayisi: 0, toplamSure: 0, sonHata: null,
  };

  const win = {
    CKYerel,
    Cam,
    location: { origin: 'http://bilgisayar:4599', protocol: 'http:' },
    OCR_CONFIG: { yerel: { url: 'http://bilgisayar:4599', token: 'tok' } },
    navigator: {
      vibrate() { },
      // Guvenli kaynak varsayilan: bu ortamda getUserMedia calisir.
      mediaDevices: { getUserMedia: function () { return Promise.resolve({}); } },
    },
    isSecureContext: secenek.guvenliKaynak !== false,
    fetch: fetchFn,
    AudioContext: undefined,   // ses üretimi yok -> sadece titreşim
    Promise, JSON, Date, Math, setTimeout: GerCagirma, clearTimeout() { },
  };
  win.window = win;
  win.document = document;
  win.localStorage = localStorage;
  win.navigator = win.navigator;
  // Ekleti ekran kapandiginda ve sayfa terk edildiginde durur. Bu iki
  // olayi da kaydetmemiz lazim, yoksa eklenti ilk calistirmada cokuyor.
  const olayDinleyiciler = {};
  win.addEventListener = (ad, fn) => { (olayDinleyiciler[ad] = olayDinleyiciler[ad] || []).push(fn); };
  win.OlayDinleyiciler = olayDinleyiciler;

  const baglam = vm.createContext(win);
  // Date.now sanallaştır
  const GercekDate = Date;
  vm.runInContext('Date.now = function(){ return __saat(); };', Object.assign(baglam, {
    __saat: () => saniye,
  }));
  vm.runInContext(KOD, baglam, { filename: 'canli-okuma.js' });

  return {
    CKYerel, Cam, A, cagriLog, istekLog, elemanlar, localStorage,
    ilerlet, saniye: () => saniye, video, baglam, olayDinleyiciler, depolama,
  };
}

// Küçük yardımcı: bir söz vermenin sonucunu bekle (mikro görev boşaltma).
function beklet(tur = 60) {
  return new Promise((r) => setImmediate(r));
}

/**
 * Bir sözü GERÇEK zaman sınırıyla yarıştır; bu sırada sanal saati de
 * ilerlet ki sanal zamanlayıcılar çalışabilsin.
 *
 * Neden şart? Eklenti bekleme yaparken setTimeout kullanıyor; testte bu
 * sanaldır. Sanal zamanlayıcı ilerletilmeden sonsuza kadar "bekliyor"
 * görünür ve süreç boşta kalıp sessizce 0 koduyla çıkar. Gerçek zaman
 * tavanı, bunu ölçülebilir bir başarısızlığa çevirir.
 */
async function zamanAsimiYarisi(o, soz, gercekMs) {
  let bitti = false;
  const surdurucu = (async () => {
    const t0 = Date.now();
    while (!bitti && Date.now() - t0 < gercekMs) {
      await o.ilerlet(500);
    }
    return 'ZAMAN-ASIMI';
  })();
  try {
    const sonuc = await Promise.race([soz, surdurucu]);
    bitti = true;
    return sonuc;
  } catch (e) {
    bitti = true;
    throw e;
  }
}

(async () => {
  // =========================================================================
  bolum('Kamera sistem tarafından açılmalı (çekim düğmesi gerekmiyor)');
  // =========================================================================
  {
    const o = ortamYap({ camAcik: false, streamVar: true });
    // Kamera sayfasi KAPALI — kullanicinin Ayarlar ekranindaki durumu
    o.Cam.stream = null;
    o.video.videoWidth = 0; o.video.videoHeight = 0;

    const istek = o.CKYerel.canliAc(true);
    ok(istek && typeof istek.then === 'function',
      'canliAc() bir SÖZ VERME döndürüyor (true = açıldı)');
    await istek;

    ok(o.Cam.openCalls === 1,
      'kamera sayfası kapalıyken sistem kendisi açıyor',
      `Cam.open çağrısı: ${o.Cam.openCalls}`);
    ok(o.CKYerel.canli.calisiyor === true,
      'kamera açıldıktan sonra mod çalışıyor',
      JSON.stringify(o.CKYerel.canli));
    ok(o.CKYerel.sureciOkuAyar === true, 'tercih kalıcı olarak kaydedildi');
    ok(o.depolama['ck-sureci-oku'] === '1', 'tercih cihazda saklandı');
  }

  // =========================================================================
  bolum('Tuzak 1: Cam.open() hatayı YUTAR — 12 sn boşuna beklenmemeli');
  // =========================================================================
  // Uygulamanın start() fonksiyonu getUserMedia hatasını yakalayıp ekrana
  // yazıyor ama YENİDEN FIRLATMIYOR. Yani `await Cam.open()` her zaman
  // "başarılı" dönüyor. Sabit süre bekleyen bir eklenti kullanıcıyı 12 saniye
  // boşuna bekletirdi. Doğru davranış: uygulamanın KENDI durumundan
  // (Cam.stream atanmamış) erken çıkıp SEBEBİNİ bildirmek.
  {
    const o = ortamYap({ camAcik: false, streamVar: false });
    const t0 = Date.now();
    const sonuc = await zamanAsimiYarisi(o, o.CKYerel.canliAc(true), 4000);
    const gecen = Date.now() - t0;

    ok(sonuc !== 'ZAMAN-ASIMI',
      `kamera açılamayınca HIZLI çıkıyor (ölçülen ${gecen} ms, eşik 4000 ms gerçek zaman)`,
      'eklenti 12 saniyelik bekleme döngüsüne girdi — düzeltme geri alınmış olabilir');
    ok(gecen < 1000,
      `düşüş yolunda bekleme yok (ölçülen ${gecen} ms)`,
      `${gecen} ms bekledi`);
    ok(o.CKYerel.canli.calisiyor === false, 'başarısızlıkta mod çalışmıyor durumda');
    ok(/izin|permission|izni/i.test(o.CKYerel.canli.kameraHatasi || ''),
      'uygulamanın kendi sebebi aktarılıyor (kullanıcı "Kamera izni verilmedi" görüyor)',
      String(o.CKYerel.canli.kameraHatasi));
    ok(o.istekLog.length === 0,
      'kamera açılmadan hiç okuma isteği atılmıyor (boşuna yük yok)');
  }

  // =========================================================================
  bolum('Tuzak 2: kullanıcı kamera sayfasını kapatırsa ısrar etmemeli');
  // =========================================================================
  // Ölçülen hata sınıfı: "düğmeler çalışmıyor". Kullanıcının bilerek
  // kapattığı sayfayı zorla geri açmak kararını ezmektir. Akış kendiliğinden
  // düşmüşse (izin iptali) yeniden açmak ise HAYAT KURTARIR. İkisi ayırt
  // edilmelidir — eski kod ikisini de "yeniden aç" diye birleştiriyordu.
  {
    const o = ortamYap({ camAcik: true, streamVar: true });
    await o.CKYerel.canliAc(true);
    ok(o.CKYerel.canli.calisiyor === true, 'mod başladı');

    // Kullanici sayfayi kapatiyor -> akis kesiliyor
    o.Cam.close();
    const oncekiOpen = o.Cam.openCalls;

    await o.ilerlet(5000);           // 5 saniyelik bekleme pencereleri
    await beklet(20);

    ok(o.Cam.openCalls === oncekiOpen,
      'kullanıcı sayfayı kapatınca kamera ZORLA geri açılmıyor',
      `Cam.open ${oncekiOpen} -> ${o.Cam.openCalls}`);
    ok(o.CKYerel.canli.calisiyor === false,
      'kullanıcı sayfayı kapatınca canlı mod DURUYOR',
      JSON.stringify(o.CKYerel.canli));
    ok(/kapat/i.test(String(o.CKYerel.sonHata || '')),
      'durma sebebi kullanıcıya anlamlı geliyor', String(o.CKYerel.sonHata));
  }

  // =========================================================================
  bolum('Akış kendiliğinden düşerse kendini toparlamalı');
  // =========================================================================
  // Sayfa AÇIK kaldı ama akış düştü (izin iptali, cihaz değişimi). Bu bir
  // hata değil, toparlanma durumudur: bir kez yeniden açılmalı.
  {
    const o = ortamYap({ camAcik: true, streamVar: true });
    await o.CKYerel.canliAc(true);

    // Akis duser ama sayfa ACIK kalir (kullanici kapatmadi)
    o.Cam.stream = null;
    o.video.videoWidth = 0; o.video.videoHeight = 0;

    const oncekiOpen = o.Cam.openCalls;
    await o.ilerlet(3000);
    await beklet(20);

    ok(o.Cam.openCalls > oncekiOpen,
      'akış düşünce bir kez yeniden açılıyor (kullanıcı kapatmamıştı)',
      `Cam.open ${oncekiOpen} -> ${o.Cam.openCalls}`);
    ok(o.CKYerel.canli.calisiyor === true,
      'yeniden açınca mod kaldığı yerden devam ediyor',
      JSON.stringify(o.CKYerel.canli));
  }

  // =========================================================================
  bolum('Döngü disiplini');
  // =========================================================================
  {
    const o = ortamYap({ camAcik: true, streamVar: true });
    await o.CKYerel.canliAc(true);

    await o.ilerlet(3000);
    await beklet(20);

    ok(o.istekLog.length > 0, 'kamera açıkken okuma istekleri atılıyor',
      `${o.istekLog.length} istek`);
    ok(o.istekLog.every((i) => i.url === '/plaka/oku' || /\/plaka\/oku$/.test(i.url)),
      'istekler mevcut uca gidiyor (yeni endpoint yok)');
    ok(o.istekLog.every((i) => i.body && typeof i.body.gorsel === 'string'),
      'her istek bir kare içeriyor');
    ok(o.istekLog.every((i) => Array.isArray(i.body.bilinenPlakalar)),
      'kurye listesi gönderiliyor (alan sözleşmesi korunuyor)');
    ok(o.istekLog.every((i) => i.body.bilisten === undefined && i.body.bilinenPlakalar.length === 0),
      'kurye listesi BOŞ gönderiliyor (yalnızca öneri; puanı artırmaz)');
    ok(o.istekLog.every((i) => i.body.ipucu && typeof i.body.ipucu.ust === 'number'),
      'kırpma ipucu yüzde olarak gönderiliyor (sunucu çözüyor)');

    // Ayni plaka arka arkaya okundu: yalnizca BIR kez bildirilmeli
    const turSayisi = o.CKYerel.canli.tur;
    ok(turSayisi > 0, 'döngü tur attı', `tur: ${turSayisi}`);
  }

  // =========================================================================
  bolum('Aynı plaka tekrar tekrar uyarmamalı');
  // =========================================================================
  {
    let bildirimSayisi = 0;
    const o = ortamYap({ camAcik: true, streamVar: true });
    // titresimi say
    o.CKYerel.canliHesapla = null;
    const eskiVibrate = o.baglam.navigator.vibrate;
    o.baglam.navigator.vibrate = () => { bildirimSayisi++; };

    await o.CKYerel.canliAc(true);
    await o.ilerlet(6000);
    await beklet(30);

    ok(bildirimSayisi <= 1,
      `aynı plaka 6 saniyede en fazla 1 kez bildirildi (ölçülen ${bildirimSayisi})`,
      `${bildirimSayisi} kez titredi — nöbetçi bunu arıza sanır`);
    o.baglam.navigator.vibrate = eskiVibrate;
  }

  // =========================================================================
  bolum('Kuyruk-dolu bir hata sayılmaz');
  // =========================================================================
  // "sistem yoğun" bir OKUMA hatası değil, bir KAPASİTE bildirimidir.
  // Sayacı artırıp modu durdurursak, geçici bir yoğunluk kalıcı bir arıza
  // gibi görünür ve kullanıcı modu gereksiz yere kapatır.
  {
    const o = ortamYap({
      camAcik: true, streamVar: true,
      fetchCevabi: { basarili: false, neden: 'kuyruk-dolu', hata: 'sistem yoğun' },
    });
    await o.CKYerel.canliAc(true);
    await o.ilerlet(8000);
    await beklet(30);

    ok(o.CKYerel.canli.calisiyor === true,
      'sunucu yoğunken mod DURMUYOR (geçici durum, kalıcı arıza değil)',
      JSON.stringify(o.CKYerel.canli));
    ok(o.CKYerel.canli.ardArdaHata === 0,
      '"kuyruk-dolu" hata sayacını artırmıyor',
      `ardArdaHata: ${o.CKYerel.canli.ardArdaHata}`);
  }

  // =========================================================================
  bolum('Ağ koptuğunda kendini durdurmalı');
  // =========================================================================
  {
    const o = ortamYap({ camAcik: true, streamVar: true, fetchHatasi: true });
    await o.CKYerel.canliAc(true);
    await o.ilerlet(30000);
    await beklet(40);

    ok(o.CKYerel.canli.calisiyor === false,
      'ağ koptuktan sonra mod kendini durdurdu (sonsuza kadar istek atmaz)',
      JSON.stringify(o.CKYerel.canli));
    ok(/ulaşılamıyor|erişilemiyor|ağ/i.test(String(o.CKYerel.sonHata || '')),
      'durma sebebi "sunucuya ulaşılamıyor"', String(o.CKYerel.sonHata));
  }

  // =========================================================================
  bolum('Kapatmak');
  // =========================================================================
  {
    const o = ortamYap({ camAcik: true, streamVar: true });
    await o.CKYerel.canliAc(true);
    const istekSayisiOnce = o.istekLog.length;

    o.CKYerel.canliAc(false);
    await beklet(10);
    await o.ilerlet(10000);
    await beklet(20);

    ok(o.CKYerel.canli.calisiyor === false, 'anahtar kapanınca mod duruyor');
    ok(o.CKYerel.sureciOkuAyar === false, 'tercih kapanıyor');
    ok(o.depolama['ck-sureci-oku'] === '0', 'kapanış cihaza kaydediliyor');
    ok(o.istekLog.length === istekSayisiOnce,
      'kapanınca HİÇBİR istek atılmıyor (sabit ekran yükü yok)',
      `${istekSayisiOnce} -> ${o.istekLog.length}`);
  }

  // =========================================================================
  bolum('GUVENSIZ KAYNAK - sertifika gerekmeden');
  // =========================================================================
  // OLCULEN HATA (kullanici): "Telefona sertifika indirmek ile olacak is
  // degil, musterilerimizi urastirmamiz gerekiyor." Hakli.
  //
  // Duz http adresinde getUserMedia CALISMAZ (guvenli kaynak sarti). Ama
  // telefonun KENDI kamerasi (capture=environment) calisir. Bu bolum o yolun
  // gercekten secildigini olcer: getUserMedia DENENMEMELI.
  {
    // Akis OLMAMALI: guvenli kaynakta tarayici video akisi baslatamaz.
    const o = ortamYap({ guvenliKaynak: false, camAcik: false, streamVar: false });
    // Guvenli kaynakta ortamda mediaDevices OLMAZ (tarayici boyle verir).
    o.baglam.navigator.mediaDevices = undefined;
    o.baglam.isSecureContext = false;
    let yerelAcildi = 0, sheet = 0;
    o.baglam.CKYerelKamera = {
      sureciIstiyor: false,
      ac() { yerelAcildi++; return true; },
      sheetGoster() { sheet++; return true; },
    };

    const istek = o.CKYerel.canliAc(true);
    ok(istek && typeof istek.then === 'function', 'guvenli kaynakta da canliAc soz veriyor');
    await istek;

    ok(yerelAcildi === 1, 'guvenli kaynakta telefonun kendi kamerasi acildi',
      `acildi=${yerelAcildi}`);
    ok(o.Cam.openCalls === 0,
      'guvenli kaynakta video akisi (Cam.open) HIC denenmiyor',
      `Cam.open=${o.Cam.openCalls}`);
    ok(sheet >= 1, 'kamera ekrani acildi (sonuc nereye bakilacak belli)');
    ok(o.CKYerel.canli.calisiyor === true, 'surekli mod guvenli kaynarda da calisiyor',
      JSON.stringify(o.CKYerel.canli));
    ok(o.CKYerel.canli.aydinlatma === 'yerel-kamera',
      'hangi yolun kullanildigi BILINIYOR (sessiz degil)');
    ok(o.baglam.CKYerelKamera.sureciIstiyor === true,
      'surekli kip yerel kameraya iletildi (her plakada tek dokunus)');
  }

  // --- Guvenli kaynakta YEREL yol secilMEMELI ---------------------------
  {
    const o = ortamYap({ camAcik: true, streamVar: true });
    let yerelAcildi = 0;
    o.baglam.CKYerelKamera = {
      ac() { yerelAcildi++; return true; },
      sheetGoster() { return true; },
    };
    await o.CKYerel.canliAc(true);
    ok(yerelAcildi === 0,
      'guvenli kaynakta yerel kamera yolu KULLANILMIYOR (canli onizleme tercih edilir)',
      `yerelAcildi=${yerelAcildi}`);
  }

  // =========================================================================
  bolum('Varsayılan olarak kapalı');
  // =========================================================================
  {
    // Tertemiz depolama: anahtar YOK -> kapalı başlamalı, hiçbir şey atılmamalı
    const o = ortamYap({ camAcik: true, streamVar: true });
    ok(o.CKYerel.sureciOkuAyar === false, 'temiz cihazda varsayılan KAPALI');
    ok(o.CKYerel.canli.calisiyor === false, 'temiz cihazda mod çalışmıyor');
    await o.ilerlet(5000);
    await beklet(20);
    ok(o.istekLog.length === 0, 'kapalıyken 5 saniyede HİÇBİR istek atılmıyor',
      `${o.istekLog.length} istek`);
    ok(o.Cam.openCalls === 0, 'kapalıyken kamera HİÇ açılmıyor');
  }

  // =========================================================================
  clearTimeout(BEKCI);
  console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('TEST ÇÖKTÜ:', e && e.stack ? e.stack : e);
  process.exit(1);
});
