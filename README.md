# Telefon → Bilgisayar Otomatik Excel Senkronizasyonu

Kopmaya, çökmeye ve elektrik kesintisine dayanıklı, kendi kendini onaran kayıt hattı.
Mimari: **telefon kuyruğu (IndexedDB) + companion servis (Node.js) + append-only log → Excel**.
`1sthillman/g-venlik` (Çınarköy Nöbet) uygulamasının gerçek veri modeliyle birebir uyumludur.

```
g-venlik (telefon tarayıcısı) --POST /kayit--> Companion --> data/kayitlar.jsonl --> kayitlar.xlsx
   ├─ senkron.js: dbPut sarma + ayrı IDB kuyruk (ck_nobet_sync)
   │  + retry 15sn→2dk, online/visible/manuel tetik, rozet + ayar penceresi
   │  + OTOMATİK EŞLEŞME: uygulama aynı sunucudan yayınlandığı için adres ve
   │    anahtar hiç sorulmaz (QR, IP değişikliği, HTTPS karışıklığı yok)
   └─ plaka-yerel.js: kamera karesi --POST /plaka/oku--> Tesseract WASM (çevrimdışı)
      + kare zaten kırpılmış gelir; sunucuda kırpma/kontrast/eşik/büyütme
      + kademeli zorlama: 1 geçiş yeterliyse anında döner (~1 sn)
      + kendini onaran karakter düzeltme + yapı/geçerlilik puanlaması
```

## 🔑 API anahtarı ve yayın (Vercel / GitHub Pages)

### Nasıl çalışıyor

Uygulama isterseniz **internete** (Vercel veya GitHub Pages) yayınlanabilir;
veri sunucusu ise **kulübedeki bilgisayarda** çalışmaya devam eder.
Telefon uygulaması her istekte API anahtarını `Authorization` başlığında
gönderir, sunucu doğrular:

```
Telefon  ──POST /plaka/oku──▶  Sunucu (bilgisayarınızda)
  Authorization: Bearer <anahtar>      │
  X-Sync-Token: <kurulum anahtarı>    ▼
                                 1) anahtar doğru mu? → değilse 401
                                 2) fotoğraf YEREL OCR motoruna (internet YOK)
                                 3) sonuç Excel'e yazılır, telefona döner
```

### Anahtarı değiştirmek / yönetmek

| Nerede | Ne yapılır |
|---|---|
| Kanonik kopya | `shared/anahtar.js` |
| Telefon uygulaması | `phone/guvenlik-sync.js` (aynı değer) |
| Sunucu | `CK_ANAHTAR` ortam değişkeni (verilirse gömülüyü **ezer**) |

İki kopyanın aynı olduğu `tests/test-anahtar.js` ile **ölçülür**. Yani
"birini güncelledim diğerini unuttum" riski yoktur.

**Vercel'e yayınlarken** anahtarı Vercel ortam değişkenlerine koyun:

| Değişken | Değer |
|---|---|
| `CK_ANAHTAR` | `shared/anahtar.js` içindeki değer |

> **Dürüst uyarı (ölçülmüş gerçek):** Tarayıcıda çalışan bir anahtar
> gizli **olamaz** — sayfa onu sunucuya göndermek zorundadır ve "Sayfayı
> görüntüle" ile okunabilir. GitHub Secrets yalnızca CI için gizlidir;
> istemci tarafında çalışan kodda hiçbir şey gizlenemez. Bu anahtar
> **kişisel veriyi** korur (aynı Wi-Fi'taki misafire karşı), anahtarın
> kendisini internete karşı gizli tutamaz.
>
> Gerçek koruma sırası: **(1) ağ** — sunucu internete açılmaz, sadece
> Wi-Fi'dan erişilir; **(2) anahtar** — istekler doğrulanır; **(3) eşleşme
> izin listesi** — yalnızca tanımlı cihazlar anahtar alır.

### Vercel / GitHub yayını için gerekli ayarlar

Uygulama internette çalışınca tarayıcının kaynağı sizin adresiniz olmaz.
Sunucu bunu **AÇIKÇA bildirilmiş kaynaklar** ile kabul eder:

```bat
set CK_EZIKIN_KAYNAKLAR=https://projeniz.vercel.app,https://site.github.io
```

Bu değer **boş bırakılırsa** sunucu yalnızca kendi adreslerini kabul eder
(güvenli varsayılan). Panelde `CK_PANEL_UZAK=1` ile panel uzaktan açılabilir
hâle getirilirse panelde uyarı görünür.

### İstemciler anahtarı göndermeli (KRİTİK KURAL)

Bu sınıf hata **üç kez** oldu ve her seferinde **sessizdi**:

| Nerede | Belirti |
|---|---|
| `plaka-yerel.js` | telefon "motor yok: Yetkisiz" diyordu |
| `core.js` + paneller | panel boş kalıyordu, kayıtlar görünmüyordu |
| `senkron.js` (`httpsYokla`) | uygulama https'e otomatik geçemiyordu |

Hepsi aynı sebep: sunucuyu anahtarla korudum, **onu kullanan istemcileri
güncellemedim**. Konsolda yalnızca `401` görünüyordu; asıl sebep o sırada
gizliydi.

Bu yüzden kalıcı koruma eklendi: `tests/test-istemci-kimlik.js` her istemci
dosyasındaki **her** veri ucu çağrısının kimlik gönderdiğini denetler
(hem kaynak hem üretilmiş çıktı). Testin işe yaradığı **negatif kontrolle**
kanıtlandı: bir çağrıdan başlığı kaldırınca test kırmızıya dönüyor.

**Kural:** bir uç `requireToken` ile korunduğunda, o ucu çağıran **her**
istemci aynı komutu güncellenmeden iş bitmiş sayılmaz.

### CORS ve çapraz kökenli geçiş

Uygulama http'den açılıp https'e geçerken tarayıcı **ön kontrol** (preflight)
gönderir. Ölçülen hata: `Access-Control-Allow-Headers` listesinde
`Authorization` yoktu; bu yüzden çapraz kökenli istekte tarayıcı anahtarı
gönderemiyor ve sunucu 401 dönüyordu. Kimlik başlıkları AÇIKÇA listelenir:

`Content-Type, Authorization, X-Sync-Token, X-Sync-Cihaz, Accept, Cache-Control`

### Canlı akış (SSE) ve kimlik

Tarayıcıdaki `EventSource` **özel başlık gönderemez** (spesifikasyon kısıtı).
Bu yüzden canlı akış kimliği sorgu parametresiyle taşır: `/olay?k=<anahtar>`.

> Ölçülen hata: akışı doğrudan kapatmıştım. Test "bir EventSource açıyor"
> diye kırıldı ve **haklıydı** — güvenliği kapatmak özelliği öldürmek
> değildir. Doğrusu kimliği taşınabilir kılmaktı.

### Sunucu tarafında ölçülen güvenlik

| Ölçüm | Sonuç |
|---|---|
| `/kayitlar`, `/durum`, `/olay`, `/plaka/durum` anahtarsız | **401** (kapatıldı) |
| `/kayit`, `/kayit/batch`, `/plaka/oku` anahtarsız | **401** |
| Yanlış anahtar | **401** |
| Yabancı site `Origin` başlığı | **yazılmıyor** (CORS kapalı) |
| Panel sayfaları uzaktan | **403** (bu bilgisayara sınırlı) |
| Eşleşme izni | ilk cihaz kaydolur, yenisi onay bekler |
| Kök CA dosyası | DER (iOS/Android kurulumu için) |

Bu ölçümler `tests/test-guvenlik.js` ve `tests/test-anahtar.js` ile her
`npm test` koşusunda yeniden doğrulanır.

## 📷 Kamera: sertifika GEREKMEZ

> **Ölçülen hata (kullanıcı):** "Telefondan girince https adresinden olmalıdır
> yoksa kameraya izin vermiyor." Doğru tespit, ama **çözümü yanlış bulduk**.
> Tarayıcı kamerayı iki yoldan açar:
>
> | yol | güvenli kaynak şartı |
> |---|---|
> | `getUserMedia()` — uygulama içinde canlı önizleme | **gerekir** (yalnızca https) |
> | `<input type="file" capture="environment">` — telefonun kendi kamerası | **gerekmez** |
>
> İkinci yol düz bir form öğesidir ve **http üzerinde de çalışır**. Yani
> plaka okuma için sertifikaya, https adresine, profil kurmaya **gerek yok**.

Bu yüzden companion iki yüzle çalışır:

| | |
|---|---|
| `http://BILGISAYAR-IP:4545` | panel, kayıt, senkronizasyon (her şey çalışır) |
| `https://BILGISAYAR-IP:4546` | **telefon uygulaması — kameranın çalıştığı yer** |

### Hangi adresi kullanacağınız? (ölçülmüş cevap)

**Telefonda IP adresini kullanın.** Panel de tam olarak onu gösterir ve
QR'a o yazılır.

Neden isim değil? Çünkü ölçtük:

| adres | ölçüm | sonuç |
|---|---|---|
| `cinarkoy-sync.local` | çözümlenmedi (kimse mDNS yayınlamıyor) | **AÇILMAZ** |
| `BILGISAYAR` (NetBIOS) | yalnızca `fe80::…` IPv6 link-local’a gitti | telefonda **işe yaramaz** |
| **`192.168.1.235`** (varsayılan rota) | gerçek Wi-Fi arayüzü | **AÇILIR** |

Sistem, hangi IP'nin doğru olduğunu **tahmin etmez**: Windows'ın rota
tablosundan (`route print -4`) varsayılan rota hangi arayüzden gidiyorsa o
arayüzün IP'sini alır. Bu sayede sanal bağdaştırıcı adresleri (ör. VMware /
Hyper-V) elenir — onları sıraya koymak, listede erişilemeyen adresleri öne
taşıyordu.

IP değişirse ne olur? Yaprak sertifika otomatik yenilenir (kök sabit kalır),
panel her açılışta güncel adresi gösterir. **Sizin hiçbir şey yapmanız gerekmez.**

### Normal akış — hiçbir ayar gerekmez

1. Telefonu bilgisayarla **aynı Wi-Fi'a** bağlayın.
2. Paneldeki **http** adresini telefonda açın (`http://192.168.x.x:4545/telefon/`).
   Uyarı sayfası çıkmaz, sertifika gerekmez.
3. Uygulamada **kamera** düğmesine basın → **telefonun kendi kamerası** açılır.
4. Plakayı çekin → okuma yapılır → sonuç ekranda.

Her plaka için **bir dokunuş**. Nöbetçi sertifika yönetmez, ayar yapmaz.

### Panelde nerede bulacaksınız?

Bilgisayarda **panel → Eşleşme** sayfasını açın. Üstteki sarı kutuda:

- **Telefonda şu adresi açın** — kopyalanabilir adres ve **Aç** düğmesi
- **Kamera açılabilir / Kapalı** rozeti (sertifika doğrulandıysa "açılabilir")
- **Telefona sertifikayı indir** düğmesi
- Adresin altında **"Diğer adresler"** — çalışmazsa sıradakini deneyin

### Peki https ne işe yarıyor? (isteğe bağlı)

Yalnızca kamerayı **uygulama ekranı içinde, hareketli** görmek isterseniz.
O zaman https adresini açarsınız; tarayıcı bir uyarı verir:
**Gelişlik → Devam et**.

iPhone'da ek bir adım gerekir (sertifikayı indir → profil kur → tam güven).
**Bu adımı atlamak tamamen mümkündür** — normal akışta hiçbir şey kurmanıza
gerek yok.

Telefonun işletim sistemi bilgisayarı tanımıyor. Tarayıcı bu yüzden
"sertifika hatası" uyarısı verir ve **kamerayı açmaz**. Çözüm: bilgisayarın
ürettiği yerel kök sertifikayı telefona kurmak. **Bu bir kere yapılır** —
bilgisayarın IP'si değişse, ağ değişse, uygulama güncellense bile geçerli
kalır (sertifika kökü sabittir).

**iPhone (iOS):**
1. Uyarı çıkan sayfada **"sertifikayı indir"** bağlantısına dokun
2. **Ayarlar › Genel › VPN ve Cihaz Yönetimi** → profili **Kur**
3. **Ayarlar › Genel › Hakkında › Sertifika Güven Ayarları** →
   Çınarköy satırındaki anahtarı **tam güven** yapın

**Android (Chrome):** tarayıcı uyarıyı gösterdiğinde **Gelişmiş → Devam et**
deyin. Ek bir ayar gerekmez. (Android 7+ "Uygulama yükleme" ekranı
gösterebilir; orada da **Devam et / Kur** deyin.)

**Bilgisayarda hiçbir şey yapmazsınız.** Panel `http` üzerinden çalışır ve
sertifikaya ihtiyacı yoktur; sertifika gereken tek yer **telefonun kamerasıdır**.
Bilgisayarın Windows güven deposuna **hiçbir şey yazılmaz**.

> **Neden bilgisayara da kurmuyoruz?** Ölçüldü: `certutil -addstore` her
> çalıştırıldığında "yüklemek istiyor musunuz?" penceresi açıyor ve kullanıcı
> bunu "sürekli geliyor, Evet'e basıyorum, yine geliyor" diye bildirdi. Sistem
> kullanıcıyı rahatsız etmemeli; ayrıca bir kök sertifikayı Windows'un güvenli
> listesine eklemek kullanıcının istemediği ağır bir işlemdir. Bu yüzden
> **bilinçli olarak yapılmıyor.** Zorunluysa `CK_KOK_GUVENME=1` ile geri açılır.

### Uyarı çıkmazsa, kamera yine açılmıyorsa

Uygulamanın üstünde kırmızı bir şerit belirir ve **açılması gereken tam
adresi** yazar. Belirsiz bir "Kamera erişimi yok" hatası göstermek yerine
sebebini ve tek seferlik çözümünü söyler. Şerit yalnızca sorun varken
çıkar; `https` altında hiçbir şey görünmez.

### Sertifika nasıl üretiliyor?

`openssl` Windows'ta yoktur ve kullanıcı "kurulum gerektirmesin" dediği için
dış araç şart değildir. `companion/net/sertifika.js` saf Node ile X.509
yazar. Üretilen her sertifika, **Node'un kendi ayrıştırıcısıyla**
(`crypto.X509Certificate`) ve Windows'un `certutil` aracıyla doğrulanır;
doğrulanamazsa HTTPS **açılmaz** (kamerasız çalışmak, kamerasız ama "güvenli
görünen" bir sistemden iyidir).

| | |
|---|---|
| Kök CA (kok-ca.pem) | bir kez üretilir, 10 yıl geçerli, **sabit** |
| Yaprak (sunucu.pem) | IP/DNS değişince yenilenir, 2 yıl geçerli |
| IP değişince | yalnızca yaprak yenilenir → **telefonda hiçbir işlem gerekmez** |
| Özel anahtar | `data/` klasöründe, **asla paketlenmez** (her kurulum kendi kökünü üretir) |

Sertifika üretimi **bağımsız doğrulayıcılarla** sınanır:

- `node tests/ara/sertifika-dogrula.js` → Node'un kendi `X509Certificate`
  ayrıştırıcısı + Windows `certutil`. Ayrıca **yanlış girdide hata bulmayı** da
  sınar (yanlış DNS/IP, başka kök, bozuk PEM → hepsi reddedilir).
- `node tests/ara/qr-dogrula.js` → üretilen QR, **OpenCV ile ÇÖZÜLÜP** orijinal
  metinle karşılaştırılır. "Hata vermedi" doğruluk değildir; okunabiliyor olmalıdır.

Bu ikisi de `npm test` içinde çalışır (kural: bir doğrulayıcının **kendi**
kontrol testi yoksa "doğruluyorum" demek yanlıştır).

## ⭐ Her şey tek çatı altında: telefon uygulaması da sunucudan

Telefon uygulaması artık **GitHub Pages'ta değil, kulübe bilgisayarının kendi
servisinden** yayınlanır (`https://BILGISAYAR:4546/telefon/`). Bunun beş
kazanımı var:

1. **Eşleşme tamamen ortadan kalkar.** Uygulama ile veri aynı kaynaktan
   geldiği için adres `location.origin`, anahtar `/eslesme`'den alınır.
   Kullanıcı hiçbir şey yazmaz, hiçbir şey okutmaz.
2. **IP değişikliği sorun olmaktan çıkar.** Adres sabit bir IP değil,
   tarayıcının açtığı yerdir.
3. **HTTPS/HTTP karışık içerik sorunu biter.** Her şey aynı protokolde.
4. **Bulut bağımlılığı biter.** Excel, QR ve plaka motoru kütüphaneleri
   pakette gelir; uygulama internetsiz açılır.
5. **Plaka okuma bilgisayarda yapılır** → telefon ısınmaz, pil yemez, sonuç
   daha hızlıdır (~1 sn).

Kaynak `Security-ST/index.html` (553 KB, tek dosya). `tools/security-st-esle.js`
her paketlemede onu sunucu sürümüne dönüştürür ve **kendini doğrular**:
dönüştürme sonrası tek bir harici kaynak ya da API anahtarı kalırsa derleme
başarısız olur. Böylece "unutulmuş CDN" ya da "dosyaya sızmış anahtar"
türü hatalar üretime giremez.

## ⭐ Plaka okuma: tamamen yerel, internetsiz, anahtarsız

Daha önce plaka okuma üç ayrı bulut servisine (OCR.space, API Ninjas, Plate
Recognizer) gönderiliyordu. Üç sorun vardı: kulübede internet olmayınca
okuma duruyordu, nöbetçinin fotoğrafı üçüncü taraflara çıkıyordu ve API
anahtarları dosyanın içinde düz metin duruyordu.

Artık okuma **bilgisayarda, çevrimdışı** yapılıyor:

| Katman | Ne yapar |
|---|---|
| `ocr/gorsel.js` | Saf JS görüntü işleme: gri tonlama, bulanıklık, kontrast germe, Otsu, Sauvola, medyan, morfoloji, ölçekleme, kırpma, PNG/JPEG çözme, BMP kodlama |
| `ocr/bolge.js` | **Plaka bölgesi bulucu** — sahne içindeki plakayı bulur (aşağıda) |
| `ocr/plaka.js` | Tesseract WASM işçisi, kademeli zorlama planı, kuyruk, boşta-kapanma, kendini onaran karakter düzeltme, puanlama |
| `POST /plaka/oku` | Anahtar zorunlu uç; 8 MB gövde sınırı (kare base64 gönderilir) |
| `GET /plaka/durum` | Motor sağlığı **ve bölge bulucu durumu** (panel ve başlatıcı gösterir) |
| `GET /plaka/hazirla` | Motoru ısıtır; ilf deklanşöre basıldığında beklemez |

### Neden telefonun TAM karesi gönderiliyor

Uygulama, `shoot()` içinde kareyi kullanıcının kırpma dikdörtgenine göre
640px'e indiriyor. Ölçüldü ki bu **asıl hataydı**: plaka kırpma bandının
dışında kaldığında sunucu hiçbir şey bulamıyor ve nöbetçi boşuna bekliyordu.
Gerçek telefon çıktısı: `1280x720 kare → 640x101 kırpım → başarısız`.

Çözüm: **canlı kamera akışı varsa tam kare gönderilir.** Tam kare hem daha
yüksek çözünürlüktür (1280px) hem de hiçbir şeyi kesmez. Ölçülen kazanç:
iki aşamalı denemede 11.1 sn, tek istekte **0.52 sn**.

### Plaka bölgesi bulucu — olmadan hiçbir şey çalışmıyordu

Telefon bir **sahne** çeker: gökyüzü, yol, araç, gölge. İlk ölçümde
8 gerçekçi sahnenin **8'i de** başarısızdı. Üç ayrı hata üst üste biniyordu:

1. `metinVarMi()` Otsu'yu tüm sahneye uyguluyor, sahneyi (gökyüzü/zemin)
   bölüyor ve gerçek plakayı "metin yok" diye eliyordu.
   → Artık yalnızca gerçekten bozuk kareleri (kapalı kamera, tek renk,
   aşırı gürültü) eliyor; kararı OCR veriyor.
2. Plaka bölgesi hiç aranmıyordu.
   → `ocr/bolge.js`: bulanıklık → Sobel → yüzdelik eşiği → yatay kapama
   → bağlı bileşenler → geometri süzümü.
3. Gürültü, uyarlanabilir eşiği yükseltip küçük metni siliyordu.
   → Gradyandan **önce** bulanıklık uygulanıyor.

Bölge bulucu "plaka yok" demez, yalnızca aday listesi döndürür; kararı OCR
verir. Aşırı geniş lekeyi (plaka bir çizgiye kaynaşmışsa) plaka boyutlu
pencerelere böler ve **dikey geçiş enerjisiyle** sıralar — plaka olan pencere
en yüksek enerjiyi alır.

### Doğruluk katmanı

Tesseract saf WebAssembly'dir (Python/OpenCV/derleyici gerekmez, her
platformda aynı). Doğruluk eksikliği kendi onarma katmanımızla kapatılıyor:

- Konuma duyarlı karakter düzeltme (O↔0, I↔1, S↔5, Z↔2, G↔6, B↔8 …)
- Sondaki tekrar eden karakteri atma, gereksiz karakteri çıkarma
- Türk plaka yapısı: `2 rakam + 1-3 harf + 2-4 rakam`
- **İl kodu 01-81 aralığı kesin elenir** (B/8 karışıklığı "84" üretmesin)
- Q ve W harfleri elenir (TR plakasında kullanılmaz)
- Telefonun kayıtlı kurye listesiyle Levenshtein eşleştirme (tam eşleşme
  +30, tek karakter fark +14 puan)

### Kendini iyileştiren kararlar

- **Kademeli zorlama.** 24 geçişi her zaman koşmak 13 saniye sürüyordu; oysa
  ilk geçiş %96 güvenle doğruydu. Artık: 1 geçiş → yetersizse 4 → hâlâ
  yetersizse 24, üstüne zaman bütçesi ve "bütçenin %60'ı harcandıysa ve
  elimizde geçerli plaka varsa dur" kuralı. Tipik plaka ~0.4 sn.
- **Kırpma tahmin değil, ölçüm.** Küçük plakada kırpmak %96 güveni, büyük
  plakada kırpmamak gerekiyordu. Artık iki seçenek de denenir, motorun
  güven puanı kazananı seçer.
- **Metin boyutuna göre plan.** 26 pikselin altındaki metinde ikilileştirme
  (Otsu) belirleyici; ölçümde `normal` %85'te "34ARC123" derken `otsu` %93'te
  "34ABC123" diyordu. Küçük metinde plan buna göre başlar.
- **Umutsuz kare hızlı reddedilir.** Bölge bulunamazsa bütçe 3 saniyeye
  iner (ölçüm: 10.5 sn → 2.8 sn). Nöbetçi boşuna beklemez.
- **Piksel bütçesi.** Tam kare 3x büyütülünce Tesseract'ı çökertiyordu
  ("Too many properties to enumerate"); çıktı 2.2 megapiksel ve 2200 piksel
  ile sınırlı.

### Ölçülen sonuç (kurulu sürüm 1.4.0, gerçekçi sahne kareleri)

Motor: **fast-plate-ocr** (`cct_s_v2_global`, ONNX, çevrimdışı).

| Ölçüm | Tesseract (1.3.0) | fast-plate-ocr (1.4.0) |
|---|---|---|
| Ortalama okuma süresi | 780 ms | **~350 ms** |
| En kötü senaryo | 4,7 sn | **~1 sn** |
| Uzak araç (zorlu) | 8,0 sn | **0,9 sn** |
| Tam eşleşme (15 koşul) | 11/12 | **13/14** |
| Yanlış kabul (plakasız kare) | — | **0/3** |
| Karakter başına güven | yok | **var** (`minGuven`) |

Model karşılaştırması ölçülerek yapıldı (`node tests/benchmark-modeller.js`),
belgelenen değere güvenilmedi:

| Model | Tam eşleşme | Karakter | Yanlış-kabul | p50 |
|---|---|---|---|---|
| **cct_s_v2_global** | **13/15 (%86,7)** | %98,4 | **0/3** | 45 ms |
| cct_xs_v2_global | 10/15 (%66,7) | %92,6 | 0/3 | 8 ms |
| european_mobile_vit_v2 | 4/15 (%26,7) | %71,7 | 0/3 | 15 ms |

Depo, Avrupa modeli için "belgelenmiş ~%92,5" diyor; **ölçüm bunu doğrulamadı** —
Türk plakalarında en kötü model çıktı ve plakasız karede plaka uydurdu
(`AA2307JA`, `GB6473`). Üretimde ölçülen model kullanılır.

| Senaryo | Süre | Sonuç |
|---|---|---|
| Tipik mesafe | 0.41 sn | doğru |
| Araç yakında | 0.36 sn | doğru |
| Araç uzakta (zorlu) | 8.6 sn | doğru |
| Gölgede | 0.26 sn | doğru |
| Gece | 0.26 sn | doğru |
| Yüksek gürültü (yüksek ISO) | 0.28 sn | doğru |
| Eğik -9° | 4.0 sn | doğru |
| Sağ alt kadraj | 2.0 sn | doğru |
| HDR zemin | 0.26 sn | doğru |
| Telefon kırpma bandı | 0.07 sn | doğru |
| **Ortalama** | **1.65 sn** | **10/10** |
| Plakasız kare | 2.8 sn | doğru şekilde reddedildi |
## Plaka motoru: neden fast-plate-ocr

Ölçülen darboğaz Tesseract'ın tarayıcı/JS tarafı değil, model çağrısıydı:

| Katman | p50 | Payı |
|---|---|---|
| `session.run()` (C++ ONNX) | 14,4 ms | **%99,5** |
| Tensör hazırlama | 0,10 ms | %0,5 |
| `coz()` argmax çözümleme | 0,0045 ms | %0,02 |

Bu ölçüm iki yanlış sezgiyi ele verdi:
- **`coz()`'yi mikro-optimize etmek işe yaramaz** — 4,5 mikrosaniye.
- **`intraOpNumThreads=1` 2,5 KAT YAVAŞ** (36,6 ms vs 14,4 ms).
- **Batchleme de işe yaramıyor**: 12 adayı tek çağrıda okumak %16 *daha* yavaş
  (508 ms vs 439 ms). Model hesap sınırlı, çağrı tabanı değil.

Öyleyse asıl kaldıraç **çağrı sayısı**. Uyarılabilir erken çıkış eklendi:
dar kırpım zaten güvenilir plaka verdiyse geniş kırpım denenmiyor.

| Strateji | Okuma/istek | Süre | Sonuç |
|---|---|---|---|
| daima iki pay | 5,4 | 135 ms | taban |
| **uyarılabilir çıkış** | **3,7** | **102 ms** | **17/17 birebir aynı** |

Bu ölçümler `tools/olcum-darboaz.js` ile yeniden üretilebilir. Gerekçeleri
`plaka-fpo.js` içinde sabit yazılıdır ki bir sonraki geliştirici "daha az
iş parçacığı = daha hızlı" diye 2,5 kat yavaşlatmasın.

### Uydurma yok (en önemli kural)

Model **karakter uydurmaz**:
- **Ekleme yok.** OCR'ın görmediği rakam/harf eklenmez.
- **Değiştirme yalnızca modelin kendi 2. tercihine dayanır.** Ölçülen kaza:
  konum düzeltmesi harfi *tahmin* ediyordu (`ILK_HARF='A'`), "14A0099"
  okumasından "14AA099" üretti ve yapı puanı 15/15 alarak doğru adayları
  yendi. Artık `coz()` ikinci en yüksek **indeksi** de döndürüyor; ikinci
  tercih uygun değilse karaktere dokunulmuyor.
- **Kurye listesi puanı/güveni artırmaz**, yalnızca `kuryeOnerisi` olarak
  ayrı alanda gösterilir.

### Güven trafik ışığı — sistem karar vermez

```
yesil   minGuven >= 0,90   -> doğrudan göster
sari    0,50 - 0,90         -> nöbetçi onaylasın / tekrar çeksin
kirmizi < 0,50 veya plaka yok -> kadrajı değiştirsin
```

Eşikler **sentetik sahnelerle kalibre edildi** (doğru: 0,55 / 0,60 / 0,98+;
yanlış: 0,19 / 0,27 / 0,30 / 0,42). Gerçek telefon fotoğrafları toplandığında
yeniden ölçülmelidir.

Ölçülen ve önemli bir olgu: model bir plakayı **%97 güvenle yanlış** okuyabilir
(`34 ABC 1223` — 9 karakter, standart plaka biçimi değil). Bu yüzden yapı
doğrulaması eşiği sıkılaştırıldı (`YAPI_ESIK = 12`).

### Motor seçimi ve sessiz bozulmama

`CKY_MOTOR` ortam değişkeni:
- `fpo` (varsayılan) — fast-plate-ocr
- `tesseract` — eski hat
- `fpo+tesseract` — gölge mod: ikisini de çalıştırıp karşılaştırır

Model dosyası eksik/bozuksa **sessizce geçilmez**: `durum().fpo.sebep` sebebi
bildirir, SHA-256 özeti tutmuyorsa motor kurulumu reddeder ve servis Tesseract'a
düşer. Kurulum paketi içeriği `test-kurulum.js` ile denetlenir.

### Sürekli kamera okuma (opsiyonel, varsayılan KAPALI)

Nöbetçi, telefonu kameraya doğrultup **beklemek** zorunda kalmadan plakayı
okutabilir. Ayarlar › **Plaka & Kurye** › **Sürekli kamera okuma** anahtarını
açar; sistem kamerayı **kendisi** açar ve arka planda okumaya başlar. Plaka
bulununca ekranda yazar ve titreşir.

**Neden varsayılan kapalı?** Sürekli kamera + JPEG sıkıştırma pili hızlı
bitirir. Açılmadıkça **hiçbir şey** çalışmaz — mevcut tek-çekim akışı olduğu
gibi kalır.

Kullanıcının yapması gereken **tek şey** anahtarı açmaktır. Çekim düğmesine
basması gerekmez: ayarı açan sistemdir, kamerayı da o açar.

| | |
|---|---|
| Bulunca | plaka ekranda + titreşim/bip |
| Aynı plaka | tekrar tekrar uyarmaz (karede kalıcı oldukça) |
| Kareden çıkınca | sıfırlanır, geri gelince yeniden uyarır |
| Kayıt | **otomatik yapılmaz** — kapıyı sen açarsın |
| Ekran kapanınca | kendiliğinden durur |
| Hata | 3 denemeden sonra durur ve sebebini yazar |
| Sunucu yoğun | "sistem yoğun, bekleniyor" — turu atlamaz, bekler |

**Ölçülen değerler:** okuma 256 ms → tur 956 ms → **1,05 kare/sn → dakikada
63 istek** (sunucunun sınırı 600/dk). Yani telefonu yormaz, sunucuyu
bunlmaz.

**Bilmeniz gereken iki sınır:**
- **iOS'ta titreşim çalışmaz** (`navigator.vibrate` yoktur); kısa bip çalar.
- **Pil.** Sürekli kamera pili hızlı bitirir. Kullanmayacaksanız anahtarı
  kapatın — kapalıyken hiçbir şey çalışmaz.

### Neden kuyruk sınırı var? (sık sorulan, ölçümle cevaplı)

Sürekli mod kareleri arka arkaya gönderir. Kuyruk sınırsız olsaydı: telefon
hızlı gönderir, sunucu yavaş işler, birikme büyür ve gecikme **kare sayısıyla**
artar. 30 kare birikse nöbetçi 10 saniyelik gecikmeli tarayıcı görür ve
"çok yavaş" der — oysa tek okuma ölçülen 0,35 saniyedir. **Yanlış tanı.**

Bu yüzden kuyruk derinliği **3** ile sınırlı ve doluyken istek "sistem yoğun"
diye açıkça reddediliyor. Ölçülen: 10 eşzamanlı istek → 3 kabul + 7 red,
sonuçlar karışmadı, iş bitince kuyruk 0'a döndü.

## ⭐ Bilgisayar tarafı: tek dosya, çift tıkla

Kullanıcı hiçbir komut yazmaz. `release/CinarkoySync-Kur-1.3.0.exe` dosyasını
çift tıklayıp **İleri**'ye basması yeterli; sonra masaüstündeki **Çınarköy Excel
Sync** simgesine tıklayınca program açılır.

Kurulum paketi:
- **Yönetici (UAC) istemez** — kullanıcının kendi klasörüne kurulur (`%LOCALAPPDATA%\Programs`).
- **Node.js'u kendi içinde taşır** — bilgisayarda Node.js kurulu olması gerekmez.
- **Plaka motorunu (WASM + 2,8 MB dil paketi) kendi içinde taşır** — internet gerekmez.
- **Telefon uygulamasını da içinde taşır** — uygulama sunucudan yayınlanır.
- Her kurulum **kendi eşleşme anahtarını üretir** (geliştirme anahtarı dağıtılmaz).
- Başlat menüsü, masaüstü simgesi, "Telefon uygulaması" ve "Excel dosyası"
  kısayolları ve *Ayarlar → Uygulamalar*'dan kaldırma kaydı otomatik oluşturulur.
- **Kaldırma kayıtları silmez**; yalnızca hata ayıklama günlüğü ve geçici
  dosyalar temizlenir. Veri klasörü yerinde bırakılır.

### Başlatıcı penceresi (tek bakışta her şey)

| Düğme | Ne yapar |
|---|---|
| **Paneli Aç** | Kontrol panelini varsayılan tarayıcıda açar |
| **Telefon Uygulaması** | Telefonda kullanılacak uygulamayı açar (kayıt + plaka okuma) |
| **Veri Klasörü** | Excel'in tutulduğu klasörü açar |
| **Servisi Yeniden Başlat** | Servisi durdurup yeniden başlatır |
| **Excel'i Aç** | `data\kayitlar.xlsx` dosyasını doğrudan açar (dosya henüz yoksa nedenini söyler) |
| **Açılışta otomatik başlat** | Bilgisayar açılınca otomatik çalışsın (varsayılan açık) |
| **Windows iznini ver** | Yalnızca gerektiğinde görünür: güvenlik duvarı iznini tek tıkla verir |

Pencere ayrıca **plaka motorunun durumunu** canlı gösterir
(`hazır · yerel (paketlenmiş)` / `yok — <sebep>`). Motor kurulamazsa servis
çökmez; plaka okuma kapanır, elle giriş çalışmaya devam eder.

Pencereyi kapatmak servisi **durdurmaz**; program sistem tepsisinde yaşamaya
devam eder (tepsi simgesi → *Programı kapat* tamamen kapatır). Servis çökerse
başlatıcı onu kendiliğinden yeniden başlatır.

### Bilgisayarın IP'si değişirse ne olur?

Bu artık kullanıcının sorunu **değil**. Dört katmanlı koruma:

1. **Eşleşme otomatiktir.** Uygulama sunucudan yayınlandığı için adres her
   zaman `location.origin`'dir. IP değişse bile doğru adres kalır. (Bu
   yüzden artık QR okutmak da gerekmiyor.)
2. **Eşleşme QR'ı IP'yi taşımaz.** Yine de panelde gösterilir; QR, bilgisayar
   adına dayalı kalıcı **https** adresi içerir (`https://BILGISAYAR-ADI:4546`) —
kamera yalnızca burada açılır ve IP değişse de bu adres geçerli kalır.
3. **Telefon aday adres döngüsü tutar.** Kayıtlı adres, bilgisayar adı,
   `.local` adresleri ve IP adresleri sırayla denenir. Bağlantı kurulan adres
   kalıcı olur. Kullanıcı hiçbir şey yapmaz.
4. **Panel her an taze.** Paneldeki QR daima güncel adresi gösterir; gerekirse
   ekrandan yeniden okutulur. Bağlantı kurulamazsa telefonun ayar penceresi
   *neyapılması gerektiğini* açıkça söyler ve denenecek adresleri listeler.

## ⭐ g-venlik projesine entegrasyon

### Önerilen yol: uygulamayı sunucudan yayınlayın (sıfır ayar)

`tools/security-st-esle.js` betiği bunu tek komutla yapar:

```bash
node tools/security-st-esle.js
```

`Security-ST/index.html` → `companion/public/telefon/` olarak dönüştürülür:
CDN'ler yerelleştirilir, Google Fonts kaldırılır, bulut OCR kapatılır,
`plaka-yerel.js` ve `senkron.js` eklenir. Sonra kurulum paketini derleyin.

Kullanıcı açısından yapılacak tek şey: telefonda tarayıcıya
`https://BILGISAYAR-ADI:4546/telefon/` yazmak. Adres ve anahtar otomatik dolar,
QR okutmaya gerek kalmaz, hiçbir şey yazılmaz.

### alternatif yol: kendi dosyanıza yama olarak ekleyin

1. `phone/guvenlik-sync.js` dosyasını projenin `index.html` dosyasının yanına kopyalayın.
2. `index.html` içinde diğer `<script>` etiketlerinin **sonuna** şunu ekleyin:
   ```html
   <script src="guvenlik-sync.js"></script>
   ```
3. Bilgisayarda paneli açın → **Eşleşme** sayfasındaki QR kodu telefon kamerasıyla
   okutun. Adres ve anahtar otomatik dolar; hiçbir şey yazmanız gerekmez.

Hepsi bu. Mevcut uygulamaya **dokunulmaz**: `dbPut()` tek yakalama noktasıdır —
uygulamanın visits yazan **tüm** akışları (yeni kayıt, düzenleme, tekli silme, firma
geri-doldurma, kopya temizliği, içe aktarma) buradan geçer; yama yalnızca bitmiş
kaydın kopyasını kuyruğa alır. Düzenlemeler sunucuda `updatedAt` karşılaştırmasıyla
birleştirilir (uygulamanın kendi kuralı); silmeler Excel'den düşer, log'da denetim
için kalır. Toplu yerel silme sunucuya yayılmaz — sunucu log güvenlik ağı olarak
veriyi korur.
Ayrı IndexedDB (`ck_nobet_sync`) kullanır — uygulamanın `ck_nobet_v2` veritabanına,
sürümüne ve `localStorage` anahtarlarına dokunmaz. IndexedDB olmayan cihazda
`localStorage` kuyruğuna düşer.

> ⚠️ **Neden sunucudan yayınlıyoruz:** Uygulama GitHub Pages (https) üzerinden
> açılırsa tarayıcı, yerel ağdaki `http://` adresine bağlanmaya izin vermez
> (mixed content). Aynı sorun plaka fotoğrafının bulut servise gönderilmesinde
> de vardı. Uygulamayı companion servisinin kendisinden yayınladığımızda her iki
> sorun birden ortadan kalkar, ayrıca uygulama internetsiz de açılabilir hâle
> gelir. Yama yine de eski yolu destekler: GitHub Pages kullanmaya devam
> ederseniz rozette ve ayar penceresinde bu durumu açıkça söyler.

Model uyumu: `uid` idempotency anahtarıdır, `Firma` için `firmOf()` sonucu (yoksa
`company`) gönderilir, `deleted:true` kayıtlar log'da tutulur ama Excel'e yazılmaz.
Excel sütun sırası ve Tarih/Saat türetme, uygulamanın kendi Excel export'uyla aynıdır.

## Klasörler
| Klasör | İçerik |
|---|---|
| `companion/` | `companion.js` (servis), `public/` (panel + `telefon/` uygulaması), `ocr/` (yerel plaka motoru: `bolge.js` bölge bulucu, `gorsel.js` görüntü işleme, `plaka.js` motor), `launcher/` (Windows başlatıcı), `kurulum.iss` (Inno Setup), `paketle.ps1` (paketleme), `config.example.json` |
| `phone/` | `guvenlik-sync.js` (**g-venlik drop-in yaması**), örnek SPA: `index.html`, `css/`, `js/`, `sw.js`, `manifest.json` |
| `tools/` | `security-st-esle.js` (Security-ST → sunucu sürümü dönüştürücü, kendini doğrular) |
| `tests/ara/` | `sahne-uret.js` (gerçekçi sahne kareleri üretir), `plaka-uret.ps1` (plaka fikstürleri) |
| `Security-ST/` | Telefon uygulamasının kaynak sürümü (553 KB tek dosya) |
| `shared/` | `protocol.md` (API sözleşmesi) |
| `tests/` | 16 süit, 721 kontrol + canlı E2E (`fixtures/` = gerçekçi plaka ve **sahne** görüntüleri) |
| `release/` | Üretilen kurulum paketi (`CinarkoySync-Kur-<sürüm>.exe`) |

## Panel (4 sayfa, koyu/aydınlık tema, gerçek zamanlı)

| Sayfa | İçerik |
|---|---|
| `/` | İstatistikler, son hareketler, sistem durumu, servis ilerleme adımları, **plaka motoru durumu** |
| `kayitlar.html` | Tüm kayıtlar: arama, sayfalama, silinen kayıt filtresi, canlı güncelleme |
| `eslesme.html` | QR kod, aday adresler, anahtar — telefonu tek adımda eşlemek için |
| `ayar.html` | Tema seçimi, servis durumu, dosya ve kısayol bilgileri |
| `/telefon/` | **Telefon uygulamasının kendisi** (aynı servis, aynı köken) |

Gerçek zamanlı akış SSE (`/olay`) ile gelir; bağlantı düşerse 15 saniyede bir
REST yoklamasına düşer. Tüm ikonlar vektörel SVG'dir — hiçbir yerde emoji yoktur.
Koyu ve aydınlık temalar birlikte tasarlanmıştır; her iki temada da metin/zemin
kontrastı WCAG AA eşiğinin (4.5:1) üstündedir ve bu sayısal olarak sınanır
(`tests/test-tema.js`). Seçim kalıcıdır ve sistem tercihini de izler.

Yedek yoklama döngüsü yalnızca SSE gerçekten bağlanamıyorken çalışır ve en fazla
bir tane olur; sekme kapanınca da temizlenir. Böylece onlarca sekme açıkken bile
sunucunun hız sınırına takılması engellenir (`tests/test-akis.js` bunu ölçer).

## Hızlı kurulum — geliştirici (paketlemeden)

1. Node.js LTS kurun.
2. `companion/` içinde: `npm install`, sonra `node companion.js`.
   (`config.json` yoksa servis ilk açılışta kendi anahtarını üretip yazar.)
3. Panel: `http://localhost:4545/`

## Paketleme (kurulum .exe'i üretmek)

```powershell
cd companion
powershell -ExecutionPolicy Bypass -File paketle.ps1
```

Sırasıyla: telefon uygulamasını sunucu sürümüne dönüştürür → Node motorunu
hazırlar → bağımlılıkları üretim modunda kurar → uygulama simgesini üretir →
başlatıcıyı Windows'un kendi `csc.exe` derleyicisiyle derler → Inno Setup 6 ile
kurulum paketini derler. Çıktı: `release/CinarkoySync-Kur-1.3.0.exe` (34 MB).

Gereken tek dış araç **Inno Setup 6** (ücretsiz). Yoksa betik taşınabilir klasörü
hazırlayıp uyarı verir, paketlemeyi atlar.

## Telefon kurulumu

**Sunucudan yayınlanan uygulama (önerilen):**

1. Telefonu bilgisayarla **aynı Wi-Fi'a** bağlayın.
2. Tarayıcıya şunu yazın: **`http://BILGISAYAR-IP:4545/telefon/`** (sertifika gerekmez)
   (bilgisayar adı http'den daha güvenli **ve** kamerayı açabilir)
3. Sayfayı **ana ekrana ekleyin** (iOS: Paylaş → Ana Ekrana Ekle;
   Android: ⋮ → Ana ekrana ekle). Artık bir uygulama gibi açılır.
4. **Hiçbir şey yazmanız gerekmez.** Adres doğrudur, anahtar otomatik alınır.

Bilgisayar adını bilmiyorsanız paneldeki **Eşleşme** sayfası adresi gösterir
veya QR kodu okutabilirsiniz (ikincil yöntem).

## Hata senaryoları (hepsi testli)
- Wi-Fi kopması / PC kapalı → kayıt IndexedDB kuyruğunda bekler, ağ dönünce otomatik akar.
- Servis çökmesi → başlatıcı (veya pm2) saniyeler içinde yeniden başlatır; PC restartında otomatik açılır.
- **Bilgisayarın IP'si değişmesi** → uygulama aynı kökenden yayınlandığı için adres değişmez; QR ve telefon aday döngüsü ikinci emniyet.
- Çift gönderim → `id` dedup ile Excel'de tek satır (`duplicate:true`).
- Excel silinmesi/bozulması → açılışta veya sonraki kayıtta `.jsonl`'den sıfırdan üretilir (doğrulandı).
- Yazarken elektrik kesintisi → `.tmp` yarım kalır, gerçek `.xlsx` korunur (atomik rename).
- 20 paralel istek → promise zinciriyle sıraya girer, kayıp/çakışma yok (testli).
- Bozuk `seen-ids.json` → log'dan yeniden kurulur, bozuk dosya yedeklenir.
- Windows güvenlik duvarı engeli → başlatıcı pencerede tek tıkla izin ister.
- **İnternet kesilmesi / hiç internet olmaması** → uygulama, plaka okuma ve
  senkronizasyonun tamamı çalışır. Tek dış istek yoktur.
- **Plaka görüntüsü bozuk / plaka karede yok** → Tesseract hiç çağrılmaz, anında
  "kamerayı plakaya yaklaştırın" mesajı; uygulama çökmez.
- **OCR dil dosyası eksik veya WASM yüklenemiyor** → servis çökmez; plaka
  okuma kapanır, elle giriş çalışır, panelde ve başlatıcıda sebep yazılır.
- **Eşzamanlı plaka okuma istekleri** → tek kuyruğa girer, sonuçlar karışmaz
  (`tests/test-ocr.js` bunu üç paralel istekle ölçer).
- **Tesseract bozulması / okuma hatası** → işçi kapatılır, bir sonraki okumada
  kendiliğinden yeniden yüklenir.

## Test
```bash
cd companion && npm install && npm test
```
Beklenen: **721 kontrol + canlı E2E, tamamı PASS** (16 süit: temel entegrasyon,
kenar durumları + self-heal, telefon SYNC motoru, g-venlik yaması, QR kapalı devre,
panel akışı, tema kontrastı, **yerel plaka okuma**, **sahne tabanlı gerçek dünya okuma**,
**sürekli modun sunucu güvenliği (kuyruk sınırı)**, **sürekli mod eklentisinin
davranışı (sahte DOM'da gerçekten çalıştırılır)**, **HTTPS + el sıkışma ve sertifika
zinciri**, **sertifika kurulumunun iz bırakmadığı**, **bağımsız doğrulayıcılar
(X.509 + QR'ın OpenCV ile çözülmesi)**, statik tutarlılık, kurulum/başlatma
+ **paket içerik denetimi**, canlı sunucu + Excel doğrulaması, **canlı telefon
uygulaması + güvenlik denetimi**). Sıfır tolerans: tek FAIL çıkış kodudur.

### Testler neden güvenilir? (yanlış yeşilin önlenmesi)

Her doğrulama aracının **kendi kontrolü** vardır — aksi hâlde "bulamadım" cümlesi
hiçbir şey kanıtlamaz ve araç sessizce bozulur:

- `test-ui-static.js` içindeki parantez tarayıcısı, bilerek bozuk üç örnekte
  hata **bulmak zorundadır**. Bu bir "bulamıyorsan temiz" işlevi değil,
  ölçülebilir bir araçtır.
  *Ölçülen hata:* eski sürüm `viewRect.left) / viewRect.width` satırındaki
  boşluklu bölme işaretini regex sanıp geçerli kodda **uydurma "kapanmayan }"**
  bildiriyordu. Bu, sahte pozitifleri meşru kılmak için değil, ekibi
  kırmızı testleri görmezden gelmeye alıştırmamak için düzeltildi.
- `test-canli-eklenti.js` eklentiyi sahte bir DOM'da **gerçekten çalıştırır** ve
  senkronize edilmiş bir saatle ölçer. Ayrıca dosya genelinde bir **bekçi**
  vardır: bir bölüm takılırsa süreç sessizce yeşil çıkmaz, gürültülü kırmızı
  çıkar. (Bu bekçi bir negatif kontrolle kanıtlandı: düzeltmeler geri alınınca
  7 kontrol kırmızıya döndü, geri yazılınca 36/36 yeşil.)

Test fikstürleri `tests/fixtures/` altındadır: gürültü, bulanıklık, eğim ve farklı
aydınlatma koşullarıyla üretilmiş dört gerçekçi plaka görüntüsü
(`tests/ara/plaka-uret.ps1`). Plaka testleri de internetsizdir.

## Üretim notları
- Eşleşme anahtarı panelde görünür olabilir; okuyan uçlar (panel, arama, durum,
  eşleşme, plaka durumu) zaten anahtarsız çalışır. Yalnızca yazan uçlar
  (`/kayit`, `/kayit/batch`, `/plaka/oku`, `/plaka/hazirla`) anahtar ister.
- **Plaka okuma anahtar ister** çünkü bir görüntü işleme kaynağıdır; ağdaki
  başka biri keyifsiz OCR servisi olarak kullanamamalıdır. Telefon anahtarı
  `/eslesme`'den aldığı için bu ek yük yoktur.
- `data/` klasörünü düzenli yedekleyin (`yedek/` klasörüne her 1000 kayıtta snapshot alınır).
- Port varsayılan `4545` (http) ve `4546` (https); `PORT`/`HTTPS_PORT`/`SYNC_TOKEN`/`DATA_DIR`
  ortam değişkenleriyle ezilebilir. Kök CA anahtarı `data/kok-ca.key`; `CK_KOK_GUVENME=0`
  ile Windows güven kurulumu atlanır (telefonda yine elle kurulmalıdır).
- **Güvenlik duvarı kuralı kurulumda eklenmez.** Kural makine genelidir ve
  yönetici ister; bizim kurulumumuz UAC'sizdir. Bunun yerine başlatıcı
  `netsh` ile sorgular ve kural yoksa pencerede tek tıkla (tek UAC onayıyla)
  ekler.
- **Plaka motoru RAM'i kendi bırakır.** İlk okumada yüklenir, 5 dakika
  kullanılmazsa kendiliğinden kapanır; sonraki okumada yeniden açılır
  (~0,3 sn). Uzun süre açık kalan bir kulübe bilgisayarı yavaşlamaz.
- `npm audit` bir xlsx uyarısı gösterir; düzeltmesi yoktur (GHSA-4r6h/5pgg).
  Bu serviste tetiklenemez: yalnızca **bizim ürettiğimiz** dosyalar okunur, dışarıdan
  dosya kabul edilmez, servis yerel ağ + token arkasındadır. Kurulum betiği bu
  yüzden `--no-audit --no-fund` ile sessiz kurulur.
