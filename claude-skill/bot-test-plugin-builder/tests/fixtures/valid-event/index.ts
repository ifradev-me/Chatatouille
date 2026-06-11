import { definePlugin } from "../../core/plugin-sdk.js";

export default definePlugin({
  async onJoin(msg, ctx) {
    await ctx.reply(`Welcome, ${msg.pushName ?? msg.from}`);
  },
  async onLeave(msg, ctx) {
    await ctx.reply(`Bye, ${msg.pushName ?? msg.from}`);
  },
});
