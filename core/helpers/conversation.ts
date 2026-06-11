import type { ConversationHelpers, ConversationState, Platform } from "../types.js";

// Standalone store (bukan ber-share dengan SessionHelpers) supaya TTL preserved
// saat update(). Key dipisah per-platform supaya WA "628123" dan Telegram "628123"
// adalah flow yang independen.

interface Entry {
  plugin: string;
  state: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();

function key(from: string, platform: Platform): string {
  return `__conv__:${platform}:${from}`;
}

function alive(k: string): Entry | null {
  const e = store.get(k);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    store.delete(k);
    return null;
  }
  return e;
}

export const conversation: ConversationHelpers = {
  enter(from, platform, plugin, state, ttlMs, opts) {
    const k = key(from, platform);
    if (!opts?.force && alive(k)) return;
    store.set(k, { plugin, state, expiresAt: Date.now() + ttlMs });
  },

  update(from, platform, state) {
    const k = key(from, platform);
    const e = alive(k);
    if (!e) return;
    store.set(k, { plugin: e.plugin, state, expiresAt: e.expiresAt });
  },

  current<T = unknown>(from: string, platform: Platform): ConversationState<T> | null {
    const e = alive(key(from, platform));
    if (!e) return null;
    return { plugin: e.plugin, state: e.state as T };
  },

  exit(from, platform) {
    store.delete(key(from, platform));
  },
};
