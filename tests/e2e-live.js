'use strict';
// Canlı uçtan uca: gerçek sunucuyu ayağa kaldır, g-venlik formatında kayıt gönder,
// Excel içeriğini doğrula, /durum al, kapat.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
  const PORT = '4599';
  const child = spawn('node', ['companion.js'], {
    cwd: path.join(__dirname, '..', 'companion'),
    env: { ...process.env, PORT, DATA_DIR: tmp, SYNC_TOKEN: 'e2e-token', CK_KOK_GUVENME: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logged = '';
  child.stdout.on('data', (d) => { logged += d; });
  child.stderr.on('data', (d) => { logged += d; });

  // açılışı bekle
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/saglik`);
      up = r.ok;
    } catch {}
    if (!up) await sleep(200);
  }
  if (!up) { console.log('SUNUCU AÇILMADI:\n' + logged); child.kill(); process.exit(1); }
  console.log('E2E — sunucu ayakta');

  const H = { 'Content-Type': 'application/json', 'X-Sync-Token': 'e2e-token' };
  // g-venlik mkVisit() çıktısı formatında (uid + fmtPlate + ts):
  const rec = {
    uid: 'rmk12345ab', site: 'Çınarköy Sitesi', unit: '12', guard: 'Ahmet Nöbetçi',
    courier: 'Mehmet Kurye', company: '', plate: '34 ABC 123',
    note: 'Kapora bırakıldı', ts: Date.now(), updatedAt: Date.now(), dev: 'dXYZ', deleted: false,
  };
  let r = await fetch(`http://127.0.0.1:${PORT}/kayit`, { method: 'POST', headers: H, body: JSON.stringify(rec) });
  console.log('E2E — POST /kayit:', r.status, JSON.stringify(await r.json()));
  await sleep(800);

  const XLSX = require(path.join(__dirname, '..', 'companion', 'node_modules', 'xlsx'));
  const wb = XLSX.readFile(path.join(tmp, 'kayitlar.xlsx'));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Kayıtlar']);
  console.log('E2E — excel satır sayısı:', rows.length);
  console.log('E2E — excel satırı:', JSON.stringify(rows[0]));

  r = await fetch(`http://127.0.0.1:${PORT}/durum`, { headers: { 'X-Sync-Token': 'e2e-token' } });
  console.log('E2E — /durum:', JSON.stringify(await r.json()));

  const files = fs.readdirSync(tmp);
  console.log('E2E — data dosyaları:', files.join(', '));

  // Panel: dört sayfa + ortak varlıklar
  const sayfalar = ['/', '/kayitlar.html', '/eslesme.html', '/ayar.html'];
  let panelOk = true;
  for (const p of sayfalar) {
    const s = await fetch(`http://127.0.0.1:${PORT}${p}`);
    const t = await s.text();
    const iyi = s.ok && t.includes('Sync') && t.includes('assets/theme.css');
    if (!iyi) panelOk = false;
    console.log(`E2E — panel ${p}: ${s.status} ${iyi ? 'VAR' : 'EKSİK'}`);
  }
  for (const v of ['/assets/theme.css', '/assets/core.js']) {
    const s = await fetch(`http://127.0.0.1:${PORT}${v}`);
    if (!s.ok) panelOk = false;
    console.log(`E2E — varlık ${v}: ${s.status}`);
  }

  r = await fetch(`http://127.0.0.1:${PORT}/kayitlar?limit=5`);
  const lj = await r.json();
  const listOk = r.ok && lj.total === 1 && lj.records[0].plate === '34 ABC 123';
  console.log('E2E — /kayitlar:', listOk ? 'liste + arama API OK' : 'HATA ' + JSON.stringify(lj));

  // Gerçek zamanlı akış: yeni kayıt anında düşmeli
  const ctrl = new AbortController();
  const sse = await fetch(`http://127.0.0.1:${PORT}/olay`, { signal: ctrl.signal });
  const rd = sse.body.getReader();
  const dec = new TextDecoder();
  await rd.read();
  await fetch(`http://127.0.0.1:${PORT}/kayit`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ id: 'e2e-canli', site: 'CANLI', unit: '1', plate: '34 CANLI 1', ts: Date.now() }),
  });
  let sseMetin = '';
  for (let i = 0; i < 12 && !sseMetin.includes('34 CANLI 1'); i++) {
    sseMetin += dec.decode((await rd.read()).value);
  }
  ctrl.abort();
  const canliOk = sseMetin.includes('34 CANLI 1');
  console.log('E2E — gerçek zamanlı akış:', canliOk ? 'yeni kayıt anında düştü' : 'DÜŞMEDİ');

  // Eşleşme: IP değişse de telefon bağlanabilsin diye aday adres listesi sunulmalı
  //   - http adresleri ÖNCE gelmeli: sertifika gerekmiyor, güvenilmeyen
  //     https tarayıcıda korkutucu uyarı sayfası açıp uygulamayı engelliyor.
  //   - kalıcı adres (QR içeriği) ÇÖZÜLEBİLİR olmalı. Ölçülen hata: eski
  //     seçim ÇÖZÜLMEYEN bilgisayar adını seçiyordu, yani QR okutan müşteri
  //     "sunucu bulunamadı" alıyor ve sistemi kullanamıyordu.
  const esl = await (await fetch(`http://127.0.0.1:${PORT}/eslesme`)).json();
  const httpsAdaylar = (esl.adaylar || []).filter((a) => a.startsWith('https://'));
  const httpAdaylar = (esl.adaylar || []).filter((a) => a.startsWith('http://'));
  const ilkHttp = esl.adaylar.findIndex((a) => a.startsWith('http://'));
  const ilkHttps = esl.adaylar.findIndex((a) => a.startsWith('https://'));
  const adaylarOk = Array.isArray(esl.adaylar) && esl.adaylar.length >= 2
    && httpsAdaylar.length >= 1
    && httpAdaylar.length >= 1
    // http ÖNCE (sertifika gerekmiyor, uyarı sayfası olmaz)
    && ilkHttp === 0
    && ilkHttps > ilkHttp
    // https adresleri kendi portunu taşır (http portuyla karışmaz)
    && httpsAdaylar.every((a) => !a.endsWith(':' + PORT))
    && !!esl.bilgisayarAdi
    && !!esl.kaliciAdres
    && esl.kaliciAdres.startsWith('http://')
    // ÇÖZÜLEBİLİR olmalı: IP biçimli. Çözülemeyen adres QR'da işe yaramaz.
    && /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/.test(esl.kaliciAdres)
    && esl.qrSvg.startsWith('<svg')
    && esl.adaylar.includes(esl.kaliciAdres)
    // Sunucu QR içeriğini AÇIKÇA bildirmeli (ölçülebilirlik; tahmin yok)
    && esl.qrAdres === esl.kaliciAdres
    // Sertifika üretilip DOĞRULANMALI (isteğe bağlı canlı önizleme için)
    && !!esl.https && esl.https.aktif === true && esl.https.dogrulandi === true
    && (esl.https.dogrulamaHatalari || []).length === 0
    && !!esl.httpsAdres && esl.httpsAdres.startsWith('https://');
  console.log('E2E — /eslesme:', adaylarOk
    ? `aday listesi OK (${httpsAdaylar.length} https + ${httpAdaylar.length} http, kalıcı: ${esl.kaliciAdres})`
    : 'HATA adaylar=' + JSON.stringify(esl.adaylar)
      + ' https=' + JSON.stringify(esl.https && esl.https.dogrulamaHatalari));

  const pass = rows.length === 1 && rows[0].Plaka === '34 ABC 123' && rows[0].Blok === 'Çınarköy Sitesi'
    && panelOk && listOk && canliOk && adaylarOk;
  console.log(pass ? 'E2E — BAŞARILI' : 'E2E — BAŞARISIZ');
  child.kill();
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('E2E HATA:', e); process.exit(1); });
