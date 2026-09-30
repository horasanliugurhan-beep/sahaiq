import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTable, parseCsv, CsvError, MAX_IMPORT_CHARS } from "../lib/import/csv.js";
import { parseLocalizedNumber, parseDateOnly, validateRow, validateDataset, autoMapping } from "../lib/import/schema.js";
import { summarizeSales } from "../lib/observer.js";
import { buildPilot } from "../scripts/build-pilot.mjs";

const headers = "Cari Kod;Cari Ünvan;Tarih;Adet;Ciro\n";
const make = (rows = "001;SENTETİK A;01.08.2026;1.000;152.544,50\n") => parseTable(headers + rows);
const validate = table => validateDataset(table, autoMapping(table.headers), { asOfDate: "2026-09-30" });
const good = () => validate(make());

for (const [raw, expected] of [["152.544,50",152544.5],["1.000",1000],["0",0],["-1.234,50",-1234.5],["(1.234,50)",-1234.5],["1.234,50 TL",1234.5],["₺ 1.234,50",1234.5],["",null]]) {
  test(`Turkish money ${JSON.stringify(raw)} -> ${expected}`, () => assert.equal(parseLocalizedNumber(raw,{money:true}),expected));
}
for (const raw of ["not-a-number","Infinity","1e3","123.45","12.34,56","1.234,567","(-1,00)","5 USD","--5","1 000,50"]) {
  test(`malformed money is rejected: ${raw}`, () => assert.throws(()=>parseLocalizedNumber(raw,{money:true})));
}
test("English locale is explicit",()=>assert.equal(parseLocalizedNumber("152,544.50",{locale:"en-US",money:true}),152544.5));
test("English decimal is not guessed in Turkish locale",()=>assert.throws(()=>parseLocalizedNumber("45.50")));
test("blank amount remains null, not zero",()=>assert.equal(parseLocalizedNumber(null),null));
test("numeric money with excess precision is rejected",()=>assert.throws(()=>parseLocalizedNumber(1.005,{money:true})));
test("unsafe money value is rejected",()=>assert.throws(()=>parseLocalizedNumber("9999999999999999,00",{money:true})));
test("boolean is not a numeric amount",()=>assert.throws(()=>parseLocalizedNumber(true)));
for (const date of ["2026-02-30","31.04.2026","29.02.2025","not-a-date","01.09/2026","09-01-2026","2026-09-01T12:00:00Z"]) {
  test(`invalid / ambiguous date rejected: ${date}`,()=>assert.throws(()=>parseDateOnly(date)));
}
test("leap day accepted",()=>assert.equal(parseDateOnly("29.02.2024"),"2024-02-29"));
test("Turkish day-first slash date accepted",()=>assert.equal(parseDateOnly("30/09/2026"),"2026-09-30"));
test("source IDs keep leading zeros",()=>assert.equal(good().rows[0].customer_id,"001"));
test("Turkish amounts and quantities reach the report",()=>{const r=summarizeSales(good().rows,{asOfDate:"2026-09-30"}); assert.equal(r.netQuantity,1000); assert.equal(r.revenue,152544.5);});
test("blank quantity is an error",()=>assert.ok(validate(make("001;SENTETİK A;01.08.2026;;1,00\n")).errors.some(e=>e.field==="quantity")));
test("fractional tire count is an error",()=>assert.ok(validate(make("001;SENTETİK A;01.08.2026;1,5;1,00\n")).errors.some(e=>e.field==="quantity")));
test("bad amount is not silently replaced with zero",()=>{const r=validate(make("001;SENTETİK A;01.08.2026;1;broken\n")); assert.ok(r.errors.some(e=>e.field==="revenue")); assert.equal(r.rows.length,0);});
test("one bad row blocks whole dataset",()=>{const r=validate(make("001;SENTETİK A;01.08.2026;1;1,00\n002;SENTETİK B;bad;1;2,00\n")); assert.equal(r.rows.length,1); assert.ok(r.errors.length); assert.equal(r.sourceRows,2);});
test("missing money makes full total unknown",()=>{const checked=validate(make("001;SENTETİK A;01.08.2026;1;1,00\n002;SENTETİK B;02.08.2026;2;\n")); const r=summarizeSales(checked.rows,{asOfDate:"2026-09-30"}); assert.equal(r.revenue,null); assert.equal(r.knownRevenue,1); assert.equal(r.missingMoneyRows,1);});
test("monetary totals use integer cents",()=>{const r=summarizeSales(validate(make("001;SENTETİK A;01.08.2026;1;0,10\n002;SENTETİK B;02.08.2026;2;0,20\n")).rows,{asOfDate:"2026-09-30"}); assert.equal(r.revenue,0.3);});
test("future sales relative to source snapshot are rejected",()=>assert.ok(validate(make("001;SENTETİK A;01.10.2026;1;1,00\n")).errors.some(e=>e.field==="date")));
test("same ID with conflicting names blocks report",()=>assert.ok(validate(make("001;SENTETİK A;01.08.2026;1;1,00\n001;SENTETİK B;02.08.2026;1;1,00\n")).errors.some(e=>e.field==="customer_name")));
test("equal rows are flagged, not silently removed",()=>{const r=validate(make("001;SENTETİK A;01.08.2026;1;1,00\n001;SENTETİK A;01.08.2026;1;1,00\n")); assert.equal(r.rows.length,2); assert.ok(r.warnings.some(w=>w.field==="duplicate"));});
test("missing source snapshot blocks report",()=>{const t=make(); assert.ok(validateDataset(t,autoMapping(t.headers)).errors.some(e=>e.field==="asOfDate"));});
test("one source column cannot map to two fields",()=>{const t=make(), m=autoMapping(t.headers); m.revenue=m.quantity; assert.ok(validateDataset(t,m,{asOfDate:"2026-09-30"}).errors.some(e=>e.field==="mapping"));});
test("balance is never automatically matched to sales revenue",()=>assert.equal(autoMapping(["Cari Kod","Cari Ünvan","Toplam Bakiye"]).revenue,undefined));
test("negative return does not change last positive sale",()=>{const r=summarizeSales(validate(make("001;SENTETİK A;01.08.2026;10;10,00\n001;SENTETİK A;29.09.2026;-2;-2,00\n")).rows,{asOfDate:"2026-09-30"}); assert.equal(r.customers[0].lastPositiveSale,"2026-08-01"); assert.equal(r.netQuantity,8); assert.equal(r.returnQuantity,2);});
test("sales rows never become order count",()=>{const r=summarizeSales(good().rows,{asOfDate:"2026-09-30"}); assert.equal(r.customers[0].salesRows,1); assert.equal(r.customers[0].orderCount,undefined);});
test("actions sorted by gap and state source limitation",()=>{const r=summarizeSales(validate(make("001;SENTETİK A;01.09.2026;1;1,00\n002;SENTETİK B;01.08.2026;1;1,00\n")).rows,{asOfDate:"2026-09-30",followupDays:10}); assert.equal(r.actions[0].customerId,"002"); assert.match(r.actions[0].reason,/dosyada/); assert.match(r.actions[0].nextAction,/kanıtı değildir/);});
test("return-only accounts are not labelled dormant",()=>assert.equal(summarizeSales(validate(make("001;SENTETİK A;01.08.2026;-2;-2,00\n")).rows,{asOfDate:"2026-09-30"}).actions.length,0));
test("quantity overflow aborts rather than rounding",()=>assert.throws(()=>summarizeSales([{...good().rows[0],quantity:Number.MAX_SAFE_INTEGER},{...good().rows[0],quantity:1}],{asOfDate:"2026-09-30"})));
test("semicolon delimiter with Turkish decimal",()=>{const t=make(); assert.equal(t.delimiter,";"); assert.equal(t.rows[0].Ciro,"152.544,50");});
test("Excel pasted tabs are supported",()=>assert.equal(parseTable("Kod\tAd\n001\tÖrnek\n").rows[0].Kod,"001"));
test("BOM / CRLF preserved with physical line evidence",()=>{const t=parseTable('\uFEFFid;name\r\n001;"Line1\r\nLine2"\r\n002;B\r\n'); assert.equal(t.rows[0].name,"Line1\nLine2"); assert.deepEqual(t.rowNumbers,[2,4]);});
test("escaped quotes are decoded",()=>assert.equal(parseCsv('id,name\n1,"A ""quoted"" B"')[0].name,'A "quoted" B'));
for (const data of ['id,name\n1,"unfinished', 'id,id\n1,2', 'id,\n1,2','id,name\n1,2,3','id,name\n1','id,name\n1,"A"oops', 'id,name\n1,ab"c']) {
  test(`structurally unsafe CSV rejected: ${JSON.stringify(data)}`,()=>assert.throws(()=>parseTable(data),CsvError));
}
test("too many rows are rejected, not truncated",()=>assert.throws(()=>parseTable("id\n1\n2",{maxRows:1}),CsvError));
test("too large text rejected",()=>assert.throws(()=>parseTable("x".repeat(MAX_IMPORT_CHARS+1)),CsvError));
test("binary file rejected",()=>assert.throws(()=>parseTable("PK\u0000\u0000"),CsvError));
test("invalid decoding marker rejected",()=>assert.throws(()=>parseTable("id\n\uFFFD"),CsvError));
test("prototype-like header remains an own data property",()=>{const t=parseTable("__proto__,id\nvalue,1"); assert.equal(Object.getPrototypeOf(t.rows[0]),Object.prototype); assert.equal(t.rows[0].__proto__,"value");});
test("empty input safe",()=>assert.deepEqual(parseCsv(""),[]));
test("portable bundle matches tested source",()=>assert.equal(readFileSync(new URL("../public/pilot.html",import.meta.url),"utf8"),buildPilot()));
test("portable pilot denies network, uses no remote scripts",()=>{const html=buildPilot(); assert.match(html,/connect-src 'none'/); assert.doesNotMatch(html,/<script[^>]+src=/); assert.doesNotMatch(html,/localStorage\.|sessionStorage\.|\.innerHTML\s*=/);});
