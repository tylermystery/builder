// FILE: components/planSync.js
//
// Keeps every open device on the latest version of the plan, and records Plan History.
//
//   • A tab coming back to the foreground, a collaborator's save (live signal over the
//     plan's realtime channel) and a slow background check (every 90s while visible)
//     each pull in the latest stored plan when it changed elsewhere.
//   • Saves themselves merge onto the latest version (see api.js / utils/planMerge.js).
//   • After a save by a signed-in person, its change list is written to Plan History.
//   • Signed-out visitors get a view-only plan (see utils/planAccess.js).
import { state } from '../state.js';
import * as api from '../api.js';
import { showToast } from '../ui.js';
import { syncPlanStateImmediate } from '../utils/planStateSync.js';
import { isPlanReadOnly } from '../utils/planAccess.js';
import { getSessionChatChannel } from '../chat.js';
import { getChannel as getPresentationChannel } from './presentation/presentationChat.js';

const CHECK_INTERVAL_MS = 90 * 1000;
const FOCUS_THROTTLE_MS = 5 * 1000;
let initialized = false;
let lastFocusCheck = 0;
let lastUpdateToast = 0;

function check(reason) {
    return api.refreshSessionFromRemote({ reason }).catch(() => false);
}

function broadcast(event, data) {
    for (const channel of [getPresentationChannel?.(), getSessionChatChannel?.()]) {
        try {
            if (channel?.subscribed) channel.trigger(event, data);
        } catch { /* realtime is best-effort */ }
    }
}

async function recordHistory({ sessionId, changes, merged }) {
    const token = localStorage.getItem('jwt');
    if (!token || !state.session.user?.isAuthenticated || !sessionId || !changes?.length) return;
    try {
        const response = await fetch('/api/plan-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ sessionId, changes, merged: !!merged, userName: state.session.user.name || null })
        });
        if (response.ok) window.dispatchEvent(new CustomEvent('plan-history-changed', { detail: { sessionId } }));
    } catch { /* history is best-effort; the plan itself is already saved */ }
}

export function updateReadOnlyUI() {
    const readOnly = isPlanReadOnly();
    document.body.classList.toggle('plan-view-readonly', readOnly);
    const banner = document.getElementById('plan-readonly-banner');
    if (banner) banner.hidden = !readOnly;
}

export function initializePlanSync() {
    if (initialized) return;
    initialized = true;

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        lastFocusCheck = Date.now();
        check('focus');
    });
    window.addEventListener('focus', () => {
        if (Date.now() - lastFocusCheck < FOCUS_THROTTLE_MS) return;
        lastFocusCheck = Date.now();
        check('focus');
    });
    setInterval(() => {
        if (document.visibilityState === 'visible' && state.session?.id) check('interval');
    }, CHECK_INTERVAL_MS);

    window.addEventListener('remote-plan-updated', (event) => {
        const data = event.detail || {};
        if (data.sessionId && data.sessionId !== state.session?.id) return;
        // Small delay so the stored record is readable everywhere before we fetch it.
        setTimeout(() => check('collaborator'), 400);
        if (data.hasChanges) window.dispatchEvent(new CustomEvent('plan-history-changed', { detail: data }));
    });

    window.addEventListener('plan-saved', (event) => {
        const detail = event.detail || {};
        broadcast('client-plan-updated', {
            sessionId: detail.sessionId,
            by: state.session.user?.id || null,
            byName: state.session.user?.name || null,
            hasChanges: (detail.changes || []).length > 0
        });
        recordHistory(detail);
    });

    window.addEventListener('plan-remote-applied', (event) => {
        const reason = event.detail?.reason;
        syncPlanStateImmediate('planSync', 'sessionLoaded');
        updateReadOnlyUI();
        if (reason !== 'readonly' && Date.now() - lastUpdateToast > 8000) {
            lastUpdateToast = Date.now();
            showToast(reason === 'merge'
                ? 'Your changes were saved alongside recent changes from collaborators.'
                : 'Plan updated with the latest changes.', 3500, 'info');
        }
        window.dispatchEvent(new CustomEvent('plan-history-changed', { detail: event.detail }));
    });

    // A signed-out visitor changed something on screen: put the plan back as stored.
    window.addEventListener('plan-readonly-revert', () => {
        api.refreshSessionFromRemote({ force: true, reason: 'readonly' }).catch(() => {});
    });
    window.addEventListener('plan-readonly-blocked', () => {
        showToast('Sign in to collaborate on this plan. You can still view everything.', 4500, 'info');
    });

    document.getElementById('plan-readonly-signin')?.addEventListener('click', () => {
        import('../auth.js').then(m => m.showUserModal()).catch(() => {});
    });

    document.addEventListener('sessionReady', updateReadOnlyUI);
    document.addEventListener('userLoggedIn', updateReadOnlyUI);
    document.addEventListener('userLoggedOut', updateReadOnlyUI);
    document.addEventListener('planStateChanged', updateReadOnlyUI);
    updateReadOnlyUI();
}
