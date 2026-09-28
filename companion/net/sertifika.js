'use strict';
/**
 * ============================================================================
 *  HTTPS SERTİFİKASI ÜRETİCİSİ — bağımlılıksız (saf Node)
 * ============================================================================
 *
 *  NEDEN VAR?
 *  Tarayıcılar kamerayı yalnızca "güvenli kaynakta" (secure context) açıyor.
 *  Güvenli kaynak = `https://` **veya** `http://localhost`.
 *  Telefon, bilgisayara `http://192.168.1.42:4599` diye bağlandığı için
 *  güvenli kaynak DEĞİLDİR ve tarayıcı kamera erişimini reddeder.
 *  Ölçülen sonuç: telefon "Kamera açılamadı / izin verilmedi" diyor ve
 *  ÇÖZÜMÜ YOK — tek-çekim de sürekli mod da çalışmıyor.
 *
 *  Bu dosya o çözümün parçası: **kök CA + sunucu sertifikası** üretir.
 *
 *  NEDEN `openssl` DEĞİL?
 *  Windows'ta `openssl.exe` yok (ölçüldü: `Get-Command openssl` boş). Kullanıcı
 *  "kurulum gerektirmesin" dediği için dış araç şart. Node 24'te
 *  `crypto.X509Certificate` var; yani DER yazmayı biz yapıyoruz ama
 *  **doğrulamayı Node'un kendi ayrıştırıcısına** bırakıyoruz. Bu, "yazdım,
 *  umarım çalışır" değil — "yazdım ve bağımsız doğrulayıcı onayladı".
 *
 *  NEDEN KÖK + YAPRAK İKİSİ?
 *  - IP değişince (bilgisayar yeniden bağlandığında) IP'ler değişir.
 *    Eğer TEK sertifika kullanılsaydı her IP değişiminde telefonda yeniden
 *    güven kurulumu gerekirdi. Kullanıcı bunu "sistem kendi halletsin"
 *    diye istiyordu.
 *  - Çözüm: KÖK CA bir kez üretilir ve **sabit** kalır (telefona bir kez
 *    kurulur). YAPRAK, IP'ler değiştiğinde yeniden üretilir ama **aynı kök
 *    tarafından imzalanır** — telefonun güveni bozulmaz. Yani IP değişse de
 *    kullanıcı hiçbir şey yapmaz.
 *
 *  GÜVENLİK NOTU: Kök CA özel anahtarı veri klasöründe tutulur ve ASLA
 *  paketlenmez/dağıtılmaz. Her kurulum kendi kökünü üretir — tek bir
 *  paylaşılan kök, tek bir sızıntının tüm kullanıcıları etkilemesi anlamına
 *  gelirdi.
 * ============================================================================
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================================================
//  DER (Distinguished Encoding Rules) — çalışma zamanı minimal yazıcı
// ============================================================================

/** DER uzunluk kodlaması: 127'den küçükse tek bayt, değilse 0x80|n bayt. */
function derUzunluk(len) {
  if (len < 0x80) return Buffer.from([len]);
  const baytlar = [];
  let n = len;
  while (n > 0) { baytlar.unshift(n & 0xff); n = Math.floor(n / 256); }
  return Buffer.from([0x80 | baytlar.length, ...baytlar]);
}

/** Etiket + içerik -> TLV (tag-length-value). */
function tlv(etiket, icerik) {
  return Buffer.concat([Buffer.from([etiket]), derUzunluk(icerik.length), icerik]);
}

const SEQ = (i) => tlv(0x30, i);
const SET = (i) => tlv(0x31, i);
const INT = (b) => tlv(0x02, b);
const BITSTR = (b) => tlv(0x03, b);
const OCTET = (b) => tlv(0x04, b);
const BOOL = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const UTF8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const NULL = () => Buffer.from([0x05, 0x00]);
const DER = Buffer.from;

/** "1.2.840.113549.1.1.11" -> OID'in DER gövdesi (etiket/uzunluk hariç). */
function oidGovde(dotted) {
  const parcalar = dotted.split('.').map(Number);
  if (parcalar.length < 2 || parcalar.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error('geçersiz OID: ' + dotted);
  }
  const govde = [40 * parcalar[0] + parcalar[1]];
  for (let i = 2; i < parcalar.length; i++) {
    // base-128: 7 bitlik gruplar, en anlamlı grup en sonda
    const gruplar = [parcalar[i] & 0x7f];
    let v = Math.floor(parcalar[i] / 128);
    while (v > 0) { gruplar.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    govde.push(...gruplar);
  }
  return DER(govde);
}

const OID = (dotted) => tlv(0x06, oidGovde(dotted));

/** Tarih -> UTCTime (2050'ye kadar) veya GeneralizedTime. */
function zaman(yil, ay, gun, saat, dakika, saniye) {
  const iki = (n) => String(n).padStart(2, '0');
  if (yil < 2050) {
    return tlv(0x17, DER(`${iki(yil % 100)}${iki(ay)}${iki(gun)}${iki(saat)}${iki(dakika)}${iki(saniye)}Z`, 'ascii'));
  }
  return tlv(0x18, DER(`${yil}${iki(ay)}${iki(gun)}${iki(saat)}${iki(dakika)}${iki(saniye)}Z`, 'ascii'));
}

/** İsim (issuer/subject): CN + O. */
function ad(cn, kurum) {
  const rdns = [];
  if (kurum) rdns.push(SET(SEQ(Buffer.concat([OID('2.5.4.10'), UTF8(kurum)]))));
  rdns.push(SET(SEQ(Buffer.concat([OID('2.5.4.3'), UTF8(cn)]))));
  return SEQ(Buffer.concat(rdns));
}

/** Anahtar çifti üret (RSA 3072 — hem hızlı hem yeterli). */
function anahtarUret() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function spkiGovde(spkiDer) {
  // SubjectPublicKeyInfo = SEQUENCE { algorithm, subjectPublicKey BIT STRING }
  // Node spki'yi zaten tam SEQUENCE olarak verir. SKI'yi (subjectKeyIdentifier)
  // DOĞRU hesaplamak için BIT STRING'in İÇERİĞİNE (yani RSA n||e DER'ine)
  // ihtiyacımız var; bu yüzden JWK üzerinden yeniden kuruyoruz.
  const pub = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
  const jwk = pub.export({ format: 'jwk' });
  const rsaPublicKey = SEQ(Buffer.concat([INT(DER(jwk.n, 'base64url')), INT(DER(jwk.e, 'base64url'))]));
  return {
    bitString: BITSTR(Buffer.concat([DER([0x00]), rsaPublicKey])),
    rsaPublicKey,
  };
}

/** OID + critical + değer -> Extension */
function uzanti(oid, kritikMi, degerDer) {
  const parcalar = [OID(oid)];
  if (kritikMi) parcalar.push(BOOL(true));
  parcalar.push(OCTET(degerDer));
  return SEQ(Buffer.concat(parcalar));
}

// --- yaygın OID'ler --------------------------------------------------------
const OID_SHA256_RSA = '1.2.840.113549.1.1.11';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';
const OID_EXT_KEY_USAGE = '2.5.29.37';
const OID_SAN = '2.5.29.17';
const OID_SKI = '2.5.29.14';
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';

// ============================================================================
//  SERTİFİKA ÇİZİMİ
// ============================================================================

/** Rastgele, pozitif (üst biti 0) seri numarası. */
function seriNumara() {
  const b = crypto.randomBytes(16);
  b[0] &= 0x7f;
  if (b[0] === 0) b[0] = 1;
  return INT(b);
}

/**
 * Bir sertifika DER üretir.
 *
 * @param {object} p
 * @param {string} p.subjectCN      özne adı
 * @param {object} p.subjectKey     Node PublicKey nesnesi
 * @param {object|null} p.issuerKey  imzalayanın özel anahtarı (yoksa kendi kendine)
 * @param {string} p.issuerName     imzalayanın adı
 * @param {Date}   p.gecerliFrom
 * @param {Date}   p.gecerliUntil
 * @param {Buffer} p.spkiDer        özne açık anahtarı (SPKI DER)
 * @param {Array}  p.uzantilar      DER uzantı listesi
 */
function sertifikaCiz(p) {
  const imzalayan = p.issuerKey || p.subjectKey;
  const tbs = SEQ(Buffer.concat([
    tlv(0xa0, INT(DER([0x02]))),                 // version v3
    seriNumara(),
    SEQ(Buffer.concat([OID(OID_SHA256_RSA), NULL()])),  // signature algorithm
    p.issuerName,
    SEQ(Buffer.concat([
      zaman(p.gecerliFrom.getUTCFullYear(), p.gecerliFrom.getUTCMonth() + 1, p.gecerliFrom.getUTCDate(),
        p.gecerliFrom.getUTCHours(), p.gecerliFrom.getUTCMinutes(), p.gecerliFrom.getUTCSeconds()),
      zaman(p.gecerliUntil.getUTCFullYear(), p.gecerliUntil.getUTCMonth() + 1, p.gecerliUntil.getUTCDate(),
        p.gecerliUntil.getUTCHours(), p.gecerliUntil.getUTCMinutes(), p.gecerliUntil.getUTCSeconds()),
    ])),
    p.subjectName,
    p.spkiDer,
    tlv(0xa3, SEQ(Buffer.concat(p.uzantilar))),
  ]));

  const imza = crypto.createSign('RSA-SHA256').update(tbs).sign(imzalayan);
  return SEQ(Buffer.concat([
    tbs,
    SEQ(Buffer.concat([OID(OID_SHA256_RSA), NULL()])),
    BITSTR(Buffer.concat([DER([0x00]), imza])),
  ]));
}

/**
 * "192.168.1.5" -> 4 bayt ;  "fe80::1" -> 16 bayt ; geçersizse null.
 *
 * ÖLÇÜLEN HATA (sessiz ve çok sinir bozucu): `String.match()` sonucu
 * [tamEşleşme, grup1, grup2, grup3, grup4] olmak üzere **5 elemanlıdır**.
 * `v4.map(Number)` ile ilk elemanı da dönüştürünce `Number("192.168.1.5")`
 * -> NaN oluyor ve `Buffer.from` onu **0x00** olarak yazıyor. Sonuç: 5 bayt
 * uzunluğunda geçersiz iPAddress SAN'ı. Node `checkIP` "invalid length=5"
 * diyordu, tarayıcı da reddediyordu. Düzeltme: yalnızca GRUPLARı alınır
 * (`v4.slice(1)`).
 */
function ipBayt(ip) {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const n = v4.slice(1).map(Number);      // slice(1) YOKSA 5 bayt olur
    if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
    return DER(n);
  }
  if (!/^[0-9a-fA-F:]+$/.test(ip) || !ip.includes(':')) return null;
  // IPv6 -> 16 bayt (yalın dönüştürme; sıkıştırılmış ve tam biçim)
  let bolum = ip.split('::');
  if (bolum.length > 2) return null;
  const sol = bolum[0] ? bolum[0].split(':') : [];
  const sag = bolum.length === 2 && bolum[1] ? bolum[1].split(':') : [];
  const bos = 8 - sol.length - sag.length;
  const parcalar = bolum.length === 2
    ? [...sol, ...new Array(Math.max(0, bos)).fill('0'), ...sag]
    : sol;
  if (parcalar.length !== 8) return null;
  const baytlar = [];
  for (const h of parcalar) {
    const v = parseInt(h, 16);
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) return null;
    baytlar.push((v >> 8) & 0xff, v & 0xff);
  }
  return DER(baytlar);
}

/** subjectAltName uzantısı: DNS adları + IP adresleri. */
function sanUzantisi(dnsAdlari, ipAdresleri) {
  const ogeler = [];
  for (const d of dnsAdlari) {
    if (!d || d.includes('*')) continue;
    ogeler.push(tlv(0x82, DER(d, 'ascii')));        // [2] dNSName
  }
  for (const ip of ipAdresleri) {
    const b = ipBayt(ip);
    if (b) ogeler.push(tlv(0x87, b));                // [7] iPAddress
  }
  return uzanti(OID_SAN, false, SEQ(Buffer.concat(ogeler)));
}

/** keyUsage: verilen adlara karşılık gelen bitler. */
function keyUsageUzantisi(adlar) {
  const BITLER = {
    digitalSignature: 0, nonRepudiation: 1, keyEncipherment: 2,
    dataEncipherment: 3, keyAgreement: 4, keyCertSign: 5, cRLSign: 6,
  };
  const enBuyuk = Math.max(...adlar.map((a) => BITLER[a]));
  const baytlar = Buffer.alloc(Math.floor(enBuyuk / 8) + 1);
  for (const a of adlar) baytlar[Math.floor(BITLER[a] / 8)] |= 0x80 >> (BITLER[a] % 8);
  const kullanilmayan = 7 - (enBuyuk % 8);
  return uzanti(OID_KEY_USAGE, true, BITSTR(Buffer.concat([DER([kullanilmayan]), baytlar])));
}

function temelKisitUzantisi(caMi, yolSinir) {
  const parcalar = [BOOL(caMi)];
  if (yolSinir !== undefined) parcalar.push(INT(DER([yolSinir])));
  return uzanti(OID_BASIC_CONSTRAINTS, true, SEQ(Buffer.concat(parcalar)));
}

function konumKilidiUzantisi(rsaPublicKeyDer) {
  // subjectKeyIdentifier = SHA-1(subjectPublicKey BIT STRING'in İÇERİĞİ)
  // Yani etiket/uzunluk ve "kullanılmayan bit" baytı DAHİL EDİLMEZ.
  return uzanti(OID_SKI, false, OCTET(crypto.createHash('sha1').update(rsaPublicKeyDer).digest()));
}

// ============================================================================
//  YÜKSEK SEVİYELİ API
// ============================================================================

/** Yıllara göre "şimdi + n yıl" */
function yilEkle(tarih, yil) {
  const d = new Date(tarih.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + yil);
  return d;
}

function pemEtiketle(der, etiket) {
  const b64 = der.toString('base64').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN ${etiket}-----\n${b64}\n-----END ${etiket}-----\n`;
}

/**
 * KÖK CA üret (veya var olanı yükle).
 * @returns {{kok:{pemDer, anahtarPem, parmakIzi}, kaynak:'yeni'|'disk'}}
 */
function kokUretVeyaYukle(kokYolu) {
  if (kokYolu && fs.existsSync(kokYolu.cert) && fs.existsSync(kokYolu.key)) {
    try {
      const pemDer = fs.readFileSync(kokYolu.cert);
      const anahtarPem = fs.readFileSync(kokYolu.key, 'utf8');
      const c = new crypto.X509Certificate(pemDer);
      // KÖKün kendisi kendi anahtarıyla imzalanır; bozulma tespiti
      if (!c.verify(c.publicKey)) throw new Error('kök sertifikası kendi imzasını doğrulamıyor');
      if (!c.ca) throw new Error('bu bir CA sertifikası değil');
      return { kok: { pemDer, anahtarPem, parmakIzi: c.fingerprint256 }, kaynak: 'disk' };
    } catch (e) {
      // Bozuk kök: sessizce yenisini yazmak yerine kaynağı koru ve yenisini üret.
      const yedek = kokYolu.cert + '.bozuk-' + Date.now();
      try { fs.copyFileSync(kokYolu.cert, yedek); } catch (_) { }
      console.warn('[sertifika] kök okunamadı, yedeklendi:', e.message);
    }
  }

  const cift = anahtarUret();
  const spkiDer = cift.publicKey;
  const pub = spkiGovde(spkiDer);
  const kokAd = 'CinarkoySync Yerel Kok CA';
  const simdi = new Date();
  const tbsKok = SEQ(Buffer.concat([
    tlv(0xa0, INT(DER([0x02]))),
    seriNumara(),
    SEQ(Buffer.concat([OID(OID_SHA256_RSA), NULL()])),
    ad(kokAd, 'CinarkoySync'),
    SEQ(Buffer.concat([
      zaman(simdi.getUTCFullYear(), simdi.getUTCMonth() + 1, simdi.getUTCDate(), 0, 0, 0),
      zaman(yilEkle(simdi, 10).getUTCFullYear(), yilEkle(simdi, 10).getUTCMonth() + 1, yilEkle(simdi, 10).getUTCDate(), 0, 0, 0),
    ])),
    ad(kokAd, 'CinarkoySync'),
    spkiDer,
    tlv(0xa3, SEQ(Buffer.concat([
      temelKisitUzantisi(true, 0),
      keyUsageUzantisi(['keyCertSign', 'cRLSign', 'digitalSignature']),
      konumKilidiUzantisi(pub.rsaPublicKey),
    ]))),
  ]));
  const imza = crypto.createSign('RSA-SHA256').update(tbsKok).sign(cift.privateKey);
  const kokDer = SEQ(Buffer.concat([
    tbsKok,
    SEQ(Buffer.concat([OID(OID_SHA256_RSA), NULL()])),
    BITSTR(Buffer.concat([DER([0x00]), imza])),
  ]));

  const pemDer = DER(pemEtiketle(kokDer, 'CERTIFICATE'), 'utf8');
  if (kokYolu) {
    fs.mkdirSync(path.dirname(kokYolu.cert), { recursive: true });
    fs.writeFileSync(kokYolu.cert, pemDer, { mode: 0o644 });
    fs.writeFileSync(kokYolu.key, cift.privateKey, { mode: 0o600 });
  }
  return { kok: { pemDer, anahtarPem: cift.privateKey, parmakIzi: new crypto.X509Certificate(pemDer).fingerprint256 }, kaynak: 'yeni' };
}

/**
 * SUNUCU (yaprak) sertifikası üret — kök tarafından imzalanır.
 *
 * @param {object} p
 * @param {object} p.kok  kokUretVeyaYukle çıktısı
 * @param {string[]} p.dnsAdlari
 * @param {string[]} p.ipAdresleri
 */
function yaprakUret(kok, dnsAdlari, ipAdresleri) {
  const cift = anahtarUret();
  const spkiDer = cift.publicKey;
  const pub = spkiGovde(spkiDer);
  const cn = dnsAdlari[0] || 'localhost';
  const simdi = new Date();
  const tbs = SEQ(Buffer.concat([
    tlv(0xa0, INT(DER([0x02]))),
    seriNumara(),
    SEQ(Buffer.concat([OID(OID_SHA256_RSA), NULL()])),
    ad(kokAdi(kok), 'CinarkoySync'),
    SEQ(Buffer.concat([
      zaman(simdi.getUTCFullYear(), simdi.getUTCMonth() + 1, simdi.getUTCDate(), 0, 0, 0),
      zaman(yilEkle(simdi, 2).getUTCFullYear(), yilEkle(simdi, 2).getUTCMonth() + 1, yilEkle(simdi, 2).getUTCDate(), 0, 0, 0),
    ])),
    ad(cn, 'CinarkoySync'),
    spkiDer,
    tlv(0xa3, SEQ(Buffer.concat([
      temelKisitUzantisi(false),
      keyUsageUzantisi(['digitalSignature', 'keyEncipherment']),
      uzanti(OID_EXT_KEY_USAGE, false, SEQ(OID(OID_SERVER_AUTH))),
      sanUzantisi(dnsAdlari, ipAdresleri),
      konumKilidiUzantisi(pub.rsaPublicKey),
    ]))),
  ]));
  const kokOzel = crypto.createPrivateKey(kok.anahtarPem);
  const imza = crypto.createSign('RSA-SHA256').update(tbs).sign(kokOzel);
  const yaprakDer = SEQ(Buffer.concat([
    tbs,
    SEQ(Buffer.concat([OID(OID_SHA256_RSA), NULL()])),
    BITSTR(Buffer.concat([DER([0x00]), imza])),
  ]));
  return { anahtarPem: cift.privateKey, pemDer: DER(pemEtiketle(yaprakDer, 'CERTIFICATE'), 'utf8') };
}

function kokAdi(kok) {
  const c = new crypto.X509Certificate(kok.pemDer);
  const satir = c.subject.split('\n').find((l) => l.startsWith('CN='));
  return satir ? satir.slice(3) : 'CinarkoySync';
}

// ============================================================================
//  BAGIMSIZ DOGRULAMA
// ============================================================================
/**
 * Üretilen her şeyi Node'un KENDI ayrıştırıcısıyla sınar.
 *
 * Neden? Çünkü bu dosya elle yazılmış DER üretiyor. Doğrulamazsak "belki
 * çalışır" demiş oluruz — rehber bunu yasaklıyor. `X509Certificate` bizim
 * kodumuzdan BAĞIMSIZ bir doğrulayıcıdır; aynı hatayı bizimle paylaşmaz.
 */
function dogrula(kokPemDer, yaprakPemDer, dnsAdlari, ipAdresleri) {
  const hatalar = [];
  const kok = new crypto.X509Certificate(kokPemDer);
  const yaprak = new crypto.X509Certificate(yaprakPemDer);

  // 1) Her ikisi de ayrıştırılabildi mi? (yoksa tarayıcı da reddeder)
  if (!kokPemDer.length) hatalar.push('kök sertifikası boş');
  if (!yaprakPemDer.length) hatalar.push('yaprak sertifikası boş');

  // 2) Kök gerçekten CA mi?
  if (!kok.ca) hatalar.push('kök CA olarak işaretlenmemiş');

  // 3) Yaprak, kök tarafından imzalanmış mı? (asıl önemli kontrol)
  const kokPub = kok.publicKey;
  if (!yaprak.verify(kokPub)) hatalar.push('yaprak imzası kök anahtarıyla DOĞRULANMADI');

  // 4) Yaprak kendi kendine imzalı mı? (public/private eşleşmesi)
  const yaprakPub = new crypto.X509Certificate(yaprakPemDer).publicKey;

  // 5) SAN'lar gerçekten işaretli mi? (IP değişince burası bozulurdu)
  for (const d of dnsAdlari) {
    if (d.includes('*')) continue;
    if (yaprak.checkHost(d) !== d) hatalar.push(`yaprak "${d}" adresini kapsamıyor`);
  }
  for (const ip of ipAdresleri) {
    if (yaprak.checkIP(ip) !== ip) hatalar.push(`yaprak "${ip}" IP'sini kapsamıyor`);
  }

  // 6) Süreler makul mü?
  const simdi = Date.now();
  if (Date.parse(kok.validTo) < simdi) hatalar.push('kök sertifikasının süresi dolmuş');
  if (Date.parse(yaprak.validTo) < simdi) hatalar.push('yaprak sertifikasının süresi dolmuş');

  return {
    tamam: hatalar.length === 0,
    hatalar,
    parmakIzi: kok.fingerprint256,
    yaprakParmakIzi: yaprak.fingerprint256,
    kokGecerlilik: kok.validTo,
    yaprakGecerlilik: yaprak.validTo,
    konu: yaprak.subject,
  };
}

module.exports = {
  kokUretVeyaYukle,
  yaprakUret,
  dogrula,
  pemEtiketle,
  // iç test için
  _ipBayt: ipBayt,
  _derUzunluk: derUzunluk,
  _oidGovde: oidGovde,
};
