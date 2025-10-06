// REPLACE THE ENTIRE CONTENTS OF: auth.js

import { state, setState } from './state.js';
import { log } from './utils/debug.js';
import { associateSessionWithUser } from './api.js';
import { initializeSessionChat } from './chat.js';

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

async function _handleSuccessfulLogin(payload) {
    if (state.session.id) {
        await associateSessionWithUser(state.session.id, payload.user.id);
    }
    
    localStorage.setItem('jwt', payload.token);
                
    setState({ 
        session: { 
            ...state.session, 
            user: { 
                ...state.session.user, 
                ...payload.user, 
                isAuthenticated: true,
                isOwner: payload.ownerData.isOwner,
                ownerDashboardId: payload.ownerData.ownerDashboardId
            } 
        } 
    });

    console.log("User state after update:", state.session.user);

    document.dispatchEvent(new CustomEvent('userLoggedIn'));
    
    updateUserProfileIcon();
    hideUserModal();
}

export function showUserModal() {
    const user = state.session.user;
    const ownerDashboardLink = document.getElementById('owner-dashboard-link');
    if (user.isAuthenticated) {
        profileNameEl.textContent = user.name;
        profileEmailEl.textContent = user.email;
        profilePhoneInput.value = user.phoneNumber || '';
        // --- THIS IS A FIX ---
        profileNotificationsSelect.value = user.notificationFrequency === 'Real-Time' ? 'Real-Time' : 'None';
        // --- END FIX ---
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

export function handleSignOut() {
    log('Auth', 'User signed out.');
    localStorage.removeItem('jwt');
    setState({
        session: { ...state.session, user: { isAuthenticated: false, id: null, name: '', email: '', isOwner: false, ownerDashboardId: null } }
    });
    // Re-initialize chat to get a new anonymous identity
    initializeSessionChat();
    updateUserProfileIcon();
    hideUserModal();
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

    // --- THIS IS A FIX ---
    // Listen for the userLoggedIn event and re-initialize chat to update the user's identity.
    document.addEventListener('userLoggedIn', () => {
        log('Auth', 'userLoggedIn event detected, re-initializing chat.');
        initializeSessionChat();
    });
    // --- END FIX ---

    const googleSsoBtn = document.getElementById('google-sso-btn');
    if (googleSsoBtn) {
        googleSsoBtn.addEventListener('click', () => {
            netlifyIdentity.open('login');
        });
    }

    netlifyIdentity.on('login', async (user) => {
        try {
            const netlifyJwt = user.token.access_token;
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
}
