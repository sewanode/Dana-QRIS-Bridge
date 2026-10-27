<div align="center">

# ⚡ Dana-QRIS-Bridge
### Fullstack Dynamic QRIS Payment Gateway & Multi-Device Android Notification Bridge

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/Node.js-v18%2B-green.svg?style=flat-square&logo=node.js)](https://nodejs.org)
[![Android](https://img.shields.io/badge/Android-SDK%2026--34-brightgreen.svg?style=flat-square&logo=android)](https://developer.android.com)
[![GitHub Actions](https://img.shields.io/badge/CI-GitHub%20Actions-orange.svg?style=flat-square&logo=githubactions)](https://github.com/Sewanode/Dana-QRIS-Bridge/actions)
[![Open Source](https://img.shields.io/badge/Open%20Source-%E2%99%A5-red.svg?style=flat-square)](https://github.com/Sewanode/Dana-QRIS-Bridge)

<p align="center">
  Solusi pembayaran QRIS mandiri berbasis <b>DANA Bisnis</b> tanpa perlu biaya admin gateway pihak ketiga.<br />
  Mengubah <b>QRIS Statis</b> menjadi <b>QRIS Dinamis</b> dengan kode unik otomatis (2 digit, 1–99), dipadukan dengan <b>Android Background Listener</b> tanpa root / tanpa Shizuku.
</p>

[Fitur Utama](#-fitur-utama) •
[Arsitektur](#-arsitektur--alur-kerja) •
[Panduan Memulai](#-panduan-instalasi--penggunaan) •
[Dokumentasi API](#-dokumentasi-rest-api-gateway) •
[Webhook](#-integrasi-webhook) •
[Disclaimer](#-disclaimer--pernyataan-hukum)

---

</div>

## ✨ Fitur Utama

- 📱 **Multi-Device Android Bridge (Tanpa Root & Tanpa Shizuku)**:
  - Berjalan 24/7 di latar belakang dengan *Foreground Service* & *Keep-Alive Heartbeat*.
  - Menangkap notifikasi dana masuk dari DANA Bisnis secara *real-time* via `NotificationListenerService`.
  - Dukungan multi-perangkat (bisa menghubungkan lebih dari 1 HP Android sekaligus dengan load-balancing & failover).
  - Mekanisme otomatis restart saat HP menyala (*Auto-Start on Boot*).
- 🔄 **Dynamic QRIS Recoding Engine (EMVCo Compatible)**:
  - Mengubah payload QRIS statis DANA Bisnis menjadi QRIS dinamis ber-nominal otomatis dengan *checksum CRC16* terstandar.
  - Penambahan kode unik nominal dinamis 2 digit (`Rp 1` – `Rp 99`) untuk rekonsiliasi transaksi instan tanpa tumpang tindih.
- 💻 **Modern Web Dashboard & Admin Portal**:
  - Tampilan *enterprise-grade* yang bersih dan responsif.
  - Keamanan berlapis: wajib ganti password pada login pertama (*first login* default: `123456`).
  - Wizard onboarding: Upload QRIS Statis dan Pairing HP dengan kode 6-digit.
  - Live Real-Time Dashboard (WebSocket) untuk memantau transaksi, status koneksi HP, dan log pembayaran.
  - Built-in Interactive API Tester & QR Code Preview.
- 🔌 **REST API & Webhook Dispatcher**:
  - API pembuatan invoice transaksi dan pengecekan status yang mudah diintegrasikan ke Website, Bot Telegram, Discord, atau Aplikasi Mobile.
  - Webhook instan dengan verifikasi signature HMAC-SHA256 ke URL sistem Anda saat pembayaran berhasil.

---

## 🏛️ Arsitektur & Alur Kerja

```
[ Pelanggan Checkout ]
         │
         ▼
[ Merchant Server / Toko Online ] ──(POST /api/transaction/create)──▶ [ Dana-QRIS-Bridge Server ]
                                                                                │
                                                                   (Generate QRIS Dinamis + Kode Unik)
                                                                                │
[ Pelanggan Scan & Bayar via DANA/BCA/Gojek/dll ] ◀─────────────────────────────┘
         │
         ▼
[ Server DANA Memproses Pembayaran ]
         │
         ▼
[ Notifikasi Muncul di HP Android DANA Bisnis ]
         │
         ▼ (NotificationListenerService)
[ Aplikasi Android Dana-QRIS-Bridge ] ──(WebSocket Port 2020)──▶ [ Dana-QRIS-Bridge Server ]
                                                                          │
                                                                 (Cocokkan Nominal Unik)
                                                                          │
[ Toko Online / Webhook Endpoint ] ◀──────(Webhook POST HMAC-SHA256)──────┘
         │
         ▼
[ Pesanan Pelanggan Otomatis Diproses ]
```

---

## 📦 Struktur Repositori

```
Dana-QRIS-Bridge/
├── .github/
│   └── workflows/
│       └── build-apk.yml          # GitHub Actions Auto-Build APK
├── android-app/                   # Source code aplikasi Android (Kotlin, Gradle)
│   ├── app/src/main/
│   │   ├── java/.../bridge/       # NotificationListener, ForegroundService, PairActivity
│   │   └── res/                   # UI Layout & Assets perbankan profesional
│   └── build.gradle
├── server/                        # Backend Node.js
│   ├── public/                    # Dashboard UI (Modern CSS, Vanilla JS, Zero Bloat)
│   ├── src/
│   │   ├── index.js               # Entrypoint HTTP Server & WebSocket
│   │   ├── qris.js                # Parser & Generator EMVCo QRIS Dinamis
│   │   ├── pairServer.js          # Protokol Pairing & Sinkronisasi Notifikasi HP
│   │   ├── store.js               # Data Store & Transaksi Management
│   │   └── webhook.js             # Webhook Dispatcher dengan HMAC-SHA256
│   ├── test/                      # E2E Test Suite
│   ├── .env.example               # Contoh konfigurasi port & environment
│   └── package.json
├── Dana-QRIS-Bridge.apk           # File APK siap pakai
├── start-server.bat               # Shortcut instan menjalankan server di Windows
├── build-apk.bat                  # Shortcut build APK mandiri di Windows
├── CONTRIBUTING.md                # Panduan kontribusi komunitas
├── SECURITY.md                    # Kebijakan pelaporan kerentanan
└── LICENSE                        # Lisensi MIT (Sewanode)
```

---

## 🚀 Panduan Instalasi & Penggunaan

### 1. Prasyarat Sistem
* **Node.js**: Versi 18.0.0 atau lebih baru ([Download](https://nodejs.org)).
* **HP Android**: Android 8.0 (Oreo) s/d Android 14+ yang telah terpasang aplikasi **DANA** dengan akun **DANA Bisnis**.

### 2. Menjalankan Server Node.js
1. Buka terminal di dalam folder proyek:
   ```bash
   cd server
   npm install
   npm start
   ```
   *(Atau klik 2x file `start-server.bat` di Windows)*.
2. Server default akan membuka 2 port:
   * **Web Dashboard & API Gateway**: `http://localhost:8080`
   * **Pairing Port Android**: `2020`

### 3. Konfigurasi Awal di Web Dashboard
1. Buka browser dan akses `http://localhost:8080`.
2. Masukkan password awal: **`123456`**.
3. Sistem akan meminta Anda **membuat password baru**.
4. Selesaikan **2 Konfigurasi Wajib**:
   - **Upload QRIS Statis**: Unggah gambar QRIS DANA Bisnis toko Anda (atau gunakan tombol *Sample QRIS* untuk testing).
   - **Hubungkan HP Android**: Dapatkan 6-digit kode pairing dari aplikasi Android dan simpan di dashboard.

### 4. Mengatur Aplikasi Android (`Dana-QRIS-Bridge.apk`)
1. Download atau transfer file `Dana-QRIS-Bridge.apk` ke HP Android Anda.
2. Buka aplikasi, setujui **Terms of Service**, dan berikan 4 izin sistem:
   - ✅ **Akses Notifikasi** (Membaca notifikasi dana masuk dari DANA).
   - ✅ **Layanan Latar Belakang** (*Foreground Service 24/7*).
   - ✅ **Jalan Otomatis Setelah Reboot** (*BOOT_COMPLETED*).
   - ✅ **Bebas Batasan Baterai** (*Ignore Battery Optimization*).
3. Masukkan **IP Server** (IP Lokal WiFi atau Domain/VPS Anda) dan **Port Pairing (`2020`)**.
4. Klik **Hubungkan ke Server** — kode pairing 6 digit akan muncul di layar.
5. Masukkan kode tersebut ke Web Dashboard. Status HP akan seketika berubah menjadi **TERHUBUNG & AKTIF**.

---

## 📘 Dokumentasi REST API Gateway

Setiap request ke API dilindungi menggunakan Bearer Token (API Key yang didapatkan dari Web Dashboard):
```http
Authorization: Bearer <API_KEY_ANDA>
```

### 1. Buat Transaksi Baru (`POST /api/transaction/create`)

#### Request Body:
```json
{
  "amount": 1000000,
  "customer_name": "Nama Pelanggan",
  "customer_email": "emailpelanggan@domain.com",
  "customer_phone": "081234567890",
  "order_items": [
    {
      "sku": "PRODUK1",
      "name": "Nama Produk 1",
      "price": 500000,
      "quantity": 1
    },
    {
      "sku": "PRODUK2",
      "name": "Nama Produk 2",
      "price": 500000,
      "quantity": 1
    }
  ],
  "return_url": "https://domainanda.com/redirect",
  "expired_time": 600
}
```

#### Successful Response (`200 OK`):
```json
{
  "success": true,
  "message": "Transaksi berhasil dibuat",
  "data": {
    "customer_name": "Nama Pelanggan",
    "customer_email": "emailpelanggan@domain.com",
    "customer_phone": "081234567890",
    "callback_url": "https://domainanda.com/callback",
    "return_url": "https://domainanda.com/redirect",
    "amount": 1000045,
    "amount_received": 1000000,
    "pay_code": "57585748548596587",
    "status": "UNPAID",
    "expired_time": 600,
    "order_items": [
      {
        "sku": "PRODUK1",
        "name": "Nama Produk 1",
        "price": 500000,
        "quantity": 1,
        "subtotal": 500000
      },
      {
        "sku": "PRODUK2",
        "name": "Nama Produk 2",
        "price": 500000,
        "quantity": 1,
        "subtotal": 500000
      }
    ],
    "qr_url": "http://localhost:8080/qris/57585748548596587.png"
  }
}
```

> **Catatan Nominal**: `amount` yang harus dibayar pelanggan (`1000045`) memiliki kode unik 2 digit (`45`), sedangkan `amount_received` adalah nominal bersih pesanan Anda (`1000000`).

---

### 2. Cek Status Transaksi (`GET /api/transaction/check-status`)

#### Request Query:
```http
GET /api/transaction/check-status?pay_code=57585748548596587
Authorization: Bearer <API_KEY_ANDA>
```

#### Successful Response (`200 OK`):
```json
{
  "success": true,
  "status": "paid",
  "message": "Status transaksi saat ini PAID"
}
```
*Status yang dapat dikembalikan:* `unpaid`, `paid`, `expired`.

---

## 🔔 Integrasi Webhook

Ketika notifikasi masuk dari DANA cocok dengan nominal unik transaksi yang sedang menunggu, server akan otomatis mengirimkan callback HTTP POST ke Webhook URL yang Anda daftarkan:

### Payload Webhook:
```json
{
  "event": "payment.success",
  "pay_code": "57585748548596587",
  "amount": 1000045,
  "nominal_bersih": 1000000,
  "kode_unik": 45,
  "paid_at": 1729900000000,
  "customer_name": "Nama Pelanggan"
}
```

### Verifikasi Signature (Node.js Contoh):
Header `X-Bridge-Signature` dikirim bersama request webhook untuk mencegah serangan pemalsuan request (spoofing):
```javascript
const crypto = require('crypto');

function verifyWebhook(req, secret) {
  const signature = req.headers['x-bridge-signature'];
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return signature === expectedSignature;
}
```

---

## 🔨 Build APK Sendiri (Opsional)

Jika Anda ingin memodifikasi source code Android di `android-app/`:
```bash
# Menggunakan build script otomatis
./build-apk.bat

# Atau manual via Gradle
cd android-app
./gradlew assembleDebug
```
File APK hasil build akan berlokasi di `android-app/app/build/outputs/apk/debug/app-debug.apk`.

---

## ⚠️ Disclaimer & Pernyataan Hukum

Proyek ini dibuat dan dikembangkan secara independen oleh [@Sewanode](https://github.com/Sewanode) untuk tujuan kemudahan integrasi dan edukasi. Proyek ini **TIDAK berafiliasi, disponsori, didukung, atau disetujui secara resmi oleh PT Espay Debit Indonesia Koe (DANA)** maupun Bank Indonesia. 

Pengguna bertanggung jawab penuh atas konfigurasi, keamanan perangkat, dan penggunaan transaksi bisnis masing-masing sesuai ketentuan hukum dan syarat layanan penyedia dompet digital terkait.

---

## 📄 Lisensi

Didistribusikan di bawah Lisensi **MIT**. Lihat file [`LICENSE`](LICENSE) untuk informasi lebih lanjut.

<div align="center">
  Dikelola dengan ❤️ oleh <a href="https://github.com/Sewanode">Sewanode</a>
</div>
