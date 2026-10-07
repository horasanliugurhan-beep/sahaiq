import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseTable, toCsv } from "../lib/import/csv.js";
import { autoMap, guessLocale, normalizeRow, parseDateOnly, parseLocalizedNumber, validateDataset, validateMapping } from "../lib/import/schema.js";
import { aggregateCustomers } from "../lib/aggregate.js";
import { analyze } from "../lib/analyze.js";
import { generateSampleRows } from "../lib/sample-data.js";

test("CSV parser detects semicolon delimiter", () => {
  const x = parseCsv("Cari Kod;Cari Adı;Tarih;Adet;Tutar\nC1;\"Ak; Lastik\";31.08.2026;4;1.250,50");
  assert.equal(x.length, 1);
  assert.equal(x[0]["Cari Adı"], "Ak; Lastik");
  assert.equal(x[0]["Tutar"], "1.250,50");
});

test("numbers need an explicit format and never guess silently", () => {
  const tr = (v, o = {}) => parseLocalizedNumber(v, { locale: "tr-TR", ...o });
  const en = (v, o = {}) => parseLocalizedNumber(v, { locale: "en-US", ...o });
  assert.equal(tr("1.250,50"), 1250.5);
  assert.equal(tr("1.250"), 1250);
  assert.equal(en("1.250"), 1.25);
  assert.equal(en("1,250.50"), 1250.5);
  assert.equal(tr("12,5"), 12.5);
  assert.equal(tr("₺ 3.400", { money: true }), 3400);
  assert.equal(tr("(12)"), -12);
  assert.equal(tr(""), null); // blank is unknown, not zero
  assert.throws(() => tr("1,250.50"));
  assert.throws(() => tr("12abc"));
  assert.throws(() => tr("1,999", { money: true }));
});

test("locale guess", () => {
  assert.equal(guessLocale(["1.250,00", "37.200,00"]), "tr-TR");
  assert.equal(guessLocale(["1,250.00", "12.50"]), "en-US");
  assert.equal(guessLocale(["20", "4"]), "tr-TR");
});

test("dates are strict", () => {
  assert.equal(parseDateOnly("2026-09-01"), "2026-09-01");
  assert.equal(parseDateOnly("1.9.2026"), "2026-09-01");
  assert.equal(parseDateOnly("31/12/2026"), "2026-12-31");
  assert.throws(() => parseDateOnly("31.02.2026"));
  assert.throws(() => parseDateOnly("yarın"));
});

test("auto-mapping recognises Turkish ERP headers", () => {
  const map = autoMap(["Cari Kod", "Cari Adı", "Fatura Tarihi", "Miktar", "Net Tutar", "Bölge"]);
  assert.deepEqual(validateMapping(map), []);
  assert.equal(map.revenue, "Net Tutar");
  assert.equal(map.region, "Bölge");
});

test("bad rows block the analysis and are reported with line numbers", () => {
  const t = parseTable("Cari Kod;Cari Adı;Tarih;Adet\n001;Ak Lastik;01.09.2026;4\n002;Bir Bayi;bozuk;3\n001;AK LASTİK LTD;02.09.2026;2");
  const map = autoMap(t.headers);
  const r = validateDataset(t, map);
  assert.ok(r.errors.some((e) => e.row === 3 && e.field === "date"));
  assert.ok(r.errors.some((e) => e.row === 4 && e.field === "customer_name")); // same code, different name
  assert.equal(r.rows[0].customer_id, "001"); // leading zeros kept
});

test("duplicates and returns produce warnings, not silent changes", () => {
  const t = parseTable("customer_id,customer_name,date,quantity\nA,A,2026-09-01,4\nA,A,2026-09-01,4\nA,A,2026-09-05,-1");
  const r = validateDataset(t, autoMap(t.headers));
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows.length, 3);
  assert.ok(r.warnings.some((w) => w.field === "duplicate"));
  assert.ok(r.warnings.some((w) => w.field === "quantity"));
});

test("CSV parser rejects broken structure instead of guessing", () => {
  assert.throws(() => parseTable("a,b\n1,2,3"), /Beklenen 2 sütun/);
  assert.throws(() => parseTable('a,b\n"1,2'), /Kapanmamış/);
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

test("a return does not count as a fresh purchase", () => {
  const rows = [
    { customer_id: "A", customer_name: "A", date: "2026-01-10", quantity: 10, revenue: 1000.1 },
    { customer_id: "A", customer_name: "A", date: "2026-06-30", quantity: -2, revenue: -200.2 },
  ];
  const [a] = aggregateCustomers(rows).customers;
  assert.equal(a.lastDate, "2026-01-10");
  assert.equal(a.frequency, 1);
  assert.equal(a.monetary, 799.9); // exact, net of the return
  assert.equal(a.units, 8);
});

test("blank amounts switch the analysis to units instead of counting as zero", () => {
  const rows = [
    { customer_id: "A", customer_name: "A", date: "2026-01-10", quantity: 10, revenue: 1000 },
    { customer_id: "B", customer_name: "B", date: "2026-01-11", quantity: 5, revenue: null },
  ];
  assert.equal(aggregateCustomers(rows).basis, "quantity");
});

test("falls back to quantity when there is no revenue column", () => {
  const { basis, customers } = aggregateCustomers([{ customer_id: "A", customer_name: "A", date: "2026-01-01", quantity: 7, revenue: null }]);
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
  const table = parseTable(toCsv(rows));
  const check = validateDataset(table, autoMap(table.headers));
  assert.equal(check.errors.length, 0);
  const back = check.rows.map(({ sourceRow, ...r }) => r);
  assert.equal(back.length, rows.length);
  assert.deepEqual(analyze(back).kpis, analyze(rows).kpis);
});
