// Vendor-neutral sales schema and fail-closed validation.
// Rules carried over from the observer pilot: a bad row is reported with its
// line number and blocks the analysis instead of being silently dropped;
// blank money is "unknown", never zero; customer codes stay text.

export const REQUIRED_FIELDS = ["customer_id", "customer_name", "date", "quantity"];
export const OPTIONAL_FIELDS = ["revenue", "product", "brand", "region"];

export const FIELD_LABELS = {
  customer_id: "Cari kod / müşteri kodu",
  customer_name: "Cari ünvan / müşteri adı",
  date: "Satış / fatura tarihi",
  quantity: "Net adet",
  revenue: "Net satış tutarı (TL)",
  product: "Ürün",
  brand: "Marka",
  region: "Bölge / ilçe",
};

export const LOCALES = { "tr-TR": "Türkçe (1.234,56)", "en-US": "İngilizce (1,234.56)" };

const ALIASES = {
  customer_id: ["customer_id", "customerid", "customer_code", "musteri_id", "musteri_kodu", "musteri_no", "cari_kod", "cari_kodu", "cari_no", "bayi_kodu", "account_id"],
  customer_name: ["customer_name", "customer", "musteri", "musteri_adi", "cari_adi", "cari_unvan", "cari_unvani", "unvan", "bayi", "bayi_adi", "account_name"],
  date: ["date", "tarih", "siparis_tarihi", "fatura_tarihi", "satis_tarihi", "order_date", "invoice_date", "islem_tarihi"],
  quantity: ["quantity", "qty", "adet", "net_adet", "satis_adedi", "miktar", "units"],
  revenue: ["revenue", "amount", "tutar", "ciro", "net_ciro", "net_tutar", "net_satis_tutari", "satis_tutari", "sales"],
  product: ["product", "urun", "urun_adi", "urun_kodu", "stok_adi", "malzeme", "item", "ebat"],
  brand: ["brand", "marka", "marka_adi"],
  region: ["region", "bolge", "ilce", "il", "sehir", "city", "territory"],
};

export function normalizeHeader(h) {
  return String(h)
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// Only maps a field when exactly one header matches; ambiguity is left to the user.
export function autoMap(headers) {
  const map = {};
  const used = new Set();
  for (const field of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
    const hits = headers.filter((h) => ALIASES[field].includes(normalizeHeader(h)) && !used.has(h));
    if (hits.length === 1) {
      map[field] = hits[0];
      used.add(hits[0]);
    }
  }
  return map;
}

export function validateMapping(map) {
  return REQUIRED_FIELDS.filter((k) => !map?.[k]);
}

// Explicit locale: in tr-TR "1.000" is one thousand, in en-US it is one.
// Returns null for blank input. Throws on anything it cannot read unambiguously.
export function parseLocalizedNumber(value, { locale = "tr-TR", money = false } = {}) {
  if (!LOCALES[locale]) throw new Error("Sayı biçimi seçilmedi.");
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Sayı sınır dışında.");
    return money ? Math.round(value * 100) / 100 : value;
  }
  let raw = String(value).trim().replace(/ /g, " ");
  if (!raw) return null;
  if (money) raw = raw.replace(/^(?:₺|TL)\s*/i, "").replace(/\s*(?:₺|TL)$/i, "").trim();
  let negative = false;
  if (/^\(.*\)$/.test(raw)) {
    negative = true;
    raw = raw.slice(1, -1).trim();
  }
  const pattern = locale === "tr-TR" ? /^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/ : /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
  if (!pattern.test(raw)) throw new Error(`"${value}" sayı olarak okunamadı (seçili biçim: ${LOCALES[locale]}).`);
  const normalized = locale === "tr-TR" ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  const decimals = (normalized.split(".")[1] || "").length;
  if (money && decimals > 2) throw new Error(`"${value}": tutar en fazla iki ondalık içermeli.`);
  const result = Number(normalized) * (negative ? -1 : 1);
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER / 100) throw new Error("Sayı güvenli hesaplama sınırını aşıyor.");
  return result;
}

// Guess the number format from sample values. Turkish wins ties because the
// unambiguous Turkish signals (decimal comma) are common in local exports.
export function guessLocale(values) {
  let tr = 0;
  let en = 0;
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (/^\(?[+-]?\d{1,3}(\.\d{3})+(,\d+)?\)?$/.test(s) || /^\(?[+-]?\d+,\d{1,2}\)?$/.test(s)) tr++;
    else if (/^\(?[+-]?\d{1,3}(,\d{3})+(\.\d+)?\)?$/.test(s) || /^\(?[+-]?\d+\.\d{1,2}\)?$/.test(s)) en++;
  }
  return en > tr ? "en-US" : "tr-TR";
}

// Returns YYYY-MM-DD; throws on unknown formats and impossible dates.
export function parseDateOnly(value) {
  const raw = String(value ?? "").trim();
  let y, m, d, x;
  if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(raw))) [, y, m, d] = x;
  else if ((x = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})(?: .*)?$/.exec(raw))) [, d, , m, y] = x;
  else throw new Error(`"${raw}" tarih olarak okunamadı (GG.AA.YYYY veya YYYY-AA-GG).`);
  y = Number(y);
  m = Number(m);
  d = Number(d);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || y > 9999 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) {
    throw new Error(`"${raw}" takvimde olmayan bir tarih.`);
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function validateRow(row, map, { locale = "tr-TR" } = {}) {
  const errors = [];
  const get = (k) => (map[k] ? row[map[k]] : undefined);
  const data = {};
  for (const field of ["customer_id", "customer_name"]) {
    const raw = get(field);
    if (raw === undefined || !String(raw).trim()) errors.push({ field, message: `${FIELD_LABELS[field]} boş.` });
    else data[field] = String(raw).trim();
  }
  try {
    data.date = parseDateOnly(get("date"));
  } catch (e) {
    errors.push({ field: "date", message: e.message });
  }
  try {
    const q = parseLocalizedNumber(get("quantity"), { locale });
    if (q === null) throw new Error("Adet boş.");
    if (!Number.isSafeInteger(q)) throw new Error(`Adet tam sayı olmalı (${get("quantity")}).`);
    data.quantity = q;
  } catch (e) {
    errors.push({ field: "quantity", message: e.message });
  }
  if (map.revenue) {
    try {
      data.revenue = parseLocalizedNumber(get("revenue"), { locale, money: true });
    } catch (e) {
      errors.push({ field: "revenue", message: e.message });
    }
  } else {
    data.revenue = null;
  }
  for (const field of ["product", "brand", "region"]) data[field] = String(get(field) ?? "").trim();
  return { value: errors.length ? null : data, errors };
}

// Compatibility helper: the normalized row or null.
export function normalizeRow(row, map, options) {
  return validateRow(row, map, options).value;
}

/**
 * Validates a whole table. Any error blocks the analysis; warnings do not.
 * @param table {headers, rows, rowNumbers} from parseTable
 */
export function validateDataset(table, map, { locale = "tr-TR", maxErrors = 50 } = {}) {
  const rows = [];
  const errors = [];
  const warnings = [];
  for (const k of validateMapping(map)) errors.push({ row: 0, field: k, message: `${FIELD_LABELS[k]} sütunu seçilmedi.` });
  const selected = Object.entries(map).filter(([, h]) => h);
  if (new Set(selected.map(([, h]) => h)).size !== selected.length) errors.push({ row: 0, field: "mapping", message: "Aynı sütun iki farklı alana seçilmiş." });
  for (const [field, h] of selected) if (!table.headers.includes(h)) errors.push({ row: 0, field, message: `"${h}" sütunu dosyada yok.` });
  if (!table.rows.length) errors.push({ row: 0, field: "file", message: "Dosyada veri satırı yok." });
  if (errors.length) return { rows, errors, warnings, errorCount: errors.length };

  const names = new Map();
  const seen = new Map();
  let errorCount = 0;
  const push = (e) => {
    errorCount++;
    if (errors.length < maxErrors) errors.push(e);
  };
  table.rows.forEach((raw, i) => {
    const line = table.rowNumbers?.[i] ?? i + 2;
    const checked = validateRow(raw, map, { locale });
    checked.errors.forEach((e) => push({ row: line, ...e }));
    if (!checked.value) return;
    const v = checked.value;
    const nameKey = v.customer_name.toLocaleUpperCase("tr-TR").replace(/\s+/g, " ");
    if (names.has(v.customer_id) && names.get(v.customer_id).key !== nameKey) {
      push({ row: line, field: "customer_name", message: `"${v.customer_id}" kodu farklı ünvanlarla geçiyor ("${names.get(v.customer_id).name}" / "${v.customer_name}").` });
    } else if (!names.has(v.customer_id)) {
      names.set(v.customer_id, { key: nameKey, name: v.customer_name });
    }
    const sig = JSON.stringify(v);
    if (seen.has(sig)) warnings.push({ row: line, field: "duplicate", message: `Satır ${seen.get(sig)} ile birebir aynı. Ayrı işlem olduğunu doğrulayın; silinmedi.` });
    else seen.set(sig, line);
    rows.push({ ...v, sourceRow: line });
  });

  const dupes = warnings.filter((w) => w.field === "duplicate");
  const summary = [];
  if (dupes.length) summary.push({ row: 0, field: "duplicate", message: `${dupes.length} satır başka bir satırla birebir aynı (ilki: satır ${dupes[0].row}). Ayrı işlem olduklarını doğrulayın; silinmedi.` });
  const missingMoney = rows.filter((r) => r.revenue === null).length;
  if (map.revenue && missingMoney) summary.push({ row: 0, field: "revenue", message: `${missingMoney} satırda tutar boş. Eksik tutar sıfır sayılmadı; analiz adet üzerinden yapıldı.` });
  if (rows.some((r) => r.quantity < 0)) summary.push({ row: 0, field: "quantity", message: "Negatif adetler (iade/iptal) net adetten düşüldü; son alım tarihi yalnızca pozitif satışlardan alındı." });
  return { rows, errors, warnings: summary, errorCount };
}
