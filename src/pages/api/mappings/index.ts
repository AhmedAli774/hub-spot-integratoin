import type { APIRoute } from 'astro';
import {
  getFieldMappings,
  saveFieldMapping,
  deleteFieldMapping,
} from '../../../backend/mapping/field-mapping.js';
import { json, jsonError, options } from '../_cors';

export const OPTIONS: APIRoute = () => options();

export const GET: APIRoute = async () => {
  return json({ mappings: getFieldMappings() });
};

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const mapping = body as { id?: string; wixField: string; hubspotProperty: string; direction?: string };
  if (!mapping.wixField || !mapping.hubspotProperty) {
    return jsonError('wixField and hubspotProperty are required', 400);
  }

  try {
    return json({ mapping: saveFieldMapping(mapping) });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Failed to save mapping', 400);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return jsonError('id query param required', 400);
  return json({ deleted: deleteFieldMapping(id) });
};
