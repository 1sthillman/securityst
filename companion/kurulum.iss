; ============================================================================
;  Çınarköy Excel Sync — Kurulum paketi (Inno Setup 6)
; ----------------------------------------------------------------------------
;  Tek dosyalık bir kurulum .exe'i üretir. Kullanıcı hiçbir komut yazmaz:
;  çift tıklar, kurulum biter, masaüstündeki simgeye tıklayınca program açılır.
;
;  Derleme:  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" kurulum.iss
;
;  Neden Inno Setup:
;    * Tek bir .exe çıktısı — kullanıcıya dağıtılacak dosya sayısı 1.
;    * Kendi Node.js motorunu (node.exe) paketin içinde taşır; bilgisayarda
;      Node.js kurulu olmasına gerek kalmaz.
;    * Yönetici yetkisi istemez: {localappdata} altına kurar (UAC yok).
;    * Başlangıç klasörü, masaüstü ve sağ tık menüsünü kendisi yaratır.
;    * Plaka okuma motorunu (WASM + dil paketi) de taşır; çalışma anında
;      internet gerekmez.
; ============================================================================

#define UygulamaAdi "Çınarköy Excel Sync"
#define UygulamaSurumu "1.7.0"
#define Yayinci "Çınarköy Güvenlik"
#define KurulumAdi "CinarkoySync"
#define AnaExe "CinarkoySync.exe"
#define Port 4545
#define TelefonUrl "http://localhost:4545/telefon/"

[Setup]
AppId={{7B2C4E10-9A31-4C5B-8D2E-3F1A6C9D4B70}
AppName={#UygulamaAdi}
AppVersion={#UygulamaSurumu}
AppVerName={#UygulamaAdi} {#UygulamaSurumu}
AppPublisher={#Yayinci}
AppComments=Telefondaki nöbet kayıtlarını bilgisayardaki Excel dosyasına otomatik aktarır; plaka okuma dahil tamamen yerelde çalışır.
DefaultDirName={localappdata}\Programs\{#KurulumAdi}
DefaultGroupName={#UygulamaAdi}
DisableProgramGroupPage=yes
OutputDir=..\release
OutputBaseFilename=CinarkoySync-Kur-{#UygulamaSurumu}
SetupIconFile=launcher\app.ico
UninstallDisplayIcon={app}\{#AnaExe}
UninstallDisplayName={#UygulamaAdi}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; UAC istemiyoruz: kullanıcı klasörüne kuruyoruz, yönetici gerektirmesin.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ChangesAssociations=no
CloseApplications=no
RestartApplications=no
; Kaldırma sırasında veri (Excel kayıtları) SİLİNMESİN — bu en önemli kural.
; Aşağıdaki [UninstallDelete] bölümü yalnızca geçici dosyaları temizler.

[Languages]
Name: "turkish"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Masaüstüne simge koy"; GroupDescription: "Ek kısayollar:"
Name: "autostart"; Description: "Bilgisayar açılınca otomatik başlat"; GroupDescription: "Ek kısayollar:"; Flags: checkedonce

; NOT: Windows güvenlik duvarı kuralı KURULUMDA eklenmez.
;   Firewall kuralları makine genelidir ve yönetici yetkisi ister; bizim
;   kurulumumuz yönetici istemiyor (UAC'siz, tek tıkla). Bunun yerine
;   başlatıcı, kural yoksa pencerede tek bir düğmeyle ("Windows izni ver")
;   ve tek bir UAC onayıyla kuralı ekler. Böylece kurulum akıcı kalır.

[Files]
; --- Başlatıcı -------------------------------------------------------------
Source: "launcher\CinarkoySync.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "launcher\app.ico";       DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

; --- Servis (Node.js motoru) ----------------------------------------------
; Node.js kendi klasörüyle gelir; kullanıcıda Node.js kurulu olması gerekmez.
Source: "node\node.exe"; DestDir: "{app}\node"; Flags: ignoreversion
Source: "companion.js";   DestDir: "{app}\app"; Flags: ignoreversion
Source: "qr.js";          DestDir: "{app}\app"; Flags: ignoreversion
Source: "package.json";   DestDir: "{app}\app"; Flags: ignoreversion
; Yeni kurulumda anahtar DEV anahtarıyla aynı olmamalı. Servis, token yoksa
; ilk açılışta kendi rastgele anahtarını üretip config.json'a yazar.
Source: "config.example.json"; DestDir: "{app}\app"; DestName: "config.json"; Flags: ignoreversion
Source: "public\*";       DestDir: "{app}\app\public"; Flags: ignoreversion recursesubdirs createallsubdirs
; NOT: public\telefon\yerel-kamera.js ve guvenli-kaynak.js de
; recursesubdirs sayesinde otomatik gelir (KAMERA SERTIFIKA GEREKTIRMEZ yolu).
; Genel kural: node_modules'ün TAMAMI, ancak onnxruntime'ın yerel ikili
; klasörü TAMAMEN dışlanır (aşağıda yalnızca 2 dosya geri ekleniyor).
;
; Neden bu kadar katı? onnxruntime-node kutudan 287 MB çıkar: win32 x64/arm64,
; linux x64/arm64, darwin ve DirectML/dxcompiler eklentilerinin ikilileri.
; ÖLÇÜLEN: ilk denemede Excludes'in alt klasör desenleri TÜMÜYLE paketlendi
; (darwin .dylib 42 MB, linux .so 44 MB, DirectML 36 MB) ve kurulum paketi
; 119 MB'a çıktı. Desen yerine klasörün tamamını dışlayıp gereken 2 dosyayı
; geri eklemek tartışmasızdır.
;
; Bu proje executionProviders: ['cpu'] kullanıyor. CPU yürütücüsü yalnızca
; şunları gerektirir:
;     onnxruntime_binding.node   (0,3 MB)
;     onnxruntime.dll           (27,4 MB)
; DirectML/dxcompiler/dxil YALNIZCA DirectML yürütücüsünde kullanılır.
;
; ARM64 Windows'ta x64 uygulama TAKLİT katmanı üzerinden çalışır ve bu ikili
; yine yüklenir. Beklenmedik ortamda ikili yüklenemezse motor SESSİZCE geçmez:
; durum().fpo.sebep sebebi bildirir ve servis Tesseract'a düşer — plaka okuma
; yine de çalışır, yalnızca yavaşlar.
;
; DİKKAT: ileride executionProviders'a 'dml' eklenirse bu iki dosya satırı
; genişletilmelidir; test-kurulum.js paket içeriğini sınar.
; NOT: Excludes deseni, kaynak jokerinin ARDINDAN kalan göreli yola göre
; eşleşir. Source "node_modules\*" olduğu için desen "onnxruntime-node\bin"
; olmalıdır; "node_modules\onnxruntime-node\bin" yazılırsa HİÇBİR ŞEY
; dışlanmaz. ÖLÇÜLEN HATA: tam yol yazıldığında 17 ikili (darwin/linux/arm64/
; DirectML) paketlendi ve kurulum 119 MB'da kaldı.
Source: "node_modules\*"; DestDir: "{app}\app\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "onnxruntime-node\bin"
;
; --- onnxruntime yerel ikilileri: YALNIZCA CPU yürütücüsünün ihtiyacı ---
; onnxruntime-node, çalışma anında yüklenen C++ ikilisidir; model dosyası
; paketlense bile ikili yoksa motor yüklenemez. İki dosya yeterlidir:
;     onnxruntime_binding.node  (yerel bağlama, 0,3 MB)
;     onnxruntime.dll          (çekirdek, 27,4 MB)
; DirectML.dll / dxcompiler.dll / dxil.dll YALNIZCA DirectML yürütücüsünde
; kullanılır; bu proje CPU yürütücüsü kullanıyor, o yüzden dışarıda.
;
; ARM64 Windows'ta x64 uygulama taklit katmanı uzerinden çalışır ve bu
; ikili yine yüklenir. Beklenmedik ortamda yüklenemezse motor SESSİZCE
; geçmez: durum().fpo.sebep sebebi bildirir, servis Tesseract'a düşer ve
; plaka okuma yine çalışır (yalnızca yavaşlar).
Source: "node_modules\onnxruntime-node\bin\napi-v6\win32\x64\onnxruntime_binding.node"; DestDir: "{app}\app\node_modules\onnxruntime-node\bin\napi-v6\win32\x64"; Flags: ignoreversion skipifsourcedoesntexist
Source: "node_modules\onnxruntime-node\bin\napi-v6\win32\x64\onnxruntime.dll"; DestDir: "{app}\app\node_modules\onnxruntime-node\bin\napi-v6\win32\x64"; Flags: ignoreversion skipifsourcedoesntexist

; NOT: data\kayitlar.jsonl BİLEREK paketlenmez. Her kurulum temiz başlar;
; geliştirme kayıtları (demo satırları) gerçek kullanıcının Excel'ine karışmamalıdır.
; Servis ilk telefon kaydı geldiğinde data\kayitlar.xlsx'i kendisi üretir.

; --- Yerel plaka okuma (çevrimdışı OCR) -----------------------------------
; İKİ MOTOR paketlenir; hangisinin okuduğu CKY_MOTOR ortam değişkeniyle
; belirlenir (varsayılan: fast-plate-ocr).
;
;   1) fast-plate-ocr  -> ocr\plaka-fpo.js + ocr\hat-fpo.js + ocr\models\*
;      ONNX modeli, çalışma anında HİÇBİR ağ isteği yapmaz (rehber §11).
;      Ölçülen: %86,7 tam eşleşme, karakter başına güven, plakasız karede
;      dürüst boş dönüş; tüm adaylar ~45 ms'de okunuyor.
;   2) Tesseract (yedek)-> ocr\lang\* (eng.traineddata) + WASM çekirdeği
;      node_modules\tesseract.js-core içinde gelir, yukarıdaki node_modules
;      kuralıyla zaten paketlenir.
;
; DİKKAT — "sadece üretimde bozuk" hatalar:
;   Geliştirmede çalışan bir şey kurulumda sessizce bozulabilir; ölçülen örnek:
;   bolge.js paketlenmediği için kurulu sürümde 10 sahnenin 8'i okunamadı.
;   Bu yüzden:
;     * test-kurulum.js kurulum paketinin İÇERİĞİNİ sınar (her ocr/*.js ve model)
;     * FpoMotoru eksik model/dosyada SESSİZCE geçmez, `durum().fpo.sebep`
;       ile bildirir; servis Tesseract'a düşer ve nedeni durum ekranında görünür.
;   Yeni bir ocr\*.js veya ocr\models dosyası eklerseniz BURAYA da ekleyin.
Source: "ocr\lang\*";    DestDir: "{app}\app\ocr\lang"; Flags: ignoreversion recursesubdirs
Source: "ocr\gorsel.js"; DestDir: "{app}\app\ocr"; Flags: ignoreversion
Source: "ocr\plaka.js";  DestDir: "{app}\app\ocr"; Flags: ignoreversion
Source: "ocr\bolge.js";  DestDir: "{app}\app\ocr"; Flags: ignoreversion
; --- fast-plate-ocr hattı (varsayılan motor) ---
Source: "ocr\turk-plaka.js"; DestDir: "{app}\app\ocr"; Flags: ignoreversion
Source: "ocr\plaka-fpo.js"; DestDir: "{app}\app\ocr"; Flags: ignoreversion
Source: "ocr\hat-fpo.js";   DestDir: "{app}\app\ocr"; Flags: ignoreversion
; Model dosyaları + config + SHA-256 özet dosyaları. Özet, kurulumda bozuk
; kopyalamayı yakalar (model sessizce değişmişse okuma tamamen yanlış olur).
Source: "ocr\models\*";   DestDir: "{app}\app\ocr\models"; Flags: ignoreversion recursesubdirs

; --- HTTPS + yerel kök CA (KAMERA İÇİN ZORUNLU) ---------------------------
; Tarayıcı kamerayı yalnızca https altında açar. Bu iki dosya olmadan
; companion.js require('./net/tls.js') yapamaz ve HTTPS hiç açılmaz; kullanıcı
; kameranın neden çalışmadığını "Kamera erişimi yok" sanır — yani kurulum
; ÇALIŞIR görünür ama kritik özellik sessizce ölü olur. Bu tam olarak
; yaşadığımız hata sınıfı: paket eksik, hata gizli.
; Yeni bir net\*.js eklerseniz BURAYA da ekleyin.
Source: "net\sertifika.js"; DestDir: "{app}\app\net"; Flags: ignoreversion
; API anahtari: companion.js `../shared/anahtar.js` okur, yani {app}\shared\ altinda
; BULUNMALIDIR. Ölçülen hata: bu klasör paketlenmediği için kurulu sürüm
; require hatasıyla açılmıyordu. Konum: {app}\shared\anahtar.js
Source: "..\shared\anahtar.js"; DestDir: "{app}\shared"; Flags: ignoreversion
Source: "net\tls.js";       DestDir: "{app}\app\net"; Flags: ignoreversion

[Dirs]
; Veri klasörü kurulum sırasında oluşturulur; Excel dosyası burada durur.
; Kaldırılırken BURAYI SİLMEYİZ — kayıtlar kullanıcının verisidir.
Name: "{app}\app\data"

[Icons]
Name: "{group}\{#UygulamaAdi}";           Filename: "{app}\{#AnaExe}"; WorkingDir: "{app}"
Name: "{group}\Telefon uygulaması";       Filename: "explorer.exe"; Parameters: """{#TelefonUrl}"""; WorkingDir: "{app}"
Name: "{group}\Excel dosyasını aç";       Filename: "explorer.exe"; Parameters: """{app}\app\data"""; WorkingDir: "{app}"
Name: "{group}\Kaldır ({#UygulamaAdi})";  Filename: "{uninstallexe}"
Name: "{autodesktop}\{#UygulamaAdi}";     Filename: "{app}\{#AnaExe}"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userdesktop}\Telefon uygulaması"; Filename: "explorer.exe"; Parameters: """{#TelefonUrl}"""; Tasks: desktopicon
Name: "{userdesktop}\Excel dosyası";      Filename: "explorer.exe"; Parameters: """{app}\app\data"""; Tasks: desktopicon

[Registry]
; Bilgisayar açılışında otomatik başlasın (başlatıcı --tray ile, pencere açılmaz).
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "CinarkoySync"; \
  ValueData: """{app}\{#AnaExe}"" --tray"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
; Kurulum bittikten sonra otomatik başlat: kullanıcı paneli hemen görsün.
Filename: "{app}\{#AnaExe}"; Description: "Programı aç"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Kaldırma: log ve Excel SİLİNMEZ (veri kaybı olmaz). Sadece geçici dosyalar.
Type: files; Name: "{app}\app\data\servis.log"
Type: files; Name: "{app}\app\data\*.tmp"

[Code]
{ Başlatıcı arka planda çalışıyorsa .exe kilitlenir ve yeni sürüm yazılamaz.
  Süreç listesine bakmak yerine dosyayı geçici adla yeniden adlandırmayı
  deniyoruz: kilitliyse başarısız olur.
  Bu kontrol PrepareToInstall'de yapılır; orada app klasörü hazır olur. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Yedek: String;
  Basarili: Boolean;
  Sonuc: Integer;
begin
  Result := '';
  NeedsRestart := False;
  Yedek := ExpandConstant('{app}\{#AnaExe}.eski');
  if not FileExists(ExpandConstant('{app}\{#AnaExe}')) then Exit;   { ilk kurulum }

  Basarili := RenameFile(ExpandConstant('{app}\{#AnaExe}'), Yedek);
  if Basarili then
  begin
    RenameFile(Yedek, ExpandConstant('{app}\{#AnaExe}'));   { yerine geri koy }
    Exit;                                                  { dosya serbest }
  end;

  { Dosya kilitli => uygulama çalışıyor. Kapatıp devam edelim mi? }
  if MsgBox('Çınarköy Excel Sync şu anda çalışıyor.' + #13#10 + #13#10 +
            'Kurulumun devam etmesi için program kapatılacak.' + #13#10 +
            'Kayıtlarınız silinmez, veri klasörü korunur.' + #13#10 + #13#10 +
            'Devam edilsin mi?',
            mbConfirmation, MB_YESNO) = IDYES then
    Exec('taskkill', '/IM {#AnaExe} /F', '', SW_HIDE, ewWaitUntilTerminated, Sonuc)
  else
    Result := 'Kurulum iptal edildi: Çınarköy Excel Sync çalışıyor.';
end;

{ Kaldırma: duvar kuralını temizle (varsa). Kural kullanıcı tarafından elle de
  eklenmiş olabilir; ekleyemediysek zaten yoktur, komut sessizce başarısız olur. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Sonuc: Integer;
begin
  if CurUninstallStep = usUninstall then
    Exec('netsh', 'advfirewall firewall delete rule name="Cinarkoy Excel Sync"',
      '', SW_HIDE, ewWaitUntilTerminated, Sonuc);
end;
