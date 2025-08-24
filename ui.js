/*
 * This module is responsible for all direct DOM manipulation.
 * It should not import from main.js.
 */
import { state } from './state.js';
import { CONSTANTS } from './config.js';
import { fetchImagesForRecord } from './api.js';
import { parseOptions } from './utils.js';

// --- DOM ELEMENT EXPORTS ---
export const catalogContainer = document.getElementById('catalog-container');
export const favoritesCarousel = document.getElementById('favorites-carousel');
export const headerEventNameInput = document.getElementById('header-event-name');
const loadingMessage = document.getElementById('loading-message');
const totalCostEl = document.getElementById('total-cost');
const favoritesSection = document.getElementById('favorites-section');
const filterControls = document.getElementById('filter-controls');

// --- HELPER & LOGIC FUNCTIONS ---
function getRecordPrice(record, optionIndex = null) {
    let price = parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
    if (optionIndex !== null) {
        const options = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const variation = options[optionIndex];
        if (variation) {
            if (variation.absolutePrice !== null) return variation.absolutePrice;
            if (variation.priceChange !== null) price += variation.priceChange;
        }
    }
    return price;
}

function getDescendantBookableItems(recordId, allRecords) {
    let bookableItems = [];
    const children = allRecords.filter(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]?.[0] === recordId);
    for (const child of children) {
        const rawOptions = parseOptions(child.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
        const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));
        if (isGrouping) {
            bookableItems = bookableItems.concat(getDescendantBookableItems(child.id, allRecords));
        } else {
            bookableItems.push(child);
        }
    }
    return bookableItems;
}

function getGroupPriceRange(record) {
    const descendants = getDescendantBookableItems(record.id, state.records.all);
    if (descendants.length === 0) return null;
    let minPrice = Infinity;
    let maxPrice = -Infinity;

    descendants.forEach(item => {
        const options = parseOptions(item.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        if (options.length > 0) {
            options.forEach((opt, index) => {
                const price = getRecordPrice(item, index);
                if (price < minPrice) minPrice = price;
                if (price > maxPrice) maxPrice = price;
            });
        } else {
            const price = getRecordPrice(item);
            if (price < minPrice) minPrice = price;
            if (price > maxPrice) maxPrice = price;
        }
    });
    return { min: minPrice, max: maxPrice };
}

// --- UI RENDERING FUNCTIONS ---
export async function createFavoriteCardElement(record, itemInfo, isLocked, imageCache) {
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

    const imageUrls = await fetchImagesForRecord(record, state.records.all, imageCache);
    itemCard.style.backgroundImage = `url('${imageUrls[0] || ''}')`;
    const cardActionsHTML = `<button class="action-btn remove-btn" title="Remove" data-composite-id="${record.id}">×</button>`;

    itemCard.innerHTML = `
        <div class="card-actions">${cardActionsHTML}</div>
        <div class="favorite-item-content">
            <p class="item-name">${fields[CONSTANTS.FIELD_NAMES.NAME]}</p>
            ${variationNameHTML}
            <p class="item-quantity">Qty: ${itemInfo.quantity}</p>
            ${noteHTML}
            <p class="item-price">$${itemPrice.toFixed(2)}</p>
        </div>`;
    return itemCard;
}

export async function createInteractiveCard(record, imageCache) {
    const fields = record.fields;
    const recordId = record.id;
    const allRecords = state.records.all;
    const rawOptions = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));

    const eventCard = document.createElement('div');
    eventCard.className = 'event-card';
    eventCard.dataset.recordId = recordId;

    const parentId = fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] ? fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM][0] : null;
    const parentButtonHTML = parentId ? `<button class="card-btn parent-btn" title="Go Up">⬆️</button>` : '';
    const explodeButtonHTML = isGrouping ? `<button class="card-btn explode-btn" title="Explode">💥</button>` : '';

    let optionsControlHTML = '';
    let notesHTML = '';
    let quantitySelectorHTML = '';
    let priceHTML = '';

    if (isGrouping) {
        optionsControlHTML = `<select class="options-selector navigate-options">
            <option value="">Select an option...</option>
            ${rawOptions.map(opt => `<option value="${opt.name}">${opt.name}</option>`).join('')}
        </select>`;
        const range = getGroupPriceRange(record);
        if (range) {
            priceHTML = range.min === range.max ? `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`;
        } else {
            priceHTML = 'From $0.00';
        }
    } else {
        const headcountMin = fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        optionsControlHTML = `<select class="options-selector configure-options">
             ${rawOptions.map((opt, index) => `<option value="${index}">${opt.name}</option>`).join('')}
        </select>`;
        notesHTML = `<textarea class="item-note" placeholder="Add a note..."></textarea>`;
        quantitySelectorHTML = `
            <div class="quantity-selector">
                <button class="quantity-btn minus" aria-label="Decrease quantity">-</button>
                <input type="number" class="quantity-input" value="${headcountMin}" min="${headcountMin}">
                <button class="quantity-btn plus" aria-label="Increase quantity">+</button>
            </div>`;
        const initialPrice = parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
        priceHTML = `$${initialPrice.toFixed(2)}`;
    }

    const isHearted = state.cart.items.has(recordId);

    eventCard.innerHTML = `
        <div class="card-header-actions">${parentButtonHTML}${explodeButtonHTML}</div>
        <div class="heart-icon ${isHearted ? 'hearted' : ''}" data-composite-id="${recordId}">
            <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
        </div>
        <div class="event-card-content">
            <h3>${fields[CONSTANTS.FIELD_NAMES.NAME] || 'Untitled Event'}</h3>
            <p class="description">${fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || ''}</p>
            ${rawOptions.length > 0 ? optionsControlHTML : ''}
            ${notesHTML}
            <div class="price-quantity-wrapper">
                <div class="price">${priceHTML}</div>
                ${quantitySelectorHTML}
            </div>
        </div>`;
    
    const plusBtn = eventCard.querySelector('.quantity-btn.plus');
    const minusBtn = eventCard.querySelector('.quantity-btn.minus');
    const quantityInput = eventCard.querySelector('.quantity-input');
    if (plusBtn && minusBtn && quantityInput) {
        plusBtn.addEventListener('click', () => { quantityInput.value = parseInt(quantityInput.value) + 1; });
        minusBtn.addEventListener('click', () => {
            const current = parseInt(quantityInput.value);
            const min = parseInt(quantityInput.min);
            if (current > min) {
                quantityInput.value = current - 1;
            }
        });
    }
    
    const imageUrls = await fetchImagesForRecord(record, state.records.all, imageCache);
    eventCard.style.backgroundImage = `url('${imageUrls[0] || ''}')`;
    return eventCard;
}

export async function renderRecords(recordsToRender, imageCache) {
    catalogContainer.innerHTML = '';
    const implodeContainer = document.getElementById('implode-container');
    if (implodeContainer) implodeContainer.remove();
    if (recordsToRender.length === 0) {
        catalogContainer.innerHTML = "<p style='text-align: center;'>No items to show.</p>";
        return;
    }
    for (const record of recordsToRender) {
        const eventCard = await createInteractiveCard(record, imageCache);
        if (eventCard) {
            catalogContainer.appendChild(eventCard);
        }
    }
}

export async function updateFavoritesCarousel() {
    if (state.cart.items.size === 0) {
        favoritesSection.style.display = 'none';
        return;
    }
    favoritesSection.style.display = 'block';
    favoritesCarousel.innerHTML = '';
    const imageCache = new Map();
    
    const sortedItems = Array.from(state.cart.items.entries());

    for (const [recordId, itemInfo] of sortedItems) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            const card = await createFavoriteCardElement(record, itemInfo, false, imageCache);
            if (card) favoritesCarousel.appendChild(card);
        }
    }
    updateTotalCost();
}

export function updateHeader() {
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Event Builder';
    document.title = eventName;
    headerEventNameInput.value = eventName;
}

export function updateTotalCost() {
    let total = 0;
    const allItems = new Map([...state.cart.items, ...state.cart.lockedItems]);
    allItems.forEach((itemInfo, recordId) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) return;
        const unitPrice = getRecordPrice(record, itemInfo.selectedOptionIndex);
        if (isNaN(unitPrice)) return;
        const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] ? parseInt(record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN]) : 1;
        const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, headcountMin);
        const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE]?.toLowerCase();
        let itemCost;
        if (pricingType === 'per hour' || pricingType === CONSTANTS.PRICING_TYPES.PER_GUEST) {
            itemCost = unitPrice * effectiveQuantity;
        } else {
            itemCost = unitPrice;
        }
        total += itemCost;
    });
    totalCostEl.textContent = `$${total.toFixed(2)}`;
}

export function toggleLoading(show) {
    loadingMessage.style.display = show ? 'block' : 'none';
    filterControls.style.display = show ? 'none' : 'flex';
}
