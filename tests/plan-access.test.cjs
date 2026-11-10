const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(session) {
    const state = { session };
    const events = [];
    const context = vm.createContext({ state, window: { dispatchEvent: e => events.push(e.type) }, CustomEvent: class { constructor(t) { this.type = t; } }, Date });
    vm.runInContext(fs.readFileSync('utils/planAccess.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
    return { run: code => vm.runInContext(code, context), events };
}

test('signed-out visitors are view-only once a signed-in person is part of the plan', () => {
    const { run, events } = harness({ id: 'recPlan', user: { isAuthenticated: false }, loadedCollaborators: ['recUser1'] });
    assert.equal(run('isPlanReadOnly()'), true);
    assert.equal(run("blockIfReadOnly('add tasks')"), true);
    assert.equal(run("blockIfReadOnly('add tasks')"), true);
    assert.deepEqual(events, ['plan-readonly-blocked']); // prompt is throttled
});

test('signed-in users, new plans and purely anonymous plans stay editable', () => {
    assert.equal(harness({ id: 'recPlan', user: { isAuthenticated: true }, loadedCollaborators: ['recUser1'] }).run('isPlanReadOnly()'), false);
    assert.equal(harness({ id: null, user: { isAuthenticated: false } }).run('isPlanReadOnly()'), false);
    assert.equal(harness({ id: 'recPlan', user: { isAuthenticated: false }, loadedCollaborators: [], planActivity: { createdBy: null, editors: [] } }).run('isPlanReadOnly()'), false);
    assert.equal(harness({ id: 'recPlan', user: { isAuthenticated: false }, loadedCollaborators: [], planActivity: { editors: ['recUser2'] } }).run('isPlanReadOnly()'), true);
});
