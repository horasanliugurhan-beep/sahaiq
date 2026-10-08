// Morning briefing built only from computed results.
//
// Design rules (learned from the retired n8n version):
// - Who to contact and every number come from code, never from a language model.
// - No offers, prices, stock or campaign promises: the sales file has no such data.
// - Openers are respectful and never confront the dealer with their own figures.
// - The data date is always shown; stale data is labelled as such.
// - validateBriefingText() binds complete generated facts to their document and
//   customer positions. Free-form AI rewrites are not an accepted input format.

import { SEGMENTS } from "./analyze.js";
import { UNSAFE_LINE_CHARACTER } from "./text-safety.js";
import { fmtDate, fmtInt, fmtMoney, fmtPct, fmtRecency } from "./format.js";

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
  const facts = [c.hasPurchase === false ? "Yüklenen veride pozitif alım yok" : `Son alım ${fmtRecency(c.recency_days)} (${fmtDate(c.lastDate)})`];
  const window = c.trend.windowDays ?? 90;
  if (c.trend.pct !== null) facts.push(`Son ${window} gün ${m(c.trend.recent)}, önceki ${window} gün ${m(c.trend.previous)} (${fmtPct(c.trend.pct)})`);
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
    L.push(`🔴 BUGÜN ARA · yüksek öncelik (${b.todayMore ? `ilk ${b.today.length} / ${b.today.length + b.todayMore}` : b.today.length})`);
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
    L.push(`🟡 HAFTA İÇİ TAKİP · orta öncelik (${b.weekMore ? `ilk ${b.week.length} / ${b.week.length + b.weekMore}` : b.week.length})`);
    b.week.forEach((e) => L.push(`• ${e.name}: ${e.reason} → ${e.next}`));
    L.push("");
  }
  L.push("📊 ÖZET");
  b.summary.forEach((s) => L.push(`• ${s}`));
  L.push("");
  L.push("Not: Rakamlar yüklenen satış verisinden hesaplandı. Fiyat, stok ve kampanya bilgisi içermez.");
  return L.join("\n");
}

// --- Briefing guard -------------------------------------------------------

// Imported literals are data, never extra document structure. Check them here
// even if a caller bypasses the importer. Do not normalize these characters away.
const APPROVED_OPENERS = new Set(Object.values(OPENERS).flat());
const singleLine = (value) => typeof value === "string" && !UNSAFE_LINE_CHARACTER.test(value);
const lines = (value) => Array.isArray(value) && Array.from(value).every(singleLine);
const count = (value) => Number.isSafeInteger(value) && value >= 0;

function validReference(b) {
  if (!b || typeof b !== "object" || !Array.isArray(b.today) || !Array.isArray(b.week)) return false;
  if (!(b.asOf === null || (singleLine(b.asOf) && /^\d{4}-\d{2}-\d{2}$/.test(b.asOf)))) return false;
  if (!(b.ageDays === null || Number.isSafeInteger(b.ageDays)) || typeof b.stale !== "boolean") return false;
  if (b.stale && b.ageDays === null) return false;
  if (!count(b.todayMore) || !count(b.weekMore) || !lines(b.summary) || !b.summary.length) return false;
  return [...b.today, ...b.week].every((e) => e &&
    singleLine(e.name) && e.name.trim().length > 0 && singleLine(e.product) &&
    singleLine(e.segment) && e.segment.length > 0 &&
    lines(e.facts) && e.facts.length > 0 && singleLine(e.reason) &&
    lines(e.more) && singleLine(e.next) &&
    // A numeric-free promise is still unsafe: only the code-owned openers may
    // reach the dealer. This check is independent of the candidate comparison.
    (e.opener === null || (singleLine(e.opener) && !/\p{N}/u.test(e.opener) && APPROVED_OPENERS.has(e.opener)))
  );
}

// Only presentation-level changes are ignored: CRLF, ASCII indentation and
// blank lines. Never trim/normalize Unicode or alter an internal literal/fact.
function documentLines(text) {
  const out = [];
  for (const [i, raw] of text.replace(/\r\n/g, "\n").split("\n").entries()) {
    const value = raw.replace(/^[ \t]+/, "");
    if (UNSAFE_LINE_CHARACTER.test(value)) return null;
    if (value) out.push({ value, row: i + 1 });
  }
  return out;
}

/**
 * Validate against the trusted, code-computed output of buildBriefing(). `b`
 * must not come from an AI rewrite or another untrusted producer: this guard
 * does not independently recompute analytics or authenticate caller-made facts.
 *
 * Accepted formats: the complete generated document, or one exact standalone
 * "customer: product" source reference for compatibility. The latter is never
 * an appendable exemption within a document. Arbitrary paraphrases fail closed.
 * Matching complete lines in their original positions preserves sign, scale,
 * type, full dates, relations and customer ownership, including list headers.
 * Literal names/products are not removed or interpreted as numeric evidence.
 *
 * The existing { ok, unknown } result is retained; unknown contains diagnostics
 * for unverifiable content, which can be nonnumeric (e.g. a stock promise).
 */
export function validateBriefingText(text, b) {
  const reject = (message) => ({ ok: false, unknown: [message] });
  if (typeof text !== "string") return reject("Metin biçimi geçersiz");
  if (!validReference(b)) return reject("Brifing kaynağı veya metin alanı geçersiz");
  const actual = documentLines(text);
  if (!actual) return reject("Metinde kontrol veya görünmez yönlendirme karakteri var");
  if (!actual.length) return reject("Brifing metni boş");

  if (actual.length === 1 && [...b.today, ...b.week].some((e) =>
    e.product && actual[0].value === `${e.name}: ${e.product}`
  )) return { ok: true, unknown: [] };

  const expected = documentLines(briefingToText(b));
  for (let i = 0; i < Math.max(actual.length, expected.length); i++) {
    if (actual[i]?.value !== expected[i]?.value) {
      return reject(actual[i] ? `Satır ${actual[i].row}: üretilen brifingle eşleşmiyor` : "Brifing metni eksik");
    }
  }
  return { ok: true, unknown: [] };
}
