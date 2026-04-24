import { items } from '@wix/data';
import { auth } from '@wix/essentials';
import { Collections } from '../collections.js';

const elevatedSave = auth.elevate(items.save);
const elevatedQuery = auth.elevate(items.query);
const elevatedRemove = auth.elevate(items.remove);

export async function saveMapping(wixContactId, hubspotContactId) {
  // Use wixContactId as _id so save() acts as upsert
  await elevatedSave(Collections.ID_MAPPING, {
    _id: wixContactId,
    wixContactId,
    hubspotContactId,
    lastSyncedAt: new Date(),
  });
}

export async function getHubSpotId(wixContactId) {
  const item = await (auth.elevate(items.get))(Collections.ID_MAPPING, wixContactId);
  return item?.hubspotContactId ?? null;
}

export async function getWixId(hubspotContactId) {
  const result = await elevatedQuery(Collections.ID_MAPPING)
    .eq('hubspotContactId', hubspotContactId)
    .limit(1)
    .find();
  return result.items[0]?.wixContactId ?? null;
}

export async function deleteMapping(wixContactId) {
  try {
    await elevatedRemove(Collections.ID_MAPPING, wixContactId);
  } catch { /* not found */ }
}

export async function getAllMappings() {
  const result = await elevatedQuery(Collections.ID_MAPPING).limit(1000).find();
  return result.items.map((item) => ({
    wixId: item.wixContactId,
    hubspotId: item.hubspotContactId,
    lastSyncedAt: item.lastSyncedAt,
  }));
}
