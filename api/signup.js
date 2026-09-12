// Vercel serverless function — receives sign-up form submissions and pushes
// each one into Systeme.io as a contact, tagged 'amyloidosis-campaign'.
//
// Required environment variable (set in Vercel → Project → Settings → Environment Variables):
//   SYSTEME_API_KEY   a Systeme.io public API key
//                      (Settings → MCP & API keys → Public API keys → Create)
//
// No npm dependencies — uses the built-in fetch and the Systeme.io public API
// (https://developer.systeme.io/reference).

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

// Warm-lambda caches — best-effort only, reset on cold start. They just save
// redundant lookups; correctness never depends on them surviving.
let customFieldsEnsured = false;
let cachedTagId = null;

function systemeHeaders(apiKey, extra = {}) {
  return { 'X-API-Key': apiKey, ...extra };
}

async function ensureCustomFields(apiKey) {
  if (customFieldsEnsured) return;
  try {
    const res = await fetch(`${API_BASE}/api/contact_fields?limit=100`, {
      headers: systemeHeaders(apiKey),
    });
    if (!res.ok) return; // Non-fatal — fields may already exist.
    const data = await res.json();
    const existingSlugs = new Set((data.items || []).map((f) => f.slug));
    const missing = CUSTOM_FIELDS.filter((f) => !existingSlugs.has(f.slug));
    for (const field of missing) {
      const createRes = await fetch(`${API_BASE}/api/contact_fields`, {
        method: 'POST',
        headers: systemeHeaders(apiKey, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ fieldName: field.fieldName, slug: field.slug }),
      });
      if (!createRes.ok && createRes.status !== 422) {
        console.error('Could not create custom field', field.slug, createRes.status, await createRes.text());
      }
    }
    customFieldsEnsured = true;
  } catch (err) {
    console.error('ensureCustomFields error:', err);
    // Non-fatal — continue; the contact write will surface any real problem.
  }
}

async function getOrCreateTagId(apiKey) {
  if (cachedTagId) return cachedTagId;

  const search = async () => {
    const res = await fetch(`${API_BASE}/api/tags?query=${encodeURIComponent(TAG_NAME)}&limit=100`, {
      headers: systemeHeaders(apiKey),
    });
    if (!res.ok) return null;
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

  // Race: another concurrent request may have just created it.
  const retryFound = await search();
  if (retryFound) {
    cachedTagId = retryFound;
    return cachedTagId;
  }

  throw new Error(`Could not find or create tag "${TAG_NAME}"`);
}

async function findContactByEmail(apiKey, email) {
  const res = await fetch(`${API_BASE}/api/contacts?email=${encodeURIComponent(email)}`, {
    headers: systemeHeaders(apiKey),
  });
  if (!res.ok) throw new Error(`Contact lookup failed: ${res.status}`);
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

function buildFields({ firstName, lastName, phone, ambassadorResponse, cityState, story }) {
  const fields = [
    { slug: 'first_name', value: firstName },
    { slug: 'last_name', value: lastName },
    { slug: 'join_or_share', value: ambassadorResponse },
  ];
  if (phone) fields.push({ slug: 'phone_number', value: phone });
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
    return res.status(500).json({ error: 'Server not configured' });
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

  const fields = buildFields({ firstName, lastName, phone, ambassadorResponse, cityState, story });

  try {
    await ensureCustomFields(apiKey);

    let contactId;
    const existing = await findContactByEmail(apiKey, email);

    if (existing) {
      const patchRes = await updateContact(apiKey, existing.id, fields);
      if (!patchRes.ok) {
        console.error('Systeme.io contact update failed', patchRes.status, await patchRes.text());
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
        const raced = await findContactByEmail(apiKey, email);
        if (!raced) {
          console.error('Systeme.io contact create failed', createRes.status, await createRes.text());
          return res.status(502).json({ error: 'Could not save your sign-up. Please check your email address and try again.' });
        }
        const patchRes = await updateContact(apiKey, raced.id, fields);
        if (!patchRes.ok) {
          console.error('Systeme.io fallback update failed', patchRes.status, await patchRes.text());
          return res.status(502).json({ error: 'Could not save your sign-up. Please try again shortly.' });
        }
        contactId = raced.id;
      } else {
        console.error('Systeme.io contact create failed', createRes.status, await createRes.text());
        return res.status(502).json({ error: 'Could not save your sign-up. Please try again shortly.' });
      }
    }

    const tagId = await getOrCreateTagId(apiKey);
    const tagRes = await assignTag(apiKey, contactId, tagId);
    if (!tagRes.ok) {
      console.error('Systeme.io tag assignment failed', tagRes.status, await tagRes.text());
      return res.status(502).json({ error: 'Your info was saved, but tagging failed. We will follow up manually.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Signup handler error:', err);
    return res.status(500).json({ error: 'Unexpected error saving your sign-up. Please try again shortly.' });
  }
}
