import type { HistoryHelpers } from "../types.js";
import { db } from "../db/index.js";

export const history: HistoryHelpers = {
  async get(from, platform, opts = {}) {
    return db.history.find({ from, platform }, { limit: opts.limit ?? 20, since: opts.since });
  },

  async append(msg, role, replyText) {
    await db.history.create({
      from: msg.from,
      platform: msg.platform,
      text: role === "user" ? msg.text : replyText ?? "",
      role,
      createdAt: new Date(),
    });
  },

  async clear(from, platform) {
    await db.history.deleteMany({ from, platform });
  },
};
