'use strict';
// Canli sunucuda https uzerinden telefon uygulamasi gercekten sunuluyor mu?
const https = require('https');

function t(yol) {
  return new Promise((c) => {
    const r = https.get({ host: '127.0.0.1', port: 4546, path: yol, rejectUnauthorized: false, timeout: 8000 }, (x) => {
      let n = 0, ilk = '';
      x.on('data', (d) => { if (!ilk) ilk = d.toString('utf8', 0, 60); n += d.length; });
      x.on('end', () => c({ yol, s: x.statusCode, bayt: n, ilk: ilk.replace(/\n/g, ' ') }));
    });
    r.on('error', (e) => c({ yol, s: 0, hata: e.message }));
    r.end();
  });
}

(async () => {
  for (const y of ['/telefon/', '/telefon/canli-okuma.js', '/telefon/yerel-kamera.js', '/telefon/index.html']) {
    const r = await t(y);
    console.log(`  ${String(r.s).padEnd(4)} ${y.padEnd(30)} ${r.bayt || 0} bayt  ${r.hata || r.ilk}`);
  }
})();
