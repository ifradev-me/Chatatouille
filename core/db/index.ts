import type { DbClient, DbCollection, HistoryEntry, User } from "../types.js";
import { pool } from "./pool.js";

// Field name (TS) → column name (Postgres).
// Helper di core/helpers/* tetap pakai field name TS — translasi terjadi di sini.
type FieldMap<T> = { [K in keyof T]: string };

const userFields: FieldMap<User> = {
  id: "id",
  from: "from_id",
  platform: "platform",
  name: "name",
  phoneNumber: "phone_number",
  lid: "lid",
  banned: "banned",
  welcomed: "welcomed",
  createdAt: "created_at",
};

const historyFields: FieldMap<HistoryEntry> = {
  id: "id",
  from: "from_id",
  platform: "platform",
  text: "text",
  role: "role",
  createdAt: "created_at",
};

function buildWhere<T>(query: Partial<T>, fieldMap: FieldMap<T>, startIdx = 1): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts: string[] = [];
  let i = startIdx;
  for (const key of Object.keys(query) as (keyof T)[]) {
    const col = fieldMap[key];
    if (!col) continue;
    params.push(query[key]);
    parts.push(`${col} = $${i++}`);
  }
  return { sql: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "", params };
}

function rowToObject<T>(row: Record<string, unknown>, fieldMap: FieldMap<T>): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fieldMap) as (keyof T)[]) {
    const col = fieldMap[key];
    if (row[col] !== undefined) out[key as string] = row[col];
  }
  return out as T;
}

function makePgCollection<T extends object>(
  table: string,
  fieldMap: FieldMap<T>,
): DbCollection<T> {
  return {
    async findOne(query) {
      const { sql, params } = buildWhere(query, fieldMap);
      const res = await pool.query(`SELECT * FROM ${table} ${sql} LIMIT 1`, params);
      return res.rowCount && res.rows[0] ? rowToObject<T>(res.rows[0], fieldMap) : null;
    },

    async find(query, opts) {
      const { sql, params } = buildWhere(query, fieldMap);
      const filters: string[] = [];
      if (sql) filters.push(sql.replace(/^WHERE\s+/, ""));
      if (opts?.since) {
        params.push(opts.since);
        filters.push(`created_at >= $${params.length}`);
      }
      const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const limitSql = opts?.limit ? `LIMIT ${Number(opts.limit)}` : "";
      const res = await pool.query(
        `SELECT * FROM ${table} ${whereSql} ORDER BY created_at DESC ${limitSql}`,
        params,
      );
      return res.rows.map((r) => rowToObject<T>(r, fieldMap));
    },

    async create(data) {
      const cols: string[] = [];
      const placeholders: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const key of Object.keys(data) as (keyof T)[]) {
        const col = fieldMap[key];
        if (!col) continue;
        // Skip id agar pakai default gen_random_uuid() bila tidak disediakan.
        if (key === ("id" as keyof T) && data[key] === undefined) continue;
        cols.push(col);
        placeholders.push(`$${i++}`);
        params.push(data[key]);
      }
      const res = await pool.query(
        `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
        params,
      );
      return rowToObject<T>(res.rows[0], fieldMap);
    },

    async updateOne(query, data) {
      const setParams: unknown[] = [];
      const sets: string[] = [];
      let i = 1;
      for (const key of Object.keys(data) as (keyof T)[]) {
        const col = fieldMap[key];
        if (!col) continue;
        sets.push(`${col} = $${i++}`);
        setParams.push(data[key]);
      }
      const where = buildWhere(query, fieldMap, i);
      const res = await pool.query(
        `UPDATE ${table} SET ${sets.join(", ")} ${where.sql} RETURNING *`,
        [...setParams, ...where.params],
      );
      if (!res.rowCount) throw new Error(`not found in ${table}`);
      return rowToObject<T>(res.rows[0], fieldMap);
    },

    async deleteMany(query) {
      const { sql, params } = buildWhere(query, fieldMap);
      await pool.query(`DELETE FROM ${table} ${sql}`, params);
    },
  };
}

export const db: DbClient = {
  users: makePgCollection<User>("users", userFields),
  history: makePgCollection<HistoryEntry>("history", historyFields),

  // Generic ad-hoc storage. Plugin yang butuh schema sendiri → tambah migration.
  async save(collection, data) {
    const res = await pool.query(
      "INSERT INTO events (collection, data) VALUES ($1, $2) RETURNING id, data",
      [collection, data],
    );
    const row = res.rows[0] as { id: string; data: Record<string, unknown> };
    return { id: row.id, ...row.data };
  },
};
