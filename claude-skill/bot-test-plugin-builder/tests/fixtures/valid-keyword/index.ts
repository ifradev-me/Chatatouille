import type { PluginDef } from "../../core/types.js";

const p: PluginDef = {
  async handle(msg, ctx) {
    switch (ctx.matched?.keyword) {
      case "price":
        await ctx.reply("ok price");
        return;
      case "shipping":
        await ctx.reply("ok shipping");
        return;
    }
  },
};

export default p;
