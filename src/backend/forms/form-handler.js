import { getValidAccessToken } from '../auth/token-manager.js';
import { markAsSynced } from '../sync/loop-prevention.js';
import { saveMapping, getHubSpotId } from '../sync/id-mapping.js';

const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

const UTM_PROPERTY_MAP = {
  utm_source: 'hs_analytics_source',
  utm_medium: 'hs_analytics_source_data_1',
  utm_campaign: 'hs_analytics_source_data_2',
  utm_term: 'utm_term',
  utm_content: 'utm_content',
};

export async function handleFormSubmission({ formFields, utmParams, wixContactId, pageUrl, referrer }) {
  const properties = {};

  // Standard form fields
  if (formFields.email) properties.email = formFields.email;
  if (formFields.firstName) properties.firstname = formFields.firstName;
  if (formFields.lastName) properties.lastname = formFields.lastName;
  if (formFields.phone) properties.phone = formFields.phone;

  // UTM attribution
  for (const utm of UTM_FIELDS) {
    const value = utmParams?.[utm];
    if (value) properties[UTM_PROPERTY_MAP[utm] ?? utm] = value;
  }

  // Page URL and referrer attribution
  if (pageUrl) properties.hs_analytics_last_url = pageUrl;
  if (referrer) properties.hs_analytics_last_referrer = referrer;

  // Submission timestamp (ISO string → HubSpot date property)
  properties.hs_analytics_last_visit_timestamp = new Date().toISOString();

  if (utmParams && Object.keys(utmParams).length > 0) {
    properties.hs_lead_status = 'NEW';
  }

  const token = await getValidAccessToken();
  if (!token) throw new Error('HubSpot not connected');

  const existingHsId = wixContactId ? await getHubSpotId(wixContactId) : null;
  let result;

  if (existingHsId) {
    result = await upsertContact(token, existingHsId, properties);
  } else {
    result = await createOrUpdateByEmail(token, properties);
    if (wixContactId && result?.id) {
      await saveMapping(wixContactId, result.id);
    }
  }

  if (wixContactId) markAsSynced(wixContactId, 'wix');
  return result;
}

async function upsertContact(token, hsId, properties) {
  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${hsId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) throw new Error(`HubSpot upsert failed: ${await res.text()}`);
  return res.json();
}

async function createOrUpdateByEmail(token, properties) {
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties }),
  });

  if (res.status === 409) {
    const body = await res.json();
    const existingId = body?.message?.match(/ID: (\d+)/)?.[1];
    if (existingId) return upsertContact(token, existingId, properties);
  }

  if (!res.ok) throw new Error(`HubSpot create failed: ${await res.text()}`);
  return res.json();
}
