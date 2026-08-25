# KPI Platform

A business-performance dashboard that combines operational data into actionable team and client metrics.

## What it does

The KPI platform brings data from multiple operational sources together so teams can monitor performance, ERP adoption, implementation health and compliance from one place.

### Core capabilities

- 📊 KPI and team performance tracking
- 🏫 ERP adoption and usage measurement
- 👥 Team and client-level reporting
- ✅ Compliance and implementation monitoring
- 🔄 External data ingestion and reconciliation
- 🧹 Defensive handling of malformed and duplicate data
- 🧪 Automated QA and regression testing
- 🌍 Timezone-aware validation

## Engineering focus

A major goal of this project is **data reliability**. Real business data is rarely clean, so the application is designed to handle missing fields, malformed rows, duplicate records, conflicting ownership and fallback scenarios instead of assuming perfect input.

Testing is used to verify both normal workflows and edge cases before changes reach production.

## Tech Stack

- **Frontend:** Plain HTML / JavaScript (no build step)
- **Auth:** Zoho client-based OAuth (implicit flow, browser-only)
- **Data:** Google Sheets / external business data via Vercel serverless proxy
- **Tooling:** Git, GitHub, jsdom QA suite

## Setup

See **[SETUP.md](./SETUP.md)** for full instructions:

1. **Zoho Setup** — API Console, Client ID, redirect URIs
2. **Email Setup** — `ALLOWED_EMAILS`, `VIEW_ALL_EMAILS`, pod scoping
3. **Prod Setup** — Vercel deploy, env vars, verification for [odcskpi.vercel.app](https://odcskpi.vercel.app/)

## Project status

🚧 Actively developed.

## Author

**Rahul Sharma** — Product Developer & Automation Builder

[GitHub](https://github.com/rahuldec) · [LinkedIn](https://www.linkedin.com/in/rahul-sharma-03200626)
