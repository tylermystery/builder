const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('utils/taskDiscussion.js', 'utf8').replace(/^export /gm, '');
function helpers() {
    const context = vm.createContext({});
    vm.runInContext(source, context);
    return context;
}
const message = (id, content, parent, reactions, extra = {}) => ({
    id, createdTime: '2026-10-30T10:00:00Z',
    fields: { Content: content, ParentMessageID: parent, Reactions: reactions, SenderName: 'Collaborator', ...extra }
});

test('task discussion includes all linked roots and nested replies, excludes other tasks, and summarizes live reactions', () => {
    const context = helpers();
    context.records = [
        message('nested', 'Nested answer', 'reply', { '👍': ['a'] }),
        message('unrelated', '[TASK:recOther] Other task'),
        message('reply', 'An answer', 'original', JSON.stringify({ '❤️': ['a', 'b'] })),
        message('original', 'Original comment'),
        message('root', '[TASK:recTask] Task: current'),
        message('deleted', 'Hidden text', 'root', { '👍': ['b'] }, { IsDeleted: true }),
        message('deleted-child', 'Reply remains visible', 'deleted'),
        message('cycle-a', 'Cycle', 'cycle-b'), message('cycle-b', 'Cycle', 'cycle-a')
    ];
    const discussion = vm.runInContext("getTaskDiscussion(records, { id: 'recTask' }, { original: 'recTask', unrelated: 'recOther' })", context);
    assert.deepEqual(Array.from(discussion.messages, record => record.id).sort(), ['deleted', 'deleted-child', 'nested', 'original', 'reply', 'root']);
    assert.equal(discussion.replyCount, 3);
    assert.equal(discussion.reactionCount, 3);
});

test('persisted markers survive custom item prefixes and malformed reaction data stays readable', () => {
    const context = helpers();
    assert.equal(vm.runInContext("taskMessageId('[PLAN_COMMENT:item:manual-item] [TASK:recTask] Task title')", context), 'recTask');
    assert.equal(vm.runInContext("taskMessageText('[PLAN_COMMENT:item:manual-item] [TASK:recTask] Task title')", context), 'Task title');
    assert.equal(vm.runInContext("Object.keys(messageReactions('{bad')).length", context), 0);
    assert.equal(vm.runInContext("Object.keys(messageReactions({ invalid: 'text' })).length", context), 0);
});

class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.dataset = {}; this.isConnected = true; this.value = ''; }
    setAttribute(name, value) { this.attrs[name] = value; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); return child; }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]).filter(el => ['button', 'textarea'].includes(el.tag)); }
    focus() { this.focused = true; }
}
function harness(initial = [], user = { id: 'user-a', name: 'Collaborator' }) {
    const container = new Element('section');
    let saved = structuredClone(initial);
    const calls = [];
    const state = { session: { id: 'recPlan' }, eventDetails: { combined: new Map() } };
    const context = vm.createContext({ state, document: { createElement: tag => new Element(tag) }, api: {
        async fetchChatMessages() { return structuredClone(saved); },
        async postChatMessage(session, id, name, content, item, options) {
            assert.equal(options.notify, false, 'placeholder roots must not send notifications');
            calls.push(['root', session, content, item]);
            const root = message('recRoot', content);
            saved.push(root);
            return root.id;
        },
        async postReplyMessage(parent, session, item, id, name, content) {
            calls.push(['reply', parent, content]);
            if (context.failReply) return null;
            const reply = message('recReply', content, parent);
            saved.push(reply);
            return reply;
        },
        async toggleMessageReaction(id, user, emoji, add) {
            calls.push(['reaction', id, emoji, add]);
            if (context.failReaction) return null;
            const record = saved.find(record => record.id === id);
            record.fields.Reactions = add ? { [emoji]: [user] } : {};
            return record.fields.Reactions;
        }
    } });
    vm.runInContext(source, context);
    vm.runInContext(fs.readFileSync('components/taskDiscussion.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
    context.container = container;
    context.getUser = () => user;
    const dispose = vm.runInContext("mountTaskDiscussion(container, { id: 'recTask', fields: { Name: 'Arrange equipment', LinkedItem: ['recItem'] } }, 'recPlan', getUser)", context);
    const all = () => {
        const walk = node => [node, ...node.children.flatMap(walk)];
        return walk(container);
    };
    return { context, calls, container, all, dispose, saved: () => structuredClone(saved) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('standalone task starts a persisted thread, sends replies, and reloads discussion without creating extra roots', async () => {
    const h = harness();
    await settle();
    assert.equal(h.calls.length, 0, 'opening task must not write');
    const input = h.all().find(el => el.tag === 'textarea');
    input.value = '<script>reply text</script>';
    h.all().find(el => el.tag === 'form').listeners.submit({ preventDefault() {} });
    await settle();
    assert.deepEqual(h.calls[0], ['root', 'recPlan', '[TASK:recTask] Task: Arrange equipment', 'recItem']);
    assert.deepEqual(h.calls[1], ['reply', 'recRoot', '<script>reply text</script>']);
    assert.equal(input.value, '');
    assert.ok(h.all().some(el => el.textContent === '<script>reply text</script>'));
    assert.ok(h.all().some(el => el.textContent?.startsWith('1 reply')));
    input.value = 'Another reply';
    h.all().find(el => el.tag === 'form').listeners.submit({ preventDefault() {} });
    await settle();
    assert.equal(h.calls.filter(call => call[0] === 'root').length, 1);
    const reopened = harness(h.saved());
    await settle();
    assert.ok(reopened.all().some(el => el.textContent === 'Another reply'));
    assert.equal(reopened.calls.length, 0, 'reopening discovers the saved task reference without writing');
});

test('existing thread reactions toggle, failed replies preserve drafts, and closing prevents stale mutations', async () => {
    const h = harness([message('recRoot', '[TASK:recTask] Arrange equipment', null, { '👍': ['user-a'] })]);
    await settle();
    const react = h.all().find(el => el.attrs['aria-label'] === 'Remove 👍 reaction (1)');
    await react.listeners.click();
    assert.deepEqual(h.calls[0], ['reaction', 'recRoot', '👍', false]);
    h.context.failReply = true;
    const input = h.all().find(el => el.tag === 'textarea');
    input.value = 'Keep this draft';
    h.all().find(el => el.tag === 'form').listeners.submit({ preventDefault() {} });
    await settle();
    assert.equal(input.value, 'Keep this draft');
    assert.ok(h.all().some(el => el.textContent?.includes('Your text is preserved')));
    h.dispose();
    const before = h.calls.length;
    h.all().find(el => el.tag === 'form').listeners.submit({ preventDefault() {} });
    await settle();
    assert.equal(h.calls.length, before);
});

test('discussion without an identity stays readable and cannot write', async () => {
    const h = harness([message('recRoot', '[TASK:recTask] Arrange equipment')], null);
    await settle();
    assert.ok(h.all().find(el => el.tag === 'textarea').disabled);
    assert.ok(h.all().some(el => el.textContent === 'Sign in to reply or react.'));
    assert.equal(h.calls.length, 0);
});

function messageApiHarness(fetcher) {
    const code = fs.readFileSync('api.js', 'utf8');
    const start = code.indexOf('async function readChatMessagePages');
    const end = code.indexOf('/**\n * Event types for plan history tracking', start);
    const context = vm.createContext({
        URL, BASE_ID: 'test-base', ITEM_MESSAGES_TABLE_NAME: 'Messages', PERSONAL_ACCESS_TOKEN: '',
        fetch: fetcher, console: { log() {}, error() {} }, log() {}, syncChatThreadsFromMessages() {}
    });
    vm.runInContext(code.slice(start, end).replace(/^export /gm, ''), context);
    return context;
}

test('task discussions load every message page, including replies after the first page', async () => {
    const urls = [];
    const context = messageApiHarness(async url => {
        urls.push(String(url));
        return { ok: true, json: async () => new URL(url).searchParams.has('offset')
            ? { records: [message('recReply', 'Reply', 'recRoot')] }
            : { records: [message('recRoot', '[TASK:recTask] Root')], offset: 'second-page' } };
    });
    const records = await vm.runInContext("fetchChatMessages('recPlan', { throwOnError: true })", context);
    assert.equal(records.length, 2);
    assert.equal(new URL(urls[1]).searchParams.get('offset'), 'second-page');
    assert.ok(new URL(urls[1]).searchParams.has('filterByFormula'));
});

test('fallback loads every page and filters by plan; strict errors do not look like empty discussion', async () => {
    let failAll = false;
    const context = messageApiHarness(async url => {
        const query = new URL(url).searchParams;
        if (failAll || query.has('filterByFormula')) return { ok: false, text: async () => 'Unavailable' };
        return { ok: true, json: async () => query.has('offset')
            ? { records: [message('reply', 'Answer', 'root', null, { SessionID: ['recPlan'] }), message('other', 'Other plan', null, null, { SessionID: ['recOther'] })] }
            : { records: [message('root', 'Source', null, null, { SessionID: ['recPlan'] })], offset: 'next' } };
    });
    const result = await vm.runInContext("fetchChatMessages('recPlan', { throwOnError: true })", context);
    assert.deepEqual(Array.from(result, record => record.id), ['root', 'reply']);
    failAll = true;
    await assert.rejects(vm.runInContext("fetchChatMessages('recPlan', { throwOnError: true })", context), /Unable to load task discussion/);
    assert.equal((await vm.runInContext("fetchChatMessages('recPlan')", context)).length, 0, 'legacy callers retain empty-list fallback');
});

test('editing task discussion text keeps its persisted task and custom-item affiliation', async () => {
    const source = fs.readFileSync('api.js', 'utf8');
    const start = source.indexOf('export async function updateChatMessage(');
    const end = source.indexOf('export async function updateChatMessageItemLink', start);
    const requests = [];
    const context = vm.createContext({
        BASE_ID: 'test-base', ITEM_MESSAGES_TABLE_NAME: 'Messages', PERSONAL_ACCESS_TOKEN: '',
        console: { log() {}, error() {} }, log() {},
        async fetch(url, options) {
            requests.push(options);
            if (options.method === 'PATCH') return { ok: true, json: async () => ({ id: 'recRoot', fields: JSON.parse(options.body).fields }) };
            return { ok: true, json: async () => message('recRoot', '[PLAN_COMMENT:item:manual] [TASK:recTask] Old title') };
        }
    });
    vm.runInContext(source.slice(start, end).replace(/^export /gm, ''), context);
    const result = await vm.runInContext("updateChatMessage('recRoot', 'Updated title', 'user-a')", context);
    assert.equal(result.fields.Content, '[PLAN_COMMENT:item:manual] [TASK:recTask] Updated title');
    assert.equal(requests.length, 2);
});

test('task thread placeholders skip notifications while normal chat keeps existing notification behavior', async () => {
    const source = fs.readFileSync('api.js', 'utf8');
    const start = source.indexOf('export async function postChatMessage(');
    const end = source.indexOf('export async function banUser', start);
    const calls = [];
    const context = vm.createContext({
        BASE_ID: 'test-base', ITEM_MESSAGES_TABLE_NAME: 'Messages', PERSONAL_ACCESS_TOKEN: '',
        console: { log() {}, error() {} }, log() {}, registerChatThread() {},
        async fetch(url) {
            calls.push(url);
            return { ok: true, json: async () => ({ records: [{ id: 'recRoot' }] }) };
        }
    });
    vm.runInContext(source.slice(start, end).replace(/^export /gm, ''), context);
    const rootId = await vm.runInContext("postChatMessage('recPlan', 'user-a', 'Collaborator', '[TASK:recTask] Task title', null, { notify: false })", context);
    assert.equal(rootId, 'recRoot');
    assert.equal(calls.length, 1);
    calls.length = 0;
    await vm.runInContext("postChatMessage('recPlan', 'user-a', 'Collaborator', 'Normal message')", context);
    assert.equal(calls.length, 4);
    assert.ok(calls.includes('/api/send-email-notification'));
});
