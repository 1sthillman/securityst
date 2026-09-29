'use strict';
/* ============================================================================
 *  Yerel Plaka Okuma — kulübe bilgisayarındaki sunucudan
 * ----------------------------------------------------------------------------
 * Bu eklenti, uygulamanın plaka okuma akışının BAŞINA girer ve OCR'ı
 * bulut servisleri yerine bilgisayardaki /plaka/oku ucuna yönlendirir.
 *
 * Neden:
 *   - Kulübede internet olmayabilir. Önceden plaka okuma orada duruyordu.
 *   - Fotoğraf üçüncü taraf sunuculara gönderiliyordu (gizlilik).
 *   - OCR anahtarları dosyada düz metin duruyordu.
 *   - Telefonu zorlamak yerine okumayı bilgisayar yapıyor: pil ısınmaz,
 *     telefon kasılmaz, sonuç daha hızlıdır.
 *
 * Uygulamanın kendi mantığı KORUNUR: plaka adaylarını puanlama, bilinen
 * kurye listesiyle eşleştirme, kullanıcıya birden fazla seçenek gösterme.
 * Değişen tek şey "metni kim okuyor" sorusunun cevabıdır.
 *
 * Başarısız olursa uygulamanın kendi yoluna düşülür (tarayıcı Tesseract'i,
 * en son elle giriş) — hiçbir durumda ekran boş kalmaz.
 * ==========================================================================*/

(function () {
  /**
   * Çınarköy Yerel API Anahtarı (GÖMÜLÜ) — KANONİK KOPYA: shared/anahtar.js
   * (tests/test-anahtar.js eşitliğini ölçer).
   *
   * ÖLÇÜLEN HATA (kullanıcı konsolundan): bu dosya anahtarı GÖNDERMİYORDU.
   * Sunucu /plaka/durum ve /plaka/oku uçlarını anahtarla koruyunca telefon
   * "motor yok: Yetkisiz" dedi — yani sistem kendi istemcisiyle ÇALIŞMIYORDU.
   *
   * NOT: kurulum anahtarı (TOKEN) zaman zaman boş olabilir; API anahtarı
   * her zaman gönderilir. İkisi birlikte gönderilir.
   */
  var API_ANAHTARI = 'ck_yk_8f2a1c47b93d5e60a1f7c4b8d29e6035';
  
  /* ÖLÇÜLEN HATA (kullanıcının telefon konsolundan, 29.09.2026):
       [yerel OCR] anahtar alınamadı (1. deneme):
       ReferenceError: TOKEN is not defined   at baslatBir

     KÖK NEDEN: `TOKEN` HİÇ TANIMLANMAMIŞTI — dosyada yalnızca ATANIYORDU
     (satır 340, 523, 686). `ckBasliklar()` bu yüzden savunmacı yazılmıştı:
         if (typeof TOKEN !== 'undefined' && TOKEN) b['X-Sync-Token'] = TOKEN;
     Yani istekler `Authorization: Bearer` ile geçiyor, kurulum anahtarı
     (X-Sync-Token) HİÇ kullanılmıyordu. Dosya strict mode'da olduğu için
     atama `ReferenceError` veriyordu.

     ETKİ: `/plaka/oku` Bearer anahtarıyla çalıştığı için okuma YINE de
     oluyordu; patlama yalnızca açılışta anahtarın saklanmasını engelliyordu.

     DÜZELTME: değişkeni tanımla. Artık kurulum anahtarı da gönderilir ve
     `ckBasliklar` içindeki savunma gereksizleşir (silinmedi: yine de
     kullanıcının elinde TOKEN yoksa hata vermemesi için doğru). */
  var TOKEN = '';

  function ckBasliklar(ekstra) {
    var b = Object.assign({}, ekstra || {});
    b['Authorization'] = 'Bearer ' + API_ANAHTARI;
    if (typeof TOKEN !== 'undefined' && TOKEN) b['X-Sync-Token'] = TOKEN;
    return b;
  }
  
  var CKYerel = {
    hazir: false,
    motor: '',
    sonDurum: null,
    sonHata: null,
    istekSayisi: 0,
    basariliSayisi: 0,
    toplamSure: 0,
  };
  window.CKYerel = CKYerel;

  // ---- yapılandırma -------------------------------------------------------
  var YAPILANDIRMA = (window.OCR_CONFIG && window.OCR_CONFIG.yerel) || {};

/**
 * Sunucu adresi — TEK kaynaktan, İSTEK ANINDA.
 *
 * ÖLÇÜLEN HATA (kullanıcı konsolu, 29.09.2026): adres dosya yüklenirken
 * bir kez hesaplanıp donduruluyordu ve yalnızca location.origin degerine
 * bakiyordu. Kullanici eslesme penceresine sunucu adresini yazdi, ama
 * plaka okuma yine sayfanin kendi kokenine gitti:
 *   GET  https://1sthillman.github.io/plaka/durum -> 404
 *   POST https://1sthillman.github.io/plaka/oku  -> 405
 *
 * Cozum sirasi:
 *   1) eslesmede ogrenilen / kullanicinin girdigi adres (GuvenlikSync.adres)
 *   2) OCR yapilandirmasindaki adres
 *   3) sayfanin kendi kokeni (companion sunucusundan yayinlandiginda dogru)
 */
function kokCoz() {
  try {
    if (window.GuvenlikSync && typeof window.GuvenlikSync.adres === "function") {
      var a = String(window.GuvenlikSync.adres() || "");
      if (a) return a.replace(/\/+$/, "");
    }
  } catch (e) { /* senkron.js henuz yuklenmemis olabilir */ }
  if (ADRES) return String(ADRES).replace(/\/+$/, "");
  if (window.location && window.location.protocol === 'file:') return '';
  return (window.location && window.location.origin) || '';
}
// Geriye uyum: disaridan KOK okunurken guncel degeri gorunsun diye
// islev olarak tutulur (eski kullanimlar KOK + yol idi).
function KOK() { return kokCoz(); }
var AKTIF = true;

function tam(url) { return kokCoz() + url; }

  // ---- durum göstergesi (ekranın köşesine küçük bir rozet) ----------------
  var rozet = null;
  function rozetCiz(metin, iyi) {
    try {
      if (!rozet) {
        rozet = document.createElement('div');
        rozet.setAttribute('style',
          'position:fixed;left:10px;bottom:10px;z-index:9998;display:flex;align-items:center;gap:7px;' +
          'padding:7px 11px;border-radius:999px;font:600 11px/1 -apple-system,system-ui,sans-serif;' +
          'letter-spacing:.02em;pointer-events:none;box-shadow:0 6px 20px -8px rgba(0,0,0,.6);' +
          'transition:opacity .25s');
        document.body.appendChild(rozet);
      }
      rozet.innerHTML =
        '<span style="width:8px;height:8px;border-radius:50%;background:' + (iyi ? '#4ADE80' : '#FFA94D') + '"></span>' +
        '<span>' + metin + '</span>';
      rozet.style.opacity = '1';
    } catch (e) { /* arayüz yoksa sessiz geç */ }
  }

  // ---- sesli/görsel bildirim (uygulamanın kendi toast fonksiyonu varsa) ----
  function bildir(metin, tur) {
    try {
      if (typeof window.toast === 'function') return window.toast(metin, tur);
    } catch (e) { /* yoksay */ }
    try { if (window.console) console.log('[yerel OCR] ' + metin); } catch (e) {}
  }

  // ---- kareyi sunucuya gönder --------------------------------------------
  //
  // KRİTİK TASARIM KARARI: TAM KARE gönderiyoruz, kırpılmış kareyi değil.
  //
  // Uygulama, `shoot()` içinde kareyi kullanıcının kırpma dikdörtgenine göre
  // 640px'e indiriyor ve O KIRPILMIŞ kareyi bize veriyor. Ölçüldü: plaka
  // kırpma bandının dışında kaldığında sunucu hiçbir şey bulamıyor ve
  // nöbetçi "plaka bölgesi bulunamadı" mesajı alıyordu. Gerçek telefon
  // çıktısı bunu doğruladı: 1280x720 kare -> 640x101 kırpım -> başarısız.
  //
  // Sunucu artık sahne içinde plaka buluyor (companion/ocr/bolge.js), bu yüzden
  // ona TAM KARE vermek hem doğru hem de tek denemede çözüm demektir.
  // Kamera akışı kapandıysa (galeriden yükleme) elimizdeki kareyi göndeririz.
  var EN_GENIS = 1280;   // sunucu 900px'te çalışıyor; 1280 fazlası gereksiz

  function cerceveyiCiz(kaynak) {
    var w = kaynak.videoWidth || kaynak.width;
    var h = kaynak.videoHeight || kaynak.height;
    if (!w || !h) return null;
    if (w <= EN_GENIS) return kaynak;
    var o = document.createElement('canvas');
    o.width = EN_GENIS;
    o.height = Math.round((h * EN_GENIS) / w);
    var c = o.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(kaynak, 0, 0, o.width, o.height);
    return o;
  }

  function tuvalHazirla(kaynak) {
    if (!kaynak) return null;
    if (typeof kaynak === 'string') return kaynak;           // zaten data URL
    var d = cerceveyiCiz(kaynak);
    if (!d) return null;
    try { return d.toDataURL('image/png'); } catch (e) { return null; }
  }

  /**
   * Canlı kamera akışından TAM kare yakalar.
   *
   * DİKKAT: `Cam.stream` bir MediaStream nesnesidir, `videoWidth` özelliği
   * YOKTUR; doğrudan onu çizmeye çalışmak sessizce başarısız olur.
   * Çizilecek şey <video> ÖGESİDİR (uygulama `#camVideo` kullanıyor ve
   * `v.srcObject = this.stream` ile bağlıyor).
   *
   * @returns {string|null} PNG data URL
   */
  /**
   * Canlı akıştan tam kare yakalar.
   *
   * ÖLÇÜLEN HATA (kullanıcı: "kamera açılıyor çekiyoruz ama okumuyor"):
   * akış vardı ama yakalama null döndü ve kod sessizce galeri yoluna
   * düştü. İki ayrı sebep vardı ve ikisi de aynı görünüyordu:
   *   a) video henüz dekode olmamış (videoWidth/videoHeight = 0)
   *   b) canvas bağlamı alınamadı ya da çizim hata verdi
   * Artık sebep ÖLÇÜLÜP döndürülüyor; `kare-yok` ayrımı ekranda da
   * görülebiliyor (konsol tek başına yetmiyor — telefon kullanılıyor).
   */
  function tamKareYakala() {
    try {
      var v = document.querySelector('#camVideo') || document.querySelector('video');
      if (!v) return null;
      var w = v.videoWidth || 0;
      var h = v.videoHeight || 0;
      if (!w || !h) return null;                 // akış henüz hazır değil
      var o = document.createElement('canvas');
      o.width = w;
      o.height = h;
      var c = o.getContext('2d');
      if (!c) return null;
      c.drawImage(v, 0, 0, w, h);
      var k = cerceveyiCiz(o);
      return k ? k.toDataURL('image/png') : null;
    } catch (e) {
      return null;
    }
  }

  /** Canlı kamera akışı var mı? (okuma yolunu belirler) */
  function akisVarMi() {
    try {
      var v = document.querySelector('#camVideo') || document.querySelector('video');
      return !!(v && v.videoWidth && v.videoHeight);
    } catch (e) {
      return false;
    }
  }

  // Okuma yolu seçimi: canlı akış varsa tam kare, yoksa uygulamanın karesi.
  // Her okumada yeniden değerlendirilir; akış kamera açılınca doğar, kapanınca
  // kaybolur (galeriden yüklemede akış kapalıdır).
  function akisSec() {
    return akisVarMi();
  }

  /** Kayıtlı kurye plakaları — motor için belirleyici (doğruluk artar). */
  function bilinenPlakalar() {
    try {
      if (Array.isArray(window.COURIERS)) {
        return window.COURIERS
          .map(function (c) { return c && (c.plate || c.key); })
          .filter(Boolean).slice(0, 300);
      }
    } catch (e) { /* yoksay */ }
    return [];
  }

  /**
   * Kullanıcının çizdiği kırpma dikdörtgeni = "plaka burada" ipucu.
   *
   * Neden şart? Ölçülen olay: nöbetçi plakanın etrafına dikdörtgen
   * çiziyor, biz o bilgiyi ATIYORDIK ve sunucu tüm karede kendi
   * aramasını yapıyordu. Sahne fotoğrafında (araç, çit, duvar, tabela)
   * bulucu 8 aday buluyor ama hiçbiri plaka değildi:
   *     bolge=8  ->  ham okuma: "TR | TR | TR | TR"  (mavi TR şeridi!)
   * Kullanıcının niyetini bilen bir sistem, o niyeti kullanmalıdır.
   *
   * Yüzde olarak gönderiyoruz: uygulamanın dikdörtgeni de yüzde tutuyor
   * (cropArea.top / cropArea.height) ve kare boyutları cihazdan cihaza
   * değişir. Sunucu kendi çözünürlüğüne çevirir.
   */
  function kirpmaIpuclari() {
    try {
      if (typeof Cam === 'undefined' || !Cam) return null;
      var alan = Cam.cropArea;
      if (!alan) return null;
      var ust = Number(alan.top), yuk = Number(alan.height);
      if (!isFinite(ust) || !isFinite(yuk)) return null;
      if (yuk < 2 || yuk > 100) return null;            // anlamsız
      return { ust: ust, yukseklik: yuk };
    } catch (e) {
      return null;
    }
  }

  /** Tek bir isteği sunucuya yollar. */
  /**
   * Ağ hatasında sıradaki adrese geçip BİR KEZ daha dener.
   *
   * ÖLÇÜLEN HATA: `tekIstek` tek deneme yapıyordu. Bozuk kayıtlı adres
   * (http://localhost:195) yüzünden hem kamera hem galeri okuması düştü.
   * Kayıt gönderiminin kendi aday rotasyonu vardı; plaka okumada yoktu.
   */
  async function tekIstek(veri) {
    try {
      return await tekIstekBir(veri);
    } catch (e) {
      if (!e || !e.agHatasi) throw e;
      var yeni = "";
      try {
        if (window.GuvenlikSync && typeof window.GuvenlikSync.sonrakiAdres === "function") {
          yeni = window.GuvenlikSync.sonrakiAdres();
        }
      } catch (x) { yeni = ""; }
      if (!yeni) throw e;
      console.warn("[yerel OCR] " + e.message + " -> sıradaki adres denenecek: " + yeni);
      return await tekIstekBir(veri);
    }
  }

  async function tekIstekBir(veri) {
    var t0 = Date.now();
    CKYerel.istekSayisi++;
    // Zaman aşımı: sunucu yanıt vermezse telefon sonsuza kadar beklemez.
    // AbortController desteklenmiyorsa (çok eski tarayıcı) normal fetch'e
    // düşülür — yeni bir hata YARATMAYACAK.
    var zamanAsimiMs = 20000;
    var istek = null;
    var denetleyici = null;
    try {
      if (typeof AbortController === 'function') {
        denetleyici = new AbortController();
        istek = fetch(tam('/plaka/oku'), {
          method: 'POST',
          headers: ckBasliklar({ 'Content-Type': 'application/json' }),
          signal: denetleyici.signal,
          body: JSON.stringify({
            gorsel: veri,
            bilinenPlakalar: bilinenPlakalar(),
            ipucu: kirpmaIpuclari(),
          }),
        });
      }
    } catch (e) { istek = null; }

    var zamanlayici = null;
    if (denetleyici) {
      zamanlayici = setTimeout(function () { denetleyici.abort(); }, zamanAsimiMs);
    }

    var r;
    try {
      r = await (istek || fetch(tam('/plaka/oku'), {
        method: 'POST',
        headers: ckBasliklar({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          gorsel: veri,
          bilinenPlakalar: bilinenPlakalar(),
          ipucu: kirpmaIpuclari(),
        }),
      }));
    } catch (e) {
      // İptal edildi mi, yoksa bağlantı mı yok?
      var iptalMi = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
      var hata = new Error(iptalMi
        ? 'sunucu ' + Math.round(zamanAsimiMs / 1000) + ' saniyede yanıt vermedi'
        : 'sunucuya ulaşılamadı');
      // AYRIM (ölçümle): zaman aşımı sunucunun YAVAŞ olduğunu gösterir —
      // adresi değiştirmek yanlış olur. Ağ hatası ise adresin YANLIŞ
      // olduğunu gösterir; sıradaki adres denenmeli.
      if (!iptalMi) hata.agHatasi = true;
      throw hata;
    } finally {
      if (zamanlayici) clearTimeout(zamanlayici);
    }
    if (!r.ok) {
      var hataGovde = null;
      try { hataGovde = await r.json(); } catch (e) { /* yoksay */ }
      // 401: anahtar yok/yanlış -> /eslesme'den tazele
      if (r.status === 401) {
        TOKEN = await anahtariTazele();
        throw new Error('anahtar tazelendi, tekrar deneyin');
      }
      throw new Error((hataGovde && hataGovde.error) || ('sunucu ' + r.status));
    }
    var sonuc = await r.json();
    sonuc.sureMs = Date.now() - t0;
    CKYerel.toplamSure += sonuc.sureMs;
    if (sonuc.basarili) {
      CKYerel.basariliSayisi++;
      CKYerel.sonHata = null;
    } else {
      CKYerel.sonHata = sonuc.hata || 'okunamadı';
    }
    return sonuc;
  }

  /**
   * Okuma.
   *
   * TASARIM: Canlı kamera akışı varsa **doğrudan TAM KARE** gönderilir.
   *
   * Ölçüm bunu dayandırıyor:
   *   * Uygulamanın kırpması 640px genişliğe indiriliyor, tam kare 1280px.
   *     Yani tam kare plakada DAHA FAZLA piksel demek — çözünürlük üstün.
   *   * Kırpma plakayı kesebiliyor (bildirilen hata tam olarak buydu).
   *     Tam kare hiçbir şeyi kesmez.
   *   * Kırpma önce denenirse ve plaka dışarıdaysa boşa ~3 saniye geçiyor
   *     (ölçüldü: toplam 11.1 sn).
   *
   * Bu yüzden akış varsa tek istek yeter. Akış yoksa (galeriden yükleme)
   * elimizdeki kare gönderilir; o zaman kırpma da elin tek şansıdır.
   *
   * Yine de emniyet kemeri: gönderilen kare okunamazsa ve elimizde ikinci bir
   * görüntü varsa (akış kapandıysa) bir kez daha denenir.
   */
  async function oku(kaynak) {
    if (!AKTIF) return { basarili: false, hata: 'sunucu adresi bilinmiyor' };

    var tam = akisSec() ? tamKareYakala() : null;
    // ÖLÇÜLEN HATA: akış vardı ama kare bir kez alınamadıysa kod galeri
    // yoluna düşüyordu; `kaynak` kamera karesi olmadığı için orası da
    // boş dönüyor ve kullanıcı EKRANDA HİÇBİR ŞEY görmüyordu.
    // Kamera akışı ilk karelerde henüz dekode olmamış olabiliyor; bir kez
    // kısa bekleyip tekrar denemek ölçülen bu boşluğu kapatıyor.
    if (!tam && akisVarMi()) {
      console.warn('[yerel OCR] kamera akışı var ama kare alınamadı — tekrar deneniyor');
      await new Promise(function (coz) { setTimeout(coz, 350); });
      tam = tamKareYakala();
    }
    if (!tam && akisVarMi()) {
      console.warn('[yerel OCR] kare yine alınamadı (videoWidth/videoHeight hazır değil)');
    }
    if (tam) {
      // TANI: gerçek telefonda akış her zaman bulunamıyor olabilir. Neyin
      // gönderildiğini konsola yazmadan teşhis koymak imkânsız.
      console.log('[yerel OCR] gönderilen: TAM KARE (' + gorselOlcu(tam) + ')' +
        ' ipucu=' + ipucuYaz(kirpmaIpuclari()));
      var sonuc = await tekIstek(tam);
      sonuc.tamKare = true;
      console.log('[yerel OCR] tam kare sonucu: basarili=' + sonuc.basarili +
        ' plaka=' + (sonuc.plaka || '-') + ' bolge=' + sonuc.bolgeler +
        ' kaynak=' + (sonuc.bulunanBolge || '-') + ' neden=' + (sonuc.neden || '-') +
        ' sure=' + sonuc.sureMs + 'ms');
      hamYaz(sonuc);
      return sonuc;
    }

    // AYIRT EDİCİ NEDEN: "görüntü alınamadı" iki ayrı hatayı birleştiriyordu
    // (kameradan kare yok / galeriden görsel yok) ve ikisi de ekranda aynı
    // sessizliğe dönüşüyordu.
    var veri = tuvalHazirla(kaynak);
    if (!veri) {
      var neden = akisVarMi() ? 'kare-yok' : 'gorset-yok';
      var ipucu = akisVarMi()
        ? 'Kamera açın ve plakayı kadraja alın, sonra tekrar çekin'
        : 'Görüntü yüklenemedi. Galeriden başka bir fotoğraf deneyin';
      console.warn('[yerel OCR] görüntü alınamadı (neden=' + neden + ')');
      return { basarili: false, hata: 'görüntü alınamadı', neden: neden, ipucu: ipucu };
    }
    // ÖLÇÜLEN KRİTİK HATA (kullanıcı: "ne galeriden ne kameradan okunmuyor"):
    // buradaki log satırı, daha önce eklenip SONRA geri alınan `tamKare`
    // değişkenine referans veriyordu. Değişken kaldırıldı, referans kaldı:
    //   ReferenceError: tamKare is not defined  (plaka-yerel.js:420)
    // `oku()` İLK satırda çöküyor, `Cam.read` bunu yakalayıp uygulamanın
    // BULUT zincirine düşüyordu ("Tüm OCR API'leri başarısız"). Yani hem
    // galeri hem kamera yolu ölüydü — ve sebep sessizdi.
    console.log('[yerel OCR] gönderilen: KIRPILMIŞ KARE (' + gorselOlcu(veri) + ')' +
      ' ipucu=' + ipucuYaz(kirpmaIpuclari()) + ' — akış yok, uygulamanın karesi');
    var sonucK = await tekIstek(veri);
    console.log('[yerel OCR] kırpma sonucu: basarili=' + sonucK.basarili +
      ' plaka=' + (sonucK.plaka || '-') + ' bolge=' + sonucK.bolgeler +
      ' neden=' + (sonucK.neden || '-') + ' sure=' + sonucK.sureMs + 'ms');
    hamYaz(sonucK);
    return sonucK;
  }

  /**
   * Tesseract'in gerçekte ne okuduğunu konsola yazar.
   *
   * Neden şart? Okuma başarısız olduğunda elimizde tek bilgi "okunamadı"dır.
   * Oysa motor birden çok ön işleme + PSM denemiş ve HANGİSİNDE ne gördüğünü
   * biliyordur. Bu satır olmadan "kamera yanlış kadrajlandı" ile "ön işleme
   * plakayı bozdu" ayrımı YAPILAMAZ. Ham çıktı olmadan teşhis deneme-yanılma
   * olurdu.
   */
  function hamYaz(sonuc) {
    if (!sonuc) return;
    if (sonuc.basarili) return;                       // başarılıyken gürültü yaratmayalım
    var ham = (sonuc.ham || '').slice(0, 300);
    console.log('[yerel OCR] ham okuma (Tesseract ne gördü): "' + ham + '"');
    if (!ham) console.log('[yerel OCR] ham okuma BOŞ — motor hiçbir metin bulamadı ' +
      '(bölge bulunamadı ya da görüntü okunamaz)');
    if (Array.isArray(sonuc.adaylar) && sonuc.adaylar.length) {
      console.log('[yerel OCR] adaylar: ' + sonuc.adaylar.map(function (a) {
        return a.plaka + '(' + a.puan + '/yapi' + a.yapi + '/guven' + a.ocrGuven + ')';
      }).join(', '));
    }
  }

  /** İpucu nesnesini okunur biçime çevir (tanı amaçlı). */
  function ipucuYaz(i) {
    if (!i) return 'yok';
    return 'ust=' + Math.round(i.ust) + '% yuk=' + Math.round(i.yukseklik) + '%';
  }

  /** Base64 data URL'den piksel ölçüsünü çıkar (tanı amaçlı). */
  function gorselOlcu(veri) {
    try {
      var uygun = /^data:image\/(\w+);base64,(.+)$/.exec(veri);
      if (!uygun) return 'bilinmiyor';
      var bayt = atob(uygun[2]);
      // PNG başlığı: 8 imza + 4 uzunluk + 4 "IHDR" + 4 genişlik + 4 yükseklik
      if (bayt.length > 24 && bayt.charCodeAt(12) === 73 && bayt.charCodeAt(13) === 72) {
        var w = (bayt.charCodeAt(16) << 24) | (bayt.charCodeAt(17) << 16) |
                (bayt.charCodeAt(18) << 8) | bayt.charCodeAt(19);
        var h = (bayt.charCodeAt(20) << 24) | (bayt.charCodeAt(21) << 16) |
                (bayt.charCodeAt(22) << 8) | bayt.charCodeAt(23);
        return w + 'x' + h + ' ' + Math.round(bayt.length / 1024) + 'KB';
      }
      return uygun[1] + ' ' + Math.round(bayt.length / 1024) + 'KB';
    } catch (e) {
      return 'bilinmiyor';
    }
  }

  /** Sunucunun "neden" koduna göre kullanıcıya en doğru eylemi söyleyen mesaj. */
  function ihtiyacaGoreMesaj(sonuc) {
    var n = (sonuc && sonuc.neden) || '';
    if (n === 'kirpma-plaka-icermiyor' || n === 'plaka-bulunamadi') {
      return 'Kamerayı biraz geri çekip plakanın TAMAMINI çerçeveye alın';
    }
    if (n === 'gorsel-kucuk') {
      return 'Kamerayı plakaya yaklaştırın';
    }
    if (n === 'doygun' || n === 'tek-renk') {
      return 'Kamera kapalı ya da görüntü boş — kamerayı açın ve plakaya doğrultun';
    }
    if (n === 'asiri-gurultulu') {
      return 'Görüntü çok gürültülü — sabit ışıkta plakaya yaklaştırın';
    }
    // ÖLÇÜLEN HATA (29.09.2026): kamera akışı vardı ama kare alınamadığında
  // kullanıcı EKRANDA HİÇBİR ŞEY görmüyordu. Bu iki durum genel
  // 'okunamadı' mesajına karışıyordu. Artık ayrı ayrı bildiriliyor.
  if (n === 'kare-yok') {
    return 'Kameradan görüntü alınamadı — kamera açılana bir saniye bekleyip tekrar çekin';
  }
  if (n === 'gorset-yok') {
    return 'Görüntü yüklenemedi — galeriden başka bir fotoğraf deneyin';
  }
  // Sunucu kendi ipucunu gönderdiyse o daha güvenilirdir.
  if (sonuc && sonuc.ipucu) return String(sonuc.ipucu);
  if (n === 'motor-yok') {
      return 'Plaka motoru yüklenemedi — bilgisayardaki programı yeniden başlatın';
    }
    return 'Plaka okunamadı — plakayı çerçeveye alıp tekrar deneyin';
  }

  /** Eşleşme anahtarını sunucudan al (panelde görünür; ayrıca girilmez). */
  async function anahtariTazele() {
    try {
      var r = await fetch(tam('/eslesme'), { cache: 'no-store', headers: ckBasliklar() });
      var d = await r.json();
      TOKEN = d.token || TOKEN;
      return TOKEN;
    } catch (e) { return TOKEN; }
  }

  // ---- uygulamanın OCR nesnesini bul --------------------------------------
  //
  // DİKKAT: Uygulama OCR motorunu `const Cam = { ... }` olarak tanımlıyor.
  // Bir klasik betikteki `const` global SÖZELSKOP'a düşer; `window` özelliği
  // OLMAZ. Bu yüzden `window.Cam` undefined dönüyor ve eklenti hiç bağlanamıyordu.
  // Doğru yol: çıplak tanımlayıcıyı `typeof` ile sormak (sözel bağlamaları da
  // görür), sonra pencereyi de kontrol etmek.
  function camBul() {
    try { if (typeof Cam !== 'undefined' && Cam) return Cam; } catch (e) { /* yoksay */ }
    if (window.Cam) return window.Cam;
    return null;
  }

  // ---- uygulamanın OCR akışına bağlan -------------------------------------
  function bagla() {
    if (!AKTIF) {
      rozetCiz('Sunucu yok — elle giriş', false);
      return;
    }
    var hemen = camBul();
    if (hemen) { camiSar(hemen); return; }

    // Uygulama henüz yüklenmemiş olabilir (betik sırası). Kısa aralıklarla
    // dene, sonra vazgeç ve kullanıcıyı bilgilendir.
    var deneme = 0;
    var zamanlayici = setInterval(function () {
      deneme++;
      var cam = camBul();
      if (cam) {
        clearInterval(zamanlayici);
        camiSar(cam);
      } else if (deneme > 60) {
        clearInterval(zamanlayici);
        rozetCiz('Yerel OCR bağlanamadı', false);
      }
    }, 250);
  }

  function camiSar(Cam) {
    if (Cam.__yerelSarildi) return;
    Cam.__yerelSarildi = true;
    var asilRead = Cam.read.bind(Cam);

    Cam.read = async function (kaynak) {
      if (!AKTIF) return asilRead(kaynak);
      if (this.busy) { console.warn('[yerel OCR] zaten okuma yapılıyor'); return; }
      var tBaslangic = Date.now();

      this.busy = true;
      this.scanning(true);
      rozetCiz('Okunuyor...', true);

      // Yavaş ağ göstergesi: 2 saniyeyi geçtiyse kullanıcıya ne kadar
      // beklediğini söyler. Normalde (ölçülen ~0,3 sn) hiç görünmez.
      var yavasGosterge = setTimeout(function () {
        if (!Cam.busy) return;
        var gecen = Math.round((Date.now() - tBaslangic) / 100) / 10;
        rozetCiz('Okunuyor... ' + gecen + ' sn', true);
      }, 2000);

      try {
        var sonuc = await oku(kaynak);

        if (sonuc && sonuc.basarili) {
          clearTimeout(yavasGosterge);
          this.prog(100);
          setTimeout(function () { selfProgOff(this); }.bind(this), 300);
          this.busy = false;
          this.scanning(false);
          this.rawText = sonuc.plaka;
          rozetCiz('Yerel motor · ' + sonuc.sureMs + ' ms', true);

          // Aday puanlaması uygulamanın kendi mantığıyla yapılır
          var cands = [];
          if (typeof window.plateCandidates === 'function') {
            cands = window.plateCandidates(sonuc.plaka, 90) || [];
          }
          if (!cands.length) {
            cands = [{ plate: sonuc.plaka, score: 90 }];
          }
          this.deliver(cands, [sonuc.plaka], []);
          return;
        }

        // Sunucu okuyamadı: kullanıcıya net ve eyleme dönük mesaj ver,
        // sonra uygulamanın kendi yoluna bırak (Tesseract.js / elle giriş).
        // Mesaj neden KODUNA göre seçilir. Sunucunun metni her zaman
        // doğru eylemi önermiyordu: örn. kırpma bandı plakayı içermiyorsa
        // "kamerayı plakaya yaklaştırın" demek yanıltıcıdır — plaka çok iyi
        // görünüyor olabilir, sadece kadraj dışında.
        clearTimeout(yavasGosterge);
        var mesaj = ihtiyacaGoreMesaj(sonuc);
        console.warn('[yerel OCR] ' + mesaj + ' [neden=' + ((sonuc && sonuc.neden) || '?') + ']');
        rozetCiz('Okunamadı', false);
        this.busy = false;
        this.scanning(false);
        this.say('Plaka okunamadı');
        this.status(mesaj + ' — elle girmek için "Yaz" düğmesine tıklayın', true);
        bildir(mesaj + ' — "Yaz" ile elle girebilirsiniz', 'warn');
      } catch (e) {
        clearTimeout(yavasGosterge);
        console.warn('[yerel OCR] hata:', e);
        this.busy = false;
        this.scanning(false);
        rozetCiz('Bağlantı yok', false);
        // Sunucuya hiç ulaşılamadıysa uygulamanın yoluna düş
        return asilRead(kaynak);
      }
    };

    function selfProgOff(cam) { if (typeof cam.progOff === 'function') cam.progOff(); }

    // Uygulamanın tarayıcı Tesseract yükleyicisini devre dışı bırak:
    // internet yoksa zaten başarısız olacak ve yanıltıcı bir hata verecek.
    // Sunucu her zaman birincil yoldur.
    if (typeof Cam.worker === 'function') {
      Cam.worker = async function () {
        throw new Error('Tarayıcı OCR kapalı — plaka okuma bilgisayardaki sunucudan yapılıyor');
      };
      Cam.releaseEngine = function () {};
    }
  }

  // ---- genel API (hata ayıklama ve otomatik test için) ---------------------
  CKYerel.oku = oku;
  CKYerel.durum = function () {
    return {
      hazir: CKYerel.hazir, adres: KOK(), motor: CKYerel.motor,
      istek: CKYerel.istekSayisi, basarili: CKYerel.basariliSayisi,
      ortalamaSure: CKYerel.basariliSayisi ? Math.round(CKYerel.toplamSure / CKYerel.basariliSayisi) : 0,
      sonHata: CKYerel.sonHata,
    };
  };
  CKYerel.bagli = function () {
    var cam = camBul();
    return !!(cam && cam.__yerelSarildi);
  };

  // ---- başlangıç -----------------------------------------------------------
  function baslat() {
    bagla();
    CKYerel.hazir = AKTIF;
    if (!AKTIF) return;

    /* ÖLÇÜLEN HATA: sıra ters ve hata yutuluyordu. Canlı ölçüm:
         /plaka/durum -> 401  (anahtarsız soruluyordu)
         /eslesme     -> 200  (token BURADA geliyor)
       Kullanıcı ekranda "Sunucuya ulaşılamıyor" görüyordu ama sunucu
       sağlamdı. Doğru sıra: ÖNCE anahtar, SONRA durum. */
    var DENEME_SINIRI = 3;

    function rozetTemizle() { if (rozet) rozet.style.opacity = '0'; }

    async function baslatBir(deneme) {
      // 1) ANAHTAR — sunucudaki tek doğruluk kaynağı. Durum yoklamasından
      //    ÖNCE gelmeli; yoksa istek 401 alır (ölçüldü).
      try {
        var e = await (await fetch(tam('/eslesme'), { cache: 'no-store', headers: ckBasliklar() })).json();
        if (e && e.token) TOKEN = e.token;
      } catch (h) {
        console.warn('[yerel OCR] anahtar alınamadı (' + (deneme + 1) + '. deneme):', h);
      }

      // 2) DURUM — anahtarla birlikte.
      try {
        var r = await fetch(tam('/plaka/durum'), { cache: 'no-store', headers: ckBasliklar() });
        var d = await r.json();
        CKYerel.motor = d.motor || 'bilinmiyor';
        CKYerel.sonDurum = d;
      } catch (h2) {
        // Sunucuya GERÇEKTEN ulaşılamadı.
        console.warn('[yerel OCR] sunucuya ulaşılamadı (' + (deneme + 1) + '. deneme):', h2);
        if (deneme < DENEME_SINIRI) {
          // KENDİ KENDİNİ İYİLEŞTİRME: artan aralıkla yeniden dene.
          setTimeout(function () { baslatBir(deneme + 1); }, 1200 * (deneme + 1));
        } else {
          rozetCiz('Sunucuya ulaşılamıyor', false);
        }
        return;
      }

      // 3) Sunucu erişilebilir. Bundan sonrası MOTOR durumu;
      //    "sunucuya ulaşılamıyor" YAZILMAZ.
      if (!d.aktif) {
        rozetCiz('Yerel motor yok — elle giriş', false);
        console.warn('[yerel OCR] motor yok:', d.sebep || d.error);
        return;
      }
      rozetCiz('Yerel plaka motoru', true);

      // 4) Motoru ısıt — bu sunucu için OPSIYONEL; hatası ayrı bildirilir.
      try {
        await fetch(tam('/plaka/hazirla'), { headers: ckBasliklar() });
      } catch (h3) {
        console.warn('[yerel OCR] motor ısıtılamadı (sunucu erişilebilir):', h3);
      }
    }

    baslatBir(0);

    // Sekme kapanırken rozeti temizle
    window.addEventListener('pagehide', function () {
      rozetTemizle();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', baslat);
  } else {
    baslat();
  }
})();
