'use strict';
// ============================================================================
//  Kurulum ve başlatma testi (tarayıcısız, statik)
// ----------------------------------------------------------------------------
//  Burada, "programı kullanamayan" birinin deneyimini koruyan parçaları
//  denetliyoruz:
//    * Başlatıcı var mı, servisi kendisi başlatıyor mu, tarayıcıyı ve Excel'i
//      açıyor mu, IP değişse de telefonu kurtaracak aday adres mantığı var mı.
//    * Kurulum paketi: Node.js'u kendi içinde taşıyor mu, UAC istemiyor mu,
//      kaldırılırken kayıtları silmiyor mu.
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COMP = path.join(ROOT, 'companion');
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log(`PASS — ${name}`); }
  else { fail++; console.log(`FAIL — ${name}${extra ? ' :: ' + extra : ''}`); }
};

const varMi = (p) => fs.existsSync(path.join(COMP, p));
const oku = (p) => fs.readFileSync(path.join(COMP, p), 'utf8');

// ---------------------------------------------------------------------------
// 1. Başlatıcı (Windows .exe) kaynakları
// ---------------------------------------------------------------------------
ok(varMi(path.join('launcher', 'Baslatici.cs')), 'başlatıcı kaynağı var (launcher/Baslatici.cs)');
ok(varMi(path.join('launcher', 'CinarkoySync.exe')), 'derlenmiş başlatıcı var (launcher/CinarkoySync.exe)');
ok(varMi(path.join('launcher', 'ikon-uret.ps1')), 'simge üreticisi var (launcher/ikon-uret.ps1)');

const cs = oku(path.join('launcher', 'Baslatici.cs'));

// Temel kullanıcı işleri: kullanıcı hiçbir komut yazmadan her şeyi yapabilmeli
ok(/class AnaPencere/.test(cs), 'başlatıcı pencere sınıfı tanımlı');
ok(/Paneli Aç/.test(cs) && /TarayiciAc\(/.test(cs), 'başlatıcı paneli tarayıcıda açabiliyor');
ok(/Excel'i Aç/.test(cs) && /Yol\.ExcelYolu/.test(cs), 'başlatıcı Excel dosyasını açabiliyor ve yolunu biliyor');
ok(/Veri Klasörü/.test(cs) && /KlasorAc/.test(cs), 'başlatıcı veri klasörünü açabiliyor');
ok(/NotifyIcon/.test(cs), 'başlatıcı sistem tepsisinde yaşıyor (arka planda çalışıyor)');
ok(/Programı kapat/.test(cs), 'tepsi menüsünde tam kapatma seçeneği var');

// Servis yönetimi
ok(/ServisPid\(\)/.test(cs) && /Win32_Process/.test(cs), 'çalışan servisi süreç listesinden buluyor');
ok(/start \\"\\" \/b/.test(cs), 'servis başlatıcıdan bağımsız (arkada planda) çalışıyor');
ok(/companion\.js/.test(cs), 'başlatıcı companion.js servisini çalıştırıyor');
ok(/servis\.log/.test(cs), 'servis çıktısı dosyaya yazılıyor (hata ayıklama için)');
ok(/TekKopuk/.test(cs) && /Mutex/.test(cs), 'tek kopya çalışıyor (çift açılma engellendi)');
ok(/Servisi Yeniden Başlat/.test(cs), 'servisi yeniden başlatma düğmesi var');

// Kendini onarma: servis çökerse kullanıcı hiçbir şey yapmadan toparlanmalı
ok(/_yenidenDeneme/.test(cs) && /NabizBaslat/.test(cs), 'servis düşerse otomatik yeniden başlatıyor');
ok(/_servisiDurdurduk/.test(cs), 'kullanıcı bilerek durdurduysa otomatik açılmıyor');

// Windows güvenlik duvarı: yönetici gerektirmeyen tek tıkla izin
ok(/class Duar/.test(cs) && /KuralVar/.test(cs) && /KuralEkle/.test(cs),
  'güvenlik duvarı kuralı sorgulanıyor ve tek tıkla eklenebiliyor');
ok(/Verb = "runas"/.test(cs), 'duvar izni tek seferlik yönetici onayı istiyor');
ok(/Windows iznini ver/.test(cs), 'pencerede "Windows iznini ver" düğmesi var');

// Başlangıçta otomatik açılma
ok(/CurrentVersion\\+Run/.test(cs) || /CurrentVersion\\\\Run/.test(cs), 'açılışta otomatik başlatma kaydı yönetiliyor');
ok(/Açılışta otomatik başlat/.test(cs), 'otomatik başlatma onay kutusu var');

// Node.js bulma (kurulumda Node yolunda olmayabilir)
ok(/class NodeBul/.test(cs), 'başlatıcı Node.js motorunu kendisi buluyor');
ok(/Path\.Combine\(Yol\.ExeDizini, "node", "node\.exe"\)/.test(cs),
  'kendi yanındaki Node motorunu (kurulum klasörü) önce tercih ediyor');
ok(/GetEnvironmentVariable\("PATH"\)/.test(cs), 'Node PATH üzerinde yoksa aranıyor');

// ---------------------------------------------------------------------------
// 2. Kurulum paketi (kurulum.iss)
// ---------------------------------------------------------------------------
const iss = oku('kurulum.iss');
ok(iss.length > 100, 'kurulum betiği mevcut (kurulum.iss)');
ok(/OutputBaseFilename=CinarkoySync-Kur-/.test(iss), 'tek dosya .exe kurulum paketi üretiliyor');
ok(/PrivilegesRequired=lowest/.test(iss), 'kurulum yönetici (UAC) istemiyor — kullanıcıyı yormuyor');
ok(/DefaultDirName=\{localappdata\}/.test(iss), 'kullanıcı klasörüne kuruluyor (Program Files değil)');

// Veri kaybı olmamalı: kaldırma kayıtları SİLMEZ.
// NOT: Yalnızca GERÇEK [UninstallDelete] bölümüne bakılır. Betikte aynı ad
// geçen bir açıklama satırı ve [Code] bölümü yanlış alarm üretiyordu.
const udBas = iss.lastIndexOf('\n[UninstallDelete]');
const udBitis = udBas < 0 ? -1 : iss.indexOf('\n[', udBas + 2);
const kaldirmaTemizlik = udBas < 0 ? '' : iss.slice(udBas, udBitis < 0 ? undefined : udBitis);
ok(udBas > 0, 'kaldırma temizlik bölümü tanımlı');
ok(!/kayitlar|seen-ids|\\data$/.test(kaldirmaTemizlik),
  'kaldırma Excel ve kayıt dosyalarını SİLmiyor (veri kaybı yok)');
// Veri klasörüne yönelik her satır yalnızca servis.log veya *.tmp olmalı
const veriSatirlari = kaldirmaTemizlik.split(/\r?\n/)
  .filter((l) => /\{app\}\\app\\data/.test(l));
ok(veriSatirlari.length > 0 &&
   veriSatirlari.every((l) => /servis\.log"|\*\.tmp"/.test(l)),
  'kaldırma veri klasöründe yalnızca hata ayıklama günlüğünü ve geçici .tmp dosyalarını temizliyor');

// Program dağıtımı
ok(/Source: "node\\node\.exe"; DestDir: "\{app\}\\node"/.test(iss) ||
   /Source: "node\\node\.exe"; DestDir: "\{app\}\\node"/.test(iss.replace(/\s+/g, ' ')) ||
   /node\\node\.exe/.test(iss),
  'Node.js motoru kurulum paketinin içinde geliyor (kullanıcıda kurulu olması gerekmiyor)');
ok(/launcher\\CinarkoySync\.exe/.test(iss), 'başlatıcı .exe kuruluma dahil');
ok(/public\\\*"/.test(iss) && /recursesubdirs/.test(iss), 'panel dosyaları kuruluma dahil');
ok(/node_modules\\\*"/.test(iss), 'servis bağımlılıkları kuruluma dahil');

// ---------------------------------------------------------------------------
//  PAKET İÇERİĞİ DENETİMİ — "sadece üretimde bozuk" hataları yakalar
// ---------------------------------------------------------------------------
// ÖNEMLİ: Inno Setup dosyaları TEK TEK listeler (klasör kuralı yok). Yeni
// bir companion/ocr/*.js dosyası eklendiğinde kurulum betiğine de eklenmezse
// geliştirmede çalışır, KURULU SÜRÜMDE çalışmaz — ve `try { require }
// catch {}` deseni hatayı yuttuğu için kimse farkına varamaz.
// Gerçekleşen: ocr/bolge.js paketlenmemişti. Kurulu sürümde 10 gerçekçi
// sahnenin 8'i okunamadı (2/10), geliştirmede 10/10 okunuyordu.
{
  const ocrDizin = path.join(COMP, 'ocr');
  const ocrDosyalari = fs.readdirSync(ocrDizin)
    .filter((f) => f.endsWith('.js') && f !== 'fizibilite.js');
  ok(ocrDosyalari.length >= 3, `companion/ocr altında JS modülleri var (${ocrDosyalari.join(', ')})`);

  for (const dosya of ocrDosyalari) {
    ok(new RegExp(`ocr\\\\${dosya.replace('.', '\\.')}"`).test(iss),
      `kurulum paketi ocr/${dosya} dosyasını içeriyor (yoksa üretimde bozulur)`);
  }
  ok(/ocr\\lang\\\*/.test(iss), 'kurulum paketi OCR dil paketini içeriyor (internetsiz okuma)');

  // --- fast-plate-ocr model dosyaları -------------------------------------
  // Neden ayrı denetim? Model dosyası paketlenmezse motor geliştirmede
  // çalışır, kurulumda çalışmaz. Dahası: model bozuk kopyalanırsa okuma
  // sessizce TAMAMEN YANLIŞ olur — çünkü model yine "bir plaka" der, sadece
  // başka bir plaka der. Bu yüzden hem dosya varlığı hem SHA-256 özeti
  // paketlenmeli (rehber §11).
  const modelDizin = path.join(ocrDizin, 'models');
  const modeller = fs.existsSync(modelDizin)
    ? fs.readdirSync(modelDizin).filter((f) => f.endsWith('.onnx'))
    : [];
  ok(modeller.length >= 1,
    `fast-plate-ocr model dosyası var (${modeller.join(', ') || 'YOK'})`);
  ok(/ocr\\models\\\*/.test(iss), 'kurulum paketi model klasörünü içeriyor (internetsiz okuma)');

  const { FpoMotoru, VARSAYILAN, modelDogrula } = require(path.join(COMP, 'ocr', 'plaka-fpo.js'));
  ok(modeller.includes(VARSAYILAN + '.onnx'),
    `varsayılan model (${VARSAYILAN}) indirilmiş ve paketlenebilir`);
  const dogrulama = modelDogrula(VARSAYILAN);
  ok(dogrulama.var, 'varsayılan model doğrulanıyor', dogrulama.hata || '');
  ok(dogrulama.ozet && dogrulama.ozet.uyusuyor,
    'varsayılan modelin SHA-256 özeti tutuyor (bozuk kopya yok)',
    dogrulama.ozet ? 'beklenen ' + dogrulama.ozet.beklenen + ' / bulunan ' + dogrulama.ozet.gercek : 'özet dosyası yok');

  // Özet dosyaları da paketlenmeli (modelle birlikte)
  for (const m of modeller) {
    ok(fs.existsSync(path.join(modelDizin, m + '.sha256')),
      `${m} için SHA-256 özet dosyası var (bozulma tespiti)`);
  }

  // --- onnxruntime yerel ikilileri ----------------------------------------
  // Neden? Bu paket, C++ çekirdeğin ÇALIŞMA ANINDA yüklenen ikilisidir.
  // Kopyalanmazsa motor kurulumda yüklenemez. Model dosyasının varlığı tek
  // başına yetmez: model orada olabilir ama çalıştırılamaz.
  const ortKok = path.join(COMP, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'win32', 'x64');
  const gerekliIkililer = ['onnxruntime_binding.node', 'onnxruntime.dll'];
  for (const b of gerekliIkililer) {
    ok(fs.existsSync(path.join(ortKok, b)), `onnxruntime ikilisi mevcut: win32/x64/${b}`);
    ok(iss.includes('onnxruntime_binding.node') || /onnxruntime-node\\bin\\napi-v6\\win32\\x64/.test(iss),
      `kurulum paketi ONNX yerel ikilisini içeriyor: ${b}`);
  }
  // Kullanılmayan platformlar DIŞLANMIŞ olmalı: onnxruntime-node kutudan
  // 287 MB'dir.
  //
  // ÖNEMLİ DERS: Bu denetim ÖNCE .iss METNİNİ okuyarak "doğru görünüyor"
  // diye GEÇTİ, ama gerçekte 17 ikili (darwin/linux/arm64/DirectML) paketleniyor
  // ve kurulum 119 MB'da kalıyordu. Yani test NİYETİ değil ETKİYİ ölçüyordu.
  // Aşağıdaki denetim .iss'te ne yazdığına değil, kurulum betiğinin
  // davranışına bakar: genel kural Excludes kullanıyor mu ve geri eklenen
  // dosya tam olarak ikisi mi.
  const genelKural = iss.split('\n').find((l) => /^Source:\s*"node_modules\\\*/.test(l)) || '';
  ok(/Excludes/i.test(genelKural),
    'genel node_modules kuralı onnxruntime ikililerini dışlıyor', genelKural);
  // Desen kaynak jokerinin ARDINDAN kalan göreli yola göre eşleşir; tam yol
  // yazılırsa hiçbir şey dışlanmaz. Doğru biçim: "onnxruntime-node\bin"
  const desenler = (genelKural.match(/Excludes:\s*(.+)$/i) || [, ''])[1];
  ok(/onnxruntime-node\\bin/i.test(desenler),
    'dışlama deseni göreli yol olarak yazılmış (tam yol çalışmaz)', desenler.trim());
  ok(!/node_modules\\onnxruntime-node/.test(desenler),
    'dışlama deseninde tam yol kullanılmamış (etkisiz kalırdı)', desenler.trim());

  // Geri eklenen dosyalar tam olarak ikisi olmalı — ne eksik ne fazla.
  const geriEklenen = [...iss.matchAll(/onnxruntime-node\\bin\\napi-v6\\win32\\x64\\([\w.]+)/g)]
    .map((m) => m[1]);
  const beklenenIkililer = ['onnxruntime_binding.node', 'onnxruntime.dll'];
  ok(geriEklenen.length === beklenenIkililer.length
    && beklenenIkililer.every((b) => geriEklenen.includes(b)),
    'yalnızca CPU yürütücüsünün 2 ikilisi geri ekleniyor',
    `geri eklenen: ${geriEklenen.join(', ') || 'YOK'}`);
  ok(!/onnxruntime-node\\bin\\napi-v6\\(linux|darwin|win32\\arm64)/.test(iss),
    'kullanılmayan platform ikilileri paketlenmiyor (linux/darwin/arm64)');

  // companion/companion.js'in gerçekten require ettiği yerel modüller
  const compIcerik = oku('companion.js');
  const yerelGereksinimler = [...compIcerik.matchAll(/require\('(\.\/[^']+)'\)/g)]
    .map((m) => m[1].replace(/^\.\//, ''))
    .filter((f) => !f.includes('node_modules'));
  for (const g of new Set(yerelGereksinimler)) {
    ok(varMi(g), `companion.js'in beklediği yerel modül mevcut: ${g}`);
  }
  // companion/ocr/plaka.js'in require ettiği modüller de paketlenmeli
  const plakaIcerik = oku(path.join('ocr', 'plaka.js'));
  const plakaGereksinimler = [...plakaIcerik.matchAll(/require\('\.\/([^']+)'\)/g)]
    .map((m) => 'ocr/' + m[1]);
  for (const g of new Set(plakaGereksinimler)) {
    ok(varMi(g), `ocr/plaka.js'in beklediği modül mevcut: ${g}`);
    ok(iss.includes(g.replace(/\//g, '\\')),
      `kurulum paketi ${g} dosyasını içeriyor (plaka.js onu require ediyor)`);
  }

  // Sessiz yutma yasak: eksik modül durumda bildirilmeli
  ok(/bolgeBulucu/.test(plakaIcerik), 'OCR durumu bölge bulucusunu bildiriyor (sessiz bozulma yok)');
  ok(/bolgeBulucuHatasi = e\.message/.test(plakaIcerik),
    'OCR modülü yüklenemezse hata kaydediliyor (sessizce yutulmuyor)');
  ok(/bolgeBulucu/.test(compIcerik), 'servis /durum bölge bulucu durumunu yayınlıyor');
}

// Temiz kurulum: geliştirme verisi ve geliştirme anahtarı taşınmamalı
ok(!/Source: "data\\kayitlar\.jsonl"/.test(iss), 'geliştirme kayıtları kuruluma paketlenmiyor (temiz başlangıç)');
ok(/config\.example\.json"; DestDir: "\{app\}\\app"; DestName: "config\.json"/.test(iss),
  'yeni kurulum kendi anahtarını üretir (geliştirme anahtarı dağıtılmıyor)');
ok(!/Source: "config\.json"/.test(iss), 'geliştirme config.json dosyası kuruluma dahil edilmiyor');

// Kısayollar: kullanıcı programı nerede bulacağını bilsin
ok(iss.includes('Name: "{autodesktop}\\{#UygulamaAdi}"') && /Tasks: desktopicon/.test(iss),
  'masaüstüne simge konuluyor');
ok(/Excel dosyas/.test(iss) && /explorer\.exe/.test(iss), 'başlat menüsünde Excel klasörü kısayolu var');
ok(/UninstallDisplayName/.test(iss), 'program "Ayarlar > Uygulamalar"da kaldırılabilir görünüyor');
ok(/UninstallDisplayIcon/.test(iss), 'kaldırma simgesi başlatıcı simgesiyle aynı');

// Kurulum sırasında açık programla uğraşmamalı
ok(/PrepareToInstall/.test(iss), 'kurulum öncesi açık programla başa çıkılıyor (dosya kilidi)');

// ---------------------------------------------------------------------------
// 3. Paketleme betiği
// ---------------------------------------------------------------------------
const paketle = oku('paketle.ps1');
ok(/node\\node\.exe|node\.exe/.test(paketle), 'paketleme betiği Node motorunu hazırlıyor');
ok(/csc\.exe/.test(paketle), 'paketleme betiği başlatıcıyı derliyor');
ok(/ISCC\.exe|kurulum\.iss/.test(paketle), 'paketleme betiği kurulum paketini derliyor');
ok(/--omit=dev/.test(paketle) && /--no-audit/.test(paketle), 'paketleme betiği sessiz ve hızlı (üretim modu)');

// ---------------------------------------------------------------------------
// 4. IP değişimi dayanıklılığı (kullanıcı "IP değişirse ne olur?" diye sordu)
// ---------------------------------------------------------------------------
const comp = oku('companion.js');
ok(/function adayAdresler/.test(comp), 'servis sıralı aday adres listesi üretiyor');
ok(/os\.hostname\(\)/.test(comp), 'aday listesinde bilgisayar adı var (IP\'den kalıcı)');
const eslesmeBlogu = comp.slice(comp.indexOf("app.get('/eslesme'"));
ok(/adaylar,/.test(eslesmeBlogu) && /bilgisayarAdi,/.test(eslesmeBlogu),
  '/eslesme aday listesini ve bilgisayar adını döndürüyor');
ok(/kaliciAdres/.test(comp), '/eslesme IP\'den kalıcı adresi ayrıca bildiriyor');

// ÖLÇÜLEN HATA: bu denetim "QR'da IP olmamalı, kalıcı (isim) adresi
// olmalı" diyordu. Gerekçesi "IP değişse eşleşme bozulmaz" idi. Ama ÖLÇÜLDÜ
// ki cinarkoy-sync.local HİÇ ÇÖZÜLMÜYOR (kimse mDNS yayınlamıyor) ve
// NetBIOS adı telefonda çalışmıyor. Yani "kalıcı" adres aslında AÇILMAYAN bir
// adresti; kullanıcı paneldeki adresi yazınca sayfa gelmiyor ve kamera
// açılmıyordu. Doğru değişmez "adres kalıcı olsun" değil, "GÖSTERİLEN ADRES
// GERÇEKTEN ULAŞILABİLİR OLSUN"dur. IP değiştiğinde sertifika otomatik
// yenilendiği (ölçüldü) ve panel her açılışta güncel adresi gösterdiği için
// bu değişmez de sağlanır.
ok(/qrAl\(kalici\)/.test(comp),
  'eşleşme QR kodunda ulaşılabilir adres kullanılıyor (çözülemeyen isim değil)');
ok(/birincilLanIp\(\)/.test(oku('net/tls.js')),
  'birincil LAN IP rota tablosundan okunuyor (sanal bağdaştırıcı eleniyor)');
// ".local" YEDEK olarak durabilir (IP yoksa işe yarar); yasak olan onun
// VARSAYILAN seçilmesidir. O yüzden VAR OLUP OLMAYACAĞINI değil,
// SIRAYI denetliyoruz: IP denemesi isim denemesinden ÖNCE gelmeli.
{
  const kalici = (oku('net/tls.js').match(/function kaliciAdres[\s\S]*?\n}/) || [''])[0];
  const ipYeri = kalici.indexOf('birincilLanIp()');
  const isimYeri = kalici.indexOf('dnsAdlari()');
  ok(ipYeri !== -1 && (isimYeri === -1 || ipYeri < isimYeri),
    'telefon adresinde IP, çözülemeyen isimden ÖNCE deneniyor (sıra ölçüldü)',
    `ipYeri=${ipYeri} isimYeri=${isimYeri}`);
  // Değişken adı tahmin edilmemeli: fonksiyonun kendi gövdesi okunur.
  // Gerçek şart şu: "IP varsa, isim denemesine DÜŞMEDEN dönüş yapılıyor".
  const ipDonus = /if \(ip\) return `https:\/\/\$\{ip\}/.test(kalici);
  const isimDeneme = kalici.indexOf('const dns = dnsAdlari()');
  const ipDeneme = kalici.indexOf('const ip = birincilLanIp()');
  ok(ipDonus && ipDeneme !== -1 && (isimDeneme === -1 || ipDeneme < isimDeneme),
    'birincil LAN IP varsa adres DOĞRUDAN dönüyor, isme düşülmüyor',
    `ipDonus=${ipDonus} ipYeri=${ipDeneme} isimYeri=${isimDeneme}`);
}

const yama = fs.readFileSync(path.join(ROOT, 'phone', 'guvenlik-sync.js'), 'utf8');
// --- HTTPS paketleme denetimi -----------------------------------------------
// ÖLÇÜLEN HATA SINIFI: paket eksik dosya içerir, kurulum "başarılı" görünür
// ve kritik özellik (KAMERA) sessizce ölür. companion.js require('./net/tls.js')
// yapamazsa servis ÇÖKMEZ — yalnızca https açılmaz. Kullanıcı "Kamera erişimi
// yok" sanır ve sistemin bozuk olduğunu düşünür.
const companionJs = oku('companion.js');
ok(/net\/tls\.js/.test(companionJs),
  'companion.js net/tls.js modülünü kullanıyor (https için)');
ok(/Source: "net\\tls\.js"/.test(iss),
  'kurulum paketi net/tls.js dosyasını içeriyor (yoksa kamera üretimde ölü)');
ok(/Source: "net\\sertifika\.js"/.test(iss),
  'kurulum paketi net/sertifika.js dosyasını içeriyor');
ok(/DestDir: "\{app\}\\app\\net"/.test(iss),
  'net dosyaları doğru klasöre kuruluyor');
ok(fs.existsSync(path.join(ROOT, 'companion', 'net', 'tls.js')) &&
   fs.existsSync(path.join(ROOT, 'companion', 'net', 'sertifika.js')),
  'net klasörü depoda mevcut (paketleme kaynağı eksik değil)');

ok(/function adaylariAyarla/.test(yama), 'telefonda aday adres yönetimi var');
// --- KAMERA ÖN KOSULU: telefon https adresini tercih etmeli ---------------
// ÖLÇÜLEN HATA: aday listesi http'yi ÖNE koyuyor ve portu 4545 olarak
// sabitliyordu (gerçek port 4599). Telefon güvensiz kaynata düşüyor ve
// tarayıcı kamera izni vermiyordu.
ok(/birlik\.httpsAdres/.test(yama),
  'telefon https adresini sunucudan alıyor (kamera ön koşulu)');
// --- TELEFON ADAY SIRASI: HTTP ONCE (URUN KARARI) ---------------------
// OLCULEN HATA (kullanici): once https adresleri one alindi ve kullanicidan
// sertifika kurmasi istendi. Sonuc: (a) tarayicida korkutucu uyari sayfasi
// acilip uygulama engelleniyor, (b) "musterilerimizi urastirmamiz gerekiyor".
//
// COZUM (olculerek dogrulandi): telefonun KENDI kamerasi
// (capture="environment") guvenli kaynak istemez. Yani plaka okuma duz http
// uzerinde de calisir. Sertifika hicbir seye gerekmez.
//
// Dogrulanabilir degismezler:
//   1) kayitli adres her zaman ilk (kullanicinin kullandigi adres)
//   2) http adresleri https adreslerinden ONCE denenir (uyari sayfasi yok)
//   3) https en sonda kalir — yalnizca istege bagli canli onizleme icin
ok(/if \(birlik\.baseUrl\) ekle\(birlik\.baseUrl\)/.test(yama),
  'telefon kayitli adresi ONCE deniyor (kullanicinin kullandigi adres)');
const sira = yama.split('function adaylariAyarla')[1].split('function httpPortu')[0] || '';
ok(sira.indexOf('httpOnce.forEach(ekle)') !== -1
   && sira.indexOf('httpOnce.forEach(ekle)') < sira.indexOf('httpsSonra.forEach(ekle)'),
  'http adresleri https adreslerinden ONCE deneyecek (uyari sayfasi olmaz)');
ok(/httpsSonra\.forEach\(ekle\)/.test(sira),
  'https adresleri listenin sonunda (istege bagli canli onizleme)');
ok(!/httpOnce\.push\(birlik\.httpsAdres\)/.test(sira),
  'https adresi yanlislIkla http listesine eklenmiyor');
ok(/httpsPortu\(birlik\)/.test(yama),
  'https portu sunucudan geliyor (tahmin değil)');
ok(/function sonrakiAday/.test(yama) && /function basariliAdres/.test(yama),
  'telefon bağlantı kurulan adresi sabitler, kuramayınca sıradakini dener');
ok(/deneme < S\.adaylar\.length/.test(yama), 'telefon tüm adayları sırayla dener (kullanıcı hiçbir şey yapmaz)');
ok(/adaylar: S\.adaylar/.test(yama), 'aday listesi kalıcı olarak saklanıyor');
// ÖLÇÜLEN REGRESYON: mesajı gerçek bir düğmeye yönlendirecek şekilde
// değiştirdim; eski test eski metni arıyordu. Denetim GÜÇLENDİRİLDİ:
// artık yalnızca metin değil, mesajın gösterdiği düğmenin GERÇEKTEN
// var olduğu da ölçülüyor. (Daha önce "QR okutun" denilen ama olmayan
// bir yol gösterilmişti — bu denetim onu yakalayamıyordu.)
ok(/baglantiUyarisi/.test(yama), 'bağlantı kurulamazsa uyarı gösteriliyor');
ok(/<b>QR kodunu okut<\/b>/.test(yama),
  'uyarı mesajı EYLEM DÖNÜK (bir düğmeyi adlandırıyor)');
ok(/id="gsync-qr"/.test(yama),
  'mesajın gösterdiği QR düğmesi GERÇEKTEN sayfada var (yanıltıcı yönlendirme yok)');
ok(/gsync-qrfile/.test(yama) && /capture="environment"/.test(yama),
  'QR düğmesi telefon kamerasını açıyor (güvenli kaynak gerekmez)');

// ---------------------------------------------------------------------------
// ===========================================================================
// Paketleme bütünlüğü — kurulu sürüm AÇILABİLMELİ
// ===========================================================================
// ÖLÇÜLEN KRİTİK HATA: companion.js artık `require('../shared/anahtar.js')`
// diyor. Geliştirmede yol doğru, ama kurulumda dosya {app}\app\companion.js
// oluyor ve `../shared/` = {app}\shared\ demek — o klasör PAKETLENMEMİŞTİ.
// Sonuç: kurulu sürüm açılışta require hatasıyla PATLIYORDU.
// Geliştirme makinesinde her şey çalıştığı için görünmüyordu.
{
  const iss = fs.readFileSync(path.join(__dirname, '..', 'companion', 'kurulum.iss'), 'utf8');
  const requireVar = /require\('\.\.\/shared\/anahtar\.js'\)/.test(
    fs.readFileSync(path.join(__dirname, '..', 'companion', 'companion.js'), 'utf8'));
  ok(requireVar, 'companion.js anahtar dosyasini okuyor');
  ok(/\.\.\\shared\\anahtar\.js/.test(iss),
    'kurulum.iss anahtar dosyasini paketliyor (yol: ..\shared\anahtar.js)',
    'paketlemeye eklenmesi unutuldu — kurulu sürüm açılmazdı');
  ok(/DestDir: "\{app\}\\shared"/.test(iss),
    "anahtar dosyasi {app}\\shared altina konuluyor (require yoluyla uyumlu)");
  // Dayanıklılık: dosya yine de yoksa servis DÜŞMEMELİ.
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'companion', 'companion.js'), 'utf8');
  ok(/try\s*\{[\s\S]{0,220}require\('\.\.\/shared\/anahtar\.js'\)/.test(kaynak),
    'require try/catch icinde (dosya yoksa servis cokmez, durumda bildirir)');
  // Statik sunum satiri geri gelmemeli — panel koruması eklerken silinmisti.
  ok(/express\.static\(path\.join\(__dirname, 'public'\)\)/.test(kaynak),
    'express.static YERINDE (telefon uygulamasi 404 vermesin)');
}

console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
