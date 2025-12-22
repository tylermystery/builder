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
// --- FIX: Removed imports for kaleidoscope, wind, water, psychedelic, and vortex ---
console.log('[auth.js] 1a. Importing fractalEffect.js...');
// --- DEBUG ---
import fractalEffect from './components/effects/fractal.js';
// --- DEBUG ---
console.log('[auth.js] 1b. Importing fluidEffect.js...');
// --- DEBUG ---
import fluidEffect from './components/effects/fluid.js';
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
// --- FIX: This array now only contains the effects that actually exist ---
const effects = [
    { name: "Fluid Energy", plugin: fluidEffect },
    { name: "Fractal (Simple)", plugin: fractalEffect },
];
// --- END FIX ---

// --- DEBUG ---
console.log(`[auth.js] 3. 'effects' array created. Length: ${effects.length}`);
// --- DEBUG ---

// Refactored function to handle a successful login from any method
async function _handleSuccessfulLogin(payload) {
    console.log(`[Auth] ========== _handleSuccessfulLogin CALLED ==========`);
    console.log(`[Auth] Timestamp:`, new Date().toISOString());
    console.log(`[Auth] Full payload:`, JSON.stringify(payload, null, 2));
    console.log(`[Auth] Payload received:`, payload);
    console.log(`[Auth] User from payload:`, payload.user);
    console.log(`[Auth] Liked items from payload:`, payload.user.likedItemIds);
    console.log(`[Auth] Token from payload:`, payload.token ? 'Present' : 'Missing');
    
    if (state.session.id) {
        await api.associateSessionWithUser(state.session.id, payload.user.id); // Use imported api
    }

    console.log('[Auth] Storing JWT in localStorage...');
    localStorage.setItem('jwt', payload.token);
    console.log('[Auth] JWT stored. Verifying storage...');
    const storedJwt = localStorage.getItem('jwt');
    console.log('[Auth] JWT successfully stored:', !!storedJwt);
    console.log('[Auth] Stored JWT (first 20 chars):', storedJwt ? storedJwt.substring(0, 20) + '...' : 'null');

    // --- MOVED STATE UPDATE HERE ---
    const initialLikedItemIdsFromPayload = payload.user.likedItemIds || [];
    console.log(`[Auth] Setting user state. Liked items from payload: ${initialLikedItemIdsFromPayload.length}`);
    console.log(`[Auth] Full liked items array:`, initialLikedItemIdsFromPayload);
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
    console.log("[Auth] User state set immediately after login. Liked items count:", state.session.user.likedItemIds.size);
    console.log("[Auth] Full user state:", state.session.user);
    console.log("[Auth] Full likedItemIds Set:", Array.from(state.session.user.likedItemIds));
    // --- END MOVED STATE UPDATE ---

    // --- START LIKES SYNC (Now runs *after* state is updated) ---
    const currentLikedItemIds = state.session.user.likedItemIds;
    let syncPromises = [];
    const tempLikesString = localStorage.getItem('tempLikes');
    console.log(`[Auth] ========== TEMP LIKES MERGE DEBUG START ==========`);
    console.log(`[Auth] TempLikes from localStorage:`, tempLikesString);
    
    if (tempLikesString) {
        try {
            const tempLikes = JSON.parse(tempLikesString);
            console.log(`[Auth] Parsed temp likes:`, tempLikes);
            if (Array.isArray(tempLikes) && tempLikes.length > 0) {
                console.log(`[Auth] Found ${tempLikes.length} temporary likes to sync.`);
                console.log(`[Auth] Current authenticated liked items:`, Array.from(currentLikedItemIds));
                tempLikes.forEach(itemId => {
                    if (!currentLikedItemIds.has(itemId)) {
                        console.log(`[Auth] Syncing temporary like for item: ${itemId}`);
                        syncPromises.push(
                            api.toggleUserLike(itemId) // Use imported api
                                .then(result => {
                                    console.log(`[Auth] Sync result for ${itemId}:`, result);
                                    if (result.success && result.liked) {
                                        state.session.user.likedItemIds.add(itemId);
                                        console.log(`[Auth] Added ${itemId} to user liked items`);
                                    }
                                })
                                .catch(err => console.error(`[Auth] Error syncing like for item ${itemId}:`, err.message))
                        );
                    } else {
                        console.log(`[Auth] Item ${itemId} already in user's liked items, skipping`);
                    }
                });
            }
        } catch (e) {
            console.error('[Auth] Error parsing/processing temporary likes from localStorage:', e);
        } finally {
             localStorage.removeItem('tempLikes');
             console.log('[Auth] Cleared temporary likes from localStorage.');
        }
    } else {
        console.log('[Auth] No temporary likes found in localStorage');
    }
    console.log(`[Auth] ========== TEMP LIKES MERGE DEBUG END ==========`);
    // --- END LIKES SYNC ---

    await Promise.allSettled(syncPromises);
    console.log('[Auth] Like sync process finished.');
    console.log('[Auth] Final liked items count:', state.session.user.likedItemIds.size);
    console.log('[Auth] Final liked items:', Array.from(state.session.user.likedItemIds));
    
    console.log("[Auth] Final user state after sync:", state.session.user);
    console.log(`[Auth] ========== LOGIN DEBUG END ==========`);

    // Trigger events and update UI
    console.log('[Auth] Dispatching userLoggedIn event...');
    document.dispatchEvent(new CustomEvent('userLoggedIn'));
    console.log('[Auth] userLoggedIn event dispatched');
    // populateUserPlans and applyFiltersAndSort are removed from here
    // They are handled by the 'userLoggedIn' listener in main.js
    console.log('[Auth] Updating user profile icon...');
    updateUserProfileIcon();
    console.log('[Auth] Hiding user modal...');
    hideUserModal();
    console.log('[Auth] ========== _handleSuccessfulLogin COMPLETE ==========');
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
        const adminProfileBtn = document.getElementById('admin-bulk-profile-btn'); // <-- ADD THIS
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
    // --- DEBUG ---
    console.log(`[auth.js] Populating effects dropdown. Found ${effects.length} effects.`);
    console.log(`[auth.js] Checking IF condition...`);
    console.log(`[auth.js]   - effectSelect exists: ${!!effectSelect}`);
    console.log(`[auth.js]   - effectControlsContainer exists: ${!!effectControlsContainer}`);
    if (effectSelect) {
        // --- FIX: Use childElementCount to correctly check if empty ---
        console.log(`[auth.js]   - effectSelect.childElementCount: ${effectSelect.childElementCount}`);
    }
    // --- DEBUG ---

    // --- FIX: Check childElementCount (handles whitespace) instead of innerHTML ---
    if (effectSelect && effectControlsContainer && effectSelect.childElementCount === 0) {
        // --- DEBUG ---
        console.log('[auth.js] IF condition PASSED. Populating dropdown.');
        // --- DEBUG ---
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
        
        // Load the default effect (the first one in the 'effects' array)
        // --- DEBUG ---
        if (effects.length > 0 && effects[0].plugin) {
            console.log(`[auth.js] Loading default effect: ${effects[0].name}`);
            backgroundEngine.loadEffect(effects[0].plugin, effectControlsContainer);
        } else {
            console.log('[auth.js] No effects found in array to load as default.');
        }
        // --- DEBUG ---
    } else {
        // --- DEBUG ---
        console.log('[auth.js] IF condition FAILED. Dropdown will not be populated.');
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

// SMS Authentication Handlers
let currentSmsPhoneNumber = null;

async function handleSmsSignIn(e) {
    console.log('[SMS-DEBUG] ========== handleSmsSignIn CALLED ==========');
    console.log('[SMS-DEBUG] Event object:', e);
    console.log('[SMS-DEBUG] Event type:', e?.type);

    e.preventDefault();
    console.log('[SMS-DEBUG] preventDefault() called successfully');

    const phoneInput = document.getElementById('signin-phone');
    const smsMessage = document.getElementById('sms-message');
    const consentCheckbox = document.getElementById('sms-consent-checkbox');
    console.log('[SMS-DEBUG] Phone input element:', phoneInput);
    console.log('[SMS-DEBUG] SMS message element:', smsMessage);
    console.log('[SMS-DEBUG] Consent checkbox element:', consentCheckbox);

    const phoneNumber = phoneInput.value.trim();
    console.log('[SMS-DEBUG] Phone number value:', phoneNumber);
    console.log('[SMS-DEBUG] Consent checkbox checked:', consentCheckbox?.checked);

    if (!phoneNumber) {
        console.log('[SMS-DEBUG] Phone number validation failed - empty');
        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = 'Please enter a phone number.';
        return;
    }

    if (!consentCheckbox || !consentCheckbox.checked) {
        console.log('[SMS-DEBUG] Consent validation failed - not checked');
        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = 'Please agree to receive SMS messages by checking the consent box.';
        return;
    }

    log('Auth', `SMS sign-in initiated for: ${phoneNumber}`);
    console.log('[SMS-DEBUG] Storing phone number to currentSmsPhoneNumber');
    currentSmsPhoneNumber = phoneNumber;

    smsMessage.style.color = '#333';
    smsMessage.textContent = 'Sending SMS code...';
    console.log('[SMS-DEBUG] UI updated - showing "Sending SMS code..." message');

    try {
        console.log('[SMS-DEBUG] Starting fetch request to /api/auth-sms-start');
        console.log('[SMS-DEBUG] Request payload:', { phoneNumber: phoneNumber });

        const response = await fetch('/api/auth-sms-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: phoneNumber }),
        });

        console.log('[SMS-DEBUG] Fetch completed');
        console.log('[SMS-DEBUG] Response status:', response.status);
        console.log('[SMS-DEBUG] Response ok:', response.ok);
        console.log('[SMS-DEBUG] Response headers:', Object.fromEntries(response.headers.entries()));

        const data = await response.json();
        console.log('[SMS-DEBUG] Response data:', data);

        if (!response.ok) {
            console.log('[SMS-DEBUG] Response not OK, throwing error');
            const errorMessage = data.error || 'Failed to send SMS code.';
            console.log('[SMS-DEBUG] Error message from server:', errorMessage);
            throw new Error(errorMessage);
        }

        console.log('[SMS-DEBUG] Success! Updating UI to show verification section');
        smsMessage.style.color = '#28a745';
        smsMessage.textContent = `A 6-digit code has been sent to ${phoneNumber}. Check your messages!`;

        // Hide phone form, show OTP verification form
        const smsForm = document.getElementById('sms-signin-form');
        const verifySection = document.getElementById('sms-verify-section');
        console.log('[SMS-DEBUG] SMS form element:', smsForm);
        console.log('[SMS-DEBUG] Verify section element:', verifySection);

        smsForm.style.display = 'none';
        verifySection.style.display = 'block';
        console.log('[SMS-DEBUG] UI visibility updated - form hidden, verify section shown');

        // Focus on OTP input
        const otpInput = document.getElementById('signin-otp');
        console.log('[SMS-DEBUG] OTP input element:', otpInput);
        otpInput.focus();
        console.log('[SMS-DEBUG] Focus set on OTP input');

        log('Auth', 'SMS code sent successfully');
        console.log('[SMS-DEBUG] ========== handleSmsSignIn COMPLETED SUCCESSFULLY ==========');
    } catch (error) {
        console.error('[SMS-DEBUG] ========== ERROR IN handleSmsSignIn ==========');
        console.error('[SMS-DEBUG] Error object:', error);
        console.error('[SMS-DEBUG] Error message:', error.message);
        console.error('[SMS-DEBUG] Error stack:', error.stack);

        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = error.message;
        log('Auth', `SMS error: ${error.message}`);
        console.log('[SMS-DEBUG] ========== handleSmsSignIn FAILED ==========');
    }
}

async function handleSmsVerify() {
    console.log('[SMS-DEBUG] ========== handleSmsVerify CALLED ==========');

    const otpInput = document.getElementById('signin-otp');
    const smsMessage = document.getElementById('sms-message');
    console.log('[SMS-DEBUG] OTP input element:', otpInput);
    console.log('[SMS-DEBUG] SMS message element:', smsMessage);

    const otpCode = otpInput.value.trim();
    console.log('[SMS-DEBUG] OTP code value:', otpCode);
    console.log('[SMS-DEBUG] OTP code length:', otpCode.length);

    if (!otpCode || otpCode.length !== 6) {
        console.log('[SMS-DEBUG] OTP validation failed - invalid length or empty');
        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = 'Please enter a valid 6-digit code.';
        return;
    }

    if (!currentSmsPhoneNumber) {
        console.log('[SMS-DEBUG] ERROR: currentSmsPhoneNumber is null or undefined');
        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = 'Phone number not found. Please start over.';
        return;
    }

    console.log('[SMS-DEBUG] Current phone number:', currentSmsPhoneNumber);
    log('Auth', `Verifying SMS code for: ${currentSmsPhoneNumber}`);

    smsMessage.style.color = '#333';
    smsMessage.textContent = 'Verifying code...';
    console.log('[SMS-DEBUG] UI updated - showing "Verifying code..." message');

    try {
        console.log('[SMS-DEBUG] Starting fetch request to /api/auth-sms-verify');
        console.log('[SMS-DEBUG] Request payload:', { code: otpCode, phoneNumber: currentSmsPhoneNumber });

        const response = await fetch('/api/auth-sms-verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: otpCode,
                phoneNumber: currentSmsPhoneNumber
            }),
        });

        console.log('[SMS-DEBUG] Fetch completed');
        console.log('[SMS-DEBUG] Response status:', response.status);
        console.log('[SMS-DEBUG] Response ok:', response.ok);

        const data = await response.json();
        console.log('[SMS-DEBUG] Response data:', data);

        if (!response.ok) {
            console.log('[SMS-DEBUG] Response not OK, throwing error');
            throw new Error(data.error || 'Invalid code. Please try again.');
        }

        console.log('[SMS-DEBUG] Verification successful!');
        smsMessage.style.color = '#28a745';
        smsMessage.textContent = 'Success! Signing you in...';

        // Handle successful login
        console.log('[SMS-DEBUG] Calling _handleSuccessfulLogin with data');
        await _handleSuccessfulLogin(data);
        console.log('[SMS-DEBUG] _handleSuccessfulLogin completed');

        // Reset SMS form
        console.log('[SMS-DEBUG] Resetting SMS form UI');
        otpInput.value = '';
        currentSmsPhoneNumber = null;
        document.getElementById('sms-signin-form').style.display = 'block';
        document.getElementById('sms-verify-section').style.display = 'none';
        document.getElementById('signin-phone').value = '';

        log('Auth', 'SMS authentication successful');
        console.log('[SMS-DEBUG] ========== handleSmsVerify COMPLETED SUCCESSFULLY ==========');
    } catch (error) {
        console.error('[SMS-DEBUG] ========== ERROR IN handleSmsVerify ==========');
        console.error('[SMS-DEBUG] Error object:', error);
        console.error('[SMS-DEBUG] Error message:', error.message);
        console.error('[SMS-DEBUG] Error stack:', error.stack);

        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = error.message;
        log('Auth', `SMS verification error: ${error.message}`);
        console.log('[SMS-DEBUG] ========== handleSmsVerify FAILED ==========');
    }
}

async function handleResendSms() {
    console.log('[SMS-DEBUG] ========== handleResendSms CALLED ==========');

    const smsMessage = document.getElementById('sms-message');
    console.log('[SMS-DEBUG] SMS message element:', smsMessage);

    if (!currentSmsPhoneNumber) {
        console.log('[SMS-DEBUG] ERROR: currentSmsPhoneNumber is null or undefined');
        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = 'Phone number not found. Please start over.';
        return;
    }

    console.log('[SMS-DEBUG] Current phone number:', currentSmsPhoneNumber);
    log('Auth', `Resending SMS code to: ${currentSmsPhoneNumber}`);

    smsMessage.style.color = '#333';
    smsMessage.textContent = 'Resending code...';
    console.log('[SMS-DEBUG] UI updated - showing "Resending code..." message');

    try {
        console.log('[SMS-DEBUG] Starting fetch request to /api/auth-sms-start');
        console.log('[SMS-DEBUG] Request payload:', { phoneNumber: currentSmsPhoneNumber });

        const response = await fetch('/api/auth-sms-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: currentSmsPhoneNumber }),
        });

        console.log('[SMS-DEBUG] Fetch completed');
        console.log('[SMS-DEBUG] Response status:', response.status);
        console.log('[SMS-DEBUG] Response ok:', response.ok);

        const data = await response.json();
        console.log('[SMS-DEBUG] Response data:', data);

        if (!response.ok) {
            console.log('[SMS-DEBUG] Response not OK, throwing error');
            throw new Error(data.error || 'Failed to resend SMS code.');
        }

        smsMessage.style.color = '#28a745';
        smsMessage.textContent = `New code sent to ${currentSmsPhoneNumber}!`;

        log('Auth', 'SMS code resent successfully');
        console.log('[SMS-DEBUG] ========== handleResendSms COMPLETED SUCCESSFULLY ==========');
    } catch (error) {
        console.error('[SMS-DEBUG] ========== ERROR IN handleResendSms ==========');
        console.error('[SMS-DEBUG] Error object:', error);
        console.error('[SMS-DEBUG] Error message:', error.message);
        console.error('[SMS-DEBUG] Error stack:', error.stack);

        smsMessage.style.color = '#dc3545';
        smsMessage.textContent = error.message;
        log('Auth', `Resend SMS error: ${error.message}`);
        console.log('[SMS-DEBUG] ========== handleResendSms FAILED ==========');
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

    // --- SMS AUTHENTICATION EVENT LISTENERS ---
    console.log('[SMS-DEBUG] ========== Setting up SMS event listeners ==========');

    const smsSigninForm = document.getElementById('sms-signin-form');
    const verifyOtpBtn = document.getElementById('verify-otp-btn');
    const resendSmsBtn = document.getElementById('resend-sms-btn');

    console.log('[SMS-DEBUG] sms-signin-form element:', smsSigninForm);
    console.log('[SMS-DEBUG] verify-otp-btn element:', verifyOtpBtn);
    console.log('[SMS-DEBUG] resend-sms-btn element:', resendSmsBtn);

    if (smsSigninForm) {
        console.log('[SMS-DEBUG] Attaching submit listener to sms-signin-form');
        smsSigninForm.addEventListener('submit', handleSmsSignIn);
        console.log('[SMS-DEBUG] Submit listener attached successfully');
    } else {
        console.warn('[SMS-DEBUG] WARNING: sms-signin-form element not found!');
    }

    if (verifyOtpBtn) {
        console.log('[SMS-DEBUG] Attaching click listener to verify-otp-btn');
        verifyOtpBtn.addEventListener('click', handleSmsVerify);
        console.log('[SMS-DEBUG] Click listener attached successfully');
    } else {
        console.warn('[SMS-DEBUG] WARNING: verify-otp-btn element not found!');
    }

    if (resendSmsBtn) {
        console.log('[SMS-DEBUG] Attaching click listener to resend-sms-btn');
        resendSmsBtn.addEventListener('click', handleResendSms);
        console.log('[SMS-DEBUG] Click listener attached successfully');
    } else {
        console.warn('[SMS-DEBUG] WARNING: resend-sms-btn element not found!');
    }

    // Allow Enter key to submit OTP
    const otpInput = document.getElementById('signin-otp');
    console.log('[SMS-DEBUG] signin-otp element:', otpInput);

    if (otpInput) {
        console.log('[SMS-DEBUG] Attaching keypress listener to signin-otp');
        otpInput.addEventListener('keypress', (e) => {
            console.log('[SMS-DEBUG] Keypress event in OTP input:', e.key);
            if (e.key === 'Enter') {
                console.log('[SMS-DEBUG] Enter key detected - calling handleSmsVerify');
                e.preventDefault();
                handleSmsVerify();
            }
        });
        console.log('[SMS-DEBUG] Keypress listener attached successfully');
    } else {
        console.warn('[SMS-DEBUG] WARNING: signin-otp element not found!');
    }

    console.log('[SMS-DEBUG] ========== SMS event listeners setup complete ==========');

    // --- NETLIFY IDENTITY SSO SETUP ---
    console.log('[Auth] ========== NETLIFY IDENTITY SETUP START ==========');
    console.log('[Auth] Checking if netlifyIdentity is already defined:', typeof netlifyIdentity !== 'undefined');

    // Get the debug status element
    const debugStatusEl = document.getElementById('google-sso-debug-status');
    const updateDebugStatus = (message, color = '#666') => {
        if (debugStatusEl) {
            debugStatusEl.textContent = message;
            debugStatusEl.style.color = color;
        }
        console.log('[Auth] Debug status:', message);
    };

    // Function to load Netlify Identity script
    const loadNetlifyIdentityScript = () => {
        return new Promise((resolve, reject) => {
            console.log('[Auth] Loading Netlify Identity widget script...');
            updateDebugStatus('Loading Google SSO...', '#666');

            if (typeof window.netlifyIdentity !== 'undefined') {
                console.log('[Auth] Netlify Identity already loaded');
                resolve();
                return;
            }

            // Check if the script is already being loaded
            const existingScript = document.querySelector('script[src*="netlify-identity-widget"]');
            if (existingScript) {
                console.log('[Auth] Netlify Identity script already exists, waiting for load...');
                existingScript.onload = () => {
                    console.log('[Auth] Existing script loaded');
                    resolve();
                };
                existingScript.onerror = () => {
                    console.error('[Auth] Existing script failed to load');
                    reject(new Error('Failed to load Netlify Identity widget'));
                };
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://identity.netlify.com/v1/netlify-identity-widget.js';
            script.async = true;
            script.onload = () => {
                console.log('[Auth] Netlify Identity widget script loaded successfully');
                resolve();
            };
            script.onerror = (err) => {
                console.error('[Auth] Failed to load Netlify Identity widget script:', err);
                reject(new Error('Failed to load Netlify Identity widget'));
            };
            document.head.appendChild(script);
        });
    };

    // Load and initialize Netlify Identity
    loadNetlifyIdentityScript()
        .then(() => {
            console.log('[Auth] Script loaded, waiting for netlifyIdentity to be available...');
            // Small delay to ensure the script has initialized
            setTimeout(() => {
                if (typeof window.netlifyIdentity !== 'undefined') {
                    initializeNetlifyIdentity(updateDebugStatus);
                } else {
                    console.error('[Auth] netlifyIdentity not available after script load');
                    updateDebugStatus('Google SSO unavailable - widget failed to initialize', '#dc3545');
                }
            }, 100);
        })
        .catch((error) => {
            console.error('[Auth] Error loading Netlify Identity:', error);
            updateDebugStatus('Google SSO unavailable - script load failed', '#dc3545');
        });

    console.log('[Auth] ========== NETLIFY IDENTITY SETUP END ==========');
}

function initializeNetlifyIdentity(updateDebugStatus = () => {}) {
    console.log('[Auth] ========== NETLIFY IDENTITY INITIALIZATION START ==========');
    console.log('[Auth] Window.netlifyIdentity exists:', typeof netlifyIdentity !== 'undefined');

    if (typeof netlifyIdentity === 'undefined') {
        console.error('[Auth] netlifyIdentity is undefined!');
        updateDebugStatus('Google SSO Error: Widget not loaded', '#dc3545');
        return;
    }

    console.log('[Auth] Initializing Netlify Identity');

    // Initialize the widget
    console.log('[Auth] Calling netlifyIdentity.init()');
    try {
        netlifyIdentity.init({
            locale: 'en'
        });
        console.log('[Auth] netlifyIdentity.init() completed');
        updateDebugStatus('Google SSO Ready', '#28a745');
    } catch (error) {
        console.error('[Auth] Error during netlifyIdentity.init():', error);
        updateDebugStatus('Google SSO Error: Init failed', '#dc3545');
        return;
    }

    // Check if Google provider is configured
    console.log('[Auth] Checking Netlify Identity configuration...');
    console.log('[Auth] Site URL:', window.location.origin);

    // Set up Google SSO button
    const googleSsoBtn = document.getElementById('google-sso-btn');
    console.log('[Auth] Google SSO button element found:', !!googleSsoBtn);

    if (googleSsoBtn) {
        googleSsoBtn.addEventListener('click', () => {
            console.log('[Auth] ========== GOOGLE SSO BUTTON CLICKED ==========');
            console.log('[Auth] Timestamp:', new Date().toISOString());
            updateDebugStatus('Opening Google sign-in...', '#007bff');

            try {
                // Trigger Google login directly
                console.log('[Auth] Opening Netlify Identity modal...');
                netlifyIdentity.open('login');
                console.log('[Auth] Netlify Identity modal opened');

                // Try to auto-click Google after a short delay
                setTimeout(() => {
                    const googleBtn = document.querySelector('.btnProvider[data-provider="google"]');
                    console.log('[Auth] Looking for Google provider button:', !!googleBtn);
                    if (googleBtn) {
                        console.log('[Auth] Found Google provider button, clicking...');
                        googleBtn.click();
                    } else {
                        console.log('[Auth] Google provider button not found in modal');
                        console.log('[Auth] Available provider buttons:', document.querySelectorAll('.btnProvider').length);
                        document.querySelectorAll('.btnProvider').forEach((btn, i) => {
                            console.log(`[Auth]   Provider ${i}:`, btn.getAttribute('data-provider'));
                        });
                        updateDebugStatus('Google provider not configured in Netlify Identity', '#ff9800');
                    }
                }, 500);
            } catch (error) {
                console.error('[Auth] Error opening Google SSO:', error);
                updateDebugStatus('Error opening Google sign-in: ' + error.message, '#dc3545');
                signinMessage.textContent = "Error opening Google sign-in. Please try again.";
                signinMessage.style.color = '#dc3545';
            }
        });
        console.log('[Auth] Google SSO button click listener attached');
    } else {
        console.warn('[Auth] Google SSO button not found in DOM');
        updateDebugStatus('Google SSO button not found', '#dc3545');
    }

    // Handle successful login
    netlifyIdentity.on('login', async (user) => {
        console.log('[Auth] ========== NETLIFY IDENTITY LOGIN EVENT ==========');
        console.log('[Auth] Timestamp:', new Date().toISOString());
        console.log('[Auth] User object received:', !!user);
        console.log('[Auth] User email:', user?.email);
        console.log('[Auth] User id:', user?.id);
        console.log('[Auth] User token exists:', !!user?.token);
        console.log('[Auth] User token.access_token exists:', !!user?.token?.access_token);
        console.log('[Auth] User app_metadata:', JSON.stringify(user?.app_metadata));
        console.log('[Auth] User user_metadata:', JSON.stringify(user?.user_metadata));

        updateDebugStatus('Completing sign-in...', '#007bff');

        try {
            if (!user?.token?.access_token) {
                throw new Error('No access token received from Netlify Identity');
            }

            const netlifyJwt = user.token.access_token;
            console.log('[Auth] Netlify JWT received');
            console.log('[Auth] JWT length:', netlifyJwt.length);
            console.log('[Auth] Calling /api/auth-social with Netlify JWT...');

            // Call serverless function to get app-specific JWT
            const response = await fetch('/api/auth-social', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${netlifyJwt}`
                }
            });

            console.log('[Auth] /api/auth-social response status:', response.status);
            console.log('[Auth] /api/auth-social response ok:', response.ok);

            const responseText = await response.text();
            console.log('[Auth] Response body length:', responseText.length);

            let responseData;
            try {
                responseData = JSON.parse(responseText);
            } catch (e) {
                console.error('[Auth] Failed to parse response as JSON:', responseText.substring(0, 200));
                throw new Error('Invalid response from auth-social endpoint');
            }

            if (!response.ok) {
                console.error('[Auth] auth-social error response:', responseData);
                throw new Error(responseData.error || "Failed to sync social login.");
            }

            console.log('[Auth] Received app payload from /api/auth-social');
            console.log('[Auth] App token present:', !!responseData.token);
            console.log('[Auth] User data present:', !!responseData.user);
            console.log('[Auth] User ID:', responseData.user?.id);
            console.log('[Auth] Liked items count:', responseData.user?.likedItemIds?.length || 0);

            console.log('[Auth] Calling _handleSuccessfulLogin...');
            updateDebugStatus('Signed in successfully!', '#28a745');

            await _handleSuccessfulLogin(responseData);

            console.log('[Auth] _handleSuccessfulLogin completed');
            console.log('[Auth] Closing Netlify Identity modal...');
            netlifyIdentity.close();
            console.log('[Auth] Modal closed');
            console.log('[Auth] ========== GOOGLE SSO LOGIN COMPLETE ==========');

        } catch (error) {
            console.error('[Auth] ========== SSO LOGIN ERROR ==========');
            console.error("[Auth] Error details:", error);
            console.error("[Auth] Error message:", error.message);
            console.error("[Auth] Error stack:", error.stack);

            updateDebugStatus('Sign-in failed: ' + error.message, '#dc3545');
            signinMessage.textContent = "Error logging in with Google: " + error.message;
            signinMessage.style.color = '#dc3545';
            console.error('[Auth] ========== SSO LOGIN ERROR END ==========');
        }
    });

    // Handle modal close
    netlifyIdentity.on('close', () => {
        console.log('[Auth] Netlify Identity modal closed');
    });

    // Handle errors
    netlifyIdentity.on('error', (error) => {
        console.error('[Auth] ========== NETLIFY IDENTITY ERROR ==========');
        console.error('[Auth] Error:', error);
        console.error('[Auth] Error type:', typeof error);
        console.error('[Auth] Error message:', error?.message || error);
        updateDebugStatus('Authentication error: ' + (error?.message || error), '#dc3545');
        signinMessage.textContent = "Authentication error. Please try again.";
        signinMessage.style.color = '#dc3545';
        console.error('[Auth] ========== NETLIFY IDENTITY ERROR END ==========');
    });

    // Handle logout
    netlifyIdentity.on('logout', () => {
        console.log('[Auth] Netlify Identity logout event');
    });

    console.log('[Auth] ========== NETLIFY IDENTITY INITIALIZATION COMPLETE ==========');
}

// --- DEBUG ---
console.log('[auth.js] 4. File execution finished. Exports are ready.');
// --- DEBUG ---
