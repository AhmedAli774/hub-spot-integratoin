# Wix ↔ HubSpot Integration

[![Wix](https://img.shields.io/badge/Wix-CLI-blue)](https://dev.wix.com/)
[![HubSpot](https://img.shields.io/badge/HubSpot-CRM-orange)](https://developers.hubspot.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)]()

A production-ready Wix CLI app that provides **bi-directional contact sync** between Wix CRM and HubSpot, **UTM attribution tracking** on form submissions, and a full dashboard UI for managing connections, field mappings, and leads.

---

## 📋 Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Quick Start (Step-by-Step)](#quick-start-step-by-step)
4. [How to Update Forms](#how-to-update-forms)
5. [API Plan](#api-plan)
6. [How It Works](#how-it-works)
7. [Project Structure](#project-structure)
8. [Environment Variables](#environment-variables)
9. [Setup Guide](#setup-guide)
10. [Deliverables](#deliverables)

---

## ✨ Features

### Feature #1 — Reliable Bi-Directional Contact Sync
- ✅ **New contact creation** — Wix → HubSpot and HubSpot → Wix
- ✅ **Contact updates** — Changes sync both ways automatically
- ✅ **User-configurable field mapping** — Map any Wix field to any HubSpot property via dashboard UI
- ✅ **Conflict resolution** — "Last updated wins" using timestamps
- ✅ **Infinite loop prevention** — 60-second dedup window + source tracking
- ✅ **External ID mapping** — Persistent WixContactId ↔ HubSpotContactId storage

### Feature #2 — Form & Lead Capture with Attribution
- ✅ **Wix form UI** → HubSpot contact creation/update
- ✅ **UTM tracking** — `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
- ✅ **Page URL & Referrer** captured automatically
- ✅ **Timestamp** stored in HubSpot
- ✅ **Company field** support
- ✅ **Lead list** — View all HubSpot contacts in dashboard
- ✅ **Edit leads** — Modify contacts directly from dashboard (updates HubSpot instantly)

### Security & Connection
- ✅ **OAuth 2.0** — Secure HubSpot connection (no API keys in frontend)
- ✅ **Auto token refresh** — Refreshes access token before expiry
- ✅ **Least privilege scopes** — Only `contacts.read/write + schemas.read`
- ✅ **Secure storage** — Tokens stored via Wix Data (elevated permissions)
- ✅ **Connect/Disconnect** — One-click from dashboard

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Wix Dashboard (React)                     │
│  ┌─────────┐ ┌─────────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Connect │ │Field Mapping│ │Lead Capture│ │  Leads List  │ │
│  │  Tab    │ │    Tab      │ │   Tab      │ │    Tab       │ │
│  └────┬────┘ └──────┬──────┘ └─────┬────┘ └──────┬───────┘ │
└───────┼─────────────┼──────────────┼─────────────┼─────────┘
        │             │              │             │
        └─────────────┴──────────────┴─────────────┘
                          │
                    ┌─────┴─────┐
                    │  Dev API  │  ← Astro API Routes (Production)
                    │  Server   │  ← scripts/api-dev-server.mjs (Dev)
                    │  :4321    │
                    └─────┬─────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
   ┌────┴────┐      ┌────┴────┐      ┌────┴────┐
   │ HubSpot │      │  Wix    │      │  File   │
   │  CRM    │      │  Data   │      │  Store  │
   │  API    │      │Collections│     │ (Dev)   │
   └─────────┘      └─────────┘      └─────────┘
```

| Layer | Technology | Purpose |
|---|---|---|
| Dashboard UI | React 16 + TypeScript + Wix Design System | Tabbed interface for all features |
| Backend API | Astro API Routes / Node HTTP Server | OAuth, webhooks, sync, forms |
| Sync Engine | Node.js ES Modules | Bidirectional sync with conflict handling |
| Data Storage | Wix Data Collections (`@wix/data`) | Tokens, ID mappings, sync logs |
| Dev Tunnel | ngrok | Public URL for local development |

---

## 🚀 Quick Start (Step-by-Step)

### Prerequisites
- Node.js 18+ installed
- Wix developer account
- HubSpot developer account with OAuth app
- ngrok account (free tier works)

---

### Step 1: Install ngrok

**Windows (PowerShell):**
```powershell
# Download and install ngrok
choco install ngrok
# OR download from https://ngrok.com/download

# Add your auth token (get from https://dashboard.ngrok.com)
ngrok config add-authtoken YOUR_NGROK_AUTH_TOKEN
```

**Verify installation:**
```powershell
ngrok version
# Should show: ngrok version 3.x.x
```

---

### Step 2: Clone & Install

```bash
git clone <repo-url>
cd hub-spot-integration
npm install
```

---

### Step 3: Configure Environment

Create `.env` file in the root folder (`hub-spot-integration/.env`):

```env
HUBSPOT_CLIENT_ID=your-hubspot-client-id
HUBSPOT_CLIENT_SECRET=your-hubspot-client-secret
HUBSPOT_REDIRECT_URI=https://your-ngrok-domain.ngrok-free.dev/api/auth/callback
PUBLIC_API_BASE=https://your-ngrok-domain.ngrok-free.dev
HUBSPOT_APP_ID=your-hubspot-app-id
```

> **Note:** Replace `your-ngrok-domain` with your actual ngrok static domain (e.g., `quilt-irregular-squabble.ngrok-free.dev`)

---

### Step 4: Start Development Server

Open **PowerShell** in the project root folder and run:

```powershell
.\scripts\start-dev.ps1
```

---

### Step 5: What Happens After You Run the Command?

When you run `.\scripts\start-dev.ps1`, **3 PowerShell windows** will open automatically:

| Window | What It Runs | Port | Purpose |
|--------|-------------|------|---------|
| **Window 1** | API Server (`api-dev-server.mjs`) | `:4321` | Backend API routes (OAuth, webhooks, sync) |
| **Window 2** | Dev Proxy (`dev-proxy.mjs`) | `:5175` | Unifies Vite + Astro into one port |
| **Window 3** | Wix CLI (`npm run dev`) | `:5173` | Dashboard UI development server |

**Plus:** ngrok starts in the background and creates a public URL like:
```
https://your-domain.ngrok-free.dev → localhost:5175
```

**You will see this in your main PowerShell window:**
```
============================================
  NGROK TUNNEL IS LIVE
============================================

  Public URL : https://your-domain.ngrok-free.dev
  Proxy      : http://127.0.0.1:5175
  ngrok UI   : http://127.0.0.1:4040

  -- .env values (already set) --
  PUBLIC_API_BASE=https://your-domain.ngrok-free.dev
  HUBSPOT_REDIRECT_URI=https://your-domain.ngrok-free.dev/api/auth/callback
```

---

### Step 6: Open Wix Dashboard

1. In the **Wix CLI window** (Window 3), you will see:
```
Current Dev Site: Dev Sitex1134354643 (Press C to switch)

Press a number key to open a dashboard page:
  ›  1 - HubSpot Integration (/)
```

2. **Press `1`** on your keyboard

3. This will open your browser at:
```
https://manage.wix.com/dashboard/.../app/...
```

4. You will see the **HubSpot Integration** app inside your Wix dashboard:

```
┌─────────────────────────────────────────┐
│  Wix Dashboard                          │
│  ┌─────────────────────────────────┐    │
│  │  HubSpot Integration App        │    │
│  │  ┌─────┬─────────┬───────────┐  │    │
│  │  │Connect│ Mapping │ Sync │ Leads│  │    │
│  │  └─────┴─────────┴───────────┘  │    │
│  │                                  │    │
│  │  [Connect HubSpot] Button        │    │
│  │                                  │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

---

### Step 7: Connect HubSpot

1. Click on the **"Connect HubSpot"** button
2. A popup will open asking you to login to HubSpot
3. Authorize the app
4. You will see ✅ **"Connected"** status

---

## 📝 How to Update Forms

### Where Are the Forms?

The **Lead Capture Form** is located at:
```
src/dashboard/form/LeadCaptureForm.tsx
```

### How to Edit the Form

1. **Open the file:**
   ```
   src/dashboard/form/LeadCaptureForm.tsx
   ```

2. **Find the form fields** (around the middle of the file):
   ```tsx
   <FormField label="First Name" required>
     <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
   </FormField>
   ```

3. **Add a new field** (example - adding "Job Title"):
   ```tsx
   // Add state at the top
   const [jobTitle, setJobTitle] = useState('');
   
   // Add form field in the JSX
   <FormField label="Job Title">
     <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
   </FormField>
   
   // Include in the submit handler
   body: JSON.stringify({
     firstName,
     lastName,
     email,
     phone,
     company,
     jobTitle,  // ← Add this
     utmParams,
   })
   ```

4. **Update the API handler** to receive the new field:
   ```
   src/pages/api/forms/submit.ts
   ```
   
   Add the new field to the HubSpot properties:
   ```typescript
   properties: {
     firstname: data.firstName,
     lastname: data.lastName,
     email: data.email,
     phone: data.phone,
     company: data.company,
     jobtitle: data.jobTitle,  // ← Add this
     ...
   }
   ```

5. **Save the files** — The Wix CLI (Window 3) will automatically reload the dashboard!

### All Form-Related Files

| File | Purpose |
|------|---------|
| `src/dashboard/form/LeadCaptureForm.tsx` | Frontend form UI (what users see) |
| `src/pages/api/forms/submit.ts` | Backend API that receives form data |
| `src/backend/forms/form-handler.ts` | Logic to create/update HubSpot contact |

### Dashboard Tabs Location

All dashboard pages are in:
```
src/dashboard/
├── pages/page.tsx              ← Main tabbed layout
├── connect/ConnectPage.tsx     ← "Connect" tab content
├── mapping/FieldMappingTable.tsx ← "Field Mapping" tab
├── status/SyncStatus.tsx       ← "Sync Status" tab
├── form/LeadCaptureForm.tsx    ← "Lead Capture" tab
└── leads/LeadList.tsx          ← "Leads" tab
```

**To add a new tab:**
1. Create a new component file (e.g., `src/dashboard/analytics/AnalyticsPage.tsx`)
2. Add the tab in `src/dashboard/pages/page.tsx`
3. The new tab will automatically appear in the dashboard

---

## 📡 API Plan

### Authentication APIs

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/connect` | GET | Returns HubSpot OAuth URL |
| `/api/auth/callback` | GET | Exchanges OAuth code for tokens |
| `/api/auth/status` | GET | Returns `{ connected, expiresAt }` |
| `/api/auth/disconnect` | POST | Revokes tokens + cleans up |

**HubSpot APIs:**
- `POST /oauth/v1/token` — Code exchange + refresh

### Contact Sync APIs

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/sync/trigger` | POST | Run full bidirectional sync |
| `/api/sync/logs` | GET | Get recent sync events |
| `/api/webhooks/wix` | POST | Receive Wix contact events |
| `/api/webhooks/hubspot` | POST | Receive HubSpot contact events |
| `/api/mappings` | GET/POST/DELETE | Field mapping CRUD |
| `/api/leads` | GET | List HubSpot contacts |
| `/api/leads` | PATCH | Update HubSpot contact |

**HubSpot CRM APIs:**
- `GET /crm/v3/objects/contacts` — List contacts
- `POST /crm/v3/objects/contacts` — Create contact
- `PATCH /crm/v3/objects/contacts/{id}` — Update contact
- `POST /crm/v3/objects/contacts/search` — Search by email
- `POST /engagements/v1/engagements` — Add note

### Form Capture APIs

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/forms/submit` | POST | Submit form + create HubSpot contact |
| `/api/forms/submissions` | GET | List form submissions |

---

## ⚙️ How It Works

### OAuth Flow

```
Dashboard → GET /api/auth/connect → HubSpot OAuth URL
                ↓
User clicks → Popup opens → Authorizes HubSpot
                ↓
HubSpot redirects → GET /api/auth/callback?code=xxx
                ↓
Server exchanges code → tokens → stores in Wix Data
                ↓
Auto-registers webhooks → starts auto-sync (every 5 min)
```

- Tokens stored in `HubSpotTokens` collection (singleton)
- `getValidAccessToken()` auto-refreshes 60s before expiry

### Bi-Directional Sync

**Wix → HubSpot:**
1. Wix webhook fires → `/api/webhooks/wix`
2. Check `wasRecentlySynced(contactId, 'hubspot')` → skip if yes
3. Apply field mappings → build HubSpot properties
4. If ID mapping exists → PATCH; else search by email → create
5. `markAsSynced(contactId, 'wix')`

**HubSpot → Wix:**
1. HubSpot webhook fires → `/api/webhooks/hubspot`
2. Check `wasRecentlySynced(hubspotId, 'wix')` → skip if yes
3. Fetch contact → apply reverse mappings → update Wix contact
4. `markAsSynced(hubspotId, 'hubspot')`

### Loop Prevention

```
Wix change → wix-webhook → wasRecent('hubspot')? No
                ↓
         syncToHubSpot → markAsSynced('wix')
                ↓
HubSpot fires → hubspot-webhook → wasRecent('wix')? YES → SKIP ✓
```

- **Mechanism:** In-memory `Map<"source:id", timestamp>`
- **Window:** 60 seconds
- **Why it works:** Absorbs round-trip webhook delay

### Form Capture with UTM

```
Visitor fills form (UTM in URL)
    ↓
POST /api/forms/submit
    ↓
Create/Update HubSpot contact
    ↓
Set UTM properties:
  utm_source → hs_analytics_source
  utm_medium → hs_analytics_source_data_1
  utm_campaign → hs_analytics_source_data_2
  pageUrl → hs_analytics_last_url
  referrer → hs_analytics_last_referrer
  timestamp → hs_analytics_last_visit_timestamp
    ↓
Add engagement note with full context
```

---

## 📁 Project Structure

```
hub-spot-integration/
├── scripts/
│   ├── start-dev.ps1          ← One-command dev startup (RUN THIS!)
│   ├── dev-proxy.mjs          ← Unifies :5173 + :4321 → :5175
│   ├── api-dev-server.mjs     ← Standalone API server (Node 20)
│   ├── dev-store.mjs          ← File-based JSON store (dev)
│   └── test-sync.js           ← Sync validation tests
├── src/
│   ├── backend/
│   │   ├── auth/
│   │   │   ├── hubspot-oauth.js     ← OAuth URL + token exchange
│   │   │   └── token-manager.js    ← Store/get/refresh tokens
│   │   ├── sync/
│   │   │   ├── contact-sync.js     ← Bidirectional sync engine
│   │   │   ├── loop-prevention.js  ← Dedup window (60s)
│   │   │   └── id-mapping.js       ← Wix ↔ HubSpot ID pairs
│   │   ├── forms/
│   │   │   └── form-handler.js     ← Form submission + UTM
│   │   ├── webhooks/
│   │   │   ├── wix-webhook.js      ← Handle Wix events
│   │   │   └── hubspot-webhook.js  ← Handle HubSpot events
│   │   └── mapping/
│   │       └── field-mapping.js    ← Field mapping logic
│   ├── dashboard/
│   │   ├── pages/page.tsx          ← Main tabbed dashboard
│   │   ├── connect/ConnectPage.tsx ← OAuth connect UI
│   │   ├── mapping/FieldMappingTable.tsx ← Mapping CRUD UI
│   │   ├── status/SyncStatus.tsx   ← Sync logs + trigger
│   │   ├── form/LeadCaptureForm.tsx ← Form with UTM fields
│   │   └── leads/LeadList.tsx      ← HubSpot contacts + edit
│   ├── pages/api/                  ← Astro API routes
│   │   ├── auth/{connect,callback,status,disconnect}.ts
│   │   ├── sync/{trigger,logs}.ts
│   │   ├── webhooks/{wix,hubspot}.ts
│   │   ├── forms/submit.ts
│   │   ├── mappings/index.ts
│   │   └── leads/index.ts
│   └── extensions.ts              ← Wix CLI entry point
├── .env                           ← Environment variables (YOU EDIT THIS!)
├── API_PLAN.md                    ← Detailed API documentation
└── README.md                      ← This file
```

---

## 🔐 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `HUBSPOT_CLIENT_ID` | ✅ | HubSpot OAuth app client ID |
| `HUBSPOT_CLIENT_SECRET` | ✅ | HubSpot OAuth app secret |
| `HUBSPOT_REDIRECT_URI` | ✅ | Full callback URL (`.../api/auth/callback`) |
| `PUBLIC_API_BASE` | ✅ | Public ngrok URL for frontend API calls |
| `HUBSPOT_APP_ID` | ❌ | For webhook auto-registration |

---

## 📖 Setup Guide

### Step 1: HubSpot OAuth App

1. Go to [HubSpot Developer](https://developers.hubspot.com/)
2. Create app → Auth settings
3. Set redirect URL: `https://your-ngrok.ngrok-free.dev/api/auth/callback`
4. Scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.schemas.contacts.read`
5. Copy Client ID + Secret to `.env`

### Step 2: ngrok Setup

```bash
ngrok config add-authtoken <your-token>
```

### Step 3: Wix Dev Center

1. Create app → Get namespace
2. Update `src/backend/collections.js` with your namespace
3. Configure app URL to your ngrok domain

### Step 4: Run & Test

```powershell
.\scripts\start-dev.ps1
```

Dashboard tabs:
- **Connect** → Link HubSpot account
- **Field Mapping** → Customize field mappings
- **Sync Status** → Trigger manual sync + view logs
- **Lead Capture** → Fill form with UTM data
- **Leads** → View/edit HubSpot contacts

---

## 📦 Deliverables

### A) API Plan
📄 [`API_PLAN.md`](./API_PLAN.md) — Complete documentation of:
- APIs used per feature
- HubSpot endpoints + Wix endpoints
- Webhook architecture
- Rate limits & error handling

### B) Working Integration
✅ All features implemented and tested:
- OAuth connect/disconnect via dashboard
- Field-mapping table UI + persistence
- Bi-directional contact sync with loop prevention
- Wix form → HubSpot lead capture with UTM/source context
- Lead list + inline editing

### C) GitHub Repo
Push this repository with:
- All source code
- `API_PLAN.md`
- `README.md` (this file)
- `.env.example` (template, no secrets)

### D) Test Credentials
To test the app connection:
1. Install the app on a Wix site
2. Go to the HubSpot Integration dashboard
3. Click **Connect HubSpot**
4. Use any HubSpot account to authorize

---

## 🛡️ Security Notes

- Tokens are **never exposed to the browser**
- All HubSpot API calls happen from **elevated backend code**
- OAuth uses **least privilege scopes** only
- No PII or tokens are logged
- Wix Data collections use **PRIVILEGED** permissions

---

## 📄 License

MIT License — feel free to use and modify.

---

## 🙋 Support

For issues or questions:
1. Check `API_PLAN.md` for endpoint details
2. Review sync logs in the **Sync Status** tab
3. Check ngrok status at `http://127.0.0.1:4040`
