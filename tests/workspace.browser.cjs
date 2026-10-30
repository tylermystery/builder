// Run against Netlify dev on :8889. Install Playwright outside the project if needed.
const { chromium } = require(process.env.WORKSPACE_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const html = fs.readFileSync('index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    // Exercise the real markup/styles/controller without production data or logins.
    await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'localhost') return route.abort();
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
        return route.continue();
    });
    await page.goto('http://localhost:8889/');
    await page.evaluate(async () => {
        const { initializeWorkspace } = await import('/utils/workspace.js');
        const byId = id => document.getElementById(id);
        byId('loading-message').hidden = true;
        byId('main-shop-title').textContent = 'What the Fun';
        byId('shop-logo-container').textContent = 'W';
        byId('catalog-container').innerHTML = '<article style="min-height:200px">Catalog item</article>';
        byId('wtf-plans-list-container').innerHTML = '<button id="test-plan-item">A saved plan</button>';
        byId('ucp-content').innerHTML = '<button id="test-message">A conversation</button>';
        byId('detail-modal-overlay').querySelector('.modal-content').innerHTML = '<button id="test-detail-action">Item details</button>';
        window.testActions = {
            openLeft: () => { byId('wtf-plans-panel').style.display = 'flex'; byId('wtf-plans-panel').classList.add('open'); },
            closeLeft: () => byId('wtf-plans-panel').classList.remove('open'),
            openRight: () => document.body.classList.add('ucp-panel-open'),
            closeRight: () => { document.body.classList.remove('ucp-panel-open'); byId('forum-panel').classList.remove('open'); },
            closeChat: () => document.body.classList.remove('ucp-panel-open'),
            closeForum: () => byId('forum-panel').classList.remove('open'),
            exitChatFullscreen: () => { document.body.classList.remove('ucp-fullscreen-active'); byId('unified-chat-panel').classList.remove('ucp-fullscreen'); },
            closeDetail: () => byId('detail-modal-overlay').classList.remove('active'),
            setCentralView: async presenting => {
                document.body.classList.toggle('presentation-active', presenting);
                byId('presentation-modal-overlay').classList.toggle('active', presenting);
            }
        };
        initializeWorkspace(window.testActions);
        window.setDetails = open => {
            const detail = byId('detail-modal-overlay');
            detail.style.cssText = 'display:flex;position:fixed;top:0;left:0;width:100%;height:100%;z-index:1100;opacity:1;align-items:center;justify-content:center;';
            detail.dataset.recordId = 'fixture-item';
            detail.classList.toggle('active', open);
            detail.style.display = open ? 'flex' : '';
        };
    });
    assert.equal(await page.locator('#workspace-controls').count(), 0);
    assert.equal(await page.locator('#main-header #user-profile-button').count(), 1);
    assert.equal(await page.locator('#main-header #main-shop-title').count(), 1);
    assert.equal(await page.locator('#main-header #shop-logo-container').count(), 1);
    assert.equal(await page.locator('#main-header #hamburger-menu-btn').count(), 1);
    let cases = 0;
    for (const width of [1440, 1100]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const presenting of [false, true]) for (const details of [false, true]) for (const left of [false, true]) for (const right of [false, true]) {
            await page.evaluate(async ({ presenting, details, left, right }) => {
                await window.testActions.setCentralView(presenting);
                window.setDetails(details);
                window.testActions[left ? 'openLeft' : 'closeLeft']();
                window.testActions[right ? 'openRight' : 'closeRight']();
            }, { presenting, details, left, right });
            await page.waitForTimeout(50);
            const geometry = await page.evaluate(() => {
                const rect = selector => {
                    const r = document.querySelector(selector).getBoundingClientRect();
                    return { x: r.x, right: r.right, width: r.width, top: r.top };
                };
                return { catalog: rect('#catalog-workspace'), plan: rect('#presentation-modal-overlay'), detail: rect('#detail-modal-overlay'), left: rect('#wtf-plans-panel'), right: rect('#unified-chat-panel') };
            });
            for (const area of ['catalog', ...(presenting ? ['plan'] : []), ...(details ? ['detail'] : [])]) {
                assert.ok(Math.abs(geometry[area].x - (left ? 360 : 0)) < 1, `${width}: ${area} left inset`);
                assert.ok(Math.abs(geometry[area].right - (width - (right ? 380 : 0))) < 1, `${width}: ${area} right inset`);
            }
            const headerHeight = await page.locator('#main-header').evaluate(node => node.getBoundingClientRect().height);
            if (left) assert.equal(geometry.left.top, headerHeight);
            if (right) assert.equal(geometry.right.top, headerHeight);
            if (details) assert.equal(geometry.detail.top, headerHeight);
            // Controls must receive clicks even with both rails and details open.
            await page.click('#hamburger-menu-btn');
            assert.equal(await page.getAttribute('#hamburger-menu-btn', 'aria-expanded'), String(!left));
            await page.click('#hamburger-menu-btn');
            await page.click('#chat-toggle-button');
            assert.equal(await page.getAttribute('#chat-toggle-button', 'aria-expanded'), String(!right));
            await page.click('#chat-toggle-button');
            cases++;
        }
    }
    await page.evaluate(() => { window.setDetails(true); window.testActions.openLeft(); window.testActions.openRight(); });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('workspace-show-plan')));
    assert.equal(await page.getAttribute('#hamburger-menu-btn', 'aria-expanded'), 'true');
    assert.equal(await page.getAttribute('#chat-toggle-button', 'aria-expanded'), 'true');
    await page.evaluate(async () => { await window.testActions.setCentralView(false); document.body.dataset.workspaceSurface = 'center'; document.dispatchEvent(new CustomEvent('workspace-surface-changed')); });
    assert.equal(await page.getAttribute('#hamburger-menu-btn', 'aria-expanded'), 'true');
    assert.equal(await page.getAttribute('#chat-toggle-button', 'aria-expanded'), 'true');
    // Escape in a rail must not also close the center detail or the other rail.
    await page.evaluate(() => window.setDetails(true));
    await page.click('#test-plan-item');
    await page.keyboard.press('Escape');
    assert.equal(await page.getAttribute('#hamburger-menu-btn', 'aria-expanded'), 'false');
    assert.equal(await page.getAttribute('#chat-toggle-button', 'aria-expanded'), 'true');
    assert.equal(await page.locator('#detail-modal-overlay').evaluate(node => node.classList.contains('active')), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'hamburger-menu-btn');
    // A legacy discussion request cannot paint over Unified Chat.
    await page.evaluate(() => {
        document.dispatchEvent(new CustomEvent('workspace-panel-opening', { detail: { surface: 'right', panel: 'forum' } }));
        document.getElementById('forum-panel').classList.add('open');
    });
    assert.equal(await page.evaluate(() => document.body.classList.contains('ucp-panel-open')), false);
    await page.evaluate(() => {
        document.dispatchEvent(new CustomEvent('workspace-panel-opening', { detail: { surface: 'right', panel: 'chat' } }));
        window.testActions.openRight();
    });
    assert.equal(await page.locator('#forum-panel').evaluate(node => node.classList.contains('open')), false);
    // Blocking dialogs keep their existing keyboard handling and cover controls.
    await page.evaluate(() => {
        const checkout = document.getElementById('checkout-modal-overlay');
        checkout.classList.add('active');
        checkout.style.display = 'flex';
    });
    assert.equal(await page.locator('#main-header').evaluate(node => getComputedStyle(node).visibility), 'hidden');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#detail-modal-overlay').evaluate(node => node.classList.contains('active')), true);
    await page.evaluate(() => {
        const checkout = document.getElementById('checkout-modal-overlay');
        checkout.classList.remove('active');
        checkout.style.display = '';
        document.body.classList.add('ucp-fullscreen-active');
        document.getElementById('unified-chat-panel').classList.add('ucp-fullscreen');
    });
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#unified-chat-panel').evaluate(node => node.inert), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.body.classList.contains('ucp-fullscreen-active')), false);
    for (const width of [1024, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(() => { window.testActions.openLeft(); window.testActions.openRight(); window.setDetails(true); document.body.dataset.workspaceSurface = 'center'; document.dispatchEvent(new CustomEvent('workspace-surface-changed')); });
        await page.waitForTimeout(50);
        await page.evaluate(async () => { await window.testActions.setCentralView(false); document.body.dataset.workspaceSurface = 'center'; document.dispatchEvent(new CustomEvent('workspace-surface-changed')); });
        await page.click('#hamburger-menu-btn');
        assert.equal(await page.evaluate(() => document.body.dataset.workspaceSurface), 'left');
        assert.equal(await page.locator('#detail-modal-overlay').evaluate(node => node.inert), true);
        await page.click('#chat-toggle-button');
        assert.equal(await page.evaluate(() => document.body.dataset.workspaceSurface), 'right');
        assert.equal(await page.getAttribute('#hamburger-menu-btn', 'aria-expanded'), 'true');
        await page.evaluate(async () => { await window.testActions.setCentralView(false); document.body.dataset.workspaceSurface = 'center'; document.dispatchEvent(new CustomEvent('workspace-surface-changed')); });
        assert.equal(await page.evaluate(() => document.body.dataset.workspaceSurface), 'center');
        assert.equal(await page.locator('#detail-modal-overlay').evaluate(node => node.inert), false);
        assert.equal(await page.locator('#detail-modal-overlay').evaluate(node => node.getBoundingClientRect().width), width);
        assert.ok(await page.locator('#main-header').evaluate(node => node.scrollWidth <= innerWidth), 'Header must fit the viewport');
        await page.screenshot({ path: `/tmp/workspace-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: '/tmp/workspace-desktop.png' });
    console.log(`Passed ${cases} desktop layout combinations, rail toggles, view persistence, keyboard dismissal, right-rail exclusivity, and tablet/mobile foreground checks.`);
    await browser.close();
})().catch(error => { console.error(error.message); process.exit(1); });
