import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./pool.js";
import { schemaFor } from "./plugin.js";
import { logger } from "../logger.js";

// Format filename: [urutan]_[YYYYMMDD]_[HHMMSS]_[epoch_s]_[deskripsi].sql
// Migrations diurut by filename (urutan numerik di depan).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function ensureMigrationTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function listApplied(): Promise<Set<string>> {
  const res = await pool.query<{ filename: string }>("SELECT filename FROM _migrations");
  return new Set(res.rows.map((r) => r.filename));
}

function listOnDisk(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function migrate(): Promise<void> {
  await ensureMigrationTable();
  const applied = await listApplied();
  const files = listOnDisk();
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    logger.info({ applied: files.length }, "[migrate] up-to-date");
    return;
  }

  logger.info({ pending: pending.length }, "[migrate] applying…");

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      logger.info({ file }, "[migrate] applied");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      logger.error({ file, err: (err as Error).message }, "[migrate] failed");
      throw err;
    } finally {
      client.release();
    }
  }
}

// ─── plugin migrations ───────────────────────────────────────────────────────
// plugins/<name>/migrations/*.sql — format filename sama dengan core.
// Tiap file jalan dalam transaksi dengan search_path = <schema plugin>, public
// sehingga `CREATE TABLE notes (...)` masuk schema plugin, bukan public.
// Tracking di tabel _migrations yang sama, di-namespace: "<plugin>/<filename>".

export interface PluginMigrationTarget {
  name: string;
  dir: string;
}

/**
 * Jalankan pending migrations milik plugin. Dipanggil SETELAH migrate() core
 * dan setelah loadPlugins() (butuh dir tiap plugin).
 *
 * Kegagalan TIDAK menghentikan boot — plugin yang migration-nya gagal
 * dikembalikan sebagai daftar nama supaya caller bisa exclude dari routing
 * (satu plugin rusak tidak boleh bunuh bot — konsisten dengan loader).
 */
export async function migratePlugins(targets: PluginMigrationTarget[]): Promise<string[]> {
  const failed: string[] = [];
  if (targets.length === 0) return failed;

  await ensureMigrationTable();
  const applied = await listApplied();

  for (const target of targets) {
    const dir = path.join(target.dir, "migrations");
    if (!fs.existsSync(dir)) continue;

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const pending = files.filter((f) => !applied.has(`${target.name}/${f}`));
    if (pending.length === 0) continue;

    let schema: string;
    try {
      schema = schemaFor(target.name);
    } catch (err) {
      logger.error({ plugin: target.name, err: (err as Error).message }, "[migrate] plugin skip");
      failed.push(target.name);
      continue;
    }

    logger.info({ plugin: target.name, pending: pending.length }, "[migrate] plugin migrations…");

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // schema sudah divalidasi schemaFor() — aman di-interpolate.
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
        await client.query(`SET LOCAL search_path TO ${schema}, public`);
        await client.query(sql);
        await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [
          `${target.name}/${file}`,
        ]);
        await client.query("COMMIT");
        logger.info({ plugin: target.name, file }, "[migrate] applied");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        logger.error(
          { plugin: target.name, file, err: (err as Error).message },
          "[migrate] plugin migration failed — plugin di-exclude dari routing",
        );
        failed.push(target.name);
        break; // file berikutnya plugin ini pasti bergantung pada yang gagal
      } finally {
        client.release();
      }
    }
  }

  return failed;
}
