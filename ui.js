// ui.js
import { state } from './state.js';
import { CONSTANTS, EMOJI_REACTIONS, RECORDS_PER_LOAD } from './config.js';
import { fetchImageForRecord } from './api.js';
import { calculateReactionScore } from './main.js';
// --- DOM ELEMENT EXPORTS ---
export const catalogContainer = document.getElementById('catalog-container');
export const favoritesCarousel = document.getElementById('favorites-carousel');
export const nameFilter = document.getElementById('name-filter');
export const priceFilter = document.getElementById('price-filter');
export const durationFilter = document.getElementById('duration-filter');
export const statusFilter = document.getElementById('status-filter');
export const guestCountInput = document.getElementById('guest-count');
export const summaryEventNameInput = document.getElementById('summary-event-name');
export const summaryDateInput = document.getElementById('summary-date');
export const summaryHeadcountInput = document.getElementById('summary-headcount');
export const summaryLocationInput = document.getElementById('summary-location');
export const stickyHeader = document.getElementById('sticky-header');
const loadingMessage = document.getElementById('loading-message');
const totalCostEl = document.getElementById('total-cost');
const summaryTotalCostEl = document.getElementById('summary-total-cost');
const favoritesSection = document.getElementById('favorites-section');
const eventTitleHeader = document.getElementById('event-title-header');
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
// --- HELPER FUNCTIONS ---
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
    const imageUrl = await fetchImageForRecord(record, imageCache);
    itemCard.style.backgroundImage = `url('${imageUrl}')`;
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
    let basePrice = fields[CONSTANTS.FIELD_NAMES.PRICE] ? parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE]).replace(/[^0-9.-]+/g, "")) : null;
    const eventCard = document.createElement('div');
    eventCard.className = 'event-card';
    eventCard.dataset.recordId = recordId;
    const imageUrl = await fetchImageForRecord(record, imageCache);
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
    const initialQuantity = Math.max(parseInt(guestCountInput.value), headcountMin);
    // *** THE FIX IS HERE: Added edit-card-btn ***
    eventCard.innerHTML = `<button class="edit-card-btn">🪄</button> <div class="event-card-content"> <div class="heart-icon ${isHearted ? 'hearted' : ''}" data-composite-id="${compositeId}"> <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg> </div> <h3>${fields[CONSTANTS.FIELD_NAMES.NAME] || 'Untitled Event'}</h3> ${optionsDropdownHTML} <p class="details">${fields[CONSTANTS.FIELD_NAMES.DURATION] ? `Duration: ${fields[CONSTANTS.FIELD_NAMES.DURATION]} hours` : ''}</p> <div class="price-quantity-wrapper"> <div class="price" data-unit-price="${basePrice}"> ${basePrice !== null ? '$' + basePrice.toFixed(2) : 'N/A'} <span style="font-size: 0.7em; font-weight: normal;">${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || ''}</span> </div> <div class="quantity-selector"> <button class="quantity-btn minus" aria-label="Decrease quantity">-</button> <input type="number" class="quantity-input" value="${initialQuantity}" min="${headcountMin}"> <button class="quantity-btn plus" aria-label="Increase quantity">+</button> </div> </div> </div> <div class="card-footer">${renderReactionsSummary(recordId)}</div> ${renderReactionbar(recordId)} `;
    
    const dropdown = eventCard.querySelector('.options-selector');
    const heartIcon = eventCard.querySelector('.heart-icon');
    const quantityInput = eventCard.querySelector('.quantity-input');
    const plusBtn = eventCard.querySelector('.quantity-btn.plus');
    const minusBtn = eventCard.querySelector('.quantity-btn.minus');
    const priceEl = eventCard.querySelector('.price');
    const updatePrice = () => {
        const unitPrice = parseFloat(priceEl.dataset.unitPrice);
        if (!isNaN(unitPrice)) {
            priceEl.innerHTML = `$${unitPrice.toFixed(2)} <span style="font-size: 0.7em; font-weight: normal;">${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || ''}</span>`;
        }
    };
    
    if (dropdown) {
        dropdown.addEventListener('change', () => {
            const selectedIndex = dropdown.value;
            const selectedOption = options[selectedIndex];
            const newBasePrice = (basePrice || 0) + selectedOption.priceChange;
            priceEl.dataset.unitPrice = newBasePrice;
            updatePrice();
            const newCompositeId = `${recordId}-${selectedIndex}`;
            heartIcon.dataset.compositeId = newCompositeId;
            eventCard.querySelector('.edit-card-btn').dataset.compositeId = newCompositeId; // Keep edit button in sync
            heartIcon.classList.toggle('hearted', state.cart.items.has(newCompositeId) || state.cart.lockedItems.has(newCompositeId));
        });
        dropdown.dispatchEvent(new Event('change'));
    } else {
        updatePrice();
    }
    
    if (plusBtn) plusBtn.addEventListener('click', () => { quantityInput.value = parseInt(quantityInput.value) + 1; guestCountInput.value = quantityInput.value; });
    if (minusBtn) minusBtn.addEventListener('click', () => { const current = parseInt(quantityInput.value); const min = parseInt(quantityInput.min); if (current > min) { quantityInput.value = current - 1; guestCountInput.value = quantityInput.value; } });
    quantityInput.addEventListener('change', () => { const min = parseInt(quantityInput.min); if (parseInt(quantityInput.value) < min) { quantityInput.value = min; } guestCountInput.value = quantityInput.value; });
    eventCard.querySelector('.edit-card-btn').dataset.compositeId = heartIcon.dataset.compositeId;
    return eventCard;
}
export async function renderRecords(recordsToRender, imageCache) {
    if (recordsToRender.length === 0 && state.ui.recordsCurrentlyDisplayed === 0) {
        catalogContainer.innerHTML = "<p style='text-align: center; width: 100%;'>No events match the current filters.</p>";
    }
    for (const record of recordsToRender) {
        const eventCard = await createEventCardElement(record, imageCache);
        catalogContainer.appendChild(eventCard);
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
    // REMOVED eventDetails.combined.forEach loop
    const sortedLockedItems = Array.from(state.cart.lockedItems.entries()).sort(([idA], [idB]) => calculateReactionScore(idB.split('-')[0]) - calculateReactionScore(idA.split('-')[0]));
    for (const [compositeId, itemInfo] of sortedLockedItems) {
        const card = await createFavoriteCardElement(compositeId, itemInfo, true, imageCache);
        if (card) favoritesCarousel.appendChild(card);
    }
    const sortedItems = Array.from(state.cart.items.entries()).sort(([idA], [idB]) => calculateReactionScore(idB.split('-')[0]) - calculateReactionScore(idA.split('-')[0]));
    for (const [compositeId, itemInfo] of sortedItems) {
        const card = await createFavoriteCardElement(compositeId, itemInfo, false, imageCache);
        if (card) favoritesCarousel.appendChild(card);
    }
    updateTotalCost();
    updateHeader();
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
export function toggleLoading(show) {
    loadingMessage.style.display = show ? 'block' : 'none';
    filterControls.style.display = show ? 'none' : 'flex';
}
export function updateHeader() {
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Your Event';
    eventTitleHeader.textContent = eventName;
    document.title = eventName === 'Your Event' ? 'Event Catalog' : `TMT - ${eventName}`;
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
        const card = document.querySelector(`.event-card[data-record-id="${record.id}"]`);
        itemInfo = { quantity: card ? card.querySelector('.quantity-input').value : 1, requests: '' };
    }
    const fields = record.fields;
    const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    let basePrice = fields[CONSTANTS.FIELD_NAMES.PRICE] ? parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE]).replace(/[^0-9.-]+/g, "")) : null;
    let optionsDropdownHTML = '';
    if (options.length > 0) {
        const optionIndex = compositeId.split('-')[1] || 0;
        optionsDropdownHTML = `<div class="form-group"><label>Options</label><select id="modal-options" ${isLocked ? 'disabled' : ''}>${options.map((opt, index) => `<option value="${index}" ${index == optionIndex ? 'selected' : ''}>${opt.name}</option>`).join('')}</select></div>`;
    }
    const isHearted = state.cart.items.has(compositeId) || state.cart.lockedItems.has(compositeId);
    modalBody.innerHTML = `<h3>${fields[CONSTANTS.FIELD_NAMES.NAME]}</h3><p class="description">${fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || 'No description available.'}</p>${optionsDropdownHTML}<div class="price-quantity-wrapper" style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px;"><div class="price" data-unit-price="${basePrice}"></div><div class="quantity-selector"><button class="quantity-btn minus" aria-label="Decrease quantity" ${isLocked ? 'disabled' : ''}>-</button><input type="number" class="quantity-input" value="${itemInfo.quantity}" min="${fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1}" ${isLocked ? 'readonly' : ''}><button class="quantity-btn plus" aria-label="Increase quantity" ${isLocked ? 'disabled' : ''}>+</button></div></div><div class="modal-footer"><div class="heart-icon ${isHearted ? 'hearted' : ''}" data-composite-id="${compositeId}"> <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg></div><div class="reactions-summary">${renderReactionsSummary(record.id)}</div></div>`;
    
    const imageUrl = await fetchImageForRecord(record, imageCache);
    modalContent.style.backgroundImage = `url('${imageUrl}')`;
    modalOverlay.style.display = 'flex';
    
    const modalPriceEl = modalBody.querySelector('.price');
    function updateModalPrice() {
        const unitPrice = parseFloat(modalPriceEl.dataset.unitPrice);
        if (!isNaN(unitPrice)) {
            modalPriceEl.innerHTML = `$${unitPrice.toFixed(2)} <span style="font-size: 0.7em; font-weight: normal;">${fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || ''}</span>`;
        }
    }
    modalPriceEl.dataset.unitPrice = basePrice;
    if (options.length > 0) {
        const optionIndex = compositeId.split('-')[1] || 0;
        const selectedOption = options[optionIndex];
        modalPriceEl.dataset.unitPrice = (basePrice || 0) + selectedOption.priceChange;
    }
    updateModalPrice();
    modalBody.querySelectorAll('select, input, button, .heart-icon').forEach(el => el.addEventListener('click', e => e.stopPropagation()));
}
