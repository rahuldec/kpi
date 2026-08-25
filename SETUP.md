# KPI Dashboard — Setup Guide

This document covers Zoho sign-in, email access control, and production deployment for the CS Team KPI portal.

**Production URL:** [https://odcskpi.vercel.app/](https://odcskpi.vercel.app/)

---

## 1. Zoho Setup

The dashboard uses a **client-based Zoho OAuth application** (browser-only, implicit flow). It is separate from any existing server-based Zoho backend — create a new client for this project only.

**Reference:** [Zoho client-based OAuth docs](https://www.zoho.com/accounts/protocol/oauth/js-apps/access-token.html)

### 1.1 Choose the right API Console (data centre)

| Organisation region | API Console | Accounts URL (for code) |
|---|---|---|
| India | [api-console.zoho.in](https://api-console.zoho.in/) | `https://accounts.zoho.in` |
| US | [api-console.zoho.com](https://api-console.zoho.com/) | `https://accounts.zoho.com` |
| EU | [api-console.zoho.eu](https://api-console.zoho.eu/) | `https://accounts.zoho.eu` |

Okie Dokie uses the **India** data centre → `accounts.zoho.in`.

### 1.2 Create the OAuth client

1. Sign in to [Zoho API Console](https://api-console.zoho.in/) with an organisation admin account.
2. **Add Client** → select **Client-based Application** (not Server-based or Self Client).
3. Name it e.g. `CS KPI Dashboard`.
4. Configure URLs for each environment you use (local + production can share one client):

#### Local development

| Zoho field | Value |
|---|---|
| Homepage URL | `http://localhost:3000/` |
| Authorized Redirect URI | `http://localhost:3000/` |
| JavaScript Domain | `http://localhost:3000` |

#### Production

| Zoho field | Value |
|---|---|
| Homepage URL | `https://odcskpi.vercel.app/` |
| Authorized Redirect URI | `https://odcskpi.vercel.app/` |
| JavaScript Domain | `https://odcskpi.vercel.app` |

**Rules:**

- Redirect URI must match the browser URL **exactly** (scheme, host, port, path, trailing slash).
- Use **`localhost`**, not `127.0.0.1`, in Zoho (the app normalises `127.0.0.1` → `localhost`, but Zoho must list `localhost`).
- JavaScript Domain includes `http://` or `https://` and has **no trailing slash**.
- There is **no Client Secret** for client-based apps — do not create or store one.

5. Save and copy the **Client ID** (format: `1000.XXXXXXXX…`).

### 1.3 Update the codebase

Edit `lib/zoho-auth.js`:

```javascript
const ZOHO = {
  clientId: '1000.XXXXXXXXXXXXXXXXXXXXXXXXXXXX',  // paste Client ID from Zoho
  accountsUrl: 'https://accounts.zoho.in',        // match your org data centre
  scopes: 'AaaServer.profile.READ',               // leave as-is (name + email)
  // redirectUri is computed automatically from the current page URL
};
```

| Setting | Where it comes from |
|---|---|
| `clientId` | Zoho API Console → Client ID |
| `accountsUrl` | Your org data centre (India = `https://accounts.zoho.in`) |
| `scopes` | Keep `AaaServer.profile.READ` |

**Disable auth for local QA:** set `clientId: ''`. Auth is also skipped on `kpi.test` or with `?noauth` in the URL.

### 1.4 How auth works in this project

- OAuth uses `response_type=token` (implicit flow) — required for Zoho client-based apps.
- After sign-in, the access token is stored in `localStorage` under `kpi.zoho.session`.
- Zoho profile is fetched via `/api/zoho-user` (server proxy) because Zoho blocks browser CORS on `/oauth/user/info`.
- No Zoho credentials belong in Vercel environment variables — only the public Client ID in `lib/zoho-auth.js`.

### 1.5 Common Zoho errors

| Error | Fix |
|---|---|
| **Invalid Client** | App type must be **Client-based Application** |
| **Redirect URI mismatch** | Redirect in Zoho must exactly match the URL in the browser address bar |
| **JavaScript domain error** | Set JavaScript Domain with protocol, no trailing slash |
| **Could not load profile (502)** | Check `/api/zoho-user` is deployed (Vercel Functions or local dev server) |

---

## 2. Email Setup

Access control is configured in `index.html` near the top of the main script block. All matching is **case-insensitive** on email.

### 2.1 Three lists — what each does

```javascript
const ALLOWED_EMAILS = [
  'user@okiedokiepay.com',
];

const VIEW_ALL_EMAILS = [
  'leadership@okiedokiepay.com',
];

const VIEWER_EMAIL_TO_NAME = {
  'user@okiedokiepay.com': 'Exact Name From Team Tab',
};
```

| List | Purpose |
|---|---|
| `ALLOWED_EMAILS` | **Login gate.** Only these Zoho emails can sign in. Everyone else stays on the login screen with *“Your account is not authorised to use this dashboard.”* |
| `VIEW_ALL_EMAILS` | **Full dashboard.** These users see all data — no pod scoping. |
| `VIEWER_EMAIL_TO_NAME` | **Roster name fix.** Maps a Zoho email to the exact spelling on the Team tab when the display name does not match. Used for pod-scoped users. |

### 2.2 User types

| Who | Config needed | What they see |
|---|---|---|
| Leadership / admins | `ALLOWED_EMAILS` + `VIEW_ALL_EMAILS` | Full dashboard |
| CS team member (pod-scoped) | `ALLOWED_EMAILS` + name on Team tab (or `VIEWER_EMAIL_TO_NAME`) | Only their RM’s pod |
| Not on any list | — | Blocked at login — dashboard never opens |

### 2.3 Adding a new user

1. Get their **exact Zoho account email** (after a test login, check DevTools → Application → Local Storage → `kpi.zoho.session` → `user.email`).
2. Add the email to `ALLOWED_EMAILS`.
3. Choose access level:
   - **Full access** → also add to `VIEW_ALL_EMAILS`.
   - **Pod-scoped** → ensure their name appears on the Team tab in the CS Team Plan sheet, or map them in `VIEWER_EMAIL_TO_NAME`.
4. Commit and deploy (production picks up changes on next Vercel deploy).

### 2.4 Login flow (what the user experiences)

1. User opens the portal → **Sign in with Zoho**.
2. Zoho OAuth completes → email checked against `ALLOWED_EMAILS`.
   - Not listed → returned to login screen (session cleared).
3. Listed → login screen shows *“Loading dashboard…”* while data loads.
4. Roster is built from the Team tab:
   - In `VIEW_ALL_EMAILS` → full dashboard opens.
   - On Team tab (or mapped in `VIEWER_EMAIL_TO_NAME`) → pod-scoped dashboard opens.
   - Not matched → returned to login with *“Your account is not set up on the CS team roster…”*

### 2.5 Test mode (bypasses all email checks)

Auth and email lists are skipped when:

- `clientId` is empty in `lib/zoho-auth.js`, or
- hostname is `kpi.test`, or
- URL contains `?noauth`

Use only for local QA — never in production.

---

## 3. Prod Setup

Production is hosted on **Vercel** at [https://odcskpi.vercel.app/](https://odcskpi.vercel.app/).

### 3.1 Pre-deploy checklist

- [ ] Zoho client has production URLs (see §1.2)
- [ ] `clientId` set in `lib/zoho-auth.js` (not empty)
- [ ] `accountsUrl` matches org data centre (`https://accounts.zoho.in`)
- [ ] `ALLOWED_EMAILS` populated in `index.html`
- [ ] `VIEW_ALL_EMAILS` / `VIEWER_EMAIL_TO_NAME` configured as needed
- [ ] Vercel environment variables set for sheet data (see §3.3)
- [ ] Google sheets shared: **Anyone with the link → Viewer**

### 3.2 Deploy to Vercel

```bash
git add .
git commit -m "Your change description"
git push origin main   # or your default branch
```

Vercel redeploys automatically on push. After changing **environment variables** in the Vercel dashboard, trigger a **Redeploy** manually.

**API routes** (no extra config needed):

| Route | Purpose |
|---|---|
| `/api/data` | Google Sheets / data proxy |
| `/api/zoho-user` | Zoho profile proxy (CORS workaround) |

### 3.3 Vercel environment variables

Set in **Vercel → Project → Settings → Environment Variables** (Production).

Zoho does **not** use Vercel env vars. These are for `api/data.js`:

| Variable | Purpose |
|---|---|
| `SHEET_ID` | Internal team calls tracker — spreadsheet ID |
| `SHEET_GID` | Internal tracker tab gid (optional; auto-discovered if empty) |
| `CLIENT_SHEET_ID` | Client calls tracker — spreadsheet ID |
| `CLIENT_SHEET_GID` | Client tracker tab gid (optional) |
| `ESC_SHEET_ID` | Escalations sheet ID |
| `ESC_SHEET_GID` | Escalations tab gid (optional) |
| `ADOPTION_SHEET_ID` | ERP module adoption workbook |
| `BOOK_CSV_URL` | Published CSV URL for client book |
| `FEEDBACK_CSV_URL` | Published CSV URL for client feedback form responses |
| `TEAM_CSV_URL` | Published CSV URL for Team tab (roster / pods) |
| `IMPLEMENTATION_CSV_URL` | Published CSV URL for implementation portfolio |
| `MOM_FEED_URL` | MOM Portal visits feed URL |
| `MOM_FEED_KEY` | Shared secret for visits feed (required for visits tab) |

Defaults exist in `api/data.js` for development. Override in Vercel for production control. See `.env.example` for a copy-paste template.

**Local dev:** copy `.env.example` to `.env.local` or `.env` and run:

```bash
node scripts/dev-server.js
# → http://localhost:3000/
```

### 3.4 Post-deploy verification

1. Open [https://odcskpi.vercel.app/](https://odcskpi.vercel.app/) in a **private/incognito** window.
2. Confirm the **Sign in with Zoho** screen appears (dashboard should not load without auth).
3. Sign in with an email in `ALLOWED_EMAILS` → dashboard loads after *“Loading dashboard…”*.
4. Sign in with an email **not** in `ALLOWED_EMAILS` → login error, no dashboard.
5. Spot-check API endpoints:
   - [https://odcskpi.vercel.app/api/data?src=internal](https://odcskpi.vercel.app/api/data?src=internal) → CSV response
   - [https://odcskpi.vercel.app/lib/zoho-auth.js](https://odcskpi.vercel.app/lib/zoho-auth.js) → contains your `clientId`

### 3.5 Local vs production

| | Local | Production |
|---|---|---|
| URL | `http://localhost:3000/` | `https://odcskpi.vercel.app/` |
| Run | `node scripts/dev-server.js` | Git push → Vercel |
| Zoho redirect | `http://localhost:3000/` | `https://odcskpi.vercel.app/` |
| Zoho JS domain | `http://localhost:3000` | `https://odcskpi.vercel.app` |
| Env vars | `.env.local` / `.env` | Vercel dashboard |
| Auth bypass | Empty `clientId` or `?noauth` | Never — keep `clientId` set |

### 3.6 Troubleshooting production

| Symptom | Likely cause | Fix |
|---|---|---|
| Dashboard loads without login | `clientId` empty in deployed `lib/zoho-auth.js` | Set Client ID and redeploy |
| Redirect URI mismatch | Zoho prod URL not registered | Add `https://odcskpi.vercel.app/` in Zoho |
| Not authorised (login) | Email missing from `ALLOWED_EMAILS` | Add email in `index.html`, redeploy |
| Not on CS roster (login) | Name not on Team tab | Add to Team tab or `VIEWER_EMAIL_TO_NAME` |
| Could not load the sheet | Sheet sharing or wrong env vars | Check Google sharing + Vercel env vars |
| Visits tab empty | `MOM_FEED_KEY` unset | Set in Vercel env vars |

---

## Quick reference

```
Zoho API Console                         →  lib/zoho-auth.js
─────────────────────────────────────────────────────────────
Client ID                                →  ZOHO.clientId
Data centre (India)                      →  ZOHO.accountsUrl
Redirect URI                             →  (automatic from browser URL)

Zoho user emails                         →  index.html
─────────────────────────────────────────────────────────────
Who can log in                           →  ALLOWED_EMAILS
Who sees full dashboard                  →  VIEW_ALL_EMAILS
Email → roster name                      →  VIEWER_EMAIL_TO_NAME

Sheet / data sources                     →  Vercel env vars (api/data.js)
─────────────────────────────────────────────────────────────
See .env.example for full variable list
```
