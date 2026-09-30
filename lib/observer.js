import { parseDateOnly } from "./import/schema.js";

function safeAdd(a, b) {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error("Toplam güvenli hesaplama sınırını aşıyor; rapor durduruldu.");
  return result;
}
const daysBetween = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);

// Sales rows are NOT orders. We deliberately do not infer order frequency,
// debt, collection risk, campaigns, contact dates or current live status.
export function summarizeSales(rows, { asOfDate, followupDays = 30 } = {}) {
  const asOf = parseDateOnly(asOfDate);
  if (!Number.isInteger(followupDays) || followupDays < 1 || followupDays > 3650) throw new Error("Takip eşiği 1–3650 tam gün olmalı.");
  if (!rows.length) throw new Error("Özetlenecek veri yok.");
  const accounts = new Map();
  let netQuantity = 0, grossQuantity = 0, returnQuantity = 0, knownCents = 0, missingMoneyRows = 0;
  let earliestDate = rows[0].date, latestDate = rows[0].date;
  for (const row of rows) {
    if (parseDateOnly(row.date) > asOf || !Number.isSafeInteger(row.quantity) || !row.customer_id || !row.customer_name) throw new Error("Doğrulanmamış satış satırı.");
    if (row.revenue !== null && (typeof row.revenue !== "number" || !Number.isFinite(row.revenue))) throw new Error("Doğrulanmamış satış tutarı.");
    const cents = row.revenue === null ? null : Math.round(row.revenue * 100);
    netQuantity = safeAdd(netQuantity, row.quantity);
    if (row.quantity >= 0) grossQuantity = safeAdd(grossQuantity, row.quantity);
    else returnQuantity = safeAdd(returnQuantity, -row.quantity);
    if (cents === null) missingMoneyRows++; else knownCents = safeAdd(knownCents, cents);
    earliestDate = row.date < earliestDate ? row.date : earliestDate;
    latestDate = row.date > latestDate ? row.date : latestDate;
    if (!accounts.has(row.customer_id)) accounts.set(row.customer_id, {
      id: row.customer_id, name: row.customer_name, region: row.region, netQuantity: 0,
      knownCents: 0, missingMoneyRows: 0, salesRows: 0, lastPositiveSale: null, sourceRows: []
    });
    const account = accounts.get(row.customer_id);
    account.netQuantity = safeAdd(account.netQuantity, row.quantity);
    account.salesRows++;
    if (cents === null) account.missingMoneyRows++; else account.knownCents = safeAdd(account.knownCents, cents);
    if (row.quantity > 0 && (!account.lastPositiveSale || row.date > account.lastPositiveSale)) account.lastPositiveSale = row.date;
    account.sourceRows.push(row.sourceRow);
  }
  const customers = [...accounts.values()].map(a => ({
    ...a, revenue: a.missingMoneyRows ? null : a.knownCents / 100,
    daysSincePositiveSale: a.lastPositiveSale ? daysBetween(asOf, a.lastPositiveSale) : null
  }));
  const actions = customers.filter(a => a.daysSincePositiveSale !== null && a.daysSincePositiveSale >= followupDays)
    .sort((a, b) => b.daysSincePositiveSale - a.daysSincePositiveSale || b.netQuantity - a.netQuantity)
    .map(a => ({
      customerId: a.id, customerName: a.name, category: "follow_up", priority: "today",
      reason: `Yüklenen dosyada son pozitif satış ${a.lastPositiveSale}; kaynak rapor tarihi itibarıyla ${a.daysSincePositiveSale} gün geçmiş.`,
      nextAction: "Güncel siparişi ve son görüşmeyi doğrula; uygunsa müşteri takibi planla. Bu kayıt tek başına müşteri kaybı kanıtı değildir.",
      sourceRows: a.sourceRows
    }));
  return {
    asOfDate: asOf, followupDays, earliestDate, latestDate, customerCount: customers.length, rowCount: rows.length,
    netQuantity, grossQuantity, returnQuantity, revenue: missingMoneyRows ? null : knownCents / 100,
    knownRevenue: knownCents / 100, missingMoneyRows, customers, actions,
    limits: ["Yalnızca yüklenen dosya kapsamındadır; eksiksiz bayi ana listesi değildir.",
      "Qlik ve Outlook canlı verisi okunmadı; borç, vade, sevkiyat ve son görüşme doğrulanmadı.",
      "Satış satırı sipariş sayısı değildir. Satış düşüşü, müşteri kaybı ve ROI iddia edilmez."]
  };
}
