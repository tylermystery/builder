// REPLACE THE ENTIRE CONTENTS OF: filtering.js

import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import * as api from './api.js';
import { getGroupPriceRange, getRecordPrice, parseOptions, getTempLikes } from './utils.js';
import { calculateMissingCategories, buildGoalBucket, calculateRecommendationScore } from './availability.js';

// --- Performance: Cached record metadata to avoid re-parsing on every filter pass ---
const _recordMetaCache = new WeakMap();

/**
 * Get or compute cached metadata for a record (categories, price, etc.)
 * Uses WeakMap so entries are garbage collected when records are removed from state.
 */
function getRecordMeta(record) {
    if (_recordMetaCache.has(record)) return _recordMetaCache.get(record);

    const fields = record.fields || {};
    const categoriesRaw = fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '';
    const subcategoriesRaw = fields.Subcategories || '';
    const parentName = (fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || '').trim().toLowerCase().replace(/\s+/g, ' ');

    const meta = {
        categoriesLower: categoriesRaw.split(',').map(c => c.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean),
        subcategoriesLower: subcategoriesRaw.split(',').map(s => s.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean),
        parentNameLower: parentName,
        nameLower: (fields[CONSTANTS.FIELD_NAMES.NAME] || '').toLowerCase(),
        descriptionLower: (fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || '').toLowerCase(),
        price: getGroupPriceRange(record)?.min ?? parseFloat(String(fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, "")),
        capacity: parseCapacity(fields['Capacity']),
        locationLower: (fields['Location'] || '').toLowerCase()
    };

    _recordMetaCache.set(record, meta);
    return meta;
}


// --- HELPER FUNCTIONS (Non-Scoring, kept local) ---

function getDescendantBookableItems(record, allRecordsInStore, allRecordNames) {
    let bookableItems = [];
    const children = allRecordsInStore.filter(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] === record.fields.Name);

    for (const child of children) {
        if (isGrouping(child, allRecordNames)) {
            bookableItems = bookableItems.concat(getDescendantBookableItems(child, allRecordsInStore, allRecordNames));
        } else {
            bookableItems.push(child);
        }
    }
    return bookableItems;
}

function isGrouping(record, allRecordNames) {
    return record.fields['Item Type'] === 'Grouping';
}

function parseCapacity(capacityStr) {
    if (!capacityStr || typeof capacityStr !== 'string') return { min: 0, max: Infinity };
    if (capacityStr.includes('+')) {
        return { min: parseInt(capacityStr, 10) || 0, max: Infinity };
    }
    const parts = capacityStr.split('-').map(p => parseInt(p, 10));
    return { min: parts[0] || 0, max: parts[1] || Infinity };
}

function filterByCategoryAndSubcategory(records, selectedCategory, activeSubcategories) {
    // Defensive: ensure inputs are valid
    if (!Array.isArray(records)) {
        console.warn('[FilterDebug] filterByCategoryAndSubcategory received non-array records');
        return [];
    }
    if (!Array.isArray(activeSubcategories)) {
        activeSubcategories = [];
    }

    if (selectedCategory === 'all' || !selectedCategory) {
        return records;
    }

    const selectedCategoryLower = String(selectedCategory).toLowerCase().replace(/\s+/g, ' ');
    let categoryFilteredRecords = [];

    categoryFilteredRecords = records.filter(record => {
        // Defensive: ensure record has fields
        if (!record || !record.fields) return false;

        const meta = getRecordMeta(record);
        return meta.categoriesLower.includes(selectedCategoryLower) ||
               meta.parentNameLower === selectedCategoryLower ||
               meta.subcategoriesLower.includes(selectedCategoryLower);
    });

    if (activeSubcategories.length > 0) {
        const subcategoryFilteredRecords = categoryFilteredRecords.filter(record => {
            if (!record || !record.fields) return false;

            const meta = getRecordMeta(record);
            return activeSubcategories.some(activeSubcat =>
                meta.subcategoriesLower.includes(activeSubcat) ||
                meta.parentNameLower === activeSubcat
            );
        });
        return subcategoryFilteredRecords;
    } else {
        return categoryFilteredRecords;
    }
}


function filterByStatus(records, statusFilter) {
    // Defensive: ensure records is an array
    if (!Array.isArray(records)) return [];

    if (statusFilter === 'all') {
        return records;
    } else if (statusFilter === 'Available') {
        return records.filter(record => {
            if (!record || !record.fields) return false;
            const status = record.fields[CONSTANTS.FIELD_NAMES.STATUS];
            return status && (status === 'Available' || status === 'Featured');
        });
    } else {
        return records.filter(record => {
            if (!record || !record.fields) return false;
            return record.fields[CONSTANTS.FIELD_NAMES.STATUS] &&
                record.fields[CONSTANTS.FIELD_NAMES.STATUS] === statusFilter;
        });
    }
}

function filterByHeadcount(records, headcountFilter, customHeadcount) {
    // Defensive: ensure records is an array
    if (!Array.isArray(records)) return [];

    if (headcountFilter === 'any' && !customHeadcount) {
        return records;
    }

    let filterMin = 0, filterMax = Infinity;
    if (headcountFilter === 'custom') {
        filterMin = parseInt(customHeadcount, 10) || 0;
        filterMax = filterMin;
    } else if (headcountFilter && headcountFilter.includes('-')) {
        const [minStr, maxStr] = headcountFilter.split('-');
        filterMin = parseInt(minStr, 10) || 0;
        filterMax = maxStr === 'plus' ? Infinity : (parseInt(maxStr, 10) || Infinity);
    }

    return records.filter(record => {
        if (!record || !record.fields) return false;
        const meta = getRecordMeta(record);
        return filterMin <= meta.capacity.max && filterMax >= meta.capacity.min;
    });
}

function filterByLocation(records, locationFilter) {
    // Defensive: ensure records is an array
    if (!Array.isArray(records)) return [];

    if (locationFilter === 'any') {
        return records;
    }
    const filterValueToRegion = {
        'sf': 'San Francisco',
        'oakland': 'Oakland',
        'peninsula': 'Peninsula',
        'south-bay': 'South Bay',
        'north-bay': 'North Bay',
        'east-bay': 'East Bay',
        'other': 'Other'
    };
    const targetRegion = filterValueToRegion[locationFilter];

    if (!targetRegion) {
        return records;
    }

    return records.filter(record => {
        if (!record || !record.fields) return false;
        const recordRegions = record.fields['Region'] || [];
        // Defensive: ensure recordRegions is an array
        const safeRegions = Array.isArray(recordRegions) ? recordRegions : [];

        const isTargeted = safeRegions.includes(targetRegion);
        const isAvailableEverywhere = safeRegions.includes('All');
        const isRegionBlank = safeRegions.length === 0;

        return isTargeted || isAvailableEverywhere || isRegionBlank;
    });
}

function filterByBudget(records, budgetFilter) {
    // Defensive: ensure records is an array
    if (!Array.isArray(records)) return [];

    if (budgetFilter === 'any') {
        return records;
    }
    const BUDGET_RANGES = {
        'budget-friendly': { min: 0, max: 50 },
        'moderate': { min: 51, max: 100 },
        'executive': { min: 101, max: 250 },
        'luxury': { min: 251, max: Infinity }
    };
    const range = BUDGET_RANGES[budgetFilter];

    // Defensive: if budget filter is invalid, return all records
    if (!range) {
        console.warn('[FilterDebug] Invalid budget filter:', budgetFilter);
        return records;
    }

    return records.filter(record => {
        if (!record || !record.fields) return false;
        const meta = getRecordMeta(record);
        const price = meta.price;
        return !isNaN(price) && price >= range.min && price <= range.max;
    });
}

function filterBySearchTerm(records, searchTerm) {
    // Defensive: ensure records is an array
    if (!Array.isArray(records)) return [];

    if (!searchTerm) {
        return records;
    }
    const lowerSearchTerm = String(searchTerm).toLowerCase();

    const scoredRecords = [];
    records.forEach(record => {
        // Defensive: skip invalid records
        if (!record || !record.fields) return;

        let score = 0;
        const meta = getRecordMeta(record);
        const fields = record.fields;

        const optionNames = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]).map(opt => opt.name).join(' ').toLowerCase();
        const allOtherText = [
            fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '',
            fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES] || '',
            fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS] || '',
            fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || '',
            fields['Location'] || '',
            optionNames
        ].join(' ').toLowerCase();

        if (meta.nameLower.includes(lowerSearchTerm)) {
            score = 3;
        } else if (meta.descriptionLower.includes(lowerSearchTerm)) {
            score = 2;
        } else if (allOtherText.includes(lowerSearchTerm)) {
            score = 1;
        }

        if (score > 0) {
            scoredRecords.push({ record, score });
        }
    });

    scoredRecords.sort((a, b) => b.score - a.score);
    return scoredRecords.map(item => item.record);
}

function sortRecords(records, sortBy, goalBucket) {
    // Defensive: ensure records is an array
    if (!Array.isArray(records)) return [];
    // Defensive: ensure goalBucket is an array
    if (!Array.isArray(goalBucket)) goalBucket = [];

    if (sortBy === 'recommended') {
        const log = (typeof ui !== 'undefined' && ui.log) ? ui.log : console.log;
        log('Filtering', `Sorting by v3.0 "Recommended". Goals Included. Bucket: [${goalBucket.join(', ')}]`);

        const scoredRecords = records.map(record => ({
            record,
            score: calculateRecommendationScore(record, goalBucket)
        }));

        scoredRecords.sort((a, b) => b.score - a.score);

        return scoredRecords.map(item => item.record);
    }
    
    return records.sort((a, b) => {
        const aIsFeatured = a.fields[CONSTANTS.FIELD_NAMES.STATUS] === 'Featured';
        const bIsFeatured = b.fields[CONSTANTS.FIELD_NAMES.STATUS] === 'Featured';

        if (aIsFeatured && !bIsFeatured) {
            return -1;
        }
        if (!aIsFeatured && bIsFeatured) {
            return 1;
        }

        const aMeta = getRecordMeta(a);
        const bMeta = getRecordMeta(b);

        switch (sortBy) {
            case 'price-asc': return aMeta.price - bMeta.price;
            case 'price-desc': return bMeta.price - aMeta.price;
            case 'name-asc': return aMeta.nameLower.localeCompare(bMeta.nameLower);
            default: return aMeta.nameLower.localeCompare(bMeta.nameLower);
        }
    });
}


export async function applyFiltersAndSort(imageCache) {
    const catalogContainer = document.getElementById('catalog-container');

    const params = new URLSearchParams(window.location.search);
    const rawCategory = params.get('category');
    const selectedCategory = rawCategory ? rawCategory.toLowerCase().replace(/\s+/g, ' ') : 'all';
    const rawSubcategories = params.get('subcategory')?.split(',').filter(Boolean) || [];
    const activeSubcategories = rawSubcategories.map(sc => sc.toLowerCase().replace(/\s+/g, ' '));
    const view = params.get('view');

    // Skip filtering/rendering when tasks view is active - task manager handles its own rendering
    if (view === 'tasks') {
        return;
    }

    // Get other filter values from UI elements (unchanged)
    const searchTerm = document.getElementById('name-filter').value.toLowerCase();
    const statusFilter = document.getElementById('status-filter').value;
    const headcountFilter = document.getElementById('headcount-filter').value;
    const customHeadcount = document.getElementById('headcount-custom').value;
    const locationFilter = document.getElementById('location-filter').value;
    const budgetFilter = document.getElementById('budget-filter').value;
    const sortBy = document.getElementById('sort-by').value;

    const goalBucket = buildGoalBucket(sortBy);

    let baseRecordsToFilter = state.records.all.filter(record =>
        record.fields.Stores && record.fields.Stores.includes(state.ui.activeShopId)
    );

    let recordsToDisplay;

    if (view === 'plan') {
        const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Your';
        const lockedItemIds = Array.from(state.cart.lockedItems.keys());
        const ideaItemIds = Array.from(state.cart.items.keys());
        const allPlanRecordIds = [...lockedItemIds, ...ideaItemIds];
        recordsToDisplay = allPlanRecordIds.map(id => state.records.all.find(record => record.id === id)).filter(Boolean);
        
    } else if (view === 'likes') {
        let likedIds = new Set();
        if (state.session.user.isAuthenticated) {
            likedIds = state.session.user.likedItemIds;
        } else {
            likedIds = getTempLikes();
        }
        recordsToDisplay = baseRecordsToFilter.filter(record => likedIds.has(record.id));
        
    } else if (view === 'my-sessions') {
        console.log('[DEBUG MY-SESSIONS VIEW] ========== MY SESSIONS VIEW ACTIVE ==========');
        console.log('[DEBUG MY-SESSIONS VIEW] state.session.user.isAuthenticated:', state.session.user.isAuthenticated);
        console.log('[DEBUG MY-SESSIONS VIEW] state.session.user.id:', state.session.user.id);
        if (state.session.user.isAuthenticated && state.session.user.id) {
            console.log('[DEBUG MY-SESSIONS VIEW] User is authenticated, fetching plans...');
            const userSessions = await api.fetchPlansForUser(state.session.user.id, true);
            console.log('[DEBUG MY-SESSIONS VIEW] api.fetchPlansForUser returned:', userSessions?.length, 'sessions');
            console.log('[DEBUG MY-SESSIONS VIEW] Raw userSessions:', userSessions);

            // Transform sessions into catalog tiles
            recordsToDisplay = userSessions.map((session, index) => {
                console.log(`[DEBUG MY-SESSIONS VIEW] Processing session ${index + 1}:`, session.id);
                console.log(`[DEBUG MY-SESSIONS VIEW]   - session.fields:`, session.fields);
                const sessionFields = session.fields || {};
                const itemCount = (sessionFields.Items || []).length;
                const totalCost = sessionFields.TotalCost || 0;
                const dateStr = sessionFields.Date ? new Date(sessionFields.Date + 'T00:00:00').toLocaleDateString() : 'No date set';
                const eventName = sessionFields.Name || 'Untitled Session';

                const transformedRecord = {
                    id: session.id,
                    fields: {
                        Name: eventName,
                        Description: `${itemCount} items • ${dateStr} • $${totalCost.toFixed(2)}`,
                        'Item Type': 'Session',
                        Status: 'Available',
                        Price: totalCost,
                        ServiceType: 'Session',
                        Categories: 'My Sessions'
                    },
                    isSession: true,
                    sessionData: session
                };
                console.log(`[DEBUG MY-SESSIONS VIEW]   - Transformed record:`, transformedRecord);
                console.log(`[DEBUG MY-SESSIONS VIEW]   - isSession: ${transformedRecord.isSession}`);
                console.log(`[DEBUG MY-SESSIONS VIEW]   - sessionData present: ${!!transformedRecord.sessionData}`);
                return transformedRecord;
            });

            console.log('[DEBUG MY-SESSIONS VIEW] Total transformed records:', recordsToDisplay.length);
            console.log('[DEBUG MY-SESSIONS VIEW] First record isSession:', recordsToDisplay[0]?.isSession);
            console.log('[DEBUG MY-SESSIONS VIEW] First record sessionData:', recordsToDisplay[0]?.sessionData);

            // Apply search filter if present
            if (searchTerm) {
                console.log('[DEBUG MY-SESSIONS VIEW] Applying search filter:', searchTerm);
                recordsToDisplay = filterBySearchTerm(recordsToDisplay, searchTerm);
                console.log('[DEBUG MY-SESSIONS VIEW] After search filter:', recordsToDisplay.length, 'records');
            }
            console.log('[DEBUG MY-SESSIONS VIEW] ========== MY SESSIONS VIEW COMPLETE ==========');
        } else {
            console.log('[DEBUG MY-SESSIONS VIEW] ⚠️ User not authenticated, returning empty array');
            recordsToDisplay = [];
        }
        
    } else if (view === 'rsvp-events') {
        if (!state.session.user.isAuthenticated || !state.session.user.id) {
            console.warn('[Filtering] RSVP events view requires authentication, but user is not authenticated or has no ID');
            recordsToDisplay = [];
        } else {
            const userId = state.session.user.id;
            console.log(`[Filtering] Filtering RSVP events for user: ${userId}`);
            recordsToDisplay = baseRecordsToFilter.filter(record => {
                const isEvent = record.fields['Item Type'] === 'Event';
                if (!isEvent) return false;
                
                const userRsvpedYes = (record.fields.RSVPs || []).includes(userId);
                const userRsvpedMaybe = (record.fields.RSVPMaybe || []).includes(userId);
                const userRsvpedNo = (record.fields.RSVPNo || []).includes(userId);
                
                const hasRsvp = userRsvpedYes || userRsvpedMaybe || userRsvpedNo;
                
                if (hasRsvp) {
                    console.log(`[Filtering] User RSVP found for event: ${record.fields.Name} (Yes: ${userRsvpedYes}, Maybe: ${userRsvpedMaybe}, No: ${userRsvpedNo})`);
                }
                
                return hasRsvp;
            });
            console.log(`[Filtering] Found ${recordsToDisplay.length} RSVP events for user`);
        }
        
    } else if (view === 'categories') {
        // Get categories from the active store's Items field
        const activeShop = state.stores.all.find(s => s.id === state.ui.activeShopId);
        let categoryRecords = [];
        
        if (activeShop && activeShop.fields && activeShop.fields.Items) {
            // Items field contains Airtable record IDs that reference actual category records
            const itemRecordIds = Array.isArray(activeShop.fields.Items) 
                ? activeShop.fields.Items 
                : activeShop.fields.Items.split(',').map(id => id.trim());
            
            // Look up the actual category records by their IDs
            categoryRecords = itemRecordIds
                .map(recordId => state.records.all.find(r => r.id === recordId))
                .filter(Boolean);
        } else {
            // Fallback to extracting categories from items if store doesn't have Items field
            const categoryNames = [...new Set(
                baseRecordsToFilter
                    .map(r => r.fields[CONSTANTS.FIELD_NAMES.CATEGORIES])
                    .filter(Boolean)
                    .flatMap(cat => cat.split(',').map(c => c.trim()))
            )].sort();
            
            categoryRecords = categoryNames.map(categoryName => {
                return {
                    id: `category-${categoryName.toLowerCase().replace(/\s+/g, '-')}`,
                    fields: {
                        Name: categoryName,
                        Description: `View all items in ${categoryName}`,
                        'Item Type': 'Grouping',
                        Categories: categoryName
                    }
                };
            });
        }
        
        recordsToDisplay = categoryRecords;

    } else if (view === 'packages') {
        // Show all Package type items for this store
        recordsToDisplay = baseRecordsToFilter.filter(record => record.fields['Item Type'] === 'Package');
        // Apply status filter (only show Available packages by default)
        recordsToDisplay = filterByStatus(recordsToDisplay, statusFilter);

    } else {
         // Standard filtering path
         const activeShop = state.stores.all.find(s => s.id === state.ui.activeShopId);
         const hasStoreCategories = activeShop && activeShop.fields && activeShop.fields.Items && activeShop.fields.Items.length > 0;

         // If on landing page (no category selected), include Grouping records for carousel display
         if (selectedCategory === 'all') {
             let storeCategoryRecords = [];

             if (hasStoreCategories) {
                 const storeItemIds = Array.isArray(activeShop.fields.Items)
                     ? activeShop.fields.Items
                     : activeShop.fields.Items.split(',').map(id => id.trim());

                 // Get the actual category (Grouping) records that the store defines
                 storeCategoryRecords = storeItemIds
                     .filter(id => id.startsWith('rec'))
                     .map(id => state.records.all.find(r => r.id === id))
                     .filter(r => r && r.fields['Item Type'] === 'Grouping');
             }

             // Also include any Grouping-type records from the base store items
             // that aren't already in storeCategoryRecords
             const existingIds = new Set(storeCategoryRecords.map(r => r.id));
             const additionalGroupings = baseRecordsToFilter.filter(
                 r => r.fields['Item Type'] === 'Grouping' && !existingIds.has(r.id)
             );
             storeCategoryRecords = [...storeCategoryRecords, ...additionalGroupings];

             // Get all items that belong to this store (excluding Groupings from base filter)
             const storeItems = baseRecordsToFilter.filter(r => r.fields['Item Type'] !== 'Grouping');

             // Combine: Groupings first, then other items
             recordsToDisplay = [...storeCategoryRecords, ...storeItems];
         } else {
             recordsToDisplay = filterByCategoryAndSubcategory(baseRecordsToFilter, selectedCategory, activeSubcategories);
         }

         // Standard filters apply to ALL views except 'My Plan'/'My Likes'
         // On the landing page (no category, no search), preserve Grouping records through filters
         // so they always appear as carousels. Otherwise, filter them normally.
         const isLandingPage = selectedCategory === 'all' && !searchTerm;
         let groupingRecords = [];
         let filteredItems;

         if (isLandingPage) {
             groupingRecords = recordsToDisplay.filter(r => r.fields['Item Type'] === 'Grouping');
             filteredItems = recordsToDisplay.filter(r => r.fields['Item Type'] !== 'Grouping');
         } else {
             filteredItems = recordsToDisplay;
         }

         filteredItems = filterByStatus(filteredItems, statusFilter);
         filteredItems = filterByHeadcount(filteredItems, headcountFilter, customHeadcount);
         filteredItems = filterByLocation(filteredItems, locationFilter);
         filteredItems = filterByBudget(filteredItems, budgetFilter);

         if (searchTerm) {
             filteredItems = filterBySearchTerm(filteredItems, searchTerm);
         }

         // Recombine: groupings first (if on landing page), then filtered items
         recordsToDisplay = [...groupingRecords, ...filteredItems];
    }

    recordsToDisplay = sortRecords(recordsToDisplay, sortBy, goalBucket);

    state.records.filtered = recordsToDisplay;
    state.ui.recordsCurrentlyDisplayed = 0;

    if (catalogContainer) catalogContainer.innerHTML = '';

    // Determine if we're on the carousel landing page (no category/subcategory/view filters active)
    // Search switches to grid mode, but other filters (status, headcount, etc.) keep carousels
    const isCarouselLandingPage = selectedCategory === 'all' && !params.get('subcategory') && !view && !searchTerm;
    const groupingsInResults = recordsToDisplay.filter(r => r.fields['Item Type'] === 'Grouping');
    const nonGroupingsInResults = recordsToDisplay.filter(r => r.fields['Item Type'] !== 'Grouping');

    if (isCarouselLandingPage && groupingsInResults.length > 0) {
        // On the carousel landing page, render ALL groupings upfront (no pagination limit for groupings).
        // Also discover categories from items that don't have explicit Grouping records and create
        // virtual grouping records for them so they also appear as carousels.
        const existingGroupingNames = new Set(
            groupingsInResults.map(g => g.fields.Name.toLowerCase().replace(/\s+/g, ' '))
        );

        // Find category names from items that don't have a matching Grouping record
        const discoveredCategories = new Set();
        nonGroupingsInResults.forEach(record => {
            const cats = (record.fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '')
                .split(',')
                .map(c => c.trim())
                .filter(Boolean);
            cats.forEach(cat => {
                const catLower = cat.toLowerCase().replace(/\s+/g, ' ');
                if (!existingGroupingNames.has(catLower)) {
                    discoveredCategories.add(cat); // Keep original casing for display
                }
            });
        });

        // Create virtual Grouping records for discovered categories
        const virtualGroupings = Array.from(discoveredCategories).map(catName => ({
            id: `virtual-grouping-${catName.toLowerCase().replace(/\s+/g, '-')}`,
            fields: {
                Name: catName,
                'Item Type': 'Grouping',
                Description: '',
                Categories: ''
            },
            isVirtualGrouping: true
        }));

        // Combine all groupings (real + virtual), then non-groupings
        const allGroupings = [...groupingsInResults, ...virtualGroupings];
        recordsToDisplay = [...allGroupings, ...nonGroupingsInResults];
        state.records.filtered = recordsToDisplay;

        // Render all groupings plus first batch of ungrouped items
        const initialNonGroupings = nonGroupingsInResults.slice(0, RECORDS_PER_LOAD);
        const initialRecords = [...allGroupings, ...initialNonGroupings];

        ui.renderRecords(initialRecords, imageCache, false).then(() => {
            state.ui.recordsCurrentlyDisplayed = allGroupings.length + initialNonGroupings.length;
        });
    } else {
        const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD);

        ui.renderRecords(initialRecords, imageCache, false).then(() => {
            state.ui.recordsCurrentlyDisplayed = initialRecords.length;
        });
    }

    ui.updateCatalogHeader(); // This function will now build breadcrumbs from the URL
}
