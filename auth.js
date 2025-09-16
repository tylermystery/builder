// FILE: auth.js
import { state } from './state.js';
import { log } from './utils/debug.js';

const userModalOverlay = document.getElementById('user-modal-overlay');
const userModalCloseBtn = document.getElementById('user-modal-close-btn');
const signinView = document.getElementById('signin-view');
const profileView = document.getElementById('profile-view');
const signinForm = document.getElementById('signin-form');
const signinEmailInput = document.getElementById('signin-email');
const signinMessage = document.getElementById('signin-message');
const signoutBtn = document.getElementById('signout-btn');
const profileBtn = document.getElementById('user-profile-button');

function showUserModal(view = 'signin') {
    signinView.style.display = view === 'signin' ? 'block' : 'none';
    profileView.style.display = view === 'profile' ? 'block' : 'none';
    userModalOverlay.classList.add('active');
    userModalOverlay.style.display = 'flex';
    document.body.classList.add('modal-open');
}

function hideUserModal() {
    userModalOverlay.classList.remove('active');
    setTimeout(() => {
        userModalOverlay.style.display = 'none';
    }, 300);
    document.body.classList.remove('modal-open');
}

async function handleSignIn(e) {
    e.preventDefault();
    const email = signinEmailInput.value;
    log('Auth', `Attempting sign-in for: ${email}`);

    // This is where we will call our new serverless function.
    // For now, we'll simulate the "email sent" message.
    signinMessage.textContent = `A sign-in link has been sent to ${email}. Please check your inbox.`;
    signinEmailInput.value = '';

    // In a real implementation, you would make a fetch call here:
    /*
    try {
        const response = await fetch('/api/auth-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        if (!response.ok) {
            throw new Error('Failed to send magic link.');
        }
        signinMessage.textContent = `A sign-in link has been sent to ${email}. Please check your inbox.`;
    } catch (error) {
        signinMessage.textContent = 'Error sending link. Please try again.';
        signinMessage.style.color = 'red';
    }
    */
}

function handleSignOut() {
    log('Auth', 'User signed out.');
    // Clear user from state and local storage in a real implementation
    hideUserModal();
    profileBtn.classList.remove('signed-in');
}

export function setupAuthEventListeners() {
    profileBtn.addEventListener('click', () => {
        // In a real implementation, you would check auth status here
        // For now, we just open the sign-in view.
        showUserModal('signin');
    });
    
    userModalCloseBtn.addEventListener('click', hideUserModal);
    signinForm.addEventListener('submit', handleSignIn);
    signoutBtn.addEventListener('click', handleSignOut);
}

// This function will eventually check for a valid session token.
// For now, it simulates a logged-out user.
export function isAuthenticated() {
    // In a real implementation, you would check for a valid session token in localStorage.
    // e.g., return !!localStorage.getItem('sessionToken');
    return false; 
}
