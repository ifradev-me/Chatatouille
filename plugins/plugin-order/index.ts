import { definePlugin, createRateLimit, formatMessage, match } from "../../core/plugin-sdk.js";

const limiter = createRateLimit(5, 60_000);

type OrderState =
  | { step: "ask_item" }
  | { step: "ask_qty"; item: string }
  | { step: "confirm"; item: string; qty: number };

const TTL_MS = 5 * 60_000;
const TRIGGERS = ["order", "pesan"];

// Buang kata trigger di depan kalau mirip "order"/"pesan" (toleran typo:
// "oder", "ordr", "pesn"). Return string item — kosong = user belum sebut item.
function extractItem(text: string): string {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length === 0) return "";
  if (TRIGGERS.some((t) => match(tokens[0], t, 0.55))) {
    return tokens.slice(1).join(" ").trim();
  }
  return text.trim();
}

export default definePlugin(async (msg, ctx) => {
  const active = ctx.helpers.conversation.current<OrderState>(msg.from, ctx.platform);

  // Cancel di mana pun dalam flow.
  if (active && (match(msg.text, "batal") || msg.text.toLowerCase() === "/cancel")) {
    ctx.helpers.conversation.exit(msg.from, ctx.platform);
    await ctx.reply("Order dibatalkan.");
    return;
  }

  // Entry: user trigger via fuzzy keyword "order"/"pesan" (toleran typo).
  if (!active) {
    if (!limiter(msg.from)) {
      await ctx.reply("Terlalu banyak request. Coba lagi dalam 1 menit.");
      return;
    }
    const item = extractItem(msg.text);
    if (!item) {
      // User hanya ketik "order" tanpa item — tanya itemnya dulu.
      ctx.helpers.conversation.enter(
        msg.from,
        ctx.platform,
        "plugin-order",
        { step: "ask_item" } satisfies OrderState,
        TTL_MS,
      );
      await ctx.reply("Mau pesan apa? (ketik nama produk, atau 'batal')");
      return;
    }
    ctx.helpers.conversation.enter(
      msg.from,
      ctx.platform,
      "plugin-order",
      { step: "ask_qty", item } satisfies OrderState,
      TTL_MS,
    );
    await ctx.reply(`Mau pesan barang bernama "${item}". Berapa banyak? (ketik angka, atau "batal")`);
    return;
  }

  // Step: ask_item
  if (active.state.step === "ask_item") {
    const item = msg.text.trim();
    if (!item) {
      await ctx.reply("Nama produk tidak boleh kosong. Coba lagi atau ketik 'batal'.");
      return;
    }
    ctx.helpers.conversation.update(
      msg.from,
      ctx.platform,
      { step: "ask_qty", item } satisfies OrderState,
    );
    await ctx.reply(`Mau pesan barang bernama "${item}". Berapa banyak? (ketik angka, atau "batal")`);
    return;
  }

  // Step: ask_qty
  if (active.state.step === "ask_qty") {
    const qty = parseInt(msg.text, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      await ctx.reply("angka harus angka > 0. Coba lagi, atau ketik 'batal'.");
      return;
    }
    ctx.helpers.conversation.update(
      msg.from,
      ctx.platform,
      { step: "confirm", item: active.state.item, qty } satisfies OrderState,
    );
    await ctx.reply(`Konfirmasi ${qty}× ${active.state.item}? (ketik "ya" / "tidak")`);
    return;
  }

  // Step: confirm
  if (active.state.step === "confirm") {
    if (match(msg.text, "ya")) {
      const order = await ctx.db.save("orders", {
        from: msg.from,
        platform: ctx.platform,
        item: active.state.item,
        qty: active.state.qty,
      });
      await ctx.reply(
        formatMessage(
          "Order #{{ id }} dibuat: {{ qty }}× {{ item }}. Estimasi {{ eta }} menit.",
          {
            id: String(order.id).slice(0, 8),
            qty: active.state.qty,
            item: active.state.item,
            eta: 15,
          },
        ),
      );
    } else {
      await ctx.reply("Order dibatalkan.");
    }
    ctx.helpers.conversation.exit(msg.from, ctx.platform);
  }
});
