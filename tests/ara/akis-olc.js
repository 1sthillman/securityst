'use strict';
/**
 * Canlı akış (SSE) doğrulaması.
 * ÖLÇÜLEN HATA (ölçüm betiğinde): /olay hiç bitmez; ilk denemede betik
 * ASILI KALDI ve zaman aşımına uğradı. Doğrusu: ilk veri paketi gelince
 * ölçümü bitirmek.
 */
const http = require('http');
const A = require('C:/syncserver/shared/anahtar.js').ANAHTAR;

function olc(yol) {
  return new Promise((c) => {
    const r = http.request({ host: '127.0.0.1', port: 4545, path: yol }, (res) => {
      let ilk = '';
      let bitti = false;
      const bitir = (not) => {
        if (bitti) return;
        bitti = true;
        try { r.destroy(); } catch (e) {}
        c({ s: res.statusCode, ilk: not });
      };
      res.on('data', (d) => { if (!ilk) { ilk = d.toString('utf8', 0, 70).replace(/\n/g, ' '); bitir(ilk); } });
      res.on('end', () => bitir(ilk || '(bos)'));
    });
    r.on('error', (e) => c({ s: 0, ilk: e.message }));
    r.setTimeout(5000, () => { try { r.destroy(); } catch (e) {} c({ s: 0, ilk: 'zaman asimi' }); });
    r.end();
  });
}

(async () => {
  console.log('=== CANLI AKIS (SSE) — kimlik dogrulamasi ===');
  const senaryolar = [
    ['/olay', 'kimliksiz (kapatilmis olmali)'],
    ['/olay?k=' + encodeURIComponent(A), 'API anahtari ile (acik olmali)'],
    ['/olay?k=yanlis', 'yanlis anahtar (kapatilmis olmali)'],
  ];
  for (const [yol, ad] of senaryolar) {
    const r = await olc(yol);
    console.log('  ' + String(r.s).padEnd(5) + ad.padEnd(36) + r.ilk);
  }
})();
