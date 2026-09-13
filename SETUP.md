# Website forms → Systeme.io

All three forms POST to `/api/signup`, using the existing Vercel
`SYSTEME_API_KEY`. No additional API key or tags are needed.

The handler adds or updates the contact by email and applies the existing
`amyloidosis-campaign` tag. It never creates another tag.

## Distinguishing the groups

Each submission sets its own custom field to `Yes`:

| Form | Custom field slug | Display name |
| --- | --- | --- |
| Join the Campaign | `campaign_signup` | Campaign Signup |
| For Providers | `provider_signup` | Provider Signup |
| Partner With Us | `partner_signup` | Partner Signup |

These are independent fields so a contact can belong to multiple groups.
They record membership on the contact; they do not replace tags for targeted newsletters.
Existing contacts are not backfilled automatically. Their membership field
will be set when they next submit a form.

## Field mapping

Campaign fields keep their existing mapping: account-specific first name,
surname and phone fields, plus `join_or_share`, `city_state`, and `story`.
Email identifies the contact for all three forms.

| Provider form | Custom field slug |
| --- | --- |
| Full name | `provider_name` |
| Specialty | `provider_specialty` |
| Institution / Practice | `provider_institution` |
| Partnership interest | `provider_interest` |

| Partner form | Systeme.io field slug |
| --- | --- |
| Contact name | `partner_contact_name` |
| Organization | `partner_organization` |
| Partnership interest | `partner_interest` |
| Message | `partner_message` |
| Phone | account's built-in phone field |

Full names are kept intact in the role-specific custom fields, rather than
being split or overwriting an existing campaign contact's first/last name.
Missing custom fields are created automatically on the first submission
of each type. Optional blank values are omitted from updates. Each request
writes only the fields for that form; other form fields are not sent as blanks.

## Deployment and verification

Deploy this branch through the existing Vercel project. The existing
`SYSTEME_API_KEY` must be available in the deployment environment; preview
deployments may need it enabled separately in Vercel settings.

After deployment, submit each form with a test email you control. Confirm
in Systeme.io that the contact has the expected fields and shared tag.
Use the same email on both provider and partner forms to confirm both
membership fields and details remain present. Retest the campaign form.

Success panels appear only after the server confirms saving and tagging.
Errors keep the form available for retry and do not display upstream debug
responses. Diagnostic errors remain in the Vercel function logs.

Local checks: `node --test tests/forms.test.mjs`. Tests mock Systeme.io;
they do not send contacts, create real fields, or verify live credentials.
