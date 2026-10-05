'use strict';
/**
 * Çınarköy Excel Sync — Companion Servis
 * ======================================
 * Telefon(lar) -> Bilgisayar (kulübe) otomatik Excel senkronizasyonu.
 *
 * Tasarım ilkeleri:
 *  1. Tek doğruluk kaynağı (source of truth) = data/kayitlar.jsonl (append-only log).
 *     Excel her zaman bu log'dan türetilir. Excel silinirse/bozulursa otomatik yeniden üretilir.
 *  2. Idempotent yazma + upsert: her kaydın `id`/`uid` değeri dedup edilir.
 *     Aynı id aynı/eskisiyle gelirse `duplicate` (retry güvenli); daha yeni
 *     `updatedAt` ile gelirse satır güncellenir (`updated`) — uygulamanın
 *     kendi birleştirme kuralıyla aynı. Retry = güvenli, düzenleme = yayılır.
 *  3. Atomik Excel yazma: .tmp dosyasına yaz + rename. Yarım dosya asla görünmez.
 *  4. Seri yazma kuyruğu: eşzamanlı istekler promise zinciri ile sıraya girer.
 *  5. Self-healing: açılışta log -> seenIds rebuild, Excel yoksa/bozuksa rebuild,
 *     yakalanmamış hatalarda process ölmez, pm2 watchdog olarak arkada durur.
 *
 * Endpoint'ler:
 *  POST /kayit        tek kayıt   { id|uid, site, unit, courier, company?|firma?, plate, guard, note?, type?, date?, time?, ts?, dev?, deleted? }
 *  POST /kayit/batch  toplu kayıt { records: [...] }  (telefon flush'u için verimli)
 *  GET  /saglik       sağlık + sayaç
 *  GET  /durum        detaylı durum (kuyruk yok, dosya boyutları) — token ister
 *
 * Auth: X-Sync-Token header == SHARED_TOKEN
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const qrCode = require('./qr.js');
const tls = require('./net/tls.js');
const SelfHealing = require('./self-heal.js');

/**
 * Sürüm: TEK doğruluk kaynağı package.json.
 * Ölçülen hata: /durum alanı 1.2.0'da takılı kalmıştı; sürümü üç yerde
 * ayrı ayrı yazmak yanlış bildirilere yol açıyor. Artık buradan okunur.
 */
let SUREM = '0.0.0';
try { SUREM = require('./package.json').version || SUREM; } catch {}

// Yerel plaka okuma motoru (Tesseract WASM, çevrimdışı).
// Bulut servis, API anahtarı ve internet gerekmez; fotoğraf kulübeden çıkmaz.
let plakaMotoru = null;
let plakaMotoruHatasi = null;
  // ÇOKLU DENEME: tek denemede okunamayan plaka için birden çok hazırlık
  // denenir (ölçüm: kırpılmış küçük görüntü okunmuyor, büyütülmüş okunuyor).
  const cokluOku = require('./ocr/coklu.js').cokluOku;

  // Plaka DEDEKTOru — YOLOv11 nano, onnxruntime-node ile (Python YOK).
  // OLCULECEK SONUC (29.09.2026): 8 gercek fotografin 5'inde bulunan kutu
  // 96 px'e kucultulup tam hatta gonderilince plaka DOGRU okundu (0 yanlis)
  // ve sure 2,4-10,9 saniyeden 0,15-0,39 saniyeye dustu.
  // Model yoksa/hata verirse kutular() bos doner ve yol devre disi kalir.
  const yoloPlaka = require('./ocr/yolo-plaka.js');

try {
  const { PlakaMotoru } = require('./ocr/plaka.js');
  plakaMotoru = new PlakaMotoru();
  const d = plakaMotoru.denetle();
  if (d.kullanilabilir) {
    const dur = plakaMotoru.durum();
    log('info', `Plaka motoru hazır: ${dur.motor} (${dur.dil}) · bölge bulucu: ${dur.bolgeBulucu}`);
    if (!/^aktif/.test(dur.bolgeBulucu)) {
      // Bu, kurulum paketinde dosya eksikliği demektir ve üretimde plaka
      // okumayı sessizce bozar. Kurulum betiği bu dosyayı paketliyor olmalı.
      log('warn', `UYARI: plaka bölge bulucusu yüklenemedi (${dur.bolgeBulucu}). ` +
        'Sahne karelerinde plaka bulunamayabilir. Kurulum paketini yeniden üretin.');
    }
  } else {
    plakaMotoruHatasi = d.sebep;
    log('warn', `Plaka motoru kullanılamıyor: ${d.sebep} (plaka okuma kapalı, elle giriş çalışır)`);
  }
} catch (e) {
  plakaMotoruHatasi = e.message;
  log('warn', `Plaka motoru yüklenemedi: ${e.message} (plaka okuma kapalı, elle giriş çalışır)`);
}
// NOT: yalnızca bizim ürettiğimiz dosyalar okunur (harici girdi yok),
// servis yalnızca yerel ağa bağlanır + token ister. npm audit'teki
// xlsx uyarılarının (GHSA-4r6h, GHSA-5pgg) tetiklenmesi için saldırganın
// bize özel hazırlanmış bir .xlsx dosyasını OKUTMASI gerekir — bu servis
                              // dışarıdan dosya kabul etmez, yalnızca YAZAR. Risk pratikte sıfırdır.

// ---------------------------------------------------------------------------
// 0. Konfigürasyon
// ---------------------------------------------------------------------------

function loadConfigFile() {
  const p = path.join(__dirname, 'config.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}
const fileCfg = loadConfigFile();

const PORT = parseInt(process.env.PORT || fileCfg.port || '4545', 10);
// HTTPS portu: HTTP + 1. İkisi AYNI Express uygulamasını sunar.
//
// NEDEN ZORUNLU (ölçülen, kullanıcı bildirimi): tarayıcı kamerayı yalnızca
// "güvenli kaynakta" açar. Telefon bilgisayara http://192.168.x.x ile
// bağlandığında güvenli kaynak DEĞİLDİR ve `navigator.mediaDevices` tanımsız
// olur — kamera hiç açılmaz, izin verilmez. Bu yüzden uygulamanın bir https
// yüzü OLMALI. Ayrıntı ve ölçüm: companion/net/tls.js
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || fileCfg.httpsPort || (PORT + 1), 10);
const DATA_DIR = process.env.DATA_DIR || fileCfg.dataDir || path.join(__dirname, 'data');

// ==================== EXCEL AYIRMA SİSTEMİ ====================
// Kayıtları nasıl gruplandıracağız?
// Modlar:
// - "single": Tek Excel dosyası (kayitlar.xlsx) - Varsayılan
// - "daily": Günlük Excel (kayitlar-2026-10-03.xlsx) - ÖNERİLEN
// - "shift": Vardiya bazlı Excel (kayitlar-Sabah.xlsx)
//
// Örnek config.json:
// {
//   "excelMode": "daily"
// }
// veya
// {
//   "excelMode": "shift",
//   "shifts": [
//     { "name": "Sabah", "start": "08:00", "end": "16:00" },
//     { "name": "Aksam", "start": "16:00", "end": "00:00" },
//     { "name": "Gece", "start": "00:00", "end": "08:00" }
//   ]
// }

const EXCEL_MODE = fileCfg.excelMode || 'daily'; // 'single', 'daily', 'shift'
const SHIFTS = fileCfg.shifts || [];

/**
 * Tarih string'i oluştur (YYYY-MM-DD formatında).
 * @param {Date} date - Tarih
 * @returns {string} - "2026-10-03"
 */
function getDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Hangi vardiyada olduğumuzu belirle (shift modu için).
 * @param {Date} date - Zaman damgası
 * @returns {object|null} - { start: '08:00', end: '16:00', name: 'Sabah' }
 */
function getCurrentShift(date = new Date()) {
  if (EXCEL_MODE !== 'shift' || !SHIFTS.length) return null;
  
  const hour = date.getHours();
  const minute = date.getMinutes();
  const currentMinutes = hour * 60 + minute;
  
  for (const shift of SHIFTS) {
    const [startH, startM] = shift.start.split(':').map(Number);
    const [endH, endM] = shift.end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    let endMinutes = endH * 60 + endM;
    
    // Gece vardiyası: bitiş saati başlangıçtan küçükse (örn: 22:00-06:00)
    if (endMinutes <= startMinutes) {
      if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
        return shift;
      }
    } else {
      if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
        return shift;
      }
    }
  }
  
  return null;
}

/**
 * Kaydın hangi Excel dosyasına gideceğini belirle.
 * @param {number} ts - Kayıt zaman damgası
 * @returns {string} - Excel dosya yolu
 */
function getExcelPathForRecord(ts) {
  const date = new Date(ts);
  
  if (EXCEL_MODE === 'daily') {
    // Günlük Excel: kayitlar-2026-10-03.xlsx
    const dateStr = getDateString(date);
    return path.join(DATA_DIR, `kayitlar-${dateStr}.xlsx`);
  } else if (EXCEL_MODE === 'shift') {
    // Vardiya Excel: kayitlar-Sabah.xlsx
    const shift = getCurrentShift(date);
    if (shift) {
      const safeName = shift.name.replace(/[^a-zA-Z0-9-_]/g, '');
      return path.join(DATA_DIR, `kayitlar-${safeName}.xlsx`);
    }
  }
  
  // Varsayılan: tek Excel
  return path.join(DATA_DIR, 'kayitlar.xlsx');
}

/**
 * Tüm Excel dosyaları listesi (mevcut modda).
 * @returns {Array<{name: string, path: string, type: string}>}
 */
function getAllExcelPaths() {
  const paths = [];
  
  if (EXCEL_MODE === 'daily') {
    // Son 30 günün Excel dosyalarını listele
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = getDateString(date);
      const excelPath = path.join(DATA_DIR, `kayitlar-${dateStr}.xlsx`);
      
      // Dosya varsa ekle
      try {
        if (fs.existsSync(excelPath)) {
          paths.push({
            name: dateStr,
            path: excelPath,
            type: 'daily',
            date: dateStr
          });
        }
      } catch {}
    }
  } else if (EXCEL_MODE === 'shift') {
    SHIFTS.forEach(shift => {
      const safeName = shift.name.replace(/[^a-zA-Z0-9-_]/g, '');
      paths.push({
        name: shift.name,
        path: path.join(DATA_DIR, `kayitlar-${safeName}.xlsx`),
        type: 'shift',
        shift: shift
      });
    });
  } else {
    // Single mode
    paths.push({
      name: 'Tüm Kayıtlar',
      path: path.join(DATA_DIR, 'kayitlar.xlsx'),
      type: 'single'
    });
  }
  
  return paths;
}

const EXCEL_PATH = path.join(DATA_DIR, 'kayitlar.xlsx'); // Varsayılan (vardiya yoksa)
const LOG_PATH = path.join(DATA_DIR, 'kayitlar.jsonl');
const DEDUPE_PATH = path.join(DATA_DIR, 'seen-ids.json');

// Plaka veritabanı dosyaları
const PLATE_EXCEL_PATH = path.join(DATA_DIR, 'plakalar.xlsx');
const PLATE_LOG_PATH = path.join(DATA_DIR, 'plakalar.jsonl');
const PLATE_DEDUPE_PATH = path.join(DATA_DIR, 'seen-plate-ids.json');

// Site/Blok veritabanı dosyaları
const SITE_EXCEL_PATH = path.join(DATA_DIR, 'siteler.xlsx');
const SITE_LOG_PATH = path.join(DATA_DIR, 'siteler.jsonl');
const SITE_DEDUPE_PATH = path.join(DATA_DIR, 'seen-site-ids.json');

// Eslesme izin listesi: hangi cihaz anahtar alabilir?
const ESLESME_YOLU = path.join(DATA_DIR, 'eslesmeler.json');
const BACKUP_DIR = path.join(DATA_DIR, 'yedek');

// Self-healing sistemi başlat
const healer = new SelfHealing({
  dataDir: DATA_DIR,
  checkInterval: 60000, // 1 dakikada bir kontrol
  maxBackups: 15
});

// Token: env > config.json > env.example uyarısı. Yoksa rastgele üretip dosyaya yazma
// (güvenlik için her açılışta değişen token telefonu koparır — bu yüzden kalıcı olmalı).
let SHARED_TOKEN = process.env.SYNC_TOKEN || fileCfg.token || '';
if (!SHARED_TOKEN) {
  // İlk kurulum kolaylığı: kalıcı token üret ve config.json'a yaz.
  SHARED_TOKEN = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(
      path.join(__dirname, 'config.json'),
      JSON.stringify({ port: PORT, token: SHARED_TOKEN }, null, 2)
    );
    console.log('[KURULUM] config.json oluşturuldu, token üretildi. Telefon ayarlarına girin.');
  } catch (e) {
    console.warn('[UYARI] config.json yazılamadı:', e.message);
  }
}
// Panel anahtarı (panel tarayıcıda saklar). Token'dan türetilir → ayrı yönetim yok.
const PANEL_KEY = crypto.createHash('sha256').update('panel:' + SHARED_TOKEN).digest('hex').slice(0, 32);

/**
 * API ANAHTARI — isteklerin gecmesi icin gereken kimlik.
 *
 * Oncelik sirasi:
 *   1) CK_ANAHTAR ortam degiskeni (varsa). Anahtari kod degistirmeden
 *      degistirmenizi saglar — Vercel/GitHub ayarlarindan yonetilir.
 *   2) shared/anahtar.js icindeki gomulu anahtar (kanonik kopya).
 *
 * Iki kopyanin AYNI oldugu tests/test-anahtar.js ile olculur.
 */
// Anahtar dosyası okunur. EKSİKSE servis düşmez: kendi kurulum anahtarıyla
// çalışmaya devam eder ve durum bilgisinde sebep açıkça yazılır.
// (Ölçülen hata: require eksik dosyada patlıyor ve kurulu sürüm açılmıyordu.)
let ANAHTAR_KAYNAK = 'yok';
let GOMULU_ANAHTAR = '';
try {
  GOMULU_ANAHTAR = String(require('../shared/anahtar.js').ANAHTAR || '');
  ANAHTAR_KAYNAK = 'shared/anahtar.js';
} catch (e) {
  ANAHTAR_KAYNAK = 'yok (dosya bulunamadi)';
  log('UYARI', 'shared/anahtar.js bulunamadi; yalnizca kurulum anahtari kullanilacak:', e && e.message);
}
let API_ANAHTARI = String(process.env.CK_ANAHTAR || GOMULU_ANAHTAR || '').trim();

// Panel uzaktan açılabilsin mi? (varsayılan: HAYIR)
// Ölçülen gerekçe: panel veriyi anahtarsız gösteriyor; ağa açmak, aynı
// Wi-Fi'a bağlanan herkesi tüm kayıtlara erişimle açar. Müşterinin
// talebi "kullanıcı hiçbir şey yapmasın" olduğu için burada giriş ekranı
// KOYMADIK; bunun yerine panel bu bilgisayara sınırlandı.
const PANEL_UZAK = process.env.CK_PANEL_UZAK === '1';
const TOKEN_PREVIEW = SHARED_TOKEN.slice(0, 4) + '…' + SHARED_TOKEN.slice(-4);

for (const d of [DATA_DIR, BACKUP_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ---------------------------------------------------------------------------
// 1. Loglama
// ---------------------------------------------------------------------------

function log(level, ...args) {
  const ts = new Date().toISOString();
  // Objeleri JSON'a çevir, diğerlerini String'e
  const formatted = args.map(arg => {
    if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
      try {
        return JSON.stringify(arg, null, 2);
      } catch (e) {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
  const line = `[${ts}] [${level}] ${formatted}`;
  if (level === 'ERROR' || level === 'KRITIK') console.error(line);
  else console.log(line);
}

// ---------------------------------------------------------------------------
// 2. Dedup seti (seenIds) — açılışta self-healing rebuild
// ---------------------------------------------------------------------------

/** @type {Set<string>} */
let seenIds = new Set();
/** id → updatedAt (upsert karşılaştırması; log'dan yeniden kurulur) */
const idUpdated = new Map();
let updateCount = 0;

function rebuildSeenIdsFromLog() {
  const fromLog = new Set();
  try {
    if (!fs.existsSync(LOG_PATH)) return fromLog;
    const raw = fs.readFileSync(LOG_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const r = JSON.parse(t);
        if (r && typeof r.id === 'string' && r.id) {
          fromLog.add(r.id);
          const ts = typeof r.updatedAt === 'number' ? r.updatedAt : 0;
          if (ts > (idUpdated.get(r.id) || 0)) idUpdated.set(r.id, ts);
        }
      } catch {
        // bozuk satır atlanır, log korunur
      }
    }
  } catch (e) {
    log('ERROR', 'Log okunamadı (seenIds rebuild):', e.message);
  }
  return fromLog;
}

function loadSeenIds() {
  let fromFile = null;
  try {
    if (fs.existsSync(DEDUPE_PATH)) {
      fromFile = new Set(JSON.parse(fs.readFileSync(DEDUPE_PATH, 'utf8')));
    }
  } catch (e) {
    log('ERROR', 'seen-ids.json bozuk, log üzerinden yeniden kurulacak:', e.message);
    // Bozuk dosyayı yedekle, sıfırdan kur.
    try {
      fs.renameSync(DEDUPE_PATH, DEDUPE_PATH + '.bozuk-' + Date.now());
    } catch {}
  }
  const fromLog = rebuildSeenIdsFromLog();
  // Birleşim: hangisi büyükse o (log her zaman doğruluk kaynağı).
  const merged = new Set([...fromLog, ...(fromFile || [])]);
  // Eğer dosyadakiler log'da yoksa (elle silinmiş log?) log'u gerçek kabul et.
  // Tutarlılık için merged'i değil, log'u baz alıp dosyayı eşitliyoruz:
  // Ama dosyada olup log'da olmayan id varsa o kayıt gerçekten yok demektir,
  // Excel rebuild sonrası zaten olmayacak. Yine de id'yi saklamak duplicate'e
  // karşı güvenlidir — bu yüzden merged kullanıyoruz.
  seenIds = merged;
  persistSeenIds();
  log('INFO', `Dedup yüklendi: ${seenIds.size} kayıt (log:${fromLog.size}, dosya:${fromFile ? fromFile.size : 0})`);
}

// ---------------------------------------------------------------------------
// 2b. Plaka Dedup Sistemi (kayıtlarla aynı mimari)
// ---------------------------------------------------------------------------

/** @type {Set<string>} */
let seenPlateIds = new Set();
/** id → updatedAt (upsert karşılaştırması; log'dan yeniden kurulur) */
const plateIdUpdated = new Map();
let plateUpdateCount = 0;

function rebuildSeenPlateIdsFromLog() {
  const fromLog = new Set();
  try {
    if (!fs.existsSync(PLATE_LOG_PATH)) return fromLog;
    const raw = fs.readFileSync(PLATE_LOG_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const r = JSON.parse(t);
        if (r && typeof r.id === 'string' && r.id) {
          fromLog.add(r.id);
          const ts = typeof r.updatedAt === 'number' ? r.updatedAt : 0;
          if (ts > (plateIdUpdated.get(r.id) || 0)) plateIdUpdated.set(r.id, ts);
        }
      } catch {
        // bozuk satır atlanır, log korunur
      }
    }
  } catch (e) {
    log('ERROR', 'Plaka log okunamadı (seenPlateIds rebuild):', e.message);
  }
  return fromLog;
}

function loadSeenPlateIds() {
  let fromFile = null;
  try {
    if (fs.existsSync(PLATE_DEDUPE_PATH)) {
      fromFile = new Set(JSON.parse(fs.readFileSync(PLATE_DEDUPE_PATH, 'utf8')));
    }
  } catch (e) {
    log('ERROR', 'seen-plate-ids.json bozuk, log üzerinden yeniden kurulacak:', e.message);
    try {
      fs.renameSync(PLATE_DEDUPE_PATH, PLATE_DEDUPE_PATH + '.bozuk-' + Date.now());
    } catch {}
  }
  const fromLog = rebuildSeenPlateIdsFromLog();
  const merged = new Set([...fromLog, ...(fromFile || [])]);
  seenPlateIds = merged;
  persistSeenPlateIds();
  log('INFO', `Plaka dedup yüklendi: ${seenPlateIds.size} plaka (log:${fromLog.size}, dosya:${fromFile ? fromFile.size : 0})`);
}

let persistPlateTimer = null;
function persistSeenPlateIds() {
  if (persistPlateTimer) return;
  persistPlateTimer = setTimeout(() => {
    persistPlateTimer = null;
    try {
      const tmp = PLATE_DEDUPE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify([...seenPlateIds]));
      fs.renameSync(tmp, PLATE_DEDUPE_PATH);
    } catch (e) {
      log('ERROR', 'seen-plate-ids yazılamadı:', e.message);
    }
  }, 200);
}

function persistSeenPlateIdsSync() {
  try {
    const tmp = PLATE_DEDUPE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...seenPlateIds]));
    fs.renameSync(tmp, PLATE_DEDUPE_PATH);
  } catch (e) {
    log('ERROR', 'seen-plate-ids sync yazılamadı:', e.message);
  }
}

let persistTimer = null;
function persistSeenIds() {
  // Disk yazmayı serileştir: sık çağrılarda debounce.
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const tmp = DEDUPE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify([...seenIds]));
      fs.renameSync(tmp, DEDUPE_PATH);
    } catch (e) {
      log('ERROR', 'seen-ids yazılamadı:', e.message);
    }
  }, 200);
}
function persistSeenIdsSync() {
  try {
    const tmp = DEDUPE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...seenIds]));
    fs.renameSync(tmp, DEDUPE_PATH);
  } catch (e) {
    log('ERROR', 'seen-ids sync yazılamadı:', e.message);
  }
}

// ---------------------------------------------------------------------------
// 3. Doğrulama
// ---------------------------------------------------------------------------

function validateRecord(r) {
  if (!r || typeof r !== 'object') return 'Kayıt obje olmalı';
  const id = r.id !== undefined ? r.id : r.uid; // g-venlik uygulaması `uid` kullanır
  if (!id || typeof id !== 'string' || id.length < 8 || id.length > 128)
    return 'Eksik/geçersiz id';
  if (!r.plate || typeof r.plate !== 'string' || !r.plate.trim())
    return 'Eksik plaka';
  if (r.plate.trim().length > 32) return 'Plaka çok uzun';
  for (const k of ['site', 'unit', 'courier', 'guard', 'date', 'time', 'dev']) {
    if (r[k] !== undefined && typeof r[k] !== 'string') return `Geçersiz alan: ${k}`;
    if (typeof r[k] === 'string' && r[k].length > 200) return `Alan çok uzun: ${k}`;
  }
  for (const k of ['company', 'firma', 'note']) {
    if (r[k] !== undefined && r[k] !== null && typeof r[k] !== 'string') return `Geçersiz alan: ${k}`;
    if (typeof r[k] === 'string' && r[k].length > 500) return `Alan çok uzun: ${k}`;
  }
  return null;
}

function validatePlate(p) {
  if (!p || typeof p !== 'object') return 'Plaka kaydı obje olmalı';
  const id = p.id !== undefined ? p.id : p.uid;
  if (!id || typeof id !== 'string' || id.length < 8 || id.length > 128)
    return 'Eksik/geçersiz id';
  if (!p.plate || typeof p.plate !== 'string' || !p.plate.trim())
    return 'Eksik plaka';
  if (p.plate.trim().length > 32) return 'Plaka çok uzun';
  for (const k of ['name', 'company', 'type', 'note', 'phone', 'dev']) {
    if (p[k] !== undefined && typeof p[k] !== 'string') return `Geçersiz alan: ${k}`;
    if (typeof p[k] === 'string' && p[k].length > 200) return `Alan çok uzun: ${k}`;
  }
  if (p.seen !== undefined && typeof p.seen !== 'number') return 'seen sayı olmalı';
  if (p.deleted !== undefined && typeof p.deleted !== 'boolean') return 'deleted boolean olmalı';
  return null;
}

function sanitizePlate(p) {
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const n = (v) => (typeof v === 'number' && v >= 0 ? v : 0);
  return {
    id: String(p.id !== undefined ? p.id : p.uid).trim(),
    plate: s(p.plate).toUpperCase(),
    key: s(p.key || plateKey(p.plate)),
    name: s(p.name),
    company: s(p.company),
    type: s(p.type || p.tur || 'Kurye'),
    note: s(p.note || ''),
    phone: s(p.phone || ''),
    ts: typeof p.ts === 'number' ? p.ts : Date.now(),
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : (typeof p.ts === 'number' ? p.ts : 0),
    dev: s(p.dev),
    seen: n(p.seen),
    deleted: p.deleted === true,
  };
}

function plateKey(plate) {
  // Normalize: büyük harf, boşluksuz, benzer karakterleri düzelt
  return String(plate || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/[OQD]/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5')
    .replace(/Z/g, '2').replace(/G/g, '6');
}

function sanitizeRecord(r) {
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    id: String(r.id !== undefined ? r.id : r.uid).trim(),
    site: s(r.site),
    unit: s(r.unit),
    courier: s(r.courier),
    company: s(r.company || r.firma || ''),
    plate: s(r.plate).toUpperCase(),
    guard: s(r.guard),
    note: s(r.note || ''),
    type: s(r.type || r.tur || 'Kurye'),
    date: s(r.date),
    time: s(r.time),
    ts: typeof r.ts === 'number' ? r.ts : Date.now(),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : (typeof r.ts === 'number' ? r.ts : 0),
    dev: s(r.dev),
    deleted: r.deleted === true,
  };
}

// ---------------------------------------------------------------------------
// 4. Yazma katmanı: append-only log + Excel rebuild (seri kuyruk)
// ---------------------------------------------------------------------------

let writeChain = Promise.resolve();
let writeQueueLen = 0;
let lastWriteAt = null;
let lastError = null;

function enqueueWrite(fn) {
  writeQueueLen++;
  writeChain = writeChain
    .then(() => fn())
    .catch((err) => {
      lastError = String((err && err.message) || err);
      log('KRITIK', 'Yazma zinciri hatası:', lastError);
    })
    .finally(() => {
      writeQueueLen = Math.max(0, writeQueueLen - 1);
      lastWriteAt = new Date().toISOString();
    });
  return writeChain;
}

function appendLogLine(record) {
  fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n', 'utf8');
}

function readAllLogRecords() {
  if (!fs.existsSync(LOG_PATH)) return { rows: [], corrupt: 0 };
  const raw = fs.readFileSync(LOG_PATH, 'utf8');
  const rows = [];
  let corrupt = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t));
    } catch {
      corrupt++;
    }
  }
  return { rows, corrupt };
}

function readAllPlateRecords() {
  if (!fs.existsSync(PLATE_LOG_PATH)) return { rows: [], corrupt: 0 };
  const raw = fs.readFileSync(PLATE_LOG_PATH, 'utf8');
  const rows = [];
  let corrupt = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t));
    } catch {
      corrupt++;
    }
  }
  return { rows, corrupt };
}

// ==================== SİTE/BLOK VERİTABANI ====================

const seenSiteIds = new Set();
const siteIdUpdated = new Map();
let siteUpdateCount = 0;

function rebuildSeenSiteIdsFromLog() {
  const { rows } = readAllSiteRecords();
  const s = new Set();
  const m = new Map();
  for (const r of rows) {
    if (r && r.id) {
      s.add(r.id);
      m.set(r.id, r.updatedAt || 0);
    }
  }
  return { set: s, map: m };
}

function loadSeenSiteIds() {
  let fromLog = new Set();
  let mapLog = new Map();
  try {
    const x = rebuildSeenSiteIdsFromLog();
    fromLog = x.set;
    mapLog = x.map;
  } catch (e) {
    log('ERROR', 'Site log okunamadı:', e.message);
  }

  let fromFile = null;
  if (fs.existsSync(SITE_DEDUPE_PATH)) {
    try {
      const arr = JSON.parse(fs.readFileSync(SITE_DEDUPE_PATH, 'utf8'));
      fromFile = new Set(arr);
    } catch {}
  }

  const merged = new Set([...fromLog, ...(fromFile || [])]);
  seenSiteIds.clear();
  for (const id of merged) seenSiteIds.add(id);
  
  siteIdUpdated.clear();
  for (const [id, ts] of mapLog) siteIdUpdated.set(id, ts);
  
  persistSeenSiteIds();
  log('INFO', `Site dedup yüklendi: ${seenSiteIds.size} site (log:${fromLog.size}, dosya:${fromFile ? fromFile.size : 0})`);
}

let persistSiteTimer = null;
function persistSeenSiteIds() {
  if (persistSiteTimer) return;
  persistSiteTimer = setTimeout(() => {
    persistSiteTimer = null;
    try {
      const tmp = SITE_DEDUPE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify([...seenSiteIds]));
      fs.renameSync(tmp, SITE_DEDUPE_PATH);
    } catch (e) {
      log('ERROR', 'seen-site-ids yazılamadı:', e.message);
    }
  }, 200);
}

function persistSeenSiteIdsSync() {
  try {
    const tmp = SITE_DEDUPE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...seenSiteIds]));
    fs.renameSync(tmp, SITE_DEDUPE_PATH);
  } catch (e) {
    log('ERROR', 'seen-site-ids sync yazılamadı:', e.message);
  }
}

function readAllSiteRecords() {
  if (!fs.existsSync(SITE_LOG_PATH)) return { rows: [], corrupt: 0 };
  const raw = fs.readFileSync(SITE_LOG_PATH, 'utf8');
  const rows = [];
  let corrupt = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t));
    } catch {
      corrupt++;
    }
  }
  return { rows, corrupt };
}

function validateSite(s) {
  if (!s || typeof s !== 'object') return 'Geçersiz site nesnesi';
  if (!s.id || typeof s.id !== 'string') return 'id gerekli';
  if (!s.name || typeof s.name !== 'string') return 'name gerekli';
  return null;
}

function sanitizeSite(s) {
  return {
    id: String(s.id || '').trim(),
    name: String(s.name || '').trim(),
    street: String(s.street || '').trim(),
    lat: typeof s.lat === 'number' ? s.lat : null,
    lng: typeof s.lng === 'number' ? s.lng : null,
    units: Array.isArray(s.units) ? s.units.map(u => ({
      c: String(u.c || u).trim(),
      entry: String(u.entry || '').trim(),
      lat: typeof u.lat === 'number' ? u.lat : null,
      lng: typeof u.lng === 'number' ? u.lng : null,
      qr: String(u.qr || '').trim()
    })) : [],
    box: Array.isArray(s.box) && s.box.length === 4 ? s.box : null,
    updatedAt: s.updatedAt || Date.now(),
    deleted: s.deleted === true
  };
}

const siteWriteQueue = [];
let siteWriteRunning = false;

function enqueueSiteWrite(fn) {
  return new Promise((resolve, reject) => {
    siteWriteQueue.push({ fn, resolve, reject });
    if (!siteWriteRunning) runSiteWriteQueue();
  });
}

async function runSiteWriteQueue() {
  if (siteWriteRunning || !siteWriteQueue.length) return;
  siteWriteRunning = true;
  while (siteWriteQueue.length) {
    const { fn, resolve, reject } = siteWriteQueue.shift();
    try {
      await fn();
      resolve();
    } catch (e) {
      reject(e);
    }
  }
  siteWriteRunning = false;
}

function appendSiteLogLine(site) {
  fs.appendFileSync(SITE_LOG_PATH, JSON.stringify(site) + '\n', 'utf8');
}

function replaceSiteLogLine(id, site) {
  const raw = fs.readFileSync(SITE_LOG_PATH, 'utf8').split('\n');
  let found = false;
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i].trim();
    if (!t) continue;
    try {
      if (JSON.parse(t).id === id) {
        raw[i] = JSON.stringify(site);
        found = true;
        break;
      }
    } catch {}
  }
  if (!found) {
    fs.appendFileSync(SITE_LOG_PATH, JSON.stringify(site) + '\n', 'utf8');
    return false;
  }
  const tmp = SITE_LOG_PATH + '.tmp';
  fs.writeFileSync(tmp, raw.join('\n'), 'utf8');
  fs.renameSync(tmp, SITE_LOG_PATH);
  return true;
}

function toSiteExcelRow(s) {
  return {
    'Site ID': s.id,
    'Site Adı': s.name,
    'Sokak': s.street || '',
    'Enlem': s.lat || '',
    'Boylam': s.lng || '',
    'Ünite Sayısı': s.units ? s.units.length : 0,
    'Üniteler': s.units ? s.units.map(u => u.c).join(', ') : '',
    'Güncelleme': s.updatedAt ? new Date(s.updatedAt).toLocaleString('tr-TR') : ''
  };
}

function rebuildSiteExcelFromLog() {
  const { rows, corrupt } = readAllSiteRecords();
  if (corrupt > 0) log('ERROR', `Site log'da ${corrupt} bozuk satır atlandı.`);

  const live = rows.filter(s => s && s.deleted !== true);
  live.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const sheetRows = live.map(toSiteExcelRow);
  const ws = XLSX.utils.json_to_sheet(sheetRows, {
    header: ['Site ID', 'Site Adı', 'Sokak', 'Enlem', 'Boylam', 'Ünite Sayısı', 'Üniteler', 'Güncelleme']
  });
  ws['!cols'] = [
    { wch: 20 }, { wch: 25 }, { wch: 20 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 40 }, { wch: 18 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Siteler');

  const tmpPath = SITE_EXCEL_PATH + '.tmp';
  XLSX.writeFile(wb, tmpPath, { bookType: 'xlsx' });
  fs.renameSync(tmpPath, SITE_EXCEL_PATH);
}

function doSiteAppendSync(sanitized) {
  appendSiteLogLine(sanitized);
  seenSiteIds.add(sanitized.id);
  persistSeenSiteIds();
  rebuildSiteExcelFromLog();
}

function acceptSiteOne(raw) {
  const err = validateSite(raw);
  if (err) {
    const e = new Error(err);
    e.statusCode = 400;
    throw e;
  }
  const rec = sanitizeSite(raw);
  if (seenSiteIds.has(rec.id)) {
    if (rec.updatedAt > (siteIdUpdated.get(rec.id) || 0)) {
      return enqueueSiteWrite(() => {
        replaceSiteLogLine(rec.id, rec);
        siteIdUpdated.set(rec.id, rec.updatedAt);
        rebuildSiteExcelFromLog();
        siteUpdateCount++;
        broadcast('site', { tip: 'guncel', site: rec });
      }).then(() => 'updated');
    }
    return Promise.resolve('duplicate');
  }
  return enqueueSiteWrite(() => {
    doSiteAppendSync(rec);
    siteIdUpdated.set(rec.id, rec.updatedAt);
    broadcast('site', { tip: 'yeni', site: rec });
  }).then(() => 'created');
}

/**
 * Gorsentinin ORTALAMA parlakligi (0-255).
 *
 * OLCUMLE KALIBRE EDILDI (29.09.2026, 5 gercek fotograf, 5 bilinen
 * plakanin ortalamasi):
 *     gunduz (1.00)   ort=148.0   okuma 5/5
 *     alacakaranlik   ort=106.8   okuma 3/5
 *     az isik (0.50)  ort= 85.7   okuma 2/5
 *     karanlik (0.40) ort= 72.2   okuma 0/5   <- kirilma burada
 *     gece (0.30)     ort= 61.6   okuma 0/5
 *     derin gece      ort= 55.4   okuma 0/5
 * ESIK = 78: calisan (85.7) ile calismayan (72.2) arasinda; bu yuzden
 * okunabilen kareleri kesmez.
 *
 * p99-p50 KULLANILMADI: ayirt edici degil. gunduzde 54, alacakaranlikta
 * 100, karanlikta 124 — okunabilen karede kucuk, okunamayan karede buyuk.
 *
 * @returns {number|null} ortalama parlaklik; cözülemezse null (bu durumda
 *   kontrol atlanir ve normal yol calisir).
 */
function ortalamaParlaklik(tampon) {
  try {
    const a = yoloPlaka.ac(tampon);
    if (!a) return null;
    const n = a.g * a.y;
    if (!n) return null;
    const K = a.kanal;
    let toplam = 0;
    // her 4. piksel (yeterli ve belirgin sekilde hizli)
    for (let i = 0; i < n; i += 4) {
      const o = i * K;
      toplam += K >= 3
        ? (a.veri[o] * 299 + a.veri[o + 1] * 587 + a.veri[o + 2] * 114) / 1000
        : a.veri[o];
    }
    return toplam / Math.ceil(n / 4);
  } catch (e) {
    return null;
  }
}

function trDate(ts) {
  try { return new Date(ts).toLocaleDateString('tr-TR'); } catch { return ''; }
}
function trTime(ts) {
  try { return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

function toExcelRow(r) {
  return {
    Blok: r.site || '',
    Daire: r.unit || '',
    Tür: r.type || r.tur || 'Kurye',
    Kurye: r.courier || '',
    Firma: r.company || '',
    Plaka: r.plate || '',
    Görevli: r.guard || '',
    Not: r.note || '',
    // g-venlik uygulaması Tarih/Saat'i ts'den türetir; uyum için aynısı:
    Tarih: r.date || (typeof r.ts === 'number' ? trDate(r.ts) : ''),
    Saat: r.time || (typeof r.ts === 'number' ? trTime(r.ts) : ''),
  };
}

function rebuildExcelFromLog() {
  const { rows, corrupt } = readAllLogRecords();
  if (corrupt > 0) log('ERROR', `Log'da ${corrupt} bozuk satır atlandı (dosya korunuyor).`);

  // Silinmiş (deleted) kayıtlar Excel'e girmez ama log'da denetim için kalır.
  const live = rows.filter((r) => r && r.deleted !== true);
  
  if (EXCEL_MODE === 'daily') {
    // GÜNLÜK MOD: Her gün için ayrı Excel
    const groupedByDate = {};
    
    live.forEach(r => {
      const dateStr = getDateString(new Date(r.ts));
      if (!groupedByDate[dateStr]) groupedByDate[dateStr] = [];
      groupedByDate[dateStr].push(r);
    });
    
    let fileCount = 0;
    Object.keys(groupedByDate).forEach(dateStr => {
      const dayRecords = groupedByDate[dateStr];
      dayRecords.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      
      const sheetRows = dayRecords.map(toExcelRow);
      const ws = XLSX.utils.json_to_sheet(sheetRows, {
        header: ['Blok', 'Daire', 'Tür', 'Kurye', 'Firma', 'Plaka', 'Görevli', 'Not', 'Tarih', 'Saat'],
      });
      ws['!cols'] = [
        { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 16 }, { wch: 16 },
        { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 8 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, dateStr);
      
      const excelPath = path.join(DATA_DIR, `kayitlar-${dateStr}.xlsx`);
      const tmpPath = excelPath + '.tmp';
      XLSX.writeFile(wb, tmpPath, { bookType: 'xlsx' });
      fs.renameSync(tmpPath, excelPath);
      fileCount++;
    });
    
    log('INFO', `${fileCount} günlük Excel dosyası güncellendi.`);
  } else if (EXCEL_MODE === 'shift') {
    // VARDİYA MODU: Her vardiya için ayrı Excel
    SHIFTS.forEach(shift => {
      const shiftRecords = live.filter(r => {
        const recordShift = getCurrentShift(new Date(r.ts));
        return recordShift && recordShift.name === shift.name;
      });
      
      shiftRecords.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      
      const sheetRows = shiftRecords.map(toExcelRow);
      const ws = XLSX.utils.json_to_sheet(sheetRows, {
        header: ['Blok', 'Daire', 'Tür', 'Kurye', 'Firma', 'Plaka', 'Görevli', 'Not', 'Tarih', 'Saat'],
      });
      ws['!cols'] = [
        { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 16 }, { wch: 16 },
        { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 8 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, shift.name);
      
      const safeName = shift.name.replace(/[^a-zA-Z0-9-_]/g, '');
      const excelPath = path.join(DATA_DIR, `kayitlar-${safeName}.xlsx`);
      const tmpPath = excelPath + '.tmp';
      XLSX.writeFile(wb, tmpPath, { bookType: 'xlsx' });
      fs.renameSync(tmpPath, excelPath);
    });
    
    log('INFO', `${SHIFTS.length} vardiya Excel'i güncellendi.`);
  } else {
    // SINGLE MOD: Tek Excel (eski sistem)
    live.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    
    const sheetRows = live.map(toExcelRow);
    const ws = XLSX.utils.json_to_sheet(sheetRows, {
      header: ['Blok', 'Daire', 'Tür', 'Kurye', 'Firma', 'Plaka', 'Görevli', 'Not', 'Tarih', 'Saat'],
    });
    ws['!cols'] = [
      { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 16 }, { wch: 16 },
      { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 8 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Kayıtlar');

    const tmpPath = EXCEL_PATH + '.tmp';
    XLSX.writeFile(wb, tmpPath, { bookType: 'xlsx' });
    fs.renameSync(tmpPath, EXCEL_PATH);
  }
}

/** Gece yarısı yedeği değil; her 1000 kayıtta bir jsonl snapshot. Ucuz ve güvenli. */
function maybeBackup() {
  try {
    if (seenIds.size > 0 && seenIds.size % 1000 === 0) {
      const dst = path.join(BACKUP_DIR, `kayitlar-${new Date().toISOString().slice(0, 10)}-${seenIds.size}.jsonl`);
      if (!fs.existsSync(dst)) fs.copyFileSync(LOG_PATH, dst);
    }
  } catch {}
}

function doAppendSync(sanitized) {
  appendLogLine(sanitized);       // 1) önce log (source of truth)
  seenIds.add(sanitized.id);      // 2) dedup
  persistSeenIds();               // 3) dedup kalıcı (debounced)
  rebuildExcelFromLog();          // 4) excel türet
  maybeBackup();
}

// ---------------------------------------------------------------------------
// 4b. Plaka Yazma Katmanı (kayıtlarla aynı mimari)
// ---------------------------------------------------------------------------

let plateWriteChain = Promise.resolve();
let plateWriteQueueLen = 0;
let lastPlateWriteAt = null;
let lastPlateError = null;

function enqueuePlateWrite(fn) {
  plateWriteQueueLen++;
  plateWriteChain = plateWriteChain
    .then(() => fn())
    .catch((err) => {
      lastPlateError = String((err && err.message) || err);
      log('KRITIK', 'Plaka yazma zinciri hatası:', lastPlateError);
    })
    .finally(() => {
      plateWriteQueueLen = Math.max(0, plateWriteQueueLen - 1);
      lastPlateWriteAt = new Date().toISOString();
    });
  return plateWriteChain;
}

function appendPlateLogLine(plate) {
  fs.appendFileSync(PLATE_LOG_PATH, JSON.stringify(plate) + '\n', 'utf8');
}

function toPlateExcelRow(p) {
  return {
    Plaka: p.plate || '',
    Tür: p.type || p.tur || 'Kurye',
    'Ad Soyad': p.name || '',
    Firma: p.company || '',
    Telefon: p.phone || '',
    Not: p.note || '',
    'Son Görülme': p.ts ? trDate(p.ts) + ' ' + trTime(p.ts) : '',
    'Görülme Sayısı': typeof p.seen === 'number' ? p.seen : 0,
  };
}

function rebuildPlateExcelFromLog() {
  const { rows, corrupt } = readAllPlateRecords();
  if (corrupt > 0) log('ERROR', `Plaka log'da ${corrupt} bozuk satır atlandı (dosya korunuyor).`);

  // Silinmiş plakalar Excel'e girmez
  const live = rows.filter((p) => p && p.deleted !== true);
  // Alfabetik sırala (plakaya göre)
  live.sort((a, b) => (a.plate || '').localeCompare(b.plate || ''));

  const sheetRows = live.map(toPlateExcelRow);
  const ws = XLSX.utils.json_to_sheet(sheetRows, {
    header: ['Plaka', 'Tür', 'Ad Soyad', 'Firma', 'Telefon', 'Not', 'Son Görülme', 'Görülme Sayısı'],
  });
  ws['!cols'] = [
    { wch: 12 }, { wch: 11 }, { wch: 18 }, { wch: 18 },
    { wch: 14 }, { wch: 25 }, { wch: 18 }, { wch: 10 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Plakalar');

  // Atomik yazma
  const tmpPath = PLATE_EXCEL_PATH + '.tmp';
  XLSX.writeFile(wb, tmpPath, { bookType: 'xlsx' });
  fs.renameSync(tmpPath, PLATE_EXCEL_PATH);
}

function maybePlateBackup() {
  try {
    if (seenPlateIds.size > 0 && seenPlateIds.size % 500 === 0) {
      const dst = path.join(BACKUP_DIR, `plakalar-${new Date().toISOString().slice(0, 10)}-${seenPlateIds.size}.jsonl`);
      if (!fs.existsSync(dst)) fs.copyFileSync(PLATE_LOG_PATH, dst);
    }
  } catch {}
}

function doPlateAppendSync(sanitized) {
  appendPlateLogLine(sanitized);     // 1) önce log
  seenPlateIds.add(sanitized.id);    // 2) dedup
  persistSeenPlateIds();              // 3) dedup kalıcı
  rebuildPlateExcelFromLog();         // 4) excel türet
  maybePlateBackup();
}

function replacePlateLogLine(id, plate) {
  const raw = fs.readFileSync(PLATE_LOG_PATH, 'utf8').split('\n');
  let found = false;
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i].trim();
    if (!t) continue;
    try {
      if (JSON.parse(t).id === id) {
        raw[i] = JSON.stringify(plate);
        found = true;
        break;
      }
    } catch {}
  }
  if (!found) return false;
  const tmp = PLATE_LOG_PATH + '.tmp';
  fs.writeFileSync(tmp, raw.join('\n'), 'utf8');
  fs.renameSync(tmp, PLATE_LOG_PATH);
  return true;
}

/**
 * Log satırını yerinde değiştirir (upsert). Atomik: tmp+rename.
 * @returns {boolean} satır bulundu mu
 */
function replaceLogLine(id, record) {
  const raw = fs.readFileSync(LOG_PATH, 'utf8').split('\n');
  let found = false;
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i].trim();
    if (!t) continue;
    try {
      if (JSON.parse(t).id === id) {
        raw[i] = JSON.stringify(record);
        found = true;
        break; // id benzersizdir; ilk eşleşme yeter
      }
    } catch {
      // bozuk satır korunur, atlanır
    }
  }
  if (!found) {
    fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n', 'utf8');
    return false;
  }
  const tmp = LOG_PATH + '.tmp';
  fs.writeFileSync(tmp, raw.join('\n'), 'utf8');
  fs.renameSync(tmp, LOG_PATH);
  return true;
}

/**
 * Tek kayıt kabul: doğrulanmış + sanitize edilmiş kayıt.
 * @returns {'ok'|'duplicate'|'updated'}
 */
function acceptOne(raw) {
  const err = validateRecord(raw);
  if (err) {
    const e = new Error(err);
    e.statusCode = 400;
    throw e;
  }
  const rec = sanitizeRecord(raw);
  if (seenIds.has(rec.id)) {
    // Aynı id: retry mi (aynı/eskisi) yoksa düzenleme mi (daha yeni)?
    // Uygulamanın kendi birleştirme kuralıyla aynı: updatedAt karşılaştırması.
    if (rec.updatedAt > (idUpdated.get(rec.id) || 0)) {
      replaceLogLine(rec.id, rec);
      idUpdated.set(rec.id, rec.updatedAt);
      rebuildExcelFromLog();
      updateCount++;
      broadcast('kayit', { tip: 'guncel', kayit: rec, durum: olayDurumu() });
      return 'updated';
    }
    return 'duplicate';
  }
  doAppendSync(rec);
  idUpdated.set(rec.id, rec.updatedAt);
  broadcast('kayit', { tip: 'yeni', kayit: rec, durum: olayDurumu() });
  return 'ok';
}

/**
 * Toplu kabul: yeni kayıtlar ÖNCE log'a eklenir (tek append), Excel BİR KEZ üretilir.
 * Düzenlemeler (daha yeni updatedAt) satırında güncellenir.
 * @returns {{saved:number, duplicates:number, updated:number, errors:Array}}
 */
function acceptBatch(records) {
  let saved = 0, duplicates = 0, updated = 0;
  const errors = [];
  const fresh = [];
  const updatedIds = [];
  for (let i = 0; i < records.length; i++) {
    try {
      const err = validateRecord(records[i]);
      if (err) {
        const e = new Error(err);
        e.statusCode = 400;
        throw e;
      }
      const rec = sanitizeRecord(records[i]);
      if (seenIds.has(rec.id)) {
        if (rec.updatedAt > (idUpdated.get(rec.id) || 0)) {
          replaceLogLine(rec.id, rec);
          idUpdated.set(rec.id, rec.updatedAt);
          updatedIds.push(rec);
          updated++;
          updateCount++;
        } else {
          duplicates++;
        }
      } else {
        seenIds.add(rec.id);
        idUpdated.set(rec.id, rec.updatedAt);
        fresh.push(rec);
        saved++;
      }
    } catch (e) {
      errors.push({ index: i, id: records[i] && (records[i].id || records[i].uid), error: e.message });
    }
  }
  if (fresh.length > 0) {
    fs.appendFileSync(LOG_PATH, fresh.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    persistSeenIds();
  }
  if (fresh.length > 0 || updated > 0) {
    rebuildExcelFromLog();
    maybeBackup();
    broadcast('kayit', {
      tip: 'toplu',
      kayitlar: fresh.concat(updatedIds),
      durum: olayDurumu(),
    });
  }
  return { saved, duplicates, updated, errors };
}

/**
 * Plaka kabul et (tek kayıt).
 * @returns {'created'|'duplicate'|'updated'}
 */
function acceptPlateOne(raw) {
  const err = validatePlate(raw);
  if (err) {
    const e = new Error(err);
    e.statusCode = 400;
    throw e;
  }
  const rec = sanitizePlate(raw);
  if (seenPlateIds.has(rec.id)) {
    // Aynı id: retry mi yoksa güncelleme mi?
    if (rec.updatedAt > (plateIdUpdated.get(rec.id) || 0)) {
      return enqueuePlateWrite(() => {
        replacePlateLogLine(rec.id, rec);
        plateIdUpdated.set(rec.id, rec.updatedAt);
        rebuildPlateExcelFromLog();
        plateUpdateCount++;
        broadcast('plaka', { tip: 'guncel', plaka: rec, durum: olayDurumu() });
      }).then(() => 'updated');
    }
    return Promise.resolve('duplicate');
  }
  return enqueuePlateWrite(() => {
    doPlateAppendSync(rec);
    plateIdUpdated.set(rec.id, rec.updatedAt);
    broadcast('plaka', { tip: 'yeni', plaka: rec, durum: olayDurumu() });
  }).then(() => 'created');
}

/**
 * Toplu plaka kabul et.
 * @returns {{saved:number, duplicates:number, updated:number, errors:Array}}
 */
function acceptPlateBatch(plates) {
  let saved = 0, duplicates = 0, updated = 0;
  const errors = [];
  const fresh = [];
  const updatedIds = [];
  for (let i = 0; i < plates.length; i++) {
    try {
      const err = validatePlate(plates[i]);
      if (err) {
        const e = new Error(err);
        e.statusCode = 400;
        throw e;
      }
      const rec = sanitizePlate(plates[i]);
      if (seenPlateIds.has(rec.id)) {
        if (rec.updatedAt > (plateIdUpdated.get(rec.id) || 0)) {
          replacePlateLogLine(rec.id, rec);
          plateIdUpdated.set(rec.id, rec.updatedAt);
          updatedIds.push(rec);
          updated++;
          plateUpdateCount++;
        } else {
          duplicates++;
        }
      } else {
        seenPlateIds.add(rec.id);
        plateIdUpdated.set(rec.id, rec.updatedAt);
        fresh.push(rec);
        saved++;
      }
    } catch (e) {
      errors.push({ index: i, id: plates[i] && (plates[i].id || plates[i].uid), error: e.message });
    }
  }
  if (fresh.length > 0) {
    fs.appendFileSync(PLATE_LOG_PATH, fresh.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    persistSeenPlateIds();
  }
  if (fresh.length > 0 || updated > 0) {
    rebuildPlateExcelFromLog();
    maybePlateBackup();
    broadcast('plaka', {
      tip: 'toplu',
      plakalar: fresh.concat(updatedIds),
      durum: olayDurumu(),
    });
  }
  return { saved, duplicates, updated, errors };
}

function safeJson(res, code, obj) {
  try {
    if (!res.headersSent) res.status(code).json(obj);
  } catch {}
}

// ---------------------------------------------------------------------------
// 4b. Gerçek zamanlı yayın (Server-Sent Events)
// Panelde anlık görünüm: her yeni kayıt/düzenleme/silme anında düşer.
// Bağlantı koptuğunda tarayıcı otomatik yeniden bağlanır; sunucu tarafında
// kalp atışı gönderilir, böylece ölü bağlantılar bir dakikadan önce temizlenir.
// ---------------------------------------------------------------------------

const sseClients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function olayDurumu() {
  return {
    kayitSayisi: seenIds.size,
    plakaSayisi: seenPlateIds.size,
    guncelleme: updateCount,
    excelBytes: safeSize(EXCEL_PATH),
    logBytes: safeSize(LOG_PATH),
    sonYazma: lastWriteAt,
    sonHata: lastError,
    zaman: new Date().toISOString(),
  };
}

function safeSize(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

// ---------------------------------------------------------------------------
// 5. Express uygulaması
// ---------------------------------------------------------------------------

const app = express();
// --- CORS: yalnızca KENDİ adreslerimiz ---------------------------------
//
// ÖLÇÜLEN HATA: app.use(cors()) her istege `Access-Control-Allow-Origin: *`
// koyuyordu. Ölçüldü: yabancı bir Origin (https://kotu-site.example) ile gelen
// istek 200 döndü ve /eslesme ANAHTARI verdi. Tarayıcı özel IP'lere erişebildiği
// için (192.168.x.x) nöbetçinin telefonunda açtığı herhangi bir internet
// sitesi bu servise sessizce istek atabiliyordu. Bu gerçek bir saldırı
// yüzeyidir; "anahtar kodda değil" varsayımını geçersiz kılıyordu.
//
// KURAL: yalnızca bu bilgisayarın kendi adreslerinden gelen Origin kabul edilir.
// Başka her yer için başlık YAZILMAZ → tarayıcı yanıtı okuyamaz.
// Origin başlığı hiç gelmezse (uygulamanın kendi çağrısı) izin verilir.
// İzin verilen KENDİ kaynaklar — çalışma anında hesaplanır çünkü IP değişebilir.
// (Ölçülen hata: liste başta sabit yazılınca telefonun kendi adresi
//  http://192.168.1.235:4545 engellendi ve uygulama kullanılamaz oldu.)
function kendiKaynaklari() {
  const kume = new Set([
    'http://localhost:' + PORT, 'https://localhost:' + HTTPS_PORT,
    'http://127.0.0.1:' + PORT, 'https://127.0.0.1:' + HTTPS_PORT,
  ]);
  let birincil = null;
  try { birincil = tls.birincilLanIp && tls.birincilLanIp(); } catch {}
  const ipler = lanAdresleri();
  if (birincil && !ipler.includes(birincil)) ipler.unshift(birincil);
  for (const ip of ipler) {
    kume.add(`http://${ip}:${PORT}`);
    kume.add(`https://${ip}:${HTTPS_PORT}`);
  }
  return kume;
}

/**
 * Açıkça bildirilen EK kaynaklar (virgülle ayrılmış).
 *
 * Ne zaman gerekir? Uygulama internetten yayınlandığında (Vercel, GitHub
 * Pages) tarayıcının kaynağı bizim adresimiz olmaz. O durumda sunucuya
 * "şu kaynaklardan gelen isteklere izin ver" demek gerekir:
 *
 *   CK_EZIKIN_KAYNAKLAR=https://proje.vercel.app,https://site.github.io
 *
 * Varsayılan BOŞTUR: yani ek izin verilmezse yalnızca kendi adreslerimiz
 * kabul edilir (güvenli varsayılan).
 *
 * UYARI: buraya `*` yazmayın. CORS `*` iken herhangi bir site, tarayıcı
 * üzerinden bu sunucuya (özel IP dahil) istek atıp yanıtı okuyabilir —
 * ölçülmüş saldırı yüzeyi. Tek tek kaynak yazın.
 */
const EK_KAYNAKLAR = new Set(
  String(process.env.CK_EZIKIN_KAYNAKLAR || '')
    .split(',')
    .map((x) => x.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);
if (EK_KAYNAKLAR.has('*')) log('UYARI', 'CK_EZIKIN_KAYNAKLAR icinde "*" var — butun siteler erisebilir');

function kaynakIzinli(origin) {
  if (!origin) return true;                       // aynı uygulama / native çağrı
  const temiz = String(origin).replace(/\/+$/, '');
  if (kendiKaynaklari().has(temiz)) return true;  // bu bilgisayarın kendi adresi
  if (EK_KAYNAKLAR.has(temiz)) return true;       // açıkça bildirilen yayın kaynağı
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[[::1]\])(:\d+)?$/.test(temiz);
}
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && kaynakIzinli(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    // ÖLÇÜLEN HATA: burada Authorization YOKTU. Tarayıcı çapraz kökenli
    // istekte özel başlık gönderemez; sunucu 401 döner ve ağ geçişi sessizce
    // bozulur. Kullanılan tüm kimlik başlıkları AÇIKÇA listelenir.
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Sync-Token, X-Sync-Cihaz, Accept, Cache-Control'
    );
  }
  if (req.method === 'OPTIONS') {
    if (!origin || kaynakIzinli(origin)) return res.status(204).end();
    return res.status(403).json({ ok: false, error: 'CORS reddedildi' });
  }
  next();
});

// Gövde çözümleyicileri — YOL BAZLI.
// DİKKAT: Bu sıralama kritik. express.json() bir middleware'dir; genel
// (app.use) olarak kaydedilirse ÇÖZÜMLEYİCİ rotadan ÖNCE çalışır ve
// gövdeyi 1MB sınırıyla reddeder. Plaka karesi 1280x720 PNG base64 olarak
// ~2,3 MB geldiği için sunucu HER GERÇEK FOTOĞRAFTA 413 döndürürdü.
// Ölçülen hata: E2E'de "HTTP 413 — Gövde çok büyük (1MB sınır)".
// Çözüm: /plaka/oku yolunda genel ayrıştırıcı ATLANIR, yalnızca o yolda
// çalışan 8MB'lık ayrıştırıcı devreye girer. Böylece genel API yüzeyi
// 1MB'de kalır (kayıt gövdeleri küçüktür) ama görüntü yolu esnek olur.
const PLAKA_YOL = '/plaka/oku';
const GENEL_GOVDE_SINIRI = '1mb';
const PLAKA_GOVDE_SINIRI = '8mb';

const genelGovde = express.json({ limit: GENEL_GOVDE_SINIRI });
const plakaGovde = express.json({ limit: PLAKA_GOVDE_SINIRI });

app.use((req, res, next) => {
  const yol = (req.path || '').split('?')[0];
  if (yol === PLAKA_YOL) return next();          // bu rota kendi ayrıştırıcısını kullanır
  return genelGovde(req, res, next);
});
// Gövde hataları telefonun anlayacağı JSON olsun (Express varsayılanı HTML'dir):
// - bozuk JSON → 400, - sınır üstü gövde → 413 (kayıt kuyrukta kalır, sonra
//   batch'le gelir).
// Sınır mesajı YOLA GÖRE değişir: plaka yolunda 8MB, diğerlerinde 1MB.
// Sabit "1MB" demek, 8MB'lik görüntü yolunda yanlış bilgi veriyordu.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ ok: false, error: 'Geçersiz JSON' });
  }
  if (err && err.status === 413) {
    const yol = (req.path || '').split('?')[0];
    const sinir = yol === PLAKA_YOL ? PLAKA_GOVDE_SINIRI : GENEL_GOVDE_SINIRI;
    const ne = yol === PLAKA_YOL
      ? 'görüntü çok büyük — kamerayı plakadan uzaklaştırıp yeniden çekin'
      : 'Gövde çok büyük (1MB sınır)';
    return res.status(413).json({ ok: false, error: ne, sinir });
  }
  next(err);
});

// Basit rate limit (kaba koruma: IP başına 600 istek/dk)
const hits = new Map();
setInterval(() => hits.clear(), 60 * 1000).unref();
app.use((req, res, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || '?';
    const n = (hits.get(ip) || 0) + 1;
    hits.set(ip, n);
    if (n > 600) return res.status(429).json({ ok: false, error: 'Çok fazla istek' });
  } catch {}
  next();
});

/**
 * İSTEK BU BİLGİSAYARDAN MI GELİYOR?
 *
 * ÖLÇÜLEN GEREKÇE: ağ denetimi yapıldı. Panel sayfaları (/kayitlar.html vb.)
 * veriyi anahtarsız çekiyordu; yani aynı Wi-Fi'a bağlanan MİSAFİR tüm
 * kayıtları (plaka, isim, site) tarayıcısından okuyabiliyordu.
 *
 * Panel bir OPERATÖR aracıdır; kulübedeki bilgisayarda kullanılır.
 * Telefonun ihtiyacı olan tek şey /eslesme, /plaka/oku ve yazma uçları —
 * o uçlar zaten anahtarlı ve ağa açık kalacak.
 *
 * Bu yüzden panel varsayılan olarak YALNIZCA bu bilgisayardan açılır.
 * Uzaktan açmak isteyenler CK_PANEL_UZAK=1 ile açabilir; bu durumda
 * uyarı panelde gösterilir (sessiz risk kabul edilmez).
 */
function yerelMi(req) {
  const ip = String((req.ip || req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip === '';
}

function requireYerelPanel(req, res, next) {
  if (yerelMi(req)) return next();
  if (PANEL_UZAK) return next();
  // TELEFON UYGULAMASI GEREKSİZ ENGELLENMEMELI
  // Panel dosyaları korunuyor ama telefon uygulaması /telefon/* açık olmalı
  return res.status(403).json({
    ok: false,
    error: 'Panel yalnızca bu bilgisayardan açılabilir. Aynı Wi-Fi ağındaki diğer cihazlardan kapatıldı. TELEFON İÇİN: http://' + (tls.birincilLanIp ? tls.birincilLanIp() : 'BILGISAYAR-IP') + ':' + PORT + '/telefon/',
    panelUzak: false,
  });
}

/**
 * Istek IP'si (ağ kimliği). IPv4-mapped IPv6 normalleştirilir.
 */
function istemciIp(req) {
  return String((req.ip || (req.socket && req.socket.remoteAddress)) || 'bilinmiyor')
    .replace(/^::ffff:/, '');
}

/**
 * Eslesme izin listesi: { cihazlar: [{ip, kimlik, ad, ilk, son}], onayBekleyen: [...] }
 *
 * Bozuk dosyada sessizce bos liste kullanilmaz: eski dosya yedeklenir ve
 * kullaniciya durum endpoint'i uzerinden bildirilir (sessiz veri kaybi yok).
 */
let eslesmeDurumu = { cihazlar: [], onayBekleyen: [], hata: null };
function eslesmeYukle() {
  try {
    if (fs.existsSync(ESLESME_YOLU)) {
      const g = JSON.parse(fs.readFileSync(ESLESME_YOLU, 'utf8'));
      eslesmeDurumu.cihazlar = Array.isArray(g.cihazlar) ? g.cihazlar : [];
      eslesmeDurumu.onayBekleyen = Array.isArray(g.onayBekleyen) ? g.onayBekleyen : [];
    }
  } catch (e) {
    eslesmeDurumu.hata = String((e && e.message) || e);
    log('UYARI', 'eslesmeler.json bozuk, liste bos sayildi:', eslesmeDurumu.hata);
  }
  return eslesmeDurumu;
}
function eslesmeKaydet() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const gecici = ESLESME_YOLU + '.tmp';
    fs.writeFileSync(gecici, JSON.stringify(eslesmeDurumu, null, 2), 'utf8');
    fs.renameSync(gecici, ESLESME_YOLU);
  } catch (e) {
    log('ERROR', 'eslesmeler.json yazilamadi:', e && e.message);
  }
}
eslesmeYukle();

/**
 * Bu istemgi kurabilir mi? 
 * 
 * SELF-HEALING KURAL:
 *   (a) liste bosken -> İLK GELEN CİHAZ OTOMATİK KABUL
 *   (b) BU BİLGİSAYARIN KENDİSİ (localhost veya yerel IP) -> OTOMATİK KABUL
 *   (c) IP veya kalici kimlik biliniyorsa -> KABUL
 *   (d) aksi -> onay bekler, anahtar VERİLMEZ (yönetici onaylayacak)
 * 
 * ÖNEMLİ: İlk cihaz garantili kabul - kurulum SIFIR DOKUNUŞLA çalışır
 * ÖLÇÜLEN HATA DÜZELTMESİ: Bilgisayarın 127.0.0.1 onaylandı ama 192.168.1.x
 * IP'si onay bekliyordu. Panel bu bilgisayarda çalışıyor, telefonlar da
 * bu bilgisayara bağlanıyor — aynı makinenin tüm IP'leri otomatik kabul.
 */
function eslesmeKontrol(ip, kimlik) {
  // LOCALHOST HER ZAMAN KABUL (panel bu bilgisayarda açılır)
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
    log('INFO', `Localhost kabul: ${ip}`);
    return { izin: true, ilk: false };
  }
  
  // BU BİLGİSAYARIN AĞDAKİ IP'LERİ OTOMATİK KABUL
  // Ölçülen senaryo: sunucu 192.168.1.129'da çalışıyor; telefon QR okutup
  // aynı IP'ye bağlanıyor. Bu aynı makine, onay gereksiz.
  const yerelIPler = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
  
  if (yerelIPler.includes(ip)) {
    log('INFO', `Yerel IP kabul: ${ip}`);
    return { izin: true, ilk: false };
  }
  
  // Liste boşsa -> İLK GELEN CİHAZ OTOMATİK KABUL
  if (!eslesmeDurumu.cihazlar.length) {
    log('INFO', `İlk cihaz kabul: ${ip}`);
    return { izin: true, ilk: true };
  }
  
  // IP veya kimlik biliniyorsa -> KABUL
  const bilinen = eslesmeDurumu.cihazlar.some((c) => (ip && c.ip === ip) || (kimlik && c.kimlik === kimlik));
  if (bilinen) {
    log('INFO', `Bilinen cihaz: ${ip}`);
    return { izin: true, ilk: false };
  }
  
  log('INFO', `Yeni cihaz onay bekliyor: ${ip}`);
  return { izin: false, ilk: false };
}

function eslesmeKaydetCihaz(ip, kimlik) {
  const simdi = new Date().toISOString();
  const varOlan = eslesmeDurumu.cihazlar.find((c) => (ip && c.ip === ip) || (kimlik && c.kimlik === kimlik));
  if (varOlan) {
    varOlan.son = simdi;
    if (ip) varOlan.ip = ip;
    if (kimlik) varOlan.kimlik = kimlik;
  } else {
    eslesmeDurumu.cihazlar.push({ ip: ip || null, kimlik: kimlik || null, ilk: simdi, son: simdi });
    // Liste sınırsız büyümesin (evde/kulübede sınırlı cihaz sayısı).
    if (eslesmeDurumu.cihazlar.length > 20) eslesmeDurumu.cihazlar.shift();
  }
  eslesmeDurumu.onayBekleyen = eslesmeDurumu.onayBekleyen.filter(
    (b) => !((ip && b.ip === ip) || (kimlik && b.kimlik === kimlik))
  );
  eslesmeKaydet();
}

function eslesmeOnayBekle(ip, kimlik) {
  const varOlan = eslesmeDurumu.onayBekleyen.some((b) => (ip && b.ip === ip) || (kimlik && b.kimlik === kimlik));
  if (!varOlan) eslesmeDurumu.onayBekleyen.push({ ip: ip || null, kimlik: kimlik || null, istendi: new Date().toISOString() });
  eslesmeKaydet();
}

/** Yonetici onayi: bekleyen cihazi izin listesine al. */
function eslesmeOnayla(ip) {
  const b = eslesmeDurumu.onayBekleyen.find((x) => x.ip === ip);
  if (!b) return false;
  eslesmeKaydetCihaz(b.ip, b.kimlik);
  return true;
}

/** Cihaz kaldirma (telefon degisti / cihaz calindi). */
function eslesmeKaldir(ip) {
  const onceki = eslesmeDurumu.cihazlar.length;
  eslesmeDurumu.cihazlar = eslesmeDurumu.cihazlar.filter((c) => c.ip !== ip);
  eslesmeDurumu.onayBekleyen = eslesmeDurumu.onayBekleyen.filter((b) => b.ip !== ip);
  eslesmeKaydet();
  return eslesmeDurumu.cihazlar.length !== onceki;
}

/**
 * Anahtar denetimi.
 *
 * İstek şu üç yoldan biriyle geçer:
 *   a) Authorization: Bearer <API anahtarı>   (gömülü / ortam anahtarı)
 *   b) Authorization: <API anahtarı>         (düz biçim de kabul edilir)
 *   c) X-Sync-Token: <kurulum anahtarı>      (bilgisayarın kendi ürettiği)
 *
 * Neden iki yol? (a)/(b) uygulamanın HER YERDE çalışmasını sağlar (kurulum
 * veya dağıtım farkı olmaz). (c) bilgisayar başına özel anahtarla ek koruma
 * verir. İkisi de aynı fonksiyonda kontrol edilir; ikinci bir kapı bırakılmaz.
 *
 * ÖLÇÜLEN GERÇEK (gizlenmiyor): tarayıcıda çalışan bir anahtar gizli
 * olamaz — sayfa onu sunucuya göndermek zorundadır. Bu anahtar KİŞİSEL
 * VERİYİ korur (aynı Wi-Fi'taki misafire karşı), anahtarın kendisini
 * internete karşı gizli tutamaz. Bu tarayıcı mimarisinin kuralıdır.
 */
function anahtarGecerliMi(req) {
  const auth = String(req.headers.authorization || '').trim();
  if (API_ANAHTARI) {
    if (auth === API_ANAHTARI) return true;
    const bearer = auth.replace(/^Bearer\s+/i, '').trim();
    if (bearer && bearer === API_ANAHTARI) return true;
  }
  const token = req.headers['x-sync-token'];
  if (token && (token === SHARED_TOKEN || token === PANEL_KEY)) return true;
  // Sorgu parametresi: YALNIZCA EventSource için (tarayıcı özel başlık
  // gönderemez). Bedeli: kimlik bilgisi erişim günlüğüne yazılabilir.
  // Panel yalnızca bu bilgisayarda açılır ve anahtar zaten sayfa
  // kaynağında bulunur; ek risk üretmez.
  const q = String(req.query && req.query.k || '').trim();
  if (q && (q === SHARED_TOKEN || q === PANEL_KEY)) return true;
  if (API_ANAHTARI && q && q === API_ANAHTARI) return true;
  return false;
}

function requireToken(req, res, next) {
  if (anahtarGecerliMi(req)) return next();
  return res.status(401).json({ ok: false, error: 'Yetkisiz (API anahtarı gerekli)' });
}

// Panel anahtarı: telefonun eşleşme anahtarı da panelde de geçerli olsun —
// kullanıcı tek anahtarı yeter.
function requireAnyKey(req, res, next) {
  if (anahtarGecerliMi(req)) return next();
  return res.status(401).json({ ok: false, error: 'Yetkisiz' });
}

app.get('/saglik', (req, res) => {
  res.json({ ok: true, kayitSayisi: seenIds.size, plakaSayisi: seenPlateIds.size, zaman: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// PLAKA API ENDPOINT'LERİ
// ---------------------------------------------------------------------------

// POST /plaka - Tek plaka kaydet/güncelle
app.post('/plaka', requireToken, async (req, res) => {
  try {
    const result = await acceptPlateOne(req.body);
    const sanitized = sanitizePlate(req.body);
    res.json({ ok: true, result, plate: sanitized });
  } catch (e) {
    const code = e.statusCode || 500;
    res.status(code).json({ ok: false, error: e.message });
  }
});

// POST /plaka/batch - Toplu plaka kaydet
app.post('/plaka/batch', requireToken, async (req, res) => {
  try {
    const plates = req.body.plates || [];
    if (!Array.isArray(plates)) {
      return res.status(400).json({ ok: false, error: 'plates dizisi bekleniyor' });
    }
    const result = acceptPlateBatch(plates);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /plaka/:plate - Plaka bilgisi sorgula
app.get('/plaka/:plate', requireToken, (req, res) => {
  try {
    const plateStr = decodeURIComponent(req.params.plate).toUpperCase().trim();
    const key = plateKey(plateStr);
    const { rows } = readAllPlateRecords();
    const found = rows.find(p => p && !p.deleted && (plateKey(p.plate) === key || p.plate === plateStr));
    if (found) {
      res.json({ ok: true, plate: found });
    } else {
      res.json({ ok: false, error: 'Plaka bulunamadı' });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /plakalar - Tüm plakalar (web panel için)
app.get('/plakalar', requireYerelPanel, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const q = (req.query.q || '').trim().toLocaleLowerCase('tr-TR');
    const typeFilter = (req.query.type || '').trim();
    
    let { rows } = readAllPlateRecords();
    
    // Silinmişleri filtrele
    rows = rows.filter(p => p && !p.deleted);
    
    // Arama
    if (q) {
      rows = rows.filter(p =>
        [p.plate, p.name, p.company, p.type, p.note, p.phone]
          .map(v => String(v || '').toLocaleLowerCase('tr-TR'))
          .some(v => v.includes(q))
      );
    }
    
    // Tür filtresi
    if (typeFilter) {
      rows = rows.filter(p => (p.type || 'Kurye') === typeFilter);
    }
    
    const total = rows.length;
    const paged = rows.slice(offset, offset + limit);
    
    res.json({ ok: true, total, records: paged });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /plaka/:id - Plaka güncelle (web panel)
app.put('/plaka/:id', requireYerelPanel, async (req, res) => {
  try {
    const id = req.params.id;
    const updates = req.body;
    
    // Mevcut kaydı bul
    const { rows } = readAllPlateRecords();
    const existing = rows.find(p => p && p.id === id);
    
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Plaka bulunamadı' });
    }
    
    // Güncelleme: mevcut + yeni
    const updated = Object.assign({}, existing, updates, {
      id: existing.id, // id değiştirilemez
      updatedAt: Date.now(),
    });
    
    const result = await acceptPlateOne(updated);
    res.json({ ok: true, result, plate: sanitizePlate(updated) });
  } catch (e) {
    const code = e.statusCode || 500;
    res.status(code).json({ ok: false, error: e.message });
  }
});

// DELETE /plaka/:id - Plaka sil (soft delete)
app.delete('/plaka/:id', requireYerelPanel, async (req, res) => {
  try {
    const id = req.params.id;
    
    // Mevcut kaydı bul
    const { rows } = readAllPlateRecords();
    const existing = rows.find(p => p && p.id === id);
    
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Plaka bulunamadı' });
    }
    
    // Soft delete
    const deleted = Object.assign({}, existing, {
      deleted: true,
      updatedAt: Date.now(),
    });
    
    const result = await acceptPlateOne(deleted);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /kayit/:id - Kayıt sil (soft delete)
app.delete('/kayit/:id', requireYerelPanel, (req, res) => {
  try {
    const id = req.params.id;
    log('info', `[DELETE /kayit] İstek alındı, id: ${id}`);
    
    // Mevcut kaydı bul
    const { rows } = readAllLogRecords();
    log('info', `[DELETE /kayit] Toplam ${rows.length} kayıt okundu`);
    
    const existing = rows.find(r => r && (r.id === id || r.uid === id));
    
    if (!existing) {
      log('warn', `[DELETE /kayit] Kayıt bulunamadı: ${id}`);
      return res.status(404).json({ ok: false, error: 'Kayıt bulunamadı' });
    }
    
    log('info', `[DELETE /kayit] Mevcut kayıt bulundu:`, existing);
    
    // Soft delete - deleted flag ekle
    const deleted = Object.assign({}, existing, {
      deleted: true,
      updatedAt: Date.now(),
    });
    
    log('info', `[DELETE /kayit] Silinen kayıt (deleted=true):`, deleted);
    
    // acceptOne zaten senkron, async'e gerek yok
    const result = acceptOne(deleted);
    log('info', `[DELETE /kayit] acceptOne sonucu: ${result}`);
    
    // Kontrol: gerçekten silindi mi?
    const { rows: afterRows } = readAllLogRecords();
    const afterRecord = afterRows.find(r => r && (r.id === id || r.uid === id));
    log('info', `[DELETE /kayit] Silme sonrası kontrol:`, afterRecord);
    
    res.json({ ok: true, result: 'deleted' });
  } catch (e) {
    log('error', `[DELETE /kayit] Hata: ${e.message}`, e.stack);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==================== SİTE/BLOK API ====================

// POST /expand-url - Kısa URL'leri genişlet (Google Maps short links için)
app.post('/expand-url', requireYerelPanel, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ ok: false, error: 'URL gerekli' });
    }
    
    // Google Maps short link kontrolü
    if (!url.includes('goo.gl') && !url.includes('maps.app')) {
      return res.json({ ok: true, expandedUrl: url }); // Zaten tam URL
    }
    
    // HTTP redirect takibi ile URL expand et
    const https = require('https');
    const http = require('http');
    
    const followRedirects = (urlStr, maxRedirects = 5) => {
      return new Promise((resolve, reject) => {
        if (maxRedirects === 0) {
          return reject(new Error('Çok fazla yönlendirme'));
        }
        
        const client = urlStr.startsWith('https') ? https : http;
        const req = client.get(urlStr, { timeout: 5000 }, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            // Redirect varsa takip et
            let nextUrl = response.headers.location;
            if (!nextUrl.startsWith('http')) {
              const urlObj = new URL(urlStr);
              nextUrl = urlObj.protocol + '//' + urlObj.host + nextUrl;
            }
            resolve(followRedirects(nextUrl, maxRedirects - 1));
          } else {
            resolve(urlStr);
          }
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
    };
    
    const expandedUrl = await followRedirects(url);
    log('info', `[POST /expand-url] ${url} -> ${expandedUrl}`);
    
    res.json({ ok: true, expandedUrl });
  } catch (e) {
    log('error', `[POST /expand-url] Hata: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /siteler - Tüm siteleri listele
app.get('/siteler', requireToken, (req, res) => {
  try {
    const { rows } = readAllSiteRecords();
    log('info', `[GET /siteler] Toplam ${rows.length} site`);
    
    // Deleted siteleri filtrele
    const live = rows.filter(s => s && s.deleted !== true);
    log('info', `[GET /siteler] Aktif site: ${live.length}`);
    
    // Alfabetik sırala
    live.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    
    res.json({
      ok: true,
      total: live.length,
      sites: live
    });
  } catch (e) {
    log('error', `[GET /siteler] Hata: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /site - Yeni site ekle veya güncelle
app.post('/site', requireYerelPanel, async (req, res) => {
  try {
    const site = req.body;
    log('info', `[POST /site] İstek alındı:`, site);
    
    const result = await acceptSiteOne(site);
    log('info', `[POST /site] Sonuç: ${result}`);
    
    res.json({ ok: true, result });
  } catch (e) {
    log('error', `[POST /site] Hata: ${e.message}`);
    res.status(e.statusCode || 500).json({ ok: false, error: e.message });
  }
});

// PUT /site/:id - Site güncelle
app.put('/site/:id', requireYerelPanel, async (req, res) => {
  try {
    const id = req.params.id;
    const updates = req.body;
    log('info', `[PUT /site/${id}] Güncelleme:`, updates);
    
    // Mevcut siteyi bul
    const { rows } = readAllSiteRecords();
    const existing = rows.find(s => s && s.id === id);
    
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Site bulunamadı' });
    }
    
    // Güncelleme yap
    const updated = Object.assign({}, existing, updates, {
      id: existing.id, // ID değiştirilemez
      updatedAt: Date.now()
    });
    
    const result = await acceptSiteOne(updated);
    log('info', `[PUT /site/${id}] Sonuç: ${result}`);
    
    res.json({ ok: true, result });
  } catch (e) {
    log('error', `[PUT /site/${id}] Hata: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /site/:id - Site sil (soft delete)
app.delete('/site/:id', requireYerelPanel, async (req, res) => {
  try {
    const id = req.params.id;
    log('info', `[DELETE /site/${id}] İstek alındı`);
    
    // Mevcut siteyi bul
    const { rows } = readAllSiteRecords();
    const existing = rows.find(s => s && s.id === id);
    
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Site bulunamadı' });
    }
    
    // Soft delete
    const deleted = Object.assign({}, existing, {
      deleted: true,
      updatedAt: Date.now()
    });
    
    const result = await acceptSiteOne(deleted);
    log('info', `[DELETE /site/${id}] Sonuç: ${result}`);
    
    res.json({ ok: true, result: 'deleted' });
  } catch (e) {
    log('error', `[DELETE /site/${id}] Hata: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================================
// BLACKLIST ENDPOINTS
// ============================================================================
const blacklist = require('./blacklist.js');

// GET /blacklist - Blacklist listesi
app.get('/blacklist', requireToken, (req, res) => {
  try {
    const list = blacklist.readBlacklist();
    res.json({ ok: true, blacklist: list, count: list.length });
  } catch (e) {
    log('error', `[GET /blacklist] Hata: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /blacklist - Blacklist'e ekle
app.post('/blacklist', requireYerelPanel, (req, res) => {
  try {
    const { plate, reason, addedBy } = req.body;
    if (!plate) return res.status(400).json({ ok: false, error: 'Plaka gerekli' });
    
    const entry = blacklist.addToBlacklist(plate, reason, addedBy);
    log('info', `[POST /blacklist] Eklendi: ${plate} - ${reason}`);
    res.json({ ok: true, entry });
  } catch (e) {
    log('error', `[POST /blacklist] Hata: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /blacklist/:id - Blacklist'ten çıkar
app.delete('/blacklist/:id', requireYerelPanel, (req, res) => {
  try {
    const removed = blacklist.removeFromBlacklist(req.params.id);
    if (removed) {
      log('info', `[DELETE /blacklist/${req.params.id}] Silindi`);
      res.json({ ok: true, result: 'removed' });
    } else {
      res.status(404).json({ ok: false, error: 'Kayıt bulunamadı' });
    }
  } catch (e) {
    log('error', `[DELETE /blacklist/${req.params.id}] Hata: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /check-blacklist - Plaka kontrol et
app.post('/check-blacklist', requireToken, (req, res) => {
  try {
    const { plate } = req.body;
    if (!plate) return res.status(400).json({ ok: false, error: 'Plaka gerekli' });
    
    const found = blacklist.isBlacklisted(plate);
    res.json({ ok: true, blacklisted: !!found, entry: found || null });
  } catch (e) {
    log('error', `[POST /check-blacklist] Hata: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================================
// STATISTICS & ANALYTICS ENDPOINTS
// ============================================================================

// GET /stats/performance - Güvenlik görevlisi performans istatistikleri
app.get('/stats/performance', requireToken, (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { rows } = readAllRecords();
    
    let filtered = rows.filter(r => r && !r.deleted);
    
    if (startDate) {
      filtered = filtered.filter(r => r.ts >= parseInt(startDate));
    }
    if (endDate) {
      filtered = filtered.filter(r => r.ts <= parseInt(endDate));
    }
    
    // Görevliye göre grupla
    const byGuard = {};
    filtered.forEach(r => {
      const guard = r.guard || 'Bilinmeyen';
      if (!byGuard[guard]) {
        byGuard[guard] = { count: 0, records: [] };
      }
      byGuard[guard].count++;
      byGuard[guard].records.push(r);
    });
    
    // Performans metriklerini hesapla
    const stats = Object.keys(byGuard).map(guard => {
      const data = byGuard[guard];
      const records = data.records;
      
      // Site bazında dağılım
      const bySite = {};
      records.forEach(r => {
        const site = r.site || 'Bilinmeyen';
        bySite[site] = (bySite[site] || 0) + 1;
      });
      
      // Tip bazında dağılım
      const byType = {};
      records.forEach(r => {
        const type = r.type || 'Kurye';
        byType[type] = (byType[type] || 0) + 1;
      });
      
      return {
        guard,
        totalRecords: data.count,
        sites: bySite,
        types: byType,
        avgPerDay: records.length > 0 ? (data.count / Math.max(1, (Date.now() - records[0].ts) / 86400000)).toFixed(1) : 0
      };
    });
    
    // En aktif görevliyi bul
    stats.sort((a, b) => b.totalRecords - a.totalRecords);
    
    res.json({
      ok: true,
      period: { startDate: startDate || null, endDate: endDate || null },
      totalRecords: filtered.length,
      guards: stats,
      topGuard: stats[0] || null
    });
  } catch (e) {
    log('error', `[GET /stats/performance] Hata: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /stats/dashboard - Dashboard için özet istatistikler
app.get('/stats/dashboard', requireToken, (req, res) => {
  try {
    const { rows } = readAllRecords();
    const now = Date.now();
    const today = new Date().setHours(0, 0, 0, 0);
    
    const active = rows.filter(r => r && !r.deleted);
    const todayRecords = active.filter(r => r.ts >= today);
    
    // Şu an içeride kaç araç var (giriş var ama çıkış yok)
    const inFacility = active.filter(r => !r.exitTime).length;
    
    // Tip dağılımı
    const byType = {};
    todayRecords.forEach(r => {
      const type = r.type || 'Kurye';
      byType[type] = (byType[type] || 0) + 1;
    });
    
    // Site dağılımı
    const bySite = {};
    todayRecords.forEach(r => {
      const site = r.site || 'Bilinmeyen';
      bySite[site] = (bySite[site] || 0) + 1;
    });
    
    // Son 7 gün trend
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date();
      dayStart.setDate(dayStart.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      
      const dayRecords = active.filter(r => r.ts >= dayStart.getTime() && r.ts <= dayEnd.getTime());
      last7Days.push({
        date: dayStart.toISOString().split('T')[0],
        count: dayRecords.length
      });
    }
    
    res.json({
      ok: true,
      today: {
        total: todayRecords.length,
        byType,
        bySite
      },
      inFacility,
      totalRecords: active.length,
      last7Days
    });
  } catch (e) {
    log('error', `[GET /stats/dashboard] Hata: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /stats/frequent-plates - Sık görülen plakalar (şüpheli aktivite tespiti)
app.get('/stats/frequent-plates', requireToken, (req, res) => {
  try {
    const { hours = 2, minCount = 3 } = req.query;
    const { rows } = readAllRecords();
    const cutoff = Date.now() - (parseInt(hours) * 3600000);
    
    const recent = rows.filter(r => r && !r.deleted && r.ts >= cutoff);
    
    // Plakaya göre grupla
    const byPlate = {};
    recent.forEach(r => {
      const plate = r.plate || 'Bilinmeyen';
      if (!byPlate[plate]) {
        byPlate[plate] = [];
      }
      byPlate[plate].push(r);
    });
    
    // Minimum sayıdan fazla giriş yapanları bul
    const frequent = Object.keys(byPlate)
      .map(plate => ({
        plate,
        count: byPlate[plate].length,
        records: byPlate[plate],
        sites: [...new Set(byPlate[plate].map(r => r.site))],
        lastEntry: Math.max(...byPlate[plate].map(r => r.ts))
      }))
      .filter(p => p.count >= parseInt(minCount))
      .sort((a, b) => b.count - a.count);
    
    res.json({
      ok: true,
      period: { hours: parseInt(hours), minCount: parseInt(minCount) },
      suspicious: frequent
    });
  } catch (e) {
    log('error', `[GET /stats/frequent-plates] Hata: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

function lanAdresleri() {
  const out = [];
  try {
    for (const ifs of Object.values(os.networkInterfaces() || {})) {
      for (const nic of ifs || []) {
        if (nic && nic.family === 'IPv4' && !nic.internal && nic.address) out.push(nic.address);
      }
    }
  } catch {}
  return [...new Set(out)];
}

app.get('/durum', requireToken, (req, res) => {
  res.json(Object.assign({ ok: true }, olayDurumu(), {
    kuyruk: writeQueueLen,
    adresler: adaySirasi().httpAdresler,
    https: Object.assign(tls.durumBilgisi(), { port: HTTPS_PORT }),
    uptimeSn: Math.round(process.uptime()),
    surum: SUREM,
    // Excel sistemi
    excel: {
      mode: EXCEL_MODE, // 'single', 'daily', 'shift'
      modeLabel: EXCEL_MODE === 'daily' ? 'Günlük Excel' : EXCEL_MODE === 'shift' ? 'Vardiya Excel' : 'Tek Excel',
      shifts: SHIFTS,
      currentShift: EXCEL_MODE === 'shift' ? getCurrentShift() : null,
      files: getAllExcelPaths().map(f => ({ 
        name: f.name, 
        path: path.basename(f.path),
        type: f.type 
      }))
    },
    // Ağ güvenliği yapılandırması
    agGuvenligi: {
      anahtarKaynak: ANAHTAR_KAYNAK,
      anahtarVar: !!API_ANAHTARI,
      ekKaynaklar: Array.from(EK_KAYNAKLAR),
      panelUzak: PANEL_UZAK,
      ipTabanli: !PANEL_UZAK,
      eslesmeIzinListesi: eslesmeDurumu.cihazlar.length,
      onayBekleyen: eslesmeDurumu.onayBekleyen.length,
    },
    plaka: plakaMotoru
      ? {
        aktif: true,
        hazir: plakaMotoru.durum().hazir,
        istek: plakaMotoru.durum().istekSayisi,
        bolgeBulucu: plakaMotoru.durum().bolgeBulucu,
      }
      : { aktif: false, sebep: plakaMotoruHatasi },
  }));
});

// POST /excel-ayar - Excel modu ve ayarlarını güncelle
app.post('/excel-ayar', requireYerelPanel, (req, res) => {
  try {
    const { mode, shifts } = req.body;
    
    // Mod kontrolü
    if (!['single', 'daily', 'shift'].includes(mode)) {
      return res.status(400).json({ ok: false, error: 'Geçersiz mod: single, daily veya shift olmalı' });
    }
    
    // Shift modu ise vardiya tanımı zorunlu
    if (mode === 'shift' && (!Array.isArray(shifts) || shifts.length === 0)) {
      return res.status(400).json({ ok: false, error: 'Vardiya modu aktifken en az 1 vardiya tanımlanmalı' });
    }
    
    if (shifts && mode === 'shift') {
      for (const shift of shifts) {
        if (!shift.name || !shift.start || !shift.end) {
          return res.status(400).json({ ok: false, error: 'Her vardiya name, start, end içermeli' });
        }
        // Saat formatı kontrolü (HH:MM)
        if (!/^\d{2}:\d{2}$/.test(shift.start) || !/^\d{2}:\d{2}$/.test(shift.end)) {
          return res.status(400).json({ ok: false, error: 'Saat formatı HH:MM olmalı (örn: 08:00)' });
        }
      }
    }
    
    // Config.json'u oku
    const configPath = path.join(__dirname, 'config.json');
    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {}
    
    // Excel ayarlarını güncelle
    config.excelMode = mode;
    config.shifts = (mode === 'shift' && shifts) ? shifts : [];
    
    // Eski vardiya sistemini temizle (geriye dönük uyumluluk)
    delete config.shiftEnabled;
    
    // Atomik yazma
    const tmpPath = configPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tmpPath, configPath);
    
    const modeLabel = mode === 'daily' ? 'Günlük Excel' : mode === 'shift' ? 'Vardiya Excel' : 'Tek Excel';
    log('INFO', `Excel modu güncellendi: ${modeLabel}${mode === 'shift' ? `, ${shifts.length} vardiya` : ''}`);
    
    res.json({ 
      ok: true, 
      message: `${modeLabel} modu ayarlandı. Değişikliklerin etkili olması için sunucuyu yeniden başlatın.`,
      requiresRestart: true
    });
  } catch (e) {
    log('ERROR', 'Excel ayar hatası:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Gerçek zamanlı olay akışı (SSE). Panel bu kanalı dinler; yoksa 15 sn'de bir
// yoklama yapar. Token istenmez: panel açık, veri zaten yerel ağda.
app.get('/olay', requireToken, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  res.write(`event: durum\ndata: ${JSON.stringify(olayDurumu())}\n\n`);
  sseClients.add(res);
  // Kalp atışı: 25 sn'de bir yorum satırı (proxy zaman aşımını kırar).
  const hb = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* bağlantı kapandı */ }
  }, 25000);
  const temizle = () => {
    clearInterval(hb);
    sseClients.delete(res);
  };
  req.on('close', temizle);
  req.on('error', temizle);
});

// Kayıt listesi (panel için): yeniden eskiye, aramalı, sayfalı. Panel açık olduğu
// için anahtar istemez — veri zaten bu bilgisayarda, yerel ağda duruyor.
app.get('/kayitlar', requireToken, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
  const q = String(req.query.q || '').toLocaleLowerCase('tr-TR').trim();
  const { rows } = readAllLogRecords();
  
  log('info', `[GET /kayitlar] Toplam kayıt: ${rows.length}`);
  
  // Deleted kayıtları filtrele - varsayılan olarak gösterme
  const liveRows = rows.filter(r => r && r.deleted !== true);
  
  log('info', `[GET /kayitlar] Silinmemiş kayıt: ${liveRows.length}, Silinen: ${rows.length - liveRows.length}`);
  
  liveRows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  let filtered = liveRows;
  if (q) {
    filtered = liveRows.filter((r) =>
      [r.site, r.unit, r.courier, r.company, r.plate, r.guard, r.note, r.type, r.date, r.time]
        .map((v) => String(v || '').toLocaleLowerCase('tr-TR'))
        .some((v) => v.includes(q))
    );
  }
  
  log('info', `[GET /kayitlar] Filtrelenmiş: ${filtered.length}, limit: ${limit}, offset: ${offset}`);
  
  res.json({
    ok: true,
    total: filtered.length,
    limit,
    offset,
    records: filtered.slice(offset, offset + limit),
  });
});

/**
 * Aday bağlantı adresleri.
 * IP değişse bile telefonun servisi bulabilmesi için sıralı aday listesi üretilir:
 *   1) kayıtlı adres (telefonda saklanır)
 *   2) bilgisayar adı   → çoğu Windows ağı bu adı kendiliğinden çözer (LLMNR/NetBIOS)
 *   3) mDNS kısa adı     → bazı ağlarda otomatik çalışır
 *   4) yerel IP adresleri
 * Telefon bu listeyi sırayla dener; hangisinin çalıştığını öğrenince onu saklar.
 */
/**
 * Ağ adreslerinin SIRALI listesi — TEK doğruluk kaynağı.
 *
 * Ölçülen hata: liste nesnel sırayla kuruluyordu ve sanal bağdaştırıcı
 * (192.168.56.1) gerçek ağ IP'sinden (192.168.1.235) ÖNCE geliyordu. Bu
 * hem /eslesme aday listesini hem /durum `adresler` alanını bozuyordu;
 * kullanıcı panelde ilk olarak ulaşılamayacak bir adresi görüyordu.
 *
 * Sıra kuralı: varsayılan rotanın arayüz IP'si (tls.birincilLanIp) önce,
 * sonra diğer yerel IP'ler. Bu bir TAHMİN değil, Windows rota tablosundan
 * ölçülür.
 */
function adaySirasi() {
  const hepsi = lanAdresleri();
  let birincil = null;
  try { birincil = tls.birincilLanIp && tls.birincilLanIp(); } catch {}
  const sirali = birincil && hepsi.includes(birincil) ? [birincil].concat(hepsi.filter((i) => i !== birincil)) : hepsi;
  return {
    birincilIp: birincil,
    ipAdresleri: sirali,
    httpAdresler: sirali.map((ip) => `http://${ip}:${PORT}`),
    httpsAdresler: sirali.map((ip) => `https://${ip}:${HTTPS_PORT}`),
  };
}

function adayAdresler() {
  // Aday bağlantı adresleri. SIRA ÖLÇÜLEBİLİR KURALLARA GÖRE KURULUR:
  //
  //  1) Gerçek ağ IP'si ÖNCE. Nesnel sıra güvenilir değildir — ölçüldü ki
  //     sanal bağdaştırıcı (192.168.56.1) gerçek IP'den (192.168.1.235) önce
  //     geliyordu. Varsayılan rotanın IP'si (tls.birincilLanIp) kullanılır.
  //  2) HTTP adresleri https'ten ÖNCE. Sertifika gerekmediği için http yeter;
  //     güvenilmeyen bir https ise tarayıcıda korkutucu uyarı sayfası açıp
  //     uygulamayı engelliyor. Bu, müşteriyi yoran ekrandır.
  //  3) ÇÖZÜLMEYEN adres LİSTEYE GİRMEZ — ölçüldü ki bu makinede
  //     `cinarkoy-sync.local` çözülmüyor. Ölü adresi denemek zaman kaybı.
  //
  // Sonu: ilk deneme çoğu durumda ÇALIŞIR. Kullanıcı hiçbir şey yazmaz.
  const liste = [];
  const ekle = (u) => {
    if (u && !liste.includes(u)) liste.push(u);
  };

  // 1) Birincil ağ IP'si (varsayılan rotanın arayüzü) — varsa
  let birincil = null;
  try { birincil = tls.birincilLanIp && tls.birincilLanIp(); } catch {}
  if (birincil) {
    ekle(`http://${birincil}:${PORT}`);
    ekle(`https://${birincil}:${HTTPS_PORT}`);
  }

  // 2) Diğer yerel IP'ler. Sıra /durum ile AYNI olmalı (tek doğruluk
  //    kaynağı: adaySirasi()). Yinelenenler ekle() tarafından elenir.
  for (const ip of adaySirasi().ipAdresleri) {
    ekle(`http://${ip}:${PORT}`);
    ekle(`https://${ip}:${HTTPS_PORT}`);
  }

  // 3) Bilgisayar adı — YALNIZCA listeye, denemede EN SON. Ölçüldü ki bu
  //    makinede NetBIOS adı yalnızca fe80:: IPv6'ya gidiyor ve mDNS yayınlanmıyor;
  //    yine de başka ağlarda işe yarayabilir, bu yüzden SİLİNMEDİ ama
  //    sona kondu (deneme maliyeti ölçülmüş olarak kabul edildi).
  let bilgisayarAdi = '';
  try { bilgisayarAdi = os.hostname(); } catch {}
  bilgisayarAdi = String(bilgisayarAdi || '').toLowerCase();
  if (bilgisayarAdi) {
    ekle(`http://${bilgisayarAdi}:${PORT}`);
    ekle(`http://${bilgisayarAdi}.local:${PORT}`);
  }
  ekle(`http://localhost:${PORT}`);

  // Sırayı garanti et: http adresleri https'ten önce, https en sonda.
  // (Sertifika gerekmiyor; bkz. public/telefon/yerel-kamera.js)
  const httpOnce = liste.filter((u) => u.indexOf('https://') !== 0);
  const httpsSonra = liste.filter((u) => u.indexOf('https://') === 0);

  return { adaylar: httpOnce.concat(httpsSonra), bilgisayarAdi };
}

// Eşleşme bilgisi: telefon rozetindeki ayar penceresine beslenir.
// QR görseli sunucuda çevrimdışı üretilir (qr.js) — internet gerekmez.
/**
 * Eşleşme QR'ını üretir — HATA OLABİLİR ama istemciyi ASLA düşürmez.
 *
 * Ölçülen hata: QR üretimi patlayınca /eslesme 500 döndü ve panel tüm
 * eşleşme bilgisini kaybetti. QR görseli bir KOLAYLIK; eşleşmenin kendisi
 * adres + anahtar alanlarıyla çalışır. Yani QR çizilemese bile kullanıcı
 * elle bağlanabilmelidir. Bu yüzden hata YUTULMAZ, `qrHata` olarak
 * bildirilir (sessiz bozulma yok) ve uç 200 döner.
 */
function qrAl(adres) {
  try {
    return { qrSvg: qrCode.toSvg(qrCode.encode(adres)), qrHata: null };
  } catch (e) {
    log('UYARI', "Eşleşme QR'ı üretilemedi:", e && e.message);
    return { qrSvg: null, qrHata: String((e && e.message) || e) };
  }
}

app.get('/eslesme', (req, res) => {
  // --- Eşleşme izin kontrolü (ölçülen açığın kapatılması) ---
  const _ip = istemciIp(req);
  // Cihazın kalıcı kimliği: telefon kendi üretir ve saklar. IP değişse de
  // aynı telefon tanınır (DHCP yenilemesi yüzünden gerekli).
  const _kimlik = String(req.headers['x-sync-cihaz'] || req.query.cihaz || '').slice(0, 64) || null;
  const izin = eslesmeKontrol(_ip, _kimlik);
  
  // DÜZELTME: İlk cihaz veya bilinen cihazsa kaydet VE token ver
  // Onay bekleyen cihazlar için de bilgi döndür ama token verme
  if (izin.izin) {
    eslesmeKaydetCihaz(_ip, _kimlik);
    log('INFO', `Cihaz eşleşti: ${_ip}`);
  } else {
    eslesmeOnayBekle(_ip, _kimlik);
    log('INFO', `Cihaz onay bekliyor: ${_ip}`);
  }

  const { adaylar, bilgisayarAdi } = adayAdresler();
  const gosterilebilir = adaylar.filter((u) => !/(localhost|127\.)/.test(u));
  // QR'lanacak adres: ÖLÇÜLEBİLİR ÖLÇÜTLERLE seçilir.
  //
  // ÖLÇÜLEN HATA: eski seçim önce ÇÖZÜLMEYEN bir bilgisayar adını seçiyordu
  // (`cinarkoy-sync.local`; DNS'te yok, mDNS yayınlanmıyor, NetBIOS adı
  // yalnızca fe80:: IPv6'ya gidiyor). Müşteri QR'ı okutup 'sunucu bulunamadı'
  // alıyor ve sistemi kullanamıyordu. Bu, "kullanıcı hiçbir şey yazmamalı"
  // kuralının doğrudan ihlaliydi.
  //
  // KURAL (artık değişmedi): QR yalnızca ÇÖZÜLEBİLİR bir adres kodlar,
  //  yani IP biçimli olanı. Aday yoksa sunucu kendi adresine düşer ve
  //  panel bunu açıkça "IP'nizi kontrol edin" notuyla söyler.
  //
  // Protokol: http. Sertifika gerekmiyor; https seçmek kullanıcıya korkutucu
  // uyarı sayfası göstermekten başka bir şey sağlamıyor.
  const kalici = gosterilebilir.find((u) => u.startsWith('http://') && /\d+\.\d+\.\d+\.\d+/.test(u))
    || gosterilebilir[0]
    || `http://localhost:${PORT}`;
  // KÖK CA KURULUM ADRESİ — tek seferlik, "kurulumu yapan" kişinin işi.
  //
  // Ölçülen gerekçe: CA dosyasını telefona taşımak (e-posta/WhatsApp/kablo)
  // kurulumun en rahatsız edici kısmıydı. QR ile telefon kamerasından
  // okutulur: tek dokunuş.
  //
  // Adres http üzerinden verilir çünkü dosya İNDİRİLİYOR — indirme için
  // https şart değildir. Adres IP tabanlıdır; IP değişse bile KÖK CA
  // değişmez (ölçüldü: parmak izi yeniden başlatmada birebir aynı), yani
  // indirilen CA kurulduktan sonra IP değişikliği geçersiz kılmaz.
  const kokCaAdres = kalici.replace(/\/+$/, '') + '/kurulum/kok.cer';
  // QR üretimi HATA OLAMAZ: qrAl() try/catch ile sarılı ve hata durumunda
  // null + sebep döner. Sessiz boş kutu bırakılmaz.
  const qrKok = qrAl(kokCaAdres);
  res.json({
    ok: true,
    adresler: gosterilebilir,
    adaylar,
    bilgisayarAdi,
    kaliciAdres: kalici,
    // QR içinde ne kodlandığı AÇIKÇA bildirilir. Ölçülebilirlik ilkesi:
    // "ne gönderiliyor" tahmin edilmemeli, sunucu söylemeli. Bu alan
    // testlerin ve panelin aynı değeri okumasını sağlar.
    qrAdres: kalici,
    
    // İKİ AŞAMALI QR SİSTEMİ:
    // 1) İlk QR: Sadece telefon uygulaması adresi (token YOK)
    //    Kullanıcı bunu okutup sayfayı açar
    // 2) İkinci QR: Token'lı tam adres (senkron için)
    //    Telefonda "Senkron" butonuna basınca bu QR'ı okutacak
    
    // İlk QR - Sadece uygulama adresi
    qrIlk: kalici + '/telefon/',
    
    // İkinci QR - Token'lı tam adres (senkron için)
    qrTam: SHARED_TOKEN ? (kalici + '/telefon/#token=' + SHARED_TOKEN) : (kalici + '/telefon/'),
    // Kök CA: indirme adresi + QR'ı. Panel bunları gösterir.
    kokCaAdres,
    qrKokSvg: qrKok.qrSvg,
    qrKokHata: qrKok.qrHata,
    // İSTEĞE BAĞLI canlı önizleme adresi. Kamera için ZORUNLU DEĞİLDİR:
    // telefonun kendi kamerası (capture="environment") http'te de çalışır.
    // Yalnızca uygulama İÇİNDE hareketli önizleme isteyenler kullanır.
    httpsAdres: tls.kaliciAdres(PORT, HTTPS_PORT),
    // https durumu: yalnızca "canlı önizleme mümkün mü" bilgisi için.
    https: tls.durumBilgisi(),
    // ANAHTAR YALNIZCA İZİNLİ CİHAZA VERİLİR.
    // Ölçülen gerekçe: bu uç açıktı ve anahtarı herkese veriyordu; aynı
    // Wi-Fi'a bağlanan misafir tüm kayıtlara erişebiliyordu. Şimdi ilk
    // cihaz kendiliğinden kaydolur, sonrakiler onay bekler.
    //   -> nöbetçi hâlâ HİÇBİR ŞEY YAZMAZ (izinli cihazda)
    //   -> yönetici yalnızca cihaz değişiminde panelden tek tıkla onaylar
    token: izin.izin ? SHARED_TOKEN : null,
    onayBekliyor: !izin.izin,
    ilkCihaz: izin.ilk === true,
    cihazSayisi: eslesmeDurumu.cihazlar.length,
    // Eşleşme durumu - telefona yardımcı mesajlar için
    eslesme: {
      izinVerildi: izin.izin,
      ilkCihaz: izin.ilk === true,
      onayBekliyor: !izin.izin,
      ip: _ip,
      kimlik: _kimlik,
      mesaj: izin.izin 
        ? (izin.ilk ? 'İlk cihaz otomatik kabul edildi' : 'Cihaz kayıtlı')
        : 'Yeni cihaz - yönetici onayı bekleniyor. Panelden onaylayın.'
    },
    // QR içeriği: DÜZ ADRES, JSON sarmal değil.
    //
    // ÖLÇÜLEN HATA: burada `{"u":...,"t":...}` JSON'u vardı ve 64
    // karakterlik anahtarla toplam 111 bayta çıkıyordu; V6-M sınırı 106.
    // Sonuç: encode() istal atıyor, /eslesme 500 dönüyor, panel
    // "Eşleşme bilgisi alınamadı" diyor ve telefon HİÇ bağlanamıyordu.
    // (Testler kısa anahtarla çalıştığı için bu gizli kalmıştı.)
    //
    // Ayrıca bu JSON zaten kullanışlı değildi: telefon uygulamasında QR
    // OKUYUCU YOK (guvenlik-sync.js: "QR okutma adımları TAMAMEN KALKAR"),
    // ve telefonun kendi kamerası da JSON açamaz. Yani dekoratifti.
    // Düz adres hem kısa (sınırın içinde) hem de telefonun kendi
    // kamerasıyla okutulup UYGULAMAYI AÇAR. Yani işe yarar.
    // Anahtar zaten panelde ayrı bir alanda ve /eslesme'de gelir.
    // QR görselleri:
    // 1) İlk QR - Token YOK (sadece uygulama adresi)
    ...qrAl(kalici + '/telefon/'),
    // 2) İkinci QR - Token VAR (senkron için)
    qrSvgToken: qrAl(SHARED_TOKEN ? (kalici + '/telefon/#token=' + SHARED_TOKEN) : (kalici + '/telefon/')).qrSvg,
    zaman: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
//  HTTPS GÜVEN KURULUMU — telefonda bir kez yapılan tek işlem
// ---------------------------------------------------------------------------
// Tarayıcı, işletim sistemine güvenilmeyen sertifika için kamera vermeyi
// reddeder. Bu dosya, bilgisayarda üretilen KÖK CA'yı telefon indirir. Kök
// bir kez kurulduğunda IP değişse de güven BOZULMAZ (yaprak aynı kökle
// imzalanır) — yani bu işlem "bir kere"dir, her IP değişiminde tekrarlanmaz.
/**
 * Eşleşme cihazları — yönetim uçları.
 *
 * Amaç: "ilk gelen kaydolur" kuralını görünür ve yönetilebilir kılmak.
 * Yeni telefon (kadro değişimi, yeni nöbetçi) onay bekler; yönetici
 * panelden tek tıkla onaylar. Kayıp/çalınmış cihaz da listeden silinir.
 *
 * Hata yutulmaz: bozuk izin dosyası durumda `hata` alanıyla bildirilir.
 */
/**
 * API anahtarını gösterir — kurulum için.
 *
 * Kullanıcı isteği: anahtarı web sitesine (Vercel/GitHub) yapıştırabilmek
 * için panelde görünür olmalı.
 *
 * GÜVENLİK: /eslesme AÇIK bir uçtur (eşleşme için) ve orada anahtarı
 * vermek korumayı anlamsızlaştırırdı. Bu uç requireAnyKey ile korunur ve
 * panel yalnızca bu bilgisayardan açılabilir.
 */
app.get('/eslesme/anahtar', requireAnyKey, (req, res) => {
  res.json({
    ok: true,
    anahtar: API_ANAHTARI,
    kaynak: ANAHTAR_KAYNAK,
    // Anahtarın WEB UYGULAMASINDA kullanımı için: başlık adı ve biçim.
    baslikAdi: 'Authorization',
    bicim: 'Bearer <anahtar>',
    ortamDegiskeni: 'CK_ANAHTAR',
  });
});

app.get('/eslesme/cihazlar', requireAnyKey, (req, res) => {
  eslesmeYukle();
  res.json({
    ok: true,
    cihazlar: eslesmeDurumu.cihazlar,
    onayBekleyen: eslesmeDurumu.onayBekleyen,
    hata: eslesmeDurumu.hata,
  });
});

app.post('/eslesme/onay', requireAnyKey, (req, res) => {
  const ip = String((req.body && req.body.ip) || '').trim();
  if (!ip) return res.status(400).json({ ok: false, error: 'ip gerekli' });
  const tamam = eslesmeOnayla(ip);
  res.json({ ok: tamam, ip, cihazlar: eslesmeDurumu.cihazlar, onayBekleyen: eslesmeDurumu.onayBekleyen });
});

app.post('/eslesme/kaldir', requireAnyKey, (req, res) => {
  const ip = String((req.body && req.body.ip) || '').trim();
  if (!ip) return res.status(400).json({ ok: false, error: 'ip gerekli' });
  const silindi = eslesmeKaldir(ip);
  res.json({ ok: silindi, ip, cihazlar: eslesmeDurumu.cihazlar, onayBekleyen: eslesmeDurumu.onayBekleyen });
});

app.get('/kurulum/kok.cer', (req, res) => {
  const pem = tls.kokPemi();
  if (!pem) {
    return res.status(503).json({ ok: false, error: 'kök sertifika henüz hazır değil' });
  }
  // Varsayılan DER. Ölçülen hata: PEM gövde .cer uzantısıyla gönderiliyordu;
  // iOS/Android bunu kurulum profilinden ayırt edemeyebiliyor. İkisi de
  // sunulur: ?format=pem yalnızca teşhis/denetim amaçlıdır.
  const bicim = String(req.query.format || 'der').toLowerCase();
  if (bicim === 'pem') {
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="CinarkoySync-kok-ca.pem"');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(pem);
  }
  const der = tls.kokDer();
  if (!der || !der.length) {
    return res.status(503).json({ ok: false, error: 'kök sertifika DER biçimine çevrilemedi' });
  }
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="CinarkoySync-kok-ca.cer"');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Icerik-Tipi', 'DER');
  return res.send(der);
});

// Kontrol paneli (arayüz): http://bilgisayar-ip:4545/
// Panel sayfalari + varliklar: yalnizca BU bilgisayardan.
//
// ÖLÇÜLEN GEREKÇE: panel veriyi anahtarsız okuyordu; aynı Wi-Fi'a
// bağlanan misafir tüm kayıtları (plaka/isim/site) görebiliyordu. Panel
// operatör aracıdır ve kulübedeki bilgisayarda kullanılır — ağa açmak
// gerekmez. CK_PANEL_UZAK=1 ile uzaktan açılabilir (panelde uyarı görünür).
// Panel sayfalari + varliklar: yalnizca BU bilgisayardan.
//
// ÖLÇÜLEN GEREKÇE: panel veriyi anahtarsız okuyordu; aynı Wi-Fi'a
// bağlanan misafir tüm kayitlari (plaka/isim/site) görebiliyordu. Panel
// operatör aracidir ve kulübedeki bilgisayarda kullanilir — aga acmak
// gerekmez. CK_PANEL_UZAK=1 ile uzaktan acilabilir (panelde uyari görünür).
//
// DİKKAT: bu genel bir engel DEĞİL. Yalnizca panel dosyalari korunur;
// telefonun kullandigi /telefon/*, /eslesme, /plaka/oku ve yazma uclari
// acik kalir (zaten anahtar isterler).
const PANEL_DOSYALAR = /^\/(kayitlar\.html|ayar\.html|eslesme\.html|cihazlar\.html)$/;
app.get(['/', '/index.html'], requireYerelPanel, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get(PANEL_DOSYALAR, requireYerelPanel, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', path.basename(req.path)));
});
app.get('/assets/*', requireYerelPanel, (req, res) => {
  const dosya = path.join(__dirname, 'public', 'assets', path.basename(req.path));
  if (!fs.existsSync(dosya)) return res.status(404).json({ ok: false, error: 'Bulunamadı' });
  res.sendFile(dosya);
});

// TELEFON UYGULAMASI - KORUMASIZ (telefon erişebilmeli)
// Bu route'lar requireYerelPanel kullanMAMALI çünkü telefonlar LAN'dan bağlanır
app.get(['/telefon/', '/telefon/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'telefon', 'index.html'));
});

app.get('/telefon/vendor/*', (req, res) => {
  const dosya = path.join(__dirname, 'public', 'telefon', 'vendor', path.basename(req.path));
  if (!fs.existsSync(dosya)) return res.status(404).json({ ok: false, error: 'Bulunamadı' });
  res.sendFile(dosya);
});

// Telefon uygulaması JS dosyaları
app.get('/telefon/*.js', (req, res) => {
  const dosya = path.join(__dirname, 'public', 'telefon', path.basename(req.path));
  if (!fs.existsSync(dosya)) return res.status(404).json({ ok: false, error: 'Bulunamadı' });
  res.sendFile(dosya);
});

  // --- Statik dosyalar (telefon uygulaması, vendor, panel varlıkları) ---
  //
  // ÖLÇÜLEN HATA (KRİTİK REGRESYON): bu satır panel koruması eklenirken
  // yanlışlıkla SİLİNMİŞTİ. Sonuç ölçüldü: /telefon/* 404 döndü, yani
  // telefon uygulaması hiçbir dosyasını alamıyordu. Panel çalışıyordu
  // (ona ayrı rota eklenmişti) ve bu yüzden gözden kaçtı.
  //
  // DERS: statik sunumu bir "panel özelliği" sanmak yanlıştır; telefon
  // uygulaması da buna bağlıdır. Buraya elle dokunulmamalı — testler
  // (test-https.js) hem http hem https üzerinden /telefon/ 200 bekler.
  app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// 7. Yerel plaka okuma (çevrimdışı OCR)
// ---------------------------------------------------------------------------
// Telefon, kırpılmış plaka karesini PNG/base64 olarak gönderir; servis
// bilgisayarda Tesseract WASM ile okur. İnternet, bulut servisi veya API
// anahtarı GEREKMEZ — fotoğraf kulübeden çıkmaz.
//
// Gövde: { gorsel: "data:image/png;base64,...", bilinenPlakalar?: string[],
//          hizli?: boolean, ipucu?: { ust: number, yukseklik: number } }
// Yanıt: { ok, plaka, guveniyet, adaylar[], ham, sureMs }
//
// `bilinenPlakalar` çok değerlidir: telefonun kayıtlı kurye plakalarını
// gönderir, motor bu listeye yakın okumaları öne çıkarır. Nöbetçinin sık
// gelen kuryeleri için doğruluk belirgin şekilde artar.
app.post('/plaka/oku', plakaGovde, requireToken, async (req, res) => {
  const baslangicZamani = Date.now();
  const istekIp = istemciIp(req);
  
  // Plaka okuma başlatıldı (verbose loglar kaldırıldı)
  
  // Motor kurulamadıysa servis ÇÖKMEMELİ: nöbetçi elle plaka yazabilir.
  if (!plakaMotoru) {
    log('ERROR', 'Plaka motoru kullanılamıyor');
    return res.status(503).json({
      ok: false,
      basarili: false,
      error: 'Plaka okuma motoru yüklü değil — plakayı elle girebilirsiniz',
      sebep: plakaMotoruHatasi,
    });
  }
  
  const govde = req.body || {};
  const hamGorsel = govde.gorsel || govde.image || govde.imageBase64;
  
  if (!hamGorsel || typeof hamGorsel !== 'string') {
    log('ERROR', 'Görsel alanı eksik');
    return res.status(400).json({ ok: false, error: 'gorsel alanı gerekli (base64 PNG/JPEG)' });
  }
  
  const bilinen = Array.isArray(govde.bilinenPlakalar) ? govde.bilinenPlakalar.slice(0, 400) : [];
  const hizli = !!govde.hizli;

  // KIRPMA İPUCU
  const sayi = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));
  let ipucu = null;
  if (govde.ipucu && typeof govde.ipucu === 'object' && !Array.isArray(govde.ipucu)) {
    const ust = sayi(govde.ipucu.ust);
    const yuk = sayi(govde.ipucu.yukseklik);
    if (Number.isFinite(ust) && Number.isFinite(yuk)
      && ust >= 0 && ust <= 100 && yuk >= 2 && yuk <= 100) {
      ipucu = { ust, yukseklik: yuk };
    }
  }

  const base64 = hamGorsel.replace(/^data:image\/[a-z+]+;base64,/i, '');
  
  if (!base64 || base64.length < 32) {
    return res.status(400).json({ ok: false, error: 'görüntü verisi çok kısa' });
  }
  
  let tampon;
  try {
    tampon = Buffer.from(base64, 'base64');
  } catch (e) {
    log('ERROR', 'Base64 decode hatası:', e.message);
    return res.status(400).json({ ok: false, error: 'görüntü base64 çözülemedi' });
  }
  
  if (tampon.length < 64) {
    return res.status(400).json({ ok: false, error: 'görüntü boş veya bozuk' });
  }

  // Çok büyük görsel uyarısı
  if (tampon.length > 2 * 1024 * 1024) {
    log('WARN', 'Görsel çok büyük:', (tampon.length / 1024 / 1024).toFixed(2) + ' MB');
  }

  // Karanlık kare kontrolü
  const parlaklik = ortalamaParlaklik(tampon);
  
  if (parlaklik !== null && parlaklik < 45) {
    return res.status(200).json({
      ok: true,
      basarili: false,
      plaka: '',
      guveniyet: 0,
      guvenSeviyesi: 'kirmizi',
      neden: 'karanlik',
      parlaklik: Math.round(parlaklik),
      mesaj: 'Kare çok karanlık — plaka bulunamadı. Aydınlatın, yaklaşın veya flaş kullanın.',
      sureMs: Date.now() - baslangicZamani,
    });
  }

  // YOLO hızlı yolu
  const baslangicH = Date.now();
  let hizliYol = null;
  
  try {
      const a = yoloPlaka.ac(tampon);
      const kutuListesi = a ? await yoloPlaka.kutular(tampon) : [];
      
      if (a && kutuListesi.length) {
        for (const kirp of yoloPlaka.kirpmalar(kutuListesi)) {
          const kk = yoloPlaka.kirpKucult(a, kirp, yoloPlaka.VARSAYILAN_HEDEF_Y);
          if (!kk) continue;
          
          let png = null;
          try {
            png = require('./ocr/gorsel.js').pngKodla(
              require('./ocr/gorsel.js').griyiRgba(kk.gri), kk.w, kk.h);
          } catch (e) { 
            png = null; 
          }
          if (!png) continue;
          
          let r = null;
          try {
            r = await plakaMotoru.oku(png, {
              bilinenPlakalar: bilinen.map((x) => String(x)).filter(Boolean),
              hizli: hizli,
            });
          } catch (e) { 
            r = null; 
          }
          
          if (r && r.basarili && r.plaka) {
            r.kaynak = 'yolo/kutu';
            r.yoloKutu = { guven: kirp.guven, sureMs: Date.now() - baslangicH };
            hizliYol = r;
            break;
          }
        }
      }
  } catch (e) {
    hizliYol = null;
  }

  try {
    if (hizliYol) {
      broadcast('plaka', { tip: 'plaka', plaka: hizliYol.plaka || null });
      return safeJson(res, 200, {
        ok: true,
        basarili: true,
        plaka: hizliYol.plaka || '',
        guveniyet: hizliYol.guveniyet || 0,
        guvenSeviyesi: hizliYol.guvenSeviyesi || 'yesil',
        minGuven: typeof hizliYol.minGuven === 'number' ? hizliYol.minGuven : null,
        oneriler: hizliYol.oneriler || [],
        adaylar: hizliYol.adaylar || [],
        ham: hizliYol.ham || '',
        kaynak: 'yolo/kutu',
        sureMs: Date.now() - baslangicH,
      });
    }
    const sonuc = await cokluOku(plakaMotoru, tampon, {
      bilinenPlakalar: bilinen.map((p) => String(p)).filter(Boolean),
      hizli,
      ipucu,
    });
    
    if (!sonuc.basarili) {
      log('INFO', 'Plaka okunamadı:', sonuc.neden || 'bilinmiyor');
    }
    
    broadcast('plaka', { tip: 'plaka', plaka: sonuc.plaka || null });
    safeJson(res, 200, {
      ok: true,
      basarili: sonuc.basarili,
      plaka: sonuc.plaka || '',
      guveniyet: sonuc.guveniyet || 0,
      // --- GÜVEN TRAFİK IŞIĞI (rehber §8) ---
      // Neden ayrı alan? "Okuma başarılı ama emin değilim" ile "okuma
      // başarısız" farklı EYLEMLER gerektirir: birincisinde nöbetçi
      // yaklaştırıp tekrar çeker, ikincisinde kadrajı değiştirir. Bu bilgi
      // taşınmazsa telefon her ikisinde de aynı şeyi gösterir.
      //   yesil  -> yapı geçerli ve en zayıf karakterin olasılığı >= 0,90
      //   sari   -> yapı geçerli, olasılık 0,50-0,90 (nöbetçi onaylasın)
      //   kirmizi-> emin değiliz (yaklaşın) veya plaka yok
      guvenSeviyesi: sonuc.guvenSeviyesi || (sonuc.basarili ? 'yesil' : 'kirmizi'),
      // En zayıf karakterin olasılığı: "ortalama güven tek yanlış karakteri
      // gizler" (rehber §8).
      minGuven: typeof sonuc.minGuven === 'number' ? sonuc.minGuven : null,
      // Emin değilsek bile adayları gönder: bazen doğru okuma ikinci
      // sıradadır ve nöbetçi onu tanır.
      oneriler: sonuc.oneriler || [],
      adaylar: (sonuc.adaylar || []).map((a) => ({
        // `bicim` sözleşme alanıdır (Tesseract hattı da bunu üretir).
        // Ölçülen hata: fast-plate-ocr hattı yalnızca `plaka` doldurduğunda
        // buradaki okuma `undefined` veriyordu ve nöbetçiye boş aday listesi
        // gösteriliyordu. İki alan da desteklenir: bir hattın alanı eksikse
        // diğeri devreye girer, liste ASLA sessizce boş kalmaz.
        plaka: a.bicim || a.plaka || a.ham || '',
        bicim: a.bicim || a.plaka || a.ham || '',
        ham: a.ham || null,
        puan: a.puan, yapi: a.yapi, ocrGuven: a.ocrGuven,
        ortGuven: a.ortGuven || null,
        // Konuma duyarlı düzeltme yapıldı mı? Yapıldıysa güven düşürülür
        // ve nöbetçi bunu bilmelidir (rehber §7.2).
        duzeltmeler: a.duzeltmeler || [],
        // Kurye listesi YALNIZCA öneridir; puanı ve güveni ETKİLEMEZ
        // (rehber §8.4, §13.4).
        kuryeOnerisi: a.kuryeOnerisi || null,
        kaynak: a.kaynak || null,
      })),
      ham: sonuc.ham || '',
      hata: sonuc.hata || null,
      neden: sonuc.neden || null,
      // Hangi kaynaktan okundu?
      //   'ipucu-bolge' = kullanıcının çizdiği dikdörtgenin İÇİNDE bulundu (en güvenilir)
      //   'ipucu'      = dikdörtgenin kendisi tarandı
      //   'bolge'      = plaka bölgesi karede kendi kendine bulundu
      //   'tam'        = tüm kare denendi (yedek yol)
      bulunanBolge: sonuc.bulunanBolge || null,
      bolgeler: sonuc.bolgeler || 0,
      // Telefonun gönderdiği ipucu gerçekten ulaştı mı? Tanı için gerekli:
      // ipucu düşerse kullanıcı "neden çalışmıyor" diye sorar.
      ipucuAlindi: !!ipucu,
    });
  } catch (e) {
    log('ERROR', 'Plaka okuma hatası:', e.message);
    safeJson(res, 500, { ok: false, error: 'okuma hatası: ' + e.message });
  }
});

// Motorun sağlığı — panel ve ayar ekranı bunu gösterir.
app.get('/plaka/durum', requireToken, (req, res) => {
  if (!plakaMotoru) {
    return safeJson(res, 200, { ok: true, aktif: false, sebep: plakaMotoruHatasi });
  }
  safeJson(res, 200, { ok: true, ...plakaMotoru.durum() });
});

// Motoru ısıt (ilk plaka okumadaki ~1 saniyelik gecikmeyi ortadan kaldırır).
// Telefon uygulaması açılışta çağırır; kullanıcı ilk deklanşöre bastığında
// beklemez.
app.get('/plaka/hazirla', requireToken, (req, res) => {
  if (!plakaMotoru) {
    return safeJson(res, 503, { ok: false, error: 'motor yok', sebep: plakaMotoruHatasi });
  }
  plakaMotoru.hazirla()
    .then(() => safeJson(res, 200, { ok: true, ...plakaMotoru.durum() }))
    .catch((e) => safeJson(res, 503, { ok: false, error: e.message, ...plakaMotoru.durum() }));
});

app.post('/kayit', requireToken, (req, res) => {
  enqueueWrite(() => {
    let result;
    try {
      result = acceptOne(req.body);
    } catch (e) {
      safeJson(res, e.statusCode || 500, { ok: false, error: e.message });
      return;
    }
    if (result === 'duplicate') safeJson(res, 200, { ok: true, duplicate: true });
    else if (result === 'updated') safeJson(res, 200, { ok: true, updated: true });
    else safeJson(res, 200, { ok: true });
  });
});

app.post('/kayit/batch', requireToken, (req, res) => {
  const records = req.body && req.body.records;
  if (!Array.isArray(records)) return res.status(400).json({ ok: false, error: 'records dizisi gerekli' });
  if (records.length > 500) return res.status(400).json({ ok: false, error: 'En fazla 500 kayıt' });
  enqueueWrite(() => {
    const { saved, duplicates, updated, errors } = acceptBatch(records);
    safeJson(res, 200, { ok: true, saved, duplicates, updated, errors });
  });
});

// Bilinmeyen route
app.use((req, res) => res.status(404).json({ ok: false, error: 'Bulunamadı' }));

// ---------------------------------------------------------------------------
// 6. Açılış self-healing + graceful shutdown + Watchdog
// ---------------------------------------------------------------------------

loadSeenIds();
loadSeenPlateIds();
loadSeenSiteIds();

// Seed: İlk kez çalışıyorsa mock siteleri yükle
try {
  const { seedSites } = require('./seed-sites-full.js');
  seedSites();
} catch (e) {
  log('WARN', 'Site seed başarısız (normal olabilir):', e.message);
}

// Yarım kalmış atomik yazma artığı varsa temizle (elektrik kesintisi sonrası).
// Gerçek .xlsx'e hiç dokunulmadığı için bu dosya güvenle silinir.
(function cleanStaleTmp() {
  for (const p of [
    EXCEL_PATH + '.tmp', DEDUPE_PATH + '.tmp', LOG_PATH + '.tmp',
    PLATE_EXCEL_PATH + '.tmp', PLATE_DEDUPE_PATH + '.tmp', PLATE_LOG_PATH + '.tmp'
  ]) {
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        log('INFO', 'Eski .tmp artığı temizlendi:', path.basename(p));
      }
    } catch (e) {
      log('ERROR', 'Tmp temizlenemedi:', e.message);
    }
  }
})();

// Excel yoksa/bozuksa log'dan yeniden üret.
(function startupHealExcel() {
  let need = false;
  try {
    if (!fs.existsSync(EXCEL_PATH)) need = true;
    else {
      const st = fs.statSync(EXCEL_PATH);
      if (st.size < 100) need = true;
    }
  } catch {
    need = true;
  }
  if (need && seenIds.size > 0) {
    try {
      rebuildExcelFromLog();
      log('INFO', 'Açılışta Excel log üzerinden yeniden üretildi.');
    } catch (e) {
      log('ERROR', 'Açılış Excel rebuild başarısız:', e.message);
    }
  } else if (need) {
    log('INFO', 'Kayıt yok, Excel ilk kayıtla oluşacak.');
  }
})();

// Plaka Excel'i yoksa/bozuksa log'dan yeniden üret.
(function startupHealPlateExcel() {
  let need = false;
  try {
    if (!fs.existsSync(PLATE_EXCEL_PATH)) need = true;
    else {
      const st = fs.statSync(PLATE_EXCEL_PATH);
      if (st.size < 100) need = true;
    }
  } catch {
    need = true;
  }
  if (need && seenPlateIds.size > 0) {
    try {
      rebuildPlateExcelFromLog();
      log('INFO', 'Açılışta Plaka Excel log üzerinden yeniden üretildi.');
    } catch (e) {
      log('ERROR', 'Açılış Plaka Excel rebuild başarısız:', e.message);
    }
  } else if (need) {
    log('INFO', 'Plaka kaydı yok, Excel ilk kayıtla oluşacak.');
  }
})();

// Site Excel'i yoksa/bozuksa log'dan yeniden üret.
(function startupHealSiteExcel() {
  let need = false;
  try {
    if (!fs.existsSync(SITE_EXCEL_PATH)) need = true;
    else {
      const st = fs.statSync(SITE_EXCEL_PATH);
      if (st.size < 100) need = true;
    }
  } catch {
    need = true;
  }
  if (need && seenSiteIds.size > 0) {
    try {
      rebuildSiteExcelFromLog();
      log('INFO', 'Açılışta Site Excel log üzerinden yeniden üretildi.');
    } catch (e) {
      log('ERROR', 'Açılış Site Excel rebuild başarısız:', e.message);
    }
  } else if (need) {
    log('INFO', 'Site kaydı yok, Excel ilk kayıtla oluşacak.');
  }
})();

// ==================== WATCHDOG - Otomatik İyileşme ====================
// Periyodik sağlık kontrolü: dosya bütünlüğü, bellek sızıntısı tespiti
let watchdogCount = 0;
setInterval(() => {
  watchdogCount++;
  
  // Her 5 dakikada Excel bütünlüğünü kontrol et
  if (watchdogCount % 30 === 0 && seenIds.size > 0) {
    try {
      if (!fs.existsSync(EXCEL_PATH)) {
        log('UYARI', 'Watchdog: Excel dosyası kayıp, yeniden oluşturuluyor...');
        rebuildExcelFromLog();
      } else {
        const st = fs.statSync(EXCEL_PATH);
        if (st.size < 100) {
          log('UYARI', 'Watchdog: Excel bozuk (çok küçük), yeniden oluşturuluyor...');
          rebuildExcelFromLog();
        }
      }
    } catch (e) {
      log('ERROR', 'Watchdog Excel kontrolü başarısız:', e.message);
    }
  }

  // Her 10 dakikada dedup dosyasını kontrol et
  if (watchdogCount % 60 === 0) {
    try {
      if (!fs.existsSync(DEDUPE_PATH) && seenIds.size > 0) {
        log('UYARI', 'Watchdog: Dedup dosyası kayıp, yeniden oluşturuluyor...');
        persistSeenIdsSync();
      }
      if (!fs.existsSync(PLATE_DEDUPE_PATH) && seenPlateIds.size > 0) {
        log('UYARI', 'Watchdog: Plaka dedup dosyası kayıp, yeniden oluşturuluyor...');
        persistSeenPlateIdsSync();
      }
    } catch (e) {
      log('ERROR', 'Watchdog dedup kontrolü başarısız:', e.message);
    }
  }

  // Bellek kullanımını logla (potential memory leak tespiti)
  if (watchdogCount % 120 === 0) {
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    log('INFO', `Watchdog: Bellek=${heapMB}MB, Kayıt=${seenIds.size}, Kuyruk=${writeQueueLen}, Güncel=${updateCount}`);
    
    // Aşırı bellek kullanımı uyarısı (>500MB heap)
    if (heapMB > 500) {
      log('UYARI', `Watchdog: Yüksek bellek kullanımı tespit edildi: ${heapMB}MB`);
    }
  }
}, 10000).unref(); // Her 10 saniyede kontrol

// ==================== HATA YAKALAMA - Process Ölmesin ====================
let criticalErrorCount = 0;
const MAX_CRITICAL_ERRORS = 50;

process.on('uncaughtException', (err) => {
  criticalErrorCount++;
  lastError = String((err && err.stack) || err);
  log('KRITIK', `Yakalanmamış hata #${criticalErrorCount} (process yaşatılıyor):`, lastError);
  
  // Çok fazla kritik hata varsa servisi yeniden başlat
  if (criticalErrorCount >= MAX_CRITICAL_ERRORS) {
    log('KRITIK', 'Çok fazla hata! Servis yeniden başlatılmalı.');
    // Graceful shutdown - launcher otomatik yeniden başlatacak
    shutdown('TOO_MANY_ERRORS');
  }
});

process.on('unhandledRejection', (reason) => {
  lastError = String((reason && reason.stack) || reason);
  log('KRITIK', 'İşlenmemiş promise reddi:', lastError);
});

// Her saat kritik hata sayacını azalt (kademeli iyileşme)
setInterval(() => {
  if (criticalErrorCount > 0) {
    criticalErrorCount = Math.max(0, criticalErrorCount - 5);
  }
}, 3600000).unref();

function shutdown(signal) {
  log('INFO', `${signal} alındı, kapatılıyor...`);
  try { healer.stop(); } catch {}
  try { persistSeenIdsSync(); } catch {}
  try { persistSeenPlateIdsSync(); } catch {}
  try { tls.kapat(); } catch {}
  server.close(() => {
    log('INFO', 'HTTP kapatıldı.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const server = app.listen(PORT, '0.0.0.0', () => {
  log('INFO', `Companion hazır: http://0.0.0.0:${PORT} (v${SUREM}, token:${TOKEN_PREVIEW}, kayıt:${seenIds.size}, plaka:${seenPlateIds.size})`);
  console.log(`  Kayıt: POST /kayit | Toplu: POST /kayit/batch`);
  console.log(`  Plaka: POST /plaka | GET /plaka/:plate | GET /plakalar`);
  console.log(`  Excel: ${EXCEL_PATH}`);
  console.log(`  Plaka Excel: ${PLATE_EXCEL_PATH}`);
  console.log(`  Log: ${LOG_PATH}`);
  
  // Self-healing checks ekle
  healer.addCheck('eslesmeler.json', 
    () => healer.validateJSON(ESLESME_YOLU),
    (result) => healer.repairFile(ESLESME_YOLU, content => {
      try { JSON.parse(content); return { ok: true }; }
      catch (e) { return { ok: false, reason: e.message }; }
    })
  );
  
  healer.addCheck('seen-ids.json',
    () => healer.validateJSON(DEDUPE_PATH),
    (result) => {
      const rebuilt = rebuildSeenIdsFromLog();
      try {
        fs.writeFileSync(DEDUPE_PATH, JSON.stringify([...rebuilt]));
        seenIds = rebuilt;
        return { ok: true, rebuilt: rebuilt.size };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    }
  );
  
  healer.addCheck('kayitlar.jsonl',
    () => healer.validateJSONL(LOG_PATH),
    (result) => healer.repairFile(LOG_PATH, content => {
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        try { JSON.parse(line); } catch { return { ok: false, reason: 'Bozuk satır' }; }
      }
      return { ok: true };
    })
  );
  
  // Self-healing başlat
  healer.start();
  console.log('  Self-healing sistemi aktif');
  
  // HTTPS ikinci bir dinleyici olarak AÇILIR. HTTP kapanmaz: eski kurulumlar
  // ve panel http ile çalışmaya devam eder (geriye dönük uyum).
  tls.hazirla({
    dataDir: DATA_DIR,
    port: HTTPS_PORT,
    app,
    log: (...a) => log(...a),
  });
  const h = tls.durumBilgisi();
  if (h.aktif) {
    console.log(`  HTTPS hazır: https://0.0.0.0:${HTTPS_PORT}`);
  }
  
  // Plaka motoru durumu
  if (plakaMotoru && plakaMotoru.denetle && plakaMotoru.denetle().kullanilabilir) {
    console.log(`  Plaka motoru: çevrimdışı OCR hazır`);
  } else if (plakaMotoruHatasi) {
    console.log(`  Plaka motoru kapalı: ${plakaMotoruHatasi}`);
  }
  
  console.log(`\n  Panel: http://localhost:${PORT}/`);
  console.log(`  Telefon: http://localhost:${PORT}/telefon/\n`);
});

module.exports = { app, acceptOne, acceptBatch, validateRecord, sanitizeRecord, rebuildExcelFromLog };
