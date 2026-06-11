import type { SessionHelpers } from "../types.js";

interface Entry {
  data: unknown;
  expiresAt: number | null;
}

const store = new Map<string, Entry>();

export const session: SessionHelpers = {
  get<T>(from: string): T | null {
    const entry = store.get(from);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      store.delete(from);
      return null;
    }
    return entry.data as T;
  },

  set<T>(from: string, data: T, ttlMs?: number) {
    store.set(from, {
      data,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    });
  },

  clear(from) {
    store.delete(from);
  },

  has(from) {
    return session.get(from) !== null;
  },
};
