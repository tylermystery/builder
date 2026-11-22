// FILE: components/collab.js
//
// Collab membership on the client.
//   • Signing in on a store makes you one of its contributors (decision: by
//     creating an account / logging in). Store admins can approve you as a member.
//   • Reactions and comments held while signed out are sent once you sign in.
import { state } from '../state.js';
import * as api from '../api.js';
import { showToast } from '../ui.js';
import { flushPendingCollab } from '../utils/pendingCollab.js';

let initialized = false;
const joined = new Set();

function activeStoreId() {
    return state.ui?.activeShopId || state.session?.storeId || null;
}

async function joinActiveStore() {
    const storeId = activeStoreId();
    const userId = state.session?.user?.id;
    if (!state.session?.user?.isAuthenticated || !storeId || !userId) return;
    const key = `${userId}:${storeId}`;
    if (joined.has(key)) return;
    joined.add(key);
    const status = await api.joinStoreCollab(storeId);
    if (!status) joined.delete(key); // try again on the next sign-in or store change
}

async function sendHeldCollab() {
    if (!state.session?.user?.isAuthenticated) return;
    const { sent } = await flushPendingCollab(state.session.user.name || null);
    if (sent > 0) {
        showToast(`Shared ${sent} reaction${sent === 1 ? '' : 's'} and comment${sent === 1 ? '' : 's'} you made before signing in.`, 4000, 'success');
        // Refresh the community data on screen so it shows them under your name.
        window.dispatchEvent(new CustomEvent('public-catalog-refresh'));
    }
}

export function initializeCollab() {
    if (initialized) return;
    initialized = true;
    const onSignedIn = () => { joinActiveStore(); sendHeldCollab(); };
    document.addEventListener('userLoggedIn', onSignedIn);
    document.addEventListener('sessionReady', joinActiveStore);
    document.addEventListener('userLoggedOut', () => joined.clear());
    onSignedIn(); // already signed in from a previous visit
}
