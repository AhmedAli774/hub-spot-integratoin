import type { APIRoute } from 'astro';
import { getAuthUrl } from '../../../backend/auth/hubspot-oauth.js';
import { json, options } from '../_cors';

export const OPTIONS: APIRoute = () => options();

export const GET: APIRoute = async () => {
  const url = getAuthUrl();
  return json({ url });
};
