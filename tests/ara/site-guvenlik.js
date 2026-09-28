'use strict';
/**
 * tests/ara/site-guvenlik.js — yayın klasörü güvenlik denetimi.
 *
 * site/ ÜRETİLEN bir klasördür (.gitignore'da) ve yalnızca iş akışında
 * oluşur. ÖLÇÜLEN HATA: test var olan site/ klasörüne bakıyordu; klasör
 * silinmişse "ENOENT: site/index.html" ile paket ÇÖKÜYORDU (cikis 1).
 * Yani test KENDİ KOSULDUĞU ORTAMIN KİRLİLİĞİNE BAĞLIYDI — dönüştürücüde
 * düzelttiğimiz hatanın test tarafındaki aynı sınıfı.
 *
 * DÜZELTME: test site/ klasörünü KENDİSİ kurar (iş akışıyla birebir aynı),
 * sonra denetler.
 *
 * ÖNEMLİ: denetimin kendisi kanıtlanır. `tespitEt()` bilerek bir sızıntı
 * üzerinde çalıştırılır ve GERÇEKTEN sızıntı bildirdiği gösterilir.
 * (Daha önceki denemede kontrol `fs.existsSync` ile "dosya var mı" diye
 * soruyordu — bu zaten doğru cevabı verdiği için denetimi kanıtlamıyordu,
 * yani sahte kanıttı. Düzeltildi.)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KOK = path.join(__dirname, '..', '..');
const KAYNAK = path.join(KOK, 'companion', 'public', 'telefon');
const SITE = path.join(KOK, 'site');
const PANEL_KAYNAK = path.join(KOK, 'companion', 'public', 'index.html');

// --- 1) site/ klasörünü kur (iş akışıyla birebir aynı) ----------------------
function siteKur() {
  fs.rmSync(SITE, { recursive: true, force: true });
  fs.mkdirSync(SITE, { recursive: true });
  (function gez(k, h) {
    for (const e of fs.readdirSync(k, { withFileTypes: true })) {
      const kk = path.join(k, e.name);
      const hh = path.join(h, e.name);
      if (e.isDirectory()) { fs.mkdirSync(hh, { recursive: true }); gez(kk, hh); }
      else fs.copyFileSync(kk, hh);
    }
  })(KAYNAK, SITE);
}
siteKur();
console.log('site/ test icin yeniden kuruldu (kaynak: companion/public/telefon/)');

// --- 2) TESPİT (tek doğruluk kaynağı; hem normal hem negatif kontrol bunu çağırır)
const YASAK = ['kayitlar.html', 'ayar.html', 'eslesme.html'];
const GEREKEN = ['index.html', 'senkron.js', 'plaka-yerel.js', 'canli-okuma.js',
  'yerel-kamera.js', 'yapilandirma.js', 'guvenli-kaynak.js', 'ocr-config.js',
  'vendor/qrcode.min.js', 'vendor/xlsx.full.min.js'];

function parmakOzu(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

/** Sızıntıları döndürür: liste boşsa temiz. */
function tespitEt() {
  const bulunan = [];
  for (const f of YASAK) {
    if (fs.existsSync(path.join(SITE, f))) bulunan.push('PANEL dosyasi: ' + f);
  }
  if (fs.existsSync(path.join(SITE, 'assets'))) bulunan.push('PANEL varliklari: assets/');

  const siteIndex = path.join(SITE, 'index.html');
  if (fs.existsSync(siteIndex)) {
    const s = parmakOzu(siteIndex);
    if (fs.existsSync(path.join(KAYNAK, 'index.html')) && s !== parmakOzu(path.join(KAYNAK, 'index.html'))) {
      bulunan.push('site/index.html telefon kaynagindan degil');
    }
    if (fs.existsSync(PANEL_KAYNAK) && s === parmakOzu(PANEL_KAYNAK)) {
      bulunan.push('site/index.html PANEL dosyasi - veri sizintisi');
    }
  } else {
    bulunan.push('site/index.html yok');
  }
  for (const f of GEREKEN) {
    if (!fs.existsSync(path.join(SITE, f))) bulunan.push('eksik dosya: ' + f);
  }
  return bulunan;
}

let hata = 0;
function isaret(k, ad, ek) {
  if (k) console.log('  GECTI  ' + ad);
  else { console.error('  KALDI  ' + ad + (ek ? '  -> ' + ek : '')); hata++; }
}

console.log('');
console.log('=== NORMAL DURUM ===');
const temiz = tespitEt();
isaret(temiz.length === 0, 'sızıntı yok', temiz.join('; '));
console.log('  (bulunan: ' + (temiz.length ? temiz.join(', ') : 'yok') + ')');

console.log('');
console.log('=== NEGATİF KONTROL: sızıntıyı üret, denetimin YAKALADIGINI kanıtla ===');
const sahte = path.join(SITE, 'kayitlar.html');
fs.copyFileSync(PANEL_KAYNAK, sahte);
const kirli = tespitEt();
isaret(kirli.length > 0, 'yapay sızıntı YAKALANDI', 'bulunan: ' + (kirli.length ? kirli.join(', ') : 'YOK - denetim boş!'));
isaret(kirli.some((x) => /kayitlar\.html/.test(x)), 'sızıntının KENDİSİ adıyla bildirildi');
fs.rmSync(sahte, { force: true });
isaret(tespitEt().length === 0, 'sızıntı kaldırılınca tekrar temiz');

console.log('');
console.log(hata ? 'SONUÇ: ' + hata + ' sorun' : 'SONUÇ: yayin klasoru guvenli');
process.exit(hata ? 1 : 0);
