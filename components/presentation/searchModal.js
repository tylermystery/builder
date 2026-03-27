/**
 * Search Modal
 * Presentation search, results, quick add, dig-into refinement, and manual add.
 * Extracted from presentation.js — Phase 2 modularization.
 */

import { state, setState, getRecordById, invalidateRecordsIndex } from '../../state.js';
import * as api from '../../api.js';
import { CONSTANTS, getModalZIndex } from '../../config.js';
import { updateUrl, getRecordPrice, parseOptions, flattenOptionGroups } from '../../utils.js';
import { log } from '../../utils/debug.js';
import { showDetailModal } from '../modal.js';
import { updateEventPlanSection, updateIdeasCarousel } from '../sidebar.js';
import { syncPlanState } from '../../utils/planStateSync.js';
import { triggerSave } from '../../events.js';
import { applyCloudinaryTransform } from '../../utils/imageOptimizer.js';
import { showToast } from '../../ui.js';

// Module-level DOM element references
let presentationAddBtn = null;
let presentationToggleAllBtn = null;
let presentationSearchModal = null;
let presentationSearchClose = null;
let presentationSearchInput = null;
let presentationSearchClear = null;
let presentationSearchResults = null;
let presentationRefinementChips = null;
let presentationBrowseCategories = null;

// Search modal state
let presentationSearchController = null;
let presentationSearchDebounceTimer = null;
const PRESENTATION_SEARCH_DEBOUNCE = 300;

// Dependencies injected via init()
let _toggleAllItemAccordions = null;
let _toggleArchivedItems = null;
let _toggleCompletedItems = null;
let _renderAllItems = null;

/**
 * Initialize the search modal module.
 * @param {Object} deps
 * @param {Object} deps.elements - DOM element references for the search modal
 * @param {Function} deps.toggleAllItemAccordions - Accordion toggle-all function
 * @param {Function} deps.toggleArchivedItems - Toggle archived items visibility
 * @param {Function} deps.toggleCompletedItems - Toggle completed items visibility
 * @param {Function} deps.renderAllItems - Re-renders all items in presentation view
 */
export function init(deps) {
    // Cache DOM elements
    presentationAddBtn = deps.elements.presentationAddBtn;
    presentationToggleAllBtn = deps.elements.presentationToggleAllBtn;
    presentationSearchModal = deps.elements.presentationSearchModal;
    presentationSearchClose = deps.elements.presentationSearchClose;
    presentationSearchInput = deps.elements.presentationSearchInput;
    presentationSearchClear = deps.elements.presentationSearchClear;
    presentationSearchResults = deps.elements.presentationSearchResults;
    presentationRefinementChips = deps.elements.presentationRefinementChips;
    presentationBrowseCategories = deps.elements.presentationBrowseCategories;

    // Store dependency functions
    _toggleAllItemAccordions = deps.toggleAllItemAccordions;
    _toggleArchivedItems = deps.toggleArchivedItems;
    _toggleCompletedItems = deps.toggleCompletedItems;
    _renderAllItems = deps.renderAllItems;
}

/**
 * Cleanup module state.
 */
export function cleanup() {
    closeSearchModal();
    presentationAddBtn = null;
    presentationToggleAllBtn = null;
    presentationSearchModal = null;
    presentationSearchClose = null;
    presentationSearchInput = null;
    presentationSearchClear = null;
    presentationSearchResults = null;
    presentationRefinementChips = null;
    presentationBrowseCategories = null;
    presentationSearchController = null;
    presentationSearchDebounceTimer = null;
}

/**
 * Sets up event listeners for the search modal
 */
export function setupSearchModalEventListeners() {
    // Add button opens search modal
    if (presentationAddBtn) {
        presentationAddBtn.addEventListener('click', openSearchModal);
    }

    // Toggle all button collapses/expands all item accordions
    if (presentationToggleAllBtn) {
        presentationToggleAllBtn.addEventListener('click', _toggleAllItemAccordions);
    }

    // Toggle archived items button
    const archivedToggle = document.getElementById('presentation-toggle-archived');
    if (archivedToggle) {
        archivedToggle.addEventListener('click', _toggleArchivedItems);
    }

    // Toggle completed items button
    const completedToggle = document.getElementById('presentation-toggle-completed');
    if (completedToggle) {
        completedToggle.addEventListener('click', _toggleCompletedItems);
    }

    // Close button
    if (presentationSearchClose) {
        presentationSearchClose.addEventListener('click', closeSearchModal);
    }

    // Close on backdrop click
    if (presentationSearchModal) {
        presentationSearchModal.addEventListener('click', (e) => {
            if (e.target === presentationSearchModal) {
                closeSearchModal();
            }
        });
    }

    // Search input handler
    if (presentationSearchInput) {
        presentationSearchInput.addEventListener('input', handleSearchInput);
        presentationSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeSearchModal();
            }
        });
    }

    // Clear search button
    if (presentationSearchClear) {
        presentationSearchClear.addEventListener('click', () => {
            presentationSearchInput.value = '';
            presentationSearchClear.style.display = 'none';
            showInitialSearchState();
            clearPresentationRefinementChips();
        });
    }

    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && presentationSearchModal?.classList.contains('active')) {
            closeSearchModal();
        }
    });
}

/**
 * Opens the search modal
 */
export function openSearchModal() {
    if (!presentationSearchModal) return;

    presentationSearchModal.classList.add('active');
    document.body.classList.add('search-modal-open');

    // Focus search input
    setTimeout(() => {
        presentationSearchInput?.focus();
    }, 100);

    // Initialize with browse categories
    showInitialSearchState();

    log('Presentation', 'Search modal opened');
}

/**
 * Closes the search modal
 */
export function closeSearchModal() {
    if (!presentationSearchModal) return;

    presentationSearchModal.classList.remove('active');
    document.body.classList.remove('search-modal-open');

    // Cancel any pending search
    if (presentationSearchController) {
        presentationSearchController.abort();
        presentationSearchController = null;
    }

    // Clear search state
    if (presentationSearchInput) {
        presentationSearchInput.value = '';
    }
    if (presentationSearchClear) {
        presentationSearchClear.style.display = 'none';
    }
    clearPresentationRefinementChips();

    log('Presentation', 'Search modal closed');
}

/**
 * Shows the initial search state with browse categories
 */
function showInitialSearchState() {
    if (!presentationSearchResults || !presentationBrowseCategories) return;

    // Get unique categories from catalog
    const categories = new Set();
    state.records.all.forEach(record => {
        if (record.fields.Category) {
            categories.add(record.fields.Category);
        }
    });

    // Build category buttons
    presentationBrowseCategories.innerHTML = '';
    categories.forEach(category => {
        const btn = document.createElement('button');
        btn.className = 'presentation-category-btn';
        btn.textContent = category;
        btn.addEventListener('click', () => {
            presentationSearchInput.value = category;
            handleSearchInput({ target: presentationSearchInput });
        });
        presentationBrowseCategories.appendChild(btn);
    });

    // Show initial state
    presentationSearchResults.innerHTML = `
        <div class="presentation-search-initial">
            <p class="presentation-search-hint">Search for something specific, or browse popular categories below</p>
            <div class="presentation-browse-categories" id="presentation-browse-categories-inner">
                ${presentationBrowseCategories.innerHTML}
            </div>
        </div>
    `;
}

/**
 * Handles search input changes with debouncing
 */
function handleSearchInput(e) {
    const searchTerm = e.target.value.trim();

    // Show/hide clear button
    if (presentationSearchClear) {
        presentationSearchClear.style.display = searchTerm ? 'flex' : 'none';
    }

    // Clear previous debounce timer
    if (presentationSearchDebounceTimer) {
        clearTimeout(presentationSearchDebounceTimer);
    }

    // If search is cleared, show initial state
    if (!searchTerm) {
        showInitialSearchState();
        clearPresentationRefinementChips();
        return;
    }

    // Debounce the search
    presentationSearchDebounceTimer = setTimeout(() => {
        performPresentationSearch(searchTerm);
    }, PRESENTATION_SEARCH_DEBOUNCE);
}

/**
 * Performs the hybrid search (catalog + AI)
 */
async function performPresentationSearch(searchTerm) {
    if (!presentationSearchResults) return;

    // Abort any existing search
    if (presentationSearchController) {
        presentationSearchController.abort();
    }
    presentationSearchController = new AbortController();
    const signal = presentationSearchController.signal;

    log('Presentation', `Performing search for: "${searchTerm}"`);

    // Filter catalog items
    const searchLower = searchTerm.toLowerCase();
    const catalogMatches = state.records.all.filter(record => {
        const name = (record.fields.Name || '').toLowerCase();
        const description = (record.fields.Description || '').toLowerCase();
        const category = (record.fields.Category || '').toLowerCase();
        const tags = (record.fields.Tags || []).join(' ').toLowerCase();

        return name.includes(searchLower) ||
               description.includes(searchLower) ||
               category.includes(searchLower) ||
               tags.includes(searchLower);
    }).slice(0, 15); // Limit to 15 catalog matches

    // Clear results and show catalog results first
    presentationSearchResults.innerHTML = '';

    if (catalogMatches.length > 0) {
        const catalogSection = await createPresentationResultSection(
            `Catalog Matches`,
            'From our curated catalog',
            catalogMatches,
            false
        );
        presentationSearchResults.appendChild(catalogSection);
    }

    // Show AI loading section
    const aiLoadingSection = document.createElement('div');
    aiLoadingSection.className = 'presentation-search-loading';
    aiLoadingSection.innerHTML = `
        <div class="presentation-search-spinner"></div>
        <span class="presentation-search-loading-text">Finding more options with AI...</span>
    `;
    presentationSearchResults.appendChild(aiLoadingSection);

    // Show manual add option immediately — don't wait for AI results
    const manualAddSection = createPresentationManualAddOption(searchTerm);
    presentationSearchResults.appendChild(manualAddSection);

    // Fetch AI results asynchronously — insert results before manual add section when ready
    try {
        const response = await fetch('/.netlify/functions/process-weblink', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: searchTerm }),
            signal: signal
        });

        if (!response.ok) {
            throw new Error(`API returned status ${response.status}`);
        }

        if (signal.aborted) return;

        const aiData = await response.json();
        log('Presentation', 'AI Search Response:', aiData);

        // Remove loading indicator
        aiLoadingSection.remove();

        // Handle relatedKeywords for refinement chips
        if (aiData.relatedKeywords && Array.isArray(aiData.relatedKeywords)) {
            renderPresentationRefinementChips(aiData.relatedKeywords);
        }

        // Create AI records from the response
        const aiRecords = [];
        const timestamp = Date.now();

        /**
         * Helper function to build a comprehensive AI record with all business details
         * Matches the format used in events.js for catalog search AI results
         */
        const buildAIRecord = (source, recordId, searchTermForTags) => {
            // Build comprehensive Rankings JSON with AI profile scores
            const rankingsData = {
                "profileSource": "ai_presentation_search",
                "Tags": [searchTermForTags.toLowerCase(), "ai-generated", "partner activity"]
            };
            // Add activity profile scores if provided by AI
            const sourceRankings = source.Rankings || source.rankings;
            if (sourceRankings && typeof sourceRankings === 'object') {
                rankingsData.Fun = sourceRankings.Fun || 0;
                rankingsData.Social = sourceRankings.Social || 0;
                rankingsData.Active = sourceRankings.Active || 0;
                rankingsData.Creative = sourceRankings.Creative || 0;
                rankingsData.Learning = sourceRankings.Learning || 0;
                rankingsData.Relaxing = sourceRankings.Relaxing || 0;
            }

            // Build location details with availability and address
            let locationDetails = '';
            const location = source.Location || source.location || source.Address || source.address || '';
            const availability = source.Availability || source.availability || source.Hours || source.hours || source.OperatingHours || '';
            const phone = source.Phone || source.phone || '';
            const email = source.Email || source.email || '';

            if (location) locationDetails += location;
            if (availability) {
                locationDetails += locationDetails ? '\n\n' : '';
                locationDetails += `Hours: ${availability}`;
            }
            if (phone) {
                locationDetails += locationDetails ? '\n\n' : '';
                locationDetails += `Phone: ${phone}`;
            }
            if (email) {
                locationDetails += locationDetails ? '\n\n' : '';
                locationDetails += `Email: ${email}`;
            }

            // Build "Good to Know" / Additional Information with lead time, website, and extra info
            let additionalInfo = '';
            const leadTime = source.LeadTime || source.leadTime || '';
            const goodToKnow = source.GoodToKnow || source.goodToKnow || '';
            const website = source.Website || source.website || '';
            const duration = source.Duration || source.duration || '';
            const capacity = source.Capacity || source.capacity || '';

            if (leadTime) additionalInfo += `Booking: ${leadTime}`;
            if (duration) {
                additionalInfo += additionalInfo ? '\n\n' : '';
                additionalInfo += `Duration: ${duration}`;
            }
            if (capacity) {
                additionalInfo += additionalInfo ? '\n\n' : '';
                additionalInfo += `Capacity: ${capacity}`;
            }
            if (goodToKnow) {
                additionalInfo += additionalInfo ? '\n\n' : '';
                additionalInfo += goodToKnow;
            }
            if (website) {
                additionalInfo += additionalInfo ? '\n\n' : '';
                additionalInfo += `Website: ${website}`;
            }

            // Ensure price is a number - handle all edge cases including objects/arrays
            let price = source.Price || source.price || 0;
            if (typeof price === 'object') {
                // Handle cases where price might be an object or array
                price = 0;
            } else if (typeof price === 'string') {
                price = parseFloat(price.replace(/[^0-9.-]/g, '')) || 0;
            } else if (typeof price !== 'number') {
                price = 0;
            }
            // Ensure we have a valid number
            price = isNaN(price) ? 0 : price;

            return {
                id: recordId,
                fields: {
                    Name: source.Name || source.name || 'AI Suggestion',
                    Description: source.Description || source.description || '',
                    Price: price,
                    Category: source.Category || source.category || searchTermForTags,
                    'Image URL': source.imageUrl || source['Image URL'] || '',
                    ServiceType: source.ServiceType || 'Partner Activity',
                    'Item Type': 'Bookable Item',
                    Status: 'Available',
                    'Pricing Type': source.PricingType || source.pricingType || 'flat rate',
                    // Business details for modal display
                    Duration: duration || null,
                    Capacity: capacity || null,
                    'Location Details': locationDetails || null,
                    'Additional Information': additionalInfo || null,
                    // Rankings as JSON string (required by modal.js parsing)
                    Rankings: JSON.stringify(rankingsData),
                    // Keep raw fields for backwards compatibility
                    Location: location,
                    Availability: availability,
                    Website: website,
                    LeadTime: leadTime,
                    GoodToKnow: goodToKnow,
                    Phone: phone,
                    Email: email,
                    Hours: availability,
                    // AI confidence score (0.0-1.0)
                    '_aiConfidence': source.Confidence || source.confidence || null,
                    // Store website URL for image scraping (to match events.js structure)
                    '_aiWebsite': website || null,
                    // Null fields to match events.js structure
                    Options: null, 'Parent Item': null, 'Headcount min': null,
                    'Media Tags': source.ImageKeywords || source.imageKeywords || null,
                    'Curated Images': null, Subcategories: null,
                    'iCal URL': null, 'Lead Time (days)': null, RSVPs: null, Date: null,
                    'Chat Enabled': false
                },
                isAI: true
            };
        };

        if (aiData.itemType === 'Grouping' && aiData.children && Array.isArray(aiData.children)) {
            aiData.children.forEach((child, index) => {
                const childId = `ai-presentation-${timestamp}-${index}`;
                const record = buildAIRecord(child, childId, searchTerm);
                console.log('[DEBUG Presentation] Built AI record from grouping child:', {
                    id: record.id,
                    name: record.fields?.Name,
                    isAI: record.isAI,
                    _aiConfidence: record.fields?._aiConfidence,
                    sourceConfidence: child.Confidence || child.confidence
                });
                aiRecords.push(record);
            });
        } else if (aiData.Name || aiData.name) {
            // Single AI result
            const record = buildAIRecord(aiData, `ai-presentation-${timestamp}-0`, searchTerm);
            console.log('[DEBUG Presentation] Built single AI record:', {
                id: record.id,
                name: record.fields?.Name,
                isAI: record.isAI,
                _aiConfidence: record.fields?._aiConfidence,
                sourceConfidence: aiData.Confidence || aiData.confidence
            });
            aiRecords.push(record);
        }

        // Display AI results — insert before the manual add section
        if (aiRecords.length > 0) {
            const aiSection = await createPresentationResultSection(
                'AI Discoveries',
                `Suggested options for "${searchTerm}"`,
                aiRecords,
                true
            );
            presentationSearchResults.insertBefore(aiSection, manualAddSection);
        }

        // Show no results message if nothing found (insert before manual add section)
        if (catalogMatches.length === 0 && aiRecords.length === 0) {
            const noResultsDiv = document.createElement('div');
            noResultsDiv.className = 'presentation-no-results';
            noResultsDiv.innerHTML = `
                <div class="presentation-no-results-icon">🔍</div>
                <p class="presentation-no-results-text">No results found for "${searchTerm}"</p>
                <p class="presentation-no-results-hint">Try a different search term, browse categories, or add a custom item below</p>
            `;
            presentationSearchResults.insertBefore(noResultsDiv, manualAddSection);
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            log('Presentation', 'Search was aborted');
            return;
        }

        log('Presentation', `AI search error: ${error.message}`);
        aiLoadingSection.remove();

        // Show error state if no catalog matches either (insert before manual add section)
        if (catalogMatches.length === 0) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'presentation-no-results';
            errorDiv.innerHTML = `
                <div class="presentation-no-results-icon">⚠️</div>
                <p class="presentation-no-results-text">Search encountered an issue</p>
                <p class="presentation-no-results-hint">Please try again, browse categories, or add a custom item below</p>
            `;
            presentationSearchResults.insertBefore(errorDiv, manualAddSection);
        }
    }
}

/**
 * Creates a manual add item section for the presentation search modal
 * Allows users to add a custom item with the search term as the default name
 * @param {string} searchTerm - The search term to use as default item name
 * @returns {HTMLElement} The manual add section element
 */
function createPresentationManualAddOption(searchTerm) {
    const section = document.createElement('div');
    section.className = 'presentation-manual-add-section';
    section.innerHTML = `
        <div class="presentation-manual-add-header">
            <span class="presentation-manual-add-icon">+</span>
            <span class="presentation-manual-add-title">Can't find what you're looking for?</span>
        </div>
        <div class="presentation-manual-add-content">
            <p class="presentation-manual-add-description">Add a custom item to your plan:</p>
            <div class="presentation-manual-add-form">
                <input type="text" class="presentation-manual-add-input" value="${searchTerm.replace(/"/g, '&quot;')}" placeholder="Item name">
                <button class="presentation-manual-add-btn">Add to Plan</button>
            </div>
        </div>
    `;

    // Attach click handler for the add button
    const addBtn = section.querySelector('.presentation-manual-add-btn');
    const nameInput = section.querySelector('.presentation-manual-add-input');

    addBtn.addEventListener('click', async () => {
        const itemName = nameInput.value.trim();
        if (!itemName) {
            nameInput.focus();
            return;
        }

        addBtn.disabled = true;
        addBtn.textContent = 'Adding...';

        try {
            // Create a manual item record
            const timestamp = Date.now();
            const manualId = `manual-presentation-${timestamp}`;

            const manualRecord = {
                id: manualId,
                fields: {
                    Name: itemName,
                    Description: `Manually added item from presentation search: "${searchTerm}"`,
                    Price: 0,
                    ServiceType: 'Custom Item',
                    'Item Type': 'Bookable Item',
                    Status: 'Available',
                    'Pricing Type': 'flat rate',
                    Stores: [state.ui.activeShopId],
                    Rankings: JSON.stringify({
                        "profileSource": "manual_presentation_add",
                        "Tags": [searchTerm.toLowerCase(), "manual-add", "custom"]
                    }),
                    'Location Details': null,
                    'Additional Information': null,
                    Options: null,
                    'Parent Item': null,
                    'Headcount min': null,
                    'Media Tags': null,
                    'Curated Images': null,
                    Subcategories: null,
                    'iCal URL': null,
                    'Lead Time (days)': null,
                    RSVPs: null,
                    Date: null,
                    'Chat Enabled': false,
                    Duration: null,
                    Capacity: null
                },
                isManual: true
            };

            // Add to records
            state.records.all.push(manualRecord);
            invalidateRecordsIndex();
            // Add to plan (cart.items as idea first)
            state.cart.items.set(manualId, {
                quantity: 1,
                selectedOptionIndex: 0,
                selections: {},
                note: `Manually added from presentation search: "${searchTerm}"`
            });

            // Trigger save to persist changes
            await triggerSave();

            // Update the presentation view items list
            await _renderAllItems();

            // Update the catalog view's event plan panel
            await updateEventPlanSection();

            // Sync plan state across all views
            syncPlanState('presentation', 'itemAdded', { recordId: manualId, itemName: itemName });

            // Update button state
            addBtn.textContent = 'Added!';
            addBtn.classList.add('added');
            nameInput.disabled = true;

            log('Presentation', `Manually added item: ${manualId} - "${itemName}"`);

        } catch (error) {
            log('Presentation', `Error adding manual item: ${error.message}`);
            addBtn.disabled = false;
            addBtn.textContent = 'Add to Plan';
        }
    });

    // Allow Enter key to submit
    nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addBtn.click();
        }
    });

    return section;
}

/**
 * Creates a result section with carousel
 */
async function createPresentationResultSection(title, subtitle, records, isAI = false) {
    console.log('[DEBUG Presentation] createPresentationResultSection called:', {
        title,
        isAI,
        recordCount: records.length,
        recordIds: records.map(r => r.id),
        recordsHaveIsAI: records.map(r => ({ id: r.id, isAI: r.isAI, confidence: r.fields?._aiConfidence }))
    });

    const section = document.createElement('div');
    section.className = `presentation-result-section${isAI ? ' ai-section' : ''}`;

    // Header
    const header = document.createElement('div');
    header.className = 'presentation-result-header';
    header.innerHTML = `
        <h4 class="presentation-result-title">${title}</h4>
        ${isAI ? '<span class="presentation-ai-badge">AI Discovery</span>' : ''}
        <span class="presentation-result-count">${records.length} items</span>
        ${subtitle ? `<p class="presentation-result-subtitle">${subtitle}</p>` : ''}
    `;
    section.appendChild(header);

    // Carousel wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'presentation-results-carousel-wrapper';

    // Carousel container
    const carousel = document.createElement('div');
    carousel.className = 'presentation-results-carousel';

    // Create cards for each record (await since image fetching is async)
    for (const record of records) {
        console.log('[DEBUG Presentation] Creating card for record:', { id: record.id, isAI_param: isAI, record_isAI: record.isAI });
        const card = await createPresentationResultCard(record, isAI);
        carousel.appendChild(card);
    }

    wrapper.appendChild(carousel);

    // Navigation buttons
    const leftNav = document.createElement('button');
    leftNav.className = 'presentation-carousel-nav left';
    leftNav.innerHTML = '◄';
    leftNav.setAttribute('aria-label', 'Scroll left');
    leftNav.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardWidth = carousel.querySelector('.presentation-result-card')?.offsetWidth || 240;
        carousel.scrollBy({ left: -(cardWidth + 16), behavior: 'smooth' });
    });

    const rightNav = document.createElement('button');
    rightNav.className = 'presentation-carousel-nav right';
    rightNav.innerHTML = '►';
    rightNav.setAttribute('aria-label', 'Scroll right');
    rightNav.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardWidth = carousel.querySelector('.presentation-result-card')?.offsetWidth || 240;
        carousel.scrollBy({ left: cardWidth + 16, behavior: 'smooth' });
    });

    wrapper.appendChild(leftNav);
    wrapper.appendChild(rightNav);

    // Update nav visibility based on scroll
    const updateNavVisibility = () => {
        const hasOverflow = carousel.scrollWidth > carousel.clientWidth;
        if (hasOverflow) {
            wrapper.classList.add('has-overflow');
            leftNav.style.opacity = carousel.scrollLeft <= 0 ? '0.3' : '';
            leftNav.style.pointerEvents = carousel.scrollLeft <= 0 ? 'none' : '';
            const atEnd = carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 5;
            rightNav.style.opacity = atEnd ? '0.3' : '';
            rightNav.style.pointerEvents = atEnd ? 'none' : '';
        } else {
            wrapper.classList.remove('has-overflow');
        }
    };

    carousel.addEventListener('scroll', updateNavVisibility);
    setTimeout(updateNavVisibility, 100);

    section.appendChild(wrapper);
    return section;
}

/**
 * Creates a single result card
 */
async function createPresentationResultCard(record, isAI = false) {
    console.log('[DEBUG Presentation] createPresentationResultCard called:', {
        recordId: record.id,
        recordName: record.fields?.Name,
        isAI_param: isAI,
        record_isAI: record.isAI,
        fields_aiConfidence: record.fields?._aiConfidence,
        record_aiConfidence: record._aiConfidence,
        researchData: record._researchData
    });

    const card = document.createElement('div');
    card.className = 'presentation-result-card';
    card.dataset.recordId = record.id;
    if (isAI) {
        card.dataset.isAi = 'true';
    }

    const fields = record.fields;

    // Get confidence level for AI items, solution items, and manual items (0.0-1.0)
    // Check multiple possible sources for confidence data
    const isSolutionItem = record.isSolution === true || record.id?.startsWith('solution-');
    const isManualItem = record.isManual === true ||
                         record.id?.startsWith('manual-add-') ||
                         record.id?.startsWith('manual-presentation-');
    const needsConfidenceStyling = isAI || isSolutionItem || isManualItem;

    let confidence;
    if (needsConfidenceStyling) {
        if (record._researchData?.confidence != null) {
            confidence = record._researchData.confidence;
        } else if (isAI) {
            confidence = record._aiConfidence ?? fields._aiConfidence ?? null;
        } else if (isSolutionItem && record.solutionData?.confidence) {
            const solutionConfidenceMap = { high: 0.85, medium: 0.6, low: 0.35 };
            confidence = solutionConfidenceMap[record.solutionData.confidence] ?? 0.6;
        } else if (isManualItem) {
            confidence = 0.5; // Manual items default to 50% (pen/approximated)
        } else {
            confidence = null;
        }
    } else {
        confidence = null;
    }

    console.log('[DEBUG Presentation] Confidence resolved for', record.id, ':', {
        confidence,
        confidenceType: typeof confidence,
        isAI,
        isSolutionItem,
        isManualItem,
        needsConfidenceStyling,
        confidenceSource: record._researchData?.confidence != null ? 'researchData' :
                         isAI ? 'aiConfidence' :
                         (isSolutionItem && record.solutionData?.confidence) ? 'solutionData' :
                         isManualItem ? 'manualDefault(0.5)' : 'null/not-styled',
        'record.isManual': record.isManual,
        'record.isSolution': record.isSolution
    });

    // Determine confidence class based on score:
    // < 50%: pencil (sketchy, draft-like)
    // 50-75%: pen (handwritten but cleaner)
    // 75-95%: typed (clean, professional)
    // 95-100%: premium (elegant typography)
    let confidenceClass = '';
    let confidenceLabel = '';
    let confidenceIndicatorClass = '';

    if (needsConfidenceStyling) {
        if (confidence === null || confidence === undefined) {
            // Unknown confidence - show as pencil (draft)
            confidenceClass = 'confidence-pencil';
            confidenceLabel = 'Draft';
            confidenceIndicatorClass = 'pencil';
        } else if (confidence < 0.5) {
            confidenceClass = 'confidence-pencil';
            confidenceLabel = `~${Math.round(confidence * 100)}%`;
            confidenceIndicatorClass = 'pencil';
        } else if (confidence < 0.75) {
            confidenceClass = 'confidence-pen';
            confidenceLabel = `~${Math.round(confidence * 100)}%`;
            confidenceIndicatorClass = 'pen';
        } else if (confidence < 0.95) {
            confidenceClass = 'confidence-typed';
            confidenceLabel = `${Math.round(confidence * 100)}%`;
            confidenceIndicatorClass = 'typed';
        } else {
            confidenceClass = 'confidence-premium';
            confidenceLabel = `${Math.round(confidence * 100)}%`;
            confidenceIndicatorClass = 'premium';
        }
        card.classList.add(confidenceClass);
        console.log('[DEBUG Presentation] Applied confidence class to card:', {
            recordId: record.id,
            confidenceClass,
            confidenceLabel,
            confidenceIndicatorClass,
            cardClassList: card.className
        });
    }

    // Fetch image using the multi-tier approach (website scraping, logo, etc.)
    let imageUrl = '';
    let imageSource = null; // Track where the image came from for AI indicator
    try {
        console.log('[AI IMAGE DEBUG] About to fetch images for record:', {
            recordId: record.id,
            isAI: isAI,
            recordFields: Object.keys(record.fields || {})
        });
        const { imageUrls, status } = await api.fetchImagesForRecord(record, state.records.all, new Map());
        console.log('[AI IMAGE DEBUG] fetchImagesForRecord returned:', {
            recordId: record.id,
            imageUrlsCount: imageUrls?.length,
            status: status,
            firstImageUrl: imageUrls?.[0]?.substring(0, 80)
        });
        if (imageUrls && imageUrls.length > 0) {
            imageUrl = imageUrls[0];
            imageSource = status; // 'ai_approximation', 'placeholder', 'website', 'curated', 'media_tags', etc.
        }
    } catch (e) {
        console.warn('Failed to fetch image for presentation card:', record.id, e);
    }

    // ============================================================
    // AUTO AI IMAGE GENERATION: For AI discovery items with only placeholder/approximation images
    // ============================================================
    if (!window._aiImageGenerationAttempted) {
        window._aiImageGenerationAttempted = new Set();
    }
    if (!window._aiImageGenerationInProgress) {
        window._aiImageGenerationInProgress = new Set();
    }
    // Limit concurrent AI image generations to avoid overwhelming the API
    if (!window._aiImageGenerationQueue) {
        window._aiImageGenerationQueue = [];
        window._aiImageGenerationActive = 0;
    }
    const MAX_CONCURRENT_AI_IMAGES = 2;

    const isAIDiscoveryItem = record.id?.startsWith('ai-search-') ||
                               record.id?.startsWith('ai-child-') ||
                               record.id?.startsWith('ai-presentation-');
    const hasOnlyPlaceholderImage = imageSource === 'ai_approximation' || imageSource === 'placeholder' || imageSource === 'using_placeholder';
    const hasNoCustomImagesForGen = !record.fields?._customImages || record.fields._customImages.length === 0;
    const genAlreadyAttempted = window._aiImageGenerationAttempted.has(record.id);
    const genInProgress = window._aiImageGenerationInProgress.has(record.id);

    if (isAIDiscoveryItem && hasOnlyPlaceholderImage && hasNoCustomImagesForGen && !genAlreadyAttempted && !genInProgress) {
        console.log('[AI IMAGE AUTO-GEN PRES] Queuing background AI image generation for:', record.fields?.Name);
        console.log('[AI IMAGE AUTO-GEN PRES] Conditions met:', {
            isAIDiscoveryItem,
            hasOnlyPlaceholderImage,
            imageSource,
            hasNoCustomImagesForGen,
            genAlreadyAttempted,
            genInProgress,
            currentActive: window._aiImageGenerationActive,
            queueLength: window._aiImageGenerationQueue?.length || 0,
        });
        window._aiImageGenerationInProgress.add(record.id);

        const generateForCard = async () => {
            window._aiImageGenerationActive++;
            try {
                const genPayload = {
                    name: record.fields?.Name || 'Unnamed Item',
                    description: record.fields?.Description || '',
                    category: record.fields?.Category || '',
                    serviceType: record.fields?.ServiceType || record.fields?.['Service Type'] || '',
                    tags: record.fields?.['Media Tags'] || '',
                    itemId: record.id,
                    sessionId: state.session?.id || 'unsaved'
                };

                console.log('[AI IMAGE AUTO-GEN PRES] Sending request for:', record.fields?.Name);
                console.log('[AI IMAGE AUTO-GEN PRES] Payload:', JSON.stringify(genPayload));
                const _fetchStart = Date.now();

                const aiResp = await fetch('/.netlify/functions/generate-ai-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(genPayload)
                });
                const _fetchElapsed = Date.now() - _fetchStart;

                console.log('[AI IMAGE AUTO-GEN PRES] Response received in', _fetchElapsed, 'ms');
                console.log('[AI IMAGE AUTO-GEN PRES] Status:', aiResp.status, 'ok:', aiResp.ok);

                if (aiResp.ok) {
                    const aiResult = await aiResp.json();
                    console.log('[AI IMAGE AUTO-GEN PRES] Response JSON:', JSON.stringify({
                        success: aiResult.success,
                        hasImageUrl: !!aiResult.imageUrl,
                        imageUrlPrefix: aiResult.imageUrl?.substring(0, 60),
                        _aiProvider: aiResult._aiProvider,
                        error: aiResult.error,
                    }));
                    if (aiResult.success && aiResult.imageUrl) {
                        // Store the AI image in the record so it persists
                        const aiGenImage = { url: aiResult.imageUrl, isAIGenerated: true, prompt: aiResult.prompt };
                        record.fields._customImages = [aiGenImage];
                        record.fields._hasAIGeneratedImage = true;

                        // Update state records as well
                        const stateRec = getRecordById(record.id);
                        if (stateRec) {
                            stateRec.fields._customImages = [aiGenImage];
                            stateRec.fields._hasAIGeneratedImage = true;
                        }

                        // Trigger save to persist
                        triggerSave();

                        // Update the card image in the DOM
                        const cardImageEl = card.querySelector('.presentation-result-card-image');
                        if (cardImageEl) {
                            cardImageEl.style.backgroundImage = `url('${aiResult.imageUrl}')`;
                            // Update the AI source indicator badge
                            const existingBadge = cardImageEl.querySelector('.ai-image-source');
                            if (existingBadge) {
                                existingBadge.textContent = 'AI Generated';
                                existingBadge.title = 'This image was automatically generated by AI based on the item details';
                                existingBadge.className = 'ai-image-source approximation';
                            } else {
                                const newBadge = document.createElement('span');
                                newBadge.className = 'ai-image-source approximation';
                                newBadge.textContent = 'AI Generated';
                                newBadge.title = 'This image was automatically generated by AI based on the item details';
                                cardImageEl.appendChild(newBadge);
                            }
                        }

                        console.log('[AI IMAGE AUTO-GEN PRES] SUCCESS - Updated card with AI image:', aiResult.imageUrl);
                    } else {
                        window._aiImageGenerationAttempted.add(record.id);
                    }
                } else {
                    const errorBody = await aiResp.text();
                    window._aiImageGenerationAttempted.add(record.id);
                    console.warn('[AI IMAGE AUTO-GEN PRES] FAILED for:', record.fields?.Name);
                    console.warn('[AI IMAGE AUTO-GEN PRES] Status:', aiResp.status, 'Body:', errorBody.substring(0, 500));
                }
            } catch (err) {
                window._aiImageGenerationAttempted.add(record.id);
                console.warn('[AI IMAGE AUTO-GEN PRES] EXCEPTION:', err.message);
            } finally {
                window._aiImageGenerationInProgress.delete(record.id);
                window._aiImageGenerationActive--;
                // Process next item in queue
                if (window._aiImageGenerationQueue.length > 0) {
                    const next = window._aiImageGenerationQueue.shift();
                    next();
                }
            }
        };

        // Throttle: only run MAX_CONCURRENT_AI_IMAGES at once, queue the rest
        if (window._aiImageGenerationActive < MAX_CONCURRENT_AI_IMAGES) {
            generateForCard();
        } else {
            window._aiImageGenerationQueue.push(generateForCard);
        }
    }

    const name = fields.Name || 'Unnamed Item';
    // Use centralized getRecordPrice for consistent price handling across all views
    const price = getRecordPrice(record);
    const category = fields.Category || '';

    // Check if already in plan (check cart.items, cart.lockedItems, and likedItemIds)
    const isInPlan = state.cart.lockedItems.has(record.id) ||
                     state.cart.items.has(record.id) ||
                     state.session.user.likedItemIds.has(record.id);

    // Check if item has been researched (has research data with confidence)
    const hasBeenResearched = record._researchData?.confidence != null;

    // Build AI image source indicator for AI items
    let aiImageSourceHtml = '';
    // Show AI image indicator for AI records or for manual items with AI-generated images
    const hasAIGeneratedImage = record.fields?._customImages?.some(img => img.isAIGenerated === true);

    if (isAI || (isManualItem && hasAIGeneratedImage)) {
        const isAIGenerated = imageSource === 'ai_generated' || imageSource === 'mixed_ai_custom' || hasAIGeneratedImage;
        const isPolished = imageSource && imageSource !== 'ai_approximation' && imageSource !== 'placeholder' && !isAIGenerated;
        console.log('[AI IMAGE DEBUG] Building AI image source indicator:', {
            recordId: record.id,
            isAI: isAI,
            isManualItem: isManualItem,
            hasAIGeneratedImage: hasAIGeneratedImage,
            imageSource: imageSource,
            isPolished: isPolished,
            isAIGenerated: isAIGenerated,
            imageUrl: imageUrl?.substring(0, 80)
        });

        let badgeText, badgeTitle;
        if (isAIGenerated) {
            badgeText = 'AI Generated';
            badgeTitle = 'This image was automatically generated by AI based on the item details';
        } else if (isPolished) {
            badgeText = 'Verified';
            badgeTitle = `Image from: ${imageSource}`;
        } else {
            badgeText = 'AI Approx';
            badgeTitle = 'AI-approximated image - click Dig Into for better results';
        }

        aiImageSourceHtml = `
            <span class="ai-image-source ${isPolished ? 'polished' : 'approximation'}"
                  title="${badgeTitle}">
                ${badgeText}
            </span>
        `;
        console.log('[AI IMAGE DEBUG] Built aiImageSourceHtml:', aiImageSourceHtml.trim());
    } else {
        console.log('[AI IMAGE DEBUG] NOT building AI image indicator because isAI is false:', {
            recordId: record.id,
            isAI: isAI
        });
    }

    // Confidence is now communicated purely through visual styling of the card
    // (font, color, background, borders) — no text label badge needed
    let confidenceStyleTextHtml = '';
    if (isAI) {
        console.log('[DEBUG Presentation] Confidence tier for', record.id, ':', confidenceIndicatorClass, '- expressed via card styling');
    }

    // Build dig button or accuracy badge HTML for AI items
    let digButtonHtml = '';
    if (isAI) {
        if (hasBeenResearched) {
            // Show accuracy badge for researched items
            const accuracyPercent = Math.round(record._researchData.confidence * 100);
            const accuracyLevel = accuracyPercent >= 80 ? 'high' : accuracyPercent >= 50 ? 'medium' : 'low';
            digButtonHtml = `
                <span class="presentation-accuracy-badge ${accuracyLevel}" title="Research accuracy: ${accuracyPercent}%">
                    ✓ ${accuracyPercent}%
                </span>
            `;
            console.log('[DEBUG Presentation] Built accuracy badge for researched item', record.id);
        } else {
            // Show dig button for unresearched AI items
            digButtonHtml = `
                <button class="presentation-dig-btn" data-record-id="${record.id}" title="Research this item to improve accuracy">
                    <span class="dig-icon">🔍</span> Dig Into
                </button>
            `;
            console.log('[DEBUG Presentation] Built dig button for AI item', record.id);
        }
    } else {
        console.log('[DEBUG Presentation] NOT building dig button for', record.id, '- isAI:', isAI);
    }

    card.innerHTML = `
        ${confidenceStyleTextHtml}
        <div class="presentation-result-card-image${isAI ? ' ai-item' : ''}" style="${imageUrl ? `background-image: url('${imageUrl}')` : ''}">
            ${aiImageSourceHtml}
        </div>
        <div class="presentation-result-card-content">
            <h5 class="presentation-result-card-name">${name}</h5>
            <div class="presentation-result-card-meta">
                <span class="presentation-result-card-price${isAI ? ' estimate' : ''}">
                    ${price > 0 ? `$${price.toFixed(2)}${isAI ? ' (Est.)' : ''}` : 'Price varies'}
                </span>
                ${category ? `<span class="presentation-result-card-category">${category}</span>` : ''}
            </div>
            <button class="presentation-quick-add-btn${isInPlan ? ' added' : ''}" data-record-id="${record.id}">
                ${isInPlan ? '✓ Added' : '+ Quick Add'}
            </button>
        </div>
        ${digButtonHtml}
    `;

    // Click on card (not button) opens detail modal
    card.addEventListener('click', (e) => {
        if (e.target.closest('.presentation-quick-add-btn') || e.target.closest('.presentation-dig-btn')) return;
        handleCardClick(record, isAI);
    });

    // Quick add button handler
    const quickAddBtn = card.querySelector('.presentation-quick-add-btn');
    quickAddBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleQuickAdd(record, quickAddBtn, isAI);
    });

    // Dig Into button handler for AI items
    const digBtn = card.querySelector('.presentation-dig-btn');
    if (digBtn) {
        digBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await handleDigInto(record, digBtn, card);
        });
    }

    return card;
}

/**
 * Handles clicking on a result card to show detail modal
 */
function handleCardClick(record, isAI) {
    log('Presentation', `Card clicked: ${record.fields.Name}, isAI: ${isAI}`);

    if (isAI) {
        // For AI items, create a temporary record in state for the modal to use
        const existingIndex = state.records.all.findIndex(r => r.id === record.id);
        if (existingIndex === -1) {
            state.records.all.push(record);
            invalidateRecordsIndex();
        }
    }

    // Close search modal and show detail modal
    closeSearchModal();
    showDetailModal(record);
}

/**
 * Handles quick add button click
 */
async function handleQuickAdd(record, button, isAI) {
    if (button.classList.contains('added')) return;

    log('Presentation', `Quick adding: ${record.fields.Name}`);

    button.disabled = true;
    button.textContent = 'Adding...';

    try {
        if (isAI) {
            // For AI items, we need to create a proper record first
            const existingIndex = state.records.all.findIndex(r => r.id === record.id);
            if (existingIndex === -1) {
                state.records.all.push(record);
                invalidateRecordsIndex();
            }
        }

        // Add to cart.items (ideas list) so it appears in presentation view and catalog event plan panel
        if (!state.cart.items.has(record.id) && !state.cart.lockedItems.has(record.id)) {
            const itemInfo = {
                quantity: 1,
                selectedOptionIndex: 0,
                selections: {},
                note: ''
            };
            state.cart.items.set(record.id, itemInfo);
            log('Presentation', `Added ${record.fields.Name} to cart.items (ideas)`);
        }

        // Also add to liked items for authenticated users (persists across sessions)
        if (state.session.user.isAuthenticated && !state.session.user.likedItemIds.has(record.id)) {
            state.session.user.likedItemIds.add(record.id);
        }

        // Trigger save to persist changes
        await triggerSave();

        // Update the presentation view items list in real-time
        await _renderAllItems();

        // Update the catalog view's event plan panel and ideas carousel
        await updateEventPlanSection();
        await updateIdeasCarousel();

        // Sync plan state across all views
        syncPlanState('presentation', 'itemAdded', { recordId: record.id, itemName: record.fields.Name });

        // Update button state
        button.classList.add('added');
        button.textContent = '✓ Added';
        button.disabled = false;

        log('Presentation', `Successfully added ${record.fields.Name} to plan`);

    } catch (error) {
        log('Presentation', `Error adding item: ${error.message}`);
        button.disabled = false;
        button.textContent = '+ Quick Add';
    }
}

/**
 * Handles "Dig Into" button click for AI items to research and improve accuracy
 */
async function handleDigInto(record, button, card) {
    log('Presentation', `Digging into AI item: ${record.fields.Name}`);

    // Update button to show loading state
    const originalContent = button.innerHTML;
    button.innerHTML = '<span class="dig-icon">⏳</span> Researching...';
    button.classList.add('researching');
    button.disabled = true;

    try {
        // Prepare the solution data for research
        const solutionData = {
            name: record.fields.Name || 'Unknown Item',
            description: record.fields.Description || '',
            category: record.fields.Category || '',
            price: record.fields.Price || null
        };

        // Call the API to research the item
        const result = await api.digSolutionDetails({
            fields: solutionData,
            id: record.id
        });

        if (!result.success) {
            throw new Error(result.error || 'Failed to research item');
        }

        const research = result.research;
        log('Presentation', `Successfully researched ${record.fields.Name} with confidence ${research.confidence}`);

        // Update the record with research data
        record._researchData = research;
        record._aiConfidence = research.confidence;

        // Update fields with researched information
        if (research.name) record.fields.Name = research.name;
        if (research.description) record.fields.Description = research.description;
        if (research.price?.estimate) record.fields.Price = research.price.estimate;
        if (research.price?.pricingType) record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] = research.price.pricingType;

        // Add location details
        if (research.location?.serviceArea) {
            record.fields['Location Details'] = research.location.serviceArea;
            if (research.location.type) {
                record.fields['Location Details'] += ` (${research.location.type} service)`;
            }
        }

        // Add rankings
        if (research.rankings) {
            const rankingsData = {
                profileSource: 'ai_presentation_research',
                Fun: research.rankings.Fun || 0,
                Social: research.rankings.Social || 0,
                Active: research.rankings.Active || 0,
                Creative: research.rankings.Creative || 0,
                Learning: research.rankings.Learning || 0,
                Relaxing: research.rankings.Relaxing || 0,
                Tags: research.imageKeywords || []
            };
            record.fields.Rankings = JSON.stringify(rankingsData);
        }

        // Add media tags for image searching
        if (research.imageKeywords && research.imageKeywords.length > 0) {
            record.fields['Media Tags'] = research.imageKeywords.join(' ');
        }

        // Update the record in state if present
        const stateIndex = state.records.all.findIndex(r => r.id === record.id);
        if (stateIndex !== -1) {
            state.records.all[stateIndex] = record;
        }

        // ============================================================
        // REFRESH IMAGE: Use improved keywords from research to find a better image
        // ============================================================
        const imageContainer = card.querySelector('.presentation-result-card-image');
        if (imageContainer) {
            console.log('[DEBUG Presentation] Refreshing image after dig research for:', record.id);

            // Clear the image cache for this record so we get fresh results
            // Note: api.fetchImagesForRecord uses an internal cache, so we need to re-fetch
            try {
                // Update record confidence so the placeholder reflects new confidence level
                record._aiConfidence = research.confidence;
                record.fields._aiConfidence = research.confidence;

                // Fetch new image with updated keywords/confidence
                const { imageUrls, status } = await api.fetchImagesForRecord(record, state.records.all, new Map());

                if (imageUrls && imageUrls.length > 0) {
                    const newImageUrl = imageUrls[0];
                    imageContainer.style.backgroundImage = `url('${newImageUrl}')`;

                    // Update or add the image source indicator
                    let sourceIndicator = imageContainer.querySelector('.ai-image-source');
                    if (!sourceIndicator) {
                        sourceIndicator = document.createElement('span');
                        sourceIndicator.className = 'ai-image-source';
                        imageContainer.appendChild(sourceIndicator);
                    }

                    // Update source indicator based on where image came from
                    const isAIGenerated = status === 'ai_generated' || status === 'mixed_ai_custom';
                    const isPolished = status !== 'ai_approximation' && status !== 'placeholder' && !isAIGenerated;
                    sourceIndicator.className = `ai-image-source ${isPolished ? 'polished' : 'approximation'}`;

                    if (isAIGenerated) {
                        sourceIndicator.textContent = 'AI Generated';
                        sourceIndicator.title = 'This image was automatically generated by AI based on the item details';
                    } else if (isPolished) {
                        sourceIndicator.textContent = 'Verified';
                        sourceIndicator.title = `Image from: ${status}`;
                    } else {
                        sourceIndicator.textContent = 'AI Approx';
                        sourceIndicator.title = 'AI-approximated image - click Dig Into for better results';
                    }

                    console.log('[DEBUG Presentation] Image refreshed after dig:', {
                        recordId: record.id,
                        imageSource: status,
                        isPolished
                    });

                    // If still just a placeholder after research, trigger AI image generation
                    if ((status === 'ai_approximation' || status === 'placeholder' || status === 'using_placeholder') &&
                        !window._aiImageGenerationAttempted?.has(record.id) &&
                        !window._aiImageGenerationInProgress?.has(record.id)) {
                        console.log('[AI IMAGE AUTO-GEN DIG] Generating AI image after dig research for:', record.fields?.Name);
                        if (!window._aiImageGenerationInProgress) window._aiImageGenerationInProgress = new Set();
                        window._aiImageGenerationInProgress.add(record.id);

                        try {
                            const digGenPayload = {
                                name: record.fields?.Name || 'Unnamed Item',
                                description: record.fields?.Description || '',
                                category: record.fields?.Category || '',
                                serviceType: record.fields?.ServiceType || record.fields?.['Service Type'] || '',
                                tags: record.fields?.['Media Tags'] || '',
                                itemId: record.id,
                                sessionId: state.session?.id || 'unsaved'
                            };

                            console.log('[AI IMAGE AUTO-GEN DIG] Payload:', JSON.stringify(digGenPayload));
                            const _digStart = Date.now();

                            const digAiResp = await fetch('/.netlify/functions/generate-ai-image', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(digGenPayload)
                            });
                            const _digElapsed = Date.now() - _digStart;
                            console.log('[AI IMAGE AUTO-GEN DIG] Response in', _digElapsed, 'ms, status:', digAiResp.status);

                            if (digAiResp.ok) {
                                const digAiResult = await digAiResp.json();
                                console.log('[AI IMAGE AUTO-GEN DIG] Result:', JSON.stringify({
                                    success: digAiResult.success,
                                    hasImageUrl: !!digAiResult.imageUrl,
                                    _aiProvider: digAiResult._aiProvider,
                                }));
                                if (digAiResult.success && digAiResult.imageUrl) {
                                    const digAiImg = { url: digAiResult.imageUrl, isAIGenerated: true, prompt: digAiResult.prompt };
                                    record.fields._customImages = [digAiImg];
                                    record.fields._hasAIGeneratedImage = true;
                                    const digStateRec = getRecordById(record.id);
                                    if (digStateRec) {
                                        digStateRec.fields._customImages = [digAiImg];
                                        digStateRec.fields._hasAIGeneratedImage = true;
                                    }
                                    triggerSave();

                                    imageContainer.style.backgroundImage = `url('${digAiResult.imageUrl}')`;
                                    if (sourceIndicator) {
                                        sourceIndicator.textContent = 'AI Generated';
                                        sourceIndicator.title = 'This image was automatically generated by AI based on the item details';
                                        sourceIndicator.className = 'ai-image-source approximation';
                                    }
                                    console.log('[AI IMAGE AUTO-GEN DIG] SUCCESS:', digAiResult.imageUrl);
                                } else {
                                    console.warn('[AI IMAGE AUTO-GEN DIG] Response OK but no imageUrl:', JSON.stringify(digAiResult));
                                    window._aiImageGenerationAttempted?.add(record.id);
                                }
                            } else {
                                const errBody = await digAiResp.text();
                                console.warn('[AI IMAGE AUTO-GEN DIG] FAILED status:', digAiResp.status, 'body:', errBody.substring(0, 500));
                                window._aiImageGenerationAttempted?.add(record.id);
                            }
                        } catch (digGenErr) {
                            window._aiImageGenerationAttempted?.add(record.id);
                            console.warn('[AI IMAGE AUTO-GEN DIG] EXCEPTION:', digGenErr.message);
                            console.warn('[AI IMAGE AUTO-GEN DIG] Stack:', digGenErr.stack);
                        } finally {
                            window._aiImageGenerationInProgress?.delete(record.id);
                        }
                    }
                }
            } catch (imgError) {
                console.warn('[DEBUG Presentation] Failed to refresh image after dig:', imgError);
            }
        }

        // Determine new confidence class
        const newConfidence = research.confidence;
        let newConfidenceClass = '';
        let newConfidenceIndicatorClass = '';
        let newConfidenceLabel = '';

        if (newConfidence < 0.5) {
            newConfidenceClass = 'confidence-pencil';
            newConfidenceIndicatorClass = 'pencil';
            newConfidenceLabel = `~${Math.round(newConfidence * 100)}%`;
        } else if (newConfidence < 0.75) {
            newConfidenceClass = 'confidence-pen';
            newConfidenceIndicatorClass = 'pen';
            newConfidenceLabel = `~${Math.round(newConfidence * 100)}%`;
        } else if (newConfidence < 0.95) {
            newConfidenceClass = 'confidence-typed';
            newConfidenceIndicatorClass = 'typed';
            newConfidenceLabel = `${Math.round(newConfidence * 100)}%`;
        } else {
            newConfidenceClass = 'confidence-premium';
            newConfidenceIndicatorClass = 'premium';
            newConfidenceLabel = `${Math.round(newConfidence * 100)}%`;
        }

        // Remove old confidence classes and add new one
        card.classList.remove('confidence-pencil', 'confidence-pen', 'confidence-typed', 'confidence-premium');
        card.classList.add(newConfidenceClass);

        // Update confidence style text element
        const confidenceStyleText = card.querySelector('.confidence-style-text');
        if (confidenceStyleText) {
            // Generate new style text
            let newStyleText;
            if (newConfidenceIndicatorClass === 'pencil') {
                newStyleText = `Pencil (~${Math.round(newConfidence * 100)}%)`;
            } else if (newConfidenceIndicatorClass === 'pen') {
                newStyleText = `Pen (~${Math.round(newConfidence * 100)}%)`;
            } else if (newConfidenceIndicatorClass === 'typed') {
                newStyleText = `Typed (${Math.round(newConfidence * 100)}%)`;
            } else {
                newStyleText = `Premium (${Math.round(newConfidence * 100)}%)`;
            }

            confidenceStyleText.className = `confidence-style-text confidence-style-${newConfidenceIndicatorClass}`;
            confidenceStyleText.title = `Confidence level: ${newConfidenceLabel}`;
            confidenceStyleText.textContent = newStyleText;
            console.log('[DEBUG Presentation] Updated confidence style text after dig:', newStyleText);
        }

        // Legacy: Update confidence indicator if still present
        const confidenceIndicator = card.querySelector('.confidence-indicator');
        if (confidenceIndicator) {
            confidenceIndicator.className = `confidence-indicator ${newConfidenceIndicatorClass}`;
            confidenceIndicator.title = `Confidence: ${newConfidenceLabel}`;
            confidenceIndicator.innerHTML = `
                ${newConfidenceIndicatorClass === 'pencil' ? '✏️' : newConfidenceIndicatorClass === 'pen' ? '🖊️' : newConfidenceIndicatorClass === 'typed' ? '⌨️' : '✨'}
                ${newConfidenceLabel}
            `;
        }

        // Update the name in the card if it changed
        const nameEl = card.querySelector('.presentation-result-card-name');
        if (nameEl && research.name) {
            nameEl.textContent = research.name;
        }

        // Update the price in the card if it changed
        const priceEl = card.querySelector('.presentation-result-card-price');
        if (priceEl && research.price?.estimate) {
            priceEl.textContent = `$${research.price.estimate.toFixed(2)} (Est.)`;
        }

        // Replace dig button with accuracy badge
        const accuracyPercent = Math.round(newConfidence * 100);
        const accuracyLevel = accuracyPercent >= 80 ? 'high' : accuracyPercent >= 50 ? 'medium' : 'low';
        button.outerHTML = `
            <span class="presentation-accuracy-badge ${accuracyLevel}" title="Research accuracy: ${accuracyPercent}%">
                ✓ ${accuracyPercent}%
            </span>
        `;

        // Show success toast
        showToast(`Research complete! Accuracy: ${accuracyPercent}%`);

        // Trigger save to persist the research data
        triggerSave();

        log('Presentation', `Dig Into complete for ${record.fields.Name}, new confidence: ${newConfidence}`);

    } catch (error) {
        console.error('Error researching AI item:', error);
        log('Presentation', `Error digging into item: ${error.message}`);

        // Restore button
        button.innerHTML = originalContent;
        button.classList.remove('researching');
        button.disabled = false;

        // Show error toast
        showToast('Failed to research item. Try again.');
    }
}

/**
 * Renders refinement chips for AI suggestions
 */
function renderPresentationRefinementChips(keywords) {
    if (!presentationRefinementChips || !keywords || keywords.length === 0) return;

    presentationRefinementChips.innerHTML = '';

    keywords.slice(0, 6).forEach(keyword => {
        const chip = document.createElement('button');
        chip.className = 'presentation-refinement-chip';
        chip.textContent = keyword;
        chip.title = `Search for "${keyword}"`;

        chip.addEventListener('click', () => {
            presentationSearchInput.value = keyword;
            handleSearchInput({ target: presentationSearchInput });
        });

        presentationRefinementChips.appendChild(chip);
    });
}

/**
 * Clears refinement chips
 */
function clearPresentationRefinementChips() {
    if (presentationRefinementChips) {
        presentationRefinementChips.innerHTML = '';
    }
}
