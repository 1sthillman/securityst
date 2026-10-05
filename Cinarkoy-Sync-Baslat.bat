@echo off
REM Cinarkoy Excel Sync Baslatici
REM Bu dosyayi cift tiklayarak servisi baslatin

cd /d "%~dp0companion"
start "" "CinarkoySync.exe"

echo.
echo =====================================
echo  Cinarkoy Excel Sync Baslatildi!
echo =====================================
echo.
echo Sistem tepsisinde turuncu ikonu goreceksiniz.
echo Paneli acmak icin ikona tiklayin.
echo.
echo Bu pencereyi kapatabilirsiniz.
echo.
timeout /t 5
exit
