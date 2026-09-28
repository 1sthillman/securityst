'use strict';
// Entegrasyon testi: companion API (gerçek HTTP, geçici DATA_DIR).
// Çalıştır: npm test (companion klasöründen)
const path = require('path');
const fs = require('fs');
const os = require('os');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
  process.env.PORT = '4559';
  process.env.DATA_DIR = tmp;
  process.env.SYNC_TOKEN = 'test-token-123';

  const { app } = require('../companion/companion.js');
  const server = app.listen(4559, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));

  const base = 'http://127.0.0.1:4559';
  const H = { 'Content-Type': 'application/json', 'X-Sync-Token': 'test-token-123' };
  let fail = 0;
  const ok = (cond, name) => {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (!cond) fail++;
  };

  // 1) sağlık
  let r = await fetch(base + '/saglik');
  ok(r.ok, 'GET /saglik');

  // 2) yetkisiz reddedilmeli
  r = await fetch(base + '/kayit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok(r.status === 401, 'tokensiz 401');

  // 3) eksik veri 400
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify({ id: 'x' }) });
  ok(r.status === 400, 'eksik veri 400');

  // 4) normal kayıt
  const rec = {
    id: '11111111-1111-4111-8111-111111111111', site: 'A', unit: '12',
    courier: 'Ali', company: 'Test', plate: '34 ABC 123', guard: 'Nöbetçi',
    note: '', date: '27.09.2026', time: '12:00', ts: Date.now(),
  };
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify(rec) });
  ok(r.ok && (await r.json()).ok === true, 'POST /kayit ok');

  // 5) duplicate idempotent
  r = await fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify(rec) });
  const dup = await r.json();
  ok(r.ok && dup.duplicate === true, 'duplicate idempotent');

  // 6) batch
  const batch = [0, 1, 2].map((i) => ({ ...rec, id: `22222222-2222-4222-8222-22222222222${i}`, plate: '34 XYZ ' + i }));
  r = await fetch(base + '/kayit/batch', { method: 'POST', headers: H, body: JSON.stringify({ records: batch }) });
  const bj = await r.json();
  ok(r.ok && bj.saved === 3, 'POST /kayit/batch 3 kayıt');

  // 7) dosyalar oluştu + excel okunabilir
  await new Promise((res) => setTimeout(res, 800)); // debounce persist + zincir
  const xlsxExists = fs.existsSync(path.join(tmp, 'kayitlar.xlsx'));
  const logLines = fs.readFileSync(path.join(tmp, 'kayitlar.jsonl'), 'utf8').trim().split('\n').length;
  ok(xlsxExists, 'kayitlar.xlsx oluştu (atomik)');
  ok(logLines === 4, `jsonl 4 satır (bulunan: ${logLines})`);

  // 8) paralel 20 istek — zincir çakışmamalı, hepsi tekil satır olmalı
  const parallel = Array.from({ length: 20 }, (_, i) => ({
    ...rec, id: `33333333-3333-4333-8333-3333333333${String(i).padStart(2, '0')}`, plate: 'PAR ' + i,
  }));
  const results = await Promise.all(
    parallel.map((p) => fetch(base + '/kayit', { method: 'POST', headers: H, body: JSON.stringify(p) }))
  );
  ok(results.every((x) => x.ok), '20 paralel istek hepsi 200');
  await new Promise((res) => setTimeout(res, 1500));
  const total = fs.readFileSync(path.join(tmp, 'kayitlar.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length;
  ok(total === 24, `toplam 24 satır, çakışma yok (bulunan: ${total})`);

  server.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('TEST HATASI:', e);
  process.exit(1);
});
