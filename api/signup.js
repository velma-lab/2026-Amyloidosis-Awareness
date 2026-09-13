// Vercel serverless function — receives sign-up form submissions and pushes
// each campaign, provider, or partner submission into Systeme.io as a contact, tagged 'amyloidosis-campaign'.
//
// Required environment variable (set in Vercel → Project → Settings → Environment Variables):
//   SYSTEME_API_KEY   a Systeme.io public API key
//                      (Settings → MCP & API keys → Public API keys → Create)
//
// No npm dependencies — uses the built-in fetch and the Systeme.io public API
// (https://developer.systeme.io/reference).
//
const API_BASE = 'https://api.systeme.io';
const TAG_NAME = 'amyloidosis-campaign';
const ALLOWED_RESPONSES = new Set(['ambassador', 'story', 'both']);

// Custom fields this form needs, auto-created in Systeme.io if missing so no
// manual dashboard setup is required.
const CUSTOM_FIELDS = [
  { slug: 'join_or_share', fieldName: 'Join or Share' },
  { slug: 'city_state', fieldName: 'City & State' },
  { slug: 'story', fieldName: 'Story' },
  { slug: 'campaign_signup', fieldName: 'Campaign Signup' },
  { slug: 'provider_signup', fieldName: 'Provider Signup' },
  { slug: 'provider_name', fieldName: 'Provider Full Name' },
  { slug: 'provider_specialty', fieldName: 'Provider Specialty' },
  { slug: 'provider_institution', fieldName: 'Provider Institution' },
  { slug: 'provider_interest', fieldName: 'Provider Interest' },
  { slug: 'partner_signup', fieldName: 'Partner Signup' },
  { slug: 'partner_contact_name', fieldName: 'Partner Contact Name' },
  { slug: 'partner_organization', fieldName: 'Partner Organization' },
  { slug: 'partner_interest', fieldName: 'Partner Interest' },
  { slug: 'partner_message', fieldName: 'Partner Message' },
];

// Systeme.io's built-in field slugs aren't fixed across accounts/locales —
// e.g. "last name" turned out to be `surname`, not `last_name`, on this
// account (confirmed via a live 422). So instead of hardcoding slugs, we
// look up the account's actual contact_fields once and pick whichever
// candidate slug really exists, falling back to the most likely guess.
const BUILTIN_FIELD_CANDIDATES = {
  firstName: ['first_name', 'firstname'],
  lastName: ['surname', 'last_name', 'lastname'],
  phone: ['phone_number', 'phone'],
};
const BUILTIN_FIELD_FALLBACK = { firstName: 'first_name', lastName: 'surname', phone: 'phone_number' };

// Warm-lambda caches — best-effort only, reset on cold start. They just save
// redundant lookups; correctness never depends on them surviving.
let builtinFieldSlugs = null;
const ensuredCustomSlugs = new Set();
let cachedTagId = null;

function systemeHeaders(apiKey, extra = {}) {
  return { 'X-API-Key': apiKey, ...extra };
}

// Reads a Response body as text without throwing, for logging/debug detail.
async function bodyOf(res) {
  try {
    return await res.text();
  } catch {
    return '<unreadable body>';
  }
}

function logUpstreamError(label, res, bodyText) {
  console.error(label, res.status, bodyText);
}

// Resolves the real slugs for first name / last name / phone, and makes sure
// this submission's custom fields exist —
// creating any that are missing. Cached per warm lambda instance.
async function ensureFieldSlugs(apiKey, fieldsNeeded) {
  const required = CUSTOM_FIELDS.filter((field) => fieldsNeeded.includes(field.slug));
  if (builtinFieldSlugs && required.every((field) => ensuredCustomSlugs.has(field.slug))) return builtinFieldSlugs;

  let resolved = { ...BUILTIN_FIELD_FALLBACK };
  try {
    const res = await fetch(`${API_BASE}/api/contact_fields?limit=100`, {
      headers: systemeHeaders(apiKey),
    });
    if (!res.ok) {
      console.error('ensureFieldSlugs: list failed', res.status, await bodyOf(res));
      throw new Error('Could not load contact fields');
    }
    const data = await res.json();
    const existingSlugs = new Set((data.items || []).map((f) => f.slug));

    for (const key of Object.keys(BUILTIN_FIELD_CANDIDATES)) {
      const match = BUILTIN_FIELD_CANDIDATES[key].find((slug) => existingSlugs.has(slug));
      if (match) resolved[key] = match;
    }
    builtinFieldSlugs = resolved;

    for (const field of required) {
      if (!existingSlugs.has(field.slug)) {
        const createRes = await fetch(`${API_BASE}/api/contact_fields`, {
          method: 'POST',
          headers: systemeHeaders(apiKey, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ fieldName: field.fieldName, slug: field.slug }),
        });
        if (!createRes.ok) {
          // Another request may have created the field concurrently. Confirm
          // that it now exists instead of treating every 422 as success.
          const check = await fetch(`${API_BASE}/api/contact_fields?limit=100`, {
            headers: systemeHeaders(apiKey),
          });
          const data = check.ok ? await check.json() : {};
          if (!(data.items || []).some((item) => item.slug === field.slug)) {
            throw new Error(`Could not create contact field: ${field.slug}`);
          }
        }
      }
      ensuredCustomSlugs.add(field.slug);
    }
  } catch (err) {
    console.error('ensureFieldSlugs error:', err);
    throw err;
  }

  return resolved;
}

async function getTagId(apiKey) {
  if (cachedTagId) return cachedTagId;

  const search = async () => {
    const res = await fetch(`${API_BASE}/api/tags?query=${encodeURIComponent(TAG_NAME)}&limit=100`, {
      headers: systemeHeaders(apiKey),
    });
    if (!res.ok) {
      console.error('getTagId: search failed', res.status, await bodyOf(res));
      return null;
    }
    const data = await res.json();
    const match = (data.items || []).find((t) => t.name === TAG_NAME);
    return match ? match.id : null;
  };

  const found = await search();
  if (found) {
    cachedTagId = found;
    return cachedTagId;
  }

  // Reuse the existing tag: the free account has room for only one.
  throw new Error(`Could not find existing tag "${TAG_NAME}"`);
}

async function findContactByEmail(apiKey, email) {
  const res = await fetch(`${API_BASE}/api/contacts?email=${encodeURIComponent(email)}`, {
    headers: systemeHeaders(apiKey),
  });
  if (!res.ok) {
    const bodyText = await bodyOf(res);
    console.error('findContactByEmail failed', res.status, bodyText);
    const err = new Error(`Contact lookup failed: ${res.status}`);
    err.detail = { step: 'findContactByEmail', status: res.status, body: bodyText };
    throw err;
  }
  const data = await res.json();
  return (data.items && data.items[0]) || null;
}

function createContact(apiKey, email, fields) {
  return fetch(`${API_BASE}/api/contacts`, {
    method: 'POST',
    headers: systemeHeaders(apiKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, fields }),
  });
}

function updateContact(apiKey, id, fields) {
  return fetch(`${API_BASE}/api/contacts/${id}`, {
    method: 'PATCH',
    headers: systemeHeaders(apiKey, { 'Content-Type': 'application/merge-patch+json' }),
    body: JSON.stringify({ fields }),
  });
}

function assignTag(apiKey, contactId, tagId) {
  return fetch(`${API_BASE}/api/contacts/${contactId}/tags`, {
    method: 'POST',
    headers: systemeHeaders(apiKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ tagId }),
  });
}

function buildFields(builtin, { firstName, lastName, phone, ambassadorResponse, cityState, story }) {
  const fields = [
    { slug: 'campaign_signup', value: 'Yes' },
    { slug: builtin.firstName, value: firstName },
    { slug: builtin.lastName, value: lastName },
    { slug: 'join_or_share', value: ambassadorResponse },
  ];
  if (phone) fields.push({ slug: builtin.phone, value: phone });
  if (cityState) fields.push({ slug: 'city_state', value: cityState });
  if (story) fields.push({ slug: 'story', value: story });
  return fields;
}

function buildAdditionalFields(formType, body, builtin) {
  const mapping = formType === 'provider'
    ? { name: 'provider_name', specialty: 'provider_specialty', institution: 'provider_institution', interest: 'provider_interest' }
    : { contactName: 'partner_contact_name', org: 'partner_organization', interest: 'partner_interest', message: 'partner_message', phone: builtin.phone };
  const fields = [{ slug: `${formType}_signup`, value: 'Yes' }];
  for (const [key, slug] of Object.entries(mapping)) {
    const value = String(body[key] || '').trim().slice(0, key === 'message' ? 10000 : key === 'phone' ? 50 : 200);
    if (value) fields.push({ slug, value });
  }
  return fields;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.SYSTEME_API_KEY;
  if (!apiKey) {
    console.error('SYSTEME_API_KEY is not set');
    return res.status(500).json({ error: 'Server not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const formType = body.formType === undefined ? 'campaign' : body.formType;
  if (!['campaign', 'provider', 'partner'].includes(formType)) {
    return res.status(400).json({ error: 'Invalid form type' });
  }

  const firstName = String(body.firstName || '').trim().slice(0, 200);
  const lastName = String(body.lastName || '').trim().slice(0, 200);
  const email = String(body.email || '').trim().slice(0, 320);
  const phone = String(body.phone || '').trim().slice(0, 50);
  const ambassadorResponse = String(body.ambassadorResponse || '').trim();
  const cityState = String(body.cityState || '').trim().slice(0, 200);
  const story = String(body.story || '').trim().slice(0, 10000);

  if (!email || (formType === 'campaign' && (!firstName || !lastName || !ambassadorResponse))) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  if (formType === 'campaign' && !ALLOWED_RESPONSES.has(ambassadorResponse)) {
    return res.status(400).json({ error: 'Invalid response value' });
  }

  const requiredKeys = formType === 'provider' ? ['name', 'specialty']
    : formType === 'partner' ? ['org', 'contactName', 'interest'] : [];
  if (requiredKeys.some((key) => !String(body[key] || '').trim())) {
    return res.status(400).json({ error: 'Please complete all required fields.' });
  }

  try {
    const needed = CUSTOM_FIELDS.filter((field) => formType === 'campaign'
      ? ['join_or_share', 'city_state', 'story', 'campaign_signup'].includes(field.slug)
      : field.slug.startsWith(`${formType}_`)).map((field) => field.slug);
    const builtin = await ensureFieldSlugs(apiKey, needed);
    const fields = formType === 'campaign'
      ? buildFields(builtin, { firstName, lastName, phone, ambassadorResponse, cityState, story })
      : buildAdditionalFields(formType, body, builtin);

    let contactId;
    const existing = await findContactByEmail(apiKey, email);

    if (existing) {
      const patchRes = await updateContact(apiKey, existing.id, fields);
      if (!patchRes.ok) {
        logUpstreamError('Systeme.io contact update failed', patchRes, await bodyOf(patchRes));
        return res.status(502).json({ error: 'Could not save your sign-up. Please try again shortly.' });
      }
      contactId = existing.id;
    } else {
      const createRes = await createContact(apiKey, email, fields);
      if (createRes.status === 201) {
        const created = await createRes.json();
        contactId = created.id;
      } else if (createRes.status === 422) {
        // Likely a race: the contact was created between our lookup and this
        // request. Re-fetch and update instead of failing the submission.
        const createBody = await bodyOf(createRes);
        console.error('Systeme.io contact create returned 422 (checking for race)', createBody);
        const raced = await findContactByEmail(apiKey, email);
        if (!raced) {
          console.error('Systeme.io contact create failed', createRes.status, createBody);
          return res.status(502).json({
            error: 'Could not save your sign-up. Please check your email address and try again.',
          });
        }
        const patchRes = await updateContact(apiKey, raced.id, fields);
        if (!patchRes.ok) {
          logUpstreamError('Systeme.io fallback update failed', patchRes, await bodyOf(patchRes));
          return res.status(502).json({ error: 'Could not save your sign-up. Please try again shortly.' });
        }
        contactId = raced.id;
      } else {
        logUpstreamError('Systeme.io contact create failed', createRes, await bodyOf(createRes));
        return res.status(502).json({ error: 'Could not save your sign-up. Please try again shortly.' });
      }
    }

    const tagId = await getTagId(apiKey);
    const tagRes = await assignTag(apiKey, contactId, tagId);
    if (!tagRes.ok) {
      logUpstreamError('Systeme.io tag assignment failed', tagRes, await bodyOf(tagRes));
      return res.status(502).json({ error: 'Your info was saved, but tagging failed. We will follow up manually.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Signup handler error:', err, err && err.detail ? JSON.stringify(err.detail) : '');
    return res.status(500).json({
      error: 'Unexpected error saving your sign-up. Please try again shortly.',
    });
  }
}
