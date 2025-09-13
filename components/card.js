// FILE: components/card.js
import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from '../config.js';
import { parseOptions } from '../utils.js';
import { log } from '../utils/debug.js';

function getPlaceholderImage(imageUrls) {
    // Return a random image from the provided list, or a default if none exist.
    if (!imageUrls || imageUrls.length === 0) {
        return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg`;
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
        if (!icon) {
            log('Card', `No heart icon found for record: ${recordId}`);
            return;
        }
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
        icon.style.display = 'block'; // Ensure visibility

        log('Card', `Updated heart icon for record: ${recordId}, state: ${isLocked ? 'locked' : isHearted ? 'hearted' : 'default'}`);
    });
}

export async function createInteractiveCard(record, imageCache) {
    log('Card', `Creating card for "${record.fields.Name}"`);
    const fields = record.fields;
    const recordId = record.id;
    const allRecords = state.records.all;
    const itemState = ui.getMainGetItemState()(recordId);
    const rawOptions = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));

    const eventCard = document.createElement('div');
    eventCard.className = 'event-card';
    eventCard.dataset.recordId = recordId;

    // Call the API function to fetch images based on whether it's a grouping or bookable item
    const fetchedImages = await api.fetchImagesForRecord(record, allRecords, imageCache);
    // FIX: Ensure imageUrls is an array before attempting to access its elements.
    const imageUrls = fetchedImages?.imageUrls || [];

    const parentName = record?.fields?.[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
    const parentLinkHTML = parentName ? `<p class="parent-link" data-parent-name="${parentName}">⬆️ ${parentName}</p>` : '';

    let priceHTML = '';
    let footerHTML = '';
    let cardTooltip = '';
    
    // FIX: Access the first image safely
    let cardImageStyle = `background-image: url('${imageUrls.length > 0 ? imageUrls[0] : ''}');`;

    if (isGrouping) {
        log('Card', `Card for "${record.fields.Name}" is a grouping. Using a placeholder image.`);
        cardImageStyle = `background-image: url('${getPlaceholderImage(imageUrls)}')`;
        
        const range = ui.getGroupPriceRange(record);
        priceHTML = range ?
            (range.min === range.max ? `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`) : 'Price Varies';
        footerHTML = `
            <div class="card-footer">
                <div class="price">${priceHTML}</div>
                <button class="card-action-btn view-options-btn" title="View Options">View Options</button>
            </div>
        `;
        cardTooltip = `Explore the various items and pricing options in this category.`;
    } else {
        log('Card', `Card for "${record.fields.Name}" is a bookable item. Using the first fetched image.`);
        const headcountMin = fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        const isLocked = state.cart.lockedItems.has(recordId);
        const quantitySelectorHTML = `<div class="quantity-selector"><button class="quantity-btn minus" aria-label="Decrease quantity">-</button><input type="number" class="quantity-input" value="${itemState.quantity}" min="${headcountMin}"><button class="quantity-btn plus" aria-label="Increase quantity">+</button></div>`;
        let displayPrice = ui.getRecordPrice(record, itemState.selectedOptionIndex);
        priceHTML = `$${displayPrice.toFixed(2)}`;

        const addToPlanBtnHTML = `<button class="card-action-btn add-to-plan-btn" ${isLocked ?
            'disabled' : ''} data-tooltip="${isLocked ? 'Already in plan' : 'Add to plan'}">${isLocked ? 'In Plan' : 'Add to Plan'}</button>`;
        footerHTML = `
            <div class="card-footer">
                <div class="price-quantity-wrapper">
                    <div class="price">${priceHTML}</div>
                    ${quantitySelectorHTML}
                </div>
                ${addToPlanBtnHTML}
            </div>
        `;
        cardTooltip = `${fields.Description || 'No description.'} - Price: $${displayPrice.toFixed(2)}.`;
    }

    eventCard.innerHTML = `
        <div class="event-card-image-container" style="${cardImageStyle}">
            <div class="event-card-actions">
                <button class="action-btn availability-btn" title="Check Availability">📅</button>
            </div>
            <div class="heart-icon" data-record-id="${record.id}" data-tippy-content="Add to favorites"></div>
        </div>
        <div class="event-card-content" data-tippy-content="${cardTooltip}">
            ${parentLinkHTML}
            <h3>${fields[CONSTANTS.FIELD_NAMES.NAME] || 'Untitled Event'}</h3>
            <p class="description">${fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || ''}</p>
        </div>
        ${footerHTML}
    `;
    
    // FIX: The heart icon update needs to happen after the element is in the DOM
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
    // Initialize Tippy for the main card content and heart icon
    tippy(eventCard.querySelector('.event-card-content'), {
        content: cardTooltip,
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
