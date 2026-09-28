# Uygulama simgesini (multi-size .ico) üretir.
# Simge, Başlatıcı.cs içindeki çizimle birebir aynı motifin çalışma anı
# görselidir: koyu yuvarlak zemin, amber tablo, beyaz aşağı ok.
#
# Not: System.Drawing her boyutta 32-bit BMP ikon üretir (GetHicon yolu),
# bu yüzden ikonlar her Windows sürümünde sorunsuz görünür.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IcoYardimci {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool DestroyIcon(IntPtr h);
}
'@

function Yap-Bitmap([int]$b) {
    $bmp = New-Object System.Drawing.Bitmap($b, $b, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Transparent)

    $o = $b * 0.06; $gg = $b - 2 * $o
    $r = $gg * 0.24

    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($o, $o, $r, $r, 180, 90)
    $p.AddArc(($o + $gg - $r), $o, $r, $r, 270, 90)
    $p.AddArc(($o + $gg - $r), ($o + $gg - $r), $r, $r, 0, 90)
    $p.AddArc($o, ($o + $gg - $r), $r, $r, 90, 90)
    $p.CloseFigure()
    $zemin = [System.Drawing.ColorTranslator]::FromHtml('#0B0F10')
    $kenar = [System.Drawing.ColorTranslator]::FromHtml('#232C30')
    $g.FillPath((New-Object System.Drawing.SolidBrush($zemin)), $p)
    $g.DrawPath((New-Object System.Drawing.Pen($kenar, [float][Math]::Max(1.0, $b / 32.0))), $p)
    $p.Dispose()

    $amber = [System.Drawing.ColorTranslator]::FromHtml('#F5A524')
    $sx = $b * 0.26; $sy = $b * 0.22; $sw = $b * 0.48; $sh = $b * 0.38
    $g.FillRectangle((New-Object System.Drawing.SolidBrush($amber)), $sx, $sy, $sw, $sh)
    $cizg = [System.Drawing.Color]::FromArgb(70, 11, 15, 16)
    $cb = New-Object System.Drawing.SolidBrush($cizg)
    $lw = [float][Math]::Max(1.0, $b / 40.0)
    1..3 | ForEach-Object { $g.FillRectangle($cb, $sx, ($sy + $sh * $_ / 4.0), $sw, $lw) }
    1..2 | ForEach-Object { $g.FillRectangle($cb, ($sx + $sw * $_ / 3.0), $sy, $lw, $sh) }
    $cb.Dispose()

    $metin = [System.Drawing.ColorTranslator]::FromHtml('#EEF2F0')
    $cx = $b * 0.5; $aw = $b * 0.20; $top = $b * 0.64; $hgt = $b * 0.20
    $mb = New-Object System.Drawing.SolidBrush($metin)
    $g.FillRectangle($mb, ($cx - $aw * 0.32), ($top - $hgt), ($aw * 0.64), $hgt)
    $ok = New-Object 'System.Drawing.PointF[]' 3
    $ok[0] = New-Object System.Drawing.PointF([float]($cx - $aw), [float]($top - $hgt * 0.35))
    $ok[1] = New-Object System.Drawing.PointF([float]($cx + $aw), [float]($top - $hgt * 0.35))
    $ok[2] = New-Object System.Drawing.PointF([float]$cx, [float]($top + $hgt * 0.35))
    $g.FillPolygon($mb, $ok)
    $mb.Dispose()

    $g.Dispose()
    return $bmp
}

$boyutlar = @(16, 24, 32, 48, 64, 128, 256)
$resimler = @()
foreach ($b in $boyutlar) {
    $bmp = Yap-Bitmap $b
    $h = $bmp.GetHicon()
    try {
        $ikon = [System.Drawing.Icon]::FromHandle($h)
        $ms = New-Object System.IO.MemoryStream
        $ikon.Save($ms)
        $bayt = $ms.ToArray(); $ms.Dispose()
        # .ico = 6 bayt ICONDIR + 16 bayt entry + 22'den sonrası resim
        $uzunluk = $bayt.Length - 22
        $resim = New-Object byte[] $uzunluk
        [System.Buffer]::BlockCopy($bayt, 22, $resim, 0, $uzunluk)
        $resimler += ,@($b, $resim)
    }
    finally {
        [IcoYardimci]::DestroyIcon($h) | Out-Null
        $bmp.Dispose()
    }
}

$cikti = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($cikti)
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$resimler.Count)
$ofs = 6 + 16 * $resimler.Count
foreach ($r in $resimler) {
    $b = $r[0]; $d = $r[1]
    if ($b -ge 256) { $w.Write([Byte]0); $w.Write([Byte]0) } else { $w.Write([Byte]$b); $w.Write([Byte]$b) }
    $w.Write([Byte]0); $w.Write([Byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32)
    $w.Write([UInt32]$d.Length); $w.Write([UInt32]$ofs)
    $ofs += $d.Length
}
foreach ($r in $resimler) { $w.Write($r[1]) }
$w.Flush()
$hedef = Join-Path $PSScriptRoot 'app.ico'
[System.IO.File]::WriteAllBytes($hedef, $cikti.ToArray())
$w.Dispose(); $cikti.Dispose()
Write-Output "app.ico uretildi: $hedef ($((Get-Item $hedef).Length) bayt, $($resimler.Count) boyut)"
