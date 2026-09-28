'use strict';
// ============================================================================
//  BAĞIMSIZ DOĞRULAYICILAR — paket suistimali denetimi
// ----------------------------------------------------------------------------
//  Bu iki betik "düzenli test" değil, KODLAYICININ DOĞRULANMASIDIR:
//
//  1) test-guven-tekrar.js  -> servis iki kez açar, ikinci açılışta kök CA
//     kurulumunun ATLANDIĞINI ölçer (kullanıcı "sürekli uyarı çıkıyor" dedi).
//  2) test-guven-tekrar yerine geçen eski e2e-live içi kontroller ayrıldı.
//
//  Buradaki ikinci betik (sertifika) Node'un kendi ayrıştırıcısıyla üretilen
//  X.509'u doğrular ve yanlış girdide hata bulmayı da sınar.
// ============================================================================

const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

let pass = 0, fail = 0;
const bolum = (b) => console.log(`\n--- ${b} ---`);
const ok = (k, a, e = '') => { if (k) { pass++; console.log(`PASS — ${a}`); } else { fail++; console.log(`FAIL — ${a}${e ? ' :: ' + e : ''}`); } };

function kosu(betik, ad) {
  try {
    const cikti = execFileSync(process.execPath, [path.join(__dirname, betik)],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(cikti.trim().split('\n').map((l) => '  ' + l).join('\n'));
    ok(true, `${ad} geçti`);
  } catch (e) {
    const cikti = String(e.stdout || '') + String(e.stderr || '');
    console.log(cikti.trim().split('\n').map((l) => '  ' + l).join('\n'));
    ok(false, `${ad} geçti`, `çıkış kodu ${e.status}`);
  }
}

bolum('Sertifika üretimi bağımsız doğrulayıcıyla kanıtlanıyor');
kosu('ara/sertifika-dogrula.js', 'X.509 üretimi + negatif kontroller');

bolum('QR kodu bağımsız çözücüyle (OpenCV) kanıtlanıyor');
ok(fs.existsSync(path.join(__dirname, 'ara', 'qr-dogrula.js')), 'QR doğrulama betiği mevcut');
kosu('ara/qr-dogrula.js', 'QR üretimi + çözme');


console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
