// REPLACE THE ENTIRE CONTENTS OF: filtering.js

import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import { getGroupPriceRange, getRecordPrice, parseOptions } from './utils.js';
import { calculateMissingCategories, buildGoalBucket } from './availability.js'; // <-- CORRECT IMPORT

// --- START: NEW RECOMMENDATION ENGINE V2.1 ---

/**
 * [v2.1] The "Goal Mapper" (Rosetta Stone).
 * Translates abstract user goals into weighted "Universal Profile" attributes.
 */
const GOAL_PROFILE_MAP = {
    // --- Abstract Goals (from text) ---
    "fun": { "Vibe.Energy": 1.0, "Vibe.Novelty": 0.5, "Vibe.Relaxation": -0.5 },
    "exciting": { "Vibe.Energy": 1.0, "Physicality.Intensity": 0.5 },
    
    // --- NEW SYNONYMS & MAPPERS ---
    "social": { "Vibe.Energy": 0.5, "Vibe.Formality": -0.5, "Vibe.Relaxation": 0.5 },
    "joy": { "Vibe.Energy": 0.8, "Vibe.Novelty": 0.5 },
    "lively": { "Vibe.Energy": 1.0 },
    "calm": { "Vibe.Relaxation": 1.0, "Vibe.Energy": -0.8 },
    "quiet": { "Vibe.Relaxation": 1.0, "Vibe.Energy": -0.8 },
    "unique": { "Vibe.Novelty": 1.0 },
    "challenging": { "Intellect.Analytical": 0.7, "Physicality.Intensity": 0.5 },
    // --- END NEW SYNONYMS ---
    
    "relaxing": { "Vibe.Relaxation": 1.0, "Vibe.Energy": -1.0 },
    "chill": { "Vibe.Relaxation": 1.0, "Vibe.Energy": -1.0 },
    "creative": { "Intellect.Creative": 1.0, "Vibe.Novelty": 0.5 },
    "art": { "Intellect.Creative": 1.0 },
    "artistic": { "Intellect.Creative": 1.0 },
    "team-build": { "Intellect.Analytical": 0.5, "Intellect.Creative": 0.5 },
    "team building": { "Intellect.Analytical": 0.5, "Intellect.Creative": 0.5 }, // Corrected case sensitivity match for "team building"
    "bonding": { "Vibe.Relaxation": 0.5, "Vibe.Formality": -0.5 },
    "competitive": { "Physicality.Intensity": 0.5, "Tags": "competitive" },
    "celebration": { "Vibe.Energy": 0.5, "Vibe.Formality": 0.5 },
    "celebrate": { "Vibe.Energy": 0.5, "Vibe.Formality": 0.5 },

    // --- Pillar Goals (Implicit) ---
    "Activities": { "Pillars.Activity": 1.0 },
    "Food/Drink": { "Pillars.Food/Drink": 1.0 },
    "Venue": { "Pillars.Venue": 1.0 },
    "Extras": { "Pillars.Extras": 1.0 }
};
/**
 * [v2.1] Helper to safely get a nested value (e.g., "Vibe.Energy") from a profile.
 * @param {object} profile - The parsed Rankings JSON.
 * @param {string} key - The dot-notation key (e.g., "Vibe.Energy").
 * @returns {number} The score (0-10) or 0 if not found.
 */
function getProfileScore(profile, key) {
    if (!profile || !key) return 0;
    const keys = key.split('.');
    if (keys.length === 2) {
        // Accessing nested profile[keys[0]][keys[1]]
        return profile[keys[0]]?.[keys[1]] || 0;
    }
    return 0;
}

// --- END: NEW RECOMMENDATION ENGINE V2.1 ---


// --- HELPER FUNCTIONS (Moved to the top) ---

/**
 * [v2.1] Fallback scoring for un-profiled items.
 * @param {object} record - The Airtable record.
 * @param {string} searchText - The user's search query.
 * @returns {number} A simple keyword-match score.
 */
function calculateBasicSearchScore(record, searchText) {
    if (!searchText) return 0;
    
    const name = (record.fields.Name || '').toLowerCase();
    const description = (record.fields.Description || '').toLowerCase();
    const tags = (record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS] || '').toLowerCase();
    
    if (name.includes(searchText)) return 10;
    if (description.includes(searchText)) return 5;
    if (tags.includes(searchText)) return 3;
    return 0;
}

/**
 * [v2.1] Calculates the "Universal Profile" score for an item.
 * @param {object} record - The Airtable record.
 * @param {Array<string>} goalBucket - The user's master goal list.
 * @returns {number} The final recommendation score.
 */
function calculateRecommendationScore(record, goalBucket) {
    let finalScore = 0;
    const searchText = document.getElementById('name-filter')?.value?.trim().toLowerCase() || '';

    let profile;
    try {
        // --- THIS IS THE CHANGE ---
        // Try to parse the new v2.1 AI_Profile
        profile = JSON.parse(record.fields.AI_Profile || '{}');
        // --- END CHANGE ---
        if (!profile.profileSource) throw new Error('Not a v2.1 profile.');
    } catch (e) {
        // Fallback for old/empty items
        return calculateBasicSearchScore(record, searchText);
    }

    const { profileSource, Tags = [], ...attributes } = profile;

    // --- HYBRID SCORING LOGIC ---
    goalBucket.forEach(goal => {
        const goalLower = goal.toLowerCase();

        // 1. Check "Brain 1" (The "Smart" Mapper)
        if (GOAL_PROFILE_MAP[goalLower]) {
            const mapper = GOAL_PROFILE_MAP[goalLower];
            for (const key in mapper) {
                const weight = mapper[key];
                
                if (key === 'Tags') {
                    // Special case for tag-based mappers (e.g., "competitive")
                    if (Tags.includes(weight)) {
                        finalScore += 10; // Add a flat bonus for mapped tag matches
                    }
                } else {
                    // Standard attribute scoring (e.g., "Vibe.Energy")
                    const itemScore = getProfileScore(attributes, key); // 0-10
                    finalScore += (itemScore * weight);
                }
            }
        }
        // 2. Check "Brain 2" (The "Robust" Tagger)
        // (Only run if this goal IS the search text, to avoid double-scoring)
        else if (goalLower === searchText) {
            const TAG_BONUS = 15; // High-priority bonus for direct search match
            if (Tags.some(tag => tag.includes(goalLower))) {
                finalScore += TAG_BONUS;
            }
        }
    });

    return finalScore;
}


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

// In: filtering.js
// Action: REPLACE the entire filterByLocation function

// In: filtering.js
// Action: REPLACE the entire filterByLocation function

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
    // --- NEW: Check for "Recommended" sort ---
    if (sortBy === 'recommended') {
        const log = (typeof ui !== 'undefined' && ui.log) ? ui.log : console.log;
        log('Filtering', `Sorting by v2.1 "Recommended". Goal Bucket: [${goalBucket.join(', ')}]`);

        // Create a scored list
        const scoredRecords = records.map(record => ({
            record,
            score: calculateRecommendationScore(record, goalBucket)
        }));

        // Sort by the new score, highest to lowest
        scoredRecords.sort((a, b) => b.score - a.score);

        return scoredRecords.map(item => item.record);
    }
    
    // --- EXISTING LOGIC (Fallback) ---
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
            default: return 0; // Default case, no change in order
        }
    });
}
// In: filtering.js
// Action: REPLACE the entire applyFiltersAndSort function

export function applyFiltersAndSort(imageCache) {
    const catalogContainer = document.getElementById('catalog-container');
    const catalogTitle = document.getElementById('catalog-title');
    const planFilterBtn = document.getElementById('plan-filter-btn');
    const likesFilterBtn = document.getElementById('liked-items-filter-btn');

    // Get filter values from UI elements
    const activeCategoryButton = document.querySelector('#category-filters .filter-btn.active');
    const selectedCategory = activeCategoryButton ? activeCategoryButton.dataset.filter : 'all';
    const activeSubcategoryNodes = document.querySelectorAll('#subcategory-filters .filter-btn.active');
    const activeSubcategories = Array.from(activeSubcategoryNodes).map(btn => btn.dataset.filter);
    const searchTerm = document.getElementById('name-filter').value.toLowerCase();
    const statusFilter = document.getElementById('status-filter').value;
    const headcountFilter = document.getElementById('headcount-filter').value;
    const customHeadcount = document.getElementById('headcount-custom').value;
    const locationFilter = document.getElementById('location-filter').value;
    const budgetFilter = document.getElementById('budget-filter').value;
    const sortBy = document.getElementById('sort-by').value;

    // --- VVV NEW: Build the Goal Bucket based on SortBy selection VVV ---
    const includeGoals = (sortBy === 'recommended-goals');
    const goalBucket = buildGoalBucket(includeGoals);
    // --- ^^^ END NEW ^^^

    let baseRecordsToFilter = state.records.all.filter(record =>
        record.fields.Stores && record.fields.Stores.includes(state.ui.activeShopId)
    );

    if (catalogTitle) catalogTitle.style.display = 'none';

    let recordsToDisplay;

    if (planFilterBtn && planFilterBtn.classList.contains('active')) {
        // --- "My Plan" View ---
        const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Your';
        if (catalogTitle) {
            catalogTitle.textContent = `${eventName} Plan & Ideas`;
            catalogTitle.style.display = 'block';
        }
        const lockedItemIds = Array.from(state.cart.lockedItems.keys());
        const ideaItemIds = Array.from(state.cart.items.keys());
        const allPlanRecordIds = [...lockedItemIds, ...ideaItemIds];
        recordsToDisplay = allPlanRecordIds.map(id => state.records.all.find(record => record.id === id)).filter(Boolean);
        
        // Note: No other filters are applied

    } else if (likesFilterBtn && likesFilterBtn.classList.contains('active')) {
        // --- "My Likes" View ---
        if (catalogTitle) {
            catalogTitle.textContent = `My Liked Items`;
            catalogTitle.style.display = 'block';
        }
        let likedIds = new Set();
        if (state.session.user.isAuthenticated) {
            likedIds = state.session.user.likedItemIds;
        } else {
            try {
                likedIds = new Set(JSON.parse(localStorage.getItem('tempLikes') || '[]'));
            } catch (e) { console.error("Error reading tempLikes for filtering:", e); }
        }
        recordsToDisplay = baseRecordsToFilter.filter(record => likedIds.has(record.id));
        
        // Note: No other filters are applied

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

    // --- Sort the Final List (pass the goalBucket) ---
    recordsToDisplay = sortRecords(recordsToDisplay, sortBy, goalBucket);

    // --- Update State & Render ---
    state.records.filtered = recordsToDisplay;
    state.ui.recordsCurrentlyDisplayed = 0;

    if (catalogContainer) catalogContainer.innerHTML = '';

    const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD);
    ui.renderRecords(initialRecords, imageCache, false).then(() => {
        state.ui.recordsCurrentlyDisplayed = initialRecords.length;
    });

    ui.updateCatalogHeader(); // This function will be updated to show the search term
}
