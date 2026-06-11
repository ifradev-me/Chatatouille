import { definePlugin, createHealthCheck, retry } from "../../core/plugin-sdk.js";

const UNAVAILABLE_MSG = "Maaf, layanan AI sedang tidak tersedia. Coba lagi nanti.";
const ERROR_MSG = "Terjadi kesalahan saat memproses pesanmu. Coba lagi.";
const NOT_CONFIGURED_MSG = "Bot belum dikonfigurasi untuk balas otomatis. Coba ketik 'harga', 'ongkir', atau 'order <produk>'.";

const URL = process.env.N8N_WEBHOOK_URL ?? "";
const isHealthy = URL ? createHealthCheck(URL) : () => false;

export default definePlugin(async (msg, ctx) => {
  if (!URL) {
    await ctx.reply(NOT_CONFIGURED_MSG);
    return;
  }

  if (!isHealthy()) {
    await ctx.reply(UNAVAILABLE_MSG);
    return;
  }

  const [user, history] = await Promise.all([
    ctx.helpers.user.findOrCreate(msg.from, ctx.platform),
    ctx.helpers.history.get(msg.from, ctx.platform, { limit: 10 }),
  ]);

  let reply: string;
  try {
    const data = await retry(async () => {
      const res = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg.text,
          from: msg.from,
          platform: ctx.platform,
          user: { name: user.name, phoneNumber: user.phoneNumber, lid: user.lid },
          history: history.map((h) => ({ role: h.role, text: h.text })),
        }),
      });
      if (!res.ok) throw new Error(`n8n response ${res.status}`);
      return (await res.json()) as { reply: string };
    }, 3);
    reply = data.reply;
  } catch (err) {
    ctx.log.error({ err: (err as Error).message }, "[plugin-llm] n8n error");
    await ctx.reply(ERROR_MSG);
    return;
  }

  await Promise.all([
    ctx.helpers.history.append(msg, "user"),
    ctx.helpers.history.append(msg, "bot", reply),
  ]);

  await ctx.reply(reply);
});
