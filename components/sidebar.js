// REPLACE THE ENTIRE CONTENTS of components/sidebar.js

import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from '../config.js';
import { calculateMissingCategories, buildGoalBucket } from '../availability.js';
import { calculateRecommendationScore } from '../availability.js';
import { parseOptions, getRecordPrice, getEffectiveMinQuantity } from '../utils.js';
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

    const price = getRecordPrice(record, itemInfo.selectedOptionIndex);
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
    tippy(itemCard.querySelector('.favorite-item-overlay'), {
        content: tooltipContent,
        allowHTML: true,
        placement: 'top',
        theme: 'light',
    });
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
    
    let optionName = '';
    if (!isCustomItem) { // Custom items don't have options
        const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        if (itemInfo.selectedOptionIndex != null && options[itemInfo.selectedOptionIndex]) {
            optionName = options[itemInfo.selectedOptionIndex].name;
        }
    }

    let price = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);
    const total = (price || 0) * (itemInfo.quantity || 1);
    let priceDisplay = `$${(price || 0).toFixed(2)}`;

    if (isCustomItem && itemInfo.overridePrice == null && price > 0) {
        priceDisplay = `$${price.toFixed(2)} (Est.)`;
    }

    if (itemInfo.overridePrice != null) {
        let originalPrice = getRecordPrice(record, itemInfo.selectedOptionIndex);
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
            ${optionName ? `<p class="locked-item-option">${optionName}</p>` : ''}
            <p class="locked-item-pricing">${quantityDisplay} @ ${priceDisplay} = <strong>$${total.toFixed(2)}</strong></p>
            ${itemInfo.note ? `<p class="locked-item-note"><em>Note: ${itemInfo.note}</em></p>` : ''}
        </div>
        <div class="locked-item-actions">
            <button class="demote-locked-item-btn" title="Remove from Plan">Unsave</button>
        </div>
    `;

    // Initialize Tippy tooltip for the warning asterisk if present
    const warningSpan = itemElement.querySelector('.min-qty-warning');
    if (warningSpan) {
        tippy(warningSpan, {
            content: warningSpan.dataset.tippyContent,
            allowHTML: true,
            placement: 'top',
            arrow: true
        });
    }

    // Initialize Tippy tooltip for the UMW benefit indicator if present
    const benefitSpan = itemElement.querySelector('.umw-benefit-indicator');
    if (benefitSpan) {
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
    // Remove any existing publishing controls
    const existingControls = document.getElementById('session-publishing-controls');
    if (existingControls) {
        existingControls.remove();
    }

    // Only show if we have an active session
    if (!state.session.id) {
        log('Sidebar', 'No active session, skipping publishing controls');
        return;
    }

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
        if (cartContainer && cartContainer.parentElement) {
            cartContainer.parentElement.insertBefore(controlsContainer, cartContainer);
        }

        // Add event listeners for the buttons
        const publishBtn = document.getElementById('publish-event-btn');
        const updateBtn = document.getElementById('update-published-event-btn');

        if (publishBtn) {
            publishBtn.addEventListener('click', async () => {
                await handlePublishEvent();
            });
        }

        if (updateBtn) {
            updateBtn.addEventListener('click', async () => {
                await handlePublishEvent();
            });
        }

        log('Sidebar', 'Session publishing controls updated');
    } catch (error) {
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
    // If already updating, mark that another update is needed and return
    if (isUpdatingEventPlan) {
        pendingEventPlanUpdate = true;
        log('Sidebar', 'Event plan update already in progress, will retry after completion.');
        return;
    }

    isUpdatingEventPlan = true;
    pendingEventPlanUpdate = false;

    try {
        log('Sidebar', 'Updating event plan panel.');
        const container = document.getElementById('cart-items-container');
        if (!container) return;

        // Clear container to prevent duplicates
        container.innerHTML = '';

        // Check if this session is published and display RSVP stats + Publish button
        await updateSessionPublishingControls();

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
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    const activeShop = state.stores.all.find(s => s.id === state.ui.activeShopId);
    const shopName = activeShop?.fields?.Name || '';
    document.title = eventName || (shopName ? `WTFun ${shopName}` : 'WTFun');
    const eventNameInput = document.getElementById('header-event-name');
    if (eventNameInput) eventNameInput.value = eventName;
    
    const goalsInput = document.getElementById('header-goals');
    if(goalsInput) goalsInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
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
        
        const unitPrice = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);
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
