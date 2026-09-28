# fast-plate-ocr model dosyalarini indirir.
# Rehber §11: modeller calisma aninda indirilmez, kurulum paketine konur.
# Burada yalnizca GELISTIRME makinesinde bir kez indirilip
# companion/ocr/models/ altina yerlestirilir.
$ErrorActionPreference = 'Stop'
$hedef = 'C:\syncserver\companion\ocr\models'
New-Item -ItemType Directory -Force -Path $hedef | Out-Null

$base = 'https://github.com/ankandrew/fast-plate-ocr/releases/download/arg-plates'
$dosyalar = @(
  'cct_xs_v2_global.onnx',
  'cct_xs_v2_global_plate_config.yaml',
  'cct_xs_v2_global_model_config.yaml',
  'cct_xs_v2_global_val_results.json',
  'cct_s_v2_global.onnx',
  'cct_s_v2_global_plate_config.yaml',
  'cct_s_v2_global_model_config.yaml',
  'cct_s_v2_global_val_results.json',
  'european_mobile_vit_v2_ocr.onnx',
  'european_mobile_vit_v2_ocr_config.yaml',
  'european_mobile_vit_v2_ocr_results.json'
)

foreach ($d in $dosyalar) {
  $yol = Join-Path $hedef $d
  if (Test-Path $yol) {
    $mevcut = (Get-Item $yol).Length
    Write-Host ("ATLANDI  {0,-46} {1,12:N0} B" -f $d, $mevcut)
    continue
  }
  try {
    Invoke-WebRequest -Uri "$base/$d" -OutFile $yol -TimeoutSec 180 -UseBasicParsing
    Write-Host ("INDIRILDI {0,-45} {1,12:N0} B" -f $d, (Get-Item $yol).Length)
  } catch {
    Write-Host ("HATA     {0,-45} {1}" -f $d, $_.Exception.Message) -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "--- SHA-256 (rehber §11: model ozeti kaydedilmeli) ---"
Get-ChildItem $hedef -Filter *.onnx | ForEach-Object {
  $h = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
  Write-Host ("{0,-38} {1}" -f $_.Name, $h)
  # ozeti dosyanin yanina yaz
  "$h  $($_.Name)" | Out-File -FilePath "$($_.FullName).sha256" -Encoding ascii -NoNewline
}
