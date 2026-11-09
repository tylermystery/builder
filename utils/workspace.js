import { initializeDetailModalLayout } from './detailModalLayout.js';

let initialized = false;
// A surface can be foregrounded on small screens without changing rail open state.
export function activateWorkspaceSurface(surface) {
    if (document.body.dataset.workspaceSurface === surface) return;
    document.body.dataset.workspaceSurface = surface;
    document.dispatchEvent(new CustomEvent('workspace-surface-changed', { detail: { surface } }));
}

export function initializeWorkspace(actions) {
    if (initialized) return;
    const controls = document.getElementById('main-header');
    if (!controls) return;
    initialized = true;
    document.body.classList.add('workspace-ready');
    initializeDetailModalLayout();
    const byId = id => document.getElementById(id);
    const left = byId('wtf-plans-panel');
    const forum = byId('forum-panel');
    const chat = byId('unified-chat-panel');
    const detail = byId('detail-modal-overlay');
    const leftToggle = byId('hamburger-menu-btn');
    const rightToggle = byId('chat-toggle-button');
    const isLeftOpen = () => left?.classList.contains('open');
    const isRightOpen = () => document.body.classList.contains('ucp-panel-open') || forum?.classList.contains('open');
    let previousLeft = isLeftOpen();
    let previousRight = isRightOpen();
    let previousDetail = detail?.classList.contains('active');
    let lastSurface = 'center';
    let centerFocus = null;
    let switching = false;
    let updating = false;
    const focusControl = node => node?.focus({ preventScroll: true });

    function update() {
        if (updating) return;
        updating = true;
        try {
            const leftOpen = isLeftOpen();
            const rightOpen = isRightOpen();
            const detailOpen = detail?.classList.contains('active');
            const presenting = document.body.classList.contains('presentation-active');
            leftToggle.setAttribute('aria-expanded', String(leftOpen));
            rightToggle.setAttribute('aria-expanded', String(!!rightOpen));
            leftToggle.setAttribute('aria-controls', 'wtf-plans-panel');
            leftToggle.setAttribute('aria-label', leftOpen ? 'Close plans menu' : 'Open plans menu');
            rightToggle.setAttribute('aria-label', rightOpen ? 'Close conversations and tasks' : 'Open conversations and tasks');
            rightToggle.setAttribute('aria-controls', forum?.classList.contains('open') ? 'forum-panel' : 'unified-chat-panel');
            const browseBar = left?.querySelector('.wtf-plans-browse-catalog-bar');
            if (browseBar) {
                browseBar.hidden = !presenting;
                browseBar.style.display = presenting ? 'block' : 'none';
            }
            if (leftOpen && !previousLeft) activateWorkspaceSurface('left');
            else if (rightOpen && !previousRight) activateWorkspaceSurface('right');
            else if (detailOpen && !previousDetail) activateWorkspaceSurface('center');
            if (!leftOpen && previousLeft) {
                if (left?.contains(document.activeElement)) focusControl(leftToggle);
                if (document.body.dataset.workspaceSurface === 'left') activateWorkspaceSurface('center');
            }
            if (!rightOpen && previousRight) {
                if (chat?.contains(document.activeElement) || forum?.contains(document.activeElement)) focusControl(rightToggle);
                if (document.body.dataset.workspaceSurface === 'right') activateWorkspaceSurface('center');
            }
            if (!detailOpen && previousDetail && detail?.contains(document.activeElement)) {
                focusControl(centerFocus?.isConnected ? centerFocus : leftToggle);
            }
            previousLeft = leftOpen;
            previousRight = rightOpen;
            previousDetail = detailOpen;
            // Suppress off-screen surfaces from keyboard and accessibility navigation.
            const narrow = window.innerWidth < 1100;
            const surface = document.body.dataset.workspaceSurface || 'center';
            const fullscreen = document.body.classList.contains('ucp-fullscreen-active');
            const centerHidden = (narrow && surface !== 'center') || fullscreen;
            byId('catalog-workspace').inert = centerHidden || presenting || !!detailOpen;
            byId('presentation-modal-overlay').inert = centerHidden || !presenting || !!detailOpen;
            detail.inert = centerHidden || !detailOpen;
            left.inert = !leftOpen || (narrow && surface !== 'left') || fullscreen;
            forum.inert = !forum.classList.contains('open') || (narrow && surface !== 'right') || fullscreen;
            chat.inert = !document.body.classList.contains('ucp-panel-open') || (!fullscreen && narrow && surface !== 'right');
        } finally { updating = false; }
    }

    async function showCenter(presenting) {
        if (switching) return;
        switching = true;
        try {
            const alreadyPresenting = document.body.classList.contains('presentation-active');
            // Returning to the same central view simply foregrounds it on mobile.
            if (alreadyPresenting !== presenting) {
                if (detail.classList.contains('active')) actions.closeDetail();
                await actions.setCentralView(presenting);
            }
            activateWorkspaceSurface('center');
            update();
        } finally {
            switching = false;
        }
    }
    leftToggle.addEventListener('click', event => {
        event.stopImmediatePropagation();
        if (isLeftOpen() && (window.innerWidth >= 1100 || document.body.dataset.workspaceSurface === 'left')) actions.closeLeft();
        else if (isLeftOpen()) activateWorkspaceSurface('left');
        else actions.openLeft();
        update();
    }, true);
    rightToggle.addEventListener('click', event => {
        event.stopImmediatePropagation();
        if (isRightOpen() && (window.innerWidth >= 1100 || document.body.dataset.workspaceSurface === 'right')) actions.closeRight();
        else if (isRightOpen()) activateWorkspaceSurface('right');
        else actions.openRight();
        update();
    }, true);
    document.addEventListener('workspace-show-plan', () => showCenter(true));
    document.addEventListener('workspace-panel-opening', event => {
        const { surface, panel } = event.detail;
        if (panel === 'chat' && forum.classList.contains('open')) actions.closeForum();
        if (panel === 'forum' && document.body.classList.contains('ucp-panel-open')) actions.closeChat();
        activateWorkspaceSurface(surface);
    });
    document.addEventListener('workspace-surface-changed', () => {
        lastSurface = document.body.dataset.workspaceSurface || 'center';
        update();
    });
    document.addEventListener('pointerdown', event => {
        if (controls.contains(event.target)) return;
        lastSurface = left.contains(event.target) ? 'left' :
            (chat.contains(event.target) || forum.contains(event.target)) ? 'right' : 'center';
        if (lastSurface === 'center' && !detail.contains(event.target)) centerFocus = event.target.closest('button, a, [tabindex]');
    }, true);
    document.addEventListener('focusin', event => {
        if (controls.contains(event.target)) return;
        lastSurface = left.contains(event.target) ? 'left' :
            (chat.contains(event.target) || forum.contains(event.target)) ? 'right' : 'center';
        if (lastSurface === 'center' && !detail.contains(event.target)) centerFocus = event.target;
    });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        // Leave blocking dialogs and nested popups to their existing handlers.
        if (document.querySelector('.modal-overlay.active:not(#detail-modal-overlay), .task-modal-overlay.active, .task-detail-modal-overlay.active, .image-lightbox-overlay, .emoji-picker.open, .ucp-pin-picker.open, .ucp-emoji-picker.open')) return;
        const active = window.innerWidth < 1100 ? document.body.dataset.workspaceSurface : lastSurface;
        let close;
        if (document.body.classList.contains('ucp-fullscreen-active')) close = actions.exitChatFullscreen;
        else if (active === 'left' && isLeftOpen()) close = actions.closeLeft;
        else if (active === 'right' && isRightOpen()) close = actions.closeRight;
        else if (detail.classList.contains('active')) close = actions.closeDetail;
        else if (document.body.classList.contains('presentation-active')) close = () => showCenter(false);
        else if (isRightOpen()) close = actions.closeRight;
        else if (isLeftOpen()) close = actions.closeLeft;
        if (close) {
            event.preventDefault();
            event.stopImmediatePropagation();
            close();
            update();
        }
    }, true);
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    [left, forum, chat, detail, byId('presentation-modal-overlay')].forEach(node => {
        observer.observe(node, { attributes: true, attributeFilter: ['class', 'data-record-id'] });
    });
    document.querySelectorAll('.ucp-filter-btn').forEach(button => {
        observer.observe(button, { attributes: true, attributeFilter: ['class'] });
    });
    const measureHeader = () => document.documentElement.style.setProperty('--workspace-header-height', `${controls.getBoundingClientRect().height}px`);
    new ResizeObserver(measureHeader).observe(controls);
    measureHeader();
    window.addEventListener('resize', update);
    // Session navigation reloads application data; carry only layout preferences.
    window.addEventListener('pagehide', () => {
        try {
            sessionStorage.setItem('wtf-workspace-layout', JSON.stringify({
                left: isLeftOpen(), right: !!isRightOpen(),
                leftFilter: left.querySelector('.wtf-plans-filter-btn.active')?.dataset.filter,
                leftScrollTop: byId('wtf-plans-list-container')?.scrollTop || 0,
                rightPreferences: actions.getRightPreferences?.()
            }));
        } catch { /* Storage can be unavailable in private browsing. */ }
    });
    document.addEventListener('workspace-restore', async () => {
        try {
            const saved = JSON.parse(sessionStorage.getItem('wtf-workspace-layout') || 'null');
            if (saved?.left) {
                await actions.openLeft({ skipPushState: true, filter: saved.leftFilter });
                const list = byId('wtf-plans-list-container');
                if (list) list.scrollTop = Math.max(0, Number(saved.leftScrollTop) || 0);
            }
            if (saved?.right && !isRightOpen()) await actions.openRight(saved.rightPreferences);
        } catch { /* Invalid or unavailable transient UI preferences are ignored. */ }
        activateWorkspaceSurface('center');
        update();
    }, { once: true });
    activateWorkspaceSurface('center');
    update();
}
