import { Pool } from "pg";
import { config } from "../config.js";

// ─── Plugin-owned PostgreSQL ─────────────────────────────────────────────────
// Setiap plugin mendapat schema Postgres sendiri (plugin-order → plugin_order).
// - Migrations plugin (plugins/<name>/migrations/*.sql) dijalankan dengan
//   search_path = <schema>, public — tabel tanpa qualifier masuk schema plugin.
// - Query lewat createPluginDb() juga jalan dengan search_path yang sama, jadi
//   plugin menulis SQL polos ("SELECT ... FROM notes") tanpa takut tabrakan
//   nama dengan core (public) atau plugin lain.
// Isolasi ini berbasis konvensi (semua plugin pakai satu DATABASE_URL) — tujuan
// utamanya mencegah tabrakan nama yang tidak disengaja, bukan security boundary.

/** Hasil query — subset pg.QueryResult yang stabil untuk plugin. */
export interface PluginQueryResult<R> {
  rows: R[];
  rowCount: number;
}

export type PluginQueryFn = <R = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<PluginQueryResult<R>>;

export interface PluginDb {
  /** Nama schema Postgres milik plugin (mis. "plugin_notes"). */
  schema: string;
  /** Query tunggal (auto-commit). Selalu pakai parameterized query ($1, $2…). */
  query: PluginQueryFn;
  /** Transaksi multi-statement. Rollback otomatis kalau callback throw. */
  tx<T>(fn: (query: PluginQueryFn) => Promise<T>): Promise<T>;
  /** Tutup pool — hanya untuk teardown test; bot production tidak perlu. */
  close(): Promise<void>;
}

const SCHEMA_RE = /^[a-z][a-z0-9_]*$/;

/** plugin-order → plugin_order. Throw kalau nama tidak menghasilkan identifier SQL valid. */
export function schemaFor(pluginName: string): string {
  const schema = pluginName.replace(/-/g, "_");
  if (!SCHEMA_RE.test(schema) || schema.length > 63) {
    throw new Error(
      `[plugin-db] nama plugin "${pluginName}" tidak valid untuk schema Postgres ` +
        `(harus kebab-case: huruf kecil/angka/dash, maks 63 char)`,
    );
  }
  return schema;
}

// Satu pool kecil per plugin, dibuat lazy saat query pertama. search_path
// di-set di level koneksi (startup options) — tanpa overhead per query.
const pools = new Map<string, Pool>();

function getPool(schema: string, max: number): Pool {
  let pool = pools.get(schema);
  if (!pool) {
    if (!config.DATABASE_URL) {
      throw new Error("[plugin-db] DATABASE_URL kosong. Isi di .env (lihat .env.example).");
    }
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max,
      options: `-c search_path=${schema},public`,
    });
    pool.on("error", (err) => {
      // Idle client error — log saja; query berikutnya reconnect.
      // eslint-disable-next-line no-console
      console.error(`[plugin-db:${schema}] idle client error:`, err.message);
    });
    pools.set(schema, pool);
  }
  return pool;
}

// Derivasi nama plugin dari import.meta — supaya plugin benar-benar
// self-contained (tidak hard-code nama sendiri yang bisa typo / drift dari
// nama folder). Bekerja di source (plugins/<name>/index.ts) maupun compiled
// (dist/plugins/<name>/index.js).
function pluginNameFromMeta(meta: ImportMeta): string {
  const pathname = decodeURIComponent(new URL(meta.url).pathname);
  const m = /[/\\]plugins[/\\]([^/\\]+)[/\\]/.exec(pathname);
  if (!m) {
    throw new Error(
      `[plugin-db] tidak bisa derive nama plugin dari ${meta.url} — ` +
        `file harus di dalam plugins/<nama>/; atau pass nama eksplisit: createPluginDb("plugin-x")`,
    );
  }
  return m[1];
}

/**
 * Akses PostgreSQL ber-schema untuk plugin. Panggil SEKALI di top-level module
 * (pool dibuat lazy — aman di-import meski plugin tidak selalu query).
 *
 *   const db = createPluginDb(import.meta);   // nama otomatis dari folder plugin
 *   const { rows } = await db.query<NoteRow>("SELECT * FROM notes WHERE from_id = $1", [msg.from]);
 *
 * Schema dibuat oleh migration runner saat boot (lihat core/db/migrate.ts) —
 * plugin tanpa folder migrations/ tetap bisa query tabel public.
 */
export function createPluginDb(plugin: string | ImportMeta, opts?: { max?: number }): PluginDb {
  const pluginName = typeof plugin === "string" ? plugin : pluginNameFromMeta(plugin);
  const schema = schemaFor(pluginName);
  const max = opts?.max ?? 3;

  const query: PluginQueryFn = async (sql, params) => {
    const res = await getPool(schema, max).query(sql, params);
    return { rows: res.rows, rowCount: res.rowCount ?? 0 };
  };

  return {
    schema,
    query,

    async tx(fn) {
      const client = await getPool(schema, max).connect();
      try {
        await client.query("BEGIN");
        const txQuery: PluginQueryFn = async (sql, params) => {
          const res = await client.query(sql, params);
          return { rows: res.rows, rowCount: res.rowCount ?? 0 };
        };
        const out = await fn(txQuery);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },

    async close() {
      const pool = pools.get(schema);
      if (pool) {
        pools.delete(schema);
        await pool.end();
      }
    },
  };
}
