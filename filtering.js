// REPLACE THE ENTIRE CONTENTS OF: filtering.js

import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import * as api from './api.js';
import { getGroupPriceRange, getRecordPrice, parseOptions, getTempLikes } from './utils.js';
import { calculateMissingCategories, buildGoalBucket, calculateRecommendationScore } from './availability.js'; 


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
    if (selectedCategory === 'all' || !selectedCategory) {
        return records;
    }

    const selectedCategoryLower = selectedCategory.toLowerCase();
    let categoryFilteredRecords = [];

    categoryFilteredRecords = records.filter(record => {
        const fields = record.fields;
        const parentNameLower = (fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || '').trim().toLowerCase();
        const itemCategories = (fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '')
            .split(',')
            .map(cat => cat.trim().toLowerCase());
        const itemSubcategoriesForCategoryCheck = (fields.Subcategories || '')
            .split(',')
            .map(sc => sc.trim().toLowerCase());

        return itemCategories.includes(selectedCategoryLower) || 
               parentNameLower === selectedCategoryLower ||       
               itemSubcategoriesForCategoryCheck.includes(selectedCategoryLower); 
    });

    if (activeSubcategories.length > 0) {
        const subcategoryFilteredRecords = categoryFilteredRecords.filter(record => {
            const fields = record.fields;
            const parentNameLower = (fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || '').trim().toLowerCase();
            const itemSubcategories = (fields.Subcategories || '')
                .split(',')
                .map(sc => sc.trim().toLowerCase());

            return activeSubcategories.some(activeSubcat =>
                itemSubcategories.includes(activeSubcat) || 
                parentNameLower === activeSubcat            
            );
        });
        return subcategoryFilteredRecords; 
    } else {
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
    const catalogContainer = document.getElementById('catalog-container');
    
    const params = new URLSearchParams(window.location.search);
    const selectedCategory = params.get('category') || 'all';
    const activeSubcategories = params.get('subcategory')?.split(',').filter(Boolean) || [];
    const view = params.get('view');

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
        if (state.session.user.isAuthenticated && state.session.user.id) {
            const userSessions = await api.fetchPlansForUser(state.session.user.id, true);
            
            // Transform sessions into catalog tiles
            recordsToDisplay = userSessions.map(session => {
                const sessionFields = session.fields || {};
                const itemCount = (sessionFields.Items || []).length;
                const totalCost = sessionFields.TotalCost || 0;
                const dateStr = sessionFields.Date ? new Date(sessionFields.Date).toLocaleDateString() : 'No date set';
                const eventName = sessionFields.Name || 'Untitled Session';
                
                return {
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
            });
            
            // Apply search filter if present
            if (searchTerm) {
                recordsToDisplay = filterBySearchTerm(recordsToDisplay, searchTerm);
            }
        } else {
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
        
    } else {
         recordsToDisplay = filterByCategoryAndSubcategory(baseRecordsToFilter, selectedCategory, activeSubcategories);
         
         // Standard filters apply to ALL views except 'My Plan'/'My Likes'
         recordsToDisplay = filterByStatus(recordsToDisplay, statusFilter);
         recordsToDisplay = filterByHeadcount(recordsToDisplay, headcountFilter, customHeadcount);
         recordsToDisplay = filterByLocation(recordsToDisplay, locationFilter);
         recordsToDisplay = filterByBudget(recordsToDisplay, budgetFilter);
         
         if (searchTerm) {
             recordsToDisplay = filterBySearchTerm(recordsToDisplay, searchTerm);
         }
    }

    recordsToDisplay = sortRecords(recordsToDisplay, sortBy, goalBucket);

    state.records.filtered = recordsToDisplay;
    state.ui.recordsCurrentlyDisplayed = 0;

    if (catalogContainer) catalogContainer.innerHTML = '';

    const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD);
    ui.renderRecords(initialRecords, imageCache, false).then(() => {
        state.ui.recordsCurrentlyDisplayed = initialRecords.length;
    });

    ui.updateCatalogHeader(); // This function will now build breadcrumbs from the URL
}
