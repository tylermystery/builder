/*
 * Version: 2.1.0
 * Last Modified: 2025-08-23
 *
 * Changelog:
 *
 * v2.1.0 - 2025-08-23
 * - Refactored createFavoriteCardElement to support new interactive item structure.
 * - Updated updateFavoritesCarousel to correctly render new favorited items.
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
    itemCard.dataset.recordId = record.id; // Use recordId for consistency

    const imageUrls = await fetchImagesForRecord(record, imageCache);
    itemCard.style.backgroundImage = `url('${imageUrls[0] || ''}')`;

    // Favorites get a simple remove button, not the complex interactive controls
    const cardActionsHTML = `<button class="action-btn remove-btn" title="Remove" data-composite-id="${record.id}">×</button>`;

    itemCard.innerHTML = `
        <div class="card-actions">${cardActionsHTML}</div>
        <div class="favorite-item-content">
            <p class="item-name">${fields[CONSTANTS.FIELD_NAMES.NAME]}</p>
            ${variationNameHTML}
            <p class="item-price">$${itemPrice.toFixed(2)}</p>
        </div>`;
    return itemCard;
}

export async function createInteractiveCard(record, imageCache) {
    const fields = record.fields;
    const recordId = record.id;
    const allRecords = state.records.all;

    // --- Determine Card Type ---
    // An item is a "Grouping" if its options match the names of other records.
    const rawOptions = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));

    const eventCard = document.createElement('div');
    eventCard.className = 'event-card';
    eventCard.dataset.recordId = recordId;

    // --- Card Anatomy & Controls ---
    const parentId = fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] ? fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM][0] : null;
    const parentButtonHTML = parentId ? `<button class="card-btn parent-btn" title="Go Up">⬆️</button>` : '';
    const explodeButtonHTML = isGrouping ? `<button class="card-btn explode-btn" title="Explode">💥</button>` : '';

    let optionsControlHTML = '';
    if (isGrouping) {
        // RENDER NAVIGATIONAL OPTIONS for Groupings
        optionsControlHTML = `<select class="options-selector navigate-options">
            <option value="">Select an option...</option>
            ${rawOptions.map(opt => `<option value="${opt.name}">${opt.name}</option>`).join('')}
        </select>`;
    } else {
        // RENDER CONFIGURATION OPTIONS for Bookable Items
        optionsControlHTML = `<select class="options-selector configure-options">
             ${rawOptions.map((opt, index) => `<option value="${index}">${opt.name}</option>`).join('')}
        </select>`;
        // We can add the notes field here later
    }

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
            <div class="price-quantity-wrapper">
                <div class="price">$${parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, "")).toFixed(2)}</div>
            </div>
        </div>`;
    // Fetch and set background image
    const imageUrls = await fetchImagesForRecord(record, imageCache);
    eventCard.style.backgroundImage = `url('${imageUrls[0] || ''}')`;
    return eventCard;
}
export async function renderRecords(recordsToRender, imageCache) {
    if (recordsToRender.length === 0 && state.ui.recordsCurrentlyDisplayed === 0) {
        catalogContainer.innerHTML = "<p style='text-align: center; width: 100%;'>No events match the current filters.</p>";
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

    allItems.forEach((itemInfo, recordId) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) return;

        let unitPrice = getRecordPrice(record, itemInfo.selectedOptionIndex);
        if (isNaN(unitPrice)) return;

        total += unitPrice;
    });

    const formattedTotal = `$${total.toFixed(2)}`;
    totalCostEl.textContent = formattedTotal;
    
    updateHeaderSummary();
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

export async function openDetailModal(recordId, imageCache) {
    const record = state.records.all.find(r => r.id === recordId);
    if (!record) return;

    // Build a new interactive card for the modal
    const modalCard = await createInteractiveCard(record, imageCache);

    // Clear the modal body and append the new card
    modalBody.innerHTML = '';
    modalBody.appendChild(modalCard);

    // Style the modal and card for the detailed view
    modalContent.style.backgroundImage = modalCard.style.backgroundImage;
    modalOverlay.style.display = 'flex';

    // Add a close listener to the overlay
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            modalOverlay.style.display = 'none';
        }
    });
}
