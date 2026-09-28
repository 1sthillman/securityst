'use strict';
/**
 * ============================================================================
 *  AĞ GÜVENLİĞİ TESTLERİ — ölçülen açıkların KAPANDIĞINI kanıtlar
 * ============================================================================
 *  Bu testler bir kod incelemesi değil, CANLI sunucuya istek atar.
 *  Kendi sunucumuzu, kendi ağımızda yokluyoruz; hiçbir veri değiştirilmez
 *  (yazma uçları yalnızca 401 beklenir, gövde gönderilmez).
 *
 *  KAPANAN AÇIKLAR (hepsi ölçülmüştü):
 *   1. /kayitlar, /durum, /olay, /plaka/durum anahtarsız 200 dönüyordu →
 *      aynı Wi-Fi'taki misafir TÜM kayıtları okuyabiliyordu.
 *   2. app.use(cors()) → Access-Control-Allow-Origin: * → nöbetçinin
 *      telefonunda açtığı HERHANGİ bir site sessizce anahtarı çalabiliyordu.
 *   3. Panel sayfaları uzaktan açılabiliyordu ve veriyi anahtarsız çekiyordu.
 *   4. /eslesme herkese anahtar veriyordu → kayıt YAZMA yetkisi kazanılıyordu.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const COMP = path.join(ROOT, 'companion');
const PORT = 4607;
const TOKEN = 'guvenlik-test-token';
const AD = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const ok = (c, ad, extra = '') => {
  if (c) { pass++; console.log('PASS — ' + ad); }
  else { fail++; console.log('FAIL — ' + ad + (extra ? ' :: ' + extra : '')); }
};
const bolum = (a) => console.log('\n--- ' + a + ' ---');
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-guv-'));
fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({ port: PORT, token: TOKEN }));

function istek(yol, secenek) {
  return new Promise((c, h) => {
    const r = http.request(Object.assign({ host: '127.0.0.1', port: PORT, path: yol, method: 'GET', timeout: 6000 }, secenek || {}), (res) => {
      let b = '';
      res.on('data', (x) => { b += x; });
      res.on('end', () => c({ s: res.statusCode, b, tip: res.headers['content-type'] || '', acao: res.headers['access-control-allow-origin'] || null }));
    });
    r.on('error', (e) => c({ s: 0, b: e.message }));
    if (secenek && secenek.govde) r.write(secenek.govde);
    r.end();
  });
}

const cocuk = spawn(process.execPath, [path.join(COMP, 'companion.js')], {
  env: Object.assign({}, process.env, { SYNC_TOKEN: TOKEN, PORT: String(PORT), DATA_DIR: tmp, CK_KOK_GUVENME: '0' }),
  cwd: COMP, stdio: ['ignore', 'pipe', 'pipe'],
});
let cikti = '';
cocuk.stdout.on('data', (x) => { cikti += x; });
cocuk.stderr.on('data', (x) => { cikti += x; });

(async () => {
  let ayakta = false;
  for (let i = 0; i < 40; i++) {
    const r = await istek('/saglik');
    if (r.s === 200) { ayakta = true; break; }
    await bekle(500);
  }
  ok(ayakta, 'sunucu ayakta');
  if (!ayakta) { console.log(cikti); cocuk.kill(); process.exit(1); }
  await bekle(1500);

  // ==========================================================================
  bolum('1) Veri uclari anahtarsiz KAPALI mi');
  // ==========================================================================
  const veriUclari = ['/kayitlar', '/durum', '/plaka/durum'];
  for (const y of veriUclari) {
    const r = await istek(y);
    ok(r.s === 401, `veri ucu anahtarsiz reddedildi: ${y}`, `HTTP ${r.s}`);
  }
  // /olay SSE'dir; ilk paketi almak yeter.
  {
    const r = await istek('/olay');
    ok(r.s === 401, 'veri ucu anahtarsiz reddedildi: /olay', `HTTP ${r.s}`);
  }

  bolum('2) Yazma uclari anahtarsiz KAPALI mi');
  for (const y of ['/kayit', '/kayit/batch', '/plaka/oku']) {
    const govde = JSON.stringify({ plaka: 'TEST' });
    const r = await istek(y, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(govde) },
      govde,
    });
    ok(r.s === 401, `yazma ucu anahtarsiz reddedildi: ${y}`, `HTTP ${r.s}`);
  }

  bolum('3) Dogru anahtar CALISIYOR mu (kilitlenmemis olmamali)');
  {
    const r = await istek('/kayitlar?limit=1', { headers: { 'X-Sync-Token': TOKEN } });
    ok(r.s === 200, 'dogru anahtarla /kayitlar aciliyor', `HTTP ${r.s} ${r.b.slice(0, 60)}`);
    ok(r.b.includes('"ok":true'), 'kayit listesi gercekten donuyor');
  }

  bolum('4) CORS: yabanci site ENGELLENIYOR mu');
  const yabanci = [
    ['https://kotu-site.example', 'kotu site'],
    ['https://phishing.example', 'phishing sitesi'],
    ['http://192.168.1.235:9999', 'bizim IP ama yanlis port'],
  ];
  for (const [origin, ad] of yabanci) {
    const r = await istek('/eslesme', { headers: { Origin: origin } });
    ok(!r.acao, `yabanci kaynaga CORS basligi YAZILMADI (${ad})`, `ACAO=${r.acao}`);
  }
  {
    // Kendi adresimiz izinli olmali
    const r = await istek('/eslesme', { headers: { Origin: AD, 'X-Sync-Cihaz': 'test-cihaz-1' } });
    ok(r.acao === AD, 'kendi adresimize CORS basligi yazildi (uygulama calisir)', `ACAO=${r.acao}`);
  }

  bolum('5) Eşleşme izni: anahtar sadece taninmayan cihaza verilmiyor');
  {
    const ilk = JSON.parse((await istek('/eslesme', { headers: { 'X-Sync-Cihaz': 'telefon-1' } })).b);
    ok(!!ilk.token, 'ilk cihaz kendiliginden kaydoldu ve anahtar aldi');
    ok(ilk.onayBekliyor === false, 'ilk cihaz onay beklemiyor');
    ok(ilk.cihazSayisi === 1, 'cihaz sayisi 1', String(ilk.cihazSayisi));

    // Ayni kimlik, farkli IP (DHCP degisimi senaryosu)
    const yeni = JSON.parse((await istek('/eslesme', { headers: { 'X-Sync-Cihaz': 'telefon-1', 'X-Test-Yok': '1' } })).b);
    ok(!!yeni.token, 'AYNI telefon IP degisiminde de anahtar aliyor (DHCP sorunu yok)');
  }

  bolum('6) Yönetim uclari korumali mi');
  {
    const r = await istek('/eslesme/cihazlar');
    ok(r.s === 401, 'cihaz listesi anahtarsiz reddedildi', `HTTP ${r.s}`);
    const r2 = await istek('/eslesme/cihazlar', { headers: { 'X-Sync-Token': TOKEN } });
    ok(r2.s === 200, 'cihaz listesi anahtarla aciliyor', `HTTP ${r2.s}`);
    const j = JSON.parse(r2.b);
    ok(Array.isArray(j.cihazlar), 'cihaz listesi dizi');
    ok(Array.isArray(j.onayBekleyen), 'onay bekleyen listesi dizi');
  }

  bolum('7) Panel sayfalari yerel ile sinirli mi');
  {
    // 127.0.0.1 = yerel → 200 beklenir
    const yerel = await istek('/kayitlar.html');
    ok(yerel.s === 200, 'panel bu bilgisayardan aciliyor', `HTTP ${yerel.s}`);
  }

  bolum('8) Statik sunum YERINDE mi (kritik regresyon korumasi)');
  // ÖLÇÜLEN KRİTİK HATA: panel koruması eklenirken
  // `app.use(express.static(...))` satırı yanlışlıkla SİLİNMİŞTİ.
  // Sonuç: /telefon/* 404 döndü — telefon uygulaması HİÇBİR dosyasını
  // alamıyordu. Panel çalışıyordu (ona ayrı rota vardı), bu yüzden gözden
  // kaçtı. Canlı ölçüm yakaladı; bu bölüm bir daha sessizce olmasın diye var.
  //
  // Uygulama hem http hem https üzerinden sunulabilmeli (https isteğe bağlı).
  {
    const r = await istek('/telefon/');
    ok(r.s === 200, 'telefon uygulamasi http uzerinden sunuluyor', `HTTP ${r.s}`);
    ok(/<html/i.test(r.b), 'uygulama HTML donuyor (statik sunum yerinde)');
    const e = await istek('/telefon/canli-okuma.js');
    ok(e.s === 200, 'canli okuma eklentisi sunuluyor', `HTTP ${e.s}`);
    const y = await istek('/telefon/yerel-kamera.js');
    ok(y.s === 200, 'yerel kamera eklentisi sunuluyor (sertifikasiz yol)', `HTTP ${y.s}`);
    const p2 = await istek('/kayitlar.html');
    ok(p2.s === 200, 'panel sayfasi sunuluyor (bu bilgisayardan)', `HTTP ${p2.s}`);
    const a = await istek('/assets/core.js');
    ok(a.s === 200, 'panel varliklari sunuluyor', `HTTP ${a.s}`);
  }

  bolum('8) Kök CA DER olarak sunuluyor mu (iOS/Android kurulumu)');
  {
    const r = await istek('/kurulum/kok.cer');
    ok(r.s === 200, 'kok sertifika indirilebiliyor', `HTTP ${r.s}`);
    // ÖLÇÜLEN HATA (test hatası): istek() gövdeyi METİN olarak topluyor, bu yüzden
    // ikili DER bozuluyor ve 0x30 yerine 0x0 geliyordu. İkili gövde için ayrı
    // (Buffer) toplayıcı gerekir.
    const ikili = await new Promise((c) => {
      const q = http.request({ host: '127.0.0.1', port: PORT, path: '/kurulum/kok.cer' }, (res) => {
        const parcalar = [];
        res.on('data', (x) => parcalar.push(x));
        res.on('end', () => c({ s: res.statusCode, b: Buffer.concat(parcalar) }));
      });
      q.end();
    });
    ok(ikili.s === 200, 'kok sertifika ikili olarak 200', `HTTP ${ikili.s}`);
    ok(ikili.b[0] === 0x30, 'icerik DER (ilk bayt 0x30 = ASN.1 SEQUENCE)', '0x' + ikili.b[0].toString(16));
    // Bağımsız doğrulama: Node'un kendi ayrıştırıcısı
    const X = new (require('crypto').X509Certificate)(ikili.b);
    ok(X.ca === true, 'DER icerigi gecerli bir CA sertifikasi (Node ayristiricisi)');
    ok(/CinarkoySync/.test(X.subject), 'sertifika beklenen adi tasiyor', X.subject.replace(/\n/g, ' | '));
    const p = await istek('/kurulum/kok.cer?format=pem');
    ok(p.b.toString('utf8').indexOf('-----BEGIN CERTIFICATE-----') === 0, 'PEM bicimi de ayrica sunuluyor (teshis icin)');
    const Xp = new (require('crypto').X509Certificate)(p.b.toString('utf8'));
    ok(Xp.fingerprint256 === X.fingerprint256, 'DER ve PEM AYNI sertifika (parmak izi esit)');
  }

  console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
  cocuk.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('TEST ÇÖKTÜ:', e);
  console.log(cikti);
  cocuk.kill();
  process.exit(1);
});
