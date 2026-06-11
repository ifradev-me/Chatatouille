import type { MiddlewareFn } from "../types.js";

// Cek ban + auto-register user. Plugin downstream bisa asumsi user sudah ada di DB.
const auth: MiddlewareFn = async (msg, ctx) => {
  if (msg.fromMe) {
    ctx.stop();
    return;
  }

  const user = await ctx.helpers.user.findOrCreate(msg.from, msg.platform, {
    name: msg.pushName,
    phoneNumber: msg.phoneNumber,
    lid: msg.lid,
  });

  if (user.banned) {
    ctx.stop();
    return;
  }
};

export default auth;
