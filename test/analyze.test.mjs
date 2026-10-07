import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv } from "../lib/import/csv.js";
import { autoMap, normalizeRow, parseDate, parseNumber, validateMapping } from "../lib/import/schema.js";
import { aggregateCustomers } from "../lib/aggregate.js";
import { analyze } from "../lib/analyze.js";
import { generateSampleRows } from "../lib/sample-data.js";

test("CSV parser detects semicolon delimiter", () => {
  const x = parseCsv("Cari Kod;Cari Adı;Tarih;Adet;Tutar\nC1;\"Ak; Lastik\";31.08.2026;4;1.250,50");
  assert.equal(x.length, 1);
  assert.equal(x[0]["Cari Adı"], "Ak; Lastik");
  assert.equal(x[0]["Tutar"], "1.250,50");
});

test("Turkish and international number formats", () => {
  assert.equal(parseNumber("1.250,50"), 1250.5);
  assert.equal(parseNumber("1,250.50"), 1250.5);
  assert.equal(parseNumber("12,5"), 12.5);
  assert.equal(parseNumber("1.250"), 1250);
  assert.equal(parseNumber("12.5"), 12.5);
  assert.equal(parseNumber("₺ 3.400"), 3400);
  assert.ok(Number.isNaN(parseNumber("")));
});

test("date formats and invalid dates", () => {
  assert.equal(parseDate("2026-09-01"), "2026-09-01");
  assert.equal(parseDate("1.9.2026"), "2026-09-01");
  assert.equal(parseDate("31/12/2026"), "2026-12-31");
  assert.equal(parseDate("31.02.2026"), null);
  assert.equal(parseDate("yarın"), null);
});

test("auto-mapping recognises Turkish ERP headers", () => {
  const map = autoMap(["Cari Kod", "Cari Adı", "Fatura Tarihi", "Miktar", "Net Tutar", "Bölge"]);
  assert.deepEqual(validateMapping(map), []);
  assert.equal(map.revenue, "Net Tutar");
  assert.equal(map.region, "Bölge");
});

test("aggregation computes recency, frequency, monetary and trend", () => {
  const rows = [
    { customer_id: "A", customer_name: "A", date: "2026-01-10", quantity: 10, revenue: 1000 },
    { customer_id: "A", customer_name: "A", date: "2026-01-10", quantity: 5, revenue: 500 },
    { customer_id: "A", customer_name: "A", date: "2026-06-20", quantity: 2, revenue: 200 },
    { customer_id: "B", customer_name: "B", date: "2026-06-30", quantity: 1, revenue: 100 },
  ];
  const { asOf, customers } = aggregateCustomers(rows);
  assert.equal(asOf, "2026-06-30");
  const a = customers.find((c) => c.id === "A");
  assert.equal(a.frequency, 2); // two distinct order days
  assert.equal(a.monetary, 1700);
  assert.equal(a.recency_days, 10);
  assert.equal(a.trend.recent, 200);
  assert.equal(a.trend.previous, 1500);
  assert.equal(a.trend.isDropping, true);
  assert.equal(a.monthly.reduce((s, v) => s + v, 0), 1700);
});

test("falls back to quantity when there is no revenue column", () => {
  const { basis, customers } = aggregateCustomers([{ customer_id: "A", customer_name: "A", date: "2026-01-01", quantity: 7, revenue: 0 }]);
  assert.equal(basis, "quantity");
  assert.equal(customers[0].monetary, 7);
});

test("sample data is deterministic and produces a meaningful call list", () => {
  const a = generateSampleRows();
  const b = generateSampleRows();
  assert.deepEqual(a, b);
  const r = analyze(a);
  assert.equal(r.kpis.accounts, 40);
  assert.ok(r.callList.length > 10);
  assert.ok(r.segmentCounts.champion > 0 && r.segmentCounts.at_risk > 0 && r.segmentCounts.new > 0);
  // Champions that keep buying normally must not top the list.
  assert.notEqual(r.callList[0].segmentKey, "champion");
  // One call-list entry per customer.
  assert.equal(new Set(r.callList.map((x) => x.customerId)).size, r.callList.length);
});

test("sample CSV survives a full round trip through import", () => {
  const rows = generateSampleRows();
  const raw = parseCsv(toCsv(rows));
  const map = autoMap(Object.keys(raw[0]));
  const back = raw.map((x) => normalizeRow(x, map)).filter(Boolean);
  assert.equal(back.length, rows.length);
  assert.deepEqual(analyze(back).kpis, analyze(rows).kpis);
});
