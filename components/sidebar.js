// REPLACE THE ENTIRE CONTENTS OF: components/sidebar.js

import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from '../config.js';
import { parseOptions, getRecordPrice } from '../utils.js';
import { log } from '../utils/debug.js';

async function createFavoriteCardElement(record, itemInfo, imageCache) {
    const fields = record.fields;
    const itemCard = document.createElement('div');
    itemCard.className = `favorite-item lazy-load`;
    itemCard.dataset.recordId = record.id;
    let imageUrls = []; // Default to empty array
    try {
        const imageData = await api.fetchImagesForRecord(record, state.records.all, imageCache);
        imageUrls = imageData.imageUrls || [];
    } catch (error) {
        console.error(`Failed to fetch images for favorite card ${record.id}:`, error);
    }
    
    itemCard.dataset.bgImage = imageUrls[0] || `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_100,h_100/ww71meppejsewxsxr4x7.jpg`; // Smaller default/size

    const price = getRecordPrice(record, itemInfo.selectedOptionIndex); // Get unit price
    const tooltipContent = `
        <strong>${fields.Name || 'Untitled'}</strong><br>
        <small>${fields.Description || 'No description.'}</small><br>
        <strong>Price: $${(typeof price === 'number' ? price.toFixed(2) : 'N/A')}</strong>
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
    // Initialize Tippy after innerHTML is set
    tippy(itemCard.querySelector('.favorite-item-overlay'), {
        content: tooltipContent, // Use the variable, not the template literal again
        allowHTML: true,
        placement: 'top',
        theme: 'light', // Optional: Or use your preferred theme
    });
    return itemCard;
}


async function createLockedInItemElement(record, itemInfo) {
    const fields = record.fields;
    const itemElement = document.createElement('div');
    itemElement.className = 'locked-item-card';
    itemElement.dataset.recordId = record.id;
    let imageUrls = []; // Default to empty array
     try {
        const imageData = await api.fetchImagesForRecord(record, state.records.all, new Map()); // Use separate cache for sidebar?
        imageUrls = imageData.imageUrls || [];
    } catch (error) {
        console.error(`Failed to fetch images for locked item ${record.id}:`, error);
    }
    const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    let optionName = '';
    if (itemInfo.selectedOptionIndex != null && options[itemInfo.selectedOptionIndex]) {
        optionName = options[itemInfo.selectedOptionIndex].name;
    }

    const price = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);
    // Ensure quantity respects minimum headcount
    const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const effectiveQuantity = Math.max(itemInfo.quantity || 1, headcountMin);
    const validPrice = typeof price === 'number' && !isNaN(price) ? price : 0; // Ensure price is valid number
    const total = validPrice * effectiveQuantity;

    let priceDisplay = `$${validPrice.toFixed(2)}`;
    // If an override exists, show the original price for context
    if (itemInfo.overridePrice != null) {
        const originalPrice = getRecordPrice(record, itemInfo.selectedOptionIndex);
        const validOriginalPrice = typeof originalPrice === 'number' && !isNaN(originalPrice) ? originalPrice : 0;
        priceDisplay = `$${validPrice.toFixed(2)} <em class="price-original">(was $${validOriginalPrice.toFixed(2)})</em>`;
    }


    itemElement.innerHTML = `
        <img class="locked-item-thumbnail lazy-load" data-src="${imageUrls[0] || `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_60,h_60/ww71meppejsewxsxr4x7.jpg`}" alt="${fields.Name || ''}">
        <div class="locked-item-details">
            <p class="locked-item-name">${fields.Name || 'Untitled Item'}</p>
            ${optionName ? `<p class="locked-item-option">${optionName}</p>` : ''}
            <p class="locked-item-pricing">Qty ${effectiveQuantity} @ ${priceDisplay} = <strong>$${total.toFixed(2)}</strong></p>
            ${itemInfo.note ? `<p class="locked-item-note"><em>Note: ${itemInfo.note.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</em></p>` : ''}
        </div>
        <div class="locked-item-actions">
             <span class="locked-item-status-icon"></span> <button class="edit-btn">Edit</button>
            <button class="demote-locked-item-btn" title="Remove from Plan">Unsave</button>
        </div>
    `;
    return itemElement;
}

let isUpdatingEventPlan = false; // Flag to prevent overlapping updates

export async function updateEventPlanSection() {
    if (isUpdatingEventPlan) {
         log('Sidebar', 'Skipping updateEventPlanSection: Already updating.');
         return; // Prevent re-entry
    }
    isUpdatingEventPlan = true; // Set flag
    log('Sidebar', 'Updating event plan panel.');
    const container = document.getElementById('cart-items-container');
    if (!container) {
        console.error("Sidebar Error: cart-items-container not found.");
        isUpdatingEventPlan = false; // Reset flag on error exit
        return;
    }

    container.innerHTML = ''; // Clear existing items

    if (state.cart.lockedItems.size === 0) {
        container.innerHTML = `<p style="font-size: 0.9em; color: #6c757d; padding: 10px 0;">No items locked in yet.</p>`; // Added padding
        isUpdatingEventPlan = false; // Reset flag
        return;
    }

    // Use a document fragment for better performance
    const fragment = document.createDocumentFragment();
    // Create promises for all item elements
    const itemPromises = Array.from(state.cart.lockedItems.entries()).map(async ([recordId, itemInfo]) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            try {
                return await createLockedInItemElement(record, itemInfo);
            } catch (error) {
                 console.error(`Failed to create locked item element for ${recordId}:`, error);
                 return null; // Return null on error
            }
        }
        return null; // Return null if record not found
    });

    // Wait for all promises to resolve
    const itemElements = await Promise.all(itemPromises);

    // Append resolved elements to the fragment
    itemElements.forEach(itemElement => {
        if (itemElement) { // Only append if element was created successfully
            fragment.appendChild(itemElement);
        }
    });

    // Append the fragment to the container once
    container.appendChild(fragment);

    ui.observeLazyImages(container); // Observe newly added images
    ui.updateLockedItemStatusIcons(); // Update availability icons after rendering
    isUpdatingEventPlan = false; // Reset flag when done
}


export async function updateFavoritesCarousel() {
    log('Sidebar', `Updating favorites carousel with ${state.cart.items.size} items.`);
    const favoritesSection = document.getElementById('favorites-section');
    const favoritesCarousel = document.getElementById('favorites-carousel');
    if (!favoritesSection || !favoritesCarousel) return;

    if (state.cart.items.size === 0) {
        favoritesSection.style.display = 'none'; // Hide section if no favorites
        return;
    }
    favoritesSection.style.display = 'block'; // Show section if favorites exist
    favoritesCarousel.innerHTML = ''; // Clear existing items
    const imageCache = new Map(); // Local cache for this render pass

    // Create promises for all favorite card elements
    const cardPromises = Array.from(state.cart.items.entries()).map(async ([recordId, itemInfo]) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            try {
                return await createFavoriteCardElement(record, itemInfo, imageCache);
            } catch (error) {
                console.error(`Failed to create favorite card for ${record.fields?.Name || recordId}:`, error);
                return null;
            }
        }
        return null;
    });

    // Wait for all promises and append valid cards
    const cards = await Promise.all(cardPromises);
    const fragment = document.createDocumentFragment();
    cards.forEach(card => {
        if (card) fragment.appendChild(card);
    });
    favoritesCarousel.appendChild(fragment);

    ui.observeLazyImages(favoritesCarousel); // Observe new images
    // Note: updateTotalCost is usually called after this or after state changes trigger it
}


export function updateHeader() {
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    document.title = eventName || 'Event Builder'; // Set page title
    const eventNameInput = document.getElementById('header-event-name');
    if (eventNameInput) eventNameInput.value = eventName || ''; // Update input field
    
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
    
    // Ensure all required elements exist
    if (!totalCostEl || !subtotalCostEl || !amountPaidCostEl || !amountPaidRowEl || !totalDividerEl) {
         console.warn("One or more total cost elements not found in updateTotalCost.");
         return;
    }

    let subtotal = 0;
    state.cart.lockedItems.forEach((itemInfo, recordId) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record || !record.fields) return; // Skip if record missing

        const unitPrice = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);
        const validPrice = typeof unitPrice === 'number' && !isNaN(unitPrice) ? unitPrice : 0; // Ensure price is valid number
        
        // Ensure quantity respects minimum headcount for calculation
        const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        const effectiveQuantity = Math.max(itemInfo.quantity || 1, headcountMin);
        
        subtotal += validPrice * effectiveQuantity;
    });
    
    const amountReceived = state.session.user.amountReceived || 0;
    const totalDue = Math.max(0, subtotal - amountReceived); // Ensure total due isn't negative
    
    subtotalCostEl.textContent = `$${subtotal.toFixed(2)}`;
    totalCostEl.textContent = `$${totalDue.toFixed(2)}`;
    
    // Show/hide amount paid row
    if (amountReceived > 0) {
        amountPaidCostEl.textContent = `-$${amountReceived.toFixed(2)}`;
        amountPaidRowEl.style.display = 'flex';
        totalDividerEl.style.display = 'block';
    } else {
        amountPaidRowEl.style.display = 'none';
        totalDividerEl.style.display = 'none';
    }

    // Update mobile bar
    if (mobileItemCountEl && mobileTotalCostEl) {
        const itemCount = state.cart.lockedItems.size;
        mobileItemCountEl.textContent = `${itemCount} item${itemCount !== 1 ? 's' : ''}`;
        mobileTotalCostEl.textContent = `$${totalDue.toFixed(2)}`;
    }

    // Determine conditions for mobile bar and buttons
    const isPlanEmpty = state.cart.lockedItems.size === 0; // Check size instead of subtotal for emptiness
    const isFullyPaid = totalDue < 0.01 && amountReceived > 0; // Consider fully paid only if something was paid

    // Mobile bar visibility
    if (isPlanEmpty || isFullyPaid) {
        document.body.classList.remove('mobile-bar-active');
    } else {
        document.body.classList.add('mobile-bar-active');
    }
    
    // Checkout button logic
    const totalBreakdownEl = document.getElementById('total-breakdown'); // Get the container
    if (checkoutBtn && totalBreakdownEl) {
        checkoutBtn.style.display = 'block'; // Default visible
        totalBreakdownEl.style.display = 'block'; // Default visible
         // Clear any previous "Paid" message
        const paidMessage = totalBreakdownEl.querySelector('.paid-in-full-message');
        if(paidMessage) paidMessage.remove();

        if (isFullyPaid) {
            // If fully paid, hide button and show success message WITHIN the breakdown
            checkoutBtn.style.display = 'none';
            // Insert the message into the breakdown area
            const successSpan = document.createElement('span');
            successSpan.style.color = '#28a745';
            successSpan.style.fontWeight = 'bold';
            successSpan.style.fontSize = '1.4em';
            successSpan.textContent = '✅ Paid in Full';
            successSpan.className = 'paid-in-full-message'; // Add class for easy removal
            totalBreakdownEl.appendChild(successSpan); // Append the message
        } else if (amountReceived > 0) {
            // Partially paid
            checkoutBtn.textContent = 'Pay Remainder';
            checkoutBtn.disabled = false; // Always enabled if there's a remainder
        } else {
            // Not paid yet
            checkoutBtn.textContent = checkoutBtn.dataset.defaultText || 'Reserve';
            checkoutBtn.disabled = isPlanEmpty; // Disable only if plan is truly empty
        }
    } else if (checkoutBtn) {
         // Fallback if totalBreakdownEl is missing but button exists
         checkoutBtn.disabled = isPlanEmpty || isFullyPaid;
    }
    
    // Save/Share button logic
    if (saveShareBtn) {
        // Enable if not currently saving AND (plan has items OR details exist)
        const hasContent = !isPlanEmpty || state.eventDetails.combined.size > 0;
        saveShareBtn.disabled = state.ui.saveState === 'SAVING' || !hasContent;
    }
}


// This function might be redundant if updateTotalCost covers the "Paid in Full" state
// Consider merging its logic into updateTotalCost if displayReservedStatus is only called after payment.
// export function displayReservedStatus() {
//     const checkoutBtn = document.getElementById('checkout-btn');
//     const saveShareBtn = document.getElementById('save-share-btn');
//     const totalBreakdown = document.getElementById('total-breakdown');
//     if (totalBreakdown) {
//         totalBreakdown.innerHTML = '<span style="color: #28a745; font-weight: bold; font-size: 1.4em;">✅ Event Reserved</span>';
//     }
//     if (checkoutBtn) {
//         checkoutBtn.style.display = 'none';
//     }
//     if (saveShareBtn) {
//         saveShareBtn.disabled = false;
//     }
// }
