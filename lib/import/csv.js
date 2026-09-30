// Dependency-free CSV/TSV reader. Never silently truncate records or columns.
export const MAX_IMPORT_CHARS = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 50000;

export class CsvError extends Error {
  constructor(message, line = 1) {
    super(`Satır ${line}: ${message}`);
    this.name = "CsvError";
    this.line = line;
  }
}

function detectDelimiter(text) {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (c === "\r" || c === "\n")) break;
    else if (!quoted && c in counts) counts[c]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export function parseTable(input, { delimiter = "auto", maxRows = MAX_IMPORT_ROWS } = {}) {
  const text = String(input ?? "").replace(/^\uFEFF/, "");
  if (text.length > MAX_IMPORT_CHARS) throw new CsvError("Dosya 5 milyon karakter sınırını aşıyor.");
  if (!text.trim()) return { rows: [], headers: [], rowNumbers: [], delimiter: null };
  if (text.includes("\u0000")) throw new CsvError("İkili dosya okunamaz. Excel'den tabloyu kopyalayın veya UTF-8 CSV kullanın.");
  if (text.includes("\uFFFD")) throw new CsvError("Metin kodlaması bozuk. UTF-8 CSV kullanın veya Excel'den kopyalayın.");
  // Skip leading empty physical lines before delimiter detection.
  const sample = text.replace(/^(?:[ \t]*\r?\n)+/, "");
  const sep = delimiter === "auto" ? detectDelimiter(sample) : delimiter;
  if (![",", ";", "\t"].includes(sep)) throw new CsvError("Geçersiz sütun ayracı.");
  const records = [], lineNumbers = [];
  let row = [], field = "", quoted = false, afterQuote = false, line = 1, startLine = 1;
  const finishField = () => { row.push(field); field = ""; afterQuote = false; };
  const finishRow = () => {
    finishField();
    if (row.some(v => v.trim() !== "")) {
      records.push(row); lineNumbers.push(startLine);
      if (records.length > maxRows + 1) throw new CsvError(`En fazla ${maxRows} veri satırı okunabilir.`, startLine);
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else {
        if (c === "\r" || c === "\n") {
          field += "\n"; if (c === "\r" && text[i + 1] === "\n") i++; line++;
        } else field += c;
      }
    } else if (c === sep) finishField();
    else if (c === "\r" || c === "\n") {
      finishRow(); if (c === "\r" && text[i + 1] === "\n") i++;
      line++; startLine = line;
    } else if (c === '"') {
      if (field !== "" || afterQuote) throw new CsvError("Alan içinde beklenmeyen çift tırnak.", line);
      quoted = true;
    } else {
      if (afterQuote) {
        if (c === " ") continue;
        throw new CsvError("Kapanan tırnaktan sonra beklenmeyen karakter.", line);
      }
      field += c;
    }
  }
  if (quoted) throw new CsvError("Kapanmamış çift tırnak.", startLine);
  if (field !== "" || row.length || afterQuote) finishRow();
  if (!records.length) return { rows: [], headers: [], rowNumbers: [], delimiter: sep };
  const headers = records[0].map(v => v.trim());
  if (headers.some(v => !v)) throw new CsvError("Boş sütun başlığı var.", lineNumbers[0]);
  if (new Set(headers).size !== headers.length) throw new CsvError("Tekrarlanan sütun başlığı var.", lineNumbers[0]);
  const rows = records.slice(1).map((values, i) => {
    if (values.length !== headers.length) throw new CsvError(`Beklenen ${headers.length} sütun; bulunan ${values.length}.`, lineNumbers[i + 1]);
    return Object.fromEntries(headers.map((h, j) => [h, values[j]]));
  });
  return { rows, headers, rowNumbers: lineNumbers.slice(1), delimiter: sep };
}

export function parseCsv(text, options) { return parseTable(text, options).rows; }
