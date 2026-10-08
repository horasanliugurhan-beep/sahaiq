// Turkish number/date formatting shared by the dashboard and the briefing.
// Hand-rolled on purpose: Intl output differs between the build server and
// browsers, which breaks hydration and makes text checks unstable.

export const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

export function fmtInt(n) {
  const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return n < 0 && Math.round(n) !== 0 ? "-" + s : s;
}

// Compact for dashboards: ₺53,8 Mn / ₺812.400
export function fmtMoney(n) {
  if (Math.abs(n) >= 1e6) return "₺" + (n / 1e6).toFixed(1).replace(".", ",") + " Mn";
  return "₺" + fmtInt(n);
}

export function fmtDate(iso) {
  if (!iso) return "–";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function fmtRecency(days, { compact = false } = {}) {
  if (days === null || days === undefined) return "Alım yok";
  if (days === 0) return "bugün";
  return `${fmtInt(days)} gün${compact ? "" : " önce"}`;
}

export function fmtPct(p) {
  if (p === null || p === undefined) return "–";
  return `${p > 0 ? "+" : p < 0 ? "-" : ""}%${Math.abs(p)}`;
}
