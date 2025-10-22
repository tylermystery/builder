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
    if (mainContent) mainContent.style.display = show ? 'none' : (window.innerWidth < 1000 ? 'flex' : 'grid'); // Adjusted for responsive display
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
        // Introduce a small delay to allow the browser to render the chunk
        await new Promise(resolve => setTimeout(resolve, 0));
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
    // Ensure default includes overridePrice
    return { quantity: 1, selectedOptionIndex: 0, note: '', overridePrice: null };
}


export function updateItemState(recordId, updates) {
    const existing = getItemState(recordId);
    const newState = { ...existing, ...updates };
    state.cart.items.set(recordId, newState);
}

export function updateLockedItemState(recordId, updates) {
    const existing = state.cart.lockedItems.get(recordId) || getItemState(recordId);
    const newState = { ...existing, ...updates };
    // Ensure overridePrice is explicitly handled or nulled if not present
    if (!('overridePrice' in newState)) {
        newState.overridePrice = null;
    }
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

    const notesLabelEl = document.querySelector('label[for=\"header-goals\"]');
    if (notesLabelEl && labels.notesLabel) {
        notesLabelEl.textContent = labels.notesLabel;
    }

    const dateLabelEl = document.querySelector('label[for=\"event-date-picker\"]');
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
        // Store default text for reset later if needed
        reserveButtonEl.dataset.defaultText = labels.reserveButtonText;
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
            icon.textContent = ''; // Clear icon if no date selected
            if (icon._tippy) icon._tippy.destroy(); // Remove tooltip
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
            // Prepend to actions for consistent placement
            item.querySelector('.locked-item-actions').prepend(statusIconEl);
        }
        
        // Remove previous status classes first
        statusIconEl.classList.remove('available-full', 'available-partial', 'unavailable');
        
        // Destroy existing tippy instance before setting new content
        if (statusIconEl._tippy) {
            statusIconEl._tippy.destroy();
        }

        let iconText = '';
        let tooltipText = dayStatus.reason; // Default tooltip

        switch (dayStatus.status) {
            case AVAILABILITY_STATUS.FULL:
                iconText = '✅';
                statusIconEl.classList.add('available-full');
                break;
            case AVAILABILITY_STATUS.PARTIAL:
                iconText = '🟠';
                statusIconEl.classList.add('available-partial');
                break;
            case AVAILABILITY_STATUS.NONE:
                iconText = '❌';
                statusIconEl.classList.add('unavailable');
                break;
        }
        statusIconEl.textContent = iconText;
        
        // Add tooltip using tippy.js
        tippy(statusIconEl, {
            content: tooltipText,
            placement: 'top',
            arrow: true
        });
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

    // Ensure listeners are only added once or correctly removed/re-added
    const closeBtn = document.getElementById('shop-switcher-close-btn');
    const overlayClickHandler = (e) => {
        if (e.target === overlay) {
            hideShopSwitcher();
            overlay.removeEventListener('click', overlayClickHandler); // Clean up listener
        }
    };
    // Remove previous listener if it exists before adding a new one
    closeBtn.removeEventListener('click', hideShopSwitcher); 
    closeBtn.addEventListener('click', hideShopSwitcher);
    overlay.removeEventListener('click', overlayClickHandler);
    overlay.addEventListener('click', overlayClickHandler);
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

// REMOVED renderSessionDropdown as it's replaced by populateMyPlansDropdown

export function populateMyPlansDropdown() { // Removed 'plans' parameter
    const container = document.getElementById('my-plans-container');
    const dropdown = document.getElementById('my-plans-dropdown');
    if (!container || !dropdown) return;

    const associatedSessions = state.session.user.associatedSessions || []; // Read from state

    dropdown.innerHTML = ''; // Clear existing options
    container.style.display = 'block';

    if (state.session.user.isAuthenticated) {
        const defaultOption = document.createElement('option');
        defaultOption.textContent = 'My Saved Plans...';
        defaultOption.disabled = true; // Initially disabled
        defaultOption.selected = true; // Initially selected
        dropdown.appendChild(defaultOption);

        const newPlanOption = document.createElement('option');
        newPlanOption.textContent = '✨ Create a New Plan';
        newPlanOption.value = 'new';
        dropdown.appendChild(newPlanOption);

        let currentSessionFound = false;
        if (associatedSessions.length > 0) {
            associatedSessions.forEach(session => { // Use associatedSessions
                const option = document.createElement('option');
                option.value = session.id; // Use session.id
                option.textContent = session.name || 'Untitled Plan'; // Use session.name
                if (session.id === state.session.id) {
                    option.selected = true;
                    currentSessionFound = true; // Mark that the current session is in the list
                }
                dropdown.appendChild(option);
            });
        }
        
        // If the current session is selected, re-enable and de-select the default option
        if (currentSessionFound) {
            defaultOption.disabled = false;
            defaultOption.selected = false;
        }

    } else {
        // Option for guests to log in
        const guestOption = document.createElement('option');
        guestOption.textContent = 'Sign In to Save & View Plans...';
        guestOption.value = 'login-to-save'; // Use a specific value
        dropdown.appendChild(guestOption);
        
        // Add event listener specifically for the guest option
        dropdown.addEventListener('change', (e) => {
            if (e.target.value === 'login-to-save') {
                // Trigger the sign-in modal
                import('./auth.js').then(auth => auth.showUserModal());
                // Reset dropdown visually
                e.target.selectedIndex = 0; 
            }
        });
    }
}


export async function updateMobileBarAvailability() {
    const mobileBar = document.getElementById('mobile-summary-bar');
    if (!mobileBar || window.innerWidth > 999) return; // Only run on mobile view

    const selectedDateISO = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    
    // Always remove previous classes first
    mobileBar.classList.remove('available', 'partial', 'unavailable');

    // Only check availability if a date is selected AND there are locked items
    if (selectedDateISO && state.cart.lockedItems.size > 0) {
        const selectedDate = new Date(selectedDateISO);
        // Get the full records for locked items
        const lockedItems = Array.from(state.cart.lockedItems.keys())
                                .map(recordId => state.records.all.find(r => r.id === recordId))
                                .filter(Boolean); // Filter out any undefined records
                                
        // Only proceed if we actually found the locked item records
        if (lockedItems.length > 0) {
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
    // If no date or no locked items, no class is added (defaults to base color)
}


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

    // Always start with a clickable "All Categories" link
    path.push(`<a href="#" class="breadcrumb-link" data-filter="all">All Items</a>`); // Changed text

    // Find the active category
    const activeCategoryButton = document.querySelector('#category-filters .category-filter-btn.active');
    if (activeCategoryButton && activeCategoryButton.dataset.filter !== 'all') {
        const categoryName = activeCategoryButton.textContent;
        // The category link should also be clickable
        path.push(`<a href="#" class="breadcrumb-link" data-filter="${activeCategoryButton.dataset.filter}">${categoryName}</a>`);
        currentTitle = categoryName;
    }

    // Find any active subcategories
    const activeSubcategoryNodes = document.querySelectorAll('#subcategory-filters .filter-btn.active');
    if (activeSubcategoryNodes.length > 0) {
        const subcatNames = Array.from(activeSubcategoryNodes).map(btn => btn.textContent);
        // The final part of the breadcrumb is just text, not a link
        path.push(`<span>${subcatNames.join(' + ')}</span>`);
        // If a category was also selected, append subcategory; otherwise, use subcategory as title
        currentTitle = currentTitle ? `${currentTitle} - ${subcatNames.join(' + ')}` : subcatNames.join(' + ');
    }
    
    // Only show the breadcrumbs and title if we have navigated deeper than "All Items"
    if (path.length > 1) {
        breadcrumbsEl.innerHTML = path.join(' &gt; ');
        titleEl.textContent = currentTitle;
        titleEl.style.display = 'block';
    } else {
        // If only "All Items" is active, maybe show a default title or nothing
        titleEl.textContent = "All Items"; // Or keep it hidden
        titleEl.style.display = 'block'; // Or 'none'
    }
}
