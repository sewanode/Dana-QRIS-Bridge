const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw)).digest('hex');
}

function generateApiKey() {
  return 'dqb_live_' + crypto.randomBytes(20).toString('hex');
}

function generateWebhookSecret() {
  return 'whsec_' + crypto.randomBytes(16).toString('hex');
}

function generatePayCode() {
  // 17-digit numeric string like "57585748548596587"
  let code = String(Math.floor(1 + Math.random() * 9));
  for (let i = 0; i < 16; i++) {
    code += String(Math.floor(Math.random() * 10));
  }
  return code;
}

function generatePairCode() {
  // 6-digit numeric pairing code
  return String(Math.floor(100000 + Math.random() * 900000));
}

const DEFAULT_STATE = {
  auth: {
    passwordHash: hashPassword('123456'),
    mustChangePassword: true
  },
  config: {
    httpPort: Number(process.env.HTTP_PORT) || 8080,
    pairPort: Number(process.env.PAIR_PORT) || 2020,
    publicHost: '',
    apiKey: generateApiKey(),
    uniqueCodeEnabled: true,
    uniqueCodeMin: 1,
    uniqueCodeMax: 99,
    webhookUrl: '',
    webhookSecret: generateWebhookSecret(),
    qris: {
      raw: '',
      merchantName: '',
      merchantCity: '',
      nmid: '',
      uploadedAt: null
    }
  },
  pairedDevices: [],
  transactions: [],
  notificationLogs: []
};

class DataStore {
  constructor() {
    this.state = null;
    this.sessions = new Map(); // token -> { createdAt }
    this.pendingDevices = new Map(); // pairCode -> { pairCode, deviceId, deviceName, model, androidVersion, ip, connectedAt, lastSeenAt, deviceToken }
    this.load();
  }

  load() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
      this.save();
    } else {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        this.state = {
          auth: { ...DEFAULT_STATE.auth, ...(parsed.auth || {}) },
          config: {
            ...DEFAULT_STATE.config,
            ...(parsed.config || {}),
            qris: { ...DEFAULT_STATE.config.qris, ...((parsed.config && parsed.config.qris) || {}) }
          },
          pairedDevices: Array.isArray(parsed.pairedDevices) ? parsed.pairedDevices : [],
          transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
          notificationLogs: Array.isArray(parsed.notificationLogs) ? parsed.notificationLogs.slice(0, 200) : []
        };
        if (this.state.config.uniqueCodeMax > 99) {
          this.state.config.uniqueCodeMax = 99;
          this.save();
        }
      } catch (err) {
        console.error('[Store] Failed to parse db.json, initializing fresh state:', err.message);
        this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
        this.save();
      }
    }
  }

  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      // Keep notificationLogs and transactions bounded to avoid huge files
      if (this.state.notificationLogs.length > 300) {
        this.state.notificationLogs = this.state.notificationLogs.slice(0, 300);
      }
      if (this.state.transactions.length > 1000) {
        this.state.transactions = this.state.transactions.slice(0, 1000);
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.error('[Store] Failed to write db.json:', err.message);
    }
  }

  isSetupComplete() {
    const hasQris = Boolean(this.state.config.qris && this.state.config.qris.raw);
    const hasPairedDevice = this.state.pairedDevices.length > 0;
    return {
      hasQris,
      hasPairedDevice,
      ready: hasQris && hasPairedDevice
    };
  }

  verifyPassword(password) {
    return this.state.auth.passwordHash === hashPassword(password);
  }

  changePassword(newPassword) {
    this.state.auth.passwordHash = hashPassword(newPassword);
    this.state.auth.mustChangePassword = false;
    this.save();
  }

  createSession() {
    const token = crypto.randomBytes(24).toString('hex');
    this.sessions.set(token, { createdAt: Date.now() });
    return token;
  }

  isValidSession(token) {
    if (!token) return false;
    return this.sessions.has(token);
  }

  /**
   * Refresh expired transactions automatically
   */
  refreshExpiredTransactions() {
    const now = Date.now();
    let changed = false;
    for (const tx of this.state.transactions) {
      if (tx.status === 'UNPAID' && now >= tx.expires_at) {
        tx.status = 'EXPIRED';
        changed = true;
      }
    }
    if (changed) {
      this.save();
    }
  }

  /**
   * Allocate a 2-digit unique code (1..99) so `amount = amount_received + unique_code`
   * does not collide with any currently UNPAID transaction
   */
  allocateUniqueAmount(baseAmount) {
    this.refreshExpiredTransactions();
    const base = Math.round(Number(baseAmount));
    if (!this.state.config.uniqueCodeEnabled) {
      return { amount: base, uniqueCode: 0 };
    }

    const min = Math.min(99, Math.max(1, Number(this.state.config.uniqueCodeMin) || 1));
    const max = Math.min(99, Math.max(min, Number(this.state.config.uniqueCodeMax) || 99));

    const activeAmounts = new Set(
      this.state.transactions
        .filter((t) => t.status === 'UNPAID')
        .map((t) => Number(t.amount))
    );

    // Try random 2-digit candidates first (between min and max, max 99)
    for (let i = 0; i < 60; i++) {
      const candidateCode = Math.floor(min + Math.random() * (max - min + 1));
      const candidateAmount = base + candidateCode;
      if (!activeAmounts.has(candidateAmount)) {
        return { amount: candidateAmount, uniqueCode: candidateCode };
      }
    }

    // Fallback sequential search strictly within 1..99
    for (let code = min; code <= max; code++) {
      const candidateAmount = base + code;
      if (!activeAmounts.has(candidateAmount)) {
        return { amount: candidateAmount, uniqueCode: code };
      }
    }

    const fallbackCode = Math.floor(1 + Math.random() * 99);
    return { amount: base + fallbackCode, uniqueCode: fallbackCode };
  }
}

module.exports = {
  DataStore,
  hashPassword,
  generateApiKey,
  generateWebhookSecret,
  generatePayCode,
  generatePairCode
};
