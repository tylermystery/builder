// FILE: ui.js (REPLACE ENTIRE FILE)
import { state } from './state.js';
import { CONSTANTS } from './config.js';
import { log } from './utils/debug.js';
import { createInteractiveCard, updateCardIcon } from './components/card.js';
// --- THIS LINE IS MODIFIED (renderItineraryHeader and renderItinerary removed) ---
import { setupItineraryEventListeners, showItineraryModal, hideItineraryModal } from './components/itinerary.js';
import { getDayStatus, getCombinedPlanStatus, AVAILABILITY_STATUS, checkAvailability, buildGoalBucket } from './availability.js';
import * as api from '../api.js';
import { showPresentationView, hidePresentationView, setupPresentationEventListeners } from './components/presentation.js';
import { initializeItemChat } from './chat.js';


// Re-export functions from component modules
export * from './components/card.js';
export * from './components/modal.js';
export { updateEventPlanSection, updateIdeasCarousel, updateTotalCost, displayReservedStatus, updateHeader as updateSidebarHeader } from './components/sidebar.js';
export * from '../utils.js';
// --- THIS LINE IS MODIFIED (renderItineraryHeader and renderItinerary removed) ---
export { setupItineraryEventListeners, showItineraryModal, hideItineraryModal, checkAvailability };
export { showPresentationView, hidePresentationView, setupPresentationEventListeners };
export { initializeItemChat };


const lazyLoadObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const element = entry.target;
            if (element.dataset.bgImage) {
                // Create a new image to preload
                const img = new Image();
                img.onload = () => {
                    element.style.backgroundImage = `url('${element.dataset.bgImage}')`;
                    element.classList.add('loaded');
                    element.classList.remove('lazy-load');
                };
                img.src = element.dataset.bgImage;
            }
            if (element.dataset.src) {
                const img = new Image();
                img.onload = () => {
                    element.src = element.dataset.src;
                    element.classList.add('loaded');
                    element.classList.remove('lazy-load');
                };
                img.src = element.dataset.src;
            }
            observer.unobserve(element);
        }
    });
}, { rootMargin: "0px 0px 300px 0px" });

let promptTimeout;
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

// Helper function to create skeleton cards
function createSkeletonCard() {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton-card';
    skeleton.innerHTML = `
        <div class="skeleton-image"></div>
        <div class="skeleton-content">
            <div class="skeleton skeleton-title"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text short"></div>
        </div>
        <div class="skeleton-footer">
            <div class="skeleton skeleton-price"></div>
            <div class="skeleton skeleton-button"></div>
        </div>
    `;
    return skeleton;
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
        // Show skeleton cards immediately for better perceived performance
        catalogContainer.innerHTML = '';
        const skeletonCount = Math.min(recordsToRender.length, 6);
        for (let i = 0; i < skeletonCount; i++) {
            catalogContainer.appendChild(createSkeletonCard());
        }
        if (loadingMessage) {
            loadingMessage.style.display = 'none'; // Hide loading message when showing skeletons
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
    const CHUNK_SIZE = 6; // Render in larger chunks for better performance
    
    // Progressive rendering with skeleton replacement
    for (let i = 0; i < recordsToRender.length; i += CHUNK_SIZE) {
        const chunk = recordsToRender.slice(i, i + CHUNK_SIZE);
        const cardPromises = chunk.map(record => createInteractiveCard(record, state.records.all, imageCache));
        const cards = await Promise.all(cardPromises);
        
        // Replace skeletons with real cards or append new ones
        if (!append && i === 0) {
            catalogContainer.innerHTML = ''; // Clear skeletons on first batch
        }
        
        cards.forEach(card => {
            if (card) fragment.appendChild(card);
        });
        
        catalogContainer.appendChild(fragment.cloneNode(true));
        fragment.textContent = ''; // Clear fragment for next batch
        
        // Allow UI to update between chunks
        if (i + CHUNK_SIZE < recordsToRender.length) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    
    // Initialize heart icons for all newly rendered cards
    recordsToRender.forEach(record => {
        updateCardIcon(record.id);
    });
    
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
    const activeShop = state.stores.all.find(s => s.id === state.ui.activeShopId);
    const shopName = activeShop?.fields?.Name || '';
    document.title = eventName || (shopName ? `WTFun ${shopName}` : 'WTFun');
    const eventNameInput = document.getElementById('header-event-name');
    if (eventNameInput) {
        eventNameInput.value = eventName || 'Enter Plan Name';
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
    const modalTitleEl = overlay?.querySelector('.checkout-modal-content h3');
    
    if (!overlay || !listContainer) return;

    if (modalTitleEl) {
        modalTitleEl.innerHTML = `www.whatthefun.wtf <sup>fun finder</sup>`;
        modalTitleEl.style.fontSize = '1.5em';
        modalTitleEl.style.fontWeight = 'bold';
    } else {
        console.warn('Shop switcher modal title element not found for branding.');
    }

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

export function updateCatalogHeader() {
    const breadcrumbsEl = document.getElementById('breadcrumbs');
    const nameFilterEl = document.getElementById('name-filter');
    const clearSearchBtn = document.getElementById('clear-search-btn');

    // Title element removed
    if (!breadcrumbsEl || !nameFilterEl || !clearSearchBtn) return;

    let filterCount = 0;

    breadcrumbsEl.innerHTML = '';
    clearSearchBtn.style.display = 'none';
    const activeFiltersHtml = [];
    
    const params = new URLSearchParams(window.location.search);
    const searchTerm = nameFilterEl.value.trim(); 
    const isSearchActive = searchTerm.length > 0;
    const view = params.get('view');
    const categoryFilter = params.get('category');
    const subcategoryFilters = params.get('subcategory')?.split(',').filter(Boolean) || [];

    const sortByEl = document.getElementById('sort-by');
    const sortBy = sortByEl?.value;
    const isRecommendedSort = sortBy === 'recommended';
    const goalsInput = document.getElementById('header-goals')?.value?.trim();

    if (view === 'plan' || view === 'likes') {
        const filterControlsEl = document.getElementById('filter-controls');
        if (filterControlsEl) { filterControlsEl.dataset.activeFilters = 0; }
        
        const pathContainer = document.createElement('div');
        pathContainer.id = 'breadcrumb-path-container';
        pathContainer.innerHTML = `<a href=\"#\" class=\"breadcrumb-link\" data-filter=\"all\">All Categories</a> &gt; <span>${view === 'plan' ? 'My Plan' : 'My Likes'}</span>`;
        breadcrumbsEl.appendChild(pathContainer);
        return; 
    }

    if (isSearchActive) {
        clearSearchBtn.style.display = 'block'; 
        activeFiltersHtml.push(createFilterChip('Search: ' + searchTerm, 'name-filter', nameFilterEl.value));
        filterCount++; 
    }
    
    const statusEl = document.getElementById('status-filter');
    if (statusEl && statusEl.value !== 'Available') {
        activeFiltersHtml.push(createFilterChip('Status: ' + statusEl.options[statusEl.selectedIndex].text, 'status-filter', statusEl.value));
        filterCount++; 
    }
    
    const headcountEl = document.getElementById('headcount-filter');
    const headcountCustomEl = document.getElementById('headcount-custom');
    if (headcountEl && headcountEl.value !== 'any') {
        let text = headcountEl.options[headcountEl.selectedIndex].text;
        if (headcountEl.value === 'custom' && headcountCustomEl.value) {
            text = `Headcount: ${headcountCustomEl.value}`;
        }
        activeFiltersHtml.push(createFilterChip(text, 'headcount-filter', headcountEl.value));
        filterCount++; 
    }
    
    const locationEl = document.getElementById('location-filter');
    if (locationEl && locationEl.value !== 'any') {
        activeFiltersHtml.push(createFilterChip('Location: ' + locationEl.options[locationEl.selectedIndex].text, 'location-filter', locationEl.value));
        filterCount++; 
    }

    const budgetEl = document.getElementById('budget-filter');
    if (budgetEl && budgetEl.value !== 'any') {
        activeFiltersHtml.push(createFilterChip('Budget: ' + budgetEl.options[budgetEl.selectedIndex].text, 'budget-filter', budgetEl.value));
        filterCount++; 
    }

    const mainDatePicker = document.getElementById('date-filter')?._flatpickr;
    if (mainDatePicker && mainDatePicker.selectedDates.length > 0) {
        let text;
        if (mainDatePicker.selectedDates.length === 1) {
            text = 'Date: ' + mainDatePicker.selectedDates[0].toLocaleDateString();
        } else {
            const start = mainDatePicker.selectedDates[0].toLocaleDateString();
            const end = mainDatePicker.selectedDates[1].toLocaleDateString();
            text = `Date: ${start} – ${end}`;
        }
        activeFiltersHtml.push(createFilterChip(text, 'date-filter', 'active'));
        filterCount++; 
    }
    
    const path = [];
    path.push(`<a href=\"#\" class=\"breadcrumb-link\" data-filter=\"all\">All Categories</a>`);

    const findRecordByName = (filterName) => {
        return state.records.all.find(r => r.fields.Name?.toLowerCase() === filterName.replace(/-/g, ' '));
    };

    if (categoryFilter) {
        const categoryRecord = findRecordByName(categoryFilter);
        const categoryName = categoryRecord?.fields.Name || categoryFilter; 
        
        activeFiltersHtml.push(createFilterChip('Category: ' + categoryName, 'category-filter', categoryFilter));
        filterCount++; 
        
        path.push(`<a href=\"#\" class=\"breadcrumb-link\" data-filter=\"${categoryFilter}\">${categoryName}</a>`);
    }

    subcategoryFilters.forEach(subcatFilter => {
        const subcatRecord = findRecordByName(subcatFilter);
        const subcatName = subcatRecord?.fields.Name || subcatFilter;

        activeFiltersHtml.push(createFilterChip(subcatName, 'subcategory-filter', subcatFilter));
        filterCount++; 
        path.push(`<span>${subcatName}</span>`);
    });

    if (isRecommendedSort && goalsInput && goalsInput.length > 0) {
        const STOP_WORDS = new Set([
            'a', 'an', 'the', 'for', 'with', 'and', 'is', 'of', 'to', 'in', 'on', 
            'at', 'my', 'it', 'big', 'small', 'all', 'new', 'old', 'about', 'want'
        ]);

        const goalWords = goalsInput.split(/[\s,]+/).filter(word => 
            word.length > 2 && !STOP_WORDS.has(word.toLowerCase())
        );

        goalWords.forEach(goal => {
            if (goal.toLowerCase() !== searchTerm.toLowerCase()) {
                activeFiltersHtml.push(createFilterChip(`Goal: ${goal}`, 'goal-filter', goal));
            }
        });
    }
    
    const pathContainer = document.createElement('div');
    pathContainer.id = 'breadcrumb-path-container';
    if (path.length > 1 || isSearchActive) { 
        pathContainer.innerHTML = path.join(' &gt; ');
        breadcrumbsEl.appendChild(pathContainer);
    } else {
        pathContainer.innerHTML = `<span>All Categories</span>`;
        breadcrumbsEl.appendChild(pathContainer);
    }

    if (activeFiltersHtml.length > 0) {
        const chipContainer = document.createElement('div');
        chipContainer.id = 'filter-chip-container';
        
        chipContainer.innerHTML = `
            <span class=\"chip-label\">Active Filters:</span>
            ${activeFiltersHtml.join('')}
            <button id=\"clear-all-chips-btn\" class=\"filter-chip-clear-all\">Clear Filters</button>
        `;
        breadcrumbsEl.appendChild(chipContainer); 

        breadcrumbsEl.querySelectorAll('.filter-chip button').forEach(button => {
            button.addEventListener('click', handleFilterChipClear);
        });
        
        breadcrumbsEl.querySelector('#clear-all-chips-btn')?.addEventListener('click', () => {
            document.getElementById('reset-filters-btn')?.click();
        });
    }
    
    const filterControlsEl = document.getElementById('filter-controls');
    if (filterControlsEl) {
        filterControlsEl.dataset.activeFilters = filterCount;
    }
}
/**
 * Handles the click event when a user clears a filter chip.
 */
export function handleFilterChipClear(e) {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;

    const type = chip.dataset.filterType;
    const value = chip.dataset.filterValue;
    const applyFilters = () => window.applyFiltersAndSort(window.imageCache);


    // --- VVV V2.7 GOAL CHIP LOGIC VVV ---
    if (type === 'goal-filter') {
        const goalsInput = document.getElementById('header-goals');
        if (goalsInput) {
            const goalWords = goalsInput.value.split(/[\s,]+/).filter(Boolean);
            const updatedGoals = goalWords.filter(word => word.toLowerCase() !== value.toLowerCase()).join(' ');
            
            goalsInput.value = updatedGoals;
            goalsInput.dispatchEvent(new Event('change', { bubbles: true }));
            applyFilters();
            
            return; 
        }
    }
    // --- ^^^ END V2.7 GOAL CHIP LOGIC ^^^

    switch (type) {
        case 'name-filter':
            document.getElementById('name-filter').value = '';
            break;
        case 'status-filter':
            // --- THIS IS THE FIX ---
            // It should be .value, not .css('display')
            document.getElementById('status-filter').value = 'Available';
            // --- END FIX ---
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
        case 'date-filter':
            const datePicker = document.getElementById('date-filter')?._flatpickr;
            if (datePicker) {
                 datePicker.clear();
                 state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
            }
            break;
        case 'category-filter':
            updateUrl({ category: null, subcategory: null, view: null });
            break;
        case 'subcategory-filter':
            const params = new URLSearchParams(window.location.search);
            const subcats = params.get('subcategory')?.split(',').filter(Boolean) || [];
            const newSubcats = subcats.filter(s => s !== value);
            updateUrl({ subcategory: newSubcats.join(',') || null });
            break;
    }
    
    applyFilters();
}

/**
 * Helper to create the filter chip HTML.
 */
function createFilterChip(text, type, value) {
    const isGoal = type === 'goal-filter';
    const tooltip = isGoal ? 'Click to remove this goal from the Goals / Notes box.' : 'Clear Filter';

    return `<div class=\"filter-chip ${isGoal ? 'goal-chip' : ''}\" data-filter-type=\"${type}\" data-filter-value=\"${value}\" data-tippy-content=\"${tooltip}\">\n                <span>${text}</span>\n                <button title=\"${tooltip}\">×</button>\n            </div>`;
}

export function showLoginPromptForLikes() {
    const profileButton = document.getElementById('user-profile-button');
    if (!profileButton) return;

    let promptElement = document.getElementById('login-prompt-likes');
    if (!promptElement) {
        promptElement = document.createElement('div');
        promptElement.id = 'login-prompt-likes';
        promptElement.style.position = 'absolute';
        promptElement.style.bottom = '110%'; 
        promptElement.style.right = '0';
        promptElement.style.backgroundColor = '#333';
        promptElement.style.color = 'white';
        promptElement.style.padding = '8px 12px';
        promptElement.style.borderRadius = '4px';
        promptElement.style.fontSize = '0.85em';
        promptElement.style.whiteSpace = 'nowrap';
        promptElement.style.opacity = '0';
        promptElement.style.transition = 'opacity 0.3s ease';
        promptElement.style.pointerEvents = 'none'; 
        promptElement.textContent = 'Log in to save your likes & get updates!';
        profileButton.parentNode.style.position = 'relative'; 
        profileButton.parentNode.appendChild(promptElement);
    }

    if (promptTimeout) clearTimeout(promptTimeout);

    requestAnimationFrame(() => {
         promptElement.style.opacity = '1';
    });

    promptTimeout = setTimeout(() => {
        promptElement.style.opacity = '0';
    }, 4000); 
}
