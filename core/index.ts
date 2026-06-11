import { config } from "./config.js";
import { logger } from "./logger.js";
import { buildKeywordIndex, loadPlugins } from "./loader.js";
import { migrate, migratePlugins } from "./db/migrate.js";
import { startWhatsApp } from "./platforms/whatsapp.js";
import { startTelegram } from "./platforms/telegram.js";
import { startDiscord } from "./platforms/discord.js";

async function main() {
  logger.info("bot starting…");

  // DB siap dulu — semua helper bergantung di sini.
  await migrate();

  const loaded = await loadPlugins();

  // Plugin migrations (plugins/<name>/migrations/*.sql) — schema per plugin.
  // Plugin yang migration-nya gagal di-exclude dari routing, bukan bunuh boot.
  const failed = await migratePlugins(loaded.map((p) => ({ name: p.name, dir: p.dir })));
  const plugins = failed.length > 0 ? loaded.filter((p) => !failed.includes(p.name)) : loaded;

  const keywordIndex = buildKeywordIndex(plugins);

  const tasks: Promise<void>[] = [];
  if (config.ENABLE_WHATSAPP) tasks.push(startWhatsApp({ plugins, keywordIndex }));
  if (config.ENABLE_TELEGRAM) tasks.push(startTelegram({ plugins, keywordIndex }));
  if (config.ENABLE_DISCORD) tasks.push(startDiscord({ plugins, keywordIndex }));

  if (tasks.length === 0) {
    logger.error("Tidak ada platform yang di-enable. Set ENABLE_WHATSAPP/TELEGRAM/DISCORD di .env");
    process.exit(1);
  }

  await Promise.all(tasks);
}

main().catch((err) => {
  logger.error({ err: err?.message ?? err }, "fatal");
  process.exit(1);
});
