import type { PluginDef } from "../../core/types.js";

// Router pakai fuzzy match — branch internal harus pakai ctx.matched.keyword,
// BUKAN text.includes() (yang akan miss kalau user mengetik typo seperti "hrga").
const faq: PluginDef = {
  async handle(msg, ctx) {
    switch (ctx.matched?.keyword) {
      case "harga":
        await ctx.reply("Harga produk kami mulai dari Rp10.000.");
        return;
      case "ongkir":
        await ctx.reply("Ongkir gratis untuk pembelian di atas Rp50.000.");
        return;
      case "stok":
        await ctx.reply("Stok produk diperbarui setiap hari. Sebutkan nama produknya.");
        return;
      default:
        // Tidak ada keyword yang match — biasanya tidak terjadi karena router
        // hanya dispatch ke plugin ini saat ada fuzzy hit. Defensive log saja.
        ctx.log.warn({ text: msg.text }, "[plugin-faq] dispatched tanpa ctx.matched");
    }
  },
};

export default faq;
