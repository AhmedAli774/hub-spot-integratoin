# Wix ↔ HubSpot Integration — API Plan

> **Version:** 1.0.0  
> **Author:** Wix Integration Team  
> **Last Updated:** 2026-04-24  

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication Flow](#2-authentication-flow)
3. [Feature #1 — Contact Sync APIs](#3-feature-1--contact-sync-apis)
4. [Feature #2 — Form Capture APIs](#4-feature-2--form-capture-apis)
5. [Webhook Architecture](#5-webhook-architecture)
6. [Error Handling & Logging](#6-error-handling--logging)
7. [Environment Variables](#7-environment-variables)
8. [Rate Limits](#8-rate-limits)

---

## 1. Overview

This document describes the APIs and architecture powering the **Wix ↔ HubSpot Integration**. The integration consists of:

- **Feature #1:** Bidirectional contact sync between Wix Contacts and HubSpot CRM
- **Feature #2:** Lead capture form widget with UTM attribution tracking
- **Infrastructure:** Webhook listeners, auto-sync polling, and OAuth 2.0 authentication

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 16 + TypeScript + Wix Design System |
| Dashboard | Custom Wix App Dashboard tab |
| Backend API | Node 20 (pure `http.createServer`) |
| Storage | File-based JSON store (dev) / @wix/data (prod) |
| External APIs | HubSpot REST API v3, Wix Contacts API |
| Tunnel | ngrok (dev) |

---

## 2. Authentication Flow

### HubSpot OAuth 2.0

```
[Wix Dashboard] → GET /api/auth/connect → HubSpot OAuth URL
[User Authorizes] → Redirects to /api/auth/callback?code=xxx
[Server] → Exchanges code for tokens → Stores in file store
[Server] → Auto-registers webhooks → Starts auto-sync interval
```

### Required Scopes

```
crm.objects.contacts.read
crm.objects.contacts.write
crm.schemas.contacts.read
```

### Token Refresh

- Access tokens expire in 30 minutes
- Automatic refresh 1 minute before expiry via `getValidAccessToken()`
- Refresh token stored alongside access token

### API Endpoints — Auth

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/auth/connect` | Returns HubSpot OAuth URL | No |
| GET | `/api/auth/callback` | OAuth callback — exchanges code | No |
| GET | `/api/auth/status` | Returns connection status | Yes |
| POST | `/api/auth/disconnect` | Revokes tokens + cleans up | Yes |

---

## 3. Feature #1 — Contact Sync APIs

### Data Flow

```
┌──────────────┐     sync      ┌──────────────┐
│  HubSpot CRM │ ←────────────→│  Wix Contacts│
└──────────────┘               └──────────────┘
       ↑                             ↑
       │         sync engine         │
       └─────────────────────────────┘
```

### Field Mappings

| HubSpot Property | Wix Field | Direction |
|------------------|-----------|-----------|
| `email` | `primaryInfo.email` | Bidirectional |
| `phone` | `primaryInfo.phone` | Bidirectional |
| `firstname` | `name.first` | Bidirectional |
| `lastname` | `name.last` | Bidirectional |
| `city` | `addresses[0].city` | Wix → HubSpot |
| `country` | `addresses[0].country` | Wix → HubSpot |
| `zip` | `addresses[0].postalCode` | Wix → HubSpot |

### Conflict Resolution

- Compare `lastmodifieddate` (HubSpot) vs `updatedAt` (Wix)
- More recent timestamp wins during full sync
- Webhook-driven sync goes in the direction of the event

### Loop Prevention

- 60-second dedup window: `_synced` Map tracks recently synced contact IDs
- Prevents infinite sync cycles between HubSpot ↔ Wix

### API Endpoints — Mappings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mappings` | List all field mappings |
| POST | `/api/mappings` | Create/update mapping |
| DELETE | `/api/mappings?id={id}` | Delete mapping |

### API Endpoints — Sync

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sync/trigger` | Run full bidirectional sync |
| GET | `/api/sync/logs?limit=50` | Get recent sync events |

### HubSpot APIs Used

| Purpose | Endpoint |
|---------|----------|
| List contacts | `GET /crm/v3/objects/contacts` |
| Create contact | `POST /crm/v3/objects/contacts` |
| Update contact | `PATCH /crm/v3/objects/contacts/{id}` |
| Search contacts | `POST /crm/v3/objects/contacts/search` |
| Get properties | `GET /crm/v3/properties/contacts` |

---

## 4. Feature #2 — Form Capture APIs

### Lead Capture Flow

```
[Website Visitor] → Fills Lead Capture Form
                        ↓
              [Wix Dashboard Widget]
                        ↓
               POST /api/forms/submit
                        ↓
              [Server Creates HubSpot Contact]
                        ↓
              [Adds UTM Note via Engagements API]
```

### Form Fields

| Field | Required | HubSpot Property |
|-------|----------|-----------------|
| Email | Yes | `email` |
| First Name | No | `firstname` |
| Last Name | No | `lastname` |
| Phone | No | `phone` |
| Company | No | `company` |
| Message | No | (stored in note) |

### UTM Attribution

UTM parameters captured from URL query string:

- `utm_source` → stored in engagement note
- `utm_medium` → stored in engagement note
- `utm_campaign` → stored in engagement note
- `utm_term` → stored in engagement note
- `utm_content` → stored in engagement note

When any UTM param is present, `hs_lead_status` is set to `NEW`.

### Engagement Note Format

```
Lead captured via Wix form
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Page URL:    {pageUrl}
Referrer:    {referrer}
UTM Source:  {utm_source}
UTM Medium:  {utm_medium}
UTM Campaign: {utm_campaign}
Message:     {message}
```

### API Endpoints — Forms

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/forms/submit` | Submit form + create HubSpot contact |

### HubSpot APIs Used

| Purpose | Endpoint |
|---------|----------|
| Create/Update Contact | `POST /crm/v3/objects/contacts` |
| Add Note | `POST /engagements/v1/engagements` |

---

## 5. Webhook Architecture

### Webhook Registration

Webhooks are auto-registered after successful OAuth:

- **HubSpot Webhook:** Registered via `POST /webhooks/v3/{appId}/subscriptions`
  - Event: `contact.propertyChange`
  - Property: `email`
- **Wix Webhook:** Simulated in dev mode (production: Wix SDK API)

### Webhook Cleanup

- On disconnect: webhook subscriptions are deleted automatically
- Webhook IDs stored in file store for cleanup

### Incoming Webhook Handlers

| Source | Endpoint | Event Types |
|--------|----------|-------------|
| HubSpot | `POST /api/webhooks/hubspot` | `contact.creation`, `contact.propertyChange` |
| Wix | `POST /api/webhooks/wix` | Contact create/update/delete |

### Webhook Processing

1. Receive webhook event
2. Check loop prevention (`wasRecentlySynced`)
3. Fetch full contact data from source
4. Transform via field mappings
5. Create/update in destination system
6. Log sync event with timestamp

---

## 6. Error Handling & Logging

### Error Types

| Error | Status | Response |
|-------|--------|----------|
| HubSpot not connected | 400 | `{ error: "HubSpot not connected" }` |
| Missing email | 400 | `{ error: "formFields.email is required" }` |
| Invalid field mapping | 400 | `{ error: "wixField and hubspotProperty are required" }` |
| Duplicate mapping | 400 | `{ error: "HubSpot property is already mapped..." }` |
| HubSpot API error | 500 | `{ error: "HubSpot API error {status}: {details}" }` |

### Logging

All sync events logged to `data/sync-logs.json`:

```json
{
  "ts": "2026-04-24T05:20:00.119Z",
  "source": "hubspot-to-wix",
  "status": "synced",
  "contactId": "476184110837",
  "detail": "Synced to Wix contact wix_123"
}
```

---

## 7. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HUBSPOT_CLIENT_ID` | Yes | HubSpot OAuth app client ID |
| `HUBSPOT_CLIENT_SECRET` | Yes | HubSpot OAuth app secret |
| `HUBSPOT_REDIRECT_URI` | Yes | OAuth callback URL (must match app settings) |
| `HUBSPOT_APP_ID` | No | For webhook auto-registration |
| `PUBLIC_API_BASE` | Yes | Public ngrok URL for frontend |
| `HUBSPOT_REDIRECT_URI` | Yes | Full `/api/auth/callback` URL |

---

## 8. Rate Limits

### HubSpot

- Daily limit: 250,000 API calls (depends on plan)
- Burst limit: 100 requests per 10 seconds
- Webhooks: 1,000 subscriptions per account

### Internal

- Auto-sync interval: Every 5 minutes (configurable)
- Loop prevention: 60-second dedup window
- Contact search: limited to 100 results per sync cycle

---

## Appendix: API Response Examples

### Sync Response

```json
{
  "status": "completed",
  "summary": {
    "synced": 3,
    "skipped": 1,
    "errors": 0,
    "total": 4
  }
}
```

### Form Submit Response

```json
{
  "success": true,
  "hubspotId": "123456789",
  "properties": {
    "email": "lead@example.com",
    "hs_lead_status": "NEW"
  }
}
