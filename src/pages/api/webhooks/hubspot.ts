import type { APIRoute } from 'astro';
import { verifyHubSpotSignature, handleHubSpotContactEvents } from '../../../backend/webhooks/hubspot-webhook.js';
import { json, jsonError, options } from '../_cors';

export const OPTIONS: APIRoute = () => options();

export const POST: APIRoute = async ({ request }) => {
  const rawBody = await request.text();
  const signature = request.headers.get('X-HubSpot-Signature') ?? '';
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET ?? '';

  if (signature && !verifyHubSpotSignature(rawBody, signature, clientSecret)) {
    return jsonError('Invalid signature', 401);
  }

  let events: unknown[];
  try { events = JSON.parse(rawBody); }
  catch { return jsonError('Invalid JSON', 400); }

  const wixApiClient = {
    createContact: async (data: Record<string, unknown>) => ({ contactId: 'new', ...data }),
    updateContact: async (id: string, data: Record<string, unknown>) => ({ contactId: id, ...data }),
  };

  const results = await handleHubSpotContactEvents(events as Record<string, unknown>[], wixApiClient);
  return json({ results });
};
