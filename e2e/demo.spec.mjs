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
  // Web fonts are answered empty so tests never depend on the network.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.goto("/");
});
test.afterEach(async ({}, info) => {
  expect(info.errors_, "konsol veya sayfa hatası").toEqual([]);
});

const kpis = (page) => page.locator(".kpi .v");
const chip = (page) => page.locator(".brief .verification");
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

test("no accessibility violations", async ({ page }) => {
  await expect(kpis(page).first()).toHaveText("40");
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
});

test("verified briefing opens in WhatsApp with the exact text and saves as .txt", async ({ page, context }) => {
  const expected = await page.locator(".brief-text").textContent();
  // The transfer to WhatsApp is disclosed next to the button before any click.
  const wa = page.getByRole("button", { name: "WhatsApp'ta aç" });
  await expect(wa).toHaveAttribute("aria-describedby", "wa-note");
  await expect(page.locator("#wa-note")).toBeVisible();
  await expect(page.locator("#wa-note")).toContainText("WhatsApp'a aktarılır");
  await expect(page.locator(".brief")).not.toContainText("hiçbir yere");
  // Don't load WhatsApp in tests; the URL is what matters.
  await context.route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, (route) => route.fulfill({ status: 200, body: "" }));
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("button", { name: "WhatsApp'ta aç" }).click(),
  ]);
  await popup.waitForURL(/wa\.me/);
  const url = new URL(popup.url());
  await popup.close();
  expect(url.hostname).toMatch(/(^|\.)wa\.me$|whatsapp\.com$/);
  expect(url.searchParams.get("text")).toBe(expected);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: ".txt indir" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^sahaiq-brifing-\d{4}-\d{2}-\d{2}\.txt$/);
});

test("demo names are visibly fictional and list counts are explained", async ({ page }) => {
  const names = await page.locator(".call-name").allTextContents();
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n).toMatch(/^Kurgu /);
  await expect(page.locator('section[aria-label="Arama listesi"] .sub')).toContainText("29 müşteri: 17 yüksek");
  await expect(page.locator(".brief-text")).toContainText("BUGÜN ARA · yüksek öncelik (ilk 5 / 17)");
  await expect(page.locator('footer a[href="mailto:info@sahaiq.app"]')).toBeVisible();
});


for (const width of [390, 1440]) {
  test(`route precedes summary and details, first decision fits the viewport (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await expect(page.locator('.call-name').first()).toHaveText('Kurgu Bulut Jant & Lastik');
    const first = page.locator('.call').first();
    await expect(first.locator('.call-reason')).toContainText('54 gündür sessiz');
    await expect(first.locator('.prio')).toHaveText('Yüksek öncelik');
    // Visibility alone includes content below the fold; measure the full decision.
    for (const selector of ['.call-name', '.call-reason', '.next']) {
      const box = await first.locator(selector).boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(844);
    }
    const order = await page.locator('main > section, main > .customer-details').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label') || n.id));
    expect(order).toEqual(['Arama listesi', 'Özet', 'Sabah brifingi önizlemesi', 'Veri kaynağı', 'detaylar']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`)).toEqual([]);
  });
}

test('all 29 call cards preserve the computed order, reasons and priority counts', async ({ page }) => {
  const { analyze } = await import('../lib/analyze.js');
  const { generateSampleRows } = await import('../lib/sample-data.js');
  const result = analyze(generateSampleRows());
  expect(result.asOf).toBe('2026-09-27');
  expect(result.kpis).toMatchObject({ accounts: 40, total: 53799175, atRiskValue: 20886617, paretoCount: 16, highPriority: 17 });
  expect(Math.round(result.kpis.atRiskShare * 1000) / 10).toBe(38.8);
  await expect(page.locator('.call')).toHaveCount(6);
  await page.getByRole('button', { name: 'Tümünü göster (29)' }).click();
  await expect(page.locator('.call')).toHaveCount(29);
  expect(await page.locator('.call-name').allTextContents()).toEqual(result.callList.map(c => c.customerName));
  for (const [index, call] of result.callList.entries()) {
    const card = page.locator('.call').nth(index);
    for (const reason of call.reasons) await expect(card).toContainText(reason.reason);
    await expect(card.locator('.next')).toContainText(call.reasons[0].nextAction);
  }
  await expect(page.locator('.prio.p3')).toHaveCount(17);
  await expect(page.locator('.prio.p2')).toHaveCount(6);
  await expect(page.locator('.prio.p1')).toHaveCount(6);
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map(v => v.id)).toEqual([]);
  await page.getByRole('button', { name: 'Daha az göster' }).click();
  await expect(page.locator('.call')).toHaveCount(6);
});

test('manual mapping is keyboard accessible, saved locally and reuses the same validation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const data = 'Kodum;Unvanim;Gun;Sayim;Bedelim\nK001;Kurgu Eşleme;27.09.2026;2;1.000,00';
  await upload(page, 'esleme.csv', 'text/csv', Buffer.from(data));
  await expect(page.getByRole('heading', { name: 'Sütunları eşleştirin' })).toBeVisible();
  await expect(page.locator('.import-flow')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Analiz et', exact: true })).toBeDisabled();
  for (const [id, value] of Object.entries({ customer_id: 'Kodum', customer_name: 'Unvanim', date: 'Gun', quantity: 'Sayim', revenue: 'Bedelim' })) {
    await page.locator(`#map-${id}`).selectOption(value);
  }
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map(v => v.id)).toEqual([]);
  const submit = page.getByRole('button', { name: 'Analiz et', exact: true });
  await submit.focus();
  await page.keyboard.press('Enter');
  await expect(kpis(page).first()).toHaveText('1');
  await expect(kpis(page).nth(1)).toHaveText('₺1.000');
  await expect(page.locator('.mapping')).toHaveCount(0);
  await expect(page.locator('#aramalar')).toBeFocused();
  // A reload keeps only the column mapping, never the imported customer rows.
  await page.reload();
  await expect(kpis(page).first()).toHaveText('40');
  await upload(page, 'esleme-tekrar.csv', 'text/csv', Buffer.from(data));
  await expect(kpis(page).first()).toHaveText('1');
  await expect(page.locator('.alert.warn')).toContainText('kayıtlı eşleştirme uygulandı');
  await page.getByRole('button', { name: 'Eşleştirmeyi değiştir' }).click();
  await expect(page.locator('#map-customer_id')).toHaveValue('Kodum');
  // An invalid shared column must still block replacement of the valid source.
  await page.locator('#map-quantity').selectOption('Kodum');
  await page.getByRole('button', { name: 'Analiz et', exact: true }).click();
  await expect(page.locator('.alert.err')).toContainText('Aynı sütun iki farklı alana seçilmiş');
  await expect(kpis(page).first()).toHaveText('1');
  const invalid = await new AxeBuilder({ page }).analyze();
  expect(invalid.violations.map(v => v.id)).toEqual([]);
});

test('segment toggles and name/code search combine without changing the call list', async ({ page }) => {
  const table = page.locator('#customer-table tbody tr');
  await expect(table).toHaveCount(40);
  const segment = page.getByRole('button', { name: 'Risk altında 9', exact: true });
  await segment.focus();
  await page.keyboard.press('Space');
  await expect(segment).toHaveAttribute('aria-pressed', 'true');
  await expect(table).toHaveCount(9);
  await page.getByRole('textbox', { name: 'Müşteri ara' }).fill('D016');
  await expect(table).toHaveCount(1);
  await expect(table).toContainText('Kurgu Bulut Jant & Lastik');
  await page.getByRole('textbox', { name: 'Müşteri ara' }).fill('eşleşmeyen-kurgu');
  await expect(table).toContainText('müşteri bulunamadı');
  await page.getByRole('textbox', { name: 'Müşteri ara' }).fill('');
  await segment.click();
  await expect(segment).toHaveAttribute('aria-pressed', 'false');
  await expect(table).toHaveCount(40);
  await expect(page.locator('.call-name').first()).toHaveText('Kurgu Bulut Jant & Lastik');
});

test('verified briefing is copied verbatim and demo can be restored after import', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const expected = await page.locator('.brief-text').textContent();
  await page.getByRole('button', { name: 'Metni kopyala' }).click();
  await expect(page.getByRole('button', { name: 'Kopyalandı', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  await upload(page, 'kurgu.csv', 'text/csv', Buffer.from(CSV));
  await expect(kpis(page).first()).toHaveText('3');
  await page.getByRole('button', { name: 'Demo veriye dön' }).click();
  await expect(kpis(page).first()).toHaveText('40');
  await expect(page.locator('.brief-text')).toHaveText(expected);
});


test('old imports show their source date and warning before the new call list', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-20T09:00:00Z'));
  await upload(page, 'kurgu-eski.csv', 'text/csv', Buffer.from(CSV));
  const calls = page.getByRole('region', { name: 'Arama listesi', exact: true });
  await expect(calls).toBeFocused();
  await expect(calls.locator('.sub').first()).toContainText('kurgu-eski.csv · Veri tarihi: 20 Eylül 2026');
  await expect(calls.locator('.alert.warn')).toContainText('Sonuçlar bugünü değil, o tarihi gösterir.');
  const warning = await calls.locator('.alert.warn').boundingBox();
  const firstCall = await calls.locator('.call').first().boundingBox();
  expect(warning.y + warning.height).toBeLessThan(firstCall.y);
});
