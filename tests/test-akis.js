'use strict';
// ============================================================================
//  Panel akış (Canli) testi — tarayıcısız, core.js'i sahte ortamda çalıştırır
// ----------------------------------------------------------------------------
//  Buradaki asıl konu şu: gerçek hayatta birkaç panel sekmesi açık kaldığında
//  sunucu "çok fazla istek" (429) dönmeye başlıyordu. Sebebi, SSE her
//  koptuğunda yeni bir 15 saniyelik REST yoklama döngüsü açılması ve
//  öncekinin kapatılmamasıydı (kaçak döngü → her kopma bir istek kaynağı).
//
//  Test, sahte zamanlayıcı ve sahte EventSource ile bu sayıyı ÖLÇER.
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KOK = path.join(__dirname, '..');
const CORE = path.join(KOK, 'companion', 'public', 'assets', 'core.js');

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log(`PASS — ${name}`); }
  else { fail++; console.log(`FAIL — ${name}${extra ? ' :: ' + extra : ''}`); }
};

const kaynak = fs.readFileSync(CORE, 'utf8');

// ---------------------------------------------------------------------------
//  Kontrollü sahte ortam: zamanlayıcılar elle ilerletilir
// ---------------------------------------------------------------------------
function Ortam() {
  const durum = {
    arayuzler: [],        // açılan EventSource örnekleri
    arayuzSayisi: 0,
    arayuzKapatma: 0,
    fetchSayisi: 0,
    surecler: [],         // { tip, id, fn, ms, sonraki }
    sonrakiKimlik: 1,
    saat: 0,              // sanal saat (ms)
  };

  function zamanlayiciEkle(tip, fn, ms) {
    const id = durum.sonrakiKimlik++;
    const aralik = Math.max(0, ms || 0);
    durum.surecler.push({ tip, id, fn, ms: aralik, sonraki: durum.saat + aralik });
    return id;
  }
  function zamanlayiciSil(id) {
    durum.surecler = durum.surecler.filter((s) => s.id !== id);
  }

  // Sanal saati ilerlet: süresi dolan zamanlayıcıları çalıştır.
  // setInterval kendini yeniden kurar; setTimeout bir kez çalışıp silinir.
  function ilerlet(ms) {
    const hedef = durum.saat + ms;
    for (let adim = 0; adim < 500; adim++) {
      const s = durum.surecler
        .filter((t) => t.sonraki <= hedef)
        .sort((a, b) => a.sonraki - b.sonraki)[0];
      if (!s) break;
      durum.saat = s.sonraki;
      if (s.tip === 'setTimeout') zamanlayiciSil(s.id);
      else s.sonraki = durum.saat + Math.max(s.ms, 1);
      try { s.fn(); } catch (e) { /* sahte ortamda hata akışı bozmasın */ }
    }
    durum.saat = hedef;
  }
  function arkaPlanDonguleri() {
    return durum.surecler.filter((s) => s.tip === 'setInterval');
  }

  function EventSource(url) {
    durum.arayuzSayisi++;
    const o = { url, dinleyiciler: {} };
    o.addEventListener = (ad, fn) => { (o.dinleyiciler[ad] = o.dinleyiciler[ad] || []).push(fn); };
    o.close = () => { durum.arayuzKapatma++; };
    o.tetikle = (ad, veri) => (o.dinleyiciler[ad] || []).forEach((f) => f({ data: JSON.stringify(veri || {}) }));
    durum.arayuzler.push(o);
    return o;
  }

  const ctx = {
    console, JSON, Math, Date, Object, Array, Set, String, Number,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    EventSource,
    setTimeout: (fn, ms) => zamanlayiciEkle('setTimeout', fn, ms || 0),
    clearTimeout: (id) => zamanlayiciSil(id),
    setInterval: (fn, ms) => zamanlayiciEkle('setInterval', fn, ms || 0),
    clearInterval: (id) => zamanlayiciSil(id),
    fetch: function () {
      durum.fetchSayisi++;
      return Promise.resolve({ json: () => Promise.resolve({ kayitSayisi: 7 }) });
    },
    navigator: { clipboard: null },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {
      addEventListener: () => {},
      getElementById: () => null,
      documentElement: { setAttribute: () => {}, classList: { add: () => {}, remove: () => {} } },
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(kaynak, ctx, { filename: 'core.js' });

  return { ctx, durum, ilerlet, arkaPlanDonguleri };
}

// ---------------------------------------------------------------------------
// 1) Genel yapı
// ---------------------------------------------------------------------------
{
  const { ctx } = Ortam();
  ok(ctx.CK && typeof ctx.CK.Canli === 'function', 'core.js CK.Canli dışa açıyor');
  const c = new ctx.CK.Canli();
  ok(!!c && c.es === null && c.periyod === null, 'Canli ilk durumda bağlantı/zamanlayıcı yok');
  ok(typeof c.izle === 'function' && typeof c.kapat === 'function', 'Canli.izle ve Canli.kapat mevcut');
}

// ---------------------------------------------------------------------------
// 2) Sağlıklı akış: yedek yoklama AÇILMAMALI
// ---------------------------------------------------------------------------
{
  const { ctx, durum, ilerlet, arkaPlanDonguleri } = Ortam();
  const c = new ctx.CK.Canli();
  c.baglan();
  ok(durum.arayuzSayisi === 1, 'baglan() bir EventSource açıyor');
  ok(arkaPlanDonguleri().length === 0, 'SSE açıkken yedek REST yoklaması başlamıyor');

  durum.arayuzler[0].tetikle('durum', { kayitSayisi: 7 });
  ilerlet(60000);
  ok(arkaPlanDonguleri().length === 0, 'SSE sağlıklıyken 1 dakika geçse de yedek döngü açılmıyor');
  ok(c.durum && c.durum.kayitSayisi === 7, 'durum paketi işlendi');
}

// ---------------------------------------------------------------------------
// 3) Asıl regresyon: tekrarlı kopmalarda kaçak döngü OLUŞMAMALI
// ---------------------------------------------------------------------------
{
  const { ctx, durum, ilerlet, arkaPlanDonguleri } = Ortam();
  const c = new ctx.CK.Canli();
  c.baglan();

  // 25 kez bağlantı kopması yaşanıyor (sinyal zayıf, çok kopma).
  for (let i = 0; i < 25; i++) {
    const arayuz = durum.arayuzler[durum.arayuzler.length - 1];
    arayuz.tetikle('error');
    ilerlet(4000);   // 3 sn sonra yeniden bağlanmayı dener
  }
  const dongu = arkaPlanDonguleri();
  ok(dongu.length === 1,
    `25 kopmadan sonra yalnızca 1 yedek döngü var (kaçak yok)`,
    `bulunan: ${dongu.length}`);
  ok(dongu[0].ms === 15000, 'yedek döngü 15 saniyelik');

//  Kaçak döngü olsaydı 25 kopma = 25 döngü = dakikada ~100 istek, sekme başına.
  //  10 sekme açıkken sunucu 600/dk sınırına takılırdı.
  const birDakika = () => ilerlet(60000);
  const onceki = durum.fetchSayisi;
  birDakika();
  const istekler = durum.fetchSayisi - onceki;
  ok(istekler === 4,
    'bir dakikada tam 4 REST isteği atılıyor (60 sn / 15 sn)',
    `ölçülen: ${istekler}`);
}

// ---------------------------------------------------------------------------
// 4) SSE geri gelince yedek döngü DURMALI (gereksiz yük biter)
// ---------------------------------------------------------------------------
{
  const { ctx, durum, ilerlet, arkaPlanDonguleri } = Ortam();
  const c = new ctx.CK.Canli();
  c.baglan();
  durum.arayuzler[0].tetikle('error');
  ilerlet(4000);
  ok(arkaPlanDonguleri().length === 1, 'kopma sonrası yedek döngü devreye giriyor');

  durum.arayuzler[durum.arayuzler.length - 1].tetikle('open');
  ok(arkaPlanDonguleri().length === 0, 'SSE geri bağlanınca yedek döngü hemen duruyor');

  const onceki = durum.fetchSayisi;
  ilerlet(60000);
  ok(durum.fetchSayisi === onceki, 'SSE geri bağlandıktan sonra REST isteği atılmıyor');
}

// ---------------------------------------------------------------------------
// 5) kapat() zamanlayıcı bırakmamalı
// ---------------------------------------------------------------------------
{
  const { ctx, durum, ilerlet, arkaPlanDonguleri } = Ortam();
  const c = new ctx.CK.Canli();
  c.baglan();
  durum.arayuzler[0].tetikle('error');
  ilerlet(4000);
  ok(arkaPlanDonguleri().length === 1, 'kapatmadan önce yedek döngü var');

  c.kapat();
  ok(arkaPlanDonguleri().length === 0, 'kapat() arka plan döngüsünü temizliyor');
  ok(c.es === null && c.yoklama === null, 'kapat() bağlantı ve bekleme durumunu sıfırlıyor');

  const onceki = durum.fetchSayisi;
  ilerlet(120000);
  ok(durum.fetchSayisi === onceki, 'kapatıldıktan sonra hiç istek atılmıyor (sabit ekran yükü yok)');
}

// ---------------------------------------------------------------------------
// 6) Dinleyici hatası akışı bozmasın
// ---------------------------------------------------------------------------
{
  const { ctx, durum } = Ortam();
  const c = new ctx.CK.Canli();
  const gorulen = [];
  c.izle(() => { throw new Error('dinleyici patladı'); });
  c.izle(() => gorulen.push('ikinci'));
  c.baglan();
  durum.arayuzler[0].tetikle('durum', { kayitSayisi: 1 });
  ok(gorulen.includes('ikinci'), 'bir dinleyici patlasa da diğerleri çalışıyor');
}

// ---------------------------------------------------------------------------
// 7) Sunucu hız sınırı bu yükün rahat altında kalmalı
// ---------------------------------------------------------------------------
{
  const comp = fs.readFileSync(path.join(KOK, 'companion', 'companion.js'), 'utf8');
  const m = comp.match(/if \(n > (\d+)\)/);
  const sinir = m ? parseInt(m[1], 10) : 0;
  // En kötü durum: 10 panel sekmesi, hepsi SSE'siz (yedek yol).
  // Sekme başına 4 istek/dk => 40/dk. Sınır bunun üstünde olmalı.
  const enKotu = 10 * 4;
  ok(sinir >= enKotu * 3,
    `hız sınırı (${sinir}/dk) yedek yol yükünün (${enKotu}/dk) üstünde — telefonun yazma istekleri de geçer`,
    `sinir ${sinir} < ${enKotu * 3}`);
  ok(/retry: \d+/.test(comp), 'SSE bağlantısı hız sınırından muaf (retry başlığı)');
}

console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
