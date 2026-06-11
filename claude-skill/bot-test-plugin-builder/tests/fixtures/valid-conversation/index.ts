import { definePlugin, match } from "../../core/plugin-sdk.js";

type S = { step: "ask" } | { step: "confirm" };

export default definePlugin(async (msg, ctx) => {
  const active = ctx.helpers.conversation.current<S>(msg.from, ctx.platform);
  if (active && match(msg.text, "batal")) {
    ctx.helpers.conversation.exit(msg.from, ctx.platform);
    await ctx.reply("cancelled");
    return;
  }
  if (!active) {
    ctx.helpers.conversation.enter(msg.from, ctx.platform, "valid-conversation", { step: "ask" }, 60_000);
    await ctx.reply("what?");
    return;
  }
  if (active.state.step === "ask") {
    ctx.helpers.conversation.update(msg.from, ctx.platform, { step: "confirm" });
    await ctx.reply("confirm?");
    return;
  }
  if (active.state.step === "confirm") {
    ctx.helpers.conversation.exit(msg.from, ctx.platform);
    await ctx.reply("done");
  }
});
