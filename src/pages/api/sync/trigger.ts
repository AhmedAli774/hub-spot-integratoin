import type { APIRoute } from 'astro';
import { isConnected } from '../../../backend/auth/token-manager.js';
import { json, jsonError, options } from '../_cors';

export const OPTIONS: APIRoute = () => options();

export const POST: APIRoute = async () => {
  if (!(await isConnected())) {
    return jsonError('HubSpot not connected', 400);
  }
  return json({ status: 'triggered' }, 202);
};
