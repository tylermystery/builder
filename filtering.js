// REPLACE THE ENTIRE CONTENTS OF: filtering.js

import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import { getGroupPriceRange, getRecordPrice, parseOptions } from './utils.js';
import { calculateMissingCategories } from './availability.js'; // <-- IMPORT

// --- START: NEW RECOMMENDATION ENGINE V2.1 ---

/**
 * [v2.1] The "Goal Mapper" (Rosetta Stone).
 * Translates abstract user goals into weighted "Universal Profile" attributes.
 */
const GOAL_PROFILE_MAP = {
    // --- Abstract Goals (from text) ---
    "fun": { "Vibe.Energy": 1.0, "Vibe.Novelty": 0.5, "Vibe.Relaxation": -0.5 },
    "exciting": { "Vibe.Energy": 1.0, "Physicality.Intensity": 0.5 },
    "relaxing": { "Vibe.Relaxation": 1.0, "Vibe.Energy": -1.0 },
    "chill": { "Vibe.Relaxation": 1.0, "Vibe.Energy": -1.0 },
    "creative": { "Intellect.Creative": 1.0, "Vibe.Novelty": 0.5 },
    "art": { "Intellect.Creative": 1.0 },
    "artistic": { "Intellect.Creative": 1.0 },
    "team-build": { "Intellect.Analytical": 0.5, "Intellect.Creative": 0.5 },
    "team build": { "Intellect.Analytical": 0.5, "Intellect.Creative": 0.5 },
    "bonding": { "Vibe.Relaxation": 0.5, "Vibe.Formality": -0.5 },
    "competitive": { "Physicality.Intensity": 0.5, "Tags": "competitive" },
    "celebration": { "Vibe.Energy": 0.5, "Vibe.Formality": 0.5 },
    "celebrate": { "Vibe.Energy": 0.5, "Vibe.Formality": 0.5 },

    // --- Pillar Goals (Implicit) ---
    // These keys *must* match the strings from calculateMissingCategories
    "Activities": { "Pillars.Activity": 1.0 },
    "Food/Drink": { "Pillars.Food/Drink": 1.0 },
    "Venue": { "Pillars.Venue": 1.0 },
    "Extras": { "Pillars.Extras": 1.0 }
};

// These are the *only* keywords we look for in the "Goals/Notes" input.
// This is an optimization to avoid mapping every single word.
const GOAL_KEYWORDS = Object.keys(GOAL_PROFILE_MAP);

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
        // e.g., profile['Vibe']['Energy']
        return profile[keys[0]]?.[keys[1]] || 0;
    }
    return 0;
}

/**
 * [v2.1] Scans goal text for *all* matching ranking keywords.
 * @param {string} text - The user's "Goals/Notes" text.
 * @returns {Array<string>} A list of matching goals (e.g., ["fun", "art"])
 */
export function findGoalsInText(text) {
    if (!text) return [];
    const lowerText = text.toLowerCase();
    const foundGoals = new Set();

    GOAL_KEYWORDS.forEach(keyword => {
        if (lowerText.includes(keyword)) {
            foundGoals.add(keyword);
        }
    });
    return Array.from(foundGoals);
}

/**
 * [v2.1] Gets the user's complete "Goal Bucket" from all UI inputs.
 * @returns {Array<string>} The master list of goals (e.g., ["fun", "creative", "Venue", "taco tuesdays"])
 */
function getGoalBucket() {
    const goalText = document.getElementById('header-goals').value;
    const searchTerm = document.getElementById('name-filter').value.toLowerCase().trim();
    
    // 1. Implicit Goals (Missing Pillars)
    const missingPillars = calculateMissingCategories(); // e.g., ["Venue", "Food/Drink"]
    
    // 2. Explicit Goals (From Notes)
    const explicitGoals = findGoalsInText(goalText); // e.g., ["fun", "creative"]
    
    // 3. Search Goal (From Search Bar)
    const goalBucket = [...missingPillars, ...explicitGoals];
    if (searchTerm.length > 2) {
        goalBucket.push(searchTerm); // e.g., ["Venue", "Food/Drink", "fun", "creative", "escape room"]
    }
    
    return [...new Set(goalBucket)]; // Return unique list
}

/**
 * [v2.1] Calculates a single "Recommendation Score" for an item based on the user's Goal Bucket.
 * @param {object} record - The Airtable item record.
 * @param {Array<string>} goalBucket - The user's master goal list.
 * @returns {number} The final recommendation score.
 */
export function calculateRecommendationScore(record, goalBucket) {
    let finalScore = 0;
    let profile = null;

    // 1. Try to parse the Universal Profile JSON
    try {
        profile = JSON.parse(record.fields['Rankings'] || '{}');
    } catch (e) {
        // This item is un-profiled or has bad JSON
    }

    // 2. Handle Un-profiled Items (Fallback Logic)
    if (!profile || !profile.profileSource) {
        const searchTerm = document.getElementById('name-filter').value.toLowerCase().trim();
        if (searchTerm.length > 2) {
            // Use simple keyword matching as a fallback
            const name = (record.fields.Name || '').toLowerCase();
            const description = (record.fields.Description || '').toLowerCase();
            if (name.includes(searchTerm)) finalScore += 10;
            if (description.includes(searchTerm)) finalScore += 5;
        }
        return finalScore;
    }

    // 3. Handle Profiled Items (Hybrid Scoring Logic)
    const itemTags = new Set(profile.Tags || []);

    goalBucket.forEach(goal => {
        const goalLower = goal.toLowerCase();
        let goalScore = 0;

        // --- Brain 1: Attribute Mapper (for "fun", "creative", "Venue", etc.) ---
        if (GOAL_PROFILE_MAP[goalLower]) {
            const mapper = GOAL_PROFILE_MAP[goalLower];
            for (const attribute in mapper) {
                const weight = mapper[attribute];
                
                if (attribute === "Tags") {
                    // Special case: check if a required tag exists
                    if (itemTags.has(weight)) {
                        goalScore += 10; // Flat bonus for tag match
                    }
                } else {
                    // Standard weighted score
                    // e.g., itemScore (9) * weight (1.0) = 9
                    const itemScore = getProfileScore(profile, attribute);
                    goalScore += (itemScore * weight);
                }
            }
        } 
        // --- Brain 2: Robust Tag Matcher (for "tacos", "museum", etc.) ---
        else {
            // Check if the goal (e.g., "escape room") exists as a tag
            if (itemTags.has(goalLower)) {
                goalScore += 15; // High flat bonus for direct tag match
            } else {
                // Check if any tag *contains* the goal (e.g., tag "taco bar" contains "taco")
                for (const tag of itemTags) {
                    if (tag.includes(goalLower)) {
                        goalScore += 5; // Smaller bonus for partial match
                        break; // Only score once
                    }
                }
            }
        }
        
        finalScore += goalScore;
    });

    return finalScore;
}

// --- END: NEW RECOMMENDATION ENGINE V2.1 ---


// --- (Existing helper functions: getDescendantBookableItems, isGrouping, etc.) ---
// ... (keep all existing helper functions from here) ...
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
        // If \"Show All\" is selected, return everything
        return records;
    } else if (statusFilter === 'Available') {
        // If \"Available\" is selected, include both \"Available\" AND \"Featured\" items
        return records.filter(record => {
            const status = record.fields[CONSTANTS.FIELD_NAMES.STATUS]; // Get status once
            // Check if status exists AND matches either \"Available\" or \"Featured\"
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
        // Parse range like \"11-25\" or \"250-plus\"
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

// --- REPLACE THE `filterBySearchTerm` FUNCTION ---
function filterBySearchTerm(records, searchTerm) {
    // This function is now ONLY used if the v2.1 Engine is NOT active (e.g., sort != recommended)
    // OR as a fallback for un-profiled items.
    if (!searchTerm) {
        return records; // No search term, return all records
    }
    const lowerSearchTerm = searchTerm.toLowerCase();

    return records.filter(record => {
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

        return name.includes(lowerSearchTerm) ||
               description.includes(lowerSearchTerm) ||
               allOtherText.includes(lowerSearchTerm);
    });
}
// --- END REPLACEMENT ---


// --- REPLACE THE `sortRecords` FUNCTION ---
function sortRecords(records, sortBy) {
    // --- NEW: v2.1 "Recommended" Sort ---
    if (sortBy === 'recommended') {
        // 1. Get the single Goal Bucket for this sort pass
        const goalBucket = getGoalBucket();
        
        // 2. Score every record once
        const scoredRecords = records.map(record => ({
            record,
            score: calculateRecommendationScore(record, goalBucket)
        }));
        
        // 3. Sort by the calculated score, highest to lowest
        return scoredRecords
            .filter(item => item.score > 0) // Only show items that match at all
            .sort((a, b) => b.score - a.score)
            .map(item => item.record); // Return just the records
    }
    // --- END NEW SORT ---
    
    // --- EXISTING LOGIC (Fallback for other sorts) ---
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
// --- END REPLACEMENT ---


// --- REPLACE THE `applyFiltersAndSort` FUNCTION ---
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
         
         // --- v2.1 LOGIC: Apply filters *unless* sorting by recommended ---
         // If sorting by "recommended", the filters are part of the scoring.
         // If sorting by Price/Name, we apply filters first.
         if (sortBy !== 'recommended') {
            recordsToDisplay = filterByStatus(recordsToDisplay, statusFilter);
            recordsToDisplay = filterByHeadcount(recordsToDisplay, headcountFilter, customHeadcount);
            recordsToDisplay = filterByLocation(recordsToDisplay, locationFilter);
            recordsToDisplay = filterByBudget(recordsToDisplay, budgetFilter);
            recordsToDisplay = filterBySearchTerm(recordsToDisplay, searchTerm);
         }
         // --- END v2.1 LOGIC ---
    }

    // --- Sort the Final List ---
    // This function now handles all logic, including "recommended"
    recordsToDisplay = sortRecords(recordsToDisplay, sortBy);

    // --- Update State & Render ---
    state.records.filtered = recordsToDisplay;
    state.ui.recordsCurrentlyDisplayed = 0;

    if (catalogContainer) catalogContainer.innerHTML = '';

    const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD);
    ui.renderRecords(initialRecords, imageCache, false).then(() => {
        state.ui.recordsCurrentlyDisplayed = initialRecords.length;
    });

    ui.updateCatalogHeader();
}
// --- END REPLACEMENT ---
