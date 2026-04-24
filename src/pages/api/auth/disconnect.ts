import type { APIRoute } from 'astro';
import { clearTokens } from '../../../backend/auth/token-manager.js';
import { json, options } from '../_cors';

export const OPTIONS: APIRoute = () => options();

export const POST: APIRoute = async () => {
  await clearTokens();
  return json({ success: true });
};
