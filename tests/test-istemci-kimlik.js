'use strict';
/**
 * ============================================================================
 *  İSTEMCİ KİMLİK DENETİMİ — anahtarı GÖNDERMEYEN istek kalmamalı
 * ============================================================================
 *  Bu sınıf hata ÜÇ KEZ oldu ve her seferinde sessizdi:
 *   1) plaka-yerel.js  -> /plaka/durum 401 -> telefon "motor yok" dedi
 *   2) core.js + panel -> /durum, /kayitlar 401 -> panel boş kaldı
 *   3) senkron.js      -> httpsYokla 401 -> uygulama https'e geçemedi
 *
 *  Hepsi aynı sebep: sunucuyu anahtarla korudum, istemcileri güncellemedim.
 *  Konsolda yalnızca "401" görünüyordu; neden o sırada çökmüyordu.
 *
 *  BU BETİK kalıcı korumadır: uygulama/panel kaynaklarında anahtarı (ya da
 *  ortak başlık yardımcısını) GÖNDERMEYEN hiçbir veri ucu çağrısı kalmaz.
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..');

// Denetlenecek dosyalar: hem KAYNAK hem ÜRETİLMİŞ çıktı.
// (Üretilen dosya unutulursa hata paketlenmiş üründe çıkar.)
const DOSYALAR = [
  'phone/guvenlik-sync.js',
  'companion/public/telefon/senkron.js',            // ÜRETİLMİŞ
  'companion/public/telefon/plaka-yerel.js',
  'companion/public/assets/core.js',
  'companion/public/index.html',
  'companion/public/kayitlar.html',
  'companion/public/eslesme.html',
];

// Anahtarı taşıyan yardımcılar
const YARDIMCI = /CK\.istek|istekBasliklari|ckBasliklar|Authorization/;

const KORUMASIZ_UC = [
  /\/durum\b/,
  /\/kayitlar\b/,
  /\/olay\b/,
  /\/plaka\/durum\b/,
  /\/plaka\/oku\b/,
  /\/plaka\/hazirla\b/,
  /\/eslesme\/cihazlar\b/,
  /\/kayit\/batch\b/,
];

let hata = 0;
let kontrol = 0;

console.log('=== İSTEMCİ KİMLİK DENETİMİ ===');
for (const d of DOSYALAR) {
  const yol = path.join(KOK, d);
  if (!fs.existsSync(yol)) { console.log('  EKSİK  ' + d); hata++; continue; }
  const sat = fs.readFileSync(yol, 'utf8').split('\n');
  const satirlar = [];
  sat.forEach((l, i) => {
    if (!/fetch\(|EventSource\(/.test(l)) return;
    // Çağrının devam eden 3 satırını da pencerele (çok satırlı fetch'ler var)
    const pencere = [l, sat[i + 1] || '', sat[i + 2] || ''].join('\n');
    const uc = KORUMASIZ_UC.find((r) => r.test(pencere));
    if (!uc) return;
    kontrol++;
    if (!YARDIMCI.test(pencere)) {
      satirlar.push('  EKSİK   ' + d + ':' + (i + 1) + '  ' + l.trim().substring(0, 80));
      hata++;
    }
  });
  const durum = satirlar.length ? satirlar.join('\n') : '  TAMAM   ' + d;
  console.log(durum);
}

console.log('');
console.log('Denetlenen veri ucu çağrısı: ' + kontrol);
console.log('Anahtarsız (EKSİK): ' + hata);
if (hata === 0) {
  console.log('SONUÇ: geçerli — tüm veri ucu çağrıları kimlik gönderiyor');
  process.exit(0);
}
console.log('SONUÇ: sorun var — anahtarı göndermeyen istek(ler) bulundu');
process.exit(1);
