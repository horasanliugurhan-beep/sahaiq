// Minimal CSV parser with delimiter detection.
// Handles comma, semicolon (common in Turkish Excel exports) and tab,
// quoted fields, escaped quotes ("") and a UTF-8 BOM.

export function detectDelimiter(headerLine) {
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const count = countOutsideQuotes(headerLine, d);
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function countOutsideQuotes(line, delimiter) {
  let q = false;
  let n = 0;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === delimiter && !q) n++;
  }
  return n;
}

export function splitLine(line, delimiter = ",") {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && q && line[i + 1] === '"') {
      cur += '"';
      i++;
    } else if (c === '"') {
      q = !q;
    } else if (c === delimiter && !q) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

export function parseCsv(text) {
  const lines = String(text)
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  if (!lines.length) return [];
  const delimiter = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter);
  return lines.slice(1).map((line) => {
    const cells = splitLine(line, delimiter);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
}

function escapeCell(v) {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, headers = rows[0] ? Object.keys(rows[0]) : []) {
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escapeCell(r[h])).join(","))].join("\n");
}
