# Kebijakan Keamanan (Security Policy)

Keamanan pengguna dan integritas transaksi finansial adalah prioritas utama. Jika Anda menemukan kerentanan keamanan pada **Dana-QRIS-Bridge**, mohon laporkan secara bertanggung jawab (*responsible disclosure*).

---

## 🔒 Pelaporan Kerentanan (Reporting a Vulnerability)

**JANGAN** membuat *Public Issue* di GitHub untuk kerentanan keamanan atau celah yang dapat dieksploitasi.

Silakan laporkan detail kerentanan secara privat melalui salah satu jalur berikut:
* **GitHub Private Vulnerability Reporting**: Buka tab [Security Advisories](https://github.com/Sewanode/Dana-QRIS-Bridge/security/advisories) di repository GitHub Sewanode.
* **Email Pengembang**: Kirimkan deskripsi dan *Proof of Concept* (PoC) ke kontak yang tertera di profil GitHub [@Sewanode](https://github.com/Sewanode).

---

## ⏱️ Proses Penanganan
1. Laporan akan direspon dan dikonfirmasi dalam waktu maksimal 48 jam.
2. Tim akan melakukan evaluasi dampak dan menyusun perbaikan (*patch*).
3. Setelah patch dirilis ke branch utama, penemu kerentanan akan dicantumkan dalam catatan rilis (*acknowledgment*) jika berkenan.

---

## 🛡️ Catatan Keamanan untuk Pengguna
- **Selalu Ubah Password Default**: Segera ganti password default dashboard (`123456`) pada saat login pertama kali.
- **Lindungi API Key**: Jangan pernah membagikan atau mem-push API Key atau Webhook Secret ke repository publik atau sisi client-side (frontend).
- **Akses Jaringan**: Pastikan port dashboard (`8080`) dan port pairing (`2020`) dilindungi dengan firewall / reverse proxy (misal: NGINX + HTTPS) jika diekspos ke internet publik.
