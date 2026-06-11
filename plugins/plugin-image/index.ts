import { definePlugin } from "../../core/plugin-sdk.js";
import path from "path";
import fs from "fs/promises";

// Plugin compress gambar pakai sharp. Disabled by default supaya
// project bisa di-build tanpa harus `npm install` di folder ini dulu.
// Aktifkan: cd plugins/plugin-image && npm install && set enabled: true.
export default definePlugin({
  async onMedia(msg, ctx) {
    if (!msg.media || msg.media.type !== "image") return;

    let sharp: (input: Buffer) => {
      resize: (opts: { width: number; withoutEnlargement?: boolean }) => {
        webp: (opts: { quality: number }) => { toFile: (path: string) => Promise<unknown> };
      };
    };
    try {
      // dynamic import supaya plugin tetap optional — package.json plugin
      // belum tentu di-install di root.
      const mod = (await import("sharp")) as unknown as { default: typeof sharp };
      sharp = mod.default;
    } catch {
      ctx.log.warn("[plugin-image] sharp belum di-install. cd plugins/plugin-image && npm install");
      return;
    }

    // msg.media.url di WhatsApp adapter sudah berupa path lokal hasil download.
    const source = msg.media.url;
    if (!source) return;

    const outDir = path.resolve("tmp");
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${msg.id}-compressed.webp`);

    const input = await fs.readFile(source);
    await sharp(input)
      .resize({ width: 800, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(outPath);

    const stat = await fs.stat(outPath);
    const originalKb = Math.round(input.byteLength / 1024);
    const resultKb = Math.round(stat.size / 1024);

    await ctx.replyMedia(outPath, `Gambar dikompres: ${originalKb}KB → ${resultKb}KB`);
    await fs.unlink(outPath).catch(() => undefined);
  },
});
