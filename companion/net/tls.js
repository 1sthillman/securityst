'use strict';
/**
 * ============================================================================
 *  HTTPS — kamera için ZORUNLU güvenli kaynak
 * ============================================================================
 *
 *  ÖLÇÜLEN SORUN (kullanıcı bildirimi, kritik):
 *  "Telefondan girince https adresinden olmalıdır yoksa kameraya izin vermiyor."
 *
 *  Bu bir özellik isteği değil, bir ENGELDİR. Tarayıcılar `getUserMedia`
 *  (kamera) yalnızca "güvenli kaynakta" (secure context) çalıştırır:
 *     - `https://`  ✔
 *     - `http://localhost` / `127.0.0.1`  ✔
 *     - `http://192.168.1.42`  ✘  ← telefonun bilgisayara bağlandığı yer
 *  Güvensiz kaynakta `navigator.mediaDevices` **tanımsızdır**: kamera hiç
 *  açılmaz, izin verilmez. Yani hem tek-çekim hem sürekli mod çalışmaz.
 *
 *  ÇÖZÜM MİMARİSİ (neden iki sertifika):
 *  IP değişir (bilgisayar Wi-Fi'ye yeniden bağlanır). Tek sertifikada her IP
 *  değişiminde telefonda yeniden güven kurulumu gerekirdi — "sistem kendi
 *  halletsin" isteğini ihlal ederdi.
 *    KÖK CA  : bir kez üretilir, SABİT kalır, telefona bir kez kurulur.
 *    YAPRAK  : IP/DNS listesi değişince yeniden üretilir, AMA aynı kökle
 *              imzalanır → telefonun güveni BOZULMAZ, kullanıcı hiçbir şey
 *              yapmaz.
 *
 *  DÜRÜSTLÜK NOTU (gizlenmiyor):
 *  Telefonda bir kez yapılması gereken tek iş "kök CA'yı kur"dur. Bunu
 *  atlatmanın yolu yoktur: tarayıcı, işletim sistemine güvenilmeyen bir
 *  sertifika için kamera vermeyi reddeder. Bu yüzden kurulum sihirli değil,
 *  **30 saniyelik ve bir kez** bir işlemdir; sonrası tamamen otomatiktir.
 *  Bilgisayarda ise kök CA Windows'un KENDİ deposuna otomatik eklenir
 *  (yönetici şifresi istemeden, `-user` deposuna) — orada hiçbir şey
 *  yapılmaz.
 * ============================================================================
 */

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

const sertifika = require('./sertifika.js');

// ============================================================================
//  DURUM
// ============================================================================
const durum = {
  kok: null,              // { pemDer, anahtarPem, parmakIzi }
  yaprak: null,           // { anahtarPem, pemDer }
  san: { dns: [], ip: [] },
  dogrulama: null,        // dogrula() çıktısı
  windows: { denendi: false, basarili: null, hata: null },
  hata: null,
  sunucu: null,
  sonDenetim: 0,
  dinleyici: null,
  gunluk: null,           // log() fonksiyonu
};

function log(...a) {
  if (typeof durum.gunluk === 'function') durum.gunluk(...a);
  else console.log(...a);
}

// ============================================================================
//  AD SETİ — sertifikada ne kapsanmalı?
// ============================================================================

function dnsAdlari() {
  const ad = new Set(['cinarkoy-sync.local', 'localhost']);
  let h = '';
  try { h = String(os.hostname() || '').toLowerCase(); } catch {}
  // Bilgisayar adı olmayan/bozuk karakterliyse sertifikaya koymayız:
  // geçersiz bir DNS adı tüm SAN listesini çöpe atar.
  if (h && /^[a-z0-9][a-z0-9-]{0,62}$/.test(h)) {
    ad.add(h);
    ad.add(h + '.local');
  }
  return [...ad];
}

function ipAdresleri() {
  const out = new Set(['127.0.0.1']);
  try {
    for (const ifs of Object.values(os.networkInterfaces() || {})) {
      for (const nic of ifs || []) {
        if (nic && nic.family === 'IPv4' && nic.address) out.add(nic.address);
      }
    }
  } catch {}
  return [...out];
}

let _birincilIp = null;

/**
 * Birincil (telefonun gerçekten ulaşacağı) LAN IP adresi.
 *
 * ÖLÇÜLEN HATA: panel "https://cinarkoy-sync.local:4546" adresini gösteriyordu
 * ama bu adres HİÇ ÇÖZÜLMÜYOR (kimse mDNS ile yayınlamıyor) ve bilgisayar
 * adı "rst" yalnızca kullanılamaz bir IPv6 bağlantı-sıfırına gidiyor. Yani
 * kullanıcı paneldeki adresi telefona yazdığında sayfa AÇILMIYORDU ve kamera
 * yine açılmıyordu — kullanıcı bunu "çözüm işe yaramadı" diye okurdu.
 *
 * Doğru cevap: varsayılan rota (0.0.0.0) hangi arayüz üzerinden gidiyorsa
 * O arayüzün IP adresi. Windows'ta "route print -4" bunu doğrudan yazar.
 * Bu makinede ölçüldü: rota = 192.168.1.235 (Wi-Fi), oysa arayüz listesi
 * ilk sırada 192.168.56.1 (sanal bağdaştırıcı) veriyordu. Sıraya bakarak
 * tahmin etmek bu tuzağa düşmüştü.
 *
 * @returns {string|null}
 */
function birincilLanIp() {
  if (_birincilIp !== null) return _birincilIp || null;

  // 1) Windows: varsayılan rotanın arayüz IP'si (en güvenilir)
  try {
    if (process.platform === 'win32') {
      const c = require('child_process').execFileSync;
      const cikti = c('route', ['print', '-4'], {
        encoding: 'latin1', timeout: 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const satir of String(cikti).split(/\r?\n/)) {
        // "0.0.0.0   0.0.0.0   192.168.1.1   192.168.1.235   35"
        const m = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+\S+\s+(\d+\.\d+\.\d+\.\d+)/.exec(satir);
        if (m && m[1] !== '127.0.0.1') { _birincilIp = m[1]; return _birincilIp; }
      }
    }
  } catch (e) { /* rota okunamadı -> aşağıdaki tahmine düş */ }

  // 2) Yedek: özel (private) IPv4 adreslerinden ilk gerçek olan
  const hepsi = ipAdresleri().filter((i) => i !== '127.0.0.1');
  const ozel = hepsi.filter((i) => /^192\.168\./.test(i) || /^10\./.test(i) || /^172\.(1[6-9]|2\d|3[01])\./.test(i));
  _birincilIp = (ozel[0] || hepsi[0] || '').trim();
  return _birincilIp || null;
}

function sanSeti() {
  return { dns: dnsAdlari().sort(), ip: ipAdresleri().sort() };
}

function sanAyni(a, b) {
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ============================================================================
//  SERTİFİKA YAŞAM DÖNGÜSÜ
// ============================================================================

/**
 * Kök CA'yı yükle ya da üret. Kök SABİTTİR — IP değişse de değişmez.
 */
function kokuHazirla(dosyaYollari) {
  // sertifika.js beklediği alan adı FARKLI ({cert, key}). Uyuşmazlık sessizce
  // "kok yok" demeye yol açabilirdi; ölçülen hata buydu.
  const sonuc = sertifika.kokUretVeyaYukle({ cert: dosyaYollari.kok, key: dosyaYollari.kokKey });
  durum.kok = sonuc.kok;
  if (sonuc.kaynak === 'yeni') {
    log('INFO', `HTTPS: yerel kök CA üretildi (parmak izi ${sonuc.kok.parmakIzi})`);
  } else {
    log('INFO', `HTTPS: mevcut kök CA yüklendi (parmak izi ${sonuc.kok.parmakIzi})`);
  }
  return durum.kok;
}

/**
 * Yaprak sertifikayı SAN listesine göre üret.
 * Liste değişmediyse ve dosya sağlamsa dokunulmaz (gereksiz yeniden imzalama,
 * gereksiz bağlantı kopması olmasın).
 */
function yapragiHazirla(dosyaYollari) {
  const hedef = sanSeti();

  // Kayıtlı liste diskteki yaprakla uyuşuyor mu?
  let kayitli = null;
  try {
    if (fs.existsSync(dosyaYollari.san)) {
      kayitli = JSON.parse(fs.readFileSync(dosyaYollari.san, 'utf8'));
    }
  } catch (e) {
    log('UYARI', 'HTTPS: SAN kaydı okunamadı, yeniden üretiliyor:', e.message);
  }

  const dosyalarVar = fs.existsSync(dosyaYollari.yaprak) && fs.existsSync(dosyaYollari.yaprakKey);
  if (dosyalarVar && sanAyni(kayitli, hedef)) {
    try {
      const pemDer = fs.readFileSync(dosyaYollari.yaprak);
      const anahtarPem = fs.readFileSync(dosyaYollari.yaprakKey, 'utf8');
      // Yüklenen yaprak GERÇEKTEN geçerli mi? (bozuk kopya sessizce kalmasın)
      const d = sertifika.dogrula(durum.kok.pemDer, pemDer, hedef.dns, hedef.ip);
      if (d.tamam) {
        durum.yaprak = { anahtarPem, pemDer };
        durum.san = hedef;
        durum.dogrulama = d;
        return durum.yaprak;
      }
      log('UYARI', 'HTTPS: kayıtlı sunucu sertifikası geçersiz, yeniden üretiliyor:', d.hatalar.join('; '));
    } catch (e) {
      log('UYARI', 'HTTPS: sunucu sertifikası okunamadı, yeniden üretiliyor:', e.message);
    }
  }

  const y = sertifika.yaprakUret(durum.kok, hedef.dns, hedef.ip);
  const d = sertifika.dogrula(durum.kok.pemDer, y.pemDer, hedef.dns, hedef.ip);
  if (!d.tamam) {
    // Kendi ürettiğimiz sertifika doğrulanamıyorsa HTTPS'i AÇMIYORUZ.
    // Kamerasız çalışmayı sürdürmek, kamerasız ama "güvenli görünen" bir
    // sistemden iyidir.
    durum.hata = 'sertifika üretildi ama doğrulanamadı: ' + d.hatalar.join('; ');
    durum.dogrulama = d;
    log('HATA', 'HTTPS:', durum.hata);
    return null;
  }
  fs.writeFileSync(dosyaYollari.yaprak, y.pemDer);
  fs.writeFileSync(dosyaYollari.yaprakKey, y.anahtarPem, { mode: 0o600 });
  fs.writeFileSync(dosyaYollari.san, JSON.stringify(hedef, null, 2));
  durum.yaprak = y;
  durum.san = hedef;
  durum.dogrulama = d;
  durum.hata = null;
  log('INFO', `HTTPS: sunucu sertifikası üretildi (${hedef.dns.length} ad, ${hedef.ip.length} IP)`);
  return y;
}

// ============================================================================
//  WINDOWS GÜVENİ — bilgisayarda kullanıcı hiçbir şey yapmaz
// ============================================================================

/**
 * Kök CA'yı Windows'un KULLANICI deposuna ekler.
 *  -user  : yönetici şifresi İSTEMEZ (PrivilegesRequired=lowest ile uyumlu)
 *  Başarısız olursa sunucu ÇÖKMEZ; sadece bilgisayarda bir uyarı gösterilir.
 */
function windowsGuveniKur(pemYolu) {
  if (process.platform !== 'win32') {
    durum.windows = { denendi: false, basarili: null, hata: 'Windows değil' };
    return;
  }
  durum.windows.denendi = true;
  _kokYolu = pemYolu;

  // Windows parmak izini SHA-1 olarak, iki baytlık boşluklu BÜYÜK harfle
  // gösterir. Depoda ararken bu biçimi arıyoruz.
  const parmakIzi = kokParmakIziSha1();

  // =========================================================================
  //  ÖLÇÜLEN HATA (kullanıcı bildirimi): "SÜREKLİ BU GELİYOR, EVETE
  //  BASIYORUZ YİNE GELİYOR."
  //
  //  SEBEP: certutil -addstore, sertifika ZATEN depoda olsa bile her
  //  çalıştırıldığında "yüklemek istiyor musunuz?" penceresini AÇAR. Servis
  //  her açılışta bunu çalıştırdığı için kullanıcı her açılışta uyarıyı
  //  görüyor ve "Evet" deyip geçiyordu — sistem kendi kendini sürekli
  //  rahatsız ediyordu. Düzeltme: ÖNCE depoyu oku, parmak izi varsa HİÇ
  //  dokunma.
  //
  //  Bu, "sistem kullanıcıyı rahatsız etmemeli" kuralının doğrudan ihlaliydi.
  // =========================================================================
  execFile('certutil', ['-user', '-store', 'Root'], { timeout: 30000, windowsHide: true },
    (hata, so) => {
      const cikti = String(so || '');
      const depoOkunabildi = !hata;
      const depodaVar = depoVarMi(cikti, parmakIzi);
      durum.depo = {
        okunabildi: depoOkunabildi,
        parmakIzi: parmakIzi || null,
        ciktiUzunluk: cikti.length,
        hata: hata ? String(hata.message || hata) : null,
        bulundu: depodaVar,
      };
      if (depoOkunabildi && parmakIzi && depodaVar) {
        kurulumuIsaretle(parmakIzi);
        durum.windows = { denendi: true, basarili: true, atlandi: true, hata: null };
        log('INFO', 'HTTPS: kök CA zaten güvenli — yeniden kurulum YAPILMADI (kullanıcı uyarı görmeyecek)');
        return;
      }

      // Depo OKUNAMADI (servis yeni açıldığında önceki kurulum hâlâ
      // tamamlanıyor olabilir; ya da certutil geçici bir hataya düşmüş
      // olabilir). Burada tekrar kurulum yapmak kullanıcıya GEREKSİZ
      // "Evet" penceresi açar — ki bu tam olarak yaşadığımız hata.
      // Ölçülen hata: ilk denemede depo okuması yarışa girip boş döndü ve
      // sistem her açılışta uyarı gösterdi.
      //
      // Bu yüzden: kayıt dosyası bu kökün daha önce kurulduğunu söylüyorsa
      // DOKUNMA. Kullanıcı sertifikayı elle silmişse bile zararı yok —
      // sadece bir sonraki açılışta yeniden denenir.
      if (!depoOkunabildi && parmakIzi && kurulumIslenmisMi(parmakIzi)) {
        durum.windows = { denendi: true, basarili: true, atlandi: true, hata: null };
        log('BILGI', 'HTTPS: kök CA daha önce kurulmuş; depo şu an okunamadı, yeniden kurulum yapılmadı');
        return;
      }
      // Depoda yok (ya da okunamadı) -> kur.
      execFile('certutil', ['-user', '-addstore', '-f', 'Root', pemYolu],
        { timeout: 60000, windowsHide: true },
        (h2, stdout2, stderr2) => {
          const c2 = String(stdout2 || '') + String(stderr2 || '');
          if (h2 && !/Certificate|pkcs_7|success/i.test(c2)) {
            durum.windows = { denendi: true, basarili: false, hata: c2.trim().split('\n')[0] || h2.message };
            log('UYARI', 'HTTPS: kök CA Windows deposuna eklenemedi (bilgisayarda uyarı çıkabilir):', durum.windows.hata);
            return;
          }
          // Ekleme başarılı mı? DOKRULE DEĞİL, DEPOYU OKUYARAK doğrula.
          execFile('certutil', ['-user', '-store', 'Root'], { timeout: 30000, windowsHide: true },
            (h3, so3) => {
              const varMi = parmakIzi ? depoVarMi(String(so3 || ''), parmakIzi)
                : /CinarkoySync Yerel Kok CA/.test(String(so3 || ''));
              if (varMi) kurulumuIsaretle(parmakIzi);
              durum.windows = { denendi: true, basarili: varMi, atlandi: false, hata: varMi ? null : 'depo içinde bulunamadı' };
              log(varMi ? 'INFO' : 'UYARI',
                varMi ? 'HTTPS: kök CA bilgisayarın güvenli kabul edildi (kullanıcı hiçbir şey yapmadı)'
                  : 'HTTPS: kök CA depoya yazıldı ama doğrulanamadı');
            });
        });
    });
}

/**
 * "Bu kök kuruldu" kaydı.
 *
 * Neden dosya? certutil çıktısını ayrıştırmak ikinci emniyet katmanıdır;
 * ilk çalıştırmada beklenmedik bir hâlde boş dönerse sistem her açılışta
 * "Evet" penceresini açar (kullanıcının yaşadığı durum). Kayıt, aynı kökün
 * daha önce kurulduğunu kanıtlar. Kullanıcı sertifikayı elle silerse kayıt
 * eski kalır ama depo kontrolü de yanlış döner ve yeniden kurulur.
 */
function kurulumIsaretiYolu() {
  const d = path.dirname(kokYoluTahmin());
  return path.join(d, 'kok-ca.guvendi');
}

let _kokYolu = null;
function kokYoluTahmin() { return _kokYolu || path.join(process.cwd(), 'kok-ca.pem'); }

function kurulumuIsaretle(parmakIzi) {
  if (!parmakIzi || !_kokYolu) return;
  try {
    fs.writeFileSync(kurulumIsaretiYolu(), parmakIzi, 'utf8');
  } catch (e) { /* yazılamadıysa yalnızca bir sonraki açılışta sorun olur */ }
}

function kurulumIslenmisMi(parmakIzi) {
  if (!parmakIzi || !_kokYolu) return false;
  try { return fs.readFileSync(kurulumIsaretiYolu(), 'utf8').trim() === parmakIzi; }
  catch (e) { return false; }
}
/** Kök sertifikayla depremde aranacak SHA-1 parmak izi (Windows biçimi). */
function kokParmakIziSha1() {
  try {
    if (!durum.kok) return null;
    const c = new crypto.X509Certificate(durum.kok.pemDer);
    return crypto.createHash('sha1').update(c.raw).digest('hex').toUpperCase();
  } catch (e) {
    return null;
  }
}

/** certutil çıktısında parmak izi var mı? (biçim: "AA BB CC ..." veya "AABBCC") */
function depoVarMi(cikti, parmakIzi) {
  if (!cikti || !parmakIzi) return false;
  const duz = cikti.replace(/[\s:]/g, '').toUpperCase();
  return duz.indexOf(parmakIzi) !== -1;
}

// ============================================================================
//  HTTPS SUNUCUSU
// ============================================================================

function httpsSunucuKur(app, port, uygula) {
  if (!durum.yaprak) return null;
  const s = https.createServer(
    { key: durum.yaprak.anahtarPem, cert: durum.yaprak.pemDer },
    app
  );
  s.on('error', (e) => {
    log('HATA', 'HTTPS sunucusu hatası:', e && e.message);
    durum.hata = 'https: ' + (e && e.message);
  });
  s.listen(port, '0.0.0.0', () => {
    log('INFO', `HTTPS hazır: https://0.0.0.0:${port} (kamera artık çalışabilir)`);
    if (typeof uygula === 'function') uygula(null);
  });
  durum.sunucu = s;
  return s;
}

/**
 * IP/DNS değişmiş mi? Değiştiyse yaprağı yenile ve HTTPS sunucusunu YENİDEN aç.
 *
 * Neden? "Bilgisayarın IP'si değişirse sistem kendi halletsin" kuralı.
 * IP değiştiğinde eski sertifika yeni IP'yi kapsamaz ve tarayıcı adres
 * uyuşmazlığı hatası verir. Kök DEĞİŞMEZ, yalnızca yaprak yenilenir —
 * telefonda hiçbir işlem gerekmez.
 */
async function yenidenDenetle(app, port, uygula) {
  if (!app || !port) return { degisti: false };
  const hedef = sanSeti();
  if (sanAyni(hedef, durum.san)) return { degisti: false };

  log('INFO', 'HTTPS: ağ adresleri değişti, sertifika yenileniyor…');
  const yeni = yapragiHazirla(yolTuret());
  if (!yeni) return { degisti: false, hata: durum.hata };

  // Eski dinleyiciyi kapat, yerine yenisini aç. HTTP DOKUNULMAZ.
  const eski = durum.sunucu;
  if (eski) {
    try { eski.close(); } catch {}
  }
  await new Promise((c) => setTimeout(c, 150));
  httpsSunucuKur(app, port, uygula);
  return { degisti: true };
}

// ============================================================================
//  DOSYA YOLLARI
// ============================================================================
let DOSYALAR = null;
function yolTuret() {
  if (!DOSYALAR) throw new Error('HTTPS: önce hazirla() çağrılmalı');
  return DOSYALAR;
}

// ============================================================================
//  DIŞ API
// ============================================================================

/**
 * @param {object} p
 * @param {string} p.dataDir
 * @param {number} p.port        HTTP portu (HTTPS = port + 1)
 * @param {object} p.app         Express uygulaması (HTTP ile AYNI)
 * @param {number} p.httpPort
 * @param {function} p.log
 * @param {function} p.hazirOldugunda
 */
function hazirla(p) {
  durum.gunluk = p.log || console.log;
  const kokYolu = path.join(p.dataDir, 'kok-ca.pem');
  const kokKey = path.join(p.dataDir, 'kok-ca.key');
  DOSYALAR = {
    kok: kokYolu,
    kokKey,
    yaprak: path.join(p.dataDir, 'sunucu.pem'),
    yaprakKey: path.join(p.dataDir, 'sunucu.key'),
    san: path.join(p.dataDir, 'sunucu-san.json'),
  };
  const httpsPort = p.port;

  try {
    kokuHazirla(DOSYALAR);
    const y = yapragiHazirla(DOSYALAR);
    if (y) {
      httpsSunucuKur(p.app, httpsPort, p.hazirOldugunda);
      // ------------------------------------------------------------------------
      //  ÖNEMLİ KARAR: Windows KOK DEPOSUNA OTOMATİK KURULUM YAPILMAZ.
      //
      //  Ölçülen sebepler (hepsi ölçüldü, tahmin edilmedi):
      //   1) certutil -user -addstore her çalıştırıldığında "yüklemek
      //      istiyor musunuz?" PENCERESİ AÇAR. Kullanıcı bunu gördü ve
      //      "sürekli geliyor, Evet'e basıyoruz yine geliyor" dedi. Sistem
      //      kullanıcıyı rahatsız etmemeli — pencerenin kendisi ihlaldir.
      //   2) Pencerе bir İNSAN tıklaması bekler. Otomatik (başsız) ortamda
      //      davranış kararsızdır: testler bazen "kuruldu" bazen "bekliyor"
      //      diyordu. Sistem, kullanıcının bilgisayarında kırılgan olmamalı.
      //   3) Bir kök sertifikayı Windows'un güvenli listesine EKLEMEK, kullanıcı
      //      açısından güvenlik açısından ağır bir işlemdir. Hiçbir şey
      //      istemeden yapılması doğru değildir.
      //
      //  Peki bilgisayarda ne olur? Panel http üzerinden çalışmaya devam eder
      //  (zaten öyle çalışıyordu). Kamera yalnızca TELEFONDA açılıyor ve
      //  telefonun kendi güven adımı, paneldeki düğmeyle ve BİLİNÇLİ olarak
      //  yapılıyor. Yani otomatik kuruluma ihtiyaç yok.
      //
      //  Geri açmak isteyenler için: CK_KOK_GUVENME=1
      // ------------------------------------------------------------------------
      if (process.env.CK_KOK_GUVENME === '1') {
        windowsGuveniKur(kokYolu);
      } else {
        durum.windows = {
          denendi: false, basarili: null, atlandi: true,
          hata: 'bilgisayarın sertifika deposuna dokunulmadı (bilinçli tercih)',
        };
        log('BILGI', 'HTTPS: Windows güven deposu DEĞİŞTİRİLMEDİ. Panel http ile çalışır; '
          + 'telefonda güven adımı paneldeki "sertifikayı indir" düğmesiyle yapılır.');
      }
      // Ağ değişimini izle
      durum.dinleyici = setInterval(() => {
        yenidenDenetle(p.app, httpsPort, p.hazirOldugunda).catch(() => {});
      }, 60000);
      durum.dinleyici.unref && durum.dinleyici.unref();
    }
  } catch (e) {
    durum.hata = e && e.message;
    log('HATA', 'HTTPS hazırlanamadı (HTTP çalışmaya devam ediyor):', durum.hata);
  }
  return durumBilgisi();
}

/** Telefonun denemesi gereken adresler: ÖNCE https, sonra http. */
function adayAdresler(httpPort, httpsPort) {
  const liste = [];
  const ekle = (u) => { if (u && !liste.includes(u)) liste.push(u); };
  const birincil = birincilLanIp();

  // Sıralama ÖLÇÜMLE belirlendi:
  //  1) birincil IP (varsayılan rota) — telefonda GERÇEKTEN açılır
  //  2) diğer https IP'leri
  //  3) https bilgisayar adları (çoğu çözülmez ama denemek zararsız)
  //  4) http adresleri (yalnızca panel/kayıt için; kamera burada açılmaz)
  if (birincil) ekle(`https://${birincil}:${httpsPort}`);
  for (const i of ipAdresleri()) {
    if (i === '127.0.0.1' || i === birincil) continue;
    ekle(`https://${i}:${httpsPort}`);
  }
  for (const d of dnsAdlari()) {
    if (d === 'localhost') continue;
    ekle(`https://${d}:${httpsPort}`);
  }
  for (const i of ipAdresleri()) {
    if (i === '127.0.0.1') continue;
    ekle(`http://${i}:${httpPort}`);
  }
  for (const d of dnsAdlari()) {
    if (d === 'localhost') continue;
    ekle(`http://${d}:${httpPort}`);
  }
  return liste;
}

function kaliciAdres(httpPort, httpsPort) {
  // ÖNEMLİ: burada bilgisayar adı DEĞİL, IP adresi kullanılıyor.
  //
  // Ölçülen hata: önceden "https://cinarkoy-sync.local" üretiliyordu. Bu adres
  // ÇÖZÜLMÜYOR (hiçbir şey onu mDNS ile yayınlamıyor) ve NetBIOS adı da
  // telefonda çalışmıyor. Kullanıcı paneldeki adresi yazdığında sayfa açılmıyor
  // ve kamera açılmıyordu. Panelde görünen adresin GERÇEKTEN açılabilir
  // olması gerekir.
  //
  // IP değişirse: yaprak sertifika otomatik yenilendiği için adres yine
  // geçerli kalır, ayrıca panel her açılışta güncel IP'yi gösterir.
  const ip = birincilLanIp();
  if (ip) return `https://${ip}:${httpsPort}`;
  const dns = dnsAdlari().filter((d) => d !== 'localhost');
  if (dns.length) return `https://${dns[0]}:${httpsPort}`;
  return `https://localhost:${httpsPort}`;
}

function birincilIpGuvenli() { try { return birincilLanIp(); } catch (e) { return null; } }

function durumBilgisi() {
  // ÖLÇÜLEN HATA: `listen` henüz tamamlanmadan `hazirla()` çağrılıyor ve
  // `server.address()` null dönüyor; `.port` okumak TypeError atıyordu.
  // Sunucu çalışmaya devam ediyordu ama durum bildirimi patlıyordu.
  let port = null;
  if (durum.sunucu) {
    try {
      const a = durum.sunucu.address();
      if (a && typeof a === 'object') port = a.port;
    } catch { /* henüz bağlanmamış */ }
  }
  return {
    aktif: !!durum.sunucu,
    port: port,
    birincilIp: birincilIpGuvenli(),
    san: durum.san,
    kokParmakIzi: durum.kok ? durum.kok.parmakIzi : null,
    kokGecerlilik: durum.dogrulama ? durum.dogrulama.kokGecerlilik : null,
    yaprakGecerlilik: durum.dogrulama ? durum.dogrulama.yaprakGecerlilik : null,
    dogrulandi: !!(durum.dogrulama && durum.dogrulama.tamam),
    dogrulamaHatalari: durum.dogrulama ? durum.dogrulama.hatalar : ['henüz üretilmedi'],
    windowsGuvenli: durum.windows.basarili,
    windowsKurulumAtlandi: !!durum.windows.atlandi,
    windowsDepo: durum.depo || null,
    windowsKurulumKaydi: _kokYolu ? kurulumIslenmisMi(kokParmakIziSha1()) : false,
    windowsHata: durum.windows.hata,
    hata: durum.hata,
  };
}

function kapat() {
  if (durum.dinleyici) { clearInterval(durum.dinleyici); durum.dinleyici = null; }
  if (durum.sunucu) { try { durum.sunucu.close(); } catch {} durum.sunucu = null; }
}

module.exports = {
  hazirla,
  adayAdresler,
  kaliciAdres,
  birincilLanIp,
  durumBilgisi,
  kokPemi: () => (durum.kok ? durum.kok.pemDer : null),
  // DER (ikili) biçim. iOS/Android kurulumu DER ile güvenilir çalışır;
  // PEM gövdesinden base64 çözülür, tahmin yapılmaz.
  kokDer: () => {
    const pem = durum.kok && durum.kok.pemDer;
    if (!pem) return null;
    const govde = String(pem).replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
    try { return Buffer.from(govde, 'base64'); } catch (e) { return null; }
  },
  kapat,
  yenidenDenetle,
  _sertifika: sertifika,
  _dnsAdlari: dnsAdlari,
  _ipAdresleri: ipAdresleri,
};
