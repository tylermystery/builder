// REPLACE THE ENTIRE CONTENTS OF: filtering.js

import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import * as api from './api.js';
import { getGroupPriceRange, getRecordPrice, parseOptions, getTempLikes } from './utils.js';
import { calculateMissingCategories, buildGoalBucket, calculateRecommendationScore } from './availability.js';
import * as tileSizingDebug from './utils/tileSizingDebug.js'; 


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
    console.log('[FilterDebug] === filterByCategoryAndSubcategory START ===');
    console.log('[FilterDebug] selectedCategory:', selectedCategory);
    console.log('[FilterDebug] activeSubcategories:', activeSubcategories);
    console.log('[FilterDebug] Total records to filter:', records.length);
    
    if (selectedCategory === 'all' || !selectedCategory) {
        console.log('[FilterDebug] Category is "all" or empty, returning all records');
        return records;
    }

    const selectedCategoryLower = selectedCategory.toLowerCase().replace(/\s+/g, ' ');
    console.log('[FilterDebug] selectedCategoryLower:', selectedCategoryLower);
    let categoryFilteredRecords = [];

    categoryFilteredRecords = records.filter(record => {
        const fields = record.fields;
        const parentNameLower = (fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const itemCategories = (fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '')
            .split(',')
            .map(cat => cat.trim().toLowerCase().replace(/\s+/g, ' '));
        const itemSubcategoriesForCategoryCheck = (fields.Subcategories || '')
            .split(',')
            .map(sc => sc.trim().toLowerCase().replace(/\s+/g, ' '));

        const matches = itemCategories.includes(selectedCategoryLower) || 
               parentNameLower === selectedCategoryLower ||       
               itemSubcategoriesForCategoryCheck.includes(selectedCategoryLower);
        
        if (matches) {
            console.log('[FilterDebug] MATCH found for:', fields.Name);
            console.log('  - itemCategories:', itemCategories);
            console.log('  - parentNameLower:', parentNameLower);
            console.log('  - itemSubcategoriesForCategoryCheck:', itemSubcategoriesForCategoryCheck);
        }
        
        return matches;
    });
    
    console.log('[FilterDebug] Category filtered records count:', categoryFilteredRecords.length);

    if (activeSubcategories.length > 0) {
        console.log('[FilterDebug] Applying subcategory filter...');
        const subcategoryFilteredRecords = categoryFilteredRecords.filter(record => {
            const fields = record.fields;
            const parentNameLower = (fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || '').trim().toLowerCase().replace(/\s+/g, ' ');
            const itemSubcategories = (fields.Subcategories || '')
                .split(',')
                .map(sc => sc.trim().toLowerCase().replace(/\s+/g, ' '));

            return activeSubcategories.some(activeSubcat =>
                itemSubcategories.includes(activeSubcat) || 
                parentNameLower === activeSubcat            
            );
        });
        console.log('[FilterDebug] Subcategory filtered records count:', subcategoryFilteredRecords.length);
        console.log('[FilterDebug] === filterByCategoryAndSubcategory END ===');
        return subcategoryFilteredRecords; 
    } else {
        console.log('[FilterDebug] No subcategory filter applied');
        console.log('[FilterDebug] === filterByCategoryAndSubcategory END ===');
        return categoryFilteredRecords;
    }
}


function filterByStatus(records, statusFilter) {
    if (statusFilter === 'all') {
        return records;
    } else if (statusFilter === 'Available') {
        return records.filter(record => {
            const status = record.fields[CONSTANTS.FIELD_NAMES.STATUS]; 
            return status && (status === 'Available' || status === 'Featured');
        });
    } else {
        return records.filter(record =>
            record.fields[CONSTANTS.FIELD_NAMES.STATUS] &&
            record.fields[CONSTANTS.FIELD_NAMES.STATUS] === statusFilter
        );
    }
}

function filterByHeadcount(records, headcountFilter, customHeadcount) {
    if (headcountFilter === 'any' && !customHeadcount) {
        return records;
    }

    let filterMin = 0, filterMax = Infinity;
    if (headcountFilter === 'custom') {
        filterMin = parseInt(customHeadcount, 10) || 0;
        filterMax = filterMin; 
    } else {
        const [minStr, maxStr] = headcountFilter.split('-');
        filterMin = parseInt(minStr, 10);
        filterMax = maxStr === 'plus' ? Infinity : parseInt(maxStr, 10);
    }

    return records.filter(record => {
        const capacity = parseCapacity(record.fields['Capacity']);
        return filterMin <= capacity.max && filterMax >= capacity.min;
    });
}

function filterByLocation(records, locationFilter) {
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
        const recordRegions = record.fields['Region'] || [];
        
        const isTargeted = recordRegions.includes(targetRegion);
        const isAvailableEverywhere = recordRegions.includes('All'); 
        const isRegionBlank = recordRegions.length === 0;

        return isTargeted || isAvailableEverywhere || isRegionBlank;
    });
}

function filterByBudget(records, budgetFilter) {
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

    return records.filter(record => {
        const price = getGroupPriceRange(record)?.min ?? parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
        return price >= range.min && price <= range.max;
    });
}

function filterBySearchTerm(records, searchTerm) {
    if (!searchTerm) {
        return records;
    }
    const lowerSearchTerm = searchTerm.toLowerCase();

    const scoredRecords = [];
    records.forEach(record => {
        let score = 0;
        const fields = record.fields;

        const name = (fields[CONSTANTS.FIELD_NAMES.NAME] || '').toLowerCase();
        const description = (fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || '').toLowerCase();
        const optionNames = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]).map(opt => opt.name).join(' ').toLowerCase();
        const allOtherText = [
            fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '',
            fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES] || '',
            fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS] || '',
            fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || '',
            fields['Location'] || '',
            optionNames
        ].join(' ').toLowerCase();

        if (name.includes(lowerSearchTerm)) {
            score = 3;
        } else if (description.includes(lowerSearchTerm)) {
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

        const aPrice = getGroupPriceRange(a)?.min ?? parseFloat(String(a.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
        const bPrice = getGroupPriceRange(b)?.min ?? parseFloat(String(b.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
        const aName = a.fields[CONSTANTS.FIELD_NAMES.NAME] || '';
        const bName = b.fields[CONSTANTS.FIELD_NAMES.NAME] || '';

        switch (sortBy) {
            case 'price-asc': return aPrice - bPrice;
            case 'price-desc': return bPrice - aPrice;
            case 'name-asc': return aName.localeCompare(bName);
            default: return aName.localeCompare(bName); 
        }
    });
}


export async function applyFiltersAndSort(imageCache) {
    console.log('[FilterDebug] ========================================');
    console.log('[FilterDebug] applyFiltersAndSort called');
    console.log('[FilterDebug] URL:', window.location.href);

    // === TILE SIZING DEBUG: Filter/Sort start ===
    console.log('[TileSizing][Filter] === FILTER/SORT START ===');
    console.log('[TileSizing][Filter] Viewport:', tileSizingDebug.getViewportInfo());

    const catalogContainer = document.getElementById('catalog-container');

    // === TILE SIZING DEBUG: Catalog container pre-filter state ===
    if (catalogContainer) {
        console.log('[TileSizing][Filter] Catalog container PRE-filter state:', {
            childCount: catalogContainer.children.length,
            hasCarouselSections: !!catalogContainer.querySelector('.grouping-carousel-section'),
            sizing: tileSizingDebug.getElementSizing(catalogContainer)
        });
    }
    
    const params = new URLSearchParams(window.location.search);
    const rawCategory = params.get('category');
    const selectedCategory = rawCategory ? rawCategory.toLowerCase().replace(/\s+/g, ' ') : 'all';
    const rawSubcategories = params.get('subcategory')?.split(',').filter(Boolean) || [];
    const activeSubcategories = rawSubcategories.map(sc => sc.toLowerCase().replace(/\s+/g, ' '));
    const view = params.get('view');
    console.log('[FilterDebug] selectedCategory from URL:', selectedCategory);
    console.log('[FilterDebug] activeSubcategories from URL:', activeSubcategories);
    console.log('[FilterDebug] view from URL:', view);

    // Skip filtering/rendering when tasks view is active - task manager handles its own rendering
    if (view === 'tasks') {
        console.log('[FilterDebug] Tasks view active, skipping catalog filter/render');
        console.log('[TileSizing][Filter] === FILTER/SORT SKIPPED (tasks view) ===');
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

    // Debug: Check for packages in baseRecordsToFilter
    const packagesInBase = baseRecordsToFilter.filter(r => r.fields['Item Type'] === 'Package');
    console.log('[FilterDebug] Packages in baseRecordsToFilter:', packagesInBase.length);
    if (packagesInBase.length > 0) {
        console.log('[FilterDebug] Package details:', packagesInBase.map(p => ({
            id: p.id,
            name: p.fields.Name,
            stores: p.fields.Stores,
            status: p.fields.Status,
            categories: p.fields.Categories
        })));
    }

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
        console.log('[FilterDebug] ========== PACKAGES VIEW ==========');
        recordsToDisplay = baseRecordsToFilter.filter(record => record.fields['Item Type'] === 'Package');
        console.log('[FilterDebug] Packages found for store:', recordsToDisplay.length);
        if (recordsToDisplay.length > 0) {
            console.log('[FilterDebug] Package names:', recordsToDisplay.map(p => p.fields.Name));
        }
        // Apply status filter (only show Available packages by default)
        recordsToDisplay = filterByStatus(recordsToDisplay, statusFilter);
        console.log('[FilterDebug] Packages after status filter:', recordsToDisplay.length);

    } else {
         console.log('[FilterDebug] Standard filtering path (not plan/likes/etc)');
         console.log('[FilterDebug] baseRecordsToFilter count:', baseRecordsToFilter.length);
         console.log('[FilterDebug] selectedCategory:', selectedCategory);

         // === FULL WIDTH DEBUG: Check if store has category items ===
         const activeShop = state.stores.all.find(s => s.id === state.ui.activeShopId);
         const hasStoreCategories = activeShop && activeShop.fields && activeShop.fields.Items && activeShop.fields.Items.length > 0;
         console.log('[FullWidthDebug] Store has categories (Items field):', hasStoreCategories);

         if (hasStoreCategories) {
             const storeItemIds = Array.isArray(activeShop.fields.Items)
                 ? activeShop.fields.Items
                 : activeShop.fields.Items.split(',').map(id => id.trim());
             console.log('[FullWidthDebug] Store category IDs:', storeItemIds);

             // Get the actual category (Grouping) records
             const storeCategoryRecords = storeItemIds
                 .filter(id => id.startsWith('rec'))
                 .map(id => state.records.all.find(r => r.id === id))
                 .filter(r => r && r.fields['Item Type'] === 'Grouping');
             console.log('[FullWidthDebug] Store category (Grouping) records found:', storeCategoryRecords.length);
             console.log('[FullWidthDebug] Category names:', storeCategoryRecords.map(r => r.fields.Name));
         }

         // Sample first 3 records to see their category data
         console.log('[FilterDebug] Sample records (first 3):');
         baseRecordsToFilter.slice(0, 3).forEach((rec, i) => {
             console.log(`  Record ${i}: ${rec.fields.Name}`);
             console.log(`    - Item Type: "${rec.fields['Item Type']}"`);
             console.log(`    - Categories: "${rec.fields[CONSTANTS.FIELD_NAMES.CATEGORIES]}"`);
             console.log(`    - Parent Item: "${rec.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]}"`);
             console.log(`    - Subcategories: "${rec.fields.Subcategories}"`);
         });

         // If on landing page (no category selected) AND store has categories, include the Grouping records
         if (selectedCategory === 'all' && hasStoreCategories) {
             console.log('[FullWidthDebug] Landing page with store categories - including Groupings for carousels');

             const storeItemIds = Array.isArray(activeShop.fields.Items)
                 ? activeShop.fields.Items
                 : activeShop.fields.Items.split(',').map(id => id.trim());

             // Get the actual category (Grouping) records that the store defines
             const storeCategoryRecords = storeItemIds
                 .filter(id => id.startsWith('rec'))
                 .map(id => state.records.all.find(r => r.id === id))
                 .filter(r => r && r.fields['Item Type'] === 'Grouping');

             // Get all items that belong to this store (excluding Groupings from base filter)
             const storeItems = baseRecordsToFilter.filter(r => r.fields['Item Type'] !== 'Grouping');

             // Combine: Groupings first, then other items
             recordsToDisplay = [...storeCategoryRecords, ...storeItems];
             console.log('[FullWidthDebug] Combined records: Groupings + store items =', recordsToDisplay.length);
             console.log('[FullWidthDebug] Groupings count:', storeCategoryRecords.length);
             console.log('[FullWidthDebug] Other items count:', storeItems.length);
         } else {
             recordsToDisplay = filterByCategoryAndSubcategory(baseRecordsToFilter, selectedCategory, activeSubcategories);
             console.log('[FilterDebug] After category filter, recordsToDisplay count:', recordsToDisplay.length);
         }

         // Standard filters apply to ALL views except 'My Plan'/'My Likes'
         recordsToDisplay = filterByStatus(recordsToDisplay, statusFilter);
         console.log('[FilterDebug] After status filter:', recordsToDisplay.length);
         recordsToDisplay = filterByHeadcount(recordsToDisplay, headcountFilter, customHeadcount);
         console.log('[FilterDebug] After headcount filter:', recordsToDisplay.length);
         recordsToDisplay = filterByLocation(recordsToDisplay, locationFilter);
         console.log('[FilterDebug] After location filter:', recordsToDisplay.length);
         recordsToDisplay = filterByBudget(recordsToDisplay, budgetFilter);
         console.log('[FilterDebug] After budget filter:', recordsToDisplay.length);

         if (searchTerm) {
             recordsToDisplay = filterBySearchTerm(recordsToDisplay, searchTerm);
             console.log('[FilterDebug] After search term filter:', recordsToDisplay.length);
         }

         // === FULL WIDTH DEBUG: Final records breakdown ===
         const finalGroupings = recordsToDisplay.filter(r => r.fields['Item Type'] === 'Grouping');
         const finalBookableItems = recordsToDisplay.filter(r => r.fields['Item Type'] === 'Bookable Item');
         const finalEvents = recordsToDisplay.filter(r => r.fields['Item Type'] === 'Event');
         console.log('[FullWidthDebug] FINAL recordsToDisplay breakdown:');
         console.log('  - Groupings:', finalGroupings.length, finalGroupings.map(r => r.fields.Name));
         console.log('  - Bookable Items:', finalBookableItems.length);
         console.log('  - Events:', finalEvents.length);
         console.log('  - Total:', recordsToDisplay.length);
    }

    recordsToDisplay = sortRecords(recordsToDisplay, sortBy, goalBucket);

    state.records.filtered = recordsToDisplay;
    state.ui.recordsCurrentlyDisplayed = 0;
    
    console.log('[FilterDebug] FINAL recordsToDisplay count:', recordsToDisplay.length);
    if (recordsToDisplay.length > 0) {
        console.log('[FilterDebug] First result:', recordsToDisplay[0].fields.Name);
    }
    console.log('[FilterDebug] ========================================');

    // === TILE SIZING DEBUG: Records to display breakdown ===
    const typeBreakdown = {
        groupings: recordsToDisplay.filter(r => r.fields['Item Type'] === 'Grouping').length,
        events: recordsToDisplay.filter(r => r.fields['Item Type'] === 'Event').length,
        bookableItems: recordsToDisplay.filter(r => r.fields['Item Type'] === 'Bookable Item').length,
        packages: recordsToDisplay.filter(r => r.fields['Item Type'] === 'Package').length,
        sessions: recordsToDisplay.filter(r => r.fields['Item Type'] === 'Session' || r.isSession).length,
        other: recordsToDisplay.filter(r => !['Grouping', 'Event', 'Bookable Item', 'Session', 'Package'].includes(r.fields['Item Type']) && !r.isSession).length
    };

    console.log('[TileSizing][Filter] Records to display breakdown:', typeBreakdown);
    console.log('[TileSizing][Filter] View type:', view || 'catalog');
    console.log('[TileSizing][Filter] Expected layout:', {
        isFilteredView: !!view || !!params.get('subcategory') || !!searchTerm,
        hasGroupings: typeBreakdown.groupings > 0,
        willUseCarousels: !view && !params.get('subcategory') && !searchTerm && typeBreakdown.groupings > 0
    });

    if (catalogContainer) catalogContainer.innerHTML = '';

    const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD);

    // === TILE SIZING DEBUG: About to render ===
    console.log('[TileSizing][Filter] About to call renderRecords with:', {
        recordCount: initialRecords.length,
        totalFiltered: state.records.filtered.length,
        loadSize: RECORDS_PER_LOAD
    });

    ui.renderRecords(initialRecords, imageCache, false).then(() => {
        state.ui.recordsCurrentlyDisplayed = initialRecords.length;

        // === TILE SIZING DEBUG: Post-render state ===
        console.log('[TileSizing][Filter] Post-render state:', {
            recordsDisplayed: state.ui.recordsCurrentlyDisplayed,
            catalogContainerChildren: catalogContainer ? catalogContainer.children.length : 0
        });
    });

    ui.updateCatalogHeader(); // This function will now build breadcrumbs from the URL

    console.log('[TileSizing][Filter] === FILTER/SORT COMPLETE ===');
}
