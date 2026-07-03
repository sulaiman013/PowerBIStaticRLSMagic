# PowerBI Static RLS Magic

**Embed one Power BI report and show every viewer only their own slice of the data, without giving a single viewer a Power BI license.**

This is a complete, working proof of concept of the Power BI **"embed for your customers" (app-owns-data)** pattern with **static Row-Level Security (RLS)**. A small web portal signs users in, and each one sees the same embedded report filtered to just their region. Users are plain app logins (no Azure AD, no Power BI license). The app authenticates to Power BI with a **service principal** and mints a per-user **embed token** that carries the right RLS role.

It runs on a free **PPU / trial embed token** setup (no dedicated capacity), so it also demonstrates **embed-token conservation**, which matters when the trial pool is finite.

Built on a fictional retailer, **TrailPeak Outfitters**, with a fully synthetic star-schema model. Nothing here is real customer data.

---

## The "magic" in one picture

```
  a@gmail.com ──┐                                    ┌── sees only  Mountain  region
  b@gmail.com ──┤   one report, one semantic model   ├── sees only  Pacific   region
  c@gmail.com ──┘   filtered per user by RLS role     └── sees only  Southwest region

  None of them is a Power BI user. None has a license.
  The app (via a service principal) vouches for each one and stamps an embed token
  with their region role. Power BI applies the role's filter to the whole star schema.
```

## How it works

```
browser (login)              portal server (Node/Express)                 Power BI
   |  POST /api/login  ─────────►  check user, map email -> RLS role, start session
   |  GET  /api/embed-config ───►  MSAL client-credentials ──────────────►  AAD token
   |                               GET report ───────────────────────────►  embedUrl
   |                               POST /GenerateToken with identity:
   |                                 { username, roles:[<region role>], datasets:[id] }
   |  ◄─── { embedToken, embedUrl, reportId }   (secret + AAD token stay server-side)
   |  powerbi.embed(...) with TokenType.Embed ──────────────────────────►  filtered report
```

Two tokens, never confused:
- **AAD token** = the app's badge into Power BI's API. Server-side only.
- **Embed token** = a short-lived keycard for one viewer, scoped to their RLS role. Safe to send to the browser.

Because the RLS is **static** (three named roles with fixed filters), the embed token depends only on the **role**, not the person. The filter lives on `dim_store[Region]`, and thanks to the star schema it cascades to every fact table and every visual automatically.

---

## What is in this repo

| Path | What it is |
|---|---|
| `Local Reporting portal/` | The Node/Express portal (the app). Start here. Has its own detailed README. |
| `Local Reporting portal/server.js` | Backend: login, embed-config, per-user embed-token cache, GenerateToken logging, token-usage |
| `Local Reporting portal/config.js` | Hardcoded demo users + the email -> RLS role map |
| `Local Reporting portal/add-rls-roles.js` | Admin tool: adds the 3 RLS roles to the **published** model in place via the Fabric getDefinition/updateDefinition API (no Desktop needed) |
| `Local Reporting portal/inspect-report.js` | Admin tool: dumps the published report's pages, canvas backgrounds, and resources |
| `Local Reporting portal/public/` | Login page + report page (powerbi-client) |
| `Report/` | The Power BI Project (PBIP): the semantic model (with the 3 RLS roles) and the report |
| `Report (DENEB VERSION).pbix` / `Report (HTML VERSION).pbix` | The report as PBIX, ready to open in Power BI Desktop |
| `data/` | The synthetic TrailPeak CSVs the model is built from |

Secrets are **not** in this repo. The service principal secret and all resource IDs live only in `Local Reporting portal/.env`, which is git-ignored. Copy `.env.example` to `.env` and fill in your own.

---

## Quick start

```bash
cd "Local Reporting portal"
cp .env.example .env          # then fill in your tenant/app/secret + workspace/report/dataset IDs
npm install
npm start                     # http://localhost:3000
```

Full setup (registering the service principal, the two tenant/workspace prerequisites, reading the IDs from powerbi.com, adding the RLS roles, and the 3-user acceptance test) is in **[`Local Reporting portal/README.md`](Local%20Reporting%20portal/README.md)**.

### The 3-user proof

Sign in as each user (`demo123`) and watch the same report change:

| User | Role | Sees |
|---|---|---|
| `a@gmail.com` | Mountain Region | only Mountain stores |
| `b@gmail.com` | Pacific Region | only Pacific stores |
| `c@gmail.com` | Southwest Region | only Southwest stores |

Reload any of them repeatedly and the token counter holds steady, that is the cache conserving your trial tokens.

---

## Prerequisites (once)

1. A service principal (Entra ID app registration; single tenant; no redirect URI; **no API permissions needed**).
2. Tenant setting **"Service principals can call Fabric public APIs"** enabled (org-wide or for a group containing the SP).
3. The SP added as **Member** or **Admin** of the workspace holding the report + model.
4. The semantic model must have the RLS roles. This repo's model already defines them; on a freshly published model you can add them in place with `node add-rls-roles.js --apply` (or in Power BI Desktop via Manage roles).

---

## Notes on scaling and cost

- No dedicated capacity means a **"Free trial version"** banner on the report and a finite monthly embed-token pool. Both are expected for a POC.
- To conserve trial tokens, tokens are cached per user and reused until ~5 minutes before expiry, and concurrent requests share one mint. For many users, keying the cache by **role** instead of by user makes token usage scale with the number of regions rather than the number of viewers (valid precisely because the RLS is static).
- For production, attach a small **A-SKU (Power BI Embedded, pausable) or F-SKU (Fabric)** capacity. That removes the token cap and the banner. PPU alone does not provide embed capacity.

## Security model

- The client secret and AAD tokens never leave the server; only the embed token (which is meant for the browser) crosses to the client.
- The RLS role is derived **server-side** from the authenticated session, never taken from the browser, so a user cannot request another region's data.
- `.env` and runtime logs are git-ignored; `.env.example` holds placeholders only.

---

*Synthetic data only (TrailPeak Outfitters). Companion to the code-first Power BI design work in [CodeFirstPowerBI](https://github.com/sulaiman013/CodeFirstPowerBI).*
