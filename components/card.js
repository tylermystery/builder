// REPLACE THE ENTIRE CONTENTS OF: components/card.js

import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS } from '../config.js';
import { getRecordPrice } from '../utils.js'; // <-- UPDATED
import { log } from '../utils/debug.js';

function getPlaceholderImage(imageUrls) {
    if (!imageUrls || imageUrls.length === 0) {
        return `https://res.cloudinary.com/${CONSTANTS.CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg`;
    }
    const randomIndex = Math.floor(Math.random() * imageUrls.length);
    return imageUrls[randomIndex];
}

export function updateCardIcon(recordId) {
    const isLocked = state.cart.lockedItems.has(recordId);
    const isHearted = state.cart.items.has(recordId);
    const heartSVG = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>`;
    const checkSVG = `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg>`;
    document.querySelectorAll(`.event-card[data-record-id="${recordId}"] .heart-icon, #modal-heart-btn[data-record-id="${recordId}"]`).forEach(icon => {
        if (!icon) return;
        if (isLocked) {
            icon.className = 'heart-icon locked';
            icon.innerHTML = checkSVG;
        } else if (isHearted) {
            icon.className = 'heart-icon hearted';
            icon.innerHTML = heartSVG;
        } else {
            icon.className = 'heart-icon';
            icon.innerHTML = heartSVG;
        }
        icon.style.display = 'block';
    });
}

export async function createInteractiveCard(record, allRecords, imageCache) {
    log('Card', `Creating card for "${record.fields.Name}"`);
    const eventCard = document.createElement('div');
    eventCard.dataset.recordId = record.id;
    const fields = record.fields;

    const { imageUrls } = await api.fetchImagesForRecord(record, allRecords, imageCache);
    const imageUrlToLoad = getPlaceholderImage(imageUrls);

    if (fields['Item Type'] === 'Grouping') {
        const groupingCard = eventCard;
        groupingCard.className = 'event-card grouping-card';
        groupingCard.dataset.categoryName = fields.Name;
        const groupingNameForFilter = fields.Name.toLowerCase();
        const childItems = allRecords.filter(r => {
            if (r.fields['Item Type'] !== 'Bookable Item' && r.fields['Item Type'] !== 'Event') return false;
            const itemCategories = (r.fields.Categories || '')
                .split(',')
                .map(cat => cat.trim().toLowerCase());
            return itemCategories.includes(groupingNameForFilter);
        });

        const imagePromises = childItems.slice(0, 4).map(item => api.fetchImagesForRecord(item, allRecords, new Map()));
        const imageResults = await Promise.all(imagePromises);
        const collageImages = imageResults.flatMap(res => res.imageUrls);

        let imageContainerHTML = `<div class="event-card-image-container collage-container">`; // Removed lazy-load from container
        if (collageImages.length > 0) {
            imageContainerHTML += collageImages.slice(0, 4).map(url => `<div class="collage-image lazy-load" data-bg-image="${url}"></div>`).join('');
        } else {
            imageContainerHTML += `<div class="collage-image lazy-load" data-bg-image="${imageUrlToLoad}"></div>`; // Keep lazy load on individual images
        }
        imageContainerHTML += `</div>`;
        groupingCard.innerHTML = `
            ${imageContainerHTML}
            <div class="event-card-content">
                <h3>${fields.Name || 'Untitled Category'}</h3>
                <p class="description">${fields.Description || ''}</p>
            </div>
            <div class="card-footer">
                <button class="card-action-btn view-options-btn">View Collection (${childItems.length})</button>
            </div>
        `;
        return groupingCard;
    }


    if (fields['Item Type'] === 'Event') {
        eventCard.className = 'event-card event-type-card';
        const eventDate = fields.Date ? new Date(fields.Date) : null;
        const month = eventDate ? eventDate.toLocaleString('default', { month: 'short' }).toUpperCase() : 'TBD';
        const day = eventDate ? eventDate.getDate() : '??';
        const hasRsvpd = (record.fields.RSVPs || []).includes(state.session.user.id);
        const buttonText = hasRsvpd ? "You're Going! ✅" : 'RSVP';
        const rsvpButtonHTML = `<button class="card-action-btn rsvp-btn" ${hasRsvpd ? 'disabled' : ''}>${buttonText}</button>`;

        eventCard.innerHTML = `
            <div class="event-card-image-container lazy-load" data-bg-image="${imageUrlToLoad}">
                <div class="heart-icon" data-record-id="${record.id}"></div>
            </div>
            <div class="event-card-content">
                <div class="event-date-display">
                    <span class="month">${month}</span>
                    <span class="day">${day}</span>
                </div>
                <div class="event-details">
                    <h3>${fields.Name || 'Untitled Event'}</h3>
                    <p class="description">${fields.Description || ''}</p>
                </div>
            </div>
            <div class="card-footer">
                ${rsvpButtonHTML}
            </div>
        `;
        setTimeout(() => updateCardIcon(record.id), 0);
        return eventCard;
    }

    eventCard.className = 'event-card';
    const itemState = ui.getItemState(record.id);
    const headcountMin = fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const unitPrice = getRecordPrice(record, itemState.selectedOptionIndex); // Renamed for clarity
    const pricingType = fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const isLocked = state.cart.lockedItems.has(record.id);
    // Ensure quantity respects minimum on initial render
    const initialQuantity = Math.max(itemState.quantity || 1, headcountMin);
    const quantitySelectorHTML = `<div class="quantity-selector"><button class="quantity-btn minus">-</button><input type="number" class="quantity-input" value="${initialQuantity}" min="${headcountMin}"><button class="quantity-btn plus">+</button></div>`;


    // --- Updated Price HTML Logic ---
    let priceHTML = '';
    if (headcountMin > 1 && typeof unitPrice === 'number' && unitPrice > 0) {
        const minimumTotalPrice = unitPrice * headcountMin;
        // --- Updated String Logic ---
        const pluralTypeLabel = pricingType && pricingType.toLowerCase().includes('guest') ? 'guests' : 'items'; // Use 'guests' or 'items'
        priceHTML = `$${minimumTotalPrice.toFixed(2)} <span class="pricing-type">minimum for ${headcountMin} ${pluralTypeLabel}</span>`;
        // --- End Update ---
    } else if (typeof unitPrice === 'number') {
        const pricingTypeHTML = pricingType ? `<span class="pricing-type"> / ${pricingType.toLowerCase()}</span>` : '';
        priceHTML = `$${unitPrice.toFixed(2)}${pricingTypeHTML}`;
    } else {
        priceHTML = 'N/A'; // Handle cases where price might not be a number
    }
    // --- End Update ---

    const addToPlanBtnHTML = `<button class="card-action-btn add-to-plan-btn" ${isLocked ? 'disabled' : ''}>${isLocked ? 'In Plan' : 'Add to Plan'}</button>`;
    eventCard.innerHTML = `
        <div class="event-card-image-container lazy-load" data-bg-image="${imageUrlToLoad}">
            <div class="heart-icon" data-record-id="${record.id}"></div>
        </div>
        <div class="event-card-content">
            <h3>${fields.Name || 'Untitled Event'}</h3>
            <p class="description">${fields.Description || ''}</p>
        </div>
        <div class="card-footer">
            <div class="price-wrapper"><div class="price">${priceHTML}</div></div>
            <div class="actions-wrapper">${quantitySelectorHTML}${addToPlanBtnHTML}</div>
        </div>
    `;
    const plusBtn = eventCard.querySelector('.quantity-btn.plus');
    const minusBtn = eventCard.querySelector('.quantity-btn.minus');
    const quantityInput = eventCard.querySelector('.quantity-input');
    if (plusBtn && minusBtn && quantityInput) {
        plusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            quantityInput.stepUp();
            quantityInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        minusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            quantityInput.stepDown();
            quantityInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
         // Add change listener to enforce min value directly on input change
        quantityInput.addEventListener('change', (e) => {
            e.stopPropagation(); // Prevent card click
            const min = parseInt(e.target.min, 10);
            if (parseInt(e.target.value, 10) < min) {
                e.target.value = min; // Correct value if manually typed below min
            }
             // Ensure the event bubbles up for state updates in events.js
            e.target.dispatchEvent(new CustomEvent('change', { bubbles: true }));
        });
    }

    setTimeout(() => updateCardIcon(record.id), 0);
    return eventCard;
}
