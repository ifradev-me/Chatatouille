import stringComparison from "string-comparison";
import type { Ctx, Msg, PluginDef } from "./types.js";

// ─── createPluginDb ──────────────────────────────────────────────────────────
// PostgreSQL milik plugin: schema terisolasi + migrations di folder plugin.
// Implementasi & dokumentasi API: core/db/plugin.ts; panduan: docs/PLUGINS.md.

export { createPluginDb, schemaFor } from "./db/plugin.js";
export type { PluginDb, PluginQueryFn, PluginQueryResult } from "./db/plugin.js";

// ─── definePlugin ────────────────────────────────────────────────────────────
// Dua gaya:
//   definePlugin({ handle, onMedia, ... })   → plugin kompleks
//   definePlugin(async (msg, ctx) => {})     → plugin sederhana (handle saja)

export function definePlugin(
  impl: PluginDef | ((msg: Msg, ctx: Ctx) => Promise<void>),
): PluginDef {
  if (typeof impl === "function") {
    return { handle: impl };
  }
  if (!impl.handle && !impl.onMedia && !impl.onJoin && !impl.onLeave) {
    throw new Error("[plugin-sdk] Plugin harus punya minimal satu lifecycle hook");
  }
  return impl;
}

// ─── checkHealth ─────────────────────────────────────────────────────────────

export async function checkHealth(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── createHealthCheck ───────────────────────────────────────────────────────
// Cek berkala di background; panggil sekali saat plugin load. Return isHealthy().

export function createHealthCheck(url: string, intervalMs = 30_000): () => boolean {
  let healthy = true;

  const check = async () => {
    healthy = await checkHealth(url);
  };

  void check();
  const timer = setInterval(check, intervalMs);
  // Jangan ganggu shutdown
  if (typeof timer.unref === "function") timer.unref();

  return () => healthy;
}

// ─── retry ───────────────────────────────────────────────────────────────────

export async function retry<T>(fn: () => Promise<T>, times = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // Jangan sleep setelah percobaan terakhir — langsung throw.
      if (i < times - 1) await new Promise((r) => setTimeout(r, 200 * 2 ** i));
    }
  }
  throw lastError;
}

// ─── formatMessage ───────────────────────────────────────────────────────────

export function formatMessage(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
    key in vars ? String(vars[key]) : `{{${key}}}`,
  );
}

// ─── match ───────────────────────────────────────────────────────────────────
// Fuzzy boolean check untuk branch internal plugin. Dipakai mis. untuk cek
// "ya"/"tidak" di conversation flow tanpa harus exact string match.
//   match("yaa",  "ya")            → true
//   match("tdk",  "tidak")         → true (sekitar 0.6+)
//   match("kopi", "teh")           → false
//
// `threshold` default mengikuti DEFAULT_FUZZY_THRESHOLD di loader (0.6).
// Naikkan kalau plugin perlu strict, turunkan kalau toleran.

const dice = stringComparison.diceCoefficient;

export function match(a: string, b: string, threshold = 0.6): boolean {
  if (!a || !b) return false;
  return dice.similarity(a.toLowerCase(), b.toLowerCase()) >= threshold;
}

// ─── createRateLimit ─────────────────────────────────────────────────────────
// Rate limit per-plugin, independen dari global ratelimit di core.

export function createRateLimit(max: number, windowMs: number) {
  const counts = new Map<string, { count: number; resetAt: number }>();

  // Buang entri expired saat map membesar — tanpa ini map tumbuh tanpa batas
  // (satu entri per key yang pernah lewat).
  function prune(now: number): void {
    for (const [k, e] of counts) {
      if (now > e.resetAt) counts.delete(k);
    }
  }

  return function check(key: string): boolean {
    const now = Date.now();
    if (counts.size >= 1024) prune(now);
    const entry = counts.get(key);

    if (!entry || now > entry.resetAt) {
      counts.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (entry.count >= max) return false;

    entry.count++;
    return true;
  };
}
