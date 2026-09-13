import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../api/signup.js', import.meta.url), 'utf8');
const campaign = { firstName: 'Test', lastName: 'Person', email: 'test@example.com', ambassadorResponse: 'both', story: 'Test story' };
const provider = { formType: 'provider', name: 'Dr. Test Person', email: 'test@example.com', specialty: 'Cardiology', institution: 'Test Practice', interest: 'Speaker / community educator' };
const partner = { formType: 'partner', org: 'Test Organization', contactName: 'Test Person', email: 'test@example.com', interest: 'General inquiry / exploratory conversation', message: 'Test message' };

function setup(fail = '') {
  const slugs = new Set(['first_name', 'surname', 'phone_number']);
  const contacts = new Map();
  const calls = [];
  const reply = (status, data = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
  const fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method, body });
    assert.equal(options.headers['X-API-Key'], 'test-only');
    if (fail === 'fields' && method === 'POST' && path === '/api/contact_fields') return reply(422, { error: 'private upstream error' });
    if (path === '/api/contact_fields' && method === 'GET') return reply(200, { items: [...slugs].map(slug => ({ slug })) });
    if (path === '/api/contact_fields' && method === 'POST') { slugs.add(body.slug); return reply(201, body); }
    if (path === '/api/tags') { assert.equal(method, 'GET'); return reply(200, { items: [{ id: 7, name: 'amyloidosis-campaign' }] }); }
    if (path.endsWith('/tags')) { assert.deepEqual(body, { tagId: 7 }); return reply(201); }
    if (path === '/api/contacts' && method === 'GET') return reply(200, { items: [...contacts.values()] });
    if (fail === 'save') return reply(502, { error: 'private upstream error' });
    if (path === '/api/contacts' && method === 'POST') {
      const contact = { id: 1, email: body.email, fields: body.fields };
      contacts.set(1, contact); return reply(201, contact);
    }
    if (method === 'PATCH') {
      const contact = contacts.get(1);
      const fields = new Map(contact.fields.map(field => [field.slug, field]));
      for (const field of body.fields) fields.set(field.slug, field);
      contact.fields = [...fields.values()];
      return reply(200, contact);
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };
  const context = vm.createContext({ fetch, process: { env: { SYSTEME_API_KEY: 'test-only' } }, console: { error() {} }, URL });
  vm.runInContext(source.replace('export default async function handler', 'async function handler'), context);
  const submit = async body => {
    const response = { status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; }, setHeader() {} };
    await context.handler({ method: 'POST', body }, response);
    return response;
  };
  return { submit, contacts, calls };
}

test('all three forms save through one tag and preserve other form memberships', async () => {
  const app = setup();
  for (const payload of [campaign, provider, partner, provider]) assert.equal((await app.submit(payload)).code, 200);
  assert.equal(app.contacts.size, 1);
  const fields = Object.fromEntries(app.contacts.get(1).fields.map(f => [f.slug, f.value]));
  for (const kind of ['campaign', 'provider', 'partner']) assert.equal(fields[`${kind}_signup`], 'Yes');
  assert.equal(fields.story, campaign.story);
  assert.equal(fields.provider_name, provider.name);
  assert.equal(fields.partner_message, partner.message);
  assert.equal(fields.provider_specialty, 'Cardiology');
  assert.equal(fields.partner_organization, partner.org);
  const updates = app.calls.filter(c => c.method === 'PATCH');
  assert.ok(updates.every(c => !c.body.fields.some(f => ['story', 'join_or_share', 'campaign_signup'].includes(f.slug))));
  assert.ok(!app.calls.some(c => c.path === '/api/tags' && c.method === 'POST'));
});

test('provider and partner can each create a new contact independently', async () => {
  for (const payload of [provider, partner]) {
    const app = setup();
    assert.equal((await app.submit(payload)).code, 200);
    assert.equal(app.contacts.size, 1);
  }
});

test('missing required fields, invalid email and unknown form are rejected before API calls', async () => {
  for (const payload of [{ ...provider, specialty: '' }, { ...partner, contactName: '' }, { ...partner, interest: '' }, { ...campaign, email: 'invalid' }, { ...campaign, formType: 'other' }]) {
    const app = setup();
    assert.equal((await app.submit(payload)).code, 400);
    assert.equal(app.calls.length, 0);
  }
});

test('field creation and contact save failures never report success or expose upstream errors', async () => {
  for (const fail of ['fields', 'save']) {
    const app = setup(fail);
    const response = await app.submit(provider);
    assert.ok(response.code >= 500);
    assert.equal(response.data.ok, undefined);
    assert.equal(response.data.detail, undefined);
    assert.ok(!JSON.stringify(response.data).includes('private upstream'));
    assert.equal(app.contacts.size, 0);
  }
});

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const additional = html.slice(html.indexOf('async function submitAdditionalForm'), html.indexOf('// Smooth scroll for anchor links'));

test('browser shows success only after confirmed save and keeps inputs available on error', async () => {
  for (const success of [true, false]) {
    const button = { disabled: false, textContent: 'Submit' };
    const form = { reportValidity: () => true, querySelector: () => button, style: { display: '' } };
    const panel = { style: { display: 'none' } };
    const alerts = [];
    let sent;
    const context = vm.createContext({ document: { getElementById: id => id.endsWith('-form') ? form : panel }, providerData: [], partnerData: [], alert: message => alerts.push(message), fetch: async (url, options) => {
      assert.equal(url, '/api/signup');
      assert.equal(button.disabled, true);
      assert.equal(form.style.display, '');
      sent = JSON.parse(options.body);
      return { ok: success, json: async () => success ? { ok: true } : { error: 'Try again' } };
    } });
    vm.runInContext(additional, context);
    await context.submitAdditionalForm('provider', provider);
    assert.equal(sent.formType, 'provider');
    assert.equal(button.disabled, false);
    assert.equal(panel.style.display, success ? 'block' : 'none');
    assert.equal(form.style.display, success ? 'none' : '');
    assert.equal(alerts.length, success ? 0 : 1);
  }
});

test('all inline scripts parse', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (match[1].trim()) new vm.Script(match[1]);
});
