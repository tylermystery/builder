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

export function showUserModal(view = 'signin') {
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
    log('Auth', `Sign-in initiated for: ${email}`);
    signinMessage.style.color = '#28a745';
    signinMessage.textContent = `Sending magic link...`;

    // For now, we simulate the success message.
    setTimeout(() => {
        signinMessage.textContent = `A sign-in link has been sent to ${email}. Please check your inbox.`;
        signinEmailInput.value = '';
    }, 1000);
}

function handleSignOut() {
    log('Auth', 'User signed out.');
    state.session.user = null;
    profileBtn.classList.remove('signed-in');
    hideUserModal();
}

export function setupAuthEventListeners() {
    profileBtn.addEventListener('click', () => {
        showUserModal('signin'); 
    });
    
    userModalCloseBtn.addEventListener('click', hideUserModal);
    signinForm.addEventListener('submit', handleSignIn);
    signoutBtn.addEventListener('click', handleSignOut);
    
    userModalOverlay.addEventListener('click', (e) => {
        if (e.target === userModalOverlay) {
            hideUserModal();
        }
    });
}

export function isAuthenticated() {
    return false; 
}
