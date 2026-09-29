'use strict';
/**
 * tests/ara/launcher-derleme.js
 *
 * ÖLÇÜLEN GERÇEK: `*.exe` .gitignore'da (satır: `*.exe`), ama
 * `kurulum.iss:71` şunu paketliyor:
 *     Source: "launcher\CinarkoySync.exe"; DestDir: "{app}";
 * Yani kurulum paketi exe'yi DEPOdan bekliyor, depoda yok. Temiz klon ile
 * kurulum yapılamaz.
 *
 * ÖLÇÜLEN HATA (29.09.2026): panel "Ağdan: http://localhost:4577/" ve
 * "Plaka motoru: yok" gösteriyordu. Sebep Baslatici.cs'de idi:
 * /durum ve /plaka/durum uçları anahtar zorunlu kıldı (HTTP 401), launcher
 * hiç göndermiyordu. Canlı ölçüm:
 *     /durum       -> 401 (anahtarsız)
 *     /plaka/durum -> 401 (anahtarsız)
 *     /plaka/durum -> 200 (X-Sync-Token ile) aktif=true hazir=true
 *
 * RİSKİ: exe depoda değilse, düzeltme kaynak dosyada durur ve KURULAN
 * uygulamaya hiç ulaşmaz. Sessiz gerileme. Bu test iki şeyi denetler:
 *   1) exe kurulum paketinin beklediği yolda var mı
 *   2) exe, KAYNAKTAN yeni mi (kaynak yeniden derlenmemişse kırmızı)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const KOK = 'C:/syncserver';
const EXE = path.join(KOK, 'companion', 'launcher', 'CinarkoySync.exe');
const CS = path.join(KOK, 'companion', 'launcher', 'Baslatici.cs');
const ISS = path.join(KOK, 'companion', 'kurulum.iss');

let gecti = 0, kaldi = 0;
function ok(ad, kosul, ayrinti) {
  if (kosul) { gecti++; console.log('  ok   ' + ad); }
  else { kaldi++; console.log('  FAIL ' + ad + (ayrinti ? ' :: ' + ayrinti : '')); }
}

console.log('\n== 1) kaynak ve paket beklentisi ==');
ok('Baslatici.cs var', fs.existsSync(CS));
ok('kurulum.iss var', fs.existsSync(ISS));
const iss = fs.readFileSync(ISS, 'utf8');
const paketliyorMu = /Source:\s*"launcher\\CinarkoySync\.exe"/.test(iss);
ok('kurulum.iss launcher exe paketliyor', paketliyorMu, 'paketleme satiri yok');

console.log('\n== 2) exe kurulumun bekledigi yolda ==');
const exeVar = fs.existsSync(EXE);
ok('launcher/CinarkoySync.exe mevcut', exeVar,
  exeVar ? '' : 'EXE YOK - kurulum paketi bu dosyayi bekliyor, derlenmeli');

if (exeVar) {
  const exeT = fs.statSync(EXE).mtimeMs;
  const csT = fs.statSync(CS).mtimeMs;
  ok('exe kaynaktan YENI (derlenmis)', exeT >= csT,
    'exe eski: kaynak ' + new Date(csT).toISOString() + ', exe ' + new Date(exeT).toISOString());

  console.log('\n== 3) exe gercekten guncel kod iceriyor mu? ==');
  // Kaynakta olup exe'de OLMAMASI gereken bir isaret: kurulum anahtari
  // okuyan yeni JsonAl asimli yuku. Kaynakta varsa derleme yapilmis olmalidir.
  const cs = fs.readFileSync(CS, 'utf8');
  const asimliVar = /private static string JsonAl\(string url, string kurulumAnahtari\)/.test(cs);
  ok('kaynakta anahtarli JsonAl asimli yuku var', asimliVar,
    'kaynakta dogrulama asmasi yok - exe derlemesi de eski olabilir');
  const eskiCagri = /JsonAl\("http:\/\/127\.0\.0\.1:" \+ Yol\.Port \+ "\/durum"\)\s*;/.test(cs);
  ok('/durum artik anahtarla cagriliyor', !eskiCagri,
    'hala anahtarsiz cagri var');
}

console.log('\n== 4) derleme komutu belgeli mi? ==');
const csUst = fs.readFileSync(CS, 'utf8').split('\n').slice(0, 14).join('\n');
ok('Baslatici.cs icinde csc komutu yazili', /csc[\s\S]*\/target:winexe/.test(csUst),
  'derleme komutu bulunamadi');

console.log('\n=== ' + gecti + ' gecti, ' + kaldi + ' kaldi ===');
process.exit(kaldi ? 1 : 0);
