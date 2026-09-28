/* SYNC motoru — veri kaybını önleyen katman.
 *
 * Kurallar:
 *  - Kayıt önce IndexedDB outbox'a yazılır, sonra fırsatçı gönderim denenir.
 *  - tryFlush(): FIFO sıralı tekli gönderim; kuyruk kabarıksa (≥10) tryFlushBatch().
 *    Biri başarısız olursa `break` ile durur (sıra korunur).
 *  - Tetikleyiciler: periyodik interval + online + visibilitychange + manuel.
 *  - Başarısızlıkta üstel geri çekilme (15sn taban, 2dk tavan). Başarıda sıfırlanır.
 *    Retry döngüsü asla ölmez: beklenmedik hata bile aralığı büyütüp devam eder.
 *  - Idempotency: her kayıtta kalıcı `id` (UUID). Sunucu duplicate'i güvenle yutar.
 */
import { idbQueuePut, idbQueueDelete, idbQueueGetAll, idbQueueCount, idbGetSyncConfig, idbPutSyncConfig } from './db.js';

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const BASE_INTERVAL = 15000;
const MAX_INTERVAL = 120000;

export const SYNC = {
  baseUrl: null,
  token: null,
  retryTimer: null,
  flushing: false,
  failStreak: 0,
  lastOkAt: null,
  lastError: null,
  listeners: new Set(),

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
  emit(state) {
    for (const fn of this.listeners) {
      try { fn(state); } catch {}
    }
  },

  async init() {
    try {
      const cfg = await idbGetSyncConfig();
      if (cfg && cfg.baseUrl) {
        this.baseUrl = String(cfg.baseUrl).replace(/\/+$/, '');
        this.token = cfg.token || null;
      }
    } catch (e) {
      console.warn('sync cfg okunamadı', e);
    }
    this.scheduleRetryLoop();
    window.addEventListener('online', () => this.tryFlush('online'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.tryFlush('visible');
    });
    this.tryFlush('init');
  },

  async configure(baseUrl, token) {
    this.baseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
    this.token = String(token || '').trim();
    this.failStreak = 0;
    await idbPutSyncConfig({ baseUrl: this.baseUrl, token: this.token });
    this.emit(await this.status());
    this.tryFlush('configure');
  },

  newId() {
    return uuid();
  },

  async enqueue(record) {
    if (!record.id) record.id = uuid();
    if (!record.ts) record.ts = Date.now();
    record._attempts = record._attempts || 0;
    await idbQueuePut(record); // kalıcı kuyruk — önce disk, sonra ağ
    this.emit(await this.status());
    this.tryFlush('enqueue').catch(() => {}); // fırsatçı: await yok, hata yutulmaz (içeride işlenir)
  },

  currentDelay() {
    return Math.min(BASE_INTERVAL * Math.pow(1.5, this.failStreak), MAX_INTERVAL);
  },

  scheduleRetryLoop() {
    if (this.retryTimer) return;
    const tick = async () => {
      try {
        await this.tryFlush('interval');
      } catch {
        // Depo hatası gibi beklenmedik durum: döngü ASLA ölmez, aralık büyür.
        this.failStreak++;
      } finally {
        this.retryTimer = setTimeout(tick, this.currentDelay());
      }
    };
    this.retryTimer = setTimeout(tick, BASE_INTERVAL);
  },

  async status() {
    let pending = 0;
    try {
      pending = await idbQueueCount();
    } catch {}
    return {
      baseUrl: this.baseUrl,
      configured: !!this.baseUrl,
      online: navigator.onLine,
      pending,
      flushing: this.flushing,
      lastOkAt: this.lastOkAt,
      lastError: this.lastError,
      nextRetryMs: this.currentDelay(),
    };
  },

  async tryFlush(reason) {
    if (!this.baseUrl) {
      this.emit(await this.status());
      return;
    }
    // Art arda çağrılar kaybolmaz: جاری flush bitince otomatik yeniden akıtılır.
    if (this.flushing) { this.again = true; return; }
    this.flushing = true;
    this.emit(await this.status());
    try {
      for (;;) {
        this.again = false;
        let failed = false;
        const pending = await idbQueueGetAll();
        for (const record of pending) {
          const ok = await this.sendOne(record);
          if (ok) {
            await idbQueueDelete(record.id);
            this.failStreak = 0;
            this.lastError = null;
            this.lastOkAt = new Date().toISOString();
          } else {
            this.failStreak++;
            failed = true;
            break; // sıralı: biri takıldıysa bekle
          }
        }
        // Hata varken hemen dönme (meşgul döngü olur); interval/online dener.
        if (!(this.again && !failed)) break;
      }
      this.again = false;
    } catch {
      // Depo hatası gibi beklenmedik durum: backoff'a düş, döngü yaşasın.
      // tryFlush ASLA reject etmez — tüm çağrılar fire-and-forget güvenlidir.
      this.failStreak++;
    } finally {
      this.flushing = false;
      this.emit(await this.status());
    }
    void reason;
  },

  async sendOne(record) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      let res;
      try {
        res = await fetch(`${this.baseUrl}/kayit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Sync-Token': this.token || '' },
          body: JSON.stringify(record),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }
      if (res.ok) return true;
      // 4xx (401/400): retry anlamsız — kuyrukta şişmesin diye hatayı sakla ama kaydı tut.
      // 401 = token yanlış: kullanıcı düzeltmeli. Kayıt kuyrukta kalır (veri korunur).
      this.lastError = `HTTP ${res.status}`;
      return false;
    } catch (e) {
      this.lastError = e && e.name === 'AbortError' ? 'Zaman aşımı' : 'Ağ hatası';
      return false;
    }
  },

  /** Toplu gönderim denemesi (kuyruk kabarıksa tek tek yerine). Başarısızsa tekliye dönülür. */
  async tryFlushBatch() {
    if (!this.baseUrl) return;
    if (this.flushing) { this.again = true; return; }
    this.flushing = true;
    try {
      const pending = await idbQueueGetAll();
      if (!pending.length) return;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = await fetch(`${this.baseUrl}/kayit/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Sync-Token': this.token || '' },
          body: JSON.stringify({ records: pending }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          this.lastError = `HTTP ${res.status}`;
          return;
        }
        const data = await res.json();
        if (data && data.ok) {
          // errors içermeyenleri sil (saved + duplicates). Hatalılar kuyrukta kalır.
          // Set: '__proto__' gibi özel anahtarlarda bile doğru çalışır.
          const errIds = new Set((data.errors || []).map((e) => pending[e.index] && pending[e.index].id));
          for (const r of pending) {
            if (!errIds.has(r.id)) await idbQueueDelete(r.id);
          }
          this.failStreak = 0;
          this.lastError = null;
          this.lastOkAt = new Date().toISOString();
        }
      } finally {
        clearTimeout(t);
      }
    } catch (e) {
      this.lastError = e && e.name === 'AbortError' ? 'Zaman aşımı' : 'Ağ hatası';
      this.failStreak++;
    } finally {
      this.flushing = false;
      const chained = this.again;
      this.again = false;
      this.emit(await this.status());
      // Batch sırasında yeni iş geldiyse tekli akışla hemen devam et.
      if (chained) this.tryFlush('chained').catch(() => {});
    }
  },

  async testConnection(baseUrl, token) {
    const url = String(baseUrl || this.baseUrl || '').replace(/\/+$/, '');
    if (!url) throw new Error('Adres girin');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${url}/saglik`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Token gerektirmez; sadece servis ayakta mı bakılır.
      void token;
      return data;
    } finally {
      clearTimeout(t);
    }
  },
};
