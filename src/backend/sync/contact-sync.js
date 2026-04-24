import { getValidAccessToken } from '../auth/token-manager.js';
import { markAsSynced, wasRecentlySynced } from './loop-prevention.js';
import { saveMapping, getHubSpotId, getWixId } from './id-mapping.js';
import { getFieldMappings } from '../mapping/field-mapping.js';

const HUBSPOT_CONTACTS_URL = 'https://api.hubapi.com/crm/v3/objects/contacts';

async function hsRequest(method, path, body) {
  const token = await getValidAccessToken();
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

// Filters mappings by sync direction and builds property map
function applyMappings(sourceContact, syncDirection, mappings) {
  const props = {};
  for (const m of mappings) {
    const dir = m.direction ?? 'bidirectional';
    // Skip if this mapping doesn't apply in the current sync direction
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

export async function syncWixContactToHubSpot(wixContact) {
  if (wasRecentlySynced(wixContact.id, 'wix')) return { skipped: true, reason: 'dedup_window' };

  const mappings = getFieldMappings();
  const existingHsId = await getHubSpotId(wixContact.id);

  // Conflict handling: last updated wins
  if (existingHsId && wixContact.updatedDate) {
    try {
      const hsContact = await hsRequest('GET', `/${existingHsId}?properties=lastmodifieddate`);
      const hsUpdatedMs = hsContact?.properties?.lastmodifieddate
        ? new Date(hsContact.properties.lastmodifieddate).getTime()
        : 0;
      const wixUpdatedMs = new Date(wixContact.updatedDate).getTime();
      if (hsUpdatedMs > wixUpdatedMs) {
        return { skipped: true, reason: 'hubspot_newer' };
      }
    } catch { /* if fetch fails, proceed with sync */ }
  }

  const properties = applyMappings(wixContact, 'wix-to-hubspot', mappings);
  let result;

  if (existingHsId) {
    result = await hsRequest('PATCH', `/${existingHsId}`, { properties });
  } else {
    const email = wixContact.primaryInfo?.email ?? wixContact.email;
    if (email) {
      const search = await hsRequest('POST', '/search', {
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
        limit: 1,
      });
      if (search.results?.length > 0) {
        const hsId = search.results[0].id;
        await saveMapping(wixContact.id, hsId);
        result = await hsRequest('PATCH', `/${hsId}`, { properties });
      } else {
        result = await hsRequest('POST', '', { properties });
        await saveMapping(wixContact.id, result.id);
      }
    } else {
      result = await hsRequest('POST', '', { properties });
      await saveMapping(wixContact.id, result.id);
    }
  }

  markAsSynced(wixContact.id, 'wix');
  return result;
}

export async function syncHubSpotContactToWix(hubspotContact, wixApiClient) {
  if (wasRecentlySynced(hubspotContact.id, 'hubspot')) return { skipped: true, reason: 'dedup_window' };

  const mappings = getFieldMappings();
  const contactData = applyMappings(hubspotContact.properties, 'hubspot-to-wix', mappings);

  const existingWixId = await getWixId(hubspotContact.id);
  let result;

  if (existingWixId) {
    result = await wixApiClient.updateContact(existingWixId, contactData);
  } else {
    result = await wixApiClient.createContact(contactData);
    await saveMapping(result.contactId, hubspotContact.id);
  }

  markAsSynced(hubspotContact.id, 'hubspot');
  return result;
}
