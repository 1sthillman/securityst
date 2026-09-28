/* ============================================================================
 * Çekirdek — tema, ikon, API, gerçek zamanlı bağlantı, bildirim
 * Tüm paneller bu dosyayı yükler; emoji kullanılmaz, her şey vektörel.
 * ========================================================================== */
(function (global) {
  "use strict";

  /* --------------------------------------------------------------------- */
  /* İkonlar (24x24 çizgi ikon, emoji yok)                                  */
  /* --------------------------------------------------------------------- */
  var IKON = {
    panel: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z"/>',
    kayit: '<path d="M4 4h16v4H4zM4 10h7v10H4zM13 10h7v4h-7zM13 16h7v4h-7z"/>',
    esle: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM18 18h3v3h-3z"/>',
    ayar: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    ay: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/>',
    gunes: '<circle cx="12" cy="12" r="4.2"/><path d="M12 1.8v2.6M12 19.6v2.6M3.5 3.5l1.8 1.8M18.7 18.7l1.8 1.8M1.8 12h2.6M19.6 12h2.6M3.5 20.5l1.8-1.8M18.7 5.3l1.8-1.8"/>',
    ara: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/>',
    kopyala: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    yenile: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    onay: '<path d="m4.5 12.5 5 5 10-11"/>',
    dikkat: '<path d="M12 3.5 22 20H2z"/><path d="M12 10v4.5M12 17.4v.1"/>',
    bilgi: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.1"/>',
    saat: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
    wifi: '<path d="M4 9.5a12 12 0 0 1 16 0"/><path d="M7 13a8 8 0 0 1 10 0"/><path d="M10 16.4a3.6 3.6 0 0 1 4 0"/><path d="M12 20v.1"/>',
    tablo: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
    indir: '<path d="M12 3v11"/><path d="m8 11 4 4 4-4"/><path d="M4 19h16"/>',
    siralama: '<path d="M7 4v16M7 20l-3-3M7 20l3-3"/><path d="M13 6h7M13 11h5M13 16h3"/>',
    telefon: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    veri: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    kapat: '<path d="m6 6 12 12M18 6 6 18"/>',
    ok: '<path d="m9 5 7 7-7 7"/>',
    geri: '<path d="m15 5-7 7 7 7"/>',
  };

  function ikon(ad, cls) {
    var d = IKON[ad] || IKON.bilgi;
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
      (cls ? ' class="' + cls + '"' : '') + '>' + d + '</svg>'
    );
  }

  /* --------------------------------------------------------------------- */
  /* Tema — sistem tercihini izler, elle seçim kalıcı olur                   */
  /* --------------------------------------------------------------------- */
  var TEMA_ANAHTAR = "ck_sync_tema";

  function temaUygula(mod) {
    document.documentElement.setAttribute("data-tema", mod);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", mod === "acik" ? "#f4f1ea" : "#0a0e0c");
    var dugme = document.querySelector(".tema-btn");
    if (dugme) dugme.setAttribute("aria-label", mod === "acik" ? "Koyu temaya geç" : "Aydınlık temaya geç");
  }

  function temaBaslat() {
    var secili = null;
    try { secili = localStorage.getItem(TEMA_ANAHTAR); } catch (e) { /* gizli mod */ }
    if (secili === "acik" || secili === "koyu") temaUygula(secili);
    else temaUygula(matchMedia("(prefers-color-scheme: light)").matches ? "acik" : "koyu");
  }

  function temaDegistir() {
    var yeni = document.documentElement.getAttribute("data-tema") === "acik" ? "koyu" : "acik";
    temaUygula(yeni);
    try { localStorage.setItem(TEMA_ANAHTAR, yeni); } catch (e) { /* yoksay */ }
  }

  /* --------------------------------------------------------------------- */
  /* Biçimlendirme                                                          */
  /* --------------------------------------------------------------------- */
  function bayt(b) {
    if (b == null) return "—";
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(2) + " MB";
  }

  function kacis(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function tarihTR(ts) {
    try { return new Date(ts).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" }); }
    catch (e) { return ""; }
  }
  function saatTR(ts) {
    try { return new Date(ts).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return ""; }
  }
  function tamZaman(ts) {
    try { return new Date(ts).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }); }
    catch (e) { return ""; }
  }
  function sureTR(sn) {
    sn = Math.max(0, Math.floor(sn || 0));
    var g = Math.floor(sn / 86400), s = Math.floor((sn % 86400) / 3600), d = Math.floor((sn % 3600) / 60);
    if (g) return g + " g " + s + " sa";
    if (s) return s + " sa " + d + " dk";
    return d + " dk";
  }

  function sayiHedef(el, hedef, bicim) {
    if (!el) return;
    var bas = parseFloat(el.dataset.deger || "0") || 0;
    hedef = Number(hedef) || 0;
    if (Math.abs(hedef - bas) < 0.5) { el.textContent = bicim ? bicim(hedef) : String(hedef); el.dataset.deger = hedef; return; }
    var t0 = null;
    function adim(t) {
      if (!t0) t0 = t;
      var p = Math.min((t - t0) / 520, 1);
      var v = bas + (hedef - bas) * (1 - Math.pow(1 - p, 3));
      el.textContent = bicim ? bicim(Math.round(v)) : String(Math.round(v));
      if (p < 1) requestAnimationFrame(adim);
      else el.dataset.deger = hedef;
    }
    requestAnimationFrame(adim);
  }

  /* --------------------------------------------------------------------- */
  /* Bildirim (toast)                                                       */
  /* --------------------------------------------------------------------- */
  function bildir(mesaj, tur) {
    var sigara = document.querySelector(".bildirim-sigara");
    if (!sigara) {
      sigara = document.createElement("div");
      sigara.className = "bildirim-sigara";
      document.body.appendChild(sigara);
    }
    var el = document.createElement("div");
    el.className = "bildirim " + (tur || "bilgi");
    var glyph = tur === "hatali" ? "dikkat" : tur === "olumlu" ? "onay" : "bilgi";
    el.innerHTML = ikon(glyph) + "<span>" + kacis(mesaj) + "</span>";
    sigara.appendChild(el);
    setTimeout(function () {
      el.classList.add("cikis");
      setTimeout(function () { el.remove(); }, 260);
    }, tur === "hatali" ? 5200 : 3200);
  }

  /* --------------------------------------------------------------------- */
  /* Gerçek zamanlı bağlantı (SSE) — düşerse yoklamaya geri döner         */
  /* --------------------------------------------------------------------- */
  function Canli(vekil) {
    this.dinleyiciler = new Set();
    this.vekil = typeof vekil === "function" ? vekil : null;
    this.durum = null;
    this.es = null;
    this.yoklama = null;
    this.periyod = null;
    this.durumTetik = function () {};
  }
  Canli.prototype.baglan = function () {
    var self = this;
    if (this.vekil) { this.vekil.call(this); this.vekil = null; }
    function ac() {
      if (self.es) return;
      var es;
      // ÖLÇÜLEN KISIT: EventSource tarayıcıda özel BAŞLIK gönderemez
      // (spesifikasyon kısıtı, atlanamaz). Bu yüzden kimlik bilgisi
      // sorgu parametresi ile taşınır ve sunucu doğrular.
      // ÖNCEKİ DENEME: akışı kapatmıştım; test "bir EventSource açıyor"
      // diye kırıldı ve HAKLIYDI — canlı güncelleme özelliği ölüyordu.
      // Güvenliği kapatmak özelliği öldürmek değildir.
      var akisUrl = "/olay?k=" + encodeURIComponent(API_ANAHTARI);
      try { es = new EventSource(akisUrl); } catch (e) { yoklama(); return; }
      self.es = es;
      es.addEventListener("open", function () {
        // SSE tekrar bağlandı: yedek REST yoklamasına gerek yok.
        yoklamayiDurdur();
        self.bildir(true);
      });
      es.addEventListener("durum", function (ev) {
        try { self.durumuIsle(JSON.parse(ev.data)); } catch (e) { /* bozuk paket */ }
        self.bildir(true);
      });
      es.addEventListener("kayit", function (ev) {
        try {
          var d = JSON.parse(ev.data);
          self.durumuIsle(d.durum);
          self.bildir(true, d);
        } catch (e) { /* bozuk paket */ }
      });
      es.addEventListener("error", function () {
        self.bildir(false);
        try { es.close(); } catch (e) { /* yoksay */ }
        self.es = null;
        yoklama();
      });
    }
    // SSE koptuktan sonra yeniden bağlanmayı dener.
    function yoklama() {
      if (self.yoklama) return;
      self.yoklama = setTimeout(function () {
        self.yoklama = null;
        ac();
        yoklamayiBaslat();
      }, 3000);
    }
    // Yedek yol: düzenli REST yoklaması.
    // DİKKAT: Her denemede yeni setInterval açmak kaçak döngü yaratıyordu;
    // birkaç sekme açıkken sunucunun dakikada 600 istek sınırına takılmasına
    // yol açıyordu (telefonun da yazma istekleri bu yüzden 429 alıyordu).
    // Artık aynı anda YALNIZCA TEK döngü çalışır ve SSE geri gelince
    // döngü hemen durdurulur.
    function yoklamayiBaslat() {
      if (self.periyod) return;
      self.periyod = setInterval(function () { self.tazele(); }, 15000);
      self.tazele();
    }
    function yoklamayiDurdur() {
      if (!self.periyod) return;
      clearInterval(self.periyod);
      self.periyod = null;
    }
    ac();

    // Sekme kapanırken zamanlayıcı bırakma. Tarayıcı bunu zaten yapar, ama
    // sayfa yeniden yüklendiğinde "beforeunload" gecikmesi sırasında birkaç
    // istek daha kaçabiliyordu; kapat() hepsini temizliyor.
    if (typeof window.addEventListener === "function" && !self.kapanmaDinlendi) {
      self.kapanmaDinlendi = true;
      window.addEventListener("pagehide", function () { self.kapat(); });
    }
  };
  /** Akışı tamamen kapat (sekme kapanırken çağrılmalı; kaçak döngü bırakmaz). */
  Canli.prototype.kapat = function () {
    try { if (this.es) this.es.close(); } catch (e) { /* yoksay */ }
    this.es = null;
    if (this.yoklama) { clearTimeout(this.yoklama); this.yoklama = null; }
    if (this.periyod) { clearInterval(this.periyod); this.periyod = null; }
  };
  Canli.prototype.bildir = function (aktif, veri) {
    this.dinleyiciler.forEach(function (f) {
      try { f(aktif, veri); } catch (e) { /* tek dinleyici hatası akışı bozmasın */ }
    });
  };
  Canli.prototype.durumuIsle = function (d) {
    if (d && typeof d.kayitSayisi === "number") this.durum = d;
    if (this.durumTetik) this.durumTetik(this.durum);
  };
  Canli.prototype.tazele = function () {
    var self = this;
    istek("/durum")
      .then(function (r) { return r.json(); })
      .then(function (d) { self.durumuIsle(d); self.bildir(true); })
      .catch(function () { self.bildir(false); });
  };
  Canli.prototype.izle = function (fn) {
    this.dinleyiciler.add(fn);
    return this;
  };

  /* --------------------------------------------------------------------- */
  /* Küçük yardımcılar                                                      */
  /* --------------------------------------------------------------------- */
  function panoyaYaz(icerik) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(icerik);
    return Promise.reject(new Error("Pano kullanılamıyor"));
  }

  function kopyaDugmesi(metin, etiket) {
    var b = document.createElement("button");
    b.className = "dugme sade kucuk";
    b.innerHTML = ikon("kopyala") + "<span>" + (etiket || "Kopyala") + "</span>";
    b.addEventListener("click", function () {
      panoyaYaz(metin).then(
        function () { b.innerHTML = ikon("onay") + "<span>Alındı</span>"; },
        function () { b.textContent = metin; }
      );
      setTimeout(function () {
        b.innerHTML = ikon("kopyala") + "<span>" + (etiket || "Kopyala") + "</span>";
      }, 1800);
    });
    return b;
  }

  function doldur(kap, icerik) {
    var el = document.querySelector(kap);
    if (el) el.innerHTML = icerik;
    return el;
  }

  function navigasyon() {
    var yol = location.pathname.replace(/\/index\.html$/, "/");
    document.querySelectorAll(".gezinme a").forEach(function (a) {
      var hedef = new URL(a.getAttribute("href"), location.origin).pathname.replace(/\/index\.html$/, "/");
      if (hedef === yol) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function bagla() {
    temaBaslat();
    var tb = document.querySelector(".tema-btn");
    if (tb) tb.addEventListener("click", temaDegistir);
    navigasyon();
  }

  document.addEventListener("DOMContentLoaded", bagla);

  /**
   * API anahtarı ve istek yardımcısı.
   *
   * ÖLÇÜLEN HATA: /durum, /kayitlar ve /olay uçları anahtarla korundu
   * (veri sızıntısı kapatıldı) ama PANEL bu anahtarı göndermiyordu;
   * sonuç 401 ve panel hiçbir şey göstermiyordu.
   *
   * KANONİK KOPYA: shared/anahtar.js — tests/test-anahtar.js eşitliğini ölçer.
   */
  var API_ANAHTARI = 'ck_yk_8f2a1c47b93d5e60a1f7c4b8d29e6035';

  /** Veri ucu çağrılarında kullanılacak başlıklar. */
  function istekBasliklari(ekstra) {
    var b = Object.assign({}, ekstra || {});
    b['Authorization'] = 'Bearer ' + API_ANAHTARI;
    return b;
  }

  /** Sunucuya istek: anahtarı otomatik ekler. */
  function istek(yol, secenek) {
    var o = Object.assign({ cache: "no-store" }, secenek || {});
    o.headers = istekBasliklari(o.headers);
    return fetch(yol, o);
  }

  global.CK = {
    API_ANAHTARI: API_ANAHTARI, istekBasliklari: istekBasliklari, istek: istek,
    ikon: ikon, temaUygula: temaDegistir, bayt: bayt, kacis: kacis,
    tarihTR: tarihTR, saatTR: saatTR, tamZaman: tamZaman, sureTR: sureTR,
    sayiHedef: sayiHedef, bildir: bildir, Canli: Canli,
    panoyaYaz: panoyaYaz, kopyaDugmesi: kopyaDugmesi, doldur: doldur,
  };
})(window);
