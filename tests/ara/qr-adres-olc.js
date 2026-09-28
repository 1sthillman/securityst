'use strict';
// Aday sırası ve QR içeriğini ÖLÇER (tahmin değil).
const http = require('http');

http.get({ host: '127.0.0.1', port: 4545, path: '/eslesme' }, (r) => {
  let b = ''; r.on('data', (x) => b += x); r.on('end', () => {
    const j = JSON.parse(b);
    console.log('=== ADAY SIRASI (ölçüldü) ===');
    j.adaylar.forEach((a, i) => console.log('  ' + String(i).padStart(2) + ': ' + a));

    const httpOnce = j.adaylar.filter((a) => a.startsWith('http://'));
    const httpsSonra = j.adaylar.filter((a) => a.startsWith('https://'));
    console.log('');
    console.log('=== KURALLAR ===');
    console.log('  ilk adres http mi          :', j.adaylar[0].startsWith('http://') ? 'EVET' : 'HAYIR', '->', j.adaylar[0]);
    console.log('  tüm http, https\'ten önce mi:', httpOnce.every((a) => j.adaylar.indexOf(a) < j.adaylar.indexOf(httpsSonra[0])) ? 'EVET' : 'HAYIR');
    console.log('  ölü cinarkoy-sync.local var:', j.adaylar.some((a) => a.includes('cinarkoy-sync.local')) ? 'VAR (hata)' : 'YOK (dogru)');
    console.log('  sanal bagdastirici ilk mi :', /192\.168\.56\./.test(j.adaylar[0]) ? 'EVET (hata)' : 'HAYIR (dogru)');

    // QR içeriği: sunucu AÇIKÇA bildiriyor (qrAdres). Tahmin edilmiyor.
    // ÖLÇÜLEN HATA: önceki ölçüm betiği SVG'deki `http://www.w3.org`
    // ad alanını yakalıyordu — yani ölçüm hataydı, kod değil.
    console.log('');
    console.log('=== QR İÇERİĞİ ===');
    const qrAdres = j.qrAdres;
    console.log('  kodlanan adres :', qrAdres);
    console.log('  çözülebilir mi :', /http:\/\/\d+\.\d+\.\d+\.\d+:\d+/.test(qrAdres) ? 'EVET' : 'HAYIR (hata!)');
    console.log('  sertifika şart :', qrAdres.startsWith('https://') ? 'VAR (gereksiz)' : 'YOK (dogru)');
    console.log('  liste içinde mi:', j.adaylar.indexOf(qrAdres) !== -1 ? 'EVET' : 'HAYIR');
    console.log('  kaliciAdres ile aynı:', j.kaliciAdres === qrAdres ? 'EVET' : 'HAYIR');
  });
}).on('error', (e) => { console.error('HATA:', e.message); process.exit(1); });
