import type { APIRoute } from 'astro';
import { getValidAccessToken } from '../../../backend/auth/token-manager.js';
import { json, jsonError, options } from '../_cors';

const HS_CONTACTS = 'https://api.hubapi.com/crm/v3/objects/contacts';
const PROPS = 'email,firstname,lastname,phone,company,lastmodifieddate';

export const OPTIONS: APIRoute = () => options();

export const GET: APIRoute = async () => {
  const token = await getValidAccessToken();
  if (!token) return jsonError('HubSpot not connected', 401);

  const res = await fetch(
    `${HS_CONTACTS}?limit=100&properties=${PROPS}&archived=false`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const err = await res.text();
    return jsonError(`HubSpot error: ${err}`, res.status);
  }

  const data = (await res.json()) as { results: unknown[] };
  return json({ leads: data.results ?? [] });
};

export const PATCH: APIRoute = async ({ request }) => {
  const token = await getValidAccessToken();
  if (!token) return jsonError('HubSpot not connected', 401);

  const body = (await request.json()) as { id: string; properties: Record<string, string> };
  if (!body?.id) return jsonError('Missing contact id', 400);

  const res = await fetch(`${HS_CONTACTS}/${body.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties: body.properties }),
  });

  if (!res.ok) {
    const err = await res.text();
    return jsonError(`HubSpot error: ${err}`, res.status);
  }

  return json({ success: true });
};
