const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadModule(path, globals) {
    const source = fs.readFileSync(path, 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace(/^export /gm, '');
    const context = vm.createContext({ console: { log() {}, warn() {} }, ...globals });
    vm.runInContext(source, context);
    return code => vm.runInContext(code, context);
}
function element() {
    return {
        style: {}, value: '', children: [], classList: { add() {} },
        appendChild(child) { this.children.push(child); },
        set innerHTML(value) { this.html = value; this.children = []; },
        get innerHTML() { return this.html; }
    };
}
function chatHarness() {
    const select = element();
    const state = {
        session: { id: 'plan-a' }, cart: { lockedItems: new Map([['a', {}], ['b', {}]]), items: new Map() },
        tasks: { byProject: new Map([['plan-a', [
            { id: 'task-a', fields: { LinkedItem: ['a'], Status: 'pending' } },
            { id: 'task-b', fields: { LinkedItem: ['b'], Status: 'completed' } },
            { id: 'plan-task', fields: { Status: 'pending' } }
        ]]]) }
    };
    const run = loadModule('components/unifiedChatPanel.js', {
        state, getRecordById: id => ({ fields: { Name: id } }),
        document: {
            getElementById: id => id === 'ucp-attach-select' ? select : null,
            createElement: element, body: { classList: { contains: () => true } }
        }
    });
    return { run, state, select };
}

test('item scope filters threads, retains replies, restores plan-wide, and survives repopulation', () => {
    const { run, select } = chatHarness();
    run("setUCPItemScope('a')");
    assert.equal(select.value, 'a');
    assert.equal(run("messageMatchesScope({componentId:'b', replies:[]})"), false);
    assert.equal(run("messageMatchesScope({componentId:'a', replies:[{componentId:'b'}]})"), true);
    assert.equal(run("messageMatchesScope({componentId:null, replies:[{componentId:'a'}]})"), true);
    run('populateAttachSelect()');
    assert.equal(select.value, 'a');
    run('setUCPItemScope(null)');
    assert.equal(run("messageMatchesScope({componentId:'b'})"), true);
});

test('removed items and plan changes clear the local selection without changing stream focus', () => {
    const { run, state, select } = chatHarness();
    state.stream = { focusItemId: 'broadcast-topic' };
    run("setUCPItemScope('a')");
    state.cart.lockedItems.delete('a');
    run('populateAttachSelect()');
    assert.equal(select.value, '');
    run("setUCPItemScope('b')");
    state.session.id = 'plan-b';
    run('populateAttachSelect()');
    assert.equal(select.value, '');
    assert.equal(state.stream.focusItemId, 'broadcast-topic');
});

test('tasks use the same scope and plan-wide includes unlinked tasks', () => {
    const { run } = chatHarness();
    run('createTaskTabCard = task => task; globalThis.container = {children:[], appendChild(child){this.children.push(child)}}');
    run("setUCPItemScope('a'); renderTasksTab(container)");
    assert.match(run('container.children[0].innerHTML'), /<strong>1<\/strong> total/);
    assert.equal(run('container.children[1].children[1].id'), 'task-a');
    run('setUCPItemScope(null); container.children = []; renderTasksTab(container)');
    assert.match(run('container.children[0].innerHTML'), /<strong>3<\/strong> total/);
});

test('detail layout measures either or both rails and releases insets on narrow screens', () => {
    let update;
    const widths = new Map();
    const classes = new Set();
    const panel = width => ({ classList: { contains: name => classes.has(name) }, getBoundingClientRect: () => ({ width }) });
    const panels = { 'detail-modal-overlay': {}, 'wtf-plans-panel': panel(360), 'forum-panel': panel(495), 'unified-chat-panel': panel(380) };
    const bodyClasses = new Set();
    const window = { innerWidth: 1400, addEventListener() {} };
    const run = loadModule('utils/detailModalLayout.js', {
        window,
        MutationObserver: class { constructor(fn) { update = fn; } observe() {} },
        ResizeObserver: class { observe() {} },
        document: { getElementById: id => panels[id], body: { classList: { contains: name => bodyClasses.has(name) } },
            documentElement: { style: { setProperty: (name, value) => widths.set(name, value) } } }
    });
    run('initializeDetailModalLayout()');
    assert.equal(widths.get('--detail-left-inset'), '0px');
    assert.equal(widths.get('--detail-right-inset'), '0px');
    bodyClasses.add('ucp-panel-open'); update();
    assert.equal(widths.get('--detail-right-inset'), '380px');
    classes.add('open'); update();
    assert.equal(widths.get('--detail-left-inset'), '360px');
    assert.equal(widths.get('--detail-right-inset'), '495px');
    bodyClasses.clear(); classes.clear(); update();
    assert.equal(widths.get('--detail-right-inset'), '0px');
    classes.add('open'); window.innerWidth = 768; update();
    assert.equal(widths.get('--detail-left-inset'), '0px');
    assert.equal(widths.get('--detail-right-inset'), '0px');
});
