// Vercel serverless function — receives sign-up form submissions and pushes
// each one into Systeme.io as a contact, tagged 'amyloidosis-campaign'.
//
// Required environment variable (set in Vercel → Project → Settings → Environment Variables):
//   SYSTEME_API_KEY   a Systeme.io public API key
//                      (Settings → MCP & API keys → Public API keys → Create)
//
// No npm dependencies — uses the built-in fetch and the Systeme.io public API
// (https://developer.systeme.io/reference).
//
// TEMPORARY DEBUG MODE: every error response below includes a `detail` field
// with the exact upstream Systeme.io status code + response body, and the
// same is logged via console.error. Remove the `detail` fields (and the
// bodyOf() logging) once the live failure is diagnosed — they can leak
// upstream error text to the browser, which is fine for us debugging but not
// for production.

const API_BASE = 'https://api.systeme.io';
const TAG_NAME = 'amyloidosis-campaign';
const ALLOWED_RESPONSES = new Set(['ambassador', 'story', 'both']);

// Custom fields this form needs, auto-created in Systeme.io if missing so no
// manual dashboard setup is required.
const CUSTOM_FIELDS = [
  { slug: 'join_or_share', fieldName: 'Join or Share' },
  { slug: 'city_state', fieldName: 'City & State' },
  { slug: 'story', fieldName: 'Story' },
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
let customFieldsEnsured = false;
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

function logAndDetail(label, res, bodyText) {
  console.error(label, res.status, bodyText);
  return { step: label, status: res.status, body: bodyText };
}

// Resolves the real slugs for first name / last name / phone, and makes sure
// this campaign's custom fields (join_or_share, city_state, story) exist —
// creating any that are missing. Cached per warm lambda instance.
async function ensureFieldSlugs(apiKey) {
  if (builtinFieldSlugs && customFieldsEnsured) return builtinFieldSlugs;

  let resolved = { ...BUILTIN_FIELD_FALLBACK };
  try {
    const res = await fetch(`${API_BASE}/api/contact_fields?limit=100`, {
      headers: systemeHeaders(apiKey),
    });
    if (!res.ok) {
      console.error('ensureFieldSlugs: list failed', res.status, await bodyOf(res));
      builtinFieldSlugs = resolved;
      return resolved;
    }
    const data = await res.json();
    const existingSlugs = new Set((data.items || []).map((f) => f.slug));

    for (const key of Object.keys(BUILTIN_FIELD_CANDIDATES)) {
      const match = BUILTIN_FIELD_CANDIDATES[key].find((slug) => existingSlugs.has(slug));
      if (match) resolved[key] = match;
    }
    builtinFieldSlugs = resolved;

    if (!customFieldsEnsured) {
      const missing = CUSTOM_FIELDS.filter((f) => !existingSlugs.has(f.slug));
      for (const field of missing) {
        const createRes = await fetch(`${API_BASE}/api/contact_fields`, {
          method: 'POST',
          headers: systemeHeaders(apiKey, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ fieldName: field.fieldName, slug: field.slug }),
        });
        if (!createRes.ok && createRes.status !== 422) {
          console.error('Could not create custom field', field.slug, createRes.status, await bodyOf(createRes));
        }
      }
      customFieldsEnsured = true;
    }
  } catch (err) {
    console.error('ensureFieldSlugs error:', err);
    builtinFieldSlugs = resolved;
    // Non-fatal — continue with fallback slugs; the contact write will
    // surface any real problem.
  }

  return resolved;
}

async function getOrCreateTagId(apiKey) {
  if (cachedTagId) return cachedTagId;

  const search = async () => {
    const res = await fetch(`${API_BASE}/api/tags?query=${encodeURIComponent(TAG_NAME)}&limit=100`, {
      headers: systemeHeaders(apiKey),
    });
    if (!res.ok) {
      console.error('getOrCreateTagId: search failed', res.status, await bodyOf(res));
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

  const createRes = await fetch(`${API_BASE}/api/tags`, {
    method: 'POST',
    headers: systemeHeaders(apiKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: TAG_NAME }),
  });
  if (createRes.ok) {
    const created = await createRes.json();
    cachedTagId = created.id;
    return cachedTagId;
  }
  const createBody = await bodyOf(createRes);
  console.error('getOrCreateTagId: create failed', createRes.status, createBody);

  // Race: another concurrent request may have just created it.
  const retryFound = await search();
  if (retryFound) {
    cachedTagId = retryFound;
    return cachedTagId;
  }

  const err = new Error(`Could not find or create tag "${TAG_NAME}"`);
  err.detail = { step: 'getOrCreateTagId', status: createRes.status, body: createBody };
  throw err;
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
    { slug: builtin.firstName, value: firstName },
    { slug: builtin.lastName, value: lastName },
    { slug: 'join_or_share', value: ambassadorResponse },
  ];
  if (phone) fields.push({ slug: builtin.phone, value: phone });
  if (cityState) fields.push({ slug: 'city_state', value: cityState });
  if (story) fields.push({ slug: 'story', value: story });
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
    return res.status(500).json({ error: 'Server not configured', detail: { step: 'env', message: 'SYSTEME_API_KEY is not set' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const firstName = String(body.firstName || '').trim().slice(0, 200);
  const lastName = String(body.lastName || '').trim().slice(0, 200);
  const email = String(body.email || '').trim().slice(0, 320);
  const phone = String(body.phone || '').trim().slice(0, 50);
  const ambassadorResponse = String(body.ambassadorResponse || '').trim();
  const cityState = String(body.cityState || '').trim().slice(0, 200);
  const story = String(body.story || '').trim().slice(0, 10000);

  if (!firstName || !lastName || !email || !ambassadorResponse) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  if (!ALLOWED_RESPONSES.has(ambassadorResponse)) {
    return res.status(400).json({ error: 'Invalid response value' });
  }

  try {
    const builtin = await ensureFieldSlugs(apiKey);
    const fields = buildFields(builtin, { firstName, lastName, phone, ambassadorResponse, cityState, story });

    let contactId;
    const existing = await findContactByEmail(apiKey, email);

    if (existing) {
      const patchRes = await updateContact(apiKey, existing.id, fields);
      if (!patchRes.ok) {
        const detail = logAndDetail('Systeme.io contact update failed', patchRes, await bodyOf(patchRes));
        return res.status(502).json({ error: 'Could not save your sign-up. Please try again shortly.', detail });
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
            detail: { step: 'createContact', status: createRes.status, body: createBody },
          });
        }
        const patchRes = await updateContact(apiKey, raced.id, fields);
        if (!patchRes.ok) {
          const detail = logAndDetail('Systeme.io fallback update failed', patchRes, await bodyOf(patchRes));
          return res.status(502).json({ error: 'Could not save your sign-up. Please try again shortly.', detail });
        }
        contactId = raced.id;
      } else {
        const detail = logAndDetail('Systeme.io contact create failed', createRes, await bodyOf(createRes));
        return res.status(502).json({ error: 'Could not save your sign-up. Please try again shortly.', detail });
      }
    }

    const tagId = await getOrCreateTagId(apiKey);
    const tagRes = await assignTag(apiKey, contactId, tagId);
    if (!tagRes.ok) {
      const detail = logAndDetail('Systeme.io tag assignment failed', tagRes, await bodyOf(tagRes));
      return res.status(502).json({ error: 'Your info was saved, but tagging failed. We will follow up manually.', detail });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Signup handler error:', err, err && err.detail ? JSON.stringify(err.detail) : '');
    return res.status(500).json({
      error: 'Unexpected error saving your sign-up. Please try again shortly.',
      detail: (err && err.detail) || { message: err && err.message },
    });
  }
}
