// Telefon SYNC motoru testi — bellek-içi IndexedDB sahtesi + fetch sahtesi.
// Çalıştır: node ../tests/test-phone-sync.mjs  (repo kökünden: node tests/test-phone-sync.mjs)
//
// db.js/sync.js tarayıcı API'leri kullanır; burada en küçük uyumlu sahteler kurulur.
// Test edilen: enqueue kalıcılığı, FIFO sıra, başarısızlıkta break, backoff,
// batch kısmi hata, config kalıcılığı, visits sıralaması.

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log(`PASS — ${name}`); }
  else { fail++; console.log(`FAIL — ${name}${extra ? ' :: ' + extra : ''}`); }
};

// ---------- IndexedDB sahtesi ----------
class FakeReq {
  constructor() { this.onsuccess = null; this.onerror = null; this.result = undefined; this.error = undefined; }
  _ok(v) { this.result = v; setTimeout(() => this.onsuccess && this.onsuccess({ target: this }), 0); }
  _fail(e) { this.error = e; setTimeout(() => this.onerror && this.onerror({ target: this }), 0); }
}
class FakeStore {
  constructor(kp) { this.kp = kp; this.map = new Map(); }
  _clone(v) { return JSON.parse(JSON.stringify(v)); }
  put(v) {
    const r = new FakeReq();
    const k = v && v[this.kp];
    if (k === undefined) { r._fail(new Error('key yok')); return r; }
    this.map.set(k, this._clone(v)); r._ok(k); return r;
  }
  get(k) {
    const r = new FakeReq();
    const v = this.map.get(k);
    r._ok(v === undefined ? undefined : this._clone(v)); return r;
  }
  getAll(_q, lim) {
    const r = new FakeReq();
    let arr = [...this.map.values()].map((v) => this._clone(v));
    if (typeof lim === 'number') arr = arr.slice(0, lim);
    r._ok(arr); return r;
  }
  count() { const r = new FakeReq(); r._ok(this.map.size); return r; }
  delete(k) { const r = new FakeReq(); this.map.delete(k); r._ok(undefined); return r; }
}
const _dbs = new Map();
globalThis.indexedDB = {
  open(name, _ver) {
    const r = new FakeReq();
    let entry = _dbs.get(name);
    if (!entry) {
      entry = { stores: {} };
      _dbs.set(name, entry);
    }
    const db = {
      objectStoreNames: { contains: (n) => !!entry.stores[n] },
      createObjectStore: (n, o) => { entry.stores[n] = new FakeStore(o.keyPath); },
      transaction: (storeName, _mode) => ({ objectStore: () => entry.stores[storeName] }),
    };
    setTimeout(() => {
      if (!entry.init) {
        entry.init = true;
        r.result = db;
        r.onupgradeneeded && r.onupgradeneeded({ target: r });
      }
      r.result = db;
      r.onsuccess && r.onsuccess({ target: r });
    }, 0);
    return r;
  },
};

// ---------- tarayıcı sahteleri ----------
globalThis.window = { addEventListener() {} };
globalThis.document = { addEventListener() {}, visibilityState: 'hidden' };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

const fetchCalls = [];
let fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({}) });
globalThis.fetch = async (url, opts) => {
  fetchCalls.push({ url, opts });
  return fetchHandler(url, opts);
};
const lastBody = (i = -1) => JSON.parse(fetchCalls.at(i).opts.body);
const resetFetch = () => { fetchCalls.length = 0; };

const { SYNC } = await import('../phone/js/sync.js');
const db = await import('../phone/js/db.js');

// init() timer kurmasın diye elle bağlıyoruz (scheduleRetryLoop'suz)
SYNC.baseUrl = 'http://pc:4545';
SYNC.token = 'tok';
SYNC.failStreak = 0; SYNC.lastError = null; SYNC.lastOkAt = null; SYNC.flushing = false;

// --- 1. config kalıcılığı + slash temizliği ---
await SYNC.configure('http://pc:4545///', 'tok');
ok(SYNC.baseUrl === 'http://pc:4545', 'configure trailing slash temizler');
ok((await db.idbGetSyncConfig()).baseUrl === 'http://pc:4545', 'config IndexedDB kalıcı');

// --- 2. baseUrl yokken fetch yok, kayıt korunur ---
SYNC.baseUrl = null;
resetFetch();
await SYNC.enqueue({ site: 'A', plate: 'P1', ts: 1 });
ok(fetchCalls.length === 0, 'eşleşmemişken ağa çıkılmaz');
ok((await db.idbQueueCount()) === 1, 'kayıt kuyrukta korunur');
SYNC.baseUrl = 'http://pc:4545';

// --- 3. flush başarısı FIFO + kuyruk boşalır ---
fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
resetFetch(); // enqueue'lerin fırsatçı flush'ları da bu pencerede izlenir
await SYNC.enqueue({ site: 'B', plate: 'P2', ts: 2 });
await SYNC.enqueue({ site: 'C', plate: 'P3', ts: 3 });
// Fırsatçı flush'lar await'siz koşar — bitmesini bekle (uygulama davranışı, test zamanlaması değil):
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 200 && ((await db.idbQueueCount()) > 0 || SYNC.flushing); i++) await sleep(20);
await SYNC.tryFlush('test'); // kesin süpürme
ok((await db.idbQueueCount()) === 0, 'başarılı flush kuyruğu boşaltır');
const plates = fetchCalls.map((c) => JSON.parse(c.opts.body).plate);
const firstP1 = plates.indexOf('P1'), firstP2 = plates.indexOf('P2'), firstP3 = plates.indexOf('P3');
ok(firstP1 !== -1 && firstP2 !== -1 && firstP3 !== -1 && firstP1 < firstP2 && firstP2 < firstP3, 'FIFO sıra korunur');
ok(SYNC.failStreak === 0 && SYNC.lastError === null && SYNC.lastOkAt !== null, 'başarıda sayaç sıfırlanır');

// --- 3b. yarış: art arda kayıtlarda hiçbiri interval beklemez ---
resetFetch();
await SYNC.enqueue({ plate: 'RR1', ts: 91 });
await SYNC.enqueue({ plate: 'RR2', ts: 92 });
for (let i = 0; i < 200 && ((await db.idbQueueCount()) > 0 || SYNC.flushing); i++) await new Promise((r) => setTimeout(r, 20));
ok((await db.idbQueueCount()) === 0, 'art arda kayıtlarda kuyruk anında boşalır');

// --- 4. başarısızlıkta break: kalanlar bekler, sıra bozulmaz ---
await db.idbQueuePut({ id: 'f1', plate: 'F1', ts: 10 });
await db.idbQueuePut({ id: 'f2', plate: 'F2', ts: 11 });
fetchHandler = async () => { throw new Error('ağ koptu'); };
resetFetch();
await SYNC.tryFlush('test');
ok(SYNC.failStreak === 1, 'başarısızlık streak artar');
ok((await db.idbQueueCount()) === 2, 'başarısızda kuyruk korunur');
ok(fetchCalls.length === 1, 'ilk kayıt takılınca break (1 deneme)');
// ağ dönünce ikisi de sırayla gider
fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
await SYNC.tryFlush('test');
ok((await db.idbQueueCount()) === 0, 'ağ dönünce kuyruk akar');
const seq = fetchCalls.slice(-2).map((c) => JSON.parse(c.opts.body).plate);
ok(seq[0] === 'F1' && seq[1] === 'F2', 'retry sırası FIFO');

// --- 5. HTTP 500: kayıt korunur, hata saklanır ---
await db.idbQueuePut({ id: 'e1', plate: 'E1', ts: 20 });
fetchHandler = async () => ({ ok: false, status: 500, json: async () => ({}) });
await SYNC.tryFlush('test');
ok((await db.idbQueueCount()) === 1 && SYNC.lastError === 'HTTP 500', 'HTTP 500 kaydı silmez, hatayı saklar');
await db.idbQueueDelete('e1');

// --- 6. backoff ---
SYNC.failStreak = 0;
ok(SYNC.currentDelay() === 15000, 'backoff taban 15sn');
SYNC.failStreak = 1;
ok(SYNC.currentDelay() === 22500, 'backoff 1.5x artar');
SYNC.failStreak = 50;
ok(SYNC.currentDelay() === 120000, 'backoff tavan 2dk');
SYNC.failStreak = 0;

// --- 7. batch kısmi hata: hatalı index kuyrukta kalır ---
await db.idbQueuePut({ id: 'b1', plate: 'B1', ts: 30 });
await db.idbQueuePut({ id: 'b2', plate: 'B2', ts: 31 });
await db.idbQueuePut({ id: 'b3', plate: 'B3', ts: 32 });
fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, saved: 2, duplicates: 0, errors: [{ index: 1 }] }) });
await SYNC.tryFlushBatch();
const left = await db.idbQueueGetAll();
ok(left.length === 1 && left[0].id === 'b2', 'batch hatalısı kuyrukta kalır, diğerleri silinir');
fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
await SYNC.tryFlush('test');
ok((await db.idbQueueCount()) === 0, 'kalan batch kaydı tekliyle gider');

// --- 8. batch ağ hatası: hepsi korunur ---
await db.idbQueuePut({ id: 'c1', plate: 'C1', ts: 40 });
fetchHandler = async () => { throw new Error('kopuk'); };
await SYNC.tryFlushBatch();
ok((await db.idbQueueCount()) === 1, 'batch ağ hatasında kuyruk korunur');
await db.idbQueueDelete('c1');

// --- 8b. '__proto__' id: başarılı batch ikisini de siler (prototip tuzağı yok) ---
{
  await db.idbQueuePut({ id: '__proto__', plate: 'PR', ts: 61 });
  await db.idbQueuePut({ id: 'normal-61', plate: 'NR', ts: 62 });
  fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, saved: 2, duplicates: 0, errors: [] }) });
  await SYNC.tryFlushBatch();
  const leftProto = await db.idbQueueGetAll();
  ok(leftProto.length === 0, "'__proto__' batch sonrası silinir");
  fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
}

// --- 9. testConnection ---
let threw = false;
{
  const savedUrl = SYNC.baseUrl;
  SYNC.baseUrl = null; // geri dönüş adresi de yokken boş adres hata vermeli
  try { await SYNC.testConnection('', ''); } catch { threw = true; }
  SYNC.baseUrl = savedUrl;
}
ok(threw, 'testConnection boş adreste hata verir');
fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, kayitSayisi: 7 }) });
const hc = await SYNC.testConnection('http://pc:4545/', 'x');
ok(hc.kayitSayisi === 7, 'testConnection sağlık verisini döner');

// --- 10. visits: desc sıralama + limit ---
await db.dbPutVisit({ id: 'v1', plate: 'V1', ts: 100 });
await db.dbPutVisit({ id: 'v2', plate: 'V2', ts: 300 });
await db.dbPutVisit({ id: 'v3', plate: 'V3', ts: 200 });
const vs = await db.dbGetVisits(2);
ok(vs.length === 2 && vs[0].id === 'v2' && vs[1].id === 'v3', 'visits ts desc + limit');

// --- 12. depo patlarsa tryFlush reject etmez, backoff artar, döngü yaşar ---
{
  const entry = _dbs.get('cinarkoy-sync');
  const savedStores = entry.stores;
  entry.stores = {}; // tüm store'lar yok: her depo erişimi reject eder
  const before = SYNC.failStreak;
  let threw = false;
  try {
    await SYNC.tryFlush('test');
  } catch { threw = true; }
  ok(!threw && SYNC.failStreak === before + 1 && SYNC.flushing === false, 'depo hatasında reject yok, backoff artar');
  entry.stores = savedStores; // restore
  await SYNC.enqueue({ plate: 'SONRA', ts: 999 });
  for (let i = 0; i < 200 && ((await db.idbQueueCount()) > 0 || SYNC.flushing); i++) await new Promise((r) => setTimeout(r, 20));
  ok((await db.idbQueueCount()) === 0, 'depo düzelince akış devam eder');
}

// --- 11. enqueue id üretir, tek kayıt body taşır ---
resetFetch();
fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
await SYNC.enqueue({ plate: 'IDLI', ts: 99 });
await new Promise((r) => setTimeout(r, 50));
const sent = fetchCalls.map((c) => { try { return JSON.parse(c.opts.body); } catch { return null; } }).filter(Boolean);
ok(sent.some((s) => s.plate === 'IDLI' && typeof s.id === 'string' && s.id.length >= 8), 'enqueue id üretip body taşır');
void lastBody;

console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
