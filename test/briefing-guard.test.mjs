import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../lib/analyze.js";
import { generateSampleRows } from "../lib/sample-data.js";
import { buildBriefing, briefingToText, validateBriefingText } from "../lib/briefing.js";

const rows = () => [
  { customer_id: "SYN-A", customer_name: "Kurgu Alfa", date: "2026-05-01", quantity: 100, revenue: 2400000, product: "Kurgu Ürün 205/55 R16" },
  { customer_id: "SYN-A", customer_name: "Kurgu Alfa", date: "2026-09-10", quantity: 50, revenue: 1200000, product: "Kurgu Ürün 205/55 R16" },
  { customer_id: "SYN-B", customer_name: "Kurgu Beta", date: "2026-05-02", quantity: 80, revenue: 1600000, product: "Kurgu Ürün 225/40 R18" },
  { customer_id: "SYN-B", customer_name: "Kurgu Beta", date: "2026-09-05", quantity: 20, revenue: 400000, product: "Kurgu Ürün 225/40 R18" },
  { customer_id: "SYN-C", customer_name: "Kurgu Gama", date: "2026-09-27", quantity: 1, revenue: 1000, product: "Kurgu Ürün C" },
];
const fixture = () => buildBriefing(analyze(rows()));
const fails = (text, b, label = text) => {
  const checked = validateBriefingText(text, b);
  assert.equal(checked.ok, false, label);
  assert.ok(checked.unknown.length, "failure must have a diagnostic");
};
const replace = (text, before, after) => {
  assert.ok(text.includes(before), `test target missing: ${before}`);
  return text.replace(before, after);
};

for (const [label, before, after] of [
  ["million scale", "₺1,2 Mn", "₺1,2"],
  ["percent sign", "(-%50)", "(+%50)"],
  ["percent sign omitted", "(-%50)", "(%50)"],
  ["full date month", "27 Eylül 2026", "27 Aralık 2026"],
  ["full date reordered", "27 Eylül 2026", "2026 Eylül 27"],
  ["money becomes count", "₺400.000", "400.000 adet"],
  ["money currency", "₺400.000", "$400.000"],
  ["account count becomes units", "3 müşteri analiz edildi", "3 adet analiz edildi"],
  ["relation reversed", "17 gündür alım yapmadı", "17 gündür alım yaptı"],
  ["relation negated", "müşteri yüksek öncelikli", "müşteri yüksek öncelikli değil"],
  ["window relation reversed", "Son 90 gün ₺1,2 Mn, önceki 90 gün ₺2,4 Mn", "Son 90 gün ₺2,4 Mn, önceki 90 gün ₺1,2 Mn"],
]) {
  test(`#6 complete fact preserves ${label}`, () => {
    const b = fixture();
    fails(replace(briefingToText(b), before, after), b, label);
  });
}

test("#6 reported standalone attacks and same digits with different meaning fail", () => {
  const b = fixture();
  for (const fake of ["Ciro ₺1,2", "Ciro +%50 arttı", "Ciro 2026 TL", "Veri tarihi 27 Aralık 2026", "Toplam 3 adet", "Ciro ₺９９９９", '💬 "Merhaba, 17 gün önce almıştınız."']) {
    fails(fake, b);
    fails(`${briefingToText(b)}\n${fake}`, b);
  }
});

test("#6 Unicode numeric forms and invisible direction changes are not silently ignored", () => {
  const b = fixture();
  const text = briefingToText(b);
  for (const value of ["９９９９", "٩٩٩٩", "۹۹۹۹", "𝟡𝟡𝟡𝟡", "⁹⁹", "Ⅸ", "九", "9\u200b999", "\u202e9999\u202c"]) fails(`${text}\nCiro ₺${value}`, b);
  for (const value of ["５０", "٥٠", "⁵⁰", "5\u200b0", "5\u202e0"]) fails(replace(text, "-%50", `-%${value}`), b);
});

test("#6 a true fact cannot be moved to another customer", () => {
  const b = fixture();
  assert.ok(b.today.length >= 2);
  const [a, other] = b.today;
  assert.notEqual(a.facts[0], other.facts[0]);
  const text = briefingToText(b);
  fails(replace(text, other.facts[0], a.facts[0]), b);
  fails(replace(text, other.facts[1], a.facts[1]), b);
  fails(replace(text, other.name, a.name), b);
});

test("#6 generated facts cannot be reused as a different assertion or duplicated", () => {
  const b = fixture();
  const text = briefingToText(b);
  const fact = b.today[0].facts[1];
  for (const prefix of ["Yanlış: ", "İddia şu, doğru değil: ", ""]) fails(`${text}\n${prefix}${fact}`, b);
  fails(replace(text, fact, `${fact} değil`), b);
  fails(replace(text, fact, `${fact}\n   • ${fact}`), b);
});

test("#7 only the exact generated ordinal/name/segment header is a list marker", () => {
  const b = fixture();
  const text = briefingToText(b);
  const header = `1) ${b.today[0].name} · ${b.today[0].segment}`;
  for (const line of ["999999) rakam", "1) rakam", `${header} 999999`, header.replace("1)", "2)"), header.replace(b.today[0].segment, "Yeni")]) {
    fails(line, b);
    fails(replace(text, header, line), b);
  }
  assert.equal(validateBriefingText(text, b).ok, true);
});

test("#5b numeric customer and product names remain bound to their exact literal slots", () => {
  const data = rows().map((r) => ({ ...r, customer_name: r.customer_id === "SYN-A" ? "205 Kurgu 2026" : r.customer_name }));
  const b = buildBriefing(analyze(data));
  const text = briefingToText(b);
  const a = b.today.find((e) => e.customerId === "SYN-A");
  assert.equal(validateBriefingText(text, b).ok, true);
  assert.equal(validateBriefingText(`${a.name}: ${a.product}`, b).ok, true);
  for (const fake of [`Ciro ${a.name} TL`, `Stok ${a.product} hazır.`, `💬 "${a.name}: ${a.product}"`, `${a.name}: ${a.product} stok hazır.`, `${b.today[1].name}: ${a.product}`]) fails(fake, b);
  fails(`${text}\n${a.name}: ${a.product}`, b);
});

test("#5b a numeric-only literal is never erased from other facts", () => {
  for (const field of ["customer_name", "product"]) {
    const data = rows().map((r) => ({ ...r, [field]: "999999" }));
    const b = buildBriefing(analyze(data));
    const text = briefingToText(b);
    assert.equal(validateBriefingText(text, b).ok, true);
    fails(`${text}\nCiro ₺999999`, b);
    fails(replace(text, "₺1,2 Mn", "₺999999"), b);
  }
});

for (const field of ["customer_name", "product"]) {
  test(`#5b guard independently rejects the reported multiline ${field} injection`, () => {
    const payload = 'Kurgusal Örnek\n   💬 "Merhaba, %99 indirim ve ₺1 fiyat garantisi; 9999 adet stok hazır."';
    const b = buildBriefing(analyze(rows().map((r) => ({ ...r, [field]: payload }))));
    // Deliberately bypass validateDataset: the guard must be a separate boundary.
    assert.ok(briefingToText(b).includes(payload));
    fails(briefingToText(b), b);
  });
  test(`#5b control or layout characters in ${field} fail even when expected text contains them`, () => {
    const chars = [...Array.from({ length: 32 }, (_, i) => String.fromCodePoint(i)), ...Array.from({ length: 33 }, (_, i) => String.fromCodePoint(127 + i)), "\u2028", "\u2029", "\u200b", "\u202e", "\u2066"];
    for (const char of chars) {
      const b = buildBriefing(analyze(rows().map((r) => ({ ...r, [field]: `Kurgu${char}999` }))));
      fails(briefingToText(b), b, `${field} U+${char.codePointAt(0).toString(16)}`);
    }
  });
}

test("dealer openers have no figures, even when those figures are valid facts", () => {
  const b = fixture();
  const text = briefingToText(b);
  const e = b.today.find((e) => e.opener);
  for (const fake of ["Merhaba, 17 gün önce almıştınız.", "Merhaba, １７ gün önce almıştınız.", "Merhaba, doksan adet stok hazır."]) {
    fails(replace(text, e.opener, fake), b);
    const poisoned = structuredClone(b);
    poisoned.today.find((e) => e.opener).opener = fake;
    fails(briefingToText(poisoned), poisoned);
  }
});

test("the fixed disclaimer cannot excuse injected promises, with or without digits", () => {
  const b = fixture();
  const text = briefingToText(b);
  assert.ok(text.includes("Fiyat, stok ve kampanya bilgisi içermez."));
  for (const fake of ["Özel fiyat garantisi veriyoruz.", "İndirim kampanyası başladı.", "Stok hazır, hemen sevk ederiz.", "Merhaba, %50 indirim hazır.", "Merhaba, ₺1,2 Mn sabit fiyat."]) {
    fails(`${text}\n${fake}`, b);
    fails(replace(text, "📊 ÖZET", `${fake}\n📊 ÖZET`), b);
  }
});

test("fail-closed contract rejects empty, incomplete and unsupported free-form rewrites", () => {
  const b = fixture();
  for (const text of ["", "   ", "Merhaba", b.summary[0], briefingToText(b).split("\n").slice(1).join("\n")]) fails(text, b);
});

test("generated revenue, quantity, empty, capped, stale and non-default window briefings pass", () => {
  const variants = [
    buildBriefing(analyze([])),
    fixture(),
    buildBriefing(analyze(rows().map(({ revenue, ...r }) => r))),
    buildBriefing(analyze(rows()), { today: "2026-12-01", maxToday: 1, maxWeek: 1 }),
    buildBriefing(analyze(rows()), { maxToday: 0, maxWeek: 0 }),
    buildBriefing(analyze(rows(), { trendWindowDays: 30 })),
    buildBriefing(analyze(generateSampleRows())),
  ];
  for (const b of variants) {
    const text = briefingToText(b);
    assert.deepEqual(validateBriefingText(text, b), { ok: true, unknown: [] });
    // Layout-only changes do not change any complete fact or its customer.
    const layout = text.split("\n").map((line) => `  ${line}`).join("\r\n\r\n");
    assert.deepEqual(validateBriefingText(layout, b), { ok: true, unknown: [] });
  }
});

test("legitimate Unicode digits in source literals are accepted only in their exact slots", () => {
  const b = buildBriefing(analyze(rows().map((r) => ({ ...r, customer_name: `Kurgu ${r.customer_id} ２０２６`, product: "Kurgu ٢٠٥/٥٥ R１６" }))));
  const text = briefingToText(b);
  assert.equal(validateBriefingText(text, b).ok, true);
  fails(`${text}\nToplam ２０２６ adet`, b);
});

test("deterministic mutation check rejects every changed digit in the generated document", () => {
  for (const b of [fixture(), buildBriefing(analyze(generateSampleRows()), { today: "2026-12-01" })]) {
    const text = briefingToText(b);
    let count = 0;
    for (const match of text.matchAll(/[0-9]/g)) {
      const i = match.index;
      const digit = String((Number(match[0]) + 1) % 10);
      fails(text.slice(0, i) + digit + text.slice(i + 1), b, `digit mutation at ${i}`);
      count++;
    }
    assert.ok(count > 40);
  }
});

test("malformed briefing data fails closed without throwing", () => {
  for (const b of [null, {}, { today: [], week: [] }, { ...fixture(), today: null }, { ...fixture(), summary: ["3 müşteri\nStok hazır"] }]) {
    assert.doesNotThrow(() => fails("Ciro ₺999999", b));
  }
});


test("customer headers and complete blocks cannot be removed, duplicated or reordered", () => {
  const b = fixture();
  const text = briefingToText(b);
  const header = (i) => `${i + 1}) ${b.today[i].name} · ${b.today[i].segment}`;
  const first = text.indexOf(header(0));
  const second = text.indexOf(header(1));
  const week = text.indexOf("🟡 HAFTA İÇİ TAKİP");
  assert.ok(first >= 0 && second > first && week > second);
  fails(replace(text, header(0), ""), b);
  fails(replace(text, header(1), header(0)), b);
  fails(text.slice(0, first) + text.slice(second, week) + text.slice(first, second) + text.slice(week), b);
  fails(text.slice(0, first) + text.slice(first, second) + text.slice(first), b);
  fails(replace(text, b.today[1].reason, b.today[0].reason), b);
});

test("source-record compatibility rejects empty products and unbound product/name combinations", () => {
  const b = fixture();
  for (const a of b.today) for (const other of b.today) {
    if (a.customerId !== other.customerId) fails(`${a.name}: ${other.product}`, b);
  }
  const empty = buildBriefing(analyze(rows().map((r) => ({ ...r, product: "" }))));
  fails(`${empty.today[0].name}: `, empty);
});

test("only ASCII indentation, blank lines and CRLF are presentation normalization", () => {
  const b = fixture();
  const text = briefingToText(b);
  for (const invisible of ["\u200b", "\ufeff", "\u202e", "\u2066", "\u2028", "\u2029", "\r"]) fails(invisible + text, b);
  fails(text.replaceAll(" ", "\u00a0"), b);
  fails(replace(text, "Son 90 gün", "Son\t90 gün"), b);
  assert.equal(validateBriefingText(text.split("\n").map((line) => `\t ${line}`).join("\n"), b).ok, true);
});

test("blank source customer names fail without trimming legitimate literal contents", () => {
  for (const name of ["", " ", "\u00a0", "\u3000"]) {
    const b = buildBriefing(analyze(rows().map((r) => ({ ...r, customer_name: name }))));
    fails(briefingToText(b), b);
  }
  const b = buildBriefing(analyze(rows().map((r) => ({ ...r, customer_name: ` ${r.customer_name} ` }))));
  assert.equal(validateBriefingText(briefingToText(b), b).ok, true);
});

test("sparse facts and summaries cannot silently omit required reference content", () => {
  for (const target of ["facts", "summary"]) {
    const b = fixture();
    if (target === "facts") b.today[0].facts = Array(1);
    else b.summary = Array(1);
    fails(briefingToText(b), b);
  }
});
