/**
 * ============================================================================
 *  ÇINARKÖY YEREL API ANAHTARI — TEK DOĞRULUK KAYNAĞI
 * ============================================================================
 *  Bu dosya anahtarın KANONİK kopyasıdır. İki yerde geçer:
 *    1) Sunucu: companion/companion.js  (require ile okur)
 *    2) Telefon: phone/guvenlik-sync.js (tarayıcıda çalışır, require yok —
 *       dönüştürücü bu değeri satır içine gömer)
 *
 *  Bu iki kopyanın AYNI olduğu `tests/test-anahtar.js` ile ölçülür. Yani
 *  "iki yerde ayrı ayrı yazıp birini unutma" riski yok.
 *
 *  NASIL ÇALIŞIR (ölçülen akış):
 *    Telefon  ──POST /plaka/oku──▶  Sunucu
 *      Authorization: <bu anahtar>        │
 *      X-Sync-Token: <kurulum anahtarı>   ▼
 *                                   1) anahtar doğru mu?  → değilse 401
 *                                   2) fotoğraf YEREL OCR motoruna
 *                                      (fast-plate-ocr, internet yok)
 *                                   3) sonuç Excel'e yazılır, telefona döner
 *
 *  NEDEN İKİ ANAHTAR VAR?
 *   - `Authorization`  : gömülü anahtar. Uygulamanın her yerde çalışmasını
 *                        sağlar (kurulum/taşıma farkı olmaz).
 *   - `X-Sync-Token`   : bilgisayarın kendi ürettiği 64 haneli kurulum
 *                        anahtarı. Sadece bu bilgisayarda durur, kurulum
 *                        başına değişebilir.
 *  Sunucu ikisini de kabul eder; böylece mevcut çalışan sistem bozulmaz.
 *
 *  ÖLÇÜLEN GERÇEK (bunu gizlemiyoruz):
 *  Tarayıcıda çalışan bir anahtar gizli olamaz — sayfa onu sunucuya
 *  göndermek zorundadır ve "Sayfayı görüntüle" ile okunabilir. Bu yüzden bu
 *  anahtar KİŞİSEL VERİYİ korur (aynı Wi-Fi'taki misafire karşı), ancak
 *  anahtarın kendisini internete karşı gizli tutmaz. Bu, tarayıcı
 *  mimarisinin değiştiremediğimiz bir kuralıdır.
 *
 *  DEĞİŞTİRMEK İÇİN: aşağıdaki değeri değiştirin, sonra
 *  `node tools/security-st-esle.js` çalıştırın ve `npm test` koşun.
 */
'use strict';

const ANAHTAR = 'ck_yk_8f2a1c47b93d5e60a1f7c4b8d29e6035';

/** Anahtarı düz metin olarak döndürür (başlıkta kullanılır). */
function deger() {
  return ANAHTAR;
}

module.exports = {
  ANAHTAR,
  deger,
  // Başlık adı: standart Authorization. Değer "Bearer <anahtar>" ya da
  // düz anahtar olarak kabul edilir (kullanıcının önerisi düz anahtardı).
  baslikAdi: 'Authorization',
  baslikDegeri() {
    return 'Bearer ' + ANAHTAR;
  },
};
