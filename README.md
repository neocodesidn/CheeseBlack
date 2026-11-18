# Community Exploit Bot

Discord bot modular untuk komunitas Roblox exploit/script, game developer, coding, dan technical support. Proyek ini menggunakan fondasi teknis dari source sebelumnya, tetapi fitur, command, konfigurasi, dan identitas produk sudah diarahkan ulang untuk kebutuhan komunitas baru.

## Fokus produk

### Community management
- Verification: CAPTCHA dan pemberian role setelah lolos.
- Roles: self-role panel dengan tombol toggle.
- Boost: pesan otomatis saat anggota melakukan server boost.
- Announcement: publikasi langsung melalui slash command, tanpa modal/form.
- Server Rules: panel rules statis, tanpa translate, tanpa tombol, dan tanpa modal/form.
- Welcome: pesan welcome dan goodbye yang dapat dikustomisasi.
- Donation: panel QRIS, role donatur, notifikasi, dan riwayat.
- Ticket: kanal bantuan privat, penutupan, dan transcript.
- Invites: tracking undangan dan invite logs.
- Trap: honeypot channel dengan whitelist dan security log.
- Logs: pemetaan channel log per jenis aktivitas.

### Script Management V1
- Registrasi kategori game Roblox berdasarkan nama dan link game.
- Satu kategori mewakili satu game dan satu script utama.
- Place ID diekstrak dari URL Roblox.
- Game Icon diambil dari Roblox Thumbnail API ketika kategori dibuat, dipreview, dan ketika changelog diterbitkan.
- Channel changelog disimpan per kategori.
- Changelog wajib melalui preview dan konfirmasi Publish.
- Maksimal tiga tombol per changelog: Button 1 hijau (wajib), Button 2 merah (opsional), Button 3 biru (opsional).
- Label dan channel tujuan tombol diatur untuk setiap changelog, bukan konfigurasi permanen.
- Tombol berwarna menggunakan interaksi bot dan membalas dengan tautan channel secara ephemeral. Tombol Discord berwarna tidak dapat sekaligus menjadi tombol Link langsung.
- Riwayat changelog disimpan dan dapat dilihat melalui command.

Executor Manager belum termasuk dalam V1.

## Command utama

| Command | Fungsi |
|---|---|
| `/verification setup` | Pasang CAPTCHA verification panel |
| `/roles panel` | Buat self-role panel |
| `/boost setup` | Atur channel boost |
| `/announcement send` | Kirim pengumuman tanpa modal |
| `/rules publish` | Terbitkan/perbarui rules statis |
| `/welcome setup` | Atur welcome/goodbye |
| `/welcome test` | Preview welcome/goodbye |
| `/donation panel` | Pasang panel donasi |
| `/donation setup role` | Atur role donatur otomatis |
| `/donation notify` | Atur channel notifikasi donasi |
| `/donation logs` | Lihat riwayat transaksi |
| `/ticket setup` | Pasang panel ticket |
| `/invites setup` | Aktifkan invite tracking dan atur log |
| `/invites stats` | Lihat statistik invite |
| `/logs set` | Atur channel log per fitur |
| `/logs status` | Lihat channel log yang sudah diatur |
| `/trap setup` | Aktifkan honeypot |
| `/trap status` | Lihat status honeypot |
| `/script category add` | Daftarkan game Roblox |
| `/script category list` | Lihat kategori game |
| `/script category edit` | Ubah nama/link game |
| `/script category archive` | Arsipkan kategori |
| `/script category preview` | Preview kategori dan Game Icon |
| `/script channel set` | Tetapkan channel changelog per kategori |
| `/script update` | Buat preview changelog script |
| `/script history` | Lihat riwayat changelog |
| `/panels refresh` | Refresh panel permanen yang terdaftar |
| `/help commands` | Panduan command |
| `/admin overview` | Ringkasan bot untuk Bot Owner |

## Persyaratan

- Node.js 18.17 atau lebih baru.
- Discord Application dan Bot Token.
- Bot memiliki permission sesuai fitur: View Channels, Send Messages, Embed Links, Attach Files, Manage Roles, Manage Channels, Read Message History, dan Manage Server.
- Server Members Intent untuk Welcome, Boost, Verification/role workflows tertentu, Invites, dan Trap.
- Guild Invites Intent untuk Invite Tracking.
- Guild Messages Intent untuk Trap honeypot.

Aktifkan privileged intents yang diperlukan di Discord Developer Portal dan pastikan intent yang sama diminta oleh bot.

## Instalasi

1. Ekstrak source.
2. Jalankan `npm install`.
3. Salin `.env.example` menjadi `.env`.
4. Isi `DISCORD_TOKEN`, `CLIENT_ID`, `BOT_OWNER_IDS`, dan identitas bot.
5. Jika memakai registrasi command cepat, isi `GUILD_ID` dengan satu atau beberapa server ID dipisahkan koma.
6. Jalankan `npm run register`.
7. Jalankan `npm start`.

Untuk pengembangan lokal, `npm test` menjalankan test suite yang tersedia.

## Environment

| Variabel | Keterangan |
|---|---|
| `BOT_NAME` | Nama produk yang digunakan di pesan/panel yang mendukung branding dinamis |
| `BOT_DESCRIPTION` | Deskripsi identitas bot untuk log startup/dokumentasi |
| `DISCORD_TOKEN` | Token bot Discord |
| `CLIENT_ID` | Application ID |
| `BOT_OWNER_IDS` | Discord user ID Bot Owner, dipisahkan koma |
| `GUILD_ID` | Opsional, server untuk registrasi command cepat |
| `DISABLED_PLUGINS` | Opsional, daftar plugin inti yang dinonaktifkan |
| `LOG_LEVEL` | Level log |
| `GOPAY_STATIC_QR` | QRIS statis untuk modul donation |
| `GOPAY_HISTORY_TOKEN` | Token history transaksi dari merchant yang sama |

## Struktur proyek

```text
Community-Exploit-Bot/
├── data/                 # Konfigurasi dan riwayat runtime
├── lib/                  # Shared engines, storage, helpers
├── plugins/              # Modul fitur yang aktif
├── tests/                # Unit dan regression tests
├── .env.example
├── index.js
├── register.js
└── package.json
```

## Prinsip arsitektur

- Plugin inti dimuat melalui allowlist di `lib/loader.js`; plugin yang tidak masuk allowlist tidak akan aktif.
- Setiap fitur memiliki command root yang jelas dan tidak lagi menggunakan command category lama.
- Components V2 digunakan untuk panel publik dan preview.
- Tidak ada custom icon pack bawaan pada rilis ini. Aset visual panel menggunakan input/attachment dari admin bila fitur memerlukannya. Game Icon pada Script Management merupakan data dinamis dari Roblox, bukan aset icon pack bot.
- Channel log disimpan per kategori agar aktivitas tidak tercampur.
- Panel permanen disimpan dengan channel ID dan message ID untuk mencegah duplikasi.
- File JSON ditulis secara atomic untuk mengurangi risiko file terpotong saat proses berhenti.

## Catatan operasional

- Jalankan satu instance bot untuk satu folder `data/` yang sama. JSON storage bukan database multi-process.
- Simpan `.env` dan folder `data/` secara aman; keduanya dapat berisi token atau ID konfigurasi server.
- Lakukan backup `data/` sebelum upgrade.
- Saat command berubah, jalankan ulang `npm run register` agar command lama di Discord diganti dengan struktur baru.
- Ikon Game Roblox bergantung pada ketersediaan Roblox Thumbnail API. Jika API gagal, bot menggunakan ikon terakhir yang tersimpan jika tersedia.
