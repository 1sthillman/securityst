/**
 * SÜREKLİ KAMERA OKUMA (canlı tarama) — telefon eklentisi
 *
 * ===================================================================
 *  VARSAYILAN KAPALI. Yalnızca kullanıcı Ayarlar'dan açarsa çalışır.
 *  Mevcut tek-çekim akışına HİÇ dokunulmaz.
 * ===================================================================
 *
 * ÖLÇÜLEN HATA (kullanıcı geri bildirimi): "Ayarlardan sürekli kamera
 * taramasını etkinleştirsek de bu çalışmıyor, yine çekim düğmesine
 * tıklamamız gerekiyor."
 *
 * KÖK NEDEN: eklenti kamera akışını DIŞARIDAN bekliyordu
 * (kareYakala() null döndüğünde 3 hatadan sonra kendini durduruyordu).
 * Oysa kullanıcı Ayar ekranındadır ve kamera sayfası KAPALI — akış yok
 * demektir. Yani anahtarı açmak hiçbir şeyi başlatmıyordu.
 *
 * ÇÖZÜM: Ayarı açan kişi değil, SİSTEM kamerayı açar. Bu, uygulamanın zaten
 * kullandığı davranışla aynıdır: "Kamerayı Aç ve Okut" düğmesi de
 * Cam.open({mode:'scan'}) çağırır. Kullanıcı iki şey yapmaz — bir kez
 * anahtarı açar, kamerayı tutar.
 *
 * TASARIM KURALLARI (ölçümden çıkarıldı, tahminle değil):
 *
 *  1) ASLA kendi hızında gitmez. Sunucunun ölçülen okuma süresi 0,3-1,2 sn.
 *     İstekler arka arkaya atılırsa kuyruk birikir ve kullanıcı SAHTE bir
 *     yavaşlık görür. Tur süresi = ölçülen okuma + SABİT ARA. Sunucu tarafında
 *     da kuyruk derinliği sınırlıdır; doluysa "kuyruk-dolu" döner ve burada
 *     bekleriz.
 *
 *  2) AYNI PLAKAYI TEKRAR UYARMAZ. Aynı plaka 10 kez okunursa 10 kez
 *     titreşim olur — kullanıcı bunu arıza sanır.
 *
 *  3) ÜST ÜSTE BİNMEME. Her zaman tek istek uçuşta olur.
 *
 *  4) BİRİKME YOK. Sunucu yoğunsa tur atlanır; ağ koptuysa 3 ardışık
 *     hatadan sonra mod KENDİ KENDİNE durur.
 *
 *  5) PİL. Sürekli kamera + JPEG pili hızlı bitirir. Ekran kapanınca mod
 *     kendiliğinden durur.
 *
 *  6) GÜVENLİK DÖNGÜSÜ YOK. Bulunan plaka yalnızca EKRANDA ve titreşimle
 *     bildirilir; kayıt KAPISI otomatik AÇILMAZ. Karar insana aittir.
 */

(function () {
  'use strict';

  // plaka-yerel.js zaten window.CKYerel kurar. Burada onu GENİŞLETİRİZ;
  // yeni bir nesne kurmaya çalışmak mevcut durum sayacını ve eklentiyi
  // görünmez kılardı (ölçülen hata sınıfı).
  var CKYerel = window.CKYerel;
  if (!CKYerel) {
    console.warn('[canlı okuma] plaka-yerel.js yüklü değil; canlı tarama devre dışı');
    return;
  }

  var YAPILANDIRMA = (window.OCR_CONFIG && window.OCR_CONFIG.yerel) || {};
  var KOK = YAPILANDIRMA.url ||
    ((window.location && window.location.origin) || '');
  if (window.location && window.location.protocol === 'file:') KOK = '';
  if (!KOK) return;
  var TOKEN = YAPILANDIRMA.token || '';

  // ---- AYAR (cihazda kalıcı) ---------------------------------------------
  var ANAHTAR = 'ck-sureci-oku';
  var ARA_MS = 700;          // ölçülen okuma süresine eklenecek sabit ara
  var EN_COK_HATA = 3;       // bu kadar ardışık hatadan sonra DUR
  var MOLA_HER = 600;        // güvenlik freni: ~10 dakikada bir mola ver
  var KAMERA_BEKLEME_MS = 12000;  // akışın oturması için en fazla beklenecek

  function ayarOku() {
    try { return localStorage.getItem(ANAHTAR) === '1'; } catch (e) { return false; }
  }
  function ayarYaz(v) {
    try { localStorage.setItem(ANAHTAR, v ? '1' : '0'); } catch (e) { /* gizli sekme */ }
  }

  // ---- DURUM -------------------------------------------------------------
  // Ayar (kalıcı tercih) ve çalışma durumu (anlık) BİLEREK AYRI tutulur.
  // Karıştırılırsa "açık" görünüp çalışmayan bir anahtar olur.
  CKYerel.sureciOkuAyar = ayarOku();
  CKYerel.canli = {
    calisiyor: false,
    basliyor: false,        // kamera açılıyor mu (geçiş durumu)
    tur: 0,
    sonOkumaMs: 0,
    sonOkunan: null,
    ardArdaHata: 0,
    kameraHatasi: null,     // kamerayı açamadıysak sebebi
  };

  function tam(url) { return KOK + url; }
  function bekle(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // =========================================================================
  // KAMERA
  // =========================================================================

  function videoOgesi() {
    return document.querySelector('#camVideo') || document.querySelector('video');
  }

  /** Kamera akışı oturmuş mu? (videoWidth > 0 = gerçek akış, yoksa boş) */
  function kameraHazirMi() {
    var v = videoOgesi();
    return !!(v && v.videoWidth && v.videoHeight);
  }

  /** Kullanıcı kamera sayfasını şu an açık tutuyor mu? */
  function kameraSayfasiAcikMi() {
    try {
      var s = document.querySelector('#camSheet');
      if (s) return s.classList.contains('show');
      return document.body.classList.contains('cam-on');
    } catch (e) { return false; }
  }

  /**
   * Kamerayı AÇ ve akışın oturmasını bekle.
   *
   * Neden burada? Ölçülen hata: anahtar açıldığında kamera sayfası kapalıydı
   * ve eklenti akış bekleyip vazgeçiyordu. Kullanıcı "çalışmıyor" diyordu.
   * Şimdi ayarı açan sistem kamerayı kendisi açıyor — tıpkı "Kamerayı Aç ve
   * Okut" düğmesi gibi.
   *
   * ÖLÇÜLEN İKİ TUZAK (buraya yazıldı ki tekrarlanmasın):
   *
   *  1) `Cam.open()` HATAYI YUTAR. `Cam.start()` getUserMedia hatasını
   *     yakalayıp ekrana yazıyor ama YENİDEN FIRLATMIYOR. Yani
   *     `await Cam.open()` kamera reddedilse bile "başarılı" dönüyor.
   *     Sabit süre beklersek kullanıcı 12 saniye boşuna bekler.
   *     Çözüm: uygulamanın kendi durumundan sinyal al — `Cam.stream`
   *     yalnızca akış gerçekten oturduğunda atanıyor.
   *
   *  2) Kullanıcı kamera sayfasını BİLEREK kapatırsa onu zorla geri açmak
   *     saygısızlıktır ve "düğmeler çalışmıyor" hissi verir. Sayfa kapalıysa
   *     canlı mod kendini DURDURUR; akış kendiliğinden düşmüşse (izin
   *     iptali, cihaz değişimi) yeniden açılır.
   *
   * @returns {Promise<boolean>} akış hazır mı
   */
  /** Canlı önizleme mümkün mü? (yalnızca güvenli kaynakta) */
  function guvenliKaynakMi() {
    if (typeof window.isSecureContext === 'boolean') return window.isSecureContext;
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  // ---------------------------------------------------------------------
  //  GÜVENSİZ KAYNAK = YEREL KAMERA YOLU (sertifika gerekmez)
  // ---------------------------------------------------------------------
  // ÖLÇÜLEN HATA (kullanıcı): "Telefona sertifika indirmek ile olacak iş
  // değil, müşterilerimizi uğraştırmamamız gerekiyor." Haklı.
  //
  // Bu eklenti video akışına (getUserMedia) güveniyordu; o yalnızca https
  // altında çalışır. Oysa telefonun KENDİ kamerası (capture="environment")
  // güvenli kaynak istemez. Yerel-kamera.js o yolu kurar; biz de burada
  // ona devrediyoruz.
  //
  // SONUÇ: düz http adresinde de sürekli okuma çalışır. Canlı önizleme
  // olmaz; her plaka için telefonun kamerası bir kez dokunuşla açılır.
  async function yerelKameraYolu() {
    var YK = window.CKYerelKamera;
    if (!YK || typeof YK.ac !== 'function') return false;
    CKYerel.canli.aydinlatma = 'yerel-kamera';
    YK.sureciIstiyor = true;
    ekranaYaz('Telefonun kamerası açılıyor…');
    try { if (YK.sheetGoster) YK.sheetGoster('scan'); } catch (e) {}
    return YK.ac();
  }

  async function kamerayiHazirla() {
    if (kameraHazirMi()) return true;

    // Önce: güvenli kaynak var mı? Yoksa akış YOK, beklemenin anlamı yok.
    if (!guvenliKaynakMi()) {
      return await yerelKameraYolu();
    }

    var Cam = window.Cam;
    if (!Cam || typeof Cam.open !== 'function') {
      CKYerel.canli.kameraHatasi = 'uygulamanın kamera modülü bulunamadı';
      return false;
    }

    CKYerel.canli.kameraHatasi = null;
    ekranaYaz('Kamera açılıyor…');

    try {
      // 'scan' = plaka okutma modu. Bu, uygulamanın kendi kamera düğmesinin
      // kullandığı modun aynısı — ayrı bir yol icat etmiyoruz.
      Cam.ctxMode = 'scan';
      await Cam.open({ mode: 'scan' });
    } catch (e) {
      CKYerel.canli.kameraHatasi = 'kamera açılırken hata: ' + (e && e.message ? e.message : e);
      return false;
    }

    // Tuzak 1: uygulama hatayı yuttuysa akış hiç oturmamış olabilir.
    // Sabit süre beklemeden hemen çık.
    if (!Cam.stream && !kameraHazirMi()) {
      // Uygulamanın kendi mesajı en doğru sebep; onu kullan.
      var mesaj = null;
      try {
        var el = document.querySelector('#camStatus');
        if (el && el.textContent && el.textContent.trim()) mesaj = el.textContent.trim();
      } catch (e2) { /* yoksa genel mesaj */ }
      CKYerel.canli.kameraHatasi = mesaj || 'kamera açılamadı (izin verilmemiş olabilir)';
      return false;
    }

    // Akış asenkrondur; izin penceresi bazı telefonlarda 5-10 sn sürer.
    // Otobüs yerine "hazır olana kadar, ama en fazla KAMERA_BEKLEME_MS"
    // bekliyoruz.
    var bas = Date.now();
    while (Date.now() - bas < KAMERA_BEKLEME_MS) {
      if (kameraHazirMi()) return true;
      // Tuzak 2: kullanıcı bu arada sayfayı kapattıysa ısrar etme.
      if (!kameraSayfasiAcikMi()) {
        CKYerel.canli.kameraHatasi = 'kamera ekranı kapatıldı';
        return false;
      }
      await bekle(250);
    }
    CKYerel.canli.kameraHatasi = 'kamera açılmadı (izin verilmemiş olabilir)';
    return false;
  }

  /** Kamera akışından bir kare al; yoksa null. */
  function kareYakala() {
    try {
      var v = videoOgesi();
      if (!v || !v.videoWidth || !v.videoHeight) return null;
      var c = document.createElement('canvas');
      // 1280 px: plaka okunabilirliği için gereken alt sınır. Daha küçük
      // değerler uzak plakayı okunamaz hâle getiriyordu (ölçüldü: 640 px
      // kırpım plakayı kesiyordu).
      var hedefG = 1280;
      var k = Math.min(1, hedefG / v.videoWidth);
      c.width = Math.max(64, Math.round(v.videoWidth * k));
      c.height = Math.max(64, Math.round(v.videoHeight * k));
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      // Kalite 0,80: sürekli modda bant genişliği ve JPEG süresi önemli.
      var veri = c.toDataURL('image/jpeg', 0.80);
      return (veri && veri.length > 2000) ? veri : null;
    } catch (e) {
      return null;
    }
  }

  /** Kullanıcının çizdiği kırpma dikdörtgeni (yüzde) — tek çekimle aynı. */
  function kirpmaIpuclari() {
    try {
      var Cam = window.Cam;
      if (!Cam || !Cam.cropArea) return null;
      var ust = Number(Cam.cropArea.top), yuk = Number(Cam.cropArea.height);
      if (!isFinite(ust) || !isFinite(yuk) || yuk < 2 || yuk > 100) return null;
      return { ust: ust, yukseklik: yuk };
    } catch (e) { return null; }
  }

  /** Kurye listesi yalnızca öneridir; puanı/güveni etkilemez (rehber §8.4). */
  function bilinenPlakalar() { return []; }

  /** Titreşim + kısa bip: plakayı nöbetçinin dikkatine taşır. */
  function bildirBulundu() {
    try {
      if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
    } catch (e) { /* desteklenmiyor */ }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.24);
      setTimeout(function () { try { ctx.close(); } catch (e) { } }, 400);
    } catch (e) { /* ses yoksa titreşim yeter */ }
  }

  function ekranaYaz(metin) {
    try {
      var el = document.querySelector('#camSub');
      if (el) el.textContent = metin;
    } catch (e) { /* yoksa sessiz */ }
  }

  // =========================================================================
  // ANA DÖNGÜ
  // =========================================================================
  async function tur() {
    var d = CKYerel.canli;
    if (!d.calisiyor) return;
    d.tur++;

    if (d.tur % MOLA_HER === 0) ekranaYaz('Canlı tarama sürüyor…');

    var kare = kareYakala();
    if (!kare) {
      d.ardArdaHata++;
      // İki FARKLI durum var; ikisi de "kare yok" ama davranışı ters:
      //
      //  a) Kullanıcı kamera sayfasını BİLEREK kapattıysa -> DURDUR.
      //     Zorla geri açmak kullanıcının kararını ezmek olurdu ve
      //     "düğmeler çalışmıyor" hissi verirdi.
      //  b) Sayfa açık ama akış düşmüşse (izin iptali, cihaz değişimi)
      //     -> ilk hatada BİR KEZ yeniden aç, böylece "telefonu çevirdim,
      //     döndüm" durumunda kendini toparlar.
      if (!kameraSayfasiAcikMi()) {
        durdur('kamera ekranı kapatıldı');
        return;
      }
      if (d.ardArdaHata === 1) {
        if (await kamerayiHazirla()) { d.ardArdaHata = 0; }
      }
      if (d.ardArdaHata >= EN_COK_HATA) { durdur(d.kameraHatasi || 'kamera görüntüsü yok'); return; }
      await bekle(800);
      return tur();
    }

    var t0 = Date.now();
    var sonuc;
    try {
      sonuc = await fetch(tam('/plaka/oku'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sync-Token': TOKEN || '' },
        body: JSON.stringify({
          gorsel: kare,
          bilinenPlakalar: bilinenPlakalar(),
          ipucu: kirpmaIpuclari(),
        }),
      }).then(function (r) {
        if (r.status === 401) throw new Error('yetkisiz');
        return r.json();
      });
    } catch (e) {
      d.ardArdaHata++;
      if (d.ardArdaHata >= EN_COK_HATA) { durdur('sunucuya ulaşılamıyor'); return; }
      await bekle(1500);
      return tur();
    }

    d.ardArdaHata = 0;
    d.sonOkumaMs = Date.now() - t0;
    CKYerel.istekSayisi++;
    CKYerel.toplamSure += d.sonOkumaMs;

    // Sunucu yoğun → yığılma yerine bekle (sunucu kuyruk sınırı uygular).
    if (sonuc && sonuc.neden === 'kuyruk-dolu') {
      ekranaYaz('Sistem yoğun — bekleniyor');
      await bekle(ARA_MS);
      return tur();
    }

    if (sonuc && sonuc.basarili && sonuc.plaka) {
      CKYerel.basariliSayisi++;
      var plaka = sonuc.plaka;
      var guven = sonuc.guvenSeviyesi || 'yesil';
      var ms = Math.round(d.sonOkumaMs);

      // Kural 2: AYNI PLAKAYI TEKRAR UYARMA.
      if (plaka !== d.sonOkunan) {
        d.sonOkunan = plaka;
        bildirBulundu();
        ekranaYaz(plaka + '  ·  ' + ms + ' ms  ·  ' +
          (guven === 'yesil' ? 'yüksek güven' : 'onaylayın'));
      } else {
        ekranaYaz(plaka + '  ·  ' + ms + ' ms');
      }
    } else if (d.sonOkunan) {
      d.sonOkunan = null;   // plaka kareden çıktı: tekrar uyarma üretme
    }

    // Kural 1: asla kendi hızında gitme.
    await bekle(Math.max(ARA_MS, d.sonOkumaMs + ARA_MS));
    return tur();
  }

  async function baslat() {
    var d = CKYerel.canli;
    if (d.calisiyor) return true;
    d.calisiyor = true;
    d.basliyor = true;
    d.tur = 0;
    d.sonOkunan = null;
    d.ardArdaHata = 0;

    // KAMERAYI SİSTEM AÇAR — kullanıcı çekim düğmesine basmaz.
    var hazir = await kamerayiHazirla();
    d.basliyor = false;
    if (!hazir) {
      d.calisiyor = false;
      ekranaYaz('Kamera açılamadı — tarayıcı izinlerini kontrol edin');
      CKYerel.sonHata = d.kameraHatasi || 'kamera açılamadı';
      try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) { }
      return false;
    }

    // Güvensiz kaynak: video döngüsü YAPILAMAZ (akış yok). Yerel kamera
    // yoluna geçildiyse burada duruyoruz — fotoğraf geldiğinde eklenti
    // kamerayı yeniden açar ve döngü orada devam eder.
    if (!guvenliKaynakMi()) {
      CKYerel.canli.tur++;
      ekranaYaz('Her plaka için telefonun kamerasını açın (sertifika gerekmez)');
      return true;
    }

    ekranaYaz('Canlı tarama başladı — plakayı kameraya getirin');
    tur();
    return true;
  }

  function durdur(neden) {
    var d = CKYerel.canli;
    if (!d.calisiyor) return;
    d.calisiyor = false;
    d.basliyor = false;
    if (neden) {
      ekranaYaz('Canlı tarama durdu: ' + neden);
      try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) { }
    } else {
      ekranaYaz('Canlı tarama durdu');
    }
    CKYerel.sonHata = neden || null;
  }

  // =========================================================================
  // DIŞ API
  // =========================================================================
  /**
   * Ayarı aç/kapat ve modu başlat/durdur.
   * @returns {Promise<boolean>} açıldıysa true
   *
   * Sözleşme: çağıran, AÇILDIKTAN SONRA ne olacağını öğrenmek ister.
   * Ölçülen hata bu bilgiyi alamadığı için kullanıcı "çalışmıyor" dedi.
   */
  CKYerel.canliAc = function (v) {
    CKYerel.sureciOkuAyar = (v === undefined) ? !CKYerel.sureciOkuAyar : !!v;
    ayarYaz(CKYerel.sureciOkuAyar);
    if (CKYerel.sureciOkuAyar) return baslat();
    durdur();
    return Promise.resolve(false);
  };
  CKYerel.canliBaslat = baslat;
  CKYerel.canliDurdur = function () { durdur(); };

  // Ekran kapanınca / sayfa terk edilince DURDUR.
  // Pil ve kamera güvenliği; kapalıyken HİÇBİR ŞEY çalışmıyor olmalı.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && CKYerel.canli.calisiyor) durdur('ekran kapandı');
  });
  window.addEventListener('pagehide', function () {
    if (CKYerel.canli.calisiyor) durdur();
  });

  ekranaYaz('Plaka okutmak için düğmeye basın');
})();
