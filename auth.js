// REPLACE THE ENTIRE CONTENTS OF: auth.js

import { state, setState } from './state.js';
import { log } from './utils/debug.js';
import { associateSessionWithUser } from './api.js';
import * as api from './api.js';

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

// FILE: auth.js (REPLACE _handleSuccessfulLogin function)

// Refactored function to handle a successful login from any method
async function _handleSuccessfulLogin(payload) {
    // Associate session if one exists before login
    if (state.session.id) {
        await associateSessionWithUser(state.session.id, payload.user.id); //
    }

    localStorage.setItem('jwt', payload.token); //

    // --- START LIKES INTEGRATION ---
    const likedItemIds = payload.user.likedItemIds || []; // Get liked IDs from payload
    const currentLikedItemIds = new Set(likedItemIds); // Initialize Set with persistent likes
    let syncPromises = [];

    // Sync temporary likes stored in localStorage
    const tempLikesString = localStorage.getItem('tempLikes');
    if (tempLikesString) {
        try {
            const tempLikes = JSON.parse(tempLikesString);
            if (Array.isArray(tempLikes) && tempLikes.length > 0) {
                console.log(`[Auth] Found ${tempLikes.length} temporary likes to sync.`);
                tempLikes.forEach(itemId => {
                    // Only sync if it's not already in the persistent list
                    if (!currentLikedItemIds.has(itemId)) {
                        console.log(`[Auth] Syncing temporary like for item: ${itemId}`);
                        // Call toggleUserLike - it handles adding the like on the backend
                        // We use .then() here to avoid awaiting each one individually,
                        // allowing them to run concurrently but still handling errors.
                        syncPromises.push(
                            api.toggleUserLike(itemId)
                                .then(result => {
                                    if (result.success && result.liked) {
                                        currentLikedItemIds.add(itemId); // Update local state immediately
                                    }
                                })
                                .catch(err => console.error(`[Auth] Error syncing like for item ${itemId}:`, err))
                        );
                    }
                });
            }
        } catch (e) {
            console.error('[Auth] Error parsing temporary likes from localStorage:', e);
        } finally {
             localStorage.removeItem('tempLikes'); // Clear temp likes after attempting sync
             console.log('[Auth] Cleared temporary likes from localStorage.');
        }
    }
    // --- END LIKES INTEGRATION ---


    // Wait for all sync operations to attempt completion (errors are logged individually)
    await Promise.allSettled(syncPromises);
    console.log('[Auth] Like sync process finished.');

    // Update the main application state
    setState({
        session: {
            ...state.session,
            user: {
                ...state.session.user, // Keep existing user details like payment history
                ...payload.user, // Overwrite with basic user info from payload
                isAuthenticated: true, //
                isOwner: payload.ownerData.isOwner, //
                ownerDashboardId: payload.ownerData.ownerDashboardId, //
                likedItemIds: currentLikedItemIds // Set the final liked IDs Set
            }
        }
    });

    console.log("[Auth] User state after login and sync:", state.session.user);

    // Trigger events and update UI
    document.dispatchEvent(new CustomEvent('userLoggedIn')); //
    await populateUserPlans(payload.user.id); // Refresh user plans dropdown - Ensure populateUserPlans is imported or accessible
    updateUserProfileIcon(); //
    hideUserModal(); //

    // Re-apply filters which might now include newly synced "My Likes"
    applyFiltersAndSort(imageCache); // Ensure applyFiltersAndSort and imageCache are accessible
}

export function showUserModal() {
    const user = state.session.user;
    const ownerDashboardLink = document.getElementById('owner-dashboard-link');
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
    userModalOverlay.classList.add('active');
    userModalOverlay.style.display = 'flex';
    document.body.classList.add('modal-open');
}

function hideUserModal() {
    userModalOverlay.classList.remove('active');
    setTimeout(() => { userModalOverlay.style.display = 'none'; }, 300);
    document.body.classList.remove('modal-open');
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

async function handleUpdateUserPrefs(e) {
    e.preventDefault();
    prefsMessage.textContent = 'Saving...';
    prefsMessage.style.color = '#333';
    const frequency = profileNotificationsSelect.value;
    const userId = state.session.user.id;
    try {
        const response = await fetch('/api/update-user-prefs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, frequency }),
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

// FILE: auth.js (REPLACE handleSignOut function)

export function handleSignOut() {
    log('Auth', 'User signed out.'); //
    localStorage.removeItem('jwt'); //
    localStorage.removeItem('tempLikes'); // Clear any temporary likes on sign out

    // Reset user state, including clearing likedItemIds
    setState({
        session: {
            ...state.session,
            user: {
                isAuthenticated: false, //
                id: null, //
                name: '', //
                email: '', //
                amountReceived: 0, // Reset financial info if needed
                paymentHistory: [],
                rsvps: new Set(),
                isOwner: false, //
                ownerDashboardId: null, //
                likedItemIds: new Set() // Clear liked items
            }
        }
    });

    updateUserProfileIcon(); //
    hideUserModal(); //
    populateUserPlans(null); // Clear/reset plans dropdown - Ensure accessible
    applyFiltersAndSort(imageCache); // Re-apply filters for logged-out state - Ensure accessible
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
