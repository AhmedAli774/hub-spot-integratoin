import { items } from '@wix/data';
import { auth } from '@wix/essentials';
import { refreshAccessToken } from './hubspot-oauth.js';
import { Collections } from '../collections.js';

const SINGLETON_ID = 'singleton';

const elevatedSave = auth.elevate(items.save);
const elevatedGet = auth.elevate(items.get);
const elevatedRemove = auth.elevate(items.remove);

export async function storeTokens({ access_token, refresh_token, expires_in }) {
  await elevatedSave(Collections.TOKENS, {
    _id: SINGLETON_ID,
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: Date.now() + expires_in * 1000,
  });
}

export async function getTokens() {
  const item = await elevatedGet(Collections.TOKENS, SINGLETON_ID);
  if (!item) return null;
  return {
    accessToken: item.accessToken,
    refreshToken: item.refreshToken,
    expiresAt: item.expiresAt,
    isExpired: Date.now() >= item.expiresAt - 60_000,
  };
}

export async function getValidAccessToken() {
  const tokens = await getTokens();
  if (!tokens) return null;
  if (tokens.isExpired) {
    const fresh = await refreshAccessToken(tokens.refreshToken);
    await storeTokens(fresh);
    return fresh.access_token;
  }
  return tokens.accessToken;
}

export async function clearTokens() {
  try {
    await elevatedRemove(Collections.TOKENS, SINGLETON_ID);
  } catch { /* already gone */ }
}

export async function isConnected() {
  return (await getTokens()) !== null;
}
