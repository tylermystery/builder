import { state } from '../state.js';
import { CONSTANTS } from '../config.js';
import * as api from '../api.js';
import { parseOptions } from '../utils.js';
import { getGroupPriceRange, getRecordPrice, formatPricingType } from '../ui.js'; // We'll get these from the main ui.js hub
import { getItemState } from '../events.js';
import { log } from '../utils/debug.js';

export async function createInteractiveCard(record, imageCache) {
    log('Card', `Creating interactive card for "${record.fields.Name}"`);
    const fields = record.fields;
    const recordId = record.id;
    const allRecords = state.records.all;
    const itemState = getItemState(recordId);
    const rawOptions = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));

    const eventCard = document.createElement('div');
    eventCard.className = 'event-card';
    eventCard.dataset.recordId = recordId;

    const { imageUrls } = await api.fetchImagesForRecord(record, allRecords, imageCache);
    const parentName = record?.fields?.[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
    const parentLinkHTML = parentName ? `<p class="parent-link" data-parent-name="${parentName}">⬆️ ${parentName}</p>` : '';

    let priceHTML = '';
    let footerHTML = '';

    if (isGrouping) {
        const range = getGroupPriceRange(record);
        priceHTML = range ? (range.min === range.max ? `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`) : 'Price Varies';
        footerHTML = `
            <div class="card-footer">
                <div class="price">${priceHTML}</div>
                <button class="card-action-btn explode-btn" title="Explore Options">💥</button>
            </div>
        `;
    } else {
        const headcountMin = fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        const isLocked = state.cart.lockedItems.has(recordId);
        const quantitySelectorHTML = `<div class="quantity-selector"><button class="quantity-btn minus" aria-label="Decrease quantity">-</button><input type="number" class="quantity-input" value="${itemState.quantity}" min="${headcountMin}"><button class="quantity-btn plus" aria-label="Increase quantity">+</button></div>`;
        let displayPrice = getRecordPrice(record, itemState.selectedOptionIndex);
        priceHTML = `$${displayPrice.toFixed(2)}`;
        const addToPlanBtnHTML = `<button class="card-action-btn add-to-plan-btn" ${isLocked ? 'disabled' : ''}>${isLocked ? 'In Plan' : 'Add to Plan'}</button>`;
        footerHTML = `
            <div class="card-footer">
                <div class="price-quantity-wrapper">
                    <div class="price">${priceHTML}</div>
                    ${quantitySelectorHTML}
                </div>
                ${addToPlanBtnHTML}
            </div>
        `;
    }

    const heartSVG = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>`;
    const checkSVG = `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg>`;
    const isLockedIn = state.cart.lockedItems.has(recordId);
    const isHearted = state.cart.items.has(recordId);
    let iconClass = isLockedIn ? 'locked' : (isHearted ? 'hearted' : '');
    let iconSVG = isLockedIn ? checkSVG : heartSVG;

    eventCard.innerHTML = `
        <div class="event-card-image-container" style="background-image: url('${imageUrls[0] || ''}');">
            <div class="event-card-actions">
                <button class="action-btn availability-btn" title="Check Availability">📅</button>
            </div>
            <div class="heart-icon ${iconClass}" data-record-id="${record.id}">${iconSVG}</div>
        </div>
        <div class="event-card-content">
            ${parentLinkHTML}
            <h3>${fields[CONSTANTS.FIELD_NAMES.NAME] || 'Untitled Event'}</h3>
            <p class="description">${fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || ''}</p>
        </div>
        ${footerHTML}
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
    }

    return eventCard;
}

export async function createFavoriteCardElement(record, itemInfo, isLocked, imageCache) {
    log('Card', `Creating favorite card for "${record.fields.Name}"`);
    const fields = record.fields;
    let variationNameHTML = '';
    let itemPrice = getRecordPrice(record, itemInfo.selectedOptionIndex);
    let noteHTML = itemInfo.note ? `<p class="item-note-display"><em>Note: ${itemInfo.note}</em></p>` : '';
    const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    if (itemInfo.selectedOptionIndex != null && options[itemInfo.selectedOptionIndex]) {
        variationNameHTML = `<p class="variation-name">${options[itemInfo.selectedOptionIndex].name}</p>`;
    }

    const itemCard = document.createElement('div');
    itemCard.className = `favorite-item ${isLocked ? 'locked-item' : ''}`;
    itemCard.dataset.recordId = record.id;
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, imageCache);
    itemCard.style.backgroundImage = `url('${imageUrls[0] || ''}')`;
    const cardActionsHTML = `
        <button class="action-btn add-to-plan-btn" title="Add to Plan">+</button>
        <button class="action-btn remove-btn" title="Remove">×</button>
    `;
    const pricingType = fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const pricingTypeString = formatPricingType(pricingType);
    const showCardTotal = itemInfo.quantity > 1 && pricingTypeString;
    const cardTotal = itemPrice * itemInfo.quantity;
    itemCard.innerHTML = `
        <div class="card-actions">${cardActionsHTML}</div>
        <div class="favorite-item-content">
            <p class="item-name">${fields.Name}</p>
            ${variationNameHTML}
            ${noteHTML}
            <div class="favorite-pricing-details">
                <div class="pricing-line-item">
                    <span class="item-quantity">Qty: ${itemInfo.quantity}</span>
                    <span class="item-price">$${itemPrice.toFixed(2)} ${pricingTypeString}</span>
                </div>
                ${showCardTotal ? `<div class="pricing-line-item-total"><span class="item-total-price">Total: $${cardTotal.toFixed(2)}</span></div>` : ''}
            </div>
        </div>`;
    return itemCard;
}
