// Simulasi conversation helper. Run: node scripts/sim-conversation.mjs
// (atau: npm run sim:conversation). Tidak butuh DB — helper-nya pure in-memory.
// Exit code: 0 semua PASS, 1 ada FAIL, 2 dist/ belum di-build.

let conversation;
try {
  ({ conversation } = await import("../dist/core/helpers/conversation.js"));
} catch {
  console.error("dist/ belum ada — jalankan `npm run build` dulu.");
  process.exit(2);
}

const FROM = "628123";
const PLATFORM = "whatsapp";

let failures = 0;

function check(label, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) console.log("  expected:", expected, "\n  actual  :", actual);
}

// ─── 1. Plugin-order start flow ──────────────────────────────────────────────
conversation.enter(FROM, PLATFORM, "plugin-order", { step: "ask_qty", item: "kopi" }, 60_000);
check(
  "1. plugin-order memulai flow",
  { plugin: "plugin-order", state: { step: "ask_qty", item: "kopi" } },
  conversation.current(FROM, PLATFORM),
);

// ─── 2. Plugin lain (plugin-survey) coba ikut start — DITOLAK ────────────────
conversation.enter(FROM, PLATFORM, "plugin-survey", { q: 1, score: 0 }, 60_000);
check(
  "2. plugin-survey TIDAK menggusur plugin-order (tanpa force)",
  { plugin: "plugin-order", state: { step: "ask_qty", item: "kopi" } },
  conversation.current(FROM, PLATFORM),
);

// ─── 3. Plugin-order update state — state shape sendiri ──────────────────────
conversation.update(FROM, PLATFORM, { step: "confirm", item: "kopi", qty: 2 });
check(
  "3. plugin-order update state (shape custom)",
  { plugin: "plugin-order", state: { step: "confirm", item: "kopi", qty: 2 } },
  conversation.current(FROM, PLATFORM),
);

// ─── 4. Force override (admin use case) ──────────────────────────────────────
conversation.enter(FROM, PLATFORM, "plugin-admin", { intent: "reset" }, 60_000, { force: true });
check(
  "4. plugin-admin override pakai force:true",
  { plugin: "plugin-admin", state: { intent: "reset" } },
  conversation.current(FROM, PLATFORM),
);

// ─── 5. Exit ─────────────────────────────────────────────────────────────────
conversation.exit(FROM, PLATFORM);
check("5. exit() bersihkan flow", null, conversation.current(FROM, PLATFORM));

// ─── 6. Sekarang plugin-survey bisa start ────────────────────────────────────
conversation.enter(FROM, PLATFORM, "plugin-survey", { q: 1, score: 0 }, 60_000);
check(
  "6. setelah exit, plugin lain bisa start",
  { plugin: "plugin-survey", state: { q: 1, score: 0 } },
  conversation.current(FROM, PLATFORM),
);
conversation.exit(FROM, PLATFORM);

// ─── 7. Isolasi per-user ─────────────────────────────────────────────────────
conversation.enter("user-A", PLATFORM, "plugin-order", { step: 1 }, 60_000);
conversation.enter("user-B", PLATFORM, "plugin-survey", { step: 1 }, 60_000);
check(
  "7a. user-A punya plugin-order",
  { plugin: "plugin-order", state: { step: 1 } },
  conversation.current("user-A", PLATFORM),
);
check(
  "7b. user-B punya plugin-survey (independen)",
  { plugin: "plugin-survey", state: { step: 1 } },
  conversation.current("user-B", PLATFORM),
);

// ─── 8. Isolasi per-platform ─────────────────────────────────────────────────
conversation.enter(FROM, "whatsapp", "plugin-order", { step: "wa" }, 60_000);
conversation.enter(FROM, "telegram", "plugin-survey", { step: "tg" }, 60_000);
check(
  "8a. from=628123 di WhatsApp = plugin-order",
  { plugin: "plugin-order", state: { step: "wa" } },
  conversation.current(FROM, "whatsapp"),
);
check(
  "8b. from=628123 di Telegram = plugin-survey (terpisah)",
  { plugin: "plugin-survey", state: { step: "tg" } },
  conversation.current(FROM, "telegram"),
);

// ─── 9. TTL expiry ───────────────────────────────────────────────────────────
conversation.enter("ttl-test", PLATFORM, "plugin-x", { foo: 1 }, 50); // 50ms
await new Promise((r) => setTimeout(r, 100));
check("9. TTL expiry auto-clear", null, conversation.current("ttl-test", PLATFORM));

console.log(failures > 0 ? `\nselesai — ${failures} FAIL.` : "\nselesai — semua PASS.");
process.exitCode = failures > 0 ? 1 : 0;
