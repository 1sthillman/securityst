/**
 * ============================================================================
 *  YAYIN YAPILANDIRMASI
 * ============================================================================
 *  Bu dosya uygulamanın hangi bilgisayara bağlanacağını ve hangi anahtarı
 *  kullanacağını söyler.
 *
 *  İKİ KULLANIM YERİ:
 *
 *  1) LAN kurulumu (normal) — bu dosya BOŞTUR.
 *     Uygulama, companion servisinin kendisinden sunulur
 *     (http://192.168.x.x:4545/telefon/). Bu durumda `location.origin` zaten
 *     doğru adrestir; yapılandırmaya gerek yoktur. Müşteri hiçbir şey yapmaz.
 *
 *  2) İnternetten yayın (GitHub Pages / Vercel) — bu dosya DOLDURULUR.
 *     Uygulama GitHub'dan açılınca `location.origin` GitHub adresi olur ve
 *     müşterinin bilgisayarına ulaşamaz. Bu yüzden adres buraya yazılır.
 *     Ölçülen hata: bu olmadan uygulama hiç çalışmıyordu.
 *
 *  KURULUM ÖNCESİ DOLDURMA (müşteriye hiçbir iş düşmemesi için):
 *    SUNUCU_ADRESI : müşterinin bilgisayarındaki companion adresi
 *                    ör.  http://192.168.1.42:4545
 *                    (panelde "Telefonda şu adresi açın" yazan adres)
 *    API_ANAHTARI   : aynı anahtar. Boş bırakılırsa gömülü anahtar kullanılır.
 *
 *  NOT (dürüst uyarı): tarayıcıda çalışan bir anahtar gizli olamaz — sayfa onu
 *  sunucuya göndermek zorundadır. Bu anahtar KİŞİSEL VERİYİ korur (aynı
 *  Wi-Fi'taki misafire karşı). Anahtarın kendisini internete karşı gizli
 *  tutmak tarayıcıda mümkün değildir. Gerçek koruma sırası:
 *    (1) ağ — sunucu internete açılmaz, sadece Wi-Fi'dan erişilir.
 *    (2) anahtar — istekler doğrulanır.
 *    (3) eşleşme izin listesi — yalnızca tanımlı cihazlar anahtar alır.
 */
window.CK_YAPILANDIRMA = {
  // LAN kurulumunda boş bırakılır.
  SUNUCU_ADRESI: '',

  // Boş bırakılırsa gömülü anahtar (senkron.js) kullanılır.
  API_ANAHTARI: '',
};
