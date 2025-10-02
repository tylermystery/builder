/* REPLACE THE ENTIRE CONTENTS OF: components/card.js */

import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS } from '../config.js';
import { parseOptions } from '../utils.js';
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

export async function createInteractiveCard(record, imageCache) {
    log('Card', `Creating card for "${record.fields.Name}"`);
    const fields = record.fields;
    const recordId = record.id;
    const allRecords = state.records.all;
    
    // --- MOVED TO TOP: This now runs for all card types ---
    const { imageUrls } = await api.fetchImagesForRecord(record, allRecords, imageCache);
    const imageUrlToLoad = imageUrls.length > 0 ? imageUrls[0] : '';

        // --- NEW LOGIC FOR GROUPING CARDS ---
    if (fields['Item Type'] === 'Grouping') {
        const groupingCard = document.createElement('div');
        groupingCard.className = 'event-card grouping-card'; // Add a new class for styling
        groupingCard.dataset.categoryName = fields.Name; // Store the category name

        // The footer will be different: no price, just a call to action.
        const footerHTML = `
            <div class="card-footer">
                <button class="card-action-btn view-options-btn">View Collection</button>
            </div>
        `;

        groupingCard.innerHTML = `
            <div class="event-card-image-container lazy-load" data-bg-image="${imageUrlToLoad}">
                </div>
            <div class="event-card-content">
                <h3>${fields.Name || 'Untitled Category'}</h3>
                <p class="description">${fields.Description || ''}</p>
            </div>
            ${footerHTML}
        `;
        return groupingCard;
    }

    // --- Check for the "Event" item type ---
    if (fields['Item Type'] === 'Event') {
        const eventCard = document.createElement('div');
        eventCard.className = 'event-card event-type-card';
        eventCard.dataset.recordId = recordId;

        const eventDate = fields['Event Date'] ? new Date(fields['Event Date']) : null;
        const month = eventDate ? eventDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() : 'TBD';
        const day = eventDate ? eventDate.getDate() : '';

        const priceText = (fields.Price && fields.Price > 0) ? `$${fields.Price.toFixed(2)}` : 'Free';

        const rsvpUserIds = fields.RSVPs || [];
        const hasRsvpd = state.session.user.isAuthenticated && rsvpUserIds.includes(state.session.user.id);
        const buttonText = hasRsvpd ? "You're Going! ✅" : "RSVP";
        const buttonDisabled = hasRsvpd ? "disabled" : "";

        eventCard.innerHTML = `
            <div class="event-card-image-container lazy-load" data-bg-image="${imageUrlToLoad}"></div>
            <div class="event-card-content">
                <div class="event-date-display">
                    <span class="month">${month}</span>
                    <span class="day">${day}</span>
                </div>
                <div class="event-details">
                    <h3>📅 ${fields.Name}</h3>
                    <p class="description">${fields.Description || ''}</p>
                </div>
            </div>
            <div class="card-footer">
                <div class="price">${priceText}</div>
                <button class="card-action-btn rsvp-btn" ${buttonDisabled}>${buttonText}</button>
            </div>
        `;
        return eventCard;
    }

    // --- Existing logic for standard and grouping cards ---
    const itemState = ui.getItemState(recordId);
    const rawOptions = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));

    const eventCard = document.createElement('div');
    eventCard.className = 'event-card';
    eventCard.dataset.recordId = recordId;

    const parentName = fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
    const parentLinkHTML = parentName ? `<p class="parent-link" data-parent-name="${parentName}">⬆️ ${parentName}</p>` : '';

    let footerHTML = '';
    let cardTooltipText = '';
    let cardImageStyle = '';

    if (isGrouping) {
        cardImageStyle = `background-image: url('${getPlaceholderImage(imageUrls)}')`;
        const range = ui.getGroupPriceRange(record);
        const priceHTML = range ? (range.min === range.max ? `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`) : 'Price Varies';
        footerHTML = `
            <div class="card-footer">
                <div class="price">${priceHTML}</div>
                <button class="card-action-btn view-options-btn" title="View Options">View Options</button>
            </div>
        `;
        cardTooltipText = `Explore the various items and pricing options in this category.`;
    } else {
        const headcountMin = fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        const isLocked = state.cart.lockedItems.has(recordId);
        const quantitySelectorHTML = `<div class="quantity-selector"><button class="quantity-btn minus" aria-label="Decrease quantity">-</button><input type="number" class="quantity-input" value="${itemState.quantity}" min="${headcountMin}"><button class="quantity-btn plus" aria-label="Increase quantity">+</button></div>`;
        const displayPrice = ui.getRecordPrice(record, itemState.selectedOptionIndex);
        const pricingType = fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
        const pricingTypeHTML = pricingType ? `<span class="pricing-type">/ ${pricingType.toLowerCase()}</span>` : '';
        const priceHTML = `$${displayPrice.toFixed(2)} ${pricingTypeHTML}`;
        const addToPlanBtnHTML = `<button class="card-action-btn add-to-plan-btn" ${isLocked ? 'disabled' : ''} data-tooltip="${isLocked ? 'Already in plan' : 'Add to Plan'}">${isLocked ? 'In Plan' : 'Add to Plan'}</button>`;
        
        footerHTML = `
            <div class="card-footer">
                <div class="price-wrapper"><div class="price">${priceHTML}</div></div>
                <div class="actions-wrapper">${quantitySelectorHTML}${addToPlanBtnHTML}</div>
            </div>
        `;
        cardTooltipText = `${fields.Description || 'No description.'} - Price: $${displayPrice.toFixed(2)}${pricingType ? ` ${pricingType.toLowerCase()}` : ''}.`;
    }

    eventCard.innerHTML = `
        <div class="event-card-image-container lazy-load" data-bg-image="${imageUrlToLoad}" style="${cardImageStyle}">
            <div class="event-card-actions">
                <button class="action-btn availability-btn" title="Check Availability">📅</button>
            </div>
            <div class="heart-icon" data-record-id="${record.id}" data-tippy-content="Add to favorites"></div>
        </div>
        <div class="event-card-content" data-tippy-content="${cardTooltipText}">
            ${parentLinkHTML}
            <h3>${fields.Name || 'Untitled Event'}</h3>
            <p class="description">${fields.Description || ''}</p>
        </div>
        ${footerHTML}
    `;

    setTimeout(() => {
        updateCardIcon(recordId);
    }, 0);
    
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
    }
    
    tippy(eventCard.querySelector('.event-card-content'), {
        content: cardTooltipText,
        allowHTML: true,
        placement: 'top',
        theme: 'light',
    });
    tippy(eventCard.querySelector('.heart-icon'), {
        content: 'Add to favorites',
        placement: 'top',
        theme: 'light',
    });

    return eventCard;
}
