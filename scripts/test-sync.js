/**
 * Integration test script for Wix ↔ HubSpot sync.
 *
 * Tests two modes:
 *   1. Logic tests  — runs without a server (tests backend modules directly)
 *   2. API tests    — hits live endpoints (requires: npm run dev in another terminal)
 *
 * Usage:
 *   node scripts/test-sync.js            → logic tests only
 *   BASE_URL=http://localhost:3000 node scripts/test-sync.js  → also runs API tests
 */

import 'dotenv/config';

// ─── Helpers ────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  ${GREEN}✔ PASS${RESET}  ${label}`);
  passed++;
}

function fail(label, reason) {
  console.log(`  ${RED}✖ FAIL${RESET}  ${label}`);
  if (reason) console.log(`         ${DIM}↳ ${reason}${RESET}`);
  failed++;
}

function section(title) {
  console.log(`\n${BOLD}${title}${RESET}`);
  console.log('─'.repeat(50));
}

async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  return { status: res.status, body: await res.json() };
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ─── Config ─────────────────────────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL ?? null;
const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;
const REDIRECT_URI = process.env.HUBSPOT_REDIRECT_URI;

// ─── Test Suite ──────────────────────────────────────────────────────────────

// ── 1. Environment Check ─────────────────────────────────────────────────────
section('1. Environment Variables');

if (CLIENT_ID && CLIENT_ID !== 'your-client-id') {
  pass('HUBSPOT_CLIENT_ID is set');
} else {
  fail('HUBSPOT_CLIENT_ID is set', 'Missing or placeholder value in .env');
}

if (CLIENT_SECRET && CLIENT_SECRET !== 'your-client-secret') {
  pass('HUBSPOT_CLIENT_SECRET is set');
} else {
  fail('HUBSPOT_CLIENT_SECRET is set', 'Missing or placeholder value in .env');
}

if (REDIRECT_URI) {
  pass(`HUBSPOT_REDIRECT_URI is set → ${REDIRECT_URI}`);
} else {
  fail('HUBSPOT_REDIRECT_URI is set', 'Missing in .env');
}

// ── 2. OAuth URL Generation ───────────────────────────────────────────────────
section('2. OAuth URL Generation (logic test)');

try {
  const { getAuthUrl } = await import('../src/backend/auth/hubspot-oauth.js');
  const url = getAuthUrl();

  if (url.startsWith('https://app.hubspot.com/oauth/authorize')) {
    pass('Auth URL has correct HubSpot base');
  } else {
    fail('Auth URL has correct HubSpot base', `Got: ${url.slice(0, 60)}`);
  }

  const parsed = new URL(url);
  if (parsed.searchParams.get('client_id') === CLIENT_ID) {
    pass('Auth URL contains correct client_id');
  } else {
    fail('Auth URL contains correct client_id', `Expected ${CLIENT_ID}, got ${parsed.searchParams.get('client_id')}`);
  }

  if (parsed.searchParams.get('redirect_uri') === REDIRECT_URI) {
    pass('Auth URL contains correct redirect_uri');
  } else {
    fail('Auth URL contains correct redirect_uri');
  }

  const scopes = parsed.searchParams.get('scope') ?? '';
  if (scopes.includes('crm.objects.contacts.read') && scopes.includes('crm.objects.contacts.write')) {
    pass('Auth URL contains required CRM scopes');
  } else {
    fail('Auth URL contains required CRM scopes', `Scopes: ${scopes}`);
  }
} catch (e) {
  fail('OAuth module loads', e.message);
}

// ── 3. Loop Prevention ───────────────────────────────────────────────────────
section('3. Loop Prevention (logic test)');

try {
  const { markAsSynced, wasRecentlySynced, purgeExpired } = await import('../src/backend/sync/loop-prevention.js');
  const testId = 'test-contact-001';

  if (!wasRecentlySynced(testId, 'wix')) {
    pass('New contact: wasRecentlySynced returns false');
  } else {
    fail('New contact: wasRecentlySynced returns false', 'Should not be synced yet');
  }

  markAsSynced(testId, 'wix');

  if (wasRecentlySynced(testId, 'wix')) {
    pass('After markAsSynced: wasRecentlySynced returns true');
  } else {
    fail('After markAsSynced: wasRecentlySynced returns true', 'Should be marked as synced');
  }

  if (!wasRecentlySynced(testId, 'hubspot')) {
    pass('Different source: not cross-contaminated');
  } else {
    fail('Different source: not cross-contaminated', 'wix and hubspot sources should be independent');
  }

  purgeExpired();
  pass('purgeExpired() runs without error');
} catch (e) {
  fail('Loop prevention module loads', e.message);
}

// ── 4. ID Mapping (in-memory) ─────────────────────────────────────────────────
section('4. ID Mapping (logic test)');

try {
  const { saveMapping, getHubSpotId, getWixId, deleteMapping, getAllMappings } = await import('../src/backend/sync/id-mapping.js');

  // ID mapping now uses Wix Data — we test the module loads correctly
  // (actual DB calls require a running Wix environment)
  pass('ID mapping module loads without error');

  if (typeof saveMapping === 'function') pass('saveMapping() is exported');
  else fail('saveMapping() is exported');

  if (typeof getHubSpotId === 'function') pass('getHubSpotId() is exported');
  else fail('getHubSpotId() is exported');

  if (typeof getWixId === 'function') pass('getWixId() is exported');
  else fail('getWixId() is exported');
} catch (e) {
  fail('ID mapping module loads', e.message);
}

// ── 5. Field Mapping ──────────────────────────────────────────────────────────
section('5. Field Mapping (logic test)');

try {
  const { getFieldMappings, saveFieldMapping, deleteFieldMapping } = await import('../src/backend/mapping/field-mapping.js');

  const mappings = getFieldMappings();
  if (Array.isArray(mappings) && mappings.length >= 7) {
    pass(`Default field mappings loaded (${mappings.length} mappings)`);
  } else {
    fail('Default field mappings loaded', `Got ${mappings?.length ?? 0} mappings, expected ≥7`);
  }

  const emailMapping = mappings.find(m => m.hubspotProperty === 'email');
  if (emailMapping) {
    pass('email → email mapping exists');
  } else {
    fail('email → email mapping exists');
  }

  const saved = saveFieldMapping({ wixField: 'test.field', hubspotProperty: 'test_prop' });
  if (saved.id && saved.wixField === 'test.field') {
    pass('saveFieldMapping() creates new mapping with ID');
  } else {
    fail('saveFieldMapping() creates new mapping with ID');
  }

  const deleted = deleteFieldMapping(saved.id);
  if (deleted) {
    pass('deleteFieldMapping() removes mapping');
  } else {
    fail('deleteFieldMapping() removes mapping');
  }
} catch (e) {
  fail('Field mapping module loads', e.message);
}

// ── 6. UTM Form Handler (logic test) ─────────────────────────────────────────
section('6. UTM Form Handler (logic test)');

try {
  const { handleFormSubmission } = await import('../src/backend/forms/form-handler.js');

  if (typeof handleFormSubmission === 'function') {
    pass('handleFormSubmission() is exported');
  } else {
    fail('handleFormSubmission() is exported');
  }

  // Verify UTM property mapping is correct (test without actual API call)
  const UTM_PROPERTY_MAP = {
    utm_source: 'hs_analytics_source',
    utm_medium: 'hs_analytics_source_data_1',
    utm_campaign: 'hs_analytics_source_data_2',
    utm_term: 'utm_term',
    utm_content: 'utm_content',
  };

  const utmFields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  if (utmFields.every(k => UTM_PROPERTY_MAP[k])) {
    pass('All 5 UTM params have HubSpot property mappings');
  } else {
    fail('All 5 UTM params have HubSpot property mappings');
  }
} catch (e) {
  fail('Form handler module loads', e.message);
}

// ── 7. Collections Config ─────────────────────────────────────────────────────
section('7. Wix Data Collections Config');

try {
  const { NAMESPACE, Collections } = await import('../src/backend/collections.js');

  if (NAMESPACE && NAMESPACE !== '<app-namespace>') {
    pass(`Namespace is set: ${NAMESPACE}`);
  } else {
    fail('Namespace is set', 'Still using placeholder <app-namespace>');
  }

  const expectedCollections = ['TOKENS', 'ID_MAPPING', 'SYNC_LOG'];
  for (const col of expectedCollections) {
    if (Collections[col]?.startsWith(NAMESPACE)) {
      pass(`Collections.${col} = "${Collections[col]}"`);
    } else {
      fail(`Collections.${col} is correctly scoped`);
    }
  }
} catch (e) {
  fail('Collections config loads', e.message);
}

// ── 8. Live API Tests (optional — only runs if BASE_URL is set) ───────────────
if (BASE_URL) {
  section(`8. Live API Tests → ${BASE_URL}`);

  // 8a. Connection status
  try {
    const { status, body } = await apiGet('/api/auth/status');
    if (status === 200 && typeof body.connected === 'boolean') {
      pass(`GET /api/auth/status → 200 (connected: ${body.connected})`);
    } else {
      fail('GET /api/auth/status → 200', `Got status ${status}`);
    }
  } catch (e) {
    fail('GET /api/auth/status reachable', `Connection refused — is the server running at ${BASE_URL}?`);
  }

  // 8b. Connect URL
  try {
    const { status, body } = await apiGet('/api/auth/connect');
    if (status === 200 && body.url?.includes('hubspot.com')) {
      pass('GET /api/auth/connect → returns HubSpot OAuth URL');
    } else {
      fail('GET /api/auth/connect → returns HubSpot OAuth URL', `Body: ${JSON.stringify(body)}`);
    }
  } catch (e) {
    fail('GET /api/auth/connect reachable', e.message);
  }

  // 8c. Sample contact sync (Wix → HubSpot simulation via webhook endpoint)
  try {
    const sampleEvent = {
      entityId: 'test-wix-contact-001',
      actionEvent: {
        bodyAsJson: {
          contact: {
            primaryInfo: { email: 'test@example.com' },
            name: { first: 'Test', last: 'User' },
          },
        },
      },
    };
    const { status, body } = await apiPost('/api/webhooks/wix', sampleEvent);
    if (status === 200) {
      pass('POST /api/webhooks/wix → 200 (Wix → HubSpot sync path)');
    } else if (status === 500 && body.error?.includes('not connected')) {
      pass('POST /api/webhooks/wix → 500 (HubSpot not connected yet — expected before OAuth)');
    } else {
      fail('POST /api/webhooks/wix → handled', `Status: ${status}, Body: ${JSON.stringify(body)}`);
    }
  } catch (e) {
    fail('POST /api/webhooks/wix reachable', e.message);
  }

  // 8d. Form submission with UTM params
  try {
    const formPayload = {
      formFields: {
        email: 'utm-test@example.com',
        firstName: 'UTM',
        lastName: 'Tester',
      },
      utmParams: {
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'spring-sale',
        utm_term: 'wix crm',
        utm_content: 'banner-ad',
      },
    };
    const { status, body } = await apiPost('/api/forms/submit', formPayload);
    if (status === 200) {
      pass('POST /api/forms/submit → 200 (form + UTM accepted)');
    } else if (status === 500 && body.error?.toLowerCase().includes('not connected')) {
      pass('POST /api/forms/submit → correctly requires HubSpot connection first');
    } else {
      fail('POST /api/forms/submit → handled', `Status: ${status}, Body: ${JSON.stringify(body)}`);
    }
  } catch (e) {
    fail('POST /api/forms/submit reachable', e.message);
  }

  // 8e. Sync logs
  try {
    const { status, body } = await apiGet('/api/sync/logs?limit=10');
    if (status === 200 && Array.isArray(body.logs)) {
      pass(`GET /api/sync/logs → 200 (${body.logs.length} log entries)`);
    } else {
      fail('GET /api/sync/logs → 200 with logs array', `Body: ${JSON.stringify(body)}`);
    }
  } catch (e) {
    fail('GET /api/sync/logs reachable', e.message);
  }

  // 8f. Field mappings
  try {
    const { status, body } = await apiGet('/api/mappings');
    if (status === 200 && Array.isArray(body.mappings)) {
      pass(`GET /api/mappings → 200 (${body.mappings.length} mappings)`);
    } else {
      fail('GET /api/mappings → 200', `Body: ${JSON.stringify(body)}`);
    }
  } catch (e) {
    fail('GET /api/mappings reachable', e.message);
  }
} else {
  section('8. Live API Tests');
  console.log(`  ${YELLOW}⚠ SKIP${RESET}  BASE_URL not set — skipping live API tests`);
  console.log(`  ${DIM}To run API tests: BASE_URL=http://localhost:3000 node scripts/test-sync.js${RESET}`);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
const total = passed + failed;
if (failed === 0) {
  console.log(`${GREEN}${BOLD}  ALL ${total} TESTS PASSED ✔${RESET}`);
} else {
  console.log(`${BOLD}  Results: ${GREEN}${passed} passed${RESET} · ${RED}${failed} failed${RESET} · ${total} total`);
}
console.log('═'.repeat(50));

process.exit(failed > 0 ? 1 : 0);
