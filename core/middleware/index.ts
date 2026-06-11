import type { MiddlewareFn } from "../types.js";
import logger from "./logger.js";
import ratelimit from "./ratelimit.js";
import auth from "./auth.js";
import welcome from "./welcome.js";

// Urutan penting:
//   logger    — observability dulu, tahu apa yang masuk.
//   ratelimit — block spam sebelum DB write.
//   auth      — pastikan user ada di DB (findOrCreate) + cek banned.
//   welcome   — first-contact welcome (butuh user di DB).
export const globalMiddlewares: MiddlewareFn[] = [logger, ratelimit, auth, welcome];
