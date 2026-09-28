# Test fiksturu uretir: gercekci Turk plaka goruntuleri.
# PowerShell + System.Drawing kullanir. Cikti tests/fixtures/ altina sabit PNG
# olarak yazilir; testler bu dosyalari kullanir (belirlenimci).
#
# ONEMLI: PowerShell 5.1 bu dosyayi ANSI okur. Bu yuzden tanimlayici ve
# yorum satirlari ASCII tutulur; Turkce harf yazilirsa dosya bozulur.
param(
  [string]$Hedef = (Join-Path (Split-Path $PSScriptRoot -Parent) "tests\fixtures")
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Force -Path $Hedef | Out-Null

# Metin, genislik, yukseklik, gurultu, egim, arkaplan tonu, etiket
$Ornekler = @(
  @{ Metin = '34 ABC 123'; Gen = 520; Yuk = 130; Toz = 6;  Egim = 0;    Ton = 246; Etiket = 'plaka-temiz' },
  @{ Metin = '06 KL 2301'; Gen = 520; Yuk = 130; Toz = 18; Egim = -1.2; Ton = 232; Etiket = 'plaka-gri' },
  @{ Metin = '41 TR 908';  Gen = 440; Yuk = 150; Toz = 12; Egim = 0.8;  Ton = 251; Etiket = 'plaka-motosiklet' },
  @{ Metin = '35 AZ 4507'; Gen = 520; Yuk = 130; Toz = 26; Egim = 0;    Ton = 214; Etiket = 'plaka-kirli' }
)

$rastgele = New-Object System.Random 20260928

foreach ($o in $Ornekler) {
  $bmp = New-Object System.Drawing.Bitmap($o.Gen, $o.Yuk)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  # arkaplan: hafif kirli, koyu cerceve (plaka bandi)
  $arka = [System.Drawing.Color]::FromArgb(255, $o.Ton, $o.Ton, [Math]::Min(255, $o.Ton + 4))
  $g.Clear($arka)
  $g.DrawRectangle([System.Drawing.Pens]::DarkGray, 2, 2, ($o.Gen - 5), ($o.Yuk - 5))

  if ($o.Egim -ne 0) {
    $durum = $g.Save()
    $g.TranslateTransform(($o.Gen / 2), ($o.Yuk / 2))
    $g.RotateTransform([single]$o.Egim)
    $g.TranslateTransform(-($o.Gen / 2), -($o.Yuk / 2))
  }

  # TR mavi bandi (sol taraf)
  $mavi = [System.Drawing.Color]::FromArgb(255, 20, 60, 150)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush($mavi)), 8, 10, 46, ($o.Yuk - 20))
  $trYazi = New-Object System.Drawing.Font('Arial', [Math]::Max(11, $o.Yuk * 0.11), [System.Drawing.FontStyle]::Bold)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $trRect = New-Object System.Drawing.RectangleF(8, 10, 46, ($o.Yuk - 20))
  $g.DrawString('TR', $trYazi, [System.Drawing.Brushes]::White, $trRect, $sf)

  # plaka metni  (olceklenerek kutuya tam oturur, hicbir karakter kirpilmaz)
  $metinRect = New-Object System.Drawing.RectangleF(58, 6, ($o.Gen - 66), ($o.Yuk - 12))
  $paragraf = New-Object System.Drawing.StringFormat
  $paragraf.Alignment = [System.Drawing.StringAlignment]::Center
  $paragraf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $paragraf.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
  $olcumYazi = New-Object System.Drawing.Font('Arial', [single]($o.Yuk * 0.62), [System.Drawing.FontStyle]::Bold)
  $olcum = $g.MeasureString($o.Metin, $olcumYazi)
  $olcumYazi.Dispose()
  # Hem genislige hem yukseklige sigacak sekilde olcekle
  $carpan = [Math]::Min(($metinRect.Width * 0.94) / [Math]::Max(1, $olcum.Width), ($o.Yuk * 0.70) / [Math]::Max(1, $olcum.Height))
  $yazi = New-Object System.Drawing.Font('Arial', [single]($o.Yuk * 0.62 * $carpan), [System.Drawing.FontStyle]::Bold)
  $g.DrawString($o.Metin, $yazi, [System.Drawing.Brushes]::Black, $metinRect, $paragraf)

  if ($o.Egim -ne 0) { $g.Restore($durum) }

  # sensor gurultusu + hafif isik dususu (gece cekimi gercekliligi)
  $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $veri = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $bayt = $veri.Scan0
  $satirBayt = $veri.Stride
  for ($y = 0; $y -lt $bmp.Height; $y++) {
    $kararma = 1.0 - (0.18 * ($y / $bmp.Height))
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      $gurultu = $rastgele.Next(-$o.Toz, ($o.Toz + 1))
      for ($k = 0; $k -lt 3; $k++) {
        $ofs = $y * $satirBayt + $x * 3 + $k
        $v = [System.Runtime.InteropServices.Marshal]::ReadByte($bayt, $ofs)
        $v = [int]($v * $kararma) + $gurultu
        if ($v -lt 0) { $v = 0 } elseif ($v -gt 255) { $v = 255 }
        [System.Runtime.InteropServices.Marshal]::WriteByte($bayt, $ofs, [byte]$v)
      }
    }
  }
  $bmp.UnlockBits($veri)
  $g.Dispose()

  $dosya = Join-Path $Hedef ($o.Etiket + '.png')
  $bmp.Save($dosya, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("uretildi: " + $dosya + "  (" + $o.Metin + ")")
}
