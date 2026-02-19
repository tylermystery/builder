// FILE: auth.js

import { state, setState } from './state.js';
import { log } from './utils/debug.js';
import * as api from './api.js';
import * as backgroundEngine from './components/backgroundEngine.js';

import fractalEffect from './components/effects/fractal.js';
import fluidEffect from './components/effects/fluid.js';


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
    { name: "Fluid Energy", plugin: fluidEffect },
    { name: "Fractal (Simple)", plugin: fractalEffect },
];

// Refactored function to handle a successful login from any method
async function _handleSuccessfulLogin(payload) {
    console.log(`[LOGIN-ASSOC] ========== _handleSuccessfulLogin START ==========`);
    console.log(`[LOGIN-ASSOC] User: ${payload.user?.email} (ID: ${payload.user?.id})`);
    console.log(`[LOGIN-ASSOC] Current state.session.id: ${state.session.id}`);
    log('Auth', `Login successful for user: ${payload.user?.email}`);

    // Associate the current session with the logged-in user (if a session exists)
    if (state.session.id) {
        console.log(`[LOGIN-ASSOC] Session ${state.session.id} exists, associating with user ${payload.user.id}...`);
        await api.associateSessionWithUser(state.session.id, payload.user.id);
        console.log(`[LOGIN-ASSOC] Association complete for existing session.`);
    } else {
        console.log(`[LOGIN-ASSOC] No session ID yet. Checking if there's unsaved plan data...`);
        const hasUnsavedContent = state.cart.items.size > 0 || state.cart.lockedItems.size > 0 || state.eventDetails.combined.size > 0;
        console.log(`[LOGIN-ASSOC] Unsaved content: items=${state.cart.items.size}, locked=${state.cart.lockedItems.size}, details=${state.eventDetails.combined.size}`);
        if (hasUnsavedContent) {
            console.log(`[LOGIN-ASSOC] Unsaved plan data found. Will be associated on next save (triggerSave).`);
        } else {
            console.log(`[LOGIN-ASSOC] No unsaved plan data. No session association needed at this time.`);
        }
    }

    localStorage.setItem('jwt', payload.token);

    // Set user state
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
                ownedStoreId: payload.ownerData.ownedStoreId,
                likedItemIds: new Set(initialLikedItemIdsFromPayload)
            }
        }
    });

    // Sync temporary likes from localStorage
    const currentLikedItemIds = state.session.user.likedItemIds;
    let syncPromises = [];
    const tempLikesString = localStorage.getItem('tempLikes');

    if (tempLikesString) {
        try {
            const tempLikes = JSON.parse(tempLikesString);
            if (Array.isArray(tempLikes) && tempLikes.length > 0) {
                log('Auth', `Syncing ${tempLikes.length} temporary likes`);
                tempLikes.forEach(itemId => {
                    if (!currentLikedItemIds.has(itemId)) {
                        syncPromises.push(
                            api.toggleUserLike(itemId)
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
            console.error('[Auth] Error parsing temporary likes:', e);
        } finally {
             localStorage.removeItem('tempLikes');
        }
    }

    await Promise.allSettled(syncPromises);

    // Trigger events and update UI
    console.log(`[LOGIN-ASSOC] Dispatching 'userLoggedIn' event. Session: ${state.session.id}, User: ${state.session.user.id}`);
    document.dispatchEvent(new CustomEvent('userLoggedIn'));
    updateUserProfileIcon();

    // Explicitly hide the biometric setup prompt since the user just logged in successfully
    // This prevents it from flashing briefly if the userLoggedIn event triggers showBiometricSetupPromptIfNeeded
    const biometricSetupPrompt = document.getElementById('biometric-setup-prompt');
    if (biometricSetupPrompt) {
        biometricSetupPrompt.style.display = 'none';
    }

    hideUserModal();
    console.log(`[LOGIN-ASSOC] ========== _handleSuccessfulLogin END ==========`);
}

/**
 * Show the user modal with optional specific view
 * @param {Object} options - Optional configuration
 * @param {string} options.section - Which section to show: 'phone' opens to phone sign-in for Twilio verification
 */
export function showUserModal(options = {}) {
    const user = state.session.user;
    const ownerDashboardLink = document.getElementById('owner-dashboard-link');

    // Get Effect UI Elements
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

        // Ensure biometric setup prompt is hidden (it lives in signin-view but could be left visible)
        const biometricSetupPrompt = document.getElementById('biometric-setup-prompt');
        if (biometricSetupPrompt) biometricSetupPrompt.style.display = 'none';

        const adminProfileBtn = document.getElementById('admin-bulk-profile-btn');
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

        // Refresh biometric section visibility when showing signin view
        // This ensures passkey login option appears if user has created one
        refreshBiometricSectionVisibility();

        // If specific section requested, expand it (e.g., 'phone' for Twilio verification)
        if (options.section === 'phone') {
            const phoneDetails = signinView.querySelector('details');
            if (phoneDetails) {
                phoneDetails.open = true;
                log('Auth', 'Opened phone sign-in section for direct link access');
            }
        }
    }

    // Populate Background Effects dropdown (only once)
    if (effectSelect && effectControlsContainer && effectSelect.childElementCount === 0) {
        log('Auth', 'Populating background effect tweaks for the first time.');
        effects.forEach((effect, index) => {
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

        // Load the default effect
        if (effects.length > 0 && effects[0].plugin) {
            backgroundEngine.loadEffect(effects[0].plugin, effectControlsContainer);
        }
    }

    userModalOverlay.classList.add('active');
    userModalOverlay.style.display = 'flex';
    document.body.classList.add('modal-open');
}

function hideUserModal() {
    userModalOverlay.classList.remove('active');
    setTimeout(() => { userModalOverlay.style.display = 'none'; }, 300);
    document.body.classList.remove('modal-open');

    // Reset biometric setup prompt when closing modal to prevent stale state
    const biometricSetupPrompt = document.getElementById('biometric-setup-prompt');
    if (biometricSetupPrompt) biometricSetupPrompt.style.display = 'none';
}

async function handleSignIn(e) {
    e.preventDefault();
    const email = signinEmailInput.value;
    log('Auth', `Sign-in initiated for: ${email}`);
    localStorage.setItem('lastSignInEmail', email);
    signinMessage.style.color = '#333';
    signinMessage.textContent = `Sending confirmation email...`;
    try {
        log('Auth', 'Calling /api/auth-start endpoint');
        const response = await fetch('/api/auth-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, siteUrl: window.location.origin }),
        });

        log('Auth', `auth-start response status: ${response.status}`);
        const data = await response.json();
        log('Auth', `auth-start response data:`, data);

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
        console.error('[Auth] Sign-in error:', error);
        log('Auth', `Sign-in failed: ${error.message}`);
        signinMessage.style.color = '#dc3545';
        signinMessage.textContent = error.message || 'Unable to sign in. Please try again.';
    }
}

// SMS Authentication Handlers
let currentSmsPhoneNumber = null;

async function handleSmsSignIn(e) {
    e.preventDefault();

    const phoneInput = document.getElementById('signin-phone');
    const smsMessage = document.getElementById('sms-message');
    const consentCheckbox = document.getElementById('sms-consent-checkbox');

    const phoneNumber = phoneInput.value.trim();

    if (!phoneNumber) {
        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = 'Please enter a phone number.';
        return;
    }

    if (!consentCheckbox || !consentCheckbox.checked) {
        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = 'Please agree to receive SMS messages by checking the consent box.';
        return;
    }

    log('Auth', `SMS sign-in initiated for: ${phoneNumber}`);
    currentSmsPhoneNumber = phoneNumber;

    smsMessage.style.color = '#333';
    smsMessage.textContent = 'Sending SMS code...';

    try {
        const response = await fetch('/api/auth-sms-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: phoneNumber }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to send SMS code.');
        }

        smsMessage.style.color = '#28a745';
        smsMessage.textContent = `A 6-digit code has been sent to ${phoneNumber}. Check your messages!`;

        // Hide phone form, show OTP verification form
        const smsForm = document.getElementById('sms-signin-form');
        const verifySection = document.getElementById('sms-verify-section');

        smsForm.style.display = 'none';
        verifySection.style.display = 'block';

        // Focus on OTP input
        const otpInput = document.getElementById('signin-otp');
        otpInput.focus();

        log('Auth', 'SMS code sent successfully');
    } catch (error) {
        console.error('[Auth] SMS sign-in error:', error.message);
        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = error.message;
    }
}

async function handleSmsVerify() {
    const otpInput = document.getElementById('signin-otp');
    const smsMessage = document.getElementById('sms-message');

    const otpCode = otpInput.value.trim();

    if (!otpCode || otpCode.length !== 6) {
        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = 'Please enter a valid 6-digit code.';
        return;
    }

    if (!currentSmsPhoneNumber) {
        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = 'Phone number not found. Please start over.';
        return;
    }

    log('Auth', `Verifying SMS code for: ${currentSmsPhoneNumber}`);

    smsMessage.style.color = '#333';
    smsMessage.textContent = 'Verifying code...';

    try {
        const response = await fetch('/api/auth-sms-verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: otpCode,
                phoneNumber: currentSmsPhoneNumber
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Invalid code. Please try again.');
        }

        smsMessage.style.color = '#28a745';
        smsMessage.textContent = 'Success! Signing you in...';

        // Handle successful login
        await _handleSuccessfulLogin(data);

        // Reset SMS form
        otpInput.value = '';
        currentSmsPhoneNumber = null;
        document.getElementById('sms-signin-form').style.display = 'block';
        document.getElementById('sms-verify-section').style.display = 'none';
        document.getElementById('signin-phone').value = '';

        log('Auth', 'SMS authentication successful');
    } catch (error) {
        console.error('[Auth] SMS verification error:', error.message);
        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = error.message;
    }
}

async function handleResendSms() {
    const smsMessage = document.getElementById('sms-message');

    if (!currentSmsPhoneNumber) {
        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = 'Phone number not found. Please start over.';
        return;
    }

    log('Auth', `Resending SMS code to: ${currentSmsPhoneNumber}`);

    smsMessage.style.color = '#333';
    smsMessage.textContent = 'Resending code...';

    try {
        const response = await fetch('/api/auth-sms-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: currentSmsPhoneNumber }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to resend SMS code.');
        }

        smsMessage.style.color = '#28a745';
        smsMessage.textContent = `New code sent to ${currentSmsPhoneNumber}!`;

        log('Auth', 'SMS code resent successfully');
    } catch (error) {
        console.error('[Auth] Resend SMS error:', error.message);
        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = error.message;
    }
}

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

    // Switch modal to signin view so biometric option can be refreshed
    signinView.style.display = 'block';
    profileView.style.display = 'none';
    signinEmailInput.value = localStorage.getItem('lastSignInEmail') || '';

    // Refresh biometric section visibility so passkey login remains available after sign-out
    refreshBiometricSectionVisibility();

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

    const mySessionsHeaderBtn = document.getElementById('menu-sessions-btn');

    if (mySessionsHeaderBtn) {
        mySessionsHeaderBtn.style.display = state.session.user.isAuthenticated ? 'flex' : 'none';
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

    // Copy Console Log button (subtle global button, available to all users)
    const copyConsoleBtn = document.getElementById('copy-console-btn');
    const copyConsoleMsg = document.getElementById('copy-console-message');
    if (copyConsoleBtn) {
        copyConsoleBtn.addEventListener('click', async () => {
            const buffer = window.__consoleBuffer || [];
            if (buffer.length === 0) {
                if (copyConsoleMsg) {
                    copyConsoleMsg.textContent = 'No output yet';
                    copyConsoleMsg.classList.add('visible');
                    setTimeout(() => copyConsoleMsg.classList.remove('visible'), 2000);
                }
                return;
            }
            const text = buffer.join('\n');
            try {
                await navigator.clipboard.writeText(text);
                if (copyConsoleMsg) {
                    copyConsoleMsg.textContent = `Copied ${buffer.length} lines`;
                    copyConsoleMsg.style.color = '#28a745';
                    copyConsoleMsg.classList.add('visible');
                    setTimeout(() => copyConsoleMsg.classList.remove('visible'), 2000);
                }
                log('Auth', `Console log copied: ${buffer.length} lines`);
            } catch (err) {
                // Fallback for browsers/contexts where clipboard API fails
                try {
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    if (copyConsoleMsg) {
                        copyConsoleMsg.textContent = `Copied ${buffer.length} lines`;
                        copyConsoleMsg.style.color = '#28a745';
                        copyConsoleMsg.classList.add('visible');
                        setTimeout(() => copyConsoleMsg.classList.remove('visible'), 2000);
                    }
                } catch (fallbackErr) {
                    if (copyConsoleMsg) {
                        copyConsoleMsg.textContent = 'Copy failed';
                        copyConsoleMsg.style.color = '#dc3545';
                        copyConsoleMsg.classList.add('visible');
                        setTimeout(() => copyConsoleMsg.classList.remove('visible'), 2000);
                    }
                }
            }
        });
    }

    // Listen for sign-in requests from other components (e.g., forum panel, invite system)
    document.addEventListener('requestSignIn', () => {
        showUserModal();
    });

    // SMS Authentication Event Listeners
    const smsSigninForm = document.getElementById('sms-signin-form');
    const verifyOtpBtn = document.getElementById('verify-otp-btn');
    const resendSmsBtn = document.getElementById('resend-sms-btn');

    if (smsSigninForm) {
        smsSigninForm.addEventListener('submit', handleSmsSignIn);
    }

    if (verifyOtpBtn) {
        verifyOtpBtn.addEventListener('click', handleSmsVerify);
    }

    if (resendSmsBtn) {
        resendSmsBtn.addEventListener('click', handleResendSms);
    }

    // Allow Enter key to submit OTP
    const otpInput = document.getElementById('signin-otp');
    if (otpInput) {
        otpInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSmsVerify();
            }
        });
    }

    // Netlify Identity SSO Setup
    if (typeof netlifyIdentity !== 'undefined') {
        console.log('[Google-SSO] Netlify Identity already loaded, initializing immediately');
        initializeNetlifyIdentity();
    } else {
        // Try to load Netlify Identity if the loader is available
        console.log('[Google-SSO] Netlify Identity not yet loaded, attempting to load...');
        if (typeof window.loadNetlifyIdentity === 'function') {
            console.log('[Google-SSO] loadNetlifyIdentity function available, calling it...');
            window.loadNetlifyIdentity().then(() => {
                if (typeof netlifyIdentity !== 'undefined') {
                    console.log('[Google-SSO] Netlify Identity loaded via loadNetlifyIdentity');
                    initializeNetlifyIdentity();
                } else {
                    console.error('[Google-SSO] Netlify Identity failed to load via loadNetlifyIdentity');
                }
            }).catch(err => {
                console.error('[Google-SSO] Error loading Netlify Identity:', err);
            });
        } else {
            console.log('[Google-SSO] No loadNetlifyIdentity function, waiting for window load event');
            // Wait for the script to load
            window.addEventListener('load', () => {
                if (typeof netlifyIdentity !== 'undefined') {
                    console.log('[Google-SSO] Netlify Identity available after window load');
                    initializeNetlifyIdentity();
                } else if (typeof window.loadNetlifyIdentity === 'function') {
                    console.log('[Google-SSO] loadNetlifyIdentity available after window load, calling...');
                    window.loadNetlifyIdentity().then(() => {
                        if (typeof netlifyIdentity !== 'undefined') {
                            console.log('[Google-SSO] Netlify Identity loaded after window load');
                            initializeNetlifyIdentity();
                        } else {
                            console.error('[Google-SSO] Netlify Identity still not available after all attempts');
                        }
                    });
                } else {
                    console.error('[Google-SSO] No way to load Netlify Identity - SSO will not be available');
                }
            });
        }
    }
}

function initializeNetlifyIdentity() {
    console.log('[Google-SSO] ========== INITIALIZING NETLIFY IDENTITY ==========');
    log('Auth', 'Initializing Netlify Identity');

    // Determine the correct API URL - always use production for OAuth redirects
    const PRODUCTION_SITE_URL = 'https://whatthefunfinder.netlify.app';
    const CUSTOM_DOMAIN = 'whatthefun.wtf';
    const currentHost = window.location.hostname;
    const isDeployPreview = currentHost.includes('--whatthefunfinder.netlify.app') ||
                            currentHost.includes('deploy-preview') ||
                            currentHost.includes('agent-');
    const isProduction = currentHost === 'whatthefunfinder.netlify.app' ||
                         currentHost === CUSTOM_DOMAIN ||
                         currentHost === `www.${CUSTOM_DOMAIN}`;
    const isCustomDomain = currentHost === CUSTOM_DOMAIN || currentHost === `www.${CUSTOM_DOMAIN}`;

    console.log('[Google-SSO] Current host:', currentHost);
    console.log('[Google-SSO] Is deploy preview:', isDeployPreview);
    console.log('[Google-SSO] Is production:', isProduction);
    console.log('[Google-SSO] Is custom domain:', isCustomDomain);

    // Clear any stale netlifySiteURL from localStorage on production site
    if (isProduction) {
        const storedSiteURL = localStorage.getItem('netlifySiteURL');
        if (storedSiteURL && !storedSiteURL.includes(CUSTOM_DOMAIN) && storedSiteURL !== PRODUCTION_SITE_URL) {
            localStorage.removeItem('netlifySiteURL');
        }

        const goTrueUrl = localStorage.getItem('goTrueUrl');
        if (goTrueUrl && !goTrueUrl.includes(CUSTOM_DOMAIN) && !goTrueUrl.includes('whatthefunfinder.netlify.app')) {
            localStorage.removeItem('goTrueUrl');
        }
    }

    // Build init options
    const initOptions = {
        locale: 'en'
    };

    if (isDeployPreview || isCustomDomain) {
        // Force API calls to use the Netlify subdomain's identity endpoint
        initOptions.APIUrl = `${PRODUCTION_SITE_URL}/.netlify/identity`;
    }

    console.log('[Google-SSO] Init options:', JSON.stringify(initOptions));

    // Force store the correct site URL for OAuth redirects
    const currentSiteUrl = window.location.origin;
    if (isProduction) {
        localStorage.setItem('netlifySiteURL', currentSiteUrl);
    }
    console.log('[Google-SSO] Current site URL:', currentSiteUrl);
    console.log('[Google-SSO] Stored netlifySiteURL:', localStorage.getItem('netlifySiteURL'));

    // Initialize the widget
    try {
        netlifyIdentity.init(initOptions);
        console.log('[Google-SSO] Netlify Identity initialized successfully');
        console.log('[Google-SSO] gotrue client available after init:', !!netlifyIdentity.gotrue);
        console.log('[Google-SSO] gotrue API URL:', netlifyIdentity.gotrue?.api?.apiURL);
        console.log('[Google-SSO] Current user after init:', netlifyIdentity.currentUser()?.email || 'none');

        // Check if the widget detected an OAuth callback in the URL hash
        const currentHash = window.location.hash;
        if (currentHash && currentHash.includes('access_token=')) {
            console.log('[Google-SSO] WARNING: access_token still in URL hash after init — widget may not have processed the callback yet');
            console.log('[Google-SSO] The login event should fire shortly if the token is valid');
        } else if (!currentHash && document.referrer && document.referrer.includes('accounts.google.com')) {
            console.log('[Google-SSO] Redirected from Google but no hash token — the OAuth flow may have failed at the provider level');
        }
    } catch (initError) {
        console.error('[Google-SSO] Error initializing Netlify Identity:', initError);
        console.error('[Google-SSO] Init error details:', initError.message, initError.stack);
    }

    // Set up Google SSO button — redirect directly to Google OAuth via gotrue
    const googleSsoBtn = document.getElementById('google-sso-btn');

    if (googleSsoBtn) {
        googleSsoBtn.addEventListener('click', (event) => {
            console.log('[Google-SSO] ========== GOOGLE SSO BUTTON CLICKED ==========');
            log('Auth', 'Google SSO button clicked');
            try {
                // Use gotrue client to get the direct OAuth URL, bypassing the widget UI
                const gotrueClient = netlifyIdentity.gotrue;
                console.log('[Google-SSO] gotrue client available:', !!gotrueClient);
                console.log('[Google-SSO] gotrue API URL:', gotrueClient?.api?.apiURL);

                if (gotrueClient && typeof gotrueClient.loginExternalUrl === 'function') {
                    const googleAuthUrl = gotrueClient.loginExternalUrl('google');
                    console.log('[Google-SSO] Direct OAuth URL:', googleAuthUrl);
                    console.log('[Google-SSO] Redirecting to Google OAuth...');

                    // Close the account modal before redirecting
                    hideUserModal();

                    // Redirect directly to Google's OAuth consent screen
                    window.location.href = googleAuthUrl;
                } else {
                    // Fallback: open the Netlify Identity widget if gotrue client is not available
                    console.warn('[Google-SSO] gotrue client or loginExternalUrl not available, falling back to widget');
                    console.log('[Google-SSO] gotrue client type:', typeof gotrueClient);
                    console.log('[Google-SSO] loginExternalUrl type:', typeof gotrueClient?.loginExternalUrl);
                    netlifyIdentity.open('login');
                }
            } catch (error) {
                console.error('[Google-SSO] Error initiating Google SSO:', error);
                console.error('[Google-SSO] Error name:', error.name);
                console.error('[Google-SSO] Error message:', error.message);
                console.error('[Google-SSO] Error stack:', error.stack);
                signinMessage.textContent = "Error opening Google sign-in. Please try again.";
                signinMessage.style.color = '#dc3545';
            }
        });
    } else {
        console.warn('[Google-SSO] Google SSO button element not found in DOM');
    }

    // Handle successful login from Netlify Identity (Google OAuth callback)
    netlifyIdentity.on('login', async (user) => {
        console.log('[Google-SSO] ========== NETLIFY IDENTITY LOGIN EVENT ==========');
        console.log('[Google-SSO] Event fired at:', new Date().toISOString());
        console.log('[Google-SSO] User object present:', !!user);
        console.log('[Google-SSO] User email:', user?.email);
        console.log('[Google-SSO] User id:', user?.id);
        console.log('[Google-SSO] User confirmed_at:', user?.confirmed_at);
        console.log('[Google-SSO] User app_metadata:', JSON.stringify(user?.app_metadata));
        console.log('[Google-SSO] User user_metadata:', JSON.stringify(user?.user_metadata));
        console.log('[Google-SSO] Token object present:', !!user?.token);
        console.log('[Google-SSO] access_token present:', !!user?.token?.access_token);
        console.log('[Google-SSO] access_token length:', user?.token?.access_token?.length);
        console.log('[Google-SSO] token_type:', user?.token?.token_type);
        console.log('[Google-SSO] expires_at:', user?.token?.expires_at);
        log('Auth', `Netlify Identity login event for: ${user?.email}`);

        try {
            const netlifyJwt = user.token.access_token;

            if (!netlifyJwt) {
                console.error('[Google-SSO] ERROR: No access_token in user.token — cannot call auth-social');
                signinMessage.textContent = "Login token missing. Please try again.";
                signinMessage.style.color = '#dc3545';
                return;
            }

            console.log('[Google-SSO] Calling /api/auth-social with Bearer token...');
            console.log('[Google-SSO] Token first 20 chars:', netlifyJwt.substring(0, 20) + '...');

            // Call serverless function to get app-specific JWT
            const response = await fetch('/api/auth-social', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${netlifyJwt}`
                }
            });

            console.log('[Google-SSO] auth-social response status:', response.status);
            console.log('[Google-SSO] auth-social response ok:', response.ok);
            console.log('[Google-SSO] auth-social response headers:', JSON.stringify(Object.fromEntries(response.headers.entries())));

            const responseText = await response.text();
            console.log('[Google-SSO] auth-social response body length:', responseText.length);

            if (!response.ok) {
                console.error('[Google-SSO] auth-social error response body:', responseText);
                let errorMsg = 'Failed to sync social login.';
                try {
                    const errorData = JSON.parse(responseText);
                    errorMsg = errorData.error || errorMsg;
                } catch (e) {
                    console.error('[Google-SSO] Could not parse error response as JSON');
                }
                throw new Error(errorMsg);
            }

            let appPayload;
            try {
                appPayload = JSON.parse(responseText);
            } catch (parseErr) {
                console.error('[Google-SSO] Failed to parse auth-social success response:', parseErr.message);
                throw new Error('Invalid response from auth-social');
            }

            console.log('[Google-SSO] auth-social success. User ID:', appPayload.user?.id);
            console.log('[Google-SSO] auth-social user email:', appPayload.user?.email);

            await _handleSuccessfulLogin(appPayload);
            netlifyIdentity.close();
            console.log('[Google-SSO] ========== GOOGLE SSO LOGIN COMPLETE ==========');
            log('Auth', 'Google SSO login complete');

        } catch (error) {
            console.error('[Google-SSO] ========== SSO LOGIN ERROR ==========');
            console.error('[Google-SSO] Error name:', error.name);
            console.error('[Google-SSO] Error message:', error.message);
            console.error('[Google-SSO] Error stack:', error.stack);
            signinMessage.textContent = `Google sign-in error: ${error.message}`;
            signinMessage.style.color = '#dc3545';
        }
    });

    // Handle errors
    netlifyIdentity.on('error', (error) => {
        console.error('[Google-SSO] ========== NETLIFY IDENTITY ERROR EVENT ==========');
        console.error('[Google-SSO] Error event fired at:', new Date().toISOString());
        console.error('[Google-SSO] Error object:', error);
        console.error('[Google-SSO] Error type:', typeof error);
        console.error('[Google-SSO] Error message:', error?.message || error?.msg || String(error));
        if (error?.json) {
            console.error('[Google-SSO] Error JSON:', JSON.stringify(error.json));
        }
        if (error?.status) {
            console.error('[Google-SSO] Error status:', error.status);
        }
        console.error('[Google-SSO] Full error details:', JSON.stringify(error, Object.getOwnPropertyNames(error || {})));
        signinMessage.textContent = `Authentication error: ${error?.message || error?.msg || String(error)}`;
        signinMessage.style.color = '#dc3545';
    });

    // Listen for init event to confirm widget is ready
    netlifyIdentity.on('init', (user) => {
        console.log('[Google-SSO] ========== NETLIFY IDENTITY INIT EVENT ==========');
        console.log('[Google-SSO] Init event fired at:', new Date().toISOString());
        console.log('[Google-SSO] Current user from init:', user ? user.email : 'none (not logged in)');
        console.log('[Google-SSO] Current URL hash present:', !!window.location.hash);
        if (window.location.hash) {
            console.log('[Google-SSO] Hash (first 80 chars):', window.location.hash.substring(0, 80));
        }
        if (user) {
            console.log('[Google-SSO] Init user token present:', !!user?.token?.access_token);
            console.log('[Google-SSO] Init user provider:', user?.app_metadata?.provider);
        }
    });

    console.log('[Google-SSO] ========== NETLIFY IDENTITY INITIALIZATION COMPLETE ==========');
    log('Auth', 'Netlify Identity initialization complete');
}

// ============================================
// WEBAUTHN / BIOMETRIC AUTHENTICATION
// ============================================

// Check if WebAuthn is available on this device
function isWebAuthnAvailable() {
    return window.PublicKeyCredential !== undefined &&
           typeof window.PublicKeyCredential === 'function';
}

// Check if platform authenticator (Face ID, Touch ID, etc.) is available
async function isPlatformAuthenticatorAvailable() {
    if (!isWebAuthnAvailable()) return false;
    try {
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (e) {
        console.warn('[WebAuthn] Platform authenticator check failed:', e);
        return false;
    }
}

// Check if this user has a passkey stored (by checking localStorage marker)
function hasStoredPasskey(email) {
    const passkeys = JSON.parse(localStorage.getItem('passkeyEmails') || '[]');
    return passkeys.includes(email);
}

// Check if ANY passkey is stored locally (for showing biometric option at app load)
function hasAnyStoredPasskey() {
    const passkeys = JSON.parse(localStorage.getItem('passkeyEmails') || '[]');
    return passkeys.length > 0;
}

// Mark that a user has set up a passkey
function markPasskeySetup(email) {
    const passkeys = JSON.parse(localStorage.getItem('passkeyEmails') || '[]');
    if (!passkeys.includes(email)) {
        passkeys.push(email);
        localStorage.setItem('passkeyEmails', JSON.stringify(passkeys));
    }
}

// Convert base64url string to ArrayBuffer
function base64urlToArrayBuffer(base64url) {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(base64 + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// Convert ArrayBuffer to base64url string
function arrayBufferToBase64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Register a new passkey (biometric credential)
async function registerPasskey(email) {
    console.log('[WebAuthn] ========== PASSKEY REGISTRATION START ==========');
    console.log('[WebAuthn] Registering passkey for email:', email);
    console.log('[WebAuthn] Browser/Platform:', navigator.userAgent);

    const biometricMessage = document.getElementById('biometric-message');
    const signinMessage = document.getElementById('signin-message');
    const messageEl = biometricMessage || signinMessage;

    try {
        // Get registration options from server
        if (messageEl) {
            messageEl.textContent = 'Setting up biometric login...';
            messageEl.style.color = '#333';
        }

        console.log('[WebAuthn] Requesting registration options from server...');
        const optionsRes = await fetch('/api/auth-webauthn-register-options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        console.log('[WebAuthn] Server response status:', optionsRes.status);

        if (!optionsRes.ok) {
            const errorData = await optionsRes.json();
            console.error('[WebAuthn] Server error response:', errorData);
            throw new Error(errorData.error || 'Failed to get registration options');
        }

        const { options, userId } = await optionsRes.json();
        console.log('[WebAuthn] Received registration options for user:', userId);
        console.log('[WebAuthn] RP ID:', options.rp?.id);
        console.log('[WebAuthn] Challenge received:', options.challenge ? 'Yes' : 'No');

        // Convert challenge and user.id from base64url to ArrayBuffer
        options.challenge = base64urlToArrayBuffer(options.challenge);
        options.user.id = base64urlToArrayBuffer(options.user.id);

        // Convert excludeCredentials if present
        if (options.excludeCredentials) {
            options.excludeCredentials = options.excludeCredentials.map(cred => ({
                ...cred,
                id: base64urlToArrayBuffer(cred.id)
            }));
            console.log('[WebAuthn] Excluding', options.excludeCredentials.length, 'existing credentials');
        }

        if (messageEl) {
            messageEl.textContent = 'Please authenticate with your device...';
        }

        // Create the credential
        console.log('[WebAuthn] Invoking navigator.credentials.create()...');
        const credential = await navigator.credentials.create({
            publicKey: options
        });

        console.log('[WebAuthn] Credential created successfully');
        console.log('[WebAuthn] Credential ID:', credential.id);
        console.log('[WebAuthn] Credential type:', credential.type);

        // Prepare the credential for sending to server
        const credentialForServer = {
            id: credential.id,
            rawId: arrayBufferToBase64url(credential.rawId),
            type: credential.type,
            response: {
                clientDataJSON: arrayBufferToBase64url(credential.response.clientDataJSON),
                attestationObject: arrayBufferToBase64url(credential.response.attestationObject)
            },
            transports: credential.response.getTransports ? credential.response.getTransports() : ['internal'],
            deviceName: getDeviceName()
        };

        console.log('[WebAuthn] Transports:', credentialForServer.transports);
        console.log('[WebAuthn] Device name:', credentialForServer.deviceName);

        // Verify and store the credential
        if (messageEl) {
            messageEl.textContent = 'Verifying...';
        }

        console.log('[WebAuthn] Sending credential to server for verification...');
        const verifyRes = await fetch('/api/auth-webauthn-register-verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: credentialForServer, userId })
        });

        console.log('[WebAuthn] Verify response status:', verifyRes.status);

        if (!verifyRes.ok) {
            const errorData = await verifyRes.json();
            console.error('[WebAuthn] Verification error response:', errorData);
            throw new Error(errorData.error || 'Failed to verify registration');
        }

        const result = await verifyRes.json();
        console.log('[WebAuthn] Registration verified successfully!');

        // Mark that this email has a passkey
        markPasskeySetup(email);

        // Update UI
        if (messageEl) {
            messageEl.textContent = 'Biometric login enabled!';
            messageEl.style.color = '#28a745';
        }

        // Log the user in with the returned credentials
        await _handleSuccessfulLogin(result);

        console.log('[WebAuthn] ========== PASSKEY REGISTRATION COMPLETE ==========');
        return true;

    } catch (error) {
        console.error('[WebAuthn] ========== REGISTRATION ERROR ==========');
        console.error('[WebAuthn] Error name:', error.name);
        console.error('[WebAuthn] Error message:', error.message);
        console.error('[WebAuthn] Error stack:', error.stack);

        if (messageEl) {
            if (error.name === 'NotAllowedError') {
                messageEl.textContent = 'Biometric setup was cancelled. You can try again later.';
            } else if (error.name === 'InvalidStateError') {
                messageEl.textContent = 'A passkey is already registered on this device.';
            } else {
                messageEl.textContent = error.message || 'Failed to set up biometric login.';
            }
            messageEl.style.color = '#dc3545';
        }

        return false;
    }
}

// Authenticate using a passkey
async function authenticateWithPasskey(email = null) {
    console.log('[WebAuthn] ========== PASSKEY AUTHENTICATION START ==========');
    console.log('[WebAuthn] Authenticating' + (email ? ` for email: ${email}` : ' (discoverable)'));
    console.log('[WebAuthn] Browser/Platform:', navigator.userAgent);

    const biometricMessage = document.getElementById('biometric-message');
    const signinMessage = document.getElementById('signin-message');
    const messageEl = biometricMessage || signinMessage;

    try {
        if (messageEl) {
            messageEl.textContent = 'Preparing biometric login...';
            messageEl.style.color = '#333';
        }

        // Get authentication options from server
        console.log('[WebAuthn] Requesting authentication options from server...');
        const optionsRes = await fetch('/api/auth-webauthn-auth-options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        console.log('[WebAuthn] Server response status:', optionsRes.status);

        if (!optionsRes.ok) {
            const errorData = await optionsRes.json();
            console.error('[WebAuthn] Server error response:', errorData);
            if (errorData.code === 'NO_PASSKEY') {
                // User doesn't have a passkey set up
                throw new Error('NO_PASSKEY');
            }
            throw new Error(errorData.error || 'Failed to get authentication options');
        }

        const { options, userId } = await optionsRes.json();
        console.log('[WebAuthn] Received authentication options');
        console.log('[WebAuthn] RP ID:', options.rpId);
        console.log('[WebAuthn] Allow credentials count:', options.allowCredentials?.length || 0);

        // Convert challenge from base64url to ArrayBuffer
        options.challenge = base64urlToArrayBuffer(options.challenge);

        // Convert allowCredentials if present
        if (options.allowCredentials) {
            options.allowCredentials = options.allowCredentials.map(cred => ({
                ...cred,
                id: base64urlToArrayBuffer(cred.id)
            }));
        }

        if (messageEl) {
            messageEl.textContent = 'Please authenticate with your device...';
        }

        // Get the credential
        console.log('[WebAuthn] Invoking navigator.credentials.get()...');
        const credential = await navigator.credentials.get({
            publicKey: options
        });

        console.log('[WebAuthn] Credential retrieved successfully');
        console.log('[WebAuthn] Credential ID:', credential.id);

        // Prepare the credential for sending to server
        const credentialForServer = {
            id: credential.id,
            rawId: arrayBufferToBase64url(credential.rawId),
            type: credential.type,
            response: {
                clientDataJSON: arrayBufferToBase64url(credential.response.clientDataJSON),
                authenticatorData: arrayBufferToBase64url(credential.response.authenticatorData),
                signature: arrayBufferToBase64url(credential.response.signature),
                userHandle: credential.response.userHandle ? arrayBufferToBase64url(credential.response.userHandle) : null
            }
        };

        // Verify the credential
        if (messageEl) {
            messageEl.textContent = 'Verifying...';
        }

        console.log('[WebAuthn] Sending credential to server for verification...');
        const verifyRes = await fetch('/api/auth-webauthn-auth-verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: credentialForServer })
        });

        console.log('[WebAuthn] Verify response status:', verifyRes.status);

        if (!verifyRes.ok) {
            const errorData = await verifyRes.json();
            console.error('[WebAuthn] Verification error response:', errorData);
            throw new Error(errorData.error || 'Authentication failed');
        }

        const result = await verifyRes.json();
        console.log('[WebAuthn] Authentication verified successfully!');

        if (messageEl) {
            messageEl.textContent = 'Success! Signing you in...';
            messageEl.style.color = '#28a745';
        }

        // Log the user in
        await _handleSuccessfulLogin(result);

        console.log('[WebAuthn] ========== PASSKEY AUTHENTICATION COMPLETE ==========');
        return true;

    } catch (error) {
        console.error('[WebAuthn] ========== AUTHENTICATION ERROR ==========');
        console.error('[WebAuthn] Error name:', error.name);
        console.error('[WebAuthn] Error message:', error.message);
        console.error('[WebAuthn] Error stack:', error.stack);

        if (messageEl) {
            if (error.message === 'NO_PASSKEY') {
                messageEl.textContent = 'No biometric login found. Please sign in with email first, then set up biometric login.';
            } else if (error.name === 'NotAllowedError') {
                messageEl.textContent = 'Biometric authentication was cancelled.';
            } else {
                messageEl.textContent = error.message || 'Biometric authentication failed.';
            }
            messageEl.style.color = '#dc3545';
        }

        return false;
    }
}

// Get a friendly device name
function getDeviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android Device';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Unknown Device';
}

// Refresh biometric section visibility - called when opening the signin modal
// This ensures the passkey login option appears after a user has created a passkey
async function refreshBiometricSectionVisibility() {
    const biometricSection = document.getElementById('biometric-auth-section');
    const biometricBtnText = document.getElementById('biometric-btn-text');

    if (!biometricSection) return;

    // Check if WebAuthn is available
    const webauthnAvailable = isWebAuthnAvailable();
    const platformAvailable = await isPlatformAuthenticatorAvailable();

    if (!webauthnAvailable || !platformAvailable) {
        biometricSection.style.display = 'none';
        return;
    }

    // Check if any passkey is stored
    const anyPasskeyStored = hasAnyStoredPasskey();

    console.log('[WebAuthn] Refreshing biometric section - passkey stored:', anyPasskeyStored);

    if (anyPasskeyStored) {
        biometricSection.style.display = 'block';

        // Update button text based on device if not already set
        if (biometricBtnText && biometricBtnText.textContent === 'Sign In with Biometrics') {
            const ua = navigator.userAgent;
            if (/iPhone|iPad/.test(ua)) {
                biometricBtnText.textContent = 'Sign In with Face ID / Touch ID';
            } else if (/Android/.test(ua)) {
                biometricBtnText.textContent = 'Sign In with Fingerprint';
            } else if (/Mac/.test(ua)) {
                biometricBtnText.textContent = 'Sign In with Touch ID';
            } else if (/Windows/.test(ua)) {
                biometricBtnText.textContent = 'Sign In with Windows Hello';
            }
        }
    } else {
        biometricSection.style.display = 'none';
    }
}

// Initialize biometric UI elements
async function initializeBiometricAuth() {
    console.log('[WebAuthn] ========== BIOMETRIC UI INITIALIZATION ==========');

    const biometricSection = document.getElementById('biometric-auth-section');
    const biometricLoginBtn = document.getElementById('biometric-login-btn');
    const biometricBtnText = document.getElementById('biometric-btn-text');
    const biometricSetupPrompt = document.getElementById('biometric-setup-prompt');
    const setupBiometricBtn = document.getElementById('setup-biometric-btn');
    const skipBiometricSetup = document.getElementById('skip-biometric-setup');
    const biometricManagement = document.getElementById('biometric-management-section');
    const addPasskeyBtn = document.getElementById('add-passkey-btn');

    // Check if WebAuthn is available
    const webauthnAvailable = isWebAuthnAvailable();
    const platformAvailable = await isPlatformAuthenticatorAvailable();

    console.log('[WebAuthn] WebAuthn available:', webauthnAvailable);
    console.log('[WebAuthn] Platform authenticator available:', platformAvailable);

    if (!webauthnAvailable || !platformAvailable) {
        console.log('[WebAuthn] Biometric auth not available on this device');
        // Keep biometric section hidden
        return;
    }

    // Check if ANY passkey is stored (for returning users who should see biometric option at app load)
    const anyPasskeyStored = hasAnyStoredPasskey();
    const lastEmail = localStorage.getItem('lastSignInEmail');
    const hasPasskeyForLastEmail = lastEmail && hasStoredPasskey(lastEmail);

    console.log('[WebAuthn] Any passkey stored:', anyPasskeyStored);
    console.log('[WebAuthn] Last email:', lastEmail || '(none)');
    console.log('[WebAuthn] Has passkey for last email:', hasPasskeyForLastEmail);

    // Set appropriate button text based on device
    if (biometricBtnText) {
        const ua = navigator.userAgent;
        if (/iPhone|iPad/.test(ua)) {
            biometricBtnText.textContent = 'Sign In with Face ID / Touch ID';
        } else if (/Android/.test(ua)) {
            biometricBtnText.textContent = 'Sign In with Fingerprint';
        } else if (/Mac/.test(ua)) {
            biometricBtnText.textContent = 'Sign In with Touch ID';
        } else if (/Windows/.test(ua)) {
            biometricBtnText.textContent = 'Sign In with Windows Hello';
        }
    }

    // Show biometric login button if ANY passkey is stored (enables biometric at app load)
    // This allows returning users to immediately use passkey login
    if (biometricSection && anyPasskeyStored) {
        biometricSection.style.display = 'block';
        console.log('[WebAuthn] Showing biometric login option for returning user');
    }

    // Handle biometric login button click
    if (biometricLoginBtn) {
        biometricLoginBtn.addEventListener('click', async () => {
            console.log('[WebAuthn] Biometric login button clicked');
            // Use email if available, otherwise use discoverable credentials (null email)
            const email = localStorage.getItem('lastSignInEmail');
            const emailHasPasskey = email && hasStoredPasskey(email);
            // If the last email has a passkey, use it; otherwise use discoverable credentials
            await authenticateWithPasskey(emailHasPasskey ? email : null);
        });
    }

    // Handle setup biometric button click (after first login)
    if (setupBiometricBtn) {
        setupBiometricBtn.addEventListener('click', async () => {
            console.log('[WebAuthn] Setup biometric button clicked');
            const email = state.session.user.email;
            if (email) {
                await registerPasskey(email);
                if (biometricSetupPrompt) {
                    biometricSetupPrompt.style.display = 'none';
                }
            }
        });
    }

    // Handle skip button
    if (skipBiometricSetup) {
        skipBiometricSetup.addEventListener('click', () => {
            console.log('[WebAuthn] User skipped biometric setup');
            if (biometricSetupPrompt) {
                biometricSetupPrompt.style.display = 'none';
            }
            localStorage.setItem('biometricSetupSkipped', 'true');
        });
    }

    // Handle add passkey button in profile
    if (addPasskeyBtn) {
        addPasskeyBtn.addEventListener('click', async () => {
            console.log('[WebAuthn] Add passkey button clicked');
            const email = state.session.user.email;
            if (email) {
                await registerPasskey(email);
            }
        });
    }

    // Show biometric management in profile if available
    if (biometricManagement) {
        biometricManagement.style.display = 'block';
    }

    console.log('[WebAuthn] ========== BIOMETRIC UI INITIALIZATION COMPLETE ==========');
}

// Show biometric setup prompt after successful login (if not already set up)
function showBiometricSetupPromptIfNeeded() {
    const biometricSetupPrompt = document.getElementById('biometric-setup-prompt');
    const email = state.session.user.email;

    if (!biometricSetupPrompt || !email) return;

    // Check conditions
    const hasPasskey = hasStoredPasskey(email);
    const anyPasskey = hasAnyStoredPasskey();
    const skipped = localStorage.getItem('biometricSetupSkipped') === 'true';

    // If user already has a passkey (for this email or any email), hide the prompt
    if (hasPasskey || anyPasskey || skipped) {
        biometricSetupPrompt.style.display = 'none';
        return;
    }

    isPlatformAuthenticatorAvailable().then(available => {
        if (available && !hasPasskey && !skipped) {
            console.log('[WebAuthn] Showing biometric setup prompt');
            biometricSetupPrompt.style.display = 'block';
        } else {
            biometricSetupPrompt.style.display = 'none';
        }
    });
}

// Update biometric management UI when user is authenticated
function updateBiometricManagementUI() {
    const biometricManagement = document.getElementById('biometric-management-section');
    const biometricStatus = document.getElementById('biometric-status');
    const biometricStatusText = document.getElementById('biometric-status-text');

    if (!biometricManagement) return;

    isPlatformAuthenticatorAvailable().then(available => {
        if (!available) {
            biometricManagement.style.display = 'none';
            return;
        }

        biometricManagement.style.display = 'block';

        const email = state.session.user.email;
        const hasPasskey = email && hasStoredPasskey(email);

        if (biometricStatus && biometricStatusText) {
            if (hasPasskey) {
                biometricStatus.style.background = '#e8f5e9';
                biometricStatusText.style.color = '#2e7d32';
                biometricStatusText.textContent = 'Biometric login is enabled';
            } else {
                biometricStatus.style.background = '#fff3e0';
                biometricStatusText.style.color = '#e65100';
                biometricStatusText.textContent = 'Biometric login not set up yet';
            }
        }
    });
}

// Expose functions for external use
export {
    initializeBiometricAuth,
    registerPasskey,
    authenticateWithPasskey,
    showBiometricSetupPromptIfNeeded,
    updateBiometricManagementUI,
    isPlatformAuthenticatorAvailable
};
