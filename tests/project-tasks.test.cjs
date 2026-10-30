const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
    const state = { session: { id: 'plan-a' }, tasks: { all: new Map(), byProject: new Map() } };
    const events = [];
    const context = vm.createContext({ state, window: { dispatchEvent: event => events.push(event) },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
    vm.runInContext(fs.readFileSync('utils/projectTasks.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
    const run = code => vm.runInContext(code, context);
    return { state, events, context, run };
}
const task = (id, project = 'plan-a', name = id) => ({ id, fields: { Name: name, ProjectId: [project], LinkedItem: ['item-a'], Status: 'pending' } });
const ids = tasks => Array.from(tasks, task => task.id);

test('cold load fills both task indexes without opening a task editor; concurrent views share the request', async () => {
    const { state, context, run, events } = harness();
    let calls = 0;
    context.fetchTasks = async (project, options) => { calls++; assert.equal(options.throwOnError, true); return [task('saved')]; };
    const first = run("loadProjectTasks('plan-a', fetchTasks)");
    const second = run("loadProjectTasks('plan-a', fetchTasks)");
    assert.equal(first, second);
    assert.equal(run("getProjectTaskLoadState('plan-a').loading"), true);
    await first;
    assert.equal(calls, 1);
    assert.deepEqual(ids(state.tasks.byProject.get('plan-a')), ['saved']);
    assert.equal(state.tasks.all.get('saved').fields.Name, 'saved');
    assert.equal(run("getProjectTaskLoadState('plan-a').loading"), false);
    assert.equal(events.at(-1).type, 'tasks-state-updated');
});

test('creating a task before initial loading does not mark a partial list fully loaded', async () => {
    const { context, run, state } = harness();
    context.created = task('new');
    run("upsertProjectTask(created, 'plan-a')");
    context.fetchTasks = async () => [task('saved'), task('new')];
    await run("loadProjectTasks('plan-a', fetchTasks)");
    assert.deepEqual(ids(state.tasks.byProject.get('plan-a')), ['saved', 'new']);
    run("upsertProjectTask(created, 'plan-a')");
    assert.equal(state.tasks.byProject.get('plan-a').length, 2);
});

test('in-flight loading preserves new tasks, edits, and deletions made while the request is pending', async () => {
    const { state, context, run } = harness();
    context.original = task('edit'); context.deleted = task('delete');
    run("upsertProjectTask(original, 'plan-a'); upsertProjectTask(deleted, 'plan-a')");
    let resolve;
    context.fetchTasks = () => new Promise(done => { resolve = done; });
    const pending = run("loadProjectTasks('plan-a', fetchTasks)");
    await Promise.resolve();
    context.updated = task('edit', 'plan-a', 'Latest name'); context.created = task('new');
    run("upsertProjectTask(updated, 'plan-a'); upsertProjectTask(created, 'plan-a'); removeProjectTask('delete')");
    resolve([task('edit'), task('delete'), task('saved')]);
    await pending;
    assert.deepEqual(ids(state.tasks.byProject.get('plan-a')), ['edit', 'saved', 'new']);
    assert.equal(state.tasks.all.get('edit').fields.Name, 'Latest name');
    assert.equal(state.tasks.all.has('delete'), false);
});

test('late responses stay with their own plan and do not contaminate another plan', async () => {
    const { state, context, run } = harness();
    let resolve;
    context.fetchTasks = project => project === 'plan-a' ? new Promise(done => { resolve = done; }) : Promise.resolve([task('b', 'plan-b')]);
    const first = run("loadProjectTasks('plan-a', fetchTasks)");
    await Promise.resolve();
    state.session.id = 'plan-b';
    await run("loadProjectTasks('plan-b', fetchTasks)");
    resolve([task('a')]); await first;
    assert.deepEqual(ids(state.tasks.byProject.get('plan-b')), ['b']);
    assert.deepEqual(ids(state.tasks.byProject.get('plan-a')), ['a']);
});

test('empty results finish loading, failed reads remain retryable, and refreshing picks up saved tasks', async () => {
    const { context, run, state } = harness();
    context.fetchTasks = async () => { throw new Error('Offline'); };
    await assert.rejects(run("loadProjectTasks('plan-a', fetchTasks)"), /Offline/);
    assert.equal(run("getProjectTaskLoadState('plan-a').loading"), false);
    assert.equal(run("getProjectTaskLoadState('plan-a').loaded"), false);
    context.fetchTasks = async () => [];
    await run("loadProjectTasks('plan-a', fetchTasks)");
    assert.equal(run("getProjectTaskLoadState('plan-a').error"), undefined);
    assert.equal(run("getProjectTaskLoadState('plan-a').loaded"), true);
    context.fetchTasks = async () => [task('saved-later')];
    await run("loadProjectTasks('plan-a', fetchTasks, { force: true })");
    assert.deepEqual(ids(state.tasks.byProject.get('plan-a')), ['saved-later']);
});

// Exercise the real API task functions with mocked transport, never production data.
function apiHarness(fetchWithTimeout) {
    const h = harness();
    Object.assign(h.context, { fetchWithTimeout, fetch: fetchWithTimeout, BASE_ID: 'test-base', TASKS_TABLE_NAME: 'Tasks',
        PERSONAL_ACCESS_TOKEN: '', TASK_STATUS: { PENDING: 'pending' }, log() {}, scheduleAtmosphereRefresh() {},
        console: { log() {}, warn() {}, error() {} }, performance });
    const source = fs.readFileSync('api.js', 'utf8');
    const start = source.indexOf('async function appendTaskPages(');
    const end = source.indexOf('export async function updateTaskOrder(', start);
    vm.runInContext(source.slice(start, end).replace(/^export /gm, ''), h.context);
    return h;
}
const response = data => ({ ok: true, status: 200, json: async () => data });

test('task loading follows every server-filtered result page', async () => {
    const requests = [];
    const { run } = apiHarness(async url => {
        requests.push(url);
        return response(url.includes('&offset=') ? { records: [task('second')] } : { records: [task('first')], offset: 'next page' });
    });
    assert.deepEqual(ids(await run("fetchTasks('plan-a', { throwOnError: true })")), ['first', 'second']);
    assert.equal(requests.length, 2);
    assert.ok(requests[1].includes('&offset=next%20page'));
});

test('fallback task loading filters all pages by project and surfaces failures for retry', async () => {
    const { run, context } = apiHarness(async url => {
        if (url.includes('filterByFormula')) return { ok: false, text: async () => '' };
        return response(url.includes('&offset=') ? { records: [task('matching')] } : { records: [task('other', 'plan-b')], offset: 'next' });
    });
    assert.deepEqual(ids(await run("fetchTasks('plan-a', { throwOnError: true })")), ['matching']);
    context.fetchWithTimeout = async () => { throw new Error('Offline'); };
    await assert.rejects(run("fetchTasks('plan-a', { throwOnError: true })"), /Offline/);
    assert.deepEqual(ids(await run("fetchTasks('plan-a')")), []);
});

test('successful API create, edit and delete publish to the Tasks tab regardless of their originating view', async () => {
    const { run, context, state, events } = apiHarness(async (url, options) => {
        if (options.method === 'DELETE') return response({ deleted: true });
        const fields = JSON.parse(options.body).fields;
        return response({ id: 'task', fields: { ProjectId: ['plan-a'], ...fields } });
    });
    context.data = { Name: 'Created from an item', LinkedItem: 'recItem' };
    await run("createTask('plan-a', data)");
    assert.equal(state.tasks.byProject.get('plan-a')[0].fields.Name, 'Created from an item');
    await run("updateTask('task', { Name: 'Edited', Status: 'completed' })");
    assert.equal(state.tasks.byProject.get('plan-a')[0].fields.Name, 'Edited');
    assert.equal(state.tasks.byProject.get('plan-a')[0].fields.Status, 'completed');
    await run("deleteTask('task')");
    assert.deepEqual(ids(state.tasks.byProject.get('plan-a')), []);
    assert.equal(events.filter(event => event.type === 'tasks-state-updated').length, 3);
});
