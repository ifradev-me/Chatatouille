import type { MiddlewareFn } from "../types.js";

const WINDOW_MS = 60_000;
const MAX = 30;

interface Entry {
  count: number;
  resetAt: number;
}

const counts = new Map<string, Entry>();

// Sweep berkala — tanpa ini map tumbuh tanpa batas (satu entri per user yang
// pernah kirim pesan). unref supaya timer tidak menahan shutdown.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, e] of counts) {
    if (now > e.resetAt) counts.delete(k);
  }
}, 5 * 60_000);
sweeper.unref();

const ratelimit: MiddlewareFn = async (msg, ctx) => {
  if (msg.fromMe) return;
  const now = Date.now();
  const entry = counts.get(msg.from);

  if (!entry || now > entry.resetAt) {
    counts.set(msg.from, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }

  entry.count++;
  if (entry.count === MAX + 1) {
    await ctx.reply("Terlalu banyak pesan. Coba lagi dalam 1 menit.");
    ctx.stop();
    return;
  }
  if (entry.count > MAX) {
    ctx.stop();
  }
};

export default ratelimit;
