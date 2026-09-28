'use strict';
// ============================================================================
//  TELEFON UYGULAMASI — statik doğrulama ve SÖZDİZİMİ denetimi
// ----------------------------------------------------------------------------
//  Bu dosya neden ayrı ve neden bu kadar ısrarçı?
//
//  ÖLÇÜLEN HATA: "telefon/:7831 Uncaught SyntaxError: Unexpected end of
//  input". Sayfadaki gömülü <script> bloğunda forEach'in kapanış parantezleri
//  kaybolmuştu. Sonuç: kullanıcının telefonunda UYGULAMA HİÇ ÇALIŞMIYORDU —
//  eşleşme yok, plaka okuma yok, kamera yok.
//
//  Ve ölçülen ikinci hata: o sırada mevcut olan testler (test-ui-static.js)
//  sayfayı kontrol etti ama GÖMÜLÜ JAVASCRIPT'in sözdizimini denetLEMEDİ.
//  Bu yüzden hata paketlemeye, kuruluma ve kullanıcının telefonuna kadar
//  geldi. Testler yeşildi; uygulama çalışmıyordu.
//
//  DERS: "metin dosyada var" demek "tarayıcıda çalışıyor" demek DEĞİLDİR.
//  Gömülü script'ler gerçekten ayrıştırılmalıdır.
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KOK = path.join(__dirname, '..');
const HTML = path.join(KOK, 'companion', 'public', 'telefon', 'index.html');

let pass = 0, fail = 0;
const bolum = (b) => console.log(`\n--- ${b} ---`);
function ok(kosul, aciklama, ayrinti = '') {
  if (kosul) { pass++; console.log(`PASS — ${aciklama}`); }
  else { fail++; console.log(`FAIL — ${aciklama}${ayrinti ? ' :: ' + ayrinti : ''}`); }
}

console.log('Telefon › ' + path.relative(KOK, HTML));

if (!fs.existsSync(HTML)) {
  console.error('HTML dosyası yok: ' + HTML);
  process.exit(1);
}
const html = fs.readFileSync(HTML, 'utf8');

// ===========================================================================
bolum('Gömülü script sözdizimi — en kritik denetim');
// ===========================================================================
{
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, gomulu = 0, harici = 0;
  const hatalar = [];

  while ((m = re.exec(html)) !== null) {
    const ozellik = m[1] || '';
    const govde = m[2] || '';
    const satir = html.slice(0, m.index).split('\n').length;

    if (/src\s*=/.test(ozellik)) {
      harici++;
      const yol = (ozellik.match(/src\s*=\s*["']([^"']+)/) || [, '?'])[1];
      // Harici betik dosyası GERÇEKTEN var mı? Yoksa tarayıcı 404 verir ve
      // bağımlılık sessizce kaybolur — ölçülen hata sınıfı.
      const dosya = path.join(path.dirname(HTML), yol.split('?')[0]);
      ok(fs.existsSync(dosya), `harici betik mevcut: ${yol}`, dosya);
      continue;
    }
    if (!govde.trim()) continue;

    gomulu++;
    try {
      new vm.Script(govde, { filename: `index.html:<script> satır ${satir}` });
    } catch (e) {
      const satirNo = (e.stack || '').match(/evalmachine[^:]*:(\d+)/);
      hatalar.push(`satır ${satir}${satirNo ? ' (gövde satır ' + satirNo[1] + ')' : ''}: ${e.message}`);
    }
  }

  ok(gomulu >= 1, `gömülü script bulundu (${gomulu} blok, ${harici} harici)`);
  ok(hatalar.length === 0,
    'TÜM gömülü script\'ler geçerli sözdizime sahip',
    hatalar.join(' | '));
  for (const h of hatalar) console.log('       -> ' + h);
}

// ===========================================================================
// ===========================================================================
bolum('Parantez dengesi — TANI SALI (karar vermez)');
// ===========================================================================
// ÖNEMLİ: bu bölüm karar VERMEZ, yalnızca nereye bakılacağını söyler.
//
// Neden? vm.Script ve node --check bu dosyanın GEÇERLİ olduğunu doğruladı,
// elle yazılmış bu tarayıcı ise bir yerde yanlış işaret üretti (muhtemelen bir
// regex literal'ı bölme işareti sanıyor).
//
// Geçmişte tam olarak bu hatanın TERSİ oldu: elle tarayıcı "denge yok" dedi
// ve test kırmızı oldu, oysa kod geçerliydi. YANLIŞ POZİTİF BİR TEST, TEST
// OLMAMAKTAN DAHA KÖTÜDÜR: ekibi kırmızı testleri görmezden gelmeye alıştırır.
//
// Bir doğrulama aracı gerçek doğrulama aracıyla çeliştiğinde PARSER KAZANIR.
{
  // ---------------------------------------------------------------------------
  // Tarayıcı bir fonksiyona dönüştürüldü, çünkü artık hem GERÇEK hem de
  // ÖRNEK girdiyle sınanabilir. Daha önce yalnızca gerçek girdiye bakıyordu;
  // "bulamadı" çıktısı hiçbir şey kanıtlamıyordu (hiçbir şey bulmayan bir
  // tarayıcı da aynı cümleyi söyler). Negatif kontroller olmadan bu bölüm
  // yeşil bir bilgi değil, süs idi.
  // ---------------------------------------------------------------------------
  function dengesizlikBul(govde) {
    const ac = { '(': ')', '[': ']', '{': '}' };
    const kap = { ')': '(', ']': '[', '}': '{' };
    const yigin = [];
    let i = 0, durum = 'kod', sonReges = 0;
    let bulunan = null;

    // --- '/' BÖLME Mİ REGEKS Mİ? ---------------------------------------
    // ÖLÇÜLEN HATA: eski kural `/` den önceki TEK karaktere bakıyordu ve
    // boşluğu atlıyordu. `viewRect.left) / viewRect.width` satırında
    // önceki karakter BOŞLUK olduğu için '/' regex sanıldı, tarayıcı satır
    // sonunda "regex bitti" deyip o satırdaki gerçek `{`'i yuttu ve 60
    // satır sonra UYDURMA "kapanmayan }" bildirdi. Kod ise GEÇERLİYDİ.
    //
    // Doğru kural: '/'den önceki ANLAMLI (boşluk ve yorum atlanmış) karakter
    // bir değer ifade ediyorsa (harf, rakam, ), ], }, tırnak) bu BÖLMEDİR.
    // Başka bir şeyse (işleç, ayırıcı, blok başı) regex olabilir.
    const oncekiAnlamli = (idx) => {
      for (let k = idx - 1; k >= 0; k--) {
        const ch = govde[k];
        if (/\s/.test(ch)) continue;
        if (ch === '/' && govde[k - 1] === '/') { while (k >= 0 && govde[k] !== '\n') k--; continue; }
        if (ch === '/' && govde[k - 1] === '*') {
          k -= 2;
          while (k >= 0 && !(govde[k] === '*' && govde[k + 1] === '/')) k--;
          k--;
          continue;
        }
        return ch;
      }
      return '';
    };
    const bolmeMi = (idx) => {
      const p = oncekiAnlamli(idx);
      if (p === '') return false;                    // blok başı -> regex olabilir
      return /[\w)\]}'"`]/.test(p);                 // değer -> BÖLME
    };

    while (i < govde.length && !bulunan) {
      const c = govde[i], n = govde[i + 1];
      if (durum === 'kod') {
        if (c === '/' && n === '/') { durum = 'ysatir'; i += 2; continue; }
        if (c === '/' && n === '*') { durum = 'yblok'; i += 2; continue; }
        if (c === '"' || c === "'") { durum = c; i++; continue; }
        if (c === '`') { durum = 'sablon'; i++; continue; }
        if (c === '/' && !bolmeMi(i)) { durum = 'regex'; i++; sonReges = 0; continue; }
        if (ac[c]) { yigin.push({ c, i }); i++; continue; }
        if (kap[c]) {
          const t = yigin[yigin.length - 1];
          if (!t || t.c !== kap[c]) {
            bulunan = `gövde satır ${govde.slice(0, i).split('\n').length}: kapanmayan "${c}"`;
            break;
          }
          yigin.pop(); i++; continue;
        }
        i++; continue;
      }
      if (durum === 'ysatir') { if (c === '\n') durum = 'kod'; i++; continue; }
      if (durum === 'yblok') { if (c === '*' && n === '/') { durum = 'kod'; i += 2; continue; } i++; continue; }
      if (durum === 'regex') {
        if (c === '\\') { i += 2; continue; }
        if (c === '[') sonReges++;
        else if (c === ']') sonReges--;
        else if (c === '/' && sonReges === 0) { durum = 'kod'; i++; while (/[gimuyd]/.test(govde[i] || '')) i++; continue; }
        else if (c === '\n') { durum = 'kod'; i++; continue; }
        i++; continue;
      }
      if (durum === '"' || durum === "'") {
        if (c === '\\') { i += 2; continue; }
        if (c === durum) durum = 'kod';
        i++; continue;
      }
      if (durum === 'sablon') {
        if (c === '\\') { i += 2; continue; }
        if (c === '`') { durum = 'kod'; i++; continue; }
        if (c === '$' && n === '{') {
          let d = 1; i += 2;
          while (i < govde.length && d > 0) { if (govde[i] === '{') d++; else if (govde[i] === '}') d--; i++; }
          continue;
        }
        i++; continue;
      }
    }
    if (!bulunan && yigin.length) {
      const t = yigin[yigin.length - 1];
      bulunan = `kapanmamış "${t.c}" (gövde satır ${govde.slice(0, t.i).split('\n').length})`;
    }
    return bulunan;
  }

  // --- TARAYICININ KENDISI SINAANIR -----------------------------------------
  // "Bulamadı" diyebilmek için önce BULMAYI bilmesi gerekir. Bu üç kontrol
  // olmadan bölümün yeşil olması hiçbir anlam taşımazdı.
  ok(!!dengesizlikBul('function a(){ if(x){ y(); }\n'), 'tarayıcı kapanmayan } buluyor (kontrol)');
  ok(!!dengesizlikBul('f( g( 1 ), 2;\n'), 'tarayıcı kapanmayan ) buluyor (kontrol)');
  ok(dengesizlikBul('const a = b / c; const d = { e: 1 };\n') === null,
    'tarayıcı boşluklu bölmeyi (/ ) regex sanmıyor (ÖLÇÜLEN HATA regresyonu)');
  ok(dengesizlikBul('const s = "}"; const t = `a${b}c`; const u = /[{}]/g;\n') === null,
    'tarayıcı string/şablon/regex içindeki süslüleri saymıyor (kontrol)');

  // --- GERÇEK GİRDİ --------------------------------------------------------
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, ipucu = null;
  while ((m = re.exec(html)) !== null && !ipucu) {
    if (/src\s*=/.test(m[1] || '')) continue;
    const govde = m[2] || '';
    if (!govde.trim()) continue;
    ipucu = dengesizlikBul(govde);
  }

  if (ipucu) {
    console.log(`BİLGİ — elle tarayıcı bir dengesizlik sezdi: ${ipucu}`);
    console.log('       (karar yukarıdaki ayrıştırıcı denetimine aittir)');
  } else {
    console.log('BİLGİ — elle tarayıcı dengesizlik bulmadı (kontroller geçtiği için bu anlamlı)');
  }
}

// ===========================================================================
bolum('Kamera sertifika GEREKTİRMEZ (ürün kararı)');
// ===========================================================================
// ÖLÇÜLEN HATA (kullanıcı, iki kez bildirildi):
//   1) "HTTPS nerede, telefondan nasıl açacağız?"
//   2) "Telefona sertifika indirmek ile olacak iş değil, müşterilerimizi
//      uğraştırmamamız gerekiyor."
//
// Teknik gerçek: getUserMedia güvenli kaynak ister; ancak
// <input type="file" capture="environment"> yani telefonun KENDİ kamerası
// güvenli kaynak İSTEMEZ. Plaka okuma düz http üzerinde de çalışır.
//
// Bu bölüm, kararın KAYBOLMASINI engeller: sertifika kurulumu "zorunluluk"
// olarak sunulamaz ve yol her yerde bulunmalıdır.
{
  const yk = path.join(path.dirname(HTML), 'yerel-kamera.js');
  ok(fs.existsSync(yk), 'yerel-kamera.js dosyası mevcut');
  ok(/yerel-kamera\.js/.test(html), 'sayfa yerel kamera eklentisini yüklüyor');
  const kaynak = fs.existsSync(yk) ? fs.readFileSync(yk, 'utf8') : '';

  // 1) capture="environment": guvenli kaynak gerektirmeyen yol
  ok(/id="ckYerelKamera"/.test(html) && /capture/.test(html),
    'yerel kamera girdisi capture="environment" ile sayfada');
  ok(/id="ckYerelKameraBtn"/.test(html), 'yerel kamera düğmesi sayfada');

  // 2) Bu yol uygulamanın KENDİ okuma zincirini kullanır (kopya değil)
  ok(/Cam\.compressCanvas/.test(kaynak) && /Cam\.read/.test(kaynak),
    'yerel kamera yolu uygulamanın kendi okuma zincirini çağırıyor (/plaka/oku)');

  // 3) Guvensiz kaynakta video akisi denenMEMELI
  ok(/isSecureContext/.test(kaynak), 'güvenli kaynak durumu denetleniyor');
  ok(/Cam\.open\s*=\s*function/.test(kaynak),
    'Cam.open güvenli kaynakta yerel kameraya yönlendiriliyor (sarmalanmış)');

  // 4) Kullanıcıya eylem yaptırılmamalı
  const gkYol = path.join(path.dirname(HTML), 'guvenli-kaynak.js');
  const gk = fs.existsSync(gkYol) ? fs.readFileSync(gkYol, 'utf8') : '';
  // Yorumlar sıyrılır: kullanıcı yorumları görmez.
  const gkKod = gk.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!!gk, 'kaynak notu eklentisi mevcut');
  ok(!/kok\.cer/.test(gkKod),
    'kaynak notu sertifika indirmeyi ÖNERMİYOR (zorluluk dayatmıyor)');
  ok(!/tam güven|VPN ve Cihaz Yönetimi/i.test(gkKod),
    'kaynak notunda "tam güven / profil kur" yönergesi YOK');
  ok(!/sertifika kur/i.test(gkKod), 'kaynak notunda "sertifika kur" yönergesi YOK');
  ok(!/https[^.]{0,30}(şart|gereklidir|zorunlu)/gi.test(html),
    "sayfa https'i zorunlu tutmuyor");
  ok(/Kamera akışı açılamadı/.test(html),
    'kamera hata mesajı doğru yolu gösteriyor (sertifika değil)');
  ok(!/bir <b>https<\/b> adresinden açın/.test(html),
    'eski "https adresinden açın" yönlendirmesi kaldırıldı');
}

// ===========================================================================
bolum('Sürekli okuma bağlantısı');
// ===========================================================================
// Ölçülen hata sınıfı: HTML'de bir şey aranıyor ama o dosya/olay yoksa
// özellik sessizce çalışmaz.
{
  const eklenti = path.join(path.dirname(HTML), 'canli-okuma.js');
  ok(fs.existsSync(eklenti), 'canli-okuma.js dosyası mevcut');
  ok(/canli-okuma\.js/.test(html), 'index.html canlı okuma eklentisini yüklüyor');
  ok(/data-sw="livePlate"/.test(html), 'ayarlarda "Sürekli kamera okuma" anahtarı var');
  ok(/k==='livePlate'/.test(html), 'anahtar eklentiye bağlı (canliAc)');
  ok(/livePlateNote/.test(html), 'durum metni gösteriliyor');

  // Eklenti CKYerel'i GENİŞLETİR; yeni nesne kurmamalıdır.
  const kaynak = fs.readFileSync(eklenti, 'utf8');
  ok(/var CKYerel = window\.CKYerel/.test(kaynak),
    'eklenti mevcut CKYerel nesnesini genişletiyor (yenisini kurmuyor)');
  ok(/sureciOkuAyar/.test(kaynak), 'eklenti ayarı ayrı bir alanda tutuyor');
  ok(/calisiyor/.test(kaynak), 'eklenti çalışma durumunu ayrı tutuyor');
}

// ===========================================================================
bolum('Beklenen yapı değişmedi');
// ===========================================================================
// Yeni özellik eklerken mevcut işlevlerin KAYBOLMADIĞINI doğrula.
{
  const beklenen = [
    ['plaka-yerel.js yükleniyor', /plaka-yerel\.js/],
    ['senkron.js yükleniyor', /senkron\.js/],
    ['kamera açılınca otomatik çekim', /data-sw="autoCam"/],
    ['yeni plaka öğrenme', /data-sw="autolearn"/],
    ['kayda plaka sor', /data-sw="autoPlate"/],
    ['firma listesi', /data-sw="autoFirm"/],
    ['sesli okuma', /data-sw="tts"/],
    ['ayarlar sekmesi', /data-tab="set"/],
    ['OCR yapılandırması', /ocr-config\.js/],
    ['kamera sayfası', /id="camSheet"/],
  ];
  for (const [ad, desen] of beklenen) {
    ok(desen.test(html), `mevcut özellik korunmuş: ${ad}`);
  }
}

// ===========================================================================
bolum('Harici bağımlılık yok');
// ===========================================================================
{
  const harici = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/g)]
    .map((m) => m[1]);
  ok(harici.length === 0,
    'sayfada harici kaynak yok (internet olmadan da açılır)',
    harici.slice(0, 4).join(', '));
}

bolum('Panel gömülü scriptleri SÖZDİZİMİ GEÇERLİ');
// ÖLÇÜLEN HATA: eslesme.html içinde iki fazladan `}` kalmıştı (önceki bir
// satır-aralığı ameliyatının artığı). Sonuç: "Uncaught SyntaxError:
// missing ) after argument list" — sayfadaki TÜM JavaScript ölüyordu ve
// eşleşme sayfası hiç çalışmıyordu.
//
// Bu denetim, paneldeki her gömülü script'i vm.Script ile DERLEYEREK
// sözdizimini kanıtlar. Yalnızca metin taraması yetmez: tarayıcının
// yakaladığı hata tam olarak derleme hatasıdır.
{
  const vm = require('vm');
  const panelDosyalari = ['index.html', 'kayitlar.html', 'ayar.html', 'eslesme.html'];
  for (const ad of panelDosyalari) {
    const yol = path.join(path.dirname(path.dirname(HTML)), ad); // panel public/ altında
    ok(fs.existsSync(yol), ad + ' mevcut');
    if (!fs.existsSync(yol)) continue;
    const html = fs.readFileSync(yol, 'utf8');
    const gomulu = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
    ok(gomulu.length >= 1, ad + ' gömülü script içeriyor', `${gomulu.length} adet`);
    for (let i = 0; i < gomulu.length; i++) {
      let hataYok = true, sebep = '';
      try { new vm.Script(gomulu[i][1]); }
      catch (e) { hataYok = false; sebep = e.message; }
      ok(hataYok, ad + ' script#' + (i + 1) + ' sözdizimi geçerli', sebep);
    }
    // Etiket dengesi de kontrol edilsin: </div> fazlası görsel bozulma yapar.
    const ac = (html.match(/<div\b/gi) || []).length;
    const kapa = (html.match(/<\/div>/gi) || []).length;
    ok(ac === kapa, ad + ' div etiketleri dengeli', `açık ${ac} · kapalı ${kapa}`);
  }
}

console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
