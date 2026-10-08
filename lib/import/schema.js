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

// Header vocabulary seen in ERP / Excel / BI exports, in order of preference:
// when a report has both "Stok Kodu" and "Stok Adı", the earlier alias wins.
const ALIASES = {
  customer_id: ["customer_id", "customerid", "customer_code", "cari_kod", "cari_kodu", "cari_hesap_kodu", "hesap_kodu", "cari_no", "cari_hesap_no", "musteri_kodu", "musteri_kod", "musteri_id", "musteri_no", "bayi_kodu", "account_id"],
  customer_name: ["customer_name", "cari_unvan", "cari_unvani", "cari_hesap_unvani", "cari_adi", "cari_hesap_adi", "cari_isim", "cari_ismi", "unvan", "unvani", "musteri_unvani", "musteri_adi", "firma_adi", "firma", "bayi_adi", "bayi", "account_name", "customer", "musteri"],
  date: ["date", "fatura_tarihi", "satis_tarihi", "evrak_tarihi", "belge_tarihi", "fis_tarihi", "irsaliye_tarihi", "siparis_tarihi", "islem_tarihi", "hareket_tarihi", "tarih", "invoice_date", "order_date"],
  quantity: ["quantity", "net_adet", "net_miktar", "satis_adedi", "satis_miktari", "adet", "miktar", "miktari", "qty", "units"],
  revenue: ["revenue", "net_satis_tutari", "net_tutar", "net_tutar_tl", "net_ciro", "net_satis", "kdv_haric_tutar", "matrah", "satir_tutari", "satis_tutari", "tutar", "tutari", "tutar_tl", "ciro", "toplam_tutar", "amount", "sales"],
  product: ["product", "urun_adi", "urun_aciklamasi", "stok_adi", "stok_ismi", "malzeme_aciklamasi", "malzeme_adi", "urun", "malzeme", "ebat", "item", "urun_kodu", "stok_kodu", "malzeme_kodu"],
  brand: ["brand", "marka", "marka_adi", "marka_kodu"],
  region: ["region", "bolge", "satis_bolgesi", "bolge_kodu", "ilce", "il", "sehir", "city", "territory"],
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

// Walks each field's aliases in preference order and takes the first alias that
// matches exactly one unused header; anything ambiguous is left to the user.
export function autoMap(headers) {
  const map = {};
  const used = new Set();
  const norm = headers.map((h) => [h, normalizeHeader(h)]);
  for (const field of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
    for (const alias of ALIASES[field]) {
      const hits = norm.filter(([h, n]) => n === alias && !used.has(h));
      if (hits.length === 1) {
        map[field] = hits[0][0];
        used.add(hits[0][0]);
        break;
      }
      if (hits.length > 1) break;
    }
  }
  return map;
}

// Identifies "the same report layout" so a mapping can be reused next time.
export function headerSignature(headers) {
  return [...headers].map(normalizeHeader).sort().join("|");
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
    if (!money) return value;
    const cents = Math.round(value * 100);
    if (!Number.isSafeInteger(cents)) throw new Error("Sayı güvenli hesaplama sınırını aşıyor.");
    return cents / 100;
  }
  let raw = String(value).trim().replace(/ /g, " ");
  if (!raw) return null;
  if (money) raw = raw.replace(/^(?:₺|TL)\s*/i, "").replace(/\s*(?:₺|TL)$/i, "").trim();
  let negative = false;
  if (/^\(.*\)$/.test(raw)) {
    negative = true;
    raw = raw.slice(1, -1).trim();
    if (/^[+-]/.test(raw)) throw new Error(`"${value}": parantez içinde ayrıca işaret kullanılamaz.`);
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

// Names and products enter briefing lines as literals. Check the original value
// before trimming so edge newlines/tabs cannot disappear without an error.
const UNSAFE_LINE_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const MONEY_ROUNDING_TOLERANCE = 1e-6;

export function validateRow(row, map, { locale = "tr-TR" } = {}) {
  const errors = [];
  const warnings = [];
  const get = (k) => (map[k] ? row[map[k]] : undefined);
  const data = {};
  for (const field of ["customer_id", "customer_name"]) {
    const raw = get(field);
    if (field === "customer_name" && UNSAFE_LINE_CHARACTER.test(String(raw ?? ""))) {
      errors.push({ field, message: `${FIELD_LABELS[field]} satır sonu veya kontrol karakteri içeremez.` });
    } else if (raw === undefined || !String(raw).trim()) errors.push({ field, message: `${FIELD_LABELS[field]} boş.` });
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
      const raw = get("revenue");
      data.revenue = parseLocalizedNumber(raw, { locale, money: true });
      // Excel numeric cells can contain formula results. Keep strict text-money
      // parsing, but expose meaningful numeric rounding to the import UI.
      if (typeof raw === "number" && Math.abs(raw * 100 - Math.round(raw * 100)) > MONEY_ROUNDING_TOLERANCE) {
        warnings.push({ field: "revenue", message: "Tutar kuruşa yuvarlandı." });
      }
    } catch (e) {
      errors.push({ field: "revenue", message: e.message });
    }
  } else {
    data.revenue = null;
  }
  for (const field of ["product", "brand", "region"]) {
    const raw = String(get(field) ?? "");
    if (field === "product" && UNSAFE_LINE_CHARACTER.test(raw)) {
      errors.push({ field, message: `${FIELD_LABELS[field]} satır sonu veya kontrol karakteri içeremez.` });
    } else data[field] = raw.trim();
  }
  return { value: errors.length ? null : data, errors, warnings };
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
    checked.warnings.forEach((w) => warnings.push({ row: line, ...w }));
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
  const roundedMoney = warnings.filter((w) => w.field === "revenue");
  const summary = [];
  if (roundedMoney.length) summary.push({ row: roundedMoney[0].row, field: "revenue", message: `${roundedMoney.length} hücrede tutar kuruşa yuvarlandı; ilki satır ${roundedMoney[0].row}.` });
  if (dupes.length) summary.push({ row: 0, field: "duplicate", message: `${dupes.length} satır başka bir satırla birebir aynı (ilki: satır ${dupes[0].row}). Ayrı işlem olduklarını doğrulayın; silinmedi.` });
  const missingMoney = rows.filter((r) => r.revenue === null).length;
  if (map.revenue && missingMoney) summary.push({ row: 0, field: "revenue", message: `${missingMoney} satırda tutar boş. Eksik tutar sıfır sayılmadı; analiz adet üzerinden yapıldı.` });
  if (rows.some((r) => r.quantity < 0)) summary.push({ row: 0, field: "quantity", message: "Negatif adetler (iade/iptal) net adetten düşüldü; son alım tarihi yalnızca pozitif satışlardan alındı." });
  return { rows, errors, warnings: summary, errorCount };
}
