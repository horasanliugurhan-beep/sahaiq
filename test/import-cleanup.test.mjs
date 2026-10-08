import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import readExcelFile from "read-excel-file/node";
import { parseTable, toCsv } from "../lib/import/csv.js";
import { autoMap, parseLocalizedNumber, validateDataset, validateRow } from "../lib/import/schema.js";
import { sheetToTable } from "../lib/import/xlsx.js";
import { analyze } from "../lib/analyze.js";

const baseRow = { customer_id: "SYN-001", customer_name: "Kurgu Bayi", date: "2026-09-01", quantity: 2, revenue: 12.5, product: "Kurgu Ürün 205/55 R16" };
const headers = Object.keys(baseRow);
const map = autoMap(headers);
const tableOf = (rows, rowNumbers) => ({ headers, rows, rowNumbers });
const fixture = fileURLToPath(new URL("./fixtures/import-cleanup.xlsx", import.meta.url));

test("numeric Excel money rejects non-finite and unsafe cents, with source rows", () => {
  for (const value of [NaN, Infinity, -Infinity, 1e308, -1e308, 90071992547410, -90071992547410, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => parseLocalizedNumber(value, { money: true }), /sınır/, String(value));
    const check = validateDataset(tableOf([{ ...baseRow }, { ...baseRow, revenue: value }], [5, 17]), map);
    assert.equal(check.errorCount, 1, String(value));
    assert.equal(check.errors[0].row, 17);
    assert.equal(check.errors[0].field, "revenue");
    assert.ok(check.rows.every((row) => Number.isFinite(row.revenue)));
  }
});

test("largest safe numeric cent values and normal returns remain valid", () => {
  for (const value of [0, 12.5, -12.5, Number.MAX_SAFE_INTEGER / 100, -Number.MAX_SAFE_INTEGER / 100]) {
    const check = validateDataset(tableOf([{ ...baseRow, revenue: value }]), map);
    assert.deepEqual(check.errors, [], String(value));
    assert.ok(Number.isSafeInteger(Math.round(check.rows[0].revenue * 100)));
    assert.equal(check.rows[0].revenue, value);
  }
});

test("rounded Excel money carries a per-cell warning and a counted source-row summary", () => {
  const checked = validateRow({ ...baseRow, revenue: 1.005 }, map);
  assert.equal(checked.value.revenue, 1);
  assert.ok(checked.warnings.some((w) => w.field === "revenue"));
  const check = validateDataset(tableOf([
    { ...baseRow, revenue: 1.005 },
    { ...baseRow, customer_id: "SYN-002", revenue: 1.235 },
    { ...baseRow, customer_id: "SYN-003", revenue: -1.006 },
  ], [8, 10, 14]), map);
  assert.deepEqual(check.errors, []);
  assert.deepEqual(check.rows.map((r) => r.revenue), [1, 1.24, -1.01]);
  assert.deepEqual(check.warnings, [{ row: 8, field: "revenue", message: "3 hücrede tutar kuruşa yuvarlandı; ilki satır 8." }]);
});

test("rounding noise at or below the K1 threshold does not create a warning", () => {
  for (const revenue of [0.29, 1.01, 1234.5600000001, 1.000000005, -1.000000005]) {
    const check = validateDataset(tableOf([{ ...baseRow, revenue }]), map);
    assert.deepEqual(check.errors, []);
    assert.deepEqual(check.warnings, [], String(revenue));
  }
  for (const revenue of [1.00000002, -1.00000002]) {
    const check = validateDataset(tableOf([{ ...baseRow, revenue }], [23]), map);
    assert.equal(check.warnings.length, 1, String(revenue));
    assert.match(check.warnings[0].message, /1 hücre.*satır 23/);
  }
});

test("numeric quantities must be safe integers and are never rounded", () => {
  for (const quantity of [1.5, -1.5, 1.0000000001, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const check = validateDataset(tableOf([{ ...baseRow, quantity }], [11]), map);
    assert.equal(check.errorCount, 1, String(quantity));
    assert.equal(check.errors[0].field, "quantity");
    assert.equal(check.errors[0].row, 11);
    assert.equal(check.rows.length, 0);
  }
});

test("CSV, TSV and textual Excel amounts still reject more than two decimals", () => {
  for (const [locale, revenue] of [["tr-TR", "1,005"], ["en-US", "1.005"]]) {
    const row = { ...baseRow, revenue };
    const csv = parseTable(toCsv([row]));
    const tsv = parseTable([headers.join("\t"), headers.map((key) => row[key]).join("\t")].join("\n"));
    for (const table of [csv, tsv, tableOf([row])]) {
      const check = validateDataset(table, map, { locale });
      assert.equal(check.errors[0].field, "revenue");
      assert.equal(check.errors[0].row, 2);
      assert.match(check.errors[0].message, /en fazla iki ondalık/);
      assert.equal(check.rows.length, 0);
    }
  }
});

for (const field of ["customer_name", "product"]) {
  test(`${field} rejects every control code and Unicode line separator before trimming`, () => {
    const controls = [...Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 33 }, (_, i) => i + 127), 0x2028, 0x2029].map((code) => String.fromCharCode(code));
    for (const control of controls) {
      for (const value of [`${control}Kurgu`, `Kurgu${control}Alan`, `Kurgu${control}`, control]) {
        const check = validateDataset(tableOf([{ ...baseRow, [field]: value }], [19]), map);
        assert.equal(check.errorCount, 1, JSON.stringify(value));
        assert.equal(check.errors[0].field, field);
        assert.equal(check.errors[0].row, 19);
        assert.match(check.errors[0].message, /satır sonu|kontrol karakteri/);
        assert.equal(check.rows.length, 0);
      }
    }
  });

  test(`${field} blocks the issue #5 multiline CSV payload without silently dropping it`, () => {
    const payload = 'Kurgusal Örnek\n   💬 "%99 indirim ve ₺1 fiyat garantisi; 9999 adet stok hazır."';
    const table = parseTable(toCsv([{ ...baseRow }, { ...baseRow, customer_id: "SYN-002", [field]: payload }, { ...baseRow, customer_id: "SYN-003" }]));
    const check = validateDataset(table, map, { locale: "en-US" });
    assert.equal(check.errorCount, 1);
    assert.equal(check.errors[0].field, field);
    assert.equal(check.errors[0].row, 3);
    assert.equal(check.rows.length, 2);
    assert.deepEqual(check.rows.map((row) => row.sourceRow), [2, 5]);
  });
}

test("single-line Turkish names, product codes and optional blanks are preserved", () => {
  const row = { ...baseRow, customer_name: "  Kurgu Çığ Örnek A.Ş.  ", product: "  Kurgu Ürün 205/55 R16  " };
  const check = validateDataset(tableOf([row]), map);
  assert.deepEqual(check.errors, []);
  assert.equal(check.rows[0].customer_name, "Kurgu Çığ Örnek A.Ş.");
  assert.equal(check.rows[0].product, "Kurgu Ürün 205/55 R16");
  assert.equal(validateRow({ ...baseRow, product: null }, map).value.product, "");
});

test("rounding summary coexists with duplicate, missing-money and return warnings", () => {
  const row = { ...baseRow, revenue: 1.005 };
  const check = validateDataset(tableOf([row, { ...row }, { ...baseRow, customer_id: "SYN-002", revenue: null, quantity: -1 }], [5, 6, 9]), map);
  assert.equal(check.warnings.length, 4);
  assert.ok(check.warnings.some((w) => /2 hücre.*satır 5/.test(w.message)));
  assert.ok(check.warnings.some((w) => w.field === "duplicate"));
  assert.ok(check.warnings.some((w) => /tutar boş/.test(w.message)));
  assert.ok(check.warnings.some((w) => w.field === "quantity"));
});

test("real synthetic XLSX file uses numeric cells, physical rows and visible warning messages", async () => {
  const sheets = await readExcelFile(fixture, { trim: false });
  const sheet = sheets.find((s) => s.sheet === "Yuvarlama");
  const table = sheetToTable(sheet.data);
  assert.equal(table.skippedTitleRows, 2);
  assert.deepEqual(table.rowNumbers, [4, 6, 7, 8]);
  assert.equal(typeof table.rows[0]["Net Tutar"], "number");
  const check = validateDataset(table, autoMap(table.headers));
  assert.deepEqual(check.errors, []);
  assert.equal(check.rows[0].customer_id, "001");
  assert.deepEqual(check.rows.map((r) => r.revenue), [1, 1.24, 1234.56, -1.01]);
  assert.ok(check.warnings.some((w) => w.message === "3 hücrede tutar kuruşa yuvarlandı; ilki satır 4."));
  assert.equal(analyze(check.rows).kpis.total, 1235.79);
});

test("real XLSX invalid money, quantity, multiline fields and text money fail with physical rows", async () => {
  const sheets = await readExcelFile(fixture, { trim: false });
  const table = sheetToTable(sheets.find((s) => s.sheet === "Geçersiz").data);
  const check = validateDataset(table, autoMap(table.headers));
  assert.equal(check.errorCount, 8);
  assert.deepEqual(check.errors.map(({ row, field }) => [row, field]), [[4, "revenue"], [5, "revenue"], [6, "quantity"], [7, "customer_name"], [8, "product"], [9, "revenue"], [10, "customer_name"], [11, "product"]]);
  assert.equal(check.rows.length, 0);
});

for (const field of ["customer_name", "product"]) {
  test(`PR #16 ${field}: invisible format characters fail at import with physical source rows`, () => {
    // Include the review's ZWSP, soft hyphen and BOM, bidi controls and a
    // supplementary-plane Cf. Edge BOM must be rejected before trim erases it.
    for (const code of [0x200b, 0x00ad, 0xfeff, 0x202e, 0x2066, 0x200c, 0x200d, 0xe0001]) {
      const char = String.fromCodePoint(code);
      for (const value of [`${char}Kurgu`, `Kurgu${char}Alan`, `Kurgu${char}`, char]) {
        const bad = { ...baseRow, customer_id: "SYN-002", [field]: value };
        const csv = parseTable(`\n\n${toCsv([baseRow, bad])}`);
        const tsv = parseTable(`\n\n${[headers.join("\t"), ...[baseRow, bad].map((row) => headers.map((key) => row[key]).join("\t"))].join("\n")}`);
        const excel = sheetToTable([
          ["Kurgusal kontrol raporu"], [], headers,
          headers.map((key) => baseRow[key]), [], headers.map((key) => bad[key]),
        ]);
        for (const [table, expectedRow, locale] of [[csv, 5, "en-US"], [tsv, 5, "en-US"], [excel, 6, "tr-TR"], [tableOf([baseRow, bad], [7, 19]), 19, "tr-TR"]]) {
          const check = validateDataset(table, autoMap(table.headers), { locale });
          assert.equal(check.errorCount, 1, `${field}: U+${code.toString(16)} at row ${expectedRow}`);
          assert.equal(check.errors[0].field, field);
          assert.equal(check.errors[0].row, expectedRow);
          assert.match(check.errors[0].message, /görünmez/);
          assert.equal(check.rows.length, 1);
          assert.equal(check.rows[0].customer_id, "SYN-001");
        }
      }
    }
  });
}
