import crypto from 'crypto';
import { wasRecentlySynced } from '../sync/loop-prevention.js';

export function verifyHubSpotSignature(rawBody, signature, clientSecret) {
  const expected = crypto
    .createHmac('sha256', clientSecret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function handleHubSpotContactEvents(events, wixApiClient) {
  const results = [];

  for (const event of events) {
    const { objectId, propertyName, subscriptionType } = event;

    if (!['contact.creation', 'contact.propertyChange'].includes(subscriptionType)) {
      results.push({ objectId, status: 'ignored', subscriptionType });
      continue;
    }

    // Skip contacts recently synced FROM Wix to prevent loops
    if (wasRecentlySynced(String(objectId), 'wix')) {
      results.push({ objectId, status: 'skipped', reason: 'loop-prevention' });
      continue;
    }

    try {
      const { syncHubSpotContactToWix } = await import('../sync/contact-sync.js');
      const hsContact = await fetchHubSpotContact(objectId);
      const result = await syncHubSpotContactToWix(hsContact, wixApiClient);
      results.push({ objectId, status: 'synced', result });
    } catch (err) {
      results.push({ objectId, status: 'error', error: err.message });
    }
  }

  return results;
}

async function fetchHubSpotContact(contactId) {
  const { getValidAccessToken } = await import('../auth/token-manager.js');
  const token = await getValidAccessToken();
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname,phone,city,country,zip`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Failed to fetch HubSpot contact ${contactId}`);
  return res.json();
}
