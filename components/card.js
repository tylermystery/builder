// FILE: components/card.js
/*
* Version: 4.0.0
* Last Modified: 2025-09-11
* Changelog:
* v4.0.0 - 2025-09-11
* - Refactored to import helper functions from utils.js instead of ui.js to fix a circular dependency.
*/
import { state } from '../state.js';
import * as api from '../api.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from '../config.js';
import { parseOptions, getGroupPriceRange, getRecordPrice } from '../utils.js';
import { log } from '../utils/debug.js';
import { getMainGetItemState, updateCardIcon } from '../ui.js';

function getPlaceholderImage(imageUrls) {
    // Return a random image from the provided list, or a default if none exist.
    if (!imageUrls || imageUrls.length === 0) {
        return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg`;
    }
    const randomIndex = Math.floor(Math.random() * imageUrls.length);
    return imageUrls[randomIndex];
}

export async function createInteractiveCard(record, imageCache) {
    log('Card', `Creating card for "${record.fields.Name}"`);
    const fields = record.fields;
    const recordId = record.id;
    const allRecords = state.records.all;
    const itemState = getMainGetItemState()(recordId);
    const rawOptions = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));

    const eventCard = document.createElement('div');
    eventCard.className = 'event-card';
    eventCard.dataset.recordId = recordId;

    const fetchedImages = await api.fetchImagesForRecord(record, allRecords, imageCache);
    const imageUrls = fetchedImages?.imageUrls || [];
    const parentName = record?.fields?.[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
    const parentLinkHTML = parentName ? `<p class="parent-link" data-parent-name="${parentName}">⬆️ ${parentName}</p>` : '';

    let priceHTML = '';
    let footerHTML = '';
    let cardTooltip = '';
    
    let cardImageStyle = `background-image: url('${imageUrls.length > 0 ? imageUrls[0] : ''}');`;
    if (isGrouping) {
        log('Card', `Card for "${record.fields.Name}" is a grouping. Using a placeholder image.`);
        cardImageStyle = `background-image: url('${getPlaceholderImage(imageUrls)}')`;
        
        const range = getGroupPriceRange(record);
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
        let displayPrice = getRecordPrice(record, itemState.selectedOptionIndex);
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
