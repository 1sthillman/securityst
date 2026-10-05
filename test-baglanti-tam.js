#!/usr/bin/env node
/**
 * KAPSAMLI BAĞLANTI TESTİ
 * ========================
 * Telefon-bilgisayar bağlantısının tüm katmanlarını test eder.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const SUNUCU = 'http://192.168.1.129:4545';
const RENK = {
  yesil: '\x1b[32m',
  kirmizi: '\x1b[31m',
  sari: '\x1b[33m',
  mavi: '\x1b[36m',
  sifirla: '\x1b[0m'
};

function log(mesaj, renk = RENK.sifirla) {
  console.log(`${renk}${mesaj}${RENK.sifirla}`);
}

function basarili(mesaj) {
  log(`✅ ${mesaj}`, RENK.yesil);
}

function basarisiz(mesaj) {
  log(`❌ ${mesaj}`, RENK.kirmizi);
}

function bilgi(mesaj) {
  log(`ℹ️  ${mesaj}`, RENK.mavi);
}

function uyari(mesaj) {
  log(`⚠️  ${mesaj}`, RENK.sari);
}

// HTTP GET isteği (Promise)
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

// HTTP POST isteği (Promise)
function post(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers
      }
    };
    
    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(responseData) });
        } catch {
          resolve({ status: res.statusCode, body: responseData });
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function testler() {
  console.log('\n' + '='.repeat(60));
  log('🧪 ÇINARKÖY SYNC - KAPSAMLI BAĞLANTI TESTİ', RENK.mavi);
  console.log('='.repeat(60) + '\n');
  
  let toplam = 0;
  let basarili_test = 0;
  
  // TEST 1: Sunucu çalışıyor mu?
  toplam++;
  bilgi('Test 1/7: Sunucu sağlık kontrolü...');
  try {
    const res = await get(`${SUNUCU}/saglik`);
    if (res.status === 200 && res.body.ok) {
      basarili(`Sunucu çalışıyor (${res.body.kayitSayisi} kayıt)`);
      basarili_test++;
    } else {
      basarisiz(`Sunucu yanıt verdi ama sağlıklı değil (status: ${res.status})`);
    }
  } catch (e) {
    basarisiz(`Sunucuya bağlanılamadı: ${e.message}`);
    console.log('\n⛔ KRITIK: Sunucu çalışmıyor! Önce sunucuyu başlatın:');
    console.log('   cd companion && node companion.js\n');
    process.exit(1);
  }
  
  // TEST 2: Eşleşme endpoint'i token veriyor mu?
  toplam++;
  bilgi('\nTest 2/7: Token alma (eşleşme)...');
  try {
    const res = await get(`${SUNUCU}/eslesme`);
    if (res.status === 200 && res.body.token) {
      basarili(`Token alındı: ${res.body.token.substring(0, 8)}...`);
      bilgi(`   Cihaz sayısı: ${res.body.cihazSayisi}`);
      bilgi(`   İlk cihaz: ${res.body.ilkCihaz ? 'Evet' : 'Hayır'}`);
      bilgi(`   Onay bekliyor: ${res.body.onayBekliyor ? 'Evet' : 'Hayır'}`);
      
      if (res.body.onayBekliyor) {
        uyari('   Bu cihaz onay bekliyor! Token alınamaz.');
        uyari('   Çözüm: node onay-ver.js çalıştırın');
      } else {
        basarili_test++;
      }
      
      // Token'ı sonraki testler için sakla
      global.TEST_TOKEN = res.body.token;
    } else {
      basarisiz(`Token alınamadı (status: ${res.status})`);
      if (res.body.onayBekliyor) {
        uyari('   Cihaz onay bekliyor - panelden veya onay-ver.js ile onaylayın');
      }
    }
  } catch (e) {
    basarisiz(`Eşleşme başarısız: ${e.message}`);
  }
  
  // TEST 3: Telefon uygulaması açılıyor mu?
  toplam++;
  bilgi('\nTest 3/7: Telefon uygulaması erişilebilirliği...');
  try {
    const res = await get(`${SUNUCU}/telefon/`);
    if (res.status === 200 && typeof res.body === 'string' && res.body.includes('<!DOCTYPE html>')) {
      basarili('Telefon uygulaması açılıyor');
      basarili_test++;
    } else {
      basarisiz(`Uygulama sayfası yüklenemedi (status: ${res.status})`);
    }
  } catch (e) {
    basarisiz(`Telefon uygulamasına erişilemedi: ${e.message}`);
  }
  
  // TEST 4: QR kod içeriği doğru mu?
  toplam++;
  bilgi('\nTest 4/7: QR kod içeriği...');
  try {
    const res = await get(`${SUNUCU}/eslesme`);
    if (res.body.qrTam) {
      const qr = res.body.qrTam;
      bilgi(`   QR içeriği: ${qr}`);
      
      if (qr.includes('#token=')) {
        basarili('QR kod token içeriyor ✓');
        basarili_test++;
      } else {
        uyari('QR kod token içermiyor (eski format)');
      }
      
      if (qr.includes('192.168')) {
        basarili('QR kod geçerli IP adresi içeriyor ✓');
      } else {
        uyari('QR kod localhost/belirsiz adres içeriyor');
      }
    } else {
      basarisiz('QR kod içeriği alınamadı');
    }
  } catch (e) {
    basarisiz(`QR test başarısız: ${e.message}`);
  }
  
  // TEST 5: Token ile kayıt gönderilebiliyor mu?
  toplam++;
  bilgi('\nTest 5/7: Kayıt gönderme (token ile)...');
  if (!global.TEST_TOKEN) {
    uyari('Token yok, test atlanıyor (Test 2 başarısız oldu)');
  } else {
    try {
      const testKayit = {
        uid: 'test-' + Date.now(),
        site: 'TEST',
        unit: '123',
        plate: '34ABC123',
        guard: 'Test Nöbetçi',
        courier: 'Ziyaretçi',
        company: 'Test Firma',
        date: new Date().toISOString().split('T')[0],
        time: new Date().toTimeString().split(' ')[0].substring(0, 5),
        ts: Date.now(),
        note: 'Otomatik test kaydı'
      };
      
      const res = await post(`${SUNUCU}/kayit`, testKayit, {
        'X-Sync-Token': global.TEST_TOKEN
      });
      
      if (res.status === 200 && res.body.ok) {
        basarili(`Kayıt gönderildi (${res.body.status})`);
        basarili_test++;
      } else {
        basarisiz(`Kayıt gönderilemedi (status: ${res.status})`);
      }
    } catch (e) {
      basarisiz(`Kayıt gönderme hatası: ${e.message}`);
    }
  }
  
  // TEST 6: Excel dosyası oluşuyor mu?
  toplam++;
  bilgi('\nTest 6/7: Excel dosyası kontrolü...');
  const excelYolu = path.join(__dirname, 'companion', 'data', 'kayitlar.xlsx');
  if (fs.existsSync(excelYolu)) {
    const stats = fs.statSync(excelYolu);
    basarili(`Excel dosyası mevcut (${(stats.size / 1024).toFixed(1)} KB)`);
    bilgi(`   Son değişiklik: ${stats.mtime.toLocaleString('tr-TR')}`);
    basarili_test++;
  } else {
    basarisiz('Excel dosyası bulunamadı');
  }
  
  // TEST 7: JSONL log dosyası var mı?
  toplam++;
  bilgi('\nTest 7/7: JSONL log dosyası kontrolü...');
  const logYolu = path.join(__dirname, 'companion', 'data', 'kayitlar.jsonl');
  if (fs.existsSync(logYolu)) {
    const stats = fs.statSync(logYolu);
    const satirlar = fs.readFileSync(logYolu, 'utf8').trim().split('\n').length;
    basarili(`Log dosyası mevcut (${satirlar} kayıt, ${(stats.size / 1024).toFixed(1)} KB)`);
    basarili_test++;
  } else {
    basarisiz('Log dosyası bulunamadı');
  }
  
  // SONUÇ
  console.log('\n' + '='.repeat(60));
  const basariOrani = (basarili_test / toplam * 100).toFixed(0);
  
  if (basarili_test === toplam) {
    log(`🎉 MÜKEMMEL! Tüm testler başarılı (${basarili_test}/${toplam})`, RENK.yesil);
    console.log('='.repeat(60));
    console.log('\n✅ SİSTEM TAMAMEN ÇALIŞIYOR!');
    console.log('\n📱 Telefon Kullanım Adımları:');
    console.log('   1. Tarayıcıyı kapat ve yeniden aç');
    console.log('   2. QR okut veya adres gir: http://192.168.1.129:4545/telefon/');
    console.log('   3. Plaka çek ve kaydet');
    console.log('   4. Sağ altta "Senkron" badge yeşil olmalı\n');
  } else if (basarili_test >= toplam * 0.7) {
    log(`⚠️  Testlerin çoğu başarılı (${basarili_test}/${toplam} - %${basariOrani})`, RENK.sari);
    console.log('='.repeat(60));
    console.log('\n🔧 KÜÇÜK SORUNLAR VAR, AMA ÇALIŞIR DURUMDA');
    console.log('   Yukarıdaki uyarıları kontrol edin.\n');
  } else {
    log(`❌ Testlerin yarısından fazlası başarısız (${basarili_test}/${toplam} - %${basariOrani})`, RENK.kirmizi);
    console.log('='.repeat(60));
    console.log('\n⛔ KRİTİK SORUNLAR VAR!');
    console.log('\nÖnerilen Adımlar:');
    console.log('   1. Sunucuyu yeniden başlat: node sunucu-yeniden-baslat.ps1');
    console.log('   2. Cihazları onayla: node onay-ver.js');
    console.log('   3. Bu testi tekrar çalıştır: node test-baglanti-tam.js\n');
  }
  
  console.log('📄 Detaylı çözüm kılavuzu: SORUN-COZUMU.md\n');
}

// Testleri çalıştır
testler().catch(e => {
  console.error('\n❌ Test çalıştırma hatası:', e.message);
  process.exit(1);
});
