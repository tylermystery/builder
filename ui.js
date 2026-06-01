// FILE: ui.js (REPLACE ENTIRE FILE)
console.log('[MODULE DEBUG] ui.js module starting to load...', performance.now().toFixed(2) + 'ms');
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
import { shouldUseNetlifyImageCDN, optimizeImageUrl, applyCloudinaryTransform, hasCloudinaryTransformations } from './utils/imageOptimizer.js';
import { storeSlug } from './utils.js';
import { getCommunitySentimentScore } from './components/publicCatalog.js';

console.log('[MODULE DEBUG] ui.js imports resolved. Checking key imports...');
console.log('[MODULE DEBUG] ui.js: createInteractiveCard:', typeof createInteractiveCard);
console.log('[MODULE DEBUG] ui.js: showPresentationView:', typeof showPresentationView);
console.log('[MODULE DEBUG] ui.js: hidePresentationView:', typeof hidePresentationView);
console.log('[MODULE DEBUG] ui.js: showItineraryModal:', typeof showItineraryModal);


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
export { initTaskManager, getCurrentProjectId, getCurrentTasks, showTaskModal } from './components/taskManager.js';

console.log('[MODULE DEBUG] ui.js re-exports defined successfully.', performance.now().toFixed(2) + 'ms');


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
    if (mainContent) {
        if (show) {
            mainContent.style.display = 'none';
        } else {
            // Clear inline display style to let CSS media queries control the layout
            // This ensures mobile (flex) vs desktop (grid) layouts are respected
            mainContent.style.display = '';
        }
    }
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
// Read the catalog's active status filter so carousel children can honor it.
// Returns 'all' when the filter UI isn't present (e.g. presentation/viewer
// contexts), which preserves the original "show everything" behavior there.
function getActiveCatalogStatusFilter() {
    const el = typeof document !== 'undefined' && document.getElementById('status-filter');
    return (el && el.value) || 'all';
}

// Decide whether a child item matches the active status filter. Carousel
// children are expanded from the UNFILTERED store catalog, so without this
// gate every status filter would show the same items. We intentionally leave
// 'all' (Show All) and 'Available' untouched — those keep the existing
// landing-page behavior — and only restrict the more specific selections
// (e.g. "Coming Soon", "Sold Out") to items that actually carry that status.
function childItemMatchesStatusFilter(record, statusFilter) {
    if (!statusFilter || statusFilter === 'all' || statusFilter === 'Available') return true;
    if (!record || !record.fields) return false;
    return record.fields[CONSTANTS.FIELD_NAMES.STATUS] === statusFilter;
}

// Is the catalog's beta "Sort by: Sentiment" mode active? Carousel ordering and
// within-carousel item ordering only switch to sentiment when this is selected;
// every other sort leaves the carousels exactly as they were.
function isSentimentSortActive() {
    const el = typeof document !== 'undefined' && document.getElementById('sort-by');
    return !!(el && el.value === 'sentiment');
}

// Order items by community (global) sentiment, most-loved first, breaking ties
// alphabetically by name — the same basis the catalog sort and the card chip use.
function sortItemsBySentiment(items) {
    const scoreById = new Map();
    items.forEach(it => scoreById.set(it.id, getCommunitySentimentScore(it).score));
    return [...items].sort((a, b) => {
        const diff = (scoreById.get(b.id) || 0) - (scoreById.get(a.id) || 0);
        if (diff !== 0) return diff;
        return (a.fields.Name || '').toLowerCase().localeCompare((b.fields.Name || '').toLowerCase());
    });
}

// A carousel's sentiment is the average community score of its child items, so the
// most-loved category floats to the top. Categories with no items score a neutral 0.
function getGroupingSentimentScore(grouping) {
    const children = getChildItemsForGrouping(grouping, state.records.all);
    if (!children.length) return 0;
    const sum = children.reduce((acc, child) => acc + getCommunitySentimentScore(child).score, 0);
    return sum / children.length;
}

function getChildItemsForGrouping(groupingRecord, allRecords) {
    const groupingNameForFilter = groupingRecord.fields.Name.toLowerCase().replace(/\s+/g, ' ');
    const statusFilter = getActiveCatalogStatusFilter();

    const results = allRecords.filter(r => {
        const itemType = r.fields['Item Type'];
        if (itemType !== 'Bookable Item' && itemType !== 'Event' && itemType !== 'Package') return false;
        if (!childItemMatchesStatusFilter(r, statusFilter)) return false;
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
                // Use the safe transformation helper to avoid double-transforming
                const placeholder = url.includes('cloudinary')
                    ? applyCloudinaryTransform(url, 'c_fill,w_50,q_30,f_auto,e_blur:300')
                    : url;
                const optimized = url.includes('cloudinary')
                    ? applyCloudinaryTransform(url, 'c_fill,w_300,q_auto,f_auto')
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

// Guards against overlapping catalog renders. Several unrelated triggers
// (initial load, community/Pusher data arriving, sort/filter changes) can call
// renderRecords nearly simultaneously, and because the render yields to the
// browser between chunks (requestIdleCallback/setTimeout), two invocations can
// interleave. When a carousel-mode render appends a `.grouping-carousel-section`
// while a grid-mode render is appending flat cards directly to the container,
// the CSS rule `#catalog-container:has(.grouping-carousel-section)` flips the
// container to flex-column and the grid cards stretch to full width. Each render
// claims the latest token; older in-flight renders detect they are stale at the
// next yield point and bail before mutating the DOM further, so only the newest
// render ever touches the container.
let activeRenderToken = 0;

export async function renderRecords(recordsToRender, imageCache, append = false) {
    console.log('[CATALOG DEBUG] renderRecords called.', {
        recordCount: recordsToRender?.length,
        append,
        hasImageCache: !!imageCache,
        catalogContainerExists: !!document.getElementById('catalog-container'),
        stateRecordsAll: state.records.all?.length,
        stateRecordsFiltered: state.records.filtered?.length,
        activeShopId: state.ui.activeShopId
    });
    log('UI', `renderRecords called. Attempting to render ${recordsToRender.length} records.`);

    const catalogContainer = document.getElementById('catalog-container');
    const loadingMessage = document.getElementById('loading-message');
    if (!catalogContainer) {
        console.error("UI ERROR: catalog-container element not found in the DOM!");
        return;
    }

    // Claim this render. Any render that starts after this point makes the
    // current one stale; we re-check at every yield point below and bail out
    // before appending more nodes, so renders never interleave in the DOM.
    const myRenderToken = ++activeRenderToken;
    const isStaleRender = () => myRenderToken !== activeRenderToken;

    // Set up delegated event listeners once for quantity buttons (avoids per-card listeners)
    if (!catalogContainer._delegatedListenersAttached) {
        catalogContainer._delegatedListenersAttached = true;

        catalogContainer.addEventListener('click', (e) => {
            const plusBtn = e.target.closest('.quantity-btn.plus');
            const minusBtn = e.target.closest('.quantity-btn.minus');

            if (plusBtn) {
                e.stopPropagation();
                e.preventDefault();
                const selector = plusBtn.closest('.quantity-selector');
                if (!selector) return;
                const input = selector.querySelector('.quantity-input');
                if (!input) return;
                const currentValue = parseFloat(input.value) || 1;
                input.value = parseFloat((currentValue + 1).toFixed(2));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (minusBtn) {
                e.stopPropagation();
                e.preventDefault();
                const selector = minusBtn.closest('.quantity-selector');
                if (!selector) return;
                const input = selector.querySelector('.quantity-input');
                if (!input) return;
                const currentValue = parseFloat(input.value) || 1;
                const minValue = parseFloat(input.min) || 1;
                if (currentValue > minValue) {
                    input.value = parseFloat((currentValue - 1).toFixed(2));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        });
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
    const nameFilterEl = document.getElementById('name-filter');
    const hasSearchFilter = state.ui.nameFilter || (nameFilterEl && nameFilterEl.value.trim().length > 0);
    const isFilteredView = hasSubcategoryFilter || hasViewFilter || hasSearchFilter;

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

    // Diagnostic: a grouping reaching the renderer in carousel mode expands its
    // children from the UNFILTERED state.records.all, which is the only way a
    // non-matching item can appear under a status filter. Surface that here.
    if (groupings.length > 0) {
        console.log('[CATALOG DEBUG] renderRecords layout chosen.', {
            layoutMode,
            groupingCount: groupings.length,
            groupingNames: groupings.map(g => g.fields && g.fields.Name),
            nonGroupingCount: nonGroupingRecords.length
        });
    }

    // Clear container for fresh render
    if (!append) {
        catalogContainer.innerHTML = '';
    }

    // If appending to existing carousel layout, add items to the ungrouped section
    if (layoutMode === 'append-to-ungrouped') {
        // Build a set of item IDs already shown in carousel sections to avoid duplicates
        const carouselSections = catalogContainer.querySelectorAll('.grouping-carousel-section');
        const carouselItemIds = new Set();
        carouselSections.forEach(section => {
            section.querySelectorAll('.event-card[data-record-id]').forEach(card => {
                carouselItemIds.add(card.dataset.recordId);
            });
        });

        // Filter out items already shown in carousels and any grouping records
        const itemsToAppend = recordsToRender.filter(r =>
            r.fields['Item Type'] !== 'Grouping' && !carouselItemIds.has(r.id)
        );

        if (itemsToAppend.length === 0) {
            // Nothing to append after filtering
        } else {
            // Find or create the ungrouped items section
            let ungroupedSection = existingUngroupedSection;
            if (!ungroupedSection) {
                ungroupedSection = document.createElement('div');
                ungroupedSection.className = 'ungrouped-items-section';
                ungroupedSection.style.display = 'grid';
                ungroupedSection.style.gridTemplateColumns = 'repeat(auto-fill, minmax(260px, 1fr))';
                ungroupedSection.style.gap = '25px';
                ungroupedSection.style.marginTop = '20px';
                console.log('[Catalog DEBUG] Ungrouped section grid created with minmax(260px, 1fr)');
                catalogContainer.appendChild(ungroupedSection);
            }

            const fragment = document.createDocumentFragment();
            const CHUNK_SIZE = 4;

            for (let i = 0; i < itemsToAppend.length; i += CHUNK_SIZE) {
                const chunk = itemsToAppend.slice(i, i + CHUNK_SIZE);
                const cardPromises = chunk.map(record => createInteractiveCard(record, state.records.all, imageCache));
                const cards = await Promise.all(cardPromises);
                if (isStaleRender()) return; // a newer render took over while awaiting

                cards.forEach(card => {
                    if (card) fragment.appendChild(card);
                });

                ungroupedSection.appendChild(fragment);
                fragment.textContent = '';

                addEnergy();
                updateProgress(0.00005 * chunk.length);

                if (i + CHUNK_SIZE < itemsToAppend.length) {
                    await new Promise(resolve => {
                        if (window.requestIdleCallback) {
                            requestIdleCallback(resolve, { timeout: 50 });
                        } else {
                            setTimeout(resolve, 0);
                        }
                    });
                    if (isStaleRender()) return;
                }
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
            if (isStaleRender()) return; // a newer render took over while awaiting

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
                if (isStaleRender()) return;
            }
        }
    } else {
        // Render groupings as horizontal carousel sections.
        // Carousel children honor the active status filter (see
        // getChildItemsForGrouping); groupings with no matching children are
        // skipped, so e.g. "Coming Soon"/"Sold Out" no longer surface every
        // category. Log the decision so this stays easy to verify.
        const activeStatusFilter = getActiveCatalogStatusFilter();
        // In the beta "Sort by: Sentiment" mode, reorder the carousels themselves so
        // the most-loved category floats to the top, and sort the items inside each
        // carousel by sentiment too. Every other sort leaves carousel order and
        // their item order exactly as before.
        const sentimentActive = isSentimentSortActive();
        // Precompute each carousel's aggregate sentiment once, so the comparator
        // below isn't re-scoring (and re-expanding children) on every comparison.
        const groupingScoreById = new Map();
        if (sentimentActive) {
            groupings.forEach(g => groupingScoreById.set(g.id, getGroupingSentimentScore(g)));
        }
        const orderedGroupings = sentimentActive
            ? [...groupings].sort((a, b) => {
                const diff = (groupingScoreById.get(b.id) || 0) - (groupingScoreById.get(a.id) || 0);
                if (diff !== 0) return diff;
                return (a.fields.Name || '').toLowerCase().localeCompare((b.fields.Name || '').toLowerCase());
            })
            : groupings;
        console.log('[STATUS FILTER] Rendering carousels with status filter.', {
            statusFilter: activeStatusFilter,
            sentimentSort: sentimentActive,
            groupingsBeforeSkip: groupings.length,
            groupingsWithMatches: groupings.filter(
                g => getChildItemsForGrouping(g, state.records.all).length > 0
            ).length
        });
        for (const grouping of orderedGroupings) {
            let childItems = getChildItemsForGrouping(grouping, state.records.all);
            if (sentimentActive) childItems = sortItemsBySentiment(childItems);
            if (childItems.length > 0) {
                const carouselSection = await createGroupingCarouselSection(grouping, childItems, state.records.all, imageCache);
                if (isStaleRender()) return; // a newer render took over while awaiting
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
                if (isStaleRender()) return;
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
            ungroupedSection.style.gridTemplateColumns = 'repeat(auto-fill, minmax(260px, 1fr))';
            ungroupedSection.style.gap = '25px';
            ungroupedSection.style.marginTop = '20px';

            const fragment = document.createDocumentFragment();
            const CHUNK_SIZE = 4;

            for (let i = 0; i < ungroupedItems.length; i += CHUNK_SIZE) {
                const chunk = ungroupedItems.slice(i, i + CHUNK_SIZE);
                const cardPromises = chunk.map(record => createInteractiveCard(record, state.records.all, imageCache));
                const cards = await Promise.all(cardPromises);
                if (isStaleRender()) return; // a newer render took over while awaiting

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

    // DEBUG: Log computed catalog grid styles
    requestAnimationFrame(() => {
        const container = document.getElementById('catalog-container');
        if (container) {
            const computed = window.getComputedStyle(container);
            console.log('[Catalog DEBUG] After render - computed grid:', {
                display: computed.display,
                gridTemplateColumns: computed.gridTemplateColumns,
                containerWidth: container.offsetWidth,
                parentWidth: container.parentElement?.offsetWidth,
                childCount: container.children.length
            });
        }
    });
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
    document.title = eventName || (shopName ? `${shopName} WTFun` : 'WTFun');
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

    log('UI', 'Updating event plan date display.');
    const dateInput = document.getElementById('event-date-picker');
    if (!dateInput) {
        console.log('[DEBUG updateEventPlanDateDisplay] WARNING: event-date-picker NOT found!');
        return;
    }
    const selectedDateISO = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    const selectedDateEndISO = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE_END);

    if (!selectedDateISO) {
        console.log('[DEBUG updateEventPlanDateDisplay] No date in state, setting placeholder');
        dateInput.value = '';
        dateInput.classList.remove('available-full', 'available-partial', 'unavailable');
        console.log('[DEBUG updateEventPlanDateDisplay] ========== END DATE DISPLAY UPDATE DEBUG ==========');
        return;
    }
    const selectedDate = new Date(selectedDateISO);

    const lockedItems = Array.from(state.cart.lockedItems.keys()).map(recordId => state.records.all.find(r => r.id === recordId)).filter(Boolean);
    const overallStatus = await getCombinedPlanStatus(selectedDate, lockedItems, {
        dateEnd: selectedDateEndISO ? new Date(selectedDateEndISO) : undefined,
        lockedItemsMap: state.cart.lockedItems
    });

    // Build display value — show start date (end date is computed from duration)
    const fmtOpts = { month: 'short', day: 'numeric', year: 'numeric' };
    let displayValue = selectedDate.toLocaleDateString('en-US', fmtOpts);

    // Update flatpickr instance date if it exists (single date mode)
    if (dateInput._flatpickr) {
        const currentDates = dateInput._flatpickr.selectedDates;
        const currentISO = currentDates.length > 0 ? currentDates[0].toISOString() : null;
        if (currentISO !== selectedDateISO) {
            dateInput._flatpickr.setDate(selectedDate, false);
        }
    } else {
        dateInput.value = displayValue;
    }

    console.log('[DEBUG updateEventPlanDateDisplay] Display value:', displayValue);
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
        link.href = `/?shop=${encodeURIComponent(storeSlug(record.fields.Name))}`;
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

export function showToast(message, duration = 5000, variant = 'success') {
    const toast = document.getElementById('toast-notification');
    if (toast) {
        // Remove any existing variant classes
        toast.classList.remove('toast-success', 'toast-error', 'toast-warning', 'toast-info');
        // Add the specified variant class
        toast.classList.add(`toast-${variant}`);
        toast.textContent = message;
        // Set appropriate aria-live for screen readers
        toast.setAttribute('role', variant === 'error' ? 'alert' : 'status');
        toast.setAttribute('aria-live', variant === 'error' ? 'assertive' : 'polite');
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
        const selectedDateEndISO = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE_END);
        const lockedItems = Array.from(state.cart.lockedItems.keys()).map(recordId => state.records.all.find(r => r.id === recordId)).filter(Boolean);
        const overallStatus = await getCombinedPlanStatus(selectedDate, lockedItems, {
            dateEnd: selectedDateEndISO ? new Date(selectedDateEndISO) : undefined,
            lockedItemsMap: state.cart.lockedItems
        });
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
