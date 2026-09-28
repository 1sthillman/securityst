'use strict';
/**
 * ============================================================================
 *  YAYIN YAPILANDIRMASI YAZICI
 * ============================================================================
 *  GitHub Actions tarafından çalıştırılır. GitHub Secrets/Variables'dan gelen
 *  değerleri `site/yapilandirma.js` içine yazar; uygulama buradan sunucu
 *  adresini ve kimliğini okur.
 *
 *  Müşteri hiçbir dosyaya dokunmaz. Girdiği tek yer:
 *      GitHub -> Settings -> Secrets and variables -> Actions
 *
 *  ÖLÇÜLEN GEREKÇE: eşleşme sayfasından alınan 64 haneli kurulum anahtarı
 *  canlı sunucuda tek başına HTTP 200 döndürdü. Yani paylaşılan API anahtarı
 *  gerekmez; müşteri kendi anahtarını kullanır ve anahtar artık ORTAK DEĞİLDİR.
 *
 *  GÜVENLİK NOTU (gizlenmiyor): yayınlanan dosya herkese açıktır, anahtar
 *  düz metin olarak görünür. Bu tarayıcı mimarisinin kaçınılmaz kuralıdır;
 *  gizlenmeye çalışılırsa uygulama çalışmaz. Gerçek koruma sırası:
 *  ağ (sunucu internete açılmaz) > anahtar (istekler doğrulanır) > eşleşme.
 */
const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..');
const SITE = path.join(KOK, 'site');
const HEDEF = path.join(SITE, 'yapilandirma.js');

function deger(ad) {
  return String(process.env[ad] || '').trim();
}

const SUNUCU = deger('SUNUCU');
const KURULUM = deger('KURULUM');
const APIKEY = deger('APIKEY');

// Baştaki yorum başlığını koru (alanların ne anlama geldiğini açıklar).
function baslikAl(kaynak) {
  const b = kaynak.indexOf('window.CK_YAPILANDIRMA');
  return b < 0 ? '' : kaynak.slice(0, b);
}

// --- site/ yoksa oluştur (dönüştürücü ve kopyalama adımından sonra çalışır)
fs.mkdirSync(SITE, { recursive: true });

// Mevcut yapılandırmadan yalnızca yorum başlığı alınır.
let mevcut = '';
const kaynak = path.join(KOK, 'companion', 'public', 'telefon', 'yapilandirma.js');
if (fs.existsSync(HEDEF)) mevcut = fs.readFileSync(HEDEF, 'utf8');
else if (fs.existsSync(kaynak)) mevcut = fs.readFileSync(kaynak, 'utf8');
if (!mevcut.trim()) {
  console.error('[HATA] yapilandirma.js bulunamadi ve degerler de bos.');
  process.exit(1);
}

// ÖLÇÜLEN HATA DÜZELTMESİ: alanlar regex ile yamalanmıyordu; eşleşmezse
// satırı dosyanın SONUNA yapıştırılıyordu ve nesnenin dışına düşüyordu
// (geçersiz JavaScript). Nesne şimdi baştan kurulur.
const govde = [
  'window.CK_YAPILANDIRMA = {',
  '  SUNUCU_ADRESI: ' + JSON.stringify(SUNUCU) + ',',
  '  KURULUM_ANAHTARI: ' + JSON.stringify(KURULUM) + ',',
  '  API_ANAHTARI: ' + JSON.stringify(APIKEY) + ',',
  '};',
  '',
].join('\n');

const cikti = baslikAl(mevcut) + govde;

// --- Yazmadan ÖNCE doğrula -------------------------------------------------
// Önceki hata diske yazıldıktan sonra fark edildi. Artık geçersiz JavaScript
// hiçbir koşulda diske inemez.
try {
  new Function(cikti);
} catch (e) {
  console.error('[DURDUR] uretilen yapilandirma gecersiz JavaScript - YAZILMADI: ' + e.message);
  process.exit(1);
}

fs.writeFileSync(HEDEF, cikti, 'utf8');

// --- KENDİNİ DOĞRULA: yazdığımız dosyayı gerçekten okuyup ölç ---------------
const yazilan = fs.readFileSync(HEDEF, 'utf8');
const oku = (a) => {
  const m = new RegExp(a + ':\\s*"([^"]*)"').exec(yazilan);
  return m ? m[1] : '';
};
const ySunucu = oku('SUNUCU_ADRESI');
const yKurulum = oku('KURULUM_ANAHTARI');
const yApi = oku('API_ANAHTARI');

let hata = 0;
function dogrula(k, ad) {
  if (k) { console.log('  GECTI  ' + ad); } else { console.error('  KALDI  ' + ad); hata++; }
}
dogrula(ySunucu === SUNUCU, 'sunucu adresi dosyaya yazildi');
dogrula(yKurulum === KURULUM, 'kurulum anahtari dosyaya yazildi');
dogrula(yApi === APIKEY, 'api anahtari dosyaya yazildi');
dogrula(/window\.CK_YAPILANDIRMA/.test(yazilan), 'dosya yapilandirma nesnesi olarak tanimli');

// Hiçbiri gelmediyse ne olduğunu AÇIKÇA söyle (sessizce boş yayınlama yok)
if (!SUNUCU && !KURULUM && !APIKEY) {
  console.log('');
  console.log('  BILGI: GitHub Settings -> Secrets and variables -> Actions altinda');
  console.log('         CK_SUNUCU_ADRESI ve CK_KURULUM_ANAHTARI tanimli degil.');
  console.log('         Yayin, depodaki yapilandirma.js ile yapildi.');
  console.log('         Uygulama bu durumda yalnizca o bilgisayardan sunuldugu anda');
  console.log('         (http://192.168.x.x:4545/telefon/) kendi sunucusunu bulur.');
}

if (hata) process.exit(1);
console.log('  yapilandirma yazildi: ' + HEDEF);
