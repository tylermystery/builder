// FILE: auth.js (REPLACE ENTIRE FILE)

// --- DEBUG ---
console.log('[auth.js] 0. File execution started.');
// --- DEBUG ---

import { state, setState } from './state.js';
import { log } from './utils/debug.js';
import * as api from './api.js'; // Import api module
import * as backgroundEngine from './components/backgroundEngine.js';

// --- DEBUG ---
console.log('[auth.js] 1. Importing effect plugins...');
console.log('[auth.js] 1a. Importing kaleidoscopeEffect.js...');
// --- DEBUG ---
import kaleidoscopeEffect from './components/effects/kaleidoscope.js';
// --- DEBUG ---
console.log('[auth.js] 1b. Importing windEffect.js...');
// --- DEBUG ---
import windEffect from './components/effects/wind.js';
// --- DEBUG ---
console.log('[auth.js] 1c. Importing waterEffect.js...');
// --- DEBUG ---
import waterEffect from './components/effects/water.js';
// --- DEBUG ---
console.log('[auth.js] 1d. Importing fractalEffect.js...');
// --- DEBUG ---
import fractalEffect from './components/effects/fractal.js';
// --- DEBUG ---
console.log('[auth.js] 2. All effect plugins imported.');
// --- DEBUG ---

// --- DOM Elements ---
const userModalOverlay = document.getElementById('user-modal-overlay');
const userModalCloseBtn = document.getElementById('user-modal-close-btn');
const signinView = document.getElementById('signin-view');
const profileView = document.getElementById('profile-view');
const signinForm = document.getElementById('signin-form');
const signinEmailInput = document.getElementById('signin-email');
const signinMessage = document.getElementById('signin-message');
const signoutBtn = document.getElementById('signout-btn');
const profileNameEl = document.getElementById('profile-name');
const profileEmailEl = document.getElementById('profile-email');
const userProfileButton = document.getElementById('user-profile-button');
const userPrefsForm = document.getElementById('user-prefs-form');
const profilePhoneInput = document.getElementById('profile-phone');
const profileNotificationsSelect = document.getElementById('profile-notifications');
const prefsMessage = document.getElementById('prefs-message');

// --- List of available background effects ---
const effects = [
    { name: "Kaleidoscope", plugin: kaleidoscopeEffect },
    { name: "Wind", plugin: windEffect },
    { name: "Water", plugin: waterEffect },
    { name: "Fractal (Simple)", plugin: fractalEffect },
];

// --- DEBUG ---
console.log(`[auth.js] 3. 'effects' array created. Length: ${effects.length}`);
// --- DEBUG ---

// Refactored function to handle a successful login from any method
async function _handleSuccessfulLogin(payload) {
    if (state.session.id) {
        await api.associateSessionWithUser(state.session.id, payload.user.id); // Use imported api
    }

    localStorage.setItem('jwt', payload.token);

    // --- MOVED STATE UPDATE HERE ---
    const initialLikedItemIdsFromPayload = payload.user.likedItemIds || [];
    setState({
        session: {
            ...state.session,
            user: {
                ...state.session.user,
                ...payload.user,
                isAuthenticated: true,
                isOwner: payload.ownerData.isOwner,
                ownerDashboardId: payload.ownerData.ownerDashboardId,
                likedItemIds: new Set(initialLikedItemIdsFromPayload)
            }
        }
    });
    console.log("[Auth] User state set immediately after login:", state.session.user);
    // --- END MOVED STATE UPDATE ---

    // --- START LIKES SYNC (Now runs *after* state is updated) ---
    const currentLikedItemIds = state.session.user.likedItemIds;
    let syncPromises = [];
    const tempLikesString = localStorage.getItem('tempLikes');
    if (tempLikesString) {
        try {
            const tempLikes = JSON.parse(tempLikesString);
            if (Array.isArray(tempLikes) && tempLikes.length > 0) {
                console.log(`[Auth] Found ${tempLikes.length} temporary likes to sync.`);
                tempLikes.forEach(itemId => {
                    if (!currentLikedItemIds.has(itemId)) {
                        console.log(`[Auth] Syncing temporary like for item: ${itemId}`);
                        syncPromises.push(
                            api.toggleUserLike(itemId) // Use imported api
                                .then(result => {
                                    if (result.success && result.liked) {
                                        state.session.user.likedItemIds.add(itemId);
                                    }
                                })
                                .catch(err => console.error(`[Auth] Error syncing like for item ${itemId}:`, err.message))
                        );
                    }
                });
            }
        } catch (e) {
            console.error('[Auth] Error parsing/processing temporary likes from localStorage:', e);
        } finally {
             localStorage.removeItem('tempLikes');
             console.log('[Auth] Cleared temporary likes from localStorage.');
        }
    }
    // --- END LIKES SYNC ---

    await Promise.allSettled(syncPromises);
    console.log('[Auth] Like sync process finished.');
    
    console.log("[Auth] Final user state after sync:", state.session.user);

    // Trigger events and update UI
    document.dispatchEvent(new CustomEvent('userLoggedIn'));
    // populateUserPlans and applyFiltersAndSort are removed from here
    // They are handled by the 'userLoggedIn' listener in main.js
    updateUserProfileIcon();
    hideUserModal();
}

export function showUserModal() {
    // --- DEBUG ---
    console.log('[auth.js] showUserModal() called.');
    // --- DEBUG ---
    const user = state.session.user;
    const ownerDashboardLink = document.getElementById('owner-dashboard-link');
    
    // --- NEW: Get Effect UI Elements ---
    const effectSelect = document.getElementById('effect-select');
    const effectControlsContainer = document.getElementById('effect-controls-container');

    if (user.isAuthenticated) {
        profileNameEl.textContent = user.name;
        profileEmailEl.textContent = user.email;
        profilePhoneInput.value = user.phoneNumber || '';
        profileNotificationsSelect.value = user.notificationFrequency || 'None';
        prefsMessage.textContent = ''; 
        signinView.style.display = 'none';
        profileView.style.display = 'block';
        if (user.isOwner && user.ownerDashboardId) {
            ownerDashboardLink.href = `/store-dashboard.html?id=${user.ownerDashboardId}`;
            ownerDashboardLink.style.display = 'block';
        } else {
            ownerDashboardLink.style.display = 'none';
        }
    } else {
        signinEmailInput.value = localStorage.getItem('lastSignInEmail') || '';
        signinView.style.display = 'block';
        profileView.style.display = 'none';
        ownerDashboardLink.style.display = 'none';
    }
    
    // --- MOVED: Populate Background Effects ---
    // This logic now runs for EVERYONE (guests + logged-in users)
    // Check if options are already populated to avoid re-adding
    // --- DEBUG ---
    console.log(`[auth.js] Populating effects dropdown. Found ${effects.length} effects.`);
    // --- DEBUG ---
    if (effectSelect && effectControlsContainer && effectSelect.innerHTML === '') {
        log('Auth', 'Populating background effect tweaks for the first time.');
        effects.forEach((effect, index) => {
            // --- DEBUG ---
            console.log(`[auth.js] Adding effect to dropdown: ${effect.name}`);
            // --- DEBUG ---
            const option = document.createElement('option');
            option.value = index;
            option.textContent = effect.name;
            effectSelect.appendChild(option);
        });
        
        // Add listener to the dropdown
        effectSelect.addEventListener('change', (e) => {
            const selectedEffect = effects[e.target.value];
            if (selectedEffect) {
                log('Auth', `User selected effect: ${selectedEffect.name}`);
                backgroundEngine.loadEffect(selectedEffect.plugin, effectControlsContainer);
            }
        });
        
        // Load the default effect (Kaleidoscope) initially
        // We assume the default <option> (value 0) is Kaleidoscope
        // --- DEBUG ---
        if (effects.length > 0 && effects[0].plugin) {
            console.log(`[auth.js] Loading default effect: ${effects[0].name}`);
            backgroundEngine.loadEffect(effects[0].plugin, effectControlsContainer);
        } else {
            console.log('[auth.js] No effects found in array to load as default.');
        }
        // --- DEBUG ---
    }
    // --- END: Moved Background Effects Logic ---

    userModalOverlay.classList.add('active');
    userModalOverlay.style.display = 'flex';
    document.body.classList.add('modal-open');
}

function hideUserModal() {
    userModalOverlay.classList.remove('active');
    setTimeout(() => { userModalOverlay.style.display = 'none'; }, 300);
    document.body.classList.add('modal-open');
}

async function handleSignIn(e) {
    e.preventDefault();
    const email = signinEmailInput.value;
    log('Auth', `Sign-in initiated for: ${email}`);
    localStorage.setItem('lastSignInEmail', email);
    signinMessage.style.color = '#333';
    signinMessage.textContent = `Sending confirmation email...`;
    try {
        const response = await fetch('/api/auth-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, siteUrl: window.location.origin }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to send confirmation email.');
        }
        
        signinMessage.style.color = '#28a745';
        signinMessage.textContent = `A confirmation link has been sent to ${email}. Please check your inbox. Waiting for confirmation...`;
        signinEmailInput.value = '';
        const pusher = new Pusher('236f480714e5001590b5', {
            cluster: 'us3',
            authEndpoint: '/api/pusher-auth'
        });
        const channelName = `private-auth-${data.channelId}`;
        const channel = pusher.subscribe(channelName);

        const loginTimeout = setTimeout(() => {
            channel.unbind('auth-success');
            pusher.unsubscribe(channelName);
            signinMessage.style.color = '#dc3545';
            signinMessage.textContent = 'Login attempt timed out. Please try again.';
        }, 5 * 60 * 1000);

        channel.bind('pusher:subscription_succeeded', () => {
            log('Auth', `Successfully subscribed to Pusher channel: ${channelName}`);
            channel.bind('auth-success', async (payload) => {
                clearTimeout(loginTimeout);
                pusher.unsubscribe(channelName);
                await _handleSuccessfulLogin(payload);
            });
        });

    } catch (error) {
        signinMessage.style.color = '#dc3545';
        signinMessage.textContent = error.message;
    }
}

// --- THIS FUNCTION IS UPDATED ---
async function handleUpdateUserPrefs(e) {
    e.preventDefault();
    prefsMessage.textContent = 'Saving...';
    prefsMessage.style.color = '#333';

    const token = localStorage.getItem('jwt');
    if (!token) {
        prefsMessage.textContent = 'Authentication error. Please sign out and in again.';
        prefsMessage.style.color = '#dc3545';
        return;
    }

    const frequency = profileNotificationsSelect.value;
    const phone = profilePhoneInput.value; // Get phone value

    try {
        const response = await fetch('/api/update-user-prefs', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` // Send JWT token
            },
            // Send 'action' and prefs data
            body: JSON.stringify({ 
                action: 'update-prefs', // Specify the action
                phone: phone, 
                frequency: frequency 
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to save preferences.');
        }
        
        setState({
            session: {
                ...state.session,
                user: { ...state.session.user, ...data.user }
            }
        });
        prefsMessage.textContent = data.message;
        prefsMessage.style.color = '#28a745';
    } catch (error) {
        prefsMessage.textContent = error.message;
        prefsMessage.style.color = '#dc3545';
    }
}

export function handleSignOut() {
    log('Auth', 'User signed out.');
    localStorage.removeItem('jwt');
    localStorage.removeItem('tempLikes'); // Clear any temporary likes on sign out

    // Reset user state, including clearing likedItemIds
    setState({
        session: {
            ...state.session,
            user: {
                isAuthenticated: false,
                id: null,
                name: '',
                email: '',
                amountReceived: 0,
                paymentHistory: [],
                rsvps: new Set(),
                isOwner: false,
                ownerDashboardId: null,
                likedItemIds: new Set() // Clear liked items
            }
        }
    });

    updateUserProfileIcon();
    hideUserModal();
    
    // Dispatch event so main.js can update plans dropdown and re-filter
    document.dispatchEvent(new CustomEvent('userLoggedOut'));
}

export function updateUserProfileIcon() {
    if (state.session.user.isAuthenticated && state.session.user.name) {
        userProfileButton.classList.add('signed-in');
        userProfileButton.textContent = state.session.user.name.charAt(0).toUpperCase();
        userProfileButton.title = `Logged in as ${state.session.user.name}`;
    } else {
        userProfileButton.classList.remove('signed-in');
        userProfileButton.innerHTML = '&#128100;';
        userProfileButton.title = 'Sign In / My Account';
    }
}

export function setupAuthEventListeners() {
    userProfileButton.addEventListener('click', showUserModal);
    userModalCloseBtn.addEventListener('click', hideUserModal);
    signinForm.addEventListener('submit', handleSignIn);
    signoutBtn.addEventListener('click', handleSignOut);
    userPrefsForm.addEventListener('submit', handleUpdateUserPrefs);
    userModalOverlay.addEventListener('click', (e) => {
        if (e.target === userModalOverlay) {
            hideUserModal();
        }
    });

    // --- NEW SSO EVENT LISTENERS ---
    const googleSsoBtn = document.getElementById('google-sso-btn');
    if (googleSsoBtn) {
        googleSsoBtn.addEventListener('click', () => {
            netlifyIdentity.open('login');
        });
    }

    netlifyIdentity.on('login', async (user) => {
        try {
            const netlifyJwt = user.token.access_token;
            // Call a new serverless function to get our app-specific JWT
            const response = await fetch('/api/auth-social', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${netlifyJwt}`
                }
            });
            if (!response.ok) throw new Error("Failed to sync social login.");

            const appPayload = await response.json();
            await _handleSuccessfulLogin(appPayload);
            netlifyIdentity.close();

        } catch (error) {
            console.error("SSO login error:", error);
            signinMessage.textContent = "Error logging in with Google. Please try again.";
            signinMessage.style.color = '#dc3545';
        }
    });
    // --- END NEW SSO EVENT LISTENERS ---
}

// --- DEBUG ---
console.log('[auth.js] 4. File execution finished. Exports are ready.');
// --- DEBUG ---
