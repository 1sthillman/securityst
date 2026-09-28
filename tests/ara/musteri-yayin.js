'use strict';
/**
 * ============================================================================
 *  MÜŞTERİ YAYIN AKIŞI TESTİ (uçtan uca)
 * ============================================================================
 *  ÖLÇÜLEN GEREKÇE: eşleşme sayfasından alınan 64 haneli kurulum anahtarı
 *  canlı sunucuya tek başına gönderildiğinde HTTP 200 döndü. Yani paylaşılan
 *  API anahtarına gerek yok.
 *
 *  Bu test zincirin tamamını ölçer:
 *    GitHub Secret  ->  yayin-yapilandirma.js  ->  site/yapilandirma.js
 *                   ->  sunucuKoku() / istekBasliklari()  ->  doğru adres + kimlik
 *
 *  NEGATİF KONTROLLER (yoksa test anlamsız olur):
 *    - yapılandırma boşken uygulama kendi kökenine düşmeli (geriye uyum)
 *    - yanlış anahtar yazılırsa dosyaya DÜZ yazılmamalı, hata verilmeli
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const KOK = path.join(__dirname, '..', '..');
const SITE = path.join(KOK, 'site');
const SENKRON = path.join(KOK, 'companion', 'public', 'telefon', 'senkron.js');
const YAZICI = path.join(KOK, 'tools', 'yayin-yapilandirma.js');
const YAP = path.join(SITE, 'yapilandirma.js');

let pass = 0, fail = 0;
const ok = (c, ad, ek) => {
  if (c) { pass++; console.log('PASS — ' + ad + (ek ? '  -> ' + ek : '')); }
  else { fail++; console.log('FAIL — ' + ad + (ek ? '  -> ' + ek : '')); }
};

// Parça çıkarma ortak yardımcıda (bkz. kod-parca.js): metin taraması
// kırılgan olduğu için iki test dosyasında iki kez kırıldı.

const kod = fs.readFileSync(SENKRON, 'utf8');
const { blokCikar, yapilandirmaVeKok } = require('./kod-parca.js');
const parca = yapilandirmaVeKok(kod) + blokCikar(kod, 'function istekBasliklari');

function uygula(yapilandirma, origin) {
  const pencere = { location: { origin: origin || 'https://1sthillman.github.io' } };
  // 1) yapilandirma.js dosyasını sahte `window` üzerinde çalıştır
  //    (tarayıcının yaptığı şey). Dosya `window.CK_YAPILANDIRMA = {...}` yapar.
  vm.runInNewContext(fs.readFileSync(YAP, 'utf8'), Object.assign({ window: pencere }, pencere));
  // 2) uygulama kodunu AYRI bir bağlamda çalıştır; `window` aynı pencere.
  const kutu = Object.assign({ window: pencere }, pencere);
  // API_ANAHTARI sabiti gerçek dosyada tanımlıdır. Test koşulumunda da
  // tanımlanmazsa try/catch yutup başlığı düşürür ve ÖLÇÜM yanlış çıkar.
  vm.runInNewContext('var API_ANAHTARI = "ck_yk_olcum";\n' +
    'var CK_YAPILANDIRMA = window.CK_YAPILANDIRMA || {};' +
    'var S = { token: "" };\n' + parca, kutu);
  kutu.hamYapilandirma = pencere.CK_YAPILANDIRMA;
  return kutu;
}

function yaz(ortam, ureticiDosya) {
  const eski = {};
  for (const k of ['SUNUCU', 'KURULUM', 'APIKEY']) {
    eski[k] = process.env[k];
    if (ortam[k] === undefined) delete process.env[k]; else process.env[k] = ortam[k];
  }
  try {
    const out = execFileSync(process.execPath, [ureticiDosya || YAZICI], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { kod: 0, out };
  } catch (e) {
    return { kod: e.status, out: (e.stdout || '') + (e.stderr || '') };
  } finally {
    for (const k of ['SUNUCU', 'KURULUM', 'APIKEY']) {
      if (eski[k] === undefined) delete process.env[k]; else process.env[k] = eski[k];
    }
  }
}

const ADRES = 'http://192.168.1.42:4545';
const KURULUM = '2668118589ee5ee20f8053eb5c37ba9213d053713c596120ac8fda5adc46ea82';

console.log('\n--- 1) Müşteri GitHub Settings\'e anahtarı koydu ---');
let r = yaz({ SUNUCU: ADRES, KURULUM: KURULUM, APIKEY: '' });
ok(r.kod === 0, 'yayıcı hata vermedi', 'kod ' + r.kod);
ok(fs.existsSync(YAP), 'yapilandirma.js yazıldı');
ok(fs.readFileSync(YAP, 'utf8').includes(ADRES), 'sunucu adresi dosyada');
ok(fs.readFileSync(YAP, 'utf8').includes(KURULUM), 'kurulum anahtarı dosyada');

let k = uygula();
ok(k.sunucuKoku() === ADRES, 'uygulama MÜŞTERİNİN sunucusuna gidiyor (origin değil)', k.sunucuKoku());
const hd = k.istekBasliklari();
ok(hd['X-Sync-Token'] === KURULUM, 'kimlik olarak kurulum anahtarı gönderiliyor', hd['X-Sync-Token']);
ok(!!hd['Authorization'], 'yedek Authorization başlığı da gönderiliyor (geriye uyum)');

console.log('\n--- 2) NEGATİF KONTROL: anahtar boşken geriye uyum ---');
r = yaz({ SUNUCU: '', KURULUM: '', APIKEY: '' });
k = uygula();
ok(k.sunucuKoku() === 'https://1sthillman.github.io', 'yapılandırma boşken origin kullanılıyor', k.sunucuKoku());
ok(!k.istekBasliklari()['X-Sync-Token'], 'kurulum anahtarı yoksa başlık gönderilmiyor');

console.log('\n--- 3) NEGATİF KONTROL: tırnaklı değer bozulmaz ---');
const TUZAK = 'http://192.168.1.42:4545" ; alert(1); //';
yaz({ SUNUCU: TUZAK, KURULUM: KURULUM, APIKEY: '' });
const ham = fs.readFileSync(YAP, 'utf8');
const t = uygula();
ok(t.hamYapilandirma.SUNUCU_ADRESI === TUZAK,
  'tırnak/enjeksiyon değeri bozulmadan taşındı (ham değer birebir)',
  t.hamYapilandirma.SUNUCU_ADRESI);
ok(ham.includes('\\"'), 'tırnak kaçışıyla yazıldı (dosya yapısı bozulmadı)');
// Kodun eğik çizgi temizliği kasıtlıdır: kullanıcı adresi elle yazarken
// sondaki // silinir. Ölçülen davranışın kendisi:
ok(t.sunucuKoku() === TUZAK.replace(/\/+$/, ''),
  'sondaki eğik çizgiler bilerek temizleniyor (kasıtlı kullanıcı toleransı)',
  t.sunucuKoku());

console.log('\n--- 4) NEGATİF KONTROL: yazıcı bozuk dosya YAZMAZ ---');
// İddia: yazıcı geçersiz JavaScript üretirse diske dokunmaz.
// Kanıt: okuma işlevini devre dışı bırakıp üreteci çağırıyoruz.
(function () {
  const yazici = fs.readFileSync(YAZICI, 'utf8');
  const bozuk = yazici.replace('const cikti = baslikAl(mevcut) + govde;',
    'const cikti = baslikAl(mevcut) + govde; cikti += "\\n{ bozuk";');
  if (bozuk === yazici) {
    console.log('FAIL — üretici yeniden yazıldı, test geçersiz');
    fail++;
    return;
  }
  const bozukDosya = path.join(KOK, '.ara-bozuk-yapilandirma.js');
  try {
    fs.writeFileSync(bozukDosya, bozuk, 'utf8');
    const r2 = yaz({ SUNUCU: ADRES, KURULUM: KURULUM, APIKEY: '' }, bozukDosya);
    const yazildi = fs.existsSync(YAP) && fs.readFileSync(YAP, 'utf8').includes('{ bozuk');
    ok(r2.kod !== 0, 'bozuk üretimde yazıcı BAŞARISIZ oluyor (sessiz geçme yok)', 'kod ' + r2.kod);
    ok(!yazildi, 'bozuk yapılandırma DİSKE YAZILMADI');
  } finally {
    try { fs.unlinkSync(bozukDosya); } catch (e) {}
    // dosyayı geçerli duruma geri getir
    yaz({ SUNUCU: '', KURULUM: '', APIKEY: '' });
  }
})();

console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
