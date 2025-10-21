// REPLACE THE ENTIRE CONTENTS OF: ui.js

import { state } from './state.js';
import { CONSTANTS } from './config.js';
import { log } from './utils/debug.js';
import { createInteractiveCard } from './components/card.js';
import { setupItineraryEventListeners, showItineraryModal, hideItineraryModal, renderItineraryHeader, renderItinerary } from './components/itinerary.js';
import { getDayStatus, getCombinedPlanStatus, AVAILABILITY_STATUS, checkAvailability } from './availability.js';
import * as api from './api.js';
import { showPresentationView, hidePresentationView, setupPresentationEventListeners } from './components/presentation.js';
import { initializeItemChat } from './chat.js';

// Re-export functions from component modules
export * from './components/card.js';
export * from './components/modal.js';
export * from './components/sidebar.js';
export * from './utils.js';
export { setupItineraryEventListeners, showItineraryModal, hideItineraryModal, renderItineraryHeader, renderItinerary, checkAvailability };
export { showPresentationView, hidePresentationView, setupPresentationEventListeners };
export { initializeItemChat };

const lazyLoadObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const element = entry.target;
            if (element.dataset.bgImage) {
                element.style.backgroundImage = `url('${element.dataset.bgImage}')`;
            }
            if (element.dataset.src) {
                element.src = element.dataset.src;
            }
            element.classList.remove('lazy-load');
            observer.unobserve(element);
        }
    });
}, { rootMargin: "0px 0px 200px 0px" });

export function observeLazyImages(container) {
    const lazyElements = container.querySelectorAll('.lazy-load');
    lazyElements.forEach(el => lazyLoadObserver.observe(el));
}

export function toggleLoading(show) {
    log('UI', `Toggling loading screen: ${show ? 'ON' : 'OFF'}`);
    const loadingMessage = document.getElementById('loading-message');
    const mainContent = document.querySelector('.main-content'); // Changed to class selector
    if (loadingMessage) loadingMessage.style.display = show ? 'block' : 'none';
    if (mainContent) mainContent.style.display = show ? 'none' : 'grid';
}

export async function renderRecords(recordsToRender, imageCache, append = false) {
    log('UI', `renderRecords called. Attempting to render ${recordsToRender.length} records.`);
    const catalogContainer = document.getElementById('catalog-container');
    const loadingMessage = document.getElementById('loading-message');
    if (!catalogContainer) {
        console.error("UI ERROR: catalog-container element not found in the DOM!");
        return;
    }
    if (!append) {
        catalogContainer.innerHTML = '';
        if (loadingMessage) {
            loadingMessage.style.display = 'block';
        }
    }
    if (recordsToRender.length === 0 && !append) {
        log('UI', "No records to render, displaying 'No items to show.'");
        catalogContainer.innerHTML = "<p style='text-align: center;'>No items to show.</p>";
        if (loadingMessage) {
            loadingMessage.style.display = 'none';
        }
        return;
    }

    const fragment = document.createDocumentFragment();
    const CHUNK_SIZE = 5;
    for (let i = 0; i < recordsToRender.length; i += CHUNK_SIZE) {
        const chunk = recordsToRender.slice(i, i + CHUNK_SIZE);
        const cardPromises = chunk.map(record => createInteractiveCard(record, state.records.all, imageCache));
        const cards = await Promise.all(cardPromises);
        cards.forEach(card => {
            if (card) fragment.appendChild(card);
        });
    }
    catalogContainer.appendChild(fragment);
    
    observeLazyImages(catalogContainer);

    if (loadingMessage) {
        loadingMessage.style.display = 'none';
    }
    log('UI', `Rendered ${recordsToRender.length} records to the DOM.`);
}

let mainGetItemState;
export function initStateHelpers(helpers) {
    mainGetItemState = helpers.getItemState;
}

export function getMainGetItemState() {
    return mainGetItemState;
}

export function getItemState(recordId) {
    if (state.cart.items.has(recordId)) {
        return state.cart.items.get(recordId);
    }
    return { quantity: 1, selectedOptionIndex: 0, note: '' };
}

export function updateItemState(recordId, updates) {
    const existing = getItemState(recordId);
    const newState = { ...existing, ...updates };
    state.cart.items.set(recordId, newState);
}

export function updateLockedItemState(recordId, updates) {
    const existing = state.cart.lockedItems.get(recordId) || getItemState(recordId);
    const newState = { ...existing, ...updates };
    state.cart.lockedItems.set(recordId, newState);
}

export function updateHeader() {
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    document.title = eventName || 'Event Builder';
    const eventNameInput = document.getElementById('header-event-name');
    if (eventNameInput) {
        eventNameInput.value = eventName || 'My Awesome Event';
    }
    const goalsInput = document.getElementById('header-goals');
    if (goalsInput) goalsInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
}

export function applyCartLabels(labels) {
    const cartNameEl = document.getElementById('header-event-name');
    if (cartNameEl && labels.cartNamePlaceholder) {
        cartNameEl.value = labels.cartNamePlaceholder;
    }

    const notesLabelEl = document.querySelector('label[for="header-goals"]');
    if (notesLabelEl && labels.notesLabel) {
        notesLabelEl.textContent = labels.notesLabel;
    }

    const dateLabelEl = document.querySelector('label[for="event-date-picker"]');
    if (dateLabelEl && labels.dateLabel) {
        dateLabelEl.textContent = labels.dateLabel;
    }
    
    const planTitleEl = document.getElementById('itinerary-btn');
    if (planTitleEl && labels.planTitle) {
        planTitleEl.textContent = labels.planTitle;
    }

    const reserveButtonEl = document.getElementById('checkout-btn');
    if (reserveButtonEl && labels.reserveButtonText) {
        reserveButtonEl.textContent = labels.reserveButtonText;
    }
}

export async function updateEventPlanDateDisplay() {
    log('UI', 'Updating event plan date display.');
    const dateInput = document.getElementById('event-date-picker');
    if (!dateInput) return;
    const selectedDateISO = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    if (!selectedDateISO) {
        dateInput.value = 'Select a date';
        dateInput.classList.remove('available-full', 'available-partial', 'unavailable');
        return;
    }
    const selectedDate = new Date(selectedDateISO);
    const lockedItems = Array.from(state.cart.lockedItems.keys()).map(recordId => state.records.all.find(r => r.id === recordId)).filter(Boolean);
    const overallStatus = await getCombinedPlanStatus(selectedDate, lockedItems);
    dateInput.value = selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    dateInput.classList.remove('available-full', 'available-partial', 'unavailable');
    switch (overallStatus) {
        case AVAILABILITY_STATUS.FULL:
            dateInput.classList.add('available-full');
            break;
        case AVAILABILITY_STATUS.PARTIAL:
            dateInput.classList.add('available-partial');
            break;
        case AVAILABILITY_STATUS.NONE:
            dateInput.classList.add('unavailable');
            break;
    }
}

export async function updateLockedItemStatusIcons() {
    log('UI', 'Updating locked-in item status icons.');
    const selectedDateISO = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    if (!selectedDateISO) {
        document.querySelectorAll('.locked-item-status-icon').forEach(icon => {
            icon.textContent = '';
        });
        return;
    }
    const selectedDate = new Date(selectedDateISO);
    const lockedItems = document.querySelectorAll('.locked-item-card');
    for (const item of lockedItems) {
        const recordId = item.dataset.recordId;
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;
        const busyTimes = await api.fetchCalendarForRecord(record);
        const dayStatus = await getDayStatus(selectedDate, busyTimes, record);
        let statusIconEl = item.querySelector('.locked-item-status-icon');
        if (!statusIconEl) {
            statusIconEl = document.createElement('span');
            statusIconEl.className = 'locked-item-status-icon';
            item.querySelector('.locked-item-actions').prepend(statusIconEl);
        }
        statusIconEl.classList.remove('available-full', 'available-partial', 'unavailable');
        switch (dayStatus.status) {
            case AVAILABILITY_STATUS.FULL:
                statusIconEl.textContent = '✅';
                statusIconEl.classList.add('available-full');
                break;
            case AVAILABILITY_STATUS.PARTIAL:
                statusIconEl.textContent = '🟠';
                statusIconEl.classList.add('available-partial');
                break;
            case AVAILABILITY_STATUS.NONE:
                statusIconEl.textContent = '❌';
                statusIconEl.classList.add('unavailable');
                break;
        }
    }
}

function hideShopSwitcher() {
    const overlay = document.getElementById('shop-switcher-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 300);
    }
}

export function showShopSwitcher() {
    const overlay = document.getElementById('shop-switcher-overlay');
    const listContainer = document.getElementById('shop-list-container');
    if (!overlay || !listContainer) return;
    const storeRecords = state.stores.all;
    listContainer.innerHTML = ''; 
    storeRecords.forEach(record => {
        const link = document.createElement('a');
        link.href = `/?shopId=${record.id}`;
        link.textContent = record.fields.Name;
        link.style.display = 'block';
        link.style.padding = '10px';
        link.style.borderBottom = '1px solid #eee';
        link.style.textDecoration = 'none';
        link.style.color = '#007bff';
        listContainer.appendChild(link);
    });
    overlay.style.display = 'flex';
    setTimeout(() => overlay.classList.add('active'), 10);

    document.getElementById('shop-switcher-close-btn').addEventListener('click', hideShopSwitcher);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            hideShopSwitcher();
        }
    });
}

export function showToast(message, duration = 5000) {
    const toast = document.getElementById('toast-notification');
    if (toast) {
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    }
}

export function renderSessionDropdown() {
    const container = document.getElementById('session-manager-container');
    const dropdown = document.getElementById('session-dropdown');
    const user = state.session.user;

    if (!container || !dropdown || !user.isAuthenticated) {
        if(container) container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    dropdown.innerHTML = '';

    const sessions = user.associatedSessions || [];
    const newPlanLink = document.createElement('a');
    newPlanLink.href = window.location.pathname;
    newPlanLink.textContent = '➕ Start New Plan';
    dropdown.appendChild(newPlanLink);
    const divider = document.createElement('div');
    divider.className = 'divider';
    dropdown.appendChild(divider);

    if (sessions.length > 0) {
        sessions.forEach(session => {
            const link = document.createElement('a');
            link.href = `/?session=${session.id}`;
            link.textContent = session.name || 'Unnamed Plan';
            if (state.session.id === session.id) {
                link.classList.add('active-session');
            }
            dropdown.appendChild(link);
        });
    } else {
        const noItems = document.createElement('span');
        noItems.textContent = 'No saved plans yet.';
        noItems.style.padding = '10px 15px';
        noItems.style.fontSize = '0.9em';
        noItems.style.color = '#6c757d';
        dropdown.appendChild(noItems);
    }
}

export function populateMyPlansDropdown(plans) {
    const container = document.getElementById('my-plans-container');
    const dropdown = document.getElementById('my-plans-dropdown');
    if (!container || !dropdown) return;

    dropdown.innerHTML = '';
    container.style.display = 'block';

    if (state.session.user.isAuthenticated) {
        const defaultOption = document.createElement('option');
        defaultOption.textContent = 'My Saved Plans...';
        defaultOption.disabled = true;
        defaultOption.selected = true;
        dropdown.appendChild(defaultOption);

        const newPlanOption = document.createElement('option');
        newPlanOption.textContent = '✨ Create a New Plan';
        newPlanOption.value = 'new';
        dropdown.appendChild(newPlanOption);
        if (plans && plans.length > 0) {
            plans.forEach(plan => {
                const option = document.createElement('option');
                option.value = plan.id;
                option.textContent = plan.fields.Name || 'Untitled Plan';
                if (plan.id === state.session.id) {
                    option.selected = true;
                    defaultOption.disabled = false;
                    defaultOption.selected = false;
                }
                dropdown.appendChild(option);
            });
        }
    } else {
        const guestOption = document.createElement('option');
        guestOption.textContent = 'Save & View My Plans...';
        guestOption.value = 'login-to-save';
        dropdown.appendChild(guestOption);
    }
}

export async function updateMobileBarAvailability() {
    const mobileBar = document.getElementById('mobile-summary-bar');
    if (!mobileBar || window.innerWidth > 999) return;
    const selectedDateISO = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    mobileBar.classList.remove('available', 'partial', 'unavailable');

    if (selectedDateISO && state.cart.lockedItems.size > 0) {
        const selectedDate = new Date(selectedDateISO);
        const lockedItems = Array.from(state.cart.lockedItems.keys()).map(recordId => state.records.all.find(r => r.id === recordId)).filter(Boolean);
        const overallStatus = await getCombinedPlanStatus(selectedDate, lockedItems);
        switch (overallStatus) {
            case AVAILABILITY_STATUS.FULL:
                mobileBar.classList.add('available');
                break;
            case AVAILABILITY_STATUS.PARTIAL:
                mobileBar.classList.add('partial');
                break;
            case AVAILABILITY_STATUS.NONE:
                mobileBar.classList.add('unavailable');
                break;
        }
    }
}

// REPLACE the entire updateCatalogHeader function in: ui.js

export function updateCatalogHeader() {
    const breadcrumbsEl = document.getElementById('breadcrumbs');
    const titleEl = document.getElementById('catalog-title');
    const planFilterBtn = document.getElementById('plan-filter-btn');

    if (!breadcrumbsEl || !titleEl) return;

    // Reset previous state
    breadcrumbsEl.innerHTML = '';
    titleEl.style.display = 'none';

    // Don't show breadcrumbs for the "My Plan" view
    if (planFilterBtn && planFilterBtn.classList.contains('active')) {
        return;
    }

    const path = [];
    let currentTitle = '';
    const params = new URLSearchParams(window.location.search); // Get current URL params
    const categoryParam = params.get('category');
    const subcategoryParam = params.get('subcategory');
    const groupingParam = params.get('grouping'); // Read the new grouping parameter

    // Always start with a clickable "All Categories" link
    path.push(`<a href="#" class="breadcrumb-link" data-filter="all">All Categories</a>`);

    // Find the active category based on URL param or active button as fallback
    let activeCategoryButton = null;
    if (categoryParam) {
        activeCategoryButton = document.querySelector(`#category-filters .filter-btn[data-filter="${categoryParam}"]`);
    } else {
        // Fallback if category param is missing but a button (not 'all') is active
        activeCategoryButton = document.querySelector('#category-filters .filter-btn.active:not([data-filter="all"])');
    }

    if (activeCategoryButton) {
        const categoryName = activeCategoryButton.textContent;
        path.push(`<a href="#" class="breadcrumb-link" data-filter="${activeCategoryButton.dataset.filter}">${categoryName}</a>`);
        currentTitle = categoryName;
    }

    // Find the active subcategory based on URL param or active button
     let activeSubcategoryButton = null;
     if (subcategoryParam) {
         // Handle multiple subcategories if needed, but for breadcrumbs, maybe just use the first?
         const firstSubcat = subcategoryParam.split(',')[0];
         activeSubcategoryButton = document.querySelector(`#subcategory-filters .filter-btn[data-filter="${firstSubcat}"]`);
     } else {
         // Fallback if param missing
         activeSubcategoryButton = document.querySelector('#subcategory-filters .filter-btn.active');
     }

    if (activeSubcategoryButton) {
        const subcatName = activeSubcategoryButton.textContent;
        // Subcategory link should likely reset grouping, so don't include grouping param in its link generation for now
         path.push(`<a href="#" class="breadcrumb-link" data-filter="${activeSubcategoryButton.dataset.filter}">${subcatName}</a>`); // Make subcategory clickable too
        currentTitle = subcatName;
    }

    // --- NEW: Add Grouping if present in URL ---
    if (groupingParam) {
        // --- THIS IS THE FIX: Add safety checks ---
        const groupingRecord = state.records.all.find(r =>
            r && r.fields && r.fields.Name && // Ensure record, fields, and Name exist
            r.fields.Name.toLowerCase() === groupingParam
        );
        // --- END FIX ---
        const groupingDisplayName = groupingRecord ? groupingRecord.fields.Name : groupingParam; // Fallback to param if record not found
        path.push(`<span>${groupingDisplayName}</span>`); // Grouping is the final step, not clickable
        currentTitle = groupingDisplayName;
    }
    // --- END NEW ---

    // Only show the breadcrumbs and title if we have navigated deeper than "All Categories"
    if (path.length > 1) {
        breadcrumbsEl.innerHTML = path.join(' &gt; ');
        titleEl.textContent = currentTitle;
        titleEl.style.display = 'block';
    }
}
