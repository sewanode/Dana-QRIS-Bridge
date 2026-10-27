# Panduan Kontribusi (Contributing Guidelines)

Terima kasih telah tertarik untuk berkontribusi pada **Dana-QRIS-Bridge**! Proyek ini bersifat *open-source* dan menyambut baik kontribusi dari komunitas pengembang.

---

## 📌 Kode Etik
- Bersikap sopan, inklusif, dan profesional dalam setiap interaksi (Issue, Pull Request, maupun Diskusi).
- Hargai perspektif dan tingkat pengalaman kontributor lain.

---

## 🛠️ Alur Kontribusi

1. **Fork Repository**
   Fork repositori ini ke akun GitHub Anda:
   `https://github.com/Sewanode/Dana-QRIS-Bridge`

2. **Clone & Buat Branch Baru**
   ```bash
   git clone https://github.com/<username-anda>/Dana-QRIS-Bridge.git
   cd Dana-QRIS-Bridge
   git checkout -b fitur/nama-fitur-baru
   ```

3. **Lakukan Perubahan**
   - Pastikan perubahan kode bersih, rapi, dan terdokumentasi dengan baik.
   - Jangan menyertakan file sensitif seperti konfigurasi database lokal (`server/data/*.json`) atau file `.env`.
   - Pastikan linting dan test berjalan lancar.

4. **Testing**
   - **Server Node.js**: Jalankan `npm test` di dalam folder `server/` untuk memastikan flow QRIS, enkripsi token, dan API gateway berjalan semestinya.
   - **Android App**: Uji build APK menggunakan `./gradlew assembleDebug` di dalam folder `android-app/`.

5. **Commit & Push**
   Gunakan pesan commit yang deskriptif (misal: *Conventional Commits*):
   ```bash
   git commit -m "feat(server): tambahkan retry logic pada webhook dispatcher"
   git push origin fitur/nama-fitur-baru
   ```

6. **Buat Pull Request (PR)**
   Buka PR ke branch `main` di `https://github.com/Sewanode/Dana-QRIS-Bridge` dengan deskripsi jelas mengenai perubahan yang Anda lakukan.

---

## 🐛 Melaporkan Masalah (Bug Report)
Jika Anda menemukan bug:
1. Periksa tab [Issues](https://github.com/Sewanode/Dana-QRIS-Bridge/issues) terlebih dahulu untuk memastikan masalah belum dilaporkan.
2. Buat Issue baru dengan menyertakan:
   - Versi OS / Versi Android HP yang digunakan.
   - Log error atau screenshot yang relevan.
   - Langkah-langkah untuk mereproduksi masalah (*steps to reproduce*).
