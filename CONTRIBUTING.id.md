# Contributing

> 🇬🇧 [English](CONTRIBUTING.md) · 🇮🇩 Bahasa Indonesia

Terima kasih sudah mau berkontribusi! Repo ini sengaja dibuat mudah dipelajari — hampir semua keputusan desain terdokumentasi.

## Mulai dari mana

| Mau apa | Baca |
|---|---|
| Bikin plugin baru (fitur bot) | [docs/PLUGINS.md](docs/PLUGINS.id.md) — 99% kontribusi cukup di sini, **tanpa menyentuh `core/`** |
| Mengubah core (router, loader, DB, platform) | [docs/CORE.md](docs/CORE.id.md) — per-bagian: kapan, file mana, pitfall-nya |
| Lihat status fitur / cari ide | [docs/ROADMAP.md](docs/ROADMAP.id.md) |
| Generate plugin pakai Claude | [docs/CLAUDE_PROMPT.md](docs/CLAUDE_PROMPT.id.md) atau skill di [claude-skill/](claude-skill/) |

## Setup development

```bash
npm install
cp .env.example .env          # minimal isi DATABASE_URL (lihat README untuk Postgres cepat via Docker)
npm run dev                   # tsx watch — auto-reload
```

## Sebelum buka PR

```bash
npm run typecheck             # wajib lulus
npm run build                 # wajib lulus (tsc + copy manifests/migrations)
npm run sim:conversation      # smoke test conversation helper (butuh build dulu)
```

Kalau menyentuh `claude-skill/`:

```bash
cd claude-skill/bot-test-plugin-builder
python -m pytest tests/       # 46+ test wajib lulus, lalu regenerate tarball (lihat plan.md §8)
```

## Aturan utama

1. **Plugin self-contained.** Semua kode, manifest, middleware, migrations, dan dependency plugin hidup di foldernya sendiri. Jangan import dari plugin lain; jangan tambah migration plugin ke `core/db/migrations/`.
2. **Perubahan `core/types.ts` harus backward-compatible** — field/hook baru selalu opsional (`?`). Checklist lengkap: [docs/CORE.md §13](docs/CORE.id.md).
3. **Update dokumen yang relevan di PR yang sama.** Fitur tanpa dokumentasi dianggap belum selesai. Mapping ada di [docs/CORE.md §13](docs/CORE.id.md).
4. **Jangan commit secrets** (`.env` sudah di `.gitignore` — biarkan begitu).
5. **PR kecil & fokus** lebih cepat di-review daripada satu PR raksasa.

## Konvensi

- TypeScript strict, ESM (`.js` extension di import), camelCase di TS ↔ snake_case di SQL.
- Komentar dalam Bahasa Indonesia atau Inggris — konsisten dalam satu file.
- Log pakai pino-style: `log.info({ obj }, "pesan")`. Level: `debug` dev info, `info` lifecycle, `warn` recoverable, `error` failure.

## Lisensi

Dengan berkontribusi, Anda setuju kontribusi Anda dilisensikan di bawah [MIT License](LICENSE).
