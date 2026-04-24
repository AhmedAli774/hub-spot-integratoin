import type { APIRoute } from 'astro';
import { handleFormSubmission } from '../../../backend/forms/form-handler.js';
import { json, jsonError, options } from '../_cors';

export const OPTIONS: APIRoute = () => options();

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const { formFields, utmParams, wixContactId, pageUrl, referrer } = body as {
    formFields: Record<string, string>;
    utmParams?: Record<string, string>;
    wixContactId?: string;
    pageUrl?: string;
    referrer?: string;
  };

  if (!formFields?.email) return jsonError('formFields.email is required', 400);

  try {
    const result = await handleFormSubmission({ formFields, utmParams, wixContactId, pageUrl, referrer });
    return json({ success: true, result });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Unknown error');
  }
};
