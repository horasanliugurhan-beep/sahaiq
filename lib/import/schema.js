// Vendor-neutral sales schema + tolerant value parsing.

export const REQUIRED_FIELDS = ["customer_id", "customer_name", "date", "quantity"];
export const OPTIONAL_FIELDS = ["revenue", "product", "brand", "region"];

export const FIELD_LABELS = {
  customer_id: "Müşteri kodu",
  customer_name: "Müşteri adı",
  date: "Tarih",
  quantity: "Adet",
  revenue: "Tutar / ciro",
  product: "Ürün",
  brand: "Marka",
  region: "Bölge",
};

// Common header spellings seen in ERP / Excel / BI exports.
const ALIASES = {
  customer_id: ["customer_id", "customerid", "customer_code", "musteri_id", "musteri_kodu", "musterikodu", "cari_kod", "carikod", "cari_kodu", "cari_no", "bayi_kodu", "account_id"],
  customer_name: ["customer_name", "customer", "musteri", "musteri_adi", "musteriadi", "cari_adi", "cari_unvan", "unvan", "bayi", "bayi_adi", "account_name"],
  date: ["date", "tarih", "siparis_tarihi", "fatura_tarihi", "order_date", "invoice_date", "islem_tarihi"],
  quantity: ["quantity", "qty", "adet", "miktar", "units"],
  revenue: ["revenue", "amount", "tutar", "ciro", "net_tutar", "toplam", "sales", "total"],
  product: ["product", "urun", "urun_adi", "stok_adi", "malzeme", "item", "ebat"],
  brand: ["brand", "marka"],
  region: ["region", "bolge", "il", "sehir", "city", "territory"],
};

export function normalizeHeader(h) {
  return String(h)
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function autoMap(headers) {
  const map = {};
  const norm = headers.map((h) => [h, normalizeHeader(h)]);
  for (const field of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
    const hit = norm.find(([, n]) => ALIASES[field].includes(n));
    if (hit) map[field] = hit[0];
  }
  return map;
}

// Accepts 1234.5 / 1,234.50 / 1.234,50 / "₺ 1.234" etc.
export function parseNumber(value) {
  if (typeof value === "number") return value;
  let s = String(value ?? "").replace(/[^\d.,-]/g, "");
  if (s === "" || s === "-") return NaN;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal mark.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Single comma -> Turkish decimal mark ("12,5"); several -> thousands ("1,234,567").
    const parts = s.split(",");
    s = parts.length > 2 ? parts.join("") : s.replace(",", ".");
  } else if (lastDot > -1) {
    const parts = s.split(".");
    // "1.234.567" -> thousands; "1.250" (Turkish thousands) -> 1250; "12.5" -> decimal.
    const trTh = parts.length === 2 && parts[1].length === 3 && /^-?[1-9]\d{0,2}$/.test(parts[0]);
    if (parts.length > 2 || trTh) s = parts.join("");
  }
  return Number(s);
}

// Returns YYYY-MM-DD or null. Accepts ISO, DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY.
export function parseDate(value) {
  const s = String(value ?? "").trim();
  let y, m, d;
  let x = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (x) [, y, m, d] = x;
  else if ((x = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) [, d, m, y] = x;
  else return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = Date.parse(iso + "T00:00:00Z");
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

export function normalizeRow(row, map) {
  const get = (k) => (map[k] ? row[map[k]] : undefined);
  const id = String(get("customer_id") ?? "").trim();
  const name = String(get("customer_name") ?? "").trim();
  const date = parseDate(get("date"));
  const quantity = parseNumber(get("quantity") ?? 0);
  const revenue = parseNumber(get("revenue") ?? 0);
  if (!id || !name || !date || !Number.isFinite(quantity)) return null;
  return {
    customer_id: id,
    customer_name: name,
    date,
    quantity,
    revenue: Number.isFinite(revenue) ? revenue : 0,
    product: String(get("product") ?? ""),
    brand: String(get("brand") ?? ""),
    region: String(get("region") ?? ""),
  };
}

export function validateMapping(map) {
  return REQUIRED_FIELDS.filter((k) => !map?.[k]);
}
