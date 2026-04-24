/**
 * CORS headers for API endpoints.
 * Allows Wix Studio (any Wix origin) and ngrok tunnels to call our API.
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Wix-*',
  'Content-Type': 'application/json',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: CORS_HEADERS,
  });
}

export function jsonError(message: string, status = 500): Response {
  return json({ error: message }, status);
}

/** Handle pre-flight OPTIONS requests automatically */
export function options(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
