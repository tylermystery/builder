// REPLACE THE ENTIRE CONTENTS of components/sidebar.js

import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from '../config.js';
import { calculateMissingCategories, buildGoalBucket } from '../availability.js';
import { calculateRecommendationScore } from '../availability.js';
import { parseOptions, getRecordPrice, getEffectiveMinQuantity, flattenOptionGroups } from '../utils.js';
import { log } from '../utils/debug.js';
import * as backgroundEngine from './backgroundEngine.js';
import { showReceiptModal } from './receipt.js';


async function createFavoriteCardElement(record, itemInfo, imageCache) {
    const fields = record.fields;
    const itemCard = document.createElement('div');
    itemCard.className = `favorite-item lazy-load`;
    itemCard.dataset.recordId = record.id;

    // This will use the default placeholder for custom items, which is correct
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, imageCache);

    // Optimize background image with proper Cloudinary transformations
    const defaultPlaceholder = `https://res.cloudinary.com/${CONSTANTS.CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520,f_auto,q_auto/ww71meppejsewxsxr4x7.jpg`;
    const bgImageUrl = imageUrls[0] || defaultPlaceholder;
    itemCard.dataset.bgImage = bgImageUrl.includes('cloudinary') && !bgImageUrl.includes('/upload/c_fill')
        ? bgImageUrl.replace('/upload/', '/upload/c_fill,w_600,h_520,f_auto,q_auto/')
        : bgImageUrl;

    // Use selections for price if available, otherwise fall back to selectedOptionIndex
    const priceParam = (itemInfo.selections && Object.keys(itemInfo.selections).length > 0)
        ? itemInfo.selections
        : itemInfo.selectedOptionIndex;

    const price = getRecordPrice(record, priceParam);
    const tooltipContent = `
        <strong>${fields.Name || 'Untitled'}</strong><br>
        <small>${fields.Description || 'No description.'}</small><br>
        <strong>Price: $${price.toFixed(2)}</strong>
    `;
    itemCard.innerHTML = `
        <div class="card-actions">
            <button class="action-btn add-to-plan-btn" title="Add to Plan">+</button>
            <button class="action-btn remove-btn" title="Remove">×</button>
        </div>
        <div class="favorite-item-overlay"
            data-tippy-content="${tooltipContent.replace(/"/g, '&quot;')}"
        >
            <span class="favorite-item-name">${fields.Name || 'Untitled'}</span>
        </div>
    `;
    if (window.tippy) {
        tippy(itemCard.querySelector('.favorite-item-overlay'), {
            content: tooltipContent,
            allowHTML: true,
            placement: 'top',
            theme: 'light',
        });
    }
    return itemCard;
}


// --- 1. THIS FUNCTION IS REPLACED ---\
// It now receives the *full record* instead of just the ID
// It also fixes the 404 error for the partner icon
async function createLockedInItemElement(record, itemInfo) {
    const fields = record.fields;
    let isCustomItem = record.id.startsWith('custom-') || record.id.startsWith('ai-search-');
    
    // --- THIS IS THE FIX for the 404 error ---\
    // Default to your main placeholder, which we know exists
    let imageUrl = `https://res.cloudinary.com/${CONSTANTS.CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_60,h_60/ww71meppejsewxsxr4x7.jpg`;
    // --- END THE FIX ---\

    if (!isCustomItem) {
        // --- EXISTING LOGIC for real items ---\
        const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
        if (imageUrls && imageUrls.length > 0) {
            imageUrl = imageUrls[0].replace('/upload/', '/upload/c_fill,g_auto,w_60,h_60/');
        }
    }
    // If it *is* a custom item, we just use the default `imageUrl` from above

    const itemElement = document.createElement('div');
    itemElement.className = 'locked-item-card';
    itemElement.dataset.recordId = record.id;

    // Build selected options display string from either selections or legacy selectedOptionIndex
    let optionNames = [];
    if (!isCustomItem) { // Custom items don't have options
        const optionGroups = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);

        if (itemInfo.selections && Object.keys(itemInfo.selections).length > 0) {
            // New format: selections object with groupIndex -> optionIndex mapping
            const sortedKeys = Object.keys(itemInfo.selections).sort((a, b) => {
                const indexA = parseInt(a.replace('group', ''), 10) || 0;
                const indexB = parseInt(b.replace('group', ''), 10) || 0;
                return indexA - indexB;
            });

            for (const groupKey of sortedKeys) {
                const optionIndex = itemInfo.selections[groupKey];
                const groupIndexMatch = groupKey.match(/^group(\d+)$/);
                if (!groupIndexMatch) continue;

                const groupIndex = parseInt(groupIndexMatch[1], 10);
                const group = optionGroups[groupIndex];
                if (!group || !group.options) continue;

                const option = group.options[optionIndex];
                if (option && option.name) {
                    optionNames.push(option.name);
                }
            }
        } else if (itemInfo.selectedOptionIndex != null) {
            // Legacy format: single selectedOptionIndex
            const flatOptions = flattenOptionGroups(optionGroups);
            if (flatOptions[itemInfo.selectedOptionIndex]) {
                optionNames.push(flatOptions[itemInfo.selectedOptionIndex].name);
            }
        }
    }

    // Build display string: "Color: Red, Size: Large" or just "Red, Large"
    const optionDisplay = optionNames.join(', ');

    // Use selections for price if available, otherwise fall back to selectedOptionIndex
    const priceParam = (itemInfo.selections && Object.keys(itemInfo.selections).length > 0)
        ? itemInfo.selections
        : itemInfo.selectedOptionIndex;

    let price = itemInfo.overridePrice ?? getRecordPrice(record, priceParam);
    const total = (price || 0) * (itemInfo.quantity || 1);
    let priceDisplay = `$${(price || 0).toFixed(2)}`;

    if (isCustomItem && itemInfo.overridePrice == null && price > 0) {
        priceDisplay = `$${price.toFixed(2)} (Est.)`;
    }

    if (itemInfo.overridePrice != null) {
        let originalPrice = getRecordPrice(record, priceParam);
        priceDisplay = `$${price.toFixed(2)} <em class="price-original">(was $${originalPrice.toFixed(2)})</em>`;
    }

    // Calculate effective minimum and add warning if applicable
    const effectiveMin = getEffectiveMinQuantity(record);
    const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    let quantityDisplay = `Qty ${itemInfo.quantity || 1}`;

    // Check if UMW is in plan
    let isUmwInPlan = false;
    for (const [id] of state.cart.lockedItems) {
        const lockedRecord = state.records.all.find(r => r.id === id);
        if (lockedRecord && lockedRecord.fields.Name && lockedRecord.fields.Name.includes("Union Machine Works")) {
            isUmwInPlan = true;
            break;
        }
    }

    // Add warning/note for edge cases
    if (airtableMin > 1) {
        if (!isUmwInPlan && itemInfo.quantity === effectiveMin) {
            // Off-site at minimum: show asterisk with tooltip
            quantityDisplay += ` <span class="min-qty-warning" data-tippy-content="Minimum of ${effectiveMin} required for off-site events.<br><strong>Host at Union Machine Works to waive.</strong>">*</span>`;
        } else if (isUmwInPlan && itemInfo.quantity < airtableMin) {
            // On-site below minimum: show check mark with tooltip
            quantityDisplay += ` <span class="umw-benefit-indicator" data-tippy-content="Below standard minimum of ${airtableMin}<br><strong>Allowed due to Union Machine Works venue</strong>" style="color: #28a745; font-weight: bold; cursor: help; margin-left: 2px;">✓</span>`;
        }
    }

    itemElement.innerHTML = `
        <img class="locked-item-thumbnail lazy-load" data-src="${imageUrl}" width="60" height="60" alt="${fields.Name}">
        <div class="locked-item-details">
            <p class="locked-item-name">${fields.Name}</p>
            ${optionDisplay ? `<p class="locked-item-option">${optionDisplay}</p>` : ''}
            <p class="locked-item-pricing">${quantityDisplay} @ ${priceDisplay} = <strong>$${total.toFixed(2)}</strong></p>
            ${itemInfo.note ? `<p class="locked-item-note"><em>Note: ${itemInfo.note}</em></p>` : ''}
        </div>
        <div class="locked-item-actions">
            <button class="demote-locked-item-btn" title="Remove from Plan">Unsave</button>
        </div>
    `;

    // Initialize Tippy tooltip for the warning asterisk if present
    const warningSpan = itemElement.querySelector('.min-qty-warning');
    if (warningSpan && window.tippy) {
        tippy(warningSpan, {
            content: warningSpan.dataset.tippyContent,
            allowHTML: true,
            placement: 'top',
            arrow: true
        });
    }

    // Initialize Tippy tooltip for the UMW benefit indicator if present
    const benefitSpan = itemElement.querySelector('.umw-benefit-indicator');
    if (benefitSpan && window.tippy) {
        tippy(benefitSpan, {
            content: benefitSpan.dataset.tippyContent,
            allowHTML: true,
            placement: 'top',
            arrow: true
        });
    }

    return itemElement;
}
// --- END REPLACED FUNCTION ---\

// --- VVV NEW SCORE LOGIC VVV ---\

/**
 * [V3.3] Calculates and returns the total recommendation score for the entire locked plan.
 * @returns {number} The total score.
 */
function calculateTotalPlanScore() {
    if (state.cart.lockedItems.size === 0) return 0;

    const sortBy = document.getElementById('sort-by')?.value || 'recommended'; // Assume recommended if checking score
    // The goal bucket is built based on ALL goals and missing pillars.
    const goalBucket = buildGoalBucket(sortBy); 
    
    let totalScore = 0;
    
    for (const recordId of state.cart.lockedItems.keys()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            const score = calculateRecommendationScore(record, goalBucket);
            totalScore += score;
        }
    }
    return totalScore;
}


function updateTotalPlanScoreDisplay(score) {
    const container = document.getElementById('event-health-score'); // Reuse the container
    
    if (!container) return;

    let scoreEl = container.querySelector('.plan-score-display');
    
    if (score > 0) {
        if (!scoreEl) {
             scoreEl = document.createElement('h5');
             scoreEl.className = 'plan-score-display';
             scoreEl.style.cssText = 'margin: 5px 0 0 0; text-align: center; color: #007bff; font-size: 1.2em;';
             // Prepend the score above the health score text
             container.prepend(scoreEl);
        }
        // --- THIS IS THE CHANGE ---\
        scoreEl.innerHTML = `Overall Score: ${score.toFixed(0)} Points<span class='beta-tag-subtle'>Beta</span>`;
        // --- END THE CHANGE ---\
    } else if (scoreEl) {
        // If score is 0 and element exists, remove it or hide it
        scoreEl.remove();
    }
}

// --- 2. THIS FUNCTION IS REPLACED ---
let isUpdatingEventPlan = false;
let pendingEventPlanUpdate = false;

/**
 * Updates the RSVP statistics and Publish Event button for published sessions
 */
async function updateSessionPublishingControls() {
    console.log('[PUBLISH DEBUG] updateSessionPublishingControls called');
    
    // --- PERMISSION CHECK ---
    const activeStore = state.stores.all.find(s => s.id === state.ui.activeShopId);
    const currentUser = state.session.user;

    if (activeStore && currentUser) {
        const allowedUsers = activeStore.fields.PublishPermission || [];
        if (!allowedUsers.includes(currentUser.id)) {
            log('Sidebar', 'User does not have permission to publish, hiding controls.');
            return; // Exit if user is not in the allowed list
        }
    }
    // --- END PERMISSION CHECK ---

    console.log('[PUBLISH DEBUG] state.session.id:', state.session.id);

    // Remove any existing publishing controls
    const existingControls = document.getElementById('session-publishing-controls');
    if (existingControls) {
        console.log('[PUBLISH DEBUG] Removing existing controls');
        existingControls.remove();
    }

    // Only show if we have an active session
    if (!state.session.id) {
        console.log('[PUBLISH DEBUG] No active session, skipping publishing controls');
        log('Sidebar', 'No active session, skipping publishing controls');
        return;
    }

    console.log('[PUBLISH DEBUG] Active session found, proceeding to create controls');

    try {
        const session = await api.fetchSessionById(state.session.id);
        if (!session) {
            log('Sidebar', 'Could not fetch session data');
            return;
        }

        const controlsContainer = document.createElement('div');
        controlsContainer.id = 'session-publishing-controls';
        controlsContainer.style.cssText = 'margin: 15px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;';

        let controlsHTML = '';

        // Check if this session is linked to a published event
        const linkedItemId = session.fields.LinkedItem ? session.fields.LinkedItem[0] : null;

        if (linkedItemId) {
            // Session is published, show RSVP statistics
            const linkedItem = state.records.all.find(r => r.id === linkedItemId);
            if (linkedItem) {
                const rsvpYes = linkedItem.fields.RSVPs ? linkedItem.fields.RSVPs.length : 0;
                const rsvpMaybe = linkedItem.fields.RSVPMaybe ? linkedItem.fields.RSVPMaybe.length : 0;
                const rsvpNo = linkedItem.fields.RSVPNo ? linkedItem.fields.RSVPNo.length : 0;
                const totalRsvps = rsvpYes + rsvpMaybe + rsvpNo;

                controlsHTML += `
                    <div class="rsvp-statistics" style="margin-bottom: 15px;">
                        <h4 style="margin-top: 0; color: #495057; font-size: 1em;">📊 RSVP Statistics</h4>
                        <div style="display: flex; justify-content: space-between; margin: 10px 0;">
                            <div style="text-align: center; flex: 1;">
                                <div style="font-size: 1.5em; font-weight: bold; color: #28a745;">${rsvpYes}</div>
                                <div style="font-size: 0.85em; color: #6c757d;">Going</div>
                            </div>
                            <div style="text-align: center; flex: 1;">
                                <div style="font-size: 1.5em; font-weight: bold; color: #ffc107;">${rsvpMaybe}</div>
                                <div style="font-size: 0.85em; color: #6c757d;">Maybe</div>
                            </div>
                            <div style="text-align: center; flex: 1;">
                                <div style="font-size: 1.5em; font-weight: bold; color: #dc3545;">${rsvpNo}</div>
                                <div style="font-size: 0.85em; color: #6c757d;">Can't Go</div>
                            </div>
                        </div>
                        <div style="text-align: center; padding-top: 10px; border-top: 1px solid #dee2e6;">
                            <strong>Total Responses: ${totalRsvps}</strong>
                        </div>
                    </div>
                `;

                // Update button
                controlsHTML += `
                    <button id="update-published-event-btn" style="width: 100%; padding: 10px; background-color: #17a2b8; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; margin-top: 10px;">
                        🔄 Update Published Event
                    </button>
                `;
            }
        } else {
            // Session is not published, show publish button
            controlsHTML += `
                <div style="text-align: center; margin-bottom: 10px;">
                    <p style="color: #6c757d; font-size: 0.9em; margin: 0 0 10px 0;">This plan is not yet published as a public event.</p>
                </div>
                <button id="publish-event-btn" style="width: 100%; padding: 10px; background-color: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">
                    🌐 Publish as Public Event
                </button>
            `;
        }

        controlsContainer.innerHTML = controlsHTML;

        // Insert at the top of the cart container
        const cartContainer = document.getElementById('cart-items-container');
        console.log('[PUBLISH DEBUG] cartContainer found:', !!cartContainer);
        console.log('[PUBLISH DEBUG] cartContainer.parentElement found:', !!cartContainer?.parentElement);

        if (cartContainer && cartContainer.parentElement) {
            cartContainer.parentElement.insertBefore(controlsContainer, cartContainer);
            console.log('[PUBLISH DEBUG] Controls inserted into DOM');
            console.log('[PUBLISH DEBUG] Controls container HTML:', controlsContainer.innerHTML.substring(0, 200));
        } else {
            console.error('[PUBLISH DEBUG] ERROR: Could not find cart container or its parent!');
        }

        // Add event listeners for the buttons
        const publishBtn = document.getElementById('publish-event-btn');
        const updateBtn = document.getElementById('update-published-event-btn');

        console.log('[PUBLISH DEBUG] publishBtn found:', !!publishBtn);
        console.log('[PUBLISH DEBUG] updateBtn found:', !!updateBtn);

        if (publishBtn) {
            publishBtn.addEventListener('click', async () => {
                await handlePublishEvent();
            });
            console.log('[PUBLISH DEBUG] Event listener added to publish button');
        }

        if (updateBtn) {
            updateBtn.addEventListener('click', async () => {
                await handlePublishEvent();
            });
            console.log('[PUBLISH DEBUG] Event listener added to update button');
        }

        console.log('[PUBLISH DEBUG] Session publishing controls updated successfully');
        log('Sidebar', 'Session publishing controls updated');
    } catch (error) {
        console.error('[PUBLISH DEBUG] ERROR in updateSessionPublishingControls:', error);
        console.error('Error updating session publishing controls:', error);
    }
}

/**
 * Handles publishing or updating a session as a public event
 */
async function handlePublishEvent() {
    if (!state.session.id) {
        alert('No active session to publish');
        return;
    }

    try {
        // Gather event data from session details
        const rawDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
        console.log('[PUBLISH DEBUG - Sidebar] Raw date from state:', rawDate);
        console.log('[PUBLISH DEBUG - Sidebar] Raw date type:', typeof rawDate);

        const eventData = {
            Name: state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Untitled Event',
            Date: rawDate,
            Goals: state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS),
            GuestCount: state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT)
        };

        console.log('[PUBLISH DEBUG - Sidebar] Complete eventData object:', eventData);
        log('Sidebar', `Publishing session ${state.session.id} as event with data:`, eventData);

        // Disable the button to prevent double-clicks
        const publishBtn = document.getElementById('publish-event-btn');
        const updateBtn = document.getElementById('update-published-event-btn');
        if (publishBtn) {
            publishBtn.disabled = true;
            publishBtn.textContent = 'Publishing...';
        }
        if (updateBtn) {
            updateBtn.disabled = true;
            updateBtn.textContent = 'Updating...';
        }

        // Call the API to publish/update
        const result = await api.publishSessionAsEvent(state.session.id, eventData);

        log('Sidebar', 'Event published/updated successfully:', result);
        alert('Event published successfully! It will now appear in the catalog.');

        // Reload to show updated RSVP stats
        await updateSessionPublishingControls();

    } catch (error) {
        console.error('Error publishing event:', error);
        alert(`Failed to publish event: ${error.message}`);

        // Re-enable the button
        const publishBtn = document.getElementById('publish-event-btn');
        const updateBtn = document.getElementById('update-published-event-btn');
        if (publishBtn) {
            publishBtn.disabled = false;
            publishBtn.textContent = '🌐 Publish as Public Event';
        }
        if (updateBtn) {
            updateBtn.disabled = false;
            updateBtn.textContent = '🔄 Update Published Event';
        }
    }
}

export async function updateEventPlanSection() {
    console.log('[PUBLISH DEBUG] ========== updateEventPlanSection CALLED ==========');
    console.log('[PUBLISH DEBUG] state.session.id at entry:', state.session.id);
    console.log('[PUBLISH DEBUG] state.cart.lockedItems.size:', state.cart.lockedItems.size);

    // If already updating, mark that another update is needed and return
    if (isUpdatingEventPlan) {
        pendingEventPlanUpdate = true;
        log('Sidebar', 'Event plan update already in progress, will retry after completion.');
        console.log('[PUBLISH DEBUG] Already updating, will retry later');
        return;
    }

    isUpdatingEventPlan = true;
    pendingEventPlanUpdate = false;

    try {
        log('Sidebar', 'Updating event plan panel.');
        const container = document.getElementById('cart-items-container');
        if (!container) {
            console.log('[PUBLISH DEBUG] ERROR: cart-items-container not found!');
            return;
        }

        // Clear container to prevent duplicates
        container.innerHTML = '';

        // Check if this session is published and display RSVP stats + Publish button
        console.log('[PUBLISH DEBUG] About to call updateSessionPublishingControls');
        await updateSessionPublishingControls();
        await updateInviteControls(); // <-- Added Invite Controls
        console.log('[PUBLISH DEBUG] updateSessionPublishingControls completed');

        if (state.cart.lockedItems.size === 0) {
            container.innerHTML = `<p style="font-size: 0.9em; color: #6c757d;">No items locked in yet.</p>`;
        } else {
            // Create a document fragment to batch DOM updates
            const fragment = document.createDocumentFragment();

            for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
                // Find the record in state.records.all or state.records.archive (for ghost items)
                let record = state.records.all.find(r => r.id === recordId);
                if (!record) {
                    record = state.records.archive.find(r => r.id === recordId);
                }

                if (record) {
                    const itemElement = await createLockedInItemElement(record, itemInfo); // Pass the full record
                    fragment.appendChild(itemElement);
                } else {
                    log('Sidebar', `Could not render item ${recordId}, not found in state.records.all or archive.`);
                }
            }

            // Append all items at once to minimize reflows
            container.appendChild(fragment);
        }

        ui.observeLazyImages(container);

        updateEventHealthScore(); // --- ADDED THIS LINE ---
        updateTotalPlanScoreDisplay(calculateTotalPlanScore()); // --- ADDED THIS LINE ---
    } finally {
        isUpdatingEventPlan = false;

        // If another update was requested while we were updating, run it now
        if (pendingEventPlanUpdate) {
            log('Sidebar', 'Running pending event plan update.');
            updateEventPlanSection();
        }
    }
}
// --- END REPLACED FUNCTION ---

async function handleInvite() {
    const nameInput = document.getElementById('collab-name');
    const emailInput = document.getElementById('collab-email');
    const statusEl = document.getElementById('invite-status');
    const btn = document.getElementById('invite-btn');

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();

    if (!name || !email) {
        statusEl.textContent = "Please enter both name and email.";
        statusEl.style.color = "#dc3545"; // Bootstrap danger red
        return;
    }

    btn.disabled = true;
    btn.textContent = "Sending...";
    statusEl.textContent = "";

    try {
        // Generate summary HTML
        let summaryHtml = `
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <thead>
                    <tr style="background-color: #f8f9fa; text-align: left;">
                        <th style="padding: 8px; border-bottom: 2px solid #dee2e6;">Item</th>
                        <th style="padding: 8px; border-bottom: 2px solid #dee2e6; text-align: center;">Qty</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        state.cart.lockedItems.forEach((info, id) => {
            const record = state.records.all.find(r => r.id === id);
            if (record) {
                summaryHtml += `
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${record.fields.Name}</strong></td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${info.quantity || 1}</td>
                    </tr>
                `;
            }
        });
        summaryHtml += '</tbody></table>';

        const inviterName = state.session.user.name || "A friend";

        const response = await fetch('/api/invite-collaborator', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eventId: state.session.id,
                collaboratorName: name,
                collaboratorEmail: email,
                inviterName: inviterName,
                planSummaryHtml: summaryHtml
            })
        });

        if (response.ok) {
            statusEl.textContent = "Invitation sent!";
            statusEl.style.color = "#28a745"; // Bootstrap success green
            nameInput.value = '';
            emailInput.value = '';
            setTimeout(() => {
                 statusEl.textContent = "";
                 btn.textContent = "Send Invite";
                 btn.disabled = false;
            }, 3000);
        } else {
            const err = await response.json();
            throw new Error(err.error || 'Failed to send');
        }
    } catch (e) {
        console.error(e);
        statusEl.textContent = "Error sending invite.";
        statusEl.style.color = "#dc3545";
        btn.textContent = "Send Invite";
        btn.disabled = false;
    }
}

async function updateInviteControls() {
    // Locate the container for the event plan items
    const container = document.getElementById('cart-items-container');
    if (!container || !container.parentElement) return;

    let inviteSection = document.getElementById('invite-collaborator-section');
    
    // If we have a session but no invite section, create it
    if (state.session.id && !inviteSection) {
        inviteSection = document.createElement('div');
        inviteSection.id = 'invite-collaborator-section';
        inviteSection.style.cssText = 'margin: 15px 0; padding: 15px; background-color: #f0f8ff; border-radius: 5px; border: 1px solid #cce5ff;';
        
        // Insert it after the "Publish" controls if they exist, or before cart items container
        const publishingControls = document.getElementById('session-publishing-controls');
        if (publishingControls) {
             publishingControls.insertAdjacentElement('afterend', inviteSection);
        } else {
             container.parentElement.insertBefore(inviteSection, container);
        }

        inviteSection.innerHTML = `
            <h4 style="margin-top: 0; color: #0056b3; font-size: 1em; display: flex; align-items: center; gap: 5px;">💌 Invite Collaborator</h4>
            <p style="font-size: 0.85em; color: #666; margin-bottom: 10px; margin-top: 5px;">Share this plan with a friend.</p>
            <div style="display: flex; gap: 5px; margin-bottom: 5px;">
                <input type="text" id="collab-name" placeholder="Friend's Name" style="flex: 1; padding: 8px; border: 1px solid #ced4da; border-radius: 4px; font-size: 0.9em;">
            </div>
            <div style="display: flex; gap: 5px; margin-bottom: 10px;">
                <input type="email" id="collab-email" placeholder="Friend's Email" style="flex: 1; padding: 8px; border: 1px solid #ced4da; border-radius: 4px; font-size: 0.9em;">
            </div>
            <button id="invite-btn" style="width: 100%; padding: 8px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.9em; transition: background-color 0.2s;">Send Invite</button>
            <div id="invite-status" style="font-size: 0.85em; margin-top: 5px; text-align: center; min-height: 1.2em;"></div>
        `;
        
        // Add hover effect to button
        const btn = inviteSection.querySelector('#invite-btn');
        btn.onmouseover = () => btn.style.backgroundColor = "#0056b3";
        btn.onmouseout = () => btn.style.backgroundColor = "#007bff";
        
        btn.addEventListener('click', handleInvite);
    } else if (!state.session.id && inviteSection) {
        // If no session (e.g. logged out/cleared?), remove it
        inviteSection.remove();
    }
}


/**
 * Verifies that items in the event plan panel are not duplicated
 * This function checks the DOM and logs warnings if duplicates are found
 */
export function verifyNoDuplicateItems() {
    const container = document.getElementById('cart-items-container');
    if (!container) return;

    const itemElements = container.querySelectorAll('.locked-item-card[data-record-id]');
    const seenIds = new Set();
    const duplicates = [];

    itemElements.forEach(element => {
        const recordId = element.dataset.recordId;
        if (seenIds.has(recordId)) {
            duplicates.push(recordId);
            log('Sidebar', `WARNING: Duplicate item found in event plan panel: ${recordId}`);
            // Remove the duplicate element
            element.remove();
        } else {
            seenIds.add(recordId);
        }
    });

    if (duplicates.length > 0) {
        log('Sidebar', `Removed ${duplicates.length} duplicate items from event plan panel`);
        return duplicates;
    } else {
        log('Sidebar', 'Event plan panel verification: No duplicates found');
        return [];
    }
}

export async function updateIdeasCarousel() { 
    log('Sidebar', `Updating ideas carousel with ${state.cart.items.size} items.`);
    const ideasSection = document.getElementById('favorites-section');
    const ideasCarousel = document.getElementById('favorites-carousel');
    if (!ideasSection || !ideasCarousel) return;

    if (state.cart.items.size === 0) {
        ideasSection.style.display = 'none';
        return;
    }
    ideasSection.style.display = 'block';
    ideasCarousel.innerHTML = '';
    const imageCache = new Map();

    for (const [recordId, itemInfo] of state.cart.items.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            try {
                const card = await createFavoriteCardElement(record, itemInfo, imageCache);
                if (card) ideasCarousel.appendChild(card);
            } catch (error) {
                console.error(`Failed to create idea card for ${record.fields.Name}:`, error);
            }
        }
    }
    
    if (typeof ui !== 'undefined' && ui.observeLazyImages) {
         ui.observeLazyImages(ideasCarousel);
    } else {
         console.warn("ui.observeLazyImages not found during carousel update.");
    }
}

export function updateHeader() {
    console.log('[DEBUG updateHeader] ========== HEADER UPDATE DEBUG ==========');
    console.log('[DEBUG updateHeader] state.eventDetails.combined contents:', Object.fromEntries(state.eventDetails.combined));
    console.log('[DEBUG updateHeader] CONSTANTS.DETAIL_TYPES.EVENT_NAME:', CONSTANTS.DETAIL_TYPES.EVENT_NAME);
    console.log('[DEBUG updateHeader] CONSTANTS.DETAIL_TYPES.GOALS:', CONSTANTS.DETAIL_TYPES.GOALS);

    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    console.log('[DEBUG updateHeader] Retrieved eventName:', eventName);

    const activeShop = state.stores.all.find(s => s.id === state.ui.activeShopId);
    const shopName = activeShop?.fields?.Name || '';
    document.title = eventName || (shopName ? `WTFun ${shopName}` : 'WTFun');
    const eventNameInput = document.getElementById('header-event-name');
    if (eventNameInput) {
        console.log('[DEBUG updateHeader] Setting header-event-name input to:', eventName);
        eventNameInput.value = eventName;
    } else {
        console.log('[DEBUG updateHeader] WARNING: header-event-name input NOT found!');
    }

    const goalsInput = document.getElementById('header-goals');
    const goalsValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
    console.log('[DEBUG updateHeader] Retrieved goals:', goalsValue);
    if(goalsInput) {
        console.log('[DEBUG updateHeader] Setting header-goals input to:', goalsValue);
        goalsInput.value = goalsValue;
    } else {
        console.log('[DEBUG updateHeader] WARNING: header-goals input NOT found!');
    }
    console.log('[DEBUG updateHeader] ========== END HEADER UPDATE DEBUG ==========');
}

// In: components/sidebar.js
// Action: REPLACE the entire `updateEventHealthScore` function

/**
 * [v1.2] Updates the Plan Health UI in the sidebar with the score and actionable suggestions.
 */
export function updateEventHealthScore() {
    const container = document.getElementById('event-health-score');
    if (!container) return;
    
    const suggestions = calculateMissingCategories();
    const score = 4 - suggestions.length; // Based on 4 pillars
    let html = '';

    // 1. The "Score"
    let scoreText = '🟠 Good Start!';
    let scoreColor = '#fd7e14';
    if (score === 4) {
        scoreText = '✅ Well-Rounded Event!';
        scoreColor = '#28a745';
    } else if (score === 1) {
        scoreText = '🔴 Just Beginning!';
        scoreColor = '#dc3545';
    } else if (score === 0) { // New "Empty" state
        scoreText = 'Start Your Plan!';
        scoreColor = '#6c757d'; // Neutral gray
    } else if (score === 2) {
        scoreText = '🟡 Growing!';
        scoreColor = '#ffc107';
    }

    // --- THIS IS THE FIX (Removed \") ---
    html += `<h5 style="margin: 0 0 5px 0; text-align: center; color: ${scoreColor};">Plan Health: ${scoreText} <span class='beta-tag-subtle'>Beta</span></h5>`;
    // --- END THE FIX ---

    // 2. The "Suggestions"
    if (suggestions.length > 0) {
        // --- THIS IS THE FIX (Removed \") ---
        html += `<p style="font-size: 0.9em; margin: 0; text-align: center;">
            Our experts recommend adding these components for a full experience:
        </p>`;
        
        // Create clickable "suggestion" buttons
        html += `<div style="display: flex; gap: 5px; margin-top: 10px; justify-content: center; flex-wrap: wrap;">`;
        suggestions.forEach(cat => {
            // The display name is the exact key from calculateMissingCategories (e.g., "Food & Drink")
            const displayName = cat; 
            
            // --- VVV FINAL, ROBUST FILTER TAG GENERATION VVV ---
            // Normalize the filter tag consistently with the rest of the app
            let filterTag = displayName.toLowerCase().replace(/\s+/g, ' ');
            // --- ^^^ END FINAL, ROBUST FILTER TAG GENERATION ^^^ ---
            
            // --- THIS IS THE FIX (Removed \") ---
            html += `<button class="filter-btn health-suggestion-btn" data-category-filter="${filterTag}">
                + Add ${displayName}
            </button>`;
        });
        html += `</div>`;
    } else {
        // --- THIS IS THE FIX (Removed \") ---
        html += `<p style="font-size: 0.9em; margin: 0; text-align: center; color: #28a745;">
            You've covered all the core components for a great guest experience!
        </p>`;
    }

    container.innerHTML = html;
}

export function updateTotalCost() {
    const subtotalCostEl = document.getElementById('subtotal-cost');
    const amountPaidCostEl = document.getElementById('amount-paid-cost');
    const amountPaidRowEl = document.querySelector('.amount-paid-row');
    const totalDividerEl = document.querySelector('.total-divider');
    const totalCostEl = document.getElementById('total-cost');
    const checkoutBtn = document.getElementById('checkout-btn');
    const saveShareBtn = document.getElementById('save-share-btn');
    const mobileItemCountEl = document.getElementById('mobile-bar-item-count');
    const mobileTotalCostEl = document.getElementById('mobile-bar-total-cost');
    const statusMessageEl = document.getElementById('payment-status-message'); // Get new element
    if (statusMessageEl) statusMessageEl.innerHTML = ''; // Clear status on each run

    if (!totalCostEl || !subtotalCostEl) return;

    let subtotal = 0;
    state.cart.lockedItems.forEach((itemInfo, recordId) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) return;

        // Use selections for price if available, otherwise fall back to selectedOptionIndex
        const priceParam = (itemInfo.selections && Object.keys(itemInfo.selections).length > 0)
            ? itemInfo.selections
            : itemInfo.selectedOptionIndex;

        const unitPrice = itemInfo.overridePrice ?? getRecordPrice(record, priceParam);
        if (isNaN(unitPrice)) return;

        // Custom items don't have a min headcount, so default to 1
        const minHeadcount = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        // Use itemInfo.quantity for all items
        const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, 1);
        
        subtotal += unitPrice * effectiveQuantity;
    });
    
    const amountReceived = state.session.user.amountReceived || 0;
    const totalDue = subtotal - amountReceived;
    
    subtotalCostEl.textContent = `$${subtotal.toFixed(2)}`;
    totalCostEl.textContent = `$${totalDue.toFixed(2)}`;
    
    if (typeof backgroundEngine.updateColors === 'function') {
        backgroundEngine.updateColors();
    }
    
    if (amountReceived > 0) {
        const paymentHistory = state.session.user.paymentHistory || [];
        
        if (paymentHistory.length === 1) {
            amountPaidCostEl.innerHTML = `<a href="#" class="receipt-link" data-payment-index="0" title="View Receipt">-$${amountReceived.toFixed(2)}</a>`;
        } else if (paymentHistory.length > 1) {
            // Sort payments by date (oldest first) and create index mapping
            const sortedPayments = paymentHistory
                .map((payment, originalIndex) => ({ ...payment, originalIndex }))
                .sort((a, b) => new Date(a.date) - new Date(b.date));
            
            let paymentsHtml = '<div class="multiple-payments">';
            sortedPayments.forEach((payment, displayIndex) => {
                paymentsHtml += `<div class="payment-item">
                    <a href="#" class="receipt-link" data-payment-index="${payment.originalIndex}" title="View Receipt #${displayIndex + 1}">
                        Payment ${displayIndex + 1}: -$${payment.amount.toFixed(2)}
                    </a>
                </div>`;
            });
            paymentsHtml += '</div>';
            amountPaidCostEl.innerHTML = paymentsHtml;
        } else {
            amountPaidCostEl.textContent = `-$${amountReceived.toFixed(2)}`;
        }
        
        amountPaidRowEl.style.display = 'flex';
        totalDividerEl.style.display = 'block';
    } else {
        amountPaidRowEl.style.display = 'none';
        totalDividerEl.style.display = 'none';
    }

    if (mobileItemCountEl && mobileTotalCostEl) {
        const itemCount = state.cart.lockedItems.size;
        mobileItemCountEl.textContent = `${itemCount} item${itemCount !== 1 ? 's' : ''}`;
        mobileTotalCostEl.textContent = `$${totalDue.toFixed(2)}`;
    }

    const isPlanEmpty = subtotal === 0;
    // Only consider fully paid if amount has actually been received
    const isFullyPaid = totalDue <= 0.009 && amountReceived > 0;

    if (isPlanEmpty || isFullyPaid) {
        document.body.classList.remove('mobile-bar-active');
    } else {
        document.body.classList.add('mobile-bar-active');
    }

    if (checkoutBtn) {
        checkoutBtn.style.display = 'block';
        document.getElementById('total-breakdown').style.display = 'block';

        if (isFullyPaid) {
            // --- THIS BLOCK IS MODIFIED (and fixed) ---
            checkoutBtn.textContent = 'View Receipt';
            checkoutBtn.disabled = false;
            if (statusMessageEl) {
                statusMessageEl.innerHTML = '<span style="color: #28a745; font-weight: bold; font-size: 1.2em; text-align: center; display: block; margin-bottom: 10px;">✅ Paid in Full</span>';
            }
            // --- END MODIFICATION ---
        } else if (amountReceived > 0) {
            checkoutBtn.textContent = 'Pay Remainder';
            checkoutBtn.disabled = isPlanEmpty;
        } else {
            checkoutBtn.textContent = checkoutBtn.dataset.defaultText || 'Reserve';
            // --- THIS IS THE FIX ---
            checkoutBtn.disabled = isPlanEmpty; // Was `isVIRTUAL_PAD_FINGERPRINT_VENDOR`
            // --- END THE FIX ---
        }
    }
    if (saveShareBtn) {
        saveShareBtn.disabled = isPlanEmpty && state.ui.saveState !== 'SAVING';
    }

    updateEventHealthScore(); // --- ADDED THIS LINE ---
    updateTotalPlanScoreDisplay(calculateTotalPlanScore()); // V3.3: Call to display total score
}


export function displayReservedStatus() {
    const checkoutBtn = document.getElementById('checkout-btn');
    const saveShareBtn = document.getElementById('save-share-btn');
    const statusMessageEl = document.getElementById('payment-status-message'); // Get new element
    
    if (statusMessageEl) {
        // --- THIS IS THE FIX (Removed \\\" ) ---
        statusMessageEl.innerHTML = '<span style="color: #28a745; font-weight: bold; font-size: 1.2em; text-align: center; display: block; margin-bottom: 10px;">✅ Event Reserved</span>';
    }
    if (checkoutBtn) {
        // Change text and ensure it's visible
        checkoutBtn.style.display = 'block';
        checkoutBtn.textContent = 'View Receipt';
        checkoutBtn.disabled = false;
    }
    if (saveShareBtn) {
        saveShareBtn.disabled = false;
    }
}
