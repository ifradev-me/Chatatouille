import { definePlugin } from "../../core/plugin-sdk.js";

// match: all aman di sini karena hanya implement onJoin/onLeave —
// core dispatch berdasar msg.event, jadi pesan teks tidak masuk ke sini.
export default definePlugin({
  async onJoin(msg, ctx) {
    await ctx.reply(`Selamat datang, ${msg.pushName ?? msg.from}!`);
  },
  async onLeave(msg, ctx) {
    await ctx.reply(`Sampai jumpa, ${msg.pushName ?? msg.from}.`);
  },
});
