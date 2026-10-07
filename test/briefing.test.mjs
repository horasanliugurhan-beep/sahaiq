import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../lib/analyze.js";
import { generateSampleRows } from "../lib/sample-data.js";
import { buildBriefing, briefingToText, validateBriefingText } from "../lib/briefing.js";

const result = analyze(generateSampleRows());

test("briefing lists the highest-priority customers first and shows the data date", () => {
  const b = buildBriefing(result, { today: "2026-09-30" });
  const t = briefingToText(b);
  assert.ok(t.startsWith("🗓 SAHA BRİFİNGİ · veri tarihi 27 Eylül 2026"));
  assert.equal(b.today[0].customerId, result.callList[0].customerId);
  assert.ok(b.today.length <= 5 && b.week.length <= 5);
  assert.equal(b.stale, false);
});

test("stale data is labelled", () => {
  const b = buildBriefing(result, { today: "2026-12-01" });
  assert.ok(b.stale);
  assert.match(briefingToText(b), /bugünün durumunu göstermez/);
});

test("the generated text passes its own number guard", () => {
  const b = buildBriefing(result, { today: "2026-09-30" });
  assert.deepEqual(validateBriefingText(briefingToText(b), b), { ok: true, unknown: [] });
});

test("invented figures, sizes or prices are caught", () => {
  const b = buildBriefing(result, { today: "2026-09-30" });
  const t = briefingToText(b);
  for (const fake of ["Michelin R21'de özel fiyat", "22.000 TL potansiyel", "Ciro %79 düştü", "4'lü takım"]) {
    const r = validateBriefingText(t + "\n" + fake, b);
    assert.equal(r.ok, false, fake);
  }
});

test("product names with digits are allowed when they come from the data", () => {
  const b = buildBriefing(result, { today: "2026-09-30" });
  const e = b.today.find((x) => x.product);
  assert.ok(validateBriefingText(`${e.name}: ${e.product}`, b).ok);
});

test("no offers, prices or campaigns and no figures in dealer openers", () => {
  const b = buildBriefing(result, { today: "2026-09-30" });
  const t = briefingToText(b).toLocaleLowerCase("tr");
  for (const w of ["kampanya", "özel fiyat", "indirim", "teklif:"]) assert.equal(t.includes(w) && !t.includes("kampanya bilgisi içermez"), false, w);
  for (const e of [...b.today, ...b.week]) if (e.opener) assert.doesNotMatch(e.opener, /\d/);
});

test("openers vary within a section", () => {
  const b = buildBriefing(result, { today: "2026-09-30" });
  const ops = b.today.map((e) => e.opener).filter(Boolean);
  assert.ok(new Set(ops).size > 1);
});
