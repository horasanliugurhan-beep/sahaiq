// Deterministic, explainable rules: every recommendation carries the reason it fired.

export const PRIORITY = { HIGH: 3, MEDIUM: 2, LOW: 1 };
export const CATEGORY = { RETENTION: "retention", RECOVERY: "recovery", OPPORTUNITY: "opportunity", MAINTENANCE: "maintenance", GROWTH: "growth" };

// Days without contact after which each segment should be followed up.
const SLA = { champion: 14, loyal: 30, at_risk: 7, new: 14, standard: 60 };

const action = (ctx, x) => ({
  ...x,
  customerId: ctx.customer.id,
  customerName: ctx.customer.name,
  segmentKey: ctx.rfm.segment_key,
  monetary: ctx.rfm.monetary ?? 0,
  lastContactDays: ctx.lastContactDays ?? null,
});

function champion(ctx) {
  if (ctx.rfm.segment_key !== "champion" || (ctx.lastContactDays ?? 9999) <= SLA.champion) return null;
  return action(ctx, {
    ruleKey: "champion-silent",
    priority: PRIORITY.HIGH,
    category: CATEGORY.RETENTION,
    reason: `En değerli müşterilerden biri ${ctx.lastContactDays} gündür sipariş vermedi`,
    nextAction: "Arayın, son talebi ve stok ihtiyacını konuşun.",
  });
}

function risk(ctx) {
  if (ctx.rfm.segment_key !== "at_risk") return null;
  return action(ctx, {
    ruleKey: "at-risk",
    priority: PRIORITY.HIGH,
    category: CATEGORY.RECOVERY,
    reason: `Eskiden düzenli alan müşteri ${ctx.rfm.recency_days} gündür sessiz`,
    nextAction: "Kaybedilen talebi araştırın, geri kazanım görüşmesi planlayın.",
  });
}

function decline(ctx) {
  if (!ctx.trend?.isDropping) return null;
  const pct = Math.abs(ctx.trend.pct);
  // A fully silent window is already explained by the at-risk / dormant rules.
  if (pct >= 100 && ["at_risk", "dormant"].includes(ctx.rfm.segment_key)) return null;
  return action(ctx, {
    ruleKey: "sales-decline",
    priority: PRIORITY.HIGH,
    category: CATEGORY.OPPORTUNITY,
    reason: pct >= 100 ? "Son 90 günde hiç alım yok (önceki 90 günde alım vardı)" : `Son 90 günde alım önceki 90 güne göre %${pct} düştü`,
    nextAction: "Fiyat, stok, rakip ve talep değişimini kontrol edin.",
  });
}

function loyal(ctx) {
  if (ctx.rfm.segment_key !== "loyal" || (ctx.lastContactDays ?? 9999) <= SLA.loyal) return null;
  return action(ctx, {
    ruleKey: "loyal-followup",
    priority: PRIORITY.MEDIUM,
    category: CATEGORY.MAINTENANCE,
    reason: `Sadık müşteri ${ctx.lastContactDays} gündür alım yapmadı (hedef: ${SLA.loyal} gün)`,
    nextAction: "Rutin takip ziyareti veya araması planlayın.",
  });
}

function newCustomer(ctx) {
  if (ctx.rfm.segment_key !== "new") return null;
  return action(ctx, {
    ruleKey: "new-onboarding",
    priority: PRIORITY.MEDIUM,
    category: CATEGORY.GROWTH,
    reason: "Yeni müşteri: ilk alımlar yapıldı, ilişki henüz oturmadı",
    nextAction: "Memnuniyeti sorun, ürün yelpazesini genişletmeyi önerin.",
  });
}

function dormant(ctx) {
  if (ctx.rfm.segment_key !== "dormant") return null;
  return action(ctx, {
    ruleKey: "dormant-winback",
    priority: PRIORITY.LOW,
    category: CATEGORY.RECOVERY,
    reason: `Uzun süredir pasif (${ctx.rfm.recency_days} gün)`,
    nextAction: "Düşük maliyetli bir geri kazanım teklifiyle yoklayın.",
  });
}

export const RULES = [champion, risk, decline, loyal, newCustomer, dormant];

export function evaluateRules(ctx) {
  return RULES.map((r) => r(ctx)).filter(Boolean);
}

export function sortActions(xs) {
  return [...xs].sort(
    (a, b) => b.priority - a.priority || (b.monetary ?? 0) - (a.monetary ?? 0) || String(a.customerName).localeCompare(String(b.customerName), "tr")
  );
}

// One entry per customer: highest priority first, all reasons kept.
export function groupByCustomer(actions) {
  const map = new Map();
  for (const a of sortActions(actions)) {
    if (!map.has(a.customerId)) map.set(a.customerId, { ...a, reasons: [] });
    map.get(a.customerId).reasons.push({ ruleKey: a.ruleKey, reason: a.reason, nextAction: a.nextAction });
  }
  return [...map.values()];
}
