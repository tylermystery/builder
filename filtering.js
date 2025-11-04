// REPLACE THE ENTIRE CONTENTS OF: filtering.js

import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import { getGroupPriceRange, getRecordPrice, parseOptions } from './utils.js';

// --- HELPER FUNCTIONS (Moved to the top) ---

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

// --- ADD THIS NEW HELPER FUNCTION near the top of the file ---
/**
 * Scans goal text for the first matching ranking keyword.
 * @param {string} text - The user's "Goals/Notes" text.
 * @returns {string | null} The first matching goal (e.g., "Fun") or null.
 */
function findGoalInText(text) {
    if (!text) return null;
    const lowerText = text.toLowerCase();
    
    // These keywords MUST exactly match the keys you just imported
    // from the CSV (e.g., "Fun", "Art", "Celebration", "Competitive")
    const GOAL_KEYWORDS = {
        "fun": "Fun",
        "art": "Art",
        "artistic": "Art",
        "celebration": "Celebration",
        "celebrate": "Celebration",
        "competitive": "Competitive",
        "compete": "Competitive",
        "team-build": "Team-Build",
        "team build": "Team-Build",
        "bonding": "Bonding"
        // Add more keyword-to-goal mappings here
    };

    for (const keyword in GOAL_KEYWORDS) {
        if (lowerText.includes(keyword)) {
            return GOAL_KEYWORDS[keyword]; // Return the proper-cased Goal
        }
    }
    return null; // No goal found
}

// --- REPLACE the existing `sortRecords` function with this new version ---
function sortRecords(records, sortBy) {
    // --- NEW: Check for "Recommended" sort ---
    if (sortBy === 'recommended') {
        const goalText = document.getElementById('header-goals').value;
        const goal = findGoalInText(goalText);
        
        // We only sort if a valid goal was found in the text
        if (goal) {
            log('Filtering', `Sorting by recommended goal: "${goal}"`);
            return records.sort((a, b) => {
                let scoreA = 0;
                let scoreB = 0;

                try {
                    // Get the rankings JSON from the record
                    const rankingsA = JSON.parse(a.fields['Rankings'] || '{}');
                    const rankingsB = JSON.parse(b.fields['Rankings'] || '{}');
                    
                    // Get the score for the *specific goal*
                    scoreA = rankingsA[goal] || 0;
                    scoreB = rankingsB[goal] || 0;
                } catch (e) {
                    // In case of bad JSON, scores remain 0
                }
                
                // Sort by the goal score, highest to lowest
                return scoreB - scoreA;
            });
        }
        // If no goal is found, we fall through to the default sort (Featured, then Price)
        log('Filtering', 'Sort by "Recommended" selected, but no goal text. Using default sort.');
    }
    
    // --- EXISTING LOGIC (Fallback) ---
    // (This part is the same as in your original file)
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
            default: return 0;
        }
    });
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
    // --- END NEW LOGIC ---

    // If subcategories are selected, further filter the category results.
    if (activeSubcategories.length > 0) {
        // --- NEW LOGIC: Check Subcategories and Parent Item for the selected subcategories ---
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
         // --- END NEW LOGIC ---
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

    return records.filter(record => {
        // Assuming 'Region' is a multi-select field in Airtable
        const recordRegions = record.fields['Region'] || [];
        if (recordRegions.length > 0) {
            // Keep if regions include 'All' or the specific target region
            return recordRegions.includes('All') || recordRegions.includes(targetRegion);
        }
        return false; // Exclude if no region is set
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

function sortRecords(records, sortBy) {
    return records.sort((a, b) => {
        // --- START NEW SORTING LOGIC ---
        // 1. Prioritize 'Featured' items
        const aIsFeatured = a.fields[CONSTANTS.FIELD_NAMES.STATUS] === 'Featured';
        const bIsFeatured = b.fields[CONSTANTS.FIELD_NAMES.STATUS] === 'Featured';

        if (aIsFeatured && !bIsFeatured) {
            return -1; // a comes first
        }
        if (!aIsFeatured && bIsFeatured) {
            return 1; // b comes first
        }
        // --- END NEW SORTING LOGIC ---

        // 2. Fallback to original user-selected sorting if statuses are the same (both featured or both not)
        const aPrice = getGroupPriceRange(a)?.min ?? parseFloat(String(a.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
        const bPrice = getGroupPriceRange(b)?.min ?? parseFloat(String(b.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
        const aName = a.fields[CONSTANTS.FIELD_NAMES.NAME] || '';
        const bName = b.fields[CONSTANTS.FIELD_NAMES.NAME] || '';

        switch (sortBy) {
            case 'price-asc': return aPrice - bPrice;
            case 'price-desc': return bPrice - aPrice;
            case 'name-asc': return aName.localeCompare(bName);
            default: return 0; // Default case, no change in order
        }
    });
}

// --- MAIN EXPORTED FUNCTION ---

// FILE: filtering.js (REPLACE ENTIRE applyFiltersAndSort function)

export function applyFiltersAndSort(imageCache) {
    const catalogContainer = document.getElementById('catalog-container'); // Get container for clearing later
    const catalogTitle = document.getElementById('catalog-title'); //
    const planFilterBtn = document.getElementById('plan-filter-btn'); //
    const likesFilterBtn = document.getElementById('liked-items-filter-btn'); //

    // Get filter values from UI elements
    const activeCategoryButton = document.querySelector('#category-filters .filter-btn.active'); //
    const selectedCategory = activeCategoryButton ? activeCategoryButton.dataset.filter : 'all'; // Default to 'all' if somehow none is active
    const activeSubcategoryNodes = document.querySelectorAll('#subcategory-filters .filter-btn.active'); //
    const activeSubcategories = Array.from(activeSubcategoryNodes).map(btn => btn.dataset.filter); //
    const searchTerm = document.getElementById('name-filter').value.toLowerCase(); //
    const statusFilter = document.getElementById('status-filter').value; //
    const headcountFilter = document.getElementById('headcount-filter').value; //
    const customHeadcount = document.getElementById('headcount-custom').value; //
    const locationFilter = document.getElementById('location-filter').value; //
    const budgetFilter = document.getElementById('budget-filter').value; //
    const sortBy = document.getElementById('sort-by').value; //

    // --- Determine Base Record Set ---
    let baseRecordsToFilter = state.records.all.filter(record =>
        record.fields.Stores && record.fields.Stores.includes(state.ui.activeShopId)
    ); // Start with records for the current store

    // Reset title initially
    if (catalogTitle) catalogTitle.style.display = 'none';

    // --- Apply Special Views (My Plan / My Likes) ---
    if (planFilterBtn && planFilterBtn.classList.contains('active')) {
        // --- "My Plan" View ---
        const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Your'; //
        if (catalogTitle) {
            catalogTitle.textContent = `${eventName} Plan & Ideas`; //
            catalogTitle.style.display = 'block'; //
        }
        const lockedItemIds = Array.from(state.cart.lockedItems.keys()); //
        const ideaItemIds = Array.from(state.cart.items.keys()); // Renamed from items to ideaItems
        const allPlanRecordIds = [...lockedItemIds, ...ideaItemIds]; //
        baseRecordsToFilter = allPlanRecordIds.map(id => state.records.all.find(record => record.id === id)).filter(Boolean); //
        // For "My Plan", we usually don't apply further filters, but show everything in the plan/ideas.
        // We will skip other filters and just sort/render this set.
    } else if (likesFilterBtn && likesFilterBtn.classList.contains('active')) {
        // --- "My Likes" View ---
        if (catalogTitle) {
            catalogTitle.textContent = `My Liked Items`; //
            catalogTitle.style.display = 'block'; //
        }
        let likedIds = new Set();
        if (state.session.user.isAuthenticated) {
            likedIds = state.session.user.likedItemIds; // Use persistent likes
        } else {
            try {
                likedIds = new Set(JSON.parse(localStorage.getItem('tempLikes') || '[]')); // Use temporary likes
            } catch (e) { console.error("Error reading tempLikes for filtering:", e); }
        }
        baseRecordsToFilter = baseRecordsToFilter.filter(record => likedIds.has(record.id)); // Filter the store records by liked IDs
        // Filters will be applied to this liked subset below.
    } else {
         // --- Standard Category/All View ---
         // Apply category/subcategory filtering to the store records
         baseRecordsToFilter = filterByCategoryAndSubcategory(baseRecordsToFilter, selectedCategory, activeSubcategories); //
         // Filters will be applied below.
    }

    // --- Apply Standard Filters (to the determined base set) ---
    let recordsToDisplay = baseRecordsToFilter; // Start with the result from above

    // Don't apply standard filters if in "My Plan" view (usually desired behavior)
    if (!planFilterBtn || !planFilterBtn.classList.contains('active')) {
         recordsToDisplay = filterByStatus(recordsToDisplay, statusFilter); //
         recordsToDisplay = filterByHeadcount(recordsToDisplay, headcountFilter, customHeadcount); //
         recordsToDisplay = filterByLocation(recordsToDisplay, locationFilter); //
         recordsToDisplay = filterByBudget(recordsToDisplay, budgetFilter); //
         recordsToDisplay = filterBySearchTerm(recordsToDisplay, searchTerm); //
    }

    // --- Sort the Final List ---
    recordsToDisplay = sortRecords(recordsToDisplay, sortBy); // Apply sorting

    // --- Update State & Render ---
    state.records.filtered = recordsToDisplay; // Update state
    state.ui.recordsCurrentlyDisplayed = 0; // Reset display count

    // Clear previous results before rendering new ones
    if (catalogContainer) catalogContainer.innerHTML = '';

    const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD); //
    ui.renderRecords(initialRecords, imageCache, false).then(() => { //
        state.ui.recordsCurrentlyDisplayed = initialRecords.length; //
    });

    ui.updateCatalogHeader(); // Update breadcrumbs
}
