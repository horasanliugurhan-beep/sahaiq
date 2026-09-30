export const REQUIRED_FIELDS = ["customer_id", "customer_name", "date", "quantity"];
export const OPTIONAL_FIELDS = ["revenue", "product", "brand", "region"];
export const FIELD_LABELS = {
  customer_id: "Cari kod", customer_name: "Cari ünvan", date: "Satış / fatura tarihi",
  quantity: "Net adet", revenue: "Net satış tutarı (TL)", product: "Ürün", brand: "Marka", region: "Bölge / ilçe"
};

// Locale must be chosen explicitly: in tr-TR, 1.000 means one thousand.
// Blank is unknown, never zero. Currency decorations are allowed only on money.
export function parseLocalizedNumber(value, { locale = "tr-TR", money = false } = {}) {
  if (!["tr-TR", "en-US"].includes(locale)) throw new Error("Sayı biçimi seçilmedi.");
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error("Sayı sınır dışında.");
    if (money) {
      const cents = value * 100;
      if (!Number.isSafeInteger(Math.round(cents)) || Math.abs(cents - Math.round(cents)) > 1e-7) throw new Error("Tutar güvenli sınırda ve en fazla iki ondalık basamaklı olmalı.");
      return Math.round(cents) / 100;
    }
    return value;
  }
  if (typeof value !== "string") throw new Error("Geçersiz sayı türü.");
  let raw = value.trim().replace(/\u00A0/g, " ");
  if (money) raw = raw.replace(/^(?:₺|TL)\s*/i, "").replace(/\s*(?:₺|TL)$/i, "").trim();
  let negative = false;
  if (/^\(.*\)$/.test(raw)) { negative = true; raw = raw.slice(1, -1).trim(); }
  if (negative && /^[+-]/.test(raw)) throw new Error("Çelişkili sayı işareti.");
  const pattern = locale === "tr-TR"
    ? /^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/
    : /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
  if (!pattern.test(raw)) throw new Error(`Geçersiz sayı; seçilen biçim ${locale}.`);
  const normalized = locale === "tr-TR" ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  const decimals = (normalized.split(".")[1] || "").length;
  if (money && decimals > 2) throw new Error("Tutar en fazla iki ondalık basamak içermeli; yuvarlama yapılmadı.");
  const result = Number(normalized) * (negative ? -1 : 1);
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER || (money && !Number.isSafeInteger(Math.round(result * 100)))) {
    throw new Error("Sayı güvenli hesaplama sınırını aşıyor.");
  }
  return result;
}

export function parseDateOnly(value) {
  if (typeof value !== "string") throw new Error("Tarih metin olmalı: GG.AA.YYYY veya YYYY-AA-GG.");
  const raw = value.trim();
  let y, m, d, match;
  if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw))) [, y, m, d] = match;
  else if ((match = /^(\d{2})([./])(\d{2})\2(\d{4})$/.exec(raw))) [, d, , m, y] = match;
  else throw new Error("Tarih biçimi GG.AA.YYYY, GG/AA/YYYY veya YYYY-AA-GG olmalı.");
  y = Number(y); m = Number(m); d = Number(d);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || y > 9999 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error("Takvimde bulunmayan veya desteklenmeyen tarih.");
  }
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const keyOf = value => String(value).toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]/g, "");
export function autoMapping(headers) {
  const aliases = {
    customer_id: ["customer_id", "cari kod", "cari kodu", "müşteri kodu", "müşteri no"],
    customer_name: ["customer_name", "cari ünvan", "cari unvanı", "cari ünvanı", "müşteri adı"],
    date: ["date", "tarih", "fatura tarihi", "satış tarihi"],
    quantity: ["quantity", "adet", "net adet", "satış adedi", "miktar"],
    revenue: ["revenue", "ciro", "net ciro", "net satış tutarı", "satış tutarı"],
    product: ["product", "ürün", "ürün adı", "ürün kodu"],
    brand: ["brand", "marka", "marka adı"], region: ["region", "bölge", "ilçe"]
  };
  const mapping = {};
  for (const [field, variants] of Object.entries(aliases)) {
    const matches = headers.filter(h => variants.map(keyOf).includes(keyOf(h)));
    if (matches.length === 1) mapping[field] = matches[0];
  }
  return mapping;
}

export function validateMapping(map) { return REQUIRED_FIELDS.filter(k => !map?.[k]); }

export function validateRow(row, map, options = {}) {
  const errors = [];
  const get = key => map[key] ? row[map[key]] : null;
  const data = {};
  for (const field of ["customer_id", "customer_name"]) {
    const raw = get(field);
    if (typeof raw !== "string" || !raw.trim()) errors.push({ field, message: "Zorunlu metin alanı boş veya geçersiz." });
    else data[field] = raw.trim();
  }
  try { data.date = parseDateOnly(get("date")); } catch (e) { errors.push({ field: "date", message: e.message }); }
  try {
    data.quantity = parseLocalizedNumber(get("quantity"), options);
    if (!Number.isSafeInteger(data.quantity)) throw new Error("Lastik adedi boş olamaz; tam sayı olmalı.");
  } catch (e) { errors.push({ field: "quantity", message: e.message }); }
  try { data.revenue = parseLocalizedNumber(get("revenue"), { ...options, money: true }); }
  catch (e) { errors.push({ field: "revenue", message: e.message }); }
  for (const field of ["product", "brand", "region"]) data[field] = String(get(field) ?? "").trim();
  return { value: errors.length ? null : data, errors };
}

// Compatibility export. New callers must use validateDataset, which retains errors.
export function normalizeRow(row, map, options) { return validateRow(row, map, options).value; }

export function validateDataset(table, map, { asOfDate, locale = "tr-TR" } = {}) {
  const rows = [], errors = [], warnings = [], names = new Map(), seen = new Map();
  let asOf;
  try { asOf = parseDateOnly(asOfDate); } catch { errors.push({ row: 0, field: "asOfDate", message: "Kaynak rapor tarihini seçin." }); }
  for (const key of validateMapping(map)) errors.push({ row: 0, field: key, message: "Zorunlu sütun eşleştirilmedi." });
  const selected = Object.entries(map).filter(([, h]) => h);
  if (new Set(selected.map(([, h]) => h)).size !== selected.length) errors.push({ row: 0, field: "mapping", message: "Bir kaynak sütunu iki alana eşleştirilemez." });
  for (const [field, header] of selected) if (!table.headers.includes(header)) errors.push({ row: 0, field, message: "Seçilen sütun kaynakta bulunamadı." });
  if (!table.rows.length) errors.push({ row: 0, field: "file", message: "Dosyada veri satırı yok." });
  if (errors.length) return { rows, errors, warnings, sourceRows: table.rows.length };
  table.rows.forEach((raw, i) => {
    const sourceRow = table.rowNumbers?.[i] ?? i + 2;
    const checked = validateRow(raw, map, { locale });
    errors.push(...checked.errors.map(e => ({ row: sourceRow, ...e })));
    if (!checked.value) return;
    const value = checked.value;
    if (value.date > asOf) errors.push({ row: sourceRow, field: "date", message: "Satış tarihi kaynak rapor tarihinden sonra." });
    const nameKey = value.customer_name.toLocaleUpperCase("tr-TR").replace(/\s+/g, " ");
    if (names.has(value.customer_id) && names.get(value.customer_id) !== nameKey) errors.push({ row: sourceRow, field: "customer_name", message: "Aynı cari kod farklı ünvanlarla eşleşiyor; kaynağı doğrulayın." });
    names.set(value.customer_id, nameKey);
    const signature = JSON.stringify(value);
    if (seen.has(signature)) warnings.push({ row: sourceRow, field: "duplicate", message: `Satır ${seen.get(signature)} ile aynı satış alanları. Ayrı işlem olduğunu doğrulayın; otomatik silinmedi.` });
    else seen.set(signature, sourceRow);
    rows.push({ ...value, sourceRow });
  });
  if (rows.some(r => r.revenue === null)) warnings.push({ row: 0, field: "revenue", message: "Bazı tutarlar bilinmiyor. Tam ciro hesaplanmayacak; eksikler sıfır sayılmadı." });
  if (rows.some(r => r.quantity < 0)) warnings.push({ row: 0, field: "quantity", message: "Negatif adetler net adede dahil edildi. İade/iptal olduklarını kaynaktan doğrulayın." });
  // No rejected row is silently dropped: any error blocks the entire report.
  return { rows, errors, warnings, sourceRows: table.rows.length };
}
