import test from "node:test";
import assert from "node:assert/strict";
import { parseTable } from "../lib/import/csv.js";
import { autoMap, parseLocalizedNumber, validateDataset } from "../lib/import/schema.js";
import { analyze, SEGMENTS } from "../lib/analyze.js";
import { buildBriefing, briefingToText, validateBriefingText } from "../lib/briefing.js";
import { evaluateRules } from "../lib/action-engine-rules.js";
import * as format from "../lib/format.js";

function importSales(lines, options = {}) {
  const table = parseTable(["customer_id;customer_name;date;quantity;revenue", ...lines].join("\n"));
  return validateDataset(table, autoMap(table.headers), options);
}

for (const locale of ["tr-TR", "en-US"]) {
  for (const money of [false, true]) {
    test(`#10 ${locale} ${money ? "money" : "quantity"}: parentheses cannot contain another sign`, () => {
      const parse = (value) => parseLocalizedNumber(value, { locale, money });
      assert.equal(parse("(10)"), -10);
      assert.equal(parse("-10"), -10);
      assert.equal(parse("+10"), 10);
      for (const value of ["(-10)", "(+10)", "( -10 )", "( +10 )"]) {
        assert.throws(() => parse(value), /işaret/, value);
      }
    });
  }
  test(`#10 ${locale}: conflicting signs block import with source row numbers`, () => {
    const decimal = locale === "tr-TR" ? "," : ".";
    const result = importSales([
      "SYN-01;Kurgu Bayi;2026-09-01;2;100",
      `SYN-01;Kurgu Bayi;2026-09-02;(-2);(-100${decimal}00)`,
      `SYN-01;Kurgu Bayi;2026-09-03;(+2);(+100${decimal}00)`,
    ], { locale });
    assert.equal(result.errorCount, 4);
    assert.deepEqual(result.errors.map(({ row, field }) => [row, field]), [
      [3, "quantity"], [3, "revenue"], [4, "quantity"], [4, "revenue"],
    ]);
    assert.equal(result.rows.length, 1);
  });
}

for (const [label, lines, expectedTotal] of [
  ["one return", ["SYN-01;Kurgu Bayi;2026-09-01;-2;-200"], -200],
  ["zero quantity", ["SYN-01;Kurgu Bayi;2026-09-01;0;0"], 0],
  ["multiple return-only accounts", [
    "SYN-01;Kurgu Bayi;2026-08-01;-2;-200",
    "SYN-02;Örnek Bayi;2026-09-01;-1;-100",
  ], -300],
]) {
  test(`#3 ${label}: no positive purchase has no recency, RFM or sales action`, () => {
    const checked = importSales(lines);
    assert.equal(checked.errorCount, 0);
    const result = analyze(checked.rows);
    assert.equal(result.kpis.total, expectedTotal); // returns still affect net totals
    assert.equal(result.segmentCounts.no_purchase, result.customers.length);
    assert.equal(SEGMENTS.no_purchase.label, "Alım geçmişi yok");
    for (const customer of result.customers) {
      assert.equal(customer.hasPurchase, false);
      for (const field of ["firstDate", "lastDate", "recency_days", "lastContactDays", "tenureDays", "R", "F", "M"]) {
        assert.equal(customer[field], null, field);
      }
      assert.equal(customer.frequency, 0);
      assert.equal(customer.segment_key, "no_purchase");
    }
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.callList, []);
    const briefing = buildBriefing(result);
    assert.deepEqual(briefing.today, []);
    assert.deepEqual(briefing.week, []);
    assert.doesNotMatch(briefingToText(briefing), /Son alım|null|NaN|Şampiyon/);
    assert.equal(validateBriefingText(briefingToText(briefing), briefing).ok, true);
  });
}

test("#3 accounts without purchases do not alter purchasers' quintiles", () => {
  const sale = "SYN-01;Kurgu Satış;2026-09-01;2;100";
  const alone = analyze(importSales([sale]).rows).customers[0];
  const mixed = analyze(importSales([sale, "SYN-02;Kurgu İade;2026-09-01;0;1000"]).rows);
  assert.deepEqual(mixed.customers.find((c) => c.id === "SYN-01"), alone);
  assert.equal(mixed.customers.find((c) => c.id === "SYN-02").segment_key, "no_purchase");
});

test("#3 a mixed cohort keeps all buyer quintiles unchanged", () => {
  const sales = Array.from({ length: 10 }, (_, i) => `SYN-${i};Kurgu Satış ${i};2026-09-${String(i + 1).padStart(2, "0")};${i + 1};${(i + 1) * 100}`);
  const buyers = analyze(importSales(sales).rows, { asOf: "2026-09-10" }).customers;
  const mixed = analyze(importSales([
    ...sales,
    "SYN-NONE;Kurgu Düzeltme;2026-09-10;0;10000",
    "SYN-RETURN;Kurgu İade;2026-09-10;-1;-100",
  ]).rows, { asOf: "2026-09-10" });
  assert.deepEqual(mixed.customers.filter((c) => c.hasPurchase), buyers);
  assert.equal(mixed.segmentCounts.no_purchase, 2);
});

test("#3 dashboard recency distinguishes no purchases from today's purchase", () => {
  assert.equal(format.fmtRecency(null), "Alım yok");
  assert.equal(format.fmtRecency(null, { compact: true }), "Alım yok");
  assert.equal(format.fmtRecency(0), "bugün");
  assert.equal(format.fmtRecency(12), "12 gün önce");
  assert.equal(format.fmtRecency(12, { compact: true }), "12 gün");
});

test("#3 non-purchase adjustments cannot trigger a sales decline action", () => {
  const result = analyze(importSales([
    "SYN-01;Kurgu Düzeltme;2026-03-01;0;100",
    "SYN-01;Kurgu Düzeltme;2026-06-30;0;-50",
  ]).rows);
  assert.equal(result.customers[0].trend.isDropping, true);
  assert.deepEqual(result.actions, []);
});

for (const [returned, pct] of [[-50, -100], [-150, -200]]) {
  test(`#4 recent positive sale with net ${returned === -50 ? "zero" : "negative"} value is not called no purchase`, () => {
    const checked = importSales([
      "SYN-01;Kurgu Bayi;2026-03-01;1;100",
      "SYN-01;Kurgu Bayi;2026-06-29;1;50",
      `SYN-01;Kurgu Bayi;2026-06-30;-2;${returned}`,
    ]);
    assert.equal(checked.errorCount, 0);
    const result = analyze(checked.rows);
    const customer = result.customers[0];
    assert.equal(customer.lastDate, "2026-06-29");
    assert.equal(customer.recency_days, 1);
    assert.equal(customer.trend.pct, pct);
    assert.equal(customer.trend.recentPurchaseDays, 1);
    assert.equal(customer.trend.previousPurchaseDays, 1);
    const decline = result.actions.find((a) => a.ruleKey === "sales-decline");
    assert.ok(decline);
    assert.equal(decline.reason, "Son 90 günde iadeler alımları karşıladı; net satış sıfıra ya da eksiye indi");
    assert.doesNotMatch(decline.reason, /%/);
    assert.doesNotMatch(decline.reason, /hiç alım yok/);
    const briefing = buildBriefing(result);
    assert.doesNotMatch(briefingToText(briefing), /hiç alım yok/);
    assert.equal(briefing.today[0].reason, decline.reason);
    assert.ok(briefing.today[0].facts.some((fact) => fact.endsWith(`(-%${Math.abs(pct)})`)));
    assert.equal(validateBriefingText(briefingToText(briefing), briefing).ok, true);
    for (const segment_key of ["at_risk", "dormant"]) {
      const actions = evaluateRules({ customer: { id: customer.id, name: customer.name }, rfm: { ...customer, segment_key }, trend: customer.trend });
      assert.ok(actions.some((a) => a.ruleKey === "sales-decline"), "net decline must not be suppressed as an already explained silent window");
    }
  });
}

test("#4 a genuinely silent recent window keeps the no-purchase explanation", () => {
  const result = analyze(importSales([
    "SYN-01;Kurgu Bayi;2026-03-01;2;100",
    "SYN-01;Kurgu Bayi;2026-06-30;-1;-50",
  ]).rows);
  const customer = result.customers[0];
  assert.equal(customer.trend.recentPurchaseDays, 0);
  assert.equal(customer.trend.previousPurchaseDays, 1);
  assert.match(result.actions.find((a) => a.ruleKey === "sales-decline").reason, /Son 90 günde hiç alım yok/);
});

test("#4 a legacy trend without purchase counts must not assert no purchases", () => {
  const actions = evaluateRules({ customer: { id: "SYN-01", name: "Kurgu Bayi" }, rfm: { segment_key: "standard" }, trend: { isDropping: true, pct: -100 } });
  assert.match(actions[0].reason, /net satış/);
  assert.doesNotMatch(actions[0].reason, /hiç alım yok/);
});

test("#4 custom trend windows use the same period in the action and briefing facts", () => {
  const result = analyze(importSales([
    "SYN-01;Kurgu Bayi;2026-05-15;1;100",
    "SYN-01;Kurgu Bayi;2026-06-29;1;50",
    "SYN-01;Kurgu Bayi;2026-06-30;-2;-100",
  ]).rows, { trendWindowDays: 30 });
  assert.match(result.actions.find((a) => a.ruleKey === "sales-decline").reason, /Son 30 günde iadeler alımları karşıladı; net satış sıfıra ya da eksiye indi/);
  const briefing = buildBriefing(result);
  assert.ok(briefing.today[0].facts.some((fact) => fact.startsWith("Son 30 gün ")));
  assert.doesNotMatch(briefingToText(briefing), /90 gün/);
  assert.equal(validateBriefingText(briefingToText(briefing), briefing).ok, true);
});

test("#4 purchase-day counts respect both window boundaries and deduplicate days", () => {
  const day = 86400000;
  const asOf = "2026-06-30";
  const atAge = (age) => new Date(Date.parse(asOf + "T00:00:00Z") - age * day).toISOString().slice(0, 10);
  const lines = [0, 0, 89, 90, 179, 180].map((age) => `SYN-01;Kurgu Bayi;${atAge(age)};1;100`);
  lines.push(`SYN-01;Kurgu Bayi;${asOf};-1;-100`);
  const customer = analyze(importSales(lines).rows, { asOf }).customers[0];
  assert.equal(customer.trend.recentPurchaseDays, 2);
  assert.equal(customer.trend.previousPurchaseDays, 2);
  assert.equal(customer.trend.recent, 200);
  assert.equal(customer.trend.previous, 200);
});

test("#4 quantity-basis same-day sale and return keep the positive-purchase evidence", () => {
  const result = analyze(importSales([
    "SYN-01;Kurgu Bayi;2026-03-01;2;",
    "SYN-01;Kurgu Bayi;2026-06-30;1;",
    "SYN-01;Kurgu Bayi;2026-06-30;-1;",
  ]).rows);
  assert.equal(result.basis, "quantity");
  assert.equal(result.customers[0].recency_days, 0);
  assert.equal(result.customers[0].trend.recentPurchaseDays, 1);
  assert.equal(result.customers[0].trend.recent, 0);
  assert.match(result.actions.find((a) => a.ruleKey === "sales-decline").reason, /net satış/);
  assert.doesNotMatch(briefingToText(buildBriefing(result)), /hiç alım yok/);
});

test("#4 returns that leave positive net sales retain the percentage explanation", () => {
  const result = analyze(importSales([
    "SYN-01;Kurgu Bayi;2026-03-01;1;100",
    "SYN-01;Kurgu Bayi;2026-06-29;1;50",
    "SYN-01;Kurgu Bayi;2026-06-30;-1;-10",
  ]).rows);
  assert.equal(result.customers[0].trend.recent, 40);
  assert.equal(result.actions.find((a) => a.ruleKey === "sales-decline").reason,
    "Son 90 günde net satış önceki 90 güne göre %60 düştü (iadeler dahil)");
});
