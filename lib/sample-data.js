// Deterministic synthetic sales history for the public demo.
// Every name, brand, region and figure here is fictional.

export const SAMPLE_AS_OF = "2026-09-30";

function rng(seed) {
  // mulberry32
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PREFIXES = ["Kuzey", "Mavi", "Yıldız", "Anadolu", "Çınar", "Doruk", "Ege", "Poyraz", "Kartal", "Lodos", "Gökkuşağı", "Pusula", "Meltem", "Bereket", "Zirve", "Liman", "Ardıç", "Kervan", "Toros", "Sahil", "Ufuk", "Ilgaz", "Defne", "Rüzgar", "Atlas", "Kumru", "Nehir", "Çam", "Yayla", "Güneş", "Saray", "Akdeniz", "Bulut", "Elmas", "Fener", "Gelincik", "Hisar", "İnci", "Kaya", "Martı"];
const SUFFIXES = ["Oto Lastik", "Lastik Market", "Oto Servis", "Jant & Lastik", "Lastik Merkezi"];
const REGIONS = ["Kuzey", "Güney", "Doğu", "Batı", "Merkez"];
const PRODUCTS = [
  { name: "Yaz 205/55 R16", price: 3150 },
  { name: "Kış 225/45 R17", price: 4400 },
  { name: "4 Mevsim 195/65 R15", price: 2750 },
  { name: "SUV 235/55 R18", price: 5900 },
  { name: "Hafif Ticari 215/65 R16C", price: 4100 },
];
const BRANDS = ["Marka A", "Marka B", "Marka C"];

// [archetype, count]
const MIX = [
  ["champion", 6],
  ["loyal", 8],
  ["declining", 6],
  ["silent", 5],
  ["new", 5],
  ["standard", 6],
  ["dormant", 4],
];

const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

export function generateSampleRows(seed = 2026) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const between = (a, b) => a + r() * (b - a);
  const end = Date.parse(SAMPLE_AS_OF + "T00:00:00Z");
  const start = end - 364 * DAY;
  const rows = [];
  let n = 0;

  for (const [type, count] of MIX) {
    for (let k = 0; k < count; k++) {
      n++;
      const id = `D${String(n).padStart(3, "0")}`;
      const name = `${PREFIXES[(n * 7) % PREFIXES.length]} ${SUFFIXES[(n * 3) % SUFFIXES.length]}`;
      const region = REGIONS[n % REGIONS.length];
      const brand = pick(BRANDS);
      const size = between(0.7, 1.4);

      // Each archetype: when it buys, how often, how much.
      let t, stopAt, gap, qty;
      switch (type) {
        case "champion": t = start + between(0, 10) * DAY; stopAt = end - between(1, 9) * DAY; gap = () => between(10, 14); qty = () => between(30, 44); break;
        case "loyal": t = start + between(0, 25) * DAY; stopAt = end - between(5, 26) * DAY; gap = () => between(24, 32); qty = () => between(14, 22); break;
        case "declining": t = start + between(0, 15) * DAY; stopAt = end - between(10, 35) * DAY; gap = (tt) => (tt > end - 120 * DAY ? between(40, 55) : between(14, 24)); qty = (tt) => (tt > end - 120 * DAY ? between(7, 12) : between(24, 34)); break;
        case "silent": t = start + between(0, 15) * DAY; stopAt = end - between(110, 170) * DAY; gap = () => between(12, 22); qty = () => between(20, 30); break;
        case "new": t = end - between(45, 80) * DAY; stopAt = end - between(2, 12) * DAY; gap = () => between(20, 40); qty = () => between(10, 18); break;
        case "standard": t = start + between(0, 40) * DAY; stopAt = end - between(15, 50) * DAY; gap = () => between(45, 75); qty = () => between(8, 13); break;
        default: /* dormant */ t = start + between(0, 30) * DAY; stopAt = start + between(60, 140) * DAY; gap = () => between(35, 60); qty = () => between(4, 10);
      }

      while (t <= stopAt) {
        const lines = 1 + Math.floor(r() * 2);
        for (let l = 0; l < lines; l++) {
          const p = pick(PRODUCTS);
          const quantity = Math.max(1, Math.round((qty(t) * size) / lines));
          const unit = p.price * between(0.94, 1.06);
          rows.push({
            customer_id: id,
            customer_name: name,
            date: iso(t),
            quantity,
            revenue: Math.round(quantity * unit),
            product: p.name,
            brand,
            region,
          });
        }
        t += gap(t) * DAY;
      }
    }
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.customer_id.localeCompare(b.customer_id)));
}
