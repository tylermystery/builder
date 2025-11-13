// REPLACE THE ENTIRE CONTENTS of components/modal.js

import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY } from '../config.js';
import { parseOptions, updateUrl, getGroupPriceRange, getRecordPrice, debounce } from '../utils.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS, calculateMissingCategories, buildGoalBucket, calculateRecommendationScore, ATTRIBUTE_TO_KEYWORDS_MAP } from '../availability.js';
import { log } from '../utils/debug.js';
import { initializeItemChat } from '../chat.js';

/**
 * [V3.7] Generates the "Intelligent Blurb" by calling the central recommendation engine.
 * @param {object} record - The item record being displayed.
 * @returns {string | null} The HTML string for the blurb, or null.
 */
function generateRecommendationBlurb(record) {
    // Get the current sort value from the DOM
    const sortBy = document.getElementById('sort-by')?.value || 'recommended';
    
    // 1. Get the current goal bucket, passing the sortBy value
    const goalBucket = buildGoalBucket(sortBy); // This import already exists
    
    if (goalBucket.length === 0) {
        // "Tip" blurb
        return "<span class='beta-tag-subtle' style='float: right; margin-left: 5px;'>Beta</span><strong style='color: #5a6268;'>Tip:</strong> Add goals to your 'Goals/Notes' or search to get personalized recommendations.";
    }

    // 2. Call the ONE, TRUE scoring function from availability.js
    const score = calculateRecommendationScore(record, goalBucket);

    // 3. Check if the item scored well
    if (score > 0) {
        // Create a simple, robust blurb
        let goalString = "goals"; // Default
        
        // Filter out pillar names (like "Food & Drink") from the blurb for cleaner text
        const displayGoals = goalBucket.filter(g => 
            !ATTRIBUTE_TO_KEYWORDS_MAP["Pillars.Activity"].includes(g.toLowerCase()) &&
            !ATTRIBUTE_TO_KEYWORDS_MAP["Pillars.Food & Drink"].includes(g.toLowerCase()) &&
            !ATTRIBUTE_TO_KEYWORDS_MAP["Pillars.Venues"].includes(g.toLowerCase()) &&
            !ATTRIBUTE_TO_KEYWORDS_MAP["Pillars.Extras"].includes(g.toLowerCase())
        );

        if (displayGoals.length > 2) {
            goalString = `'${displayGoals.slice(0, -1).join("', '")}', and '${displayGoals.slice(-1)}'`;
        } else if (displayGoals.length > 0) {
            goalString = `'${displayGoals.join("' and '")}'`;
        }

        // --- THIS IS THE CHANGE ---\
        // Adds the score directly into the recommendation blurb
        return `<span class='beta-tag-subtle' style='float: right; margin-left: 5px;'>Beta</span><strong style='color: #0056b3;'>Recommended for you (Score: ${score.toFixed(0)})</strong> This item is a good match for your ${goalString} goals.`;
        // --- END THE CHANGE ---\
    }

    return null; // No match
}

let stripe;
let elements; // To hold the Stripe elements instance
let paymentElement; // To hold the payment element
let currentClientSecret = null;
let currentBaseAmount = 0; // To store the amount *before* fees
let currentPaymentType = 'card'; // <-- ADD THIS LINE
let currentProcessingFee = 0; // To store the current fee

let currentShopSettings = {};
const modalOverlay = document.getElementById('detail-modal-overlay');
let currentItemChatRecordId = null;

function closeDetailModal() {
    updateUrl({ openItem: null });
    hideDetailModal();
}

function handleEscapeKey(event) {
    if (event.key === 'Escape') {
        closeDetailModal();
    }
}

function handleOverlayClick(event) {
    if (event.target === modalOverlay) {
        closeDetailModal();
    }
}

async function updateCheckoutDisplay() {
    const finalTotal = parseFloat(document.getElementById('full-total-price').dataset.total || 0);
    const amountReceived = state.session.user.amountReceived || 0;
    const totalDue = finalTotal - amountReceived;
    const isFullyPaid = totalDue <= 0.009; // Check for paid status
    
    const choice = document.querySelector('input[name="paymentChoice"]:checked')?.value || 'deposit';
    let baseAmountToCharge = totalDue; // This is the amount *before* processing fees
    
    const isInitialDeposit = amountReceived === 0 && (currentShopSettings.paymentOptions !== 'DepositOrFull' || choice === 'deposit');
    
    const tipRow = document.querySelector('.tip-row');
    if (tipRow) {
        if (isInitialDeposit && totalDue > baseAmountToCharge * 1.05) {
            tipRow.style.display = 'none';
        } else {
            tipRow.style.display = 'flex';
        }
    }

    if (amountReceived === 0) {
        if (currentShopSettings.paymentOptions === 'DepositOrFull' && choice === 'full') {
            baseAmountToCharge = finalTotal;
            document.getElementById('deposit-label').textContent = 'Full Amount Due:';
        } else {
            baseAmountToCharge = finalTotal * 0.35;
            document.getElementById('deposit-label').textContent = '35% Deposit Due:';
        }
    } else {
        document.getElementById('deposit-label').textContent = 'Remaining Balance Due:';
    }
    const tipAmount = parseFloat(document.getElementById('tip-amount').value) || 0;
    
    let finalBaseAmount = baseAmountToCharge + tipAmount;
    document.getElementById('deposit-price').textContent = `$${finalBaseAmount.toFixed(2)}`;
    
    // Get fee/total elements
    const processingFeeEl = document.getElementById('processing-fee-price');
    const finalChargeEl = document.getElementById('final-charge-price');
    const paymentForm = document.getElementById('payment-form'); // Get form

    // --- NEW LOGIC FOR "RECEIPT" MODE ---
    if (isFullyPaid && finalBaseAmount <= 0) {
        log('Modal', 'Receipt mode: Plan is fully paid.');
        
        // Hide all payment form elements
        if (paymentForm) paymentForm.style.display = 'none';
        
        // Also hide the tip row
        if (tipRow) tipRow.style.display = 'none';

        return; // Stop here, don't create a payment intent
    }
    // --- END NEW LOGIC ---

    // If we're here, we need to pay. Show the form.
    if (paymentForm) paymentForm.style.display = 'block'; 

    // --- MINIMUM CHARGE FIX ---
    // Stripe's minimum charge is $0.50 (50 cents)
    if (finalBaseAmount > 0 && finalBaseAmount < 0.50) {
        finalBaseAmount = 0.50;
        log('Modal', 'Amount less than $0.50, rounding up to Stripe minimum $0.50');
    }
    // --- END FIX ---

    // --- LOGIC: Rebuild Payment Element ONLY if amount changed ---\
    if (finalBaseAmount !== currentBaseAmount) {
        log('Modal', `Price changed from ${currentBaseAmount} to ${finalBaseAmount}. Rebuilding PaymentElement.`);
        currentBaseAmount = finalBaseAmount; // Update module-level var
        
        if (processingFeeEl) processingFeeEl.textContent = 'Calculating...';
        if (finalChargeEl) finalChargeEl.textContent = 'Calculating...';

        try {
            // 1. Call create-payment-intent with the *current* payment type
            const intentResponse = await fetch('/api/create-payment-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    amount: Math.round(currentBaseAmount * 100), 
                    paymentMethodType: currentPaymentType // Use the stored payment type
                }),
            });
            if (!intentResponse.ok) throw new Error('Could not update payment intent.');
            
            const intentData = await intentResponse.json();
            const newClientSecret = intentData.clientSecret;
            const newProcessingFee = intentData.processingFeeInCents / 100;

            // 2. Update UI with new fees
            currentProcessingFee = newProcessingFee;
            if (processingFeeEl) processingFeeEl.textContent = `$${newProcessingFee.toFixed(2)}`;
            if (finalChargeEl) finalChargeEl.textContent = `$${(currentBaseAmount + newProcessingFee).toFixed(2)}`;

            // 3. Destroy old element and create/mount a new one
            if (paymentElement) {
                paymentElement.unmount();
            }
            
            currentClientSecret = newClientSecret; // Update the secret
            elements = stripe.elements({ clientSecret: currentClientSecret });
            paymentElement = elements.create('payment');
            paymentElement.mount('#payment-element');
            
            // 4. --- THIS IS THE FIX ---\
            // Add listener to update payment type AND fetch new fee
            paymentElement.on('change', debounce(handlePaymentTypeChange, 300));

        } catch (error) {
            console.error('Failed to update payment intent/element:', error);
            if (processingFeeEl) processingFeeEl.textContent = 'Error';
            if (finalChargeEl) finalChargeEl.textContent = 'Error';
        }
    } else {
         // --- ADDED THIS ELSE BLOCK ---\
         // Price did NOT change, but we should still update the final total
         // in case the processing fee was updated by the new listener.
         log('Modal', 'Price did not change, just updating fee display.');
         if (processingFeeEl) processingFeeEl.textContent = `$${currentProcessingFee.toFixed(2)}`;
         if (finalChargeEl) finalChargeEl.textContent = `$${(currentBaseAmount + currentProcessingFee).toFixed(2)}`;
         // --- END ADDED BLOCK ---\
    }
}

/**
 * Handles changes in the PaymentElement (e.g., switching from Card to ACH).
 * This function ONLY fetches the new fee and updates the UI, it does not
 * rebuild the PaymentElement.
 */
async function handlePaymentTypeChange(event) {
    if (!event.value.type || event.value.type === currentPaymentType) {
        // No change, or event is incomplete
        return;
    }
    
    currentPaymentType = event.value.type;
    log('Modal', `Payment type changed to: ${currentPaymentType}. Fetching new fee.`);

    const processingFeeEl = document.getElementById('processing-fee-price');
    const finalChargeEl = document.getElementById('final-charge-price');

    if (processingFeeEl) processingFeeEl.textContent = 'Calculating...';
    if (finalChargeEl) finalChargeEl.textContent = 'Calculating...';

    try {
        // 1. Call create-payment-intent to get the new fee
        const intentResponse = await fetch('/api/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                amount: Math.round(currentBaseAmount * 100), 
                paymentMethodType: currentPaymentType
            }),
        });
        if (!intentResponse.ok) throw new Error('Could not fetch new processing fee.');
        
        const intentData = await intentResponse.json();
        const newProcessingFee = intentData.processingFeeInCents / 100;

        // 2. Update UI with new fees
        currentProcessingFee = newProcessingFee;
        if (processingFeeEl) processingFeeEl.textContent = `$${newProcessingFee.toFixed(2)}`;
        if (finalChargeEl) finalChargeEl.textContent = `$${(currentBaseAmount + newProcessingFee).toFixed(2)}`;
        
        log('Modal', `New fee is ${newProcessingFee.toFixed(2)}`);

    } catch (error) {
        console.error('Failed to update fee on type change:', error);
        if (processingFeeEl) processingFeeEl.textContent = 'Error';
        if (finalChargeEl) finalChargeEl.textContent = 'Error';
    }
}

function getBreadcrumbs(record) {
    const breadcrumbs = [];
    let current = record;
    while (current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]) {
        const parentName = current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
        breadcrumbs.unshift(parentName);
        current = state.records.all.find(r => r.fields.Name === parentName);
        if (!current) break;
    }
    return breadcrumbs;
}

function resetModalState() {
    const elements = {
        modalItemName: document.getElementById('modal-item-name'),
        modalItemPrice: document.getElementById('modal-item-price'),
        modalItemDescription: document.getElementById('modal-item-description'),
        modalMainImage: document.getElementById('modal-main-image'),
        modalThumbnailStrip: document.getElementById('modal-thumbnail-strip'),
        modalOptionsContainer: document.getElementById('modal-options-container'),
        modalQuantitySelector: document.getElementById('modal-quantity-selector'),
        modalItemNote: document.getElementById('modal-item-note'),
        modalCalendarContainer: document.getElementById('modal-calendar-container'),
        modalBreadcrumbs: document.getElementById('modal-breadcrumbs'),
        modalAdditionalDetails: document.getElementById('modal-additional-details'),
        modalRecommendationBlurb: document.getElementById('modal-recommendation-blurb')
    };
    for (const key in elements) {
        if (elements[key]) {
            if (key === 'modalItemNote') elements[key].value = '';
            else if (key === 'modalMainImage') elements[key].style.backgroundImage = '';
            else if (key === 'modalRecommendationBlurb') {
                elements[key].innerHTML = '';
                elements[key].style.display = 'none';
            }
            else elements[key].innerHTML = '';
        }
    }
    log('Modal', 'Reset modal state.');
}

export async function showDetailModal(record, startPhotoIndex = 0) {
    const detailSpecs = [
        { fieldName: 'Duration', label: 'Duration' },
        { fieldName: 'Capacity', label: 'Capacity' },
        { fieldName: 'Location Details', label: 'Location Info' },
        { fieldName: 'Additional Information', label: 'Good to Know' },
    ];

    console.log('[showDetailModal] Called for item:', record.id);
    log('Modal', `Showing detail modal for \"${record.fields.Name}\"`);
    updateUrl({ openItem: record.id });
    const modalHeaderActions = document.getElementById('modal-header-actions');
    const modalItemName = document.getElementById('modal-item-name');
    const modalItemPrice = document.getElementById('modal-item-price');
    const modalItemDescription = document.getElementById('modal-item-description');
    const modalMainImage = document.getElementById('modal-main-image');
    const modalThumbnailStrip = document.getElementById('modal-thumbnail-strip');
    const modalOptionsContainer = document.getElementById('modal-options-container');
    const modalQuantitySelector = document.getElementById('modal-quantity-selector');
    const modalNotesContainer = document.getElementById('modal-notes-container');
    const modalItemNote = document.getElementById('modal-item-note');
    const modalCalendarContainer = document.getElementById('modal-calendar-container');
    const modalActionsContainer = document.getElementById('modal-actions-container');
    const modalBreadcrumbs = document.getElementById('modal-breadcrumbs');
    const modalAdditionalDetails = document.getElementById('modal-additional-details');
    const addToPlanBtn = document.getElementById('modal-add-to-plan-btn');
    const modalRecBlurb = document.getElementById('modal-recommendation-blurb');

    const closeBtn = document.getElementById('modal-close-btn');
    closeBtn.onclick = closeDetailModal;
    modalOverlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleEscapeKey);

    resetModalState();
    modalOverlay.dataset.recordId = record.id;
    currentItemChatRecordId = record.id;

    const isLocked = state.cart.lockedItems.has(record.id);
    modalOverlay.dataset.mode = isLocked ? 'edit-locked' : 'edit-favorite';

    const itemState = isLocked ? state.cart.lockedItems.get(record.id) : ui.getItemState(record.id);
    if (addToPlanBtn) {
        addToPlanBtn.textContent = isLocked ? 'Update Plan' : 'Add to Plan';
        addToPlanBtn.dataset.tooltip = isLocked ? 'Update plan with changes' : 'Add to plan';
    }

    let imageUrls = [];
    if (!record.id.startsWith('custom-') && !record.id.startsWith('ai-search-')) {
        const { imageUrls: fetchedUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
        imageUrls = fetchedUrls;
    }
    if (imageUrls.length === 0) {
        imageUrls = [ui.getPlaceholderImage([])];
    }
    
    modalItemName.textContent = record.fields.Name || 'Untitled';
    modalItemDescription.textContent = record.fields.Description || '';
    
    if (record.fields['Item Type'] === 'Event') {
        const eventDateStr = record.fields.Date;
        const eventTime = record.fields.Time || '';
        const eventLocation = record.fields.Location || '';
        
        if (eventDateStr) {
            const eventDate = new Date(eventDateStr);
            const dateStr = eventDate.toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });
            
            const eventInfoSection = document.createElement('div');
            eventInfoSection.className = 'event-info-section';
            eventInfoSection.innerHTML = `
                <div class="event-date-time">
                    <strong>📅 ${dateStr}</strong>${eventTime ? ` at ${eventTime}` : ''}
                </div>
                ${eventLocation ? `<div class="event-location">📍 ${eventLocation}</div>` : ''}
            `;
            
            modalItemDescription.parentElement.insertBefore(eventInfoSection, modalItemDescription);
        }
        
        const rsvpYes = record.fields.RSVPs || [];
        const rsvpMaybe = record.fields.RSVPMaybe || [];
        const rsvpNo = record.fields.RSVPNo || [];
        
        if (rsvpYes.length > 0 || rsvpMaybe.length > 0 || rsvpNo.length > 0) {
            const rsvpListSection = document.createElement('div');
            rsvpListSection.className = 'rsvp-list-section';
            
            let rsvpHTML = '<div class="rsvp-list-header"><strong>RSVPs</strong></div>';
            
            if (rsvpYes.length > 0) {
                rsvpHTML += `<div class="rsvp-list-group">
                    <div class="rsvp-list-label">Going (${rsvpYes.length})</div>
                    <div class="rsvp-list-items">Anonymous users</div>
                </div>`;
            }
            
            if (rsvpMaybe.length > 0) {
                rsvpHTML += `<div class="rsvp-list-group">
                    <div class="rsvp-list-label">Maybe (${rsvpMaybe.length})</div>
                    <div class="rsvp-list-items">Anonymous users</div>
                </div>`;
            }
            
            if (rsvpNo.length > 0) {
                rsvpHTML += `<div class="rsvp-list-group">
                    <div class="rsvp-list-label">Can't Go (${rsvpNo.length})</div>
                    <div class="rsvp-list-items">Anonymous users</div>
                </div>`;
            }
            
            rsvpListSection.innerHTML = rsvpHTML;
            modalItemDescription.parentElement.insertBefore(rsvpListSection, modalItemDescription);
        }
    }
    
    try {
        const blurbHtml = generateRecommendationBlurb(record);
        if (blurbHtml && modalRecBlurb) {
            modalRecBlurb.innerHTML = blurbHtml;
            modalRecBlurb.style.display = 'block';
        }
    } catch (e) {
        console.warn('Failed to generate recommendation blurb:', e);
    }

    if (modalAdditionalDetails) {
        modalAdditionalDetails.innerHTML = '';
        const fragment = document.createDocumentFragment();
        let hasRankings = false;
        const rankingsHtmlParts = [];

        detailSpecs.forEach(spec => {
            const value = record.fields[spec.fieldName];
            if (value) {
                const detailItem = document.createElement('div');
                detailItem.className = 'detail-item';
                detailItem.innerHTML = `
                    <span class="detail-label">${spec.label}</span>
                    <span class="detail-value">${String(value).replace(/\n/g, '<br>')}</span>
                `;
                fragment.appendChild(detailItem);
            }
        });

        // --- THIS IS THE CHANGE ---\
        const rankingsJsonString = record.fields['AI_Profile'] || record.fields['Rankings'];
        // --- END CHANGE ---\
        
        if (rankingsJsonString) {
            try {
                // --- V2.1: Check for new profile structure ---\
                const rankingsObject = JSON.parse(rankingsJsonString);
                
                let displayRankings = {};
                // Check if it's the new v2.1 profile
                if (rankingsObject.profileSource && rankingsObject.Vibe) {
                    // Extract vibe/intellect/physicality for display
                    displayRankings = { ...rankingsObject.Vibe, ...rankingsObject.Intellect, ...rankingsObject.Physicality };
                } else {
                    // Fallback to old v1.2 structure
                    displayRankings = rankingsObject;
                }
                
                for (const label in displayRankings) {
                    if (Object.hasOwnProperty.call(displayRankings, label)) {
                        const value = displayRankings[label];
                        if (typeof value === 'number' && value > 0) {
                            hasRankings = true;
                            // Show 0-10 scale as 0-5 stars
                            const stars = '★'.repeat(Math.round(value / 2)) + '☆'.repeat(Math.max(0, 5 - Math.round(value / 2)));
                            rankingsHtmlParts.push(`
                                <div class="ranking-item">
                                    <span class="ranking-label">${label}:</span>
                                    <span class="ranking-stars">${stars}</span>
                                </div>
                            `);
                        }
                    }
                }
            } catch (error) {
                console.error(`[Modal Debug] Error parsing Rankings JSON for item ${record.id}:`, error);
            }
        }

        if (hasRankings) {
            const rankingContainer = document.createElement('div');
            rankingContainer.className = 'ranking-list detail-item';
            rankingContainer.innerHTML = `
                <span class="detail-label">Rankings</span>
                ${rankingsHtmlParts.join('')}
            `;
            fragment.appendChild(rankingContainer);
        }
        modalAdditionalDetails.appendChild(fragment);
    }

    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const allRecordNames = new Set(state.records.all.map(r => r.fields.Name));
    const isGrouping = !record.id.startsWith('custom-') && !record.id.startsWith('ai-search-') && record.fields['Item Type'] === 'Grouping'; 

    const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const pricingTypeHTML = pricingType ? `<span class="pricing-type"> / ${pricingType.toLowerCase()}</span>` : '';

    if (isGrouping) {
        const range = getGroupPriceRange(record);
        modalItemPrice.innerHTML = (range && typeof range.min === 'number') ? (range.min === range.max ? `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`) : 'Price Varies';
    } else {
        const price = getRecordPrice(record, itemState.selectedOptionIndex);
        let priceText = (typeof price === 'number' ? `$${price.toFixed(2)}` : 'N/A');
        if ((record.id.startsWith('custom-') || record.id.startsWith('ai-search-')) && price > 0) {
            priceText += ' (Est.)';
        }
        modalItemPrice.innerHTML = priceText + pricingTypeHTML;
    }

    let currentPhotoIndex = startPhotoIndex;
    modalMainImage.style.backgroundImage = `url('${imageUrls[currentPhotoIndex]}')`;
    modalThumbnailStrip.innerHTML = '';
    imageUrls.forEach((url, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail-img';
        thumb.style.backgroundImage = `url('${url}')`;
        if (index === currentPhotoIndex) thumb.classList.add('active');
        thumb.addEventListener('click', () => {
            currentPhotoIndex = index;
            modalMainImage.style.backgroundImage = `url('${url}')`;
            modalThumbnailStrip.querySelector('.active')?.classList.remove('active');
            thumb.classList.add('active');
        });
        modalThumbnailStrip.appendChild(thumb);
    });

    modalHeaderActions.innerHTML = '';
    const breadcrumbs = getBreadcrumbs(record);
    if (breadcrumbs.length > 0) {
        modalBreadcrumbs.innerHTML = breadcrumbs.map(name => `<a class="parent-link" data-parent-name="${name}" title="Go to ${name}">${name}</a>`).join(' > ');
    }

    const heartBtnContainer = document.createElement('div');
    heartBtnContainer.id = 'modal-heart-btn';
    heartBtnContainer.dataset.recordId = record.id;
    modalHeaderActions.appendChild(heartBtnContainer);

    if (record.fields['Item Type'] === 'Event') {
        const rsvpYes = record.fields.RSVPs || [];
        const rsvpMaybe = record.fields.RSVPMaybe || [];
        const rsvpNo = record.fields.RSVPNo || [];
        const userId = state.session.user.id;
        
        const hasRsvpdYes = rsvpYes.includes(userId);
        const hasRsvpdMaybe = rsvpMaybe.includes(userId);
        const hasRsvpdNo = rsvpNo.includes(userId);

        const rsvpContainer = document.createElement('div');
        rsvpContainer.className = 'rsvp-button-group';
        
        const yesBtn = document.createElement('button');
        yesBtn.className = `rsvp-btn rsvp-yes ${hasRsvpdYes ? 'active' : ''}`;
        yesBtn.dataset.recordId = record.id;
        yesBtn.dataset.rsvpType = 'yes';
        yesBtn.innerHTML = hasRsvpdYes ? "Going ✅" : 'Yes';
        
        const maybeBtn = document.createElement('button');
        maybeBtn.className = `rsvp-btn rsvp-maybe ${hasRsvpdMaybe ? 'active' : ''}`;
        maybeBtn.dataset.recordId = record.id;
        maybeBtn.dataset.rsvpType = 'maybe';
        maybeBtn.innerHTML = hasRsvpdMaybe ? "Maybe ❓" : 'Maybe';
        
        const noBtn = document.createElement('button');
        noBtn.className = `rsvp-btn rsvp-no ${hasRsvpdNo ? 'active' : ''}`;
        noBtn.dataset.recordId = record.id;
        noBtn.dataset.rsvpType = 'no';
        noBtn.innerHTML = hasRsvpdNo ? "Can't Go ❌" : 'No';
        
        rsvpContainer.appendChild(yesBtn);
        rsvpContainer.appendChild(maybeBtn);
        rsvpContainer.appendChild(noBtn);
        modalHeaderActions.appendChild(rsvpContainer);
    }

    modalOptionsContainer.innerHTML = '';
    rawOptions.forEach((opt, index) => {
        const optionButton = document.createElement('button');
        optionButton.className = 'option-btn';
        optionButton.dataset.optionIndex = index;
        if (itemState.selectedOptionIndex === index) {
            optionButton.classList.add('selected');
        }
        let priceModText = '';
        if (opt.price !== null) {
            priceModText = `$${opt.price.toFixed(2)}`;
        } else if (opt.priceChange !== null) {
            priceModText = `${opt.priceChange >= 0 ? '+' : ''}$${opt.priceChange.toFixed(2)}`;
        }
        optionButton.innerHTML = `${opt.name} <span class="price-mod">${priceModText}</span>`;

        if (allRecordNames.has(opt.name)) {
            optionButton.dataset.childName = opt.name;
            optionButton.addEventListener('click', (e) => {
                e.stopPropagation();
                const childName = e.currentTarget.dataset.childName;
                const childRecord = state.records.all.find(r => r.fields.Name === childName);
                if (childRecord) {
                    log('Modal', `Navigating from option to item: ${childName}`);
                    showDetailModal(childRecord);
                } else {
                    log('Modal', `Could not find record for child option: ${childName}`);
                }
            });
        } else {
            optionButton.addEventListener('click', (e) => {
                modalOptionsContainer.querySelectorAll('.option-btn').forEach(btn => btn.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                const newIndex = parseInt(e.currentTarget.dataset.optionIndex, 10);
                e.currentTarget.dispatchEvent(new CustomEvent('change', {
                    bubbles: true,
                    detail: { selectedOptionIndex: newIndex }
                }));
                modalItemDescription.textContent = opt.description || record.fields.Description || '';
                const newPrice = getRecordPrice(record, newIndex);
                modalItemPrice.innerHTML = (typeof newPrice === 'number' ? `$${newPrice.toFixed(2)}` : 'N/A') + pricingTypeHTML;
            });
        }
        modalOptionsContainer.appendChild(optionButton);
    });

    // --- THIS IS THE FIX ---\
    // The listeners are now MOVED INSIDE this `if` block
    if (!isGrouping) {
        modalActionsContainer.style.display = 'block';
        modalNotesContainer.style.display = 'block';
        modalItemNote.value = itemState.note;
        const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        modalQuantitySelector.innerHTML = `<div class="quantity-selector" data-record-id="${record.id}"><button class="quantity-btn minus" aria-label="Decrease quantity">-</button><input type="number" class="quantity-input" value="${itemState.quantity}" min="${headcountMin}"><button class="quantity-btn plus" aria-label="Increase quantity">+</button></div>`;
        
        const plusBtn = modalQuantitySelector.querySelector('.plus');
        const minusBtn = modalQuantitySelector.querySelector('.minus');
        const input = modalQuantitySelector.querySelector('input');
        // This check prevents the crash
        if (plusBtn && minusBtn && input) {
            plusBtn.addEventListener('click', () => { input.stepUp(); input.dispatchEvent(new Event('change', { bubbles: true })); });
            minusBtn.addEventListener('click', () => { input.stepDown(); input.dispatchEvent(new Event('change', { bubbles: true })); });
        }
    } else {
        modalActionsContainer.style.display = 'none';
        modalNotesContainer.style.display = 'none';
        modalQuantitySelector.innerHTML = '';
    }
    // --- END THE FIX ---\

    modalCalendarContainer.innerHTML = '';
    const iCalUrl = record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL];

    if (iCalUrl) {
        modalCalendarContainer.style.display = 'block';
        log('Modal', `iCal URL found for ${record.id}, initializing calendar.`);

        const busyTimes = await api.fetchCalendarForRecord(record);
        const calendarInstance = window.flatpickr(modalCalendarContainer, {
            inline: true,
            showMonths: 1,
            disable: [(date) => {
                const status = getDayStatus(date, busyTimes, record);
                return status.status === AVAILABILITY_STATUS.NONE;
            }],
            onDayCreate: function (dObj, dStr, fp, dayElem) {
                const day = dayElem.dateObj;
                const status = getDayStatus(day, busyTimes, record);
                let className = '';
                let tooltip = status.reason;
                if (status.status === AVAILABILITY_STATUS.FULL) {
                    className = 'available-full';
                } else if (status.status === AVAILABILITY_STATUS.PARTIAL) {
                    className = 'available-partial';
                    // --- THIS IS THE FIX (stray \ removed) ---
                    tooltip = `${status.reason}\nAvailable slots: ${getAvailableSlotsForDay(day, busyTimes) || 'None'}`;
                } else {
                    className = 'unavailable';
                }
                dayElem.classList.add(className);
                dayElem.setAttribute('data-tippy-content', tooltip);
            },
            onReady: function () {
                tippy('.flatpickr-day', {
                    content: reference => reference.getAttribute('data-tippy-content'),
                    placement: 'top',
                    theme: 'light',
                    allowHTML: true,
                });
            },
            onChange: (selectedDates) => {
                if (selectedDates.length > 0) {
                    const eventDateInput = document.getElementById('event-date-picker');
                    if (eventDateInput && eventDateInput._flatpickr) {
                        eventDateInput._flatpickr.setDate(selectedDates[0], true);
                    }
                }
            }
        });
        const eventDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
        if (eventDate) {
            calendarInstance.setDate(new Date(eventDate), true);
        }
    } else {
        modalCalendarContainer.style.display = 'none';
        log('Modal', `No iCal URL for ${record.id}, hiding calendar.`);
    }

    ui.updateCardIcon(record.id);

    modalOverlay.classList.add('active');
    modalOverlay.style.display = 'flex';
    document.body.classList.add('modal-open');
    setTimeout(() => {
        const chatContainer = document.getElementById('modal-chat-container');
        const isChatEnabledOnItem = record.fields['Chat Enabled'] || false;
        const isEvent = record.fields['Item Type'] === 'Event';
        const userRsvped = isEvent && (record.fields.RSVPs || []).includes(state.session.user.id);
        
        log('Modal Chat Init', {
            isAuthenticated: state.session.user.isAuthenticated,
            isChatEnabledOnItem: isChatEnabledOnItem,
            isEvent,
            userRsvped,
            chatContainerExists: !!chatContainer,
            user: state.session.user
        });
        if (state.session.user.isAuthenticated && chatContainer && (isChatEnabledOnItem || userRsvped)) {
            log('Modal', 'All conditions met. Initializing item chat.');
            chatContainer.style.display = 'flex';
            initializeItemChat(record.id);
        } else {
            log('Modal', 'Hiding chat. Reason:', {
                isAuthenticated: state.session.user.isAuthenticated,
                chatEnabled: isChatEnabledOnItem || userRsvped,
                chatContainerExists: !!chatContainer
            });
            if (chatContainer) {
                chatContainer.style.display = 'none';
            }
        }
    }, 0);
}

export function hideDetailModal() {
    console.log('[hideDetailModal] Called.');
    const closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) {
        closeBtn.onclick = null;
    }
    modalOverlay.removeEventListener('click', handleOverlayClick);
    document.removeEventListener('keydown', handleEscapeKey);
    if (currentItemChatRecordId) {
        log('Chat', `Closing item chat for recordId: ${currentItemChatRecordId}`);
        currentItemChatRecordId = null;
    }

    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        setTimeout(() => {
            modalOverlay.style.display = 'none';
            resetModalState();
        }, 300);
        document.body.classList.remove('modal-open');
    }
}

export async function showCheckoutModal(shopSettings) {
    currentShopSettings = shopSettings;
    log('Modal', 'Showing checkout modal.');
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    const fullTotalEl = document.getElementById('full-total-price');
    const checkoutCloseBtn = document.getElementById('checkout-close-btn');
    const summaryDetailsEl = document.getElementById('checkout-summary-details');
    const tipAmountInput = document.getElementById('tip-amount');
    const paymentChoiceContainer = document.getElementById('payment-choice-container');
    const termsContainer = document.querySelector('.terms-and-conditions');

    // Get new fee/total elements
    const processingFeeEl = document.getElementById('processing-fee-price');
    const finalChargeEl = document.getElementById('final-charge-price');

    const totalLabel = document.getElementById('checkout-total-label');
    if (totalLabel) {
        if (state.session.user.amountReceived > 0) {
            totalLabel.textContent = 'Total Final Cost:';
        } else {
            totalLabel.textContent = 'Total Estimated Cost:';
        }
    }

    if (!checkoutModalOverlay) return;

    const handleOverlayClick = (e) => {
        if (e.target === checkoutModalOverlay) {
            hideCheckoutModal();
        }
    };
    checkoutModalOverlay.addEventListener('click', handleOverlayClick);
    
    checkoutModalOverlay.removeEventListenerOnClick = () => {
        checkoutModalOverlay.removeEventListener('click', handleOverlayClick);
    };

    if (checkoutCloseBtn) checkoutCloseBtn.addEventListener('click', hideCheckoutModal);
    
    // --- 1. Calculate Base Total ---\
    summaryDetailsEl.innerHTML = '';
    tipAmountInput.value = '';
    let finalTotal = 0; // This is the plan subtotal
    const summaryList = document.createElement('ul');
    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;

        const price = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);

        const itemTotal = price * (itemInfo.quantity || 1);
        finalTotal += itemTotal;
        const listItem = document.createElement('li');
        
        let noteHtml = '';
        if (itemInfo.note && itemInfo.note.trim() !== '') {
            noteHtml = `<small class="checkout-summary-note">Note: ${itemInfo.note}</small>`;
        }
        
        listItem.innerHTML = `
            <div class="summary-item-details">
                <span class="summary-item-name">${record.fields.Name} (x${itemInfo.quantity || 1})</span>
                ${noteHtml}
            </div>
            <span class="summary-item-price">$${itemTotal.toFixed(2)}</span>
        `;
        summaryList.appendChild(listItem);
    }
    summaryDetailsEl.appendChild(summaryList);

    fullTotalEl.textContent = `$${finalTotal.toFixed(2)}`;
    fullTotalEl.dataset.total = finalTotal;

    if (currentShopSettings.paymentOptions === 'DepositOrFull' && state.session.user.amountReceived === 0) {
        paymentChoiceContainer.style.display = 'block';
        // --- THIS IS CHANGED: Add async/await ---\
        document.querySelectorAll('input[name="paymentChoice"]').forEach(radio => {
            radio.addEventListener('change', async () => await updateCheckoutDisplay());
        });
    } else {
        paymentChoiceContainer.style.display = 'none';
    }

    if (termsContainer && currentShopSettings.terms) {
        termsContainer.innerHTML = `<h4>Simplified Terms</h4><p>${currentShopSettings.terms.replace(/\\n/g, '<br>')}</p>`;
    }

    // --- THIS IS THE FIX ---\
    // Initialize Stripe *before* calling updateCheckoutDisplay
    try {
        stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
    } catch (err) {
        console.error("Failed to initialize Stripe:", err);
        alert(`Could not initialize payment system: ${err.message}.`);
        return;
    }
    // --- END FIX ---\

    // --- NEW: Ensure payment form is visible by default ---
    // updateCheckoutDisplay will hide it if the plan is paid
    const paymentForm = document.getElementById('payment-form');
    if (paymentForm) paymentForm.style.display = 'block';
    // --- END NEW ---

    // --- 2. Update UI (calculates tip and base amount due) ---\
    // This now updates module-level 'currentBaseAmount' and will create the payment element
    await updateCheckoutDisplay(); 
    tipAmountInput.addEventListener('input', debounce(async () => await updateCheckoutDisplay(), 500));

    // --- 3. Create Payment Intent (MOVED to updateCheckoutDisplay) ---\
    try {
        // --- 4. Call create-payment-intent (Happens in updateCheckoutDisplay) ---\
        // --- 5. Update UI with initial fees (Happens in updateCheckoutDisplay) ---\
        // --- 6. Create and Mount PaymentElement (Happens in updateCheckoutDisplay) ---\
        
        checkoutModalOverlay.cardElement = null; // Clear old reference

        // --- 8. Show Modal ---\
        checkoutModalOverlay.classList.add('active');
        setTimeout(() => {
            checkoutModalOverlay.style.display = 'flex';
            if(checkoutCloseBtn) checkoutCloseBtn.focus();
        }, 0); // <-- FIX: Removed stray \
        document.body.classList.add('modal-open');

    } catch (err) {
        // This catch block now only catches errors related to showing the modal,
        // as the payment init happens inside updateCheckoutDisplay
        console.error("Failed to show checkout modal:", err);
        alert(`Could not display checkout: ${err.message}.`);
        hideCheckoutModal();
    }
}

export function hideCheckoutModal() {
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    if (checkoutModalOverlay) {
        if (checkoutModalOverlay.removeEventListenerOnClick) {
            checkoutModalOverlay.removeEventListenerOnClick();
        }
        document.getElementById('tip-amount')?.removeEventListener('input', updateCheckoutDisplay);
        document.querySelectorAll('input[name="paymentChoice"]').forEach(radio => {
            radio.removeEventListener('change', updateCheckoutDisplay);
        });

        // --- ADD THIS ---\
        if (paymentElement) {
            paymentElement.unmount();
            paymentElement = null;
        }
        elements = null;
        currentClientSecret = null;
        currentBaseAmount = 0;
        currentProcessingFee = 0;
        // --- END ADD ---\

        checkoutModalOverlay.classList.remove('active');
        setTimeout(() => {
            const checkoutCloseBtn = document.getElementById('checkout-close-btn');
            if (checkoutCloseBtn) {
                checkoutCloseBtn.removeEventListener('click', hideCheckoutModal);
            }
            checkoutModalOverlay.style.display = 'none';
            log('Modal', 'Checkout modal hidden.');
        }, 300); // <-- FIX: Removed stray \
        document.body.classList.remove('modal-open');
    }
}

export function getStripeContext() {
    return { stripe, elements };
}
