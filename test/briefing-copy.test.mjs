import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze } from "../lib/analyze.js";
import { generateSampleRows } from "../lib/sample-data.js";
import { buildBriefing, briefingToText, validateBriefingText } from "../lib/briefing.js";

// Execute the actual small dashboard handler with browser dependencies stubbed.
// This is a handler regression test, not browser/clipboard-permission E2E.
const source = readFileSync(new URL("../app/dashboard.js", import.meta.url), "utf8");
const handler = source.match(/  async function copyBriefing\(\) \{([\s\S]*?)\n  \}\n/);
assert.ok(handler, "dashboard copy handler must be available to the regression test");
const run = new Function("briefing", "navigator", "setCopied", "setTimeout", "validateBriefingText", `${handler[0]}; return copyBriefing();`);

function fixture() {
  const b = buildBriefing(analyze(generateSampleRows()));
  return { b, text: briefingToText(b), check: { ok: true, unknown: [] } };
}
async function attempt(briefing, writeText) {
  const messages = [];
  const timers = [];
  await run(briefing, { clipboard: { writeText } }, (message) => messages.push(message), (callback) => timers.push(callback), validateBriefingText);
  assert.equal(timers.length, 1);
  return { messages, timers };
}

test("invalid briefing never calls clipboard, even if an earlier badge said valid", async () => {
  const briefing = fixture();
  briefing.text += "\nStok hazır, özel fiyat garantisi veriyoruz.";
  let writes = 0;
  const result = await attempt(briefing, async () => { writes++; });
  assert.equal(writes, 0);
  assert.deepEqual(result.messages, ["Doğrulanmayan brifing kopyalanamaz"]);
});

test("unsafe imported source reference also blocks the copy handler independently", async () => {
  const b = buildBriefing(analyze(generateSampleRows().map((r) => ({ ...r, customer_name: "Kurgu\u202e999" }))));
  let writes = 0;
  await attempt({ b, text: briefingToText(b), check: { ok: true } }, async () => { writes++; });
  assert.equal(writes, 0);
});

test("valid briefing is copied exactly once and keeps success/reset feedback", async () => {
  const briefing = fixture();
  const writes = [];
  const result = await attempt(briefing, async (text) => { writes.push(text); });
  assert.deepEqual(writes, [briefing.text]);
  assert.deepEqual(result.messages, ["Kopyalandı"]);
  result.timers[0]();
  assert.deepEqual(result.messages, ["Kopyalandı", ""]);
});

test("clipboard permission failure retains the manual-copy feedback for valid text", async () => {
  const result = await attempt(fixture(), async () => { throw new Error("permission denied"); });
  assert.deepEqual(result.messages, ["Kopyalanamadı; metni seçip elle kopyalayın"]);
});

test("copy button is disabled when the briefing guard fails", () => {
  assert.match(source, /<button[^>]*onClick=\{copyBriefing\}[^>]*disabled=\{!briefing\.check\.ok\}/);
});
