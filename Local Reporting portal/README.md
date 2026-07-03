# Embedded Power BI Portal — App-Owns-Data + Static RLS (POC)

A minimal web portal that embeds one Power BI report and shows **each portal user only their row-level-security slice**, using the **"embed for your customers" (app-owns-data)** pattern. Portal users are not Azure AD identities and need no Power BI license. The app authenticates to Power BI with a **service principal** and generates a per-user **embed token** carrying a static RLS **role**.

- **Report**: `Report (DENEB VERSION)` in workspace `rayfin R&D - sulaiman`
- **RLS dimension**: `dim_store[Region]`, 3 static roles
- **Users**: `a@gmail.com` -> Mountain Region, `b@gmail.com` -> Pacific Region, `c@gmail.com` -> Southwest Region (password `demo123` for all)

---

## How it works

```
browser (login)                server (Node/Express)                    Power BI
   |  POST /api/login  ───────────►  validate hardcoded user, set session
   |  GET  /api/embed-config ─────►  MSAL client-credentials ──────────►  AAD token
   |                                 GET report ─────────────────────►   embedUrl
   |                                 POST /GenerateToken (identity:     ─►  embed token
   |                                   { username, roles:[<role>], datasets:[id] })
   |  ◄─── { embedToken, embedUrl, reportId }
   |  powerbi.embed(...) with TokenType.Embed ─────────────────────────►  filtered report
```

The **client secret and AAD token never leave the server.** Only the embed token (which is meant for the browser) is sent to the client.

**Token conservation:** free trial embed tokens are finite. The server caches each user's embed token in memory and reuses it until ~5 minutes before expiry, so repeated page loads by the same user do **not** mint new tokens. Every `GenerateToken` call is logged (console + `generate-token.log`) with a timestamp and the user, so you can count exactly how many trial tokens were burned.

---

## RLS roles: already applied to the published model

The 3 roles are **already live** on the published model. They were added in place via the Fabric `getDefinition`/`updateDefinition` API by the included admin script, no Desktop republish needed:

```bash
node add-rls-roles.js          # dry run: shows what it will change
node add-rls-roles.js --apply  # adds the 3 roles to the published model, then verifies
```

It is additive and idempotent (pulls the current published definition, adds only the role parts, pushes it back; tables, partitions, and imported data are untouched). Verified after apply: `isEffectiveIdentityRequired = true`, and all three roles mint filtered embed tokens.

To **change** the roles later, edit the `ROLES` array in `add-rls-roles.js` and re-run with `--apply` (also update the email->role map in `config.js`). Or do it in Desktop:

### Option A — Manage roles in Power BI Desktop (if you prefer the GUI)

1. Open the PBIX you published (`Report (DENEB VERSION).pbix`) in **Power BI Desktop**.
2. **Modeling** ribbon -> **Manage roles**.
3. Create these 3 roles (New -> name it -> pick table `dim_store` -> filter). If you use the DAX filter editor, the expressions are:

   | Role name (exact) | Table | Filter DAX |
   |---|---|---|
   | `Mountain Region` | `dim_store` | `[Region] = "Mountain"` |
   | `Pacific Region` | `dim_store` | `[Region] = "Pacific"` |
   | `Southwest Region` | `dim_store` | `[Region] = "Southwest"` |

4. **Save**.
5. **Home -> Publish** to `rayfin R&D - sulaiman`. When prompted, choose **Replace** the existing dataset/report.
   - Replacing preserves the same **report ID and dataset ID**, so `.env` stays valid. (If you publish as a new item instead, update `REPORT_ID`/`DATASET_ID` in `.env`.)

### Option B — publish the PBIP folder (roles already written in TMDL)

The sibling `..\Report\` PBIP already has the 3 roles added and validated (`definition/roles/*.tmdl`). Open `..\Report\Report.pbip` in Desktop and Publish -> Replace. Note this folder contains both the HTML and Deneb report pages, so it changes the published report layout; Option A is cleaner if you only want to add roles.

### Verify the roles are live (0 tokens)

After republishing, confirm the dataset now requires an effective identity (no embed token spent):

```powershell
# from this folder
node -e "require('dotenv').config();const{PBI}=require('./config');(async()=>{const msal=require('@azure/msal-node');const c=new msal.ConfidentialClientApplication({auth:{clientId:PBI.clientId,authority:'https://login.microsoftonline.com/'+PBI.tenantId,clientSecret:PBI.clientSecret}});const t=(await c.acquireTokenByClientCredential({scopes:[PBI.scope]})).accessToken;const r=await fetch(PBI.apiRoot+'/groups/'+PBI.workspaceId+'/datasets/'+PBI.datasetId,{headers:{Authorization:'Bearer '+t}});const d=await r.json();console.log('isEffectiveIdentityRequired =',d.isEffectiveIdentityRequired,'(expect true after roles are published)');})();"
```

---

## Run

```bash
npm install
npm start
```

Open **http://localhost:3000** and sign in.

---

## Acceptance test (the 3-user RLS proof)

1. Sign in as **`a@gmail.com` / `demo123`** -> the report shows only **Mountain** region data. The top bar shows role `Mountain Region`, the trial usage %, and `tokens burned: 1`.
2. Log out. Sign in as **`b@gmail.com`** -> only **Pacific** data. `tokens burned` increments to 2.
3. Log out. Sign in as **`c@gmail.com`** -> only **Southwest** data. `tokens burned` -> 3.
4. Reload any signed-in user's page a few times -> `tokens burned` does **not** increase (served from cache). This is the conservation guarantee.
5. Check consumption precisely in `generate-token.log` (one line per token) and in the server console.

**Success** = the same embedded report shows three different regional slices for the three users, and the token counter shows exactly how many trial tokens were spent (one per distinct user until each cached token nears expiry).

A **"Free trial version"** banner appears on the report because there is no dedicated capacity (PPU only). That is expected; do not try to remove it.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login` | validate `{email,password}`, create session |
| POST | `/api/logout` | destroy session |
| GET | `/api/me` | current session user + role |
| GET | `/api/embed-config` | cached embed token + embedUrl + reportId (mints only if needed) |
| GET | `/api/token-usage` | embedTrial state + usage % + this-process GenerateToken count |

---

## Troubleshooting

- **`...shouldn't have effective identity`** — the published dataset has no RLS roles yet. Do the one-time step above.
- **`role '...' was not found`** — a role name in `config.js` does not exactly match a role in the published model. Fix the name (case/spacing) on either side so they match.
- **401 on embed-config** — session expired or not logged in; sign in again.
- **`GenerateToken` fails with 403** — the SP lost its workspace role, or the tenant setting "Service principals can call Fabric public APIs" was disabled.
- **Report loads but shows all regions** — the embed token was generated without the identity (check the role mapping) or the roles filter the wrong table.
