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
        <img class="locked-item-thumbnail lazy-load" data-src="${imageUrl}" width="60" height="60" alt="${fields.Name}" loading="lazy">
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
let shareMenuInitialized = false;

/**
 * Initializes the Share menu button event listeners (called once)
 */
export function initializeShareMenu() {
    if (shareMenuInitialized) return;

    const shareMenuBtn = document.getElementById('share-menu-btn');
    const shareMenuDropdown = document.getElementById('share-menu-dropdown');
    const shareCopyLinkBtn = document.getElementById('share-copy-link-btn');
    const shareInviteBtn = document.getElementById('share-invite-btn');
    const sharePublishBtn = document.getElementById('share-publish-btn');
    const shareUpdatePublishedBtn = document.getElementById('share-update-published-btn');

    if (!shareMenuBtn || !shareMenuDropdown) {
        console.warn('[Share Menu] Share menu elements not found');
        return;
    }

    // Toggle dropdown on button click
    shareMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = shareMenuDropdown.style.display === 'block';
        shareMenuDropdown.style.display = isVisible ? 'none' : 'block';
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!shareMenuBtn.contains(e.target) && !shareMenuDropdown.contains(e.target)) {
            shareMenuDropdown.style.display = 'none';
        }
    });

    // Copy Link handler
    if (shareCopyLinkBtn) {
        shareCopyLinkBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(window.location.href).then(() => {
                const originalHTML = shareCopyLinkBtn.innerHTML;
                shareCopyLinkBtn.innerHTML = '<span class="share-item-icon">&#10003;</span> Copied!';
                setTimeout(() => {
                    shareCopyLinkBtn.innerHTML = originalHTML;
                }, 1500);
            }).catch(err => {
                console.error('Failed to copy link:', err);
            });
            shareMenuDropdown.style.display = 'none';
        });
    }

    // Invite Collaborator handler - opens the invite popup
    if (shareInviteBtn) {
        shareInviteBtn.addEventListener('click', () => {
            shareMenuDropdown.style.display = 'none';
            openInvitePopup();
        });
    }

    // Invite Guest handler - opens the guest invite popup
    const shareInviteGuestBtn = document.getElementById('share-invite-guest-btn');
    if (shareInviteGuestBtn) {
        shareInviteGuestBtn.addEventListener('click', () => {
            shareMenuDropdown.style.display = 'none';
            openInviteGuestPopup();
        });
    }

    // Publish as Public Event handler
    if (sharePublishBtn) {
        sharePublishBtn.addEventListener('click', async () => {
            shareMenuDropdown.style.display = 'none';
            await handlePublishEvent();
        });
    }

    // Update Published Event handler
    if (shareUpdatePublishedBtn) {
        shareUpdatePublishedBtn.addEventListener('click', async () => {
            shareMenuDropdown.style.display = 'none';
            await handlePublishEvent();
        });
    }

    // Publish as Package handler
    const sharePublishPackageBtn = document.getElementById('share-publish-package-btn');
    if (sharePublishPackageBtn) {
        sharePublishPackageBtn.addEventListener('click', async () => {
            shareMenuDropdown.style.display = 'none';
            await handlePublishPackage();
        });
    }

    // Update Package handler
    const shareUpdatePackageBtn = document.getElementById('share-update-package-btn');
    if (shareUpdatePackageBtn) {
        shareUpdatePackageBtn.addEventListener('click', async () => {
            shareMenuDropdown.style.display = 'none';
            await handlePublishPackage();
        });
    }

    shareMenuInitialized = true;
    log('Sidebar', 'Share menu initialized');
}

let invitePopupInitialized = false;

/**
 * Opens the invite collaborator popup
 */
function openInvitePopup() {
    const popup = document.getElementById('invite-popup');
    if (!popup) return;

    // Initialize popup event listeners if not done
    initializeInvitePopup();

    // Show the popup
    popup.style.display = 'block';

    // Clear any previous inputs and status
    const nameInput = document.getElementById('collab-name');
    const emailInput = document.getElementById('collab-email');
    const statusEl = document.getElementById('invite-status');
    const btn = document.getElementById('invite-btn');

    if (nameInput) nameInput.value = '';
    if (emailInput) emailInput.value = '';
    if (statusEl) statusEl.textContent = '';
    if (btn) {
        btn.textContent = 'Send Invite';
        btn.disabled = false;
    }

    // Focus on the name input
    if (nameInput) nameInput.focus();
}

/**
 * Closes the invite collaborator popup
 */
function closeInvitePopup() {
    const popup = document.getElementById('invite-popup');
    if (popup) {
        popup.style.display = 'none';
    }
}

/**
 * Initializes the invite popup event listeners (called once)
 */
function initializeInvitePopup() {
    if (invitePopupInitialized) return;

    const popup = document.getElementById('invite-popup');
    const closeBtn = document.getElementById('invite-popup-close');
    const inviteBtn = document.getElementById('invite-btn');

    if (!popup) return;

    // Close button handler
    if (closeBtn) {
        closeBtn.addEventListener('click', closeInvitePopup);
    }

    // Close when clicking outside the popup (on the container)
    document.addEventListener('click', (e) => {
        if (popup.style.display === 'block' &&
            !popup.contains(e.target) &&
            !document.getElementById('share-invite-btn')?.contains(e.target)) {
            closeInvitePopup();
        }
    });

    // Invite button handler
    if (inviteBtn) {
        inviteBtn.addEventListener('click', async () => {
            await handleInvite();
        });
    }

    // Allow Enter key to submit
    popup.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleInvite();
        }
    });

    invitePopupInitialized = true;
    log('Sidebar', 'Invite popup initialized');
}

let inviteGuestPopupInitialized = false;

/**
 * Opens the invite guest popup
 */
function openInviteGuestPopup() {
    const popup = document.getElementById('invite-guest-popup');
    if (!popup) return;

    // Initialize popup event listeners if not done
    initializeInviteGuestPopup();

    // Show the popup
    popup.style.display = 'block';

    // Clear any previous inputs and status
    const nameInput = document.getElementById('guest-name');
    const emailInput = document.getElementById('guest-email');
    const statusEl = document.getElementById('invite-guest-status');
    const btn = document.getElementById('invite-guest-btn');

    if (nameInput) nameInput.value = '';
    if (emailInput) emailInput.value = '';
    if (statusEl) statusEl.textContent = '';
    if (btn) {
        btn.textContent = 'Send Invitation';
        btn.disabled = false;
    }

    // Focus on the name input
    if (nameInput) nameInput.focus();
}

/**
 * Closes the invite guest popup
 */
function closeInviteGuestPopup() {
    const popup = document.getElementById('invite-guest-popup');
    if (popup) {
        popup.style.display = 'none';
    }
}

/**
 * Initializes the invite guest popup event listeners (called once)
 */
function initializeInviteGuestPopup() {
    if (inviteGuestPopupInitialized) return;

    const popup = document.getElementById('invite-guest-popup');
    const closeBtn = document.getElementById('invite-guest-popup-close');
    const inviteBtn = document.getElementById('invite-guest-btn');

    if (!popup) return;

    // Close button handler
    if (closeBtn) {
        closeBtn.addEventListener('click', closeInviteGuestPopup);
    }

    // Close when clicking outside the popup (on the container)
    document.addEventListener('click', (e) => {
        if (popup.style.display === 'block' &&
            !popup.contains(e.target) &&
            !document.getElementById('share-invite-guest-btn')?.contains(e.target)) {
            closeInviteGuestPopup();
        }
    });

    // Invite button handler
    if (inviteBtn) {
        inviteBtn.addEventListener('click', async () => {
            await handleInviteGuest();
        });
    }

    // Allow Enter key to submit
    popup.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleInviteGuest();
        }
    });

    inviteGuestPopupInitialized = true;
    log('Sidebar', 'Invite guest popup initialized');
}

/**
 * Handles sending a guest invitation (read-only view)
 */
async function handleInviteGuest() {
    const nameInput = document.getElementById('guest-name');
    const emailInput = document.getElementById('guest-email');
    const statusEl = document.getElementById('invite-guest-status');
    const btn = document.getElementById('invite-guest-btn');

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();

    if (!name || !email) {
        statusEl.textContent = "Please enter both name and email.";
        statusEl.style.color = "#dc3545";
        return;
    }

    btn.disabled = true;
    btn.textContent = "Sending...";
    statusEl.textContent = "";

    try {
        // Generate summary HTML for the guest invitation
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

        // Get event details for the invitation
        const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Event';
        const eventDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
        const hostName = state.session.user?.name || "Your host";

        const response = await fetch('/api/invite-guest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: state.session.id,
                guestName: name,
                guestEmail: email,
                hostName: hostName,
                eventName: eventName,
                eventDate: eventDate,
                planSummaryHtml: summaryHtml
            })
        });

        if (response.ok) {
            statusEl.textContent = "Invitation sent!";
            statusEl.style.color = "#28a745";
            nameInput.value = '';
            emailInput.value = '';
            // Close the popup after showing success message
            setTimeout(() => {
                closeInviteGuestPopup();
                statusEl.textContent = "";
                btn.textContent = "Send Invitation";
                btn.disabled = false;
            }, 1500);
        } else {
            const err = await response.json();
            throw new Error(err.error || 'Failed to send');
        }
    } catch (e) {
        console.error(e);
        statusEl.textContent = "Error sending invitation.";
        statusEl.style.color = "#dc3545";
        btn.textContent = "Send Invitation";
        btn.disabled = false;
    }
}

/**
 * Updates the Share menu button visibility and options based on session state
 */
async function updateShareMenuState() {
    const shareMenuBtn = document.getElementById('share-menu-btn');
    const shareMenuDropdown = document.getElementById('share-menu-dropdown');
    const sharePublishBtn = document.getElementById('share-publish-btn');
    const shareUpdatePublishedBtn = document.getElementById('share-update-published-btn');
    const sharePublishPackageBtn = document.getElementById('share-publish-package-btn');
    const shareUpdatePackageBtn = document.getElementById('share-update-package-btn');
    const shareDivider = shareMenuDropdown?.querySelector('.share-dropdown-divider');

    if (!shareMenuBtn) return;

    // Show the share button only if we have an active session
    if (!state.session.id) {
        shareMenuBtn.style.display = 'none';
        return;
    }

    // Show the share button
    shareMenuBtn.style.display = 'flex';

    // Initialize the menu if not already done
    initializeShareMenu();

    // Check publish permissions
    const activeStore = state.stores.all.find(s => s.id === state.ui.activeShopId);
    const currentUser = state.session.user;
    let hasPublishPermission = false;

    if (activeStore && currentUser) {
        const allowedUsers = activeStore.fields.PublishPermission || [];
        hasPublishPermission = allowedUsers.includes(currentUser.id);
    }

    // Update publish/update buttons visibility based on permissions
    if (!hasPublishPermission) {
        if (sharePublishBtn) sharePublishBtn.style.display = 'none';
        if (shareUpdatePublishedBtn) shareUpdatePublishedBtn.style.display = 'none';
        if (sharePublishPackageBtn) sharePublishPackageBtn.style.display = 'none';
        if (shareUpdatePackageBtn) shareUpdatePackageBtn.style.display = 'none';
        if (shareDivider) shareDivider.style.display = 'none';
        return;
    }

    // Show the divider since we have publish permissions
    if (shareDivider) shareDivider.style.display = 'block';

    try {
        const session = await api.fetchSessionById(state.session.id);
        if (!session) return;

        // Check if this session is linked to a published event
        const linkedItemId = session.fields.LinkedItem ? session.fields.LinkedItem[0] : null;
        // Check if this session is linked to a published package
        const linkedPackageId = session.fields.LinkedPackage ? session.fields.LinkedPackage[0] : null;

        // Handle event publish/update buttons
        if (linkedItemId) {
            // Session is published as event - show update button, hide publish button
            if (sharePublishBtn) sharePublishBtn.style.display = 'none';
            if (shareUpdatePublishedBtn) {
                shareUpdatePublishedBtn.style.display = 'flex';

                // Update RSVP stats in dropdown if event is published
                const linkedItem = state.records.all.find(r => r.id === linkedItemId);
                if (linkedItem) {
                    updateShareMenuRsvpStats(linkedItem);
                }
            }
        } else {
            // Session is not published as event - show publish button, hide update button
            if (sharePublishBtn) sharePublishBtn.style.display = 'flex';
            if (shareUpdatePublishedBtn) shareUpdatePublishedBtn.style.display = 'none';

            // Remove any RSVP stats section
            const existingRsvpStats = shareMenuDropdown?.querySelector('.share-rsvp-stats');
            if (existingRsvpStats) existingRsvpStats.remove();
        }

        // Handle package publish/update buttons
        if (linkedPackageId) {
            // Session is published as package - show update button, hide publish button
            if (sharePublishPackageBtn) sharePublishPackageBtn.style.display = 'none';
            if (shareUpdatePackageBtn) shareUpdatePackageBtn.style.display = 'flex';
        } else {
            // Session is not published as package - show publish button if has items, hide update button
            if (sharePublishPackageBtn) {
                // Only show if session has locked items
                sharePublishPackageBtn.style.display = state.cart.lockedItems.size > 0 ? 'flex' : 'none';
            }
            if (shareUpdatePackageBtn) shareUpdatePackageBtn.style.display = 'none';
        }

        log('Sidebar', 'Share menu state updated');
    } catch (error) {
        console.error('Error updating share menu state:', error);
    }
}

/**
 * Updates the RSVP statistics display in the share dropdown
 */
function updateShareMenuRsvpStats(linkedItem) {
    const shareMenuDropdown = document.getElementById('share-menu-dropdown');
    if (!shareMenuDropdown || !linkedItem) return;

    const rsvpYes = linkedItem.fields.RSVPs ? linkedItem.fields.RSVPs.length : 0;
    const rsvpMaybe = linkedItem.fields.RSVPMaybe ? linkedItem.fields.RSVPMaybe.length : 0;
    const rsvpNo = linkedItem.fields.RSVPNo ? linkedItem.fields.RSVPNo.length : 0;

    // Remove existing RSVP stats if present
    const existingRsvpStats = shareMenuDropdown.querySelector('.share-rsvp-stats');
    if (existingRsvpStats) existingRsvpStats.remove();

    // Create new RSVP stats section
    const rsvpStatsHTML = `
        <div class="share-rsvp-stats">
            <h5>RSVP Statistics</h5>
            <div class="share-rsvp-row">
                <div class="share-rsvp-item">
                    <span class="share-rsvp-count going">${rsvpYes}</span>
                    <span class="share-rsvp-label">Going</span>
                </div>
                <div class="share-rsvp-item">
                    <span class="share-rsvp-count maybe">${rsvpMaybe}</span>
                    <span class="share-rsvp-label">Maybe</span>
                </div>
                <div class="share-rsvp-item">
                    <span class="share-rsvp-count no">${rsvpNo}</span>
                    <span class="share-rsvp-label">Can't Go</span>
                </div>
            </div>
        </div>
    `;

    // Insert at the beginning of the dropdown
    shareMenuDropdown.insertAdjacentHTML('afterbegin', rsvpStatsHTML);
}

/**
 * Legacy function - now updates the share menu instead of creating inline controls
 * Keeping the name for backwards compatibility with existing calls
 */
async function updateSessionPublishingControls() {
    // Remove any legacy publishing controls if they exist
    const existingControls = document.getElementById('session-publishing-controls');
    if (existingControls) {
        existingControls.remove();
    }

    // Update the share menu state instead
    await updateShareMenuState();
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

/**
 * Handles publishing or updating a session as a reusable Package (Decision 5 - Option B)
 */
async function handlePublishPackage() {
    console.log('[SIDEBAR PACKAGE DEBUG] ========== handlePublishPackage CALLED ==========');
    console.log('[SIDEBAR PACKAGE DEBUG] state.session.id:', state.session.id);
    console.log('[SIDEBAR PACKAGE DEBUG] state.cart.lockedItems.size:', state.cart.lockedItems.size);

    if (!state.session.id) {
        console.error('[SIDEBAR PACKAGE DEBUG] No active session to publish');
        alert('No active session to publish as package');
        return;
    }

    // Check if session has items to package
    if (state.cart.lockedItems.size === 0) {
        console.error('[SIDEBAR PACKAGE DEBUG] No locked items in cart');
        alert('Add some items to your Event Plan before publishing as a package.');
        return;
    }

    try {
        // Prompt for package details
        const packageName = prompt(
            'Enter a name for this package:',
            state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'My Package'
        );

        if (!packageName) {
            console.log('[SIDEBAR PACKAGE DEBUG] User cancelled - no package name');
            return; // User cancelled
        }
        console.log('[SIDEBAR PACKAGE DEBUG] Package name:', packageName);

        const packageDescription = prompt(
            'Enter a description for this package:',
            state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || ''
        );

        // Calculate suggested package price from locked items
        let totalPrice = 0;
        console.log('[SIDEBAR PACKAGE DEBUG] Calculating price from locked items...');
        console.log('[SIDEBAR PACKAGE DEBUG] state.records.all count:', state.records.all?.length || 0);
        for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                const rawPrice = record.fields[CONSTANTS.FIELD_NAMES.PRICE];
                const price = parseFloat(rawPrice || 0);
                const qty = itemInfo.quantity || 1;
                console.log('[SIDEBAR PACKAGE DEBUG] Item:', recordId, 'rawPrice:', rawPrice, 'parsedPrice:', price, 'qty:', qty);
                if (!isNaN(price)) {
                    totalPrice += price * qty;
                }
            } else {
                console.log('[SIDEBAR PACKAGE DEBUG] Record NOT FOUND in state.records.all:', recordId);
            }
        }
        console.log('[SIDEBAR PACKAGE DEBUG] Calculated totalPrice:', totalPrice);

        const priceInput = prompt(
            'Enter the package price (or leave empty for free/no price):',
            totalPrice > 0 ? totalPrice.toFixed(2) : ''
        );

        // Handle price input - when user cancels (null) or explicitly leaves empty, don't set a price
        // This allows packages to be created as "free" if the user wants
        let packagePrice = undefined;
        console.log('[SIDEBAR PACKAGE DEBUG] priceInput:', priceInput, 'type:', typeof priceInput);

        if (priceInput === null) {
            // User cancelled the prompt - use calculated price as fallback
            packagePrice = totalPrice > 0 ? totalPrice : undefined;
            console.log('[SIDEBAR PACKAGE DEBUG] User cancelled, using fallback:', packagePrice);
        } else if (priceInput.trim() === '') {
            // User explicitly left the field empty - no price (free)
            packagePrice = undefined;
            console.log('[SIDEBAR PACKAGE DEBUG] User left blank - no price set (free)');
        } else {
            // User entered a value - parse it
            const parsedPrice = parseFloat(priceInput);
            if (!isNaN(parsedPrice) && isFinite(parsedPrice) && parsedPrice >= 0) {
                packagePrice = parsedPrice;
                console.log('[SIDEBAR PACKAGE DEBUG] User entered valid price:', packagePrice);
            } else {
                // Invalid input - fall back to calculated price
                packagePrice = totalPrice > 0 ? totalPrice : undefined;
                console.log('[SIDEBAR PACKAGE DEBUG] Invalid input, using fallback:', packagePrice);
            }
        }
        console.log('[SIDEBAR PACKAGE DEBUG] Final packagePrice:', packagePrice);

        const discountInput = prompt('Enter a discount percentage (0-100, or leave empty for no discount):', '0');
        const discount = discountInput ? Math.min(100, Math.max(0, parseFloat(discountInput))) : 0;

        log('Sidebar', `Publishing session ${state.session.id} as package with name: ${packageName}`);
        console.log('[SIDEBAR PACKAGE DEBUG] About to call api.publishSessionAsPackage');
        console.log('[SIDEBAR PACKAGE DEBUG] Session ID:', state.session.id);

        // Disable the button to prevent double-clicks
        const publishPackageBtn = document.getElementById('share-publish-package-btn');
        const updatePackageBtn = document.getElementById('share-update-package-btn');
        if (publishPackageBtn) {
            publishPackageBtn.disabled = true;
            publishPackageBtn.textContent = 'Publishing...';
        }
        if (updatePackageBtn) {
            updatePackageBtn.disabled = true;
            updatePackageBtn.textContent = 'Updating...';
        }

        // Call the API to publish/update package
        const packageData = {
            Name: packageName,
            Description: packageDescription || '',
            Price: packagePrice,
            Discount: discount > 0 ? discount : undefined
        };
        console.log('[SIDEBAR PACKAGE DEBUG] packageData being sent:', JSON.stringify(packageData, null, 2));

        const result = await api.publishSessionAsPackage(state.session.id, packageData);

        console.log('[SIDEBAR PACKAGE DEBUG] ========== API CALL COMPLETE ==========');
        console.log('[SIDEBAR PACKAGE DEBUG] Result received:', result);
        console.log('[SIDEBAR PACKAGE DEBUG] Result ID:', result?.id);
        console.log('[SIDEBAR PACKAGE DEBUG] Result fields:', JSON.stringify(result?.fields, null, 2));
        log('Sidebar', 'Package published/updated successfully:', result);
        alert(`Package "${packageName}" published successfully! It will now appear in the catalog.`);

        // Reload to show updated state
        await updateSessionPublishingControls();

        // Re-enable buttons with updated text
        if (publishPackageBtn) {
            publishPackageBtn.style.display = 'none';
        }
        if (updatePackageBtn) {
            updatePackageBtn.disabled = false;
            updatePackageBtn.textContent = '📦 Update Package';
            updatePackageBtn.style.display = 'flex';
        }

    } catch (error) {
        console.error('[SIDEBAR PACKAGE DEBUG] ========== ERROR PUBLISHING PACKAGE ==========');
        console.error('[SIDEBAR PACKAGE DEBUG] Error:', error);
        console.error('[SIDEBAR PACKAGE DEBUG] Error message:', error.message);
        console.error('[SIDEBAR PACKAGE DEBUG] Error stack:', error.stack);
        console.error('Error publishing package:', error);
        alert(`Failed to publish package: ${error.message}`);

        // Re-enable buttons
        const publishPackageBtn = document.getElementById('share-publish-package-btn');
        const updatePackageBtn = document.getElementById('share-update-package-btn');
        if (publishPackageBtn) {
            publishPackageBtn.disabled = false;
            publishPackageBtn.textContent = '📦 Publish as Package';
        }
        if (updatePackageBtn) {
            updatePackageBtn.disabled = false;
            updatePackageBtn.textContent = '📦 Update Package';
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
        // Invite section removed - now accessible via Share menu popup
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
    const roleSelect = document.getElementById('collab-role'); // Phase 4: Role selector
    const statusEl = document.getElementById('invite-status');
    const btn = document.getElementById('invite-btn');

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const role = roleSelect ? roleSelect.value : 'editor'; // Default to editor

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

        // Phase 4: Include role in the invitation request
        const response = await fetch('/api/invite-collaborator', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eventId: state.session.id,
                collaboratorName: name,
                collaboratorEmail: email,
                inviterName: inviterName,
                planSummaryHtml: summaryHtml,
                role: role // Phase 4: Include selected role
            })
        });

        if (response.ok) {
            statusEl.textContent = "Invitation sent!";
            statusEl.style.color = "#28a745"; // Bootstrap success green
            nameInput.value = '';
            emailInput.value = '';
            if (roleSelect) roleSelect.value = 'editor'; // Reset role to default
            // Close the popup after showing success message
            setTimeout(() => {
                 closeInvitePopup();
                 statusEl.textContent = "";
                 btn.textContent = "Send Invite";
                 btn.disabled = false;
            }, 1500);
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

    // A plan is empty only if there are no locked items AND subtotal is 0
    const isPlanEmpty = state.cart.lockedItems.size === 0 && subtotal === 0;
    // Only consider fully paid if amount has actually been received
    const isFullyPaid = totalDue <= 0.009 && amountReceived > 0;

    // Always show the mobile plan button so users can access event details and
    // other plan panel features regardless of plan state
    document.body.classList.add('mobile-bar-active');

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
