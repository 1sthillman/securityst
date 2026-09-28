# Senkron Protokolü (Telefon ↔ Companion) — v1.6

Tek doğruluk kaynağı: companion `data/kayitlar.jsonl`. Excel türetilmiş görünümdür.


**v1.6 değişikliği — HTTPS (KAMERA İÇİN ZORUNLU).** Tarayıcı kamerayı
yalnızca güvenli kaynakta açar; `http://192.168.x.x` güvenli kaynak **değildir**.
Companion artık **iki port** üzerinden aynı uygulamayı sunar:

| | |
|---|---|
| `PORT` (varsayılan 4545) | http — panel, kayıt, senkronizasyon |
| `HTTPS_PORT` (varsayılan `PORT+1`) | **https — telefon uygulaması ve kamera** |

Yeni uç: `GET /kurulum/kok.cer` → `application/x-x509-ca-cert`,
`Content-Disposition: attachment`. Telefonun bir kez kuracağı **kök CA**
(`data/kok-ca.pem`). Yaprak sertifika (`data/sunucu.pem`) IP/DNS değişince
yenilenir ama **aynı kökle imzalanır**; bu yüzden IP değişse de telefonda
tekrar işlem gerekmez (ölçüldü: yeniden başlatmada parmak izi birebir aynı).

`GET /eslesme` yanıtına eklendi: `httpsAdres` (kullanıcının açması gereken
adres) ve `https` (sertifika durumu: `aktif`, `dogrulandi`, `kokParmakIzi`,
`windowsGuvenli`, `dogrulamaHatalari`). **Aday sırası https'ten başlar.**

> **Bilmeniz gereken tek zorunlu işlem:** tarayıcı, işletim sistemine
> güvenilmeyen bir sertifika için kamera vermeyi reddeder. Bu atlatılamaz.
> Telefonda kök CA **bir kez** kurulur (iOS'ta ayrıca "tam güven" verilmesi
> gerekir). Bilgisayarda hiçbir şey yapılmaz: kök CA Windows'un kullanıcı
> deposuna servis açılışında otomatik eklenir (`certutil -user`, UAC yok).

**v1.5 değişikliği — sürekli (canlı) kamera okuma.** `POST /plaka/oku`
artışlı okuma için güvenli hale getirildi:
- **Kuyruk derinliği sınırı = 3.** Sınırsız kuyruk, canlı modda istek
  biriktirir ve gecikme kare sayısıyla büyürdü; kullanıcı "çok yavaş" derdi
  oysa tek okuma ölçülen 0,35 sn'dir — yani **yanlış tanı**. Artık kuyruk
  doluyken istek hemen reddedilir ve `neden:"kuyruk-dolu"` döner (HTTP 200).
  Ölçülen: 10 eşzamanlı istek → 3 kabul + 7 red, sonuçlar karışmadı, iş
  bitince derinlik 0'a döndü.
- **İstemci sözleşmesi: `neden`'e ÖNCE bak.** `kuyruk-dolu` bir güven
  değil **kapasite** bildirisidir; `guvenSeviyesi` bu durumda anlamsızdır
  (`kirmizi` gelir) ve ekranda "emin değilim" gibi gösterilmemelidir —
  "sistem yoğun, bekleniyor" gösterilmelidir.
- Yeni alan: `/telefon/canli-okuma.js` (eXtension, `CKYerel.canliAc()`).
  Kapalıyken **hiçbir şey** çalışmaz. Anahtar açıldığında **sistem kamerayı
  kendisi açar** (`Cam.open({mode:'scan'})`); kullanıcı çekim düğmesine
  basmaz. `canliAc()` bir **söz** döndürür: kamera açılıp akış oturunca
  `true`, açılamazsa `false` (bu durumda ayar geri alınır).

**v1.4 değişikliği:** Plaka okuma motoru Tesseract (WASM) yerine
**fast-plate-ocr** (ONNX, `onnxruntime-node`) ile çalışıyor. Ölçülen sonuçlar:
ortalama okuma süresi **780 ms → ~350 ms**, en kötü senaryo **4,7 sn → ~1 sn**,
uzak araç senaryosu **8 sn → 0,9 sn**; doğruluk %86,7 tam eşleşme ve plakasız
karelerde **0 yanlış kabul**. Eklenen alanlar: istekte `ipucu`, yanıtta
`guvenSeviyesi`, `minGuven`, `oneriler`, `ipucuAlindi`. Tesseract hattı
`CKY_MOTOR=tesseract` ile yedekte duruyor.

**v1.3 değişikliği:** Telefon uygulaması artık companion servisinin kendisinden
yayınlanır (`/telefon/`) ve plaka okuma sunucuya taşındı (`/plaka/oku`).
Aynı köken sayesinde adres/anahtar otomatik çözülür, IP değişikliği ve mixed
content sorunları ortadan kalkar.

## Auth
- **Yazan uçlar** (`POST /kayit`, `POST /kayit/batch`, `POST /plaka/oku`,
  `GET /plaka/hazirla`): `X-Sync-Token: <SHARED_TOKEN>` zorunlu.
- **Okuyan uçlar** (`GET /saglik`, `/durum`, `/kayitlar`, `/eslesme`, `/olay`,
  `GET /plaka/durum`): token istemez.
  Panel açılır açılmaz çalışsın diye; eşleşme anahtarı zaten panelde görünür.
- `config.json` içinde token yoksa servis ilk açılışta `crypto.randomBytes(32)`
  ile kendi anahtarını üretip dosyaya yazar. Her kurulum farklıdır.

## Kayıt şeması (g-venlik `mkVisit` çıktısıyla birebir uyumlu)
```json
{
  "id": "uuid (idempotency anahtarı, zorunlu — g-venlik `uid` de kabul edilir)",
  "site": "A Blok", "unit": "12", "courier": "Ali Veli",
  "company": "opsiyonel (`firma` adı da kabul edilir)", "plate": "34 ABC 123 (zorunlu)",
  "guard": "nöbetçi", "note": "opsiyonel",
  "date": "opsiyonel (yoksa ts'den tr-TR türetilir)",
  "time": "opsiyonel (yoksa ts'den HH:MM türetilir)",
  "ts": 1759000000000,
  "updatedAt": "opsiyonel (yoksa ts) — upsert karşılaştırmasında kullanılır",
  "dev": "opsiyonel cihaz kodu",
  "deleted": false
}
```
Notlar:
- `deleted:true` kayıtlar log'da saklanır (denetim) ama Excel'e yazılmaz.
- Excel sütun sırası ve Tarih/Saat türetme, uygulamanın kendi Excel export'uyla aynıdır
  (`Blok, Daire, Kurye, Firma, Plaka, Görevli, Not, Tarih, Saat`).

## Endpoint'ler

### POST /kayit
Tek kayıt. Yanıtlar:
- `200 {ok:true}` — yazıldı
- `200 {ok:true, duplicate:true}` — id zaten vardı, gelen eski/aynı (retry güvenli)
- `200 {ok:true, updated:true}` — id vardı ama gelen `updatedAt` daha yeni: satır güncellendi (uygulamanın kendi birleştirme kuralı)
- `400 {ok:false, error}` — doğrulama hatası
- `401` — token yanlış/eksik
- `413` — gövde 1MB üstü (kayıt telefonda kalır, batch'le bölünüp gelir)

### POST /kayit/batch
`{ "records": [...] }`, en fazla 500 kayıt. Yanıt:
`{ ok:true, saved, duplicates, updated, errors:[{index,id,error}] }`.
Hatalı kayıtlar atlanır, sağlamlar yazılır.

### GET /saglik
`{ ok:true, kayitSayisi, zaman }`

### GET /kayitlar
`?limit=50&offset=0&q=` — yeniden eskiye, TR duyarsız arama, silinmişler `deleted:true` bayrağıyla gelir.
Yanıt: `{ ok:true, total, limit, offset, records:[...] }`. `limit` en fazla 200.

### GET /eslesme
```json
{
  "ok": true,
  "bilgisayarAdi": "RST",
  "adaylar":   ["http://RST:4545", "http://RST.local:4545",
                "http://cinarkoy-sync.local:4545", "http://192.168.1.50:4545",
                "http://localhost:4545"],
  "adresler":  ["...localhost hariç aynı liste..."],
  "kaliciAdres": "http://RST:4545",
  "token": "...",
  "qrSvg": "<svg ...>",
  "zaman": "2026-09-28T00:00:00.000Z"
}
```
**Neden aday listesi?** Bilgisayarın IP'si değiştiğinde eşleşme bozulmasın diye
telefon birden çok adresi sırayla dener. **QR kodu `kaliciAdres`'i taşır** —
bilgisayar adı IP'den kalıcı olduğu için IP değişse bile aynı QR geçerlidir.
QR **sunucuda çevrimdışı** üretilir (`companion/qr.js`, bağımlılık yok); kulübede
internet olmasa da çalışır.

## 🔤 Yerel plaka okuma (v1.3)

### POST /plaka/oku
Gövde (8 MB sınırlı — kare base64 olarak gönderilir):
```json
{
  "gorsel": "data:image/png;base64,iVBORw0…",
  "bilinenPlakalar": ["34 ABC 123", "06 KL 2301"],
  "ipucu": { "ust": 48, "yukseklik": 11 },
  "hizli": false
}
```
- `gorsel` zorunlu. `image/jpeg` öneki de kabul edilir; PNG ve JPEG desteklenir.
- `bilinenPlakalar` isteğe bağlı (en fazla 400). **Artık puanı veya güveni
  ARTIRMAZ** — yalnızca `kuryeOnerisi` olarak ayrı bir alanda gösterilir ve
  nöbetçinin onayına sunulur. (Ölçülen kaza: listeyle eşleşmeye +30 puan
  veriliyordu; bu, okunmamış bir karakteri listeye göre uydurma riskiydi.)
- `ipucu` isteğe bağlı: kullanıcının ekranda plakanın etrafına çizdiği
  dikdörtgen, **yüzde** olarak (`ust`: üst kenar %, `yukseklik`: yükseklik %).
  Yüzde gönderilir çünkü telefonun dikdörtgeni de yüzde tutuyor ve kare
  boyutu cihazdan cihaza değişir; sunucu kendi çözünürlüğüne çevirir.
  **Ölçülen değer:** 180 senaryonun 19'unda ipucu belirleyici oldu; en net
  örnekte ipucusuz sistem hiçbir şey okumuyordu, ipucuyla doğru plakayı
  okudu. Geçersiz ipucu (dizi, string, yüzde dışı, negatif) çökertmez —
  `ipucuAlindi:false` döner ve motor normal aramaya düşer.

Yanıt:
```json
{
  "ok": true, "basarili": true,
  "plaka": "34 ABC 123",
  "guveniyet": 42.1,
  "guvenSeviyesi": "yesil",
  "minGuven": 0.997,
  "ipucuAlindi": true,
  "bulunanBolge": "ipucu-bolge-genis",
  "bolgeler": 8, "sureMs": 351,
  "adaylar": [
    {
      "plaka": "34 ABC 123", "bicim": "34 ABC 123", "ham": "34ABC123",
      "puan": 14, "yapi": 14,
      "ocrGuven": 0.997, "ortGuven": 0.999,
      "duzeltmeler": [],
      "kuryeOnerisi": null,
      "kaynak": "ipucu-bolge"
    }
  ],
  "ham": "34ABC123 | 34ABC123 | …",
  "hata": null, "neden": null
}
```

**`guvenSeviyesi` — güven trafik ışığı (nöbetçi arayüzü için):**

| Değer | Anlamı | Nöbetçinin yapması gereken |
|---|---|---|
| `yesil` | yapı geçerli ve `minGuven` ≥ 0,90 | doğrudan göster |
| `sari` | yapı geçerli, `minGuven` 0,50–0,90 | onaylasın / tekrar çeksin |
| `kirmizi` | emin değiliz (`neden=dusuk-guven`) **veya** plaka yok | kadrajı değiştirsin |

```json
{
  "ok": true, "basarili": false,
  "guvenSeviyesi": "kirmizi",
  "minGuven": 0.19,
  "neden": "dusuk-guven",
  "hata": "plaka okundu ama emin değilim — kamerayı plakaya biraz daha yaklaştırıp tekrar çekin",
  "oneriler": [{ "plaka": "14 A 0099", "minGuven": 0.19, "kaynak": "bolge-genis" }]
}
```

> **Neden `basarili:false` ama plaka görünüyor?** Ölçülen olay: uzak araç
> karesinde model "14 A 0099" okudu — yapı olarak geçerli (puan 14) ama en
> zayıf karakterin olasılığı **0,19**. Bunu "okundu" diye göstermek, hiç
> göstermemekten daha tehlikelidir: geçerli görünür, nöbetçi kapıda yanlış
> karar verebilir. Bu yüzden sistem `dusuk-guven` diyor, `oneriler` ile
> "belki şudur" bilgisini veriyor ve `kirmizi` ışığında yaklaştırmayı
> söylüyor. **Onay akışı insana aittir; sistem karar vermez.**
Durum kodları:
- `200` — okuma tamamlandı (`basarili:false` olabilir; `hata`/`neden` doludur)
- `400` — gövde bozuk / `gorsel` eksik / base64 çözülemiyor
- `401` — token yanlış/eksik
- `413` — gövde 8 MB üstü
- `503` — OCR motoru yüklenemedi (servis çökmez; elle giriş çalışır)

`neden` alanı ayırt edicidir — **her biri farklı bir eylem gerektirir**:
- `plaka-bulunamadi` → karede plaka yok veya bulunamadı. Kadrajı değiştir.
- `dusuk-guven` → plaka orada ama model emin değil. **Yaklaştır.** Adaylar
  `oneriler` içinde döner.
- `yapi-gecersiz` → okuma yapıldı ama Türk plaka yapısına uymuyor.
- `gorsel-kucuk` / `metin-yok` → kare okunamadı. Yeniden çek.
- `motor-yok` → hiçbir OCR motoru yüklenemedi. Elle giriş kullan.
- `kuyruk-dolu` → okuma **yapılmadı**, çünkü kuyruk dolu. Bu bir okuma
  hatası DEĞİL, kapasite bildirisidir: 2-4 saniye sonra aynı isteği
  tekrarlamak yeterlidir. `hata` alanı okunabilir bir metin, `kuyrukDerinligi`
  o anki derinliği verir. **Güven ışığı burada geçersizdir** — `kirmizi`
  gelmesi "emin değilim" anlamına gelmez, ekranda böyle gösterilmemelidir.
- `null` → okundu, sorun yok.

`bulunanBolge` okumanın kaynağını bildirir:
- `ipucu-bolge` / `ipucu-bolge-genis` → kullanıcının çizdiği dikdörtgenin
  içinde bulundu (**en güvenilir**)
- `ipucu` / `ipucu-genis` → dikdörtgenin kendisi tarandı
- `bolge` / `bolge-genis` → plaka karede kendi kendine bulundu
- `tam` → tüm kare tarandı (yedek yol)

### GET /plaka/durum
```json
{ "ok": true, "aktif": true, "hazir": true,
  "hat": "fpo",
  "motor": "fast-plate-ocr (cct_s_v2_global, ONNX, çevrimdışı)",
  "dil": "yerel (paketlenmiş)",
  "fpo": {
    "model": "cct_s_v2_global",
    "hazir": true,
    "sebep": null,
    "config": { "yuva": 10, "boyut": "128x64", "kanal": 3, "alfabe": 37,
                "bolgeTahmini": true },
    "ozet": { "uyusuyor": true },
    "istekSayisi": 198, "hataSayisi": 0, "sureMs": 21
  },
  "istekSayisi": 24, "hataSayisi": 0,
  "sonOkuma": 1759… , "sonHata": null, "sebep": null }
```
`aktif:false` ise `sebep` nedenini açıklar (örn. dil dosyası eksik).
`hazir:false` ama `aktif:true` → motor henüz yüklenmedi; ilk okumada yüklenir.
`bolgeBulucu:"aktif"` olmalıdır. **Değilse kurulum paketinde `ocr/bolge.js`
exik demektir** ve sahne karelerinde plaka okunamaz. Bu alan bilinçli olarak
görünür kılınmıştır: eksik dosya geliştirmede fark edilmez (dosya yanındadır),
ama kurulumda sessizce bozar.

### GET /plaka/hazirla
Anahtar ister. Motoru önden yükler (~0,3 sn), böylece kullanıcı ilk deklanşöre
basıldığında beklemez. Yanıt `/plaka/durum` ile aynı biçimdedir.

### Motor davranışı (uygulama katmanı)
- **Tembel yüklenir, sıcak tutulur, boşta kapanır.** 5 dakika kullanılmazsa
  motor kapanır (RAM geri verilir); sonraki okumada ~0,3 sn'de yeniden açılır.
- **Tek kuyruk.** WASM eşzamanlı çağrıya dayanıklı değildir; tüm istekler
  seriye girer, sonuçlar karışmaz.
- **Kademeli zorlama.** 1 geçiş (hızlı yol) → yetersizse 3 geçiş → hâlâ
  yetersizse 12 geçiş; üstüne 8 saniyelik zaman bütçesi. Ölçülen: temiz plaka
  ~0,9 sn.
- **Metin yoksa motor çalıştırılmaz.** Koyu/açık oranı ve dinamik aralık
  denetimi boş kareyi eler; hem kullanıcıya anlamlı mesaj verir hem de
  Tesseract'ın konsola hata ayıklama çıktısı bastırmasına gerek kalmaz.
- **Başarısızlık kendini onarır.** Okuma hatasında işçi kapatılır, sonraki
  istekte taze motorla yeniden denenir.
- **Kuyruk DERİNLİĞİ SINIRLI (3).** Sınırsız kuyruk artık bir hata
  kaynağıdır: sürekli modda istek birikir, gecikme kare sayısıyla büyür ve
  kullanıcı **yanlış tanı** alır ("çok yavaş" der; oysa tek okuma 0,35 sn).
  Kuyruk doluyken istek hemen reddedilir, `neden:"kuyruk-dolu"` döner.
- **Sıfır ağ isteği.** Dil paketi kurulumla gelir; çalışma anında internet
  gerekmez.

### Sürekli (canlı) kamera okuma — istemci sözleşmesi

`/telefon/canli-okuma.js`, `plaka-yerel.js`'nin kurduğu `CKYerel` nesnesini
**genişletir** (yenisini kurmaz — aksi hâlde durum sayacı ve eklenti görünmez
olurdu). Yeni istek *yoktur*: mevcut `POST /plaka/oku` kullanılır.

**Varsayılan KAPALI.** Kapalıyken hiçbir döngü, hiçbir istek, hiçbir kamera
erişimi yoktur. Ayar `localStorage['ck-sureci-oku']` içinde, cihazda kalıcıdır.

| API | Anlamı |
|---|---|
| `CKYerel.canliAc(true/false)` | anahtarı açar/kapatır **ve** modu başlatır/durdurur. Bir **söz** döndürür. |
| `CKYerel.canliDurdur()` | kalıcı ayara dokunmadan yalnızca durdurur |
| `CKYerel.canli` | `{ calisiyor, basliyor, tur, sonOkumaMs, sonOkunan, ardArdaHata, kameraHatasi }` |
| `CKYerel.sureciOkuAyar` | kalıcı **tercih** (çalışma durumundan ayrı tutulur) |

> **Tercih ile durum neden ayrı?** Karıştırılırsa anahtar "açık" görünür ama
> çalışmayan bir anahtar olur — en sinir bozucu belirsizlik. Anahtar
> `P.livePlate` (tercih), çalışma `CKYerel.canli.calisiyor` (anlık).

**`canliAc(true)` neden `true`/`false` döndürür, neden "başladı" demez?**
Ölçülen hata: anahtar açıldığında kamera sayfası kapalıydı, eklenti akış
bekleyip vazgeçiyordu ve anahtar geri alınıyordu — kullanıcı "çalışmıyor"
dedi. Doğrusu: **ayarı açan kişi değil, sistem kamerayı açar**
(`Cam.open({mode:'scan'})`, "Kamerayı Aç ve Okut" düğmesinin yaptığı gibi).
`canliAc` ancak akış oturduktan sonra `true` döner; açılamazsa `false` döner
ve çağıran tercihi geri alır. Kullanıcı iki şey yapar: anahtarı açar, tutar.

Döngünün kuralları (her biri bir ölçümden çıkarıldı):
- **Kendi hızında gitmez.** Tur süresi = ölçülen okuma süresi + 700 ms.
  Ölçülen: okuma 256 ms → tur 956 ms → **1,05 kare/sn → 63 istek/dk**
  (sunucu hız sınırı 600/dk).
- **Üst üste binmez.** Her zaman tek istek uçuşta.
- **Aynı plakayı tekrar uyarmaz.** `sonOkunan` değişmedikçe titreşim/bip
  üretilmez. Plaka kareden çıkınca `sonOkunan` sıfırlanır, geri geldiğinde
  yeniden uyarır.
- **Yığılma olmaz.** Sunucu yoğunsa `neden:"kuyruk-dolu"` gelir, döngü
  bekler, tur atlamaz.
- **Kendini durdurur.** 3 ardışık hatadan sonra (ağ yok / kamera yok)
  durur ve `sonHata` yazar. `neden:"kuyruk-dolu"` bir hata **sayılmaz**.
- **Ekran kapanınca durur** (`visibilitychange` + `pagehide`): pil ve
  kamera güvenliği.
- **Güvenlik döngüsü yok.** Bulunan plaka yalnızca ekranda ve titreşimle
  bildirilir. **Kayıt kapısı otomatik açılmaz** — karar insana aittir.
- **Kurye listesi gönderilmez** (`bilinenPlakalar: []`). Kurye listesi yalnızca
  öneridir ve puanı/güveni etkilemez (rehber §8.4); göndermek onu sessizce
  puan yapar gibi gösterirdi.

`kuyruk-dolu` alındığunda güven ışığı **geçersizdir**; ekranda "sistem yoğun,
bekleniyor" yazılmalıdır, "emin değilim" değil.

**Ölçülen sınır:** iOS'ta `navigator.vibrate` yoktur, titreşim çalışmaz (bip
calışır). Sürekli kamera pili hızlı bitirir; bu yüzden özellik **isteğe bağlı
ve varsayılan kapalı** bırakıldı.

## 📱 Telefon uygulamasının sunucudan yayınlanması (v1.3)

`GET /telefon/` → uygulamanın tamamı. Statik dosyalar:
`plaka-yerel.js` (OCR yönlendirici), `senkron.js` (senkronizasyon),
`ocr-config.js` (anahtarsız, bulut kapalı), `vendor/*` (Excel + QR kütüphaneleri).

**Aynı köken avantajı:** `senkron.js` açılışta `location.origin` üzerinden
`/eslesme` çağırır; adres ve anahtar otomatik kurulur. QR okutmak, adres ya da
anahtar yazmak gerekmez. IP değişikliği ve mixed content sorunları yapısal
olarak ortadan kalkar.

`plaka-yerel.js`, uygulamanın `Cam.read()` akışını sarar: kareyi PNG'ye çevirip
`/plaka/oku`'ya gönderir, aday puanlamasını uygulamanın kendi mantığına
bırakır. Sunucuya ulaşılamazsa ya da okuma başarısız olursa kullanıcıya net
mesaj verir ve uygulamanın kendi yoluna (elle giriş) bırakır — hiçbir durumda
ekran boş kalmaz.

**Bulut OCR tamamen kapalıdır.** `ocr-config.js` içindeki anahtar dizileri
boştur ve `mod:'yerel'`'dir. `tests/e2e-telefon.js` bunu her koşuda doğrular:
dış bağımlılık kalmadığını, anahtar sızmadığını, eklentinin hiçbir bulut
adresine gitmediğini.

### GET /olay (SSE — gerçek zamanlı akış)
`text/event-stream`. Panel bu kanala bağlanır:
- `event: durum` — açılışta ve her durum değişiminde
- `event: kayit` — yeni kayıt düştüğü **anda** (`{ tip, kayit?, kayitlar?, durum }`)

Bağlantı düşerse istemci otomatik yeniden bağlanır; bu da olmazsa 15 saniyede
bir `GET /durum` yoklamasına düşer. Kanal zorunlu değildir — kapalıysa yazma
akışı etkilenmez.

### GET /durum
`{ ok, kayitSayisi, guncelleme, excelBytes, logBytes, sonYazma, sonHata, zaman,
   kuyruk, adresler:[...], uptimeSn, surum }`.

## 🖥️ Kontrol paneli (bilgisayar arayüzü)

Servis çalışırken tarayıcıda açın: `http://localhost:4545/`. Dört sayfa:

| Yol | İçerik |
|---|---|
| `/` | İstatistikler, son hareketler, sistem durumu, servis ilerleme adımları |
| `/kayitlar.html` | Kayıt listesi: arama, sayfalama, silinen filtresi, canlı güncelleme |
| `/eslesme.html` | Eşleşme QR'ı, aday adresler, anahtar |
| `/ayar.html` | Tema seçimi, servis durumu, dosya ve kısayol bilgileri |
| `/telefon/` | **Telefon uygulaması** (aynı servis, aynı köken) |

Ortak varlıklar: `/assets/theme.css` (tasarım sistemi), `/assets/core.js`
(ikon seti, tema motoru, `CK.Canli` = SSE + yedek yoklama, bildirimler).

Ancak: sıralama eski, cihaz yavaş veya bağlantı koparsa düğmeler çalışmazsa
programı **kurulum .exe'i** ile başlatın: `release/CinarkoySync-Kur-1.3.0.exe`.
Başlatıcı servisi yönetir, paneli açar, telefon uygulamasını açar, plaka motorunun
durumunu gösterir ve Excel'in yerini belirtir.

## İstemci kuralları (telefon)
1. Önce IndexedDB outbox'a yaz, sonra gönder (await'siz).
2. FIFO sıralı flush; başarısızlıkta dur (`break`), üstel geri çekilme (15sn→2dk).
3. Tetikleyiciler: interval + `online` + `visibilitychange` + manuel buton.
4. Kuyruk ≥10 ise `/kayit/batch` dene, olmazsa tekliye düş.
5. `id` her kayıtta sabit UUID — retry'de asla değiştirme.
6. **Aday adres döngüsü:** bağlantı hatasında sıradaki adayı dene. Bağlantı
   kurulan adresi kalıcı yap. `401`/`400` aday değiştirmez (anahtar/veri hatası).
7. `adaylar` listesini `syncCfg` ile birlikte sakla; IP değişiminde işe yarar.
8. **Otomatik eşleşme (v1.3, sunucudan yayınlandığında):** açılışta
   `location.origin + /eslesme` çağrılır. `token` gelirse adres ve anahtar
   kurulur, `syncCfg` yazılır ve **kullanıcı hiçbir şey yapmaz**. Başarısız
   olursa (örn. GitHub Pages) eski elle eşleştirme yoluna düşülür.
9. **Plaka okuma:** kareyi `≤1400px`'e küçültüp PNG'ye çevir, `/plaka/oku`'ya
   `bilinenPlakalar` ile birlikte gönder. Aday puanlamasını sunucuya bırakma —
   telefon kendi `plateCandidates` mantığıyla puanlar ve kullanıcıya seçenek
   gösterir. `basarili:false` ise `neden` alanına bak: `metin-yok` demek
   çerçeveyi düzeltmek gerekir, kullanıcıya öyle söyle.
10. **Motoru ısıt:** uygulama açılışında `GET /plaka/hazirla` çağrılır; ilk
    deklanşöre basıldığında bekleme olmaz.
