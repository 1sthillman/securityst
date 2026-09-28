'use strict';
/**
 * En küçük QR kod üreteci — eşleşme QR'ı için (bağımlılık yok, çevrimdışı).
 * Kapsam: bayt kipi, hata düzeltme M (EC_LEVEL_BITS=0b00), sürüm 1-6.
 * Kapasite: V6-M = 105 bayt. Sadece sürüm 1-6 desteklenir (OpenCV ile doğrulandı).
 *
 * DOĞRULAMA: tests/test-qr.js üretimi jsQR (bağımsız çözücü) ile karşılaştırır,
 * V1-V6 arası tüm bantlar birebir çözülür. python-qrcode ile kod sözcüğü ve
 * Reed-Solomon kalanları da birebir doğrulanmıştır (bkz. tests/refec.py).
 */

// --- Galois alanı GF(256) ---
const EXP = new Array(512);
const LOGT = new Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOGT[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOGT[a] + LOGT[b]];
}
// a / b (GF(256) bölmesi) — a·b⁻¹
function gfInvMul(a, b) {
  if (a === 0) return 0;
  return EXP[LOGT[a] + 255 - LOGT[b]];
}

// --- Sürüm tablosu (M düzeyi) — python-qrcode/QRTools ile birebir doğrulanmış.
// total = toplam kod sözcüğü (veri + EC), ec = blok başına EC, blocks = blok sayısı
const VERSIONS = {
  1: { total: 26, ec: 10, blocks: 1, align: [] },
  2: { total: 44, ec: 16, blocks: 1, align: [6, 18] },
  3: { total: 70, ec: 26, blocks: 1, align: [6, 22] },
  4: { total: 100, ec: 18, blocks: 2, align: [6, 26] },
  5: { total: 134, ec: 24, blocks: 2, align: [6, 30] },
  6: { total: 172, ec: 16, blocks: 4, align: [6, 34] },
};


/**
 * Reed-Solomon üretici polinomu.
 * python-qrcode/QRTools ile birebir: Π(x - α^i) için katsayılar
 * EN YÜKSEK kuvvetten başlayarak saklanır → [1, α^(n-1), …, α, 1].
 */
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];                       // x·poly
      next[j + 1] ^= gfMul(poly[j], EXP[i]);     // α^i·poly
    }
    poly = next;
  }
  return poly;
}

/**
 * Veri sözcüklerinin Reed-Solomon kalanı (hata düzeltme sözcükleri).
 * python-qrcode'nin Polynomial.__mod__ ile birebir:
 *   1) raw = veri + degree adet 0  (polinom degree kadar kaydırılır)
 *   2) raw % rsPoly               (uzun bölme, katsayılar yüksek kuvvetten)
 *   3) EC = kalanın tamamı
 */
function rsRemainder(data, degree) {
  const gen = rsGenerator(degree); // degree + 1 katsayı
  // 1) veri + degree sıfır
  let cur = data.concat(new Array(degree).fill(0));
  // 2) uzun bölme
  while (cur.length >= gen.length) {
    let lead = 0;
    while (lead < cur.length && cur[lead] === 0) lead++;
    cur = cur.slice(lead);
    if (cur.length < gen.length) break;
    const ratio = gfInvMul(cur[0], gen[0]);
    const next = [];
    for (let i = 0; i < gen.length; i++) next.push(cur[i] ^ gfMul(gen[i], ratio));
    for (let i = gen.length; i < cur.length; i++) next.push(cur[i]);
    cur = next;
  }
  // 3) kalanı degree kadar sıfırla ve döndür
  const out = new Array(degree).fill(0);
  for (let i = 0; i < Math.min(cur.length, degree); i++) out[i] = cur[i];
  return out;
}

// --- Bit yazıcı ---
function encodeData(text, version) {
  const bytes = Buffer.from(text, 'utf8');
  const v = VERSIONS[version];
  const dataWords = v.total - v.ec * v.blocks;
  const capBits = dataWords * 8;
  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  push(0b0100, 4);                                  // bayt kipi (MODE_8BIT_BYTE)
  push(bytes.length, version < 10 ? 8 : version < 27 ? 16 : 16); // uzunluk alanı
  for (const b of bytes) push(b, 8);
  if (bits.length > capBits) return null; // sığmadı
  const term = Math.min(4, capBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const words = [];
  for (let i = 0; i < bits.length; i += 8) {
    let w = 0;
    for (let j = 0; j < 8; j++) w = (w << 1) | bits[i + j];
    words.push(w);
  }
  const pads = [0xec, 0x11];
  for (let i = words.length, k = 0; i < dataWords; i++, k++) words.push(pads[k % 2]);
  return words;
}

function interleave(words, version) {
  const v = VERSIONS[version];
  const shortLen = v.total - v.ec * v.blocks;              // toplam veri kod sözcüğü
  const numBlocks = v.blocks;
  const shortBlockLen = Math.floor(shortLen / numBlocks);
  const numLongBlocks = shortLen % numBlocks;              // biraz uzun olan blok sayısı
  const shortBlockEc = v.ec;

  // Bloklara böl ve her birine EC üret
  const blocks = [];
  let k = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = shortBlockLen + (b >= numBlocks - numLongBlocks ? 1 : 0);
    const dat = words.slice(k, k + len);
    k += len;
    const ec = rsRemainder(dat, shortBlockEc);
    blocks.push({ dat, ec });
  }

  // Veri bloklar arası serpiştirme
  const out = [];
  const maxData = shortBlockLen + (numLongBlocks > 0 ? 1 : 0);
  for (let i = 0; i < maxData; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < blocks[b].dat.length) out.push(blocks[b].dat[i]);
    }
  }
  // EC bloklar arası serpiştirme
  for (let i = 0; i < shortBlockEc; i++) {
    for (let b = 0; b < numBlocks; b++) out.push(blocks[b].ec[i]);
  }
  return out;
}

// --- Matris ---
// Bulucu desen 7×7. python-qrcode ile birebir aynı kurulum:
// 8×8 alanın TAMAMI işaretlenir; dış halka (ayırıcı) açık renktir, köşeler de
// dış halkadır — bu yüzden 9×9 değil, 8×8 blok kullanılır.
function placeFinder(m, func, r, c) {
  const n = m.length;
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const dark =
        (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
        (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
        (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
      m[rr][cc] = dark;
      func[rr][cc] = true;
    }
  }
}

function buildBase(version) {
  const n = 17 + 4 * version;
  const m = Array.from({ length: n }, () => new Array(n).fill(null));
  const func = Array.from({ length: n }, () => new Array(n).fill(false));
  placeFinder(m, func, 0, 0);
  placeFinder(m, func, 0, n - 7);
  placeFinder(m, func, n - 7, 0);
  // Zamanlama desenleri: yalnızca boş (null) hücreler doldurulur
  // (python sırası: önce dikey sütun 6, sonra yatay satır 6)
  for (let r = 8; r < n - 8; r++) {
    if (m[r][6] === null) { m[r][6] = r % 2 === 0; func[r][6] = true; }
  }
  for (let c = 8; c < n - 8; c++) {
    if (m[6][c] === null) { m[6][c] = c % 2 === 0; func[6][c] = true; }
  }
  // Hizalama desenleri (5x5): kenar + merkez koyu, kalanlar açık.
  // python-qrcode ile birebir: yalnızca MERKEZ hücre boşsa çizilir
  // (bulucu desen veya zamanlama ile çakışan merkezler atlanır).
  const a = VERSIONS[version].align;
  for (const r of a) {
    for (const c of a) {
      if (m[r][c] !== null) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = dr === -2 || dr === 2 || dc === -2 || dc === 2 || (dr === 0 && dc === 0);
          m[r + dr][c + dc] = dark;
          func[r + dr][c + dc] = true;
        }
      }
    }
  }
  // Biçim bilgisi rezervasyonu: gerçek bitler placeFormat ile en son yazılır.
  // Yalnızca 30 hücre + karanlık modül; 8. satır/sütunun tamamı DEĞİL.
  for (let i = 0; i <= 8; i++) { func[i][8] = true; func[8][i] = true; }
  for (let i = 0; i < 7; i++) { func[n - 1 - i][8] = true; func[8][n - 1 - i] = true; }
  return { m, func, n };
}

/**
 * Veri bitlerini (maske UYGULANMIŞ halde) yerleştirir.
 * python-qrcode ile birebir: maske, veri yazılırken uygulanır; sonradan
 * tüm veri hücreleri bir kez daha çevrilmez (çift maske hatası olur).
 */
function placeData(m, func, words, mask) {
  const n = m.length;
  const bits = [];
  for (const w of words) for (let i = 7; i >= 0; i--) bits.push((w >> i) & 1);
  let bi = 0;
  let inc = -1;              // yön: -1 = yukarıdan aşağı
  let row = n - 1;
  for (let col = n - 1; col > 0; col -= 2) {
    // 6. sütun dikey zamanlama desenidir → atlanır (python: `if col <= 6: col -= 1`)
    if (col <= 6) col -= 1;
    const cols = [col, col - 1];
    for (;;) {
      for (const c of cols) {
        if (m[row][c] !== null || func[row][c]) continue;
        let dark = false;
        if (bi < bits.length) dark = bits[bi++] === 1;
        if (maskApplies(mask, row, c)) dark = !dark;
        m[row][c] = dark;
      }
      row += inc;
      if (row < 0 || row >= n) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }
}

// maske koşulları
function maskApplies(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function penalty(m) {
  const n = m.length;
  let p = 0;
  for (let r = 0; r < n; r++) {
    let run = 1;
    for (let c = 1; c < n; c++) {
      if (m[r][c] === m[r][c - 1]) run++;
      else { if (run >= 5) p += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) p += 3 + (run - 5);
  }
  for (let c = 0; c < n; c++) {
    let run = 1;
    for (let r = 1; r < n; r++) {
      if (m[r][c] === m[r - 1][c]) run++;
      else { if (run >= 5) p += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) p += 3 + (run - 5);
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (r + 1 < n && c + 1 < n) {
        const v = m[r][c];
        if (m[r + 1][c] === v && m[r][c + 1] === v && m[r + 1][c + 1] === v) p += 3;
      }
    }
  }
  const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
  const matchAt = (arr, i, pat) => { for (let k = 0; k < 11; k++) if (arr[i + k] !== pat[k]) return false; return true; };
  for (let r = 0; r < n; r++) for (let c = 0; c <= n - 11; c++) if (matchAt(m[r], c, pat1) || matchAt(m[r], c, pat2)) p += 40;
  for (let c = 0; c < n; c++) {
    const col = []; for (let r = 0; r < n; r++) col.push(m[r][c]);
    for (let r = 0; r <= n - 11; r++) if (matchAt(col, r, pat1) || matchAt(col, r, pat2)) p += 40;
  }
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) dark++;
  const pct = (dark * 100) / (n * n);
  const low = Math.floor(pct / 5) * 5, high = Math.ceil(pct / 5) * 5;
  p += Math.min(Math.abs(low - 50), Math.abs(high - 50)) * 2;
  return p;
}

// Biçim bilgisi (BCH 15,5) — ISO/IEC 18004.
// EC düzeyi 2 bit: python-qrcode sabitleriyle birebir
// (L=1, M=0, Q=3, H=2) — M düzeyi için üst 2 bit 00'dır.
const EC_LEVEL_BITS = 0b00; // M

function formatBits(mask) {
  const data = (EC_LEVEL_BITS << 3) | mask;
  let rem = data << 10;
  const gen = 0b10100110111; // x^10 + x^8 + x^5 + x^4 + x^2 + x + 1
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= gen << (i - 10);
  }
  return ((data << 10) | (rem & 0x3ff)) ^ 0b101010000010010;
}

/**
 * Biçim bilgisini (15 bit) iki kopyaya yazar.
 * python-qrcode / QRTools ile BİREBİR aynı indeksleme (LSB-first).
 * NOT: (n-8,8) sabit karanlık modüldür, format bilgisi DEĞİLDİR.
 */
function placeFormat(m, func, mask) {
  const n = m.length;
  const bits = formatBits(mask);
  // Dikey kopya
  for (let i = 0; i < 15; i++) {
    const b = ((bits >> i) & 1) === 1;
    if (i < 6) { m[i][8] = b; func[i][8] = true; }
    else if (i < 8) { m[i + 1][8] = b; func[i + 1][8] = true; }
    else { m[n - 15 + i][8] = b; func[n - 15 + i][8] = true; }
  }
  // Yatay kopya
  for (let i = 0; i < 15; i++) {
    const b = ((bits >> i) & 1) === 1;
    if (i < 8) { m[8][n - i - 1] = b; func[8][n - i - 1] = true; }
    else if (i < 9) { m[8][8] = b; func[8][8] = true; }
    else { m[8][15 - i - 1] = b; func[8][15 - i - 1] = true; }
  }
  // Sabit karanlık modül
  m[n - 8][8] = true;
  func[n - 8][8] = true;
}

function encode(text) {
  for (let version = 1; version <= 6; version++) {
    const words = encodeData(text, version);
    if (!words) continue;
    const stream = interleave(words, version);
    // python-qrcode ile aynı sıra: temel desenler → biçim bilgisi → veri (maskeli)
    // → boş hücreler açık. 8 maskenin cezası karşılaştırılır.
    let best = null, bestMask = 0, bestMat = null;
    for (let mask = 0; mask < 8; mask++) {
      const base = buildBase(version);
      const m = base.m, func = base.func, n = base.n;
      placeFormat(m, func, mask);
      placeData(m, func, stream, mask);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c] === null) m[r][c] = false;
      const score = penalty(m);
      if (best === null || score < best) { best = score; bestMask = mask; bestMat = m.map((row) => row.slice()); }
    }
    return { version, size: 17 + 4 * version, modules: bestMat, mask: bestMask };
  }
  const bayt = Buffer.from(text, 'utf8').length;
  // Sınır ÖLÇÜLDÜ (tahmin edilmedi): 106 bayt sığyor, 107 reddediliyor.
  throw new Error(
    `QR yükü V6-M kapasitesini aşıyor (${bayt} bayt, sınır 106). ` +
      "Yükü kısaltın: adresi kısa tutun veya anahtarı QR'a koymayın."
  );
}

function toSvg(qr, opts = {}) {
  const { scale = 6, margin = 4, dark = '#0A0D0D', light = '#ffffff' } = opts;
  const s = (qr.size + margin * 2) * scale;
  let rects = '';
  for (let r = 0; r < qr.size; r++) {
    let run = -1;
    for (let c = 0; c <= qr.size; c++) {
      const v = c < qr.size ? qr.modules[r][c] : false;
      if (v && run === -1) run = c;
      if (!v && run !== -1) {
        rects += `<rect x="${(run + margin) * scale}" y="${(r + margin) * scale}" width="${(c - run) * scale}" height="${scale}"/>`;
        run = -1;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" role="img" aria-label="Eşleşme QR kodu"><rect width="${s}" height="${s}" fill="${light}"/><g fill="${dark}">${rects}</g></svg>`;
}

module.exports = { encode, toSvg, VERSIONS };
// Birim testleri için iç API (alt çizgili, kararlı sayılmaz):
module.exports._test = { rsRemainder, rsGenerator, formatBits, gfMul };
