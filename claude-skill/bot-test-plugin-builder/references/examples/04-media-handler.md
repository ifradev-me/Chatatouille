# Example: media-only plugin (onMedia)

Triggered when user sends an image/video/file/audio. Plugin's `match: all` is safe here because the router only dispatches by event — text messages never reach `onMedia`.

## `plugin.json`

```json
{
  "name": "plugin-image-meta",
  "enabled": true,
  "match": { "type": "all" }
}
```

## `index.ts`

```ts
import { definePlugin } from "../../core/plugin-sdk.js";

export default definePlugin({
  async onMedia(msg, ctx) {
    if (!msg.media) return;

    // Image: log metadata, echo size.
    if (msg.media.type === "image") {
      ctx.log.info(
        { from: msg.from, mime: msg.media.mimeType, url: msg.media.url },
        "[plugin-image-meta] image received",
      );
      await ctx.reply(`Got your image (${msg.media.mimeType ?? "unknown type"}).`);
      return;
    }

    // Other media types: just acknowledge.
    if (msg.media.type === "video") {
      await ctx.reply("Got your video.");
    } else if (msg.media.type === "audio") {
      await ctx.reply("Got your audio.");
    } else if (msg.media.type === "file") {
      await ctx.reply("Got your file.");
    }
  },
});
```

## Notes

- `msg.media.url` is a **local file path** on disk (downloaded by the adapter into `tmp/`).
- `msg.text` is `""` for media events — captions land in `msg.text` if the platform supports them (WA caption, Telegram caption).
- For image processing (resize, compress), import a library in the hook via dynamic `import()`:
  ```ts
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    ctx.log.warn("sharp not installed; cd plugins/plugin-image-meta && npm install");
    return;
  }
  ```
- If the plugin needs its own deps, generate a `package.json` for it too (skill will offer this).
- **Clean up temp files** after processing — they accumulate in `tmp/`.

## When to use this pattern

- Image classifier / OCR
- Audio transcription
- File-type validation
- Auto-compress images before storing
