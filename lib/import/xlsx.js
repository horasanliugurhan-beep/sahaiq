// Converts spreadsheet sheets (arrays of cell values) into the same table shape
// that parseTable returns, so Excel files go through the exact same validation.
import { autoMap, REQUIRED_FIELDS } from "./schema.js";

export const MAX_SHEET_ROWS = 50000;

function cellToText(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    // Spreadsheet dates have no time zone; read them as calendar dates.
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "boolean") return v ? "1" : "0";
  return v;
}

const isEmpty = (row) => !row || row.every((c) => c === null || c === undefined || String(c).trim() === "");

// ERP reports often start with a title block; find the first row that looks like a header.
export function findHeaderRow(rows, scan = 20) {
  let firstNonEmpty = -1;
  for (let i = 0; i < Math.min(rows.length, scan); i++) {
    if (isEmpty(rows[i])) continue;
    if (firstNonEmpty < 0) firstNonEmpty = i;
    const headers = rows[i].map((c) => String(c ?? "").trim()).filter(Boolean);
    const map = autoMap(headers);
    if (REQUIRED_FIELDS.filter((f) => map[f]).length >= 2) return i;
  }
  return firstNonEmpty;
}

/**
 * @param data array of rows (each an array of cell values)
 * @returns {headers, rows, rowNumbers, skippedTitleRows}
 * Numbers stay numbers (no locale guessing needed); dates become YYYY-MM-DD.
 */
export function sheetToTable(data) {
  const h = findHeaderRow(data);
  if (h < 0) return { headers: [], rows: [], rowNumbers: [], skippedTitleRows: 0 };
  const raw = data[h].map((c) => String(cellToText(c) ?? "").trim());
  // Drop trailing empty header cells, then reject gaps/duplicates like the CSV reader does.
  while (raw.length && !raw[raw.length - 1]) raw.pop();
  if (raw.some((x) => !x)) throw new Error(`Satır ${h + 1}: boş sütun başlığı var.`);
  if (new Set(raw).size !== raw.length) throw new Error(`Satır ${h + 1}: tekrarlanan sütun başlığı var.`);
  const rows = [];
  const rowNumbers = [];
  for (let i = h + 1; i < data.length; i++) {
    const r = data[i];
    if (isEmpty(r)) continue;
    const extra = r.slice(raw.length).some((c) => c !== null && c !== undefined && String(c).trim() !== "");
    if (extra) throw new Error(`Satır ${i + 1}: başlığı olmayan bir sütunda değer var.`);
    rows.push(Object.fromEntries(raw.map((name, j) => [name, cellToText(r[j])])));
    rowNumbers.push(i + 1);
    if (rows.length > MAX_SHEET_ROWS) throw new Error(`En fazla ${MAX_SHEET_ROWS} veri satırı okunabilir.`);
  }
  return { headers: raw, rows, rowNumbers, skippedTitleRows: h };
}

// Pick the sheet that looks most like sales data.
export function pickSheet(sheets) {
  let best = null;
  let bestScore = -1;
  for (const s of sheets) {
    const h = findHeaderRow(s.data);
    if (h < 0) continue;
    const map = autoMap(s.data[h].map((c) => String(c ?? "").trim()).filter(Boolean));
    const score = REQUIRED_FIELDS.filter((f) => map[f]).length * 1e6 + s.data.length;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}
