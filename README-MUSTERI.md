# SECURITY-ST — Müşteri Kurulumu (GitHub)

Bu sayfa **müşteriye verilen** kısımdır. 3 adım. Komut yazılmaz.

---

## 1. Bu bilgisayarda sunucuyu çalıştırın

Kurulum dosyasını çalıştırın. Kurulum bittikten sonra sunucu kendiliğinden
başlar ve arka planda çalışır.

Sunucunun adresi panelde yazar. **Bu adresi not alın** — 2. adımda gireceksiniz.

## 2. Eşleşme sayfasından anahtarı alın

Sunucunun kendi panelinde **eşleşme** sayfası vardır. Bu sayfada şunlar yazar:

- **Sunucu adresi** — örnek `http://192.168.1.42:4545`
- **Kurulum anahtarı** — 64 haneli uzun bir yazı

Bu ikisini kopyalayın. Anahtar, bu bilgisayarın kimliğidir: başka bir
bilgisayarın sunucusuna girmez.

## 3. GitHub'e koyun

1. Depoyu **kendi GitHub hesabınıza** alın (fork veya kopyalama).
2. Depoda şuraya gidin:
   **Settings → Secrets and variables → Actions → New repository secret**
3. Şu iki anahtarı ekleyin:

   | Name | Value |
   |------|-------|
   | `CK_SUNUCU_ADRESI` | 1. adımdaki adres, ör. `http://192.168.1.42:4545` |
   | `CK_KURULUM_ANAHTARI` | 2. adımdaki 64 haneli anahtar |

4. **Actions** sekmesine gidin, **GitHub Pages** akışını bulun,
   **Run workflow** deyin.
5. Birkaç dakika sonra uygulama yayınlanır. Adres Actions çıktısında yazar.

Telefonu aynı Wi-Fi'a bağlayıp yayınlanan adresi açın — uygulama **kendi
sunucunuza** bağlanır. Adresi veya anahtarı telefonunuzda hiçbir yere
girmeniz gerekmez.

---

## Sık sorulanlar

**Yayınlanan sayfada anahtar görünüyor mu?**
Evet, düz metin olarak. Bu gizlenemez: tarayıcıdaki uygulama anahtarı
sunucuya göndermek zorundadır. Ama anahtar artık **sizin** — kendi
deponuzda, kendi sunucunuz için. Başka bir müşterinin anahtarı sizin
sunucunuza giremez.

**Sunucu internete açık mı?**
Hayır. Yalnızca kendi Wi-Fi ağınızdan erişilebilir. Dışarıdan biri
adresinizi yazsa bile ulaşamaz.

**Anahtarı değiştirdim, telefon bağlanmıyor.**
Eşleşme sayfasından **yeni** anahtarı alıp GitHub'da secret'ı güncelleyin ve
akışı yeniden çalıştırın.

**Uygulama açılıyor ama kayıtlar gelmiyor.**
Sunucunun çalıştığından ve telefonun **aynı Wi-Fi'da** olduğundan emin olun.
Panel açılıyorsa sunucu çalışıyor demektir.

**Sunucu adresim değişirse?**
Bilgisayarınızın IP'si değişirse adres de değişir. Yeni adresi eşleşme
sayfasından alıp GitHub'daki `CK_SUNUCU_ADRESI` secret'ını güncelleyin ve
akışı yeniden çalıştırın. Verileriniz kaybolmaz; yalnızca adres yenilenir.

**Verilerim nerede?**
Sunucu bilgisayarınızdadır. İnternetde, GitHub'da, bizim sunucumuzda
**hiçbir yerde** tutulmaz. Fotoğraflar bile cihazdan çıkmaz.
