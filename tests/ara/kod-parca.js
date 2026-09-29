'use strict';
/**
 * ============================================================================
 *  KOD PARÇASI ÇIKARMA YARDIMCISI
 * ============================================================================
 *  ÖLÇÜLEN HATA — bu sınıf İKİ KEZ iki ayrı test dosyasında oldu:
 *
 *  1) tests/ara/yayin-config.js: parça, İÇİNDEKİ belirli bir satır bulunarak
 *     kesiliyordu ("return window.location.origin"). Gerçek bir hata
 *     düzeltmesiyle o satır kalkınca indexOf -1 döndü ve parça yanlış
 *     yerden kesildi → SyntaxError.
 *
 *  2) tests/ara/musteri-yayin.js: aynı kırılgan yöntem. Geri dönüş
 *     düzeltmesinden sonra `k.sunucuKoku is not a function` ile çöktü.
 *
 *  KÖK NEDEN: metin taraması bir satırın DEĞİŞMESİNE bağlı. Kaynak kod
 *  düzeltildiğinde test sessizce ya da gürültüyle kırılıyor. Test, üretim
 *  kodunun İÇERİĞİNE değil YAPISINA bağlı olmalıdır.
 *
 *  ÇÖZÜM: süslü parantez sayarak blok çıkar. Fonksiyonun adı yeterlidir;
 *  gövdesi ne olursa olsun doğru şekilde alınır.
 * ============================================================================
 */

/**
 * Verilen metinde `baslangic` ile başlayan fonksiyon bloğunu çıkarır.
 * @param {string} kaynak tam kaynak kod
 * @param {string} baslangic örn. 'function sunucuKoku'
 * @returns {string|null} blok metni, bulunamazsa null
 */
function blokCikar(kaynak, baslangic) {
  const i = kaynak.indexOf(baslangic);
  if (i < 0) return null;

  // ÖLÇÜM BETİĞİ HATASI DÜZELTMESİ: önceki sürüm yalnızca { ve } sayıyordu.
  // Bu, STRING içindeki süslü parantezleri de sayıyordu. Örnek:
  //     if (s.charAt(0) === '{') {
  // Fonksiyon yarıda kesiliyordu. Artık tek tırnak, çift tırnak, şablon
  // ve her iki yorum biçimi de atlanır; kaçış karakterleri izlenir.
  let derinlik = 0, gordu = false;
  let tek = false, cift = false, sablon = false;
  for (let j = i; j < kaynak.length; j++) {
    const ch = kaynak[j];
    const sonraki = kaynak[j + 1];

    if (!tek && !cift && !sablon) {
      // yorumlar
      if (ch === '/' && sonraki === '/') {
        while (j < kaynak.length && kaynak[j] !== '\n') j++;
        continue;
      }
      if (ch === '/' && sonraki === '*') {
        j = kaynak.indexOf('*/', j + 2);
        if (j < 0) return null;
        j++;                       // kapanışın '/'ini atla
        continue;
      }
      // kaçışlı karakter
      if (ch === '\\') { j++; continue; }
      if (ch === "'") { tek = true; continue; }
      if (ch === '"') { cift = true; continue; }
      if (ch === '`') { sablon = true; continue; }
      if (ch === '{') { derinlik++; gordu = true; }
      else if (ch === '}') {
        derinlik--;
        if (gordu && derinlik === 0) return kaynak.slice(i, j + 1);
      }
      continue;
    }

    // string/şablon içindeyken
    if (ch === '\\') { j++; continue; }        // kaçışlı karakter
    if (tek && ch === "'") { tek = false; continue; }
    if (cift && ch === '"') { cift = false; continue; }
    if (sablon && ch === '`') { sablon = false; continue; }
  }
  return null;
}

/**
 * Uygulamanın yayın yapılandırması + sunucu kökü çözümleyicisini çıkarır.
 * Bunlar birlikte çalıştırılmalıdır: CK_YAPILANDIRMA beyanı olmadan
 * sunucuKoku() "not defined" verir (ölçülen ilk hata).
 * @returns {string} çalıştırılabilir kod parçası
 */
function yapilandirmaVeKok(kod) {
  const bas = kod.indexOf('var CK_YAPILANDIRMA');
  // ÖLÇÜM BETİĞİ HATASI DÜZELTMESİ: burada `kok.indexOf` yazılmıştı.
  // `kok` zaten BLOĞUN KENDİSİ olduğu için `.indexOf` her zaman 0 döner ve
  // parça, `var CK_YAPILANDIRMA` ile fonksiyon arasını YUTAR:
  //   ReferenceError: CK_YAPILANDIRMA is not defined
  // Doğrusu: konumu kaynak kodda aramak.
  const kokBas = kod.indexOf('function sunucuKoku');
  if (bas < 0 || kokBas < 0) return null;
  const kok = blokCikar(kod, 'function sunucuKoku');
  if (!kok) return null;
  return kod.slice(bas, kokBas) + kok;
}

module.exports = { blokCikar, yapilandirmaVeKok };
