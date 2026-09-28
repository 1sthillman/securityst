@echo off
REM ===========================================================================
REM  Cinarkoy Excel Sync - Windows kurulum (gelistirici / sunucu modu)
REM
REM  ONERI: Kullanicilar icin kurulum .exe'i kullanin:
REM         release\CinarkoySync-Kur-1.2.0.exe
REM         -> Node.js kurulumu gerektirmez, UAC istemez, masaustune simge
REM            koyar, programi tek tikla acar. Bu betik yalnizca Node.js
REM            zaten kurulu olan gelistirici makinelerde pm2 ile servis
REM            kurmak icindir.
REM
REM  1) Node LTS kurulu olmali: https://nodejs.org
REM  2) Bu dosyayi companion klasorunde yonetici olarak calistirin.
REM ===========================================================================
setlocal EnableExtensions EnableDelayedExpansion

cd /d %~dp0
echo [1/4] Bagimliliklar kuruluyor...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 ( echo HATA: npm install basarisiz & pause & exit /b 1 )

echo [2/4] Guvenlik duvari kurali (TCP 4545, yerel ag)...
netsh advfirewall firewall show rule name="Cinarkoy Excel Sync" >nul 2>&1
if errorlevel 1 (
  netsh advfirewall firewall add rule name="Cinarkoy Excel Sync" dir=in action=allow protocol=TCP localport=4545 profile=private
) else (
  echo Guvenlik duvari kurali zaten var.
)

echo [3/4] pm2 kuruluyor...
call npm install -g pm2 --no-audit --no-fund
if errorlevel 1 ( echo HATA: pm2 kurulamadi & pause & exit /b 1 )

REM ---- pm2 bulma: npm global klasoru bu pencerede PATH'te olmayabilir ----
REM (Ekrandaki "'pm2' is not recognized" hatasinin sebebi budur.)
REM NOT: PM2CALL yolu bosluk icerebilir (C:\Users\Ad Soyad\...) diye tirnakla tutulur.
set "PM2CALL="
where pm2 >nul 2>&1
if not errorlevel 1 set "PM2CALL=pm2"
if defined PM2CALL goto :pm2found
for /f "delims=" %%p in ('npm config get prefix') do set "NPMPREFIX=%%p"
call :checkprefix
if defined PM2CALL goto :pm2found
echo npm global klasoru PATH'te degil, kalici olarak ekleniyor...
echo ;%PATH%; | find /i ";%NPMPREFIX%;" >nul 2>&1
if errorlevel 1 setx PATH "!PATH!;%NPMPREFIX%" >nul 2>&1
call :checkprefix
if defined PM2CALL goto :pm2found
echo pm2.cmd bulunamadi, npx ile calistiriliyor...
set "PM2CALL=npx --yes pm2@latest"

:pm2found
echo pm2 komutu: %PM2CALL%
call %PM2CALL% start ecosystem.config.js
if errorlevel 1 ( echo HATA: pm2 start basarisiz & pause & exit /b 1 )
call %PM2CALL% save

echo [4/4] Otomatik baslatma (Windows gorev zamanlayici)...
echo Lutfen su komutun verdigi talimati uygulayin:
call %PM2CALL% startup

echo.
echo Kurulum tamam. Panel: http://localhost:4545/  Saglik: http://localhost:4545/saglik
pause
exit /b 0

:checkprefix
if exist "%NPMPREFIX%\pm2.cmd" set "PM2CALL="!NPMPREFIX!\pm2.cmd""
exit /b 0
