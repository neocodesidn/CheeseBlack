# CheeseBlack · Game Changelog

Bot Discord khusus kategori game dan changelog. Jalankan satu proses bot dengan Node.js 22.16+ (diuji dengan Node 24). Direktori data harus berada di disk persisten yang dapat ditulis.

## Instalasi

1. Buka aplikasi **CheeseBlack** di Discord Developer Portal. Salin Application ID dan token bot dari aplikasi tersebut. Aktifkan **Message Content Intent** di halaman Bot. Intents yang dipakai kode adalah Guilds, GuildMessages, dan MessageContent.
2. Pasang aplikasi ke server dengan scope `bot` dan `applications.commands`. Beri CheeseBlack izin **View Channel**, **Read Message History**, **Send Messages**, **Create Private Threads**, **Send Messages in Threads**, dan **Manage Threads** pada channel teks tujuan. Agar role menerima notifikasi, gunakan role yang dapat disebut atau berikan izin **Mention Everyone** kepada bot di channel tujuan. Kode hanya mengizinkan ping ke ID role pilihan. Untuk emoji dari server lain, izin Use External Emojis dapat diperlukan.
3. Ekstrak ZIP, lalu jalankan dari folder yang berisi package.json.

```sh
npm ci
cp .env.example .env
```

Isi CHEESEBLACK_APPLICATION_ID dan CHEESEBLACK_TOKEN di .env. Jika deployment lama menggunakan GUILD_ID, salin daftar ID tersebut ke LEGACY_GUILD_IDS. Di panel hosting kamu juga bisa mengisi variabel langsung. Hentikan proses **CheeseBlack versi lama** sebelum menyalakan versi baru.

```sh
npm run register
npm start
```

Registrasi memeriksa identitas token, mengganti daftar command global aplikasi itu dengan /game, lalu menghapus command guild lama pada semua server yang dapat didaftar bot serta ID tambahan dari konfigurasi. Ulangi register jika proses terputus. Untuk guild lama yang sudah ditinggalkan, akses guild mungkin harus dipulihkan dulu. Perubahan menu global dapat memerlukan waktu untuk terlihat di klien.

## Pemakaian

| Command | Hasil |
|---|---|
| /game add categoryname:FISH IT linkgame:… | Menyimpan nama tampilan serta URL opsional di server ini. |
| /game list | Daftar kategori server. |
| /game delete categoryname:FISH IT | Menghapus kategori untuk draft baru. |
| /game changelog categoryname:FISH IT recipient:@Update | Membuka thread privat di channel teks biasa. |

Semua command memerlukan Administrator. Hanya pembuat draft yang masih memiliki akses Administrator yang dapat menggunakan tombol. Anggota dengan izin Manage Threads dapat melihat thread privat sesuai aturan Discord.

Buka thread, salin contoh dan kirim **satu pesan**. Pilih emoji, role, atau channel melalui composer. Label diawali pada kolom pertama. Satu baris untuk judul, lalu isi bebas untuk description dan footer.

```text
title: New Update Released!

description:
**Changes**
• Menambahkan area memancing baru.

footer:
**Diskusi:**
```

Tekan **Preview**. Tujuan ada tepat di atas tombol **Publish**. **Edit Draft** membuka kembali penyuntingan. Edit pesan asli atau kirim pengganti, lalu tekan **Preview** lagi. Publish memakai isi preview terakhir dengan tanggal WIB pada saat terbit. Bagian footer beserta garisnya hilang jika kosong. Cancel dan publikasi sukses menutup thread. Draft tersimpan di SQLite dan dapat dilanjutkan setelah restart dengan membuka kembali thread.

Link Roblox diproses dari place ID ke universe ID, lalu ikon game. Untuk URL publik lain, bot mencoba gambar langsung atau metadata og:image/twitter:image dari halaman. Ikon server menjadi cadangan. Server tanpa ikon tetap mendapat panel teks. Empat PNG dalam assets didaftarkan saat preview pertama dan ditemukan kembali menurut nama emoji aplikasi. Biarkan nama emoji tersebut tetap sama.

## Data dan pemulihan

DATA_FILE menunjuk ke database SQLite kategori dan draft. Cadangkan direktori data saat proses berhenti. Jalankan satu instance untuk setiap aplikasi. Preview selalu bebas ping. Bot mengunci publikasi per thread, menyimpan status sebelum mengirim, dan memakai nonce Discord yang sama untuk percobaan ulang. Jika Discord menolak permintaan, perbaiki penyebabnya dan klik Publish kembali. Jika koneksi putus saat respons sedang dikirim, segera klik Publish lagi. Setelah jendela percobaan singkat, bot memeriksa penanda panel di riwayat channel. Jika hasilnya tetap ambigu, draft dipertahankan dan pengiriman otomatis dihentikan. Periksa channel secara manual sebelum membuat draft pengganti.

## Pengujian

Jalankan `npm test`. Dua belas pengujian lokal lulus, termasuk SQLite setelah dibuka ulang, isolasi server, registrasi scope, komponen dan ping, alur edit/cancel, unggahan emoji bersamaan, thumbnail, kegagalan kirim, dan pencegahan publikasi ganda. Tes API menggunakan respons simulasi. Percobaan jaringan Roblox dari lingkungan build menghasilkan fallback.

Verifikasi langsung dengan aplikasi CheeseBlack di server uji:

1. Jalankan register dan start. Periksa menu global dan guild pengujian lama, lalu cek penolakan untuk akun non-admin.
2. Tambah FISH IT, restart bot dan periksa autocomplete pada dua server.
3. Di HP, tulis draft dengan emoji server serta mention channel. Lihat preview dan tujuan, edit, preview lagi, lalu klik Publish dua kali. Cocokkan satu panel publik, ikon lokal, penerima, waktu WIB dan notifikasi. Coba Cancel pada draft terpisah.
4. Periksa thumbnail untuk game Roblox aktif, link kosong dan server tanpa ikon. Uji footer kosong, role dengan izin berbeda, dan tombol draft dari administrator kedua.
