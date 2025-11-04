// REPLACE THE ENTIRE CONTENTS of components/sidebar.js

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
    itemCard.innerHTML = `
        <div class=\"card-actions\">\
            <button class=\"action-btn add-to-plan-btn\" title=\"Add to Plan\">+</button>
            <button class=\"action-btn remove-btn\" title=\"Remove\">×</button>
        </div>
        <div class=\"favorite-item-overlay\"\
            data-tippy-content=\"${tooltipContent.replace(/\"/g, '&quot;')}\"\
        >\
            <span class=\"favorite-item-name\">${fields.Name || 'Untitled'}</span>
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


// --- THIS FUNCTION IS CORRECTED ---
async function createLockedInItemElement(record, itemInfo) {
    const fields = record.fields;
    let isCustomItem = record.id.startsWith('custom-');
    
    // --- THIS IS THE FIX for the 404 error ---
    // Default to your main placeholder, which we know exists
    let imageUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_60,h_60/ww71meppejsewxsxr4x7.jpg`;
    // --- END THE FIX ---

    if (!isCustomItem) {
        // --- EXISTING LOGIC for real items ---
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
    const total = price * itemInfo.quantity;
    let priceDisplay = `$${price.toFixed(2)}`;
    
    if (isCustomItem && itemInfo.overridePrice == null && price > 0) {
        priceDisplay = `$${price.toFixed(2)} (Est.)`;
    }
    
    if (itemInfo.overridePrice != null) {
        let originalPrice = getRecordPrice(record, itemInfo.selectedOptionIndex);
        priceDisplay = `$${price.toFixed(2)} <em class="price-original">(was $${originalPrice.toFixed(2)})</em>`;
    }

    itemElement.innerHTML = `
        <img class="locked-item-thumbnail lazy-load" data-src="${imageUrl}" alt="${fields.Name}">
        <div class="locked-item-details">
            <p class="locked-item-name">${fields.Name}</p>
            ${optionName ? `<p class="locked-item-option">${optionName}</p>` : ''}
            <p class="locked-item-pricing">Qty ${itemInfo.quantity} @ ${priceDisplay} = <strong>$${total.toFixed(2)}</strong></p>
            ${itemInfo.note ? `<p class="locked-item-note"><em>Note: ${itemInfo.note}</em></p>` : ''}
        </div>
        <div class="locked-item-actions">
            ${!isCustomItem ? '<button class="edit-btn">Edit</button>' : ''}
            <button class="demote-locked-item-btn" title="Remove from Plan">Unsave</button>
        </div>
    `;
    return itemElement;
}
// --- END CORRECTED FUNCTION ---


// --- THIS FUNCTION IS CORRECTED ---
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
            const itemElement = await createLockedInItemElement(record, itemInfo); // Pass the full record
            container.appendChild(itemElement);
        } else {
            log('Sidebar', `Could not render item ${recordId}, it was not found in state.records.all.`);
        }
    }
    ui.observeLazyImages(container);
}
// --- END CORRECTED FUNCTION ---


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

// --- THIS FUNCTION IS CORRECTED ---
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
    if (!totalCostEl || !subtotalCostEl) return;

    let subtotal = 0;
    state.cart.lockedItems.forEach((itemInfo, recordId) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) return;
        
        const unitPrice = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);
        if (isNaN(unitPrice)) return;
        
        const minHeadcount = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, minHeadcount);
        
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
        amountPaidCostEl.textContent = `-$${amountReceived.toFixed(2)}`;
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
    const isFullyPaid = totalDue <= 0.009;

    if (isPlanEmpty || isFullyPaid) {
        document.body.classList.remove('mobile-bar-active');
    } else {
        document.body.classList.add('mobile-bar-active');
    }
    
    if (checkoutBtn) {
        checkoutBtn.style.display = 'block';
        document.getElementById('total-breakdown').style.display = 'block';

        if (isFullyPaid) {
            checkoutBtn.style.display = 'none';
            if (amountReceived > 0) {
                document.getElementById('total-breakdown').innerHTML = '<span style=\"color: #28a745; font-weight: bold; font-size: 1.4em;\">✅ Paid in Full</span>';
            }
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
}
// --- END CORRECTED FUNCTION ---

export function displayReservedStatus() {
    const checkoutBtn = document.getElementById('checkout-btn');
    const saveShareBtn = document.getElementById('save-share-btn');
    const totalBreakdown = document.getElementById('total-breakdown');
    if (totalBreakdown) {
        totalBreakdown.innerHTML = '<span style=\"color: #28a745; font-weight: bold; font-size: 1.4em;\">✅ Event Reserved</span>';
    }
    if (checkoutBtn) {
        checkoutBtn.style.display = 'none';
    }
    if (saveShareBtn) {
        saveShareBtn.disabled = false;
    }
}
