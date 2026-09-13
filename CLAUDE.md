# Working on this website

Read HANDOFF.md before making changes. Read SETUP.md and api/signup.js when
working on forms. These documents are project context, not a preselected task:
let the owner explain in her own words what she wants to work on.

## Collaborate with the owner

- Use plain language. The owner makes the design and publishing decisions;
  she does not need to write technical prompts or understand code first.
- If she only asks you to read the handoff, read it and ask what she would
  like to work on. Do not automatically start a donate button or form repair.
- Ask for missing essentials (such as an actual donation destination),
  and use reasonable judgment for routine implementation choices.
- Build and preview requested changes, summarize what changed, and let her
  review before publishing unless she already explicitly asked to publish.
- Keep HANDOFF.md current when architecture, deployment, or known issues change.

## Project facts

- Repository: https://github.com/velma-lab/2026-Amyloidosis-Awareness
- Production: https://2026-amyloidosis-awareness.vercel.app/
- Plain HTML/CSS/browser JavaScript in index.html; Vercel function in api/signup.js.
- Existing Vercel hosting and GitHub main branch are already connected.
  Do not migrate frameworks, hosting, or payment providers unless requested.
- There is no package.json/build pipeline in this checkout. Do not assume npm
  install or npm run dev exists. Local static previews do not run /api/signup.
- Preserve existing visual style, accessibility, memorial copy, and working
  campaign signup when making unrelated changes.

## Systeme.io and unresolved issue

- Existing secret: SYSTEME_API_KEY in Vercel. Never place it in the browser,
  repository, documentation, logs, or chat. Do not request a replacement by default.
- Free account uses one tag: amyloidosis-campaign. Reuse it; do not add tags.
- All forms call /api/signup. Omitted formType means campaign for compatibility;
  the new forms send provider or partner.
- Custom fields are intended to be auto-created and hold separate memberships.
  Full provider and partner names use role-specific custom fields.
- IMPORTANT: Provider/partner delivery is unresolved. Deployment and mocked
  tests passed, but the user reported failed submissions and a partner success
  message with no new contact. No confirmed root cause or successful retest.
  Do not describe the integrations as fully working. See HANDOFF.md.
- The original campaign signup was confirmed working by the user before these
  changes. It has not been reconfirmed live following the changes.
- Never infer successful delivery from a deployment check, local test, or UI
  success alone. Confirm the contact, fields, and tag in the intended account.

## Checks and publishing

Inspect git status and the current remote history before editing; preserve
others' work. Use focused changes and a branch/PR when practical.
For form changes run `node --test tests/forms.test.mjs` (Node.js required).
These tests mock Systeme.io; they are not live API contract or delivery tests.
For visual changes preview the result on desktop and mobile widths.
Never submit real donations as a test. Use owner-approved test contact data
for live submissions and explain any actual writes to external services.

After authorized publication, confirm Vercel deployed the intended commit,
then verify the public URL. If a collaborator deployment is blocked, inspect
its status/reason; do not suggest editing README as a standard deployment step.
