// Browser smoke tests against the static export (the same files GitHub Pages serves).
// Build first: `npm run build:static`, then `npm run test:e2e`.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:4173", locale: "tr-TR", timezoneId: "Europe/Istanbul" },
  webServer: { command: "node scripts/serve-static.mjs out", url: "http://127.0.0.1:4173", reuseExistingServer: !process.env.CI },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
