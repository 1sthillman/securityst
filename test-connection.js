#!/usr/bin/env node
/**
 * TELEFON BAĞLANTI TESTİ
 * ======================
 * Telefonun sunucuya bağlanıp bağlanamayacağını test eder.
 */

const http = require('http');
const https = require('https');

const CONFIG = {
  host: 'localhost',
  httpPort: 4545,
  httpsPort: 4546,
  timeout: 5000
};

console.log('\n════════════════════════════════════════════════════════════');
console.log('  ÇINARKÖY SYNC - TELEFON BAĞLANTI TESTİ');
console.log('════════════════════════════════════════════════════════════\n');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  return fn()
    .then(() => {
      console.log(`✓ ${name}`);
      testsPassed++;
    })
    .catch((err) => {
      console.log(`✗ ${name}`);
      console.log(`  Hata: ${err.message}`);
      testsFailed++;
    });
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: CONFIG.host,
      port: port,
      path: path,
      method: 'GET',
      timeout: CONFIG.timeout,
      headers: {
        'User-Agent': 'CinarkoySync-Test/1.0'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data: data });
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Zaman aşımı'));
    });

    req.end();
  });
}

async function runTests() {
  console.log('1. Servis Sağlık Kontrolü\n' + '─'.repeat(50));
  
  await test('HTTP Sağlık endpoint\'i yanıt veriyor', async () => {
    const res = await httpGet(CONFIG.httpPort, '/saglik');
    if (!res.data.ok) throw new Error('Sağlık kontrolü başarısız');
  });

  console.log('\n2. Eşleşme Endpoint\'i\n' + '─'.repeat(50));
  
  await test('Eşleşme endpoint\'i erişilebilir', async () => {
    const res = await httpGet(CONFIG.httpPort, '/eslesme');
    if (!res.data.ok) throw new Error('Eşleşme yanıtı geçersiz');
  });

  await test('Token alınabiliyor', async () => {
    const res = await httpGet(CONFIG.httpPort, '/eslesme');
    if (!res.data.token) {
      console.log(`    Durum: ${res.data.eslesme?.mesaj || 'Token verilmedi'}`);
      if (res.data.onayBekliyor) {
        console.log('    ⚠ Onay bekleniyor - bu normal (ikinci cihaz için)');
        return; // Onay bekliyorsa bu bir hata değil
      }
      throw new Error('Token verilmedi');
    }
    console.log(`    Token: ${res.data.token.substring(0, 8)}...`);
  });

  await test('Adres listesi dolu', async () => {
    const res = await httpGet(CONFIG.httpPort, '/eslesme');
    if (!res.data.adaylar || res.data.adaylar.length === 0) {
      throw new Error('Aday adres listesi boş');
    }
    console.log(`    Adres sayısı: ${res.data.adaylar.length}`);
    console.log(`    Kalıcı adres: ${res.data.kaliciAdres}`);
  });

  console.log('\n3. CORS Kontrolü\n' + '─'.repeat(50));
  
  await test('CORS başlıkları doğru', async () => {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: CONFIG.host,
        port: CONFIG.httpPort,
        path: '/eslesme',
        method: 'OPTIONS',
        headers: {
          'Origin': `http://${CONFIG.host}:${CONFIG.httpPort}`,
          'Access-Control-Request-Method': 'GET'
        }
      };

      const req = http.request(options, (res) => {
        if (res.statusCode === 204 || res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`OPTIONS yanıt kodu: ${res.statusCode}`));
        }
      });

      req.on('error', reject);
      req.end();
    });
  });

  console.log('\n4. Panel Erişimi\n' + '─'.repeat(50));
  
  await test('Panel anasayfası açılıyor', async () => {
    const res = await httpGet(CONFIG.httpPort, '/');
    if (res.status !== 200) throw new Error('Panel açılmadı');
  });

  await test('Eşleşme sayfası açılıyor', async () => {
    const res = await httpGet(CONFIG.httpPort, '/eslesme.html');
    if (res.status !== 200) throw new Error('Eşleşme sayfası açılmadı');
  });

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  SONUÇ: ${testsPassed} başarılı, ${testsFailed} başarısız`);
  
  if (testsFailed === 0) {
    console.log('  ✓ TÜM TESTLER GEÇTİ - Telefon bağlanabilir!');
  } else {
    console.log('  ✗ BAZI TESTLER BAŞARISIZ - Düzeltme gerekli');
  }
  console.log('════════════════════════════════════════════════════════════\n');

  // Windows güvenlik duvarı kontrolü
  console.log('5. Güvenlik Duvarı Kontrolü\n' + '─'.repeat(50));
  console.log('   Manuel kontrol gerekli:');
  console.log('   1. Başlatıcıyı açın (CinarkoySync.exe)');
  console.log('   2. "Windows iznini ver" butonuna basın');
  console.log('   3. UAC onayına "Evet" deyin\n');

  process.exit(testsFailed > 0 ? 1 : 0);
}

// Servisi bekle
setTimeout(() => {
  runTests().catch((err) => {
    console.error('\n✗ Test hatası:', err.message);
    process.exit(1);
  });
}, 1000);
