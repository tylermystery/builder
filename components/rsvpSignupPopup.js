import { startEmailSignIn } from '../auth.js';
import { showToast } from '../ui.js';
import { getTempRsvps, setTempRsvps } from '../utils.js';

let rsvpSignupPopup = null;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]));
}

export function closeRsvpSignupPopup() {
    if (!rsvpSignupPopup) return;
    rsvpSignupPopup.remove();
    rsvpSignupPopup = null;
}

export function showRsvpSignupPopup({ eventId, rsvpType, eventRecord }) {
    closeRsvpSignupPopup();

    const eventName = eventRecord?.fields?.Name || eventRecord?.fields?.Title || 'this event';
    const overlay = document.createElement('div');
    overlay.className = 'rsvp-signup-overlay active';
    overlay.innerHTML = `
        <div class="rsvp-signup-modal" role="dialog" aria-modal="true" aria-labelledby="rsvp-signup-title">
            <button type="button" class="rsvp-signup-close" aria-label="Close">&times;</button>
            <div class="rsvp-signup-kicker">${rsvpType === 'yes' ? 'RSVP saved as going' : 'RSVP saved as maybe'}</div>
            <h3 id="rsvp-signup-title">Register or get updates</h3>
            <p class="rsvp-signup-copy">Add an email for ${escapeHtml(eventName)}. You can save this RSVP to an account and receive event updates.</p>
            <form class="rsvp-signup-form">
                <label class="rsvp-signup-field">
                    <span>Email</span>
                    <input type="email" name="email" autocomplete="email" placeholder="you@example.com">
                </label>
                <label class="rsvp-signup-check">
                    <input type="checkbox" name="saveToAccount">
                    <span>Create and/or save to account</span>
                </label>
                <label class="rsvp-signup-check">
                    <input type="checkbox" name="receiveUpdates">
                    <span>Receive event updates</span>
                </label>
                <div class="rsvp-signup-message" aria-live="polite"></div>
                <div class="rsvp-signup-actions">
                    <button type="button" class="rsvp-signup-secondary">Not now</button>
                    <button type="submit" class="rsvp-signup-primary">Continue</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(overlay);
    rsvpSignupPopup = overlay;

    const form = overlay.querySelector('.rsvp-signup-form');
    const emailInput = overlay.querySelector('input[name="email"]');
    const messageEl = overlay.querySelector('.rsvp-signup-message');
    const saveCheckbox = overlay.querySelector('input[name="saveToAccount"]');
    const updatesCheckbox = overlay.querySelector('input[name="receiveUpdates"]');
    const primaryBtn = overlay.querySelector('.rsvp-signup-primary');

    const close = () => closeRsvpSignupPopup();
    overlay.querySelector('.rsvp-signup-close')?.addEventListener('click', close);
    overlay.querySelector('.rsvp-signup-secondary')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    const lastEmail = localStorage.getItem('lastSignInEmail') || '';
    if (lastEmail) emailInput.value = lastEmail;
    setTimeout(() => emailInput.focus(), 0);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = emailInput.value.trim();
        const saveToAccount = saveCheckbox.checked;
        const receiveUpdates = updatesCheckbox.checked;

        if ((saveToAccount || receiveUpdates) && !email) {
            messageEl.textContent = 'Enter an email to continue.';
            messageEl.className = 'rsvp-signup-message error';
            emailInput.focus();
            return;
        }

        const tempRsvps = getTempRsvps();
        tempRsvps[eventId] = {
            ...(tempRsvps[eventId] || {}),
            rsvpType,
            quantity: tempRsvps[eventId]?.quantity || 1,
            email: email || undefined,
            saveToAccount,
            receiveUpdates,
        };
        setTempRsvps(tempRsvps);

        if (!saveToAccount) {
            showToast(receiveUpdates ? 'Update preference saved.' : 'RSVP saved.');
            close();
            return;
        }

        primaryBtn.disabled = true;
        try {
            await startEmailSignIn(email, {
                onStatus: (msg, kind) => {
                    messageEl.textContent = msg;
                    messageEl.className = `rsvp-signup-message ${kind || 'info'}`;
                },
            });
        } catch (error) {
            primaryBtn.disabled = false;
            messageEl.textContent = error.message || 'Unable to send confirmation email.';
            messageEl.className = 'rsvp-signup-message error';
        }
    });
}

document.addEventListener('userLoggedIn', closeRsvpSignupPopup);
