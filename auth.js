// REPLACE THE ENTIRE CONTENTS of auth.js

import { state, setState } from './state.js';
import { log } from './utils/debug.js';
import { updateUrl, getUrlParams } from './utils.js';
import { CONSTANTS } from './config.js';

let shopId = null;
let tippyInstance = null;

console.log('[auth.js] 0. File execution started.');

import * as fractalEffect from './components/effects/fractal.js';
console.log('[auth.js] 1a. Importing fractalEffect.js...');
import * as fluidEffect from './components/effects/fluid.js';
console.log('[auth.js] 1b. Importing fluidEffect.js...');

console.log('[auth.js] 2. All effect plugins imported.');

const effects = [
    { name: 'Fractal', module: fractalEffect, controlsContainer: document.getElementById('fractal-controls') },
    { name: 'Fluid', module: fluidEffect, controlsContainer: document.getElementById('fluid-controls') },
];
console.log('[auth.js] 3. \'effects\' array created. Length:', effects.length);

export function showUserModal(initialView = 'login') {
    const modal = document.getElementById('user-modal-overlay');
    // --- Add a check here in case modal doesn't exist ---
    if (!modal) {
        console.warn('showUserModal called, but user modal overlay not found.');
        return; 
    }
    // --- End check ---
    
    const loginView = document.getElementById('login-view');
    const signupView = document.getElementById('signup-view');
    const verifyView = document.getElementById('verify-view');
    const resetView = document.getElementById('reset-view');
    const welcomeView = document.getElementById('welcome-view');
    const profileView = document.getElementById('profile-view');
    const views = [loginView, signupView, verifyView, resetView, welcomeView, profileView];
    
    views.forEach(view => {
        if (view) view.style.display = 'none';
    });
    
    // Check if error message elements exist before setting text
    document.getElementById('auth-error-msg')?.textContent = '';
    document.getElementById('verify-error-msg')?.textContent = '';
    document.getElementById('reset-error-msg')?.textContent = '';
    
    const user = state.session.user;
    if (user.isAuthenticated) {
        if (profileView) profileView.style.display = 'block';
        if (document.getElementById('profile-email')) {
             document.getElementById('profile-email').textContent = user.email;
        }
        if (document.getElementById('profile-plan-count')) {
            document.getElementById('profile-plan-count').textContent = user.planIds.length;
        }
    } else {
        if (initialView === 'login' && loginView) {
            loginView.style.display = 'block';
        } else if (initialView === 'signup' && signupView) {
            signupView.style.display = 'block';
        } else if (initialView === 'verify' && verifyView) {
            verifyView.style.display = 'block';
        } else if (initialView === 'reset' && resetView) {
            resetView.style.display = 'block';
        }
    }
    
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
    document.body.classList.add('modal-open');
}

function closeUserModal() {
    const modal = document.getElementById('user-modal-overlay');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
    document.body.classList.remove('modal-open');
}

// --- THIS FUNCTION IS RENAMED and EXPORTED ---
export function initializeAuth(activeShopId) {
    shopId = activeShopId;
    // --- THIS IS THE FIX ---
    // The extra "=" is removed from the line below
    const modal = document.getElementById('user-modal-overlay');
    // --- END THE FIX ---

    // If the modal doesn't exist on this page, just stop.
    if (!modal) {
        log('Auth', 'Auth modal not found on this page. Skipping auth event listeners.');
        return;
    }

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeUserModal();
        }
    });
    
    // Add null checks for all buttons
    const closeBtn = document.getElementById('user-modal-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeUserModal);
    }
    
    // Switch view triggers
    document.querySelectorAll('.toggle-auth-view').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = e.target.dataset.view;
            showUserModal(targetView);
        });
    });

    // Handle Login
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            const errorMsg = document.getElementById('auth-error-msg');
            errorMsg.textContent = '';
            
            try {
                const response = await fetch('/api/auth-start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password, shopId, authType: 'login' })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error);
                
                if (data.success && data.token) {
                    // Successful login
                    localStorage.setItem(CONSTANTS.AUTH_TOKEN_KEY, data.token);
                    setState({ session: { ...state.session, user: data.user } });
                    updateUserProfileIcon();
                    document.getElementById('welcome-email').textContent = data.user.email;
                    showUserModal('welcome');
                }
            } catch (err) {
                errorMsg.textContent = err.message;
            }
        });
    }

    // Handle Signup
    const signupForm = document.getElementById('signup-form');
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('signup-email').value;
            const password = document.getElementById('signup-password').value;
            const passwordConfirm = document.getElementById('signup-password-confirm').value;
            const errorMsg = document.getElementById('auth-error-msg');
            errorMsg.textContent = '';
            
            if (password !== passwordConfirm) {
                errorMsg.textContent = 'Passwords do not match.';
                return;
            }
            
            try {
                const response = await fetch('/api/auth-start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password, shopId, authType: 'signup' })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error);

                if (data.success) {
                    document.getElementById('verify-email-display').textContent = email;
                    showUserModal('verify');
                }
            } catch (err) {
                errorMsg.textContent = err.message;
            }
        });
    }

    // Handle Verify
    const verifyForm = document.getElementById('verify-form');
    if (verifyForm) {
        verifyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('verify-email-display').textContent;
            const code = document.getElementById('verify-code').value;
            const errorMsg = document.getElementById('verify-error-msg');
            errorMsg.textContent = '';
            
            try {
                const response = await fetch('/api/auth-verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, code, shopId })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error);

                if (data.success && data.token) {
                    localStorage.setItem(CONSTANTS.AUTH_TOKEN_KEY, data.token);
                    setState({ session: { ...state.session, user: data.user } });
                    updateUserProfileIcon();
                    document.getElementById('welcome-email').textContent = data.user.email;
                    showUserModal('welcome');
                }
            } catch (err) {
                errorMsg.textContent = err.message;
            }
        });
    }

    // Handle Forgot Password
    const resetForm = document.getElementById('reset-request-form');
    if (resetForm) {
        resetForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('reset-email').value;
            const errorMsg = document.getElementById('reset-error-msg');
            errorMsg.textContent = '';
            
            try {
                const response = await fetch('/api/auth-start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, shopId, authType: 'reset' })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error);

                if (data.success) {
                    errorMsg.textContent = 'Password reset email sent! Check your inbox.';
                    errorMsg.style.color = 'green';
                }
            } catch (err) {
                errorMsg.textContent = err.message;
            }
        });
    }

    // Handle Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem(CONSTANTS.AUTH_TOKEN_KEY);
            setState({ session: { ...state.session, user: { isAuthenticated: false, email: null, id: null, likedItemIds: new Set(), planIds: [], paymentHistory: [], amountReceived: 0 } } });
            updateUserProfileIcon();
            closeUserModal();
            // Clear local likes
            localStorage.removeItem('tempLikes');
        });
    }

    // Handle "Welcome" continue button
    const welcomeBtn = document.getElementById('welcome-continue-btn');
    if (welcomeBtn) {
        welcomeBtn.addEventListener('click', closeUserModal);
    }
    
    // --- v2.0 Effects Engine ---
    const effectsDropdown = document.getElementById('effects-dropdown');
    
    // Add a check in case this element doesn't exist
    if (effectsDropdown) {
        effects.forEach((effect, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = effect.name;
            effectsDropdown.appendChild(option);
        });
        
        effectsDropdown.addEventListener('change', (e) => {
            const selectedEffectIndex = e.target.value;
            const selectedEffect = effects[selectedEffectIndex];
            
            // Hide all controls
            effects.forEach(eff => {
                if (eff.controlsContainer) eff.controlsContainer.style.display = 'none';
            });
            
            // Load the new effect
            if (selectedEffect) {
                backgroundEngine.loadEffect(selectedEffect.module, selectedEffect.controlsContainer);
            } else {
                backgroundEngine.loadEffect(null, null); // Clear effect
            }
        });
    }
    // --- End v2.0 Effects Engine ---
}

// --- THIS FUNCTION WAS MISSING/RENAMED ---
export function updateUserProfileIcon() {
// --- END FIX ---
    const userBtn = document.getElementById('user-profile-btn');
    if (!userBtn) return;
    
    const user = state.session.user;
    if (user.isAuthenticated) {
        userBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm0 14c-2.03 0-4.43-.82-6.14-2.88C7.55 15.8 9.68 15 12 15s4.45.8 6.14 2.12C16.43 19.18 14.03 20 12 20z"></path></svg>
        `;
        if (tippyInstance) {
            tippyInstance.setContent(`Logged in as: ${user.email}`);
        } else {
            tippyInstance = tippy(userBtn, {
                content: `Logged in as: ${user.email}`,
                placement: 'bottom',
                theme: 'light',
            });
        }
    } else {
        userBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
        `;
        if (tippyInstance) {
            tippyInstance.setContent('Login / Sign Up');
        } else {
            tippyInstance = tippy(userBtn, {
                content: 'Login / Sign Up',
                placement: 'bottom',
                theme: 'light',
            });
        }
    }
}

console.log('[auth.js] 4. File execution finished. Exports are ready.');
