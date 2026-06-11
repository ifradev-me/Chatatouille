import type { MiddlewareFn } from "../../../core/types.js";

const validate: MiddlewareFn = async (msg, ctx) => {
  if (!msg.text || msg.text.length < 3) {
    await ctx.reply("Pertanyaan terlalu pendek. Mohon detailnya.");
    ctx.stop();
  }
};

export default validate;
