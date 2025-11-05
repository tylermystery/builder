// In: ui.js
// Action: REPLACE THE ENTIRE FILE with this corrected content.

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
export { updateEventPlanSection, updateIdeasCarousel, updateTotalCost, displayReservedStatus, updateHeader as updateSidebarHeader } from './components/sidebar.js';
export * from './utils.js';
export { setupItineraryEventListeners, showItineraryModal, hideItineraryModal, renderItineraryHeader, renderItinerary, checkAvailability };
export { showPresentationView, hidePresentationView, setupPresentationEventListeners };
export { initializeItemChat };
export { handleFilterChipClear };

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
    // --- ADD THIS ---
    // Initialize tooltips for new partner badges
    const partnerBadges = container.querySelectorAll('.partner-badge');
    if (partnerBadges.length > 0 && typeof tippy === 'function') {
        tippy(partnerBadges, {
            content: "This is a partner activity. We handle all booking and logistics to ensure it's a seamless part of your event.",
            placement: 'top',
            theme: 'light',
        });
    }
    // --- END ADD ---
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

// In: ui.js (around line 347)
// REPLACE the entire showShopSwitcher function with this:

export function showShopSwitcher() {
    const overlay = document.getElementById('shop-switcher-overlay');
    const listContainer = document.getElementById('shop-list-container');
    // --- NEW: Get the modal title element ---
    const modalTitleEl = overlay?.querySelector('.checkout-modal-content h3');
    // --- END NEW ---
    
    if (!overlay || !listContainer) return;

    // --- NEW: Set the branded title and styles ---
    if (modalTitleEl) {
        modalTitleEl.innerHTML = `www.whatthefun.wtf <sup>fun finder</sup>`;
        modalTitleEl.style.fontSize = '1.5em';
        modalTitleEl.style.fontWeight = 'bold';
    } else {
        console.warn('Shop switcher modal title element not found for branding.');
    }
    // --- END NEW ---

    const storeRecords = state.stores.all;
    listContainer.innerHTML = ''; 
    storeRecords.forEach(record => {
// ... rest of function remains the same ...
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

// FIX: ADD THE MISSING EXPORTED FUNCTION HERE
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
// In: ui.js
// Action: REPLACE the entire updateCatalogHeader function

// In: ui.js
// Action: REPLACE the entire updateCatalogHeader function

export function updateCatalogHeader() {
    const breadcrumbsEl = document.getElementById('breadcrumbs');
    const titleEl = document.getElementById('catalog-title');
    const nameFilterEl = document.getElementById('name-filter');
    const clearSearchBtn = document.getElementById('clear-search-btn');

    if (!breadcrumbsEl || !titleEl || !nameFilterEl || !clearSearchBtn) return;

    // Reset visibility
    breadcrumbsEl.innerHTML = '';
    titleEl.style.display = 'none';
    clearSearchBtn.style.display = 'none';
    const activeFiltersHtml = [];
    const searchTerm = nameFilterEl.value.trim();
    const isSearchActive = searchTerm.length > 0;
    const sortBy = document.getElementById('sort-by')?.value;

    // --- 1. Handle Special Views (My Plan/My Likes) ---
    if (document.getElementById('plan-filter-btn')?.classList.contains('active') || document.getElementById('liked-items-filter-btn')?.classList.contains('active')) {
        // Leave the default title logic in filtering.js to handle this
        return;
    }

    // --- 2. Collect Active Filters (Non-Category) ---

    // A. Name Search
    if (isSearchActive) {
        // Activate the search clear button
        clearSearchBtn.style.display = 'block'; 
        // Add search term as a clearable chip
        activeFiltersHtml.push(createFilterChip('Search: ' + searchTerm, 'name-filter', nameFilterEl.value));
    }
    
    // B. Status
    const statusEl = document.getElementById('status-filter');
    if (statusEl && statusEl.value !== 'Available') {
        activeFiltersHtml.push(createFilterChip('Status: ' + statusEl.options[statusEl.selectedIndex].text, 'status-filter', statusEl.value));
    }
    
    // C. Headcount
    const headcountEl = document.getElementById('headcount-filter');
    const headcountCustomEl = document.getElementById('headcount-custom');
    if (headcountEl && headcountEl.value !== 'any') {
        let text = headcountEl.options[headcountEl.selectedIndex].text;
        if (headcountEl.value === 'custom' && headcountCustomEl.value) {
            text = `Headcount: ${headcountCustomEl.value}`;
        }
        activeFiltersHtml.push(createFilterChip(text, 'headcount-filter', headcountEl.value));
    }
    
    // D. Location
    const locationEl = document.getElementById('location-filter');
    if (locationEl && locationEl.value !== 'any') {
        activeFiltersHtml.push(createFilterChip('Location: ' + locationEl.options[locationEl.selectedIndex].text, 'location-filter', locationEl.value));
    }

    // E. Budget
    const budgetEl = document.getElementById('budget-filter');
    if (budgetEl && budgetEl.value !== 'any') {
        activeFiltersHtml.push(createFilterChip('Budget: ' + budgetEl.options[budgetEl.selectedIndex].text, 'budget-filter', budgetEl.value));
    }

    // --- 3. Collect Active Category/Subcategory Filters ---
    
    const path = [];
    let currentTitle = '';
    
    // Always start with "All Categories" as the base path, but not as a filter chip
    path.push(`<a href=\"#\" class=\"breadcrumb-link\" data-filter=\"all\">All Categories</a>`);

    // Category (Only allow one active Category at a time based on existing events.js logic)
    const activeCategoryButton = document.querySelector('#category-filters .category-filter-btn.active');
    if (activeCategoryButton && activeCategoryButton.dataset.filter !== 'all') {
        const categoryName = activeCategoryButton.textContent;
        // The category itself becomes a breadcrumb
        path.push(`<a href=\"#\" class=\"breadcrumb-link\" data-filter=\"${activeCategoryButton.dataset.filter}\">${categoryName}</a>`);
        currentTitle = categoryName;
    }

    // Subcategories (Multi-select)
    const activeSubcategoryNodes = document.querySelectorAll('#subcategory-filters .filter-btn.active');
    activeSubcategoryNodes.forEach(btn => {
        const subcatName = btn.textContent;
        // Subcategories are added as clearable chips, not just a label in the breadcrumb
        activeFiltersHtml.push(createFilterChip(subcatName, 'subcategory-filter', btn.dataset.filter));
        // We still include them in the breadcrumb path as the title context
        path.push(`<span>${subcatName}</span>`);
        currentTitle = subcatName;
    });
    
    // --- 4. Render and Bind ---

    // A. Render Active Filter Chips
    if (activeFiltersHtml.length > 0) {
        // Prepend a title for the filter bar
        const chipContainer = document.createElement('div');
        chipContainer.id = 'filter-chip-container';
        chipContainer.innerHTML = '<h4>Active Filters:</h4>' + activeFiltersHtml.join('');
        breadcrumbsEl.appendChild(chipContainer);

        // Bind new event listeners for clearing filters
        breadcrumbsEl.querySelectorAll('.filter-chip button').forEach(button => {
            button.addEventListener('click', handleFilterChipClear);
        });
    }


    // B. Render Breadcrumbs (Only if filter chips aren't used for navigation, or as a path)
    if (path.length > 1 && !isSearchActive) {
         // Show category breadcrumb only if search is NOT active, or if it's the only active filter
        if (activeFiltersHtml.length === 0) {
            breadcrumbsEl.innerHTML = path.join(' &gt; ');
        }
        titleEl.textContent = currentTitle;
        titleEl.style.display = 'block';
    } else if (isSearchActive) {
        // If search is active, ensure the title reflects that (handled above in 2.A)
        titleEl.textContent = `Search: "${searchTerm}"` + (sortBy === 'recommended' ? ` (Recommended)` : '');
        titleEl.style.display = 'block';
    } else {
        // Reset if only "All Categories" is active
        titleEl.textContent = '';
    }
}

/**
 * Helper to create the filter chip HTML.
 * @param {string} text - The display text (e.g., 'Status: Coming Soon').
 * @param {string} type - The filter type ('status-filter', 'name-filter', etc.).
 * @param {string} value - The filter value to clear.
 * @returns {string} The HTML for the chip.
 */
function createFilterChip(text, type, value) {
    return `<div class="filter-chip" data-filter-type="${type}" data-filter-value="${value}">
                <span>${text}</span>
                <button title="Clear Filter">×</button>
            </div>`;
}

/**
 * Handles the click event when a user clears a filter chip.
 */
function handleFilterChipClear(e) {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;

    const type = chip.dataset.filterType;
    const value = chip.dataset.filterValue;

    // 1. Clear the filter state based on type
    switch (type) {
        case 'name-filter':
            document.getElementById('name-filter').value = '';
            break;
        case 'status-filter':
            document.getElementById('status-filter').value = 'Available';
            break;
        case 'headcount-filter':
            document.getElementById('headcount-filter').value = 'any';
            document.getElementById('headcount-custom').value = '';
            document.getElementById('headcount-custom').style.display = 'none';
            break;
        case 'location-filter':
        case 'budget-filter':
            document.getElementById(type).value = 'any';
            break;
        case 'subcategory-filter':
            // Find and unclick the corresponding button (which updates the URL/filters)
            const subcatButton = document.querySelector(`#subcategory-filters .filter-btn[data-filter=\"${value}\"]`);
            if (subcatButton) subcatButton.click();
            // We exit here, as subcatButton.click() already calls applyFiltersAndSort
            return;
    }
    
    // 2. Re-run filters and update UI (for all non-subcategory filters)
    window.applyFiltersAndSort(window.imageCache);
}
// --- Function to show login prompt for likes ---
let promptTimeout;
export function showLoginPromptForLikes() {
    const profileButton = document.getElementById('user-profile-button');
    if (!profileButton) return;

    // Create prompt element if it doesn't exist
    let promptElement = document.getElementById('login-prompt-likes');
    if (!promptElement) {
        promptElement = document.createElement('div');
        promptElement.id = 'login-prompt-likes';
        promptElement.style.position = 'absolute';
        promptElement.style.bottom = '110%'; // Position above the button
        promptElement.style.right = '0';
        promptElement.style.backgroundColor = '#333';
        promptElement.style.color = 'white';
        promptElement.style.padding = '8px 12px';
        promptElement.style.borderRadius = '4px';
        promptElement.style.fontSize = '0.85em';
        promptElement.style.whiteSpace = 'nowrap';
        promptElement.style.opacity = '0';
        promptElement.style.transition = 'opacity 0.3s ease';
        promptElement.style.pointerEvents = 'none'; // Prevent interaction
        promptElement.textContent = 'Log in to save your likes & get updates!';
        // Append near the button (adjust based on your header structure if needed)
        profileButton.parentNode.style.position = 'relative'; // Ensure parent allows absolute positioning
        profileButton.parentNode.appendChild(promptElement);
    }

    // Clear previous timeout if prompt is shown again quickly
    if (promptTimeout) clearTimeout(promptTimeout);

    // Show the prompt
    requestAnimationFrame(() => {
         promptElement.style.opacity = '1';
    });


    // Hide after a delay
    promptTimeout = setTimeout(() => {
        promptElement.style.opacity = '0';
    }, 4000); // Show for 4 seconds
}
// --- END login prompt function ---
