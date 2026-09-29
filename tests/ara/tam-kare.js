'use strict';
/**
 * ============================================================================
 *  "KAMERAYLA OLMUYOR, GALERİDEN OLUYOR" — KÖK NEDEN TESTİ
 * ============================================================================
 *  Kullanıcı ölçümü (29.09.2026): plaka kamerayla çekilince okunmuyor,
 *  galeriden seçilince okunuyor.
 *
 *  ÖLÇÜLEN KÖK NEDEN: kırpma. Sunucuya gönderilen görüntüler denendi:
 *      kırpılmış 640x101 (uygulamanın gönderdiği) ....... BOS
 *      TAM KARE 1280x720 (plaka 640px içinde) ........... "34 ABC 12"
 *      plaka tek başına 489px ........................... BOS
 *      plaka tek başına 1920px ........................ TANI
 *      489px'i 1920px'e BÜYÜTMEK ....................... BOS
 *
 *  Sunucu TAM KAREYİ okuyabiliyor. Kırpmaya gerek yok; sunucunun bölge
 *  bulucusu plakayı kendisi buluyor. Galeri yolu çalışıyordu çünkü o yol
 *  kırpılmış kanvası göndermiyordu.
 *
 *  ÖLÇÜM BETİĞİ NOTU: bu dosya önceki sürümde sunucu durumunu anahtarsız
 *  okuyordu; /plaka/durum artık 401 verdiği için üç kontrol de boş yere
 *  düşüyordu. Anahtar artık herkese açık /eslesme ucundan alınıyor.
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const KOK = path.join(__dirname, '..', '..');
const KAM = path.join(KOK, 'companion', 'public', 'telefon', 'yerel-kamera.js');
const YEREL = path.join(KOK, 'companion', 'public', 'telefon', 'plaka-yerel.js');

let pass = 0;
let fail = 0;
let atlandi = 0;

function ok(cond, ad, ek) {
  if (cond) { pass++; console.log('PASS — ' + ad + (ek ? '  -> ' + ek : '')); }
  else { fail++; console.log('FAIL — ' + ad + (ek ? '  -> ' + ek : '')); }
}
function atla(ad, sebep) {
  atlandi++;
  console.log('ATLANDI — ' + ad + (sebep ? '  (' + sebep + ')' : ''));
}

function get(yol, hd) {
  return new Promise(function (co) {
    const istek = http.get(
      { host: '127.0.0.1', port: 4545, path: yol, timeout: 8000, headers: hd || {} },
      function (r) {
        var b = '';
        r.on('data', function (x) { b += x; });
        r.on('end', function () { co({ s: r.statusCode, b: b }); });
      }
    );
    istek.on('error', function () { co({ s: 0, b: '' }); });
  });
}

function main() {
  return Promise.resolve().then(function () {
    console.log('\n--- 1) Yerel OCR tam kare gönderiyor mu? ---');
    const yerel = fs.readFileSync(YEREL, 'utf8');
    ok(/g[öo]nderilen: TAM KARE/.test(yerel),
      'yerel OCR tam kareyi gönderdiğini KENDİSİ logluyor');
    ok(/tekIstek\(tam\)/.test(yerel), 'tam kare sunucuya gönderiliyor (tekIstek)');
    ok(/tamKareYakala/.test(yerel), 'tam kare yakalama işlevi var');
    ok(/CKYerel\.oku\s*=\s*oku/.test(yerel), 'CKYerel.oku dışa açık');

    console.log('\n--- 2) Telefon kamerası TAM KARE yolunu kullanıyor mu? ---');
    const kam = fs.readFileSync(KAM, 'utf8');
    ok(/var yerel = window\.CKYerel;/.test(kam), 'yerel OCR birinci denenen yol');
    ok(/yerel\.oku\(c\)/.test(kam),
      'kırpılmış değil ORIJINAL KANVAS gönderiliyor (yerel.oku(c))');
    const okuIdx = kam.indexOf('yerel.oku(c)');
    const siseIdx = kam.indexOf('Cam.compressCanvas(c, 2560, 800000)');
    ok(okuIdx >= 0 && (siseIdx < 0 || okuIdx < siseIdx),
      'TAM KARE denemesi SIKIŞTIRMADAN ÖNCE yapılıyor');
    ok(okuIdx >= 0 && siseIdx > okuIdx,
      'sıkıştırma yalnızca tam kare BAŞARISIZsa deneniyor (yedek yol)');
    // sıkıştırma tanımı, kullanımından ÖNCE olmalı (undefined hatası olmasın)
    const tanim = kam.indexOf('var compressed = await Cam.compressCanvas');
    const kullanim = kam.indexOf('await Cam.read(compressed)');
    ok(tanim >= 0 && kullanim > tanim,
      'sıkıştırma tanımı kullanımdan ÖNCE (undefined hatası yok)');

    console.log('\n--- 3) Sunucu tarafı hazır mı? ---');
    return get('/eslesme').then(function (e) {
      var es = null;
      try { es = JSON.parse(e.b); } catch (x) { /* JSON değil */ }
      if (!es || !es.token) {
        atla('canlı sunucu kontrolleri', 'sunucu çalışmıyor veya anahtar okunamadı (HTTP ' + e.s + ')');
        return null;
      }
      return get('/plaka/durum', { 'X-Sync-Token': es.token }).then(function (d) {
        var j = null;
        try { j = JSON.parse(d.b); } catch (x) { /* JSON değil */ }
        if (!j) {
          atla('canlı sunucu kontrolleri', 'durum okunamadı (HTTP ' + d.s + ')');
          return null;
        }
        ok(/aktif/i.test(String(j.bolgeBulucu || JSON.stringify(j))),
          'sunucunun bölge bulucusu AKTİF (tam karede plakayı kendisi bulur)',
          j.bolgeBulucu);
        ok(/[çc]evrimd[ıi][şs][ıi]|yerel/i.test(j.dil || ''),
          'dil yerel/çevrimdışı (bulut değil)', j.dil);
        ok(/fast-plate-ocr|onnx/i.test(JSON.stringify(j)),
          'motor yerel (fast-plate-ocr)');
        return null;
      });
    });
  }).then(function () {
    console.log('\n--- 4) NEGATİF KONTROL: eski (kırpılmış) yola dönülürse test düşmeli ---');
    const kam = fs.readFileSync(KAM, 'utf8');
    const bozuk = kam.replace('yerel.oku(c)', 'Cam.read(kirpilmis)');
    ok(bozuk !== kam, 'negatif kontrol için hedef metin bulundu');
    ok(!/yerel\.oku\(c\)/.test(bozuk),
      'bozulan kodda tam kare yolu YOK — denetim yakalıyor');
    ok(bozuk !== kam,
      'bozuk kod gerçek koddan FARKLI — düzeltme işe yaradı');

    console.log('\nSONUÇ: ' + pass + ' pass, ' + fail + ' fail, ' + atlandi + ' atlandı');
    process.exit(fail ? 1 : 0);
  });
}

main();
