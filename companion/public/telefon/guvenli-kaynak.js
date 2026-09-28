/**
 * ============================================================================
 *  GÜVENLİ KAYNAK NOTU — eylem İSTEMEYEN bilgilendirme
 * ============================================================================
 *
 *  ÖLÇÜLEN HATA (kullanıcı bildirimi, ÜRÜN KARARINI DEĞİŞTİRDİ):
 *  "Telefona sertifika indirmek ile olacak iş değil, bu çok saçma ve kötü bir
 *   yöntem, müşterilerimizi uğraştırmamamız gerekiyor."
 *
 *  Önceki sürümün hatasi tam olarak buydu: kullanıcıdan sertifika indirmesini,
 *  profili kurmasını ve ayarlardan "tam güven" vermesini istiyordu. Yani güvenlik
 *  nöbetçisinden sertifika yönetimi bekliyordu. Bu kabul edilemez.
 *
 *  Şimdi ne oluyor:
 *  - Düz http adresinde canlı önizleme olmaz (tarayıcı güvenlik kuralı).
 *  - AMA plaka okuma ÇALIŞIR: telefonun kendi kamerası (capture="environment")
 *    güvenli kaynak istemez. Bkz. yerel-kamera.js.
 *  - Dolayısıyla kullanıcının YAPMASI GEREKEN HİÇBİR ŞEY YOKTUR.
 *
 *  Bu dosya artık yalnızca kısa ve sakin bir bilgi gösterir. Sertifika
 *  indirme bağlantısı, "yapmanız gerekir" dili, uyarı rengi — hepsi kaldırıldı.
 *  Bir kontrol (anahtar/sertifika) kullanıcıya gösterilmez.
 * ============================================================================
 */
(function () {
  'use strict';

  var CKGuvenliKaynak = {
    guvenli: null,        // null = henüz bilinmiyor
    notGosterildi: false,
  };
  window.CKGuvenliKaynak = CKGuvenliKaynak;

  function guvenliMi() {
    if (typeof window.isSecureContext === 'boolean') return window.isSecureContext;
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function notGoster() {
    if (CKGuvenliKaynak.notGosterildi) return;
    CKGuvenliKaynak.notGosterildi = true;

    var el = document.getElementById('ck-kaynak-notu');
    if (el) return;
    el = document.createElement('div');
    el.id = 'ck-kaynak-notu';
    // Satır içi stil: uygulamanın CSS'i yüklenmemiş olsa da görünür.
    // Bilgi tonu (uyarı değil): çünkü çalışma ETKİLENMİYOR.
    el.setAttribute('style', [
      'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:2147482000',
      'background:#123a5e', 'color:#eaf3ff', 'padding:9px 14px',
      'font:13px/1.5 system-ui,-apple-system,Segoe UI,sans-serif',
      'box-shadow:0 -2px 10px rgba(0,0,0,.25)'
    ].join(';'));
    el.innerHTML = 'Kamera, telefonun kendi kamerasıyla çekilir — '
      + 'her plaka için bir kez dokunmanız yeterli. '
      + 'Güvenli adres (https) yalnızca uygulama içinde <b>canlı önizleme</b> '
      + 'ekranı içindir; <b>gerekli değildir</b>.';

    if (document.body) document.body.appendChild(el);
  }

  function baslat() {
    CKGuvenliKaynak.guvenli = guvenliMi();
    if (!CKGuvenliKaynak.guvenli) notGoster();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', baslat);
  } else {
    baslat();
  }
})();
