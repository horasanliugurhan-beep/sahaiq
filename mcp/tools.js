// SahaIQ as a read-only data source for Claude (MCP tools).
//
// Rules (sahaiq#21):
// - Fictional demo data only. Real or Qlik data needs the owner's company
//   approval and an auth layer first; this file must not read anything else.
// - No new analytics: every number comes from lib/ (the same code the demo
//   and its tests use), so a Claude dashboard shows exactly the demo's figures.
// - Read-only and pure: no writes, no network, no clock (asOf is the data date).

import { analyze, SEGMENTS } from "../lib/analyze.js";
import { generateSampleRows } from "../lib/sample-data.js";
import { fmtInt } from "../lib/format.js";

export const SOURCE = "kurgusal demo verisi (gerçek firma veya rakam içermez)";
const MAX_LIMIT = 100;
const PRIORITY = { 3: "yüksek", 2: "orta", 1: "düşük" };

let cache = null;
function data() {
  if (!cache) {
    const rows = generateSampleRows();
    cache = { rows, result: analyze(rows) };
  }
  return cache;
}

// Money stays exact: integer kuruş plus a human-readable string.
const kurus = (tl) => Math.round(tl * 100);
function tlText(tl) {
  const k = kurus(tl);
  const sign = k < 0 ? "-" : "";
  const abs = Math.abs(k);
  return `${sign}₺${fmtInt(Math.floor(abs / 100))},${String(abs % 100).padStart(2, "0")}`;
}
function value(basis, v) {
  return basis === "revenue" ? { kurus: kurus(v), text: tlText(v) } : { units: v, text: `${fmtInt(v)} adet` };
}

function meta(extra = {}) {
  const { result } = data();
  return { source: SOURCE, asOf: result.asOf, basis: result.basis === "revenue" ? "ciro (TL)" : "adet", ...extra };
}

function customerView(c) {
  const { result } = data();
  return {
    id: c.id,
    name: c.name,
    region: c.region || null,
    segment: c.segment_key,
    segmentLabel: SEGMENTS[c.segment_key]?.label || c.segment_key,
    rfm: c.R === null || c.R === undefined ? null : { R: c.R, F: c.F, M: c.M },
    lastPurchase: c.hasPurchase === false ? null : c.lastDate,
    daysSinceLastPurchase: c.recency_days ?? null,
    purchaseDays: c.frequency,
    total: value(result.basis, c.monetary),
    trend: {
      windowDays: c.trend.windowDays ?? 90,
      recent: value(result.basis, c.trend.recent),
      previous: value(result.basis, c.trend.previous),
      changePct: c.trend.pct,
      dropping: Boolean(c.trend.isDropping),
    },
    topProduct: c.topProduct || null,
    topBrand: c.topBrand || null,
  };
}

function callView(a, rank) {
  const { result } = data();
  return {
    rank,
    customerId: a.customerId,
    name: a.customerName,
    priority: PRIORITY[a.priority] || String(a.priority),
    segment: a.segmentKey,
    reasons: a.reasons.map((r) => r.reason),
    nextAction: a.reasons[0]?.nextAction || a.nextAction,
    total: value(result.basis, a.monetary),
  };
}

// --- input validation (small JSON-schema subset, strict) -------------------

class ToolInputError extends Error {}

function check(schema, args) {
  // Omitted arguments mean "none"; an explicit null is not an object and is rejected.
  if (args === null) throw new ToolInputError("Argümanlar bir nesne olmalı.");
  const input = args ?? {};
  if (typeof input !== "object" || Array.isArray(input)) throw new ToolInputError("Argümanlar bir nesne olmalı.");
  const props = schema.properties || {};
  // Own properties only: `in` would accept inherited names like toString or __proto__.
  for (const key of Object.keys(input)) if (!Object.hasOwn(props, key)) throw new ToolInputError(`Bilinmeyen argüman: ${key.slice(0, 40)}`);
  for (const key of schema.required || []) if (input[key] === undefined) throw new ToolInputError(`Eksik argüman: ${key}`);
  for (const [key, p] of Object.entries(props)) {
    const v = input[key];
    if (v === undefined) continue;
    if (p.type === "integer" && !Number.isSafeInteger(v)) throw new ToolInputError(`${key} tam sayı olmalı.`);
    if (p.type === "string" && typeof v !== "string") throw new ToolInputError(`${key} metin olmalı.`);
    if (p.enum && !p.enum.includes(v)) throw new ToolInputError(`${key} şunlardan biri olmalı: ${p.enum.join(", ")}`);
    if (p.minimum !== undefined && v < p.minimum) throw new ToolInputError(`${key} en az ${p.minimum} olmalı.`);
    if (p.maximum !== undefined && v > p.maximum) throw new ToolInputError(`${key} en fazla ${p.maximum} olmalı.`);
    if (p.maxLength !== undefined && v.length > p.maxLength) throw new ToolInputError(`${key} çok uzun.`);
  }
  return input;
}

const limitProp = { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: `En fazla kaç kayıt (1–${MAX_LIMIT}).` };
const SEGMENT_KEYS = Object.keys(SEGMENTS);
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// --- tools -------------------------------------------------------------------

export const TOOLS = [
  {
    name: "get_kpis",
    title: "Özet göstergeler",
    description: "Kurgusal demo verisinin özet göstergeleri: müşteri sayısı, toplam ciro, yüksek öncelikli müşteri sayısı, risk altındaki ciro ve payı, cironun %80'ini yapan müşteri sayısı (Pareto). Rakamlar SahaIQ'nun test edilmiş hesabından gelir.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run() {
      const { result } = data();
      const k = result.kpis;
      const counts = { yüksek: 0, orta: 0, düşük: 0 };
      for (const a of result.callList) counts[PRIORITY[a.priority]]++;
      return {
        ...meta(),
        customers: k.accounts,
        rows: result.rowCount,
        total: value(result.basis, k.total),
        callList: { total: result.callList.length, byPriority: counts },
        atRisk: { ...value(result.basis, k.atRiskValue), sharePct: Math.round(k.atRiskShare * 1000) / 10 },
        paretoCustomers: k.paretoCount,
      };
    },
  },
  {
    name: "get_call_list",
    title: "Arama listesi",
    description: "Bugün kimin aranacağına dair gerekçeli öncelik listesi (yüksek, orta, düşük). Sıra, SahaIQ'nun öncelik ve müşteri değeri kurallarından gelir; her kayıtta gerekçe ve önerilen sonraki adım var.",
    inputSchema: {
      type: "object",
      properties: { priority: { type: "string", enum: ["yüksek", "orta", "düşük"], description: "Yalnızca bu öncelik." }, limit: limitProp },
      additionalProperties: false,
    },
    run(args) {
      const { result } = data();
      const list = result.callList.map((a, i) => callView(a, i + 1)).filter((x) => !args.priority || x.priority === args.priority);
      const limit = args.limit ?? 30;
      return { ...meta({ listTotal: result.callList.length }), matched: list.length, items: list.slice(0, limit) };
    },
  },
  {
    name: "get_customers",
    title: "Müşteri listesi",
    description: "Müşteriler; RFM puanı ve segmenti, son alım, toplam ciro ve son 90 günün önceki 90 güne göre değişimiyle. Segment ve bölgeye göre süzülebilir, ciroya, değişime veya son alıma göre sıralanabilir.",
    inputSchema: {
      type: "object",
      properties: {
        segment: { type: "string", enum: SEGMENT_KEYS, description: "RFM segmenti." },
        region: { type: "string", maxLength: 40, description: "Bölge adı (ör. Kuzey)." },
        sort: { type: "string", enum: ["total_desc", "change_asc", "change_desc", "recency_desc", "name_asc"], description: "Sıralama. change_asc: en çok düşenler önce." },
        limit: limitProp,
      },
      additionalProperties: false,
    },
    run(args) {
      const { result } = data();
      let list = result.customers.filter((c) => (!args.segment || c.segment_key === args.segment) && (!args.region || c.region === args.region));
      const pct = (c) => (c.trend.pct === null || c.trend.pct === undefined ? null : c.trend.pct);
      const nullsLast = (f, dir) => (a, b) => {
        const x = f(a);
        const y = f(b);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return dir * (x - y);
      };
      const sorts = {
        total_desc: (a, b) => b.monetary - a.monetary,
        change_asc: nullsLast(pct, 1),
        change_desc: nullsLast(pct, -1),
        recency_desc: nullsLast((c) => c.recency_days ?? null, -1),
        name_asc: (a, b) => a.name.localeCompare(b.name, "tr"),
      };
      list = [...list].sort(sorts[args.sort || "total_desc"]);
      const limit = args.limit ?? 40;
      return { ...meta(), matched: list.length, items: list.slice(0, limit).map(customerView) };
    },
  },
  {
    name: "get_customer",
    title: "Tek müşteri",
    description: "Bir müşterinin ayrıntısı: segment, RFM, son alım, trend, en çok aldığı ürün ve arama listesindeki gerekçeleri. id get_customers veya get_call_list sonucundan alınır (ör. D016).",
    inputSchema: { type: "object", properties: { id: { type: "string", maxLength: 20, description: "Müşteri kodu." } }, required: ["id"], additionalProperties: false },
    run(args) {
      const { result } = data();
      const c = result.customers.find((x) => x.id === args.id);
      if (!c) throw new ToolInputError(`"${args.id}" kodlu müşteri yok.`);
      const idx = result.callList.findIndex((a) => a.customerId === c.id);
      return { ...meta(), customer: customerView(c), callList: idx < 0 ? null : callView(result.callList[idx], idx + 1) };
    },
  },
  {
    name: "get_segment_summary",
    title: "Segment özeti",
    description: "Her RFM segmentindeki müşteri sayısı, toplam cirosu ve toplam içindeki payı, segmentin anlamıyla birlikte.",
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
          sharePct: totalK ? Math.round((k / totalK) * 1000) / 10 : 0,
        };
      }).filter((s) => s.customers > 0);
      return { ...meta(), segments };
    },
  },
  {
    name: "get_sales_timeseries",
    title: "Satış zaman serisi",
    description: "Net satışın (iadeler düşülmüş) haftalık veya aylık seyri; tüm müşteriler ya da tek müşteri için. Grafikler için.",
    inputSchema: {
      type: "object",
      properties: {
        granularity: { type: "string", enum: ["week", "month"], description: "Haftalık (pazartesi başlangıçlı) ya da aylık." },
        customer_id: { type: "string", maxLength: 20, description: "Verilirse yalnızca bu müşteri." },
      },
      required: ["granularity"],
      additionalProperties: false,
    },
    run(args) {
      const { rows, result } = data();
      if (args.customer_id && !result.customers.some((c) => c.id === args.customer_id)) throw new ToolInputError(`"${args.customer_id}" kodlu müşteri yok.`);
      const bucket = (iso) => {
        if (args.granularity === "month") return iso.slice(0, 7);
        const d = new Date(iso + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
        return d.toISOString().slice(0, 10);
      };
      const sums = new Map();
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
        units: s.units,
      }));
      return { ...meta({ granularity: args.granularity, customerId: args.customer_id || null }), points };
    },
  },
];

export function listTools() {
  return TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema, annotations: { title, ...READ_ONLY } }));
}

/** Runs a tool. Returns an MCP CallToolResult; never throws for bad input. */
export function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  try {
    const out = tool.run(check(tool.inputSchema, args));
    return { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out };
  } catch (e) {
    const message = e instanceof ToolInputError ? e.message : "Araç çalışırken beklenmeyen bir hata oluştu.";
    return { content: [{ type: "text", text: message }], isError: true };
  }
}
