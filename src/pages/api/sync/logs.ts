import type { APIRoute } from 'astro';
import { items } from '@wix/data';
import { auth } from '@wix/essentials';
import { Collections } from '../../../backend/collections.js';
import { json, options } from '../_cors';

const elevatedInsert = auth.elevate(items.insert);
const elevatedQuery = auth.elevate(items.query);

export async function appendSyncLog(entry: {
  direction: string;
  status: string;
  contactId: string;
  detail?: string;
}): Promise<void> {
  await elevatedInsert(Collections.SYNC_LOG, {
    syncId: crypto.randomUUID(),
    source: entry.direction,
    action: entry.direction,
    status: entry.status,
    contactId: entry.contactId,
    detail: entry.detail ?? '',
  });
}

export const OPTIONS: APIRoute = () => options();

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

  try {
    const result = await elevatedQuery(Collections.SYNC_LOG)
      .descending('_createdDate')
      .limit(limit)
      .find();

    const logs = result.items.map((item) => ({
      ts: (item._createdDate as Date | undefined)?.getTime() ?? Date.now(),
      direction: item.source as string,
      status: item.status as string,
      contactId: item.contactId as string,
      detail: (item.detail as string | undefined) ?? '',
    }));

    return json({ logs });
  } catch {
    return json({ logs: [] });
  }
};
