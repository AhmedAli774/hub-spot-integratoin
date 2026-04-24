/**
 * Dev API server — serves Astro API routes on port 4321 for local development.
 * Replaces `astro dev` which requires Node >=22.12.0 (user has Node 20).
 *
 * Routes implemented:
 *   GET    /api/auth/connect
 *   GET    /api/auth/status
 *   POST   /api/auth/disconnect
 *   GET    /api/auth/callback
 *   GET    /api/mappings
 *   POST   /api/mappings
 *   DELETE /api/mappings
 *   GET    /api/sync/logs
 *   POST   /api/sync/trigger      ← actual sync engine
 *   POST   /api/forms/submit      ← actual HubSpot contact creation
 *   POST   /api/webhooks/hubspot  ← actual sync processing
 *   POST   /api/webhooks/wix      ← actual sync processing
 */
import http from 'http';
import url from 'url';
import 'dotenv/config';
import { store, logStore } from './dev-store.mjs';

const PORT = process.env.PORT || 4321;
const HUBSPOT_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const HUBSPOT_CONTACTS_URL = 'https://api.hubapi.com/crm/v3/objects/contacts';
const HUBSPOT_PROPERTIES_URL = 'https://api.hubapi.com/crm/v3/properties/contacts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Wix-*',
  'Content-Type': 'application/json',
};

/* ─────────────── helpers ─────────────── */

function json(body, status = 200, extraHeaders = {}) {
  return { status, body: JSON.stringify(body), headers: { ...CORS_HEADERS, ...extraHeaders } };
}

function jsonError(message, status = 500) {
  return json({ error: message }, status);
}

function html(body, status = 200) {
  return { status, body, headers: { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' } };
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.setEncoding('utf-8');
    req.on('data', (c) => { chunks += c; });
    req.on('end', () => {
      try { resolve(chunks ? JSON.parse(chunks) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

/* ─────────────── token management ─────────────── */

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.HUBSPOT_CLIENT_ID,
    client_secret: process.env.HUBSPOT_CLIENT_SECRET,
    refresh_token: refreshToken,
  });

  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HubSpot token refresh failed: ${err}`);
  }
  return res.json();
}

async function getTokens() {
  return await store.get('tokens', 'singleton');
}

async function storeTokens({ access_token, refresh_token, expires_in }) {
  await store.set('tokens', 'singleton', {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: Date.now() + expires_in * 1000,
  });
}

async function clearTokens() {
  await store.remove('tokens', 'singleton');
}

async function getValidAccessToken() {
  const tokens = await getTokens();
  if (!tokens) return null;
  if (Date.now() >= tokens.expiresAt - 60_000) {
    const fresh = await refreshAccessToken(tokens.refreshToken);
    await storeTokens(fresh);
    return fresh.access_token;
  }
  return tokens.accessToken;
}

/* ─────────────── HubSpot API helpers ─────────────── */

async function hsRequest(method, path, body) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('HubSpot not connected');

  const res = await fetch(`${HUBSPOT_CONTACTS_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HubSpot API error ${res.status}: ${err}`);
  }
  return res.status === 204 ? null : res.json();
}

async function fetchHubSpotContacts(limit = 100) {
  const token = await getValidAccessToken();
  if (!token) return [];

  const res = await fetch(
    `${HUBSPOT_CONTACTS_URL}?limit=${limit}&properties=email,firstname,lastname,phone,company,city,country,zip,lastmodifieddate`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) throw new Error(`Failed to fetch contacts: ${await res.text()}`);
  const data = await res.json();
  return data.results ?? [];
}

async function createOrUpdateHubSpotContact(properties) {
  try {
    return await hsRequest('POST', '', { properties });
  } catch (err) {
    if (err.message.includes('409')) {
      // Conflict — contact already exists, try to find by email
      if (properties.email) {
        const search = await hsRequest('POST', '/search', {
          filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: properties.email }] }],
          limit: 1,
        });
        if (search.results?.length > 0) {
          const hsId = search.results[0].id;
          return await hsRequest('PATCH', `/${hsId}`, { properties });
        }
      }
    }
    throw err;
  }
}

/* ─────────────── ID mapping ─────────────── */

async function saveMapping(wixContactId, hubspotContactId) {
  await store.set('id-mappings', wixContactId, {
    wixContactId,
    hubspotContactId,
    lastSyncedAt: new Date().toISOString(),
  });
}

async function getHubSpotId(wixContactId) {
  const mapping = await store.get('id-mappings', wixContactId);
  return mapping?.hubspotContactId ?? null;
}

async function getWixId(hubspotContactId) {
  const all = await store.all('id-mappings');
  const found = all.find((m) => m.hubspotContactId === hubspotContactId);
  return found?.wixContactId ?? null;
}

/* ─────────────── loop prevention ─────────────── */

const DEDUP_WINDOW_MS = 60_000;
const _synced = new Map();

function markAsSynced(contactId, source) {
  _synced.set(`${source}:${contactId}`, Date.now());
}

function wasRecentlySynced(contactId, source) {
  const ts = _synced.get(`${source}:${contactId}`);
  if (!ts) return false;
  if (Date.now() - ts > DEDUP_WINDOW_MS) {
    _synced.delete(`${source}:${contactId}`);
    return false;
  }
  return true;
}

/* ─────────────── field mappings ─────────────── */

const DEFAULT_MAPPINGS = [
  { id: '1', wixField: 'primaryInfo.email',    hubspotProperty: 'email',      direction: 'bidirectional', required: true },
  { id: '2', wixField: 'primaryInfo.phone',    hubspotProperty: 'phone',      direction: 'bidirectional', required: false },
  { id: '3', wixField: 'name.first',           hubspotProperty: 'firstname',  direction: 'bidirectional', required: false },
  { id: '4', wixField: 'name.last',            hubspotProperty: 'lastname',   direction: 'bidirectional', required: false },
  { id: '5', wixField: 'addresses[0].city',    hubspotProperty: 'city',       direction: 'wix-to-hubspot', required: false },
  { id: '6', wixField: 'addresses[0].country', hubspotProperty: 'country',    direction: 'wix-to-hubspot', required: false },
  { id: '7', wixField: 'addresses[0].postalCode', hubspotProperty: 'zip',     direction: 'wix-to-hubspot', required: false },
];

async function ensureDefaultMappings() {
  const existing = await store.all('mappings');
  if (existing.length === 0) {
    for (const m of DEFAULT_MAPPINGS) {
      await store.set('mappings', m.id, m);
    }
  }
}

async function getFieldMappings() {
  await ensureDefaultMappings();
  return await store.all('mappings');
}

function applyMappings(sourceContact, syncDirection, mappings) {
  const props = {};
  for (const m of mappings) {
    const dir = m.direction ?? 'bidirectional';
    if (dir !== 'bidirectional' && dir !== syncDirection) continue;
    const [srcField, dstField] =
      syncDirection === 'wix-to-hubspot'
        ? [m.wixField, m.hubspotProperty]
        : [m.hubspotProperty, m.wixField];
    const value = sourceContact[srcField];
    if (value !== undefined && value !== null) props[dstField] = value;
  }
  return props;
}

/* ─────────────── mock Wix contact store (dev only) ─────────────── */

async function getMockWixContacts() {
  return await store.all('mock-wix-contacts');
}

async function saveMockWixContact(contact) {
  const id = contact.id ?? `wix_${Date.now()}`;
  await store.set('mock-wix-contacts', id, { ...contact, id, updatedAt: new Date().toISOString() });
  return { ...contact, id };
}

/* ─────────────── sync engine ─────────────── */

async function syncHubSpotContactToWix(hsContact) {
  if (wasRecentlySynced(hsContact.id, 'hubspot')) {
    return { status: 'skipped', reason: 'dedup_window' };
  }

  const mappings = await getFieldMappings();
  const existingWixId = await getWixId(hsContact.id);

  const contactData = {
    email: hsContact.properties?.email,
    firstName: hsContact.properties?.firstname,
    lastName: hsContact.properties?.lastname,
    phone: hsContact.properties?.phone,
    city: hsContact.properties?.city,
    country: hsContact.properties?.country,
    zip: hsContact.properties?.zip,
    lastModifiedDate: hsContact.properties?.lastmodifieddate,
  };

  let result;
  if (existingWixId) {
    const existing = await store.get('mock-wix-contacts', existingWixId);
    // Conflict: last updated wins
    const hsUpdated = new Date(hsContact.properties?.lastmodifieddate || 0).getTime();
    const wixUpdated = new Date(existing?.updatedAt || 0).getTime();
    if (wixUpdated > hsUpdated) {
      return { status: 'skipped', reason: 'wix_newer' };
    }
    result = await saveMockWixContact({ ...existing, ...contactData, id: existingWixId });
  } else {
    result = await saveMockWixContact(contactData);
    await saveMapping(result.id, hsContact.id);
  }

  markAsSynced(hsContact.id, 'hubspot');
  return { status: 'synced', contactId: result.id, hubspotId: hsContact.id };
}

async function syncWixContactToHubSpot(wixContact) {
  if (wasRecentlySynced(wixContact.id, 'wix')) {
    return { status: 'skipped', reason: 'dedup_window' };
  }

  const mappings = await getFieldMappings();
  const existingHsId = await getHubSpotId(wixContact.id);

  const properties = {
    email: wixContact.email,
    firstname: wixContact.firstName,
    lastname: wixContact.lastName,
    phone: wixContact.phone,
    city: wixContact.city,
    country: wixContact.country,
    zip: wixContact.zip,
  };

  // Remove undefined values
  Object.keys(properties).forEach((k) => properties[k] === undefined && delete properties[k]);

  let result;
  if (existingHsId) {
    result = await hsRequest('PATCH', `/${existingHsId}`, { properties });
  } else {
    result = await createOrUpdateHubSpotContact(properties);
    await saveMapping(wixContact.id, result.id);
  }

  markAsSynced(wixContact.id, 'wix');
  return { status: 'synced', contactId: wixContact.id, hubspotId: result.id };
}

async function runFullSync() {
  const results = [];

  try {
    // 1. Fetch HubSpot contacts and sync to Wix (mock)
    const hsContacts = await fetchHubSpotContacts();
    for (const hsContact of hsContacts) {
      try {
        const r = await syncHubSpotContactToWix(hsContact);
        results.push({ direction: 'hubspot-to-wix', ...r, contactId: hsContact.id });
        await logStore.append('sync-logs', {
          source: 'hubspot-to-wix',
          status: r.status,
          contactId: hsContact.id,
          detail: r.reason ?? `Synced to Wix contact ${r.contactId}`,
        });
      } catch (err) {
        results.push({ direction: 'hubspot-to-wix', status: 'error', contactId: hsContact.id, error: err.message });
        await logStore.append('sync-logs', {
          source: 'hubspot-to-wix',
          status: 'error',
          contactId: hsContact.id,
          detail: err.message,
        });
      }
    }

    // 2. Fetch mock Wix contacts and sync to HubSpot
    const wixContacts = await getMockWixContacts();
    for (const wixContact of wixContacts) {
      try {
        const r = await syncWixContactToHubSpot(wixContact);
        results.push({ direction: 'wix-to-hubspot', ...r });
        await logStore.append('sync-logs', {
          source: 'wix-to-hubspot',
          status: r.status,
          contactId: wixContact.id,
          detail: `Synced to HubSpot contact ${r.hubspotId}`,
        });
      } catch (err) {
        results.push({ direction: 'wix-to-hubspot', status: 'error', contactId: wixContact.id, error: err.message });
        await logStore.append('sync-logs', {
          source: 'wix-to-hubspot',
          status: 'error',
          contactId: wixContact.id,
          detail: err.message,
        });
      }
    }

    return results;
  } catch (err) {
    throw err;
  }
}


async function addNoteToContact(contactId, text) {
  const token = await getValidAccessToken();
  if (!token) return null;

  const res = await fetch('https://api.hubapi.com/engagements/v1/engagements', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      engagement: { active: true, type: 'NOTE' },
      associations: { contactIds: [parseInt(contactId, 10)] },
      metadata: { body: text },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[NOTE ERROR]', err);
    return null;
  }
  return res.json();
}

/* ─────────────── webhook registration ─────────────── */

const HUBSPOT_WEBHOOK_API = (appId) => `https://api.hubapi.com/webhooks/v3/${appId}/subscriptions`;

async function registerHubSpotWebhook() {
  const appId = process.env.HUBSPOT_APP_ID;
  if (!appId) {
    console.warn('[WEBHOOK] HUBSPOT_APP_ID not set — skipping HubSpot webhook auto-registration');
    return null;
  }

  const token = await getValidAccessToken();
  const res = await fetch(HUBSPOT_WEBHOOK_API(appId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      eventType: 'contact.propertyChange',
      propertyName: 'email',
      active: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[WEBHOOK] HubSpot registration failed:', err);
    return null;
  }

  const data = await res.json();
  await store.set('webhooks', 'hubspot-subscription', { id: data.id, createdAt: Date.now() });
  console.log('[WEBHOOK] HubSpot subscription registered:', data.id);
  return data.id;
}

async function deleteHubSpotWebhook() {
  const appId = process.env.HUBSPOT_APP_ID;
  const sub = await store.get('webhooks', 'hubspot-subscription');
  if (!appId || !sub?.id) return;

  const token = await getValidAccessToken();
  await fetch(`${HUBSPOT_WEBHOOK_API(appId)}/${sub.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  await store.remove('webhooks', 'hubspot-subscription');
  console.log('[WEBHOOK] HubSpot subscription deleted:', sub.id);
}

async function registerWixWebhook() {
  // In dev mode: simulate Wix webhook registration (production would call Wix API)
  const webhookId = `wix_wh_${Date.now()}`;
  await store.set('webhooks', 'wix-subscription', { id: webhookId, createdAt: Date.now() });
  console.log('[WEBHOOK] Wix webhook registered (simulated):', webhookId);
  return webhookId;
}

async function deleteWixWebhook() {
  await store.remove('webhooks', 'wix-subscription');
}

async function getWebhookStatus() {
  const hubspot = await store.get('webhooks', 'hubspot-subscription');
  const wix = await store.get('webhooks', 'wix-subscription');
  return {
    hubspot: hubspot ? { registered: true, id: hubspot.id } : { registered: false },
    wix: wix ? { registered: true, id: wix.id } : { registered: false },
  };
}

/* ─────────────── form submission handler ─────────────── */

const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const UTM_PROPERTY_MAP = {
  utm_source: 'hs_analytics_source',
  utm_medium: 'hs_analytics_source_data_1',
  utm_campaign: 'hs_analytics_source_data_2',
  utm_term: 'utm_term',
  utm_content: 'utm_content',
};

async function handleFormSubmission({ formFields, utmParams, wixContactId, pageUrl, referrer }) {
  const properties = {};

  // Basic contact properties
  if (formFields.email) properties.email = formFields.email;
  if (formFields.firstName) properties.firstname = formFields.firstName;
  if (formFields.lastName) properties.lastname = formFields.lastName;
  if (formFields.phone) properties.phone = formFields.phone;
  if (formFields.company) properties.company = formFields.company;

  // Set lead status for attribution tracking
  if (utmParams && Object.keys(utmParams).length > 0) {
    properties.hs_lead_status = 'NEW';
  }

  const existingHsId = wixContactId ? await getHubSpotId(wixContactId) : null;
  let result;

  if (existingHsId) {
    result = await hsRequest('PATCH', `/${existingHsId}`, { properties });
  } else {
    result = await createOrUpdateHubSpotContact(properties);
    if (wixContactId && result?.id) {
      await saveMapping(wixContactId, result.id);
    }
  }

  // Add engagement note with UTM + message attribution
  if (result?.id) {
    const noteLines = [
      'Lead captured via Wix form',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      pageUrl ? `Page URL: ${pageUrl}` : null,
      referrer ? `Referrer: ${referrer}` : null,
      utmParams?.utm_source ? `UTM Source: ${utmParams.utm_source}` : null,
      utmParams?.utm_medium ? `UTM Medium: ${utmParams.utm_medium}` : null,
      utmParams?.utm_campaign ? `UTM Campaign: ${utmParams.utm_campaign}` : null,
      utmParams?.utm_term ? `UTM Term: ${utmParams.utm_term}` : null,
      utmParams?.utm_content ? `UTM Content: ${utmParams.utm_content}` : null,
      formFields.message ? `Message: ${formFields.message}` : null,
    ].filter(Boolean);

    if (noteLines.length > 2) {
      await addNoteToContact(result.id, noteLines.join('\n'));
    }
  }

  // Save submission locally for lead list
  await logStore.append('form-submissions', {
    hubspotId: result?.id ?? null,
    email: formFields.email,
    firstName: formFields.firstName ?? '',
    lastName: formFields.lastName ?? '',
    phone: formFields.phone ?? '',
    company: formFields.company ?? '',
    message: formFields.message ?? '',
    pageUrl: pageUrl ?? '',
    referrer: referrer ?? '',
    utmParams: utmParams ?? {},
  });

  if (wixContactId) markAsSynced(wixContactId, 'wix');
  return result;
}

/* ─────────────── HubSpot OAuth ─────────────── */

const HUBSPOT_AUTH_URL = 'https://app.hubspot.com/oauth/authorize';
const SCOPES = 'crm.objects.contacts.read crm.objects.contacts.write crm.schemas.contacts.read';

function getAuthUrl() {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const redirectUri = process.env.HUBSPOT_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new Error('Missing HUBSPOT_CLIENT_ID or HUBSPOT_REDIRECT_URI in .env');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    response_type: 'code',
  });
  return `${HUBSPOT_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.HUBSPOT_CLIENT_ID,
    client_secret: process.env.HUBSPOT_CLIENT_SECRET,
    redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
    code,
  });

  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HubSpot token exchange failed: ${err}`);
  }
  return res.json();
}

/* ─────────────── router ─────────────── */

const routes = {
  /* ── auth ── */
  'GET /api/auth/connect': async () => {
    return json({ url: getAuthUrl() });
  },

  'GET /api/auth/status': async () => {
    const tokens = await getTokens();
    return json({ connected: tokens !== null, expiresAt: tokens?.expiresAt ?? null });
  },

  'POST /api/auth/disconnect': async () => {
    await deleteHubSpotWebhook();
    await deleteWixWebhook();
    await clearTokens();
    return json({ success: true });
  },

  'GET /api/auth/callback': async (req) => {
    const parsed = url.parse(req.url, true);
    const code = parsed.query.code;
    const error = parsed.query.error;

    if (error) return jsonError(error, 400);
    if (!code) return jsonError('Missing code parameter', 400);

    try {
      const tokens = await exchangeCodeForToken(code);
      await storeTokens(tokens);

      // Auto-register webhooks after successful OAuth
      try { await registerHubSpotWebhook(); } catch (e) { console.warn('[WEBHOOK] Auto-register HubSpot failed:', e.message); }
      try { await registerWixWebhook(); } catch (e) { console.warn('[WEBHOOK] Auto-register Wix failed:', e.message); }

      // Start auto-sync polling
      startAutoSync(5);

      return html(
        `<html><body><script>window.close();</script>
         <p style="font-family:sans-serif;text-align:center;margin-top:40px">
           <strong>HubSpot connected!</strong><br>You can close this window.
         </p></body></html>`
      );
    } catch (err) {
      return jsonError(err.message);
    }
  },

  /* ── mappings ── */
  'GET /api/mappings': async () => {
    await ensureDefaultMappings();
    const mappings = await store.all('mappings');
    return json({ mappings });
  },

  'POST /api/mappings': async (req) => {
    await ensureDefaultMappings();
    const body = await readBody(req);
    const { id, wixField, hubspotProperty, direction } = body;

    if (!wixField || !hubspotProperty) {
      return jsonError('wixField and hubspotProperty are required', 400);
    }

    const mappings = await store.all('mappings');
    const duplicate = mappings.find(
      (m) => m.hubspotProperty === hubspotProperty && m.id !== id
    );
    if (duplicate) {
      return jsonError(
        `HubSpot property "${hubspotProperty}" is already mapped to "${duplicate.wixField}"`,
        400
      );
    }

    const entryId = id ?? String(Date.now());
    const entry = { id: entryId, wixField, hubspotProperty, direction: direction ?? 'bidirectional' };
    await store.set('mappings', entryId, entry);
    return json({ mapping: entry });
  },

  'DELETE /api/mappings': async (req) => {
    const parsed = url.parse(req.url, true);
    const id = parsed.query.id;
    if (!id) return jsonError('id query param required', 400);
    await store.remove('mappings', id);
    return json({ deleted: true });
  },

  /* ── sync ── */
  'GET /api/sync/logs': async (req) => {
    const parsed = url.parse(req.url, true);
    const limit = Math.min(parseInt(parsed.query.limit ?? '50', 10), 200);
    const items = await logStore.list('sync-logs', { limit });
    const logs = items.map((item) => ({
      ts: new Date(item._createdDate || Date.now()).getTime(),
      direction: item.source ?? '',
      status: item.status ?? '',
      contactId: item.contactId ?? '',
      detail: item.detail ?? '',
    }));
    return json({ logs });
  },

  'POST /api/sync/trigger': async () => {
    const tokens = await getTokens();
    if (!tokens) return jsonError('HubSpot not connected', 400);

    try {
      const results = await runFullSync();
      const synced = results.filter((r) => r.status === 'synced').length;
      const skipped = results.filter((r) => r.status === 'skipped').length;
      const errors = results.filter((r) => r.status === 'error').length;

      return json({
        status: 'completed',
        summary: { synced, skipped, errors, total: results.length },
        results,
      });
    } catch (err) {
      return jsonError(`Sync failed: ${err.message}`);
    }
  },

  /* ── leads ── */
  'GET /api/leads': async () => {
    const tokens = await getTokens();
    if (!tokens) return jsonError('HubSpot not connected', 400);
    try {
      const contacts = await fetchHubSpotContacts(100);
      return json({ leads: contacts });
    } catch (err) {
      return jsonError(err.message);
    }
  },

  'PATCH /api/leads': async (req) => {
    const body = await readBody(req);
    const { id, properties } = body;
    if (!id) return jsonError('id is required', 400);
    if (!properties || Object.keys(properties).length === 0) {
      return jsonError('properties object is required', 400);
    }
    try {
      const result = await hsRequest('PATCH', `/${id}`, { properties });
      return json({ success: true, contact: result });
    } catch (err) {
      return jsonError(err.message);
    }
  },

  /* ── forms ── */
  'GET /api/forms/submissions': async () => {
    const items = await logStore.list('form-submissions', { limit: 200 });
    const submissions = items.map((item) => ({
      id: item._createdDate + item.email,
      email: item.email,
      firstName: item.firstName ?? '',
      lastName: item.lastName ?? '',
      phone: item.phone ?? '',
      company: item.company ?? '',
      message: item.message ?? '',
      pageUrl: item.pageUrl ?? '',
      referrer: item.referrer ?? '',
      utmParams: item.utmParams ?? {},
      hubspotId: item.hubspotId ?? null,
      createdAt: item._createdDate,
    }));
    return json({ submissions });
  },

  'POST /api/forms/submit': async (req) => {
    const body = await readBody(req);
    const { formFields, utmParams, wixContactId, pageUrl, referrer } = body;

    if (!formFields?.email) return jsonError('formFields.email is required', 400);

    try {
      const result = await handleFormSubmission({ formFields, utmParams, wixContactId, pageUrl, referrer });
      return json({ success: true, hubspotId: result.id, properties: result.properties });
    } catch (err) {
      console.error('[FORM SUBMIT ERROR]', err.message, err.stack);
      return jsonError(err instanceof Error ? err.message : 'Unknown error');
    }
  },

  /* ── webhooks ── */
  'POST /api/webhooks/hubspot': async (req) => {
    const body = await readBody(req);
    const events = Array.isArray(body) ? body : [body];
    const results = [];

    for (const event of events) {
      const { objectId, subscriptionType } = event;

      if (!['contact.creation', 'contact.propertyChange'].includes(subscriptionType)) {
        results.push({ objectId, status: 'ignored', subscriptionType });
        continue;
      }

      if (wasRecentlySynced(String(objectId), 'wix')) {
        results.push({ objectId, status: 'skipped', reason: 'loop-prevention' });
        continue;
      }

      try {
        const hsContact = await hsRequest('GET', `/${objectId}?properties=email,firstname,lastname,phone,city,country,zip,lastmodifieddate`);
        const result = await syncHubSpotContactToWix(hsContact);
        results.push({ objectId, status: 'synced', result });
      } catch (err) {
        results.push({ objectId, status: 'error', error: err.message });
      }
    }

    return json({ results });
  },

  'POST /api/webhooks/wix': async (req) => {
    const body = await readBody(req);
    const entityId = body?.entityId ?? body?.data?.contactId;

    if (!entityId) return jsonError('Missing entityId', 400);

    if (wasRecentlySynced(String(entityId), 'hubspot')) {
      return json({ status: 'skipped', reason: 'loop-prevention' });
    }

    const contact = body?.actionEvent?.bodyAsJson?.contact ?? body?.data?.contact;
    if (!contact) return jsonError('No contact payload', 400);

    try {
      const wixContact = {
        id: entityId,
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        city: contact.city,
        country: contact.country,
        zip: contact.zip,
      };
      const result = await syncWixContactToHubSpot(wixContact);
      return json({ status: 'synced', result });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Sync failed');
    }
  },
};

/* ─────────────── auto sync interval ─────────────── */

let _autoSyncInterval = null;

function startAutoSync(minutes = 5) {
  stopAutoSync();
  _autoSyncInterval = setInterval(async () => {
    const tokens = await getTokens();
    if (!tokens) return;
    try {
      console.log(`[AUTO SYNC] Triggering scheduled sync (every ${minutes}m)...`);
      const results = await runFullSync();
      const synced = results.filter((r) => r.status === 'synced').length;
      console.log(`[AUTO SYNC] Completed — ${synced} contacts synced`);
    } catch (err) {
      console.error('[AUTO SYNC] Error:', err.message);
    }
  }, minutes * 60_000);
}

function stopAutoSync() {
  if (_autoSyncInterval) {
    clearInterval(_autoSyncInterval);
    _autoSyncInterval = null;
  }
}

/* ─────────────── server ─────────────── */

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const pathname = req.url.split('?')[0];
  const key = `${req.method} ${pathname}`;
  const handler = routes[key];

 if (!handler) {
    // Root route — serve dashboard HTML for Wix iframe
    if (pathname === '/' || !pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HubSpot Integration</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f5f7;color:#1a1a2e;min-height:100vh}
.header{background:#fff;border-bottom:1px solid #e5e7eb;padding:16px 24px;display:flex;align-items:center;gap:12px}
.header h1{font-size:18px;font-weight:600;color:#1a1a2e}
.badge{background:#dcfce7;color:#166534;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px}
.badge.disconnected{background:#fee2e2;color:#991b1b}
.tabs{display:flex;background:#fff;border-bottom:1px solid #e5e7eb;padding:0 24px}
.tab{padding:12px 16px;font-size:14px;font-weight:500;color:#6b7280;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.2s}
.tab.active{color:#ff7a59;border-bottom-color:#ff7a59}
.tab:hover{color:#ff7a59}
.content{padding:24px;max-width:900px}
.section{display:none}
.section.active{display:block}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:16px}
.card h2{font-size:16px;font-weight:600;margin-bottom:8px}
.card p{font-size:14px;color:#6b7280;margin-bottom:16px}
.btn{padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;border:none;transition:all 0.2s}
.btn-primary{background:#ff7a59;color:#fff}
.btn-primary:hover{background:#e8644a}
.btn-danger{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
.btn-danger:hover{background:#fecaca}
.btn-secondary{background:#f3f4f6;color:#374151;border:1px solid #e5e7eb}
.btn-secondary:hover{background:#e5e7eb}
.btn:disabled{opacity:0.5;cursor:not-allowed}
.status-row{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.dot{width:10px;height:10px;border-radius:50%;background:#d1d5db}
.dot.green{background:#22c55e}
.dot.red{background:#ef4444}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:10px 12px;background:#f9fafb;font-weight:500;color:#6b7280;border-bottom:1px solid #e5e7eb}
td{padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#374151}
tr:last-child td{border-bottom:none}
select,input{padding:8px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;color:#374151;background:#fff;width:100%}
select:focus,input:focus{outline:none;border-color:#ff7a59}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.alert{padding:12px 16px;border-radius:8px;font-size:13px;margin-bottom:16px}
.alert.success{background:#dcfce7;color:#166534}
.alert.error{background:#fee2e2;color:#991b1b}
.sync-log{font-size:12px;padding:8px 12px;border-left:3px solid #e5e7eb;margin-bottom:6px;background:#f9fafb;border-radius:0 6px 6px 0}
.sync-log.synced{border-left-color:#22c55e}
.sync-log.error{border-left-color:#ef4444}
.sync-log.skipped{border-left-color:#f59e0b}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px}
.edit-btn{padding:4px 10px;font-size:12px;border-radius:4px;background:#eff6ff;color:#1d4ed8;border:none;cursor:pointer}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid #e5e7eb;border-top-color:#ff7a59;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:100;align-items:center;justify-content:center}
.overlay.open{display:flex}
.modal-box{background:#fff;border-radius:12px;padding:24px;width:400px;max-width:90vw}
.modal-box h3{font-size:16px;font-weight:600;margin-bottom:16px}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
</style>
</head>
<body>
<div class="header">
  <span style="font-size:20px">&#128279;</span>
  <h1>HubSpot Integration</h1>
  <span class="badge disconnected" id="conn-badge">Checking...</span>
</div>
<div class="tabs">
  <div class="tab active" onclick="switchTab('connect')">Connect</div>
  <div class="tab" onclick="switchTab('mapping')">Field Mapping</div>
  <div class="tab" onclick="switchTab('sync')">Sync Status</div>
  <div class="tab" onclick="switchTab('form')">Lead Capture</div>
  <div class="tab" onclick="switchTab('leads')">Leads</div>
</div>
<div class="content">
  <div class="section active" id="tab-connect">
    <div class="card">
      <h2>HubSpot Connection</h2>
      <p>Connect your HubSpot account to enable bi-directional contact sync.</p>
      <div class="status-row">
        <div class="dot" id="conn-dot"></div>
        <span id="conn-text" style="font-size:14px;font-weight:500">Checking...</span>
      </div>
      <div id="conn-expires" style="font-size:12px;color:#6b7280;margin-bottom:16px;display:none"></div>
      <button class="btn btn-primary" id="btn-connect" onclick="connectHubspot()">Connect HubSpot</button>
      <button class="btn btn-danger" id="btn-disconnect" onclick="disconnectHubspot()" style="display:none;margin-left:8px">Disconnect</button>
    </div>
    <div class="card">
      <h2>About this integration</h2>
      <p>This app provides:</p>
      <ul style="font-size:14px;color:#6b7280;line-height:2;padding-left:20px">
        <li>Bi-directional contact sync (Wix to HubSpot)</li>
        <li>Configurable field mapping</li>
        <li>Form submissions with UTM attribution</li>
        <li>Loop prevention and conflict resolution</li>
        <li>OAuth 2.0 secure connection</li>
      </ul>
    </div>
  </div>
  <div class="section" id="tab-mapping">
    <div class="card">
      <h2>Field Mapping</h2>
      <p>Map Wix contact fields to HubSpot properties. Changes apply on next sync.</p>
      <div id="mapping-alert"></div>
      <table>
        <thead><tr><th>Wix Field</th><th>HubSpot Property</th><th>Direction</th><th></th></tr></thead>
        <tbody id="mapping-body"><tr><td colspan="4" style="text-align:center;color:#6b7280">Loading...</td></tr></tbody>
      </table>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid #e5e7eb">
        <div class="grid3">
          <input id="new-wix" placeholder="Wix field (e.g. name.first)">
          <input id="new-hs" placeholder="HubSpot property (e.g. firstname)">
          <select id="new-dir">
            <option value="bidirectional">Bidirectional</option>
            <option value="wix-to-hubspot">Wix to HubSpot</option>
            <option value="hubspot-to-wix">HubSpot to Wix</option>
          </select>
        </div>
        <button class="btn btn-primary" onclick="addMapping()">Add Mapping</button>
      </div>
    </div>
  </div>
  <div class="section" id="tab-sync">
    <div class="card">
      <h2>Sync Control</h2>
      <p>Trigger a manual bi-directional sync between Wix and HubSpot.</p>
      <div id="sync-alert"></div>
      <button class="btn btn-primary" id="btn-sync" onclick="triggerSync()">Trigger Sync Now</button>
      <div id="sync-result" style="margin-top:16px;display:none">
        <div class="grid3" style="gap:8px">
          <div style="background:#f0fdf4;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:22px;font-weight:600;color:#166534" id="r-synced">0</div>
            <div style="font-size:11px;color:#166534">Synced</div>
          </div>
          <div style="background:#fffbeb;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:22px;font-weight:600;color:#92400e" id="r-skipped">0</div>
            <div style="font-size:11px;color:#92400e">Skipped</div>
          </div>
          <div style="background:#fef2f2;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:22px;font-weight:600;color:#991b1b" id="r-errors">0</div>
            <div style="font-size:11px;color:#991b1b">Errors</div>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Sync Logs</h2>
      <p style="margin-bottom:12px">Recent sync events</p>
      <button class="btn btn-secondary" onclick="loadLogs()" style="margin-bottom:12px;font-size:12px;padding:6px 12px">Refresh Logs</button>
      <div id="log-list"><p style="font-size:13px;color:#6b7280">Click refresh to load logs.</p></div>
    </div>
  </div>
  <div class="section" id="tab-form">
    <div class="card">
      <h2>Lead Capture Form</h2>
      <p>Submit a lead directly to HubSpot with UTM attribution tracking.</p>
      <div id="form-alert"></div>
      <div class="form-group"><label>First Name</label><input id="f-first" placeholder="John"></div>
      <div class="form-group"><label>Last Name</label><input id="f-last" placeholder="Smith"></div>
      <div class="form-group"><label>Email *</label><input id="f-email" type="email" placeholder="john@example.com"></div>
      <div class="form-group"><label>Phone</label><input id="f-phone" placeholder="+1 555 000 0000"></div>
      <div class="form-group"><label>Company</label><input id="f-company" placeholder="Acme Inc"></div>
      <div class="form-group"><label>Message</label><input id="f-message" placeholder="How can we help?"></div>
      <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:16px">
        <p style="font-size:12px;font-weight:500;color:#6b7280;margin-bottom:10px">UTM Attribution (optional)</p>
        <div class="grid2" style="gap:8px">
          <div><label style="font-size:11px;color:#6b7280;display:block;margin-bottom:4px">utm_source</label><input id="u-source" placeholder="google"></div>
          <div><label style="font-size:11px;color:#6b7280;display:block;margin-bottom:4px">utm_medium</label><input id="u-medium" placeholder="cpc"></div>
          <div><label style="font-size:11px;color:#6b7280;display:block;margin-bottom:4px">utm_campaign</label><input id="u-campaign" placeholder="spring-sale"></div>
          <div><label style="font-size:11px;color:#6b7280;display:block;margin-bottom:4px">utm_content</label><input id="u-content" placeholder="banner-a"></div>
        </div>
      </div>
      <button class="btn btn-primary" id="btn-form" onclick="submitForm()">Submit to HubSpot</button>
    </div>
  </div>
  <div class="section" id="tab-leads">
    <div class="card">
      <h2>HubSpot Contacts</h2>
      <p>View and edit contacts synced with HubSpot.</p>
      <button class="btn btn-secondary" onclick="loadLeads()" style="margin-bottom:12px;font-size:12px;padding:6px 12px">Refresh</button>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Company</th><th></th></tr></thead>
          <tbody id="leads-body"><tr><td colspan="5" style="text-align:center;color:#6b7280">Click refresh to load.</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>
</div>
<div class="overlay" id="edit-modal">
  <div class="modal-box">
    <h3>Edit Contact</h3>
    <input type="hidden" id="edit-id">
    <div class="form-group"><label>First Name</label><input id="edit-first"></div>
    <div class="form-group"><label>Last Name</label><input id="edit-last"></div>
    <div class="form-group"><label>Phone</label><input id="edit-phone"></div>
    <div class="form-group"><label>Company</label><input id="edit-company"></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveContact()">Save</button>
    </div>
  </div>
</div>
<script>
const API=window.location.origin;
async function api(m,p,b){const o={method:m,headers:{'Content-Type':'application/json'}};if(b)o.body=JSON.stringify(b);const r=await fetch(API+p,o);return r.json();}
function showAlert(id,msg,type){const el=document.getElementById(id);el.innerHTML='<div class="alert '+type+'">'+msg+'</div>';setTimeout(()=>{el.innerHTML='';},5000);}
function switchTab(name){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));const tabs=['connect','mapping','sync','form','leads'];document.querySelectorAll('.tab')[tabs.indexOf(name)].classList.add('active');document.getElementById('tab-'+name).classList.add('active');if(name==='mapping')loadMappings();if(name==='leads')loadLeads();if(name==='sync')loadLogs();}
async function checkStatus(){try{const d=await api('GET','/api/auth/status');const badge=document.getElementById('conn-badge');const dot=document.getElementById('conn-dot');const text=document.getElementById('conn-text');const exp=document.getElementById('conn-expires');const btnC=document.getElementById('btn-connect');const btnD=document.getElementById('btn-disconnect');if(d.connected){badge.textContent='Connected';badge.className='badge';dot.className='dot green';text.textContent='HubSpot Connected';if(d.expiresAt){exp.textContent='Token expires: '+new Date(d.expiresAt).toLocaleString();exp.style.display='block';}btnC.style.display='none';btnD.style.display='inline-block';}else{badge.textContent='Disconnected';badge.className='badge disconnected';dot.className='dot red';text.textContent='Not connected';exp.style.display='none';btnC.style.display='inline-block';btnD.style.display='none';}}catch(e){console.error(e);}}
async function connectHubspot(){const d=await api('GET','/api/auth/connect');if(d.url){const w=window.open(d.url,'_blank','width=600,height=700');const t=setInterval(()=>{if(w.closed){clearInterval(t);setTimeout(checkStatus,1500);}},500);}}
async function disconnectHubspot(){if(!confirm('Disconnect HubSpot? Sync will stop.'))return;await api('POST','/api/auth/disconnect');checkStatus();}
async function loadMappings(){const d=await api('GET','/api/mappings');const tbody=document.getElementById('mapping-body');if(!d.mappings||d.mappings.length===0){tbody.innerHTML='<tr><td colspan="4" style="text-align:center;color:#6b7280">No mappings yet.</td></tr>';return;}tbody.innerHTML=d.mappings.map(m=>'<tr><td>'+m.wixField+'</td><td>'+m.hubspotProperty+'</td><td>'+(m.direction||'bidirectional')+'</td><td>'+(m.required?'<span style="font-size:11px;color:#6b7280">Required</span>':'<button class="edit-btn" onclick="deleteMapping(\''+m.id+'\')">Remove</button>')+'</td></tr>').join('');}
async function addMapping(){const wixField=document.getElementById('new-wix').value.trim();const hubspotProperty=document.getElementById('new-hs').value.trim();const direction=document.getElementById('new-dir').value;if(!wixField||!hubspotProperty){showAlert('mapping-alert','Both fields are required.','error');return;}const d=await api('POST','/api/mappings',{wixField,hubspotProperty,direction});if(d.error){showAlert('mapping-alert',d.error,'error');return;}document.getElementById('new-wix').value='';document.getElementById('new-hs').value='';showAlert('mapping-alert','Mapping saved!','success');loadMappings();}
async function deleteMapping(id){await api('DELETE','/api/mappings?id='+id);loadMappings();}
async function triggerSync(){const btn=document.getElementById('btn-sync');btn.innerHTML='<span class="spinner"></span> Syncing...';btn.disabled=true;document.getElementById('sync-result').style.display='none';try{const d=await api('POST','/api/sync/trigger');if(d.error){showAlert('sync-alert',d.error,'error');return;}document.getElementById('r-synced').textContent=d.summary.synced;document.getElementById('r-skipped').textContent=d.summary.skipped;document.getElementById('r-errors').textContent=d.summary.errors;document.getElementById('sync-result').style.display='block';showAlert('sync-alert','Sync completed - '+d.summary.total+' contacts processed.','success');loadLogs();}catch(e){showAlert('sync-alert','Sync failed: '+e.message,'error');}finally{btn.innerHTML='Trigger Sync Now';btn.disabled=false;}}
async function loadLogs(){const d=await api('GET','/api/sync/logs');const el=document.getElementById('log-list');if(!d.logs||d.logs.length===0){el.innerHTML='<p style="font-size:13px;color:#6b7280">No sync logs yet.</p>';return;}el.innerHTML=d.logs.slice(0,20).map(l=>'<div class="sync-log '+l.status+'"><span style="font-weight:500">'+l.direction+'</span> &nbsp; <span style="color:#6b7280">'+l.status+'</span> &nbsp; '+(l.detail||'')+'<br><span style="font-size:10px;color:#9ca3af">'+new Date(l.ts).toLocaleString()+'</span></div>').join('');}
async function submitForm(){const email=document.getElementById('f-email').value.trim();if(!email){showAlert('form-alert','Email is required.','error');return;}const btn=document.getElementById('btn-form');btn.innerHTML='<span class="spinner"></span> Submitting...';btn.disabled=true;const body={formFields:{firstName:document.getElementById('f-first').value,lastName:document.getElementById('f-last').value,email,phone:document.getElementById('f-phone').value,company:document.getElementById('f-company').value,message:document.getElementById('f-message').value},utmParams:{utm_source:document.getElementById('u-source').value,utm_medium:document.getElementById('u-medium').value,utm_campaign:document.getElementById('u-campaign').value,utm_content:document.getElementById('u-content').value},pageUrl:window.location.href,referrer:document.referrer};try{const d=await api('POST','/api/forms/submit',body);if(d.error){showAlert('form-alert',d.error,'error');return;}showAlert('form-alert','Lead submitted! HubSpot ID: '+d.hubspotId,'success');['f-first','f-last','f-email','f-phone','f-company','f-message','u-source','u-medium','u-campaign','u-content'].forEach(id=>document.getElementById(id).value='');}catch(e){showAlert('form-alert','Submit failed: '+e.message,'error');}finally{btn.innerHTML='Submit to HubSpot';btn.disabled=false;}}
async function loadLeads(){const tbody=document.getElementById('leads-body');tbody.innerHTML='<tr><td colspan="5" style="text-align:center"><span class="spinner"></span></td></tr>';try{const d=await api('GET','/api/leads');if(d.error){tbody.innerHTML='<tr><td colspan="5" style="color:#991b1b;text-align:center">'+d.error+'</td></tr>';return;}if(!d.leads||d.leads.length===0){tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:#6b7280">No contacts found.</td></tr>';return;}tbody.innerHTML=d.leads.map(c=>{const p=c.properties||{};return'<tr><td>'+(p.firstname||'')+' '+(p.lastname||'')+'</td><td>'+(p.email||'&mdash;')+'</td><td>'+(p.phone||'&mdash;')+'</td><td>'+(p.company||'&mdash;')+'</td><td><button class="edit-btn" onclick="openEdit(\''+c.id+'\',\''+(p.firstname||'')+'\',\''+(p.lastname||'')+'\',\''+(p.phone||'')+'\',\''+(p.company||'')+'\')">Edit</button></td></tr>';}).join('');}catch(e){tbody.innerHTML='<tr><td colspan="5" style="color:#991b1b">Error loading leads.</td></tr>';}}
function openEdit(id,first,last,phone,company){document.getElementById('edit-id').value=id;document.getElementById('edit-first').value=first;document.getElementById('edit-last').value=last;document.getElementById('edit-phone').value=phone;document.getElementById('edit-company').value=company;document.getElementById('edit-modal').classList.add('open');}
function closeModal(){document.getElementById('edit-modal').classList.remove('open');}
async function saveContact(){const id=document.getElementById('edit-id').value;const properties={firstname:document.getElementById('edit-first').value,lastname:document.getElementById('edit-last').value,phone:document.getElementById('edit-phone').value,company:document.getElementById('edit-company').value};const d=await api('PATCH','/api/leads',{id,properties});closeModal();if(d.success)loadLeads();}
checkStatus();
</script>
</body>
</html>`);
      return;
    }

    res.writeHead(404, CORS_HEADERS);
    res.end(JSON.stringify({ error: 'Not found', path: pathname }));
    return;
  }

  try {
    const result = await handler(req);
    res.writeHead(result.status, result.headers);
    res.end(result.body);
  } catch (err) {
    console.error(`[API ERROR] ${key}:`, err.message);
    res.writeHead(500, CORS_HEADERS);
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Dev API server running on:", PORT);
});

