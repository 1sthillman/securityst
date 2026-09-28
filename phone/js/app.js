/* Uygulama kabuğu: form + liste + rozet + ayarlar.
 * saveVisit() mevcut davranışı korur: önce yerelde sakla, sonra SYNC.enqueue (await'siz).
 */
import { dbPutVisit, dbGetVisits, idbQueueGetAll } from './db.js';
import { SYNC } from './sync.js';

const $ = (s) => document.querySelector(s);

function fmtTR(ts) {
  return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}
function dateTR(ts) {
  return new Date(ts).toLocaleDateString('tr-TR');
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function mkVisit(d) {
  const ts = Date.now();
  return {
    id: SYNC.newId(),
    site: (d.site || '').trim(),
    unit: (d.unit || '').trim(),
    courier: (d.courier || '').trim(),
    company: (d.company || '').trim(),
    plate: (d.plate || '').trim().toUpperCase(),
    guard: (d.guard || '').trim(),
    note: (d.note || '').trim(),
    date: dateTR(ts),
    time: fmtTR(ts),
    ts,
  };
}

export async function saveVisit(d) {
  if (!d.plate || !String(d.plate).trim()) throw new Error('Plaka zorunlu');
  const rec = mkVisit(d);
  await dbPutVisit(rec); // yerel kopya — her zaman
  // Sunucu kaydı: kuyruğa yaz + fırsatçı gönder (await YOK — UI bloklanmaz)
  SYNC.enqueue({
    id: rec.id, site: rec.site, unit: rec.unit, courier: rec.courier,
    company: rec.company, plate: rec.plate, guard: rec.guard,
    note: rec.note, date: rec.date, time: rec.time, ts: rec.ts,
  }).catch((e) => console.warn('enqueue hatası', e));
  return rec;
}

// --- rozet ---
function paintSyncBadge(st) {
  const badge = $('#syncBadge');
  if (!badge) return;
  if (!st.configured) {
    badge.className = 'badge warn';
    badge.innerHTML = '<span class="dot"></span> Eşleşmedi';
    $('#syncDetail').textContent = 'Ayarlardan bilgisayar adresini girin.';
    return;
  }
  if (st.flushing) {
    badge.className = 'badge busy';
    badge.innerHTML = '<span class="dot pulse"></span> Gönderiliyor…';
  } else if (st.pending > 0) {
    badge.className = 'badge warn';
    badge.innerHTML = `<span class="dot"></span> Bekleyen: ${st.pending}`;
  } else {
    badge.className = 'badge ok';
    badge.innerHTML = '<span class="dot"></span> Senkron';
  }
  const parts = [];
  parts.push(st.online ? 'çevrimiçi' : 'çevrimdışı');
  if (st.lastOkAt) parts.push('son başarı: ' + new Date(st.lastOkAt).toLocaleTimeString('tr-TR'));
  if (st.lastError) parts.push('hata: ' + st.lastError);
  if (st.pending > 0) parts.push(`sonraki deneme ~${Math.round(st.nextRetryMs / 1000)}sn`);
  $('#syncDetail').textContent = parts.join(' • ');
}

// --- liste ---
async function refreshList() {
  const rows = await dbGetVisits(100);
  const box = $('#list');
  if (!rows.length) {
    box.innerHTML = '<div class="empty">Henüz kayıt yok. İlk girişi yukarıdan ekleyin.</div>';
    return;
  }
  const queued = new Set((await idbQueueGetAll()).map((r) => r.id));
  box.innerHTML = rows
    .map(
      (r) => `<div class="card ${queued.has(r.id) ? 'pending' : ''}">
      <div class="plate">${esc(r.plate)}</div>
      <div class="meta">${esc(r.site)} ${esc(r.unit)} • ${esc(r.courier)}${r.company ? ' / ' + esc(r.company) : ''}</div>
      <div class="sub">${esc(r.date)} ${esc(r.time)} • ${esc(r.guard)}${r.note ? ' • ' + esc(r.note) : ''}${queued.has(r.id) ? ' • <b>kuyrukta</b>' : ''}</div>
    </div>`
    )
    .join('');
}

// --- ayarlar ---
async function loadSettingsUI() {
  const st = await SYNC.status();
  $('#baseUrl').value = st.baseUrl || '';
  $('#token').value = SYNC.token || '';
}

async function init() {
  await SYNC.init();
  SYNC.onChange((st) => {
    paintSyncBadge(st);
    refreshList().catch(() => {});
  });
  paintSyncBadge(await SYNC.status());
  await loadSettingsUI();
  await refreshList();

  $('#visitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#saveBtn');
    btn.disabled = true;
    try {
      const d = {
        site: $('#fSite').value, unit: $('#fUnit').value, courier: $('#fCourier').value,
        company: $('#fCompany').value, plate: $('#fPlate').value, guard: $('#fGuard').value,
        note: $('#fNote').value,
      };
      await saveVisit(d);
      e.target.reset();
      $('#fPlate').focus();
      toast('Kaydedildi ✓ (kuyruğa alındı)');
      await refreshList();
    } catch (err) {
      toast('Hata: ' + err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  $('#saveSettings').addEventListener('click', async () => {
    try {
      await SYNC.configure($('#baseUrl').value, $('#token').value);
      toast('Ayarlar kaydedildi ✓');
    } catch (e) {
      toast('Hata: ' + e.message, true);
    }
  });

  $('#testBtn').addEventListener('click', async () => {
    try {
      const data = await SYNC.testConnection($('#baseUrl').value, $('#token').value);
      toast(`Bağlantı OK • sunucuda ${data.kayitSayisi} kayıt`);
    } catch (e) {
      toast('Bağlantı başarısız: ' + e.message, true);
    }
  });

  $('#flushBtn').addEventListener('click', async () => {
    const st = await SYNC.status();
    if (st.pending >= 10) await SYNC.tryFlushBatch();
    else await SYNC.tryFlush('manual');
    await refreshList();
  });

  // Görevli adı kalıcı olsun (nöbetçi her seferinde yazmasın)
  const guard = localStorage.getItem('guard');
  if (guard) $('#fGuard').value = guard;
  $('#fGuard').addEventListener('change', (e) => localStorage.setItem('guard', e.target.value));
}

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = 'toast'), 2600);
}

document.addEventListener('DOMContentLoaded', init);
