/**
 * Site/Blok veritabanı seed script
 * Telefon uygulamasındaki mock verileri backend'e aktarır
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const SITE_LOG_PATH = path.join(DATA_DIR, 'siteler.jsonl');

// Mock siteler (telefon uygulamasından)
const MOCK_SITES = [
  /* ---- CEVAHİR BLOKLARI ---- */
  {
    id:'cevahir563-13', street:'Aleyna Sokak', name:'Cevahir 563-13',
    lat: 41.02307770603441, lng: 29.19935776910435,
    box:[155,290,250,82],
    units:[
      {c:'A4', lat:41.02307770603441, lng:29.19935776910435, entry:'', qr:'https://maps.google.com/?q=41.02307770603441,29.19935776910435'},
      {c:'A2', lat:41.02308956030348, lng:29.19820855885712, entry:'', qr:'https://maps.google.com/?q=41.02308956030348,29.19820855885712'},
      {c:'A1', lat:41.02303674374058, lng:29.19793399336484, entry:'', qr:'https://maps.google.com/?q=41.02303674374058,29.19793399336484'},
      {c:'C1', lat:41.02308155061975, lng:29.1997114360173, entry:'', qr:'https://maps.google.com/?q=41.02308155061975,29.1997114360173'},
      {c:'B', lat:41.02299340669676, lng:29.19859880739902, entry:'', qr:'https://maps.google.com/?q=41.02299340669676,29.19859880739902'},
      {c:'A3', lat:41.02307786572372, lng:29.19898476539496, entry:'', qr:'https://maps.google.com/?q=41.02307786572372,29.19898476539496'}
    ]
  },
  {
    id:'cevahir564-1', street:'Dumlusu Sokak', name:'Cevahir 564-1',
    lat: 41.02407430620328, lng: 29.20179113211643,
    box:[478,40,310,375],
    units:[
      {c:'E1', lat:41.02407430620328, lng:29.20179113211643, entry:'', qr:'https://maps.google.com/?q=41.02407430620328,29.20179113211643'},
      {c:'D', lat:41.02474293338042, lng:29.20109001832819, entry:'', qr:'https://maps.google.com/?q=41.02474293338042,29.20109001832819'},
      {c:'A1', lat:41.02328374208423, lng:29.20201803028566, entry:'', qr:'https://maps.google.com/?q=41.02328374208423,29.20201803028566'},
      {c:'C3', lat:41.02365278207963, lng:29.20108732015258, entry:'', qr:'https://maps.google.com/?q=41.02365278207963,29.20108732015258'},
      {c:'A4', lat:41.02460676140519, lng:29.20163754342273, entry:'', qr:'https://maps.google.com/?q=41.02460676140519,29.20163754342273'},
      {c:'C2', lat:41.02410621855989, lng:29.20029213454636, entry:'', qr:'https://maps.google.com/?q=41.02410621855989,29.20029213454636'}
    ]
  },

  /* ---- AYDUR BLOKLARI ---- */
  {
    id:'aydur563-15', street:'Dede Korkut Sokak', name:'Aydur 563-15',
    lat: 41.02261695490009, lng: 29.19714643703557,
    box:[42,392,140,160],
    units:[
      {c:'I', lat:41.02261695490009, lng:29.19714643703557, entry:'', qr:'https://maps.google.com/?q=41.02261695490009,29.19714643703557'},
      {c:'J', lat:41.02198918364284, lng:29.19702712992148, entry:'', qr:'https://maps.google.com/?q=41.02198918364284,29.19702712992148'},
      {c:'K', lat:41.0219873754487, lng:29.19752219567631, entry:'', qr:'https://maps.google.com/?q=41.0219873754487,29.19752219567631'}
    ]
  },
  {
    id:'aydur563-14', street:'Dede Korkut Sokak', name:'Aydur 563-14',
    lat: 41.02264962944798, lng: 29.19936372594864,
    box:[185,385,195,167],
    units:[
      {c:'P', lat:41.02264962944798, lng:29.19936372594864, entry:'', qr:'https://maps.google.com/?q=41.02264962944798,29.19936372594864'},
      {c:'M', lat:41.02222638524279, lng:29.19933731822695, entry:'', qr:'https://maps.google.com/?q=41.02222638524279,29.19933731822695'},
      {c:'L', lat:41.02208485419702, lng:29.19856201467471, entry:'', qr:'https://maps.google.com/?q=41.02208485419702,29.19856201467471'},
      {c:'N', lat:41.02257075599226, lng:29.19817001211239, entry:'', qr:'https://maps.google.com/?q=41.02257075599226,29.19817001211239'},
      {c:'O', lat:41.02264926154946, lng:29.19878036849991, entry:'', qr:'https://maps.google.com/?q=41.02264926154946,29.19878036849991'}
    ]
  },

  /* ---- GÖKYOL BLOKLARI ---- */
  {
    id:'gokyol563-16', street:'Ovacık Sokak', name:'Gökyol 563-16',
    lat: 41.02182541258998, lng: 29.19889698286877,
    box:[42,555,370,148],
    units:[
      {c:'C', lat:41.02182541258998, lng:29.19889698286877, entry:'', qr:'https://maps.google.com/?q=41.02182541258998,29.19889698286877'},
      {c:'A', lat:41.02161188596384, lng:29.19747330335008, entry:'', qr:'https://maps.google.com/?q=41.02161188596384,29.19747330335008'},
      {c:'G', lat:41.02113225375112, lng:29.19899247247338, entry:'', qr:'https://maps.google.com/?q=41.02113225375112,29.19899247247338'},
      {c:'E', lat:41.02086346402842, lng:29.19774952742288, entry:'', qr:'https://maps.google.com/?q=41.02086346402842,29.19774952742288'}
    ]
  },

  /* ---- VİLLA GÜVENLİK GİRİŞİ ---- */
  {
    id:'villa', street:'Güvenlik', name:'Villa Güvenlik Girişi',
    lat: 41.02306901463607, lng: 29.20264694419512,
    box:[750,280,120,50],
    units:[
      {c:'Giriş', lat:41.02306901463607, lng:29.20264694419512, entry:'', qr:'https://maps.google.com/?q=41.02306901463607,29.20264694419512'}
    ]
  }
];

function seedSites() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Eğer site log dosyası varsa seed etme
  if (fs.existsSync(SITE_LOG_PATH)) {
    console.log('Site veritabanı zaten mevcut, seed atlanıyor.');
    return;
  }

  console.log('Site veritabanı oluşturuluyor...');
  
  const now = Date.now();
  const sites = MOCK_SITES.map(site => ({
    id: site.id,
    name: site.name,
    street: site.street || '',
    lat: site.lat || null,
    lng: site.lng || null,
    units: site.units || [],
    box: site.box || null,
    updatedAt: now,
    deleted: false
  }));

  // JSONL formatında yaz
  const lines = sites.map(site => JSON.stringify(site)).join('\n') + '\n';
  fs.writeFileSync(SITE_LOG_PATH, lines, 'utf8');

  console.log(`✅ ${sites.length} site eklendi!`);
  console.log('   Dosya:', SITE_LOG_PATH);
}

// Eğer direkt çalıştırılırsa
if (require.main === module) {
  seedSites();
}

module.exports = { seedSites, MOCK_SITES };
