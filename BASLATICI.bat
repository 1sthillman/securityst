@echo off
chcp 65001 >nul
title Çınarköy Sync Server
echo.
echo ════════════════════════════════════════════════════════════
echo    ÇINARKÖY SYNC SERVER - BAŞLATILIYOR
echo ════════════════════════════════════════════════════════════
echo.

REM Eski kurulumları kapat
echo [1/3] Eski process'ler kapatılıyor...
taskkill /F /IM "CinarkoySync.exe" 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4577"') do taskkill /F /PID %%a 2>nul
timeout /t 2 /nobreak >nul

REM Companion dizinine git
cd /d "%~dp0companion"

REM Server'ı başlat
echo [2/3] Server başlatılıyor...
echo.
echo ┌──────────────────────────────────────────────────────────┐
echo │  Server çalışıyor!                                       │
echo │                                                          │
echo │  Panel:   http://localhost:4545                         │
echo │  Telefon: http://192.168.1.129:4545/telefon/           │
echo │                                                          │
echo │  Kapatmak için bu pencereyi kapatın                     │
echo └──────────────────────────────────────────────────────────┘
echo.
echo [3/3] Log'lar:
echo ────────────────────────────────────────────────────────────

REM Node'u başlat
node companion.js

REM Hata durumunda bekle
if errorlevel 1 (
    echo.
    echo [HATA] Server başlatılamadı!
    echo Node.js kurulu mu? companion.js dosyası mevcut mu?
    pause
)
