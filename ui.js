/*
 * Version: 2.0.1
 * Last Modified: 2025-08-22
 *
 * Changelog:
 *
 * v2.0.1 - 2025-08-22
 * - Added logic to populate Category and Subcategory filters.
 * - Exported new filter dropdown elements.
 *
 * v2.0.0 - 2025-08-21
 * - Implemented conditional rendering logic for Beta Toolkit features.
 * - Cards now render different buttons/UI based on active modes.
 *
 * v1.9.0 - 2025-08-21
 * - Stripped down to MVP: Removed reaction bars and complex favorite card buttons.
 * - Favorites now have a simple "Remove" button.
 *
 * v1.8.7 - 2025-08-21
 * - Implemented the Heart -> Ring -> Ball & Chain emoji sequence for favorite card buttons.
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

// --- DOM ELEMENT EXPORTS ---
export const catalogContainer = document.getElementById('catalog-container');
export const favoritesCarousel = document.getElementById('favorites-carousel');
export const nameFilter = document.getElementById('name-filter');
export const priceFilter = document.getElementById('price-filter');
export const durationFilter = document.getElementById('duration-filter');
export const statusFilter = document.getElementById('status-filter');
export const categoryFilter = document.getElementById('category-filter');
export const subcategoryFilter = document.getElementById('subcategory-filter');
export const sortBy = document.getElementById('sort-by');
export const guestCountInput = document.getElementById('guest-count');
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
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const modalOverlay = document.getElementById('edit-modal');
const modalContent = document.querySelector('#edit-modal .modal-content');
const modalBody = document.getElementById('modal-body');
export const headerEventNameInput = document.getElementById('header-event-name');





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
    
    // CONDITIONAL BUTTON RENDERING
    let cardActionsHTML = '';
    const isPlannerMode = document.body.classList.contains('planner-mode-enabled');
    if (isPlannerMode) {
        const primaryActionHTML = isLocked 
            ? `<button class="action-btn-primary locked-btn" title="Locked In">⛓️</button>` 
            : `<button class="action-btn-primary promote-btn" title="Lock it in" data-composite-id="${compositeId}"><span class="icon-default">💘</span><span class="icon-hover">💍</span></button>`;
        const secondaryActionHTML = isLocked 
            ? `<button class="action-btn-secondary demote-btn" title="Unlock" data-composite-id="${compositeId}">🔨</button>` 
            : `<button class="action-btn-secondary remove-btn" title="Remove" data-composite-id="${compositeId}">💔</button>`;
        cardActionsHTML = `${primaryActionHTML}${secondaryActionHTML}`;
    } else {
        cardActionsHTML = `<button class="action-btn remove-btn" title="Remove" data-composite-id="${compositeId}">×</button>`;
    }
    
    // CONDITIONAL REACTION BAR RENDERING
    const isCollabMode = document.body.classList.contains('collab-mode-enabled');
    const reactionUI = isCollabMode ? `${renderReactionbar(record.id)}<div class="card-footer">${renderReactionsSummary(record.id)}</div>` : '';

    itemCard.innerHTML = `<div class="card-actions">${cardActionsHTML}</div><div class="favorite-item-content"><p class="item-name">${fields[CONSTANTS.FIELD_NAMES.NAME]}</p>${variationNameHTML}<p class="item-quantity">Qty: ${itemInfo.quantity}</p><p class="item-price">$${itemPrice.toFixed(2)} ${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || ''}</p></div>${reactionUI}<button class="gallery-arrow left">←</button><button class="gallery-arrow right">→</button>`;
    
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
        state.ui.cardImageIndexes.set(record.id, 0);
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
    
    const isCollabMode = document.body.classList.contains('collab-mode-enabled');
    const reactionUI = isCollabMode ? `${renderReactionbar(record.id)}<div class="card-footer">${renderReactionsSummary(record.id)}</div>` : '';

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
        ${reactionUI}
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
        heartIcon.classList.toggle('hearted', state.cart.items.has(newCompositeId) || state.cart.lockedItems.has(newCompositeId));
    };
    if (dropdown) {
        dropdown.addEventListener('change', updateCardDetails);
    }
    updateCardDetails();
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

export function updateHistoryButtons() {
    if (undoBtn && redoBtn) {
        undoBtn.disabled = state.history.undoStack.length <= 1;
        redoBtn.disabled = state.history.redoStack.length === 0;
    }
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
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Mystery Tour Event Builder';
    // No longer setting an input, but the h1 inside the title container
    const titleEl = document.querySelector('.header-title-container h1');
    if(titleEl) titleEl.textContent = eventName;
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
        if (Array.isArray(fieldValue)) {
            fieldValue.forEach(val => values.add(val));
        } else if (fieldValue) {
            values.add(fieldValue);
        }
    });
    
    while (filterElement.options.length > 1) {
        filterElement.remove(1);
    }

    Array.from(values).sort().forEach(value => {
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
    modalBody.innerHTML = `<h3>${fields[CONSTANTS.FIELD_NAMES.NAME]}</h3><p class="description">${fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || 'No description available.'}</p>${optionsDropdownHTML}<div class="price-quantity-wrapper" style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px;"><div class="price" data-unit-price="${basePrice}"></div><div class="quantity-selector"><button class="quantity-btn minus" aria-label="Decrease quantity" ${isLocked ? 'disabled' : ''}>-</button><input type="number" id="modal-quantity" class="quantity-input" value="${itemInfo.quantity}" min="${fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1}" ${isLocked ? 'readonly' : ''}><button class="quantity-btn plus" aria-label="Increase quantity" ${isLocked ? 'disabled' : ''}>+</button></div></div><div class="modal-footer"><div class="heart-icon ${isHearted ? 'hearted' : ''}" data-composite-id="${compositeId}"> <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg></div></div><button class="gallery-arrow left">←</button><button class="gallery-arrow right">→</button>`;
    
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
        updateRender();
    });
    const modalOptions = modalBody.querySelector('#modal-options');
    if (modalOptions) {
        modalOptions.addEventListener('change', (e) => {
            recordStateForUndo();
            selectedOptionIndex = e.target.value;
            updateModalPrice();
            const newCompositeId = options.length > 0 ? `${record.id}-${selectedOptionIndex}` : record.id;
            const newItemInfo = { quantity: parseInt(modalBody.querySelector('#modal-quantity').value), requests: '' };
        
            if (state.cart.items.has(compositeId)) {
                state.cart.items.delete(compositeId);
                state.cart.items.set(newCompositeId, newItemInfo);
            } else if (state.cart.lockedItems.has(compositeId)) {
                state.cart.lockedItems.delete(compositeId);
                state.cart.lockedItems.set(newCompositeId, newItemInfo);
            }
            modalHeart.dataset.compositeId = newCompositeId;
            updateRender();
        });
    }

    const modalQuantity = modalBody.querySelector('#modal-quantity');
    modalQuantity.addEventListener('change', () => {
        recordStateForUndo();
        const min = parseInt(modalQuantity.min);
        if (parseInt(modalQuantity.value) < min) modalQuantity.value = min;
        itemInfo.quantity = parseInt(modalQuantity.value);
        if (state.cart.items.has(compositeId)) {
            state.cart.items.set(compositeId, itemInfo);
        } else if (state.cart.lockedItems.has(compositeId)) {
            state.cart.lockedItems.set(compositeId, itemInfo);
        }
        updateRender();
    });
    const modalPlus = modalBody.querySelector('.quantity-btn.plus');
    const modalMinus = modalBody.querySelector('.quantity-btn.minus');
    if (modalPlus) modalPlus.addEventListener('click', () => { modalQuantity.value = parseInt(modalQuantity.value) + 1; modalQuantity.dispatchEvent(new Event('change')); });
    if (modalMinus) modalMinus.addEventListener('click', () => { const current = parseInt(modalQuantity.value); const min = parseInt(modalQuantity.min); if (current > min) { modalQuantity.value = current - 1; modalQuantity.dispatchEvent(new Event('change')); } });
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay || e.target.classList.contains('modal-close')) {
            modalOverlay.style.display = 'none';
        }
    });
}
```

### FILE: `main.js`
```javascript
/*
 * Version: 1.8.6
 * Last Modified: 2025-08-22
 *
 * Changelog:
 *
 * v1.8.6 - 2025-08-22
 * - Restored Undo/Redo functionality and connected to new "History Mode" toggle.
 *
 * v1.8.5 - 2025-08-21
 * - Implemented event listeners for Beta Toolkit toggles to show/hide features.
 *
 * v1.8.4 - 2025-08-21
 * - Added logic to hide "Sort by Reactions" option by default for MVP.
 *
 * v1.8.3 - 2025-08-21
 * - Stripped down to MVP: Removed reaction bar and complex button listeners.
 *
 * v1.8.2 - 2025-08-21
 * - Fixed bug where action buttons (promote, demote, remove) on favorites carousel were not working.
 *
 * v1.8.1 - 2025-08-21
 * - Refined card interactions: Emoji clicks no longer open the modal.
 * - Added mouse wheel scrolling to the horizontal favorites carousel.
 *
 * v1.8.0 - 2025-08-21
 * - Removed Undo/Redo and Autosave functionality for MVP simplification.
 *
 * v1.7.2 - 2025-08-21
 * - Updated scroll listeners to support a vertical catalog layout.
 * - Removed horizontal mouse wheel scroll functionality.
 */



import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD, REACTION_SCORES } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
const imageCache = new Map();



// --- STATE & HISTORY ---
export function recordStateForUndo() {
    if (state.history.isRestoring) return;
    const currentState = {
        items: new Map(state.cart.items),
        lockedItems: new Map(state.cart.lockedItems),
        combined: new Map(state.eventDetails.combined)
    };
    state.history.undoStack.push(currentState);
    state.history.redoStack = [];
    ui.updateHistoryButtons();
}

async function restoreState(newState) {
    state.history.isRestoring = true;
    state.cart.items = newState.items;
    state.cart.lockedItems = newState.lockedItems;
    state.eventDetails.combined = newState.combined;
    state.history.isRestoring = false;
    await updateRender();
}

function undo() {
    if (state.history.undoStack.length > 1) {
        const currentState = state.history.undoStack.pop();
        state.history.redoStack.push(currentState);
        const prevState = state.history.undoStack[state.history.undoStack.length - 1];
        restoreState(prevState);
    }
}

function redo() {
    if (state.history.redoStack.length > 0) {
        const nextState = state.history.redoStack.pop();
        state.history.undoStack.push(nextState);
        restoreState(nextState);
    }
}


// --- CORE LOGIC ---
function getInitials(name = '') { return name.split(' ').map(n => n[0]).join('').toUpperCase(); }
export function calculateReactionScore(recordId) {
    const reactions = state.session.reactions.get(recordId) || {};
    return Object.values(reactions).reduce((score, emoji) => score + (REACTION_SCORES[emoji] || 0), 0);
}
export function getRecordPrice(record, optionIndex = null) {
    let price = record.fields[CONSTANTS.FIELD_NAMES.PRICE] ? parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE]).replace(/[^0-9.-]+/g, "")) : 0;
    if (optionIndex !== null) {
        const options = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const variation = options[optionIndex];
        if (variation) {
            if (variation.absolutePrice !== null) {
                return variation.absolutePrice;
            }
            if (variation.priceChange !== null) {
                price += variation.priceChange;
            }
        }
    }
    return price;
}
function checkUserProfile() {
    state.session.user = localStorage.getItem('userName');
    if (!state.session.user) {
        state.session.user = prompt("Welcome! Please enter your name to collaborate:", "");
        if (state.session.user) {
            localStorage.setItem('userName', state.session.user);
            if (!state.session.collaborators.includes(state.session.user)) state.session.collaborators.push(state.session.user);
        } else {
            state.session.user = 'Guest';
            if (!state.session.collaborators.includes('Guest')) state.session.collaborators.push('Guest');
        }
    } else {
        if (!state.session.collaborators.includes(state.session.user)) {
            state.session.collaborators.push(state.session.user);
        }
    }
    ui.renderCollaborators(getInitials);
}
export async function handleReaction(recordId, emoji) {
    if (!state.session.reactions.has(recordId)) {
        state.session.reactions.set(recordId, {});
    }
    const reactions = state.session.reactions.get(recordId);
    if (reactions[state.session.user] === emoji) {
        delete reactions[state.session.user];
    } else {
        reactions[state.session.user] = emoji;
    }
    await updateRender();
}
export function getStoredSessions() { return JSON.parse(localStorage.getItem('savedSessions') || '{}'); }
export function storeSession(id, name) { const sessions = getStoredSessions(); sessions[id] = name;
localStorage.setItem('savedSessions', JSON.stringify(sessions)); }
async function applyFilters() {
    state.ui.recordsCurrentlyDisplayed = 0;
    ui.catalogContainer.innerHTML = '';

    const nameValue = ui.nameFilter.value.toLowerCase();
    const priceValue = ui.priceFilter.value;
    const durationValue = ui.durationFilter.value;
    const statusValue = ui.statusFilter.value;
    state.ui.currentSort = ui.sortBy.value;
    state.records.filtered = state.records.all.filter(record => {
        const nameMatch = !nameValue || (record.fields[CONSTANTS.FIELD_NAMES.NAME] && record.fields[CONSTANTS.FIELD_NAMES.NAME].toLowerCase().includes(nameValue));
        const priceMatch = (priceValue === 'all') ? true : (() => {
            const price = getRecordPrice(record);
            if (price === null) return false;
            switch (priceValue) {
                case '0-50': return price < 50;
                case '50-100': return price >= 50 && price <= 100;
                case '100-250': return price > 100 && price <= 250;
                case '250-plus': return price > 250;
                default: return true;
            }
        })();
        const durationMatch = durationValue === 'all' || (record.fields[CONSTANTS.FIELD_NAMES.DURATION] && String(record.fields[CONSTANTS.FIELD_NAMES.DURATION]) === durationValue);
        const statusMatch = statusValue === 'all' || (record.fields[CONSTANTS.FIELD_NAMES.STATUS] && record.fields[CONSTANTS.FIELD_NAMES.STATUS] === statusValue);
        return nameMatch && priceMatch && durationMatch && statusMatch;
    });

    state.records.filtered.sort((a, b) => {
        switch (state.ui.currentSort) {
            case 'price-asc':
                return getRecordPrice(a) - getRecordPrice(b);
            case 'price-desc':
                return getRecordPrice(b) - getRecordPrice(a);
            case 'name-asc':
                return (a.fields[CONSTANTS.FIELD_NAMES.NAME] || '').localeCompare(b.fields[CONSTANTS.FIELD_NAMES.NAME] || '');
            case 'reactions-desc':
                default:
                    return calculateReactionScore(b.id) - calculateReactionScore(a.id);
        }
    });
    loadMoreRecords();
}
async function loadMoreRecords() {
    if (state.ui.isLoadingMore || state.ui.recordsCurrentlyDisplayed >= state.records.filtered.length) {
        return;
    }
    state.ui.isLoadingMore = true;
    const start = state.ui.recordsCurrentlyDisplayed;
    const end = start + RECORDS_PER_LOAD;
    const recordsToLoad = state.records.filtered.slice(start, end);
    await ui.renderRecords(recordsToLoad, imageCache);
    state.ui.recordsCurrentlyDisplayed = end;
    state.ui.isLoadingMore = false;
}
export async function updateRender() { // Exported for ui.js
    ui.updateHeader();
    await ui.updateFavoritesCarousel();
    await applyFilters();
}

function setupEventListeners() {
    // BETA TOOLKIT LISTENERS
    document.getElementById('beta-trigger').addEventListener('click', () => {
        document.getElementById('beta-toolkit').classList.toggle('visible');
    });

    document.getElementById('collab-mode-toggle').addEventListener('change', (e) => {
        document.body.classList.toggle('collab-mode-enabled', e.target.checked);
        const reactionsSortOption = document.getElementById('sort-by-reactions');
        reactionsSortOption.style.display = e.target.checked ? 'block' : 'none';
        if (!e.target.checked && ui.sortBy.value === 'reactions-desc') {
            ui.sortBy.value = 'price-asc'; // Reset to default sort
        }
        updateRender();
    });

    document.getElementById('planner-mode-toggle').addEventListener('change', (e) => {
        document.body.classList.toggle('planner-mode-enabled', e.target.checked);
        updateRender();
    });

    document.getElementById('history-mode-toggle').addEventListener('change', (e) => {
        document.body.classList.toggle('history-mode-enabled', e.target.checked);
    });

    // REGULAR EVENT LISTENERS
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('redo-btn').addEventListener('click', redo);
    
    const filterInputs = [ui.nameFilter, ui.priceFilter, ui.durationFilter, ui.statusFilter, ui.sortBy];
    filterInputs.forEach(input => {
        input.addEventListener('change', applyFilters);
    });
    document.getElementById('reset-filters').addEventListener('click', () => {
        ui.nameFilter.value = '';
        ui.priceFilter.value = 'all';
        ui.durationFilter.value = 'all';
        ui.statusFilter.value = 'all';
        ui.sortBy.value = document.body.classList.contains('collab-mode-enabled') ? 'reactions-desc' : 'price-asc';
        applyFilters();
    });
    document.getElementById('add-collaborator-btn').addEventListener('click', () => {
        const newName = prompt("Enter collaborator's name:");
        if (newName && !state.session.collaborators.includes(newName)) {
            state.session.collaborators.push(newName);
            ui.renderCollaborators(getInitials);
        }
    });
    
    window.addEventListener('scroll', () => {
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
            loadMoreRecords();
        }
    });

    document.body.addEventListener('click', async (e) => {
        const reactionBtn = e.target.closest('.reaction-bar button');
        if (reactionBtn) {
            e.stopPropagation();
            await handleReaction(reactionBtn.dataset.recordId, reactionBtn.dataset.emoji);
        }
    });

    ui.favoritesCarousel.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
            e.preventDefault();
            ui.favoritesCarousel.scrollLeft += e.deltaY;
        }
    });

    ui.favoritesCarousel.addEventListener('click', async (e) => {
        const removeBtn = e.target.closest('.remove-btn');
        if (removeBtn) {
            e.stopPropagation();
            recordStateForUndo();
            const compositeId = removeBtn.dataset.compositeId;
            state.cart.items.delete(compositeId);
            state.cart.lockedItems.delete(compositeId);
            await updateRender();
            return;
        }

        const promoteBtn = e.target.closest('.promote-btn');
        if (promoteBtn) {
            e.stopPropagation();
            recordStateForUndo();
            const compositeId = promoteBtn.dataset.compositeId;
            const itemData = state.cart.items.get(compositeId);
            if (itemData) {
                state.cart.lockedItems.set(compositeId, itemData);
                state.cart.items.delete(compositeId);
                await updateRender();
            }
            return;
        }

        const demoteBtn = e.target.closest('.demote-btn');
        if (demoteBtn) {
            e.stopPropagation();
            recordStateForUndo();
            const compositeId = demoteBtn.dataset.compositeId;
            const itemData = state.cart.lockedItems.get(compositeId);
            if (itemData) {
                state.cart.items.set(compositeId, itemData);
                state.cart.lockedItems.delete(compositeId);
                await updateRender();
            }
            return;
        }

        const favoriteItem = e.target.closest('.favorite-item');
        if (favoriteItem && !e.target.closest('button')) {
            const compositeId = favoriteItem.dataset.compositeId;
            await ui.openDetailModal(compositeId, imageCache);
        }
    });

    ui.catalogContainer.addEventListener('click', async function(e) {
        const heart = e.target.closest('.heart-icon');
        if (heart) {
            e.stopPropagation();
            recordStateForUndo();
            
            const card = heart.closest('.event-card');
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const options = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            
            const compositeId = heart.dataset.compositeId;
            if (state.cart.items.has(compositeId) || state.cart.lockedItems.has(compositeId)) {
                return;
            }

            const quantity = card.querySelector('.quantity-input').value;
            const itemInfo = { quantity: parseInt(quantity), requests: '' };
            state.cart.items.set(compositeId, itemInfo);

            const allOptionsFavorited = options.every((opt, index) => {
                const id = `${recordId}-${index}`;
                return state.cart.items.has(id) || state.cart.lockedItems.has(id);
            });

            if (options.length > 0 && allOptionsFavorited) {
                card.remove();
            } else if (options.length === 0) {
                card.remove();
            } else {
                const newCard = await ui.createEventCardElement(record, imageCache);
                card.replaceWith(newCard);
            }
            
            await ui.updateFavoritesCarousel();
            return;
        }
        
        if (e.target.closest('button')) {
            return;
        }

        const card = e.target.closest('.event-card');
        if (card) {
            const compositeId = card.querySelector('.heart-icon').dataset.compositeId;
            await ui.openDetailModal(compositeId, imageCache);
        }
    });
    
    const headerInputs = [ui.headerEventNameInput, ui.headerDateInput, ui.headerHeadcountInput, ui.headerGoalsInput];
    headerInputs.forEach(input => {
        input.addEventListener('change', (e) => {
            recordStateForUndo();
            const value = e.target.value;
            let detailType;
            switch (e.target.id) {
                case 'header-event-name': detailType = CONSTANTS.DETAIL_TYPES.EVENT_NAME; break;
                case 'header-date': detailType = CONSTANTS.DETAIL_TYPES.DATE; break;
                case 'header-headcount': detailType = CONSTANTS.DETAIL_TYPES.GUEST_COUNT; break;
                case 'header-goals': detailType = CONSTANTS.DETAIL_TYPES.GOALS; break;
            }
            if (detailType) {
                state.eventDetails.combined.set(detailType, value);
                ui.updateHeader();
            }
        });
    });
    document.getElementById('save-share-btn').addEventListener('click', async () => {
        const success = await api.saveSessionToAirtable();
        if (success) {
            document.getElementById('save-status').textContent = 'Saved!';
            const shareLinkContainer = document.getElementById('share-link-container');
            shareLinkContainer.style.display = 'inline-flex';
            document.getElementById('share-link').value = window.location.href;
            ui.populateSessionsDropdown(getStoredSessions);
        }
        setTimeout(() => {
            if (document.getElementById('save-status').textContent !== 'Saving...') {
                document.getElementById('save-status').textContent = '';
            }
        }, 3000);
    });
    
    ui.sessionsDropdown.addEventListener('change', async (e) => {
        const selectedId = e.target.value;
        if (selectedId) {
            await api.loadSessionFromAirtable(selectedId);
            await updateRender();
            e.target.value = '';
        }
    });
}



// --- INITIALIZATION ---
async function initialize() {
    console.log('Starting initialize...');
    ui.toggleLoading(true);
    
    try {
        console.log('Fetching records from Airtable...');
        state.records.all = await api.fetchAllRecords();
        console.log('Records fetched:', state.records.all.length);
    } catch (error) {
        console.error("Failed to load records:", error);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please try again later.</p>`;
        ui.toggleLoading(false);
        return;
    }
    
    console.log('Checking for session ID in URL...');
    const urlParams = new URLSearchParams(window.location.search);
    const sessionIdFromUrl = urlParams.get('session');
    if (sessionIdFromUrl) {
        console.log('Loading session:', sessionIdFromUrl);
        await api.loadSessionFromAirtable(sessionIdFromUrl);
        console.log('Session loaded');
    }
    
    recordStateForUndo();
    console.log('Checking user profile...');
    checkUserProfile();
    console.log('Populating sessions dropdown...');
    ui.populateSessionsDropdown(getStoredSessions);
    console.log('Toggling loading off...');
    ui.toggleLoading(false);
    
    console.log('Populating filters...');
    ui.populateFilter(ui.durationFilter, CONSTANTS.FIELD_NAMES.DURATION);
    ui.populateFilter(ui.statusFilter, CONSTANTS.FIELD_NAMES.STATUS);
    
    console.log('Setting up event listeners...');
    setupEventListeners();
    ui.collapseHeaderOnScroll();
    
    document.getElementById('sort-by-reactions').style.display = 'none';
    ui.sortBy.value = 'price-asc'; 

    console.log('Updating render...');
    await updateRender();
    console.log('Initialize complete');
}



initialize();
