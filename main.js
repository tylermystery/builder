/*
 * Version: 3.14.0
 * Last Modified: 2025-08-29
 *
 * Changelog:
 *
 * v3.14.0 - 2025-08-29
 * - Implemented nested, collapsible category/subcategory filters.
 * - Updated filter logic and event listeners to support the new hierarchy.
 * - Added data processing step to create category-subcategory relationships.
 *
 * v3.13.0 - 2025-08-29
 * - Added dynamic category and subcategory filters to the left sidebar.
 * - Updated filter logic to incorporate new category filters.
 * - Enhanced the 'Reset' button to clear the new category filters.
 *
 * v3.12.1 - 2025-08-28
 * - Replaced the native browser tooltip on card availability icons with a tippy.js tooltip.
 */

import { state } from './state.js';
 import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
 import { getStoredSessions, storeSession } from './session.js';
import { parseOptions } from './utils.js';
 import { getDayStatus, checkAvailability, getBusySlotsForDay, AVAILABILITY_STATUS } from './availability.js';
const imageCache = new Map();
let mainDatePicker = null;
 // --- UTILITY FUNCTIONS ---
function debounce(func, delay = 300) {
    let timeout;
 return (...args) => {
        clearTimeout(timeout);
 timeout = setTimeout(() => {
            func.apply(this, args);
        }, delay);
 };
}

// --- SAVE STATE MANAGEMENT ---
let saveTimeout;
const saveShareBtn = document.getElementById('save-share-btn');
 function updateSaveShareButton() {
    switch (state.ui.saveState) {
        case 'MODIFIED':
            saveShareBtn.textContent = 'Changes pending...';
 saveShareBtn.disabled = true;
            break;
        case 'SAVING':
            saveShareBtn.textContent = '⚙️ Saving...';
 saveShareBtn.disabled = true;
            break;
        case 'SAVED':
            saveShareBtn.textContent = '🔗 Copy Link';
 saveShareBtn.disabled = false;
            break;
    }
}
function triggerSave() {
    clearTimeout(saveTimeout);
    state.ui.saveState = 'MODIFIED';
    updateSaveShareButton();
 saveTimeout = setTimeout(async () => {
        state.ui.saveState = 'SAVING';
        updateSaveShareButton();
        const success = await api.saveSessionToAirtable();
        if (success) {
            state.ui.saveState = 'SAVED';
            updateSaveShareButton();
        }
    }, 1500);
 }

// --- CORE LOGIC ---
function applyFiltersAndSort() {
    const searchTerm = document.getElementById('name-filter').value.toLowerCase();
    const priceFilter = document.getElementById('price-filter').value;
 const sortBy = document.getElementById('sort-by').value;
    
    const selectedCategories = Array.from(document.querySelectorAll('.category-checkbox:checked')).map(el => el.value);
    const selectedSubcategories = Array.from(document.querySelectorAll('.subcategory-checkbox:checked')).map(el => el.value);

    let recordsToDisplay = state.records.all;

    if (searchTerm) {
        const scoredRecords = [];
 recordsToDisplay.forEach(record => {
            let score = 0;
            const fields = record.fields;
            const name = (fields.Name || '').toLowerCase();
            const description = (fields.Description || '').toLowerCase();
            const tags = [...(fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || []), ...(fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES] || []), ...(fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS]?.split(',') || [])].map(t => t.toLowerCase().trim());
         
           if (name.includes(searchTerm)) score = 3;
            else if (description.includes(searchTerm)) score = 2;
            else if (tags.some(tag => tag.includes(searchTerm))) score = 1;
            if (score > 0) { scoredRecords.push({ record, score }); }
        });
 scoredRecords.sort((a, b) => b.score - a.score);
        recordsToDisplay = scoredRecords.map(item => item.record);
 } else {
        recordsToDisplay = recordsToDisplay.filter(r => !r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]);
 }
    
    if (selectedCategories.length > 0) {
        recordsToDisplay = recordsToDisplay.filter(record => {
            const recordCategories = record.fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || [];
            return selectedCategories.some(cat => recordCategories.includes(cat));
        });
    }

    if (selectedSubcategories.length > 0) {
        recordsToDisplay = recordsToDisplay.filter(record => {
            const recordSubcategories = record.fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES] || [];
            return selectedSubcategories.some(subcat => recordSubcategories.includes(subcat));
        });
    }

    if (priceFilter !== 'all') {
        const [minStr, maxStr] = priceFilter.split('-');
 const min = parseFloat(minStr);
        const max = maxStr === 'plus' ? Infinity : parseFloat(maxStr);
 recordsToDisplay = recordsToDisplay.filter(record => {
            const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const childRecordNames = new Set(state.records.all.map(r => r.fields.Name));
            const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));
            if (isGrouping) {
                const range = ui.getGroupPriceRange(record);
               return range && range.min <= max && range.max >= min;
            } else {
                const price = parseFloat(String(record.fields.Price || '0').replace(/[^0-9.-]+/g, ""));
                return price >= min && price <= max;
            }
    });
    }

    recordsToDisplay.sort((a, b) => {
        const aPrice = ui.getGroupPriceRange(a)?.min ?? parseFloat(String(a.fields.Price || '0').replace(/[^0-9.-]+/g, ""));
        const bPrice = ui.getGroupPriceRange(b)?.min ?? parseFloat(String(b.fields.Price || '0').replace(/[^0-9.-]+/g, ""));
        const aName = a.fields.Name || '';
        const bName = b.fields.Name || '';
        switch (sortBy) {
            case 'price-asc': return aPrice - bPrice;
            case 'price-desc': return bPrice - aPrice;
            case 'name-asc': return aName.localeCompare(bName);
            default: return 0;
        }
    });
 ui.renderRecords(recordsToDisplay, imageCache);
}

// --- AVAILABILITY LOGIC ---
async function updateAllCardAvailabilityIcons() {
    if (!mainDatePicker || mainDatePicker.selectedDates.length < 2) {
        return;
 }
    const startDate = mainDatePicker.selectedDates[0];
    const requestedEnd = mainDatePicker.selectedDates[1];
    const cards = document.querySelectorAll('.event-card');
 for (const card of cards) {
        const recordId = card.dataset.recordId;
 const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;

        const busyTimes = await api.fetchCalendarForRecord(record);
 const dayStatus = getDayStatus(startDate, busyTimes, record);
        const isAvailable = checkAvailability(startDate, requestedEnd, busyTimes);

        const icon = card.querySelector('.availability-btn');
 if (icon) {
            // Destroy previous tippy instance if it exists to prevent memory leaks
            if (icon._tippy) {
                icon._tippy.destroy();
 }

            let statusIcon, statusText, titleText;
 if (dayStatus === AVAILABILITY_STATUS.NONE || !isAvailable) {
                icon.textContent = '❌';
 statusIcon = '❌';
                statusText = 'Unavailable';
                titleText = 'Unavailable';
            } else if (dayStatus === AVAILABILITY_STATUS.PARTIAL) {
                icon.textContent = '🟠';
 statusIcon = '🟠';
                statusText = 'Partially Available';
                titleText = 'Partially Available';
 } else {
                icon.textContent = '✅';
 statusIcon = '✅';
                statusText = 'Fully Available';
                titleText = 'Fully Available';
 }
            
            const dateString = startDate.toLocaleDateString();
 const tooltipContent = `
                <div style="text-align: left;">
                    <strong>${dateString}</strong>
                    <hr style="margin: 2px 0 5px;">
                    <span>${statusIcon} ${record.fields.Name}: ${statusText}</span>
    </div>
            `;
 tippy(icon, {
                content: tooltipContent,
                allowHTML: true,
                placement: 'top',
                arrow: true,
            });
 icon.title = titleText; // Keep native title as a simple fallback
        }
    }
}

// --- INITIALIZATION & MAIN FLOW ---
async function initialize() {
    ui.toggleLoading(true);
 try {
        state.records.all = await api.fetchAllRecords();
 } catch (error) {
        console.error("Failed to load initial data:", error);
 document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please try again later.</p>`;
        return;
 }
    
    // Create nested category data structure
    const categoryMap = new Map();
    state.records.all.forEach(record => {
        const cats = record.fields[CONSTANTS.FIELD_NAMES.CATEGORIES];
        const subcats = record.fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES];
        if (cats && cats.length > 0) {
            cats.forEach(cat => {
                if (!categoryMap.has(cat)) {
                    categoryMap.set(cat, new Set());
                }
                if (subcats && subcats.length > 0) {
                    subcats.forEach(subcat => categoryMap.get(cat).add(subcat));
                }
            });
        }
    });
    ui.populateCategoryFilters(categoryMap);

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');
    setupEventListeners();
 if (sessionId) {
        await api.loadSessionFromAirtable(sessionId);
        ui.updateHeader();
        const savedDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
 if (savedDate && Array.isArray(savedDate) && savedDate.length === 2) {
            mainDatePicker.setDate([savedDate[0], savedDate[1]], true);
 }
    } else {
        state.session.isOwned = true;
 }
    ui.toggleLoading(false);
    applyFiltersAndSort();
    ui.updateFavoritesCarousel();
    updateSaveShareButton();
}

function setupEventListeners() {
    const safeAddEventListener = (selector, event, handler) => {
        const element = document.getElementById(selector);
 if (element) {
            element.addEventListener(event, handler);
 } else {
            console.warn(`Element with ID "${selector}" not found.`);
 }
    };

    // --- FILTER & RESET LISTENERS ---
    safeAddEventListener('name-filter', 'input', debounce(() => applyFiltersAndSort()));
 safeAddEventListener('price-filter', 'change', applyFiltersAndSort);
    safeAddEventListener('sort-by', 'change', applyFiltersAndSort);
    safeAddEventListener('category-filter-container', 'change', applyFiltersAndSort);
    safeAddEventListener('reset-filters-btn', 'click', () => {
        document.getElementById('name-filter').value = '';
        document.getElementById('price-filter').selectedIndex = 0;
        document.getElementById('sort-by').selectedIndex = 0;
        document.querySelectorAll('#category-filter-container input:checked').forEach(el => el.checked = false);
        document.querySelectorAll('#category-filter-container .subcategory-list').forEach(list => list.style.display = 'none');
        document.querySelectorAll('#category-filter-container .arrow.expanded').forEach(arrow => arrow.classList.remove('expanded'));
        applyFiltersAndSort();
    });

    // Listener for expanding/collapsing categories
    const categoryContainer = document.getElementById('category-filter-container');
    if (categoryContainer) {
        categoryContainer.addEventListener('click', (e) => {
            const categoryLabel = e.target.closest('.category-label');
            if (categoryLabel) {
                // Prevent checkbox from firing twice
                if (e.target.type === 'checkbox') return;

                const sublist = categoryLabel.nextElementSibling;
                const arrow = categoryLabel.querySelector('.arrow');
                if (sublist && sublist.classList.contains('subcategory-list')) {
                    const isExpanded = sublist.style.display === 'block';
                    sublist.style.display = isExpanded ? 'none' : 'block';
                    arrow?.classList.toggle('expanded', !isExpanded);
                }
            }
        });
    }

 // --- PAYMENT FORM SUBMISSION ---
    safeAddEventListener('payment-form', 'submit', async (e) => {
        e.preventDefault();
        const { stripe, cardElement, clientSecret } = ui.getStripeContext();
        if (!stripe || !cardElement || !clientSecret) return;

        const { error } = await stripe.confirmCardPayment(
            clientSecret, {
                payment_method: {
                   card: cardElement,
                    billing_details: {
                        name: document.getElementById('customer-name').value,
                        email: document.getElementById('customer-email').value,
           },
                },
            }
        );

        const cardErrors = document.getElementById('card-errors');
        if (error) {
            cardErrors.textContent = error.message;
        } else {
            cardErrors.textContent = '';
            alert('Payment successful! Your event is booked.');
            ui.hideCheckoutModal();
 }
    });
    // --- AUTOSAVE TRIGGERS ---
    safeAddEventListener('header-event-name', 'change', (e) => { 
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        triggerSave();
    });
 safeAddEventListener('header-headcount', 'change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GUEST_COUNT, e.target.value);
        triggerSave();
    });
 safeAddEventListener('header-goals', 'change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        triggerSave();
    });
 // --- BETA TOOLKIT ---
    safeAddEventListener('beta-trigger', 'click', () => {
        document.getElementById('beta-toolkit').classList.toggle('visible');
    });
 // --- MAIN DATE PICKER ---
    mainDatePicker = flatpickr("#header-date", {
        mode: "range",
        enableTime: true,
        dateFormat: "M j, Y h:i K",
        onClose: (selectedDates) => {
            if (selectedDates.length === 2) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString()));
             triggerSave();
                updateAllCardAvailabilityIcons();
            }
        },
        onDayCreate: async (dObj, dStr, fp, dayElem) => {
            const day = dayElem.dateObj;
            const favoritedRecords = Array.from(state.cart.items.keys())
              .map(id => state.records.all.find(r => r.id === id))
                .filter(record => record);
            if (favoritedRecords.length === 0) {
                dayElem.classList.add('flatpickr-available');
                tippy(dayElem, { content: 'Available' });
               return;
              }
            const busyTimePromises = favoritedRecords.map(record => api.fetchCalendarForRecord(record));
 const allBusyTimes = await Promise.all(busyTimePromises);
            let finalStatus = AVAILABILITY_STATUS.FULL;
            let tooltipContent = [`<strong>${day.toLocaleDateString()}</strong><hr>`];
 for (let i = 0; i < favoritedRecords.length; i++) {
                const record = favoritedRecords[i];
 const busyTimes = allBusyTimes[i];
                const status = getDayStatus(day, busyTimes, record);
                let statusIcon = '✅';
                let statusText = `Available`;
 if (status === AVAILABILITY_STATUS.NONE) {
                    finalStatus = AVAILABILITY_STATUS.NONE;
 statusIcon = '❌';
                    statusText = 'Unavailable';
                } else if (status === AVAILABILITY_STATUS.PARTIAL) {
                    if (finalStatus !== AVAILABILITY_STATUS.NONE) {
                        finalStatus = AVAILABILITY_STATUS.PARTIAL;
 }
                    statusIcon = '🟠';
 const busySlots = getBusySlotsForDay(day, busyTimes);
                    statusText = `Partial ${busySlots}`;
                }
                tooltipContent.push(`<span>${statusIcon} ${record.fields.Name}: ${statusText}</span>`);
 }
            if (finalStatus === AVAILABILITY_STATUS.NONE) { dayElem.classList.add('flatpickr-disabled');
 }
            else if (finalStatus === AVAILABILITY_STATUS.PARTIAL) { dayElem.classList.add('flatpickr-partial');
 }
            else { dayElem.classList.add('flatpickr-available');
 }
            tippy(dayElem, {
                content: tooltipContent.join('<br>'),
                allowHTML: true,
                appendTo: () => document.body,
            });
 }
    });
    
    // --- NAVIGATION GUARD ---
    window.addEventListener('beforeunload', (e) => {
        if (state.ui.saveState === 'MODIFIED' || state.ui.saveState === 'SAVING') {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        }
    });
 // --- UNIFIED CLICK LISTENER ---
    document.body.addEventListener('click', async (e) => {
        if (e.target.matches('#detail-modal-overlay, #modal-close-btn')) {
            ui.hideDetailModal();
            return;
        }
        if (e.target.matches('#checkout-modal-overlay, #checkout-close-btn')) {
            ui.hideCheckoutModal();
            return;
        }

        const modalContent = e.target.closest('.modal-content');
        if (modalContent) {
            const isInteractiveElement = e.target.closest('button, .heart-icon, a, input, select, textarea, .thumbnail-img');
            if (!isInteractiveElement) {
                return; 
            }
        }
        
 const heartIcon = e.target.closest('.heart-icon:not(#modal-heart-btn)');
        const explodeBtn = e.target.closest('.explode-btn');
        const implodeBtn = e.target.closest('.implode-btn');
        const availabilityBtn = e.target.closest('.availability-btn');
        const saveShareBtn = e.target.closest('#save-share-btn');
 const checkoutBtn = e.target.closest('#checkout-btn');
        const removeBtn = e.target.closest('.remove-btn');
        const card = e.target.closest('.event-card');
        const favoriteItem = e.target.closest('.favorite-item');
        const addToPlanBtn = e.target.closest('#modal-add-to-plan-btn');
 const editBtn = e.target.closest('.edit-btn');
        const modalHeartBtn = e.target.closest('#modal-heart-btn');
        const parentLink = e.target.closest('.parent-link');
 if (saveShareBtn) {
            navigator.clipboard.writeText(window.location.href).then(() => {
                const originalText = saveShareBtn.textContent;
                saveShareBtn.textContent = 'Copied!';
                setTimeout(() => { saveShareBtn.textContent = originalText; }, 1500);
            });
 } else if (checkoutBtn) {
            ui.showCheckoutModal();
 } else if (addToPlanBtn) {
            const modalOverlay = document.getElementById('detail-modal-overlay');
 const recordId = modalOverlay.dataset.recordId;
            if (!recordId) return;
            
            const quantityInput = document.querySelector('#modal-quantity-selector .quantity-input');
            const selectedOptionEl = document.querySelector('#modal-options-container .option-btn.selected');
 const noteInput = document.getElementById('modal-item-note');

            const itemInfo = {
                quantity: quantityInput ?
 parseInt(quantityInput.value, 10) : 1,
                selectedOptionIndex: selectedOptionEl ?
 parseInt(selectedOptionEl.dataset.optionIndex, 10) : null,
                note: noteInput ?
 noteInput.value.trim() : ''
            };

            state.cart.lockedItems.set(recordId, itemInfo);
 const cardIcon = document.querySelector(`.event-card[data-record-id="${recordId}"] .heart-icon`);
            if (cardIcon) {
                cardIcon.className = 'heart-icon locked';
 cardIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg>`;
 }

            ui.updateEventPlanPanel();
            ui.updateTotalCost();
            triggerSave();
            
            ui.hideDetailModal();
 } else if (editBtn) {
            const lockedItemCard = editBtn.closest('.locked-item-card');
 if (!lockedItemCard) return;

            const recordId = lockedItemCard.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
 if (record) {
                ui.showDetailModal(record);
 }
        } else if (parentLink) {
            e.stopPropagation();
 const card = parentLink.closest('.event-card');
            if (!card) return;
            
            const parentName = parentLink.dataset.parentName;
            const parentRecord = state.records.all.find(p => p.fields.Name === parentName);
 if (parentRecord) {
                const newCard = await ui.createInteractiveCard(parentRecord, imageCache);
 card.replaceWith(newCard);
            }
        } else if (availabilityBtn) {
            e.stopPropagation();
 const record = state.records.all.find(r => r.id === availabilityBtn.closest('.event-card').dataset.recordId);
            if (record) ui.showDetailModal(record);
 } else if (heartIcon || modalHeartBtn) {
            e.stopPropagation();
 const targetElement = heartIcon || modalHeartBtn;
            const iconContainer = targetElement.closest('.heart-icon');
 if (iconContainer && iconContainer.classList.contains('locked')) {
                return;
 // Do nothing if the item is locked in
            }

            const recordId = targetElement.closest('[data-record-id]').dataset.recordId;
 const record = state.records.all.find(r => r.id === recordId);
            const isGrouping = !!(parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]).find(opt => state.records.all.some(r => r.fields.Name === opt.name)));
 let itemInfo = state.cart.items.get(recordId) ||
            { quantity: 1, selectedOptionIndex: null, note: '' };
 if (!isGrouping) {
                const quantityInput = document.querySelector('#modal-quantity-selector .quantity-input') ||
 targetElement.closest('.event-card')?.querySelector('.quantity-input');
                if (quantityInput) {
                    itemInfo.quantity = parseInt(quantityInput.value, 10);
 }
            }

            if (state.cart.items.has(recordId)) {
                state.cart.items.delete(recordId);
 } else {
                state.cart.items.set(recordId, itemInfo);
 }
            
            const newQuantity = itemInfo.quantity;
 const isHearted = state.cart.items.has(recordId);

            document.querySelector(`.event-card[data-record-id="${recordId}"] .heart-icon`)?.classList.toggle('hearted', isHearted);
            document.getElementById('modal-heart-btn')?.classList.toggle('hearted', isHearted);
            
            const mainCardInput = document.querySelector(`.event-card[data-record-id="${recordId}"] .quantity-input`);
            if (mainCardInput) mainCardInput.value = newQuantity;
 const modalInput = document.querySelector('#modal-quantity-selector .quantity-input');
            const modalOverlay = document.getElementById('detail-modal-overlay');
            if (modalOverlay.dataset.recordId === recordId && modalInput) {
                modalInput.value = newQuantity;
 }
            
            await ui.updateFavoritesCarousel();
 mainDatePicker.redraw();
            triggerSave();
        } else if (removeBtn) {
            e.stopPropagation();
 const favoriteCard = removeBtn.closest('.favorite-item');
            if (!favoriteCard) return;
            const recordId = favoriteCard.dataset.recordId;
            if (state.cart.items.has(recordId)) { state.cart.items.delete(recordId);
 }
            document.querySelector(`.event-card[data-record-id="${recordId}"] .heart-icon`)?.classList.remove('hearted');
            document.getElementById('modal-heart-btn')?.classList.remove('hearted');
            await ui.updateFavoritesCarousel();
            mainDatePicker.redraw();
            triggerSave();
 } else if (explodeBtn) {
            e.stopPropagation();
 const recordId = explodeBtn.closest('[data-record-id]').dataset.recordId;
            ui.hideDetailModal();
            const record = state.records.all.find(r => r.id === recordId);
            const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
 const childNames = new Set(rawOptions.map(opt => opt.name));
            const children = state.records.all.filter(r => childNames.has(r.fields.Name));
            ui.renderRecords(children, imageCache);
            const implodeButton = document.createElement('div');
 implodeButton.id = 'implode-container';
            implodeButton.innerHTML = `<button class="card-btn implode-btn" title="Implode"> اجمع </button>`;
            document.querySelector('#catalog-container').insertAdjacentElement('beforebegin', implodeButton);
 } else if (implodeBtn) {
            e.stopPropagation();
            implodeBtn.closest('#implode-container').remove();
            applyFiltersAndSort();
 } else if (favoriteItem) {
            e.stopPropagation();
 const recordId = favoriteItem.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
 if (record) {
                ui.showDetailModal(record);
 }
        } else if (card) {
            if (e.target.closest('.options-selector, .quantity-selector, .parent-link')) {
                return;
 }
            const recordId = card.dataset.recordId;
 const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                ui.showDetailModal(record);
 }
        }
    });
 // --- UNIFIED CHANGE LISTENER ---
    document.body.addEventListener('change', async (e) => {
        const card = e.target.closest('.event-card');
        if (!card) return;
        if (e.target.classList.contains('configure-options')) {
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
       
            const selectedIndex = parseInt(e.target.value, 10);
            const selectedOption = rawOptions[selectedIndex];
            const initialPrice = parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
            let newPrice = initialPrice;
            if (selectedOption) {
                if (selectedOption.absolutePrice != null) newPrice = 
 selectedOption.absolutePrice;
                 else if (selectedOption.priceChange != null) newPrice += selectedOption.priceChange;
            }
            card.querySelector('.price').textContent = `$${newPrice.toFixed(2)}`;
 card.querySelector('.description').textContent = selectedOption.description || record.fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || '';
            if (selectedOption) {
                const formatForTag = (name) => name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
 const itemTag = formatForTag(record.fields[CONSTANTS.FIELD_NAMES.NAME]);
                const optionTag = formatForTag(selectedOption.name);
                const optionImageUrls = await api.fetchImagesByTags([itemTag, optionTag]);
 if (optionImageUrls && optionImageUrls.length > 0) {
                    card.style.backgroundImage = `url('${optionImageUrls[0]}')`;
 } else {
                    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, imageCache);
 card.style.backgroundImage = `url('${imageUrls[0]}')`;
                }
            }
        }
        if (e.target.classList.contains('navigate-options')) {
            const childName = e.target.value;
 if (!childName) return;
            const childRecord = state.records.all.find(r => r.fields.Name === childName);
 if (childRecord) {
                const newCard = await ui.createInteractiveCard(childRecord, imageCache);
 card.replaceWith(newCard);
            }
        }
    });
}

initialize();
