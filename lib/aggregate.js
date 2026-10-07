// Turns normalized transaction rows into one profile per customer:
// recency, frequency, monetary value, recent trend and a 12-month series.

const DAY = 86400000;
const toTime = (iso) => Date.parse(iso + "T00:00:00Z");

export function latestDate(rows) {
  let max = null;
  for (const r of rows) if (!max || r.date > max) max = r.date;
  return max;
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = "";
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

/**
 * @param rows normalized rows ({customer_id, customer_name, date, quantity, revenue, ...})
 * @param opts.asOf YYYY-MM-DD reference date; defaults to the latest date in the data,
 *        so a historical export is analysed "as of" its own end date.
 * @param opts.trendWindowDays size of the two windows compared for the trend (default 90)
 * @param opts.dropThresholdPct trend at or below this % counts as dropping (default -30)
 */
export function aggregateCustomers(rows, opts = {}) {
  if (!rows.length) return { asOf: null, basis: "revenue", customers: [] };
  const asOf = opts.asOf || latestDate(rows);
  const asOfT = toTime(asOf);
  const window = opts.trendWindowDays ?? 90;
  const dropAt = opts.dropThresholdPct ?? -30;
  // Use revenue when the file has it, otherwise fall back to units.
  const basis = rows.some((r) => r.revenue > 0) ? "revenue" : "quantity";
  const value = (r) => (basis === "revenue" ? r.revenue : r.quantity);

  const byCustomer = new Map();
  for (const r of rows) {
    if (!byCustomer.has(r.customer_id)) byCustomer.set(r.customer_id, []);
    byCustomer.get(r.customer_id).push(r);
  }

  const asOfMonth = new Date(asOfT);
  const monthIndex = (iso) => {
    const d = new Date(toTime(iso));
    return (asOfMonth.getUTCFullYear() - d.getUTCFullYear()) * 12 + (asOfMonth.getUTCMonth() - d.getUTCMonth());
  };

  const customers = [];
  for (const [id, list] of byCustomer) {
    const dates = new Set();
    let monetary = 0;
    let units = 0;
    let recent = 0;
    let previous = 0;
    let last = list[0].date;
    let first = list[0].date;
    const monthly = Array(12).fill(0);
    for (const r of list) {
      dates.add(r.date);
      monetary += value(r);
      units += r.quantity;
      if (r.date > last) last = r.date;
      if (r.date < first) first = r.date;
      const age = (asOfT - toTime(r.date)) / DAY;
      if (age >= 0 && age < window) recent += value(r);
      else if (age >= window && age < window * 2) previous += value(r);
      const mi = monthIndex(r.date);
      if (mi >= 0 && mi < 12) monthly[11 - mi] += value(r);
    }
    const pct = previous > 0 ? Math.round(((recent - previous) / previous) * 100) : null;
    const recency = Math.max(0, Math.round((asOfT - toTime(last)) / DAY));
    customers.push({
      id,
      name: list[0].customer_name,
      region: mostCommon(list.map((r) => r.region)),
      topBrand: mostCommon(list.map((r) => r.brand)),
      firstDate: first,
      lastDate: last,
      recency_days: recency,
      frequency: dates.size,
      monetary: Math.round(monetary * 100) / 100,
      units,
      // No CRM contact log in a sales export: last order is the best available proxy.
      lastContactDays: recency,
      tenureDays: Math.round((asOfT - toTime(first)) / DAY),
      trend: { pct, isDropping: pct !== null && pct <= dropAt, recent, previous },
      monthly,
    });
  }
  return { asOf, basis, customers };
}
