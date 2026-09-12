# Sign-up form → Systeme.io

The homepage sign-up form (`#signup-form` in `index.html`) posts to a Vercel
serverless function at `api/signup.js`, which adds or updates the submitter
as a **Systeme.io contact** via the [Systeme.io public API](https://developer.systeme.io/reference)
and applies the tag **`amyloidosis-campaign`**.

## Field mapping

| Form field | Systeme.io field | Type |
| --- | --- | --- |
| First name | `first_name` | built-in |
| Last name | `last_name` | built-in |
| Email | contact's email (identity/lookup key) | built-in |
| Phone | `phone_number` | built-in, optional |
| "Willing to join / share your story" answer | `join_or_share` | custom field, auto-created |
| City & State | `city_state` | custom field, auto-created |
| "In Your Own Words" story | `story` | custom field, auto-created |

The three custom fields (`join_or_share`, `city_state`, `story`) don't need
to be created by hand in the Systeme.io dashboard — the function checks for
them on each cold start and creates any that are missing.

## Existing contacts

On every submission the handler looks the email up first
(`GET /api/contacts?email=...`):

- **Found** → `PATCH`es that contact with the new field values (so a repeat
  signup, or someone updating their story, overwrites the old values rather
  than creating a duplicate).
- **Not found** → `POST`s a new contact.
- If two submissions race and Systeme.io reports the contact already exists
  on create (`422`), the handler re-looks-up the contact and falls back to
  updating it instead of failing.

Either way, the tag `amyloidosis-campaign` is then applied to the contact
(the tag is looked up by name and created once if it doesn't exist yet).

## Environment variable to set in Vercel

Vercel → your project → **Settings → Environment Variables** (add to
Production, Preview, and Development), then redeploy:

| Key | Value |
| --- | --- |
| `SYSTEME_API_KEY` | Systeme.io → your profile picture → **Settings → MCP & API keys → Public API keys → Create** |

> The API key is a secret. It lives only in Vercel's environment (server
> side) and is never sent to the browser.

## User-facing behavior

- On success, the form's normal "🙏 Thank you for joining" panel is shown.
- On failure, the submitter sees an alert asking them to try again, the
  submit button re-enables, and the specific Systeme.io error (invalid
  field, rate limit, etc.) is logged server-side in Vercel's function logs
  for you to check — nothing sensitive is shown to the visitor.

## Viewing submissions

Systeme.io → Contacts, filter by the tag `amyloidosis-campaign`.
