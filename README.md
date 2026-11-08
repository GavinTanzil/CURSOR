# CURSOR: Platform Kelas Belajar Bersama HMIF

Aplikasi web sederhana untuk program kerja **CURSOR** (HMIF): mahasiswa dapat melihat jadwal kelas,
melakukan **presensi 2 tahap (Check-In dan Check-Out)**, serta mengunduh modul setelah kelas selesai.
Admin mengelola jadwal, status kelas, dan memantau daftar hadir lewat dashboard.

Dibuat sebagai tugas seleksi calon staff **Website RnD**.

## Link Repository GitHub

**https://github.com/USERNAME-KAMU/cursor-attendance**

## Tech Stack

Bahasa/runtime  : JavaScript, Node.js 18+
Framework web   : Express 5
Templating      : EJS (server-side rendering)
Database        : SQLite lewat `better-sqlite3` (satu file, tanpa server database)
Autentikasi     : `express-session` + `bcryptjs` (hash password)
Frontend        : HTML, CSS (responsif, tanpa framework CSS), sedikit JavaScript vanilla
Pengujian       : `node:test` bawaan Node.js (12 skenario end-to-end)

## Struktur File

```
cursor-app/
server.js               : Entry point: semua route (publik, auth, admin), validasi, CSRF
db.js                   : Koneksi SQLite, skema tabel, seed admin & data contoh
seed.js                 : Reset + isi ulang data contoh  (npm run seed)
package.json
.env                    : konfigurasi opsional
data/                   : Lokasi file database cursor.db (dibuat otomatis, di-ignore git)

views/
├── index.ejs           : Halaman publik: daftar kelas, filter, dialog Check-In/Check-Out
├── error.ejs           : Halaman error (403/404/500)
├── partials/           : head.ejs (header + flash message) dan foot.ejs

admin/
├── login.ejs           : Form login admin
├── dashboard.ejs       : Tabel kelas + daftar peserta + ubah status cepat
└── form.ejs            : Form tambah / edit kelas

public/
├── css/style.css       : Seluruh gaya tampilan (responsif)
└── js/app.js           : Buka/tutup dialog, konfirmasi hapus

tests/
└── flow.test.js        : Tes alur lengkap (presensi, kunci modul, CRUD, CSRF)
```

## Cara Instalasi dan Menjalankan (Lokal)

```bash
## 1 Masuk ke folder project
cd cursor-app

## 2 Pasang dependensi
npm install

## 3 Jalankan aplikasi
npm start
```

Buka **http://localhost:3000**.

Saat pertama dijalankan, database `data/cursor.db` dibuat otomatis lengkap dengan akun admin dan
5 kelas contoh. Tidak perlu migrasi manual.

`npm start`     : Menjalankan server
`npm run dev`   : Menjalankan server dengan auto-reload 
`npm run seed`  : Menghapus semua kelas lalu mengisi ulang data contoh 
`npm test`      : Menjalankan tes otomatis (memakai database sementara) 

### Akun Admin

Buka **http://localhost:3000/admin/login**

- Username: `admin`
- Password: `admin123`

Ubah lewat variabel lingkungan sebelum pertama kali menjalankan (lihat `.env`):
`ADMIN_USER`, `ADMIN_PASS`, `SESSION_SECRET`, `PORT`.

## Fitur dan Aturan Bisnis

**Halaman publik (mahasiswa)**

- Daftar kelas berbentuk kartu: mata kuliah, pengajar, tanggal & jam, ruang, status (Belum Mulai/Berlangsung/Selesai), jumlah peserta hadir, tombol Download Modul.
- **Check-In** (input Nama Lengkap + NIM) hanya untuk kelas *Berlangsung*. Data tersimpan sebagai *Check-In (Di Kelas)*. NIM yang sama tidak bisa Check-In dua kali di kelas yang sama (dijaga oleh `UNIQUE(event_id, nim)` di database), dan Check-In ditolak jika kelas sudah *Selesai*.
- **Check-Out** (input NIM + Kode Sesi): jika cocok, status berubah menjadi *Hadir Penuh*. Ditolak jika NIM belum Check-In di kelas itu atau Kode Sesi salah. Peserta yang tidak Check-Out tetap berstatus *Check-In*.
- **Download Modul**: dapat diakses siapa pun tanpa syarat presensi, tetapi hanya aktif jika status kelas *Selesai*. Penguncian dilakukan di UI **dan** di server (`GET /kelas/:id/modul`), dan link modul tidak ditulis ke HTML selama kelas belum selesai.

**Dashboard admin**

- **Create**: tambah kelas (mata kuliah, pengajar, tanggal & jam, ruang, kode sesi, link modul).
- **Read**: tabel semua kelas beserta daftar peserta berstatus *Check-In (Belum Check-Out)* dan *Hadir Penuh*.
- **Update**: edit informasi kelas dan ubah status kelas (juga tersedia ubah status cepat di tabel).
- **Delete**: hapus kelas (data presensinya ikut terhapus).

**Poin plus yang diimplementasikan**

- Login sederhana yang memisahkan halaman mahasiswa dan admin.
- Pencarian kelas berdasarkan nama mata kuliah.
- Tampilan responsif (HP sampai desktop) dengan CSS buatan sendiri.
- Tambahan kecil: ekspor daftar hadir ke CSV.

## Catatan Keamanan

- Query SQL memakai *prepared statement* (aman dari SQL injection); output EJS di-escape (aman dari XSS).
- Token CSRF pada semua form POST, cookie sesi `httpOnly` + `sameSite=lax`, password admin di-hash dengan bcrypt, percobaan login dibatasi.
- Link modul divalidasi hanya `http://` / `https://`; ekspor CSV menetralkan *formula injection*.
- Penyimpanan sesi memakai memori (cukup untuk lokal/demo); untuk produksi ganti dengan session store persisten.
