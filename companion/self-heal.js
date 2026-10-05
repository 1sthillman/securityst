/**
 * SELF-HEALING SİSTEMİ
 * Sistem sorunlarını otomatik tespit edip düzeltir
 */
'use strict';

const fs = require('fs');
const path = require('path');

class SelfHealing {
  constructor(config = {}) {
    this.dataDir = config.dataDir || path.join(__dirname, 'data');
    this.backupDir = path.join(this.dataDir, 'yedek');
    this.checkInterval = config.checkInterval || 30000; // 30 saniye
    this.maxBackups = config.maxBackups || 10;
    this.isRunning = false;
    this.checks = [];
    
    this.ensureDirectories();
  }

  ensureDirectories() {
    [this.dataDir, this.backupDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  // Otomatik backup sistemi
  createBackup(filePath, reason = 'auto') {
    try {
      if (!fs.existsSync(filePath)) return null;
      
      const fileName = path.basename(filePath);
      const timestamp = Date.now();
      const backupName = `${timestamp}-${reason}-${fileName}`;
      const backupPath = path.join(this.backupDir, backupName);
      
      fs.copyFileSync(filePath, backupPath);
      
      // Eski yedekleri temizle
      this.cleanOldBackups(fileName);
      
      return backupPath;
    } catch (e) {
      console.error('[Self-Heal] Backup hatası:', e.message);
      return null;
    }
  }

  cleanOldBackups(fileName) {
    try {
      const backups = fs.readdirSync(this.backupDir)
        .filter(f => f.endsWith(fileName))
        .map(f => ({
          name: f,
          path: path.join(this.backupDir, f),
          time: parseInt(f.split('-')[0])
        }))
        .sort((a, b) => b.time - a.time);
      
      // En son N tanesini tut, geri kalanını sil
      backups.slice(this.maxBackups).forEach(backup => {
        try {
          fs.unlinkSync(backup.path);
        } catch (e) {
          // Sessiz hata
        }
      });
    } catch (e) {
      // Sessiz hata
    }
  }

  // Dosya bütünlüğü kontrolü
  validateFile(filePath, validator) {
    try {
      if (!fs.existsSync(filePath)) return { ok: false, reason: 'Dosya yok' };
      
      const content = fs.readFileSync(filePath, 'utf8');
      
      if (validator) {
        const result = validator(content);
        if (!result.ok) return result;
      }
      
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  // JSON dosyası kontrolü
  validateJSON(filePath) {
    return this.validateFile(filePath, content => {
      try {
        JSON.parse(content);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: 'JSON parse hatası: ' + e.message };
      }
    });
  }

  // JSONL dosyası kontrolü
  validateJSONL(filePath) {
    return this.validateFile(filePath, content => {
      try {
        const lines = content.trim().split('\n').filter(Boolean);
        for (const line of lines) {
          JSON.parse(line);
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: 'JSONL parse hatası: ' + e.message };
      }
    });
  }

  // Bozuk dosyayı onar
  repairFile(filePath, validator) {
    try {
      // 1. Backup al
      this.createBackup(filePath, 'before-repair');
      
      // 2. En son geçerli backup'ı bul
      const fileName = path.basename(filePath);
      const backups = fs.readdirSync(this.backupDir)
        .filter(f => f.endsWith(fileName))
        .map(f => ({
          name: f,
          path: path.join(this.backupDir, f),
          time: parseInt(f.split('-')[0])
        }))
        .sort((a, b) => b.time - a.time);
      
      for (const backup of backups) {
        const check = this.validateFile(backup.path, validator);
        if (check.ok) {
          fs.copyFileSync(backup.path, filePath);
          console.log('[Self-Heal] ✓ Dosya onarıldı:', fileName, 'kaynak:', backup.name);
          return { ok: true, restoredFrom: backup.name };
        }
      }
      
      // 3. Geçerli backup bulunamadı, yeni oluştur
      const defaultContent = this.getDefaultContent(filePath);
      if (defaultContent !== null) {
        fs.writeFileSync(filePath, defaultContent, 'utf8');
        console.log('[Self-Heal] ✓ Dosya varsayılan içerikle oluşturuldu:', fileName);
        return { ok: true, createdDefault: true };
      }
      
      return { ok: false, reason: 'Onarım başarısız' };
    } catch (e) {
      console.error('[Self-Heal] Onarım hatası:', e.message);
      return { ok: false, reason: e.message };
    }
  }

  getDefaultContent(filePath) {
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);
    
    if (ext === '.json') {
      if (name.includes('eslesmeler')) return '[]';
      if (name.includes('seen-ids')) return '[]';
      return '{}';
    }
    
    if (ext === '.jsonl') {
      return '';
    }
    
    return null;
  }

  // Check kaydı ekle
  addCheck(name, checkFn, repairFn) {
    this.checks.push({ name, checkFn, repairFn });
  }

  // Tek check çalıştır
  async runCheck(check) {
    try {
      const result = await check.checkFn();
      if (!result.ok && check.repairFn) {
        console.log('[Self-Heal] Problem tespit edildi:', check.name, '→', result.reason);
        const repairResult = await check.repairFn(result);
        if (repairResult.ok) {
          console.log('[Self-Heal] ✓ Onarım başarılı:', check.name);
        } else {
          console.error('[Self-Heal] ✗ Onarım başarısız:', check.name, repairResult.reason);
        }
        return repairResult;
      }
      return result;
    } catch (e) {
      console.error('[Self-Heal] Check hatası:', check.name, e.message);
      return { ok: false, reason: e.message };
    }
  }

  // Tüm checkleri çalıştır
  async runAllChecks() {
    const results = [];
    for (const check of this.checks) {
      const result = await this.runCheck(check);
      results.push({ name: check.name, ...result });
    }
    return results;
  }

  // Otomatik kontrol başlat
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log('[Self-Heal] Otomatik kontrol başlatıldı, interval:', this.checkInterval + 'ms');
    
    // İlk check hemen çalıştır
    this.runAllChecks();
    
    // Periyodik check
    this.intervalId = setInterval(() => {
      this.runAllChecks();
    }, this.checkInterval);
  }

  // Durdur
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[Self-Heal] Otomatik kontrol durduruldu');
  }
}

module.exports = SelfHealing;
