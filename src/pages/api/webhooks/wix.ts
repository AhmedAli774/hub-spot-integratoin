import type { APIRoute } from 'astro';
import { handleWixContactEvent, parseWixWebhookBody } from '../../../backend/webhooks/wix-webhook.js';
import { json, jsonError, options } from '../_cors';

export const OPTIONS: APIRoute = () => options();

export const POST: APIRoute = async ({ request }) => {
  const rawBody = await request.text();
  let event: unknown;
  try { event = parseWixWebhookBody(rawBody); }
  catch { return jsonError('Invalid payload', 400); }

  try {
    const result = await handleWixContactEvent(event as Record<string, unknown>);
    return json(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Unknown error');
  }
};
