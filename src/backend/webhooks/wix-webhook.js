import { syncWixContactToHubSpot } from '../sync/contact-sync.js';
import { wasRecentlySynced } from '../sync/loop-prevention.js';

export async function handleWixContactEvent(event) {
  const { entityId, actionEvent } = event;

  if (!entityId) throw new Error('Missing entityId in Wix webhook event');

  // Skip if this contact was synced from HubSpot recently (loop guard)
  if (wasRecentlySynced(entityId, 'hubspot')) {
    return { status: 'skipped', reason: 'loop-prevention' };
  }

  const contact = actionEvent?.bodyAsJson?.contact ?? actionEvent?.contact;
  if (!contact) throw new Error('No contact payload in Wix event');

  const result = await syncWixContactToHubSpot({ id: entityId, ...contact });
  return { status: 'synced', result };
}

export function parseWixWebhookBody(rawBody) {
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error('Invalid JSON in Wix webhook body');
  }
}
