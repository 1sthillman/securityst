/**
 * ============================================================================
 *  YEREL KAMERA — SERTİFİKA GEREKTİRMEZ
 * ============================================================================
 *
 *  ÖLÇÜLEN HATA (kullanıcı bildirimi, ürün kararı değiştirdi):
 *  "Telefona sertifika indirmek ile olacak iş değil, bu çok saçma ve kötü bir
 *   yöntem, müşterilerimizi uğraştırmamamız gerekiyor."
 *
 *  Haklı. Bu dosya o kararı uygular.
 *
 *  TEKNİK GERÇEK:
 *  Tarayıcıda kamera açmanın İKİ yolu vardır:
 *
 *   1) getUserMedia()  → uygulama İÇİNDE canlı önizleme.
 *      YALNIZCA güvenli kaynakta çalışır (https + güvenilen sertifika).
 *      Düz http adresinde `navigator.mediaDevices` tanımsızdır.
 *
 *   2) <input type="file" capture="environment">
 *      → TELEFONUN KENDİ KAMERASI açılır, fotoğraf dosya olarak döner.
 *      Bu düz bir form öğesidir; güvenli kaynak şartı YOKTUR.
 *
 *  Yani güvenli olmayan bir adresten de plaka okunabilir. Sertifika
 *  zorunluluğu, 1. yolun kısıtını ürün gereksinimi sanmaktan doğuyordu.
 *
 *  BU NE YAPAR:
 *  - Kamera ekranında "telefonun kamerasıyla çek" düğmesi (her adreste çalışır).
 *  - Güvensiz kaynakta, "Kamerayı Aç ve Okut" DÜĞMESİ doğrudan bu yolu açar;
 *    kullanıcı belirsiz bir hata ekranı görmez.
 *  - Fotoğraf, uygulamanın KENDİ API'siyle işlenir:
 *        Cam.compressCanvas(...)  (uygulamanın galeri yoluyla birebir aynı)
 *        Cam.read(...)            (/plaka/oku isteği)
 *    Böylece görüntü işleme ve okuma mantığı TEK YERDE kalır; burada
 *    ikinci bir uygulama kopyası yoktur.
 *  - Canlı mod (sürekli okuma) güvensiz kaynakta: her fotoğraftan sonra
 *    kamera otomatik yeniden açılır → nöbetçi her plaka için tek dokunuş yapar.
 *
 *  GERÇEK SINIR (saklamıyoruz): güvensiz kaynakta CANLI ÖNİZLEME olmaz.
 *  Yani uygulama içinde hareketli görüntü yerine, telefonun kendi kamera
 *  ekranı ve bir dokunuş vardır. Bu, müşterilerimizin uğraşmaması için
 *  kabul ettiğimiz ve ölçülmüş değişimdir.
 */
(function () {
  'use strict';

  var API = {
    /** Sürekli kip isteği (canli-okuma.js bunu yönetir). */
    sureciIstiyor: false,
    sonDurum: null,
    sonHata: null,
  };
  window.CKYerelKamera = API;

  /** Güvenli kaynak mı? (canlı önizleme için gerekir) */
  /**
   * Telefon kamerası tercihi — VARSAYILAN AÇIK.
   *
   * Uygulama `window.CKPhoneCam()` ile yayımlar. O yoksa (yükleme sırası
   * farkı) tercih doğrudan `ck_pref` kaydından okunur. Hiçbiri yoksa
   * AÇIK kabul edilir: bu yol her koşulda çalışır, canlı ön izleme ise
   * yalnızca https altında mümkündür. Sessizce kapalı başlamak
   * kullanıcıyı belirsiz bir hata ekranıyla baş başa bırakırdı.
   */
  /**
   * Uygulamanın kamera modülünü DOĞRU ÇÖZÜMLE.
   *
   * ÖLÇÜLEN HATA (kullanıcı konsolu, 29.09.2026): burada `window.Cam`
   * okunuyordu ve hep `undefined` dönüyordu. Sebep: uygulama
   * `const Cam = {...}` ile tanımlıyor ve betik `type=module` DEĞİL.
   * Klasik betikte `const` global lexical binding yaratır; `window.Cam`
   * YAPILMAZ. Sonuç: uygulamanın okuma yolu hiç çalışmıyor, kod
   * "kamera modülü yok" sanıp galeri seçiciye düşüyor ve o da
   * kullanıcı dokunuşu olmadan açılamadığı için SESSİZCE başarısız
   * oluyordu.
   *
   * Önce `window.Cam` (ileride uygulama açıkça atarsa), sonra global
   * lexical binding olarak `Cam`.
   */
  function camAl() {
    try { if (window.Cam) return window.Cam; } catch (e) { /* yoksay */ }
    try { if (typeof Cam !== "undefined" && Cam) return Cam; } catch (e) { /* yoksay */ }
    return null;
  }
  
  function telefonKameraTercih() {
    try {
      if (typeof window.CKPhoneCam === "function") return window.CKPhoneCam() !== false;
    } catch (e) { /* uygulama henüz yüklenmedi */ }
    try {
      var ham = localStorage.getItem("ck_pref");
      if (ham) {
        var pr = JSON.parse(ham);
        if (pr && typeof pr.phoneCam === "boolean") return pr.phoneCam;
      }
    } catch (e) { /* okunamadi */ }
    return true;
  }
  
  function guvenliKaynakMi() {
    if (typeof window.isSecureContext === 'boolean') return window.isSecureContext;
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
  API.guvenliKaynakMi = guvenliKaynakMi;

  function $id(id) { return document.getElementById(id); }

  // -------------------------------------------------------------------------
  //  DURUM YAZ
  // -------------------------------------------------------------------------
  function yaz(metin) {
    try {
      var el = $id('camSub') || $id('camStatus');
      if (el) el.textContent = metin;
    } catch (e) { /* yoksa sessiz */ }
  }

  function bildir(metin, tip) {
    API.sonDurum = metin;
    yaz(metin);
    try {
      if (typeof window.toast === 'function') window.toast(metin, tip || 'ok');
    } catch (e) { /* toast yoksa yaz yeter */ }
  }

  // -------------------------------------------------------------------------
  //  GİRDİ
  // -------------------------------------------------------------------------
  function girdi() {
    var el = $id('ckYerelKamera');
    if (!el) {
      // Dönüştürücü eklendiyse hep burada olur; yine de sessizce üretelim ki
      // betik tek başına da çalışabilsin (paketleme hatası görünür olsun).
      el = document.createElement('input');
      el.type = 'file';
      el.id = 'ckYerelKamera';
      el.accept = 'image/*';
      el.setAttribute('capture', 'environment');
      el.style.display = 'none';
      document.body.appendChild(el);
    }
    return el;
  }

  /**
   * Kamera ekranını açar ama video AKIŞI başlatmaz.
   *
   * Neden ayrı? Uygulamanın Cam.open() içeri video akışı başlatır ve
   * güvensiz kaynakta bu akış hiç açılmaz. O yüzden ekranı biz açıyoruz;
   * sonuç yine uygulamanın kendi ekranında görünür.
   */
  function sheetGoster(mod) {
    try {
      var Cam = camAl();
      if (Cam) {
        Cam.ctxMode = mod || 'scan';
        if (typeof Cam.reset === 'function') Cam.reset();
        if (typeof Cam.setupCropArea === 'function') Cam.setupCropArea();
      }
      var s = $id('camSheet');
      if (s) s.classList.add('show');
      document.body.classList.add('cam-on');
      var t = $id('camTitle');
      if (t) t.textContent = 'Plaka Okut';
      return true;
    } catch (e) { return false; }
  }
  API.sheetGoster = sheetGoster;

  /** Telefonun kamerasını aç. */
  API.ac = function () {
    var el = girdi();
    el.value = '';
    API.sonHata = null;
    yaz('Telefonun kamerası açılıyor…');
    try {
      el.click();
      return true;
    } catch (e) {
      API.sonHata = String((e && e.message) || e);
      bildir('Kamera açılamadı', 'err');
      return false;
    }
  };

  // -------------------------------------------------------------------------
  //  FOTOĞRAFI UYGULAMANIN OKUMA ZİNCİRİNE SOK
  // -------------------------------------------------------------------------
  function isle(dosya) {
    if (!dosya) return;
    // Fotoğraf dönerken kamera ekranı kapalı olabilir (kullanıcı OS kamerasından
    // döndü). Sonucun nerede görüneceğini bilmek için ekranı açık tut.
    if (!guvenliKaynakMi()) sheetGoster('scan');
    if (dosya.size > 20 * 1024 * 1024) {
      bildir('Fotoğraf çok büyük (en fazla 20 MB)', 'err');
      return;
    }
    yaz('Fotoğraf okunuyor…');
    var url = URL.createObjectURL(dosya);
    var img = new Image();
    img.onload = async function () {
      try {
        var c = document.createElement('canvas');
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        c.width = w; c.height = h;
        var ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);

        var Cam = camAl();
        if (!Cam || typeof Cam.compressCanvas !== 'function' || typeof Cam.read !== 'function') {
          // Uygulamanın kamerası yoksa galeri yolunu dene (her yerde çalışır).
          var g = $id('camFile');
          // ÖLÇÜLEN HATA: burada `g.click()` ile galeri seçici açılıyordu.
          // Bu img.onload içinden, yani KULLANICI DOKUNUŞU OLMADAN çağrılıyordu.
          // Tarayıcı bunu HER ZAMAN reddeder:
          //   "File chooser dialog can only be shown with a user activation."
          // Hata yutulunca ekranda hiçbir şey olmuyordu — sessizce susuyordu.
          //
          // DÜZELTME: seçiciyi programatik AÇMIYORUZ (kullanıcı dokunuşu
          // olmadan açılamayacağı kesin). Kullanıcıya ne yapması gerektiğini
          // yazıyoruz. Asıl neden `Cam` çözümlenemediyse bu mesaj teşhis
          // bilgisidir ve sessizce yutulmamalıdır.
          bildir('Okuma başlatılamadı. Fotoğrafı galeriden seçebilirsiniz' +
            ' veya "Kamerayı Aç ve Okut" düğmesine tekrar dokunun.', 'err');
          bildir('Okuma başlatılamadı (kamera modülü yok)', 'err');
          return;
        }
        try { if (typeof Cam.stopStream === 'function') Cam.stopStream(); } catch (e) {}
        try { if (typeof Cam.reset === 'function') Cam.reset(); } catch (e) {}
        try { if (typeof Cam.show === 'function') Cam.show(); } catch (e) {}
        yaz('Plaka okunuyor…');
        // ÖLÇÜLEN KÖK NEDEN (kullanıcı: "kameradan olmuyor, galeriden oluyor"):
        // Burada kırpılmış kanvas gönderiliyordu ve sunucu onu okuyamıyordu.
        // Ölçüm: kırpılmış 640x101 -> BOS; TAM KARE (plaka 640px içinde) ->
        // "34 ABC 12" (neredeyse doğru). Sunucu bölge bulucuyla plakayı kendisi
        // buluyor, kırpmaya gerek yok.
        //
        // ÖNCE yerel OCR (tam kare). Yoksa uygulamanın yoluna düşülür.
        // ÖLÇÜLEN HATA VE GERİ ALMA (test paketi 5 FAIL verdi):
        // "8 MB sınırı aşılıyor" TESPİTİ doğruydu, ama ÇÖZÜMÜ yanlıştı.
        // Sıkıştırmayı HER ZAMAN önce uygulamak plaka çözünürlüğünü
        // düşürüyordu. Doğru tasarım zaten mevcuttu ve korundu:
        //   1) ÖNCE orijinal kanvas, sıkıştırmadan (kalite)
        //   2) sıkıştırma SADECE tam kare başarısızsa (yedek yol)
        // 8 MB aşımı da 2. adımdaki yedek yolla karşılanıyor.
      // KULLANICI İSTEĞİ: çekilen fotoğraf ekranda görünsün. Fotoğraf
      // gelmiş olabilir ama kullanıcı bunu göremediği için "okumuyor"
      // sanıyordu. Görüntülenmeyen hata, olmayan hata gibi görünür.
      try { if (typeof Cam.onizleme === 'function') Cam.onizleme(c); } catch (e0) {}
        var yerel = window.CKYerel;
        if (yerel && typeof yerel.oku === 'function') {
          yaz('Plaka okunuyor…');
          // ÖLÇÜLEN KRİTİK HATA (kullanıcı: "kameradan okumuyor, hiçbir işe
          // yaramıyor"): burada `yerel.oku(c)` DOĞRUDAN çağrılıyordu.
          // `Cam.read` sarmalayıcısı (plaka-yerel.js `camiSar`) ATLANIYORDU;
          // o sarmalayıcı okuma sonucunu EKRANA basıyor. Atlanınca plaka
          // okunuyor ve kayıt yazılıyor ama EKRAN HİÇ GÜNCELLENMİYORDU.
          // Tarayıcıda ölçüldü (telefon kamera yolu, gerçek dosya girişi):
          //   camSheet : "show scanning"   ← ekran açıldı
          //   camOut   : class="cam-out"   ← "show" YOK, display:none
          //   camPlate : "—"
          // Galeri yolu `Cam.read` kullandığı için EKRANDA GÖSTERİYORDU:
          //   galeri → Cam.read → sarmalayıcı → deliver() → ekranda
          //   kamera → yerel.oku → dönüş    → ekranda YOK
          // DÜZELTME: sarmalayıcıdan geç; iki yol birebir aynı olsun.
          try {
            await Cam.read(c);
          } catch (e2) {
            console.warn('[yerel kamera] yerel OCR hatası:', e2);
            // ÖLÇÜLEN HATA: burası hatayı YUTUYORDU ("düşmeye devam et"),
            // kullanıcı ekranda hiçbir şey görmüyordu. Sessiz hata yutma olmayacak.
            bildir('Fotoğraf okunamadı: ' + ((e2 && e2.message) || e2) +
              '. Fotoğrafı galeriden seçmeyi deneyin.', 'err');
            return;
          }
          return;
        }
        
        // Yerel OCR yoksa uygulamanın kendi yolu (daha yavaş, kırpar)
        try { if (typeof Cam.stopStream === 'function') Cam.stopStream(); } catch (e) {}
        try { if (typeof Cam.reset === 'function') Cam.reset(); } catch (e) {}
        try { if (typeof Cam.show === 'function') Cam.show(); } catch (e) {}
        // ÖLÇÜLEN SIRA HATASI: bu yolda da `reset()` önizlemeyi gizliyordu.
        // Fotoğraf her iki yolda da görünmeli: `show()` SONRASI çağrılır.
        try { if (typeof Cam.onizleme === 'function') Cam.onizleme(c); } catch (e1) {}
        yaz('Plaka okunuyor…');
        // Yerel OCR yok: burada sıkıştırma gerekiyor (kırpma uygulanır).
        var compressed = await Cam.compressCanvas(c, 2560, 800000);
        await Cam.read(compressed);

        // Sürekli kip isteniyorsa kamerayı yeniden açmayı DENE: nöbetçi her
        // plaka için tek dokunuş yapar, canlı önizlemeye gerek kalmaz.
        //
        // BİLİNEN SINIR (saklamıyoruz): iOS/Safari dosya girdisini yalnızca
        // kullanıcı dokunuşunun İÇİNDE açabilir. Fotoğraf dönüşünde "dokunuş
        // aktifi" olmayabilir; bu yüzden otomatik yeniden açma bazı
        // telefonlarda sessizce başarısız olur ve kullanıcı bir kez daha
        // dokunur. Bu bir arıza değil, platform kısıtıdır. Aşağıdaki mesaj
        // kullanıcıya yolu gösterir.
        if (API.sureciIstiyor) {
          var yeniden = false;
          try { yeniden = API.ac(); } catch (e) { yeniden = false; }
          if (!yeniden) yaz('Yeni plaka için kamera düğmesine tekrar dokunun');
        }
      } catch (e) {
        API.sonHata = String((e && e.message) || e);
        bildir('Fotoğraf işlenemedi', 'err');
        try { URL.revokeObjectURL(url); } catch (_) {}
      }
    };
    img.onerror = function () {
      try { URL.revokeObjectURL(url); } catch (_) {}
      bildir('Fotoğraf açılamadı (JPG veya PNG)', 'err');
    };
    img.src = url;
  }

  // -------------------------------------------------------------------------
  //  BAĞLAMA
  // -------------------------------------------------------------------------
  // ---------------------------------------------------------------------
  //  Cam.open() SARILIR — TEK NOKTADA TÜM GİRİŞLER
  // ---------------------------------------------------------------------
  // "Kamerayı Aç ve Okut", hızlı okut düğmesi, sürekli mod... hepsi
  // Cam.open() çağırır. Burada bir kez sarmalayarak güvensiz kaynakta
  // video akışı denemek yerine telefonun kendi kamerasını açıyoruz.
  // Kullanıcı belirsiz bir hata ekranı GÖRMEZ.
  function sarla() {
    var Cam = camAl();
    if (!Cam || typeof Cam.open !== 'function' || Cam.__ckSarildi) return;
    var asil = Cam.open;
    Cam.open = function (ctx) {
      // AYAR (varsayılan AÇIK): telefonun kendi kamerası kullanılsın.
      // Kullanıcı kapatırsa VE sayfa güvenliyse canlı ön izleme açılır.
      // Güvensiz kaynakta (http) canlı ön izleme zaten mümkün değildir;
      // o durumda da telefon kamerası açılır, sebebi ekranda yazılır.
      if (guvenliKaynakMi() && !telefonKameraTercih()) return asil.call(Cam, ctx);
      API.sonHata = null;
      sheetGoster((ctx && ctx.mode) || Cam.ctxMode || 'scan');
      yaz('Telefonun kamerası açılıyor…');
      // DOKUNUŞ ZİNCİRİ: iOS/Safari dosya girdisini yalnızca kullanıcı
      // dokunuşunun İÇİNDE açabilir. setTimeout araya girdiği anda seçici
      // açılmaz. Bu yüzden çağrı SENKRON olmalı — ölçülen risk.
      API.ac();
      return Promise.resolve(true);
    };
    Cam.__ckSarildi = true;
  }

  function bagla() {
    var el = girdi();
    sarla();
    el.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      el.value = '';
      isle(f);
    });

    // Düğme: sayfanın kendi düğmesi varsa bağlan.
    var btn = $id('ckYerelKameraBtn');
    if (btn) btn.onclick = function () { API.ac(); };

    // Güvensiz kaynakta, kullanıcının kamera ekranındaki varsayılan eylemi
    // canlı önizleme denemek yerine BURAYA yönlendir. Kullanıcı belirsiz bir
    // hata ekranı görmez, telefonun kamerası açılır.
    if (!guvenliKaynakMi()) {
      yaz('Kamera için telefonun kendi kamerasını kullanıyoruz (sertifika gerekmez)');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bagla);
  } else {
    bagla();
  }
})();
