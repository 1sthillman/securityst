#!/usr/bin/env node
/**
 * QR KOD AKIŞI TAM TEST
 * =====================
 * Telefon QR okuttuğunda ne olacağını simüle eder
 */

const http = require('http');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  QR KOD AKIŞI - TELEFON SİMÜLASYONU                       ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

function httpRequest(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        // Hem JSON hem de text döndürebilir
        let parsed = body;
        try {
          if (body.trim()) parsed = JSON.parse(body);
        } catch {
          // JSON değilse text olarak kalsın
        }
        resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw: body });
      });
    });
    
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function testFlow() {
  let step = 1;
  
  // ===== ADIM 1: QR OKUTMA (Telefon eşleşme bilgisini alır) =====
  console.log(`${step++}. QR Kodu Okutma - /eslesme çağrısı`);
  console.log('─'.repeat(60));
  
  const eslesme = await httpRequest({
    hostname: 'localhost',
    port: 4545,
    path: '/eslesme',
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)',
      'X-Sync-Cihaz': 'test-telefon-12345' // Telefon kimliği
    }
  });
  
  if (!eslesme.data.ok) {
    console.log('✗ BAŞARISIZ: Eşleşme yanıtı geçersiz\n');
    return false;
  }
  
  console.log(`   Durum: ${eslesme.status}`);
  console.log(`   Token: ${eslesme.data.token ? '✓ Alındı' : '✗ YOK!'}`);
  console.log(`   Adres: ${eslesme.data.kaliciAdres}`);
  console.log(`   Mesaj: ${eslesme.data.eslesme.mesaj}`);
  
  if (!eslesme.data.token) {
    console.log('\n✗ KRİTİK: TOKEN VERİLMEDİ!');
    console.log(`   Sebep: ${eslesme.data.eslesme.mesaj}`);
    console.log(`   Onay bekliyor: ${eslesme.data.onayBekliyor}`);
    
    if (eslesme.data.onayBekliyor) {
      console.log('\n   ÇÖZÜM: node onay-ver.js komutunu çalıştırın');
    }
    return false;
  }
  
  const TOKEN = eslesme.data.token;
  const BASE_URL = eslesme.data.kaliciAdres || 'http://localhost:4545';
  console.log('   ✓ Eşleşme başarılı\n');
  
  // ===== ADIM 2: UYGULAMAYA GİRİŞ - Telefon uygulaması açılır =====
  console.log(`${step++}. Telefon Uygulaması Açılır - /telefon/`);
  console.log('─'.repeat(60));
  
  const telefonApp = await httpRequest({
    hostname: 'localhost',
    port: 4545,
    path: '/telefon/',
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)',
      'X-Sync-Cihaz': 'test-telefon-12345'
    }
  });
  
  if (telefonApp.status === 200) {
    console.log('   ✓ Telefon uygulaması açıldı\n');
  } else {
    console.log(`   ✗ BAŞARISIZ: HTTP ${telefonApp.status}\n`);
    return false;
  }
  
  // ===== ADIM 3: SAĞLIK KONTROLÜ - Sunucu durumunu kontrol =====
  console.log(`${step++}. Sağlık Kontrolü - /saglik`);
  console.log('─'.repeat(60));
  
  const saglik = await httpRequest({
    hostname: 'localhost',
    port: 4545,
    path: '/saglik',
    method: 'GET'
  });
  
  if (saglik.data.ok) {
    console.log(`   ✓ Servis sağlıklı`);
    console.log(`   Kayıt sayısı: ${saglik.data.kayitSayisi}\n`);
  } else {
    console.log('   ✗ Servis sağlıksız\n');
    return false;
  }
  
  // ===== ADIM 4: TEST KAYIT GÖNDER - Senkronizasyonu test et =====
  console.log(`${step++}. Test Kaydı Gönder - POST /kayit`);
  console.log('─'.repeat(60));
  
  const ts = Date.now();
  const testKayit = {
    id: 'test-qr-' + ts,
    plate: '34TEST01',
    site: 'Test Blok',
    unit: 'A1',
    courier: 'Test Kurye',
    company: 'Test Firma',
    guard: 'Test Güvenlik',
    note: 'QR akış testi',
    date: new Date(ts).toLocaleDateString('tr-TR'),
    time: new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    ts: ts
  };
  
  const kayitData = JSON.stringify(testKayit);
  console.log(`   Gönderilen veri: ${kayitData.substring(0, 100)}...`);
  console.log(`   Veri boyutu: ${kayitData.length} byte`);
  
  const kayitRes = await httpRequest({
    hostname: 'localhost',
    port: 4545,
    path: '/kayit',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': kayitData.length,
      'X-Sync-Token': TOKEN,
      'X-Sync-Cihaz': 'test-telefon-12345'
    }
  }, kayitData);
  
  if (kayitRes.data.ok) {
    console.log(`   ✓ Kayıt başarıyla gönderildi`);
    console.log(`   Durum: ${kayitRes.data.status || 'ok'}`);
    console.log(`   ID: ${kayitRes.data.id || testKayit.id}`);
    console.log(`   Excel güncellendi: ${kayitRes.data.excelOk ? '✓' : '?'}\n`);
  } else {
    console.log(`   ✗ BAŞARISIZ`);
    console.log(`   HTTP Status: ${kayitRes.status}`);
    console.log(`   Yanıt tipi: ${typeof kayitRes.data}`);
    console.log(`   Ham yanıt: "${kayitRes.raw}"`);
    console.log(`   Yanıt:`, kayitRes.data ? JSON.stringify(kayitRes.data, null, 2) : '(boş)');
    console.log('');
    return false;
  }
  
  // ===== ADIM 5: DURUMU KONTROL =====
  console.log(`${step++}. Son Durum Kontrolü`);
  console.log('─'.repeat(60));
  
  const sonSaglik = await httpRequest({
    hostname: 'localhost',
    port: 4545,
    path: '/saglik',
    method: 'GET'
  });
  
  if (sonSaglik.data.ok) {
    console.log(`   ✓ Kayıt sayısı: ${sonSaglik.data.kayitSayisi}`);
    console.log(`   ✓ Sistem sağlıklı\n`);
  }
  
  return true;
}

// Test başlat
testFlow()
  .then((success) => {
    console.log('═'.repeat(60));
    if (success) {
      console.log('✓ TÜM ADIMLAR BAŞARILI!');
      console.log('  QR okutma → Uygulama açma → Kayıt gönderme → Excel');
      console.log('  Telefon kullanıma hazır!');
    } else {
      console.log('✗ TEST BAŞARISIZ - Yukarıdaki hataları düzeltin');
    }
    console.log('═'.repeat(60) + '\n');
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error('\n✗ HATA:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
