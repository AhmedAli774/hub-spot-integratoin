const HUBSPOT_AUTH_URL = 'https://app.hubspot.com/oauth/authorize';
const HUBSPOT_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.schemas.contacts.read',
].join(' ');

export function getAuthUrl() {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const redirectUri = process.env.HUBSPOT_REDIRECT_URI;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    response_type: 'code',
  });
  return `${HUBSPOT_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.HUBSPOT_CLIENT_ID,
    client_secret: process.env.HUBSPOT_CLIENT_SECRET,
    redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
    code,
  });

  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HubSpot token exchange failed: ${err}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.HUBSPOT_CLIENT_ID,
    client_secret: process.env.HUBSPOT_CLIENT_SECRET,
    refresh_token: refreshToken,
  });

  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HubSpot token refresh failed: ${err}`);
  }
  return res.json();
}
