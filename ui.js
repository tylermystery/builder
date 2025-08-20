/*
 * Version: 1.9.0
 * Last Modified: 2025-08-20
 *
 * Changelog:
 *
 * v1.9.0 - 2025-08-20
 * - Added `updateHeaderSummary` function to display selection count and total cost in the new collapsed header state.
 *
 * v1.8.3 - 2025-08-19
 * - [cite_start]Removed disclaimer tooltips from autosave-toggle and sessions-dropdown as features are now complete. [cite: 198]
 *
 * v1.8.2 - 2025-08-19
 * - [cite_start]Made modal changes (option, quantity) auto-apply to state on change, removed save button, call updateRender to reflect in catalog/favorites. [cite: 199]
 *
 * v1.8.1 - 2025-08-19
 * - [cite_start]Added reactions bar and hearting functionality to detailed modal view, mirroring catalog. [cite: 200]
 *
 * v1.8.0 - 2025-08-18
 * - [cite_start]Enhanced `openDetailModal` to include full description, editable options/quantity, and save button to apply changes to state/cart. [cite: 201]
 *
 * v1.7.0 - 2025-08-18
 * - [cite_start]Fixed total cost calculation to multiply variation price by quantity (hours for per-hour, guests for per-guest). [cite: 202]
 * - [cite_start]Added disclaimer tooltip to autosave-toggle and sessions-dropdown. [cite: 202]
 *
 * v1.6.0 - 2025-08-18
 * - [cite_start]Enhanced `updateTotalCost` to ensure accurate pricing with variations and quantity, including min headcount enforcement. [cite: 203]
 * - [cite_start]Added breakdown tooltip to total cost display. [cite: 203]
 *
 * v1.5.0 - 2025-08-18
 * - [cite_start]Implemented image gallery functionality for event cards, favorite items, and modals. [cite: 204]
 * - [cite_start]Updated to use `fetchImagesForRecord` for retrieving multiple images. [cite: 205]
 * - [cite_start]Added gallery arrow buttons and cycling logic using `state.ui.cardImageIndexes`. [cite: 206]
 *
 * v1.4.0 - 2025-08-18
 * - [cite_start]Refactored `parseOptions` to handle a robust key-value pair format. [cite: 207]
 * - [cite_start]Updated `createEventCardElement` to display and dynamically update option-specific descriptions, prices, and durations. [cite: 208]
 * - [cite_start]Updated `updateTotalCost` and `createFavoriteCardElement` to use the new price calculation logic. [cite: 209]
 *
 * v1.3.0 - 2025-08-18
 * - [cite_start]Implemented logic to remove event cards from the catalog only after all their variations have been favorited. [cite: 210]
 * - [cite_start]Event cards now auto-select the next available variation after one is favorited. [cite: 211]
 *
 * v1.2.1 - 2025-08-17
 * - [cite_start]Fixed a critical HTML structure error in index.html. [cite: 212]
 *
 * v1.2.0 - 2025-08-17
 * - [cite_start]Updated `updateFavoritesCarousel` to use the new unified sorting logic. [cite: 213]
 * - [cite_start]Exported `parseOptions` for use in `main.js`. [cite: 214]
 * - [cite_start]Exported the new `sortBy` dropdown element. [cite: 214]
 *
 * v1.0.0 - 2025-08-17
 * - Initial versioning and changelog added.
 */



import { state } from './state.js';
[cite_start]import { CONSTANTS, EMOJI_REACTIONS } from './config.js'; [cite: 215]
import { fetchImagesForRecord } from './api.js';
[cite_start]import { calculateReactionScore, getRecordPrice, updateRender, recordStateForUndo, handleReaction } from './main.js'; [cite: 216]



// --- DOM ELEMENT EXPORTS ---
export const catalogContainer = document.getElementById('catalog-container');
[cite_start]export const favoritesCarousel = document.getElementById('favorites-carousel'); [cite: 217]
export const nameFilter = document.getElementById('name-filter');
export const priceFilter = document.getElementById('price-filter');
export const durationFilter = document.getElementById('duration-filter');
[cite_start]export const statusFilter = document.getElementById('status-filter'); [cite: 218]
export const sortBy = document.getElementById('sort-by');
export const guestCountInput = document.getElementById('guest-count');
export const summaryEventNameInput = document.getElementById('summary-event-name');
[cite_start]export const summaryDateInput = document.getElementById('summary-date'); [cite: 219]
export const summaryHeadcountInput = document.getElementById('summary-headcount');
export const summaryLocationInput = document.getElementById('summary-location');
export const stickyHeader = document.getElementById('sticky-header');
[cite_start]const loadingMessage = document.getElementById('loading-message'); [cite: 220]
const totalCostEl = document.getElementById('total-cost');
const summaryTotalCostEl = document.getElementById('summary-total-cost');
const favoritesSection = document.getElementById('favorites-section');
const eventTitleHeader = document.getElementById('event-title-header');
[cite_start]const headerSummary = document.getElementById('header-summary'); [cite: 221]
const collaboratorsSection = document.getElementById('collaborators-section');
export const sessionsDropdownContainer = document.getElementById('sessions-dropdown-container');
export const sessionsDropdown = document.getElementById('sessions-dropdown');
[cite_start]const filterControls = document.getElementById('filter-controls'); [cite: 222]
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const modalOverlay = document.getElementById('edit-modal');
[cite_start]const modalContent = document.querySelector('#edit-modal .modal-content'); [cite: 223]
const modalBody = document.getElementById('modal-body');





// --- HELPER FUNCTIONS ---
export function parseOptions(optionsText) {
    if (!optionsText) return [];
    [cite_start]return optionsText.split('\n').map(line => { [cite: 224]
        const parts = line.split(',').map(p => p.trim());
        const option = { 
            name: parts[0], 
            priceChange: null,
            absolutePrice: null,
            durationChange: null, 
            description: null 
    
        [cite_start]}; [cite: 225]

        parts.slice(1).forEach(part => {
            const [key, ...valueParts] = part.split(':').map(p => p.trim());
            const value = valueParts.join(':');

            switch (key.toLowerCase()) {
                case 'price change':
                    option.priceChange 
                    [cite_start]= parseFloat(value.replace(/[^0-9.-]+/g, '')) || 0; [cite: 226]
                    break;
                case 'price':
                    option.absolutePrice = parseFloat(value.replace(/[^0-9.-]+/g, '')) || 0;
                    break;
              
                [cite_start]case 'duration change': [cite: 227]
                    option.durationChange = parseFloat(value.replace(/[^0-9.-]+/g, '')) || 0;
                    break;
                case 'description':
                    [cite_start]option.description = value.replace(/"/g, ''); [cite: 228]
// Remove quotes
                    break;
            [cite_start]} [cite: 229]
        });
        return option;
    [cite_start]}); [cite: 230]
}

// --- UI RENDERING FUNCTIONS ---
function renderReactionsSummary(recordId) {
    const reactions = state.session.reactions.get(recordId) || [cite_start]{}; [cite: 231]
    const reactionCounts = Object.values(reactions).reduce((acc, emoji) => {
        acc[emoji] = (acc[emoji] || 0) + 1;
        return acc;
    }, {});
    [cite_start]return `<div class="reactions-summary">${Object.entries(reactionCounts).map(([emoji, count]) => `<div class="reaction-pill" title="${emoji}">${emoji} ${count}</div>`).join('')}</div>`; [cite: 232]
}

function renderReactionbar(recordId) {
    [cite_start]return `<div class="reaction-bar">${EMOJI_REACTIONS.map(emoji => `<button data-record-id="${recordId}" data-emoji="${emoji}">${emoji}</button>`).join('')}</div>`; [cite: 233]
}

export async function createFavoriteCardElement(compositeId, itemInfo, isLocked, imageCache) {
    [cite_start]const record = state.records.all.find(r => r.id === compositeId.split('-')[0]); [cite: 234]
    if (!record) return null;
    const fields = record.fields;
    let variationNameHTML = '';
    [cite_start]let itemPrice = getRecordPrice(record, compositeId.split('-')[1] || null); [cite: 235]
    const optionIndex = compositeId.split('-')[1];
    if (optionIndex) {
        const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        [cite_start]const variation = options[optionIndex]; [cite: 236]
        if (variation) {
            [cite_start]variationNameHTML = `<p class="variation-name">${variation.name}</p>`; [cite: 237]
        }
    }

    const itemCard = document.createElement('div');
    itemCard.className = `favorite-item ${isLocked ? 'locked-item' : ''}`;
    [cite_start]itemCard.dataset.compositeId = compositeId; [cite: 238]
    itemCard.dataset.recordId = record.id;
    [cite_start]const imageUrls = await fetchImagesForRecord(record, imageCache); [cite: 239]
    if (!state.ui.cardImageIndexes.has(record.id)) {
        state.ui.cardImageIndexes.set(record.id, 0);
    }
    let currentIndex = state.ui.cardImageIndexes.get(record.id);
    [cite_start]itemCard.style.backgroundImage = `url('${imageUrls[currentIndex] || ''}')`; [cite: 240]
    const primaryActionHTML = isLocked ?
        [cite_start]`<button class="primary-action-btn" title="Locked In">⛓️</button>` : `<button class="primary-action-btn promote-btn" data-composite-id="${compositeId}"><span class="icon-default">💘</span><span class="icon-hover">💍</span></button>`; [cite: 241]
    const secondaryActionHTML = isLocked ?
        [cite_start]`<button class="secondary-action-btn demote-btn" data-composite-id="${compositeId}" title="Unlock">🔨</button>` : `<button class="secondary-action-btn remove-btn" data-composite-id="${compositeId}" title="Remove">💔</button>`; [cite: 242]
    itemCard.innerHTML = `<div class="action-btn-container">${primaryActionHTML}</div><button class="edit-card-btn" data-composite-id="${compositeId}">🪄</button>${secondaryActionHTML}<div class="favorite-item-content"><p class="item-name">${fields[CONSTANTS.FIELD_NAMES.NAME]}</p>${variationNameHTML}<p class="item-quantity">Qty: ${itemInfo.quantity}</p><p class="item-price">$${itemPrice.toFixed(2)} ${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || [cite_start]''}</p></div><div class="card-footer">${renderReactionsSummary(record.id)}</div>${renderReactionbar(record.id)}<button class="gallery-arrow left">←</button><button class="gallery-arrow right">→</button>`; [cite: 243]
    [cite_start]const leftArrow = itemCard.querySelector('.gallery-arrow.left'); [cite: 244]
    const rightArrow = itemCard.querySelector('.gallery-arrow.right');
    if (imageUrls.length > 1) {
        leftArrow.addEventListener('click', () => {
            currentIndex = (currentIndex - 1 + imageUrls.length) % imageUrls.length;
            state.ui.cardImageIndexes.set(record.id, currentIndex);
            itemCard.style.backgroundImage = `url('${imageUrls[currentIndex]}')`;
        });
        [cite_start]rightArrow.addEventListener('click', () => { [cite: 245]
            currentIndex = (currentIndex + 1) % imageUrls.length;
            state.ui.cardImageIndexes.set(record.id, currentIndex);
            itemCard.style.backgroundImage = `url('${imageUrls[currentIndex]}')`;
        });
    [cite_start]} else { [cite: 246]
        leftArrow.style.display = 'none';
        [cite_start]rightArrow.style.display = 'none'; [cite: 247]
    }

    return itemCard;
}

export async function createEventCardElement(record, imageCache) {
    const fields = record.fields;
    [cite_start]const recordId = record.id; [cite: 248]
    const headcountMin = fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const basePrice = fields[CONSTANTS.FIELD_NAMES.PRICE] ?
        [cite_start]parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE]).replace(/[^0-9.-]+/g, "")) : 0; [cite: 249]
    const baseDuration = fields[CONSTANTS.FIELD_NAMES.DURATION] || 0;

    const eventCard = document.createElement('div');
    eventCard.className = 'event-card';
    eventCard.dataset.recordId = recordId;
    [cite_start]const imageUrls = await fetchImagesForRecord(record, imageCache); [cite: 250]
    if (!state.ui.cardImageIndexes.has(recordId)) {
        [cite_start]state.ui.cardImageIndexes.set(recordId, 0); [cite: 251]
    }
    let currentIndex = state.ui.cardImageIndexes.get(recordId);
    eventCard.style.backgroundImage = `url('${imageUrls[currentIndex] || ''}')`;

    let optionsDropdownHTML = '';
    [cite_start]const availableOptions = options.filter((opt, index) => { [cite: 252]
        const compositeId = `${recordId}-${index}`;
        return !state.cart.items.has(compositeId) && !state.cart.lockedItems.has(compositeId);
    });
    [cite_start]if (options.length > 0) { [cite: 253]
        if (availableOptions.length === 0) {
            [cite_start]return null; [cite: 254]
        }
        optionsDropdownHTML = `<select class="options-selector"> ${availableOptions.map(opt => {
            const originalIndex = options.findIndex(o => o.name === opt.name);
            return `<option value="${originalIndex}">${opt.name}</option>`;
        [cite_start]}).join('')} </select>`; [cite: 255]
    }

    const firstAvailableOptionIndex = options.findIndex(opt => opt.name === availableOptions[0]?.name);
    const compositeId = options.length > 0 ?
        [cite_start]`${recordId}-${firstAvailableOptionIndex}` : recordId; [cite: 256]
    const initialQuantity = Math.max(parseInt(guestCountInput.value), headcountMin);

    eventCard.innerHTML = `
        <button class="edit-card-btn">🪄</button>
        <div class="event-card-content">
            <div class="heart-icon" data-composite-id="${compositeId}">
                <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
      
            [cite_start]</div> [cite: 257]
            <h3>${fields[CONSTANTS.FIELD_NAMES.NAME] ||
                [cite_start]'Untitled Event'}</h3> [cite: 258]
            ${optionsDropdownHTML}
            <p class="option-description"></p>
            <p class="details"></p>
            <div class="price-quantity-wrapper">
                <div class="price"></div>
                <div class="quantity-selector">
              
                    [cite_start]<button class="quantity-btn minus" aria-label="Decrease quantity">-</button> [cite: 259]
                    <input type="number" class="quantity-input" value="${initialQuantity}" min="${headcountMin}">
                    <button class="quantity-btn plus" aria-label="Increase quantity">+</button>
                </div>
            </div>
        </div>
      
        [cite_start]<div class="card-footer">${renderReactionsSummary(recordId)}</div> [cite: 260]
        ${renderReactionbar(recordId)}
        <button class="gallery-arrow left">←</button>
        <button class="gallery-arrow right">→</button>`;
    [cite_start]const dropdown = eventCard.querySelector('.options-selector'); [cite: 261]
    const heartIcon = eventCard.querySelector('.heart-icon');
    const quantityInput = eventCard.querySelector('.quantity-input');
    const plusBtn = eventCard.querySelector('.quantity-btn.plus');
    const minusBtn = eventCard.querySelector('.quantity-btn.minus');
    [cite_start]const priceEl = eventCard.querySelector('.price'); [cite: 262]
    const descriptionEl = eventCard.querySelector('.option-description');
    const detailsEl = eventCard.querySelector('.details');
    [cite_start]const updateCardDetails = () => { [cite: 263]
        const selectedIndex = dropdown ?
            [cite_start]dropdown.value : null; [cite: 264]
        const selectedOption = selectedIndex ? options[selectedIndex] : null;
        [cite_start]// Update Price [cite: 265]
        let currentPrice = basePrice;
        [cite_start]if (selectedOption) { [cite: 266]
            if (selectedOption.absolutePrice !== null) {
                [cite_start]currentPrice = selectedOption.absolutePrice; [cite: 267]
            } else if (selectedOption.priceChange !== null) {
                [cite_start]currentPrice += selectedOption.priceChange; [cite: 268]
            }
        }
        priceEl.innerHTML = `$${currentPrice.toFixed(2)} <span style="font-size: 0.7em; font-weight: normal;">${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] ||
            [cite_start]''}</span>`; [cite: 269]

        // Update Description
        descriptionEl.textContent = selectedOption?.description || '';
        descriptionEl.style.display = selectedOption?.description ?
            [cite_start]'block' : 'none'; [cite: 270]

        // Update Duration
        let currentDuration = baseDuration;
        [cite_start]if (selectedOption && selectedOption.durationChange !== null) { [cite: 271]
            [cite_start]currentDuration += selectedOption.durationChange; [cite: 272]
        }
        detailsEl.textContent = currentDuration > 0 ? `Duration: ${currentDuration} hours` : '';
        [cite_start]// Update Heart Icon and Edit Button [cite: 273]
        const newCompositeId = selectedIndex ?
            [cite_start]`${recordId}-${selectedIndex}` : recordId; [cite: 274]
        heartIcon.dataset.compositeId = newCompositeId;
        eventCard.querySelector('.edit-card-btn').dataset.compositeId = newCompositeId;
        heartIcon.classList.toggle('hearted', state.cart.items.has(newCompositeId) || state.cart.lockedItems.has(newCompositeId));
    };
    [cite_start]if (dropdown) { [cite: 275]
        dropdown.addEventListener('change', updateCardDetails);
    }
    [cite_start]updateCardDetails(); [cite: 276]
// Initial call
    
    if (plusBtn) plusBtn.addEventListener('click', () => { quantityInput.value = parseInt(quantityInput.value) + 1; guestCountInput.value = quantityInput.value; });
    [cite_start]if (minusBtn) minusBtn.addEventListener('click', () => { const current = parseInt(quantityInput.value); const min = parseInt(quantityInput.min); if (current > min) { quantityInput.value = current - 1; guestCountInput.value = quantityInput.value; } }); [cite: 277]
    [cite_start]quantityInput.addEventListener('change', () => { const min = parseInt(quantityInput.min); if (parseInt(quantityInput.value) < min) { quantityInput.value = min; } guestCountInput.value = quantityInput.value; }); [cite: 278]
    [cite_start]const leftArrow = eventCard.querySelector('.gallery-arrow.left'); [cite: 279]
    const rightArrow = eventCard.querySelector('.gallery-arrow.right');
    if (imageUrls.length > 1) {
        leftArrow.addEventListener('click', () => {
            currentIndex = (currentIndex - 1 + imageUrls.length) % imageUrls.length;
            state.ui.cardImageIndexes.set(recordId, currentIndex);
            eventCard.style.backgroundImage = `url('${imageUrls[currentIndex]}')`;
        });
        [cite_start]rightArrow.addEventListener('click', () => { [cite: 280]
            currentIndex = (currentIndex + 1) % imageUrls.length;
            state.ui.cardImageIndexes.set(recordId, currentIndex);
            eventCard.style.backgroundImage = `url('${imageUrls[currentIndex]}')`;
        });
    [cite_start]} else { [cite: 281]
        leftArrow.style.display = 'none';
        [cite_start]rightArrow.style.display = 'none'; [cite: 282]
    }

    return eventCard;
}

export async function renderRecords(recordsToRender, imageCache) {
    if (recordsToRender.length === 0 && state.ui.recordsCurrentlyDisplayed === 0) {
        catalogContainer.innerHTML = "<p style='text-align: center; width: 100%;'>No events match the current filters.</p>";
        [cite_start]return; [cite: 283]
    }

    for (const record of recordsToRender) {
        const options = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        [cite_start]const recordId = record.id; [cite: 284]

        const allOptionsFavorited = options.length > 0 && options.every((opt, index) => {
            const compositeId = `${recordId}-${index}`;
            return state.cart.items.has(compositeId) || state.cart.lockedItems.has(compositeId);
        });
        [cite_start]if (allOptionsFavorited || (options.length === 0 && (state.cart.items.has(recordId) || state.cart.lockedItems.has(recordId)))) { [cite: 285]
            [cite_start]continue; [cite: 286]
        }

        const eventCard = await createEventCardElement(record, imageCache);
        [cite_start]if (eventCard) { [cite: 287]
            [cite_start]catalogContainer.appendChild(eventCard); [cite: 288]
        }
    }
}

export async function updateFavoritesCarousel() {
    if (state.cart.lockedItems.size === 0 && state.cart.items.size === 0 && state.eventDetails.combined.size === 0) {
        favoritesSection.style.display = 'none';
        [cite_start]return; [cite: 289]
    }
    favoritesSection.style.display = 'block';
    favoritesCarousel.innerHTML = '';
    const imageCache = new Map();
    [cite_start]const sorter = ([idA], [idB]) => { [cite: 290]
        const recordA = state.records.all.find(r => r.id === idA.split('-')[0]);
        [cite_start]const recordB = state.records.all.find(r => r.id === idB.split('-')[0]); [cite: 291]
        if (!recordA || !recordB) return 0;
        [cite_start]switch (state.ui.currentSort) { [cite: 292]
            case 'price-asc':
                return getRecordPrice(recordA, idA.split('-')[1]) - getRecordPrice(recordB, idB.split('-')[1]);
            [cite_start]case 'price-desc': [cite: 293]
                return getRecordPrice(recordB, idB.split('-')[1]) - getRecordPrice(recordA, idA.split('-')[1]);
            [cite_start]case 'name-asc': [cite: 294]
                return (recordA.fields[CONSTANTS.FIELD_NAMES.NAME] || '').localeCompare(recordB.fields[CONSTANTS.FIELD_NAMES.NAME] || '');
            [cite_start]case 'reactions-desc': [cite: 295]
            default:
                [cite_start]return calculateReactionScore(recordB.id) - calculateReactionScore(recordA.id); [cite: 296]
        }
    };

    const sortedLockedItems = Array.from(state.cart.lockedItems.entries()).sort(sorter);
    for (const [compositeId, itemInfo] of sortedLockedItems) {
        const card = await createFavoriteCardElement(compositeId, itemInfo, true, imageCache);
        [cite_start]if (card) favoritesCarousel.appendChild(card); [cite: 297]
    }

    const sortedItems = Array.from(state.cart.items.entries()).sort(sorter);
    [cite_start]for (const [compositeId, itemInfo] of sortedItems) { [cite: 298]
        const card = await createFavoriteCardElement(compositeId, itemInfo, false, imageCache);
        [cite_start]if (card) favoritesCarousel.appendChild(card); [cite: 299]
    }

    updateTotalCost();
    updateHeader();
}

export function updateHistoryButtons() {
    undoBtn.disabled = state.history.undoStack.length <= 1;
    [cite_start]redoBtn.disabled = state.history.redoStack.length === 0; [cite: 300]
}

export function renderCollaborators(getInitials) {
    collaboratorsSection.style.display = 'flex';
    const collaboratorAvatars = document.getElementById('collaborator-avatars');
    [cite_start]collaboratorAvatars.innerHTML = ''; [cite: 301]
    state.session.collaborators.forEach(name => {
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = getInitials(name);
        avatar.title = name;
        collaboratorAvatars.appendChild(avatar);
    [cite_start]}); [cite: 302]
}

export function populateSessionsDropdown(getStoredSessions) {
    if (!sessionsDropdownContainer) return;
    const sessions = getStoredSessions();
    const sessionIds = Object.keys(sessions);
    [cite_start]if (sessionIds.length === 0) { [cite: 303]
        sessionsDropdownContainer.style.display = 'none';
        [cite_start]return; [cite: 304]
    }
    sessionsDropdownContainer.style.display = 'block';
    sessionsDropdown.innerHTML = '<option value="">Load a saved list...</option>';
    [cite_start]sessionIds.forEach(id => { [cite: 305]
        const option = document.createElement('option');
        option.value = id;
        option.textContent = sessions[id];
        if (id === state.session.id) {
            option.selected = true;
        }
        sessionsDropdown.appendChild(option);
    [cite_start]}); [cite: 306]
}

export function updateSummaryToolbar() {
    summaryEventNameInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    summaryDateInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE) || '';
    summaryHeadcountInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT) || [cite_start]1; [cite: 307]
    summaryLocationInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.LOCATION) || [cite_start]''; [cite: 308]
}

export function toggleLoading(show) {
    loadingMessage.style.display = show ? 'block' : 'none';
    filterControls.style.display = show ?
        [cite_start]'none' : 'flex'; [cite: 309]
}

export function updateHeader() {
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Your Event';
    eventTitleHeader.textContent = eventName;
    document.title = eventName === 'Your Event' ? [cite_start]'Event Catalog' : `TMT - ${eventName}`; [cite: 311]
}

export function updateHeaderSummary() {
    const headerSummary = document.getElementById('header-summary');
    const itemCount = state.cart.items.size + state.cart.lockedItems.size;
    const totalCost = document.getElementById('total-cost').textContent;

    if (itemCount > 0) {
        headerSummary.textContent = `Selections: ${itemCount} | Total: ${totalCost}`;
    } else {
        headerSummary.textContent = `Event: ${state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Your Event'}`;
    }
}

export function updateTotalCost() {
    let total = 0;
    const breakdown = [];
    [cite_start]const allItems = new Map([...state.cart.items, ...state.cart.lockedItems]); [cite: 312]

    allItems.forEach((itemInfo, compositeId) => {
        const record = state.records.all.find(r => r.id === compositeId.split('-')[0]);
        if (!record) return;

        const unitPrice = getRecordPrice(record, compositeId.split('-')[1] || null);
        if (isNaN(unitPrice)) return;

        const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] ? parseInt(record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN]) : 1;
        const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, headcountMin);
        const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE]?.toLowerCase();
  
        [cite_start]let itemCost; [cite: 313]

        if (pricingType === 'per hour') {
            itemCost = unitPrice * effectiveQuantity; // Multiply by hours
        } else if (pricingType === CONSTANTS.PRICING_TYPES.PER_GUEST) {
            itemCost = unitPrice * effectiveQuantity; // Multiply by guests
        } else {
            itemCost = unitPrice; // 
            [cite_start]Flat price [cite: 314]
        }

        total += itemCost;
        [cite_start]const variationIndex = compositeId.split('-')[1]; [cite: 315]
        const variationName = variationIndex ? parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS])[variationIndex]?.name : '';
        const quantityLabel = pricingType === 'per hour' ?
            [cite_start]'hours' : 'qty'; [cite: 316]
        breakdown.push(`${record.fields[CONSTANTS.FIELD_NAMES.NAME]}${variationName ? ` (${variationName})` : ''}: $${unitPrice.toFixed(2)} x ${effectiveQuantity} ${quantityLabel} = $${itemCost.toFixed(2)}`);
    });

    const formattedTotal = `$${total.toFixed(2)}`;
    [cite_start]const breakdownText = breakdown.length > 0 ? breakdown.join('\n') : 'No items selected'; [cite: 317]
    totalCostEl.textContent = formattedTotal;
    totalCostEl.title = breakdownText;
    [cite_start]// Tooltip for breakdown [cite: 318]
    summaryTotalCostEl.textContent = formattedTotal;
    summaryTotalCostEl.title = breakdownText;
    [cite_start]// Tooltip for breakdown [cite: 319]
    updateHeaderSummary(); // Update the collapsed header summary
}

export function populateFilter(filterElement, fieldName) {
    const values = new Set();
    [cite_start]state.records.all.forEach(record => { [cite: 320]
        const fieldValue = record.fields[fieldName];
        if (fieldValue) {
            values.add(fieldValue);
        }
    });
    [cite_start]values.forEach(value => { [cite: 321]
        const option = document.createElement('option');
        option.value = value;
        option.textContent = fieldName === CONSTANTS.FIELD_NAMES.DURATION ? `${value} hours` : value;
        filterElement.appendChild(option);
    [cite_start]}); [cite: 322]
}

export function collapseHeaderOnScroll() {
    let lastScrollY = window.scrollY;
    [cite_start]window.addEventListener('scroll', () => { [cite: 323]
        if (window.scrollY > lastScrollY && window.scrollY > 100) {
            stickyHeader.classList.add('header-collapsed');
        } else if (window.scrollY < lastScrollY) {
            stickyHeader.classList.remove('header-collapsed');
        }
        lastScrollY = window.scrollY <= 0 ? 0 : window.scrollY;
    [cite_start]}, { passive: true }); [cite: 324]
}

export async function openDetailModal(compositeId, imageCache) {
    const record = state.records.all.find(r => r.id === compositeId.split('-')[0]);
    if (!record) return;
    [cite_start]const isLocked = state.cart.lockedItems.has(compositeId); [cite: 325]
    let itemInfo = state.cart.lockedItems.get(compositeId) || state.cart.items.get(compositeId);
    [cite_start]if (!itemInfo) { [cite: 326]
        const card = document.querySelector(`.event-card[data-record-id="${record.id}"]`) || document.querySelector(`.favorite-item[data-composite-id="${compositeId}"]`);
        [cite_start]itemInfo = { quantity: card ? parseInt(card.querySelector('.quantity-input')?.value || card.querySelector('.item-quantity')?.textContent.replace('Qty: ', '') || 1) : 1, requests: '' }; [cite: 327]
    [cite_start]} [cite: 328]
    const fields = record.fields;
    const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    let basePrice = fields[CONSTANTS.FIELD_NAMES.PRICE] ?
        [cite_start]parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE]).replace(/[^0-9.-]+/g, "")) : null; [cite: 329]
    let optionsDropdownHTML = '';
    let selectedOptionIndex = compositeId.split('-')[1] || 0;
    [cite_start]if (options.length > 0) { [cite: 330]
        optionsDropdownHTML = `<div class="form-group"><label>Options</label><select id="modal-options" ${isLocked ?
            [cite_start]'disabled' : ''}>${options.map((opt, index) => `<option value="${index}" ${index == selectedOptionIndex ? 'selected' : ''}>${opt.name}</option>`).join('')}</select></div>`; [cite: 331]
    [cite_start]} [cite: 332]
    const isHearted = state.cart.items.has(compositeId) || state.cart.lockedItems.has(compositeId);
    modalBody.innerHTML = `<h3>${fields[CONSTANTS.FIELD_NAMES.NAME]}</h3><p class="description">${fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] ||
        'No description available.'}</p>${optionsDropdownHTML}<div class="price-quantity-wrapper" style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px;"><div class="price" data-unit-price="${basePrice}"></div><div class="quantity-selector"><button class="quantity-btn minus" aria-label="Decrease quantity" ${isLocked ?
        'disabled' : ''}>-</button><input type="number" id="modal-quantity" class="quantity-input" value="${itemInfo.quantity}" min="${fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1}" ${isLocked ?
        'readonly' : ''}><button class="quantity-btn plus" aria-label="Increase quantity" ${isLocked ? [cite_start]'disabled' : ''}>+</button></div></div><div class="modal-footer"><div class="heart-icon ${isHearted ? 'hearted' : ''}" data-composite-id="${compositeId}"> <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg></div><div class="reactions-summary">${renderReactionsSummary(record.id)}</div>${renderReactionbar(record.id)}</div><button class="gallery-arrow left">←</button><button class="gallery-arrow right">→</button>`; [cite: 333, 334, 335]
    [cite_start]// Removed save button [cite: 336]
    
    const imageUrls = await fetchImagesForRecord(record, imageCache);
    [cite_start]if (!state.ui.cardImageIndexes.has(record.id)) { [cite: 337]
        state.ui.cardImageIndexes.set(record.id, 0);
    }
    let currentIndex = state.ui.cardImageIndexes.get(record.id);
    [cite_start]modalContent.style.backgroundImage = `url('${imageUrls[currentIndex] || ''}')`; [cite: 338]
    modalOverlay.style.display = 'flex';
    
    const modalPriceEl = modalBody.querySelector('.price');
    [cite_start]function updateModalPrice() { [cite: 339]
        const unitPrice = getRecordPrice(record, selectedOptionIndex);
        [cite_start]if (!isNaN(unitPrice)) { [cite: 340]
            modalPriceEl.innerHTML = `$${unitPrice.toFixed(2)} <span style="font-size: 0.7em; font-weight: normal;">${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] ||
                [cite_start]''}</span>`; [cite: 341]
        }
    }
    
    updateModalPrice();
    [cite_start]modalBody.querySelectorAll('select, input, button, .heart-icon').forEach(el => el.addEventListener('click', e => e.stopPropagation())); [cite: 342]

    const leftArrow = modalBody.querySelector('.gallery-arrow.left');
    const rightArrow = modalBody.querySelector('.gallery-arrow.right');
    [cite_start]if (imageUrls.length > 1) { [cite: 343]
        leftArrow.addEventListener('click', () => {
            currentIndex = (currentIndex - 1 + imageUrls.length) % imageUrls.length;
            state.ui.cardImageIndexes.set(record.id, currentIndex);
            modalContent.style.backgroundImage = `url('${imageUrls[currentIndex]}')`;
        });
        [cite_start]rightArrow.addEventListener('click', () => { [cite: 344]
            currentIndex = (currentIndex + 1) % imageUrls.length;
            state.ui.cardImageIndexes.set(record.id, currentIndex);
            modalContent.style.backgroundImage = `url('${imageUrls[currentIndex]}')`;
        });
    [cite_start]} else { [cite: 345]
        leftArrow.style.display = 'none';
        [cite_start]rightArrow.style.display = 'none'; [cite: 346]
    }

    // Add reaction listeners in modal
    modalBody.querySelectorAll('.reaction-bar button').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await handleReaction(btn.dataset.recordId, btn.dataset.emoji);
            // Update reactions summary in modal
            modalBody.querySelector('.reactions-summary').innerHTML = renderReactionsSummary(record.id);
            // Reflect in 
            catalog/favorites
            [cite_start]await updateRender(); [cite: 347]
        });
    });
    [cite_start]// Hearting in modal [cite: 348]
    const modalHeart = modalBody.querySelector('.heart-icon');
    [cite_start]modalHeart.addEventListener('click', (e) => { [cite: 349]
        e.stopPropagation();
        recordStateForUndo();
        const currentCompositeId = modalHeart.dataset.compositeId;
        if (state.cart.items.has(currentCompositeId)) {
            state.cart.items.delete(currentCompositeId);
            modalHeart.classList.remove('hearted');
        } else {
            state.cart.items.set(currentCompositeId, itemInfo);
            modalHeart.classList.add('hearted');
 
        [cite_start]} [cite: 350]
        // Reflect changes immediately
        updateRender();
    });
    [cite_start]// Auto-apply option change [cite: 351]
    const modalOptions = modalBody.querySelector('#modal-options');
    [cite_start]if (modalOptions) { [cite: 352]
        modalOptions.addEventListener('change', (e) => {
            recordStateForUndo();
            selectedOptionIndex = e.target.value;
            updateModalPrice();
            const newCompositeId = options.length > 0 ? `${record.id}-${selectedOptionIndex}` : record.id;
            const newItemInfo = { quantity: parseInt(modalBody.querySelector('#modal-quantity').value), requests: '' };
        
            [cite_start]// Update state [cite: 353]
            if (state.cart.items.has(compositeId)) {
                state.cart.items.delete(compositeId);
                state.cart.items.set(newCompositeId, newItemInfo);
            } else if (state.cart.lockedItems.has(compositeId)) {
                state.cart.lockedItems.delete(compositeId);
               
                [cite_start]state.cart.lockedItems.set(newCompositeId, newItemInfo); [cite: 354]
            }
            modalHeart.dataset.compositeId = newCompositeId; // Update heart dataset
            // Reflect
            updateRender();
        });
    [cite_start]} [cite: 355]

    // Auto-apply quantity change
    const modalQuantity = modalBody.querySelector('#modal-quantity');
    [cite_start]modalQuantity.addEventListener('change', () => { [cite: 356]
        recordStateForUndo();
        const min = parseInt(modalQuantity.min);
        if (parseInt(modalQuantity.value) < min) modalQuantity.value = min;
        itemInfo.quantity = parseInt(modalQuantity.value);
        // Update state if in cart
        if (state.cart.items.has(compositeId)) {
            state.cart.items.set(compositeId, itemInfo);
        } else if (state.cart.lockedItems.has(compositeId)) {
      
            [cite_start]state.cart.lockedItems.set(compositeId, itemInfo); [cite: 357]
        }
        // Reflect
        updateRender();
    });
    [cite_start]const modalPlus = modalBody.querySelector('.quantity-btn.plus'); [cite: 358]
    const modalMinus = modalBody.querySelector('.quantity-btn.minus');
    if (modalPlus) modalPlus.addEventListener('click', () => { modalQuantity.value = parseInt(modalQuantity.value) + 1; modalQuantity.dispatchEvent(new Event('change')); });
    [cite_start]if (modalMinus) modalMinus.addEventListener('click', () => { const current = parseInt(modalQuantity.value); const min = parseInt(modalQuantity.min); if (current > min) { modalQuantity.value = current - 1; modalQuantity.dispatchEvent(new Event('change')); } }); [cite: 359]
    [cite_start]// Close modal on overlay click or close button [cite: 360]
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay || e.target.classList.contains('modal-close')) {
            modalOverlay.style.display = 'none';
        }
    [cite_start]}); [cite: 361]
}
