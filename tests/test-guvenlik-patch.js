'use strict';
// guvenlik-sync.js (drop-in yama) testi: tarayıcı sahteleriyle node'da çalışır.
// Kapsar: saveVisit sarma, uid→id eşleme, firmOf/company çözümü, FIFO flush,
// kuyruk kalıcılığı (localStorage fallback), configure kalıcılığı, deleted işareti.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log(`PASS — ${name}`); }
  else { fail++; console.log(`FAIL — ${name}${extra ? ' :: ' + extra : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- localStorage sahtesi ---
const lsStore = {};
const localStorageStub = {
  getItem: (k) => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v); },
  removeItem: (k) => { delete lsStore[k]; },
};

// --- en küçük DOM sahtesi ---
function fakeEl() {
  return {
    children: [],
    style: {},
    textContent: '',
    innerHTML: '',
    value: '',
    title: '',
    id: '',
    onclick: null,
    setAttribute() {},
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return fakeEl(); },
  };
}
const listeners = { online: [] };

// --- fetch sahtesi ---
const fetchCalls = [];
let fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });

global.window = {
  indexedDB: undefined, // localStorage fallback yolu test edilir
  addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  // Uygulamanın dbPut davranışı: depoya yazar, yazdığı kaydı döner.
  dbPut: async (st, rec) => rec,
  firmOf: (plate) => (plate === '34 F 1' ? 'FirmaX' : ''),
  AbortController,
  fetch: undefined,
  location: { protocol: 'http:' },
};
global.document = {
  readyState: 'complete',
  visibilityState: 'hidden',
  body: fakeEl(),
  createElement: () => fakeEl(),
  getElementById: () => null,
  addEventListener: () => {},
};
global.localStorage = localStorageStub;
global.fetch = async (url, opts) => {
  fetchCalls.push({ url, opts });
  return fetchHandler(url, opts);
};

require(path.join(__dirname, '..', 'phone', 'guvenlik-sync.js'));

async function main() {
  const G = global.window.GuvenlikSync;
  ok(!!G, 'GuvenlikSync globali kurulur');
  // Boot (depo hazırlığı) bitmeden gelen kayıt: kapı (S.ready) tutar, kaybolmaz.
  const earlyP = G.enqueueVisit({ uid: 'rearly0001', plate: 'ERKEN', ts: 5 });
  await sleep(300); // boot: openDb(resolve) + kvGet
  await earlyP;

  // 1. dbPut sarma: visits yazımı kuyruğa düşer, couriers düşmez
  await global.window.GuvenlikSync.configure('http://pc:4545', 'tok');
  fetchCalls.length = 0;
  const rec = await global.window.dbPut('visits', { uid: 'rabc12345', site: 'A', unit: '1', courier: 'Ali', company: '', plate: '34 F 1', guard: 'Nöbetçi', note: '', ts: 777, dev: 'd1', deleted: false });
  ok(rec && rec.uid === 'rabc12345', 'orijinal dbPut çalışır, kaydı döner');
  await global.window.dbPut('couriers', { uid: 'ck1', plate: '34 F 1' });
  // OLCULEN HATA (test saglamligi): 300 ms uykuya guveniliyordu ve TUM
  // fetch govdeleri JSON varsayiliyordu. Artik:
  //  1) akitma ACIKCA tetiklenir (zamanlamaya bagli degil)
  //  2) govdesi olmayan istekler (orn. /saglik yoklamasi) JSON.parse ile
  //     COKMEZ; aksi halde test yanlis yerde patliyordu.
  try { await G.flush(); } catch (e) { /* asagida yakalanir */ }
  await sleep(200);

  // Govdesi JSON olan istekler (yardimci: govdesi olmayanlari atlar).
  const govdeVar = (b) => { try { return JSON.parse(b); } catch (e) { return null; } };
  const jsonCagrilar = fetchCalls.map((c) => govdeVar(c.opts && c.opts.body)).filter(Boolean);

  ok(fetchCalls.length >= 1, 'sarma sonrasi kuyruk aga cikar',
    `fetchCalls=${fetchCalls.length} · govdeli=${jsonCagrilar.length}`);
  ok(!jsonCagrilar.some((b) => b && b.id === 'ck1'),
    'couriers yazimi kuyruga dusmez');
  const ziyaretGovdesi = jsonCagrilar.find((b) => b && b.id === 'rabc12345');
  ok(!!ziyaretGovdesi,
    'ziyaret kaydi aga gonderildi (id bulundu)',
    `gonderilen govdeler: ${JSON.stringify(jsonCagrilar.map((b) => b && b.id))}`);
  const body = ziyaretGovdesi || {};
  ok(body.id === 'rabc12345' && body.uid === 'rabc12345', 'uid -> id eslenir', JSON.stringify(body));
  ok(body.company === 'FirmaX', 'firmOf() sonucu Firma olarak gonderilir', body.company);
  ok(JSON.parse(lsStore['ck_sync_outbox'] || '[]').length === 0, 'basarili gonderim kuyrugu bosaltir');
  ok(jsonCagrilar.some((b) => b && b.plate === 'ERKEN'),
    'boot oncesi gelen kayit da kuyruga girip gonderilir');
  ok(fetchCalls.some((c) => { try { return JSON.parse(c.opts.body).plate === 'ERKEN'; } catch { return false; } }),
    'boot öncesi gelen kayıt da kuyruğa girip gönderilir');

  // 1b. düzenleme akışı da yakalanır (firma değişikliği upsert ile yayılır)
  fetchCalls.length = 0;
  await global.window.dbPut('visits', { uid: 'rabc12345', site: 'A', unit: '1', courier: 'Ali', company: 'YeniFirma', plate: '34 F 1', guard: 'Nöbetçi', note: '', ts: 777, updatedAt: 999, dev: 'd1', deleted: false });
  await sleep(300);
  const editBodies = fetchCalls.map((c) => { try { return JSON.parse(c.opts.body); } catch { return null; } }).filter(Boolean);
  ok(editBodies.some((b) => b.id === 'rabc12345' && b.company === 'YeniFirma' && b.updatedAt === 999),
    'düzenleme kuyruğa düşer (upsert verisi tam)');

  // 1c. plakasız kayıt kuyruğa alınmaz (zehirli kayıt kuyruğu tıkamaz)
  await global.window.dbPut('visits', { uid: 'rnoplate01', site: 'A', plate: '', ts: 778 });
  await sleep(200);
  ok(JSON.parse(lsStore['ck_sync_outbox'] || '[]').length === 0, 'plakasız kayıt kuyruğa alınmaz');

  // 2. company varsa firmOf ezmez
  fetchCalls.length = 0;
  await G.enqueueVisit({ uid: 'rcompany01', plate: '34 C 1', company: 'ElleFirma', ts: 778 });
  await sleep(300);
  const b2 = JSON.parse(fetchCalls[fetchCalls.length - 1].opts.body);
  ok(b2.company === 'ElleFirma', 'kayıtlı company korunur');

  // 3. ağ kopukken kuyruk korunur, dönünce FIFO akar (önce kopukluk başlar)
  fetchHandler = async () => { throw new Error('kopuk'); };
  await G.enqueueVisit({ uid: 'rq00000001', plate: 'Q1', ts: 10 });
  await G.enqueueVisit({ uid: 'rq00000002', plate: 'Q2', ts: 11 });
  await sleep(400); // fırsatçı flush'lar da başarısız olur
  fetchCalls.length = 0;
  await G.flush();
  await sleep(200);
  const q = JSON.parse(lsStore['ck_sync_outbox'] || '[]');
  ok(q.length === 2, 'kopukken kuyruk korunur');
  fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  fetchCalls.length = 0;
  await G.flush();
  await sleep(300);
  const q2 = JSON.parse(lsStore['ck_sync_outbox'] || '[]');
  const order = fetchCalls.map((c) => JSON.parse(c.opts.body).plate);
  ok(q2.length === 0, 'ağ dönünce kuyruk boşalır');
  ok(order[0] === 'Q1' && order[1] === 'Q2', 'retry FIFO', order.join(','));

  // 4. configure kalıcılığı
  await G.configure('http://192.168.1.50:4545///', 'abc');
  const cfg = JSON.parse(lsStore['ck_sync_cfg'] || '{}');
  ok(cfg.syncCfg && cfg.syncCfg.baseUrl === 'http://192.168.1.50:4545', 'configure slash temizler + kalıcı');

  // 5. deleted işareti taşınır
  fetchCalls.length = 0;
  await G.enqueueVisit({ uid: 'rdel000001', plate: 'QD', ts: 12, deleted: true });
  await sleep(300);
  const b5 = JSON.parse(fetchCalls[fetchCalls.length - 1].opts.body);
  ok(b5.deleted === true, 'deleted bayrağı sunucuya taşınır');

  // 6. status raporu
  const st = await G.status();
  ok(st && typeof st.pending === 'number' && st.baseUrl === 'http://192.168.1.50:4545', 'status raporu');

  // 6b. '__proto__' id: başarılı batch'te silinir (prototip tuzağı yok)
  fetchHandler = async () => { throw new Error('kopuk'); };
  await G.enqueueVisit({ uid: '__proto__', plate: 'PP', ts: 70 });
  await G.enqueueVisit({ uid: 'rnormal70', plate: 'NP', ts: 71 });
  await sleep(300);
  ok(JSON.parse(lsStore['ck_sync_outbox'] || '[]').length === 2, 'batch öncesi 2 kayıt kuyrukta');
  fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, saved: 2, duplicates: 0, errors: [] }) });
  await G.flushBatch();
  await sleep(200);
  ok(JSON.parse(lsStore['ck_sync_outbox'] || '[]').length === 0, "'__proto__' id batch ile temizlenir");
  fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });

  // 7. yarış: configure + art arda kayıtlar — hiçbiri 15sn beklemez, hepsi gider
  fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  fetchCalls.length = 0;
  await G.configure('http://pc:4545', 'tok'); // iç flush'u henüz bitmeden:
  await G.enqueueVisit({ uid: 'rr00000001', plate: 'R1', ts: 50 });
  await G.enqueueVisit({ uid: 'rr00000002', plate: 'R2', ts: 51 });
  await sleep(600);
  const rq = JSON.parse(lsStore['ck_sync_outbox'] || '[]');
  ok(rq.length === 0, 'art arda kayıtlarda kuyruk anında boşalır');
  const rPlates = fetchCalls.map((c) => JSON.parse(c.opts.body).plate);
  ok(rPlates.includes('R1') && rPlates.includes('R2'), 'art arda kayıtların ikisi de gönderilir');

  console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('TEST HATASI:', e); process.exit(1); });
