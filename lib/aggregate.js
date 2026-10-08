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

// Product the customer bought the most units of (positive sales only).
function topByUnits(list) {
  const units = new Map();
  for (const r of list) if (r.product && r.quantity > 0) units.set(r.product, (units.get(r.product) || 0) + r.quantity);
  let best = "";
  let n = 0;
  for (const [p, u] of units) if (u > n) [best, n] = [p, u];
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
  // Use revenue only when every row has a known amount; a blank amount is
  // unknown, not zero, so mixed files are analysed on units instead.
  const basis = rows.every((r) => typeof r.revenue === "number" && Number.isFinite(r.revenue)) && rows.some((r) => r.revenue !== 0) ? "revenue" : "quantity";
  // Money is summed in integer kuruş to avoid floating-point drift.
  const value = (r) => (basis === "revenue" ? Math.round(r.revenue * 100) : r.quantity);
  const out = (v) => (basis === "revenue" ? v / 100 : v);

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
    const recentDates = new Set();
    const previousDates = new Set();
    let monetary = 0;
    let units = 0;
    let recent = 0;
    let previous = 0;
    // Recency and frequency come from positive sales only: a return must not
    // look like a fresh purchase. Value and units are net of returns.
    let last = null;
    let first = null;
    const monthly = Array(12).fill(0);
    for (const r of list) {
      monetary += value(r);
      units += r.quantity;
      if (r.quantity > 0) {
        dates.add(r.date);
        if (!last || r.date > last) last = r.date;
        if (!first || r.date < first) first = r.date;
      }
      const age = (asOfT - toTime(r.date)) / DAY;
      if (age >= 0 && age < window) {
        recent += value(r);
        if (r.quantity > 0) recentDates.add(r.date);
      } else if (age >= window && age < window * 2) {
        previous += value(r);
        if (r.quantity > 0) previousDates.add(r.date);
      }
      const mi = monthIndex(r.date);
      if (mi >= 0 && mi < 12) monthly[11 - mi] += value(r);
    }
    const pct = previous > 0 ? Math.round(((recent - previous) / previous) * 100) : null;
    // A return/adjustment is not a purchase, even when it is the only row.
    const recency = last ? Math.max(0, Math.round((asOfT - toTime(last)) / DAY)) : null;
    customers.push({
      id,
      name: list[0].customer_name,
      region: mostCommon(list.map((r) => r.region)),
      topBrand: mostCommon(list.map((r) => r.brand)),
      topProduct: topByUnits(list),
      hasPurchase: dates.size > 0,
      firstDate: first,
      lastDate: last,
      recency_days: recency,
      frequency: dates.size,
      monetary: out(monetary),
      units,
      // No CRM contact log in a sales export: last order is the best available proxy.
      lastContactDays: recency,
      tenureDays: first ? Math.round((asOfT - toTime(first)) / DAY) : null,
      trend: {
        pct, isDropping: pct !== null && pct <= dropAt,
        recent: out(recent), previous: out(previous),
        recentPurchaseDays: recentDates.size, previousPurchaseDays: previousDates.size,
        windowDays: window,
      },
      monthly: monthly.map(out),
    });
  }
  return { asOf, basis, customers };
}
