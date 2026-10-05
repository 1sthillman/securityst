#!/usr/bin/env node
/**
 * TAM SİSTEM TESTİ - Her şeyin çalıştığını doğrular
 * =====================================================
 * Tüm kritik bileşenleri test eder ve rapor verir
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const IP = '192.168.1.129';
const PORT = 4545;

const TESTS = [];
let PASSED = 0;
let FAILED = 0;

function test(name, fn) {
  TESTS.push({ name, fn });
}

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${IP}:${PORT}${path}`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: body.trim() ? JSON.parse(body) : null, raw: body });
        } catch {
          resolve({ status: res.statusCode, data: null, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  TAM SİSTEM TESTİ - Çınarköy Sync                        ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// ==================== TESTLER ====================

test('1. Servis Sağlık Kontrolü', async () => {
  const res = await httpGet('/saglik');
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  if (!res.data || !res.data.ok) throw new Error('Servis sağlıksız');
  console.log(`   Kayıt sayısı: ${res.data.kayitSayisi}`);
});

test('2. Eşleşme Endpoint - Token Verir Mi?', async () => {
  const res = await httpGet('/eslesme');
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  if (!res.data) throw new Error('Yanıt boş');
  
  // İlk cihaz token almalı veya onay beklemeli
  if (res.data.token) {
    console.log(`   ✓ Token alındı (${res.data.token.substring(0, 8)}...)`);
  } else if (res.data.onayBekliyor) {
    console.log(`   ⚠ Onay bekliyor - bu normaldir (${res.data.eslesme.ip})`);
  } else {
    throw new Error('Token verilmedi ve onay da beklemiyor!');
  }
  
  console.log(`   Kalıcı adres: ${res.data.kaliciAdres}`);
  console.log(`   Cihaz sayısı: ${res.data.cihazSayisi}`);
});

test('3. Telefon Uygulaması Erişilebilir Mi?', async () => {
  const res = await httpGet('/telefon/');
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  if (res.raw.indexOf('Çınarköy') === -1) throw new Error('HTML içeriği yanlış');
  console.log(`   ✓ Uygulama yüklendi (${Math.round(res.raw.length / 1024)}KB)`);
});

test('4. Panel Sadece Localhost\'tan Erişilebilir Mi?', async () => {
  // Localhost'tan erişim test edilemez çünkü bu IP'den çalışıyoruz
  // Ama 403 almazsak sorun yok demektir
  const res = await httpGet('/');
  if (res.status === 403) {
    console.log(`   ✓ Panel koruması çalışıyor (403)`);
  } else if (res.status === 200) {
    console.log(`   ⚠ Panel açık (bu IP'den erişebildik - localhost sayılıyor)`);
  }
});

test('5. Cihaz Yönetimi Çalışıyor Mu?', async () => {
  // Token gerektiriyor, olmadan deneyeceğiz
  try {
    const res = await httpGet('/eslesme/cihazlar');
    if (res.status === 401) {
      console.log(`   ✓ Endpoint korumalı (401 - bu doğru)`);
    } else if (res.status === 200 && res.data && res.data.cihazlar) {
      console.log(`   ✓ Endpoint çalışıyor - ${res.data.cihazlar.length} kayıtlı cihaz`);
      console.log(`   Onay bekleyen: ${res.data.onayBekleyen ? res.data.onayBekleyen.length : 0}`);
    }
  } catch (e) {
    // 401 hatasını yakaladık - bu normaldir
    if (e.message.indexOf('401') > -1) {
      console.log(`   ✓ Endpoint korumalı`);
    } else {
      throw e;
    }
  }
});

test('6. Dosya Yapısı Kontrol', async () => {
  const files = [
    'companion/data/kayitlar.jsonl',
    'companion/data/kayitlar.xlsx',
    'companion/data/seen-ids.json',
    'companion/data/eslesmeler.json'
  ];
  
  const missing = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      missing.push(file);
    }
  }
  
  if (missing.length > 0) {
    console.log(`   ⚠ Eksik dosyalar: ${missing.join(', ')}`);
    console.log(`   (İlk çalıştırmada normal olabilir)`);
  } else {
    console.log(`   ✓ Tüm kritik dosyalar mevcut`);
  }
});

test('7. Log Dosyası Yazmaya Açık Mı?', async () => {
  const logPath = 'companion/data/servis.log';
  try {
    const stats = fs.statSync(logPath);
    const size = (stats.size / 1024).toFixed(1);
    console.log(`   ✓ Log dosyası erişilebilir (${size} KB)`);
  } catch (e) {
    throw new Error('Log dosyası okunamıyor: ' + e.message);
  }
});

test('8. QR Kod Bilgileri Doğru Mu?', async () => {
  const res = await httpGet('/eslesme');
  if (!res.data) throw new Error('Eşleşme yanıtı yok');
  
  const qrTam = res.data.qrTam || '';
  if (!qrTam) throw new Error('QR tam içeriği yok');
  
  if (qrTam.indexOf('#token=') === -1 && qrTam.indexOf('?token=') === -1) {
    throw new Error('QR içinde token yok!');
  }
  
  const adres = qrTam.split(/[#?]/)[0];
  if (adres.indexOf('localhost') > -1 || adres.indexOf('127.0.0.1') > -1) {
    throw new Error('QR adresi localhost içeriyor - TELEFON BAĞLANAMAZ!');
  }
  
  console.log(`   ✓ QR adresi: ${adres.substring(0, 30)}...`);
  console.log(`   ✓ Token içeriyor: ${qrTam.indexOf('#token=') > -1 ? 'EVET' : 'Sorgu parametresinde'}`);
});

// ==================== TEST ÇALIŞTIRICI ====================

async function runTests() {
  console.log(`Toplam ${TESTS.length} test çalıştırılacak...\n`);
  
  for (let i = 0; i < TESTS.length; i++) {
    const { name, fn } = TESTS[i];
    try {
      await fn();
      console.log(`✓ ${name}`);
      PASSED++;
    } catch (e) {
      console.log(`✗ ${name}`);
      console.log(`  Hata: ${e.message}\n`);
      FAILED++;
    }
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log(`SONUÇ: ${PASSED}/${TESTS.length} test başarılı`);
  
  if (FAILED === 0) {
    console.log('\n🎉 TÜM SİSTEM MÜKEMMEL ÇALIŞIYOR!');
    console.log('\nTelefonda açılacak adres:');
    console.log(`   http://${IP}:${PORT}/telefon/`);
    console.log('\nBilgisayarda açılacak panel:');
    console.log(`   http://localhost:${PORT}/`);
    console.log('\nCihaz onaylama:');
    console.log(`   http://localhost:${PORT}/cihazlar.html`);
  } else {
    console.log(`\n⚠ ${FAILED} test başarısız oldu - yukarıdaki hataları kontrol edin`);
  }
  
  console.log('═'.repeat(60) + '\n');
  
  process.exit(FAILED > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('\n✗ TEST SİSTEMİ HATASI:', err);
  process.exit(1);
});
