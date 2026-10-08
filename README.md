# SahaIQ

**Open Sales Intelligence & Field CRM**

SahaIQ turns sales data into customer segments, risk signals and explainable next-best actions.

Built by **Uğurhan Horasanlı** as an open, vendor-neutral sales intelligence toolkit that works with any sales data source.

🌐 [sahaiq.app](https://sahaiq.app)

## What works today

- RFM customer scoring and segmentation
- Explainable rule-based action engine
- Sales decline and follow-up signals
- Live in-browser demo: 40 synthetic accounts, 12 months of history
- Prioritised "who to call today" list with the reason for every recommendation
- Import from anywhere, all in the browser (files never leave it):
  - Excel `.xlsx` (picks the sales sheet, skips report title rows, reads real date cells)
  - CSV / TSV (comma, semicolon or tab; Turkish `1.234,56` and `31.12.2026` formats)
  - Copy-paste from any ERP, BI or spreadsheet screen
  - Common ERP header vocabulary (Cari Kodu, Cari Hesap Ünvanı, Evrak Tarihi, Net Tutar, Stok Adı…) maps automatically; any other layout is mapped once and remembered in that browser
- Normalized customer/sales schema
- Morning briefing preview built only from computed results: who to call today, follow-ups and a summary, with varied, respectful openers and no prices, stock or campaign promises. A fail-closed briefing guard (`validateBriefingText`) matches complete generated facts in document/customer order, preserving number types, signs, scales, full dates and relationships. Only the deterministic document (apart from ASCII indentation, blank lines and CRLF) or one exact standalone customer/product reference is accepted; arbitrary AI paraphrases are not supported
- Fail-closed data checks (from the observer pilot): bad dates/numbers, one code with two names, broken CSV structure stop the analysis and are listed by line number; duplicates, blank amounts and returns are flagged, never silently changed; money is summed in kuruş; stale exports are labelled with their own date
- Connector foundation for external data sources
- Reference BI connector: Qlik Cloud (REST + QIX engine)
- Automated core, import and connector tests
- Secret-safe environment template

## Run locally

~~~bash
npm install
npm test
npm run dev
~~~

Open the local Next.js URL, then use **Kendi CSV'nizi yükleyin** for your own data.

Static demo build (no server needed, output in `out/`):

```
npm run build:static
```

Pushes to `main` deploy the static demo to GitHub Pages via `.github/workflows/pages.yml`.

## Data model

Required: `customer_id`, `customer_name`, `date`, `quantity`

Optional: `revenue`, `product`, `brand`, `region`

Numeric Excel amounts must be finite and fit in safe integer kuruş. They are
rounded to kuruş; changes larger than the floating-point tolerance produce a
visible warning with the number of affected cells and the first source row.
CSV, pasted text and Excel text cells still reject amounts with more than two
decimal places. Quantities must be safe integers and are never rounded.
Customer names and products must be single-line values without control
characters; invalid cells block the import and are reported by source row.

## Briefing validation boundary

`validateBriefingText(text, b)` requires the trusted result of `buildBriefing()`
as its reference. It does not recompute or authenticate analytics supplied in
`b` by another caller. Never replace the reference with AI-produced content.
Names and products are matched only in their original literal positions, never
globally stripped. Control, line-separator and invisible format/direction
characters are rejected independently of import validation. Dealer openers must
be exact, code-owned, numeric-free phrases; extra price, stock or campaign claims
fail even if the fixed disclaimer is still present. The legacy `unknown` array
now contains diagnostics for any unverifiable content, including nonnumeric
claims. The copy button is disabled after failed validation; its handler also
revalidates immediately before writing to the clipboard. Supporting other
rewrite formats requires a separate explicit contract.

## Data connectors

SahaIQ is source-agnostic: every connector maps its fields into the same vendor-neutral schema, so the CRM is not tied to any single company, database or BI tool.

- **CSV** – built-in import with configurable field mapping (works with Excel or ERP exports)
- **BI tools / REST APIs** – Qlik Cloud is included as a reference connector (`docs/QLIK.md`, `docs/QLIK-MAPPING.md`); the same mapping pattern can be extended to other BI platforms and REST data sources

Connector credentials always stay server-side. Configure runtime values in `.env.local` using `.env.example`.

The `/api/qlik` status endpoint is **off by default**. It only runs when `SAHAIQ_ENABLE_QLIK_CHECK=true` and a request carries `Authorization: Bearer <SAHAIQ_STATUS_TOKEN>` (at least 32 random characters). Only `*.qlikcloud.com` HTTPS tenants are accepted, and a success means "authentication and app metadata reachable" — it never verifies business data or permissions. The public static demo does not include this endpoint.

## Privacy & security

This public repository contains synthetic demo data only. Never commit production exports, database files, tenant URLs, API keys, OAuth secrets or customer information.

## Status

Public alpha. Core analytics and connector foundations are implemented; production deployments should validate their own authorization, persistence and data-governance requirements.

## Author

**Uğurhan Horasanlı**  
Sales intelligence, automation and applied AI projects.
