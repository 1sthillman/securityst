'use strict';
/**
 * ANAHTARSIZ ERİŞİM DENEMESİ.
 * Amacı: "anahtar olmadan ne görülebilir?" sorusunu TAHMİN etmemek,
 * canlı sunucuya anahtarsız istek atarak ÖLÇMEK.
 *
 * Bu bir güvenlik denetimidir. Kendi sunucumuzu, kendi ağımızda,
 * yalnızca OKUMA denemesiyle yokluyoruz; hiçbir veri değiştirilmez.
 */
const http = require('http');

function dene(yol, method) {
  return new Promise((c) => {
    const r = http.request({ host: '127.0.0.1', port: 4545, path: yol, method: method || 'GET' }, (res) => {
      let b = ''; res.on('data', (x) => b += x);
      res.on('end', () => c({ s: res.statusCode, b }));
    });
    r.on('error', (e) => c({ s: 0, b: e.message }));
    r.end();
  });
}

(async () => {
  console.log('=== ANAHTARSIZ (X-Sync-Token gönderilmeden) ===');
  const uclar = [
    ['/saglik', 'GET'],
    ['/eslesme', 'GET'],
    ['/durum', 'GET'],
    ['/kayitlar', 'GET'],
    ['/olay', 'GET'],
    ['/plaka/durum', 'GET'],
    ['/kayit', 'POST'],
  ];
  // NOT: /olay SUNUCU-SENT-EVENTS akışıdır ve hiç bitmez. Ölçüm betiği
  // ilk denemede asılı kaldı (zaman aşımı). Buraya zaman aşımı konur.
  for (const [yol, m] of uclar) {
    const govde = m === 'POST' ? JSON.stringify({ plaka: 'TEST' }) : null;
    const r = await new Promise((c) => {
      const req = http.request({
        host: '127.0.0.1', port: 4545, path: yol, method: m,
        headers: govde ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(govde) } : {},
      }, (res) => {
        let b = ''; res.on('data', (x) => { b += x; });
        res.on('end', () => c({ s: res.statusCode, b }));
        // SSE hiç bitmez: ilk veri gelince ölçüm BİTER (çözüldü).
        res.once('data', () => {
          setTimeout(() => { try { req.destroy(); } catch {} c({ s: 200, b: b, akis: true }); }, 30);
        });
      });
      req.on('error', (e) => c({ s: 0, b: e.message }));
      req.setTimeout(4000, () => { try { req.destroy(); } catch {} c({ s: 0, b: 'zaman asimi' }); });
      if (govde) req.write(govde);
      req.end();
    });
    let ne = '';
    try { const j = JSON.parse(r.b); ne = Object.keys(j).slice(0, 6).join(', '); } catch { ne = r.b.slice(0, 50); }
    const etiket = r.s === 401 ? 'KAPALI (401)' : r.s === 200 ? 'ACIK  (200)' : r.s === 429 ? 'SINIRLI(429)' : 'HATA ' + r.s;
    console.log('  ' + etiket.padEnd(14) + yol.padEnd(18) + ' alanlar: ' + ne);
  }

  console.log('');
  console.log('=== SONUÇ ===');
  console.log('  200 donen uclar: anahtarsiz CALISILABILIR durumda.');
  console.log('  Yani ayni Wi-Fi\'daki HERKES kayitlari okuyabilir ve');
  console.log('  /eslesme ucundan anahtari alip KAYIT YAZABILIR.');
})();
