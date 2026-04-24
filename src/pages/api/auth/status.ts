import type { APIRoute } from 'astro';
import { getTokens } from '../../../backend/auth/token-manager.js';
import { json, options } from '../_cors';

export const OPTIONS: APIRoute = () => options();

export const GET: APIRoute = async () => {
  const tokens = await getTokens();
  return json({ connected: tokens !== null, expiresAt: tokens?.expiresAt ?? null });
};
