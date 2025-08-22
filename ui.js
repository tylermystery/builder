/*
 * Version: 1.8.6
 * Last Modified: 2025-08-21
 *
 * Changelog:
 *
 * v1.8.6 - 2025-08-21
 * - Replaced emoji buttons on favorite cards with clearer SVG icons for lock and remove actions.
 *
 * v1.8.5 - 2025-08-21
 * - Removed obsolete updateSummaryToolbar function.
 * - Exported new header input elements.
 *
 * v1.8.4 - 2025-08-21
 * - Removed updateHistoryButtons function as part of MVP cleanup.
 *
 * v1.8.3 - 2025-08-19
 * - Removed disclaimer tooltips from autosave-toggle and sessions-dropdown as features are now complete.
 *
 * v1.8.2 - 2025-08-19
 * - Made modal changes (option, quantity) auto-apply to state on change, removed save button, call updateRender to reflect in catalog/favorites.
 *
 * v1.8.1 - 2025-08-19
 * - Added reactions bar and hearting functionality to detailed modal view, mirroring catalog.
 *
 * v1.8.0 - 2025-08-18
 * - Enhanced `openDetailModal` to include full description, editable options/quantity, and save button to apply changes to state/cart.
 *
 * v1.7.0 - 2025-08-18
 * - Fixed total cost calculation to multiply variation price by quantity (hours for per-hour, guests for per-guest).
 * - Added disclaimer tooltip to autosave-toggle and sessions-dropdown.
 *
 * v1.6.0 - 2025-08-18
 * - Enhanced `updateTotalCost` to ensure accurate pricing with variations and quantity, including min headcount enforcement.
 * - Added breakdown tooltip to total cost display.
 *
 * v1.5.0 - 2025-08-18
 * - Implemented image gallery functionality for event cards, favorite items, and modals.
 * - Updated to use `fetchImagesForRecord` for retrieving multiple images.
 * - Added gallery arrow buttons and cycling logic using `state.ui.cardImageIndexes`.
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
import { calculateReactionScore, getRecordPrice, updateRender, recordStateForUndo, handleReaction } from './main.js';

// SVG Icons for buttons
const ICON_LOCK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z"/></svg>`;
const ICON_UNLOCK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6H5v2h2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H9V10h9v10z"/></svg>`;
const ICON_REMOVE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
const ICON_LOCKED_IN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`;


// --- DOM ELEMENT EXPORTS ---
export const catalogContainer = document.getElementById('catalog-container');
export const favoritesCarousel = document.getElementById('favorites-carousel');
export const nameFilter = document.getElementById('name-filter');
export const priceFilter = document.getElementById('price-filter');
export const durationFilter = document.getElementById('duration-filter');
export const statusFilter = document.getElementById('status-filter');
export const sortBy = document.getElementById('sort-by');
export const guestCountInput = document.getElementById('guest-count');
// New Header Inputs
export const headerEventNameInput = document.getElementById('header-event-name');
export const headerDateInput = document.getElementById('header-date');
export const headerHeadcountInput = document.getElementById('header-headcount');
export const headerGoalsInput = document.getElementById('header-goals');

export const stickyHeader = document.getElementById('sticky-header');
const loadingMessage = document.getElementById('loading-message');
const totalCostEl = document.getElementById('total-cost');
const favoritesSection = document.getElementById('favorites-section');
const headerSummary = document.getElementById('header-summary');
const collaboratorsSection = document.getElementById('collaborators-section');
export const sessionsDropdownContainer = document.getElementById('sessions-dropdown-container');
export const sessionsDropdown = document.getElementById('sessions-dropdown');
const filterControls = document.getElementById('filter-controls');
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
                    option.priceChange
                    = parseFloat(value.replace(/[^0-9.-]+/g, '')) || 0;
                    break;
                case 'price':
                    option.absolutePrice = parseFloat(value.replace(/[^0-9.-]+/g, '')) || 0;
                    break;
                case 'duration change':
                    option.durationChange = parseFloat(value.replace(/[^0-9.-]+/g, '')) || 0;
                    break;
                case 'description':
                    option.description = value.replace(/"/g, '');
// Remove quotes
                    break;
            }
        });
        return option;
    });
}

// --- UI RENDERING FUNCTIONS ---
function renderReactionsSummary(recordId) {
    const reactions = state.session.reactions.get(recordId) || {};
    const reactionCounts = Object.values(reactions).reduce((acc, emoji) => {
        acc[emoji] = (acc[emoji] || 0) + 1;
        return acc;
    }, {});
    return `<div class="reactions-summary">${Object.entries(reactionCounts).map(([emoji, count]) => `<div class="reaction-pill" title="${emoji}">${emoji} ${count}</div>`).join('')}</div>`;
}

function renderReactionbar(recordId) {
    return `<div class="reaction-bar">${EMOJI_REACTIONS.map(emoji => `<button data-record-id="${recordId}" data-emoji="${emoji}">${emoji}</button>`).join('')}</div>`;
}

export async function createFavoriteCardElement(compositeId, itemInfo, isLocked, imageCache) {
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
    if (!state.ui.cardImageIndexes.has(record.id)) {
        state.ui.cardImageIndexes.set(record.id, 0);
    }
    let currentIndex = state.ui.cardImageIndexes.get(record.id);
    itemCard.style.backgroundImage = `url('${imageUrls[currentIndex] || ''}')`;
    
    const primaryActionHTML = isLocked 
        ? `<button class="action-btn locked-btn" title="Locked In">${ICON_LOCKED_IN}</button>` 
        : `<button class="action-btn promote-btn" title="Lock it in" data-composite-id="${compositeId}">${ICON_LOCK}</button>`;
    const secondaryActionHTML = isLocked 
        ? `<button class="action-btn demote-btn" title="Unlock" data-composite-id="${compositeId}">${ICON_UNLOCK}</button>` 
        : `<button class="action-btn remove-btn" title="Remove" data-composite-id="${compositeId}">${ICON_REMOVE}</button>`;

    itemCard.innerHTML = `<div class="card-actions">${primaryActionHTML}${secondaryActionHTML}</div><div class="favorite-item-content"><p class="item-name">${fields[CONSTANTS.FIELD_NAMES.NAME]}</p>${variationNameHTML}<p class="item-quantity">Qty: ${itemInfo.quantity}</p><p class="item-price">$${itemPrice.toFixed(2)} ${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || ''}</p></div><div class="card-footer">${renderReactionsSummary(record.id)}</div>${renderReactionbar(record.id)}<button class="gallery-arrow left">←</button><button class="gallery-arrow right">→</button>`;
    
    const leftArrow = itemCard.querySelector('.gallery-arrow.left');
    const rightArrow = itemCard.querySelector('.gallery-arrow.right');
    if (imageUrls.length > 1) {
        leftArrow.addEventListener('click', () => {
            currentIndex = (currentIndex - 1 + imageUrls.length) % imageUrls.length;
            state.ui.cardImageIndexes.set(record.id, currentIndex);
            itemCard.style.backgroundImage = `url('${imageUrls[currentIndex]}')`;
        });
        rightArrow.addEventListener('click', () => {
            currentIndex = (currentIndex + 1) % imageUrls.length;
            state.ui.cardImageIndexes.set(record.id, currentIndex);
            itemCard.style.backgroundImage = `url('${imageUrls[currentIndex]}')`;
        });
    } else {
        leftArrow.style.display = 'none';
        rightArrow.style.display = 'none';
    }

    return itemCard;
}

export async function createEventCardElement(record, imageCache) {
    const fields = record.fields;
    const recordId = record.id;
    const headcountMin = fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const basePrice = fields[CONSTANTS.FIELD_NAMES.PRICE] ?
        parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE]).replace(/[^0-9.-]+/g, "")) : 0;
    const baseDuration = fields[CONSTANTS.FIELD_NAMES.DURATION] || 0;

    const eventCard = document.createElement('div');
    eventCard.className = 'event-card';
    eventCard.dataset.recordId = recordId;
    const imageUrls = await fetchImagesForRecord(record, imageCache);
    if (!state.ui.cardImageIndexes.has(recordId)) {
        state.ui.cardImageIndexes.set(recordId, 0);
    }
    let currentIndex = state.ui.cardImageIndexes.get(recordId);
    eventCard.style.backgroundImage = `url('${imageUrls[currentIndex] || ''}')`;

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
    const compositeId = options.length > 0 ?
        `${recordId}-${firstAvailableOptionIndex}` : recordId;
    const initialQuantity = Math.max(parseInt(guestCountInput.value), headcountMin);

    eventCard.innerHTML = `
        <div class="heart-icon" data-composite-id="${compositeId}">
            <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
        </div>
        <div class="event-card-content">
            <h3>${fields[CONSTANTS.FIELD_NAMES.NAME] || 'Untitled Event'}</h3>
            ${optionsDropdownHTML}
            <p class="option-description"></p>
            <p class="details"></p>
            <div class="price-quantity-wrapper">
                <div class="price"></div>
                <div class="quantity-selector">
                    <button class="quantity-btn minus" aria-label="Decrease quantity">-</button>
                    <input type="number" class="quantity-input" value="${initialQuantity}" min="${headcountMin}">
                    <button class="quantity-btn plus" aria-label="Increase quantity">+</button>
                </div>
            </div>
        </div>
        <div class="card-footer">${renderReactionsSummary(recordId)}</div>
        ${renderReactionbar(recordId)}
        <button class="gallery-arrow left">←</button>
        <button class="gallery-arrow right">→</button>`;
    const dropdown = eventCard.querySelector('.options-selector');
    const heartIcon = eventCard.querySelector('.heart-icon');
    const quantityInput = eventCard.querySelector('.quantity-input');
    const plusBtn = eventCard.querySelector('.quantity-btn.plus');
    const minusBtn = eventCard.querySelector('.quantity-btn.minus');
    const priceEl = eventCard.querySelector('.price');
    const descriptionEl = eventCard.querySelector('.option-description');
    const detailsEl = eventCard.querySelector('.details');
    const updateCardDetails = () => {
        const selectedIndex = dropdown ?
            dropdown.value : null;
        const selectedOption = selectedIndex ? options[selectedIndex] : null;
        // Update Price
        let currentPrice = basePrice;
        if (selectedOption) {
            if (selectedOption.absolutePrice !== null) {
                currentPrice = selectedOption.absolutePrice;
            } else if (selectedOption.priceChange !== null) {
                currentPrice += selectedOption.priceChange;
            }
        }
        priceEl.innerHTML = `$${currentPrice.toFixed(2)} <span style="font-size: 0.7em; font-weight: normal;">${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || ''}</span>`;

        // Update Description
        descriptionEl.textContent = selectedOption?.description || '';
        descriptionEl.style.display = selectedOption?.description ? 'block' : 'none';

        // Update Duration
        let currentDuration = baseDuration;
        if (selectedOption && selectedOption.durationChange !== null) {
            currentDuration += selectedOption.durationChange;
        }
        detailsEl.textContent = currentDuration > 0 ? `Duration: ${currentDuration} hours` : '';
        // Update Heart Icon and Edit Button
        const newCompositeId = selectedIndex ? `${recordId}-${selectedIndex}` : recordId;
        heartIcon.dataset.compositeId = newCompositeId;
        heartIcon.classList.toggle('hearted', state.cart.items.has(newCompositeId) || state.cart.lockedItems.has(newCompositeId));
    };
    if (dropdown) {
        dropdown.addEventListener('change', updateCardDetails);
    }
    updateCardDetails();
// Initial call
    
    if (plusBtn) plusBtn.addEventListener('click', () => { quantityInput.value = parseInt(quantityInput.value) + 1; guestCountInput.value = quantityInput.value; });
    if (minusBtn) minusBtn.addEventListener('click', () => { const current = parseInt(quantityInput.value); const min = parseInt(quantityInput.min); if (current > min) { quantityInput.value = current - 1; guestCountInput.value = quantityInput.value; } });
    quantityInput.addEventListener('change', () => { const min = parseInt(quantityInput.min); if (parseInt(quantityInput.value) < min) { quantityInput.value = min; } guestCountInput.value = quantityInput.value; });
    const leftArrow = eventCard.querySelector('.gallery-arrow.left');
    const rightArrow = eventCard.querySelector('.gallery-arrow.right');
    if (imageUrls.length > 1) {
        leftArrow.addEventListener('click', () => {
            currentIndex = (currentIndex - 1 + imageUrls.length) % imageUrls.length;
            state.ui.cardImageIndexes.set(recordId, currentIndex);
            eventCard.style.backgroundImage = `url('${imageUrls[currentIndex]}')`;
        });
        rightArrow.addEventListener('click', () => {
            currentIndex = (currentIndex + 1) % imageUrls.length;
            state.ui.cardImageIndexes.set(recordId, currentIndex);
            eventCard.style.backgroundImage = `url('${imageUrls[currentIndex]}')`;
        });
    } else {
        leftArrow.style.display = 'none';
        rightArrow.style.display = 'none';
    }

    return eventCard;
}

export async function renderRecords(recordsToRender, imageCache) {
    if (recordsToRender.length === 0 && state.ui.recordsCurrentlyDisplayed === 0) {
        catalogContainer.innerHTML = "<p style='text-align: center; width: 100%;'>No events match the current filters.</p>";
        return;
    }

    for (const record of recordsToRender) {
        const options = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const recordId = record.id;

        const allOptionsFavorited = options.length > 0 && options.every((opt, index) => {
            const compositeId = `${recordId}-${index}`;
            return state.cart.items.has(compositeId) || state.cart.lockedItems.has(compositeId);
        });
        if (allOptionsFavorited || (options.length === 0 && (state.cart.items.has(recordId) || state.cart.lockedItems.has(recordId)))) {
            continue;
        }

        const eventCard = await createEventCardElement(record, imageCache);
        if (eventCard) {
            catalogContainer.appendChild(eventCard);
        }
    }
}

export async function updateFavoritesCarousel() {
    if (state.cart.lockedItems.size === 0 && state.cart.items.size === 0 && state.eventDetails.combined.size === 0) {
        favoritesSection.style.display = 'none';
        return;
    }
    favoritesSection.style.display = 'block';
    favoritesCarousel.innerHTML = '';
    const imageCache = new Map();
    const sorter = ([idA], [idB]) => {
        const recordA = state.records.all.find(r => r.id === idA.split('-')[0]);
        const recordB = state.records.all.find(r => r.id === idB.split('-')[0]);
        if (!recordA || !recordB) return 0;
        switch (state.ui.currentSort) {
            case 'price-asc':
                return getRecordPrice(recordA, idA.split('-')[1]) - getRecordPrice(recordB, idB.split('-')[1]);
            case 'price-desc':
                return getRecordPrice(recordB, idB.split('-')[1]) - getRecordPrice(recordA, idA.split('-')[1]);
            case 'name-asc':
                return (recordA.fields[CONSTANTS.FIELD_NAMES.NAME] || '').localeCompare(recordB.fields[CONSTANTS.FIELD_NAMES.NAME] || '');
            case 'reactions-desc':
            default:
                return calculateReactionScore(recordB.id) - calculateReactionScore(recordA.id);
        }
    };

    const sortedLockedItems = Array.from(state.cart.lockedItems.entries()).sort(sorter);
    for (const [compositeId, itemInfo] of sortedLockedItems) {
        const card = await createFavoriteCardElement(compositeId, itemInfo, true, imageCache);
        if (card) favoritesCarousel.appendChild(card);
    }

    const sortedItems = Array.from(state.cart.items.entries()).sort(sorter);
    for (const [compositeId, itemInfo] of sortedItems) {
        const card = await createFavoriteCardElement(compositeId, itemInfo, false, imageCache);
        if (card) favoritesCarousel.appendChild(card);
    }

    updateTotalCost();
    updateHeader();
}

export function renderCollaborators(getInitials) {
    collaboratorsSection.style.display = 'flex';
    const collaboratorAvatars = document.getElementById('collaborator-avatars');
    collaboratorAvatars.innerHTML = '';
    state.session.collaborators.forEach(name => {
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = getInitials(name);
        avatar.title = name;
        collaboratorAvatars.appendChild(avatar);
    });
}

export function populateSessionsDropdown(getStoredSessions) {
    if (!sessionsDropdownContainer) return;
    const sessions = getStoredSessions();
    const sessionIds = Object.keys(sessions);
    if (sessionIds.length === 0) {
        sessionsDropdownContainer.style.display = 'none';
        return;
    }
    sessionsDropdownContainer.style.display = 'block';
    sessionsDropdown.innerHTML = '<option value="">Load a saved list...</option>';
    sessionIds.forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = sessions[id];
        if (id === state.session.id) {
            option.selected = true;
        }
        sessionsDropdown.appendChild(option);
    });
}

export function toggleLoading(show) {
    loadingMessage.style.display = show ? 'block' : 'none';
    filterControls.style.display = show ? 'none' : 'flex';
}

export function updateHeader() {
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Event Catalog';
    document.title = eventName;
}

export function updateHeaderSummary() {
    const headerSummary = document.getElementById('header-summary');
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Untitled Event';
    const date = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    const headcount = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT) || 0;
    const totalCost = document.getElementById('total-cost').textContent;

    const summaryParts = [];
    summaryParts.push(`<strong>${eventName}</strong>`);
    if (date) {
        summaryParts.push(`📅 ${date}`);
    }
    if (headcount > 0) {
        summaryParts.push(`👤 ${headcount}`);
    }
    summaryParts.push(`- ${totalCost}`);

    headerSummary.innerHTML = summaryParts.join(' | ');
}

export function updateTotalCost() {
    let total = 0;
    const breakdown = [];
    const allItems = new Map([...state.cart.items, ...state.cart.lockedItems]);

    allItems.forEach((itemInfo, compositeId) => {
        const record = state.records.all.find(r => r.id === compositeId.split('-')[0]);
        if (!record) return;

        const unitPrice = getRecordPrice(record, compositeId.split('-')[1] || null);
        if (isNaN(unitPrice)) return;

        const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] ? parseInt(record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN]) : 1;
        const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, headcountMin);
        const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE]?.toLowerCase();
  
        let itemCost;

        if (pricingType === 'per hour') {
            itemCost = unitPrice * effectiveQuantity; // Multiply by hours
        } else if (pricingType === CONSTANTS.PRICING_TYPES.PER_GUEST) {
            itemCost = unitPrice * effectiveQuantity; // Multiply by guests
        } else {
            itemCost = unitPrice; // Flat price
        }

        total += itemCost;
        const variationIndex = compositeId.split('-')[1];
        const variationName = variationIndex ? parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS])[variationIndex]?.name : '';
        const quantityLabel = pricingType === 'per hour' ? 'hours' : 'qty';
        breakdown.push(`${record.fields[CONSTANTS.FIELD_NAMES.NAME]}${variationName ? ` (${variationName})` : ''}: $${unitPrice.toFixed(2)} x ${effectiveQuantity} ${quantityLabel} = $${itemCost.toFixed(2)}`);
    });

    const formattedTotal = `$${total.toFixed(2)}`;
    const breakdownText = breakdown.length > 0 ? breakdown.join('\n') : 'No items selected';
    totalCostEl.textContent = formattedTotal;
    totalCostEl.title = breakdownText;
    
    updateHeaderSummary(); // Update the collapsed header summary
}

export function populateFilter(filterElement, fieldName) {
    const values = new Set();
    state.records.all.forEach(record => {
        const fieldValue = record.fields[fieldName];
        if (fieldValue) {
            values.add(fieldValue);
        }
    });
    values.forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = fieldName === CONSTANTS.FIELD_NAMES.DURATION ? `${value} hours` : value;
        filterElement.appendChild(option);
    });
}

export function collapseHeaderOnScroll() {
    let lastScrollY = window.scrollY;
    window.addEventListener('scroll', () => {
        if (window.scrollY > lastScrollY && window.scrollY > 100) {
            stickyHeader.classList.add('header-collapsed');
        } else if (window.scrollY < lastScrollY) {
            stickyHeader.classList.remove('header-collapsed');
        }
        lastScrollY = window.scrollY <= 0 ? 0 : window.scrollY;
    }, { passive: true });
}

export async function openDetailModal(compositeId, imageCache) {
    const record = state.records.all.find(r => r.id === compositeId.split('-')[0]);
    if (!record) return;
    const isLocked = state.cart.lockedItems.has(compositeId);
    let itemInfo = state.cart.lockedItems.get(compositeId) || state.cart.items.get(compositeId);
    if (!itemInfo) {
        const card = document.querySelector(`.event-card[data-record-id="${record.id}"]`) || document.querySelector(`.favorite-item[data-composite-id="${compositeId}"]`);
        itemInfo = { quantity: card ? parseInt(card.querySelector('.quantity-input')?.value || card.querySelector('.item-quantity')?.textContent.replace('Qty: ', '') || 1) : 1, requests: '' };
    }
    const fields = record.fields;
    const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    let basePrice = fields[CONSTANTS.FIELD_NAMES.PRICE] ?
        parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE]).replace(/[^0-9.-]+/g, "")) : null;
    let optionsDropdownHTML = '';
    let selectedOptionIndex = compositeId.split('-')[1] || 0;
    if (options.length > 0) {
        optionsDropdownHTML = `<div class="form-group"><label>Options</label><select id="modal-options" ${isLocked ? 'disabled' : ''}>${options.map((opt, index) => `<option value="${index}" ${index == selectedOptionIndex ? 'selected' : ''}>${opt.name}</option>`).join('')}</select></div>`;
    }
    const isHearted = state.cart.items.has(compositeId) || state.cart.lockedItems.has(compositeId);
    modalBody.innerHTML = `<h3>${fields[CONSTANTS.FIELD_NAMES.NAME]}</h3><p class="description">${fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || 'No description available.'}</p>${optionsDropdownHTML}<div class="price-quantity-wrapper" style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px;"><div class="price" data-unit-price="${basePrice}"></div><div class="quantity-selector"><button class="quantity-btn minus" aria-label="Decrease quantity" ${isLocked ? 'disabled' : ''}>-</button><input type="number" id="modal-quantity" class="quantity-input" value="${itemInfo.quantity}" min="${fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1}" ${isLocked ? 'readonly' : ''}><button class="quantity-btn plus" aria-label="Increase quantity" ${isLocked ? 'disabled' : ''}>+</button></div></div><div class="modal-footer"><div class="heart-icon ${isHearted ? 'hearted' : ''}" data-composite-id="${compositeId}"> <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg></div><div class="reactions-summary">${renderReactionsSummary(record.id)}</div>${renderReactionbar(record.id)}</div><button class="gallery-arrow left">←</button><button class="gallery-arrow right">→</button>`;
    
    const imageUrls = await fetchImagesForRecord(record, imageCache);
    if (!state.ui.cardImageIndexes.has(record.id)) {
        state.ui.cardImageIndexes.set(record.id, 0);
    }
    let currentIndex = state.ui.cardImageIndexes.get(record.id);
    modalContent.style.backgroundImage = `url('${imageUrls[currentIndex] || ''}')`;
    modalOverlay.style.display = 'flex';
    
    const modalPriceEl = modalBody.querySelector('.price');
    function updateModalPrice() {
        const unitPrice = getRecordPrice(record, selectedOptionIndex);
        if (!isNaN(unitPrice)) {
            modalPriceEl.innerHTML = `$${unitPrice.toFixed(2)} <span style="font-size: 0.7em; font-weight: normal;">${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || ''}</span>`;
        }
    }
    
    updateModalPrice();
    modalBody.querySelectorAll('select, input, button, .heart-icon').forEach(el => el.addEventListener('click', e => e.stopPropagation()));

    const leftArrow = modalBody.querySelector('.gallery-arrow.left');
    const rightArrow = modalBody.querySelector('.gallery-arrow.right');
    if (imageUrls.length > 1) {
        leftArrow.addEventListener('click', () => {
            currentIndex = (currentIndex - 1 + imageUrls.length) % imageUrls.length;
            state.ui.cardImageIndexes.set(record.id, currentIndex);
            modalContent.style.backgroundImage = `url('${imageUrls[currentIndex]}')`;
        });
        rightArrow.addEventListener('click', () => {
            currentIndex = (currentIndex + 1) % imageUrls.length;
            state.ui.cardImageIndexes.set(record.id, currentIndex);
            modalContent.style.backgroundImage = `url('${imageUrls[currentIndex]}')`;
        });
    } else {
        leftArrow.style.display = 'none';
        rightArrow.style.display = 'none';
    }

    // Add reaction listeners in modal
    modalBody.querySelectorAll('.reaction-bar button').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await handleReaction(btn.dataset.recordId, btn.dataset.emoji);
            // Update reactions summary in modal
            modalBody.querySelector('.reactions-summary').innerHTML = renderReactionsSummary(record.id);
            // Reflect in catalog/favorites
            await updateRender();
        });
    });
    // Hearting in modal
    const modalHeart = modalBody.querySelector('.heart-icon');
    modalHeart.addEventListener('click', (e) => {
        e.stopPropagation();
        recordStateForUndo();
        const currentCompositeId = modalHeart.dataset.compositeId;
        if (state.cart.items.has(currentCompositeId)) {
            state.cart.items.delete(currentCompositeId);
            modalHeart.classList.remove('hearted');
        } else {
            state.cart.items.set(currentCompositeId, itemInfo);
            modalHeart.classList.add('hearted');
        }
        // Reflect changes immediately
        updateRender();
    });
    // Auto-apply option change
    const modalOptions = modalBody.querySelector('#modal-options');
    if (modalOptions) {
        modalOptions.addEventListener('change', (e) => {
            recordStateForUndo();
            selectedOptionIndex = e.target.value;
            updateModalPrice();
            const newCompositeId = options.length > 0 ? `${record.id}-${selectedOptionIndex}` : record.id;
            const newItemInfo = { quantity: parseInt(modalBody.querySelector('#modal-quantity').value), requests: '' };
        
            // Update state
            if (state.cart.items.has(compositeId)) {
                state.cart.items.delete(compositeId);
                state.cart.items.set(newCompositeId, newItemInfo);
            } else if (state.cart.lockedItems.has(compositeId)) {
                state.cart.lockedItems.delete(compositeId);
                state.cart.lockedItems.set(newCompositeId, newItemInfo);
            }
            modalHeart.dataset.compositeId = newCompositeId; // Update heart dataset
            // Reflect
            updateRender();
        });
    }

    // Auto-apply quantity change
    const modalQuantity = modalBody.querySelector('#modal-quantity');
    modalQuantity.addEventListener('change', () => {
        recordStateForUndo();
        const min = parseInt(modalQuantity.min);
        if (parseInt(modalQuantity.value) < min) modalQuantity.value = min;
        itemInfo.quantity = parseInt(modalQuantity.value);
        // Update state if in cart
        if (state.cart.items.has(compositeId)) {
            state.cart.items.set(compositeId, itemInfo);
        } else if (state.cart.lockedItems.has(compositeId)) {
            state.cart.lockedItems.set(compositeId, itemInfo);
        }
        // Reflect
        updateRender();
    });
    const modalPlus = modalBody.querySelector('.quantity-btn.plus');
    const modalMinus = modalBody.querySelector('.quantity-btn.minus');
    if (modalPlus) modalPlus.addEventListener('click', () => { modalQuantity.value = parseInt(modalQuantity.value) + 1; modalQuantity.dispatchEvent(new Event('change')); });
    if (modalMinus) modalMinus.addEventListener('click', () => { const current = parseInt(modalQuantity.value); const min = parseInt(modalQuantity.min); if (current > min) { modalQuantity.value = current - 1; modalQuantity.dispatchEvent(new Event('change')); } });
    // Close modal on overlay click or close button
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay || e.target.classList.contains('modal-close')) {
            modalOverlay.style.display = 'none';
        }
    });
}
