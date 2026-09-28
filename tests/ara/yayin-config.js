'use strict';
/**
 * ============================================================================
 *  YAYIN YAPILANDIRMASI TESTİ
 * ============================================================================
 *  ÖLÇÜLEN HATA: uygulama `window.location.origin` adresine bağlanıyordu.
 *  LAN kurulumunda bu DOĞRU (uygulama kendi companion servisinden sunulur).
 *  Ama uygulama GitHub Pages'ten yayınlandığında origin
 *  "https://1sthillman.github.io" olur ve uygulama MÜŞTERİNİN BİLGİSAYARINA
 *  değil, GitHub'a bağlanmaya çalışır — yani Pages'te uygulama hiç çalışmaz.
 *
 *  Çözüm: `yapilandirma.js` (CK_YAPILANDIRMA) okunur.
 *    - SUNUCU_ADRESI doluysa O adres kullanılır (Pages kurulumu).
 *    - Boşsa mevcut davranış korunur (LAN kurulumu, geriye uyum).
 *
 *  Müşteri hiçbir şey yapmaz: adres teslimattan önce biz yazarız.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const KAYNAK = path.join(__dirname, '..', '..', 'phone', 'guvenlik-sync.js');

let pass = 0, fail = 0;
const ok = (c, ad, alinan) => {
  if (c) { pass++; console.log('PASS — ' + ad + (alinan ? '  -> ' + alinan : '')); }
  else { fail++; console.log('FAIL — ' + ad + (alinan ? '  -> ' + alinan : '')); }
};

const { blokCikar, yapilandirmaVeKok } = require('./kod-parca.js');
const parca = yapilandirmaVeKok(fs.readFileSync(KAYNAK, 'utf8'));

function calistir(pencere) {
  const kutu = Object.assign({ window: pencere }, pencere);
  vm.runInNewContext(parca, kutu);
  return kutu.sunucuKoku();
}

console.log('\n--- YAYIN YAPILANDIRMASI ---');
ok(calistir({ location: { origin: 'http://192.168.1.42:4545' } }) === 'http://192.168.1.42:4545',
  'LAN kurulumu aynı kökeni kullanır (yapılandırma yok, geriye uyum)');

ok(calistir({ location: { origin: 'https://1sthillman.github.io' } }) === 'https://1sthillman.github.io',
  'yapılandırma boşken origin kullanılır');

const dolu = { location: { origin: 'https://1sthillman.github.io' }, CK_YAPILANDIRMA: { SUNUCU_ADRESI: 'http://192.168.1.42:4545' } };
ok(calistir(dolu) === 'http://192.168.1.42:4545',
  'yapılandırma doluyken SUNUCU_ADRESI kullanılır (Pages düzeltmesi)', calistir(dolu));

ok(calistir(dolu) !== calistir({ location: { origin: 'https://1sthillman.github.io' } }),
  'yapılandırma origin\'i EZER — Pages\'te yanlış adrese bağlanma düzeltildi');

ok(calistir({
  location: { origin: 'https://x' },
  CK_YAPILANDIRMA: { SUNUCU_ADRESI: 'http://192.168.1.42:4545///' },
}) === 'http://192.168.1.42:4545', 'yapılandırmadaki son eğik çizgiler temizlenir');

ok(calistir({
  location: { origin: 'https://x' },
  CK_YAPILANDIRMA: { SUNUCU_ADRESI: '   ' },
}) === 'https://x', 'yalnızca boşluk içeren yapılandırma yok sayılır');

// Üretilmiş çıktı da yapılandırmayı yüklemeli
// --- Proje alt yolu (ölçülen hata) ------------------------------------
// GitHub Pages proje sayfası /<depo>/ altındadır. `location.origin` yalnızca
// kök alan adıdır; depo yolunu içermez. Ölçülen hata: uygulama
// https://1sthillman.github.io/plaka/oku adresine gidiyordu (405).
const PROJE = { location: { origin: 'https://1sthillman.github.io', pathname: '/securityst/index.html' } };
const projeKok = calistir(PROJE);
ok(projeKok === 'https://1sthillman.github.io/securityst',
  'proje sayfasında depo yolu KORUNUYOR (ölçülen hatanın düzeltmesi)', projeKok);

ok(!/^https:\/\/1sthillman\.github\.io$/.test(projeKok),
  'kök alan adına düşülmüyor (eski hata tekrarlanmıyor)');

// Alt klasörde çalışsa da aynı kural geçerli: `/telefon` segmenti
// SUNUCU KÖKÜ değildir, atılır. (companion `express.static` ile oradan
// servis eder; API uçları köktedir.)
const ALT = { location: { origin: 'https://1sthillman.github.io', pathname: '/securityst/telefon/index.html' } };
ok(calistir(ALT) === 'https://1sthillman.github.io/securityst',
  'alt klasörde `/telefon` atılır, depo yolu korunur', calistir(ALT));

// GERÇEK KURAL: API uçları sunucu KÖKÜNDEDİR. `/telefon` kök değildir.
// (ölçülen hata: ".../telefon" + "/durum" -> ".../telefon/durum" -> 404)
const TELEFON_AD = { location: { origin: 'http://192.168.1.42:4545', pathname: '/telefon/' } };
ok(calistir(TELEFON_AD) === 'http://192.168.1.42:4545',
  'LAN: /telefon atılır, uçlar sunucu kökünde açılır', calistir(TELEFON_AD));

const KOK_DUZ = { location: { origin: 'http://192.168.1.42:4545', pathname: '/telefon/index.html' } };
ok(calistir(KOK_DUZ) === 'http://192.168.1.42:4545',
  'LAN kurulumunda yine sunucunun kendisi kullanılıyor (geriye uyum)', calistir(KOK_DUZ));

console.log('\n--- ÜRETİLMİŞ ÇIKTI ---');
const uretilmis = path.join(__dirname, '..', '..', 'companion', 'public', 'telefon', 'index.html');
if (fs.existsSync(uretilmis)) {
  const html = fs.readFileSync(uretilmis, 'utf8');
  ok(/yapilandirma\.js/.test(html), 'üretilmiş sayfa yapilandirma.js yüklüyor');
} else {
  ok(false, 'üretilmiş sayfa bulunamadı (önce tools/security-st-esle.js çalıştırın)');
}
const yapDosya = path.join(__dirname, '..', '..', 'companion', 'public', 'telefon', 'yapilandirma.js');
ok(fs.existsSync(yapDosya), 'yapilandirma.js mevcut (yoksa sayfa 404 ister)');
if (fs.existsSync(yapDosya)) {
  const y = fs.readFileSync(yapDosya, 'utf8');
  ok(/SUNUCU_ADRESI/.test(y) && /API_ANAHTARI/.test(y), 'yapilandirma.js beklenen alanları tanımlıyor');
}

console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
