import test from "node:test";
import assert from "node:assert/strict";
import { autoMap, headerSignature, validateDataset, validateMapping } from "../lib/import/schema.js";
import { parseTable } from "../lib/import/csv.js";
import { findHeaderRow, pickSheet, sheetToTable } from "../lib/import/xlsx.js";
import { analyze } from "../lib/analyze.js";

const d = (s) => new Date(s + "T00:00:00Z");

test("ERP-style headers map without manual work, preferring net amount and product name", () => {
  const a = autoMap(["Cari Hesap Kodu", "Cari Hesap Ünvanı", "Fatura Tarihi", "Malzeme Kodu", "Malzeme Açıklaması", "Miktar", "Tutar", "Net Tutar"]);
  assert.deepEqual(validateMapping(a), []);
  assert.equal(a.revenue, "Net Tutar");
  assert.equal(a.product, "Malzeme Açıklaması");
  const b = autoMap(["Cari Kodu", "Cari İsmi", "Evrak Tarihi", "Stok Kodu", "Stok İsmi", "Miktar", "Tutar"]);
  assert.deepEqual(validateMapping(b), []);
  assert.equal(b.product, "Stok İsmi");
});

test("ambiguous headers are left to the user", () => {
  const m = autoMap(["Tarih", "tarih ", "Cari Kodu", "Cari Adı", "Adet"]);
  assert.equal(m.date, undefined);
});

test("header signature ignores order and spelling variants", () => {
  assert.equal(headerSignature(["Cari Kodu", "Miktar"]), headerSignature(["MİKTAR", "cari kodu"]));
});

test("Excel sheet with a title block, real dates and numbers becomes a valid table", () => {
  const data = [
    ["SATIŞ FATURA SATIRLARI", null, null, null, null],
    ["Dönem: 01.01.2026 - 30.09.2026", null, null, null, null],
    [null, null, null, null, null],
    ["Cari Kodu", "Cari Ünvanı", "Fatura Tarihi", "Miktar", "Net Tutar"],
    ["001", "Kurgu Lastik", d("2026-09-01"), 20, 64000],
    [1002, "Örnek Oto", d("2026-09-15"), 4, 12800.5],
    [null, null, null, null, null],
  ];
  assert.equal(findHeaderRow(data), 3);
  const t = sheetToTable(data);
  assert.equal(t.skippedTitleRows, 3);
  assert.deepEqual(t.rowNumbers, [5, 6]);
  const check = validateDataset(t, autoMap(t.headers));
  assert.deepEqual(check.errors, []);
  assert.equal(check.rows[0].date, "2026-09-01");
  assert.equal(check.rows[0].customer_id, "001");
  assert.equal(check.rows[1].customer_id, "1002");
  assert.equal(check.rows[1].revenue, 12800.5);
});

test("Excel totals row is caught instead of being counted as a customer", () => {
  const t = sheetToTable([
    ["Cari Kodu", "Cari Ünvanı", "Fatura Tarihi", "Miktar"],
    ["001", "Kurgu Lastik", d("2026-09-01"), 20],
    [null, "TOPLAM", null, 20],
  ]);
  const check = validateDataset(t, autoMap(t.headers));
  assert.ok(check.errors.some((e) => e.row === 3));
});

test("values under an unnamed column are rejected", () => {
  assert.throws(() => sheetToTable([["Cari Kodu", "Cari Ünvanı"], ["1", "A", "stray"]]), /başlığı olmayan/);
});

test("the sales sheet is picked over a summary sheet", () => {
  const sheets = [
    { sheet: "Özet", data: [["Toplam"], [100]] },
    { sheet: "Satışlar", data: [["Cari Kodu", "Cari Ünvanı", "Tarih", "Adet"], ["1", "A", d("2026-01-01"), 1]] },
  ];
  assert.equal(pickSheet(sheets).sheet, "Satışlar");
});

test("a table pasted from Excel (tab separated) runs end to end", () => {
  const t = parseTable("Cari Kodu\tCari Ünvanı\tEvrak Tarihi\tMiktar\tNet Tutar\n001\tKurgu Lastik\t01.09.2026\t20\t64.000,00\n002\tÖrnek Oto\t15.09.2026\t4\t12.800,50\n");
  const check = validateDataset(t, autoMap(t.headers), { locale: "tr-TR" });
  assert.deepEqual(check.errors, []);
  const r = analyze(check.rows);
  assert.equal(r.kpis.accounts, 2);
  assert.equal(r.kpis.total, 76800.5);
});
