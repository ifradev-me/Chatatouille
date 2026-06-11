import type { PluginDef } from "../../core/types.js";

const ABOUT_MSG = [
  "Saya bot test — bot modular untuk WhatsApp & Telegram.",
  "Ketik 'bantuan' untuk daftar perintah yang tersedia.",
].join("\n");

const HELP_MSG = [
  "Perintah yang tersedia:",
  "",
  "• about / siapa / info  — info tentang bot",
  "• bantuan / help        — daftar perintah ini",
  "• harga / ongkir / stok — FAQ produk",
  "• order <nama>          — pesan barang (multi-step flow)",
  "",
  "Ketik 'batal' kapan saja untuk membatalkan flow yang sedang berjalan.",
].join("\n");

const about: PluginDef = {
  async handle(msg, ctx) {
    switch (ctx.matched?.keyword) {
      case "about":
      case "siapa":
      case "info":
        await ctx.reply(ABOUT_MSG);
        return;
      case "bantuan":
      case "help":
        await ctx.reply(HELP_MSG);
        return;
      default:
        ctx.log.warn({ text: msg.text }, "[plugin-about] dispatched tanpa ctx.matched");
    }
  },
};

export default about;
