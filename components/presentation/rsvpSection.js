/**
 * RSVP Section
 * RSVP buttons, attendee list, and calendar export for events.
 * Extracted from presentation.js — Phase 1 modularization.
 */

import { state, getRecordById } from '../../state.js';
import * as api from '../../api.js';
import { log } from '../../utils/debug.js';
import { showToast } from '../../ui.js';
import { showUserModal } from '../../auth.js';
import { createCalendarExportButtons, initializeCalendarExportListeners } from '../../utils/calendarExport.js';

// Cache for the linked event record
let linkedEventRecord = null;

/**
 * Fetches and renders the RSVP section for events.
 * Called during presentation view initialization.
 */
export async function renderRsvpSection() {
    const rsvpSection = document.getElementById('presentation-rsvp-section');
    const rsvpButtonsContainer = document.getElementById('presentation-rsvp-buttons');
    const rsvpListContainer = document.getElementById('presentation-rsvp-list');

    if (!rsvpSection || !rsvpButtonsContainer || !rsvpListContainer) {
        console.log('[Presentation] RSVP section elements not found');
        return;
    }

    // Try to get eventId from URL first
    const urlParams = new URLSearchParams(window.location.search);
    const eventIdFromUrl = urlParams.get('eventId');

    let eventRecord = null;

    if (eventIdFromUrl) {
        eventRecord = getRecordById(eventIdFromUrl);
        if (!eventRecord) {
            try {
                const fetchedItems = await api.fetchGhostItems([eventIdFromUrl]);
                if (fetchedItems && fetchedItems.length > 0) {
                    eventRecord = fetchedItems[0];
                }
            } catch (err) {
                console.error('[Presentation] Error fetching event record:', err);
            }
        }
    }

    // If no eventId in URL, try to find it from session's LinkedItem
    if (!eventRecord && state.session.id) {
        try {
            const sessionData = await api.fetchSessionById(state.session.id);
            if (sessionData?.fields?.LinkedItem?.length > 0) {
                const linkedItemId = sessionData.fields.LinkedItem[0];
                eventRecord = getRecordById(linkedItemId);
                if (!eventRecord) {
                    const fetchedItems = await api.fetchGhostItems([linkedItemId]);
                    if (fetchedItems && fetchedItems.length > 0) {
                        eventRecord = fetchedItems[0];
                    }
                }
            }
        } catch (err) {
            console.error('[Presentation] Error fetching session LinkedItem:', err);
        }
    }

    if (!eventRecord || eventRecord.fields['Item Type'] !== 'Event') {
        rsvpSection.style.display = 'none';
        linkedEventRecord = null;
        return;
    }

    linkedEventRecord = eventRecord;
    rsvpSection.style.display = 'block';

    renderRsvpButtons(rsvpButtonsContainer, eventRecord);
    await renderRsvpList(rsvpListContainer, eventRecord);

    // Render calendar export buttons
    const calendarExportContainer = document.getElementById('presentation-calendar-export');
    if (calendarExportContainer && eventRecord.fields.Date) {
        // Ensure the WTF link can be built: in plan view the current session is
        // always known, so backfill LinkedSession for legacy events that predate it.
        if ((!eventRecord.fields.LinkedSession || eventRecord.fields.LinkedSession.length === 0) && state.session.id) {
            eventRecord.fields.LinkedSession = [state.session.id];
        }
        calendarExportContainer.innerHTML = createCalendarExportButtons(eventRecord);
        initializeCalendarExportListeners(eventRecord, calendarExportContainer);
    }
}

/**
 * Renders the RSVP buttons (Yes, Maybe, No).
 */
function renderRsvpButtons(container, eventRecord) {
    const rsvpYes = eventRecord.fields.RSVPs || [];
    const rsvpMaybe = eventRecord.fields.RSVPMaybe || [];
    const rsvpNo = eventRecord.fields.RSVPNo || [];
    const userId = state.session.user.id;

    const hasRsvpdYes = rsvpYes.includes(userId);
    const hasRsvpdMaybe = rsvpMaybe.includes(userId);
    const hasRsvpdNo = rsvpNo.includes(userId);

    container.innerHTML = `
        <div class="presentation-rsvp-label">Are you going?</div>
        <div class="rsvp-button-group">
            <button class="rsvp-btn rsvp-yes ${hasRsvpdYes ? 'active' : ''}"
                    data-record-id="${eventRecord.id}"
                    data-rsvp-type="yes">
                ${hasRsvpdYes ? "Going \u2705" : "Yes"}
            </button>
            <button class="rsvp-btn rsvp-maybe ${hasRsvpdMaybe ? 'active' : ''}"
                    data-record-id="${eventRecord.id}"
                    data-rsvp-type="maybe">
                ${hasRsvpdMaybe ? "Maybe \u2753" : "Maybe"}
            </button>
            <button class="rsvp-btn rsvp-no ${hasRsvpdNo ? 'active' : ''}"
                    data-record-id="${eventRecord.id}"
                    data-rsvp-type="no">
                ${hasRsvpdNo ? "Can't Go \u274c" : "No"}
            </button>
        </div>
    `;
}

/**
 * Renders the RSVP list showing who has RSVPed.
 */
async function renderRsvpList(container, eventRecord) {
    const rsvpYes = eventRecord.fields.RSVPs || [];
    const rsvpMaybe = eventRecord.fields.RSVPMaybe || [];
    const rsvpNo = eventRecord.fields.RSVPNo || [];

    if (rsvpYes.length === 0 && rsvpMaybe.length === 0 && rsvpNo.length === 0) {
        container.innerHTML = '<div class="rsvp-empty-state">No responses yet</div>';
        return;
    }

    let html = '';

    if (rsvpYes.length > 0) {
        html += `
            <div class="rsvp-list-group">
                <div class="rsvp-list-label">Going (${rsvpYes.length})</div>
                <div class="rsvp-list-items" data-rsvp-type="yes">Loading...</div>
            </div>
        `;
    }

    if (rsvpMaybe.length > 0) {
        html += `
            <div class="rsvp-list-group">
                <div class="rsvp-list-label">Maybe (${rsvpMaybe.length})</div>
                <div class="rsvp-list-items" data-rsvp-type="maybe">Loading...</div>
            </div>
        `;
    }

    if (rsvpNo.length > 0) {
        html += `
            <div class="rsvp-list-group">
                <div class="rsvp-list-label">Can't Go (${rsvpNo.length})</div>
                <div class="rsvp-list-items" data-rsvp-type="no">Loading...</div>
            </div>
        `;
    }

    container.innerHTML = html;

    // Fetch user names asynchronously
    const allUserIds = [...rsvpYes, ...rsvpMaybe, ...rsvpNo];
    try {
        const userNameMap = await api.fetchUserNamesByIds(allUserIds);

        const formatNames = (userIds) => {
            if (userIds.length === 0) return '';
            const names = userIds.map(id => userNameMap.get(id) || 'Guest');
            return names.join(', ');
        };

        const yesEl = container.querySelector('[data-rsvp-type="yes"]');
        if (yesEl) yesEl.textContent = formatNames(rsvpYes) || 'Guest';

        const maybeEl = container.querySelector('[data-rsvp-type="maybe"]');
        if (maybeEl) maybeEl.textContent = formatNames(rsvpMaybe) || 'Guest';

        const noEl = container.querySelector('[data-rsvp-type="no"]');
        if (noEl) noEl.textContent = formatNames(rsvpNo) || 'Guest';
    } catch (err) {
        console.error('[Presentation] Error fetching RSVP user names:', err);
        const items = container.querySelectorAll('.rsvp-list-items');
        items.forEach(el => el.textContent = 'Guests');
    }
}

/**
 * Handles RSVP button clicks in the presentation view.
 * @param {Event} e - Click event
 * @param {HTMLElement} modal - The presentation modal element
 */
export function handleRsvpClick(e, modal) {
    const rsvpBtn = e.target.closest('.rsvp-btn');
    if (!rsvpBtn) return;

    if (!modal || !modal.classList.contains('active')) return;

    if (!state.session.user.isAuthenticated) {
        showToast('Please sign in to RSVP');
        showUserModal();
        return;
    }

    const recordId = rsvpBtn.dataset.recordId;
    const rsvpType = rsvpBtn.dataset.rsvpType;
    const userId = state.session.user.id;

    if (!recordId || !rsvpType || !linkedEventRecord) {
        console.error('[Presentation] Missing RSVP data');
        return;
    }

    const originalText = rsvpBtn.innerHTML;
    rsvpBtn.disabled = true;
    rsvpBtn.innerHTML = '...';

    (async () => {
        try {
            const currentlyActive = rsvpBtn.classList.contains('active');
            const newRsvpType = currentlyActive ? null : rsvpType;

            const result = await api.updateRsvpForEvent(recordId, userId, newRsvpType);

            if (result) {
                linkedEventRecord.fields.RSVPs = result.RSVPs || [];
                linkedEventRecord.fields.RSVPMaybe = result.RSVPMaybe || [];
                linkedEventRecord.fields.RSVPNo = result.RSVPNo || [];

                const stateRecord = getRecordById(recordId);
                if (stateRecord) {
                    stateRecord.fields.RSVPs = result.RSVPs || [];
                    stateRecord.fields.RSVPMaybe = result.RSVPMaybe || [];
                    stateRecord.fields.RSVPNo = result.RSVPNo || [];
                }

                const rsvpButtonsContainer = document.getElementById('presentation-rsvp-buttons');
                const rsvpListContainer = document.getElementById('presentation-rsvp-list');

                if (rsvpButtonsContainer) {
                    renderRsvpButtons(rsvpButtonsContainer, linkedEventRecord);
                }
                if (rsvpListContainer) {
                    await renderRsvpList(rsvpListContainer, linkedEventRecord);
                }

                log('Presentation', `RSVP updated: ${rsvpType} for event ${recordId}`);
            } else {
                throw new Error('RSVP update failed');
            }
        } catch (error) {
            console.error('[Presentation] RSVP Error:', error);
            showToast(`RSVP Error: ${error.message}`);
            rsvpBtn.innerHTML = originalText;
            rsvpBtn.disabled = false;
        }
    })();
}

export function cleanup() {
    linkedEventRecord = null;
}
