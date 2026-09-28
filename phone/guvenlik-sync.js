/* ============================================================================
 * GuvenlikSync — g-venlik (Çınarköy Nöbet) uygulaması için drop-in Excel senkronu
 * ----------------------------------------------------------------------------
 * Kurulum (tek adım): uygulamanın index.html dosyasına, diğer <script>
 * etiketlerinin SONUNA şunu ekleyin:
 *
 *   <script src="guvenlik-sync.js"></script>
 *
 * Bu dosya tek başına yeterlidir: mevcut koda DOKUNMAZ. Yaptıkları:
 *  1. Global `dbPut()` fonksiyonunu otomatik sarar (wrap): uygulamanın visits
 *     yazan TÜM akışları (yeni kayıt, düzenleme, silme, firma geri-doldurma,
 *     kopya temizliği, içe aktarma) bu tek noktadan geçer. Orijinal kayıt akışı
 *     asla değişmez; yama yalnızca bitmiş kaydın kopyasını kuyruğa alır.
 *  2. Kuyruk ayrı bir IndexedDB'dedir (`ck_nobet_sync`) — uygulamanın
 *     `ck_nobet_v2` veritabanıyla çakışmaz, sürüm yükseltmesi tetiklemez.
 *     IndexedDB yoksa localStorage'a düşer (`ck_sync_outbox`).
 *  3. Bilgisayardaki companion servise FIFO + idempotent (+retry) gönderir.
 *  4. Sağ altta durum rozeti gösterir: dokununca hemen gönderir,
 *     dişli düğmesi adres/token ayarını açar (localStorage'da saklanır).
 *
 * Kaynak model uyumu: uygulamanın `mkVisit()` çıktısı birebir gönderilir
 * (`uid` idempotency anahtarıdır). `Firma` için `firmOf()` varsa onun sonucu,
 * yoksa kaydın `company` alanı kullanılır. `deleted:true` kayıtlar sunucuda
 * log'da tutulur ama Excel'e yazılmaz.
 * ========================================================================== */
/**
 * Çınarköy Yerel API Anahtarı (GÖMÜLÜ).
 *
 * KANONİK KOPYA: shared/anahtar.js — ikisi AYNI olmak zorundadır
 * (tests/test-anahtar.js ölçer).
 *
 * Sunucu bu anahtarı Authorization başlığında bekler:
 *   Authorization: Bearer <anahtar>   (düz anahtar da kabul edilir)
 *
 * Uygulama sunucu adresini /eslesme ucundan öğrenir; kullanıcı adres
 * yazmaz.
 *
 * Dürüst olalım: tarayıcıda çalışan bir anahtar gizli olamaz; sayfa onu
 * sunucuya göndermek zorundadır. Bu anahtar KİŞİSEL VERİYİ korur (aynı
 * Wi-Fi'taki misafire karşı). Anahtarın kendisini internete karşı gizli
 * tutmak tarayıcıda mümkün değildir.
 */
/**
 * Yayın yapılandırması.
 *
 * `yapilandirma.js` dosyası bu nesneyi doldurur. Dosya yoksa boş kalır ve
 * uygulama kendi kökeninde çalışmaya devam eder (LAN kurulumu).
 *
 * Alanlar:
 *   SUNUCU_ADRESI : Müşterinin bilgisayarındaki companion adresi.
 *                  Boşsa `window.location.origin` kullanılır.
 *   API_ANAHTARI   : Boşsa aşağıdaki gömülü anahtar kullanılır.
 */
var CK_YAPILANDIRMA = (typeof window !== "undefined" && window.CK_YAPILANDIRMA) || {};

// Sunucu adresi: yapılandırma > aynı köken (LAN kurulumu).
function sunucuKoku() {
  var ayar = String(CK_YAPILANDIRMA.SUNUCU_ADRESI || "").trim().replace(/\/+$/, "");
  if (ayar) return ayar;
  return window.location.origin;
}

var API_ANAHTARI = 'ck_yk_8f2a1c47b93d5e60a1f7c4b8d29e6035';

(function () {
  'use strict';

  var DB_NAME = 'ck_nobet_sync';
  var DB_VER = 1;
  var STORE_OUTBOX = 'outbox';
  var STORE_KV = 'kv';
  var LS_OUTBOX = 'ck_sync_outbox';
  var LS_CFG = 'ck_sync_cfg';
  var BASE_INTERVAL = 15000;
  var MAX_INTERVAL = 120000;

  var S = {
    baseUrl: null,
    adaylar: [],        // sırayla denenecek adresler (IP değişse diye)
    adaySira: 0,        // ÖLÇÜLEN HATA: bu hiç yoktu → liste[NaN] → adres düşüyordu
    httpsGuvenli: false,   // CA kuruldu mu? (arka planda yoklanir)
    token: null,
    flushing: false,
    failStreak: 0,
    lastOkAt: 0,
    lastError: null,
    db: null,
    lsMode: false,
    timer: null,
  };

  // ---- Aday adres yönetimi ------------------------------------------------
  // Aday sırası — ve BU BİR ÜRÜN KARARIDIR, teknik zorunluluk değil.
  //
  // ÖLÇÜLEN HATA (kullanıcı, iki kez bildirildi):
  //  1) "HTTPS nerede, telefondan nasıl açacağız?" — ve ardından
  //  2) "Telefona sertifika indirmek ile olacak iş değil, müşterilerimizi
  //     uğraştırmamamız gerekiyor."
  //
  // İlk denemede https adresleri öne alındı. Ölçülen sonuç: güvenilmeyen
  // bir https adresi tarayıcıda KORKUTUCU uyarı sayfası açıyor ve
  // uygulamayı ENGELLİYOR. Müşteri için bu "kurulum gerekiyor" demek —
  // kabul edilemeyen bir yük.
  //
  // ÇÖZÜM (ölçümle doğrulandı): Telefonun KENDİ kamerası
  // (capture="environment") güvenli kaynak istemez; plaka okuma düz http
  // adresinde de çalışır. Bkz. yerel-kamera.js.
  //
  // Doğrusu:
  //   1) HTTP adresleri ÖNCE — uyarı sayfası yok, sıfır ayar, her şey çalışır
  //   2) https adresleri EN SONDA — isteğe bağlı canlı önizleme için
  //   3) Kayıtlı adres daima önce (kullanıcı ne kullandıysa)
  //
  // ÖLÇÜLEN HATA (kullanıcı bildirimi, kritik): eski sıralama http adresini
  // ÖNE koyuyordu. Telefon bu yüzden güvensiz kaynata düşüyor ve tarayıcı
  // kamera izni VERMİYORDU. Üstelik daha önce kaydedilmiş http adresi, https
  // geldiği halde yapışkan kalıp kullanılmaya devam ediyordu.
  //
  // (DÜZELTİLME: bu yorumda önce "port 4545 sabitleniyordu, yanlıştı"
  //  denmişti. ÖLÇÜLDÜ: 4545 zaten varsayılan port (config.json ve
  //  başlatıcı). Kusur portta değil, PROTOKOLDE. Yanlış gerekçe, sonradan
  //  başka birinin doğru hatayı yanlış yere aramasına yol açar.)
  //
  // Doğrusu:
  //   1) https adresler ÖNCE (kamera ancak burada çalışır)
  //   2) https varsa eski http adresi kalıcı listeden DÜŞER — kullanıcı hiçbir
  //      şey yapmadan sistem kendini yükseltir
  //   3) bilgisayar adı yedekleri http olarak DEĞİL, https olarak eklenir
  //      (port tahmin edilir; sunucu listesi her zaman önceliklidir)
  function adaylariAyarla(birlik) {
    var liste = [];
    var ekle = function (u) {
      if (u && liste.indexOf(u) === -1) liste.push(String(u).replace(/\/+$/, ''));
    };
    if (birlik) {
      // 1) Kayıtlı adres önce: kullanıcı zaten bu adresde çalışıyordur.
      //    Kalıcılık, liste sırasından daha önemlidir.
      if (birlik.baseUrl) ekle(birlik.baseUrl);

      // 2) Sunucunun yayınladığı HTTP adresleri. Sıfır ayar: uyarı sayfası
      //    yok, kamera telefonun kendi kamerasıyla çalışır.
      var httpOnce = [], httpsSonra = [];
      (birlik.adaylar || []).forEach(function (u) {
        if (String(u).indexOf('https://') === 0) httpsSonra.push(u);
        else httpOnce.push(u);
      });
      httpOnce.forEach(ekle);

      // 3) Bilgisayar adı yedekleri (http). Port tahmin risklidir, EN SONDA.
      if (birlik.bilgisayarAdi) {
        ekle('http://' + birlik.bilgisayarAdi + ':' + httpPortu(birlik));
        ekle('http://' + birlik.bilgisayarAdi + '.local:' + httpPortu(birlik));
      }
      ekle('http://localhost:' + httpPortu(birlik));

      // 4) En sonda https: isteğe bağlı canlı önizleme.
      httpsSonra.forEach(ekle);
      if (birlik.httpsAdres) ekle(birlik.httpsAdres);
    }
    if (birlik && birlik.token) S.token = birlik.token;
    if (liste.length) {
      S.adaylar = liste;
      // Mevcut adres listede yoksa başa al
      if (S.baseUrl && liste.indexOf(S.baseUrl) === -1) S.adaySira = 0;
      else S.adaySira = Math.max(0, Math.min(S.adaySira, liste.length - 1));
      // Liste boşsa mevcut adres KORUNUR (sessizce düşürülmez).
      if (S.adaySira >= 0 && S.adaySira < liste.length) S.baseUrl = liste[S.adaySira];
    }
    return S.adaylar;
  }

  /** http portu: kayıtlı adresten ya da sunucudan. */
  function httpPortu(birlik) {
    var m = /:(\d+)$/.exec(String(S.baseUrl || (birlik && birlik.baseUrl) || ''));
    return m ? parseInt(m[1], 10) : 4545;
  }

  /** https portu (yalnızca isteğe bağlı canlı önizleme için). */
  function httpsPortu(birlik) {
    if (birlik && birlik.https && birlik.https.port) return birlik.https.port;
    return httpPortu(birlik) + 1;
  }

/**
 * HTTPS GECISI — kullanıcı hiçbir şey yapmadan kendiliğinden.
 *
 * ÖLÇÜLEN GERÇEK: sunucu tarafı belirleyici ölçümde %100 doğrulandı
 * (TLS el sıkışma, zincir köke kadar, SAN alan adı, imza — hepsi geçti;
 * bkz. tests/ara/https-gercek.js). Yani tek eksik sey: telefonun kok CA'ya
 * guvenmesi. CA kuruldugu an https calisir.
 *
 * Bu yuzden uyguama her acilista ARKA PLANDA https'i yoklar. Cevap alirsa
 * (yani guven varsa) adresi kalici olarak https'e yukseltir ve bundan sonra
 * her acilista dogrudan https uzerinden acilir. Kullaniciya hicbir secim,
 * hicbir uyari gosterilmez.
 *
 * Neden http once? Cunku CA kurulmadan once guvenilmeyen bir https adresi
 * tarayicida KORKUTUCU uyari sayfasi acar ve uygulamayi engeller. http ise
 * her zaman guvenli sekilde acar. Yani sira su: once http (her zaman acilir),
 * sonra https (guven varsa devreye girer). Kullanici hicbir zaman engellenmez.
 *
 * Guvenli kaynak YOKSA ne olur? Yoklama sessizce basarisiz olur ve uygulama
 * http uzerinde calismaya devam eder. Hata yutulmaz: durum S.durumRaporu'ya
 * yazilir, panelden ve ayar ekranindan gorulebilir.
 */
  function httpsYokla(birlik) {
    var httpsAdaylar = (S.adaylar || []).filter(function (u) { return String(u).indexOf('https://') === 0; });
    if (!httpsAdaylar.length) return Promise.resolve(false);
    // En az trafige yol acan uc: kucuk ve hizli yanit verir.
    var kazanilanAdres = null;
    var dene = function (i) {
      if (i >= httpsAdaylar.length) return Promise.resolve(false);
      var adres = httpsAdaylar[i];
      var url = adres + '/durum';
      var denetleyici = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var zamanAsimi = setTimeout(function () { if (denetleyici) denetleyici.abort(); }, 4000);
    return fetch(url, {
      cache: 'no-store',
      // ÖLÇÜLEN HATA: bu istek başlık GÖNDERMİYORDU (401 alıyordu).
      headers: istekBasliklari(),
      signal: denetleyici ? denetleyici.signal : undefined,
    })
        .then(function (r) {
          clearTimeout(zamanAsimi);
          if (r.ok) { kazanilanAdres = adres; return true; }
          return dene(i + 1);
        })
        .catch(function () { clearTimeout(zamanAsimi); return dene(i + 1); });
    };
    return dene(0).then(function (tamam) {
      S.httpsGuvenli = !!tamam;
      if (tamam) {
        // Basarili https adresi kalici adres olur: sonraki acilislarda
        // dogrudan https kullanilir (daha hizli, uyari sayfasi yok).
        if (kazanilanAdres) basariliAdres(kazanilanAdres);
      }
      return !!tamam;
    });
  }

  /** Durum raporu: panelde/ayar ekranında gorulebilir olsun diye. */
  function durumRaporu() {
    return {
      baseUrl: S.baseUrl,
      adaylar: (S.adaylar || []).slice(),
      httpsGuvenli: S.httpsGuvenli === true,
      adaySira: S.adaySira
    };
  }

  /** Bağlantı kurulunca doğrulanan adresi kalıcı adres olarak sabitler. */
  function basariliAdres(url) {
    if (!url || url === S.baseUrl) return;
    var i = S.adaylar.indexOf(url);
    if (i === -1) { S.adaylar.unshift(url); i = 0; }
    if (i !== 0) {
      S.adaylar.splice(i, 1);
      S.adaylar.unshift(url);
    }
    S.adaySira = 0;
    S.baseUrl = url;
    kvPut('syncCfg', { baseUrl: url, adaylar: S.adaylar, token: S.token })
      .then(null, function () {});
  }

  /** Bağlantı kurulamazsa sıradaki adaya geçer (yoksa baştan döner). */
  function sonrakiAday() {
    if (!S.adaylar.length) return false;
    S.adaySira = (S.adaySira + 1) % S.adaylar.length;
    S.baseUrl = S.adaylar[S.adaySira];
    return true;
  }

  /* ---------------- kalıcı kuyruk (IDB, yoksa localStorage) ---------------- */

  function lsRead(key, fb) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fb : v;
    } catch (e) { return fb; }
  }
  function lsWrite(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  /**
   * Kalıcı cihaz kimliği.
   *
   * Neden var? Eşleşme izin listesi IP + kimlik ile çalışır. Yalnızca IP
   * olsaydı, DHCP IP değişiminde (her ağa bağlanışta olabilir) telefon
   * "bilinmeyen cihaz" sayılır ve yönetici onayına takılırdı. Telefon bir
   * kez üretip sakladığı kimliği gönderir; IP değişse de aynı cihaz tanınır.
   *
   * Bu bir sırdır ama SIR NİTELİĞİ TAŞIMAZ: yalnızca cihazı tanımlar,
   * yetki vermez. Yetki API anahtarındadır.
   */
  var cihazKimligi = null;
  function cihazKimligiAl() {
    if (cihazKimligi) return cihazKimligi;
    cihazKimligi = lsRead(LS_CFG + ':cihaz', '');
    if (!cihazKimligi) {
      var parca = [];
      var alfabe = 'abcdefghijklmnopqrstuvwxyz0123456789';
      try {
        var k = new Uint8Array(16);
        (window.crypto || window.msCrypto).getRandomValues(k);
        for (var i = 0; i < k.length; i++) parca.push(alfabe[k[i] % alfabe.length]);
      } catch (e) {
        parca.push(String(Date.now()).slice(-8), String(Math.floor(Math.random() * 1679616)));
      }
      cihazKimligi = parca.join('');
      lsWrite(LS_CFG + ':cihaz', cihazKimligi);
    }
    return cihazKimligi;
  }

  /**
   * Her istekte gönderilen başlıklar:
   *   Authorization  → gömülü API anahtarı (sunucu doğrular)
   *   X-Sync-Token   → bilgisayarın kurulum anahtarı (varsa)
   *   X-Sync-Cihaz   → kalıcı cihaz kimliği (eşleşme izin listesi)
   *
   * GÜVENLİK NOTU: bu fonksiyon HİÇBİR ZAMAN hata fırlatmaz.
   * Ölçülen hata: cihazKimligiAl() bir istisna attığında TÜM istekler
   * düşüyordu — çünkü başlık yardımcısı fetch'den ÖNCE çalışıyor ve
   * istisna yukarı yayılıyordu. Bu sessiz veri kaybıdır. Artık en kötü
   * halde anahtarsız gönderilir; sunucu 401 döner ve sebep görünür.
   */
  function istekBasliklari(ekstra) {
    var b = Object.assign({}, ekstra || {});
    try { b['X-Sync-Cihaz'] = cihazKimligiAl(); } catch (e) { /* kimlik yok */ }
    // Anahtar da yapılandırmadan gelebilir: tek yerden değiştirmek için.
    try { b['Authorization'] = 'Bearer ' + (CK_YAPILANDIRMA.API_ANAHTARI || API_ANAHTARI); } catch (e) {}
    try { if (S.token) b['X-Sync-Token'] = S.token; } catch (e) {}
    return b;
  }

  function openDb() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) { S.lsMode = true; resolve(null); return; }
      var req;
      try { req = window.indexedDB.open(DB_NAME, DB_VER); }
      catch (e) { S.lsMode = true; resolve(null); return; }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE_OUTBOX)) d.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(STORE_KV)) d.createObjectStore(STORE_KV, { keyPath: 'key' });
      };
      req.onsuccess = function () { S.db = req.result; resolve(req.result); };
      req.onerror = function () { S.lsMode = true; resolve(null); };
    });
  }

  function idbReq(store, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t;
      try { t = S.db.transaction(store, mode); }
      catch (e) { reject(e); return; }
      var s = t.objectStore(store);
      var r;
      try { r = fn(s); }
      catch (e) { reject(e); return; }
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  // Açılış kapısı: depo (IDB/localStorage kararı) hazır olmadan hiçbir
  // yazma/okuma yapılmaz. Yoksa açılışın ilk milisaniyelerinde gelen kayıt
  // sessizce kuyruğa giremezdi (uygulamada durur, senkronı kaçırırdı).
  S.ready = openDb();

  function qPut(rec) {
    return S.ready.then(function () {
    if (S.lsMode || !S.db) {
      var a = lsRead(LS_OUTBOX, []);
      var i = -1;
      for (var k = 0; k < a.length; k++) { if (a[k] && a[k].id === rec.id) { i = k; break; } }
      if (i >= 0) a[i] = rec; else a.push(rec);
      lsWrite(LS_OUTBOX, a);
      return Promise.resolve();
    }
    return idbReq(STORE_OUTBOX, 'readwrite', function (s) { return s.put(rec); });
    });
  }
  function qDel(id) {
    return S.ready.then(function () {
    if (S.lsMode || !S.db) {
      lsWrite(LS_OUTBOX, lsRead(LS_OUTBOX, []).filter(function (x) { return !x || x.id !== id; }));
      return Promise.resolve();
    }
    return idbReq(STORE_OUTBOX, 'readwrite', function (s) { return s.delete(id); });
    });
  }
  function qAll() {
    return S.ready.then(function () {
    if (S.lsMode || !S.db) {
      var rows = lsRead(LS_OUTBOX, []).slice();
      rows.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
      return Promise.resolve(rows);
    }
    return idbReq(STORE_OUTBOX, 'readonly', function (s) { return s.getAll(); })
      .then(function (rows) {
        rows = (rows || []).slice();
        rows.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
        return rows;
      });
    });
  }
  function kvGet(key) {
    return S.ready.then(function () {
    if (S.lsMode || !S.db) return Promise.resolve(lsRead(LS_CFG, {})[key] || null);
    return idbReq(STORE_KV, 'readonly', function (s) { return s.get(key); })
      .then(function (r) { return r ? r.value : null; });
    });
  }
  function kvPut(key, value) {
    return S.ready.then(function () {
    if (S.lsMode || !S.db) {
      var o = lsRead(LS_CFG, {}); o[key] = value; lsWrite(LS_CFG, o);
      return Promise.resolve();
    }
    return idbReq(STORE_KV, 'readwrite', function (s) { return s.put({ key: key, value: value }); });
    });
  }

  /* ---------------- ağ ---------------- */

  function postJson(url, body, timeoutMs) {
    return new Promise(function (resolve) {
      var ctrl, timer = null;
      try {
        ctrl = new AbortController();
        timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, timeoutMs);
      } catch (e) { ctrl = undefined; }
      fetch(url, {
        method: 'POST',
    headers: istekBasliklari({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
      }).then(function (res) {
        if (timer) clearTimeout(timer);
        resolve({ ok: res.ok, status: res.status, res: res });
      }).catch(function (e) {
        if (timer) clearTimeout(timer);
        resolve({ ok: false, status: 0, netErr: e && e.name === 'AbortError' ? 'Zaman aşımı' : 'Ağ hatası' });
      });
    });
  }

  /**
   * Tek kayıt gönderir. Ağ hatası / 401 dışındaki hatalarda sıradaki aday
   * adrese geçip yeniden dener: bilgisayarın IP'si değişmişse telefon kendi
   * kendini toparlar, kullanıcı hiçbir şey yapmaz.
   */
  function sendOne(rec, deneme) {
    deneme = deneme || 0;
    return postJson(S.baseUrl + '/kayit', rec, 8000).then(function (r) {
      if (r.ok) { basariliAdres(S.baseUrl); return true; }
      // 401 = anahtar yanlış; aday değiştirmek işe yaramaz, kullanıcıya bildir.
      // 400 = kayıt hatası; aynı şekilde.
      if (r.status === 401 || r.status === 400) {
        S.lastError = r.status === 401 ? 'Anahtar hatalı' : 'Kayıt reddedildi';
        return false;
      }
      S.lastError = r.status ? 'HTTP ' + r.status : (r.netErr || 'Bağlantı yok');
      // Bağlantı sorunu: başka adres var mı dene
      if (!r.status && deneme < S.adaylar.length && sonrakiAday()) {
        return sendOne(rec, deneme + 1);
      }
      return false;
    });
  }

  function tryFlush() {
    if (!S.baseUrl) { paint(); return Promise.resolve(); }
    // Hızlı art arda çağrılar (configure→kayıt, seri kayıtlar) kaybolmaz:
    // جاری flush bitince otomatik yeniden akıtılır.
    if (S.flushing) { S.again = true; return Promise.resolve(); }
    S.flushing = true; paint();
    var drain = function () {
      return qAll().then(function (pending) {
        var failed = false;
        var chain = Promise.resolve();
        pending.forEach(function (rec) {
          chain = chain.then(function (stop) {
            if (stop) return true;
            return sendOne(rec).then(function (ok) {
              if (ok) {
                return qDel(rec.id).then(function () {
                  S.failStreak = 0; S.lastError = null; S.lastOkAt = Date.now();
                  return false;
                });
              }
              S.failStreak++;
              failed = true;
              return true; // break: sıra korunur
            });
          });
        });
        return chain.then(function () { return failed; });
      }).then(function (failed) {
        // Başarısızlıkta hemen dönme (sunucu/ağ sorunu varken meşgul döngü olur);
        // sıradaki interval/online tetiklemesi dener. Yeni kayıt geldiyse ve
        // hata yoksa hemen bir tur daha akıt.
        if (S.again && !failed) { S.again = false; return drain(); }
        S.again = false;
      });
    };
    return drain().then(function () {
      S.flushing = false; paint();
    }, function () {
      // Depo hatası gibi beklenmedik durum: bayraklar temizlenir, döngü yaşar.
      // tryFlush ASLA reject etmez — tüm çağrılar fire-and-forget güvenlidir.
      S.flushing = false; S.failStreak++; paint();
    });
  }

  function tryFlushBatch() {
    if (!S.baseUrl) return Promise.resolve();
    if (S.flushing) { S.again = true; return Promise.resolve(); }
    S.flushing = true; paint();
    return qAll().then(function (pending) {
      if (!pending.length) { S.flushing = false; paint(); return; }
      return postJson(S.baseUrl + '/kayit/batch', { records: pending }, 15000).then(function (r) {
        if (!r.ok) { S.lastError = r.status ? 'HTTP ' + r.status : (r.netErr || 'Ağ hatası'); S.failStreak++; return; }
        return r.res.json().then(function (data) {
          if (data && data.ok) {
            // Bilinçli olarak dizi: '{}' kullanılsaydı id='__proto__' olan kayıt
            // prototip tuzağına takılır, hep 'hatalı' sanılıp sonsuz retry'e girerdi.
            var errIds = [];
            (data.errors || []).forEach(function (e) {
              var rec = pending[e.index];
              if (rec) errIds.push(rec.id);
            });
            var chain = Promise.resolve();
            pending.forEach(function (rec) {
              if (errIds.indexOf(rec.id) === -1) chain = chain.then(function () { return qDel(rec.id); });
            });
            return chain.then(function () {
              S.failStreak = 0; S.lastError = null; S.lastOkAt = Date.now();
            });
          }
        }).catch(function () { S.failStreak++; });
      });
    }).then(function () {
      S.flushing = false;
      var chained = S.again;
      S.again = false;
      paint();
      // Batch sırasında yeni iş geldiyse tekli akışla hemen devam et.
      if (chained) tryFlush().then(null, function () {});
    });
  }

  function currentDelay() {
    return Math.min(BASE_INTERVAL * Math.pow(1.5, S.failStreak), MAX_INTERVAL);
  }
  function loop() {
    if (S.timer) return;
    var tick = function () {
      qAll().then(function (p) {
        return (p.length >= 10 ? tryFlushBatch() : tryFlush());
      }).then(function () {
        S.timer = setTimeout(tick, currentDelay());
      }, function () {
        // Depo hatası gibi beklenmedik durum: döngü ASLA ölmez, aralık büyür.
        S.failStreak++;
        S.timer = setTimeout(tick, currentDelay());
      });
    };
    S.timer = setTimeout(tick, BASE_INTERVAL);
  }

  /* ---------------- kayıt sarma (uygulamaya dokunmadan) ---------------- */

  function resolveFirma(rec) {
    if (rec.company) return rec.company;
    try {
      if (typeof window.firmOf === 'function') {
        var f = window.firmOf(rec.plate, rec.courier);
        if (f) return f;
      }
    } catch (e) {}
    return '';
  }

  function enqueueVisit(rec) {
    if (!rec) return Promise.resolve();
    var id = rec.uid || rec.id;
    // Sunucu plakasız kaydı reddeder (400); zehirli kaydın kuyruğu tıkamasın
    // diye kuyruğa hiç alınmaz (yerel uygulamada durmaya devam eder).
    if (!id || !rec.plate) return Promise.resolve();
    var payload = {
      id: id,
      uid: rec.uid || id,
      site: rec.site || '',
      unit: rec.unit || '',
      courier: rec.courier || '',
      company: resolveFirma(rec),
      plate: rec.plate || '',
      guard: rec.guard || '',
      note: rec.note || '',
      ts: typeof rec.ts === 'number' ? rec.ts : Date.now(),
      updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : (typeof rec.ts === 'number' ? rec.ts : 0),
      dev: rec.dev || '',
      deleted: rec.deleted === true,
    };
    return qPut(payload).then(function () { paint(); tryFlush(); });
  }

  // TEK YAKALAMA NOKTASI: uygulamanın visits yazan TÜM akışları (kayıt, düzenleme,
  // tekli silme, firma geri-doldurma, kopya temizliği, içe aktarma) dbPut(S_V,…)
  // üzerinden geçer. saveVisit'i değil dbPut'u sarmak hepsini kapsar; kayıt akışı
  // değişmez, yama yalnızca bitmiş kaydın kopyasını kuyruğa alır.
  function wrapDbPut() {
    if (typeof window.dbPut !== 'function') return false;
    if (window.dbPut.__gsyncWrapped) return true;
    var orig = window.dbPut;
    var wrapped = function (st, rec) {
      return orig.apply(this, arguments).then(function (r) {
        try {
          if (st === 'visits' && r && r.uid && r.plate) enqueueVisit(r).catch(function () {});
        } catch (e) {}
        return r;
      });
    };
    wrapped.__gsyncWrapped = true;
    window.dbPut = wrapped;
    return true;
  }
  var wrapTries = 0;
  var wrapTimer = setInterval(function () {
    try {
      if (wrapDbPut()) { clearInterval(wrapTimer); wrapTimer = null; }
      // dbPut 60 sn'de gelmediyse (yanlış sayfa?) zamanlayıcıyı öldür; kaynak sızıntısı yok.
      else if (++wrapTries > 120) { clearInterval(wrapTimer); wrapTimer = null; }
    } catch (e) {}
  }, 500);

  /* ---------------- rozet + ayar penceresi (kendi overlay'i) ---------------- */

  var badgeEl = null, cfgEl = null;

  // GitHub Pages (https) üzerinden açılırsa tarayıcı yerel HTTP API'yi
  // engeller (mixed content). Kullanıcıyı ayarda net şekilde uyarırız.
  var PAGE_HTTPS = false;
  try { PAGE_HTTPS = String(window.location && window.location.protocol || '').toLowerCase().indexOf('https') === 0; }
  catch (e) {}

  function ensureBadge() {
    if (badgeEl || !document.body) return;
    badgeEl = document.createElement('div');
    badgeEl.id = 'gsync-badge';
    badgeEl.setAttribute('style',
      'position:fixed;right:12px;bottom:86px;z-index:70;display:flex;align-items:center;gap:7px;' +
      'background:rgba(18,23,26,.95);border:1px solid #232C30;color:#EEF2F0;border-radius:100px;' +
      'padding:8px 12px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer;user-select:none;');
    var gear = document.createElement('span');
    gear.textContent = '⚙';
    gear.setAttribute('style', 'opacity:.7;');
    gear.onclick = function (e) { e.stopPropagation(); openCfg(); };
    badgeEl.appendChild(gear);
    var txt = document.createElement('span');
    txt.id = 'gsync-badge-txt';
    txt.textContent = '…';
    badgeEl.appendChild(txt);
    badgeEl.onclick = function () { tryFlush(); };
    document.body.appendChild(badgeEl);
  }

  function paint() {
    if (!badgeEl) return;
    var txt = document.getElementById('gsync-badge-txt');
    if (!txt) return;
    qAll().then(function (p) {
      var label;
      if (!S.baseUrl) label = 'Eşleşmedi';
      else if (S.flushing) label = 'Gönderiliyor…';
      else if (p.length > 0) label = 'Bekleyen: ' + p.length;
      else label = 'Senkron ✓';
      var extra = S.lastError ? ' • ' + S.lastError : '';
      if (PAGE_HTTPS) extra += ' • DİKKAT: sayfa HTTPS, yerel HTTP engelli olabilir';
      txt.textContent = label;
      badgeEl.title = 'Bilgisayar senkronu' + extra + ' (ayar için ⚙)';
      badgeEl.style.borderColor = !S.baseUrl ? '#FFA94D' : (p.length > 0 ? '#FFA94D' : '#2a6a50');
    }).catch(function () {});
  }

  function openCfg() {
    if (cfgEl) { cfgEl.style.display = 'flex'; return; }
    cfgEl = document.createElement('div');
    cfgEl.setAttribute('style',
      'position:fixed;inset:0;z-index:99;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(4,6,6,.7);padding:24px;');
    var box = document.createElement('div');
    box.setAttribute('style',
      'background:#12171A;border:1px solid #232C30;border-radius:18px;padding:22px;width:100%;max-width:360px;');
    box.innerHTML =
      '<div style="font:700 16px Inter,sans-serif;color:#EEF2F0;margin-bottom:4px;">Bilgisayar eşleşmesi</div>' +
      '<div style="font:400 12.5px Inter,sans-serif;color:#7C8B8B;margin-bottom:14px;">Kulübe bilgisayarının adresi ve anahtarı. Bir kez girilir.</div>' +
      (PAGE_HTTPS
        ? '<div style="font:400 12px Inter,sans-serif;color:#FFA94D;background:rgba(255,169,77,.1);border:1px solid #FFA94D;border-radius:10px;padding:9px 11px;margin-bottom:12px;line-height:1.5;">Bu sayfa HTTPS ile açık. Tarayıcı, yerel ağdaki HTTP adresine bağlanmaya izin vermez. Uygulamayı kulübe bilgisayarından <b>http://</b> ile açın (örn. <b>python -m http.server</b>).</div>'
        : '') +
      '<div id="gsync-uyari" style="display:none;font:400 12px Inter,sans-serif;color:#FF6B5B;background:rgba(255,107,91,.1);border:1px solid #FF6B5B;border-radius:10px;padding:10px 12px;margin-bottom:12px;line-height:1.5;"></div>' +
      '<div id="gsync-adaylar" style="display:none;margin-bottom:12px;"></div>' +
      '<input id="gsync-url" placeholder="http://192.168.1.50:4545" ' +
      'style="width:100%;box-sizing:border-box;background:#181F22;border:1px solid #232C30;border-radius:12px;' +
      'padding:12px;color:#EEF2F0;font-size:14px;margin-bottom:10px;"/>' +
      '<input id="gsync-tok" type="password" placeholder="Eşleşme anahtarı (token)" ' +
      'style="width:100%;box-sizing:border-box;background:#181F22;border:1px solid #232C30;border-radius:12px;' +
      'padding:12px;color:#EEF2F0;font-size:14px;margin-bottom:14px;"/>' +
      '<div style="display:flex;gap:8px;">' +
      '<button id="gsync-test" style="flex:1;padding:12px;border-radius:12px;border:1px solid #232C30;background:#181F22;color:#EEF2F0;font-weight:600;">Dene</button>' +
      '<button id="gsync-save" style="flex:1;padding:12px;border-radius:12px;border:0;background:#FFA94D;color:#1c1206;font-weight:700;">Kaydet</button>' +
      '</div>' +
      '<div id="gsync-msg" style="font:400 12px Inter,sans-serif;color:#7C8B8B;margin-top:10px;min-height:16px;"></div>';
    cfgEl.appendChild(box);
    cfgEl.onclick = function (e) { if (e.target === cfgEl) cfgEl.style.display = 'none'; };
    document.body.appendChild(cfgEl);
    box.querySelector('#gsync-url').value = S.baseUrl || '';
    box.querySelector('#gsync-tok').value = S.token || '';
    var msg = function (t) { box.querySelector('#gsync-msg').textContent = t; };
    box.querySelector('#gsync-test').onclick = function () {
      var u = box.querySelector('#gsync-url').value.trim().replace(/\/+$/, '');
      if (!u) { msg('Adres girin.'); return; }
      msg('Deneniyor…');
      fetch(u + '/saglik', { headers: istekBasliklari() }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        msg('Bağlantı OK • sunucuda ' + d.kayitSayisi + ' kayıt.');
      }).catch(function (e) { msg('Başarısız: ' + (e.message || e)); });
    };
    box.querySelector('#gsync-save').onclick = function () {
      var u = box.querySelector('#gsync-url').value.trim().replace(/\/+$/, '');
      var t = box.querySelector('#gsync-tok').value.trim();
      adaylariAyarla({ baseUrl: u });
      S.token = t; S.failStreak = 0; S.adaySira = 0;
      kvPut('syncCfg', { baseUrl: S.baseUrl, adaylar: S.adaylar, token: t }).then(function () {
        msg('Kaydedildi');
        paint(); tryFlush();
        setTimeout(function () { cfgEl.style.display = 'none'; }, 700);
      });
    };

    // ---- Bağlantı yoksa kullanıcıya ne yapacağını söyle, seçenek sun ----
    function baglantiUyarisi() {
      var kutu = box.querySelector('#gsync-uyari');
      var adayKutu = box.querySelector('#gsync-adaylar');
      if (!kutu) return;
      // Sunucuya hiç ulaşılamıyorsa ve birden çok aday varsa kullanıcıya seçenek sun
      var cop = S.lastError === 'Anahtar hatalı';
      if (!S.adaylar.length || cop) { kutu.style.display = 'none'; adayKutu.style.display = 'none'; return; }
      kutu.style.display = 'block';
      kutu.innerHTML = 'Bilgisayara ulaşılamıyor. Adres değişmiş olabilir.<br>' +
        'Bilgisayardaki paneli açıp yeni QR kodu okutmanız yeterli.';
      adayKutu.style.display = 'block';
      adayKutu.innerHTML = '<div style="font:400 12px Inter,sans-serif;color:#7C8B8B;margin-bottom:6px;">Denenecek adresler:</div>';
      S.adaylar.forEach(function (a) {
        var b = document.createElement('button');
        b.style.cssText = 'display:block;width:100%;text-align:left;margin-bottom:5px;padding:9px 11px;' +
          'border-radius:10px;border:1px solid #232C30;background:#181F22;color:#EEF2F0;font:11px monospace;cursor:pointer';
        b.textContent = a + (a === S.baseUrl ? '  ← şu an denenen' : '');
        b.onclick = function () {
          S.baseUrl = a; S.adaySira = S.adaylar.indexOf(a); S.failStreak = 0;
          box.querySelector('#gsync-url').value = a;
          kvPut('syncCfg', { baseUrl: a, adaylar: S.adaylar, token: S.token }).then(function () {
            paint(); tryFlush();
          });
        };
        adayKutu.appendChild(b);
      });
    }
    baglantiUyarisi();
  }

  /* ---------------- otomatik eşleşme ---------------- */

  /**
   * AYNI KÖKENLİ KULLANIM — kullanıcının hiçbir şey yapmasına gerek kalmaz.
   *
   * Uygulama companion servisinin kendisinden yayınlandığında
   * (http://BILGISAYAR:4545/telefon/) adres zaten doğrudur ve anahtar
   * /eslesme ucundan okunur. Böylece:
   *   - QR okutma, adres yazma, anahtar yazma adımları TAMAMEN KALKAR
   *   - Bilgisayarın IP'si değişse bile eşleşme bozulmaz (adres sabit değil,
   *     tarayıcının açtığı yer doğrudur)
   *   - HTTPS/HTTP karışık içerik sorunu oluşmaz (hepsi aynı protokol)
   *
   * Bu, GitHub Pages kullanımından daha sağlamdır; o senaryo için eski
   * elle eşleştirme yolu çalışmaya devam eder.
   */
  function otomatikEslesme() {
    if (window.location.protocol === 'file:') return Promise.resolve(null);
    // ÖLÇÜLEN HATA: burada hep location.origin kullanılıyordu; GitHub
    // Pages'te uygulama yanlış adrese bağlanıyordu. Yapılandırma varsa o.
    var kok = sunucuKoku();
    // Yalnızca companion servisini konuştuğumuzdan emin ol
    return fetch(kok + '/eslesme', { cache: 'no-store', headers: istekBasliklari() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.token) return null;
        adaylariAyarla({ baseUrl: kok, adaylar: d.adaylar || [] });
        S.token = d.token;
        return kvPut('syncCfg', { baseUrl: S.baseUrl, adaylar: S.adaylar, token: S.token })
          .then(function () { return { kok: kok, token: d.token, adaylar: d.adaylar }; });
      })
      .catch(function () { return null; });
  }

  /* ---------------- başlatma ---------------- */

  function boot() {
    ensureBadge();
    S.ready
      .then(otomatikEslesme)          // önce dene: aynı köken mi?
      .then(function (otomatik) {
        return kvGet('syncCfg').then(function (cfg) {
          if (otomatik) return;       // zaten ayarlandı
          if (!cfg) return;
          S.token = cfg.token || '';
          if (cfg.baseUrl) adaylariAyarla({ baseUrl: cfg.baseUrl, adaylar: cfg.adaylar });
          S.baseUrl = S.adaylar.length ? S.adaylar[0] : S.baseUrl;
        });
      })
      .then(function () {
        paint();
        try { wrapDbPut(); } catch (e) {}
        loop();
        tryFlush();
        // ARKA PLANDA: CA kuruldu mu diye yokla.
        //
        // Ölçülen sunucu tarafı: doğrulama açık TLS istekleri %100 geçti.
        // Yani CA kurulduğu an https çalışır. Yoklama başarılı olursa
        // adres kalıcı olarak https'e yükselir ve bundan sonraki her açılışta
        // uygulama doğrudan https üzerinden açılır — kullanıcı hiçbir şey
        // yapmaz, hiçbir uyarı görmez.
        //
        // Yoklama basarisiz olursa (CA kurulmamis) sessizce http devam eder.
        // Hata yutulmaz: S.httpsGuvenli false kalir ve durum raporu yazilir.
        return httpsYokla().then(function (guvenli) {
          if (guvenli) { paint(); }
          return guvenli;
        });
      })
      .catch(function () { paint(); loop(); });

    window.addEventListener('online', function () { tryFlush(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tryFlush();
    });
    setInterval(paint, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.GuvenlikSync = {
    configure: function (baseUrl, token, ekstra) {
      S.token = String(token || '').trim();
      S.failStreak = 0;
      adaylariAyarla(Object.assign({ baseUrl: baseUrl }, ekstra || {}));
      return kvPut('syncCfg', { baseUrl: S.baseUrl, adaylar: S.adaylar, token: S.token })
        .then(function () { paint(); tryFlush(); });
    },
    /** Eşleşme penceresini açar (panelden okunan adres + anahtar buraya girilir). */
    ayarlar: openCfg,
    flush: tryFlush,
    flushBatch: tryFlushBatch,
    enqueueVisit: enqueueVisit,
    status: function () {
      return qAll().then(function (p) {
        return Object.assign(durumRaporu(), {
          pending: p.length, lastError: S.lastError, lastOkAt: S.lastOkAt
        });
      });
    },
    /** CA guvenini elle yeniden yokla (ayar ekranindaki dugme icin). */
    httpsYokla: function () {
      return httpsYokla().then(function (g) { paint(); return g; });
    },
    /** Sifir yazma: guven durumu panelde/ayarda gorunsun. */
    durum: durumRaporu,
  };
})();
