'use strict';
const fs = require('fs');
const path = require('path');

const BLACKLIST_FILE = path.join(__dirname, 'data', 'blacklist.jsonl');

function readBlacklist() {
  try {
    if (!fs.existsSync(BLACKLIST_FILE)) return [];
    const lines = fs.readFileSync(BLACKLIST_FILE, 'utf8').trim().split('\n').filter(l => l);
    return lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(b => b && !b.deleted);
  } catch (e) {
    console.error('[BLACKLIST] Read error:', e.message);
    return [];
  }
}

function addToBlacklist(plate, reason, addedBy) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    plate: (plate || '').toUpperCase().trim(),
    reason: reason || 'Şüpheli araç',
    addedBy: addedBy || 'system',
    addedAt: Date.now(),
    deleted: false
  };
  
  fs.appendFileSync(BLACKLIST_FILE, JSON.stringify(entry) + '\n');
  return entry;
}

function removeFromBlacklist(id) {
  const entries = readBlacklist();
  const found = entries.find(e => e.id === id);
  if (found) {
    const deleted = Object.assign({}, found, { deleted: true, deletedAt: Date.now() });
    fs.appendFileSync(BLACKLIST_FILE, JSON.stringify(deleted) + '\n');
    return true;
  }
  return false;
}

function isBlacklisted(plate) {
  const list = readBlacklist();
  return list.find(e => e.plate === (plate || '').toUpperCase().trim());
}

module.exports = { readBlacklist, addToBlacklist, removeFromBlacklist, isBlacklisted };
