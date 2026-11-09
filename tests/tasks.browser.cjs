// Run against Netlify dev on :8889. All task reads and writes use fixture data.
const { chromium } = require(process.env.WORKSPACE_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const html = fs.readFileSync('index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    let tasks = [
        { id: 'saved-a', fields: { Name: 'Previously saved item task', ProjectId: ['plan-a'], LinkedItem: ['recItemA'], Status: 'pending' } },
        { id: 'saved-b', fields: { Name: 'Another item task', ProjectId: ['plan-a'], LinkedItem: ['recItemB'], Status: 'completed' } },
        { id: 'plan-task', fields: { Name: 'Plan-wide task', ProjectId: ['plan-a'], Status: 'in_progress' } }
    ];
    let failTaskReads = false;
    let failMessages = false;
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        const request = route.request();
        if (url.hostname === 'localhost') {
            if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
            return route.continue();
        }
        if (url.hostname === 'api.airtable.com') {
            if (url.pathname.includes('/Tasks')) {
                if (request.method() === 'GET') {
                    if (failTaskReads) return route.fulfill({ status: 503, json: {} });
                    return route.fulfill({ json: { records: tasks } });
                }
                const id = url.pathname.split('/').at(-1);
                if (request.method() === 'DELETE') {
                    tasks = tasks.filter(task => task.id !== id);
                    return route.fulfill({ json: { deleted: true, id } });
                }
                const fields = request.postDataJSON().fields;
                if (request.method() === 'POST') {
                    const task = { id: 'new-task', fields };
                    tasks.push(task);
                    return route.fulfill({ json: task });
                }
                const task = tasks.find(task => task.id === id);
                task.fields = { ...task.fields, ...fields };
                return route.fulfill({ json: task });
            }
            if (failMessages && url.pathname.includes('/Messages')) return route.fulfill({ status: 503, json: {} });
            return route.fulfill({ json: { records: [] } });
        }
        return route.abort();
    });
    async function openFixture() {
        await page.goto('http://localhost:8889/');
        await page.evaluate(async () => {
            const { state } = await import('/state.js');
            state.session.id = 'plan-a';
            state.cart.lockedItems = new Map([['recItemA', {}], ['recItemB', {}]]);
            state.records.all = [
                { id: 'recItemA', fields: { Name: 'Item A' } },
                { id: 'recItemB', fields: { Name: 'Item B' } }
            ];
            const panel = await import('/components/unifiedChatPanel.js');
            await panel.showUnifiedChatPanel();
        });
        await page.click('.ucp-filter-btn[data-filter="tasks"]');
    }
    const cards = page.locator('.ucp-task-card');
    await openFixture();
    await cards.first().waitFor();
    assert.equal(await cards.count(), 3, 'Saved tasks load before any create/edit action');
    await page.selectOption('#ucp-attach-select', 'recItemA');
    assert.equal(await cards.count(), 1);
    assert.match(await cards.first().innerText(), /Previously saved item task/);
    await page.evaluate(async () => {
        const api = await import('/api.js');
        await api.createTask('plan-a', { Name: 'New item task', LinkedItem: 'recItemA' });
    });
    assert.equal(await cards.count(), 2, 'Task creation refreshes the selected item immediately');
    await page.evaluate(async () => {
        const api = await import('/api.js');
        await api.updateTask('new-task', { Name: 'Renamed task', LinkedItem: 'recItemB' });
    });
    assert.equal(await cards.count(), 1, 'Moving a task updates its item scope');
    await page.selectOption('#ucp-attach-select', 'recItemB');
    assert.equal(await cards.count(), 2);
    assert.match(await page.locator('[data-task-id="new-task"]').innerText(), /Renamed task/);
    await page.selectOption('#ucp-attach-select', '');
    assert.equal(await cards.count(), 4);
    await openFixture();
    await cards.first().waitFor();
    assert.equal(await cards.count(), 4, 'All persisted tasks survive page reload');
    await page.evaluate(async () => { const api = await import('/api.js'); await api.deleteTask('new-task'); });
    assert.equal(await cards.count(), 3, 'Deleted tasks disappear immediately');
    // Conversation failures must not prevent an independent task load.
    failMessages = true;
    await openFixture();
    await cards.first().waitFor();
    assert.equal(await cards.count(), 3);
    failTaskReads = true;
    await openFixture();
    await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    failTaskReads = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await cards.first().waitFor();
    assert.equal(await cards.count(), 3, 'Retry restores saved tasks');
    assert.deepEqual(pageErrors, []);
    console.log('Passed Tasks tab cold load, item scoping, create/edit/delete refresh, page reload, independent loading, and retry browser checks.');
    await browser.close();
})().catch(error => { console.error(error.message); process.exit(1); });
