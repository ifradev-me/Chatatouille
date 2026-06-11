import type { UserHelpers } from "../types.js";
import { db } from "../db/index.js";

// Semua lookup PER-PLATFORM. WA `"628123"` ≠ Telegram `"628123"`.
// Schema: UNIQUE (from, platform).
export const user: UserHelpers = {
  async find(from, platform) {
    return db.users.findOne({ from, platform });
  },

  async findOrCreate(from, platform, extra) {
    const existing = await db.users.findOne({ from, platform });
    if (existing) {
      // Backfill phoneNumber/lid/name jika sebelumnya kosong (mis. migrasi LID di WA).
      if (extra && (extra.phoneNumber || extra.lid || extra.name)) {
        const patch: Partial<typeof existing> = {};
        if (extra.phoneNumber && !existing.phoneNumber) patch.phoneNumber = extra.phoneNumber;
        if (extra.lid && !existing.lid) patch.lid = extra.lid;
        if (extra.name && !existing.name) patch.name = extra.name;
        if (Object.keys(patch).length > 0) {
          return db.users.updateOne({ from, platform }, patch);
        }
      }
      return existing;
    }
    try {
      return await db.users.create({
        from,
        platform,
        banned: false,
        createdAt: new Date(),
        ...extra,
      } as Parameters<typeof db.users.create>[0]);
    } catch (err) {
      // 23505 = unique violation: dua pesan pertama datang bersamaan dan
      // sama-sama lolos findOne null. User sudah dibuat oleh request lain.
      if ((err as { code?: string }).code === "23505") {
        const winner = await db.users.findOne({ from, platform });
        if (winner) return winner;
      }
      throw err;
    }
  },

  async update(from, platform, data) {
    return db.users.updateOne({ from, platform }, data);
  },

  async ban(from, platform) {
    await db.users.updateOne({ from, platform }, { banned: true });
  },

  async isBanned(from, platform) {
    const u = await db.users.findOne({ from, platform });
    return u?.banned ?? false;
  },
};
