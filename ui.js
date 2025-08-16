// ui.js
import { state } from './state.js';
import { CONSTANTS, EMOJI_REACTIONS } from './config.js';
import { fetchImageForRecord } from './api.js';

// DOM Elements managed by the UI module
export const catalogContainer = document.getElementById('catalog-container');
export const favoritesCarousel = document.getElementById('favorites-carousel');
const loadingMessage = document.getElementById('loading-message');
const totalCostEl = document.getElementById('total-cost');
const summaryTotalCostEl = document.getElementById('summary-total-cost');
const favoritesSection = document.getElementById('favorites-section');
const eventTitleHeader = document.getElementById('event-title-header');
const headerSummary = document.getElementById('header-summary');
const collaboratorsSection = document.getElementById('collaborators-section');
const sessionsDropdownContainer = document.getElementById('sessions-dropdown-container');
const sessionsDropdown = document.getElementById('sessions-dropdown');
const summaryEventNameInput = document.getElementById('summary-event-name');
const summaryDateInput = document.getElementById('summary-date');
const summaryHeadcountInput = document.getElementById('summary-headcount');
const summaryLocationInput = document.getElementById('summary-location');
const filterControls = document.getElementById('filter-controls');
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');

// Helper function
function parseOptions(optionsText) {
    if (!optionsText) return [];
    return optionsText.split('\n').map(line => {
        const parts = line.split(',').map(p => p.trim());
        const option = { name: parts[0], priceChange: 0, durationChange: 0 };
        parts.slice(1).forEach(part => {
            if (part.includes('$')) {
                option.priceChange = parseFloat(part.replace(/[^0-9.-]+/g, '')) || 0;
            } else if (part.toLowerCase().includes('duration change')) {
                option.durationChange = parseFloat(part.replace(/[^0-9.-]+/g, '')) || 0;
            }
        });
        return option;
    });
}

// Reaction UI Functions
function renderReactionsSummary(recordId) {
    const reactions = state.session.reactions.get(recordId) || {};
    let reactionsSummaryHTML = '';
    const reactionCounts = {};
    Object.values(reactions).forEach(emoji => {
        reactionCounts[emoji] = (reactionCounts[emoji] || 0) + 1;
    });
    reactionsSummaryHTML = Object.entries(reactionCounts).map(([emoji, count]) => `<div class="reaction-pill" title="${emoji}">${emoji} ${count}</div>`).join('');
    return `<div class="reactions-summary">${reactionsSummaryHTML}</div>`;
}

function renderReactionbar(recordId) {
    return `<div class="reaction-bar">${EMOJI_REACTIONS.map(emoji => `<button data-record-id="${recordId}" data-emoji="${emoji}">${emoji}</button>`).join('')}</div>`;
}

// Main Card Builder Functions
export async function createFavoriteCardElement(compositeId, itemInfo, isLocked) {
    const record = state.records.all.find(r => r.id === compositeId.split('-')[0]);
    if (!record) return null;
    const fields = record.fields;
    let variationNameHTML = '';
    let itemPrice = fields[CONSTANTS.FIELD_NAMES.PRICE] ? parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE]).replace(/[^0-9.-]+/g, "")) : 0;
    const optionIndex = compositeId.split('-')[1];
    if (optionIndex) {
        const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const variation = options[optionIndex];
        if (variation) {
            variationNameHTML = `<p class="variation-name">${variation.name}</p>`;
            itemPrice += variation.priceChange;
        }
    }
    const itemCard = document.createElement('div');
    itemCard.className = `favorite-item ${isLocked ? 'locked-item' : ''}`;
    itemCard.dataset.compositeId = compositeId;
    itemCard.dataset.recordId = record.id;
    const imageUrl = await fetchImageForRecord(record, new Map()); // Using a temp cache for simplicity here
    itemCard.style.backgroundImage = `url('${imageUrl}')`;
    let primaryActionHTML = '';
    let secondaryActionHTML = '';
    if (isLocked) {
        primaryActionHTML = `<button class="primary-action-btn" title="Locked In">⛓️</button>`;
        secondaryActionHTML = `<button class="secondary-action-btn demote-btn" data-composite-id="${compositeId}" title="Unlock">🔨</button>`;
    } else {
        primaryActionHTML = `<button class="primary-action-btn promote-btn" data-composite-id="${compositeId}"><span class="icon-default">💘</span><span class="icon-hover">💍</span></button>`;
        secondaryActionHTML = `<button class="secondary-action-btn remove-btn" data-composite-id="${compositeId}" title="Remove">💔</button>`;
    }
    itemCard.innerHTML = `<div class="action-btn-container">${primaryActionHTML}</div><button class="edit-card-btn" data-composite-id="${compositeId}">🪄</button>${secondaryActionHTML}<div class="favorite-item-content"><p class="item-name">${fields[CONSTANTS.FIELD_NAMES.NAME]}</p>${variationNameHTML}<p class="item-quantity">Qty: ${itemInfo.quantity}</p><p class="item-price">$${itemPrice.toFixed(2)} ${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || ''}</p></div><div class="card-footer">${renderReactionsSummary(record.id)}</div>${renderReactionbar(record.id)}`;
    return itemCard;
}

export async function createEventCardElement(record) {
    const fields = record.fields;
    const recordId = record.id;
    const headcountMin = fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] ? parseInt(fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN]) : 1;
    const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    let basePrice = null;
    if (fields[CONSTANTS.FIELD_NAMES.PRICE]) {
        const cleanedPrice = String(fields[CONSTANTS.FIELD_NAMES.PRICE]).replace(/[^0-9.-]+/g, "");
        if (cleanedPrice && !isNaN(parseFloat(cleanedPrice))) {
            basePrice = parseFloat(cleanedPrice);
        }
    }
    const eventCard = document.createElement('div');
    eventCard.className = 'event-card';
    eventCard.dataset.recordId = recordId;
    const imageUrl = await fetchImageForRecord(record, new Map());
    eventCard.style.backgroundImage = `url('${imageUrl}')`;
    let optionsDropdownHTML = '';
    let nextUnfavoritedOptionIndex = 0;
    if (options.length > 0) {
        nextUnfavoritedOptionIndex = options.findIndex((opt, index) => !state.cart.items.has(`${recordId}-${index}`) && !state.cart.lockedItems.has(`${recordId}-${index}`));
        if (nextUnfavoritedOptionIndex === -1) nextUnfavoritedOptionIndex = 0;
        optionsDropdownHTML = ` <select class="options-selector"> ${options.map((opt, index) => `<option value="${index}" ${index === nextUnfavoritedOptionIndex ? 'selected' : ''}>${opt.name}</option>`).join('')} </select> `;
    }
    const compositeId = options.length > 0 ? `${recordId}-${nextUnfavoritedOptionIndex}` : recordId;
    const isHearted = state.cart.items.has(compositeId) || state.cart.lockedItems.has(compositeId);
    const initialQuantity = Math.max(parseInt(document.getElementById('guest-count').value), headcountMin);
    eventCard.innerHTML = ` <div class="event-card-content"> <div class="heart-icon ${isHearted ? 'hearted' : ''}" data-composite-id="${compositeId}"> <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg> </div> <h3>${fields[CONSTANTS.FIELD_NAMES.NAME] || 'Untitled Event'}</h3> ${optionsDropdownHTML} <p class="details">${fields[CONSTANTS.FIELD_NAMES.DURATION] ? `Duration: ${fields[CONSTANTS.FIELD_NAMES.DURATION]} hours` : ''}</p> <div class="price-quantity-wrapper"> <div class="price" data-unit-price="${basePrice}"> ${basePrice !== null ? '$' + basePrice.toFixed(2) : 'N/A'} <span style="font-size: 0.7em; font-weight: normal;">${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || ''}</span> </div> <div class="quantity-selector"> <button class="quantity-btn minus" aria-label="Decrease quantity">-</button> <input type="number" class="quantity-input" value="${initialQuantity}" min="${headcountMin}"> <button class="quantity-btn plus" aria-label="Increase quantity">+</button> </div> </div> </div> <div class="card-footer">${renderReactionsSummary(recordId)}</div> ${renderReactionbar(recordId)} `;
    
    const dropdown = eventCard.querySelector('.options-selector');
    const heartIcon = eventCard.querySelector('.heart-icon');
    const quantityInput = eventCard.querySelector('.quantity-input');
    const plusBtn = eventCard.querySelector('.quantity-btn.plus');
    const minusBtn = eventCard.querySelector('.quantity-btn.minus');
    const priceEl = eventCard.querySelector('.price');

    function updatePrice() {
        const unitPrice = parseFloat(priceEl.dataset.unitPrice);
        if (isNaN(unitPrice)) return;
        priceEl.innerHTML = `$${unitPrice.toFixed(2)} <span style="font-size: 0.7em; font-weight: normal;">${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || ''}</span>`;
    }

    if (dropdown) {
        dropdown.addEventListener('change', (e) => {
            const selectedIndex = e.target.value;
            const selectedOption = options[selectedIndex];
            const newBasePrice = (basePrice || 0) + selectedOption.priceChange;
            const newDuration = (fields[CONSTANTS.FIELD_NAMES.DURATION] || 0) + selectedOption.durationChange;
            priceEl.dataset.unitPrice = newBasePrice;
            updatePrice();
            eventCard.querySelector('.details').textContent = `Duration: ${newDuration} hours`;
            const newCompositeId = `${recordId}-${selectedIndex}`;
            heartIcon.dataset.compositeId = newCompositeId;
            heartIcon.classList.toggle('hearted', state.cart.items.has(newCompositeId) || state.cart.lockedItems.has(newCompositeId));
        });
        dropdown.dispatchEvent(new Event('change'));
    } else {
        updatePrice();
    }

    if (plusBtn) { plusBtn.addEventListener('click', () => { quantityInput.value = parseInt(quantityInput.value) + 1; document.getElementById('guest-count').value = quantityInput.value; }); }
    if (minusBtn) { minusBtn.addEventListener('click', () => { const currentValue = parseInt(quantityInput.value); const min = parseInt(quantityInput.min); if (currentValue > min) { quantityInput.value = currentValue - 1; document.getElementById('guest-count').value = quantityInput.value; } }); }
    quantityInput.addEventListener('change', (e) => { const min = parseInt(e.target.min); if(parseInt(e.target.value) < min) e.target.value = min; document.getElementById('guest-count').value = e.target.value; });

    return eventCard;
}

// Main UI Update Functions
export function showLoadingState() {
    loadingMessage.style.display = 'block';
    filterControls.style.display = 'none';
}

export function hideLoadingState() {
    loadingMessage.style.display = 'none';
    filterControls.style.display = 'flex';
}

export function updateTotalCost() {
    let total = 0;
    const allItems = new Map([...state.cart.items, ...state.cart.lockedItems]);
    allItems.forEach((itemInfo, compositeId) => {
        const record = state.records.all.find(r => r.id === compositeId.split('-')[0]);
        if (record) {
            let unitPrice = record.fields[CONSTANTS.FIELD_NAMES.PRICE] ? parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE]).replace(/[^0-9.-]+/g, "")) : 0;
            const optionIndex = compositeId.split('-')[1];
            if (optionIndex) {
                const options = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
                const variation = options[optionIndex];
                if (variation) unitPrice += variation.priceChange;
            }
            if (record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] && record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE].toLowerCase() === CONSTANTS.PRICING_TYPES.PER_GUEST) {
                const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] ? parseInt(record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN]) : 1;
                const effectiveGuestCount = Math.max(itemInfo.quantity, headcountMin);
                total += unitPrice * effectiveGuestCount;
            } else {
                total += unitPrice;
            }
        }
    });
    const formattedTotal = `$${total.toFixed(2)}`;
    totalCostEl.textContent = formattedTotal;
    summaryTotalCostEl.textContent = formattedTotal;
}

export async function updateFavoritesCarousel(calculateReactionScore) {
    if (state.cart.lockedItems.size === 0 && state.cart.items.size === 0 && state.eventDetails.combined.size === 0) {
        favoritesSection.style.display = 'none';
        return;
    }
    favoritesSection.style.display = 'block';
    favoritesCarousel.innerHTML = '';
    
    state.eventDetails.combined.forEach((value, key) => {
        const favItem = document.createElement('div');
        favItem.className = 'favorite-item detail-favorite';
        favItem.innerHTML = `<div class="favorite-item-content"><p class="item-name">${key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</p><p class="variation-name">${value}</p></div>`;
        favoritesCarousel.appendChild(favItem);
    });

    const sortedLockedItems = Array.from(state.cart.lockedItems.entries()).sort(([idA], [idB]) => calculateReactionScore(idB.split('-')[0]) - calculateReactionScore(idA.split('-')[0]));
    for (const [compositeId, itemInfo] of sortedLockedItems) {
        const card = await createFavoriteCardElement(compositeId, itemInfo, true);
        if (card) favoritesCarousel.appendChild(card);
    }

    const sortedItems = Array.from(state.cart.items.entries()).sort(([idA], [idB]) => calculateReactionScore(idB.split('-')[0]) - calculateReactionScore(idA.split('-')[0]));
    for (const [compositeId, itemInfo] of sortedItems) {
        const card = await createFavoriteCardElement(compositeId, itemInfo, false);
        if (card) favoritesCarousel.appendChild(card);
    }
    
    updateTotalCost();
    updateHeader();
}

export function updateHeader() {
    const itemCount = state.cart.items.size + state.cart.lockedItems.size;
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Your Event';
    eventTitleHeader.textContent = eventName;
    document.title = eventName === 'Your Event' ? 'Event Catalog' : `TMT - ${eventName}`;

    const totalCostText = totalCostEl.textContent;
    if (itemCount > 0) {
        headerSummary.innerHTML = `<span>${eventName}</span> <span><strong>${itemCount}</strong> ${itemCount > 1 ? 'items' : 'item'} selected</span> <strong>${totalCostText}</strong>`;
    } else {
        headerSummary.innerHTML = `<span>${eventName}</span>`;
    }
}

export function updateHistoryButtons() {
    undoBtn.disabled = state.history.undoStack.length <= 1;
    redoBtn.disabled = state.history.redoStack.length === 0;
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

export function updateSummaryToolbar() {
    summaryEventNameInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    summaryDateInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE) || '';
    summaryHeadcountInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT) || 1;
    summaryLocationInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.LOCATION) || '';
}

// And so on for other UI functions like openDetailModal, populateFilter, etc.
