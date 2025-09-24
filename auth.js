import { state, setState } from './state.js';
import { log } from './utils/debug.js';

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

// --- Functions ---
export function showUserModal() {
    const user = state.session.user;
    if (user.isAuthenticated) {
        profileNameEl.textContent = user.name;
        profileEmailEl.textContent = user.email;
        signinView.style.display = 'none';
        profileView.style.display = 'block';
    } else {
        signinView.style.display = 'block';
        profileView.style.display = 'none';
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
    signinMessage.style.color = '#333';
    signinMessage.textContent = `Sending magic link...`;

    try {
        // --- THIS IS THE MODIFIED PART ---
        const response = await fetch('/api/auth-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                email: email,
                siteUrl: window.location.origin // Automatically include the site's base URL
            }),
        });
        // --- END MODIFICATION ---

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to send magic link.');
        }
        
        signinMessage.style.color = '#28a745';
        signinMessage.textContent = `A sign-in link has been sent to ${email}. Please check your inbox.`;
        signinEmailInput.value = '';
    } catch (error) {
        signinMessage.style.color = '#dc3545';
        signinMessage.textContent = error.message;
    }
}

export function handleSignOut() {
    log('Auth', 'User signed out.');
    localStorage.removeItem('jwt');
    setState({
        session: { ...state.session, user: { isAuthenticated: false, id: null, name: '', email: '' } }
    });
    updateUserProfileIcon();
    hideUserModal();
}

export function updateUserProfileIcon() {
    if (state.session.user.isAuthenticated) {
        userProfileButton.classList.add('signed-in');
        userProfileButton.textContent = state.session.user.name.charAt(0).toUpperCase();
        userProfileButton.title = `Logged in as ${state.session.user.name}`;
    } else {
        userProfileButton.classList.remove('signed-in');
        userProfileButton.innerHTML = '&#128100;'; // Person emoji
        userProfileButton.title = 'Sign In / My Account';
    }
}

export function setupAuthEventListeners() {
    userProfileButton.addEventListener('click', showUserModal);
    userModalCloseBtn.addEventListener('click', hideUserModal);
    signinForm.addEventListener('submit', handleSignIn);
    signoutBtn.addEventListener('click', handleSignOut);
    
    userModalOverlay.addEventListener('click', (e) => {
        if (e.target === userModalOverlay) {
            hideUserModal();
        }
    });
}
