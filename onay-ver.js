#!/usr/bin/env node
/**
 * Bekleyen cihazları onaylama aracı
 * Yönetici panelden yapabilir ama bu script hızlı kurulum için
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Config oku
const configPath = path.join(__dirname, 'companion', 'data', 'eslesmeler.json');
const eslesme = JSON.parse(fs.readFileSync(configPath, 'utf8'));

console.log('\n╔═══════════════════════════════════════════════════════╗');
console.log('║  BEKLEYEN CİHAZLARI ONAYLA                           ║');
console.log('╚═══════════════════════════════════════════════════════╝\n');

if (!eslesme.onayBekleyen || eslesme.onayBekleyen.length === 0) {
  console.log('✓ Onay bekleyen cihaz yok.\n');
  process.exit(0);
}

console.log(`Bekleyen cihaz sayısı: ${eslesme.onayBekleyen.length}\n`);

eslesme.onayBekleyen.forEach((c, i) => {
  console.log(`${i + 1}. IP: ${c.ip}`);
  console.log(`   Kimlik: ${c.kimlik || 'yok'}`);
  console.log(`   İstek: ${new Date(c.istendi).toLocaleString('tr-TR')}\n`);
});

console.log('─'.repeat(55));
console.log('Tüm bekleyen cihazlar otomatik onaylanacak...\n');

// Config'den token al
const companionConfig = path.join(__dirname, 'companion', 'config.json');
let token = '';
try {
  const cfg = JSON.parse(fs.readFileSync(companionConfig, 'utf8'));
  token = cfg.token;
} catch (e) {
  console.error('✗ Token okunamadı:', e.message);
  process.exit(1);
}

// Tüm cihazları onayla
let approved = 0;
let failed = 0;

function onaylaCihaz(ip) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ ip });
    const options = {
      hostname: 'localhost',
      port: 4545,
      path: '/eslesme/onay',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'X-Sync-Token': token
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function onaylaTumunu() {
  for (const cihaz of eslesme.onayBekleyen) {
    try {
      await onaylaCihaz(cihaz.ip);
      console.log(`✓ Onaylandı: ${cihaz.ip}`);
      approved++;
    } catch (err) {
      console.log(`✗ Başarısız: ${cihaz.ip} - ${err.message}`);
      failed++;
    }
  }

  console.log('\n' + '═'.repeat(55));
  console.log(`Sonuç: ${approved} onaylandı, ${failed} başarısız`);
  console.log('═'.repeat(55) + '\n');

  if (failed === 0) {
    console.log('✓ Tüm cihazlar başarıyla onaylandı!');
    console.log('  Telefonlar artık bağlanabilir.\n');
  }
}

onaylaTumunu().catch((err) => {
  console.error('\n✗ Hata:', err.message);
  process.exit(1);
});
