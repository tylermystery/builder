// REPLACE THE ENTIRE CONTENTS OF: components/sidebar.js

import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from '../config.js';
import { parseOptions, getRecordPrice } from '../utils.js';
import { log } from '../utils/debug.js';
import * as backgroundEngine from './backgroundEngine.js';

async function createFavoriteCardElement(record, itemInfo, imageCache) {
    const fields = record.fields;
    const itemCard = document.createElement('div');
    itemCard.className = `favorite-item lazy-load`;
    itemCard.dataset.recordId = record.id;
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, imageCache);
    
    itemCard.dataset.bgImage = imageUrls[0] || `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg`;

    const price = getRecordPrice(record, itemInfo.selectedOptionIndex);
    const tooltipContent = `
        <strong>${fields.Name || 'Untitled'}</strong><br>
        <small>${fields.Description || 'No description.'}</small><br>
        <strong>Price: $${price.toFixed(2)}</strong>
    `;
    
    // --- FIX: RE-ADDING MISSING BUTTON HTML TO FAVORITE ITEM CARD ---
    itemCard.innerHTML = `
        <div class="card-actions">
            <button class="action-btn add-to-plan-btn" title="Add to Plan">+</button>
            <button class="action-btn remove-btn" title="Remove from Ideas">×</button>
        </div>
        <div class="favorite-item-overlay"
            data-tippy-content="${tooltipContent.replace(/"/g, '&quot;')}"
        >
            <span class="favorite-item-name">${fields.Name || 'Untitled'}</span>
        </div>
    `;
    // --- END FIX ---
    
    tippy(itemCard.querySelector('.favorite-item-overlay'), {
        content: tooltipContent,
        allowHTML: true,
        placement: 'top',
        theme: 'light',
    });
    return itemCard;
}


// In: components/sidebar.js (Replace the existing createLockedInItemElement function)

async function createLockedInItemElement(record, itemInfo) {
    const fields = record.fields;
    const itemElement = document.createElement('div');
    itemElement.className = 'locked-item-card';
    itemElement.dataset.recordId = record.id;
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    let optionName = '';
    if (itemInfo.selectedOptionIndex != null && options[itemInfo.selectedOptionIndex]) {
        optionName = options[itemInfo.selectedOptionIndex].name;
    }

    const price = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);
    const total = price * itemInfo.quantity;
    let priceDisplay = `$${price.toFixed(2)}`;
    if (itemInfo.overridePrice != null) {
        const originalPrice = getRecordPrice(record, itemInfo.selectedOptionIndex);
        priceDisplay = `$${price.toFixed(2)} <em class="price-original">(was $${originalPrice.toFixed(2)})</em>`;
    }

    // --- REVISED: Updated buttons to Pencil and Minus Sign ---
    itemElement.innerHTML = `
        <img class="locked-item-thumbnail lazy-load" data-src="${imageUrls[0] || `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg`}" alt="${fields.Name}">
        <div class="locked-item-details">
            <p class="locked-item-name">${fields.Name}</p>
            ${optionName ? `<p class="locked-item-option">${optionName}</p>` : ''}
            <p class="locked-item-pricing">Qty ${itemInfo.quantity} @ ${priceDisplay} = <strong>$${total.toFixed(2)}</strong></p>
            ${itemInfo.note ? `<p class="locked-item-note"><em>Note: ${itemInfo.note}</em></p>` : ''}
        </div>
        <div class="locked-item-actions">
            <button class="edit-btn" title="Edit Item Details">✏️</button>
            <button class="demote-locked-item-btn" title="Demote to Ideas (Minus Sign)">—</button>
        </div>
    `;
    // --- END REVISED ---
    
    // Attach the event listener directly here for simplicity and robustness
    itemElement.querySelector('.edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        log('Sidebar', `Edit button (✏️) clicked for ${fields.Name}. Opening modal.`);
        ui.showDetailModal(record);
    });

    itemElement.querySelector('.demote-locked-item-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        log('Sidebar', `Demote button (—) clicked for ${fields.Name}. Removing from plan.`);
        // Note: The actual removal logic is handled by the main events.js listener
        e.target.dispatchEvent(new Event('click', { bubbles: true }));
    });
    
    return itemElement;
}


export async function updateEventPlanSection() {
    log('Sidebar', 'Updating event plan panel.');
    const container = document.getElementById('cart-items-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (state.cart.lockedItems.size === 0) {
        container.innerHTML = `<p style="font-size: 0.9em; color: #6c757d;">No items locked in yet.</p>`;
        return;
    }

    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            const itemElement = await createLockedInItemElement(record, itemInfo);
            container.appendChild(itemElement);
        }
    }
    ui.observeLazyImages(container);
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
    document.title = eventName || 'Event Builder';
    const eventNameInput = document.getElementById('header-event-name');
    if (eventNameInput) eventNameInput.value = eventName;
    
    const goalsInput = document.getElementById('header-goals');
    if(goalsInput) goalsInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
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
    const totalBreakdown = document.getElementById('total-breakdown'); 
    
    if (!totalCostEl || !subtotalCostEl || !totalBreakdown) return;

    let subtotal = 0;
    state.cart.lockedItems.forEach((itemInfo, recordId) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) return;
        const unitPrice = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);
        if (isNaN(unitPrice)) return;
        const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1);
        subtotal += unitPrice * effectiveQuantity;
    });
    
    const amountReceived = state.session.user.amountReceived || 0;
    const totalDue = subtotal - amountReceived;
    
    subtotalCostEl.textContent = `$${subtotal.toFixed(2)}`;
    totalCostEl.textContent = `$${totalDue.toFixed(2)}`;
    
    if (typeof backgroundEngine.updateColors === 'function') {
        backgroundEngine.updateColors();
    }
    
    // Reset total breakdown HTML before applying status logic
    totalBreakdown.innerHTML = `
        <div class="total-row subtotal-row">
            <span>Subtotal:</span>
            <span id="subtotal-cost">$${subtotal.toFixed(2)}</span>
        </div>
        <div class="total-row amount-paid-row" style="display: none;">
            <span>Amount Paid:</span>
            <span id="amount-paid-cost">$0.00</span>
        </div>
        <hr class="total-divider" style="display: none;">
        <div class="total-row final-total-row">
            <strong>Total Due:</strong>
            <strong id="total-cost">$${totalDue.toFixed(2)}</strong>
        </div>
    `;

    if (amountReceived > 0) {
        // Re-get the elements after reset
        const currentAmountPaidCostEl = totalBreakdown.querySelector('#amount-paid-cost');
        const currentAmountPaidRowEl = totalBreakdown.querySelector('.amount-paid-row');
        const currentTotalDividerEl = totalBreakdown.querySelector('.total-divider');
        
        if (currentAmountPaidCostEl) currentAmountPaidCostEl.textContent = `-$${amountReceived.toFixed(2)}`;
        if (currentAmountPaidRowEl) currentAmountPaidRowEl.style.display = 'flex';
        if (currentTotalDividerEl) currentTotalDividerEl.style.display = 'block';
    }

    if (mobileItemCountEl && mobileTotalCostEl) {
        const itemCount = state.cart.lockedItems.size;
        mobileItemCountEl.textContent = `${itemCount} item${itemCount !== 1 ? 's' : ''}`;
        mobileTotalCostEl.textContent = `$${totalDue.toFixed(2)}`;
    }

    const isPlanEmpty = subtotal === 0;
    const isFullyPaid = totalDue <= 0.009;

    if (isPlanEmpty || isFullyPaid) {
        document.body.classList.remove('mobile-bar-active');
    } else {
        document.body.classList.add('mobile-bar-active');
    }
    
    if (checkoutBtn) {
        // --- START FIX: Ensure button is always enabled if plan is not empty ---
        const hasContent = state.cart.lockedItems.size > 0;

        if (hasContent) {
            checkoutBtn.style.display = 'block';
            checkoutBtn.disabled = false; // Always enable if content exists

            if (isFullyPaid) {
                // Display 'Paid in Full' status and set button text to 'View Summary'
                totalBreakdown.innerHTML = '<span style="color: #28a745; font-weight: bold; font-size: 1.4em;">✅ Paid in Full</span>';
                checkoutBtn.textContent = 'View Summary';
                checkoutBtn.dataset.defaultText = 'View Summary'; // Set default text for consistency
            } else if (amountReceived > 0) {
                checkoutBtn.textContent = 'Pay Remainder';
                checkoutBtn.dataset.defaultText = 'Reserve';
            } else {
                checkoutBtn.textContent = checkoutBtn.dataset.defaultText || 'Reserve';
                checkoutBtn.dataset.defaultText = 'Reserve';
            }
        } else {
            // Plan is empty
            checkoutBtn.style.display = 'block';
            checkoutBtn.textContent = checkoutBtn.dataset.defaultText || 'Reserve';
            checkoutBtn.disabled = true;
        }
        // --- END FIX ---
    }
    if (saveShareBtn) {
        saveShareBtn.disabled = isPlanEmpty && state.ui.saveState !== 'SAVING';
    }
}

export function displayReservedStatus() {
    const checkoutBtn = document.getElementById('checkout-btn');
    const saveShareBtn = document.getElementById('save-share-btn');
    const totalBreakdown = document.getElementById('total-breakdown');
    
    if (totalBreakdown) {
        totalBreakdown.innerHTML = '<span style="color: #28a745; font-weight: bold; font-size: 1.4em;">✅ Event Reserved</span>';
    }
    if (checkoutBtn) {
        checkoutBtn.style.display = 'block'; 
        checkoutBtn.textContent = 'View Summary'; // Changed from 'Reserve' to 'View Summary'
        checkoutBtn.disabled = false;
    }
    if (saveShareBtn) {
        saveShareBtn.disabled = false;
    }
}
