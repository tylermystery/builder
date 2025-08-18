/*
 * Version: 1.5.0
 * Last Modified: 2025-08-18
 *
 * Changelog:
 *
 * v1.5.0 - 2025-08-18
 * - `createEventCardElement` now builds an image gallery with navigation arrows.
 * - Image URLs are stored in a data attribute on the card for the gallery to use.
 *
 * v1.4.0 - 2025-08-18
 * - Refactored `parseOptions` to handle a robust key-value pair format.
 * - Updated `createEventCardElement` to display and dynamically update option-specific descriptions, prices, and durations.
 * - Updated `updateTotalCost` and `createFavoriteCardElement` to use the new price calculation logic.
 *
 * v1.3.0 - 2025-08-18
 * - Implemented logic to remove event cards from the catalog only after all their variations have been favorited.
 * - Event cards now auto-select the next available variation after one is favorited.
 *
 * v1.2.1 - 2025-08-17
 * - Fixed a critical HTML structure error in index.html.
 *
 * v1.2.0 - 2025-08-17
 * - Updated `updateFavoritesCarousel` to use the new unified sorting logic.
 * - Exported `parseOptions` for use in `main.js`.
 * - Exported the new `sortBy` dropdown element.
 *
 * v1.0.0 - 2025-08-17
 * - Initial versioning and changelog added.
 */

import { state } from './state.js';
import { CONSTANTS, EMOJI_REACTIONS } from './config.js';
import { fetchImagesForRecord } from './api.js';
import { calculateReactionScore, getRecordPrice } from './main.js';

// --- DOM ELEMENT EXPORTS ---
// ... (exports are unchanged) ...

// --- HELPER FUNCTIONS ---
// ... (parseOptions is unchanged) ...

// --- UI RENDERING FUNCTIONS ---
// ... (renderReactionsSummary, renderReactionbar are unchanged) ...

export async function createFavoriteCardElement(compositeId, itemInfo, isLocked, imageCache) {
    // ... (function is largely unchanged, but now uses fetchImagesForRecord) ...
    const record = state.records.all.find(r => r.id === compositeId.split('-')[0]);
    if (!record) return null;
    const fields = record.fields;
    let variationNameHTML = '';
    let itemPrice = getRecordPrice(record, compositeId.split('-')[1] || null);
    
    const optionIndex = compositeId.split('-')[1];
    if (optionIndex) {
        const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const variation = options[optionIndex];
        if (variation) {
            variationNameHTML = `<p class="variation-name">${variation.name}</p>`;
        }
    }

    const itemCard = document.createElement('div');
    itemCard.className = `favorite-item ${isLocked ? 'locked-item' : ''}`;
    itemCard.dataset.compositeId = compositeId;
    itemCard.dataset.recordId = record.id;
    const imageUrls = await fetchImagesForRecord(record, imageCache);
    itemCard.style.backgroundImage = `url('${imageUrls[0]}')`; // Use first image for favorites
    const primaryActionHTML = isLocked ? `<button class="primary-action-btn" title="Locked In">⛓️</button>` : `<button class="primary-action-btn promote-btn" data-composite-id="${compositeId}"><span class="icon-default">💘</span><span class="icon-hover">💍</span></button>`;
    const secondaryActionHTML = isLocked ? `<button class="secondary-action-btn demote-btn" data-composite-id="${compositeId}" title="Unlock">🔨</button>` : `<button class="secondary-action-btn remove-btn" data-composite-id="${compositeId}" title="Remove">💔</button>`;
    
    itemCard.innerHTML = `<div class="action-btn-container">${primaryActionHTML}</div><button class="edit-card-btn" data-composite-id="${compositeId}">🪄</button>${secondaryActionHTML}<div class="favorite-item-content"><p class="item-name">${fields[CONSTANTS.FIELD_NAMES.NAME]}</p>${variationNameHTML}<p class="item-quantity">Qty: ${itemInfo.quantity}</p><p class="item-price">$${itemPrice.toFixed(2)} ${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || ''}</p></div><div class="card-footer">${renderReactionsSummary(record.id)}</div>${renderReactionbar(record.id)}`;
    return itemCard;
}

export async function createEventCardElement(record, imageCache) {
    const fields = record.fields;
    const recordId = record.id;
    const headcountMin = fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const basePrice = fields[CONSTANTS.FIELD_NAMES.PRICE] ? parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE]).replace(/[^0-9.-]+/g, "")) : 0;
    const baseDuration = fields[CONSTANTS.FIELD_NAMES.DURATION] || 0;

    const eventCard = document.createElement('div');
    eventCard.className = 'event-card';
    eventCard.dataset.recordId = recordId;
    
    const imageUrls = await fetchImagesForRecord(record, imageCache);
    eventCard.dataset.imageUrls = JSON.stringify(imageUrls); // Store all URLs

    let optionsDropdownHTML = '';
    const availableOptions = options.filter((opt, index) => {
        const compositeId = `${recordId}-${index}`;
        return !state.cart.items.has(compositeId) && !state.cart.lockedItems.has(compositeId);
    });

    if (options.length > 0) {
        if (availableOptions.length === 0) {
            return null;
        }
        optionsDropdownHTML = `<select class="options-selector"> ${availableOptions.map(opt => {
            const originalIndex = options.findIndex(o => o.name === opt.name);
            return `<option value="${originalIndex}">${opt.name}</option>`;
        }).join('')} </select>`;
    }

    const firstAvailableOptionIndex = options.findIndex(opt => opt.name === availableOptions[0]?.name);
    const compositeId = options.length > 0 ? `${recordId}-${firstAvailableOptionIndex}` : recordId;
    const initialQuantity = Math.max(parseInt(guestCountInput.value), headcountMin);

    eventCard.innerHTML = `
        <div class="card-image-container"></div>
        <button class="card-arrow left">‹</button>
        <button class="card-arrow right">›</button>
        <button class="edit-card-btn">🪄</button>
        <div class="event-card-content">
            <div class="heart-icon" data-composite-id="${compositeId}">
                <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
            </div>
            <h3>${fields[CONSTANTS.FIELD_NAMES.NAME] || 'Untitled Event'}</h3>
            ${optionsDropdownHTML}
            <p class="option-description"></p>
            <p class="details"></p>
            <div class="price-quantity-wrapper">
                <div class="price" data-base-price="${basePrice}"></div>
                <div class="quantity-selector">
                    <button class="quantity-btn minus" aria-label="Decrease quantity">-</button>
                    <input type="number" class="quantity-input" value="${initialQuantity}" min="${headcountMin}">
                    <button class="quantity-btn plus" aria-label="Increase quantity">+</button>
                </div>
            </div>
        </div>
        <div class="card-footer">${renderReactionsSummary(recordId)}</div>
        ${renderReactionbar(recordId)}`;
    
    const dropdown = eventCard.querySelector('.options-selector');
    const heartIcon = eventCard.querySelector('.heart-icon');
    const quantityInput = eventCard.querySelector('.quantity-input');
    const plusBtn = eventCard.querySelector('.quantity-btn.plus');
    const minusBtn = eventCard.querySelector('.quantity-btn.minus');
    const priceEl = eventCard.querySelector('.price');
    const descriptionEl = eventCard.querySelector('.option-description');
    const detailsEl = eventCard.querySelector('.details');
    const imageContainer = eventCard.querySelector('.card-image-container');

    const currentImageIndex = state.ui.cardImageIndexes.get(recordId) || 0;
    imageContainer.style.backgroundImage = `url('${imageUrls[currentImageIndex]}')`;

    const updateCardDetails = () => {
        const selectedIndex = dropdown ? dropdown.value : null;
        const selectedOption = selectedIndex ? options[selectedIndex] : null;
        
        let currentPrice = basePrice;
        if (selectedOption) {
            if (selectedOption.absolutePrice !== null) {
                currentPrice = selectedOption.absolutePrice;
            } else if (selectedOption.priceChange !== null) {
                currentPrice += selectedOption.priceChange;
            }
        }
        priceEl.innerHTML = `$${currentPrice.toFixed(2)} <span style="font-size: 0.7em; font-weight: normal;">${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || ''}</span>`;

        descriptionEl.textContent = selectedOption?.description || '';
        descriptionEl.style.display = selectedOption?.description ? 'block' : 'none';

        let currentDuration = baseDuration;
        if (selectedOption && selectedOption.durationChange !== null) {
            currentDuration += selectedOption.durationChange;
        }
        detailsEl.textContent = currentDuration > 0 ? `Duration: ${currentDuration} hours` : '';

        const newCompositeId = selectedIndex ? `${recordId}-${selectedIndex}` : recordId;
        heartIcon.dataset.compositeId = newCompositeId;
        eventCard.querySelector('.edit-card-btn').dataset.compositeId = newCompositeId;
        heartIcon.classList.toggle('hearted', state.cart.items.has(newCompositeId) || state.cart.lockedItems.has(newCompositeId));
    };
    
    if (dropdown) {
        dropdown.addEventListener('change', updateCardDetails);
    }
    updateCardDetails();
    
    if (plusBtn) plusBtn.addEventListener('click', () => { quantityInput.value = parseInt(quantityInput.value) + 1; guestCountInput.value = quantityInput.value; });
    if (minusBtn) minusBtn.addEventListener('click', () => { const current = parseInt(quantityInput.value); const min = parseInt(quantityInput.min); if (current > min) { quantityInput.value = current - 1; guestCountInput.value = quantityInput.value; } });
    quantityInput.addEventListener('change', () => { const min = parseInt(quantityInput.min); if (parseInt(quantityInput.value) < min) { quantityInput.value = min; } guestCountInput.value = quantityInput.value; });

    return eventCard;
}

// ... (rest of the file is unchanged) ...
