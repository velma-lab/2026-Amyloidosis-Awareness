# Your website: getting started and making changes

You can describe what you want in your own words. This guide gives Claude the
background so you do not have to remember how the site was built.

Website: https://2026-amyloidosis-awareness.vercel.app/

Repository: https://github.com/velma-lab/2026-Amyloidosis-Awareness

## Set up your computer once

1. Install [Visual Studio Code](https://code.visualstudio.com/), if needed.
2. In VS Code, open the Command Palette and choose **Git: Clone**. Paste the
   repository link above. Choose your Desktop as the parent folder and open
   the downloaded project when prompted. If VS Code says Git is missing,
   follow its installation instructions first. Sign in to your own GitHub
   account when prompted for access or publishing.
3. Install the official **Claude Code** extension from Anthropic in VS Code
   and follow its sign-in/setup instructions. Open its panel with this
   repository folder open. Your account needs access to Claude Code.
4. Paste this short message:

   > Read CLAUDE.md and HANDOFF.md so you understand my website and its current setup. Then ask me what I’d like to work on.

You can use that same message when starting a new conversation later. You
only need to clone once; on later visits, open the existing project folder
and ask Claude to check for GitHub updates while preserving any local work.

Official setup help:
[Cloning in VS Code](https://code.visualstudio.com/docs/sourcecontrol/repos-remotes)
and [Claude Code in VS Code](https://code.claude.com/docs/en/ide-integrations).

## Tell Claude what you want

Use ordinary language, such as “I want to add a donate button,” “Please change
this paragraph,” or “Can you help me update the pictures?” You choose the task
and can change your mind. Ask Claude to explain unfamiliar steps.

A donate button was mentioned as a possible next task, but it has not been
implemented as part of this handoff. No donation destination has been supplied.
If you request it, Claude should ask where donations should go and help you
choose the placement and wording. It should not invent a payment link.

## Review and publish

A change saved on your computer is not automatically live. Ask Claude to
show a preview and explain the changes. When you are satisfied, you can say,
“Publish these changes to my website.”

GitHub stores the code history. Vercel publishes the site from that code.
This project already has a connection between GitHub and Vercel; updates to
main triggered production deployment successfully on September 13, 2026.
Claude should check the actual deployment status each time. You should not
normally need to make a token edit to README to trigger publishing.

If a GitHub or Vercel permission error occurs, use your own account to review
it. GitHub collaborator access does not automatically grant Vercel dashboard
access. Do not share passwords or API keys in chat or commit them to GitHub.

For a visual preview, a static local server is enough. Form submissions need
the Vercel function and its server-side API key; a static preview cannot test
actual delivery to Systeme.io. Ask Claude to set up the appropriate preview.

## Important open issue: form delivery

**Status at handoff, September 13, 2026: provider and partner contact delivery
has not been verified successfully and needs investigation.**

What is known:

- The owner’s team confirmed that Join the Campaign created contacts in
  Systeme.io before the latest form changes.
- Provider and partner forms previously kept data only in browser memory
  and displayed success without sending it to Systeme.io.
- [Pull request #1](https://github.com/velma-lab/2026-Amyloidosis-Awareness/pull/1)
  connected both forms to `/api/signup`. Merge commit:
  `ac29ec7259c316a466f50eeddf9c83404ddb9549`.
- The deployment succeeded and the updated browser code was found on the
  public site. Six local mocked tests passed. These facts do not establish
  successful contact delivery.
- A provider test displayed “Could not save your sign-up. Please check your
  email address and try again.” The code uses this message for a contact
  creation rejection; it does not prove the email itself was the cause.
- A partner test reportedly displayed success, but a brand-new contact did
  not appear in Systeme.io. This has not been traced to a confirmed cause.
- A new private-window retest was suggested to rule out an older loaded
  page, but no result was reported. Stale browser code is only a hypothesis.
- Vercel runtime logs were unavailable to the collaborator’s signed-in
  account. No log evidence identifying the cause has been obtained.

If you choose to investigate with Claude:

1. Open the public site in a fresh private window and use a test email you
   control. Record the form, time, and exact success/error message.
2. In Systeme.io, clear contact filters and search the exact email. Confirm
   you are viewing the account associated with the Vercel API key. Do not
   expose the key. Existing emails update contacts instead of adding duplicates.
3. In your Vercel project, open **Logs** and find the `/api/signup` request
   at that time. Expand it to inspect the response and server error.
   [Vercel log instructions](https://vercel.com/docs/functions/logs).
4. Compare the real API error and field slugs with the code before changing
   mappings. Do not assume the email is wrong or that fields must be created
   manually. The current code attempts to create missing custom fields.
5. After a fix, verify all three forms in Systeme.io, including submitting
   provider and partner forms with the same email and checking both sets of
   details remain. Also retest the original campaign form.

You can request other website changes while this issue remains documented.
It should not be silently marked resolved or confused with a hosting failure.

## Technical reference for Claude

| File | Purpose |
| --- | --- |
| `index.html` | Main page, styling, three sections/forms, browser scripts |
| `api/signup.js` | Vercel server function that talks to Systeme.io |
| `SETUP.md` | Field mapping, secret variable name, form verification steps |
| `tests/forms.test.mjs` | Six local checks with a simulated Systeme.io API |
| `brf_bubble_questions.html` | Additional existing HTML resource; inspect before changing |
| `CLAUDE.md` | Working instructions for Claude |

The current tag is **amyloidosis-campaign**, not amyloidosis-awareness.
The free Systeme.io account has one tag available. Separate custom fields
record Campaign Signup, Provider Signup, and Partner Signup as “Yes.” These
fields can record overlapping groups; they are not a promise of separate
newsletter targeting on the free plan. Existing contacts are not automatically
backfilled with the new signup flags.

`SYSTEME_API_KEY` is already configured in Vercel according to the owner’s
team. It must remain server-side. A local clone does not include that secret.
See SETUP.md for intended field mappings and remember the open issue above
when interpreting its implementation description.

Future maintainers: update this guide with the date, evidence, and outcome
when the form issue is resolved or the setup changes.
