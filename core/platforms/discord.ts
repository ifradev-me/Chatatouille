import type { KeywordIndexEntry, LoadedPlugin } from "../types.js";
import { logger } from "../logger.js";

// Stub: belum diimplementasikan. Tambah adapter Discord kapan saja —
// pastikan menormalisasi pesan ke format `Msg` lalu panggil route(msg, ctx, plugins, keywordIndex).
export async function startDiscord(_opts: {
  plugins: LoadedPlugin[];
  keywordIndex: KeywordIndexEntry[];
}): Promise<void> {
  logger.warn("[discord] adapter belum diimplementasi");
}
