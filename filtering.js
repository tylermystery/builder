// REPLACE THE ENTIRE CONTENTS OF: filtering.js

import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import { getGroupPriceRange, getRecordPrice, parseOptions } from './utils.js';
// VVV FINAL IMPORT FIX: Import all scoring helpers VVV
import { calculateMissingCategories, buildGoalBucket, calculateRecommendationScore } from './availability.js'; 
// ^^^ END FINAL IMPORT FIX ^^^


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
    // Assuming 'Grouping' is a defined Item Type in Airtable
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

// REPLACE the filterByCategoryAndSubcategory function in: filtering.js

function filterByCategoryAndSubcategory(records, selectedCategory, activeSubcategories) {
    // If 'all' or no category is selected, pass through all records.
    if (selectedCategory === 'all' || !selectedCategory) {
        return records;
    }

    const selectedCategoryLower = selectedCategory.toLowerCase();
    let categoryFilteredRecords = [];

    // --- NEW LOGIC: Check Categories, Parent Item, and Subcategories for the selected category ---
    categoryFilteredRecords = records.filter(record => {
        const fields = record.fields;
        const parentNameLower = (fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || '').trim().toLowerCase();
        const itemCategories = (fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '')
            .split(',')
            .map(cat => cat.trim().toLowerCase());
        // Also check Subcategories field for the main category name (edge case)
        const itemSubcategoriesForCategoryCheck = (fields.Subcategories || '')
            .split(',')
            .map(sc => sc.trim().toLowerCase());

        return itemCategories.includes(selectedCategoryLower) || // Matches Category field
               parentNameLower === selectedCategoryLower ||       // Matches Parent Item field
               itemSubcategoriesForCategoryCheck.includes(selectedCategoryLower); // Matches Subcategories field
    });
    // --- END NEW LOGIC --

    // If subcategories are selected, further filter the category results.
    if (activeSubcategories.length > 0) {
        // --- NEW LOGIC: Check Subcategories and Parent Item for the selected subcategories --
        const subcategoryFilteredRecords = categoryFilteredRecords.filter(record => {
            const fields = record.fields;
            const parentNameLower = (fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || '').trim().toLowerCase();
            const itemSubcategories = (fields.Subcategories || '')
                .split(',')
                .map(sc => sc.trim().toLowerCase());

            // Keep if *any* active subcategory filter matches the item's Subcategories OR Parent Item
            return activeSubcategories.some(activeSubcat =>
                itemSubcategories.includes(activeSubcat) || // Matches Subcategories field
                parentNameLower === activeSubcat            // Matches Parent Item field
            );
        });
         // --- END NEW LOGIC --
        return subcategoryFilteredRecords; // Return items matching category logic AND subcategory logic
    } else {
        // If no subcategories are selected, return all items matching the broad category logic.
        return categoryFilteredRecords;
    }
}


function filterByStatus(records, statusFilter) {
    if (statusFilter === 'all') {
        // If "Show All" is selected, return everything
        return records;
    } else if (statusFilter === 'Available') {
        // If "Available" is selected, include both "Available" AND "Featured" items
        return records.filter(record => {
            const status = record.fields[CONSTANTS.FIELD_NAMES.STATUS]; // Get status once
            // Check if status exists AND matches either "Available" or "Featured"
            return status && (status === 'Available' || status === 'Featured');
        });
    } else {
        // For any other specific status, check if status exists AND matches the filter
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
        filterMax = filterMin; // For custom, min and max are the same target value
    } else {
        // Parse range like "11-25" or "250-plus"
        const [minStr, maxStr] = headcountFilter.split('-');
        filterMin = parseInt(minStr, 10);
        filterMax = maxStr === 'plus' ? Infinity : parseInt(maxStr, 10);
    }

    // Filter records: Keep if the record's capacity range overlaps with the filter range
    return records.filter(record => {
        // Assuming 'Capacity' field exists and is parsed correctly by parseCapacity
        const capacity = parseCapacity(record.fields['Capacity']);
        // Overlap condition: filterMin <= capacity.max AND filterMax >= capacity.min
        return filterMin <= capacity.max && filterMax >= capacity.min;
    });
}

function filterByLocation(records, locationFilter) {
    if (locationFilter === 'any') {
        return records;
    }
    // Map dropdown values to Airtable region names
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

    // If no target region exists for the filter value, return all records (fallback)
    if (!targetRegion) {
        return records;
    }

    return records.filter(record => {
        // Assuming 'Region' is a multi-select field in Airtable
        const recordRegions = record.fields['Region'] || [];
        
        // --- VVV START LONG-TERM ROBUST LOGIC VVV ---
        
        // Case 1: The item is explicitly tagged for the current filter region
        const isTargeted = recordRegions.includes(targetRegion);
        
        // Case 2: The item is explicitly tagged as available everywhere
        const isAvailableEverywhere = recordRegions.includes('All'); 
        
        // Case 3: The item has NO region tags, meaning it's assumed globally available
        const isRegionBlank = recordRegions.length === 0;

        // An item is visible if it matches the target region, OR is tagged 'All', 
        // OR is not tagged at all (blank field = globally available default).
        return isTargeted || isAvailableEverywhere || isRegionBlank;

        // --- ^^^ END LONG-TERM ROBUST LOGIC ^^^ ---
    });
}

function filterByBudget(records, budgetFilter) {
    if (budgetFilter === 'any') {
        return records;
    }
    // Define budget ranges based on dropdown values
    const BUDGET_RANGES = {
        'budget-friendly': { min: 0, max: 50 },
        'moderate': { min: 51, max: 100 },
        'executive': { min: 101, max: 250 },
        'luxury': { min: 251, max: Infinity }
    };
    const range = BUDGET_RANGES[budgetFilter];

    return records.filter(record => {
        // Get the minimum price (handles groupings and individual items)
        const price = getGroupPriceRange(record)?.min ?? parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
        // Keep if the item's price falls within the selected budget range
        return price >= range.min && price <= range.max;
    });
}

function filterBySearchTerm(records, searchTerm) {
    if (!searchTerm) {
        return records; // No search term, return all records
    }
    // Normalize search term
    const lowerSearchTerm = searchTerm.toLowerCase();

    const scoredRecords = [];
    records.forEach(record => {
        let score = 0;
        const fields = record.fields;

        // Fields to search within
        const name = (fields[CONSTANTS.FIELD_NAMES.NAME] || '').toLowerCase();
        const description = (fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || '').toLowerCase();
        const optionNames = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]).map(opt => opt.name).join(' ').toLowerCase();
        const allOtherText = [
            fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '',
            fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES] || '',
            fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS] || '',
            fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || '',
            fields['Location'] || '',
            optionNames // Include parsed option names in search text
        ].join(' ').toLowerCase();

        // Assign scores based on where the term is found (higher score for name match)
        if (name.includes(lowerSearchTerm)) {
            score = 3;
        } else if (description.includes(lowerSearchTerm)) {
            score = 2;
        } else if (allOtherText.includes(lowerSearchTerm)) {
            score = 1;
        }

        // Add records with a score > 0 to the results
        if (score > 0) {
            scoredRecords.push({ record, score });
        }
    });

    // Sort results by score (highest first)
    scoredRecords.sort((a, b) => b.score - a.score);
    // Return just the record objects in the sorted order
    return scoredRecords.map(item => item.record);
}

// --- THIS IS THE CORRECT, REPLACED FUNCTION ---
function sortRecords(records, sortBy, goalBucket) {
    // --- VVV NEW V3.0: Dedicated Recommended Sort VVV ---
    if (sortBy === 'recommended') {
        const log = (typeof ui !== 'undefined' && ui.log) ? ui.log : console.log;
        log('Filtering', `Sorting by v3.0 "Recommended". Goals Included. Bucket: [${goalBucket.join(', ')}]`);

        // Create a scored list
        const scoredRecords = records.map(record => ({
            record,
            // VVV Use the imported score function VVV
            score: calculateRecommendationScore(record, goalBucket)
            // ^^^ END VVV
        }));

        // Sort by the new score, highest to lowest
        scoredRecords.sort((a, b) => b.score - a.score);

        return scoredRecords.map(item => item.record);
    }
    
    // --- EXISTING LOGIC (Fallback: Price/Name Sort) ---
    return records.sort((a, b) => {
        const aIsFeatured = a.fields[CONSTANTS.FIELD_NAMES.STATUS] === 'Featured';
        const bIsFeatured = b.fields[CONSTANTS.FIELD_NAMES.STATUS] === 'Featured';

        if (aIsFeatured && !bIsFeatured) {
            return -1; // a comes first
        }
        if (!aIsFeatured && bIsFeatured) {
            return 1; // b comes first
        }

        const aPrice = getGroupPriceRange(a)?.min ?? parseFloat(String(a.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
        const bPrice = getGroupPriceRange(b)?.min ?? parseFloat(String(b.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
        const aName = a.fields[CONSTANTS.FIELD_NAMES.NAME] || '';
        const bName = b.fields[CONSTANTS.FIELD_NAMES.NAME] || '';

        switch (sortBy) {
            case 'price-asc': return aPrice - bPrice;
            case 'price-desc': return bPrice - aPrice;
            case 'name-asc': return aName.localeCompare(bName);
            default: return aName.localeCompare(bName); // Default sort for non-recommended mode is Name (A-Z)
        }
    });
}
// --- END REPLACED FUNCTION ---


export function applyFiltersAndSort(imageCache) {
    const catalogContainer = document.getElementById('catalog-container');
    const planFilterBtn = document.getElementById('plan-filter-btn'); // Still need this
    const likesFilterBtn = document.getElementById('liked-items-filter-btn'); // Still need this

    // --- NEW: Read filters directly from URL ---
    const params = new URLSearchParams(window.location.search);
    const selectedCategory = params.get('category') || 'all';
    const activeSubcategories = params.get('subcategory')?.split(',').filter(Boolean) || [];
    const view = params.get('view');
    // --- END NEW ---

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

    // --- UPDATED: Check 'view' param from URL ---
    if (view === 'plan') {
        // --- "My Plan" View ---
        const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Your';
        // (We removed the catalogTitle element)
        const lockedItemIds = Array.from(state.cart.lockedItems.keys());
        const ideaItemIds = Array.from(state.cart.items.keys());
        const allPlanRecordIds = [...lockedItemIds, ...ideaItemIds];
        recordsToDisplay = allPlanRecordIds.map(id => state.records.all.find(record => record.id === id)).filter(Boolean);
        
    } else if (view === 'likes') {
        // --- "My Likes" View ---
        let likedIds = new Set();
        if (state.session.user.isAuthenticated) {
            likedIds = state.session.user.likedItemIds;
        } else {
            try {
                likedIds = new Set(JSON.parse(localStorage.getItem('tempLikes') || '[]'));
            } catch (e) { console.error("Error reading tempLikes for filtering:", e); }
        }
        recordsToDisplay = baseRecordsToFilter.filter(record => likedIds.has(record.id));
        
    } else {
         // --- Standard Category/All View ---
         recordsToDisplay = filterByCategoryAndSubcategory(baseRecordsToFilter, selectedCategory, activeSubcategories);
         
         // Standard filters apply to ALL views except 'My Plan'/'My Likes'
         recordsToDisplay = filterByStatus(recordsToDisplay, statusFilter);
         recordsToDisplay = filterByHeadcount(recordsToDisplay, headcountFilter, customHeadcount);
         recordsToDisplay = filterByLocation(recordsToDisplay, locationFilter);
         recordsToDisplay = filterByBudget(recordsToDisplay, budgetFilter);
         
         // FIXED: ALWAYS FILTER BY SEARCH TERM 
         if (searchTerm) {
             recordsToDisplay = filterBySearchTerm(recordsToDisplay, searchTerm);
         }
    }
    // --- END UPDATED BLOCK ---

    // --- Sort the Final List (pass the goalBucket) ---\n    recordsToDisplay = sortRecords(recordsToDisplay, sortBy, goalBucket);

    // --- Update State & Render ---\n    state.records.filtered = recordsToDisplay;
    state.ui.recordsCurrentlyDisplayed = 0;

    if (catalogContainer) catalogContainer.innerHTML = '';

    const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD);
    ui.renderRecords(initialRecords, imageCache, false).then(() => {
        state.ui.recordsCurrentlyDisplayed = initialRecords.length;
    });

    ui.updateCatalogHeader(); // This function will now build breadcrumbs from the URL
}
