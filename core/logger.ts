import pino from "pino";
import { config } from "./config.js";
import type { Logger } from "./types.js";

// pino-pretty hanya untuk dev — di production CPU-nya mahal; raw JSON ke
// stdout biar log collector di luar yang parse.
const pretty = process.env.NODE_ENV !== "production";

const base = pino({
  level: config.LOG_LEVEL,
  ...(pretty
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        },
      }
    : {}),
});

export const logger: Logger = base;
export const rawLogger = base;
