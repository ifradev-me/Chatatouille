import { definePlugin, createPluginDb } from "../../core/plugin-sdk.js";

// Contoh plugin dengan tabel PostgreSQL sendiri — self-contained penuh:
// handler + manifest + migrations hidup di folder ini, tabel hidup di schema
// "plugin_notes". Panduan lengkap: docs/PLUGINS.md §8.
//
// Pemakaian:
//   "catat beli kopi besok"  → simpan catatan
//   "catatan"                → tampilkan 5 catatan terakhir

interface NoteRow {
  id: string;
  text: string;
  created_at: Date;
}

// import.meta → nama plugin diturunkan dari nama folder (plugins/plugin-notes/)
// — tidak ada nama hard-coded yang bisa drift. Pool dibuat lazy; aman di top-level.
const db = createPluginDb(import.meta);

export default definePlugin(async (msg, ctx) => {
  const text = msg.text.trim();

  try {
    // "catatan" → list. Tabel "notes" resolve ke plugin_notes.notes via search_path.
    if (/^catatan\b/i.test(text)) {
      const { rows } = await db.query<NoteRow>(
        "SELECT id, text, created_at FROM notes WHERE from_id = $1 AND platform = $2 ORDER BY created_at DESC LIMIT 5",
        [msg.from, msg.platform],
      );
      if (rows.length === 0) {
        await ctx.reply("Belum ada catatan. Ketik: catat <isi catatan>");
        return;
      }
      await ctx.reply(
        ["Catatan terakhir:", ...rows.map((r, i) => `${i + 1}. ${r.text}`)].join("\n"),
      );
      return;
    }

    // "catat <isi>" → simpan.
    const isi = text.replace(/^catat\s*/i, "").trim();
    if (!isi) {
      await ctx.reply("Format: catat <isi catatan>");
      return;
    }
    await db.query(
      "INSERT INTO notes (from_id, platform, text) VALUES ($1, $2, $3)",
      [msg.from, msg.platform, isi],
    );
    await ctx.reply("Tersimpan ✓ — ketik 'catatan' untuk lihat 5 terakhir.");
  } catch (err) {
    ctx.log.error({ err: (err as Error).message }, "[plugin-notes] query gagal");
    await ctx.reply("Lagi ada gangguan penyimpanan. Coba lagi sebentar lagi.");
  }
});
