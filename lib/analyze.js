// One call from normalized rows to everything the dashboard shows.
import { aggregateCustomers } from "./aggregate.js";
import { calculateRFM } from "./rfm.js";
import { evaluateRules, groupByCustomer } from "./action-engine-rules.js";

export const SEGMENTS = {
  champion: { label: "Şampiyon", hint: "Sık alan, yakın zamanda alan, en çok ciro getiren" },
  loyal: { label: "Sadık", hint: "Düzenli ve sık alan" },
  at_risk: { label: "Risk altında", hint: "Eskiden değerliydi, son dönemde sessiz" },
  new: { label: "Yeni", hint: "Yakın zamanda başladı, az sayıda alım" },
  standard: { label: "Standart", hint: "Ortalama davranış" },
  dormant: { label: "Pasif", hint: "Uzun süredir alım yok, düşük sıklık" },
};

export function analyze(rows, opts = {}) {
  const { asOf, basis, customers } = aggregateCustomers(rows, opts);
  const scored = calculateRFM(customers);
  const actions = scored.flatMap((r) =>
    evaluateRules({ customer: { id: r.id, name: r.name }, rfm: r, lastContactDays: r.lastContactDays, trend: r.trend })
  );
  const callList = groupByCustomer(actions);
  const segmentCounts = Object.fromEntries(Object.keys(SEGMENTS).map((k) => [k, 0]));
  for (const c of scored) segmentCounts[c.segment_key] = (segmentCounts[c.segment_key] || 0) + 1;

  const total = scored.reduce((s, c) => s + c.monetary, 0);
  const atRiskValue = scored
    .filter((c) => c.segment_key === "at_risk" || c.trend.isDropping)
    .reduce((s, c) => s + c.monetary, 0);
  // Pareto: how many customers make up 80% of the value.
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
      paretoCount: pareto,
    },
  };
}
