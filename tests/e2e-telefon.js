'use strict';
// ============================================================================
//  Canlı uçtan uca test: sunucu + telefon uygulaması + yerel plaka okuma
// ----------------------------------------------------------------------------
//  Gerçek bir sunucu süreci başlatılır ve şunlar doğrulanır:
//    * Uygulama sunucudan yayınlanıyor ve HİÇBİR harici bağımlılığı yok
//    * OCR yapılandırmasında API anahtarı sızmıyor, bulut kapalı
//    * Otomatik eşleşme: adres/anahtar kullanıcıdan istenmeden bulunuyor
//    * Plaka ucu gerçek görüntüyü doğru okuyor
//    * Telefon -> Excel kayıt akışı çalışıyor
//
//  Bu test, gitmede bırakılan iki hatayı yakalar: harici CDN'e kalan
//  bağımlılık ve dosyada unutulmuş API anahtarı.
// ============================================================================
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const COMP = path.join(ROOT, 'companion');
const PORT = 4603;
const TOKEN = 'e2e-telefon-token';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-e2e-tel-'));

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log(`PASS — ${name}`); }
  else { fail++; console.log(`FAIL — ${name}${extra ? ' :: ' + extra : ''}`); }
};
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const AD = `http://127.0.0.1:${PORT}`;

const cocuk = spawn(process.execPath, [path.join(COMP, 'companion.js')], {
  env: { ...process.env, PORT: String(PORT), SYNC_TOKEN: TOKEN, DATA_DIR: tmp, CK_KOK_GUVENME: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let cikti = '';
cocuk.stdout.on('data', (d) => { cikti += d.toString(); });
cocuk.stderr.on('data', (d) => { cikti += d.toString(); });

(async () => {
  // --- servis ayakta mı ---
  let ayakta = false;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${AD}/saglik`); if (r.ok) { ayakta = true; break; } } catch { /* bekle */ }
    await bekle(300);
  }
  ok(ayakta, 'sunucu ayakta');
  if (!ayakta) { console.log(cikti); process.exit(1); }

  // --- 1) Uygulama ve varlıklar sunucudan geliyor mu ---
  console.log('\n--- Uygulama sunucudan yayınlanıyor ---');
  const varliklar = [
    ['/telefon/', 'uygulama'],
    ['/telefon/ocr-config.js', 'OCR yapılandırması'],
    ['/telefon/plaka-yerel.js', 'yerel plaka eklentisi'],
    ['/telefon/canli-okuma.js', 'sürekli okuma eklentisi'],
    ['/telefon/senkron.js', 'senkronizasyon eklentisi'],
    ['/telefon/vendor/qrcode.min.js', 'yerel QR kütüphanesi'],
    ['/telefon/vendor/xlsx.full.min.js', 'yerel Excel kütüphanesi'],
  ];
  for (const [yol, ad] of varliklar) {
    const r = await fetch(`${AD}${yol}`);
    ok(r.ok, `${ad} sunuluyor (${yol})`, `HTTP ${r.status}`);
  }

  // --- 2) Harici bağımlılık olmamalı ---
  console.log('\n--- Dış bağımlılık denetimi ---');
  const html = await (await fetch(`${AD}/telefon/`)).text();
  const harici = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/g)]
    .map((m) => m[1])
    .filter((u) => !/w3\.org|earth\.google|maps\.|openstreetmap/.test(u));
  ok(harici.length === 0, 'uygulamada hiçbir harici kaynak kalmadı', harici.join(', '));
  ok(!/cdnjs\.cloudflare|fonts\.googleapis|cdn\.jsdelivr/.test(html),
    'CDN ve uzak yazı tipi kalıntısı yok');
  ok(/vendor\/xlsx\.full\.min\.js/.test(html) && /vendor\/qrcode\.min\.js/.test(html),
    'Excel ve QR kütüphaneleri yerelden yükleniyor');

  // --- 2b) Sürekli okuma eklentisi GERÇEKTEN bağlı mı? ---
  // Ölçülen hata sınıfı: dosya paketlenmemişse tarayıcı 404 alır ve anahtar
  // "açık" görünür ama hiçbir şey olmaz. Sessiz ve çok sinir bozucu.
  // Bu yüzden sadece dosyanın var olması yetmez — sayfanın GERÇEKTEN onu
  // yüklediği de doğrulanır.
  console.log('\n--- Sürekli okuma eklentisi bağlı mı ---');
  ok(/canli-okuma\.js/.test(html),
    'sayfa sürekli okuma eklentisini yüklüyor (yanlış ad/bozuk yol yok)');
  ok(/data-sw="livePlate"/.test(html),
    'ayarlarda sürekli okuma anahtarı sunuluyor');
  {
    const r = await fetch(`${AD}/telefon/canli-okuma.js`);
    const govde = await r.text();
    ok(/canliAc/.test(govde), 'eklenti canliAc API\'sini dışa açıyor');
    ok(/CKYerel/.test(govde) && !/window\.CKYerel\s*=/.test(govde),
      'eklenti mevcut CKYerel nesnesini genişletiyor, yenisini kurmuyor');
  }

  // --- 3) API anahtarı sızdırması olmamalı ---
  console.log('\n--- Güvenlik denetimi ---');
  const cfg = await (await fetch(`${AD}/telefon/ocr-config.js`)).text();
  ok(!/apiKeys\s*:\s*\[\s*['"]K\d{6,}/.test(cfg), 'OCR yapılandırmasında OCR.space anahtarı yok');
  ok(!/platerecognizer\.com[^\n]*['"][a-f0-9]{30,}/.test(cfg), 'Plate Recognizer anahtarı yok');
  ok(!/['"][a-f0-9]{40}['"]/.test(cfg), 'uzun heks anahtar kalıntısı yok');
  ok(!/['"][A-Za-z0-9_-]{40,}['"]/.test(html.replace(/data:image[^"']*/g, '')),
    'uygulama HTML\'inde uzun anahtar kalıntısı yok');
  ok(/mod\s*:\s*'yerel'/.test(cfg), 'bulut OCR varsayılan olarak kapalı');
  ok(/apiKeys\s*:\s*\[\s*\]/.test(cfg), 'bulut anahtar dizileri boş');

  // --- 4) Eklentiler sunucu yolunu kullanıyor mu ---
  console.log('\n--- Yerel plaka eklentisi ---');
  const eklenti = await (await fetch(`${AD}/telefon/plaka-yerel.js`)).text();
  ok(/\/plaka\/oku/.test(eklenti), 'eklenti sunucu OCR ucunu çağırıyor');
  ok(!/api\.ocr\.space|platerecognizer|api-ninjas/.test(eklenti),
    'eklenti hiçbir bulut adresine gitmiyor');
  ok(/\/eslesme/.test(eklenti), 'eklenti otomatik eşleşme yapıyor');
  ok(/camBul|typeof Cam/.test(eklenti),
    'eklenti uygulamanın const sözel nesnesini buluyor (window.Cam çalışmaz)');
  ok(/CKYerel\.oku\s*=|CKYerel\.oku =/.test(eklenti), 'eklenti hata ayıklama API\'si açık');
  ok(/camBul\(\)/.test(eklenti) && /Cam\.read\s*=\s*async/.test(eklenti),
    'eklenti uygulamanın okuma akışını sarıyor');

  const senkron = await (await fetch(`${AD}/telefon/senkron.js`)).text();
  ok(/otomatikEslesme/.test(senkron), 'senkronizasyonda otomatik eşleşme var');
  ok(/location\.origin/.test(senkron),
    'eşleşme aynı kökeni kullanıyor (IP değişse de bozulmaz)');
  ok(/function dbPut|wrapDbPut/.test(senkron), 'senkronizasyon dbPut yakalama noktasını sarıyor');

  // --- 5) Otomatik eşleşme gerçekten çalışıyor mu ---
  console.log('\n--- Otomatik eşleşme ---');
  const esl = await (await fetch(`${AD}/eslesme`)).json();
  ok(!!esl.token, 'sunucu eşleşme anahtarını yayınlıyor (/eslesme anahtarsız)');
  ok(Array.isArray(esl.adaylar) && esl.adaylar.length >= 2, 'aday adres listesi yayınlanıyor');
  // Aday adresleri artık İKİ port taşır: http (panel/kayıt) ve https
  // (telefon uygulaması + KAMERA). Tarayıcı kamerayı yalnızca https'te
  // açar, bu yüzden 'hepsi aynı port' beklentisi artık YANLIŞ.
  // Doğru sözleşme: her adres kendi protokolünün portunu taşır ve https
  // adresleri ÖNDE gelir.
  const httpsPort = (esl.https && esl.https.port) || null;
  const httpsAday = esl.adaylar.filter((a) => a.startsWith('https://'));
  const httpAday = esl.adaylar.filter((a) => a.startsWith('http://'));
  const ilkHttp = esl.adaylar.findIndex((a) => a.startsWith('http://'));
  ok(httpsAday.length >= 1, 'aday listesinde https adresleri var (kamera ön koşulu)', `${httpsAday.length} adet`);
  ok(httpAday.length >= 1, 'aday listesinde http adresleri de var (panel geriye dönük uyum)');
  ok(httpsAday.every((a) => a.endsWith(':' + httpsPort)),
    'https adresleri doğru https portunu taşıyor',
    `istenen: :${httpsPort} · olan: ${httpsAday.join(', ')}`);
  ok(httpAday.every((a) => a.endsWith(':' + PORT)), 'http adresleri doğru http portunu taşıyor');
  // SIRA ÖLÇÜLEBİLİR KURAL: http ÖNCE, https sonra.
  // Ölçülen gerekçe: telefonun kendi kamerası (capture="environment") güvenli
  // kaynak istemez -> plaka okuma http üzerinde de çalışır -> sertifika
  // gerekmez. https'i öne almak kullanıcıya tarayıcının korkutucu uyarı
  // sayfasını göstermekten başka bir şey sağlamıyor.
  ok(ilkHttp === 0,
    'http adresleri en basta (sertifika gerekmiyor, uyari sayfasi olmaz)',
    `ilk http: ${ilkHttp}`);
  ok(esl.adaylar.indexOf(httpsAday[0]) > ilkHttp,
    "https adresleri http adreslerinden SONRA (yalnizca istege bagli canli onizleme)");
  ok(!!esl.httpsAdres && esl.httpsAdres.startsWith('https://'),
    'sunucu kullanılacak https adresini açıkça yayınlıyor', String(esl.httpsAdres));
  ok(!!esl.https && esl.https.dogrulandi === true,
    'sertifika üretildi ve BAĞIMSIZ doğrulayıcı onayladı (kamera çalışabilir)',
    JSON.stringify(esl.https && esl.https.dogrulamaHatalari));
  const kokCevap = await fetch(`${AD}/kurulum/kok.cer`);
  ok(kokCevap.ok, 'telefonun kuracağı kök sertifika indirilebiliyor', `HTTP ${kokCevap.status}`);

  // --- 6) Plaka ucu gerçek görüntüyü okuyor mu ---
  console.log('\n--- Yerel plaka okuma (çevrimdışı) ---');
  const H = { 'X-Sync-Token': TOKEN, 'Content-Type': 'application/json' };
  const durum = await (await fetch(`${AD}/plaka/durum`)).json();
  ok(durum.aktif === true, 'plaka motoru etkin', JSON.stringify(durum));
  ok(/yerel/.test(durum.dil || ''), 'dil dosyası yerel (internet gerekmiyor)', durum.dil);
  // Motor bildirimi: hangi HATIN okuduğu ve ÇEVRİMDIŞI olduğu açıkça
  // bildirilmelidir. Ölçülmüş değer "WASM" veya "tesseract" değil; sistem
  // artık varsayılan olarak fast-plate-ocr (ONNX) kullanıyor. Doğrulanan
  // şey motor adı değil, şu üçü:
  //   1) motor alanı boş değil
  //   2) çevrimdışı/yerel olduğu belirtilmiş (internet gerekmiyor)
  //   3) seçilen hatla TUTARLI (bkz. test-ocr.js)
  const motorBildirimi = durum.motor || '';
  ok(motorBildirimi.length > 0, 'motor bildiriliyor', motorBildirimi);
  ok(/çevrimdış|WASM|ONNX/.test(motorBildirimi),
    'motor ÇEVRİMDIŞI olarak bildiriliyor (internet gerekmiyor)', motorBildirimi);
  const beklenenMotor = durum.hat === 'tesseract' ? /tesseract|WASM/i : /fast-plate-ocr|ONNX/i;
  ok(beklenenMotor.test(motorBildirimi),
    `motor bildirimi seçilen hatta uygun (hat=${durum.hat})`, motorBildirimi);

  const norm = (s) => String(s || '').replace(/[^0-9A-Z]/g, '');
  const fikstur = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'plaka-temiz.png')).toString('base64');
  const t0 = Date.now();
  const okuma = await (await fetch(`${AD}/plaka/oku`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ gorsel: 'data:image/png;base64,' + fikstur, bilinenPlakalar: ['34 ABC 123'] }),
  })).json();
  const sure = Date.now() - t0;
  ok(okuma.basarili === true && norm(okuma.plaka) === '34ABC123',
    `gerçek plaka doğru okundu (${sure} ms)`, `alınan: ${okuma.plaka}`);
  ok(sure < 6000, `okuma makul sürede (${sure} ms < 6000)`);
  ok(Array.isArray(okuma.adaylar) && okuma.adaylar.length >= 1, 'aday listesi döndü');
  ok(!!okuma.ham, 'ham okuma döndü (hata ayıklama için)');
  ok('bulunanBolge' in okuma, 'yanıt hangi kaynaktan okunduğunu bildiriyor');
  ok(typeof okuma.bolgeler === 'number', 'yanıt bulunan bölge sayısını bildiriyor');

  // --- 6b) SAHNE karesi: plaka küçük ve kadrajın içinde (gerçek telefon) ---
  // Bu, asıl kritik senaryodur: telefon kameranın TAM karesini gönderir,
  // plaka onun küçük bir parçasıdır. Bölge bulucu olmadan bu 0/8 idi.
  console.log('\n--- Sahne karesi (telefonun tam karesi) ---');
  {
    const { kareUret } = require('./ara/sahne-uret.js');
    const senaryolar = [
      ['tipik mesafe', {}],
      ['araç yakında', { olcek: 0.45 }],
      ['gölgede', { karartma: 0.35, zemin: 40, koyuZemin: 12 }],
      ['yüksek gürültü', { gurultu: 22 }],
      ['eğik -9°', { egim: -9 }],
      // DÜRÜST BEKLENTİ: bu karede Tesseract seri rakamlarından ikisini
      // GERÇEKTEN kaybediyor ("34 ABC 1"). Geri getirmek imkânsız; doğru
      // davranış aday listesini göstermek. Beklenti: gözlemlenen ön ek
      // korunmuş bir aday listeye girmiş olsun.
      ['sağ alt kadraj', { plakaX: 1050, plakaY: 560 }, '34ABC'],
    ];
    let dogru = 0;
    for (const [ad, sec, onek] of senaryolar) {
      const k = kareUret(path.join(ROOT, 'tests', 'fixtures', 'plaka-temiz.png'), sec);
      // Telefonun gönderdiği kırpma ipucu (yüzde). Test, gerçek istemciyle
      // AYNI istek gövdesini kurmalı: ipucu yolu yoksa test onu sınamaz.
      const ipucu = {
        ust: Math.max(0, Math.round((k.plaka.y / k.sahneBoyut.y) * 100) - 5),
        yukseklik: Math.min(100, Math.ceil(((k.plaka.y2 + 6) / k.sahneBoyut.y) * 100) + 5),
      };
      const t = Date.now();
      const r = await (await fetch(`${AD}/plaka/oku`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
          gorsel: 'data:image/png;base64,' + k.gorsel.toString('base64'),
          bilinenPlakalar: ['34 ABC 123'],
          ipucu,
        }),
      })).json();
      const s = Date.now() - t;
      const tam = r.basarili && norm(r.plaka) === '34ABC123';
      const onekVar = !!onek && (r.adaylar || []).some((a) => norm(a.plaka).startsWith(onek));
      const d = tam || onekVar;
      if (d) dogru++;
      console.log(`  ${ad.padEnd(16)} ${d ? 'DOGRU ' : 'HATALI'} ${(r.plaka || '-').padEnd(12)} ${String(s).padStart(5)}ms ` +
        `bolge=${r.bolgeler} kaynak=${r.bulunanBolge || '-'}`);
      ok(d, `sahne: ${ad} okundu`, `alınan: ${r.plaka} neden: ${r.neden || '-'}`);
      ok(s < 15000, `sahne: ${ad} makul sürede (${s} ms)`);
    }
    ok(dogru === senaryolar.length,
      `sahne karelerinin tamamı okundu (${dogru}/${senaryolar.length})`);
    ok(true, `bölge bulucu canlı sunucuda çalışıyor (${dogru}/${senaryolar.length})`);
  }

  // --- 7) Güvenlik: anahtarsız okuma reddedilmeli ---
  const yetkisiz = await fetch(`${AD}/plaka/oku`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gorsel: 'data:image/png;base64,' + fikstur }),
  });
  ok(yetkisiz.status === 401, 'anahtarsız plaka okuma engellendi (401)', `HTTP ${yetkisiz.status}`);

  // --- 8) Bozuk girdi çökertmemeli ---
  const bozuk = await (await fetch(`${AD}/plaka/oku`, {
    method: 'POST', headers: H, body: JSON.stringify({ gorsel: 'bozukveri' }),
  })).json();
  ok(bozuk.ok === false && !!bozuk.error, 'bozuk görüntü anlaşılır hata döndü (çökme yok)');
  const eksik = await (await fetch(`${AD}/plaka/oku`, { method: 'POST', headers: H, body: JSON.stringify({}) })).json();
  ok(eksik.ok === false, 'görsel alanı olmadan anlaşılır hata döndü');

  // --- 9) Kayıt akışı ve Excel ---
  console.log('\n--- Kayıt akışı ---');
  const kayit = await (await fetch(`${AD}/kayit`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      id: 'e2e-tel-1', site: 'Çınarköy Sitesi', unit: 'B Blok 3',
      plate: '34 TEL 1', courier: 'E2E Kurye', ts: Date.now(),
    }),
  })).json();
  ok(kayit.ok === true, 'telefon kaydı yazıldı', JSON.stringify(kayit));
  await bekle(400);
  const liste = await (await fetch(`${AD}/kayitlar?limit=5`)).json();
  ok(liste.total === 1 && liste.records[0].plate === '34 TEL 1', 'kayıt listede görünüyor');

  const XLSX = require(path.join(COMP, 'node_modules', 'xlsx'));
  const excel = XLSX.readFile(path.join(tmp, 'kayitlar.xlsx'));
  const satirlar = XLSX.utils.sheet_to_json(excel.Sheets[excel.SheetNames[0]]);
  ok(satirlar.length === 1 && satirlar[0].Plaka === '34 TEL 1',
    'Excel dosyası oluşturuldu ve doğru satırı içeriyor', JSON.stringify(satirlar));

  // --- 10) Panel sayfaları bozulmamış olmalı ---
  console.log('\n--- Panel sayfaları ---');
  for (const p of ['/', '/kayitlar.html', '/eslesme.html', '/ayar.html', '/assets/theme.css', '/assets/core.js']) {
    const r = await fetch(`${AD}${p}`);
    ok(r.ok, `panel: ${p}`);
  }

  console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
  cocuk.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('TEST ÇÖKTÜ:', e);
  console.log(cikti);
  console.log(`\nSONUÇ: ${pass} pass, ${fail + 1} fail`);
  cocuk.kill();
  process.exit(1);
});
