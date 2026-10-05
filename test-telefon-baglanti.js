#!/usr/bin/env node
/**
 * TELEFON BAĞLANTI TEST - Telefonun erişebileceği tüm yolları test eder
 */

const http = require('http');

const IP = '192.168.1.129';
const PORT = 4545;

function test(path, description) {
  return new Promise((resolve) => {
    const req = http.get(`http://${IP}:${PORT}${path}`, (res) => {
      const ok = res.statusCode === 200;
      console.log(`${ok ? '✓' : '✗'} ${description}: HTTP ${res.statusCode}`);
      resolve(ok);
    });
    req.on('error', (e) => {
      console.log(`✗ ${description}: ${e.message}`);
      resolve(false);
    });
    req.setTimeout(5000, () => {
      console.log(`✗ ${description}: Zaman aşımı`);
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  TELEFON BAĞLANTI TESTİ');
  console.log('║  Adres: http://' + IP + ':' + PORT);
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const tests = [
    ['/saglik', 'Sağlık kontrolü'],
    ['/eslesme', 'Eşleşme (QR kod bilgileri)'],
    ['/telefon/', 'Telefon uygulaması (ANA SAYFA)'],
    ['/telefon/index.html', 'Telefon uygulaması HTML'],
    ['/', 'Panel ana sayfa (localhost dışından ERİŞİLMEMELİ)']
  ];

  let passed = 0;
  for (const [path, desc] of tests) {
    if (await test(path, desc)) passed++;
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n' + '═'.repeat(56));
  console.log(`SONUÇ: ${passed}/${tests.length} test başarılı\n`);

  if (passed >= 3) {
    console.log('✓ TELEFON BAĞLANABİLİR!');
    console.log(`  Telefonda şu adresi açın: http://${IP}:${PORT}/telefon/\n`);
  } else {
    console.log('✗ BAĞLANTI SORUNU VAR');
    console.log('  • Telefon ve bilgisayar aynı Wi-Fi\'de mi?');
    console.log('  • Windows Firewall engelliyor olabilir mi?\n');
  }
}

main().catch(console.error);
