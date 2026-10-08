var __defProp = Object.defineProperty;
var __name = (target, value2) => __defProp(target, "name", { value: value2, configurable: true });

// lib/aggregate.js
var DAY = 864e5;
var toTime = /* @__PURE__ */ __name((iso2) => Date.parse(iso2 + "T00:00:00Z"), "toTime");
function latestDate(rows) {
  let max = null;
  for (const r of rows) if (!max || r.date > max) max = r.date;
  return max;
}
__name(latestDate, "latestDate");
function mostCommon(values) {
  const counts = /* @__PURE__ */ new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = "";
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}
__name(mostCommon, "mostCommon");
function topByUnits(list) {
  const units = /* @__PURE__ */ new Map();
  for (const r of list) if (r.product && r.quantity > 0) units.set(r.product, (units.get(r.product) || 0) + r.quantity);
  let best = "";
  let n = 0;
  for (const [p, u] of units) if (u > n) [best, n] = [p, u];
  return best;
}
__name(topByUnits, "topByUnits");
function aggregateCustomers(rows, opts = {}) {
  if (!rows.length) return { asOf: null, basis: "revenue", customers: [] };
  const asOf = opts.asOf || latestDate(rows);
  const asOfT = toTime(asOf);
  const window = opts.trendWindowDays ?? 90;
  const dropAt = opts.dropThresholdPct ?? -30;
  const basis = rows.every((r) => typeof r.revenue === "number" && Number.isFinite(r.revenue)) && rows.some((r) => r.revenue !== 0) ? "revenue" : "quantity";
  const value2 = /* @__PURE__ */ __name((r) => basis === "revenue" ? Math.round(r.revenue * 100) : r.quantity, "value");
  const out = /* @__PURE__ */ __name((v) => basis === "revenue" ? v / 100 : v, "out");
  const byCustomer = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (!byCustomer.has(r.customer_id)) byCustomer.set(r.customer_id, []);
    byCustomer.get(r.customer_id).push(r);
  }
  const asOfMonth = new Date(asOfT);
  const monthIndex = /* @__PURE__ */ __name((iso2) => {
    const d = new Date(toTime(iso2));
    return (asOfMonth.getUTCFullYear() - d.getUTCFullYear()) * 12 + (asOfMonth.getUTCMonth() - d.getUTCMonth());
  }, "monthIndex");
  const customers = [];
  for (const [id, list] of byCustomer) {
    const dates = /* @__PURE__ */ new Set();
    const recentDates = /* @__PURE__ */ new Set();
    const previousDates = /* @__PURE__ */ new Set();
    let monetary = 0;
    let units = 0;
    let recent = 0;
    let previous = 0;
    let last = null;
    let first = null;
    const monthly = Array(12).fill(0);
    for (const r of list) {
      monetary += value2(r);
      units += r.quantity;
      if (r.quantity > 0) {
        dates.add(r.date);
        if (!last || r.date > last) last = r.date;
        if (!first || r.date < first) first = r.date;
      }
      const age = (asOfT - toTime(r.date)) / DAY;
      if (age >= 0 && age < window) {
        recent += value2(r);
        if (r.quantity > 0) recentDates.add(r.date);
      } else if (age >= window && age < window * 2) {
        previous += value2(r);
        if (r.quantity > 0) previousDates.add(r.date);
      }
      const mi = monthIndex(r.date);
      if (mi >= 0 && mi < 12) monthly[11 - mi] += value2(r);
    }
    const pct = previous > 0 ? Math.round((recent - previous) / previous * 100) : null;
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
        pct,
        isDropping: pct !== null && pct <= dropAt,
        recent: out(recent),
        previous: out(previous),
        recentPurchaseDays: recentDates.size,
        previousPurchaseDays: previousDates.size,
        windowDays: window
      },
      monthly: monthly.map(out)
    });
  }
  return { asOf, basis, customers };
}
__name(aggregateCustomers, "aggregateCustomers");

// lib/rfm.js
function assignQuintile(items, higherIsBetter = true) {
  const s = [...items].sort((a, b) => higherIsBetter ? b.val - a.val : a.val - b.val);
  const out = /* @__PURE__ */ new Map();
  let pv, ps = 5;
  s.forEach((x, i) => {
    let q = i / s.length < 0.2 ? 5 : i / s.length < 0.4 ? 4 : i / s.length < 0.6 ? 3 : i / s.length < 0.8 ? 2 : 1;
    if (pv !== void 0 && x.val === pv) q = ps;
    out.set(x.id, q);
    pv = x.val;
    ps = q;
  });
  return out;
}
__name(assignQuintile, "assignQuintile");
function segmentOf(R, F, M) {
  if (R >= 4 && F >= 4 && M >= 4) return "champion";
  if (R <= 2 && F >= 3 && M >= 3) return "at_risk";
  if (R <= 2 && F <= 2) return "dormant";
  if (R >= 3 && F >= 3) return "loyal";
  if (R >= 4 && F <= 2) return "new";
  return "standard";
}
__name(segmentOf, "segmentOf");
function calculateRFM(customers) {
  const hasPurchase = /* @__PURE__ */ __name((c) => c.hasPurchase !== false && c.frequency > 0, "hasPurchase");
  const buyers = customers.filter(hasPurchase);
  const rs = assignQuintile(buyers.map((c) => ({ id: c.id, val: c.recency_days })), false);
  const fs = assignQuintile(buyers.map((c) => ({ id: c.id, val: c.frequency })));
  const ms = assignQuintile(buyers.map((c) => ({ id: c.id, val: c.monetary })));
  return customers.map((c) => {
    if (!hasPurchase(c)) return { ...c, R: null, F: null, M: null, segment_key: "no_purchase" };
    const R = rs.get(c.id), F = fs.get(c.id), M = ms.get(c.id);
    return { ...c, R, F, M, segment_key: segmentOf(R, F, M) };
  });
}
__name(calculateRFM, "calculateRFM");

// lib/action-engine-rules.js
var PRIORITY = { HIGH: 3, MEDIUM: 2, LOW: 1 };
var CATEGORY = { RETENTION: "retention", RECOVERY: "recovery", OPPORTUNITY: "opportunity", MAINTENANCE: "maintenance", GROWTH: "growth" };
var SLA = { champion: 14, loyal: 30, at_risk: 7, new: 14, standard: 60 };
var action = /* @__PURE__ */ __name((ctx, x) => ({
  ...x,
  customerId: ctx.customer.id,
  customerName: ctx.customer.name,
  segmentKey: ctx.rfm.segment_key,
  monetary: ctx.rfm.monetary ?? 0,
  lastContactDays: ctx.lastContactDays ?? null
}), "action");
function champion(ctx) {
  if (ctx.rfm.segment_key !== "champion" || (ctx.lastContactDays ?? 9999) <= SLA.champion) return null;
  return action(ctx, {
    ruleKey: "champion-silent",
    priority: PRIORITY.HIGH,
    category: CATEGORY.RETENTION,
    reason: `En de\u011Ferli m\xFC\u015Fterilerden biri ${ctx.lastContactDays} g\xFCnd\xFCr al\u0131m yapmad\u0131`,
    nextAction: "Aray\u0131n, son talebi ve stok ihtiyac\u0131n\u0131 konu\u015Fun."
  });
}
__name(champion, "champion");
function risk(ctx) {
  if (ctx.rfm.segment_key !== "at_risk") return null;
  return action(ctx, {
    ruleKey: "at-risk",
    priority: PRIORITY.HIGH,
    category: CATEGORY.RECOVERY,
    reason: `Eskiden d\xFCzenli alan m\xFC\u015Fteri ${ctx.rfm.recency_days} g\xFCnd\xFCr sessiz`,
    nextAction: "Kaybedilen talebi ara\u015Ft\u0131r\u0131n, geri kazan\u0131m g\xF6r\xFC\u015Fmesi planlay\u0131n."
  });
}
__name(risk, "risk");
function decline(ctx) {
  if (!ctx.trend?.isDropping) return null;
  const pct = Math.abs(ctx.trend.pct);
  const window = ctx.trend.windowDays ?? 90;
  const silent = ctx.trend.recentPurchaseDays === 0 && ctx.trend.previousPurchaseDays > 0;
  const wiped = ctx.trend.recent <= 0;
  if (silent && ["at_risk", "dormant"].includes(ctx.rfm.segment_key)) return null;
  return action(ctx, {
    ruleKey: "sales-decline",
    priority: PRIORITY.HIGH,
    category: CATEGORY.OPPORTUNITY,
    reason: silent ? `Son ${window} g\xFCnde hi\xE7 al\u0131m yok (\xF6nceki ${window} g\xFCnde al\u0131m vard\u0131)` : wiped ? `Son ${window} g\xFCnde iadeler al\u0131mlar\u0131 kar\u015F\u0131lad\u0131; net sat\u0131\u015F s\u0131f\u0131ra ya da eksiye indi` : `Son ${window} g\xFCnde net sat\u0131\u015F \xF6nceki ${window} g\xFCne g\xF6re %${pct} d\xFC\u015Ft\xFC (iadeler dahil)`,
    nextAction: "Fiyat, stok, rakip ve talep de\u011Fi\u015Fimini kontrol edin."
  });
}
__name(decline, "decline");
function loyal(ctx) {
  if (ctx.rfm.segment_key !== "loyal" || (ctx.lastContactDays ?? 9999) <= SLA.loyal) return null;
  return action(ctx, {
    ruleKey: "loyal-followup",
    priority: PRIORITY.MEDIUM,
    category: CATEGORY.MAINTENANCE,
    reason: `Sad\u0131k m\xFC\u015Fteri ${ctx.lastContactDays} g\xFCnd\xFCr al\u0131m yapmad\u0131 (hedef: ${SLA.loyal} g\xFCn)`,
    nextAction: "Rutin takip ziyareti veya aramas\u0131 planlay\u0131n."
  });
}
__name(loyal, "loyal");
function newCustomer(ctx) {
  if (ctx.rfm.segment_key !== "new") return null;
  return action(ctx, {
    ruleKey: "new-onboarding",
    priority: PRIORITY.MEDIUM,
    category: CATEGORY.GROWTH,
    reason: "Yeni m\xFC\u015Fteri: ilk al\u0131mlar yap\u0131ld\u0131, ili\u015Fki hen\xFCz oturmad\u0131",
    nextAction: "Memnuniyeti sorun, \xFCr\xFCn yelpazesini geni\u015Fletmeyi \xF6nerin."
  });
}
__name(newCustomer, "newCustomer");
function dormant(ctx) {
  if (ctx.rfm.segment_key !== "dormant") return null;
  return action(ctx, {
    ruleKey: "dormant-winback",
    priority: PRIORITY.LOW,
    category: CATEGORY.RECOVERY,
    reason: `Uzun s\xFCredir pasif (${ctx.rfm.recency_days} g\xFCn)`,
    nextAction: "D\xFC\u015F\xFCk maliyetli bir geri kazan\u0131m teklifiyle yoklay\u0131n."
  });
}
__name(dormant, "dormant");
var RULES = [champion, risk, decline, loyal, newCustomer, dormant];
function evaluateRules(ctx) {
  if (ctx.rfm.hasPurchase === false || ctx.rfm.segment_key === "no_purchase") return [];
  return RULES.map((r) => r(ctx)).filter(Boolean);
}
__name(evaluateRules, "evaluateRules");
function sortActions(xs) {
  return [...xs].sort(
    (a, b) => b.priority - a.priority || (b.monetary ?? 0) - (a.monetary ?? 0) || String(a.customerName).localeCompare(String(b.customerName), "tr")
  );
}
__name(sortActions, "sortActions");
function groupByCustomer(actions) {
  const map = /* @__PURE__ */ new Map();
  for (const a of sortActions(actions)) {
    if (!map.has(a.customerId)) map.set(a.customerId, { ...a, reasons: [] });
    map.get(a.customerId).reasons.push({ ruleKey: a.ruleKey, reason: a.reason, nextAction: a.nextAction });
  }
  return [...map.values()];
}
__name(groupByCustomer, "groupByCustomer");

// lib/analyze.js
var SEGMENTS = {
  champion: { label: "\u015Eampiyon", hint: "S\u0131k alan, yak\u0131n zamanda alan, en \xE7ok ciro getiren" },
  loyal: { label: "Sad\u0131k", hint: "D\xFCzenli ve s\u0131k alan" },
  at_risk: { label: "Risk alt\u0131nda", hint: "Eskiden de\u011Ferliydi, son d\xF6nemde sessiz" },
  new: { label: "Yeni", hint: "Yak\u0131n zamanda ba\u015Flad\u0131, az say\u0131da al\u0131m" },
  standard: { label: "Standart", hint: "Ortalama davran\u0131\u015F" },
  dormant: { label: "Pasif", hint: "Uzun s\xFCredir al\u0131m yok, d\xFC\u015F\xFCk s\u0131kl\u0131k" },
  no_purchase: { label: "Al\u0131m ge\xE7mi\u015Fi yok", hint: "Y\xFCklenen veride pozitif sat\u0131\u015F yok; RFM puan\u0131 ve sat\u0131\u015F takibi \xF6nerisi \xFCretilmez" }
};
function analyze(rows, opts = {}) {
  const { asOf, basis, customers } = aggregateCustomers(rows, opts);
  const scored = calculateRFM(customers);
  const actions = scored.flatMap(
    (r) => evaluateRules({ customer: { id: r.id, name: r.name }, rfm: r, lastContactDays: r.lastContactDays, trend: r.trend })
  );
  const callList = groupByCustomer(actions);
  const segmentCounts = Object.fromEntries(Object.keys(SEGMENTS).map((k) => [k, 0]));
  for (const c of scored) segmentCounts[c.segment_key] = (segmentCounts[c.segment_key] || 0) + 1;
  const exact = /* @__PURE__ */ __name((xs) => xs.reduce((s, c) => s + Math.round(c.monetary * 100), 0) / 100, "exact");
  const total = exact(scored);
  const atRiskValue = exact(scored.filter((c) => c.segment_key === "at_risk" || c.trend.isDropping));
  let acc = 0;
  let pareto = 0;
  for (const c of [...scored].sort((a, b) => b.monetary - a.monetary)) {
    if (acc >= total * 0.8) break;
    acc += c.monetary;
    pareto++;
  }
  return {
    asOf,
    basis,
    rowCount: rows.length,
    customers: scored,
    actions,
    callList,
    segmentCounts,
    kpis: {
      accounts: scored.length,
      total,
      highPriority: callList.filter((x) => x.priority === 3).length,
      atRiskValue,
      atRiskShare: total ? atRiskValue / total : 0,
      paretoCount: pareto
    }
  };
}
__name(analyze, "analyze");

// lib/sample-data.js
var SAMPLE_AS_OF = "2026-09-30";
function rng(seed) {
  return function() {
    seed |= 0;
    seed = seed + 1831565813 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
__name(rng, "rng");
var PREFIXES = ["Kuzey", "Mavi", "Y\u0131ld\u0131z", "Anadolu", "\xC7\u0131nar", "Doruk", "Ege", "Poyraz", "Kartal", "Lodos", "G\xF6kku\u015Fa\u011F\u0131", "Pusula", "Meltem", "Bereket", "Zirve", "Liman", "Ard\u0131\xE7", "Kervan", "Toros", "Sahil", "Ufuk", "Ilgaz", "Defne", "R\xFCzgar", "Atlas", "Kumru", "Nehir", "\xC7am", "Yayla", "G\xFCne\u015F", "Saray", "Akdeniz", "Bulut", "Elmas", "Fener", "Gelincik", "Hisar", "\u0130nci", "Kaya", "Mart\u0131"];
var SUFFIXES = ["Oto Lastik", "Lastik Market", "Oto Servis", "Jant & Lastik", "Lastik Merkezi"];
var REGIONS = ["Kuzey", "G\xFCney", "Do\u011Fu", "Bat\u0131", "Merkez"];
var PRODUCTS = [
  { name: "Yaz 205/55 R16", price: 3150 },
  { name: "K\u0131\u015F 225/45 R17", price: 4400 },
  { name: "4 Mevsim 195/65 R15", price: 2750 },
  { name: "SUV 235/55 R18", price: 5900 },
  { name: "Hafif Ticari 215/65 R16C", price: 4100 }
];
var BRANDS = ["Marka A", "Marka B", "Marka C"];
var MIX = [
  ["champion", 6],
  ["loyal", 8],
  ["declining", 6],
  ["silent", 5],
  ["new", 5],
  ["standard", 6],
  ["dormant", 4]
];
var DAY2 = 864e5;
var iso = /* @__PURE__ */ __name((t) => new Date(t).toISOString().slice(0, 10), "iso");
function generateSampleRows(seed = 2026) {
  const r = rng(seed);
  const pick = /* @__PURE__ */ __name((arr) => arr[Math.floor(r() * arr.length)], "pick");
  const between = /* @__PURE__ */ __name((a, b) => a + r() * (b - a), "between");
  const end = Date.parse(SAMPLE_AS_OF + "T00:00:00Z");
  const start = end - 364 * DAY2;
  const rows = [];
  let n = 0;
  for (const [type, count] of MIX) {
    for (let k = 0; k < count; k++) {
      n++;
      const id = `D${String(n).padStart(3, "0")}`;
      const name = `Kurgu ${PREFIXES[n * 7 % PREFIXES.length]} ${SUFFIXES[n * 3 % SUFFIXES.length]}`;
      const region = REGIONS[n % REGIONS.length];
      const brand = pick(BRANDS);
      const size = between(0.7, 1.4);
      let t, stopAt, gap, qty;
      switch (type) {
        case "champion":
          t = start + between(0, 10) * DAY2;
          stopAt = end - between(1, 9) * DAY2;
          gap = /* @__PURE__ */ __name(() => between(10, 14), "gap");
          qty = /* @__PURE__ */ __name(() => between(30, 44), "qty");
          break;
        case "loyal":
          t = start + between(0, 25) * DAY2;
          stopAt = end - between(5, 26) * DAY2;
          gap = /* @__PURE__ */ __name(() => between(24, 32), "gap");
          qty = /* @__PURE__ */ __name(() => between(14, 22), "qty");
          break;
        case "declining":
          t = start + between(0, 15) * DAY2;
          stopAt = end - between(10, 35) * DAY2;
          gap = /* @__PURE__ */ __name((tt) => tt > end - 120 * DAY2 ? between(40, 55) : between(14, 24), "gap");
          qty = /* @__PURE__ */ __name((tt) => tt > end - 120 * DAY2 ? between(7, 12) : between(24, 34), "qty");
          break;
        case "silent":
          t = start + between(0, 15) * DAY2;
          stopAt = end - between(110, 170) * DAY2;
          gap = /* @__PURE__ */ __name(() => between(12, 22), "gap");
          qty = /* @__PURE__ */ __name(() => between(20, 30), "qty");
          break;
        case "new":
          t = end - between(45, 80) * DAY2;
          stopAt = end - between(2, 12) * DAY2;
          gap = /* @__PURE__ */ __name(() => between(20, 40), "gap");
          qty = /* @__PURE__ */ __name(() => between(10, 18), "qty");
          break;
        case "standard":
          t = start + between(0, 40) * DAY2;
          stopAt = end - between(15, 50) * DAY2;
          gap = /* @__PURE__ */ __name(() => between(45, 75), "gap");
          qty = /* @__PURE__ */ __name(() => between(8, 13), "qty");
          break;
        default:
          t = start + between(0, 30) * DAY2;
          stopAt = start + between(60, 140) * DAY2;
          gap = /* @__PURE__ */ __name(() => between(35, 60), "gap");
          qty = /* @__PURE__ */ __name(() => between(4, 10), "qty");
      }
      while (t <= stopAt) {
        const lines = 1 + Math.floor(r() * 2);
        for (let l = 0; l < lines; l++) {
          const p = pick(PRODUCTS);
          const quantity = Math.max(1, Math.round(qty(t) * size / lines));
          const unit = p.price * between(0.94, 1.06);
          rows.push({
            customer_id: id,
            customer_name: name,
            date: iso(t),
            quantity,
            revenue: Math.round(quantity * unit),
            product: p.name,
            brand,
            region
          });
        }
        t += gap(t) * DAY2;
      }
    }
  }
  return rows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.customer_id.localeCompare(b.customer_id));
}
__name(generateSampleRows, "generateSampleRows");

// lib/format.js
function fmtInt(n) {
  const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return n < 0 && Math.round(n) !== 0 ? "-" + s : s;
}
__name(fmtInt, "fmtInt");

// mcp/tools.js
var SOURCE = "kurgusal demo verisi (ger\xE7ek firma veya rakam i\xE7ermez)";
var MAX_LIMIT = 100;
var PRIORITY2 = { 3: "y\xFCksek", 2: "orta", 1: "d\xFC\u015F\xFCk" };
var cache = null;
function data() {
  if (!cache) {
    const rows = generateSampleRows();
    cache = { rows, result: analyze(rows) };
  }
  return cache;
}
__name(data, "data");
var kurus = /* @__PURE__ */ __name((tl) => Math.round(tl * 100), "kurus");
function tlText(tl) {
  const k = kurus(tl);
  const sign = k < 0 ? "-" : "";
  const abs = Math.abs(k);
  return `${sign}\u20BA${fmtInt(Math.floor(abs / 100))},${String(abs % 100).padStart(2, "0")}`;
}
__name(tlText, "tlText");
function value(basis, v) {
  return basis === "revenue" ? { kurus: kurus(v), text: tlText(v) } : { units: v, text: `${fmtInt(v)} adet` };
}
__name(value, "value");
function meta(extra = {}) {
  const { result } = data();
  return { source: SOURCE, asOf: result.asOf, basis: result.basis === "revenue" ? "ciro (TL)" : "adet", ...extra };
}
__name(meta, "meta");
function customerView(c) {
  const { result } = data();
  return {
    id: c.id,
    name: c.name,
    region: c.region || null,
    segment: c.segment_key,
    segmentLabel: SEGMENTS[c.segment_key]?.label || c.segment_key,
    rfm: c.R === null || c.R === void 0 ? null : { R: c.R, F: c.F, M: c.M },
    lastPurchase: c.hasPurchase === false ? null : c.lastDate,
    daysSinceLastPurchase: c.recency_days ?? null,
    purchaseDays: c.frequency,
    total: value(result.basis, c.monetary),
    trend: {
      windowDays: c.trend.windowDays ?? 90,
      recent: value(result.basis, c.trend.recent),
      previous: value(result.basis, c.trend.previous),
      changePct: c.trend.pct,
      dropping: Boolean(c.trend.isDropping)
    },
    topProduct: c.topProduct || null,
    topBrand: c.topBrand || null
  };
}
__name(customerView, "customerView");
function callView(a, rank) {
  const { result } = data();
  return {
    rank,
    customerId: a.customerId,
    name: a.customerName,
    priority: PRIORITY2[a.priority] || String(a.priority),
    segment: a.segmentKey,
    reasons: a.reasons.map((r) => r.reason),
    nextAction: a.reasons[0]?.nextAction || a.nextAction,
    total: value(result.basis, a.monetary)
  };
}
__name(callView, "callView");
var ToolInputError = class extends Error {
  static {
    __name(this, "ToolInputError");
  }
};
function check(schema, args) {
  if (args === null) throw new ToolInputError("Arg\xFCmanlar bir nesne olmal\u0131.");
  const input = args ?? {};
  if (typeof input !== "object" || Array.isArray(input)) throw new ToolInputError("Arg\xFCmanlar bir nesne olmal\u0131.");
  const props = schema.properties || {};
  for (const key of Object.keys(input)) if (!Object.hasOwn(props, key)) throw new ToolInputError(`Bilinmeyen arg\xFCman: ${key.slice(0, 40)}`);
  for (const key of schema.required || []) if (input[key] === void 0) throw new ToolInputError(`Eksik arg\xFCman: ${key}`);
  for (const [key, p] of Object.entries(props)) {
    const v = input[key];
    if (v === void 0) continue;
    if (p.type === "integer" && !Number.isSafeInteger(v)) throw new ToolInputError(`${key} tam say\u0131 olmal\u0131.`);
    if (p.type === "string" && typeof v !== "string") throw new ToolInputError(`${key} metin olmal\u0131.`);
    if (p.enum && !p.enum.includes(v)) throw new ToolInputError(`${key} \u015Funlardan biri olmal\u0131: ${p.enum.join(", ")}`);
    if (p.minimum !== void 0 && v < p.minimum) throw new ToolInputError(`${key} en az ${p.minimum} olmal\u0131.`);
    if (p.maximum !== void 0 && v > p.maximum) throw new ToolInputError(`${key} en fazla ${p.maximum} olmal\u0131.`);
    if (p.maxLength !== void 0 && v.length > p.maxLength) throw new ToolInputError(`${key} \xE7ok uzun.`);
  }
  return input;
}
__name(check, "check");
var limitProp = { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: `En fazla ka\xE7 kay\u0131t (1\u2013${MAX_LIMIT}).` };
var SEGMENT_KEYS = Object.keys(SEGMENTS);
var READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
var TOOLS = [
  {
    name: "get_kpis",
    title: "\xD6zet g\xF6stergeler",
    description: "Kurgusal demo verisinin \xF6zet g\xF6stergeleri: m\xFC\u015Fteri say\u0131s\u0131, toplam ciro, y\xFCksek \xF6ncelikli m\xFC\u015Fteri say\u0131s\u0131, risk alt\u0131ndaki ciro ve pay\u0131, cironun %80'ini yapan m\xFC\u015Fteri say\u0131s\u0131 (Pareto). Rakamlar SahaIQ'nun test edilmi\u015F hesab\u0131ndan gelir.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run() {
      const { result } = data();
      const k = result.kpis;
      const counts = { y\u00FCksek: 0, orta: 0, d\u00FC\u015F\u00FCk: 0 };
      for (const a of result.callList) counts[PRIORITY2[a.priority]]++;
      return {
        ...meta(),
        customers: k.accounts,
        rows: result.rowCount,
        total: value(result.basis, k.total),
        callList: { total: result.callList.length, byPriority: counts },
        atRisk: { ...value(result.basis, k.atRiskValue), sharePct: Math.round(k.atRiskShare * 1e3) / 10 },
        paretoCustomers: k.paretoCount
      };
    }
  },
  {
    name: "get_call_list",
    title: "Arama listesi",
    description: "Bug\xFCn kimin aranaca\u011F\u0131na dair gerek\xE7eli \xF6ncelik listesi (y\xFCksek, orta, d\xFC\u015F\xFCk). S\u0131ra, SahaIQ'nun \xF6ncelik ve m\xFC\u015Fteri de\u011Feri kurallar\u0131ndan gelir; her kay\u0131tta gerek\xE7e ve \xF6nerilen sonraki ad\u0131m var.",
    inputSchema: {
      type: "object",
      properties: { priority: { type: "string", enum: ["y\xFCksek", "orta", "d\xFC\u015F\xFCk"], description: "Yaln\u0131zca bu \xF6ncelik." }, limit: limitProp },
      additionalProperties: false
    },
    run(args) {
      const { result } = data();
      const list = result.callList.map((a, i) => callView(a, i + 1)).filter((x) => !args.priority || x.priority === args.priority);
      const limit = args.limit ?? 30;
      return { ...meta({ listTotal: result.callList.length }), matched: list.length, items: list.slice(0, limit) };
    }
  },
  {
    name: "get_customers",
    title: "M\xFC\u015Fteri listesi",
    description: "M\xFC\u015Fteriler; RFM puan\u0131 ve segmenti, son al\u0131m, toplam ciro ve son 90 g\xFCn\xFCn \xF6nceki 90 g\xFCne g\xF6re de\u011Fi\u015Fimiyle. Segment ve b\xF6lgeye g\xF6re s\xFCz\xFClebilir, ciroya, de\u011Fi\u015Fime veya son al\u0131ma g\xF6re s\u0131ralanabilir.",
    inputSchema: {
      type: "object",
      properties: {
        segment: { type: "string", enum: SEGMENT_KEYS, description: "RFM segmenti." },
        region: { type: "string", maxLength: 40, description: "B\xF6lge ad\u0131 (\xF6r. Kuzey)." },
        sort: { type: "string", enum: ["total_desc", "change_asc", "change_desc", "recency_desc", "name_asc"], description: "S\u0131ralama. change_asc: en \xE7ok d\xFC\u015Fenler \xF6nce." },
        limit: limitProp
      },
      additionalProperties: false
    },
    run(args) {
      const { result } = data();
      let list = result.customers.filter((c) => (!args.segment || c.segment_key === args.segment) && (!args.region || c.region === args.region));
      const pct = /* @__PURE__ */ __name((c) => c.trend.pct === null || c.trend.pct === void 0 ? null : c.trend.pct, "pct");
      const nullsLast = /* @__PURE__ */ __name((f, dir) => (a, b) => {
        const x = f(a);
        const y = f(b);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return dir * (x - y);
      }, "nullsLast");
      const sorts = {
        total_desc: /* @__PURE__ */ __name((a, b) => b.monetary - a.monetary, "total_desc"),
        change_asc: nullsLast(pct, 1),
        change_desc: nullsLast(pct, -1),
        recency_desc: nullsLast((c) => c.recency_days ?? null, -1),
        name_asc: /* @__PURE__ */ __name((a, b) => a.name.localeCompare(b.name, "tr"), "name_asc")
      };
      list = [...list].sort(sorts[args.sort || "total_desc"]);
      const limit = args.limit ?? 40;
      return { ...meta(), matched: list.length, items: list.slice(0, limit).map(customerView) };
    }
  },
  {
    name: "get_customer",
    title: "Tek m\xFC\u015Fteri",
    description: "Bir m\xFC\u015Fterinin ayr\u0131nt\u0131s\u0131: segment, RFM, son al\u0131m, trend, en \xE7ok ald\u0131\u011F\u0131 \xFCr\xFCn ve arama listesindeki gerek\xE7eleri. id get_customers veya get_call_list sonucundan al\u0131n\u0131r (\xF6r. D016).",
    inputSchema: { type: "object", properties: { id: { type: "string", maxLength: 20, description: "M\xFC\u015Fteri kodu." } }, required: ["id"], additionalProperties: false },
    run(args) {
      const { result } = data();
      const c = result.customers.find((x) => x.id === args.id);
      if (!c) throw new ToolInputError(`"${args.id}" kodlu m\xFC\u015Fteri yok.`);
      const idx = result.callList.findIndex((a) => a.customerId === c.id);
      return { ...meta(), customer: customerView(c), callList: idx < 0 ? null : callView(result.callList[idx], idx + 1) };
    }
  },
  {
    name: "get_segment_summary",
    title: "Segment \xF6zeti",
    description: "Her RFM segmentindeki m\xFC\u015Fteri say\u0131s\u0131, toplam cirosu ve toplam i\xE7indeki pay\u0131, segmentin anlam\u0131yla birlikte.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run() {
      const { result } = data();
      const totalK = kurus(result.kpis.total);
      const segments = SEGMENT_KEYS.map((key) => {
        const members = result.customers.filter((c) => c.segment_key === key);
        const k = members.reduce((s, c) => s + kurus(c.monetary), 0);
        return {
          segment: key,
          label: SEGMENTS[key].label,
          meaning: SEGMENTS[key].hint,
          customers: members.length,
          total: value(result.basis, k / 100),
          sharePct: totalK ? Math.round(k / totalK * 1e3) / 10 : 0
        };
      }).filter((s) => s.customers > 0);
      return { ...meta(), segments };
    }
  },
  {
    name: "get_sales_timeseries",
    title: "Sat\u0131\u015F zaman serisi",
    description: "Net sat\u0131\u015F\u0131n (iadeler d\xFC\u015F\xFClm\xFC\u015F) haftal\u0131k veya ayl\u0131k seyri; t\xFCm m\xFC\u015Fteriler ya da tek m\xFC\u015Fteri i\xE7in. Grafikler i\xE7in.",
    inputSchema: {
      type: "object",
      properties: {
        granularity: { type: "string", enum: ["week", "month"], description: "Haftal\u0131k (pazartesi ba\u015Flang\u0131\xE7l\u0131) ya da ayl\u0131k." },
        customer_id: { type: "string", maxLength: 20, description: "Verilirse yaln\u0131zca bu m\xFC\u015Fteri." }
      },
      required: ["granularity"],
      additionalProperties: false
    },
    run(args) {
      const { rows, result } = data();
      if (args.customer_id && !result.customers.some((c) => c.id === args.customer_id)) throw new ToolInputError(`"${args.customer_id}" kodlu m\xFC\u015Fteri yok.`);
      const bucket = /* @__PURE__ */ __name((iso2) => {
        if (args.granularity === "month") return iso2.slice(0, 7);
        const d = /* @__PURE__ */ new Date(iso2 + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
        return d.toISOString().slice(0, 10);
      }, "bucket");
      const sums = /* @__PURE__ */ new Map();
      for (const r of rows) {
        if (args.customer_id && r.customer_id !== args.customer_id) continue;
        const key = bucket(r.date);
        const cur = sums.get(key) || { k: 0, units: 0 };
        cur.k += Math.round((r.revenue ?? 0) * 100);
        cur.units += r.quantity;
        sums.set(key, cur);
      }
      const points = [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, s]) => ({
        period,
        net: result.basis === "revenue" ? { kurus: s.k, text: tlText(s.k / 100) } : { units: s.units, text: `${fmtInt(s.units)} adet` },
        units: s.units
      }));
      return { ...meta({ granularity: args.granularity, customerId: args.customer_id || null }), points };
    }
  }
];
function listTools() {
  return TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema, annotations: { title, ...READ_ONLY } }));
}
__name(listTools, "listTools");
function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  try {
    const out = tool.run(check(tool.inputSchema, args));
    return { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out };
  } catch (e) {
    const message = e instanceof ToolInputError ? e.message : "Ara\xE7 \xE7al\u0131\u015F\u0131rken beklenmeyen bir hata olu\u015Ftu.";
    return { content: [{ type: "text", text: message }], isError: true };
  }
}
__name(callTool, "callTool");

// mcp/server.js
var SERVER_INFO = { name: "sahaiq", title: "SahaIQ (kurgusal demo verisi)", version: "0.1.0" };
var PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
var MAX_BODY = 64 * 1024;
var ALLOWED_ORIGINS = ["https://claude.ai", "https://claude.com"];
var INSTRUCTIONS = "SahaIQ, saha sat\u0131\u015F ekipleri i\xE7in \xF6ncelik ve sat\u0131\u015F analiti\u011Fi hesaplar. Bu sunucu yaln\u0131zca KURGUSAL demo verisi verir; firma adlar\u0131 'Kurgu' ile ba\u015Flar ve ger\xE7ek de\u011Fildir. Rakamlar\u0131 yeniden hesaplama veya tahmin etme; ara\xE7lar\u0131n d\xF6nd\xFCrd\xFC\u011F\xFC de\u011Ferleri kullan ve panellerde veri tarihini (asOf) ile kayna\u011F\u0131 g\xF6ster. Para alanlar\u0131nda 'kurus' tamsay\u0131d\u0131r, 'text' g\xF6sterim i\xE7indir.";
var ok = /* @__PURE__ */ __name((id, result) => ({ jsonrpc: "2.0", id, result }), "ok");
var fail = /* @__PURE__ */ __name((id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }), "fail");
function handleMessage(msg) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return fail(msg?.id, -32600, "Invalid Request");
  }
  const isNotification = msg.id === void 0;
  if (isNotification) return null;
  const params = msg.params ?? {};
  switch (msg.method) {
    case "initialize": {
      const asked = params.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return ok(msg.id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: listTools() });
    case "tools/call": {
      if (typeof params.name !== "string") return fail(msg.id, -32602, "Invalid params: name");
      const result = callTool(params.name, params.arguments);
      if (!result) return fail(msg.id, -32602, `Unknown tool: ${params.name}`);
      return ok(msg.id, result);
    }
    default:
      return fail(msg.id, -32601, "Method not found");
  }
}
__name(handleMessage, "handleMessage");
var json = /* @__PURE__ */ __name((body, status = 200, extra = {}) => new Response(body === null ? null : JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra }
}), "json");
async function readLimited(request, max) {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (; ; ) {
    const { done, value: value2 } = await reader.read();
    if (done) break;
    size += value2.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {
      });
      return null;
    }
    chunks.push(value2);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
__name(readLimited, "readLimited");
async function handleHttp(request) {
  const url = new URL(request.url);
  if (url.pathname === "/" && request.method === "GET") {
    return new Response("SahaIQ MCP sunucusu (kurgusal demo verisi). MCP u\xE7 noktas\u0131: /mcp\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (url.pathname !== "/mcp") return json({ error: "not found" }, 404);
  const origin = request.headers.get("origin");
  if (origin !== null && !ALLOWED_ORIGINS.includes(origin)) return json(fail(null, -32600, "Origin not allowed"), 403);
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405, { allow: "POST" });
  const version = request.headers.get("mcp-protocol-version");
  if (version !== null && !PROTOCOL_VERSIONS.includes(version)) return json(fail(null, -32600, "Unsupported MCP-Protocol-Version"), 400);
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return json(fail(null, -32700, "Content-Type must be application/json"), 415);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY) return json(fail(null, -32600, "Request too large"), 413);
  const bytes = await readLimited(request, MAX_BODY);
  if (bytes === null) return json(fail(null, -32600, "Request too large"), 413);
  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return json(fail(null, -32700, "Parse error"), 400);
  }
  if (Array.isArray(payload)) {
    if (!payload.length || payload.length > 20) return json(fail(null, -32600, "Invalid batch"), 400);
    const responses = payload.map(handleMessage).filter(Boolean);
    return responses.length ? json(responses) : new Response(null, { status: 202 });
  }
  const response = handleMessage(payload);
  return response ? json(response) : new Response(null, { status: 202 });
}
__name(handleHttp, "handleHttp");

// mcp/worker.js
var worker_default = {
  fetch(request) {
    return handleHttp(request);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
