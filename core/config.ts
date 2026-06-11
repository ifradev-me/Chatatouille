import "dotenv/config";
import type { Config } from "./types.js";

function bool(v: string | undefined, def = false): boolean {
  if (v === undefined) return def;
  return v === "1" || v.toLowerCase() === "true";
}

function num(v: string | undefined, def: number): number {
  // `Number("")` = 0 — env var yang ada tapi kosong (PORT=) harus jatuh ke default.
  if (v === undefined || v.trim() === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export const config: Config = {
  WA_SESSION_PATH: process.env.WA_SESSION_PATH ?? "./sessions/wa",
  WA_USE_PAIRING_CODE: bool(process.env.WA_USE_PAIRING_CODE, false),
  WA_PHONE_NUMBER: process.env.WA_PHONE_NUMBER ?? "",
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN ?? "",
  DISCORD_TOKEN: process.env.DISCORD_TOKEN ?? "",
  ENABLE_WHATSAPP: bool(process.env.ENABLE_WHATSAPP, true),
  ENABLE_TELEGRAM: bool(process.env.ENABLE_TELEGRAM, false),
  ENABLE_DISCORD: bool(process.env.ENABLE_DISCORD, false),
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL ?? "",
  PORT: num(process.env.PORT, 3000),
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
};
