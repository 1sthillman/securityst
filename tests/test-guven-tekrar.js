'use strict';
/**
 * ============================================================================
 *  SERTİFİKA KURULUMUNUN İZ BIRAKMADIĞI DENETİMİ
 * ============================================================================
 *
 *  ÖLÇÜLEN HATA (kullanıcı bildirimi, bir kez daha):
 *  "SÜREKLİ BU GELİYOR, EVETE BASIYORUZ YİNE GELİYOR."
 *
 *  Ölçülen iki ayrı sebep vardı:
 *   1) `certutil -addstore` her açılışta çalışıyordu. Bu komut, sertifika
 *      depoda ZATEN olsa bile her seferinde "yüklemek istiyor musunuz?"
 *      PENCERESİ açar. Servis her açılışta kullanıcıyı böylece uyarıyordu.
 *   2) Daha kötüsü: tek bir test koşusunda 6 kök CA birikti. 5'i ölüydü
 *      (veri klasörleri silinmişti) ama kullanıcının güvenli listesinde
 *      "güvenilir" olarak duruyordu. Testler kalıcı olarak SİSTEM DEĞİŞTİRİYORDU.
 *
 *  ÇÖZÜM (ölçümle gerekçelendirildi):
 *  Windows'un kök deposuna OTOMATİK kurulum YAPILMAZ.
 *   - Pencerenin kendisi, "kullanıcı hiçbir şey yapmasın" kuralını ihlaldir.
 *   - Pencere bir insan tıklaması bekler; bu da sistemi kırılgan kılar.
 *   - Bir kök sertifikayı güvenli listeye eklemek ağır bir güvenlik işlemidir;
 *     kullanıcı istemeden yapılmamalıdır.
 *  Bilgisayarda panel http ile çalışmaya devam eder. Kamera yalnızca
 *  TELEFONDA açılır ve telefonun güven adımı paneldeki düğmeyle, bilinçli
 *  olarak yapılır.
 *
 *  Bu dosya, bu kararı ÖLÇER: varsayılanda Windows deposuna hiç dokunulmaz.
 * ============================================================================
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { X509Certificate, createHash } = require('crypto');

// ÖLÇÜLEN HATA: /durum ve /eslesme artık API anahtarı istiyor (401).
// Bu test çıplak curl kullandığı için "servis ayakta" kontrolü 401
// yanıtını "servis kapalı" sanıyordu. Anahtarı kanalın TEK kaynağından
// (shared/anahtar.js) okuyoruz; burada sabit yazmak ikinci kopyadır ve
// test-anahtar.js iki kopyanın ayrıldığını zaten denetliyor.
const { ANAHTAR } = require('../shared/anahtar.js');
const YETKI = '-H "Authorization: Bearer ' + ANAHTAR + '"';

const VERI = path.join(os.tmpdir(), 'ck-iz-test');
fs.rmSync(VERI, { recursive: true, force: true });
fs.mkdirSync(VERI, { recursive: true });

const PORT = 47511;
const HTTPS = 47512;
const COMPANION = path.join(__dirname, '..', 'companion', 'companion.js');

let pass = 0, fail = 0;
const ok = (k, a, e = '') => { if (k) { pass++; console.log(`PASS — ${a}`); } else { fail++; console.log(`FAIL — ${a}${e ? ' :: ' + e : ''}`); } };
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const c = execFileSync;

const curl = (yol) => new Promise((co) => {
  // Yetki başlığı ZORUNLU: /durum ve /eslesme anahtarsız istekte 401 döner.
  // (Sunucu değişmedi; test eskiydi.)
  require('child_process').exec(`curl -s ${YETKI} http://127.0.0.1:${PORT}${yol}`,
    { maxBuffer: 4e6 }, (e, so) => co(so));
});
const durumCek = async () => { try { return JSON.parse(await curl('/durum')); } catch { return null; } };

// NOT: bu yardımcı anahtarsız çağrı YAPMAZ. Çağırdığı her uç anahtar ister.
// Anahtarsız 401 alınırsa "servis kapalı" sanılmamalı, kimlik eksikliği
// denmelidir — yoksa hata "kapalı servis" gibi görünür ve gerçek sebep
// (401) gizlenir. Bu, bu dosyada yaşanan hataydır.

/** Depodaki tüm CinarkoySync kök parmak izleri. */
function depoKokleri() {
  try {
    const d = c('certutil', ['-user', '-store', 'Root'], { encoding: 'latin1', maxBuffer: 8e6 });
    const izler = [];
    const bloklar = d.split(/Certificate \d+/);
    for (const b of bloklar) {
      if (!/CinarkoySync Yerel Kok CA/.test(b)) continue;
      const m = /Cert Hash\(sha1\):\s*([0-9a-fA-F]+)/.exec(b);
      if (m) izler.push(m[1].toUpperCase());
    }
    return izler;
  } catch (e) { return []; }
}

function baslat(gunluk) {
  const p = spawn(process.execPath, [COMPANION], {
    // CK_KOK_GUVENME HİÇ verilmiyor -> varsayılan (kapalı) ölçülüyor.
    env: { ...process.env, PORT: String(PORT), HTTPS_PORT: String(HTTPS), DATA_DIR: VERI, SYNC_TOKEN: 'iz-test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', (d) => gunluk.push(d.toString()));
  p.stderr.on('data', (d) => gunluk.push(d.toString()));
  return p;
}

(async () => {
  const onceki = depoKokleri();
  console.log(`  (başlangıçta depoda ${onceki.length} CinarkoySync kökü var)`);

  // --- 1. AÇILIŞ ---------------------------------------------------------
  const g1 = [];
  const p1 = baslat(g1);
  let ayakta = false;
  for (let i = 0; i < 60; i++) {
    const d = await durumCek();
    if (d && d.ok) { ayakta = true; break; }
    await bekle(500);
  }
  ok(ayakta, 'servis ayakta (1. açılış)');
  await bekle(6000);

  // --- 2. YENIDEN AÇILIŞ --------------------------------------------------
  p1.kill();
  await bekle(2000);
  const g2 = [];
  const p2 = baslat(g2);
  for (let i = 0; i < 60; i++) { const d = await durumCek(); if (d && d.ok) break; await bekle(500); }
  await bekle(6000);
  const d2 = await durumCek();
  // ÖLÇÜLEN HATA (bu testin kendi hatası): p2 burada öldürülüyordu, ama
  // denetimler sunucu KALIRKEN yapılmalı. https probesi ölü sunucuya
  // gidiyor ve hata "kod bozuk" sanılıyordu.

  // --- 3. KÖK KARARLI MI? (IP değişse de telefonu etkilememeli) ---------
  const kok1 = JSON.parse(fs.readFileSync(path.join(VERI, 'kok-ca.pem'), 'utf8') ? '{}' : '{}') && null;
  const x = new X509Certificate(fs.readFileSync(path.join(VERI, 'kok-ca.pem')));
  const kokParmak = createHash('sha1').update(x.raw).digest('hex').toUpperCase();
  ok(!!kokParmak, 'kök sertifika üretildi', kokParmak);
  ok(!!(d2 && d2.https && d2.https.kokParmakIzi), 'durum kök parmak izini bildiriyor');

  // --- 4. ASIL DENETİM: depo HİÇ DEĞİŞMEDİ -----------------------------
  const sonraki = depoKokleri();
  const yeniKokler = sonraki.filter((i) => onceki.indexOf(i) === -1);
  ok(yeniKokler.length === 0,
    'iki açılış sonrası Windows deposuna HİÇ YENİ KÖK EKLENMEDİ (kullanıcı uyarı görmez)',
    `eklenen: ${yeniKokler.join(', ') || '-'}`);

  // --- 5. GÜVENLİK İZ YOK -----------------------------------------------
  const gunluk = g1.join('') + g2.join('');
  ok(!/accepted|addstore|kabul edildi/i.test(gunluk),
    'günlükte kurulum yapıldığına dair kayıt YOK');
  ok(!/certificate|kok CA Windows/i.test(gunluk.replace(/kullanıcı güven|guven i\u011flemiyor/gi, '')),
    'günlükte sertifika kurulumu geçmişi YOK');

  // --- 6. SİSTEM YİNE DE ÇALIŞIYOR MU? (güven kaybı = iş kaybı değil) ---
  const httpsSaglik = await new Promise((co) => {
    require('child_process').exec(`curl -sk https://127.0.0.1:${HTTPS}/saglik`, (e, so) => co(so));
  });
  ok(/\"ok\":true/.test(httpsSaglik),
    'https YİNE de çalışıyor (güven kurulmasa da telefon bağlanabilir)', httpsSaglik.slice(0, 60));
  ok(!!(d2 && d2.https && d2.https.aktif && d2.https.dogrulandi),
    'sertifika üretildi ve doğrulandı (telefon için hazır)');
  const esl = JSON.parse(await curl('/eslesme') || '{}');
  ok(!!(esl.httpsAdres && esl.httpsAdres.startsWith('https://')),
    'kullanılacak https adresi yayınlanıyor (/eslesme)', String(esl.httpsAdres));
  ok(!!(esl.qrSvg && esl.qrSvg.indexOf('<svg') === 0),
    "eşleşme QR'ı üretildi (telefon kamerasıyla okutulabilir)");
  ok(!esl.qrHata, 'QR üretiminde hata yok', String(esl.qrHata));

  // --- 7. TEMİZLİK -------------------------------------------------------
  p2.kill();
  await bekle(1000);
  fs.rmSync(VERI, { recursive: true, force: true });
  const son = depoKokleri();
  ok(son.length === onceki.length, 'test hiçbir iz bırakmadı (depo aynı kaldı)',
    `${onceki.length} -> ${son.length}`);

  console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST ÇÖKTÜ:', e.stack || e); process.exit(1); });
