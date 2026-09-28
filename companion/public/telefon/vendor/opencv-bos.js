/* ============================================================================
 *  vendor/opencv-bos.js — bilinçli olarak BOŞ dosya
 * ----------------------------------------------------------------------------
 *  Uygulama, plaka okumadan ÖNCE kamerayı hazırlamak için isteğe bağlı olarak
 *  OpenCV.js yüklemeye çalışır. Bu dosya o yüklemeyi karşılar.
 *
 *  Neden boş bir dosya, neden 404 değil?
 *    404 (bulunamadı) durumunda tarayıcı konsola kırmızı bir ağ hatası basar
 *    ve uygulama "OpenCV yüklenemedi" diye özel bir hata daha üretir. Nöbetçi
 *    konsola baktığında sistemin bozuk olduğunu sanır — oysa hiçbir şey
 *    bozuk değildir, sadece bu isteğe bağlı hızlandırma kullanılmıyor.
 *
 *    Bu dosya yüklendiğinde `window.cv` tanımsız kalır; uygulamanın
 *    `ensureOpenCV()` fonksiyonu `CV_READY = false` deyip kendi basit ön
 *    işleme yedeğine düşer. Konsol temiz kalır, davranış tutarlıdır.
 *
 *  Asıl plaka okuma bilgisayardaki companion servisinde yapılır
 *  (bkz. companion/ocr/), dolayısıyla burada işlev kaybı yoktur.
 * ==========================================================================*/
// Bilerek boş. Gerekçe yukarıda.
