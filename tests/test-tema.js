'use strict';
// ============================================================================
//  Tema kontrast testi
// ----------------------------------------------------------------------------
//  Kullanıcının şartı: "arka plan siyahsa yazı beyaz, beyazsa siyah (iki temada
//  da okunaklı)". Burada theme.css'teki değişkenler okunup GERÇEK kontrast
//  oranları hesaplanır. Yarı saydam yüzeyler (--surface vb.) altlarındaki zemin
//  üzerine kompozit edilerek hesaba katılır.
//
//  Bu test gerçek bir hatayı yakalamıştı: açık temada --text-3, açık zeminde
//  yalnızca 1.75:1 idi (tablodaki soluk hücreler görünmez oluyordu).
// ============================================================================
const fs = require('fs');
const path = require('path');

const CSS = path.join(__dirname, '..', 'companion', 'public', 'assets', 'theme.css');
const css = fs.readFileSync(CSS, 'utf8');

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log(`PASS — ${name}`); }
  else { fail++; console.log(`FAIL — ${name}${extra ? ' :: ' + extra : ''}`); }
};

// --- Renk çözümleme ---------------------------------------------------------
function hex(h) {
  h = h.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: 1,
  };
}
function rgbaDeger(d) {
  const m = d.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((v) => parseFloat(v));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function uzerine(ust, alt) {   // alfa harmanlama
  return {
    r: ust.r * ust.a + alt.r * (1 - ust.a),
    g: ust.g * ust.a + alt.g * (1 - ust.a),
    b: ust.b * ust.a + alt.b * (1 - ust.a),
  };
}
function luminans({ r, g, b }) {
  const kanal = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
}
function kontrast(a, b) {
  const la = luminans(a), lb = luminans(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// --- Değişkenleri oku --------------------------------------------------------
function blokOku(baslangic, bitis) {
  const i = css.indexOf(baslangic);
  if (i < 0) return {};
  const j = bitis ? css.indexOf(bitis, i) : css.length;
  const govde = css.slice(i, j < 0 ? css.length : j);
  const c = {};
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(govde))) c[m[1]] = m[2].trim();
  return c;
}
const koyu = blokOku(':root {', 'html[data-tema="acik"]');
const acik = blokOku('html[data-tema="acik"] {', '* { box-sizing');

// --- Temaları çözümle -------------------------------------------------------
function temaCoz(degiskenler) {
  const zemin = hex(degiskenler['bg']);
  const yuzey = rgbaDeger(degiskenler.surface);          // kart zemini (yarı saydam)
  const yuzeyKat = yuzey ? uzerine(yuzey, zemin) : zemin;
  const metinler = {};
  for (const k of ['text', 'text-2', 'text-3', 'accent', 'cyan', 'ok', 'warn', 'danger']) {
    const d = degiskenler[k];
    if (d) metinler[k] = d.startsWith('#') ? hex(d) : rgbaDeger(d);
  }
  return { zemin, yuzey, yuzeyKat, metinler };
}
const T = { koyu: temaCoz(koyu), acik: temaCoz(acik) };

ok(koyu['bg'] && acik['bg'], 'iki tema da tanımlı (koyu + aydınlık)');
ok(koyu['text'] && acik['text'], 'iki temada da metin rengi tanımlı');

// Kullanıcının temel şartı: zemin koyuyken metin aydınlık, zemin aydınlıkken metin koyu
ok(luminans(T.koyu.zemin) < 0.05, 'koyu temada zemin gerçekten koyu');
ok(luminans(T.acik.zemin) > 0.7, 'aydınlık temada zemin gerçekten aydınlık');
ok(luminans(T.koyu.metinler.text) > luminans(T.koyu.zemin), 'koyu zeminde metin açık');
ok(luminans(T.acik.metinler.text) < luminans(T.acik.zemin), 'aydınlık zeminde metin koyu');

// --- Metin/zemin kontrastları (WCAG AA) -------------------------------------
const ESIK = 4.5;   // normal metin
const buyukEsik = 3.0;

for (const [ad, tema] of Object.entries(T)) {
  // Metin, sayfa zemininde
  for (const [rol, renk] of Object.entries(tema.metinler)) {
    const oran = kontrast(renk, tema.zemin);
    const buyuk = rol === 'accent' || rol === 'cyan' || rol === 'ok' || rol === 'warn' || rol === 'danger';
    const esik = buyuk ? buyukEsik : ESIK;
    ok(oran >= esik,
      `${ad}: --${rol} sayfa zemininde okunaklı (${oran.toFixed(2)}:1, gereken ${esik})`);
  }
  // Metin, kart zeminde (asıl okuma yüzeyi budur)
  for (const rol of ['text', 'text-2', 'text-3']) {
    const oran = kontrast(tema.metinler[rol], tema.yuzeyKat);
    ok(oran >= ESIK,
      `${ad}: --${rol} kart üzerinde okunaklı (${oran.toFixed(2)}:1, gereken ${ESIK})`);
  }
}

// --- Kart zemininin kendi okunaklılığı -------------------------------------
for (const [ad, tema] of Object.entries(T)) {
  const sayfaKontrast = kontrast(tema.yuzeyKat, tema.zemin);
  ok(sayfaKontrast >= 1.03,
    `${ad}: kart yüzeyi sayfa zemininden ayırt ediliyor (${sayfaKontrast.toFixed(2)}:1)`);
}

// --- Renk körlüğüne karşı: durum renkleri de metinden ayrışmalı -------------
for (const [ad, tema] of Object.entries(T)) {
  for (const rol of ['ok', 'warn', 'danger']) {
    const oran = kontrast(tema.metinler[rol], tema.metinler.text);
    ok(oran >= 1.35,
      `${ad}: durum rengi --${rol} metinden ayırt ediliyor (${oran.toFixed(2)}:1)`,
      'renk körlüğünde durum yalnızca renge bakılarak anlaşılamaz');
  }
}

console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
