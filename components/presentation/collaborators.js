/**
 * Collaborators
 * Collaborator display, invite modal, and collaborator management.
 * Extracted from presentation.js — Phase 1 modularization.
 */

import { state } from '../../state.js';
import { getCurrentUser } from '../../chat.js';
import { triggerSave } from '../../events.js';
import { log } from '../../utils/debug.js';

// DOM element caches (set via init or lazy lookup)
let collaboratorsListEl = null;
let collaboratorsModal = null;
let collaboratorsModalClose = null;
let collaboratorsModalList = null;
let collaboratorsAddShareBtn = null;
let presentationAccountBtn = null;

// Dependencies
let _updateAccountButton = null;

/**
 * Initialize the collaborators module.
 * @param {Object} deps
 * @param {Function} deps.updateAccountButton - Function to update the account button display
 * @param {Object} deps.elements - Pre-cached DOM elements
 * @param {HTMLElement} deps.elements.collaboratorsListEl
 * @param {HTMLElement} deps.elements.collaboratorsModal
 * @param {HTMLElement} deps.elements.collaboratorsModalClose
 * @param {HTMLElement} deps.elements.collaboratorsModalList
 * @param {HTMLElement} deps.elements.collaboratorsAddShareBtn
 * @param {HTMLElement} deps.elements.presentationAccountBtn
 */
export function init({ updateAccountButton, elements }) {
    _updateAccountButton = updateAccountButton;
    if (elements) {
        collaboratorsListEl = elements.collaboratorsListEl;
        collaboratorsModal = elements.collaboratorsModal;
        collaboratorsModalClose = elements.collaboratorsModalClose;
        collaboratorsModalList = elements.collaboratorsModalList;
        collaboratorsAddShareBtn = elements.collaboratorsAddShareBtn;
        presentationAccountBtn = elements.presentationAccountBtn;
    }
}

/**
 * Render the collaborator list in the presentation header.
 */
export function renderCollaborators() {
    const userProfiles = state.session.userProfiles;

    // Update the account button with current user info
    if (_updateAccountButton) _updateAccountButton();

    if (userProfiles.size === 0) {
        if (collaboratorsListEl) {
            collaboratorsListEl.innerHTML = '';
        }
        return;
    }

    const collaboratorsArray = [];
    userProfiles.forEach((name, odId) => {
        const isCurrentUser = state.session.user.id === odId;
        if (!isCurrentUser) {
            collaboratorsArray.push({ name, odId });
        }
    });

    let html = '';
    collaboratorsArray.forEach((collab) => {
        html += `
            <button class="collaborator-name-btn" data-collaborator-id="${collab.odId}" title="${collab.name}">
                ${collab.name}
            </button>
        `;
    });

    if (collaboratorsListEl) {
        collaboratorsListEl.innerHTML = html;
    }
}

/**
 * Show the invite modal for sending email invitations.
 */
export function showInviteModal() {
    const overlay = document.getElementById('invite-modal-overlay');
    const emailInput = document.getElementById('invite-email-input');
    const statusEl = document.getElementById('invite-status');
    const sendBtn = document.getElementById('invite-send-btn');

    if (!overlay) return;

    if (emailInput) emailInput.value = '';
    if (statusEl) {
        statusEl.style.display = 'none';
        statusEl.textContent = '';
    }
    if (sendBtn) sendBtn.disabled = false;

    overlay.classList.add('active');

    if (!overlay._listenersSetup) {
        overlay._listenersSetup = true;

        const form = document.getElementById('invite-form');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await handleSendInvite();
            });
        }

        const copyBtn = document.getElementById('invite-copy-link-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const baseURL = window.location.origin + window.location.pathname;
                const sessionID = state.session.id;
                const shareURL = `${baseURL}?session=${sessionID}&view=present`;

                navigator.clipboard.writeText(shareURL).then(() => {
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 1500);
                });
            });
        }

        const cancelBtn = document.getElementById('invite-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', hideInviteModal);
        }

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) hideInviteModal();
        });
    }

    if (emailInput) emailInput.focus();
}

/**
 * Hide the invite modal.
 */
export function hideInviteModal() {
    const overlay = document.getElementById('invite-modal-overlay');
    if (overlay) overlay.classList.remove('active');
}

/**
 * Handle sending an invite email.
 */
async function handleSendInvite() {
    const emailInput = document.getElementById('invite-email-input');
    const roleSelect = document.getElementById('invite-role-select');
    const statusEl = document.getElementById('invite-status');
    const sendBtn = document.getElementById('invite-send-btn');

    const email = emailInput?.value?.trim();
    const role = roleSelect?.value || 'Editor';

    if (!email) return;

    if (sendBtn) sendBtn.disabled = true;
    if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.textContent = 'Sending invitation...';
        statusEl.className = 'invite-status';
    }

    try {
        const currentUser = getCurrentUser();
        const eventName = state.eventDetails?.combined?.get?.('Event Name') || 'Event Plan';

        const response = await fetch('/api/send-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                sessionId: state.session.id,
                invitedBy: currentUser?.id,
                inviterName: currentUser?.name || 'Someone',
                role,
                sessionName: eventName,
                storeId: state.session.storeId || ''
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to send invitation');
        }

        if (statusEl) {
            statusEl.textContent = `Invitation sent to ${email}`;
            statusEl.className = 'invite-status success';
        }
        if (emailInput) emailInput.value = '';
        if (sendBtn) sendBtn.disabled = false;

        log('Presentation', `Invite sent to ${email} as ${role}`);

    } catch (error) {
        if (statusEl) {
            statusEl.textContent = error.message;
            statusEl.className = 'invite-status error';
        }
        if (sendBtn) sendBtn.disabled = false;
        log('Presentation', `Invite error: ${error.message}`);
    }
}

/**
 * Show the expanded collaborators modal with full list.
 */
export function showCollaboratorsModal() {
    if (!collaboratorsModal || !collaboratorsModalList) return;

    const userProfiles = state.session.userProfiles;
    const currentUserIsAuthenticated = state.session.user.isAuthenticated;

    let html = '';
    userProfiles.forEach((name, odId) => {
        const isCurrentUser = state.session.user.id === odId;
        const badge = isCurrentUser ? '<span class="collaborator-badge">You</span>' : '';
        const isUnauthenticatedCollaborator = !odId.startsWith('rec');
        const showRemoveBtn = currentUserIsAuthenticated && isUnauthenticatedCollaborator && !isCurrentUser;
        const removeBtn = showRemoveBtn
            ? `<button class="collaborator-remove-btn" data-collaborator-id="${odId}" title="Remove this collaborator">&#10005;</button>`
            : '';
        html += `
            <div class="collaborator-item${isUnauthenticatedCollaborator ? ' unauthenticated' : ''}">
                <span class="collaborator-avatar">${name.charAt(0).toUpperCase()}</span>
                <span class="collaborator-name">${name}${badge}</span>
                ${removeBtn}
            </div>
        `;
    });

    collaboratorsModalList.innerHTML = html;

    collaboratorsModalList.querySelectorAll('.collaborator-remove-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const collaboratorId = btn.dataset.collaboratorId;
            await removeUnauthenticatedCollaborator(collaboratorId);
        });
    });

    collaboratorsModal.classList.add('active');
}

/**
 * Remove an unauthenticated collaborator from the plan.
 * @param {string} collaboratorId
 */
async function removeUnauthenticatedCollaborator(collaboratorId) {
    if (!collaboratorId) return;

    if (collaboratorId.startsWith('rec')) {
        console.warn('Cannot remove authenticated collaborators via this function');
        return;
    }

    const collaboratorName = state.session.userProfiles.get(collaboratorId) || 'Unknown';

    if (!confirm(`Remove "${collaboratorName}" from this plan? Their reactions will remain but they won't appear in the team list.`)) {
        return;
    }

    state.session.userProfiles.delete(collaboratorId);

    await triggerSave();

    showCollaboratorsModal();
    renderCollaborators();

    log('Presentation', `Removed unauthenticated collaborator: ${collaboratorName} (${collaboratorId})`);
}

/**
 * Hide the expanded collaborators modal.
 */
export function hideCollaboratorsModal() {
    if (collaboratorsModal) {
        collaboratorsModal.classList.remove('active');
    }
}

export function cleanup() {
    collaboratorsListEl = null;
    collaboratorsModal = null;
    collaboratorsModalClose = null;
    collaboratorsModalList = null;
    collaboratorsAddShareBtn = null;
    presentationAccountBtn = null;
    _updateAccountButton = null;
}
