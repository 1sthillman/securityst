/* IndexedDB katmanı — promise tabanlı, küçük ve güvenilir.
 * Store'lar:
 *  visits : tüm kayıtların yereldeki kopyası (keyPath: id)
 *  outbox : bilgisayara henüz ulaşmamış kuyruk (keyPath: id)
 *  kv     : ayarlar (keyPath: key)
 */
import { DB_NAME, DB_VERSION, STORE_VISITS, STORE_OUTBOX, STORE_KV } from './config.js';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_VISITS)) db.createObjectStore(STORE_VISITS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
export function db() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const s = t.objectStore(store);
        let out;
        try {
          out = fn(s);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('tx abort'));
      })
  );
}

const reqToPromise = (store, mode, fn) =>
  db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const s = t.objectStore(store);
        let r;
        try {
          r = fn(s);
        } catch (e) {
          reject(e);
          return;
        }
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      })
  );

// --- visits ---
export const dbPutVisit = (rec) => reqToPromise(STORE_VISITS, 'readwrite', (s) => s.put(rec));
export const dbGetVisits = async (limit = 200) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE_VISITS, 'readonly');
    // visits'te id keyPath; ts'ye göre sıralamak için tamamını okuyup sırala (küçük ölçek).
    const reqAll = t.objectStore(STORE_VISITS).getAll();
    reqAll.onsuccess = () => {
      const rows = reqAll.result || [];
      rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      resolve(rows.slice(0, limit));
    };
    reqAll.onerror = () => reject(reqAll.error);
  });
};

// --- outbox (kuyruk) ---
export const idbQueuePut = (rec) => reqToPromise(STORE_OUTBOX, 'readwrite', (s) => s.put(rec));
export const idbQueueDelete = (id) => reqToPromise(STORE_OUTBOX, 'readwrite', (s) => s.delete(id));
export const idbQueueCount = async () => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE_OUTBOX, 'readonly');
    const r = t.objectStore(STORE_OUTBOX).count();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
};
export const idbQueueGetAll = async (limit = 500) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE_OUTBOX, 'readonly');
    const r = t.objectStore(STORE_OUTBOX).getAll(null, limit);
    r.onsuccess = () => {
      const rows = r.result || [];
      rows.sort((a, b) => (a.ts || 0) - (b.ts || 0)); // FIFO
      resolve(rows);
    };
    r.onerror = () => reject(r.error);
  });
};

// --- kv / config ---
export const kvGet = (key) => reqToPromise(STORE_KV, 'readonly', (s) => s.get(key)).then((r) => (r ? r.value : null));
export const kvPut = (key, value) => reqToPromise(STORE_KV, 'readwrite', (s) => s.put({ key, value }));

export const idbGetSyncConfig = () => kvGet('syncCfg');
export const idbPutSyncConfig = (cfg) => kvPut('syncCfg', cfg);

export { tx };
