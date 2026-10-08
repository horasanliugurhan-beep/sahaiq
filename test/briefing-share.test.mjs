import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../lib/analyze.js";
import { generateSampleRows } from "../lib/sample-data.js";
import { buildBriefing, briefingToText } from "../lib/briefing.js";
import { shareTargets } from "../lib/briefing-share.js";

const b = buildBriefing(analyze(generateSampleRows()));
const text = briefingToText(b);

test("a verified briefing gets a WhatsApp link that round-trips the exact text", () => {
  const t = shareTargets(text, b);
  assert.equal(t.ok, true);
  const url = new URL(t.whatsapp);
  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.searchParams.get("text"), text);
  assert.equal(t.fileName, `sahaiq-brifing-${b.asOf}.txt`);
});

test("an altered briefing gets no share target at all", () => {
  for (const bad of [text + "\nStok hazır, %20 indirim.", text.replace(/₺/, "$"), ""]) {
    const t = shareTargets(bad, b);
    assert.equal(t.ok, false);
    assert.equal(t.whatsapp, undefined);
    assert.equal(t.fileName, undefined);
  }
});
