import type { APIRoute } from 'astro';
import { exchangeCodeForToken } from '../../../backend/auth/hubspot-oauth.js';
import { storeTokens } from '../../../backend/auth/token-manager.js';
import { json, jsonError, options } from '../_cors';

export const OPTIONS: APIRoute = () => options();

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) return jsonError(error, 400);
  if (!code) return jsonError('Missing code parameter', 400);

  try {
    const tokens = await exchangeCodeForToken(code);
    await storeTokens(tokens);
    // Close the popup — dashboard polls /api/auth/status
    return new Response(
      `<html><body><script>window.close();</script>
       <p>Connected! You can close this window.</p></body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonError(message);
  }
};
