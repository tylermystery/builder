// Who may change the open plan.
//
// Signed-out visitors can view a plan, but once any signed-in person is part of it
// (a collaborator, its creator, or an editor) they must sign in to change it. A
// brand-new or purely anonymous plan (nobody signed in has touched it) stays
// editable so people can still start planning before creating an account.
import { state } from '../state.js';

export function planHasSignedInMembers() {
    const s = state.session || {};
    const isAccount = id => typeof id === 'string' && id.startsWith('rec');
    if ((s.loadedCollaborators || []).some(isAccount)) return true;
    const activity = s.planActivity || {};
    if (isAccount(activity.createdBy)) return true;
    return (activity.editors || []).some(isAccount);
}

export function isPlanReadOnly() {
    const s = state.session || {};
    if (!s.id) return false;
    if (s.user?.isAuthenticated) return false;
    return planHasSignedInMembers();
}

let lastPromptAt = 0;

/**
 * Call before any change to the open plan. Returns true (and prompts the visitor
 * to sign in, at most every few seconds) when the change must not happen.
 */
export function blockIfReadOnly(action = 'make changes') {
    if (!isPlanReadOnly()) return false;
    const now = Date.now();
    if (now - lastPromptAt > 4000) {
        lastPromptAt = now;
        try {
            window.dispatchEvent(new CustomEvent('plan-readonly-blocked', { detail: { action } }));
        } catch { /* non-browser */ }
    }
    return true;
}
