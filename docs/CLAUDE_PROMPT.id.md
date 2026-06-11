# Prompt Claude — Bikin Plugin Baru

> 🇬🇧 [English](CLAUDE_PROMPT.md) · 🇮🇩 Bahasa Indonesia

Copy-paste prompt di bawah ke Claude (Claude Code, claude.ai, atau API), isi bagian `{{ ... }}`, lalu kirim. Claude akan generate folder `plugins/plugin-{{nama}}/` lengkap dengan `plugin.json` + `index.ts` sesuai aturan repo ini.

> Prasyarat: jalankan prompt di **root** repo (folder yang berisi `core/`, `plugins/`, `docs/`). Claude akan baca [PLUGINS.md](PLUGINS.id.md), [CORE.md](CORE.id.md), dan [core/types.ts](../core/types.ts) sebelum nulis kode.

---

## A. Prompt singkat (one-shot)

Pakai ini kalau ide plugin sudah jelas dan kamu cuma butuh kode jadi.

```
Tolong bikin plugin baru untuk bot di repo ini.

Spesifikasi:
- Nama plugin: plugin-{{nama-kebab-case}}
- Apa yang dilakukan: {{deskripsi singkat — 1-2 kalimat}}
- Trigger (kapan plugin dipanggil): {{contoh: keyword "harga", "ongkir" / regex "^order\s+.+" / fallback "all" / event onJoin}}
- Platform target: {{whatsapp / telegram / semua}}
- Response type: {{static / dynamic / llm}}
- Butuh state multi-step? {{ya — jelaskan stepnya / tidak}}
- Butuh tabel database sendiri? {{tidak / ya — sebutkan data apa yang disimpan}}
- Butuh dependency npm? {{tidak / sebutkan: sharp, axios, dll}}
- Butuh middleware lokal? {{tidak / sebutkan validasi yang perlu}}

Sebelum nulis kode:
1. Baca docs/PLUGINS.md sampai habis — ikuti SEMUA konvensi di sana.
2. Baca core/types.ts untuk signature PluginDef, Msg, Ctx.
3. Lihat 1-2 plugin existing di plugins/ yang paling mirip use-case-nya sebagai referensi gaya.

Aturan keras:
- Self-contained: JANGAN import dari plugins/plugin-lain/. Reusable logic → core/helpers/ atau SDK utility.
- JANGAN sentuh core/router.ts atau core/loader.ts.
- Pakai msg.from sebagai primary key (BUKAN msg.phoneNumber / msg.lid).
- Pass ctx.platform di SEMUA helpers.user.* dan helpers.history.get/clear.
- Semua I/O (fetch/DB) dibungkus retry() + try/catch dengan ctx.log.error.
- createHealthCheck() / rate limiter dipanggil di top-level module, BUKAN di dalam hook.
- Butuh tabel sendiri? createPluginDb(import.meta) + migrations/ di folder plugin (PLUGINS.md §8). JANGAN tambah migration ke core/db/migrations/ untuk plugin. Query selalu parameterized ($1, $2).
- Conversation.enter() WAJIB TTL — tidak boleh infinite.
- TypeScript strict — tidak ada `any` kecuali untuk msg.raw.
- Pakai definePlugin() dari core/plugin-sdk.js.

Deliverable:
1. plugins/plugin-{{nama-kebab-case}}/plugin.json
2. plugins/plugin-{{nama-kebab-case}}/index.ts
3. (kalau perlu) plugins/plugin-{{nama-kebab-case}}/middleware/*.ts
4. (kalau perlu) plugins/plugin-{{nama-kebab-case}}/migrations/*.sql
5. (kalau perlu) plugins/plugin-{{nama-kebab-case}}/package.json + perintah install

Setelah generate:
- Jalankan `npm run typecheck` dan perbaiki kalau ada error.
- Tampilkan 2-3 contoh pesan trigger yang seharusnya match, plus contoh pesan yang seharusnya TIDAK match (untuk verifikasi router).
- Tampilkan checklist §12 PLUGINS.md, centang yang sudah, kasih TODO untuk yang belum.
```

---

## B. Prompt interaktif (kalau idenya masih kasar)

Pakai ini kalau kamu cuma punya ide samar dan mau Claude bantu shaping.

```
Saya mau bikin plugin bot baru di repo ini, tapi spesifikasi belum fix. Ide kasar:

"{{tulis ide bebas — mis. 'plugin untuk balas harga produk berdasarkan database', 'plugin reminder per-user', 'plugin yang nge-resize gambar dari user'}}"

Tugasmu:
1. Baca docs/PLUGINS.md dan docs/CORE.md dulu supaya paham arsitektur.
2. Tanya saya HANYA hal-hal kritis yang belum jelas (maksimal 3 pertanyaan):
   - Trigger yang tepat (keyword apa? regex? fallback?)
   - Apakah perlu state multi-step (conversation)?
   - Apakah perlu API eksternal / DB / dependency npm?
3. Setelah saya jawab, rangkum spesifikasi final dalam 1 paragraf, MINTA konfirmasi saya.
4. Setelah saya konfirmasi, generate plugin sesuai Prompt A di atas.

Jangan langsung nulis kode sebelum spesifikasi dikonfirmasi.
```

---

## C. Contoh pengisian Prompt A

### Contoh 1 — FAQ harga (keyword + static reply)

```
Nama plugin: plugin-harga
Apa yang dilakukan: balas pertanyaan harga produk dari mapping statis { "kopi": 15000, "teh": 10000 }.
Trigger: keyword "harga", "berapa", "price"
Platform target: semua
Response type: static
Butuh state multi-step? tidak
Butuh dependency npm? tidak
Butuh middleware lokal? tidak
```

### Contoh 2 — Order wizard (regex + conversation)

```
Nama plugin: plugin-order
Apa yang dilakukan: terima order, tanya qty, konfirmasi, simpan ke DB.
Trigger: regex "^order\s+.+"
Platform target: whatsapp
Response type: dynamic
Butuh state multi-step? ya — step ask_qty → confirm → save. Cancel via "batal" / "/cancel". TTL 5 menit.
Butuh dependency npm? tidak
Butuh middleware lokal? ya — validateFormat: tolak kalau setelah "order " kosong.
```

### Contoh 3 — Image resize (onMedia + npm dep)

```
Nama plugin: plugin-image-resize
Apa yang dilakukan: kalau user kirim gambar, resize ke 800px lalu kirim balik.
Trigger: match "all" (cuma implement onMedia, jadi text tidak akan kena).
Platform target: semua
Response type: dynamic
Butuh state multi-step? tidak
Butuh dependency npm? sharp ^0.33
Butuh middleware lokal? tidak
```

---

## D. Tips supaya hasil Claude lebih bagus

- **Sebutkan plugin existing yang mirip** ("mirip plugin-faq tapi pakai DB lookup, bukan hardcoded map"). Claude akan langsung baca file itu sebagai referensi gaya.
- **Sebut error case yang harus di-handle**, bukan cuma happy path ("kalau qty bukan angka, balas error dan tetap di step yang sama").
- **Kalau pakai LLM/n8n/API eksternal**, sebutkan env var yang dipakai (`N8N_WEBHOOK_URL`, `OPENAI_API_KEY`, dll) — Claude akan baca dari `ctx.config` bukan `process.env` langsung kalau memang sudah ada di config loader.
- **Setelah Claude selesai**, minta dia jalankan `npm run typecheck` dan **kirim 1 pesan tes** lewat dev runner kalau ada, bukan cuma asumsi jalan.

---

## E. Anti-pola yang sering muncul (kasih tahu Claude kalau lihat)

| Anti-pola | Koreksi |
|---|---|
| Import dari `plugins/plugin-x/...` | Pindahkan ke `core/helpers/` atau jadikan SDK utility |
| `process.env.X` di tengah hook | Pakai `ctx.config.X` |
| `helpers.user.findOrCreate(msg.from)` tanpa platform | Wajib pass `ctx.platform` sebagai arg ke-2 |
| `createHealthCheck()` di dalam hook | Pindahkan ke top-level module |
| `conversation.enter()` tanpa TTL | TTL wajib (lihat §4 PLUGINS.md) |
| `msg.phoneNumber` sebagai key DB | Ganti ke `msg.from` |
| Migration plugin ditaruh di `core/db/migrations/` | Pindah ke `plugins/<nama>/migrations/` (lihat §8 PLUGINS.md) |
| Interpolasi input user ke string SQL | Parameterized query (`$1, $2`) |
| `any` di TypeScript | Pakai type dari `core/types.ts` |

---

## F. Pakai di claude.ai (website) — tanpa akses repo

Claude di website **tidak bisa baca file lokal**. Konteks harus kamu kasih manual.

### Cara cepat (recommended) — upload file

1. Buka chat baru di [claude.ai](https://claude.ai).
2. Klik tombol **attach** (📎), upload file-file ini dari repo:
   - `docs/PLUGINS.md` ← wajib, ini aturan main
   - `core/types.ts` ← wajib, signature Msg/Ctx/PluginDef
   - `core/plugin-sdk.ts` ← wajib, util `definePlugin`, `retry`, dll
   - 1 contoh plugin yang paling mirip use-case kamu, mis. `plugins/plugin-faq/index.ts` + `plugin.json`
3. Paste **Prompt A** dari section di atas, isi placeholder `{{ ... }}`.
4. Tambahkan baris ini di awal prompt (override instruksi "baca file" karena Claude website tidak punya tools):

   ```
   Konteks ada di file yang saya attach (PLUGINS.md, types.ts, plugin-sdk.ts, contoh plugin).
   Jangan minta saya akses repo — kerjakan dari attachment saja.
   Output langsung sebagai code blocks dengan header path file, mis.:

       // plugins/plugin-namaku/plugin.json
       { ... }

       // plugins/plugin-namaku/index.ts
       ...
   ```

5. Setelah Claude generate, **copy manual** tiap code block ke file lokal kamu. Bikin foldernya sendiri:

   ```bash
   mkdir plugins/plugin-namaku
   # paste isi plugin.json dan index.ts ke editor
   ```

6. Jalankan `npm run typecheck` di lokal — kalau ada error, paste error-nya balik ke Claude untuk diperbaiki.

### Versi paling minimal (kalau malas upload)

Kalau cuma plugin sederhana (keyword + reply teks), kamu bisa paste isi `PLUGINS.md` langsung ke chat. Tapi context window kepakai banyak, dan Claude bisa kelewat detail. **Lebih reliable: upload file.**

### Pakai Projects di claude.ai (best untuk repeat use)

Kalau sering bikin plugin di repo ini:

1. Di claude.ai, bikin **Project** baru, namai mis. "Bot Plugin Generator".
2. **Project knowledge**: upload sekali `PLUGINS.md`, `CORE.md`, `core/types.ts`, `core/plugin-sdk.ts`, dan 2-3 contoh plugin.
3. **Custom instructions** Project: paste isi "Aturan keras" + "Anti-pola" dari dokumen ini.
4. Sekali jadi, tiap chat baru di Project itu tinggal kirim **Prompt A** singkat — Claude sudah punya semua konteks.

> Re-upload knowledge tiap kali kamu update arsitektur (PLUGINS.md berubah, types.ts ada field baru), kalau tidak Claude akan generate kode pakai aturan lama.

### Perbedaan vs Claude Code (CLI/IDE)

| Aspek | claude.ai (web) | Claude Code |
|---|---|---|
| Akses file repo | Manual upload | Otomatis baca via `Read`/`Grep` |
| Bikin file ke disk | Copy-paste manual | Langsung `Write` ke folder |
| Jalankan `typecheck` | Kamu jalankan di terminal | Claude jalankan via `Bash` |
| Loop fix error | Paste error → tunggu fix → coba lagi | Otomatis sampai lulus |
| Cocok untuk | Plugin one-off / belajar arsitektur | Iterasi cepat di proyek aktif |

Kalau plugin yang kamu bikin non-trivial (multi-step, ada middleware, ada npm dep), pakai Claude Code di repo ini akan jauh lebih cepat daripada bolak-balik copy-paste dari web.

---

## G. Referensi
- Aturan lengkap: [PLUGINS.md](PLUGINS.id.md)
- Arsitektur core: [CORE.md](CORE.id.md)
- Roadmap: [ROADMAP.md](ROADMAP.id.md)
- Type definitions: [core/types.ts](../core/types.ts)
- SDK: [core/plugin-sdk.ts](../core/plugin-sdk.ts)
- Contoh plugin: [plugins/](../plugins/)
