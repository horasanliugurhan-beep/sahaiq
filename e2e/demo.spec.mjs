// Browser smoke tests: the demo must work for a stranger who clicks the link.
// Synthetic data only (AGENTS.md): every name below is fictional.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const CSV = [
  "Cari Kodu;Cari Ünvanı;Fatura Tarihi;Miktar;Net Tutar;Stok Adı",
  "K001;Kurgu Lastik Alfa;03.03.2026;4;12.400,50;Kurgu Ürün A",
  "K001;Kurgu Lastik Alfa;15.08.2026;2;6.100,00;Kurgu Ürün A",
  "K002;Kurgu Oto Beta;10.01.2026;8;20.000,00;Kurgu Ürün B",
  "K003;Kurgu Servis Gama;20.09.2026;1;3.250,75;Kurgu Ürün C",
].join("\n");

const TSV = CSV.replace(/;/g, "\t");

// Fail on any page error or console error, on every test.
test.beforeEach(async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  info.errors_ = errors;
  await page.goto("/");
});
test.afterEach(async ({}, info) => {
  expect(info.errors_, "konsol veya sayfa hatası").toEqual([]);
});

const kpis = (page) => page.locator(".kpi .v");
const chip = (page) => page.locator(".brief .chip");
const upload = (page, name, mimeType, buffer) => page.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer });

test("demo loads with the fictional dataset and a verified briefing", async ({ page }) => {
  await expect(kpis(page).first()).toHaveText("40");
  await expect(kpis(page).nth(1)).toHaveText("₺53,8 Mn");
  await expect(chip(page)).toHaveText("✓ Tüm rakamlar veriden");
  await expect(page.getByRole("button", { name: "Metni kopyala" })).toBeEnabled();
});

test("CSV upload is analysed in the browser", async ({ page }) => {
  await upload(page, "kurgu.csv", "text/csv", Buffer.from(CSV));
  await expect(page.locator(".source .meta")).toContainText("kurgu.csv");
  await expect(kpis(page).first()).toHaveText("3");
  await expect(chip(page)).toHaveText("✓ Tüm rakamlar veriden");
  await expect(page.locator(".alert.err")).toHaveCount(0);
});

test("pasted table from Excel/ERP is analysed", async ({ page }) => {
  await page.getByRole("button", { name: "Excel'den yapıştır" }).click();
  await page.locator("textarea.paste").fill(TSV);
  await page.getByRole("button", { name: "Analiz et" }).click();
  await expect(page.locator(".source .meta")).toContainText("Yapıştırılan tablo");
  await expect(kpis(page).first()).toHaveText("3");
});

test("Excel workbook is read, with a rounding warning", async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles("test/fixtures/e2e-kurgu.xlsx");
  await expect(page.locator(".source .meta")).toContainText("e2e-kurgu.xlsx");
  await expect(kpis(page).first()).toHaveText("4");
  await expect(page.locator(".alert.warn")).toContainText("kuruşa yuvarlandı");
});

test("bad rows block the analysis and are shown with row numbers", async ({ page }) => {
  const bad = CSV + "\nK004;Kurgu​Delta;bozuk;1;(-10);Kurgu Ürün D";
  await upload(page, "hatali.csv", "text/csv", Buffer.from(bad));
  const err = page.locator(".alert.err");
  await expect(err).toContainText("Satır 6");
  // The demo stays on screen; nothing from the bad file is analysed.
  await expect(kpis(page).first()).toHaveText("40");
});

test("sortable headers work from the keyboard", async ({ page }) => {
  const header = page.locator("th .sort").first();
  const th = page.locator("th[aria-sort]").first();
  const before = await th.getAttribute("aria-sort");
  await header.focus();
  await expect(header).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(th).not.toHaveAttribute("aria-sort", before ?? "");
});

test("no horizontal overflow at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(kpis(page).first()).toHaveText("40");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("no critical or serious accessibility violations", async ({ page }) => {
  await expect(kpis(page).first()).toHaveText("40");
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations.filter((v) => ["critical", "serious"].includes(v.impact));
  expect(blocking.map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
});
