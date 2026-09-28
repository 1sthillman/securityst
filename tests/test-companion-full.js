'use strict';
// Derin kenar-durum süiti: doğrulama, batch kısmî hata, auth, Excel içeriği,
// bozuk log/seen-ids, restart self-heal, sıralama, .tmp artığı.
// Çalıştır: node ../tests/test-companion-full.js  (companion klasöründen)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const XLSX = require(path.join(__dirname, '..', 'companion', 'node_modules', 'xlsx'));

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`PASS — ${name}`); }
  else { fail++; console.log(`FAIL — ${name}${extra ? ' :: ' + extra : ''}`); }
}

const uid = (n) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, '0')}`;
const baseRec = (n, extra = {}) => ({
  id: uid(n), site: 'A', unit: '12', courier: 'Ali', company: '',
  plate: '34 TST ' + n, guard: 'G', note: '', date: '27.09.2026', time: '12:00', ts: 1000 + n,
  ...extra,
});

function startServer(port, dataDir, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['companion.js'], {
      cwd: path.join(__dirname, '..', 'companion'),
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SYNC_TOKEN: 'full-token', CK_KOK_GUVENME: '0', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const t0 = Date.now();
    const poll = async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/saglik`);
        if (r.ok) return resolve({ child, out: () => out });
      } catch {}
      if (Date.now() - t0 > 10000) {
        child.kill();
        reject(new Error('sunucu açılmadı: ' + out));
      } else setTimeout(poll, 150);
    };
    poll();
  });
}
const stop = (h) => new Promise((r) => { h.child.kill(); setTimeout(r, 500); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'full-'));
  const PORT = 4571;
  const H = { 'Content-Type': 'application/json', 'X-Sync-Token': 'full-token' };
  const base = `http://127.0.0.1:${PORT}`;

// Sunucu 29. satırda SYNC_TOKEN ile başlatılıyor. Veri uçları artık anahtar
// istiyor (ölçülen açık kapatıldı) ve bu testler doğru davranışı savunuyor.
const TOKEN = 'full-token';

  let h = await startServer(PORT, tmp);

  // --- 1. sağlık şekli ---
  let r = await fetch(base + '/saglik');
  let j = await r.json();
  ok(r.ok && j.ok === true && typeof j.kayitSayisi === 'number' && typeof j.zaman === 'string', 'saglik şeması');

  // --- 2. 404 JSON ---
  r = await fetch(base + '/yok-boyle');
  j = await r.json().catch(() => null);
  ok(r.status === 404 && j && j.ok === false, 'bilinmeyen route 404 JSON');

  // --- 3. CORS ---
  // ÖLÇÜLEN HATA: app.use(cors()) her Origin'e `Access-Control-Allow-Origin: *`
  // yazıyordu. Böylece nöbetçinin telefonunda açtığı HERHANGİ bir internet
  // sitesi, tarayıcı üzerinden özel IP'ye istek atıp yanıtı okuyabiliyordu.
  // Artık yalnızca kendi adreslerimize başlık yazılır.
  r = await fetch(base + '/saglik', { headers: { Origin: 'https://kotu-site.example' } });
  ok(r.headers.get('access-control-allow-origin') === null,
    'yabancı siteye CORS başlığı YAZILMIYOR (sızıntı kapalı)');
  r = await fetch(base + '/kayit', {
    method: 'OPTIONS',
    headers: { Origin: 'https://kotu-site.example', 'Access-Control-Request-Method': 'POST' },
  });
  ok(r.status !== 204 && !r.ok, 'yabancı site preflight (OPTIONS) reddedildi', `HTTP ${r.status}`);
  r = await fetch(base + '/panelde-olmayan-sey');
  j = await r.json().catch(() => null);
  ok(r.status === 404 && j && j.ok === false, 'statik dışı 404 JSON (panel geçişi)');

  // --- 4. bozuk JSON ---
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: '{bozuk json' });
  j = await r.json().catch(() => null);
  ok(r.status === 400 && j && j.ok === false, 'bozuk JSON 400 JSON');

  // --- 4b. 1MB üstü gövde → 413 JSON (HTML değil) ---
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify({ id: uid(9151), plate: 'X', note: 'n'.repeat(2 * 1024 * 1024) }) });
  j = await r.json().catch(() => null);
  ok(r.status === 413 && j && j.ok === false, '1MB üstü gövde 413 JSON');

  // --- 4c. özel anahtar id: '__proto__' sorunsuz saklanır + dedup çalışır ---
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify({ id: '__proto__', plate: '34 P 1' }) });
  ok(r.ok, "'__proto__' id kabul edilir");
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify({ id: '__proto__', plate: '34 P 1' }) });
  j = await r.json();
  ok(r.ok && j.duplicate === true, "'__proto__' dedup çalışır");

  // --- 5/6. null + dizi gövde ---
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: 'null' });
  ok(r.status === 400, 'null gövde 400');
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: '[]' });
  ok(r.status === 400, 'dizi gövde 400');

  // --- 7-10. doğrulama sınırları ---
  const cases = [
    [{ plate: 'X' }, 'id yok 400'],
    [{ id: uid(9001) }, 'plaka yok 400'],
    [{ id: 'kısa', plate: 'X' }, 'kısa id 400'],
    [{ id: 'x'.repeat(129), plate: 'X' }, 'uzun id 400'],
    [baseRec(9101, { plate: 'x'.repeat(33) }), 'plaka 33 karakter 400'],
    [baseRec(9102, { note: 'n'.repeat(501) }), 'not 501 karakter 400'],
    [baseRec(9103, { guard: 123 }), 'sayısal guard 400'],
    [baseRec(9104, { site: 's'.repeat(201) }), 'site 201 karakter 400'],
  ];
  for (const [body, name] of cases) {
    r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify(body) });
    ok(r.status === 400, name);
  }

  // --- 11. plaka normalizasyonu (trim + büyük harf) ---
  const norm = baseRec(9201, { plate: '  34 abc 123  ' });
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify(norm) });
  ok(r.ok, 'normalizasyon kaydı yazıldı');
  await sleep(600);
  const logRaw = fs.readFileSync(path.join(tmp, 'kayitlar.jsonl'), 'utf8');
  ok(logRaw.includes('"plate":"34 ABC 123"'), 'plaka trim+uppercase jsonl');

  // --- 12/13. Türkçe karakter + Excel başlık sırası ---
  const tr = baseRec(9202, { site: 'Çınarköy Ş Blok', unit: 'ĞÜŞÖÇ', courier: 'Işıklı ğüşiöç', company: 'Şirket İ', plate: '34 IŞIK 1', guard: 'Nöbetçi', note: 'çalışıyor — ✓' });
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify(tr) });
  ok(r.ok, 'Türkçe kayıt yazıldı');
  await sleep(600);
  const wb = XLSX.readFile(path.join(tmp, 'kayitlar.xlsx'));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  ok(JSON.stringify(rows[0]) === JSON.stringify(['Blok', 'Daire', 'Kurye', 'Firma', 'Plaka', 'Görevli', 'Not', 'Tarih', 'Saat']), 'Excel başlık sırası', JSON.stringify(rows[0]));
  const trRow = rows.find((x) => x[4] === '34 IŞIK 1');
  ok(!!trRow && trRow[0] === 'Çınarköy Ş Blok' && trRow[2] === 'Işıklı ğüşiöç', 'Türkçe hücreler birebir');

  // --- 14. batch sınırları ---
  r = await fetch(base + '/kayit/batch', { method: 'POST', headers: H, body: JSON.stringify({ records: 'x' }) });
  ok(r.status === 400, 'batch non-array 400');
  r = await fetch(base + '/kayit/batch', { method: 'POST', headers: H, body: JSON.stringify({ records: new Array(501).fill(baseRec(9300)) }) });
  ok(r.status === 400, 'batch 501 kayıt 400');
  r = await fetch(base + '/kayit/batch', { method: 'POST', headers: H, body: JSON.stringify({ records: [] }) });
  j = await r.json();
  ok(r.ok && j.saved === 0 && j.duplicates === 0 && j.errors.length === 0, 'boş batch 200 sıfır');

  // --- 15. batch kısmî hata ---
  const good1 = baseRec(9401, { plate: 'BATCH 1' });
  const bad = { id: uid(9402) }; // plakasız
  const dup = { ...good1 };      // aynı id
  const good2 = baseRec(9403, { plate: 'BATCH 2' });
  r = await fetch(base + '/kayit/batch', { method: 'POST', headers: H, body: JSON.stringify({ records: [good1, bad, dup, good2] }) });
  j = await r.json();
  ok(r.ok && j.saved === 2 && j.duplicates === 1 && j.errors.length === 1 && j.errors[0].index === 1, 'batch kısmî: 2 saved 1 dup 1 err', JSON.stringify(j));

  // --- 16. batch içi çift id ---
  const same = baseRec(9501, { plate: 'AYNI' });
  r = await fetch(base + '/kayit/batch', { method: 'POST', headers: H, body: JSON.stringify({ records: [same, { ...same }] }) });
  j = await r.json();
  ok(r.ok && j.saved === 1 && j.duplicates === 1, 'batch içi aynı id 1+1');

  // --- 17/18. /durum (panel açık) + batch auth ---
  r = await fetch(base + '/durum');
  ok(r.status === 401, '/durum anahtarsız REDDEDİLDİ (veri sızıntısı kapatıldı)', `HTTP ${r.status}`);
  r = await fetch(base + '/durum', { headers: { 'X-Sync-Token': TOKEN } });
  ok(r.status === 200, '/durum anahtarla açılır');
  j = await r.json();
  ok(r.ok && typeof j.kayitSayisi === 'number' && typeof j.kuyruk === 'number'
    && typeof j.excelBytes === 'number' && typeof j.logBytes === 'number', '/durum şeması');
  r = await fetch(base + '/kayit/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok(r.status === 401, 'batch tokensiz 401');

  // --- 19. .tmp artığı yok ---
  await sleep(500);
  ok(!fs.existsSync(path.join(tmp, 'kayitlar.xlsx.tmp')) && !fs.existsSync(path.join(tmp, 'seen-ids.json.tmp')), '.tmp artığı yok');

  // --- 20. bozuk jsonl satırı atlanır, log korunur, excel etkilenmez ---
  const beforeRows = XLSX.utils.sheet_to_json(XLSX.readFile(path.join(tmp, 'kayitlar.xlsx')).Sheets['Kayıtlar']).length;
  fs.appendFileSync(path.join(tmp, 'kayitlar.jsonl'), 'BU SATIR BOZUK {{{{\n', 'utf8');
  const afterCorrupt = baseRec(9601, { plate: 'BOZUK SONRASI' });
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify(afterCorrupt) });
  ok(r.ok, 'bozuk satır sonrası yazma çalışır');
  await sleep(600);
  const wb2 = XLSX.readFile(path.join(tmp, 'kayitlar.xlsx'));
  const n2 = XLSX.utils.sheet_to_json(wb2.Sheets['Kayıtlar']).length;
  const logKept = fs.readFileSync(path.join(tmp, 'kayitlar.jsonl'), 'utf8').includes('BU SATIR BOZUK');
  ok(n2 === beforeRows + 1, `bozuk satır excel'e girmedi (${beforeRows}→${n2})`);
  ok(logKept, 'bozuk satır logda korundu (denetlenebilir)');

  // --- 21. seen-ids geçerli ve id'yi içeriyor ---
  await sleep(400);
  let seenOk = false;
  try {
    const arr = JSON.parse(fs.readFileSync(path.join(tmp, 'seen-ids.json'), 'utf8'));
    seenOk = Array.isArray(arr) && arr.includes(uid(9401));
  } catch {}
  ok(seenOk, 'seen-ids.json geçerli + id içeriyor');

  // --- 21b. g-venlik uyumu: uid anahtarı, firma, dev, deleted ---
  const uidRec = { uid: uid(9801), site: 'B', unit: '5', courier: 'Mehmet', firma: 'YemekCo', plate: '34 U 1', guard: 'N', ts: 2000 };
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify(uidRec) });
  ok(r.ok, 'uid alanıyla kayıt kabul edilir');
  // çapraz anahtar dedup: aynı değer `id` ile gelirse duplicate
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify({ id: uid(9801), plate: '34 U 1' }) });
  j = await r.json();
  ok(r.ok && j.duplicate === true, 'uid/id çapraz dedup');
  await sleep(600);
  let wbU = XLSX.readFile(path.join(tmp, 'kayitlar.xlsx'));
  let rowsU = XLSX.utils.sheet_to_json(wbU.Sheets['Kayıtlar']);
  const uRow = rowsU.find((x) => x.Plaka === '34 U 1');
  ok(!!uRow && uRow.Firma === 'YemekCo', 'firma alanı Excel Firma sütununa düşer');
  // ts'den Tarih/Saat türetme (g-venlik export'uyla aynı kural)
  const tsRec = { uid: uid(9802), plate: '34 TS 1', ts: new Date('2026-09-27T14:03:00').getTime() };
  await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify(tsRec) });
  await sleep(600);
  wbU = XLSX.readFile(path.join(tmp, 'kayitlar.xlsx'));
  rowsU = XLSX.utils.sheet_to_json(wbU.Sheets['Kayıtlar']);
  const tsRow = rowsU.find((x) => x.Plaka === '34 TS 1');
  const expDate = new Date(tsRec.ts).toLocaleDateString('tr-TR');
  ok(!!tsRow && tsRow.Tarih === expDate && /^\d{2}:\d{2}$/.test(tsRow.Saat), 'Tarih/Saat ts üzerinden tr-TR türetilir', JSON.stringify(tsRow));
  // deleted: log'a girer, Excel'e girmez
  const nBeforeDel = rowsU.length;
  const delRec = { uid: uid(9803), plate: '34 SIL 1', ts: 3000, deleted: true };
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify(delRec) });
  ok(r.ok, 'deleted kayıt kabul edilir');
  await sleep(600);
  wbU = XLSX.readFile(path.join(tmp, 'kayitlar.xlsx'));
  rowsU = XLSX.utils.sheet_to_json(wbU.Sheets['Kayıtlar']);
  const logHasDel = fs.readFileSync(path.join(tmp, 'kayitlar.jsonl'), 'utf8').includes(uid(9803));
  ok(rowsU.length === nBeforeDel && !rowsU.find((x) => x.Plaka === '34 SIL 1'), 'deleted Excel dışında tutulur');
  ok(logHasDel, 'deleted logda denetim için korunur');

  // --- 21c. panel API: /kayitlar + /durum ek alanlar ---
  const TH = { 'X-Sync-Token': 'full-token' };
  r = await fetch(base + '/kayitlar?limit=2', { headers: TH });
  j = await r.json();
  ok(r.ok && j.records.length === 2 && j.total >= 2 && typeof j.total === 'number', '/kayitlar limit+total');
  r = await fetch(base + '/kayitlar');
  ok(r.status === 401, '/kayitlar anahtarsız REDDEDİLDİ (plaka/isim sızıntısı kapatıldı)', `HTTP ${r.status}`);
  r = await fetch(base + '/kayitlar', { headers: { 'X-Sync-Token': TOKEN } });
  ok(r.status === 200, '/kayitlar anahtarla açılır');
  // Eşleşme bilgisi: adres + token + çevrimdışı QR
  r = await fetch(base + '/eslesme');
  const esl = await r.json();
  ok(r.ok && esl.ok === true, '/eslesme herkese açık (panel QR için)');
  ok(Array.isArray(esl.adresler) && typeof esl.token === 'string' && esl.token.length > 0, '/eslesme adres + token döner');
  ok(typeof esl.qrSvg === 'string' && esl.qrSvg.startsWith('<svg') && esl.qrSvg.includes('</svg>'), '/eslesme QR SVG üretir (çevrimdışı)');

  // --- 21f. gerçek zamanlı akış (SSE): kayıt düşer ---
  // Ölçülen açık: /olay anahtarsız 200 dönüyordu ve canlı kayıt akışını
  // (plaka/isim) herkese açıktı. Artık anahtar istiyor.
  const sseKontrol = await fetch(base + '/olay', { headers: { Accept: 'text/event-stream' } });
  ok(sseKontrol.status === 401, '/olay anahtarsız REDDEDİLDİ (canlı akış sızıntısı kapatıldı)', `HTTP ${sseKontrol.status}`);
  const sseOku = (await fetch(base + '/olay', {
    headers: { Accept: 'text/event-stream', 'X-Sync-Token': TOKEN },
  })).body.getReader();
  const ilkYaz = await sseOku.read();
  const ilkParca = new TextDecoder().decode(ilkYaz.value);
  ok(ilkParca.includes('event: durum'), 'SSE akışı açılır ve durum gönderir');
  const sseKayit = new Promise((resolve) => {
    (async () => {
      const oku = (async () => {
        for (;;) {
          const { value, done } = await sseOku.read();
          if (done) return;
          const t = new TextDecoder().decode(value);
          if (t.includes('event: kayit')) return resolve(t);
        }
      })().catch(() => {});
    })();
  });
  await fetch(base + '/kayit', {
    method: 'POST', headers: H,
    body: JSON.stringify({ id: uid(9910), site: 'SSE', unit: '1', plate: '34 SSE 1', ts: 9000 }),
  });
  const sseMetin = await Promise.race([sseKayit, new Promise((r) => setTimeout(() => r(''), 4000))]);
  ok(sseMetin.includes('34 SSE 1'), 'SSE yeni kaydı anında yayar', sseMetin.slice(0, 80));
  await sseOku.cancel().catch(() => {});

  const firstIds = j.records.map((x) => x.id);
  r = await fetch(base + '/kayitlar?limit=2&offset=2', { headers: TH });
  j = await r.json();
  ok(r.ok && j.records.length === 2 && !j.records.some((x) => firstIds.includes(x.id)), '/kayitlar offset sayfalar');
  r = await fetch(base + '/kayitlar?q=batch 1', { headers: TH });
  j = await r.json();
  ok(r.ok && j.total >= 1 && j.records.every((x) => JSON.stringify(x).toLocaleLowerCase('tr-TR').includes('batch 1')), '/kayitlar arama (TR duyarsız)');
  r = await fetch(base + '/kayitlar?limit=200', { headers: TH });
  j = await r.json();
  const delRow = j.records.find((x) => x.id === uid(9803));
  ok(!!delRow && delRow.deleted === true, '/kayitlar silinmişi bayrağıyla döner');
  ok(j.records[0].ts >= j.records[1].ts, '/kayitlar yeniden eskiye sıralı');
  r = await fetch(base + '/durum', { headers: TH });
  j = await r.json();
  ok(Array.isArray(j.adresler) && typeof j.uptimeSn === 'number' && typeof j.surum === 'string', '/durum adres+uptime+surum');

  // --- 21d. upsert: düzenleme yayılır, eski retry yutulur ---
  const editBase = { uid: uid(9811), site: 'E', unit: '9', courier: 'Veli', company: 'Eski', plate: '34 UP 1', guard: 'G', ts: 5000, updatedAt: 100 };
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify(editBase) });
  ok(r.ok && (await r.json()).updated !== true, 'ilk yazı ok');
  await sleep(500);
  // düzenleme: daha yeni updatedAt + değişen firma
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify({ ...editBase, company: 'Yeni', updatedAt: 200 }) });
  j = await r.json();
  ok(r.ok && j.updated === true, 'düzenleme updated:true döner');
  await sleep(500);
  wbU = XLSX.readFile(path.join(tmp, 'kayitlar.xlsx'));
  rowsU = XLSX.utils.sheet_to_json(wbU.Sheets['Kayıtlar']);
  const upRow = rowsU.filter((x) => x.Plaka === '34 UP 1');
  ok(upRow.length === 1 && upRow[0].Firma === 'Yeni', 'Excel tek satır + güncel firma');
  // eski retry: updatedAt geride → duplicate, excel bozulmaz
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify({ ...editBase, company: 'ÇokEski', updatedAt: 50 }) });
  j = await r.json();
  ok(r.ok && j.duplicate === true, 'eski retry duplicate yutulur');
  await sleep(400);
  wbU = XLSX.readFile(path.join(tmp, 'kayitlar.xlsx'));
  rowsU = XLSX.utils.sheet_to_json(wbU.Sheets['Kayıtlar']);
  ok(rowsU.filter((x) => x.Plaka === '34 UP 1')[0].Firma === 'Yeni', 'eski retry Excel bozmaz');
  // batch karışık: yeni + güncelleme + duplicate + hatalı
  const batchMix = [
    baseRec(9812, { plate: 'BATCH U1', ts: 6000 }),
    { ...editBase, company: 'BatchYeni', updatedAt: 300 },
    { ...editBase, company: 'Stale', updatedAt: 10 },
    { id: uid(9813) },
  ];
  r = await fetch(base + '/kayit/batch', { method: 'POST', headers: H, body: JSON.stringify({ records: batchMix }) });
  j = await r.json();
  ok(r.ok && j.saved === 1 && j.updated === 1 && j.duplicates === 1 && j.errors.length === 1, 'batch: 1 yeni + 1 güncelleme + 1 dup + 1 hata', JSON.stringify(j));
  // /durum güncelleme sayacı
  r = await fetch(base + '/durum', { headers: { 'X-Sync-Token': 'full-token' } });
  j = await r.json();
  ok(typeof j.guncelleme === 'number' && j.guncelleme >= 2, '/durum güncelleme sayacı');

  // --- 24. ts sıralaması (tersten gönder, excel artan sıralasın) ---
  const late = baseRec(9701, { plate: 'SIRA A', ts: 500 });
  const early = baseRec(9702, { plate: 'SIRA B', ts: 100 });
  await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify(late) });
  await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify(early) });
  await sleep(600);
  const wb3 = XLSX.readFile(path.join(tmp, 'kayitlar.xlsx'));
  const all3 = XLSX.utils.sheet_to_json(wb3.Sheets['Kayıtlar']);
  const ia = all3.findIndex((x) => x.Plaka === 'SIRA A');
  const ib = all3.findIndex((x) => x.Plaka === 'SIRA B');
  ok(ib !== -1 && ia !== -1 && ib < ia, 'excel ts artan sıralı');

  // --- 22. RESTART HEAL: xlsx sil + seen-ids boz, yeniden başlat ---
  const countBefore = (await (await fetch(base + '/saglik')).json()).kayitSayisi;
  await stop(h);
  fs.unlinkSync(path.join(tmp, 'kayitlar.xlsx'));
  fs.writeFileSync(path.join(tmp, 'kayitlar.xlsx.tmp'), 'yarım-artık', 'utf8');
  fs.writeFileSync(path.join(tmp, 'seen-ids.json'), '{{{bozuk', 'utf8');
  h = await startServer(PORT, tmp);
  const jAfter = await (await fetch(base + '/saglik')).json();
  ok(jAfter.kayitSayisi === countBefore, `restart: sayaç log'dan kurtarıldı (${countBefore})`, String(jAfter.kayitSayisi));
  ok(fs.existsSync(path.join(tmp, 'kayitlar.xlsx')), 'restart: xlsx yeniden üretildi');
  ok(!fs.existsSync(path.join(tmp, 'kayitlar.xlsx.tmp')), 'restart: stale .tmp temizlendi');
  const wb4 = XLSX.readFile(path.join(tmp, 'kayitlar.xlsx'));
  const n4 = XLSX.utils.sheet_to_json(wb4.Sheets['Kayıtlar']).length;
  ok(n4 === all3.length, `restart: excel satır sayısı korundu (${all3.length})`, String(n4));
  // bozuk seen-ids yedeği alındı mı?
  const leftovers = fs.readdirSync(tmp).filter((f) => f.startsWith('seen-ids.json.bozuk-'));
  ok(leftovers.length >= 1, 'bozuk seen-ids yedeğe alındı');
  // heal sonrası duplicate koruması hâlâ çalışıyor mu?
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify(good1) });
  j = await r.json();
  ok(r.ok && j.duplicate === true, 'heal sonrası dedup çalışıyor');

  await stop(h);
  console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('TEST HATASI:', e);
  process.exit(1);
});
