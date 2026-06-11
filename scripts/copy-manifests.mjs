// Copy file non-TS yang tidak di-emit tsc:
// - plugins/*/plugin.json + package.json → dist/plugins/
// - plugins/*/migrations/*.sql            → dist/plugins/*/migrations/
// - core/db/migrations/*.sql              → dist/core/db/migrations/

import { cp, readdir, stat, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const PLUGIN_SRC = resolve("plugins");
const PLUGIN_DST = resolve("dist", "plugins");
const MIGRATIONS_SRC = resolve("core", "db", "migrations");
const MIGRATIONS_DST = resolve("dist", "core", "db", "migrations");

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyPluginManifests() {
  if (!(await exists(PLUGIN_SRC))) return;
  await mkdir(PLUGIN_DST, { recursive: true });
  const dirs = await readdir(PLUGIN_SRC, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const from = join(PLUGIN_SRC, d.name);
    const to = join(PLUGIN_DST, d.name);
    await mkdir(to, { recursive: true });
    for (const name of ["plugin.json", "package.json"]) {
      const src = join(from, name);
      if (await exists(src)) {
        await cp(src, join(to, name));
      }
    }
    // Migrations milik plugin (schema per plugin — lihat core/db/migrate.ts).
    const migSrc = join(from, "migrations");
    if (await exists(migSrc)) {
      const migDst = join(to, "migrations");
      await mkdir(migDst, { recursive: true });
      for (const f of await readdir(migSrc)) {
        if (f.endsWith(".sql")) {
          await cp(join(migSrc, f), join(migDst, f));
        }
      }
    }
  }
}

async function copyMigrations() {
  if (!(await exists(MIGRATIONS_SRC))) return;
  await mkdir(MIGRATIONS_DST, { recursive: true });
  const files = await readdir(MIGRATIONS_SRC, { withFileTypes: true });
  for (const f of files) {
    if (!f.isFile() || !f.name.endsWith(".sql")) continue;
    await cp(join(MIGRATIONS_SRC, f.name), join(MIGRATIONS_DST, f.name));
  }
}

async function main() {
  await copyPluginManifests();
  await copyMigrations();
  console.log("[copy-manifests] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
