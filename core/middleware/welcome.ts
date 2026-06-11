import type { MiddlewareFn } from "../types.js";

// First-contact welcome. Jalan SEKALI per user (per platform) — di-track lewat
// kolom users.welcomed yang di-flip ke true setelah pesan terkirim.
// Tidak ctx.stop() — plugin tetap jalan setelah ini. User dapat 2 pesan:
// welcome dulu, lalu jawaban plugin yang relevan.

const WELCOME_MSG = [
  "👋 Selamat datang!",
  "",
  "Beberapa hal yang bisa saya bantu:",
  "• Ketik 'bantuan' untuk daftar perintah.",
  "• Ketik 'order <nama>' untuk pesan barang.",
  "• Tanya 'harga', 'ongkir', atau 'stok' untuk FAQ.",
].join("\n");

const welcome: MiddlewareFn = async (msg, ctx) => {
  // Hanya untuk pesan teks. Skip media/join/leave supaya tidak noisy.
  if (msg.event !== "message") return;
  if (msg.fromMe) return;
  // Hanya private chat — onboarding ke seluruh grup hanya jadi spam.
  // Sambutan join grup adalah urusan plugin (onJoin), bukan middleware ini.
  if (msg.isGroup) return;

  const user = await ctx.helpers.user.find(msg.from, msg.platform);
  if (!user || user.welcomed) return;

  try {
    await ctx.reply(WELCOME_MSG);
    await ctx.helpers.user.update(msg.from, msg.platform, { welcomed: true });
  } catch (err) {
    ctx.log.error({ err: (err as Error).message }, "[welcome] failed");
  }
};

export default welcome;
