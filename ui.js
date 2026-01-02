// FILE: ui.js (REPLACE ENTIRE FILE)
import { state } from './state.js';
import { CONSTANTS } from './config.js';
import { log } from './utils/debug.js';
import { createInteractiveCard, updateCardIcon } from './components/card.js';
// --- THIS LINE IS MODIFIED (renderItineraryHeader and renderItinerary removed) ---
import { setupItineraryEventListeners, showItineraryModal, hideItineraryModal } from './components/itinerary.js';
import { getDayStatus, getCombinedPlanStatus, AVAILABILITY_STATUS, checkAvailability, buildGoalBucket } from './availability.js';
import { updateAllCardAvailabilityIcons } from './events.js';
import * as api from './api.js';
import { showPresentationView, hidePresentationView, setupPresentationEventListeners } from './components/presentation.js';
import { addEnergy, updateProgress } from './components/backgroundEngine.js';
import { shouldUseNetlifyImageCDN, optimizeImageUrl } from './utils/imageOptimizer.js';


// Re-export functions from component modules
export * from './components/card.js';
export * from './components/modal.js';
export { updateEventPlanSection, updateIdeasCarousel, updateTotalCost, displayReservedStatus, updateHeader as updateSidebarHeader, verifyNoDuplicateItems, initializeShareMenu, initializeSidebarSync } from './components/sidebar.js';
export * from './utils.js';
// --- THIS LINE IS MODIFIED (renderItineraryHeader and renderItinerary removed) ---
export { setupItineraryEventListeners, showItineraryModal, hideItineraryModal, checkAvailability };
export { showPresentationView, hidePresentationView, setupPresentationEventListeners };
export { updateFooter, initializeFooter } from './components/footer.js';
// Phase 3a: Task Manager exports
export { initTaskManager, getCurrentProjectId, getCurrentTasks } from './components/taskManager.js';


// Optimized lazy loading with Netlify Image CDN, responsive images and modern format support
const lazyLoadObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const element = entry.target;
            if (element.dataset.bgImage) {
                let imageUrl = element.dataset.bgImage;
                const width = element.offsetWidth || 400;
                const height = element.offsetHeight || 300;
                const dpr = window.devicePixelRatio || 1;
                const optimalWidth = Math.min(Math.ceil(width * dpr), 1200);
                const optimalHeight = Math.min(Math.ceil(height * dpr), 900);

                // Use Netlify Image CDN for supported images (provides auto WebP/AVIF)
                if (shouldUseNetlifyImageCDN(imageUrl)) {
                    imageUrl = optimizeImageUrl(imageUrl, {
                        width: optimalWidth,
                        height: optimalHeight,
                        fit: 'cover',
                        format: 'webp',
                        quality: 80
                    });
                } else if (imageUrl.includes('cloudinary.com')) {
                    // Fallback: direct Cloudinary transformations
                    imageUrl = imageUrl.replace('/upload/', `/upload/f_auto,q_auto,w_${optimalWidth}/`);
                }

                // Create a new image to preload
                const img = new Image();
                img.onload = () => {
                    element.style.backgroundImage = `url('${imageUrl}')`;
                    element.classList.add('loaded');
                    element.classList.remove('lazy-load');
                };
                img.onerror = () => {
                    // Fallback to original URL if optimized version fails
                    element.style.backgroundImage = `url('${element.dataset.bgImage}')`;
                    element.classList.add('loaded');
                    element.classList.remove('lazy-load');
                };
                img.src = imageUrl;
            }
            if (element.dataset.src) {
                let imageUrl = element.dataset.src;
                const width = element.offsetWidth || 400;
                const height = element.offsetHeight || 300;
                const dpr = window.devicePixelRatio || 1;
                const optimalWidth = Math.min(Math.ceil(width * dpr), 1200);
                const optimalHeight = Math.min(Math.ceil(height * dpr), 900);

                // Use Netlify Image CDN for supported images
                if (shouldUseNetlifyImageCDN(imageUrl)) {
                    imageUrl = optimizeImageUrl(imageUrl, {
                        width: optimalWidth,
                        height: optimalHeight,
                        fit: 'cover',
                        format: 'webp',
                        quality: 80
                    });
                } else if (imageUrl.includes('cloudinary.com')) {
                    // Fallback: direct Cloudinary transformations
                    imageUrl = imageUrl.replace('/upload/', `/upload/f_auto,q_auto,w_${optimalWidth}/`);
                }

                const img = new Image();
                img.onload = () => {
                    element.src = imageUrl;
                    element.classList.add('loaded');
                    element.classList.remove('lazy-load');
                };
                img.onerror = () => {
                    element.src = element.dataset.src;
                    element.classList.add('loaded');
                    element.classList.remove('lazy-load');
                };
                img.src = imageUrl;
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
    // Initialize tooltips for new partner badges - load libraries on demand
    const partnerBadges = container.querySelectorAll('.partner-badge');
    if (partnerBadges.length > 0) {
        // Lazy-load tooltip libraries only when needed
        if (typeof window.loadTooltipLibraries === 'function') {
            window.loadTooltipLibraries().then(() => {
                if (typeof tippy === 'function') {
                    tippy(partnerBadges, {
                        content: "This is a partner activity. We handle all booking and logistics to ensure it's a seamless part of your event.",
                        placement: 'top',
                        theme: 'light',
                    });
                }
            });
        } else if (typeof tippy === 'function') {
            tippy(partnerBadges, {
                content: "This is a partner activity. We handle all booking and logistics to ensure it's a seamless part of your event.",
                placement: 'top',
                theme: 'light',
            });
        }
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

// Helper function to find child items for a grouping
function getChildItemsForGrouping(groupingRecord, allRecords) {
    const groupingNameForFilter = groupingRecord.fields.Name.toLowerCase().replace(/\s+/g, ' ');

    const results = allRecords.filter(r => {
        if (r.fields['Item Type'] !== 'Bookable Item' && r.fields['Item Type'] !== 'Event') return false;
        const itemCategories = (r.fields.Categories || '')
            .split(',')
            .map(cat => cat.trim().toLowerCase().replace(/\s+/g, ' '));
        return itemCategories.includes(groupingNameForFilter);
    });

    return results;
}

// Helper function to find child groupings (nested collections) for a parent grouping
function getChildGroupingsForGrouping(parentGroupingRecord, allRecords) {
    const parentNameForFilter = parentGroupingRecord.fields.Name.toLowerCase().replace(/\s+/g, ' ');

    const results = allRecords.filter(r => {
        if (r.fields['Item Type'] !== 'Grouping') return false;
        if (r.id === parentGroupingRecord.id) return false; // Exclude self
        const itemCategories = (r.fields.Categories || '')
            .split(',')
            .map(cat => cat.trim().toLowerCase().replace(/\s+/g, ' '));
        return itemCategories.includes(parentNameForFilter);
    });

    return results;
}

// Helper function to create a nested collection tile (collage/grid with "See Collection" button)
async function createNestedCollectionTile(nestedGrouping, allRecords, imageCache) {
    const fields = nestedGrouping.fields;
    const collectionName = fields.Name || 'Untitled Collection';
    const description = fields.Description || '';

    // Get child items for this nested grouping to create the collage
    const childItems = getChildItemsForGrouping(nestedGrouping, allRecords);

    // Create the tile element
    const tile = document.createElement('div');
    tile.className = 'event-card nested-collection-tile';
    tile.dataset.recordId = nestedGrouping.id;
    tile.dataset.categoryName = collectionName;

    // Fetch images for the first 4 child items to create a collage
    let collageImagesHTML = '';
    if (childItems.length > 0) {
        const imagePromises = childItems.slice(0, 4).map(item =>
            api.fetchImagesForRecord(item, allRecords, imageCache)
        );
        const imageResults = await Promise.all(imagePromises);
        const collageImages = imageResults.flatMap(res => res.imageUrls).slice(0, 4);

        if (collageImages.length > 0) {
            collageImagesHTML = collageImages.map(url => {
                // Use a low-quality placeholder for lazy loading
                const placeholder = url.includes('cloudinary')
                    ? url.replace('/upload/', '/upload/c_fill,w_50,q_30,f_auto,e_blur:300/')
                    : url;
                const optimized = url.includes('cloudinary')
                    ? url.replace('/upload/', '/upload/c_fill,w_300,q_auto,f_auto/')
                    : url;
                return `<div class="collage-image lazy-load" style="background-image: url('${placeholder}')" data-bg-image="${optimized}"></div>`;
            }).join('');
        }
    }

    // Fallback if no images
    if (!collageImagesHTML) {
        collageImagesHTML = `<div class="collage-image" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);"></div>`;
    }

    tile.innerHTML = `
        <div class="event-card-image-container collage-container nested-collage">
            ${collageImagesHTML}
            <div class="nested-collection-overlay">
                <span class="nested-collection-count">${childItems.length} items</span>
            </div>
        </div>
        <div class="event-card-content">
            <h3>${collectionName}</h3>
            <p class="description">${description}</p>
        </div>
        <div class="card-footer">
            <button class="card-action-btn see-collection-btn">See Collection</button>
        </div>
    `;

    // Add click handler for the "See Collection" button
    const seeCollectionBtn = tile.querySelector('.see-collection-btn');
    if (seeCollectionBtn) {
        seeCollectionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const params = new URLSearchParams(window.location.search);
            params.set('subcategory', collectionName.toLowerCase().replace(/\s+/g, ' '));
            params.delete('view');
            window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
            if (window.applyFiltersAndSort) {
                window.applyFiltersAndSort(imageCache);
            }
        });
    }

    // Add click handler for the entire tile (except buttons)
    tile.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const params = new URLSearchParams(window.location.search);
        params.set('subcategory', collectionName.toLowerCase().replace(/\s+/g, ' '));
        params.delete('view');
        window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
        if (window.applyFiltersAndSort) {
            window.applyFiltersAndSort(imageCache);
        }
    });

    return tile;
}

// Helper function to create a grouping carousel section
async function createGroupingCarouselSection(groupingRecord, childItems, allRecords, imageCache) {
    const section = document.createElement('div');
    section.className = 'grouping-carousel-section';
    section.dataset.groupingId = groupingRecord.id;
    section.dataset.categoryName = groupingRecord.fields.Name;

    const fields = groupingRecord.fields;
    const groupingName = fields.Name || 'Untitled Collection';
    const description = fields.Description || '';

    // Create header
    const header = document.createElement('div');
    header.className = 'grouping-carousel-header';
    header.innerHTML = `
        <h3 class="grouping-carousel-title">${groupingName}</h3>
        <span class="grouping-carousel-count">${childItems.length} items</span>
    `;
    header.addEventListener('click', () => {
        // Navigate to the grouping category when header is clicked
        const params = new URLSearchParams(window.location.search);
        params.set('subcategory', groupingRecord.fields.Name.toLowerCase().replace(/\s+/g, ' '));
        params.delete('view');
        window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
        if (window.applyFiltersAndSort) {
            window.applyFiltersAndSort(imageCache);
        }
    });
    section.appendChild(header);

    // Add description if present
    if (description) {
        const descEl = document.createElement('p');
        descEl.className = 'grouping-carousel-description';
        descEl.textContent = description;
        section.appendChild(descEl);
    }

    // Create carousel wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'grouping-carousel-wrapper';

    // Create carousel container
    const container = document.createElement('div');
    container.className = 'grouping-carousel-container';

    // Get nested groupings (child collections) for this parent grouping
    const nestedGroupings = getChildGroupingsForGrouping(groupingRecord, allRecords);

    // Create tiles for nested collections first (they appear at the start of the carousel)
    if (nestedGroupings.length > 0) {
        const nestedTilePromises = nestedGroupings.map(nestedGrouping =>
            createNestedCollectionTile(nestedGrouping, allRecords, imageCache)
        );
        const nestedTiles = await Promise.all(nestedTilePromises);

        nestedTiles.forEach((tile) => {
            if (tile) {
                container.appendChild(tile);
            }
        });
    }

    // Create cards for child items (limit to first 10 for carousel, minus nested collection tiles)
    const maxItems = Math.max(0, 10 - nestedGroupings.length);
    const itemsToShow = childItems.slice(0, maxItems);

    const cardPromises = itemsToShow.map(record => createInteractiveCard(record, allRecords, imageCache));
    const cards = await Promise.all(cardPromises);

    cards.forEach((card) => {
        if (card) {
            container.appendChild(card);
        }
    });

    wrapper.appendChild(container);

    // Helper function to calculate scroll distance based on card width
    const getScrollDistance = () => {
        const card = container.querySelector('.event-card');
        if (card) {
            return card.offsetWidth + 20; // 20px gap
        }
        return container.clientWidth;
    };

    // Add navigation buttons
    const leftNav = document.createElement('button');
    leftNav.className = 'grouping-carousel-nav left';
    leftNav.innerHTML = '◄';
    leftNav.setAttribute('aria-label', 'Scroll left');
    leftNav.addEventListener('click', (e) => {
        e.stopPropagation();
        container.scrollBy({ left: -getScrollDistance(), behavior: 'smooth' });
    });

    const rightNav = document.createElement('button');
    rightNav.className = 'grouping-carousel-nav right';
    rightNav.innerHTML = '►';
    rightNav.setAttribute('aria-label', 'Scroll right');
    rightNav.addEventListener('click', (e) => {
        e.stopPropagation();
        container.scrollBy({ left: getScrollDistance(), behavior: 'smooth' });
    });

    wrapper.appendChild(leftNav);
    wrapper.appendChild(rightNav);

    // Update navigation button visibility based on scroll position
    const updateNavVisibility = () => {
        const hasOverflow = container.scrollWidth > container.clientWidth;

        if (hasOverflow) {
            wrapper.classList.add('has-overflow');
            // Fade left button at start
            leftNav.style.opacity = container.scrollLeft <= 0 ? '0.3' : '';
            leftNav.style.pointerEvents = container.scrollLeft <= 0 ? 'none' : '';
            // Fade right button at end
            const atEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 5;
            rightNav.style.opacity = atEnd ? '0.3' : '';
            rightNav.style.pointerEvents = atEnd ? 'none' : '';
        } else {
            wrapper.classList.remove('has-overflow');
        }
    };

    // Listen for scroll events to update nav visibility
    container.addEventListener('scroll', updateNavVisibility);

    // Check for overflow and update nav visibility after render
    setTimeout(updateNavVisibility, 100);
    setTimeout(updateNavVisibility, 500);

    section.appendChild(wrapper);

    // Add "View All" link if there are more items
    if (childItems.length > 10) {
        const viewAll = document.createElement('a');
        viewAll.className = 'grouping-carousel-view-all';
        viewAll.textContent = `View all ${childItems.length} items →`;
        viewAll.addEventListener('click', (e) => {
            e.preventDefault();
            const params = new URLSearchParams(window.location.search);
            params.set('subcategory', groupingRecord.fields.Name.toLowerCase().replace(/\s+/g, ' '));
            params.delete('view');
            window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
            if (window.applyFiltersAndSort) {
                window.applyFiltersAndSort(imageCache);
            }
        });
        section.appendChild(viewAll);
    }

    return section;
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
        log('UI', "No records to render, displaying empty state message.");

        // Check if filters are active
        const hasActiveFilters = state.ui.selectedCategory !== 'all' ||
                                 state.ui.activeSubcategories.size > 0 ||
                                 state.ui.nameFilter ||
                                 state.ui.selectedDateRange.start;

        let emptyMessage = '';
        if (hasActiveFilters) {
            emptyMessage = `
                <div style='text-align: center; padding: 40px 20px; color: #6c757d;'>
                    <p style='font-size: 1.2em; margin-bottom: 10px;'>No items match your filters</p>
                    <p>Try adjusting your search criteria or filters to see more results.</p>
                </div>
            `;
        } else {
            emptyMessage = `
                <div style='text-align: center; padding: 40px 20px; color: #6c757d;'>
                    <p style='font-size: 1.2em; margin-bottom: 10px;'>No items available</p>
                    <p>Check back soon for new event options!</p>
                </div>
            `;
        }

        catalogContainer.innerHTML = emptyMessage;
        if (loadingMessage) {
            loadingMessage.style.display = 'none';
        }
        return;
    }

    // Separate groupings from regular items
    const groupings = recordsToRender.filter(r => r.fields['Item Type'] === 'Grouping');
    const nonGroupingRecords = recordsToRender.filter(r => r.fields['Item Type'] !== 'Grouping');

    // Check if we're viewing a specific subcategory (filtered view) - don't show carousels in filtered views
    const params = new URLSearchParams(window.location.search);
    const hasSubcategoryFilter = params.get('subcategory');
    const hasViewFilter = params.get('view');
    const isFilteredView = hasSubcategoryFilter || hasViewFilter || state.ui.nameFilter;

    // Check if carousel layout is already established in the container
    const existingCarouselSections = catalogContainer.querySelector('.grouping-carousel-section');
    const existingUngroupedSection = catalogContainer.querySelector('.ungrouped-items-section');
    const hasExistingCarouselLayout = existingCarouselSections !== null;

    // When appending, respect the existing layout structure
    let layoutMode;
    if (append && hasExistingCarouselLayout) {
        // Append mode with existing carousel layout - add to ungrouped section
        layoutMode = 'append-to-ungrouped';
    } else if (isFilteredView || groupings.length === 0) {
        layoutMode = 'grid';
    } else {
        layoutMode = 'carousel-sections';
    }

    // Clear container for fresh render
    if (!append) {
        catalogContainer.innerHTML = '';
    }

    // If appending to existing carousel layout, add items to the ungrouped section
    if (layoutMode === 'append-to-ungrouped') {
        // Find or create the ungrouped items section
        let ungroupedSection = existingUngroupedSection;
        if (!ungroupedSection) {
            ungroupedSection = document.createElement('div');
            ungroupedSection.className = 'ungrouped-items-section';
            ungroupedSection.style.display = 'grid';
            ungroupedSection.style.gridTemplateColumns = 'repeat(auto-fill, minmax(320px, 1fr))';
            ungroupedSection.style.gap = '25px';
            ungroupedSection.style.marginTop = '20px';
            catalogContainer.appendChild(ungroupedSection);
        }

        const fragment = document.createDocumentFragment();
        const CHUNK_SIZE = 4;

        for (let i = 0; i < recordsToRender.length; i += CHUNK_SIZE) {
            const chunk = recordsToRender.slice(i, i + CHUNK_SIZE);
            const cardPromises = chunk.map(record => createInteractiveCard(record, state.records.all, imageCache));
            const cards = await Promise.all(cardPromises);

            cards.forEach(card => {
                if (card) fragment.appendChild(card);
            });

            ungroupedSection.appendChild(fragment);
            fragment.textContent = '';

            addEnergy();
            updateProgress(0.00005 * chunk.length);

            if (i + CHUNK_SIZE < recordsToRender.length) {
                await new Promise(resolve => {
                    if (window.requestIdleCallback) {
                        requestIdleCallback(resolve, { timeout: 50 });
                    } else {
                        setTimeout(resolve, 0);
                    }
                });
            }
        }
    } else if (isFilteredView || groupings.length === 0) {
        // If in filtered view or no groupings, render normally (GRID MODE)
        const fragment = document.createDocumentFragment();
        const CHUNK_SIZE = 4;

        for (let i = 0; i < recordsToRender.length; i += CHUNK_SIZE) {
            const chunk = recordsToRender.slice(i, i + CHUNK_SIZE);
            const cardPromises = chunk.map(record => createInteractiveCard(record, state.records.all, imageCache));
            const cards = await Promise.all(cardPromises);

            cards.forEach(card => {
                if (card) fragment.appendChild(card);
            });

            catalogContainer.appendChild(fragment);
            fragment.textContent = '';

            addEnergy();
            updateProgress(0.00005 * chunk.length);

            if (i + CHUNK_SIZE < recordsToRender.length) {
                await new Promise(resolve => {
                    if (window.requestIdleCallback) {
                        requestIdleCallback(resolve, { timeout: 50 });
                    } else {
                        setTimeout(resolve, 0);
                    }
                });
            }
        }
    } else {
        // Render groupings as horizontal carousel sections
        for (const grouping of groupings) {
            const childItems = getChildItemsForGrouping(grouping, state.records.all);
            if (childItems.length > 0) {
                const carouselSection = await createGroupingCarouselSection(grouping, childItems, state.records.all, imageCache);
                catalogContainer.appendChild(carouselSection);
                addEnergy();
                updateProgress(0.00005);

                // Yield to browser
                await new Promise(resolve => {
                    if (window.requestIdleCallback) {
                        requestIdleCallback(resolve, { timeout: 50 });
                    } else {
                        setTimeout(resolve, 0);
                    }
                });
            }
        }

        // Also render any non-grouped items that don't belong to any grouping
        // Find items that aren't in any grouping's child items
        const allGroupedItemIds = new Set();
        groupings.forEach(g => {
            const children = getChildItemsForGrouping(g, state.records.all);
            children.forEach(c => allGroupedItemIds.add(c.id));
        });

        const ungroupedItems = nonGroupingRecords.filter(r => !allGroupedItemIds.has(r.id));

        if (ungroupedItems.length > 0) {
            // Create a section for ungrouped items
            const ungroupedSection = document.createElement('div');
            ungroupedSection.className = 'ungrouped-items-section';
            ungroupedSection.style.display = 'grid';
            ungroupedSection.style.gridTemplateColumns = 'repeat(auto-fill, minmax(320px, 1fr))';
            ungroupedSection.style.gap = '25px';
            ungroupedSection.style.marginTop = '20px';

            const fragment = document.createDocumentFragment();
            const CHUNK_SIZE = 4;

            for (let i = 0; i < ungroupedItems.length; i += CHUNK_SIZE) {
                const chunk = ungroupedItems.slice(i, i + CHUNK_SIZE);
                const cardPromises = chunk.map(record => createInteractiveCard(record, state.records.all, imageCache));
                const cards = await Promise.all(cardPromises);

                cards.forEach(card => {
                    if (card) fragment.appendChild(card);
                });

                addEnergy();
                updateProgress(0.00005 * chunk.length);
            }

            ungroupedSection.appendChild(fragment);
            catalogContainer.appendChild(ungroupedSection);
        }
    }

    // Initialize heart icons for all newly rendered cards
    recordsToRender.forEach(record => {
        updateCardIcon(record.id);
    });

    // Update availability icons if a date range is selected
    if (!append) {
        updateAllCardAvailabilityIcons().catch(err => {
            log('UI', `Error updating availability icons: ${err.message}`);
        });
    }

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
    // Return default state with both legacy and new format support
    return { quantity: 1, selectedOptionIndex: 0, selections: {}, note: '' };
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
    console.log('[DEBUG updateEventPlanDateDisplay] ========== DATE DISPLAY UPDATE DEBUG ==========');
    console.log('[DEBUG updateEventPlanDateDisplay] state.eventDetails.combined contents:', Object.fromEntries(state.eventDetails.combined));
    console.log('[DEBUG updateEventPlanDateDisplay] CONSTANTS.DETAIL_TYPES.DATE:', CONSTANTS.DETAIL_TYPES.DATE);

    log('UI', 'Updating event plan date display.');
    const dateInput = document.getElementById('event-date-picker');
    if (!dateInput) {
        console.log('[DEBUG updateEventPlanDateDisplay] WARNING: event-date-picker NOT found!');
        return;
    }
    const selectedDateISO = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    console.log('[DEBUG updateEventPlanDateDisplay] Retrieved date from state:', selectedDateISO);

    if (!selectedDateISO) {
        console.log('[DEBUG updateEventPlanDateDisplay] No date in state, setting placeholder');
        dateInput.value = 'Select a date';
        dateInput.classList.remove('available-full', 'available-partial', 'unavailable');
        console.log('[DEBUG updateEventPlanDateDisplay] ========== END DATE DISPLAY UPDATE DEBUG ==========');
        return;
    }
    const selectedDate = new Date(selectedDateISO);
    console.log('[DEBUG updateEventPlanDateDisplay] Parsed date object:', selectedDate);
    console.log('[DEBUG updateEventPlanDateDisplay] Is valid date?', !isNaN(selectedDate.getTime()));

    const lockedItems = Array.from(state.cart.lockedItems.keys()).map(recordId => state.records.all.find(r => r.id === recordId)).filter(Boolean);
    const overallStatus = await getCombinedPlanStatus(selectedDate, lockedItems);
    const displayValue = selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    console.log('[DEBUG updateEventPlanDateDisplay] Display value:', displayValue);
    dateInput.value = displayValue;
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
    console.log('[DEBUG updateEventPlanDateDisplay] ========== END DATE DISPLAY UPDATE DEBUG ==========');
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

export function showEventPlanNotification(message, duration = 5000) {
    const notification = document.getElementById('event-plan-notification');
    if (notification) {
        notification.textContent = message;
        notification.style.display = 'block';
        setTimeout(() => {
            notification.style.display = 'none';
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
    // Remove any existing filter chip container from catalog-header
    document.getElementById('filter-chip-container')?.remove();
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

    if (view === 'plan' || view === 'likes' || view === 'my-sessions') {
        const filterControlsEl = document.getElementById('filter-controls');
        if (filterControlsEl) { filterControlsEl.dataset.activeFilters = 0; }

        const pathContainer = document.createElement('div');
        pathContainer.id = 'breadcrumb-path-container';
        let viewLabel;
        if (view === 'plan') {
            viewLabel = 'My Plan';
        } else if (view === 'likes') {
            viewLabel = 'My Likes';
        } else {
            viewLabel = 'My Sessions';
        }
        pathContainer.innerHTML = `<span>${viewLabel}</span>`;
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
        // First, check if filterName is actually a record ID (starts with 'rec')
        if (filterName.startsWith('rec')) {
            return state.records.all.find(r => r.id === filterName);
        }
        // Try exact match first (for new format with spaces)
        let record = state.records.all.find(r => r.fields.Name?.toLowerCase() === filterName);
        // If no match, try converting dashes to spaces (for old URLs with dashes)
        if (!record) {
            record = state.records.all.find(r => r.fields.Name?.toLowerCase() === filterName.replace(/-/g, ' '));
        }
        return record;
    };

    if (categoryFilter) {
        const categoryRecord = findRecordByName(categoryFilter);
        const categoryName = categoryRecord?.fields.Name || categoryFilter;

        // Category is shown in breadcrumbs, so don't add to active filters
        // activeFiltersHtml.push(createFilterChip('Category: ' + categoryName, 'category-filter', categoryFilter));
        // filterCount++;

        path.push(`<a href=\"#\" class=\"breadcrumb-link\" data-filter=\"${categoryFilter}\">${categoryName}</a>`);
    }

    subcategoryFilters.forEach(subcatFilter => {
        const subcatRecord = findRecordByName(subcatFilter);
        const subcatName = subcatRecord?.fields.Name || subcatFilter;

        // Subcategory is shown in breadcrumbs, so don't add to active filters
        // activeFiltersHtml.push(createFilterChip(subcatName, 'subcategory-filter', subcatFilter));
        // filterCount++;
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

        // Append to catalog-header so filter chips appear below the breadcrumbs row
        const catalogHeader = document.getElementById('catalog-header');
        if (catalogHeader) {
            catalogHeader.appendChild(chipContainer);
        }

        catalogHeader?.querySelectorAll('.filter-chip button').forEach(button => {
            button.addEventListener('click', handleFilterChipClear);
        });

        catalogHeader?.querySelector('#clear-all-chips-btn')?.addEventListener('click', () => {
            document.getElementById('reset-filters-btn')?.click();
        });
    }
    
    const filterControlsEl = document.getElementById('filter-controls');
    if (filterControlsEl) {
        filterControlsEl.dataset.activeFilters = filterCount;
    }

    // Update filter count badge in the new search bar
    const filterCountBadge = document.getElementById('filter-count-badge');
    const filterToggleBtn = document.getElementById('filter-toggle-btn');
    if (filterCountBadge && filterToggleBtn) {
        if (filterCount > 0) {
            filterCountBadge.textContent = filterCount;
            filterCountBadge.style.display = 'inline-block';
            filterToggleBtn.classList.add('has-filters');
        } else {
            filterCountBadge.style.display = 'none';
            filterToggleBtn.classList.remove('has-filters');
        }
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
