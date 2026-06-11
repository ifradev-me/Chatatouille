import { Pool } from "pg";
import { config } from "../config.js";

if (!config.DATABASE_URL) {
  throw new Error(
    "[db] DATABASE_URL kosong. Isi di .env (lihat .env.example). " +
      "Format: postgres://user:pass@host:port/dbname",
  );
}

export const pool = new Pool({ connectionString: config.DATABASE_URL });

pool.on("error", (err) => {
  // Idle client errors — log saja, jangan crash. Query baru akan reconnect.
  // eslint-disable-next-line no-console
  console.error("[db] idle client error:", err.message);
});
