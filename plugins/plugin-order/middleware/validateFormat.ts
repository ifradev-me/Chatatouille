import type { MiddlewareFn } from "../../../core/types.js";

const validate: MiddlewareFn = async (msg, ctx) => {
  const rest = msg.text.replace(/^order\s+/i, "").trim();
  if (!rest) {
    await ctx.reply("Format tidak valid. Ketik: order [nama produk]");
    ctx.stop();
  }
};

export default validate;
