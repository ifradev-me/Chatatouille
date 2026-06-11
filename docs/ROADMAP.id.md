# Roadmap

> 🇬🇧 [English](ROADMAP.md) · 🇮🇩 Bahasa Indonesia

Status fitur + catatan implementasi. Nomor item dipakai sebagai referensi lintas dokumen (mis. "#7" = Push notification API) — **jangan renumber** item lama, tambah di bawah.

Legenda: ✅ selesai · 🚧 sebagian / stub · ⬜ belum

---

## 1. ✅ WhatsApp adapter (Baileys v7, LID-aware)

- `core/platforms/whatsapp.ts`. QR + pairing code, auto-reconnect dengan backoff, media download ke `tmp/`.
- LID↔PN resolution via `signalRepository.lidMapping`; `msg.from` prefer LID (lihat [PLUGINS.md §10](PLUGINS.id.md)).
- Hanya proses `messages.upsert` type `notify` — replay history saat sync tidak dibalas.

## 2. ✅ Telegram adapter (grammy)

- `core/platforms/telegram.ts`. Long polling (tanpa URL publik), media download via Bot API, join/leave events.
- Catatan: privacy mode bot harus di-disable via @BotFather supaya bisa baca pesan grup non-command.

## 3. ✅ Plugin system

- Loader (`core/loader.ts`): discovery `plugins/*/plugin.json` + `dist/plugins/`, prefer dist. Validasi `platforms[]` + file middleware saat boot.
- Router (`core/router.ts`): global middleware → conversation lock → fuzzy keyword (centralized, dice coefficient) → regex/all loop.
- Lifecycle hooks: `handle` / `onMedia` / `onJoin` / `onLeave`.
- Local middleware per-plugin (lazy load + cache).
- SDK (`core/plugin-sdk.ts`): `definePlugin`, `match`, `retry`, `formatMessage`, `createRateLimit`, `createHealthCheck`.

## 4. ✅ PostgreSQL storage + migrations

- `core/db/`: pool tunggal dari `DATABASE_URL`, raw SQL migrations auto-apply saat boot (tabel `_migrations`, transaksi per file).
- Tabel: `users` (UNIQUE from_id+platform), `history`, `events` (generic JSONB untuk `ctx.db.save`).

## 5. ✅ Conversation flow (multi-step)

- `ctx.helpers.conversation` — lock router ke satu plugin per (user, platform), TTL wajib, `force` untuk override.
- In-memory; hilang saat restart (by design — data durable simpan ke DB).
- Smoke test: `npm run sim:conversation` (butuh `npm run build` dulu).

## 6. ✅ Claude skill — plugin builder

- `claude-skill/bot-test-plugin-builder/` — skill untuk claude.ai yang scaffold plugin end-to-end (interview → plan → generate → test Python → tar.gz).
- Test internal: `cd claude-skill/bot-test-plugin-builder && python -m pytest tests/`.
- Version-pinned ke API core per 2026-05 — regenerate kalau `core/types.ts` berubah signature.

## 7. ⬜ Push notification API

- Endpoint HTTP (pakai `PORT` di config) supaya sistem eksternal (n8n, cron, dashboard) bisa trigger bot kirim pesan keluar tanpa pesan masuk.
- Perlu: auth token, rate limit per caller, antrian kirim yang hormati batas platform.

## 8. 🚧 Discord adapter

- `core/platforms/discord.ts` masih stub (log warning). Union `Platform` + config flag sudah ada.
- Implementasi: normalisasi ke `Msg` + `route(msg, ctx, plugins, keywordIndex)` — lihat pola di [CORE.md §5](CORE.id.md).

## 9. ⬜ `match.type: "intent"` (classifier)

- Placeholder di types + router (selalu skip). Rencana: classifier eksternal non-blocking, cache hasil per pesan.

## 10. ⬜ Graceful shutdown

- Tangkap SIGINT/SIGTERM → tutup pool pg, stop polling Telegram, logout-less close Baileys, flush log. Saat ini belum ada (lihat [CORE.md §12](CORE.id.md)).

## 11. ⬜ Plugin hot-reload

- Saat ini restart bot untuk load plugin baru (`tsx watch` sudah cukup di dev). Hot-reload butuh teardown protocol (timer/listener cleanup) + rebuild `keywordIndex`.

## 12. ⬜ Session helper per-platform

- `ctx.helpers.session` masih keyed by `from` saja — user dengan id sama di WA & Telegram berbagi session. `conversation` sudah per-platform. Mengubah `SessionHelpers` = breaking change untuk plugin; tunda sampai ada kebutuhan nyata, sementara pakai key manual `${platform}:${from}` kalau perlu isolasi.

## 13. ⬜ Test infrastructure TypeScript

- Belum ada unit test TS (baru `sim:conversation` + test Python di skill). Kandidat: vitest untuk router matching, helpers, plugin-sdk.

## 14. ✅ Plugin-owned PostgreSQL (schema per plugin)

- Plugin self-contained penuh: `plugins/<nama>/migrations/*.sql` + `createPluginDb(import.meta)` dari SDK.
- Isolasi via schema Postgres per plugin (`plugin-notes` → schema `plugin_notes`) dengan `search_path` di level koneksi — tabel polos tanpa qualifier, tidak mungkin tabrakan nama.
- Migration gagal → plugin di-exclude dari routing, bot tetap boot.
- Uninstall bersih: `DROP SCHEMA <schema> CASCADE` + hapus row `_migrations` + hapus folder.
- Contoh hidup: `plugins/plugin-notes/`. Panduan: [PLUGINS.md §8](PLUGINS.id.md).
