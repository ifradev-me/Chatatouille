import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { glob } from "glob";
import type { KeywordIndexEntry, LoadedPlugin, Platform, PluginDef, PluginManifest } from "./types.js";
import { logger } from "./logger.js";

const ROOT = process.cwd();
const KNOWN_PLATFORMS: readonly Platform[] = ["whatsapp", "telegram", "discord"];

/** Default fuzzy threshold global. Override per-plugin via `match.threshold`. */
export const DEFAULT_FUZZY_THRESHOLD = 0.6;

function validatePlatforms(name: string, platforms: unknown): Platform[] | undefined {
  if (platforms === undefined) return undefined;
  if (!Array.isArray(platforms)) {
    logger.warn({ plugin: name, platforms }, "[loader] platforms harus array — diabaikan");
    return undefined;
  }
  if (platforms.length === 0) {
    logger.warn(
      { plugin: name },
      "[loader] platforms: [] — plugin tidak akan jalan di mana pun",
    );
  }
  const unknown = platforms.filter((p) => !KNOWN_PLATFORMS.includes(p as Platform));
  if (unknown.length > 0) {
    logger.warn(
      { plugin: name, unknown, known: KNOWN_PLATFORMS },
      "[loader] platforms berisi nilai tidak dikenal (typo?)",
    );
  }
  return platforms as Platform[];
}

// Cek file middleware lokal ada saat boot — error sebenarnya baru muncul saat
// dispatch (lazy import di router), tapi warn dini jauh lebih mudah di-debug.
function validateMiddleware(name: string, dir: string, middleware: string[] | undefined): void {
  for (const mwName of middleware ?? []) {
    const found = ["js", "ts", "mjs"].some((ext) =>
      fs.existsSync(path.join(dir, "middleware", `${mwName}.${ext}`)),
    );
    if (!found) {
      logger.warn(
        { plugin: name, middleware: mwName },
        "[loader] file middleware tidak ditemukan — dispatch plugin ini akan error",
      );
    }
  }
}

function resolveHandlerPath(dir: string): string {
  // Compiled mode (dist): file ada di dist/plugins/x/index.js — pakai langsung.
  // Dev mode (tsx): file ada di plugins/x/index.ts — pakai juga.
  const candidates = [
    path.join(dir, "index.js"),
    path.join(dir, "index.ts"),
    path.join(dir, "index.mjs"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`[loader] index.{js,ts,mjs} tidak ditemukan di ${dir}`);
}

export async function loadPlugins(): Promise<LoadedPlugin[]> {
  // Search plugin.json di kedua lokasi: source (plugins/) dan compiled (dist/plugins/).
  const patterns = ["plugins/*/plugin.json", "dist/plugins/*/plugin.json"];
  const files = new Set<string>();
  for (const p of patterns) {
    for (const f of await glob(p, { cwd: ROOT })) {
      files.add(path.resolve(ROOT, f));
    }
  }

  // Kalau dist ada, prefer dist (lebih cepat, tanpa tsx).
  const distFiles = [...files].filter((f) => f.includes(`${path.sep}dist${path.sep}`));
  const srcFiles = [...files].filter((f) => !f.includes(`${path.sep}dist${path.sep}`));
  const chosen = distFiles.length > 0 ? distFiles : srcFiles;

  const loaded: LoadedPlugin[] = [];
  for (const file of chosen) {
    try {
      const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as PluginManifest;
      const dir = path.dirname(file);
      const handlerFile = resolveHandlerPath(dir);
      const mod = (await import(pathToFileURL(handlerFile).href)) as { default: PluginDef };
      const handler = mod.default;
      if (!handler) throw new Error("default export kosong");
      const platforms = validatePlatforms(manifest.name, manifest.platforms);
      validateMiddleware(manifest.name, dir, manifest.middleware);
      loaded.push({ ...manifest, platforms, dir, handler });
    } catch (err) {
      logger.error({ file, err: (err as Error).message }, "[loader] gagal load plugin");
    }
  }

  const active = loaded.filter((p) => p.enabled);
  const specifics = active.filter((p) => p.match.type !== "all");
  const fallbacks = active.filter((p) => p.match.type === "all");

  logger.info(
    {
      total: loaded.length,
      enabled: active.length,
      specifics: specifics.map((p) => p.name),
      fallbacks: fallbacks.map((p) => p.name),
    },
    "[loader] plugins loaded",
  );

  return [...specifics, ...fallbacks];
}

/**
 * Bangun keyword index global untuk fuzzy match centralized di router.
 * Setiap value pada plugin `match.type === "keyword"` jadi 1 entry.
 */
export function buildKeywordIndex(plugins: LoadedPlugin[]): KeywordIndexEntry[] {
  const index: KeywordIndexEntry[] = [];
  for (const p of plugins) {
    if (p.match.type !== "keyword") continue;
    const threshold = p.match.threshold ?? DEFAULT_FUZZY_THRESHOLD;
    for (const v of p.match.values ?? []) {
      index.push({ plugin: p.name, keyword: v.toLowerCase(), threshold });
    }
  }
  logger.info({ entries: index.length }, "[loader] keyword index built");
  return index;
}
