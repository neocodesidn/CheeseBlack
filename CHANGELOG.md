# Changelog

## 2.0.1 — 2026-11-18 (Registration hotfix)
- Fixed `/rules publish` option ordering so required `title` and `body` precede optional `channel` and `footer`.
- Added local slash-command option-order validation before Discord registration, with a clear command path in the error.
- Added regression tests for valid and invalid required/optional option ordering.

## 2.0.0 — Community Exploit Bot V1

### Product rebrand
- Mengganti identitas produk menjadi Community Exploit Bot.
- Menambahkan `BOT_NAME` dan `BOT_DESCRIPTION` pada `.env`.
- Menghapus referensi dan identitas produk sebelumnya dari source aktif.
- Mengganti plugin loader menjadi allowlist fitur inti.
- Menghapus modul Store, Reseller, Robux, Sales, Vouch, Testimonial, Leveling, Automod, Moderation, Protection, Giveaway, Poll, Suggestion, dan Reminder dari paket aktif.

### Community modules
- Mempertahankan Verification, Roles, Boost, Announcement, Rules, Welcome, Donation, Ticket, Invites, Logs, dan Trap.
- Merapikan command menjadi root yang jelas: `/verification`, `/roles`, `/boost`, `/announcement`, `/rules`, `/welcome`, `/donation`, `/ticket`, `/invites`, `/logs`, dan `/trap`.
- Memisahkan channel log per kategori melalui `/logs set` dan `/logs status`.
- Menghapus custom icon pack lama; paket ini tidak menyertakan ikon PNG/WebP/SVG bot.
- Menghapus modal/form dari Announcement dan Server Rules.
- Server Rules sekarang berupa panel statis tanpa tombol dan tanpa translate.

### Script Management V1
- Menambahkan `/script category add` dengan input nama game dan link Roblox.
- Menambahkan ekstraksi Place ID dan integrasi Roblox Game Icon Thumbnail API.
- Menambahkan kategori satu game–satu script, channel changelog per kategori, autocomplete, archive, preview, dan history.
- Menambahkan `/script update` dengan maksimal tiga tombol per update.
- Menetapkan warna tombol: Button 1 Success/hijau, Button 2 Danger/merah, Button 3 Primary/biru.
- Menambahkan preview privat dan konfirmasi Publish/Cancel.
- Menyimpan changelog yang sudah diterbitkan dan mengarahkan tombol ke channel tujuan melalui respons ephemeral.

### Maintenance
- Memperbarui panel registry/updater untuk modul yang dipertahankan.
- Memigrasikan panel Rules dan Trap lama agar dapat di-refresh dengan struktur baru.
- Menambahkan test untuk command registry, JSON storage, Roblox API parsing, invite helper, dan Trap engine.
