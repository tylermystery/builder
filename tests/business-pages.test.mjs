import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { businesses, loadBusiness, renderBusiness, webUrl } from '../netlify/functions/business-pages.mjs';

test('business rendering escapes store content and preserves the selected shop', () => {
  const b = {
    ...businesses()[0], id: 'recExampleStore123', description: '</script><img src=x onerror=alert(1)>',
    area: 'Oakland & beyond', offerings: ['Food & Drink'], website: 'https://example.test/',
    email: 'hello@example.test', phone: '+1 (510) 555-0100', socials: [],
  };
  const html = renderBusiness(b);
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;\/script&gt;/);
  assert.match(html, /shopId=recExampleStore123&amp;category=Food%20%26%20Drink/);
  assert.match(html, /<h1>Tyler&#39;s Mystery Tours<\/h1>/);
  assert.match(html, /rel="canonical" href="https:\/\/whatthefun.wtf\/shops\/tylers-mystery-tours\//);
  const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
  assert.equal(JSON.parse(json).description, b.description);
  assert.equal(JSON.parse(json)['@type'], 'Organization');
});

test('external links accept websites and reject unsafe schemes and credentials', () => {
  assert.equal(webUrl('example.test'), 'https://example.test/');
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'ftp://example.test', 'https://user:password@example.test', null]) assert.equal(webUrl(value), null);
});

test('store lookup resolves pillar names and exposes only selected public fields', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    if (String(url).includes('/Stores?')) return Response.json({ records: [{ id: 'recExampleStore123', fields: {
      Name: "Tyler's Mystery Tours", Description: 'An introduction.', Pillars: ['rec12345678901234', 'Food', 'Food', 'rec99999999999999'],
      'Location or service area': 'Bay Area',
      'Store Details json': JSON.stringify({ businessInfo: {
        websiteUrl: 'example.test', taxId: 'PRIVATE_FIELD_SHOULD_NOT_RENDER',
        contact: { supportEmail: 'hello@example.test', accountingEmail: 'PRIVATE_ACCOUNTING_ADDRESS', phone: '+1 510 555 0100' },
        socialMedia: { instagram: 'javascript:alert(1)' },
      } }),
    } }] });
    return Response.json({ records: [{ id: 'rec12345678901234', fields: { Name: 'Activities' } }] });
  };
  const previousPat = process.env.AIRTABLE_PAT;
  const previousBase = process.env.BASE_ID;
  process.env.AIRTABLE_PAT = 'test-placeholder'; process.env.BASE_ID = 'test-base';
  t.after(() => {
    if (previousPat === undefined) delete process.env.AIRTABLE_PAT; else process.env.AIRTABLE_PAT = previousPat;
    if (previousBase === undefined) delete process.env.BASE_ID; else process.env.BASE_ID = previousBase;
  });
  const b = await loadBusiness(businesses()[0]);
  assert.equal(calls, 2);
  assert.deepEqual(b.offerings, ['Activities', 'Food']);
  const html = renderBusiness(b);
  assert.ok(!html.includes('PRIVATE_'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('rec99999999999999'));
});

test('routing handles directory, unknown shops, methods, and temporary lookup failures', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => { throw new Error('private upstream details'); };
  const request = (path, method = 'GET') => new Request(`https://example.test${path}`, { method });
  const directory = await handler(request('/shops/'));
  assert.equal(directory.status, 200);
  const html = await directory.text();
  for (const b of businesses()) assert.ok(html.includes(`/shops/${b.slug}/`));
  assert.equal((await handler(request('/shops/unknown/'))).status, 404);
  assert.equal((await handler(request('/shops/', 'POST'))).status, 405);
  assert.equal((await handler(request('/shops/', 'HEAD'))).body, null);
  const redirect = await handler(request('/shops/union-machine-works'));
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/shops/union-machine-works/');
  const unavailable = await handler(request('/shops/union-machine-works/'));
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('cache-control'), 'no-store');
  assert.ok(!(await unavailable.text()).includes('private upstream'));
});
