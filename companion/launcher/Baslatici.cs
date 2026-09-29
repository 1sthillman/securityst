// ============================================================================
//  Çınarköy Excel Sync — Windows Başlatıcı
// ----------------------------------------------------------------------------
//  Tek amaç: kullanıcı hiçbir komut yazmadan, paneli açabilsin ve Excel'in
//  nerede olduğunu görebilsin. Servisi arka planda yönetir, tarayıcıyı ve
//  veri klasörünü tek tıkla açar, sistem tepsisinde yaşar.
//
//  Derleme:  csc /target:winexe /out:CinarkoySync.exe Baslatici.cs
//  Not: C# 5 sözdizimiyle yazılmıştır (Windows'un kendi csc derleyicisiyle
//        derlenebilsin diye): string interpolation, nameof, ?. kullanılmaz.
// ============================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Management;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace CinarkoySync
{
    // =========================================================================
    //  Tema (panelin koyu paletiyle aynı)
    // =========================================================================
    internal static class Palet
    {
        public static readonly Color Zemin = ColorTranslator.FromHtml("#0B0F10");
        public static readonly Color Yuzey = ColorTranslator.FromHtml("#12171A");
        public static readonly Color Kenar = ColorTranslator.FromHtml("#232C30");
        public static readonly Color Metin = ColorTranslator.FromHtml("#EEF2F0");
        public static readonly Color Soluk = ColorTranslator.FromHtml("#7C8B8B");
        public static readonly Color Amber = ColorTranslator.FromHtml("#F5A524");
        public static readonly Color Yesil = ColorTranslator.FromHtml("#3DD68C");
        public static readonly Color Kirmizi = ColorTranslator.FromHtml("#FF6B5B");
    }

    // =========================================================================
    //  Yol çözümü: kurulumda ve depoda aynı exe'yi kullanabilmeliyiz
    // =========================================================================
    internal static class Yol
    {
        public static readonly string ExeDizini = AppDomain.CurrentDomain.BaseDirectory;
        public static readonly string ExeYolu = Path.Combine(ExeDizini, "CinarkoySync.exe");

        /// companion.js'in bulunduğu dizin. Kurulumda <kok>\app, depoda <kok>\companion.
        public static readonly string AppDizini = UygulamaDiziniBul();

        public static readonly string CompanionJs = Path.Combine(AppDizini, "companion.js");
        public static readonly string VeriDizini = Path.Combine(AppDizini, "data");
        public static readonly string ExcelYolu = Path.Combine(VeriDizini, "kayitlar.xlsx");
        public static readonly string LogYolu = Path.Combine(VeriDizini, "servis.log");
        public static readonly int Port = PortBul();

        private static string UygulamaDiziniBul()
        {
            string[] adaylar =
            {
                Path.Combine(ExeDizini, "app"),
                ExeDizini,
                Path.Combine(ExeDizini, "companion"),
            };
            foreach (string a in adaylan(adaylar))
                if (File.Exists(Path.Combine(a, "companion.js"))) return a;
            return ExeDizini;
        }

        private static IEnumerable<string> adaylan(string[] liste)
        {
            foreach (string s in liste) if (!string.IsNullOrEmpty(s)) yield return s;
        }

        private static int PortBul()
        {
            try
            {
                string cfg = Path.Combine(AppDizini, "config.json");
                if (File.Exists(cfg))
                {
                    string t = File.ReadAllText(cfg, Encoding.UTF8);
                    Match m = Regex.Match(t, "\"port\"\\s*:\\s*(\\d+)");
                    int p;
                    if (m.Success && int.TryParse(m.Groups[1].Value, out p) && p > 0 && p < 65536) return p;
                }
            }
            catch { }
            return 4545;
        }

        /// https portu. Tarayıcı kamerayı YALNIZCA güvenli kaynakta açar ve
        /// http://192.168.x.x güvenli kaynak DEĞİLDİR; bu yüzden telefon
        /// uygulaması bu porttan servis edilir.
        /// config.json'da "httpsPort" varsa o, yoksa http portunun bir fazlası.
        public static readonly int HttpsPort = HttpsPortBul();

        private static int HttpsPortBul()
        {
            try
            {
                string cfg = Path.Combine(AppDizini, "config.json");
                if (File.Exists(cfg))
                {
                    string t = File.ReadAllText(cfg, Encoding.UTF8);
                    Match m = Regex.Match(t, "\"httpsPort\"\\s*:\\s*(\\d+)");
                    int p;
                    if (m.Success && int.TryParse(m.Groups[1].Value, out p) && p > 0 && p < 65536) return p;
                }
            }
            catch { }
            return Port + 1;
        }

        public static string YerelPanel { get { return "http://localhost:" + Port + "/"; } }
        /// Kurulum anahtarı (64 haneli). config.json'da kurulumda üretilir.
        ///
        /// ÖLÇÜLEN HATA: panel "Ağdan: http://localhost:4577/" ve "Plaka motoru:
        /// yok" gösteriyordu. Sebep: /durum ve /plaka/durum uçları anahtar
        /// zorunlu kıldı (401), launcher hiç göndermiyordu. Canlı ölçüm:
        ///   /durum       -> 401   (anahtarsız)
        ///   /plaka/durum -> 401   (anahtarsız)
        ///   /plaka/durum -> 200   (X-Sync-Token ile) aktif=true
        ///
        /// Anahtar config.json'da zaten var; panelin okuyabildiği yerde.
        public static string KurulumAnahtari
        {
            get
            {
                try
                {
                    string cfg = Path.Combine(AppDizini, "config.json");
                    if (File.Exists(cfg))
                    {
                        string t = File.ReadAllText(cfg, Encoding.UTF8);
                        Match m = Regex.Match(t, "\"token\"\\s*:\\s*\"([^\"]+)\"");
                        if (m.Success) return m.Groups[1].Value;
                    }
                }
                catch { }
                return "";
            }
        }

        /// Telefon uygulaması servis tarafından yayınlanıyor. Adres her zaman
        /// doğrudur; bilgisayarın IP'si değişse bile değişmez.
        ///
        /// ÖNEMLİ: https kullanılıyor. Tarayıcı kamerayı yalnızca güvenli
        /// kaynakta açar; telefon http://192.168.x.x üzerinden bağlandığında
        /// kamera izni VERİLMEZ. Kullanıcı http adresini kullanırsa "kamera
        /// açılmıyor" sanır — oysa asıl sebep tarayıcının güvenlik kuralıdır.
        public static string TelefonUygulamasi { get { return "https://localhost:" + HttpsPort + "/telefon/"; } }
    }

    // =========================================================================
    //  Node.js bulma
    // =========================================================================
    internal static class NodeBul
    {
        public static string Bul()
        {
            string[] dogrudan =
            {
                Path.Combine(Yol.AppDizini, "node", "node.exe"),
                Path.Combine(Yol.ExeDizini, "node", "node.exe"),
                Path.Combine(Yol.ExeDizini, "node.exe"),
                @"C:\Program Files\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"nodejs\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\nodejs\node.exe"),
            };
            foreach (string p in dogrudan)
                if (File.Exists(p)) return p;

            // PATH üzerinde ara
            try
            {
                string yol = Environment.GetEnvironmentVariable("PATH") ?? "";
                foreach (string d in yol.Split(';'))
                {
                    if (string.IsNullOrEmpty(d)) continue;
                    string p = Path.Combine(d.Trim(), "node.exe");
                    if (File.Exists(p)) return p;
                }
            }
            catch { }
            return null;
        }
    }

    // =========================================================================
    //  Servis durumu
    // =========================================================================
    internal class ServisDurumu
    {
        public bool Ayakta;
        public int KayitSayisi;
        public long ExcelBayt;
        public string SonYazma = "";
        public string AgAdresleri = "";
        public string Hata = "";
        // Yerel plaka (OCR) motoru durumu
        public bool PlakaAktif;
        public bool PlakaHazir;
        public string PlakaDil = "";
        public string PlakaSebep = "";
    }

    internal static class Servis
    {
        private static int istekNo = 0;

        public static ServisDurumu Sorgula()
        {
            int benim = System.Threading.Interlocked.Increment(ref istekNo);
            var d = new ServisDurumu();
            try
            {
                string saglik = JsonAl("http://127.0.0.1:" + Yol.Port + "/saglik");
                if (saglik == null) { d.Hata = "Servis yanıt vermiyor."; return d; }
                d.Ayakta = true;
                d.KayitSayisi = IntOku(saglik, "kayitSayisi");
                string durum = JsonAl("http://127.0.0.1:" + Yol.Port + "/durum", Yol.KurulumAnahtari);
                if (durum != null)
                {
                    d.ExcelBayt = LongOku(durum, "excelBytes");
                    d.SonYazma = MetinOku(durum, "sonYazma");
                    d.AgAdresleri = DiziOku(durum, "adresler");
                }
                // Plaka motoru durumu: ayrı uç, çünkü /durum yalnızca özet veriyor
                string plaka = JsonAl("http://127.0.0.1:" + Yol.Port + "/plaka/durum", Yol.KurulumAnahtari);
                if (plaka != null)
                {
                    d.PlakaAktif = MantiksalOku(plaka, "aktif");
                    d.PlakaHazir = MantiksalOku(plaka, "hazir");
                    d.PlakaDil = MetinOku(plaka, "dil");
                    d.PlakaSebep = MetinOku(plaka, "sebep");
                }
            }
            catch (Exception e) { d.Hata = e.Message; }
            GC.KeepAlive(benim);
            return d;
        }

        /// ÖLÇÜLEN HATA: /durum ve /plaka/durum anahtar zorunlu kıldı;
        /// launcher anahtarsız çağırınca 401 alıyor ve panel boş bilgi
        /// gösteriyordu. Artık kurulum anahtarı başlıkla gönderiliyor.
        private static string JsonAl(string url, string kurulumAnahtari)
        {
            try
            {
                var wc = new WebClient();
                wc.Encoding = Encoding.UTF8;
                wc.Headers.Add("Cache-Control", "no-cache");
                if (!string.IsNullOrEmpty(kurulumAnahtari))
                    wc.Headers["X-Sync-Token"] = kurulumAnahtari;
                return wc.DownloadString(url);
            }
            catch { return null; }
        }

        private static string JsonAl(string url)
        {
            try
            {
                var wc = new WebClient();
                wc.Encoding = Encoding.UTF8;
                wc.Headers.Add("Cache-Control", "no-cache");
                return wc.DownloadString(url);
            }
            catch { return null; }
        }

        private static bool MantiksalOku(string json, string anahtar)
        {
            Match m = Regex.Match(json, "\"" + anahtar + "\"\\s*:\\s*(true|false)");
            return m.Success && m.Groups[1].Value == "true";
        }

        private static int IntOku(string json, string anahtar)
        {
            Match m = Regex.Match(json, "\"" + anahtar + "\"\\s*:\\s*(\\d+)");
            int v;
            return m.Success && int.TryParse(m.Groups[1].Value, out v) ? v : 0;
        }

        private static long LongOku(string json, string anahtar)
        {
            Match m = Regex.Match(json, "\"" + anahtar + "\"\\s*:\\s*(\\d+)");
            long v;
            return m.Success && long.TryParse(m.Groups[1].Value, out v) ? v : 0;
        }

        private static string MetinOku(string json, string anahtar)
        {
            Match m = Regex.Match(json, "\"" + anahtar + "\"\\s*:\\s*\"([^\"]*)\"");
            return m.Success ? m.Groups[1].Value : "";
        }

        private static string DiziOku(string json, string anahtar)
        {
            Match m = Regex.Match(json, "\"" + anahtar + "\"\\s*:\\s*\\[([^\\]]*)\\]");
            if (!m.Success) return "";
            var parcalar = Regex.Matches(m.Groups[1].Value, "\"([^\"]+)\"");
            var liste = new List<string>();
            foreach (Match p in parcalar) liste.Add(p.Groups[1].Value);
            return string.Join(", ", liste.ToArray());
        }

        /// Çalışan companion.js sürecini bul (varsa PID).
        public static int ServisPid()
        {
            try
            {
                int bulunan = -1;
                string hedef = Yol.CompanionJs;
                var arama = new ManagementObjectSearcher(
                    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'");
                foreach (ManagementObject o in arama.Get())
                {
                    string cl = Convert.ToString(o["CommandLine"]);
                    if (!string.IsNullOrEmpty(cl) &&
                        cl.IndexOf(hedef, StringComparison.OrdinalIgnoreCase) >= 0)
                        bulunan = Convert.ToInt32(o["ProcessId"]);
                }
                return bulunan;
            }
            catch { return -1; }
        }

        public static void Durdur()
        {
            int pid = ServisPid();
            if (pid > 0)
            {
                try { Process.GetProcessById(pid).Kill(); } catch { }
            }
        }

        public static bool Baslat(out string hata)
        {
            hata = "";
            if (!File.Exists(Yol.CompanionJs))
            {
                hata = "Servis dosyaları bulunamadı:\n" + Yol.CompanionJs;
                return false;
            }
            string node = NodeBul.Bul();
            if (node == null)
            {
                hata = "Bilgisayarınızda Node.js bulunamadı.\n\n" +
                       "Program, Node.js motorunu kendi yanında taşımalıdır.\n" +
                       "Kurulumu yeniden çalıştırmayı deneyin.\n\nBeklenen konum:\n" +
                       Path.Combine(Yol.ExeDizini, "node");
                return false;
            }
            try
            {
                if (!Directory.Exists(Yol.VeriDizini)) Directory.CreateDirectory(Yol.VeriDizini);

                // start /b: servis, başlatıcı kapatılsa da yaşamaya devam eder.
                string komut = "/c start \"\" /b \"" + node + "\" \"" + Yol.CompanionJs + "\" >> \"" + Yol.LogYolu + "\" 2>&1";
                var psi = new ProcessStartInfo("cmd.exe", komut);
                psi.WorkingDirectory = Yol.AppDizini;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);
                return true;
            }
            catch (Exception e) { hata = e.Message; return false; }
        }

        /// Servisin ayağa kalkmasını bekler. Ayağa kalkarsa tarayıcıyı açar.
        public static bool BekleVeAc(out ServisDurumu durum)
        {
            durum = new ServisDurumu();
            for (int i = 0; i < 40; i++)   // ~20 saniye
            {
                durum = Sorgula();
                if (durum.Ayakta) return true;
                Thread.Sleep(500);
            }
            return false;
        }
    }

    // =========================================================================
    //  Windows güvenlik duvarı
    // -------------------------------------------------------------------------
    //  Telefonun bağlanabilmesi için bilgisayarın 4545 portunu dinlemesi ve
    //  duvarın buna izin vermesi gerekir. Dünya genelinde Windows bu izni
    //  "program ilk kez dinlemeye başlayınca" bir soru olarak sorar; kullanıcı
    //  yanlışlıkla reddederse telefon hiçbir zaman bağlanamaz ve kimse nedenini
    //  bilemez.
    //
    //  Biz bu izni kendimiz, tek tıkla ve tek UAC onayıyla veriyoruz.
    //  Kurulum aşamasında veremeyiz: duvar kuralları makine genelidir ve
    //  yönetici ister, bizimki ise yönetici istemeyen akıcı bir kurulumdur.
    // =========================================================================
    internal static class Duar
    {
        private const string KuralAdi = "Cinarkoy Excel Sync";

        /// Gelen bağlantılara izin veren kural zaten var mı?
        /// (netsh ile SORGULANIR; sorgu için yönetici gerektirmez.)
        public static bool KuralVar()
        {
            try
            {
                string gecici = Path.Combine(Path.GetTempPath(),
                    "ck-duvar-" + Guid.NewGuid().ToString("N").Substring(0, 6) + ".txt");
                var psi = new ProcessStartInfo("cmd.exe",
                    "/c netsh advfirewall firewall show rule name=\"" + KuralAdi + "\" > \"" + gecici + "\" 2>&1");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process p = Process.Start(psi);
                if (p != null) p.WaitForExit(8000);

                string metin = "";
                for (int i = 0; i < 20 && File.Exists(gecici); i++)
                {
                    try { metin = File.ReadAllText(gecici); break; }
                    catch { Thread.Sleep(150); }   // dosya hâlâ yazılıyor
                }
                try { if (File.Exists(gecici)) File.Delete(gecici); } catch { }
                if (string.IsNullOrEmpty(metin)) return false;
                if (metin.IndexOf("No rules match", StringComparison.OrdinalIgnoreCase) >= 0) return false;
                return metin.IndexOf("Rule Name", StringComparison.OrdinalIgnoreCase) >= 0;
            }
            catch { return false; }
        }

        /// Kuralı ekler. Windows bir kez "yönetici izni" sorar; evet denirse
        /// kural yazılır. Düğmeye basıldığı için bu tek soru normaldir.
        public static void KuralEkle()
        {
            string komut = "netsh advfirewall firewall add rule name=\"" + KuralAdi + "\" " +
                "dir=in action=allow protocol=TCP localport=" + Yol.Port + " profile=private";
            try
            {
                Process.Start(new ProcessStartInfo(komut)
                {
                    UseShellExecute = true,
                    Verb = "runas",     // yönetici onayı (tek seferlik)
                    WindowStyle = ProcessWindowStyle.Hidden
                });
            }
            catch (Exception e) { throw new Exception("Windows izni verilemedi: " + e.Message, e); }
        }

        /// Kuralı kaldırır (Kaldır sırasında çağrılır).
        public static void KuralSil()
        {
            try
            {
                var psi = new ProcessStartInfo("cmd.exe",
                    "/c netsh advfirewall firewall delete rule name=\"" + KuralAdi + "\"");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process p = Process.Start(psi);
                if (p != null) p.WaitForExit(8000);
            }
            catch { }
        }
    }

    // =========================================================================
    //  Program girişi
    // =========================================================================
    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        private const string MutexAdi = "Local\\CinarkoySyncTekKopuk";
        private const string CagriOlayAdi = "Local\\CinarkoySyncCagir";

        [STAThread]
        private static void Main(string[] args)
        {
            bool tepsiKipi = false, tarayiciAcma = false;
            foreach (string a in args)
            {
                string l = (a ?? "").ToLowerInvariant();
                if (l == "--tray" || l == "-tray" || l == "/tray") tepsiKipi = true;
                if (l == "--no-browser" || l == "-no-browser") tarayiciAcma = false;
            }

            try { SetProcessDPIAware(); } catch { }

            bool ilk;
            using (var kilit = new Mutex(true, MutexAdi, out ilk))
            {
                if (!ilk)
                {
                    // Zaten çalışıyorsa yalnızca onu uyandır.
                    try
                    {
                        using (var e = EventWaitHandle.OpenExisting(CagriOlayAdi)) e.Set();
                    }
                    catch { }
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                try
                {
                    var ikon = Simge.Uret(32);
                    if (ikon != null) Application.Run(new AnaPencere(tepsiKipi, !tarayiciAcma, ikon));
                    else Application.Run(new AnaPencere(tepsiKipi, !tarayiciAcma, null));
                }
                finally { kilit.ReleaseMutex(); }
            }
        }
    }

    // =========================================================================
    //  Simge (dosya gerekmeden çalışma anında çizilir)
    // =========================================================================
    internal static class Simge
    {
        public static Icon Uret(int boyut)
        {
            try
            {
                using (Bitmap bmp = Ciz(boyut))
                {
                    IntPtr h = bmp.GetHicon();
                    try
                    {
                        // FromHandle işaretçiyi ödünç alır; handle'i serbest bırakınca
                        // nesne çalışmaz hale gelir. Bu yüzden klonlanır.
                        return (Icon)Icon.FromHandle(h).Clone();
                    }
                    finally { DestroyIcon(h); }
                }
            }
            catch { return null; }
        }

        private static Bitmap Ciz(int boyut)
        {
            var bmp = new Bitmap(boyut, boyut, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.Clear(Color.Transparent);

                float o = boyut * 0.06f;
                float gd = boyut - 2 * o;

                // Yuvarlak koyu zemin
                using (var yol = new GraphicsPath())
                {
                    float r = gd * 0.24f;
                    yol.AddArc(o, o, r, r, 180, 90);
                    yol.AddArc(o + gd - r, o, r, r, 270, 90);
                    yol.AddArc(o + gd - r, o + gd - r, r, r, 0, 90);
                    yol.AddArc(o, o + gd - r, r, r, 90, 90);
                    yol.CloseFigure();
                    using (var dolgu = new SolidBrush(Palet.Zemin)) g.FillPath(dolgu, yol);
                    using (var kalinlik = new Pen(Palet.Kenar, Math.Max(1f, boyut / 32f))) g.DrawPath(kalinlik, yol);
                }

                // Amber tablo (Excel sayfası)
                float sx = boyut * 0.26f, sy = boyut * 0.22f, sw = boyut * 0.48f, sh = boyut * 0.38f;
                using (var f = new SolidBrush(Palet.Amber))
                    g.FillRectangle(f, sx, sy, sw, sh);
                using (var f = new SolidBrush(Color.FromArgb(70, 11, 15, 16)))
                {
                    for (int i = 1; i < 4; i++)
                        g.FillRectangle(f, sx, sy + sh * i / 4f, sw, Math.Max(1f, boyut / 40f));
                    for (int i = 1; i < 3; i++)
                        g.FillRectangle(f, sx + sw * i / 3f, sy, Math.Max(1f, boyut / 40f), sh);
                }

                // Beyaz aşağı ok (telefon -> bilgisayar aktarımı)
                float cx = boyut * 0.5f, aw = boyut * 0.20f, top = boyut * 0.64f, hgt = boyut * 0.20f;
                using (var f = new SolidBrush(Palet.Metin))
                {
                    g.FillRectangle(f, cx - aw * 0.32f, top - hgt, aw * 0.64f, hgt);
                    var ok = new PointF[]
                    {
                        new PointF(cx - aw, top - hgt * 0.35f),
                        new PointF(cx + aw, top - hgt * 0.35f),
                        new PointF(cx, top + hgt * 0.35f),
                    };
                    g.FillPolygon(f, ok);
                }
            }
            return bmp;
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool DestroyIcon(IntPtr h);
    }

    // =========================================================================
    //  Düğmeler
    // =========================================================================
    internal class Dugme : Button
    {
        private bool _vurgu;
        public bool Vurgu
        {
            get { return _vurgu; }
            set { _vurgu = value; Ciz(); }
        }

        public Dugme(string metin, bool vurgu)
        {
            _vurgu = vurgu;
            Text = metin;
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 1;
            FlatAppearance.BorderColor = Palet.Kenar;
            BackColor = vurgu ? Palet.Amber : Palet.Yuzey;
            ForeColor = vurgu ? ColorTranslator.FromHtml("#14100A") : Palet.Metin;
            Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            Height = 36;
            Cursor = Cursors.Hand;
            UseVisualStyleBackColor = false;
        }

        private void Ciz()
        {
            BackColor = Vurgu ? Palet.Amber : Palet.Yuzey;
            ForeColor = Vurgu ? ColorTranslator.FromHtml("#14100A") : Palet.Metin;
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            base.OnMouseEnter(e);
            if (Vurgu) BackColor = ColorTranslator.FromHtml("#FFB63C");
            else BackColor = ColorTranslator.FromHtml("#182025");
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            BackColor = Vurgu ? Palet.Amber : Palet.Yuzey;
        }
    }

    // =========================================================================
    //  Ana pencere
    // =========================================================================
    internal class AnaPencere : Form
    {
        private Panel _govde;
        private Label _baslik, _altBaslik, _durumMetin, _durumAciklama;
        private Panel _nokta;
        private Label _panelSatir, _agSatir, _excelSatir, _kayitSatir, _gunlukSatir;
        private Dugme _panelDugme, _telefonDugme, _excelDugme, _klasorDugme, _yenidenDugme, _kapatDugme, _durDugme;
        private Panel _duvarBandi;
        private Label _duvarMetin;
        private Dugme _duvarDugme;
        private Panel _kart;
        private Label _ipucu;
        private Label _plakaSatir, _telefonSatir;
        private List<Label> _bilgiEtiketleri = new List<Label>();
        private List<Label> _bilgiSatirlari = new List<Label>();
        private bool _duvarSorgulandi = false;
        private bool _servisiDurdurduk = false;   // kullanıcı bilerek durdurduysa
        private int _yenidenDeneme = 0;           // kendiliğinden yeniden başlatma sayacı
        private CheckBox _otoBaslat;
        private NotifyIcon _tepsi;
        private System.Threading.Timer _nabiz;
        private ServisDurumu _durum = new ServisDurumu();
        private bool _baslatildi = false;
        private bool _kapaniyor = false;
        private Icon _ikon;

        private const string CalismaAnahtari = @"Software\Microsoft\Windows\CurrentVersion\Run";

        public AnaPencere(bool tepsiKipi, bool tarayiciyiAc, Icon ikon)
        {
            _ikon = ikon;
            Build(tepsiKipi);

            _tepsi = new NotifyIcon();
            _tepsi.Icon = _ikon != null ? _ikon : SystemIcons.Application;
            _tepsi.Text = "Çınarköy Excel Sync";
            _tepsi.Visible = true;
            _tepsi.ContextMenuStrip = TepsiMenusu();
            _tepsi.DoubleClick += delegate { TepsiGoster(); };

            // Başka bir örnek çağrı yaptıysa pencereyi öne getir
            try
            {
                var olay = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\CinarkoySyncCagir");
                var isleyici = new Thread(delegate()
                {
                    while (true)
                    {
                        olay.WaitOne();
                        if (_kapaniyor) return;
                        try
                        {
                            if (IsHandleCreated) BeginInvoke(new MethodInvoker(delegate
                            {
                                Show(); WindowState = FormWindowState.Normal; Activate(); Tasi(); PanelAc();
                            }));
                        }
                        catch { }
                    }
                });
                isleyici.IsBackground = true;
                isleyici.Start();
            }
            catch { }

            Calistir(tarayiciyiAc, tepsiKipi);
        }

        // ---------------------------------------------------------------------
        private void Build(bool tepsiKipi)
        {
            Text = "Çınarköy Excel Sync";
            BackColor = Palet.Zemin;
            ForeColor = Palet.Metin;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            // NOT: AutoScaleMode bilerek varsayılan bırakıldı. AutoScaleMode.Dpi
            // ayarlanırsa yalnızca yazı tipleri büyüyüp sabit piksel ölçüleri
            // küçük kalıyor (metin taşması). Yükseklik de Build() sonunda
            // içerikten hesaplanır.
            ClientSize = new Size(520, 430);
            if (_ikon != null) Icon = _ikon;
            Font = new Font("Segoe UI", 9f);

            // ---- başlık ----
            var ust = new Panel { Dock = DockStyle.Top, Height = 74, BackColor = Palet.Yuzey, Padding = new Padding(20, 16, 20, 12) };
            _baslik = new Label
            {
                Text = "Çınarköy Excel Sync",
                ForeColor = Palet.Metin,
                Font = new Font("Segoe UI", 15f, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(20, 12)
            };
            _altBaslik = new Label
            {
                Text = "Telefondaki kayıtlar bu bilgisayardaki Excel'e aktarılır.",
                ForeColor = Palet.Soluk,
                Font = new Font("Segoe UI", 9f),
                AutoSize = true,
                Location = new Point(22, 46)
            };
            ust.Controls.Add(_baslik);
            ust.Controls.Add(_altBaslik);

            // ---- gövde ----
            // DİKKAT: gövde önce eklenir. WinForms'te docking, koleksiyondaki en
            // yüksek indeksten başlayarak yapılır; Fill olan gövde böylece en son
            // yerleşir ve başlığın altında kalan alanı doldurur. (Tersi sırada
            // gövde 0,0'dan tüm pencereyi kaplar, başlık gizlenir.)
            _govde = new Panel { Dock = DockStyle.Fill, BackColor = Palet.Zemin, Padding = new Padding(20, 16, 20, 12) };
            Controls.Add(_govde);
            Controls.Add(ust);

            // ---- Windows izni bandı ---------------------------------------
            // Telefonun bağlanabilmesi için duvarın bu programa izin vermesi
            // gerekir. İzin verilmemişse telefon sessizce bağlanamaz ve kimse
            // nedenini anlamaz; o yüzden konuyu açıkça burada bildiriyoruz.
            _duvarBandi = new Panel
            {
                Size = new Size(480, 74),
                BackColor = ColorTranslator.FromHtml("#1E1A10"),
                Visible = false
            };
            _duvarBandi.Paint += delegate(object s, PaintEventArgs e)
            {
                using (var p = new Pen(Palet.Amber))
                    e.Graphics.DrawRectangle(p, 0, 0, _duvarBandi.Width - 1, _duvarBandi.Height - 1);
            };
            _duvarMetin = new Label
            {
                Location = new Point(16, 12),
                Size = new Size(448, 36),
                ForeColor = Palet.Metin,
                Font = new Font("Segoe UI", 9f),
                Text = "Telefonun bilgisayara bağlanabilmesi için Windows izni gerekiyor.\r\n" +
                       "Düğmeye basın; Windows bir kez onay isteyecek."
            };
            _duvarDugme = new Dugme("Windows iznini ver", true) { Location = new Point(16, 48), Width = 200 };
            _duvarDugme.Click += delegate { DuzarIzniniVer(); };
            _duvarBandi.Controls.Add(_duvarMetin);
            _duvarBandi.Controls.Add(_duvarDugme);
            _govde.Controls.Add(_duvarBandi);

            // Durum kartı
            _kart = new Panel { Size = new Size(480, 62), BackColor = Palet.Yuzey };
            _kart.Paint += delegate(object s, PaintEventArgs e)
            {
                using (var p = new Pen(Palet.Kenar))
                    e.Graphics.DrawRectangle(p, 0, 0, _kart.Width - 1, _kart.Height - 1);
            };
            _nokta = new Panel { Location = new Point(16, 16), Size = new Size(12, 12), BackColor = Palet.Soluk };
            _nokta.Paint += delegate(object s, PaintEventArgs e)
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                // Panel önce kendi zeminini boyar; daire dışı kısmı kartın
                // rengine dönmeli, yoksa nokta kare görünür.
                using (var zemin = new SolidBrush(Palet.Yuzey))
                    e.Graphics.FillRectangle(zemin, 0, 0, 12, 12);
                using (var b = new SolidBrush(_nokta.BackColor))
                    e.Graphics.FillEllipse(b, 0, 0, 12, 12);
            };
            _durumMetin = new Label
            {
                Location = new Point(38, 11),
                Size = new Size(300, 20),
                ForeColor = Palet.Metin,
                Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                Text = "Başlatılıyor..."
            };
            _durumAciklama = new Label
            {
                Location = new Point(38, 33),
                Size = new Size(424, 18),
                ForeColor = Palet.Soluk,
                Font = new Font("Segoe UI", 8.5f),
                Text = "Servis arka planda başlatılıyor."
            };
            _kart.Controls.Add(_nokta);
            _kart.Controls.Add(_durumMetin);
            _kart.Controls.Add(_durumAciklama);
            _govde.Controls.Add(_kart);

            // Bilgi satırları (etiket + değer birlikte konumlanmalı)
            _bilgiEtiketleri = new List<Label>();
            _bilgiSatirlari = new List<Label>();
            _panelSatir = BilgiSatiri("Panel", Yol.YerelPanel);
            _telefonSatir = BilgiSatiri("Telefonda", Yol.TelefonUygulamasi);
            _agSatir = BilgiSatiri("Ağdan", "—");
            _plakaSatir = BilgiSatiri("Plaka motoru", "—");
            _excelSatir = BilgiSatiri("Excel dosyası", Yol.ExcelYolu);
            _kayitSatir = BilgiSatiri("Kayıt", "—");
            _gunlukSatir = BilgiSatiri("Son yazma", "—");

            // Düğmeler
            _panelDugme = new Dugme("Paneli Aç", true) { Width = 150 };
            _panelDugme.Click += delegate { PanelAc(); };
            _telefonDugme = new Dugme("Telefon Uygulaması", false) { Width = 150 };
            _telefonDugme.Click += delegate { TelefonAc(); };
            _excelDugme = new Dugme("Excel'i Aç", false) { Width = 224 };
            _excelDugme.Click += delegate { ExcelAc(); };
            _klasorDugme = new Dugme("Veri Klasörü", false) { Width = 224 };
            _klasorDugme.Click += delegate { KlasorAc(); };

            _yenidenDugme = new Dugme("Servisi Yeniden Başlat", false) { Width = 224 };
            _yenidenDugme.Click += delegate { ServisiYenidenBaslat(); };
            _otoBaslat = new CheckBox
            {
                Text = "Açılışta otomatik başlat",
                Size = new Size(242, 24),
                ForeColor = Palet.Metin,
                BackColor = Palet.Zemin,
                Font = new Font("Segoe UI", 8.5f),
                FlatStyle = FlatStyle.Flat,
                Checked = OtomatikBaslatAcik(),
                Cursor = Cursors.Hand
            };
            _otoBaslat.CheckedChanged += delegate { OtomatikBaslatAyarla(_otoBaslat.Checked); };

            _ipucu = new Label
            {
                Text = "Kayıtlar arka planda aktarılır.",
                Size = new Size(232, 20),
                ForeColor = Palet.Soluk,
                Font = new Font("Segoe UI", 8f)
            };
            _kapatDugme = new Dugme("Gizle", false) { Width = 112 };
            _kapatDugme.Click += delegate { TepsiyeGizle(); };
            _durDugme = new Dugme("Servisi Durdur", false) { Width = 122 };
            _durDugme.Click += delegate { ServisiDurdur(); };

            _govde.Controls.Add(_panelDugme);
            _govde.Controls.Add(_telefonDugme);
            _govde.Controls.Add(_klasorDugme);
            _govde.Controls.Add(_yenidenDugme);
            _govde.Controls.Add(_excelDugme);
            _govde.Controls.Add(_otoBaslat);
            _govde.Controls.Add(_ipucu);
            _govde.Controls.Add(_kapatDugme);
            _govde.Controls.Add(_durDugme);

            Yerles(false);

            FormClosing += delegate(object s, FormClosingEventArgs e)
            {
                if (_kapaniyor) return;
                e.Cancel = true;
                Tasi();
                Hide();
                // Kullanıcı X'e bastığında: servis durmadı, neden görünmüyor açıkla.
                if (_baslatildi)
                    BallonBildir("Çınarköy Excel Sync",
                        "Servis arka planda çalışmaya devam ediyor. Pencereyi geri getirmek için " +
                        "sağ alttaki simgeye tıklayın. Tamamen kapatmak için: simge > Programı kapat.");
            };
        }

        /// Tüm düğme ve metin konumlarını dikey olarak dizer.
        /// Windows izni bandı açılıp kapandığında da aynı işlev çağrılır;
        /// böylece yerleşim tek yerde tanımlıdır ve dağılmaz.
        private void Yerles(bool duvarGorunur)
        {
            _duvarBandi.Visible = duvarGorunur;
            _duvarBandi.Location = new Point(20, 0);

            int y = duvarGorunur ? 88 : 0;
            _kart.Location = new Point(20, y);
            y += 76;

            BilgiSatiriTasi(_panelSatir, y); y += 26;
            BilgiSatiriTasi(_telefonSatir, y); y += 26;
            BilgiSatiriTasi(_agSatir, y); y += 26;
            BilgiSatiriTasi(_plakaSatir, y); y += 26;
            BilgiSatiriTasi(_excelSatir, y); y += 26;
            BilgiSatiriTasi(_kayitSatir, y); y += 26;
            BilgiSatiriTasi(_gunlukSatir, y); y += 20;

            _panelDugme.Location = new Point(20, y);
            _telefonDugme.Location = new Point(178, y);
            _klasorDugme.Location = new Point(336, y);
            y += 46;

            _yenidenDugme.Location = new Point(20, y);
            _excelDugme.Location = new Point(252, y);
            _otoBaslat.Location = new Point(20, y + 46);
            y += 46 + 30;   // düğme satırı + onay kutusu satırı

            _ipucu.Location = new Point(20, y + 12);
            _kapatDugme.Location = new Point(258, y);
            _durDugme.Location = new Point(378, y);
            y += 36;

            // Yükseklik içeriğin gerçekten bittiği noktadan hesaplanır; elle
            // sabit sayı vermek farklı yazı tipi ölçülerinde taşmaya yol açar.
            ClientSize = new Size(520, 74 + y + 14);
        }

        /// Bir bilgi satırının ETİKET ve DEĞERini birlikte taşır.
        /// (Sadece değeri taşımak etiketi yerinde bırakıyordu.)
        private void BilgiSatiriTasi(Label deger, int y)
        {
            deger.Location = new Point(134, y);
            int i = _bilgiSatirlari.IndexOf(deger);
            if (i >= 0 && i < _bilgiEtiketleri.Count)
                _bilgiEtiketleri[i].Location = new Point(20, y);
        }

        private Label BilgiSatiri(string etiket, string deger)
        {
            var l = new Label
            {
                Location = new Point(20, 0),
                Size = new Size(110, 22),
                ForeColor = Palet.Soluk,
                Font = new Font("Segoe UI", 8.5f),
                Text = etiket
            };
            var d = new Label
            {
                Location = new Point(134, 0),
                Size = new Size(366, 22),
                ForeColor = Palet.Metin,
                Font = new Font("Segoe UI", 9f),
                Text = deger,
                AutoEllipsis = true
            };
            _govde.Controls.Add(l);
            _govde.Controls.Add(d);
            _bilgiEtiketleri.Add(l);   // Yerles() ikisini birlikte taşır
            _bilgiSatirlari.Add(d);
            return d;
        }

        // ---------------------------------------------------------------------
        private ContextMenuStrip TepsiMenusu()
        {
            var m = new ContextMenuStrip { ShowImageMargin = false, Font = new Font("Segoe UI", 9f) };
            m.Items.Add("Paneli Aç", null, delegate { TepsiGoster(); PanelAc(); });
            m.Items.Add("Telefon uygulamasını aç", null, delegate { TepsiGoster(); TelefonAc(); });
            m.Items.Add("Excel dosyasını aç", null, delegate { ExcelAc(); });
            m.Items.Add("Veri klasörünü aç", null, delegate { KlasorAc(); });
            m.Items.Add(new ToolStripSeparator());
            m.Items.Add("Servisi yeniden başlat", null, delegate { TepsiGoster(); ServisiYenidenBaslat(); });
            m.Items.Add(new ToolStripSeparator());
            m.Items.Add("Programı kapat (servis çalışmaya devam eder)", null, delegate { KapatVeCik(); });
            return m;
        }

        // ---------------------------------------------------------------------
        private void Calistir(bool tarayiciyiAc, bool tepsiKipi)
        {
            var isAkisi = new Thread(delegate()
            {
                ServisDurumu d = Servis.Sorgula();
                if (!d.Ayakta)
                {
                    string hata;
                    if (!Servis.Baslat(out hata))
                    {
                        Bitiyorum();
                        BasariHatasi(hata);
                        return;
                    }
                    Servis.BekleVeAc(out d);
                }

                _baslatildi = true;
                try
                {
                    if (IsHandleCreated)
                        BeginInvoke(new MethodInvoker(delegate
                        {
                            DurumCiz(d);
                            if (tarayiciyiAc && d.Ayakta) PanelAc();
                            if (tepsiKipi) { Hide(); }
                        }));
                }
                catch { }
                DuzarKontrolu();
                NabizBaslat();
            });
            isAkisi.IsBackground = true;
            isAkisi.Start();
        }

        private void NabizBaslat()
        {
            _nabiz = new System.Threading.Timer(delegate
            {
                if (_kapaniyor) return;
                ServisDurumu d = Servis.Sorgula();

                // Servis kendiliğinden durdu/çöktüyse kaldır yerine yeniden
                // başlat. Böylece bilgisayar yeniden açıldığında, güncelleme
                // sonrasında ya da bir hata sonrası kullanıcı hiçbir şey
                // yapmadan toparlanır. (Sınırlı sayıda denenir, sonsuz döngüye
                // girmez.)
                if (!d.Ayakta && _baslatildi && !_servisiDurdurduk && _yenidenDeneme < 10)
                {
                    int deneme = System.Threading.Interlocked.Increment(ref _yenidenDeneme);
                    string hata;
                    if (Servis.Baslat(out hata))
                    {
                        ServisDurumu d2;
                        Servis.BekleVeAc(out d2);
                        try
                        {
                            if (IsHandleCreated)
                                BeginInvoke(new MethodInvoker(delegate
                                {
                                    DurumCiz(d2);
                                    if (d2.Ayakta)
                                        BallonBildir("Çınarköy Excel Sync",
                                            "Servis kendiliğinden yeniden başlatıldı. Kayıtlar aktarılmaya devam ediyor.");
                                }));
                        }
                        catch { }
                    }
                    return;
                }

                if (d.Ayakta != _durum.Ayakta || d.KayitSayisi != _durum.KayitSayisi)
                {
                    try
                    {
                        if (IsHandleCreated) BeginInvoke(new MethodInvoker(delegate { DurumCiz(d); }));
                    }
                    catch { }
                }
            }, null, 4000, 4000);
        }

        private void DurumCiz(ServisDurumu d)
        {
            _durum = d;
            if (d.Ayakta)
            {
                _nokta.BackColor = Palet.Yesil;
                _nokta.Refresh();
                _durumMetin.Text = "Servis çalışıyor";
                _durumAciklama.Text = "Kayıtlar arka planda aktarılıyor. Bu pencereyi kapatabilirsiniz.";
                _kayitSatir.Text = d.KayitSayisi.ToString("N0", CultureInfo.CurrentCulture) + " kayıt";
                _agSatir.Text = string.IsNullOrEmpty(d.AgAdresleri) ? Yol.YerelPanel : d.AgAdresleri;
                _gunlukSatir.Text = ZamanBicim(d.SonYazma);
                if (!d.PlakaAktif)
                    _plakaSatir.Text = "yok — " + (d.PlakaSebep ?? "kurulamadı");
                else if (d.PlakaHazir)
                    _plakaSatir.Text = "hazır · " + (string.IsNullOrEmpty(d.PlakaDil) ? "yerel" : d.PlakaDil);
                else
                    _plakaSatir.Text = "ilk kullanımda yükleniyor";
                _durDugme.Enabled = true;
                _yenidenDugme.Text = "Servisi Yeniden Başlat";
                _servisiDurdurduk = false;
            }
            else
            {
                _nokta.BackColor = Palet.Kirmizi;
                _nokta.Refresh();
                _durumMetin.Text = _servisiDurdurduk ? "Servis durduruldu" : "Servis durdu";
                _durumAciklama.Text = _servisiDurdurduk
                    ? "Telefondaki kayıtlar biriktirilir; servis açılınca aktarılır."
                    : (string.IsNullOrEmpty(d.Hata)
                        ? "Servis yanıt vermiyor. Kendiliğinden yeniden başlatılacak."
                        : d.Hata);
                _kayitSatir.Text = "—";
                _gunlukSatir.Text = "—";
                _plakaSatir.Text = "—";
                _durDugme.Enabled = false;
                _yenidenDugme.Text = _servisiDurdurduk ? "Servisi Aç" : "Servisi Yeniden Başlat";
            }
            _panelDugme.Enabled = d.Ayakta;
        }

        private static string ZamanBicim(string iso)
        {
            if (string.IsNullOrEmpty(iso)) return "—";
            DateTime t;
            if (DateTime.TryParse(iso, CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out t))
                return t.ToLocalTime().ToString("d MMMM yyyy, HH:mm", new CultureInfo("tr-TR"));
            return iso;
        }

        // ---------------------------------------------------------------------
        private void Tasi() { if (!_baslatildi) return; if (Visible) Hide(); }

        private void TepsiyeGizle()
        {
            Hide();
            BallonBildir("Çınarköy Excel Sync", "Servis arka planda çalışmaya devam ediyor.");
        }

        private void TepsiGoster()
        {
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        private void BallonBildir(string baslik, string mesaj)
        {
            try
            {
                _tepsi.BalloonTipTitle = baslik;
                _tepsi.BalloonTipText = mesaj;
                _tepsi.ShowBalloonTip(4000);
            }
            catch { }
        }

        private void PanelAc()
        {
            if (!_durum.Ayakta) { Mesaj("Servis henüz ayakta değil.\nYeniden başlatılıyor..."); return; }
            string url = string.IsNullOrEmpty(_durum.AgAdresleri) ? Yol.YerelPanel : _durum.AgAdresleri.Split(',')[0].Trim();
            // Panelde QR'ı telefon okutacağız: yerel adresi tercih et.
            TarayiciAc(Yol.YerelPanel);
            GC.KeepAlive(url);
        }

        /// Telefon uygulamasını açar. Uygulama servis tarafından yayınlandığı
        /// için adres her zaman doğrudur; IP değişikliği eşleşmeyi bozmaz.
        private void TelefonAc()
        {
            if (!_durum.Ayakta) { Mesaj("Servis henüz ayakta değil.\nYeniden başlatılıyor..."); return; }
            TarayiciAc(Yol.TelefonUygulamasi);
        }

        private void TarayiciAc(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch (Exception e) { Mesaj("Tarayıcı açılamadı:\n" + e.Message + "\n\nAdresi elle açabilirsiniz:\n" + url); }
        }

        private void ExcelAc()
        {
            try
            {
                if (!File.Exists(Yol.ExcelYolu))
                {
                    Mesaj("Excel dosyası henüz oluşmadı.\n\nTelefondan ilk kayıt gönderildiğinde kendiliğinden oluşur.\n\nBeklenen konum:\n" + Yol.ExcelYolu);
                    return;
                }
                Process.Start(new ProcessStartInfo(Yol.ExcelYolu) { UseShellExecute = true });
            }
            catch (Exception e) { Mesaj("Excel açılamadı:\n" + e.Message + "\n\nDosyayı elle açabilirsiniz:\n" + Yol.ExcelYolu); }
        }

        private void KlasorAc()
        {
            try
            {
                if (!Directory.Exists(Yol.VeriDizini)) Directory.CreateDirectory(Yol.VeriDizini);
                Process.Start(new ProcessStartInfo("explorer.exe", "\"" + Yol.VeriDizini + "\"") { UseShellExecute = true });
            }
            catch (Exception e) { Mesaj("Klasör açılamadı:\n" + e.Message); }
        }

        private void YenidenBaslat()
        {
            DurumBekle("Servis yeniden başlatılıyor...");
            var isAkisi = new Thread(delegate()
            {
                Servis.Durdur();
                Thread.Sleep(900);
                string hata;
                if (!Servis.Baslat(out hata)) { BasariHatasi(hata); return; }
                ServisDurumu d;
                Servis.BekleVeAc(out d);
                try { if (IsHandleCreated) BeginInvoke(new MethodInvoker(delegate { DurumCiz(d); })); }
                catch { }
            });
            isAkisi.IsBackground = true;
            isAkisi.Start();
        }

        /// Kullanıcı bilerek durdurduktan sonra yeniden başlatmak isterse.
        private void ServisiYenidenBaslat()
        {
            _servisiDurdurduk = false;
            _yenidenDeneme = 0;
            YenidenBaslat();
        }

        private void ServisiDurdur()
        {
            var cevap = MessageBox.Show(
                "Servis durdurulacak. Telefondan gelen kayıtlar telefonda biriktirilir ve servis yeniden " +
                "başlatıldığında aktarılır.\n\n" +
                "Bilgisayarı yeniden başlattığınızda servis kendiliğinden açılır.\n\nDevam edilsin mi?",
                "Servisi durdur", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (cevap != DialogResult.Yes) return;
            _servisiDurdurduk = true;   // otomatik yeniden başlatma devre dışı
            Servis.Durdur();
            DurumCiz(new ServisDurumu { Ayakta = false, Hata = "Kullanıcı tarafından durduruldu." });
        }

        private void DurumBekle(string mesaj)
        {
            _durumMetin.Text = mesaj;
            _durumAciklama.Text = "Birkaç saniye sürebilir.";
            _nokta.BackColor = Palet.Amber;
            _nokta.Refresh();
        }

        private void BasariHatasi(string mesaj)
        {
            try
            {
                if (IsHandleCreated)
                    BeginInvoke(new MethodInvoker(delegate
                    {
                        DurumBekle("Başlatılamadı");
                        Mesaj(mesaj);
                    }));
            }
            catch { }
        }

        // ---------------------------------------------------------------------
        //  Windows güvenlik duvarı izni
        // ---------------------------------------------------------------------
        /// Düz arka planda: kural var mı diye bakar, gerekiyorsa bandı açar.
        private void DuzarKontrolu()
        {
            if (_duvarSorgulandi) return;
            _duvarSorgulandi = true;
            var isParcasi = new Thread(delegate()
            {
                bool varMi;
                try { varMi = Duar.KuralVar(); }
                catch { varMi = true; }   // emin olamadıkça kullanıcıyı yorma
                if (varMi) return;
                try
                {
                    if (IsHandleCreated) BeginInvoke(new MethodInvoker(delegate { Yerles(true); }));
                }
                catch { }
            });
            isParcasi.IsBackground = true;
            isParcasi.Start();
        }

        /// Düğmeye basıldığında: tek seferlik yönetici onayıyla kuralı ekler.
        private void DuzarIzniniVer()
        {
            _duvarDugme.Enabled = false;
            _duvarDugme.Text = "Açılıyor...";
            _duvarMetin.Text = "Windows onay penceresini açtı. 'Evet' deyin.";
            Application.DoEvents();

            var isParcasi = new Thread(delegate()
            {
                string hata = "";
                try { Duar.KuralEkle(); }
                catch (Exception e) { hata = e.Message; }
                System.Threading.Thread.Sleep(2500);
                bool tamam = false;
                try { tamam = Duar.KuralVar(); } catch { }

                try
                {
                    if (IsHandleCreated)
                        BeginInvoke(new MethodInvoker(delegate
                        {
                            if (tamam)
                            {
                                Yerles(false);
                                BallonBildir("Çınarköy Excel Sync",
                                    "İzin verildi. Telefon artık bilgisayara bağlanabilir.");
                            }
                            else
                            {
                                _duvarDugme.Enabled = true;
                                _duvarDugme.Text = "Windows iznini ver";
                                _duvarMetin.Text = string.IsNullOrEmpty(hata)
                                    ? "İzin verilmedi. Telefon bağlanamayabilir. Düğmeye tekrar basmayı deneyin."
                                    : "İzin verilemedi: " + hata;
                            }
                        }));
                }
                catch { }
            });
            isParcasi.IsBackground = true;
            isParcasi.Start();
        }

        private void Mesaj(string metin)
        {
            MessageBox.Show(metin, "Çınarköy Excel Sync", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        private void Bitiyorum()
        {
            try { if (IsHandleCreated) BeginInvoke(new MethodInvoker(delegate { Application.Exit(); })); }
            catch { Application.Exit(); }
        }

        // ---------------------------------------------------------------------
        //  Windows açılışında otomatik başlatma
        // ---------------------------------------------------------------------
        private static bool OtomatikBaslatAcik()
        {
            try
            {
                RegistryKey anahtar = Registry.CurrentUser.OpenSubKey(CalismaAnahtari);
                if (anahtar == null) return false;
                try { return anahtar.GetValue("CinarkoySync") != null; }
                finally { anahtar.Dispose(); }
            }
            catch { return false; }
        }

        private void OtomatikBaslatAyarla(bool acik)
        {
            try
            {
                RegistryKey anahtar = Registry.CurrentUser.CreateSubKey(CalismaAnahtari);
                if (anahtar == null) return;
                try
                {
                    if (acik) anahtar.SetValue("CinarkoySync", "\"" + Yol.ExeYolu + "\" --tray", RegistryValueKind.String);
                    else anahtar.DeleteValue("CinarkoySync", false);
                }
                finally { anahtar.Dispose(); }
            }
            catch (Exception e) { Mesaj("Otomatik başlatma ayarı kaydedilemedi:\n" + e.Message); }
        }

        // ---------------------------------------------------------------------
        private void KapatVeCik()
        {
            _kapaniyor = true;
            try { if (_nabiz != null) _nabiz.Dispose(); } catch { }
            try { if (_tepsi != null) { _tepsi.Visible = false; _tepsi.Dispose(); } } catch { }
            Application.Exit();
        }
    }
}
