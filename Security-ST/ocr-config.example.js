// Multi-OCR API Configuration - EXAMPLE FILE
// ⚠️ Bu dosya sadece örnek içindir. Gerçek key'leriniz için:
// 1. Bu dosyayı kopyalayın: cp ocr-config.example.js ocr-config.js
// 2. ocr-config.js içindeki API key'leri kendi key'lerinizle değiştirin
// 3. ocr-config.js dosyası .gitignore'da - GitHub'a yüklenmeyecek

const OCR_CONFIG = {
  // OCR.space API (Metin tabanlı OCR)
  // ✅ Ücretsiz: 25,000 istek/ay per key
  // 📝 Key almak için: https://ocr.space/ocrapi
  ocrSpace: {
    apiKeys: [
      'YOUR_OCR_SPACE_KEY_1',  // Key 1: 25,000/ay
      'YOUR_OCR_SPACE_KEY_2',  // Key 2: 25,000/ay
      'YOUR_OCR_SPACE_KEY_3'   // Key 3: 25,000/ay
    ],
    apiUrl: 'https://api.ocr.space/parse/image',
    totalCapacity: {
      monthly: 75000,
      daily: 2500,
      hourly: 104
    }
  },
  
  // API Ninjas - Image-to-Text API (Alternatif OCR)
  // ✅ Ücretsiz: 50,000 istek/ay per key
  // 📝 Key almak için: https://api-ninjas.com/api/imagetotext
  apiNinjas: {
    apiKeys: [
      'YOUR_API_NINJAS_KEY_1',  // Key 1: 50,000/ay
      'YOUR_API_NINJAS_KEY_2'   // Key 2: 50,000/ay
    ],
    apiUrl: 'https://api.api-ninjas.com/v1/imagetotext',
    totalCapacity: {
      monthly: 100000,
      daily: 3333,
      hourly: 139
    }
  },
  
  // Plate Recognizer API (Özel plaka tanıma - EN İYİ)
  // ✅ Ücretsiz: 2,500 istek/ay per key
  // 📝 Key almak için: https://platerecognizer.com/
  // 📚 Döküman: https://guides.platerecognizer.com/
  plateRecognizer: {
    apiKeys: [
      'YOUR_PLATE_RECOGNIZER_KEY_1',  // Key 1: 2,500/ay
      'YOUR_PLATE_RECOGNIZER_KEY_2',  // Key 2: 2,500/ay
      'YOUR_PLATE_RECOGNIZER_KEY_3'   // Key 3: 2,500/ay
    ],
    apiUrl: 'https://api.platerecognizer.com/v1/plate-reader/',
    totalCapacity: {
      monthly: 7500,
      daily: 250,
      hourly: 10
    }
  },
  
  // Öncelik sırası (en yüksek başarı oranına göre)
  priority: ['plateRecognizer', 'ocrSpace', 'apiNinjas'],
  
  // Fallback stratejisi
  fallbackEnabled: true,
  
  // Timeout ayarları (milisaniye)
  timeouts: {
    plateRecognizer: 25000,  // 25 saniye
    ocrSpace: 30000,          // 30 saniye
    apiNinjas: 20000          // 20 saniye
  }
};

// Export (browser)
if(typeof window !== 'undefined'){
  window.OCR_CONFIG = OCR_CONFIG;
}

// Export (Node.js)
if(typeof module !== 'undefined' && module.exports){
  module.exports = OCR_CONFIG;
}
