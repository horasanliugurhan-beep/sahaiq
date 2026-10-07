// Morning briefing built only from computed results.
//
// Design rules (learned from the retired n8n version):
// - Who to contact and every number come from code, never from a language model.
// - No offers, prices, stock or campaign promises: the sales file has no such data.
// - Openers are respectful and never confront the dealer with their own figures.
// - The data date is always shown; stale data is labelled as such.
// - validateBriefingText() rejects any text that contains a number not present
//   in the facts, so a future AI rewrite can be checked before it is sent.

import { SEGMENTS } from "./analyze.js";
import { fmtDate, fmtInt, fmtMoney, fmtPct } from "./format.js";

// Several phrasings per situation so a list of five does not read like a template.
const OPENERS = {
  "at-risk": [
    "Merhaba, uzun zamandır konuşamadık, her şey yolunda mı? Bu hafta uğrayıp önümüzdeki dönemin ihtiyaçlarını birlikte planlayalım mı?",
    "Merhaba, bir süredir sizden haber alamadık, merak ettim. Müsait olduğunuz bir gün kısa bir kahveye uğrayabilir miyim?",
    "Merhaba, son dönemde sizi pek göremedik. Ne lazımsa birlikte bakalım; bu hafta için uygun bir zamanınız var mı?",
  ],
  "sales-decline": [
    "Merhaba, son dönemde talebinizde bir değişiklik oldu mu? Size en uygun ürün ve stok planını konuşmak için kısa bir görüşme ayarlayalım mı?",
    "Merhaba, piyasada sizin tarafta durum nasıl? İhtiyaçlarınızı dinlemek için bu hafta uğramak isterim.",
  ],
  "champion-silent": [
    "Merhaba, yoğun bir dönemdesiniz sanırım. Önümüzdeki haftalar için stok ihtiyacınızı şimdiden birlikte konuşalım mı?",
    "Merhaba, her zamanki gibi yoğunsunuzdur. Sezon öncesi ihtiyaç listenizi birlikte çıkaralım mı?",
  ],
  "loyal-followup": [
    "Merhaba, uğramayalı biraz oldu. Bu hafta kısa bir ziyaret için müsait olduğunuz bir zaman var mı?",
    "Merhaba, bir çay içmeye uğrayayım diyorum; bu hafta hangi gün uygunsunuz?",
  ],
  "new-onboarding": [
    "Merhaba, ilk siparişleriniz nasıl gitti? Memnuniyetinizi ve eklemek istediğiniz ürünleri konuşmak isterim.",
    "Merhaba, birlikte çalışmaya başladığımız için memnunum. Her şey yolunda mı, eksik kalan bir şey var mı?",
  ],
  "dormant-winback": [
    "Merhaba, uzun süredir birlikte çalışamadık. Yeniden çalışmak için neler yapabileceğimizi konuşmak isterim.",
  ],
};
const opener = (ruleKey, i) => {
  const list = OPENERS[ruleKey];
  return list ? list[i % list.length] : null;
};

const money = (basis) => (basis === "revenue" ? (n) => fmtMoney(n) : (n) => `${fmtInt(n)} adet`);

function customerFacts(c, basis) {
  const m = money(basis);
  const facts = [`Son alım ${c.recency_days === 0 ? "bugün" : `${fmtInt(c.recency_days)} gün önce`} (${fmtDate(c.lastDate)})`];
  if (c.trend.pct !== null) facts.push(`Son 90 gün ${m(c.trend.recent)}, önceki 90 gün ${m(c.trend.previous)} (${fmtPct(c.trend.pct)})`);
  else facts.push(`Toplam ${m(c.monetary)}`);
  if (c.topProduct) facts.push(`En çok aldığı ürün: ${c.topProduct}`);
  return facts;
}

/**
 * @param result output of analyze()
 * @param opts.today YYYY-MM-DD (to label stale data); omit to skip the check
 * @param opts.maxToday how many high-priority customers to list (default 5)
 * @param opts.maxWeek how many medium-priority customers to list (default 5)
 */
export function buildBriefing(result, { today, maxToday = 5, maxWeek = 5 } = {}) {
  const byId = new Map(result.customers.map((c) => [c.id, c]));
  const m = money(result.basis);
  const ageDays = today && result.asOf ? Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(result.asOf + "T00:00:00Z")) / 86400000) : null;

  const counts = {};
  const entry = (a) => {
    const c = byId.get(a.customerId);
    const primary = a.reasons[0];
    return {
      customerId: a.customerId,
      name: a.customerName,
      segment: SEGMENTS[a.segmentKey]?.label || a.segmentKey,
      facts: customerFacts(c, result.basis),
      reason: primary.reason,
      // The trend is already in the facts; don't repeat it as a second reason.
      more: a.reasons.slice(1).filter((r) => r.ruleKey !== "sales-decline").map((r) => r.reason),
      next: primary.nextAction,
      opener: opener(primary.ruleKey, (counts[primary.ruleKey] = (counts[primary.ruleKey] ?? -1) + 1)),
      product: c.topProduct || "",
    };
  };

  const high = result.callList.filter((a) => a.priority === 3);
  const mid = result.callList.filter((a) => a.priority === 2);
  const today_ = high.slice(0, maxToday).map(entry);
  const week = mid.slice(0, maxWeek).map(entry);
  const k = result.kpis;
  const summary = [
    `${fmtInt(k.accounts)} müşteri analiz edildi`,
    `${fmtInt(k.highPriority)} müşteri yüksek öncelikli`,
    `Sessiz veya düşüşteki müşterilerin payı %${Math.round(k.atRiskShare * 100)} (${m(k.atRiskValue)})`,
  ];
  return {
    asOf: result.asOf,
    ageDays,
    stale: ageDays !== null && ageDays > 14,
    today: today_,
    todayMore: Math.max(0, high.length - today_.length),
    week,
    weekMore: Math.max(0, mid.length - week.length),
    summary,
  };
}

export function briefingToText(b) {
  const L = [];
  L.push(`🗓 SAHA BRİFİNGİ · veri tarihi ${fmtDate(b.asOf)}`);
  if (b.stale) L.push(`⚠️ Veri ${fmtInt(b.ageDays)} gün önceye ait; bugünün durumunu göstermez.`);
  L.push("");
  if (b.today.length) {
    L.push(`🔴 BUGÜN ARA (${b.today.length}${b.todayMore ? ` / toplam ${b.today.length + b.todayMore}` : ""})`);
    b.today.forEach((e, i) => {
      L.push(`${i + 1}) ${e.name} · ${e.segment}`);
      e.facts.forEach((f) => L.push(`   • ${f}`));
      L.push(`   • Neden: ${e.reason}`);
      if (e.more.length) L.push(`   • Ayrıca: ${e.more.join("; ")}`);
      L.push(`   → ${e.next}`);
      if (e.opener) L.push(`   💬 "${e.opener}"`);
      L.push("");
    });
  } else {
    L.push("🔴 Bugün acil aranacak müşteri yok.");
    L.push("");
  }
  if (b.week.length) {
    L.push(`🟡 HAFTA İÇİ TAKİP (${b.week.length}${b.weekMore ? ` / toplam ${b.week.length + b.weekMore}` : ""})`);
    b.week.forEach((e) => L.push(`• ${e.name}: ${e.reason} → ${e.next}`));
    L.push("");
  }
  L.push("📊 ÖZET");
  b.summary.forEach((s) => L.push(`• ${s}`));
  L.push("");
  L.push("Not: Rakamlar yüklenen satış verisinden hesaplandı. Fiyat, stok ve kampanya bilgisi içermez.");
  return L.join("\n");
}

// --- Number guard ---------------------------------------------------------

const NUM = /\d+(?:[.,]\d+)*/g;
const MONTH_RE = /^\s+(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\b/;

// A number is only "the same" if it is the same kind of number: "₺4" is not
// "4 gün", and "4'lü takım" is not the 4th of August.
function kindOf(text, start, end) {
  const before = text.slice(Math.max(0, start - 2), start);
  const after = text.slice(end, end + 12);
  if (/₺\s?$/.test(before)) return "money";
  if (/%$/.test(before)) return "pct";
  if (MONTH_RE.test(after)) return "date";
  if (/^\s*gün/.test(after)) return "days";
  if (/^\s*(adet|müşteri)/.test(after)) return "count";
  if (/^(\s*\/|\s*Mn)/.test(after)) return "other";
  return "other";
}

function numbersIn(text) {
  const s = String(text).replace(/^\s*\d+\)\s/gm, "  "); // list markers "1) " are not data
  const out = [];
  for (const m of s.matchAll(NUM)) {
    const raw = m[0].replace(/[.,]$/, "");
    out.push(`${kindOf(s, m.index, m.index + m[0].length)}:${raw}`);
  }
  return out;
}

// Everything a briefing is allowed to mention, as text.
function factStrings(b) {
  const out = [`veri tarihi ${fmtDate(b.asOf)}`, ...(b.summary || [])];
  if (b.stale) out.push(`Veri ${fmtInt(b.ageDays)} gün`);
  for (const n of [b.today.length, b.week.length, b.today.length + b.todayMore, b.week.length + b.weekMore]) out.push(`(${n})`);
  for (const e of [...b.today, ...b.week]) out.push(...e.facts, e.reason, ...e.more, e.next);
  out.push("90 gün");
  return out;
}

/**
 * Checks that every number in `text` also appears in the briefing's facts.
 * Customer and product names are removed first, since they can contain digits
 * (e.g. "205/55 R16"). Returns { ok, unknown: [numbers not backed by data] }.
 */
export function validateBriefingText(text, b) {
  let t = String(text);
  const literals = [...b.today, ...b.week].flatMap((e) => [e.name, e.product]).filter(Boolean).sort((x, y) => y.length - x.length);
  for (const lit of literals) t = t.split(lit).join(" ");
  const allowed = new Set(factStrings(b).flatMap((s) => {
    let x = s;
    for (const lit of literals) x = x.split(lit).join(" ");
    return numbersIn(x);
  }));
  const unknown = [...new Set(numbersIn(t).filter((n) => !allowed.has(n)))];
  return { ok: unknown.length === 0, unknown };
}
