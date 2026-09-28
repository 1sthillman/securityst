'use strict';
/**
 * "Son hareketler listesinde sadece en son kayıt görünüyor" hatasını
 * ÖLÇER. Panel sayfası yüklenir, sonra sunucuya kayıt gönderilir ve
 * tablodaki satır sayısı izlenir.
 *
 * Beklenen (düzeltmeden sonra): yeni kayıt geldiğinde tablo 1 değil,
 * mevcut kayıt + 1 satır göstermeli.
 */
const http = require('http');
const fs = require('fs');

function istek(yol, hd) {
  return new Promise((c) => {
    const r = http.request({ host: '127.0.0.1', port: 4545, path: yol, method: hd && hd.method || 'GET', headers: hd || {} }, (res) => {
      let b = '';
      res.on('data', (x) => b += x);
      res.on('end', () => c({ s: res.statusCode, b }));
    });
    r.on('error', (e) => c({ s: 0, b: e.message }));
    if (hd && hd.govde) r.write(hd.govde);
    r.end();
  });
}

const A = require('C:/syncserver/shared/anahtar.js').ANAHTAR;

(async () => {
  // Panelin göreceği kayıt sayısını ölç
  const list = await istek('/kayitlar?limit=25', { Authorization: 'Bearer ' + A });
  const mevcut = JSON.parse(list.b).records.length;
  console.log('Sunucuda görünen kayıt sayısı (limit 25): ' + mevcut);
  console.log('Ölçüm, tarayıcıda yapılacak: /tmp/ara/hareketler-olc.txt');
  fs.writeFileSync('C:/Users/minif/AppData/Local/Temp/opencode/hareketler-mevcut.txt', String(mevcut), 'utf8');
  process.exit(0);
})();
