/*
 * Version: 2.18.5
 * Last Modified: 2025-08-30
 *
 * Changelog:
 * v2.18.5 - 2025-08-30
 * - Added availability tooltips (popups) to the calendar in the detail modal.
 *
 * v2.18.4 - 2025-08-30
 * - Fixed "api is not defined" ReferenceError by restoring the missing api.js import.
 */

import { state } from './state.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY } from './config.js';
import * as api from './api.js';
import { parseOptions } from './utils.js';
import { getDayStatus, getBusySlotsForDay } from './availability.js';

let mainGetItemState;
export function initStateHelpers(helpers) {
    mainGetItemState = helpers.getItemState;
}

let stripe, elements, cardElement, clientSecret;

// --- HELPER & LOGIC FUNCTIONS ---
function getBreadcrumbs(record, allRecords) {
    const breadcrumbs = [];
    let current = record;
    while (current && current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]) {
        const parentName = current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
        const parentRecord = allRecords.find(r => r.fields.Name === parentName);
        if (parentRecord) {
            breadcrumbs.unshift(parentRecord);
            current = parentRecord;
        } else {
            break;
        }
    }
    return breadcrumbs;
}

export function getRecordPrice(record, optionIndex = null) {
    let price = parseFloat(String(record?.fields?.[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
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

function getDescendantBookableItems(record, allRecords) {
    let bookableItems = [];
    const children = allRecords.filter(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] === record.fields.Name);
    for (const child of children) {
        const rawOptions = parseOptions(child.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
        const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));
        if (isGrouping) {
            bookableItems = bookableItems.concat(getDescendantBookableItems(child, allRecords));
        } else {
            bookableItems.push(child);
        }
    }
    return bookableItems;
}

export function getGroupPriceRange(record) {
    const descendants = getDescendantBookableItems(record, state.records.all);
    if (descendants.length === 0) return null;
    let minPrice = Infinity, maxPrice = -Infinity;
    descendants.forEach(item => {
        const options = parseOptions(item.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        if (options.length > 0) {
            options.forEach((opt, index) => {
                const price = getRecordPrice(item, index);
                if (price > 0) {
                    if (price < minPrice) minPrice = price;
                    if (price > maxPrice) maxPrice = price;
                }
            });
        } else {
            const price = getRecordPrice(item);
            if (price > 0) {
                if (price < minPrice) minPrice = price;
                if (price > maxPrice) maxPrice = price;
            }
        }
    });
    return (minPrice === Infinity) ? null : { min: minPrice, max: maxPrice };
}

// --- UI RENDERING FUNCTIONS ---
function formatPricingType(pricingType) {
    if (!pricingType) return '';
    const type = pricingType.toLowerCase();
    if (type === 'per guest') return '/ guest';
    if (type === 'per hour') return '/ hour';
    return '';
}

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
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, imageCache);
    itemCard.style.backgroundImage = `url('${imageUrls[0] || ''}')`;
    const cardActionsHTML = `<button class="action-btn remove-btn" title="Remove">×</button>`;
    
    const pricingType = fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const pricingTypeString = formatPricingType(pricingType);
    const showCardTotal = itemInfo.quantity > 1 && pricingTypeString;
    const cardTotal = itemPrice * itemInfo.quantity;
    itemCard.innerHTML = `
        <div class="card-actions">${cardActionsHTML}</div>
        <div class="favorite-item-content">
            <p class="item-name">${fields[CONSTANTS.FIELD_NAMES.NAME]}</p>
            ${variationNameHTML}
            ${noteHTML}
            <div class="favorite-pricing-details">
                <div class="pricing-line-item">
                    <span class="item-quantity">Qty: ${itemInfo.quantity}</span>
                    <span class="item-price">$${itemPrice.toFixed(2)} ${pricingTypeString}</span>
                </div>
                ${showCardTotal ? `<div class="pricing-line-item-total"><span class="item-total-price">Total: $${cardTotal.toFixed(2)}</span></div>` : ''}
            </div>
        </div>`;
    return itemCard;
}

export async function createLockedInItemElement(record, itemInfo) {
    const fields = record.fields;
    const itemElement = document.createElement('div');
    itemElement.className = 'locked-item-card';
    itemElement.dataset.recordId = record.id;

    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    let optionName = '';
    if (itemInfo.selectedOptionIndex != null && options[itemInfo.selectedOptionIndex]) {
        optionName = options[itemInfo.selectedOptionIndex].name;
    }

    const price = getRecordPrice(record, itemInfo.selectedOptionIndex);
    const total = price * itemInfo.quantity;
    itemElement.innerHTML = `
        <img src="${imageUrls[0]}" class="locked-item-thumbnail" alt="${fields.Name}">
        <div class="locked-item-details">
            <p class="locked-item-name">${fields.Name}</p>
            ${optionName ? `<p class="locked-item-option">${optionName}</p>` : ''}
            <p class="locked-item-pricing">Qty ${itemInfo.quantity} @ $${price.toFixed(2)} = <strong>$${total.toFixed(2)}</strong></p>
            ${itemInfo.note ? `<p class="locked-item-note"><em>Note: ${itemInfo.note}</em></p>` : ''}
        </div>
        <div class="locked-item-actions">
            <button class="edit-btn">Edit</button>
            <button class="remove-locked-item-btn" title="Remove from Plan">×</button>
        </div>
    `;
    return itemElement;
}

export async function updateEventPlanPanel() {
    const container = document.getElementById('cart-items-container');
    if (!container) return;
    container.innerHTML = '';
    if (state.cart.lockedItems.size === 0) {
        container.innerHTML = `<p style="font-size: 0.9em; color: #6c757d;">No items locked in yet.</p>`;
        return;
    }
    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            const itemElement = await createLockedInItemElement(record, itemInfo);
            container.appendChild(itemElement);
        }
    }
}

export function updateCardIcon(recordId) {
    const isLocked = state.cart.lockedItems.has(recordId);
    const isHearted = state.cart.items.has(recordId);
    
    const heartSVG = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>`;
    const checkSVG = `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg>`;

    document.querySelectorAll(`.event-card[data-record-id="${recordId}"] .heart-icon, #modal-heart-btn[data-record-id="${recordId}"]`).forEach(icon => {
        if (isLocked) {
            icon.className = 'heart-icon locked';
            icon.innerHTML = checkSVG;
        } else if (isHearted) {
            icon.className = 'heart-icon hearted';
            icon.innerHTML = heartSVG;
        } else {
            icon.className = 'heart-icon';
            icon.innerHTML = heartSVG;
        }
    });
}

export async function createInteractiveCard(record, imageCache) {
    const fields = record.fields;
    const recordId = record.id;
    const allRecords = state.records.all;
    const itemState = mainGetItemState(recordId);
    const rawOptions = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));

    const eventCard = document.createElement('div');
    eventCard.className = 'event-card';
    eventCard.dataset.recordId = recordId;
    const explodeButtonHTML = isGrouping ? `<button class="card-btn explode-btn" title="Explode">💥</button>` : '';
    const availabilityButtonHTML = `<button class="card-btn availability-btn" title="Check Availability">📅</button>`;
    const parentName = record?.fields?.[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
    const parentLinkHTML = parentName ? `<p class="parent-link" data-parent-name="${parentName}">⬆️ ${parentName}</p>` : '';

    let optionsControlHTML = '', notesHTML = '', quantitySelectorHTML = '', priceHTML = '';
    if (isGrouping) {
        optionsControlHTML = `<select class="options-selector navigate-options"><option value="">Select an option...</option>${rawOptions.map(opt => `<option value="${opt.name}">${opt.name}</option>`).join('')}</select>`;
        const range = getGroupPriceRange(record);
        priceHTML = range ? (range.min === range.max ? `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`) : 'Price Varies';
    } else {
        const headcountMin = fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        optionsControlHTML = `<select class="options-selector configure-options">${rawOptions.map((opt, index) => `<option value="${index}" ${itemState.selectedOptionIndex === index ? 'selected' : ''}>${opt.name}</option>`).join('')}</select>`;
        notesHTML = `<textarea class="item-note" placeholder="Add a note...">${itemState.note}</textarea>`;
        quantitySelectorHTML = `<div class="quantity-selector"><button class="quantity-btn minus" aria-label="Decrease quantity">-</button><input type="number" class="quantity-input" value="${itemState.quantity}" min="${headcountMin}"><button class="quantity-btn plus" aria-label="Increase quantity">+</button></div>`;
        const initialPrice = parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
        priceHTML = `$${initialPrice.toFixed(2)}`;
    }

    const heartSVG = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>`;
    const checkSVG = `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg>`;
    const isLockedIn = state.cart.lockedItems.has(recordId);
    const isHearted = state.cart.items.has(recordId);
    let iconClass = isLockedIn ? 'locked' : (isHearted ? 'hearted' : '');
    let iconSVG = isLockedIn ? checkSVG : heartSVG;

    eventCard.innerHTML = `<div class="card-header-actions">${availabilityButtonHTML}${explodeButtonHTML}</div><div class="heart-icon ${iconClass}">${iconSVG}</div><div class="event-card-content">${parentLinkHTML}<h3>${fields[CONSTANTS.FIELD_NAMES.NAME] || 'Untitled Event'}</h3><p class="description">${fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || ''}</p>${rawOptions.length > 0 ? optionsControlHTML : ''}${notesHTML}<div class="price-quantity-wrapper"><div class="price">${priceHTML}</div>${quantitySelectorHTML}</div></div>`;
    
    const plusBtn = eventCard.querySelector('.quantity-btn.plus');
    const minusBtn = eventCard.querySelector('.quantity-btn.minus');
    const quantityInput = eventCard.querySelector('.quantity-input');
    if (plusBtn && minusBtn && quantityInput) {
        plusBtn.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            quantityInput.stepUp(); 
            quantityInput.dispatchEvent(new Event('change', { bubbles: true })); 
        });
        minusBtn.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            quantityInput.stepDown(); 
            quantityInput.dispatchEvent(new Event('change', { bubbles: true })); 
        });
    }
    
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, imageCache);
    eventCard.style.backgroundImage = `url('${imageUrls[0] || ''}')`;
    return eventCard;
}

export async function renderRecords(recordsToRender, imageCache, append = false) {
    const catalogContainer = document.getElementById('catalog-container');
    if (!catalogContainer) return;
    if (!append) {
        catalogContainer.innerHTML = '';
        const implodeContainer = document.getElementById('implode-container');
        if (implodeContainer) implodeContainer.remove();
    }
    if (recordsToRender.length === 0 && !append) {
        catalogContainer.innerHTML = "<p style='text-align: center;'>No items to show.</p>";
        return;
    }
    const CHUNK_SIZE = 5;
    for (let i = 0; i < recordsToRender.length; i += CHUNK_SIZE) {
        const chunk = recordsToRender.slice(i, i + CHUNK_SIZE);
        const cardPromises = chunk.map(record => createInteractiveCard(record, imageCache));
        const cards = await Promise.all(cardPromises);
        cards.forEach(card => {
            if (card) catalogContainer.appendChild(card);
        });
    }
}

export async function updateFavoritesCarousel() {
    const favoritesSection = document.getElementById('favorites-section');
    const favoritesCarousel = document.getElementById('favorites-carousel');
    if (!favoritesSection || !favoritesCarousel) return;

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

export async function showDetailModal(record) {
    const modalOverlay = document.getElementById('detail-modal-overlay');
    const modalHeaderActions = document.getElementById('modal-header-actions');
    const modalBreadcrumbsContainer = document.getElementById('modal-breadcrumbs');
    const modalItemName = document.getElementById('modal-item-name');
    const modalItemPrice = document.getElementById('modal-item-price');
    const modalItemDescription = document.getElementById('modal-item-description');
    const modalMainImage = document.getElementById('modal-main-image');
    const modalThumbnailStrip = document.getElementById('modal-thumbnail-strip');
    const modalOptionsContainer = document.getElementById('modal-options-container');
    const modalQuantitySelector = document.getElementById('modal-quantity-selector');
    const modalNotesContainer = document.getElementById('modal-notes-container');
    const modalItemNote = document.getElementById('modal-item-note');
    const modalCalendarContainer = document.getElementById('modal-calendar-container');
    const modalActionsContainer = document.getElementById('modal-actions-container');
    const addToPlanBtn = document.getElementById('modal-add-to-plan-btn');

    modalOverlay.dataset.recordId = record.id;
    const isLocked = state.cart.lockedItems.has(record.id);
    modalOverlay.dataset.mode = isLocked ? 'edit-locked' : 'edit-favorite';

    const itemState = isLocked ? state.cart.lockedItems.get(record.id) : mainGetItemState(record.id);
    
    if (addToPlanBtn) {
        addToPlanBtn.textContent = isLocked ? 'Update Plan' : 'Add to Plan';
    }

    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    modalItemName.textContent = record.fields.Name || 'Untitled';
    modalItemDescription.textContent = record.fields.Description || '';
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const allRecordNames = new Set(state.records.all.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => allRecordNames.has(opt.name));
    
    if (isGrouping) {
        const range = getGroupPriceRange(record);
        modalItemPrice.textContent = range ? `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}` : 'Price Varies';
    } else {
        modalItemPrice.textContent = `$${getRecordPrice(record).toFixed(2)}`;
    }

    modalMainImage.style.backgroundImage = `url('${imageUrls[0]}')`;
    modalThumbnailStrip.innerHTML = '';
    imageUrls.forEach((url, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail-img';
        thumb.style.backgroundImage = `url('${url}')`;
        if (index === 0) thumb.classList.add('active');
        thumb.addEventListener('click', () => {
            modalMainImage.style.backgroundImage = `url('${url}')`;
            modalThumbnailStrip.querySelector('.active')?.classList.remove('active');
            thumb.classList.add('active');
        });
        modalThumbnailStrip.appendChild(thumb);
    });

    modalHeaderActions.innerHTML = '';
    modalBreadcrumbsContainer.innerHTML = '';
    const breadcrumbs = getBreadcrumbs(record, state.records.all);
    if (breadcrumbs.length > 0) {
        breadcrumbs.forEach((crumb, index) => {
            const crumbLink = document.createElement('a');
            crumbLink.href = '#';
            crumbLink.textContent = crumb.fields.Name;
            crumbLink.onclick = (e) => { e.preventDefault(); showDetailModal(crumb); };
            modalBreadcrumbsContainer.appendChild(crumbLink);
            if (index < breadcrumbs.length - 1) {
                const separator = document.createElement('span');
                separator.textContent = ' > ';
                modalBreadcrumbsContainer.appendChild(separator);
            }
        });
    }

    if (isGrouping) {
        modalHeaderActions.innerHTML += `<button id="modal-explode-btn" class="card-btn">💥</button>`;
    }
    
    const heartBtnContainer = document.createElement('div');
    heartBtnContainer.id = 'modal-heart-btn';
    heartBtnContainer.dataset.recordId = record.id;
    modalHeaderActions.appendChild(heartBtnContainer);
    updateCardIcon(record.id);
        
    modalOptionsContainer.innerHTML = '';
    rawOptions.forEach((opt, index) => {
        const optionButton = document.createElement('button');
        optionButton.className = 'option-btn';
        optionButton.dataset.optionIndex = index;
        if (itemState.selectedOptionIndex === index) {
            optionButton.classList.add('selected');
        }
        let priceModText = '';
        if (opt.absolutePrice != null) {
            priceModText = `$${opt.absolutePrice.toFixed(2)}`;
        } else if (opt.priceChange != null) {
            priceModText = `${opt.priceChange >= 0 ? '+' : ''}$${opt.priceChange.toFixed(2)}`;
        }
        optionButton.innerHTML = `${opt.name} <span class="price-mod">${priceModText}</span>`;
        if (allRecordNames.has(opt.name)) {
            optionButton.onclick = () => {
                const childRecord = state.records.all.find(r => r.fields.Name === opt.name);
                if (childRecord) showDetailModal(childRecord);
            };
        } else {
            optionButton.onclick = (e) => {
                modalOptionsContainer.querySelectorAll('.option-btn').forEach(btn => btn.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                const newIndex = parseInt(e.currentTarget.dataset.optionIndex, 10);
                e.currentTarget.dispatchEvent(new CustomEvent('change', {
                    bubbles: true,
                    detail: { selectedOptionIndex: newIndex }
                }));
                modalItemDescription.textContent = opt.description || record.fields.Description;
            };
        }
        modalOptionsContainer.appendChild(optionButton);
    });

    if (!isGrouping) {
        modalActionsContainer.style.display = 'block';
        modalNotesContainer.style.display = 'block';
        modalItemNote.value = itemState.note;
        const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        modalQuantitySelector.innerHTML = `<div class="quantity-selector" data-record-id="${record.id}"><button class="quantity-btn minus" aria-label="Decrease quantity">-</button><input type="number" class="quantity-input" value="${itemState.quantity}" min="${headcountMin}"><button class="quantity-btn plus" aria-label="Increase quantity">+</button></div>`;
        const plusBtn = modalQuantitySelector.querySelector('.plus');
        const minusBtn = modalQuantitySelector.querySelector('.minus');
        const input = modalQuantitySelector.querySelector('input');
        plusBtn.addEventListener('click', () => { input.stepUp(); input.dispatchEvent(new Event('change', { bubbles: true })); });
        minusBtn.addEventListener('click', () => { input.stepDown(); input.dispatchEvent(new Event('change', { bubbles: true })); });
    } else {
        modalActionsContainer.style.display = 'none';
        modalNotesContainer.style.display = 'none';
        modalQuantitySelector.innerHTML = '';
    }

    modalCalendarContainer.innerHTML = '';
    const busyTimes = await api.fetchCalendarForRecord(record);
    flatpickr(modalCalendarContainer, {
        inline: true,
        onDayCreate: function(dObj, dStr, fp, dayElem) {
            const day = dayElem.dateObj;
            const status = getDayStatus(day, busyTimes, record);
            
            // Add the appropriate CSS class for coloring
            if (status === 'NONE') dayElem.classList.add('flatpickr-disabled');
            else if (status === 'PARTIAL') dayElem.classList.add('flatpickr-partial');
            else dayElem.classList.add('flatpickr-available');

            // **THE FIX**: Add the tooltip creation logic
            let statusIcon = '✅';
            let statusText = 'Available';
            let busySlotsText = '';

            if (status === 'NONE') {
                statusIcon = '❌';
                statusText = 'Unavailable';
            } else if (status === 'PARTIAL') {
                statusIcon = '🟠';
                statusText = 'Partially Available';
                const busySlots = getBusySlotsForDay(day, busyTimes);
                if (busySlots) {
                    busySlotsText = `<br><small style="color:#666;">Booked: ${busySlots}</small>`;
                }
            }

            const tooltipContent = `
                <div style="text-align: left; padding: 2px;">
                    <strong>${day.toLocaleDateString()}</strong>
                    <hr style="margin: 2px 0 5px;">
                    <span>${statusIcon} ${record.fields.Name}: ${statusText}</span>
                    ${busySlotsText}
                </div>
            `;

            tippy(dayElem, {
                content: tooltipContent,
                allowHTML: true,
                placement: 'top',
            });
        }
    });

    modalOverlay.style.display = 'flex';
    document.body.classList.add('modal-open');
}

export function hideDetailModal() {
    const modalOverlay = document.getElementById('detail-modal-overlay');
    if (modalOverlay) {
        modalOverlay.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
}

export async function showCheckoutModal() {
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    const summaryList = document.getElementById('checkout-summary-list');
    const totalPriceEl = document.getElementById('checkout-total-price');
    if (!checkoutModalOverlay || !summaryList || !totalPriceEl) return;

    summaryList.innerHTML = '';
    let finalTotal = 0;
    
    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;

        const price = getRecordPrice(record, itemInfo.selectedOptionIndex);
        const itemTotal = price * itemInfo.quantity;
        finalTotal += itemTotal;
        const listItem = document.createElement('li');
        listItem.innerHTML = `<span>${record.fields.Name} (x${itemInfo.quantity})</span><span>$${itemTotal.toFixed(2)}</span>`;
        summaryList.appendChild(listItem);
    }
    
    const finalTotalInCents = Math.round(finalTotal * 100);
    totalPriceEl.textContent = `$${finalTotal.toFixed(2)}`;
    
    try {
        const response = await fetch('/api/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: finalTotalInCents }),
        });
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Failed to fetch payment details.');
        }

        clientSecret = data.clientSecret;

        stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
        elements = stripe.elements({ clientSecret });
        cardElement = elements.create('card');
        cardElement.mount('#card-element');
        
        checkoutModalOverlay.style.display = 'flex';
        document.body.classList.add('modal-open');
    } catch (err) {
        console.error("Failed to initialize payment form:", err);
        alert("Could not initialize payment form. Please try again.");
    }
}

export function hideCheckoutModal() {
    if (cardElement) {
        cardElement.unmount();
    }
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    if (checkoutModalOverlay) {
        checkoutModalOverlay.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
}

export function getStripeContext() {
    return { stripe, elements, cardElement, clientSecret };
}

export function updateHeader() {
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    document.title = eventName || 'Event Builder';
    const eventNameInput = document.getElementById('header-event-name');
    if (eventNameInput) eventNameInput.value = eventName;
    
    const goalsInput = document.getElementById('header-goals');
    if(goalsInput) goalsInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
}

export function updateTotalCost() {
    const totalCostEl = document.getElementById('total-cost');
    const checkoutBtn = document.getElementById('checkout-btn');
    const saveShareBtn = document.getElementById('save-share-btn');
    if (!totalCostEl) return;

    let total = 0;
    const allItems = state.cart.lockedItems;
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

    const isPlanEmpty = total === 0;
    if (checkoutBtn) {
        checkoutBtn.disabled = isPlanEmpty;
    }
    if (saveShareBtn) {
        if (isPlanEmpty) {
            saveShareBtn.disabled = true;
        } else if (state.ui.saveState === 'SAVED') {
            saveShareBtn.disabled = false;
        }
    }
}

export function toggleLoading(show) {
    const loadingMessage = document.getElementById('loading-message');
    const filterControls = document.getElementById('filter-controls');
    if (loadingMessage) loadingMessage.style.display = show ? 'block' : 'none';
    if (filterControls) filterControls.style.display = show ? 'block' : 'flex';
}
