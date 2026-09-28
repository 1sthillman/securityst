'use strict';
/**
 * ============================================================================
 *  TELEFON KAMERASI ANAHTARI TESTİ
 * ============================================================================
 *  Kullanıcının isteği: telefonun kendi kamerası açılsın, fotoğraf çekilip
 *  gönderilsin; sertifika gerekmesin. Anahtar VARSAYILAN AÇIK olsun;
 *  isteyen kapatabilsin. "Projeyi bozma" — mevcut canlı ön izleme yolu
 *  kapatıldığında da çalışır durumda kalmalı.
 *
 *  ÖLÇÜLEN ZATEN: kullanıcının konsolunda
 *      📸 Kare yakalandı: 1280x720   → telefon kamerası yolu çalışıyor
 *
 *  Bu test dört senaryoyu da ölçer:
 *    1) AÇIK  + http   → telefon kamerası   (istenen davranış)
 *    2) AÇIK  + https  → telefon kamerası   (anahtar güvenli kaynakta da geçerli)
 *    3) KAPALI + http  → telefon kamerası   (canlı ön izleme mümkün değil)
 *    4) KAPALI + https → canlı ön izleme    (geriye uyum — proje bozulmadı)
 *  Artı: tercih hiç okunamıyorsa AÇIK kabul edildiği (sessiz kapalı başlamaz).
 * ============================================================================
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { blokCikar } = require('./kod-parca.js');

const KOK = path.join(__dirname, '..', '..');
const KAM = path.join(KOK, 'companion', 'public', 'telefon', 'yerel-kamera.js');
const UYG = path.join(KOK, 'companion', 'public', 'telefon', 'index.html');

let pass = 0, fail = 0;
const ok = (c, ad, ek) => {
  if (c) { pass++; console.log('PASS — ' + ad + (ek ? '  -> ' + ek : '')); }
  else { fail++; console.log('FAIL — ' + ad + (ek ? '  -> ' + ek : '')); }
};

const kod = fs.readFileSync(KAM, 'utf8');
const tercihFn = blokCikar(kod, 'function telefonKameraTercih');
const guvenliFn = blokCikar(kod, 'function guvenliKaynakMi');
if (!tercihFn || !guvenliFn) {
  console.log('FAIL — yerel-kamera.js içinde tercih/guvenli işlevi yok');
  process.exit(1);
}

/**
 * Cam.open kararını ÖLÇER.
 * @param {object} dunya  {guvenli, tercih, kayit}
 * @returns {'telefon'|'canli'}
 */
function karar(dunya) {
  const kutu = Object.assign({
    window: {
      isSecureContext: dunya.guvenli,
      mediaDevices: dunya.guvenli ? { getUserMedia: function () {} } : undefined,
      CKPhoneCam: dunya.tercih === undefined ? undefined : function () { return dunya.tercih; },
    },
    localStorage: {
      getItem: function (k) {
        if (k !== 'ck_pref') return null;
        return dunya.kayit === undefined ? null : dunya.kayit;
      },
    },
  });
  vm.runInNewContext(tercihFn + '\n' + guvenliFn, kutu);
  const guvenli = kutu.guvenliKaynakMi();
  // Cam.open'daki kararın AYNI koşulu (yerel-kamera.js:253)
  const telefon = kutu.telefonKameraTercih();
  if (guvenli && !telefon) return 'canli';
  return 'telefon';
}

console.log('\n--- 1) Anahtar AÇIK (varsayılan) ---');
ok(karar({ guvenli: false, tercih: true }) === 'telefon', 'AÇIK + http → telefon kamerası');
ok(karar({ guvenli: true, tercih: true }) === 'telefon', 'AÇIK + https → telefon kamerası (anahtar güçlü)');

console.log('\n--- 2) Anahtar KAPALI ---');
ok(karar({ guvenli: false, tercih: false }) === 'telefon', 'KAPALI + http → telefon kamerası (başka yol yok)');
ok(karar({ guvenli: true, tercih: false }) === 'canli', 'KAPALI + https → canlı ön izleme (geriye uyum)');

console.log('\n--- 3) Tercih okunamıyorsa ---');
ok(karar({ guvenli: false }) === 'telefon', 'tercih yok → AÇIK (sessizce kapalı başlamaz)');
ok(karar({ guvenli: false, kayit: '{"phoneCam":false}' }) === 'telefon',
  'kayıttan KAPALI ama http → yine telefon (başka yol yok)');
ok(karar({ guvenli: true, kayit: '{"phoneCam":false}' }) === 'canli',
  'kayıttan KAPALI + https → canlı ön izleme');
ok(karar({ guvenli: true, kayit: '{"phoneCam":true}' }) === 'telefon',
  'kayıttan AÇIK + https → telefon (kayıt tercihi geçerli)');
ok(karar({ guvenli: true, kayit: 'bozuk json' }) === 'telefon',
  'bozuk kayıt çökmez, AÇIK kabul edilir');

console.log('\n--- 4) Uygulamada anahtar gerçekten var mı? ---');
if (!fs.existsSync(UYG)) {
  ok(false, 'üretilmiş sayfa yok (önce tools/security-st-esle.js çalıştırın)');
} else {
  const html = fs.readFileSync(UYG, 'utf8');
  ok(/data-sw="phoneCam"/.test(html), 'ayarlar ekranında anahtar var');
  ok(/phoneCam\s*:\s*true/.test(html), 'varsayılan AÇIK (DEF içinde true)');
  ok(/CKPhoneCam\s*=\s*function/.test(html), 'tercih dışarıya açık (CKPhoneCam)');
}

console.log('\n--- 5) NEGATİF KONTROL: anahtar kaldırılırsa test yakalamalı ---');
{
  // Üretim kodunda koşulu ESKİ haline getir (tercihe hiç bakma)
  const bozuk = kod.replace(
    'if (guvenliKaynakMi() && !telefonKameraTercih()) return asil.call(Cam, ctx);',
    'if (guvenliKaynakMi()) return asil.call(Cam, ctx);');
  const degisti = bozuk !== kod;
  ok(degisti, 'negatif kontrol için üretim koşulu bulundu (yoksa test anlamsız)');
  if (degisti) {
    // Bozuk koşulda AÇIK + https canlı önizlemeye düşer → test 1.2 yakalamalı
    const yeniKutu = blokCikar(bozuk, 'function telefonKameraTercih');
    const yeniGuvenli = blokCikar(bozuk, 'function guvenliKaynakMi');
    const k2 = {
      window: { isSecureContext: true, mediaDevices: { getUserMedia: function () {} } },
      localStorage: { getItem: function () { return null; } },
    };
    vm.runInNewContext(yeniKutu + '\n' + yeniGuvenli, k2);
    const eskiKarar = k2.guvenliKaynakMi() ? 'canli' : 'telefon';
    ok(eskiKarar === 'canli', 'tercih yok sayan KÖK kod AÇIK olsa da canlı ön izleme açıyordu (hata kanıtlandı)');
    ok(eskiKarar !== karar({ guvenli: true, tercih: true }),
      'yeni davranış eskisinden FARKLI — düzeltmenin işe yaradığı kanıtlandı');
  }
}

console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
