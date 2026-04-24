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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f5f7; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: white; border-radius: 12px; padding: 48px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); text-align: center; max-width: 480px; width: 90%; }
    .logo { font-size: 48px; margin-bottom: 16px; }
    h1 { color: #1a1a2e; font-size: 24px; margin-bottom: 8px; }
    p { color: #6b7280; font-size: 15px; line-height: 1.6; margin-bottom: 24px; }
    .badge { display: inline-block; background: #dcfce7; color: #166534; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 24px; }
    .api-list { background: #f8f9fa; border-radius: 8px; padding: 16px; text-align: left; }
    .api-list p { color: #374151; font-size: 13px; margin-bottom: 4px; font-family: monospace; }
    .api-list p:last-child { margin-bottom: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🔗</div>
    <h1>HubSpot Integration</h1>
    <div class="badge">✅ Server Running</div>
    <p>This backend powers your Wix ↔ HubSpot integration. Open the app from your <strong>Wix Dashboard</strong> to manage contacts and sync settings.</p>
    <div class="api-list">
      <p>GET  /api/auth/status</p>
      <p>GET  /api/auth/connect</p>
      <p>POST /api/sync/trigger</p>
      <p>GET  /api/leads</p>
      <p>POST /api/forms/submit</p>
    </div>
  </div>
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

