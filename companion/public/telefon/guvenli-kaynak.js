/**
 * ============================================================================
 *  GÜVENLİ KAYNAK TESPİTİ — ARAYÜZ YOK
 * ============================================================================
 *  BU DOSYA ÖNCE MAVİ BİR BANT GÖSTERİYORDU. KALDIRILDI.
 *
 *  ÖLÇÜLEN HATA (kullanıcı bildirimi, 29.09.2026): ekran görüntüsünde
 *  sayfanın altındaki mavi şerit:
 *    "Kamera, telefonun kendi kamerasıyla çekilir — her plaka için bir kez
 *     dokunmanız yeterli. Güvenli adres (https) yalnızca uygulama içinde
 *     canlı önizleme ekranı içindir; gerekli değildir."
 *  Kullanıcının isteği: "şu mavi yazıyı kaldır, navigasyonu kapatıyor,
 *  ona gerek yok."
 *
 *  Haklı: bant `position:fixed; bottom:0` ile ekranın altına yapışıyordu ve
 *  alt gezinme çubuğunun (Bağlantı yok / Plan / Plaka / Kayıt / Ayarlar)
 *  ÜSTÜNE biniyordu. Kullanıcı sekmelere basamıyordu.
 *
 *  ÖNCEKİ KARARIN GÜÇLÜ YANLARI (silinmiyor, çünkü doğruydu):
 *   - Sertifika indirme, profil kurma, "tam güven" istemiyoruz.
 *   - Düz http'de canlı önizleme olmaz ama plaka okuma ÇALIŞIR
 *     (telefonun kendi kamerası, capture="environment").
 *   Bu yüzden bilgilendirmeye ihtiyaç yok: kullanıcı hiçbir şey yapmıyor.
 *  Bu bilgi artık AYARLAR ekranındaki "Telefonun kamerası" satırında
 *  duruyor; oraya gitmek isteyen oraya gider, her açılışta değil.
 *
 *  Burada kalan: güvenli kaynak TESPİTİ. Başka kod bunu kullanabilir
 *  (ör. sürekli mod yalnızca güvenli kaynakta çalışır). Tespit doğru
 *  çalışmaya devam eder; yalnızca ekrana bir şey basılmaz.
 * ============================================================================
 */
(function () {
  'use strict';

  var CKGuvenliKaynak = {
    guvenli: null,          // null = henüz bilinmiyor
    // notGosterildi alanı kaldırıldı: artık hiçbir arayüz gösterilmiyor.
    // Alanı silmek yerine bırakıyoruz ki olası eski okuyucular hata almasın.
    notGosterildi: true,
  };
  window.CKGuvenliKaynak = CKGuvenliKaynak;

  /**
   * Sayfa güvenli kaynakta mı? (canlı önizleme için gerekir)
   * Plaka okuma için GEREKMEZ — telefonun kendi kamerası yeterlidir.
   */
  function guvenliMi() {
    if (typeof window.isSecureContext === 'boolean') return window.isSecureContext;
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /**
   * ÖLÇÜLEN DÜZELTME: burada bir <div> oluşturulup sayfaya ekleniyordu.
   * Kullanıcı şerbi altındaki sekmelere basamadı. Artık hiçbir arayüz
   * öğesi oluşturulmaz. Fonksiyon adı korunuyor ki olası çağıranlar
   * sessizce "gösterdim" sanmasın diye... hayır: burası BİLEREK boş bir
   * fonksiyondur ve nedenini yazdım.
   */
  function notGoster() {
    // BİLEREK BOŞ — mavi bant kaldırıldı (29.09.2026, kullanıcı isteği).
    // Gerekçe yukarıda. Ekrana hiçbir öğye basılmaz.
  }

  function baslat() {
    CKGuvenliKaynak.guvenli = guvenliMi();
    // Ölçüm: burada hiçbir arayüz öğesi oluşturulmuyor.
    if (!CKGuvenliKaynak.guvenli) notGoster();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', baslat);
  } else {
    baslat();
  }
})();
