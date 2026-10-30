const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadPlanSnapshot, buildSnapshotEmailParts } = require('../netlify/functions/utils/plan-snapshot-email');
const { buildReceiptEmail, buildMerchantNotificationEmail } = require('../netlify/functions/utils/checkout-emails');

function fixture() {
  const data = {
    lockedInItems: { recVenue: { quantity: 2, selections: { group0: [1], group1: [0] }, note: 'Bring banners', itemDate: '2026-11-02', itemStartTime: '10:00', itemEndTime: '12:00' } },
    ideasItems: { customIdea: { quantity: 1 } },
    aiRecords: { customIdea: { id: 'customIdea', fields: { Name: 'Custom idea', Description: 'A custom activity', Price: 5 } } },
    itemReactions: { recVenue: { userA: ['👍'] }, 'recVenue::original': { userA: ['👍', '❤️'], userB: '👍' } },
    eventDetails: { goals: 'Celebrate the team', summary: 'A day together' }, planItemOrder: ['recVenue', 'customIdea']
  };
  const session = { id: 'recPlan', fields: { Name: 'Team <day>', Stores: ['recStore'], Collaborators: ['recActor', 'recRecipient', 'recDigest'], 'Items with Variations': JSON.stringify(data) } };
  const record = { id: 'recVenue', fields: { Name: 'Venue', Description: 'Waterfront space', Price: 10, Address: '123 Main Street', Options: '[Package]\nBasic\nPremium [price:+5]\n[Meal]\nVegetarian' } };
  const tasks = [
    { id: 'one', fields: { ProjectId: ['recPlan'], LinkedItem: ['recVenue'], Name: 'Book equipment', Description: 'Arrange chairs\nCheck delivery', Status: 'pending', Assignee: 'Alex', DueDate: '2026-11-01' } },
    { id: 'two', fields: { ProjectId: ['recPlan'], LinkedItem: ['recVenue', 'customIdea'], Name: 'Shared preparation', Status: 'completed' } },
    { id: 'three', fields: { ProjectId: ['recPlan'], Name: 'Confirm budget', Status: 'blocked' } },
    { id: 'four', fields: { ProjectId: ['recPlan'], LinkedItem: ['removedItem'], Name: 'Follow up on removed item', Status: 'in_progress' } },
    { id: 'unrelated', fields: { ProjectId: ['recOther'], Name: 'Unrelated private task' } }
  ];
  const requests = [];
  const fetcher = async url => {
    const parsed = new URL(url); requests.push(parsed);
    const parts = parsed.pathname.split('/');
    if (parts.at(-1) === 'recPlan') return response(session);
    if (parts.at(-1) === 'recStore') return response({ id: 'recStore', fields: { Name: 'Store', ContactEmail: 'merchant@example.test' } });
    if (parts.at(-1) === 'recVenue') return response(record);
    if (parts.at(-1) === 'Tasks') return response(parsed.searchParams.has('offset') ? { records: tasks.slice(2) } : { records: tasks.slice(0, 2), offset: 'page 2' });
    if (parts.at(-1) === 'Users') return response({ records: [
      { id: 'recActor', fields: { Email: 'actor@example.test', NotificationFrequency: 'Real-Time' } },
      { id: 'recRecipient', fields: { Email: 'recipient@example.test', Name: 'Recipient', NotificationFrequency: 'Real-Time' } },
      { id: 'recDigest', fields: { Email: 'digest@example.test', NotificationFrequency: 'Digest' } }
    ] });
    throw new Error('Unexpected fixture request');
  };
  return { data, session, record, tasks, fetcher, requests };
}
function response(data) { return { ok: true, json: async () => data }; }
const options = f => ({ fetcher: f.fetcher, versions: [], now: new Date('2026-10-25T12:00:00Z') });

test('snapshot loads persisted tasks across pages and nests every status, plan-wide and removed-item tasks', async () => {
  const f = fixture();
  const snapshot = await loadPlanSnapshot('recPlan', options(f));
  assert.equal(snapshot.tasks.length, 4);
  assert.deepEqual(snapshot.items[0].tasks.map(task => task.id), ['one', 'two']);
  assert.deepEqual(snapshot.items[1].tasks.map(task => task.id), ['two']);
  assert.deepEqual(snapshot.planTasks.map(task => task.id), ['three']);
  assert.deepEqual(snapshot.otherTasks.map(task => task.id), ['four']);
  assert.equal(snapshot.items[0].reactions, '👍 2 · ❤️ 1');
  assert.deepEqual(snapshot.items[0].optionLines, ['Package: Premium', 'Meal: Vegetarian']);
  assert.equal(snapshot.subtotal, 30);
  const parts = buildSnapshotEmailParts(snapshot);
  for (const value of ['Premium', 'Vegetarian', 'Bring banners', 'Book equipment', 'Arrange chairs', 'Alex', '2026-11-01', 'Completed', 'Confirm budget', 'Follow up on removed item', '👍 2', 'A day together', '123 Main Street']) {
    assert.ok(parts.html.includes(value), `HTML includes ${value}`);
    assert.ok(parts.text.includes(value), `Plain text includes ${value}`);
  }
  assert.ok(parts.html.includes('4 tasks (1 completed, 3 open)'));
  assert.ok(!parts.html.includes('Unrelated private task'));
  assert.ok(parts.html.includes('Team &lt;day&gt;'));
  assert.ok(parts.html.includes('2026-10-25T12:00:00.000Z'));
  assert.equal(parts.attachments, undefined);
});

test('legacy linked-record query fallback filters all pages; failed task reads fail rather than send an empty snapshot', async () => {
  const f = fixture();
  const normal = f.fetcher;
  f.fetcher = async url => new URL(url).searchParams.has('filterByFormula') ? { ok: false } : normal(url);
  assert.equal((await loadPlanSnapshot(f.session, options(f))).tasks.length, 4);
  f.fetcher = async url => new URL(url).pathname.endsWith('/Tasks') ? { ok: false } : normal(url);
  await assert.rejects(loadPlanSnapshot(f.session, options(f)), /complete plan snapshot/);
});

test('selected approved versions and saved iterations are used instead of silently substituting current catalog text', async () => {
  const f = fixture();
  f.data.lockedInItems.recVenue.variationId = 7;
  f.session.fields['Items with Variations'] = JSON.stringify(f.data);
  const snapshot = await loadPlanSnapshot(f.session, { ...options(f), versions: [{ id: 7, catalog_item_id: 'recVenue', name: 'Selected version', description: 'Saved version details', price: '20' }] });
  assert.equal(snapshot.items[0].name, 'Selected version');
  assert.equal(snapshot.items[0].description, 'Saved version details');
  assert.equal(snapshot.subtotal, 50);
  f.data.itemIterations = { recVenue: { iterations: [{ title: 'Base' }, { title: 'Plan refinement', description: 'Refined details' }] } };
  f.data.activeVariationIndices = { recVenue: 1 };
  f.session.fields['Items with Variations'] = JSON.stringify(f.data);
  assert.equal((await loadPlanSnapshot(f.session, options(f))).items[0].name, 'Plan refinement');
});

test('missing catalog records remain visible, malformed saved data fails, and empty plans render clearly', async () => {
  const f = fixture();
  const normal = f.fetcher;
  f.fetcher = async url => new URL(url).pathname.endsWith('/recVenue') ? { ok: false } : normal(url);
  const snapshot = await loadPlanSnapshot(f.session, options(f));
  assert.equal(snapshot.items[0].tasks.length, 2);
  assert.ok(buildSnapshotEmailParts(snapshot).text.includes('Catalog details are unavailable'));
  f.session.fields['Items with Variations'] = '{bad';
  await assert.rejects(loadPlanSnapshot(f.session, options(f)), /read saved plan/);
  f.session.fields['Items with Variations'] = '{}';
  const empty = await loadPlanSnapshot(f.session, options(f));
  assert.ok(buildSnapshotEmailParts(empty).html.includes('No items yet.'));
});

test('long task descriptions are not truncated; a complete attachment protects against email-client clipping', async () => {
  const f = fixture();
  f.tasks[0].fields.Description = '<script>unsafe()</script>' + 'Full details '.repeat(8000) + 'FINAL TASK DETAIL';
  const parts = buildSnapshotEmailParts(await loadPlanSnapshot(f.session, options(f)));
  assert.ok(parts.html.includes('&lt;script&gt;unsafe()&lt;/script&gt;'));
  assert.ok(!parts.html.includes('<script>'));
  assert.ok(parts.html.includes('FINAL TASK DETAIL'));
  const attachment = Buffer.from(parts.attachments[0].content, 'base64').toString();
  assert.ok(attachment.includes('FINAL TASK DETAIL'));
  assert.ok(attachment.includes('Follow up on removed item'));
});

function handler(filename, f, sent, overrides = {}) {
  const source = fs.readFileSync(`netlify/functions/${filename}.js`, 'utf8');
  let blobsConnected = false;
  const context = vm.createContext({
    exports: {}, process: { env: { SITE_URL: 'https://example.test', SENDGRID_API_KEY: true } }, console: { log() {}, warn() {}, error() {} }, Buffer, URL, URLSearchParams,
    require: name => {
      if (name === 'node-fetch') return f.fetcher;
      if (name === '@sendgrid/mail') return { setApiKey() {}, send: async message => { sent.push(message); } };
      if (name === './utils/email-config') return { buildFrom: () => ({ name: 'Store', email: 'store@example.test' }), fetchStoreName: async () => 'Store' };
      if (name === './utils/plan-snapshot-email') return { loadPlanSnapshot: input => loadPlanSnapshot(input, options(f)), buildSnapshotEmailParts, ...overrides };
      if (name === './utils/checkout-emails') return { ...require('../netlify/functions/utils/checkout-emails'), loadCheckoutEmailDetails: async () => ({ sessionData: f.data, itemRecords: [f.record] }) };
      if (name === 'crypto') return require('node:crypto');
      if (name === '@netlify/blobs') return {
        connectLambda: event => {
          assert.equal(event.httpMethod, 'POST');
          assert.ok(event.blobs, 'the original invocation context reaches Blobs');
          blobsConnected = true;
        },
        getStore: () => {
          assert.ok(blobsConnected, 'Blobs must connect before accessing the invite store');
          return { setJSON: async () => {} };
        }
      };
      throw new Error(`Unexpected test dependency: ${name}`);
    }
  });
  vm.runInContext(source, context);
  return body => {
    blobsConnected = false;
    return context.exports.handler({ httpMethod: 'POST', body: JSON.stringify(body), blobs: 'test-invocation-context' });
  };
}

test('update notifications include the snapshot while preserving preferences and sender exclusion', async () => {
  const f = fixture(); const sent = [];
  const result = await handler('send-email-notification', f, sent)({ sessionId: 'recPlan', senderId: 'recActor', senderName: 'Owner', notificationType: 'plan_updated', content: '<script>not markup</script>' });
  assert.equal(result.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'recipient@example.test');
  assert.ok(sent[0].subject.startsWith('Plan updated:'));
  assert.ok(sent[0].html.includes('Book equipment'));
  assert.ok(sent[0].text.includes('Confirm budget'));
  assert.ok(!sent[0].html.includes('<script>'));
});

test('invitations preserve their join link and role while including the saved snapshot', async () => {
  const f = fixture(); const sent = [];
  const result = await handler('send-invite', f, sent)({ sessionId: 'recPlan', email: 'invitee@example.test', inviterName: 'Owner', role: 'viewer', sessionName: 'Outdated client title', storeId: 'recStore' });
  assert.equal(result.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].html.includes('invite_token='));
  assert.ok(sent[0].html.includes('Viewer'));
  assert.ok(sent[0].html.includes('Book equipment'));
  assert.ok(sent[0].text.includes('Plan-wide tasks'));
  assert.ok(sent[0].subject.includes('Team <day>'));
});

test('snapshot failures do not send a misleading partial invitation or update', async () => {
  const f = fixture(); const sent = [];
  const overrides = { loadPlanSnapshot: async () => { throw new Error('Snapshot unavailable'); } };
  const invite = await handler('send-invite', f, sent, overrides)({ sessionId: 'recPlan', email: 'invitee@example.test' });
  const update = await handler('send-email-notification', f, sent, overrides)({ sessionId: 'recPlan', senderId: 'recActor' });
  assert.equal(invite.statusCode, 500);
  assert.equal(update.statusCode, 500);
  assert.equal(sent.length, 0);
});

test('saved-plan receipt formatting accepts the snapshot without changing paid receipt behavior', async () => {
  const f = fixture();
  const snapshot = buildSnapshotEmailParts(await loadPlanSnapshot(f.session, options(f)));
  const payment = { amount: 30, method: 'Card', date: '2026-10-25T12:00:00Z', customerEmail: 'customer@example.test' };
  const receipt = buildReceiptEmail(f.session, payment, null, 'https://example.test', { unpaid: true, snapshotHtml: snapshot.html });
  const merchant = buildMerchantNotificationEmail(f.session, payment, null, 'https://example.test', { unpaid: true, snapshotHtml: snapshot.html });
  assert.ok(receipt.html.includes('Book equipment'));
  assert.ok(merchant.html.includes('Follow up on removed item'));
  assert.ok(receipt.html.includes('Open Plan &amp; Pay'));
  const paid = buildReceiptEmail(f.session, payment, null, 'https://example.test', { sessionData: f.data, itemRecords: [f.record] });
  assert.ok(paid.subject.includes('Payment Receipt'));
  assert.ok(paid.html.includes('Amount Paid'));
  assert.ok(paid.html.includes('Premium'));
  assert.ok(!paid.html.includes('Plan snapshot:'));
});


test('saved-plan confirmation sends the same snapshot to the purchaser and merchant without changing pay/sign-in controls', async () => {
  const f = fixture(); const sent = [];
  const result = await handler('send-checkout-confirmation', f, sent)({ sessionId: 'recPlan', customerEmail: 'customer@example.test', amountDue: 30, unpaid: true });
  assert.equal(result.statusCode, 200);
  assert.equal(sent.length, 2);
  for (const message of sent) {
    assert.ok(message.html.includes('Book equipment'));
    assert.ok(message.text.includes('Confirm budget'));
  }
  assert.ok(sent[0].html.includes('Open Plan &amp; Pay'));
  assert.ok(sent[0].text.includes('Amount due: $30.00'));
});


test('subtasks inherit their parent item and duplicate records do not inflate task totals', async () => {
  const f = fixture();
  f.tasks.push({ id: 'child', fields: { ProjectId: ['recPlan'], ParentTask: ['one'], Name: 'Check chair delivery' } });
  f.tasks.push(f.tasks[0]);
  const snapshot = await loadPlanSnapshot(f.session, options(f));
  assert.equal(snapshot.tasks.length, 5);
  assert.ok(snapshot.items[0].tasks.some(task => task.id === 'child'));
  assert.ok(!snapshot.planTasks.some(task => task.id === 'child'));
});

test('saved public item versions are read using their store and approved visibility', async () => {
  const f = fixture();
  f.data.lockedInItems.recVenue.variationId = 7;
  f.session.fields['Items with Variations'] = JSON.stringify(f.data);
  let checked = false;
  const context = vm.createContext({
    module: { exports: {} }, exports: {}, process: { env: {} }, URLSearchParams, Buffer,
    require: name => {
      if (name === 'node-fetch') return f.fetcher;
      if (name === './checkout-emails') return require('../netlify/functions/utils/checkout-emails');
      if (name === '@netlify/database') return { getDatabase: () => ({ pool: { query: async (sql, params) => {
        checked = true;
        assert.ok(sql.includes('p.store_id = $2'));
        assert.ok(sql.includes("v.status = 'approved'"));
        assert.equal(params[1], 'recStore');
        assert.equal(params[0][0], 7);
        return { rows: [{ id: 7, catalog_item_id: 'recVenue', name: 'Approved version' }] };
      } } }) };
      throw new Error('Unexpected snapshot dependency');
    }
  });
  vm.runInContext(fs.readFileSync('netlify/functions/utils/plan-snapshot-email.js', 'utf8'), context);
  const snapshot = await context.module.exports.loadPlanSnapshot(f.session, { fetcher: f.fetcher });
  assert.equal(checked, true);
  assert.equal(snapshot.items[0].name, 'Approved version');
});
