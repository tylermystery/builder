const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
    const listeners = {};
    const state = {
        session: { id: 'plan-a' },
        tasks: { all: new Map(), byProject: new Map() },
        eventDetails: { combined: new Map() }
    };
    let saves = 0;
    const target = { addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }, dispatchEvent: (e) => (listeners[e.type] || []).forEach(fn => fn(e)) };
    const context = vm.createContext({
        state, window: target, document: target, setTimeout, clearTimeout,
        getProjectTaskLoadState: () => ({ loaded: !!state.__tasksLoaded }),
        CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
        taskMessageId: content => String(content).replace(/^\[PLAN_COMMENT:item:[^\]]+\]\s*/, '').match(/^\[TASK:([^\]]+)\]\s*/)?.[1] || null
    });
    vm.runInContext(fs.readFileSync('utils/openConversations.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
    const run = code => vm.runInContext(code, context);
    run('initOpenConversations({ triggerSave: () => { globalThis.__saves = (globalThis.__saves || 0) + 1; } })');
    const load = records => target.dispatchEvent(new context.CustomEvent('plan-messages-loaded', { detail: { sessionId: 'plan-a', records } }));
    return { state, run, load, context };
}

const msg = (id, fields = {}) => ({ id, fields: { SenderID: 'u1', Content: 'hi', ...fields } });

test('counts unresolved top-level chats and open tasks for the plan and each item', () => {
    const { state, run, load } = harness();
    state.tasks.byProject.set('plan-a', [
        { id: 't1', fields: { Status: 'pending', LinkedItem: ['recA'] } },
        { id: 't2', fields: { Status: 'completed', LinkedItem: ['recA'] } },
        { id: 't3', fields: { Status: 'in_progress', LinkedItem: [] } },
        { id: 't4', fields: { Status: 'blocked', LinkedItem: ['recA', 'recB'], SourceCommentId: 'm5' } }
    ]);
    state.eventDetails.combined.set('_commentTaskLinks', { m4: 't2' });
    load([
        msg('m1'),                                                      // plan chat
        msg('m2', { 'Item Link': ['recA'] }),                           // item chat
        msg('m3', { ParentMessageID: 'm2', 'Item Link': ['recA'] }),     // reply: not a thread
        msg('m4', { 'Item Link': ['recA'] }),                           // linked to a task
        msg('m5', { Content: '[PLAN_COMMENT:item:custom-1] x' }),       // task source comment
        msg('m6', { Content: '[PLAN_COMMENT:item:custom-1] y' }),       // custom item chat
        msg('m7', { IsDeleted: true }),
        msg('m8', { SenderID: 'system', Content: '{}' }),
        msg('m9', { Content: '[TASK:t1] discussion' })
    ]);
    const { plan, byItem } = run('getOpenConversationCounts()');
    assert.equal(plan.chats, 3);   // m1, m2, m6
    assert.equal(plan.tasks, 3);   // t1, t3, t4
    assert.equal(plan.total, 6);
    assert.equal(byItem.get('recA').chats, 1);
    assert.equal(byItem.get('recA').tasks, 2);
    assert.equal(byItem.get('recB').total, 1);
    assert.equal(byItem.get('custom-1').chats, 1);
    // A task linked to two options in a group counts once.
    assert.equal(run("getOpenCountsForItems(['recA', 'recB']).tasks"), 2);
});

test('resolving a thread removes it from the counts, persists, and can be reopened', () => {
    const { state, run, load } = harness();
    load([msg('m1'), msg('m2', { 'Item Link': ['recA'] })]);
    run("setThreadResolved('m2', true, { id: 'u1', name: 'Ann' })");
    assert.equal(run('getOpenConversationCounts().plan.chats'), 1);
    assert.equal(run("getOpenConversationCounts().byItem.get('recA').chats"), 0);
    assert.equal(state.eventDetails.combined.get('_resolvedChatThreads').m2.byName, 'Ann');
    assert.equal(run('globalThis.__saves'), 1);
    run("setThreadResolved('m2', false)");
    assert.equal(run('getOpenConversationCounts().plan.chats'), 2);
});

test('ignores messages loaded for another plan', () => {
    const { run, context } = harness();
    run("window.dispatchEvent(new CustomEvent('plan-messages-loaded', { detail: { sessionId: 'plan-b', records: [{ id: 'x', fields: { SenderID: 'u', Content: 'hi' } }] } }))");
    assert.equal(run('getOpenConversationCounts().plan.chats'), 0);
});

test('snapshot is only produced once messages and tasks are loaded, and falls back to the saved one', () => {
    const { state, run, load } = harness();
    state.session.openConversationsSnapshot = { chats: 4, tasks: 1, total: 5 };
    assert.equal(run('getOpenConversationSnapshot()'), null);
    assert.equal(run('getOpenConversationSnapshotForSave()').total, 5); // keeps the saved one
    load([msg('m1')]);
    assert.equal(run('getOpenConversationSnapshot()'), null);            // tasks not loaded yet
    state.__tasksLoaded = true;
    const fresh = run('getOpenConversationSnapshotForSave()');
    assert.equal(fresh.chats, 1);
    assert.equal(fresh.total, 1);
    assert.equal(state.session.openConversationsSnapshot.total, 1);
});

test('reads saved snapshots defensively', () => {
    const { run } = harness();
    assert.equal(run('readSavedOpenConversations({})'), null);
    assert.equal(run("readSavedOpenConversations({ openConversations: 'x' })"), null);
    assert.equal(run("readSavedOpenConversations({ openConversations: { chats: 2, tasks: '3' } }).total"), 5);
});
