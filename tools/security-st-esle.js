'use strict';
// ============================================================================
//  Security-ST -> companion/public/telefon/ dönüştürücü
// ----------------------------------------------------------------------------
//  Neden bir dönüştürücü? 553 KB'lık tek dosyayı elle düzenlemek sürdürülemez:
//  her güncellemede aynı dört değişikliğin unutulma riski çok yüksek. Burada
//  değişiklikler TEK YERDE ve AÇIKÇA tanımlıdır; betik kendini doğrular ve
//  kaçırdığı bir şeyi sessizce geçmez.
//
//  Yapılan değişiklikler:
//   1) Harici CDN kaldırılır (qrcodejs, xlsx) -> yerel vendor/ dosyaları.
//      İnternet yoksa uygulama yine açılır.
//   2) Google Fonts kaldırılır -> sistem yazı tipi yığını.
//      Kulübede internet olmayabilir; font beklemek arayüzü bloklar.
//   3) Bulut OCR yapılandırması (ocr-config.js) anahtarsız üretilir.
//      Fotoğraf artık hiçbir dışarı servise gitmiyor.
//   4) Yerel eklentiler eklenir: plaka-yerel.js (sunucu OCR),
//      senkron.js (aynı kökenli senkronizasyon), canli-okuma.js
//      (sürekli kamera okuma — VARSAYILAN KAPALI).
//   5) Ayarlar › Plaka & Kurye'ye "Sürekli kamera okuma" anahtarı eklenir.
//
//  Kullanım:  node tools/security-st-esle.js
// ============================================================================

const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..');
const KAYNAK = path.join(KOK, 'Security-ST', 'index.html');
const HEDEF_DIZIN = path.join(KOK, 'companion', 'public', 'telefon');
const HEDEF = path.join(HEDEF_DIZIN, 'index.html');

let hata = 0;
const uyari = (m) => console.log('  UYARI: ' + m);
const basari = (m) => console.log('  ok: ' + m);

function oku(p) { return fs.readFileSync(p, 'utf8'); }
function yaz(p, icerik) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, icerik, 'utf8');
}

// ---------------------------------------------------------------------------
//  "Sürekli kamera okuma" ayar satırı — HTML parçası
// ---------------------------------------------------------------------------
// Neden ayrı sabit? Ayar satırı ve ona bağlı iki davranış değişikliği
// (anahtar işleyicisi + paintPrefs) tek yerde tanımlanır; üçü birbirinden
// koparsa anahtar görünür ama işlevsiz kalır. Metin, kaynak uygulamanın
// mevcut "srow" kalıbını birebir izler — yeni bir görsel dil uydurmuyoruz.
const AYAR_SATIRI = `        <!-- ===== SÜREKLİ KAMERA OKUMA (varsayılan KAPALI) =====
             Neden varsayılan kapalı? Sürekli kamera + JPEG sıkıştırma pil
             hızlı bitirir ve eski telefonu yorar. Bu özellik İSTEĞE BAĞLIDIR;
             açılmadıkça HİÇBİR şey çalışmaz ve mevcut tek-çekim akışı olduğu
             gibi kalır.
             Ölçülen okuma ~0,3-1,2 sn; telefon KENDİ HIZINDA gitmez, sunucunun
             ölçtüğü süreye sabit ara ekleyerek bekler. Aynı plaka için tekrar
             uyarı vermez. Kayıt KAPISI otomatik açılmaz — karar insana aittir. -->
        <div class="srow" data-set="livePlate">
          <div class="sico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/><path d="M12 1v3M12 20v3"/></svg></div>
          <div class="smain"><div class="st">Sürekli kamera okuma</div><div class="ss" id="livePlateNote">Kamerayı plakaya tut; sistem kendi okusun. Pili daha hızlı bitirir.</div></div>
          <div class="sw" data-sw="livePlate"></div>
        </div>`;


// ---------------------------------------------------------------------------
// 1) OCR yapılandırması — anahtarsız, yerel
// ---------------------------------------------------------------------------
const OCR_CONFIG = `'use strict';
/* ============================================================================
 * OCR yapılandırması — BULUT YOK, ANAHTAR YOK
 * ----------------------------------------------------------------------------
 * Bu dosya daha önce OCR.space / API Ninjas / Plate Recognizer API
 * anahtarlarını içeriyordu. Üç sorun vardı:
 *   1) Kulübede internet olmayınca plaka okuma tamamen duruyordu.
 *   2) Nöbetçinin plaka fotoğrafı üçüncü taraf sunuculara gönderiliyordu.
 *   3) Anahtarlar dosyanın içinde düz metin duruyordu.
 *
 * Artık plaka okma KULÜBİ BİLGİSAYARINDA, çevrimdışı çalışıyor
 * (/plaka/oku ucu). Bu dosya yalnızca arayüzün davranışını tanımlar.
 * ==========================================================================*/
const OCR_CONFIG = {
  // 'yerel'   : bilgisayardaki sunucu (varsayılan, önerilen)
  // 'bulut'   : yalnızca kullanıcı bilerek açarsa (internet gerektirir)
  mod: 'yerel',

  yerel: {
    // Aynı köken: uygulama zaten companion servisinden yayınlandığı için
    // adres otomatik doğru gelir (IP değişse bile sorun olmaz).
    url: '',
    token: '',
  },

  // Bulut seçenekleri boş bırakıldı: anahtar yoksa o yollar atlanır.
  ocrSpace:     { apiKeys: [], apiUrl: 'https://api.ocr.space/parse/image' },
  apiNinjas:    { apiKeys: [], apiUrl: 'https://api.api-ninjas.com/v1/imagetotext' },
  plateRecognizer: { apiKeys: [], apiUrl: 'https://api.platerecognizer.com/v1/plate-reader/' },

  priority: ['plateRecognizer', 'ocrSpace', 'apiNinjas'],
  fallbackEnabled: true,
  timeouts: { plateRecognizer: 25000, ocrSpace: 30000, apiNinjas: 20000 },
};

if (typeof window !== 'undefined') window.OCR_CONFIG = OCR_CONFIG;
if (typeof module !== 'undefined' && module.exports) module.exports = OCR_CONFIG;
`;

// ---------------------------------------------------------------------------
// 2) Dönüştürme
// ---------------------------------------------------------------------------
function donustur(icerik) {
  const degisimler = [];

  // Satır sonlarını LF'ye normalize et.
  //
  // Neden? Kaynak dosya CRLF kullanıyordu ve buradaki ankarlar \n ile
  // yazıldığı için dönüşümler sessizce başarısız oluyordu (ölçülen hata).
  // Normalizasyon sonrası ankarlar hem CRLF hem LF kaynakta çalışır.
  icerik = icerik.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  degisimler.push('satır sonları LF olarak normalize edildi (CRLF kaynakta da çalışır)');
  const degistir = (eski, yeni, aciklama, zorunlu = true) => {
    if (!icerik.includes(eski)) {
      if (zorunlu) { uyari(`bulunamadı (${aciklama}): ${eski.slice(0, 60)}`); hata++; }
      return;
    }
    degisimler.push(aciklama);
    // Dünya çapında değiştir
    icerik = icerik.split(eski).join(yeni);
  };

  // --- 1) CDN -> yerel ---
  degistir(
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
    'vendor/qrcode.min.js',
    'QRCodejs CDN -> yerel'
  );
  degistir(
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'vendor/xlsx.full.min.js',
    'SheetJS CDN -> yerel'
  );

  // --- 2) Google Fonts -> sistem yazı tipi ---
  // Satır sonu farklarına (\r\n) takılmasın diye desenle bulunur.
  const fontDeseni = /<link[^>]*rel="preconnect"[^>]*fonts\.googleapis\.com[^>]*>\s*<link[^>]*href="https:\/\/fonts\.googleapis\.com\/css2[^"]*"[^>]*>/i;
  if (fontDeseni.test(icerik)) {
    icerik = icerik.replace(fontDeseni,
      '<!-- Yazı tipleri: internet gerekmesin diye sistem yazı tipi kullanılıyor.\n' +
      '     Kulübede internet olmayabilir; harici fontu beklemek arayüzü bloklar. -->\n' +
      '<style>\n' +
      '  :root{\n' +
      '    --font-govde: "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;\n' +
      '    --font-baslik: var(--font-govde);\n' +
      '  }\n' +
      '  body{ font-family: var(--font-govde) !important; }\n' +
      '  h1,h2,h3,.display{ font-family: var(--font-baslik) !important; }\n' +
      '</style>');
    degisimler.push('Google Fonts -> sistem yazı tipi');
  } else {
    uyari('Google Fonts bağlantısı bulunamadı (bulut yazı tipi kalabilir)');
    hata++;
  }

  // Uygulama CSS'inde doğrudan yazı tipi adları geçiyor; onları da değiştir.
  icerik = icerik
    .split("'Space Grotesk',system-ui,sans-serif").join("var(--font-baslik)")
    .split("'Inter',system-ui,sans-serif").join("var(--font-govde)");

  // --- 3) Harici kod yükleyicilerini yerelleştir ---
  // Uygulama iki harici kütüphane daha yüklemeye çalışıyor:
  //   * OpenCV.js  — plaka bölgesi bulmak için (isteğe bağlı hızlandırma)
  //   * Tesseract.js — tarayıcı içi OCR yedeği
  // Kulübede internet olmayabilir; bu iki istek zaman aşımına takılıp
  // arayüzü kilitler. Yerel (bulunmayan) bir yola çeviriyoruz: yükleme
  // anında başarısız olur, uygulamanın kendi hata yolu devreye girer ve
  // HİÇBİR dış istek yapılmaz. (Asıl okuma zaten sunucuda.)
  const HARICI_YUKLEYICILER = [
    ['https://cdn.jsdelivr.net/npm/tesseract.js@5.0.4/dist/tesseract.min.js',
      'vendor/tesseract.min.js', 'Tesseract.js CDN -> yerel (bulunmuyor, yükleme yapılmaz)'],
    // OpenCV.js: UYGULAMANIN İSTEĞE BAĞLI HIZLANDIRMASI.
    // 404 vermemesi için boş ama GERÇEK bir yerel dosyaya yönlendiriyoruz.
    // Uygulamanın `ensureOpenCV()` fonksiyonu dosyayı yükler, `window.cv`
    // tanımsız olduğu için `CV_READY = false` olur ve kendi "basit ön
    // işleme" yedeğine sessizce düşer. Böylece:
    //   * konsolda korkutucu 404 + "OpenCV yüklenemedi" hatası GÖRÜLMEZ
    //   * kulübede internet olmasa da davranış tutarlıdır
    //   * asıl okma zaten sunucuda yapıldığı için işlev kaybı yoktur
    ['https://docs.opencv.org/4.9.0/opencv.js',
      'vendor/opencv-bos.js', 'OpenCV.js CDN -> yerel boş dosya (sessiz devre dışı)'],
  ];
  for (const [harici, yerel, aciklama] of HARICI_YUKLEYICILER) {
    if (icerik.includes(harici)) {
      icerik = icerik.split(harici).join(yerel);
      degisimler.push(aciklama);
    } else {
      degisimler.push(aciklama + ' (zaten yok)');
    }
  }

  // --- 3b) OpenCV ön işleme yolunu tamamen devre dışı bırak ---
  //
  // OpenCV.js isteğe bağlı bir HIZLANDIRMADIR; asıl plaka okuma artık
  // bilgisayarda yapılıyor. Açık bırakılırsa:
  //   * konsolda 404 + "OpenCV yüklenemedi" uyarısı çıkar (kullanıcı sistemin
  //     bozuk olduğunu sanır)
  //   * ya da (dosya bulunursa) YANLIŞ bir bildirim çıkar:
  //     "Gelişmiş görüntü motoru yüklendi" — oysa yüklenmemiştir.
  // Hiçbir işlev kaybı olmadığı için yolu kapatıyoruz; uygulamanın kendi
  // basit ön işleme yedeği zaten devreye girecek.
  const OPencv_KAPAT = 'if(!CV_READY && !CV_LOADING){';
  if (icerik.includes(OPencv_KAPAT)) {
    icerik = icerik.split(OPencv_KAPAT).join('if(false){ /* yerel OCR: OpenCV gereksiz */');
    degisimler.push('OpenCV ön işleme yolu devre dışı (konsol temiz, yanlış bildirim yok)');
  } else {
    uyari('OpenCV tetikleyicisi bulunamadı — konsolda 404 çıkabilir');
  }

  // --- 4) Yerel eklentiler ---
  degistir(
    '</body>',
    '  <!-- Yerel eklentiler (kulübe bilgisayarından yayınlanan sürüm) -->\n' +
    '  <script src="plaka-yerel.js"></script>\n' +
    '  <script src="senkron.js"></script>\n' +
    '  <!-- Sürekli kamera okuma (varsayılan KAPALI). Varsayılan plaka-yerel.js\n' +
    '       tarafından kurulan CKYerel nesnesini GENİŞLETİR. -->\n' +
    '  <script src="canli-okuma.js"></script>\n' +
    '  <!-- Yerel kamera (SERTİFİKA GEREKMEZ). getUserMedia yalnizca https\n' +
    '       ister; bu yol telefonun kendi kamerasini acar ve duz http\n' +
    '       adresinde de calisir. Musterilerimiz hicbir ayar yapmaz. -->\n' +
    '  <script src="yerel-kamera.js"></script>\n' +
    '  <!-- Güvenli kaynak uyarısı (KAMERA ÖN KOSULU). Tarayıcı kamerayı\n' +
    '       yalnızca https altında açar; http adresinde kullanıcı belirsiz bir\n' +
    '       hata görür ve sebebini bilmez. Bu eklenti sebebi ve TE SEFERLIK\n' +
    '       çözümü açıkça yazar. Güvenli kaynakta HİÇBİR ŞEY olmaz. -->\n' +
    '  <script src="guvenli-kaynak.js"></script>\n' +
    '</body>',
    'yerel eklentiler eklendi'
  );

  // --- 6) Yerel kamera yolu (SERTİFİKA GEREKMEZ) -------------------------
  // ÖLÇÜLEN HATA (kullanıcı): "Telefona sertifika indirmek ile olacak iş
  // değil, müşterilerimizi uğraştırmamamız gerekiyor." Haklı.
  //
  // getUserMedia güvenli kaynak ister; ama <input type="file" capture> DEĞİZ.
  // Bu yüzden düz HTTP adresinde de plaka okunabilir: düğme telefonun kendi
  // kamerasını açar, fotoğraf gelir, mevcut okuma zinciri çalışır.
  degistir(
    '<input type="file" id="camFile" accept="image/*" style="display:none">',
    '<input type="file" id="camFile" accept="image/*" style="display:none">\n' +
    '   <!-- YEREL KAMERA: guvenli kaynak (https) GEREKMEZ. capture="environment"\n' +
    '        telefonun kendi kamerasini acar; duz HTTP adresinde de calisir. -->\n' +
    '   <input type="file" id="ckYerelKamera" accept="image/*" capture="environment" style="display:none">',
    'yerel kamera girdisi eklendi (capture=environment)'
  );

  // Düğme: kamera ekranının üst çubuğuna
  degistir(
    '<button class="cam-glass" id="camGallery" type="button"',
    '<button class="cam-glass" id="ckYerelKameraBtn" type="button" title="Telefonun kamerasıyla çek" aria-label="Telefonun kamerasıyla çek"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/></svg></button>\n' +
    '  <button class="cam-glass" id="camGallery" type="button"',
    'yerel kamera düğmesi eklendi'
  );

  // Bağlantı: düğme eklentiyi açar.
  //
  // Neden ayrı eklenti? Çünkü uygulamanın galeri dinleyicisi ANONİM bir
  // fonksiyon; doğrudan çağrılamaz. Metinle uğraşmak yerine eklenti,
  // uygulamanın kendi kullandigi iki API'yi cagirir:
  //     Cam.compressCanvas(...)  -> sıkıştırma (aynen uygulamanın yaptığı gibi)
  //     Cam.read(...)            -> /plaka/oku isteği
  // Yani görüntü işleme ve okuma mantığı TEK YERDE kalır.
  degistir(
    "$('#camGallery').onclick=()=>{ $('#camFile').click(); };",
    "$('#camGallery').onclick=()=>{ $('#camFile').click(); };\n" +
    "  /* Yerel kamera: sertifika GEREKMEZ (capture=environment). */\n" +
    "  $('#ckYerelKameraBtn').onclick=()=>{ window.CKYerelKamera && window.CKYerelKamera.ac(); };",
    'yerel kamera düğmesi bağlandı'
  );

  // Kamera hata mesajı: yanlış yönlendirmeyi düzelt
  //
  // ÖLÇÜLEN HATA (kullanıcı): "Telefona sertifika indirmek ile olacak iş değil..."
  // Bu mesaj da aynı hatayı yapıyordu: "https adresinden açın" diyordu. Oysa
  // plaka okuma https OLMADAN da çalışır — telefonun kendi kamerası
  // (capture=environment) güvenli kaynak istemez.
  degistir(
    "this.ph('<b>Kamera erişimi yok.</b><br>Tarayıcı bu sayfada kamerayı açmıyor. Dosya olarak açılan uygulamalarda bu sınırlıdır — uygulamayı bir <b>https</b> adresinden açın ya da aşağıdaki düğmeleri kullanın.');",
    "this.ph('<b>Kamera akışı açılamadı.</b><br>Uygulama içinde canlı önizleme yalnızca <b>https</b> adreslerde çalışır; ancak plakayı yine de okutabilirsiniz: yukarıdaki <b>kamera</b> düğmesi telefonunuzun kendi kamerasını açar ve <b>sertifika gerekmez</b>. Olmazsa galeriden fotoğraf seçin ya da plakayı elle yazın.');",
    'kamera hata mesajı düzeltildi (sertifika yönlendirmesi kaldırıldı)'
  );

  // --- 5) "Sürekli kamera okuma" ayar anahtarı -----------------------------
  // Kamerayla otomatik çekim satırının hemen ARDASINA eklenir: ikisi de
  // plaka okuma davranışı, birlikte görünmeleri doğal.
  degistir(
    '<div class="sw" data-sw="autoCam"></div>\n        </div>',
    '<div class="sw" data-sw="autoCam"></div>\n        </div>\n\n' + AYAR_SATIRI,
    'sürekli okuma ayar anahtarı eklendi'
  );

  // Anahtar davranışı: tercih kaydedilir AYRICA eklentiye bildirilir.
  degistir(
    "if(k==='autoFirm') firmToggle($('#courierCoField'), P.autoFirm); }; });",
    "if(k==='autoFirm') firmToggle($('#courierCoField'), P.autoFirm);\n" +
    "  // Sürekli okuma: tercih kaydedilir AYRICA eklentiye bildirilir.\n" +
    "  //\n" +
    "  // ÖLÇÜLEN HATA (kullanıcı geri bildirimi): \"ayarlardan sürekli kamera\n" +
    "  // taramasını etkinleştirsek de bu çalışmıyor, yine çekim düğmesine\n" +
    "  // tıklamamız gerekiyor.\"\n" +
    "  //\n" +
    "  // KÖK NEDEN: bu blok kamera AÇIK DEĞİLSE anahtarı hemen geri\n" +
    "  // alıyordu. Kullanıcı Ayarlar ekranındadır ve kamera sayfası kapalı —\n" +
    "  // yani akış yok. Doğrusu: ayarı açan KİŞİ değil SİSTEM kamerayı\n" +
    "  // açar (canli-okuma.js -> Cam.open), tıpkı \"Kamerayı Aç ve Okut\"\n" +
    "  // düğmesi gibi. Kullanıcı iki şey yapmaz: anahtarı açar, tutar.\n" +
    "  if(k==='livePlate'){\n" +
    "  if(!(window.CKYerel && typeof window.CKYerel.canliAc==='function')){\n" +
    "    P.livePlate = false; savePrefs(); paintPrefs();\n" +
    "    toast('Sürekli okuma kullanılamıyor (eklenti yok)','err');\n" +
    "    return;\n" +
    "  }\n" +
    "  P.livePlate = true; savePrefs(); paintPrefs();\n" +
    "  var istek = window.CKYerel.canliAc(true);\n" +
    "  // canliAc artık bir SÖZ VERME döndürür: kamera açılıp akış oturunca\n" +
    "  // true döner. Kullanıcı o ana kadar bekler; \"çalışmıyor\" demeyiz.\n" +
    "  Promise.resolve(istek).then(function(acik){\n" +
    "    if(!acik){\n" +
    "      P.livePlate = false; savePrefs(); paintPrefs();\n" +
    "      toast('Kamera açılamadı — tarayıcı izinlerini kontrol edin','err');\n" +
    "    } else {\n" +
    "      toast('Sürekli okuma açık — kamerayı plakaya tutun','ok');\n" +
    "    }\n" +
    "  }).catch(function(){\n" +
    "    P.livePlate = false; savePrefs(); paintPrefs();\n" +
    "    toast('Sürekli okuma başlatılamadı','err');\n" +
    "  });\n" +
    "  }\n" +
    ' }; });',
    'sürekli okuma anahtar davranışı bağlandı'
  );

  // paintPrefs: anahtar TERCİH durumunu gösterir, ayrıca eklentinin gerçekten
  // çalışıp çalışmadığını yansıtır. "Açık ama çalışmıyor" en sinir bozucu
  // belirsizliklerden biridir.
  degistir(
    "function paintPrefs(){\n  $$('[data-sw]').forEach(sw=>sw.classList.toggle('on',!!P[sw.dataset.sw]));",
    "function paintPrefs(){\n  $$('[data-sw]').forEach(sw=>sw.classList.toggle('on',!!P[sw.dataset.sw]));\n" +
    '  // Sürekli okuma: tercih durumu + gerçek çalışma durumu.\n' +
    '  (function(){\n' +
    '    var canli = window.CKYerel && window.CKYerel.canli;\n' +
    "    var notEl = $('#livePlateNote');\n" +
    '    if(!canli || !notEl) return;\n' +
    '    if(P.livePlate){\n' +
    "      notEl.textContent = canli.basliyor\n" +
    "        ? 'Kamera açılıyor…'\n" +
    "        : canli.calisiyor\n" +
    "          ? 'AÇIK — kamerayı plakaya tutun, bulunca titreşimle bildirir. Kapatmak için bu anahtarı kapatın.'\n" +
    "          : 'Durdu';\n" +
    '    } else {\n' +
    "      notEl.textContent = 'Kamerayı plakaya tut; sistem kendi okusun. Pili daha hızlı bitirir.';\n" +
    '    }\n' +
    '  })();',
    'paintPrefs sürekli okuma durumunu gösteriyor'
  );

  // -----------------------------------------------------------------------
  //  ÇIKTI DOĞRULAMASI — üretilen sayfa gerçekten ayrıştırılabilir mi?
  // -----------------------------------------------------------------------
  // Bu adım olmadan dönüştürücü, bozuk bir HTML üretip yeşil bildirebilirdi.
  // Ölçülen hata tam olarak buydu: kapanış parantezleri kayboldu, dönüştürücü
  // "ok" dedi, tarayıcı "Unexpected end of input" dedi.
  const vmGerekirMi = (() => { try { require('vm'); return true; } catch { return false; } })();
  if (vmGerekirMi) {
    const vm = require('vm');
    const reScript = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m2, gomulu = 0, bozuk = [];
    while ((m2 = reScript.exec(icerik)) !== null) {
      if (/src\s*=/.test(m2[1] || '')) continue;
      const govde = m2[2] || '';
      if (!govde.trim()) continue;
      gomulu++;
      try {
        new vm.Script(govde);
      } catch (e) {
        const sr = icerik.slice(0, m2.index).split('\n').length;
        bozuk.push('satır ' + sr + ': ' + e.message);
      }
    }
    // Harici betikler gerçekten var mı? (yoksa tarayıcı 404 verir)
    const eksikHarici = [];
    for (const mm of icerik.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)) {
      const yol = mm[1].split('?')[0];
      if (/^https?:\/\//i.test(yol)) continue;
      if (!fs.existsSync(path.join(HEDEF_DIZIN, yol))) eksikHarici.push(yol);
    }

    if (bozuk.length) {
      console.error('  HATA: üretilen sayfanın gömülü script\'i GEÇERSİZ:');
      bozuk.forEach((x) => console.error('       ' + x));
      console.error('       Bu çıktı tarayıcıda ÇALIŞMAZ. Dönüşüm kuralını gözden geçir.');
      hata++;
    } else if (gomulu > 0) {
      degisimler.push('çıktı doğrulandı: ' + gomulu + ' gömülü script geçerli');
    }
    if (eksikHarici.length) {
      console.error('  HATA: sayfa VAR OLMAYAN harici betiğe bağlı: ' + eksikHarici.join(', '));
      hata++;
    }
  }

  return { icerik, degisimler };
}

// ---------------------------------------------------------------------------
// 3) Çalıştır
// ---------------------------------------------------------------------------
console.log('Security-ST -> companion/public/telefon');
if (!fs.existsSync(KAYNAK)) {
  console.error('KAYNAK BULUNAMADI: ' + KAYNAK);
  process.exit(1);
}

const { icerik, degisimler } = donustur(oku(KAYNAK));

// --- Kendini doğrula: hiçbir harici bağımlılık kalmamalı ---
const kalanHarici = [...icerik.matchAll(/(?:src|href)\s*=\s*"(https?:\/\/[^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !u.includes('w3.org') && !u.includes('earth.google') && !u.includes('maps'));
if (kalanHarici.length) {
  uyari('kalan harici kaynak: ' + kalanHarici.join(', '));
  hata++;
}

// Anahtar sızdırması denetimi: OCR API anahtarı biçimi "K" + rakamlar
if (/apiKeys\s*:\s*\[\s*'K\d+/.test(icerik) || /'[a-f0-9]{40}'/.test(icerik)) {
  uyari('DOSYADA API ANAHTARI VAR — kaldırılmalı');
  hata++;
}

yaz(HEDEF, icerik);
basari('index.html yazıldı (' + Math.round(icerik.length / 1024) + ' KB)');
degisimler.forEach((d) => basari(d));

yaz(path.join(HEDEF_DIZIN, 'ocr-config.js'), OCR_CONFIG);
basari('ocr-config.js üretildi (anahtarsız, bulut kapalı)');

// --- senkronizasyon eklentisi ------------------------------------------------
// Aynı kökenli yayında eşleşme otomatiktir (adres/anahtar girilmez), ama
// dosyanın kendisi gömülü değil: tek doğruluk kaynağı phone/ altındadır.
const SENKRON_KAYNAK = path.join(KOK, 'phone', 'guvenlik-sync.js');
if (!fs.existsSync(SENKRON_KAYNAK)) {
  uyari('phone/guvenlik-sync.js bulunamadı — senkronizasyon eklentisi üretilemedi');
  hata++;
} else {
  yaz(path.join(HEDEF_DIZIN, 'senkron.js'), oku(SENKRON_KAYNAK));
  basari('senkron.js üretildi (otomatik eşleşme: ' +
    Math.round(fs.statSync(SENKRON_KAYNAK).size / 1024) + ' KB)');
}

if (hata) {
  console.error('\n' + hata + ' sorun var — çıktı güvenilmez.');
  process.exit(1);
}
console.log('\nDönüştürme tamam.');
