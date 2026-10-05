/**
 * Site/Blok veritabanı FULL seed script
 * Telefon uygulamasındaki TÜM mock verileri backend'e aktarır
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const SITE_LOG_PATH = path.join(DATA_DIR, 'siteler.jsonl');

// TÜM MOCK SİTELER (telefon uygulamasından - tam liste)
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
      {c:'C2', lat:41.02410621855989, lng:29.20029213454636, entry:'', qr:'https://maps.google.com/?q=41.02410621855989,29.20029213454636'},
      {c:'C2', lat:41.02442811993564, lng:29.20121766056874, entry:'', qr:'https://maps.google.com/?q=41.02442811993564,29.20121766056874'},
      {c:'A5', lat:41.02404162202706, lng:29.20109424019526, entry:'', qr:'https://maps.google.com/?q=41.02404162202706,29.20109424019526'},
      {c:'A6', lat:41.02381417126646, lng:29.20033830841074, entry:'', qr:'https://maps.google.com/?q=41.02381417126646,29.20033830841074'},
      {c:'D', lat:41.02310803880206, lng:29.20061597588805, entry:'', qr:'https://maps.google.com/?q=41.02310803880206,29.20061597588805'},
      {c:'A5', lat:41.02357854354459, lng:29.20037739894888, entry:'', qr:'https://maps.google.com/?q=41.02357854354459,29.20037739894888'},
      {c:'A3', lat:41.02437602350719, lng:29.20173880488307, entry:'', qr:'https://maps.google.com/?q=41.02437602350719,29.20173880488307'},
      {c:'A8', lat:41.02430422163768, lng:29.20009459985646, entry:'', qr:'https://maps.google.com/?q=41.02430422163768,29.20009459985646'},
      {c:'C1', lat:41.02436519514672, lng:29.20092357514609, entry:'', qr:'https://maps.google.com/?q=41.02436519514672,29.20092357514609'},
      {c:'A8', lat:41.02449918973315, lng:29.20007388778846, entry:'', qr:'https://maps.google.com/?q=41.02449918973315,29.20007388778846'},
      {c:'A2', lat:41.0235782376421, lng:29.20190702176131, entry:'', qr:'https://maps.google.com/?q=41.0235782376421,29.20190702176131'},
      {c:'B', lat:41.02317816030684, lng:29.20127594603947, entry:'', qr:'https://maps.google.com/?q=41.02317816030684,29.20127594603947'},
      {c:'E', lat:41.02478250896001, lng:29.20013081458205, entry:'', qr:'https://maps.google.com/?q=41.02478250896001,29.20013081458205'},
      {c:'C4', lat:41.02369738766952, lng:29.20134895455998, entry:'', qr:'https://maps.google.com/?q=41.02369738766952,29.20134895455998'},
      {c:'E2', lat:41.02387491103156, lng:29.20180291341377, entry:'', qr:'https://maps.google.com/?q=41.02387491103156,29.20180291341377'}
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
      {c:'E', lat:41.02086346402842, lng:29.19774952742288, entry:'', qr:'https://maps.google.com/?q=41.02086346402842,29.19774952742288'},
      {c:'D', lat:41.02184040263099, lng:29.19964936991656, entry:'', qr:'https://maps.google.com/?q=41.02184040263099,29.19964936991656'},
      {c:'H', lat:41.02126049303701, lng:29.19965674729721, entry:'', qr:'https://maps.google.com/?q=41.02126049303701,29.19965674729721'},
      {c:'B', lat:41.02175236733705, lng:29.19817956752387, entry:'', qr:'https://maps.google.com/?q=41.02175236733705,29.19817956752387'},
      {c:'F', lat:41.02095007150545, lng:29.19828283103623, entry:'', qr:'https://maps.google.com/?q=41.02095007150545,29.19828283103623'}
    ]
  },

  /* ---- SERRA BLOKLARI ---- */
  {
    id:'serra563-18', street:'Ovacık Sokak', name:'Serra 563-18',
    lat: 41.02067526465649, lng: 29.19840106672013,
    box:[42,708,92,160],
    units:[
      {c:'A1', lat:41.02067526465649, lng:29.19840106672013, entry:'', qr:'https://maps.google.com/?q=41.02067526465649,29.19840106672013'},
      {c:'B2', lat:41.0198708931976, lng:29.19799249273776, entry:'', qr:'https://maps.google.com/?q=41.0198708931976,29.19799249273776'},
      {c:'B1', lat:41.01992818953721, lng:29.19860520102997, entry:'', qr:'https://maps.google.com/?q=41.01992818953721,29.19860520102997'},
      {c:'C1', lat:41.02057723264651, lng:29.19797896472381, entry:'', qr:'https://maps.google.com/?q=41.02057723264651,29.19797896472381'},
      {c:'B3', lat:41.02041089847134, lng:29.19758167094136, entry:'', qr:'https://maps.google.com/?q=41.02041089847134,29.19758167094136'}
    ]
  },
  {
    id:'serra563-17', street:'Ovacık Sokak', name:'Serra 563-17',
    lat: 41.02071867017334, lng: 29.19882740401068,
    box:[137,700,268,178],
    units:[
      {c:'C2', lat:41.02071867017334, lng:29.19882740401068, entry:'', qr:'https://maps.google.com/?q=41.02071867017334,29.19882740401068'},
      {c:'E1', lat:41.02015790664948, lng:29.19958060331575, entry:'', qr:'https://maps.google.com/?q=41.02015790664948,29.19958060331575'},
      {c:'H1', lat:41.02028659864943, lng:29.20006535318266, entry:'', qr:'https://maps.google.com/?q=41.02028659864943,29.20006535318266'},
      {c:'C4', lat:41.02093769358702, lng:29.19981803711003, entry:'', qr:'https://maps.google.com/?q=41.02093769358702,29.19981803711003'},
      {c:'C3', lat:41.020832531983, lng:29.19932605637546, entry:'', qr:'https://maps.google.com/?q=41.020832531983,29.19932605637546'},
      {c:'A2', lat:41.01999896428725, lng:29.19892365907804, entry:'', qr:'https://maps.google.com/?q=41.01999896428725,29.19892365907804'}
    ]
  },

  /* ---- PEKERLER BLOKLARI ---- */
  {
    id:'pekerler563-19', street:'Emekçi Sokak', name:'Pekerler 563-19',
    lat: 41.01931972489571, lng: 29.19991844823705,
    box:[42,870,370,155],
    units:[
      {c:'G2', lat:41.01931972489571, lng:29.19991844823705, entry:'', qr:'https://maps.google.com/?q=41.01931972489571,29.19991844823705'},
      {c:'G1', lat:41.01941796183188, lng:29.20038375453452, entry:'', qr:'https://maps.google.com/?q=41.01941796183188,29.20038375453452'},
      {c:'B4', lat:41.01956109520082, lng:29.19870512717494, entry:'', qr:'https://maps.google.com/?q=41.01956109520082,29.19870512717494'},
      {c:'D1', lat:41.01994059903097, lng:29.19973948181239, entry:'', qr:'https://maps.google.com/?q=41.01994059903097,29.19973948181239'},
      {c:'B5', lat:41.01919974910861, lng:29.19928589562208, entry:'', qr:'https://maps.google.com/?q=41.01919974910861,29.19928589562208'},
      {c:'D2', lat:41.01979172538832, lng:29.19914026335507, entry:'', qr:'https://maps.google.com/?q=41.01979172538832,29.19914026335507'},
      {c:'F1', lat:41.01990147556836, lng:29.2003016980645, entry:'', qr:'https://maps.google.com/?q=41.01990147556836,29.2003016980645'}
    ]
  },

  /* ---- KARPEM BLOKLARI ---- */
  {
    id:'karpem570-3', street:'Dumlusu Sokak', name:'Karpem 570-3',
    lat: 41.02212181668784, lng: 29.20007484920718,
    box:[408,398,115,192],
    units:[
      {c:'B2', lat:41.02212181668784, lng:29.20007484920718, entry:'', qr:'https://maps.google.com/?q=41.02212181668784,29.20007484920718'},
      {c:'D', lat:41.02256820015145, lng:29.20068489926843, entry:'', qr:'https://maps.google.com/?q=41.02256820015145,29.20068489926843'},
      {c:'A', lat:41.02204029138807, lng:29.20083253552241, entry:'', qr:'https://maps.google.com/?q=41.02204029138807,29.20083253552241'},
      {c:'B3', lat:41.02192079194042, lng:29.2001162838203, entry:'', qr:'https://maps.google.com/?q=41.02192079194042,29.2001162838203'},
      {c:'C2', lat:41.02266774204965, lng:29.20002946484863, entry:'', qr:'https://maps.google.com/?q=41.02266774204965,29.20002946484863'},
      {c:'C1', lat:41.02246401366014, lng:29.1999946209267, entry:'', qr:'https://maps.google.com/?q=41.02246401366014,29.1999946209267'}
    ]
  },
  {
    id:'karpem565-1', street:'Aleyna Sokak', name:'Karpem 565-1',
    lat: 41.02282015294893, lng: 29.20211454426595,
    box:[578,400,172,77],
    units:[
      {c:'A', lat:41.02282015294893, lng:29.20211454426595, entry:'', qr:'https://maps.google.com/?q=41.02282015294893,29.20211454426595'},
      {c:'B', lat:41.02258428169188, lng:29.20149778930631, entry:'', qr:'https://maps.google.com/?q=41.02258428169188,29.20149778930631'}
    ]
  },

  /* ---- ÖZKİYI BLOKLARI ---- */
  {
    id:'ozkiyi570-1', street:'Dumlusu Sokak', name:'Özkıyı 570-1',
    lat: 41.02150697280014, lng: 29.20077575925215,
    box:[408,590,115,262],
    units:[
      {c:'A', lat:41.02150697280014, lng:29.20077575925215, entry:'', qr:'https://maps.google.com/?q=41.02150697280014,29.20077575925215'},
      {c:'B1', lat:41.02108664998465, lng:29.20095727919638, entry:'', qr:'https://maps.google.com/?q=41.02108664998465,29.20095727919638'},
      {c:'C', lat:41.02046842118807, lng:29.20097189190816, entry:'', qr:'https://maps.google.com/?q=41.02046842118807,29.20097189190816'},
      {c:'B2', lat:41.0208363410033, lng:29.20102411582202, entry:'', qr:'https://maps.google.com/?q=41.0208363410033,29.20102411582202'},
      {c:'D2', lat:41.02106228659365, lng:29.20039326180888, entry:'', qr:'https://maps.google.com/?q=41.02106228659365,29.20039326180888'},
      {c:'E1', lat:41.02131376933538, lng:29.20033193841856, entry:'', qr:'https://maps.google.com/?q=41.02131376933538,29.20033193841856'},
      {c:'D1', lat:41.02075061933077, lng:29.20051837545759, entry:'', qr:'https://maps.google.com/?q=41.02075061933077,29.20051837545759'},
      {c:'E2', lat:41.02149903929441, lng:29.20025357737009, entry:'', qr:'https://maps.google.com/?q=41.02149903929441,29.20025357737009'}
    ]
  },

  /* ---- EGEYAPİ BLOKLARI ---- */
  {
    id:'egeyapi569-1', street:'Emekçi Sokak', name:'Egeyapı 569-1',
    lat: 41.0189469421227, lng: 29.20184378387203,
    box:[408,855,188,218],
    units:[
      {c:'C', lat:41.0189469421227, lng:29.20184378387203, entry:'', qr:'https://maps.google.com/?q=41.0189469421227,29.20184378387203'},
      {c:'B2', lat:41.01957591961269, lng:29.20178727455602, entry:'', qr:'https://maps.google.com/?q=41.01957591961269,29.20178727455602'},
      {c:'B4', lat:41.01999742341954, lng:29.20089898469439, entry:'', qr:'https://maps.google.com/?q=41.01999742341954,29.20089898469439'},
      {c:'D1', lat:41.01917979429414, lng:29.20135612573748, entry:'', qr:'https://maps.google.com/?q=41.01917979429414,29.20135612573748'},
      {c:'D2', lat:41.01948582005403, lng:29.20121823051256, entry:'', qr:'https://maps.google.com/?q=41.01948582005403,29.20121823051256'},
      {c:'B3', lat:41.01976640201543, lng:29.201028098475, entry:'', qr:'https://maps.google.com/?q=41.01976640201543,29.201028098475'},
      {c:'A1', lat:41.02007930236407, lng:29.20150320323829, entry:'', qr:'https://maps.google.com/?q=41.02007930236407,29.20150320323829'},
      {c:'A2', lat:41.01927440496274, lng:29.2018753867828, entry:'', qr:'https://maps.google.com/?q=41.01927440496274,29.2018753867828'},
      {c:'B1', lat:41.01980630296673, lng:29.20166991247285, entry:'', qr:'https://maps.google.com/?q=41.01980630296673,29.20166991247285'}
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

  // SELF-HEALING: Dosya varsa SEED YAPMA!
  // Seed sadece ilk kurulumda veya dosya yoksa çalışmalı
  if (fs.existsSync(SITE_LOG_PATH)) {
    const stats = fs.statSync(SITE_LOG_PATH);
    if (stats.size > 0) {
      console.log('ℹ️  Siteler veritabanı zaten var, seed atlanıyor');
      return;
    }
  }

  console.log('🔄 İlk kurulum: Siteler veritabanı oluşturuluyor...');
  
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
  
  // İstatistikler
  const totalUnits = sites.reduce((sum, s) => sum + (s.units ? s.units.length : 0), 0);
  console.log(`   Toplam ünite: ${totalUnits}`);
  console.log('   Bloklar:', sites.map(s => s.name).join(', '));
}

// Eğer direkt çalıştırılırsa
if (require.main === module) {
  seedSites();
}

module.exports = { seedSites, MOCK_SITES };
