#!/usr/bin/env node
/**
 * TAM QR AKIŞI - QR'dan telefon uygulamasına kadar herşeyi test eder
 */

const http = require('http');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  TAM QR AKIŞI TESTİ');
console.log('╚════════════════════════════════════════════════════════════╝\n');

async function testQR() {
  console.log('1. QR kodunu alıyoruz (/eslesme)...');
  
  const eslesme = await new Promise((resolve, reject) => {
    http.get('http://localhost:4545/eslesme', (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });

  if (!eslesme.qrTam) {
    console.log('✗ QR bulunamadı!\n');
    return false;
  }

  console.log('   ✓ QR alındı:', eslesme.qrTam);
  console.log('');

  // QR'dan token'i çıkar
  const match = eslesme.qrTam.match(/#token=([A-Za-z0-9]+)/);
  if (!match) {
    console.log('✗ Token QR\'da bulunamadı!\n');
    return false;
  }

  const token = match[1];
  console.log('2. Token çıkarıldı:', token.substring(0, 8) + '...' + token.substring(token.length - 8));
  console.log('');

  // QR'dan base URL'i al
  const baseUrl = eslesme.qrTam.split('#')[0].replace(/\/$/, '');
  console.log('3. Base URL:', baseUrl);
  console.log('');

  // Telefon uygulamasının açıldığını kontrol et
  console.log('4. Telefon uygulaması açılıyor...');
  const appCheck = await new Promise((resolve) => {
    http.get(baseUrl, (res) => {
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });

  if (!appCheck) {
    console.log('   ✗ Telefon uygulaması açılamadı!\n');
    return false;
  }

  console.log('   ✓ Telefon uygulaması açıldı');
  console.log('');

  // Test kaydı gönder
  console.log('5. Test kaydı gönderiliyor (token ile)...');
  
  const testKayit = {
    id: 'qr-test-' + Date.now(),
    plate: '34QR999',
    site: 'QR Test',
    unit: 'A1',
    courier: 'QR Testi',
    company: 'Test',
    guard: 'Test',
    note: 'QR akış testi',
    date: new Date().toLocaleDateString('tr-TR'),
    time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    ts: Date.now()
  };

  const kayitData = JSON.stringify(testKayit);
  
  const kayitRes = await new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 4545,
      path: '/kayit',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': kayitData.length,
        'X-Sync-Token': token
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    req.write(kayitData);
    req.end();
  });

  if (kayitRes.status === 200 && kayitRes.data.ok) {
    console.log('   ✓ Kayıt başarıyla gönderildi!');
    console.log('');
    return true;
  } else {
    console.log('   ✗ Kayıt gönderilemedi!');
    console.log('   HTTP:', kayitRes.status);
    console.log('   Yanıt:', JSON.stringify(kayitRes.data, null, 2));
    console.log('');
    return false;
  }
}

testQR()
  .then((success) => {
    console.log('═'.repeat(60));
    if (success) {
      console.log('✓✓✓ TÜM QR AKIŞI BAŞARILI! ✓✓✓');
      console.log('');
      console.log('Telefonda şunu yapın:');
      console.log('1. QR kodu okutun (panelden)');
      console.log('2. Otomatik olarak uygulamaya gidecek');
      console.log('3. Token otomatik kaydedilecek');
      console.log('4. Kayıt gönderebileceksiniz!');
    } else {
      console.log('✗ QR AKIŞI BAŞARISIZ');
    }
    console.log('═'.repeat(60) + '\n');
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error('\n✗ HATA:', err.message);
    process.exit(1);
  });
