/*
 * Version: 2.2.0
 * Last Modified: 2025-08-23
 *
 * Changelog:
 *
 * v2.2.0 - 2025-08-23
 * - Added real-time price/description updates to configurable cards.
 * - Added a notes field to Bookable Item cards.
 * - Updated favorite cards to display saved notes and configurations.
 */

import { state } from './state.js';
import { CONSTANTS, EMOJI_REACTIONS } from './config.js';
import { fetchImagesForRecord } from './api.js';
import { calculateReactionScore, getRecordPrice, updateRender, recordStateForUndo, handleReaction } from './main.js';

// --- DOM ELEMENT EXPORTS ---
export const catalogContainer = document.getElementById('catalog-container');
export const favoritesCarousel = document.getElementById('favorites-carousel');
export const nameFilter = document.getElementById('name-filter');
export const priceFilter = document.getElementById('price-filter');
export const sortBy = document.getElementById('sort-by');
export const headerEventNameInput = document.getElementById('header-event-name');
export const headerDateInput = document.getElementById('header-date');
export const headerHeadcountInput = document.getElementById('header-headcount');
export const headerGoalsInput = document.getElementById('header-goals');
const loadingMessage = document.getElementById('loading-message');
const totalCostEl = document.getElementById('total-cost');
const favoritesSection = document.getElementById('favorites-section');
const modalOverlay = document.getElementById('edit-modal');
const modalContent = document.querySelector('#edit-modal .modal-content');
const modalBody = document.getElementById('modal-body');

// --- HELPER FUNCTIONS ---
export function parseOptions(optionsText) {
    if (!optionsText) return [];
    return optionsText.split('\n').map(line => {
        const parts = line.split(',').map(p => p.trim());
        const option = {
            name: parts[0],
            priceChange: null,
            absolutePrice: null,
            durationChange: null,
            description: null
        };

        parts.slice(1).forEach(part => {
            const [key, ...valueParts] = part.split(':').map(p => p.trim());
            const value = valueParts.join(':');

            switch (key.toLowerCase()) {
                case 'price change':
                    option.priceChange = parseFloat(value.replace(/[^0-9.-]+/g, '')) || 0;
                    break;
                case 'price':
                    option.absolutePrice = parseFloat(value.replace(/[^0-9.-]+/g, '')) || 0;
                    break;
                case 'duration change':
                    option.durationChange = parseFloat(value.replace(/[^0-9.-]+/g, '')) || 0;
                    break;
                case 'description':
                    option.description = value.replace(/"/g, '');// Remove quotes
                    break;
            }
        });
        return option;
    });
}

// --- UI RENDERING FUNCTIONS ---
export async function createFavoriteCardElement(record, itemInfo, isLocked, imageCache) {
    const fields = record.fields;
    let variationNameHTML = '';
    let itemPrice = parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
    let noteHTML = itemInfo.note ? `<p class="item-note-display"><em>Note: ${itemInfo.note}</em></p>` : '';

    if (itemInfo.selectedOptionIndex != null) {
        const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const variation = options[itemInfo.selectedOptionIndex];
        if (variation) {
            variationNameHTML = `<p class="variation-name">${variation.name}</p>`;
            // Adjust price based on the selected variation
            if (variation.absolutePrice != null) {
                itemPrice = variation.absolutePrice;
            } else if (variation.priceChange != null) {
                itemPrice += variation.priceChange;
            }
        }
    }

    const itemCard = document.createElement('div');
    itemCard.className = `favorite-item ${isLocked ? 'locked-item' : ''}`;
    itemCard.dataset.recordId = record.id;

    const imageUrls = await fetchImagesForRecord(record, imageCache);
    itemCard.style.backgroundImage = `url('${imageUrls[0] || ''}')`;

    const cardActionsHTML = `<button class="action-btn remove-btn" title="Remove" data-composite-id="${record.id}">×</button>`;

    itemCard.innerHTML = `
        <div class="card-actions">${cardActionsHTML}</div>
        <div class="favorite-item-content">
            <p class="item-name">${fields[CONSTANTS.FIELD_NAMES.NAME]}</p>
            ${variationNameHTML}
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
    if (isGrouping) {
        optionsControlHTML = `<select class="options-selector navigate-options">
            <option value="">Select an option...</option>
            ${rawOptions.map(opt => `<option value="${opt.name}">${opt.name}</option>`).join('')}
        </select>`;
    } else {
        optionsControlHTML = `<select class="options-selector configure-options">
             ${rawOptions.map((opt, index) => `<option value="${index}">${opt.name}</option>`).join('')}
        </select>`;
        notesHTML = `<textarea class="item-note" placeholder="Add a note..."></textarea>`;
    }

    const initialPrice = parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));

    eventCard.innerHTML = `
        <div class="card-header-actions">
            ${parentButtonHTML}
            ${explodeButtonHTML}
        </div>
        <div class="heart-icon" data-composite-id="${recordId}">
            <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
        </div>
        <div class="event-card-content">
            <h3>${fields[CONSTANTS.FIELD_NAMES.NAME] || 'Untitled Event'}</h3>
            <p class="description">${fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || ''}</p>
            ${rawOptions.length > 0 ? optionsControlHTML : ''}
            ${notesHTML}
            <div class="price-quantity-wrapper">
                <div class="price">$${initialPrice.toFixed(2)}</div>
            </div>
        </div>`;

    // Add event listener for real-time updates on configurable cards
    if (!isGrouping) {
        const optionsSelector = eventCard.querySelector('.configure-options');
        if (optionsSelector) {
            optionsSelector.addEventListener('change', () => {
                const selectedIndex = parseInt(optionsSelector.value, 10);
                const selectedOption = rawOptions[selectedIndex];
                let newPrice = initialPrice;
                if (selectedOption) {
                    if (selectedOption.absolutePrice != null) {
                        newPrice = selectedOption.absolutePrice;
                    } else if (selectedOption.priceChange != null) {
                        newPrice += selectedOption.priceChange;
                    }
                }
                eventCard.querySelector('.price').textContent = `$${newPrice.toFixed(2)}`;
                eventCard.querySelector('.description').textContent = selectedOption.description || fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || '';
            });
        }
    }
    
    const imageUrls = await fetchImagesForRecord(record, imageCache);
    eventCard.style.backgroundImage = `url('${imageUrls[0] || ''}')`;
    return eventCard;
}

export async function renderRecords(recordsToRender, imageCache) {
    catalogContainer.innerHTML = ''; // Clear existing cards before rendering new ones
    if (recordsToRender.length === 0) {
        catalogContainer.innerHTML = "<p style='text-align: center; width: 100%;'>No items match the current filters.</p>";
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
    
    const sorter = ([idA], [idB]) => {
        const recordA = state.records.all.find(r => r.id === idA);
        const recordB = state.records.all.find(r => r.id === idB);
        if (!recordA || !recordB) return 0;
        return (recordA.fields[CONSTANTS.FIELD_NAMES.NAME] || '').localeCompare(recordB.fields[CONSTANTS.FIELD_NAMES.NAME] || '');
    };

    const sortedItems = Array.from(state.cart.items.entries()).sort(sorter);

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

        let unitPrice = getRecordPrice(record, itemInfo.selectedOptionIndex);
        if (isNaN(unitPrice)) return;

        total += unitPrice;
    });

    const formattedTotal = `$${total.toFixed(2)}`;
    totalCostEl.textContent = formattedTotal;
}

export async function openDetailModal(recordId, imageCache) {
    const record = state.records.all.find(r => r.id === recordId);
    if (!record) return;

    const modalCard = await createInteractiveCard(record, imageCache);
    modalBody.innerHTML = '';
    modalBody.appendChild(modalCard);

    modalContent.style.backgroundImage = modalCard.style.backgroundImage;
    modalOverlay.style.display = 'flex';

    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            modalOverlay.style.display = 'none';
        }
    });
}
