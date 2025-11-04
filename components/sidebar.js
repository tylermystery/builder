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
    
    // FIX: Re-adding the missing action buttons for Ideas carousel
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
    
    tippy(itemCard.querySelector('.favorite-item-overlay'), {
        content: tooltipContent,
        allowHTML: true,
        placement: 'top',
        theme: 'light',
    });
    return itemCard;
}


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

    // --- REVISED: Updated buttons to Pencil and Minus Sign (with correct icons/tooltips) ---
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
    
    // FIX: The edit button logic is now robust against duplicate clicks
    itemElement.querySelector('.edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        log('Sidebar', `Edit button (✏️) clicked for ${fields.Name}. Opening modal.`);
        ui.showDetailModal(record);
    });

    // FIX: The demote button listener is REMOVED from here to prevent infinite recursion.
    // The global listener in events.js now handles demote/remove based on the class 'demote-locked-item-btn'.
    
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
    // FIX: Event listeners were moved directly inside createLockedInItemElement for edit button
    // The demote button relies on the single global listener in events.js for the demote-locked-item-btn class.
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

// In: components/sidebar.js
// Action: REPLACE the entire `updateTotalCost` function

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
    
    // --- NEW: Get Concierge Fee elements ---
    const conciergeFeeRowEl = document.getElementById('concierge-fee-row');
    const conciergeFeeCostEl = document.getElementById('concierge-fee-cost');
    const CONCIERGE_FEE_PERCENT = 0.15; // 15% Fee - You can change this
    // --- END NEW ---
    
    if (!totalCostEl || !subtotalCostEl) return;

    let subtotal = 0;
    let partnerItemSubtotal = 0; // --- NEW: Track partner item cost ---

    state.cart.lockedItems.forEach((itemInfo, recordId) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) return; // Item not found (shouldn't happen)

        let price = 0;
        let isPartnerItem = false;

        price = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex); //
        
        // Check if it's a Partner Activity (from AI or curated list)
        if (record.fields.ServiceType === 'Partner Activity') {
            isPartnerItem = true;
        }
        
        if (isNaN(price)) return;
        
        // Use the quantity from the itemInfo, not the record's min headcount
        const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, 1);
        const itemTotal = price * effectiveQuantity;
        
        subtotal += itemTotal;
        
        if (isPartnerItem) {
            partnerItemSubtotal += itemTotal; // Add to partner total
        }
    });
    
    // --- NEW: Calculate and Display Fee ---
    let conciergeFee = 0;
    if (partnerItemSubtotal > 0) {
        conciergeFee = partnerItemSubtotal * CONCIERGE_FEE_PERCENT;
        conciergeFeeCostEl.textContent = `$${conciergeFee.toFixed(2)}`;
        conciergeFeeRowEl.style.display = 'flex';
    } else {
        conciergeFeeRowEl.style.display = 'none';
    }
    // --- END NEW ---
    
    const amountReceived = state.session.user.amountReceived || 0;
    const totalWithFee = subtotal + conciergeFee; // --- NEW: Add fee to total ---
    const totalDue = totalWithFee - amountReceived;
    
    subtotalCostEl.textContent = `$${subtotal.toFixed(2)}`;
    totalCostEl.textContent = `$${totalDue.toFixed(2)}`;
    
    // --- (This logic remains the same from your file) ---
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
            checkoutBtn.disabled = isPlanEmpty;
        }
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
