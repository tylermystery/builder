/*
 * Version: 2.7.0
 * Last Modified: 2025-08-26
 *
 * Changelog:
 *
 * v2.7.0 - 2025-08-26
 * - Added a placeholder button for availability status to the interactive card.
 *
 * v2.6.0 - 2025-08-24
 * - [cite_start]Removed parseOptions function (moved to utils.js). [cite: 159]
 * - [cite_start]Imported parseOptions from utils.js to break circular dependency. [cite: 160]
 *
 * v2.5.1 - 2025-08-23
 * - [cite_start]Moved price logic from main.js to fix circular dependency. [cite: 161]
 */

import { state } from './state.js';
import { CONSTANTS } from './config.js';
import { fetchImagesForRecord } from './api.js';
import { parseOptions } from './utils.js'; [cite_start]// IMPORT ADDED [cite: 162]

// --- DOM ELEMENT EXPORTS ---
export const catalogContainer = document.getElementById('catalog-container');
export const favoritesCarousel = document.getElementById('favorites-carousel');
export const headerEventNameInput = document.getElementById('header-event-name');
const loadingMessage = document.getElementById('loading-message');
const totalCostEl = document.getElementById('total-cost');
const favoritesSection = document.getElementById('favorites-section');
const filterControls = document.getElementById('filter-controls');
const headerSummary = document.getElementById('header-summary');

// --- HELPER & LOGIC FUNCTIONS ---
// parseOptions was removed from here

function getRecordPrice(record, optionIndex = null) {
    [cite_start]let price = parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, "")); [cite: 166]
    [cite_start]if (optionIndex !== null) { [cite: 166]
        [cite_start]const options = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]); [cite: 167]
        const variation = options[optionIndex];
        [cite_start]if (variation) { [cite: 167]
            [cite_start]if (variation.absolutePrice !== null) return variation.absolutePrice; [cite: 168]
            [cite_start]if (variation.priceChange !== null) price += variation.priceChange; [cite: 168]
        }
    }
    return price;
}

function getDescendantBookableItems(recordId, allRecords) {
    let bookableItems = [];
    [cite_start]const children = allRecords.filter(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]?.[0] === recordId); [cite: 170]
    [cite_start]for (const child of children) { [cite: 170]
        [cite_start]const rawOptions = parseOptions(child.fields[CONSTANTS.FIELD_NAMES.OPTIONS]); [cite: 171]
        [cite_start]const childRecordNames = new Set(allRecords.map(r => r.fields.Name)); [cite: 171]
        [cite_start]const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name)); [cite: 172]
        [cite_start]if (isGrouping) { [cite: 172]
            [cite_start]bookableItems = bookableItems.concat(getDescendantBookableItems(child.id, allRecords)); [cite: 173]
        } else {
            [cite_start]bookableItems.push(child); [cite: 174]
        }
    }
    return bookableItems;
}

function getGroupPriceRange(record) {
    const descendants = getDescendantBookableItems(record.id, state.records.all);
    [cite_start]if (descendants.length === 0) return null; [cite: 176]
    let minPrice = Infinity;
    let maxPrice = -Infinity;

    [cite_start]descendants.forEach(item => { [cite: 176]
        const options = parseOptions(item.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        if (options.length > 0) {
            options.forEach((opt, index) => {
                const price = getRecordPrice(item, index);
                if (price < minPrice) minPrice = price;
          
                [cite_start]if (price > maxPrice) maxPrice = price; [cite: 177]
            });
        } else {
            const price = getRecordPrice(item);
            if (price < minPrice) minPrice = price;
            if (price > maxPrice) maxPrice = price;
        }
    });
    [cite_start]return { min: minPrice, max: maxPrice }; [cite: 178]
}

// ... (rest of the file is unchanged)
// --- UI RENDERING FUNCTIONS ---
// --- NEW: Helper function to format pricing type for display ---
function formatPricingType(pricingType) {
    [cite_start]if (!pricingType) return ''; [cite: 179]
    // Default for flat rate
    const type = pricingType.toLowerCase();
    [cite_start]if (type === 'per guest') return '/ guest'; [cite: 180]
    [cite_start]if (type === 'per hour') return '/ hour'; [cite: 180]
    [cite_start]return ''; [cite: 181]
}

export async function createFavoriteCardElement(record, itemInfo, isLocked, imageCache) {
    [cite_start]const fields = record.fields; [cite: 182]
    let variationNameHTML = '';
    let itemPrice = getRecordPrice(record, itemInfo.selectedOptionIndex);
    let noteHTML = itemInfo.note ? [cite_start]`<p class="item-note-display"><em>Note: ${itemInfo.note}</em></p>` : ''; [cite: 183]
    [cite_start]const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]); [cite: 183]

    if (itemInfo.selectedOptionIndex != null && options[itemInfo.selectedOptionIndex]) {
        [cite_start]variationNameHTML = `<p class="variation-name">${options[itemInfo.selectedOptionIndex].name}</p>`; [cite: 184]
    }

    const itemCard = document.createElement('div');
    itemCard.className = `favorite-item ${isLocked ? 'locked-item' : ''}`;
    itemCard.dataset.recordId = record.id;
    [cite_start]const { imageUrls } = await fetchImagesForRecord(record, state.records.all, imageCache); [cite: 185]
    [cite_start]itemCard.style.backgroundImage = `url('${imageUrls[0] || ''}')`; [cite: 186]
    const cardActionsHTML = `<button class="action-btn remove-btn" title="Remove" data-composite-id="${record.id}">×</button>`;
    
    const pricingType = fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    [cite_start]const pricingTypeString = formatPricingType(pricingType); [cite: 187]
    [cite_start]const showCardTotal = itemInfo.quantity > 1 && pricingTypeString; [cite: 188]
    const cardTotal = itemPrice * itemInfo.quantity;
    itemCard.innerHTML = `
        <div class="card-actions">${cardActionsHTML}</div>
        <div class="favorite-item-content">
            <p class="item-name">${fields[CONSTANTS.FIELD_NAMES.NAME]}</p>
            ${variationNameHTML}
            ${noteHTML}
            <div class="favorite-pricing-details">
                <div class="pricing-line-item">
             
                    [cite_start]<span class="item-quantity">Qty: ${itemInfo.quantity}</span> [cite: 189]
                    <span class="item-price">$${itemPrice.toFixed(2)} ${pricingTypeString}</span>
                </div>
                [cite_start]${showCardTotal ? [cite: 190]
                `
                <div class="pricing-line-item-total">
                    <span class="item-total-price">Total: $${cardTotal.toFixed(2)}</span>
                </div>
                ` : ''}
            </div>
        </div>`;
    [cite_start]return itemCard; [cite: 191]
}
export async function createInteractiveCard(record, imageCache) {
    const fields = record.fields;
    const recordId = record.id;
    [cite_start]const allRecords = state.records.all; [cite: 192]
    const rawOptions = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    [cite_start]const childRecordNames = new Set(allRecords.map(r => r.fields.Name)); [cite: 193]
    [cite_start]const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name)); [cite: 193]

    const eventCard = document.createElement('div');
    eventCard.className = 'event-card';
    eventCard.dataset.recordId = recordId;
    [cite_start]const parentId = fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] ? fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM][0] : null; [cite: 194]
    const parentButtonHTML = parentId ? [cite_start]`<button class="card-btn parent-btn" title="Go Up">⬆️</button>` : ''; [cite: 195]
    const explodeButtonHTML = isGrouping ? [cite_start]`<button class="card-btn explode-btn" title="Explode">💥</button>` : ''; [cite: 195]
    const availabilityButtonHTML = `<button class="card-btn availability-btn" title="Check Availability">📅</button>`;

    let optionsControlHTML = '';
    [cite_start]let notesHTML = ''; [cite: 196]
    [cite_start]let quantitySelectorHTML = ''; [cite: 196]
    [cite_start]let priceHTML = ''; [cite: 196]

    if (isGrouping) {
        optionsControlHTML = `<select class="options-selector navigate-options">
            <option value="">Select an option...</option>
            ${rawOptions.map(opt => `<option value="${opt.name}">${opt.name}</option>`).join('')}
        </select>`;
        [cite_start]const range = getGroupPriceRange(record); [cite: 197]
        if (range) {
            [cite_start]priceHTML = range.min === range.max ? [cite: 198]
                `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`;
        } else {
            [cite_start]priceHTML = 'From $0.00'; [cite: 199]
        }
    } else {
        const headcountMin = fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || [cite_start]1; [cite: 200]
        optionsControlHTML = `<select class="options-selector configure-options">
             ${rawOptions.map((opt, index) => `<option value="${index}">${opt.name}</option>`).join('')}
        [cite_start]</select>`; [cite: 201]
        [cite_start]notesHTML = `<textarea class="item-note" placeholder="Add a note..."></textarea>`; [cite: 201]
        quantitySelectorHTML = `
            <div class="quantity-selector">
                <button class="quantity-btn minus" aria-label="Decrease quantity">-</button>
                <input type="number" class="quantity-input" value="${headcountMin}" min="${headcountMin}">
                <button class="quantity-btn plus" aria-label="Increase quantity">+</button>
            </div>`;
        [cite_start]const initialPrice = parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, "")); [cite: 202]
        priceHTML = `$${initialPrice.toFixed(2)}`;
    }

    [cite_start]const isHearted = state.cart.items.has(recordId); [cite: 203]
    eventCard.innerHTML = `
        <div class="card-header-actions">${availabilityButtonHTML}${parentButtonHTML}${explodeButtonHTML}</div>
        <div class="heart-icon ${isHearted ? 'hearted' : ''}" data-composite-id="${recordId}">
            <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
        </div>
        <div class="event-card-content">
         
            <h3>${fields[CONSTANTS.FIELD_NAMES.NAME] || [cite_start]'Untitled Event'}</h3> [cite: 204]
            [cite_start]<p class="description">${fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || [cite: 205]
                ''}</p>
            [cite_start]${rawOptions.length > 0 ? [cite: 206]
                optionsControlHTML : ''}
            ${notesHTML}
            <div class="price-quantity-wrapper">
                <div class="price">${priceHTML}</div>
                ${quantitySelectorHTML}
            </div>
        </div>`;
    [cite_start]const plusBtn = eventCard.querySelector('.quantity-btn.plus'); [cite: 207]
    [cite_start]const minusBtn = eventCard.querySelector('.quantity-btn.minus'); [cite: 208]
    [cite_start]const quantityInput = eventCard.querySelector('.quantity-input'); [cite: 208]
    [cite_start]if (plusBtn && minusBtn && quantityInput) { [cite: 208]
        [cite_start]plusBtn.addEventListener('click', () => { quantityInput.value = parseInt(quantityInput.value) + 1; }); [cite: 209]
        [cite_start]minusBtn.addEventListener('click', () => { [cite: 209]
            const current = parseInt(quantityInput.value);
            const min = parseInt(quantityInput.min);
            if (current > min) {
                quantityInput.value = current - 1;
            }
        });
    }
    
    [cite_start]const imageUrls = await fetchImagesForRecord(record, state.records.all, imageCache); [cite: 210]
    [cite_start]console.log(`Checking record: "${fields.Name}". Is it a grouping (from API)?`, isGrouping, imageUrls); [cite: 211]
    eventCard.style.backgroundImage = `url('${imageUrls[0] || ''}')`;
    [cite_start]return eventCard; [cite: 212]
}

export async function renderRecords(recordsToRender, imageCache) {
    catalogContainer.innerHTML = '';
    const implodeContainer = document.getElementById('implode-container');
    [cite_start]if (implodeContainer) implodeContainer.remove(); [cite: 213]
    [cite_start]if (recordsToRender.length === 0) { [cite: 213]
        [cite_start]catalogContainer.innerHTML = "<p style='text-align: center;'>No items to show.</p>"; [cite: 214]
        return;
    }
    for (const record of recordsToRender) {
        const eventCard = await createInteractiveCard(record, imageCache);
        [cite_start]if (eventCard) { [cite: 215]
            [cite_start]catalogContainer.appendChild(eventCard); [cite: 216]
        }
    }
}

export async function updateFavoritesCarousel() {
    if (state.cart.items.size === 0) {
        [cite_start]favoritesSection.style.display = 'none'; [cite: 217]
        return;
    }
    favoritesSection.style.display = 'block';
    favoritesCarousel.innerHTML = '';
    const imageCache = new Map();
    
    [cite_start]const sortedItems = Array.from(state.cart.items.entries()); [cite: 218]
    for (const [recordId, itemInfo] of sortedItems) {
        const record = state.records.all.find(r => r.id === recordId);
        [cite_start]if (record) { [cite: 219]
            const card = await createFavoriteCardElement(record, itemInfo, false, imageCache);
            [cite_start]if (card) favoritesCarousel.appendChild(card); [cite: 220]
        }
    }
    [cite_start]updateTotalCost(); [cite: 221]
}

export function updateHeader() {
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Event Builder';
    document.title = eventName;
    [cite_start]headerEventNameInput.value = eventName; [cite: 222]
}

export function updateTotalCost() {
    let total = 0;
    [cite_start]const allItems = new Map([...state.cart.items, ...state.cart.lockedItems]); [cite: 223]
    allItems.forEach((itemInfo, recordId) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) return;
        const unitPrice = getRecordPrice(record, itemInfo.selectedOptionIndex);
        if (isNaN(unitPrice)) return;
        const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] ? parseInt(record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN]) : 1;
        const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, headcountMin);
        const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE]?.toLowerCase();
        let itemCost;
 
        
        [cite_start]if (pricingType === 'per hour' || pricingType === CONSTANTS.PRICING_TYPES.PER_GUEST) { [cite: 224]
            itemCost = unitPrice * effectiveQuantity;
        } else {
            itemCost = unitPrice;
        }
        total += itemCost;
    });
    [cite_start]totalCostEl.textContent = `$${total.toFixed(2)}`; [cite: 225]
}

export function toggleLoading(show) {
    loadingMessage.style.display = show ? 'block' : 'none';
    filterControls.style.display = show ? [cite_start]'none' : 'flex'; [cite: 226]
}
