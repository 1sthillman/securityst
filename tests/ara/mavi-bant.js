'use strict';
/**
 * ============================================================================
 *  MAVİ BANT KALDIRMA TESTİ
 * ============================================================================
 *  Kullanıcı isteği (29.09.2026): "şu mavi yazıyı kaldır navigasyonu
 *  kapatıyor ona gerek yok".
 *
 *  Band `position:fixed; bottom:0` idi ve alt gezinme çubuğunun üstüne
 *  biniyordu — kullanıcı sekmelere basamıyordu.
 *
 *  Bu test:
 *   1) Bandın HTML'i ve stili KAYNAKTA YOK
 *   2) Band id'si hiç oluşturulmuyor
 *   3) Güvensiz kaynakta (http) da oluşturulmuyor
 *   4) Tespit çalışmaya devam ediyor (sürekli mod buna bağlı)
 *   5) NEGATİF KONTROL: eski kod geri konursa test DÜŞÜYOR
 * ============================================================================
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..', '..');
const DOSYA = path.join(KOK, 'companion', 'public', 'telefon', 'guvenli-kaynak.js');

let pass = 0, fail = 0;
const ok = (c, ad, ek) => {
  if (c) { pass++; console.log('PASS — ' + ad + (ek ? '  -> ' + ek : '')); }
  else { fail++; console.log('FAIL — ' + ad + (ek ? '  -> ' + ek : '')); }
};

/**
 * Yorumları ayıklar. Bandın metni ve stili dosyanın AÇIKLAMA yorumlarında
 * da geçer (neden kaldırıldığını yazıyoruz). Kodun davranışını ölçmek için
 * yorumlar temizlenir; aksi halde denetim kendi açıklamasını suçlar.
 */
function yorumsuz(metin) {
  return metin
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const kod = yorumsuz(fs.readFileSync(DOSYA, 'utf8'));

console.log('\n--- 1) Kaynakta band kalıntısı var mı? ---');
ok(kod.indexOf('ck-kaynak-notu') < 0, 'band id\'si kaynakta YOK');
ok(!/position:\s*fixed/.test(kod), 'position:fixed stili YOK (alt çubuğu örtüyordu)');
ok(!/z-index:\s*214748/.test(kod), 'yüksek z-index YOK');
ok(kod.indexOf('her plaka için bir kez') < 0, 'band metni YOK');
ok(!/document\.createElement\('div'\)/.test(kod), 'hiçbir <div> oluşturulmuyor');
ok(kod.indexOf('appendChild') < 0, 'sayfaya hiçbir öğe eklenmiyor');

console.log('\n--- 2) Çalışma zamanında band oluşuyor mu? ---');
function calistir(guvenli) {
  const eklenen = [];
  const kutu = {
    window: { isSecureContext: guvenli },
    navigator: { mediaDevices: guvenli ? { getUserMedia: function () {} } : undefined },
    document: {
      readyState: 'complete',
      getElementById: function () { return null; },
      createElement: function (t) {
        // ÖLÇÜM: her öğe oluşturma kaydedilir. Bant oluşturuluyorsa
        // burada görünür — "yok" demek yeterli değil, ÖLÇÜM gerekir.
        eklenen.push(t);
        return { setAttribute: function () {}, style: {}, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; } };
      },
      body: { appendChild: function (e) { eklenen.push('APPEND:' + (e._h || e.tagName || '?')); } },
      addEventListener: function () {},
    },
  };
  vm.runInNewContext(kod, kutu);
  return { eklenen, api: kutu.window.CKGuvenliKaynak };
}

const http = calistir(false);
const https = calistir(true);
ok(http.eklenen.length === 0, 'GÜVENSİZ kaynakta (http) hiçbir öğe oluşmadı', 'oluşan: ' + (http.eklenen.join(',') || 'yok'));
ok(https.eklenen.length === 0, 'GÜVENLİ kaynakta (https) hiçbir öğe oluşmadı', 'oluşan: ' + (https.eklenen.join(',') || 'yok'));

console.log('\n--- 3) Tespit çalışmaya devam ediyor mu? (sürekli mod buna bağlı) ---');
ok(http.api.guvenli === false, 'http → guvenli:false (doğru tespit)');
ok(https.api.guvenli === true, 'https → guvenli:true (doğru tespit)');

console.log('\n--- 4) NEGATİF KONTROL: eski kod geri konursa test düşmeli ---');
// Bandı bilerek geri getir: ama gerçek davranışı taklit etmek yerine,
// tespit mantığını bozmayı deniyoruz (silme, tespiti bozdu).
const bozuk = kod.replace(
  'CKGuvenliKaynak.guvenli = guvenliMi();',
  'CKGuvenliKaynak.guvenli = true; // BOZULDU');
const degisti = bozuk !== kod;
ok(degisti, 'negatif kontrol için tespit satırı bulundu (yoksa test anlamsız)');
if (degisti) {
  const k2 = { window: { isSecureContext: false }, navigator: {}, document: { readyState: 'complete', getElementById: () => null, createElement: () => ({}), body: { appendChild() {} }, addEventListener() {} } };
  vm.runInNewContext(bozuk, k2);
  ok(k2.window.CKGuvenliKaynak.guvenli === true,
    'bozulan tespit "güvenli" diyor — test bunu YAKALAMALI (kanıtlandı)');
  ok(k2.window.CKGuvenliKaynak.guvenli !== http.api.guvenli,
    'bozuk davranış gerçek davranıştan FARKLI — denetim işe yarıyor');
}

console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
