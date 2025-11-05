// REPLACE THE ENTIRE CONTENTS OF: filtering.js

import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import { getGroupPriceRange, getRecordPrice, parseOptions } from './utils.js';
import { calculateMissingCategories, buildGoalBucket } from './availability.js';

// --- START: RECOMMENDATION ENGINE V2.1 (DUAL-PROFILE) ---

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
    "Activities": { "Pillars.Activity": 1.0 },
    "Food/Drink": { "Pillars.Food/Drink": 1.0 },
    "Venue": { "Pillars.Venue": 1.0 },
    "Extras": { "Pillars.Extras": 1.0 }
};

/**
 * [v1.2] Keywords for the old "Rankings" (v1.2) profile.
 */
const V1_2_GOAL_KEYWORDS = {
    "fun": "Fun", "art": "Art", "artistic": "Art", "celebration": "Celebration",
    "celebrate": "Celebration", "competitive": "Competitive", "compete": "Competitive",
    "team-build": "Team-Build", "team build": "Team-Build", "bonding": "Bonding"
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
        return profile[keys[0]]?.[keys[1]] || 0;
    }
    return 0;
}

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
 * [v2.1] Scores an item based on the "Universal Profile" (AI_Profile field).
 * @param {object} profile - The parsed v2.1 profile object.
 * @param {Array<string>} goalBucket - The user's master goal list.
 * @param {string} searchText - The user's search query.
 * @returns {number} The final recommendation score.
 */
function calculateV2_1_Score(profile, goalBucket, searchText) {
    let finalScore = 0;
    const { Tags = [], ...attributes } = profile;

    goalBucket.forEach(goal => {
        const goalLower = goal.toLowerCase();

        // 1. Check "Brain 1" (The "Smart" Mapper)
        if (GOAL_PROFILE_MAP[goalLower]) {
            const mapper = GOAL_PROFILE_MAP[goalLower];
            for (const key in mapper) {
                const weight = mapper[key];
                
                if (key === 'Tags') {
                    if (Tags.includes(weight)) {
                        finalScore += 10; // Flat bonus for mapped tag
                    }
                } else {
                    const itemScore = getProfileScore(attributes, key); // 0-10
                    finalScore += (itemScore * weight);
                }
            }
        }
        // 2. Check "Brain 2" (The "Robust" Tagger)
        else if (goalLower === searchText) {
            const TAG_BONUS = 15; // High-priority bonus for direct search match
            if (Tags.some(tag => tag.includes(goalLower))) {
                finalScore += TAG_BONUS;
            }
        }
    });
    return finalScore;
}

/**
 * [v1.2] Scores an item based on the *old* "Rankings" field.
 * @param {object} profile - The parsed v1.2 profile object.
 * @param {Array<string>} goalBucket - The user's master goal list.
 * @returns {number} The final recommendation score.
 */
function calculateV1_2_Score(profile, goalBucket) {
    let finalScore = 0;
    
    goalBucket.forEach(goal => {
        const goalLower = goal.toLowerCase();
        
        // 1. Check Pillars
        if (goal === "Activities" && (profile.Activities || 0) > 0) finalScore += 10;
        if (goal === "Food/Drink" && (profile["Food/Drink"] || 0) > 0) finalScore += 10;
        if (goal === "Venue" && (profile.Venue || 0) > 0) finalScore += 10;
        if (goal === "Extras" && (profile.Extras || 0) > 0) finalScore += 10;

        // 2. Check Mapped Goals
        const mappedGoal = V1_2_GOAL_KEYWORDS[goalLower];
        if (mappedGoal && (profile[mappedGoal] || 0) >= 4) {
            finalScore += 15; // High score for matching an old goal
        }
    });
    return finalScore;
}


/**
 * [v2.1] The "Master Router" for scoring.
 * It checks for a v2.1 profile, then a v1.2 profile, then falls back to search.
 */
function calculateRecommendationScore(record, goalBucket) {
    const searchText = document.getElementById('name-filter')?.value?.trim().toLowerCase() || '';

    // 1. Try to parse v2.1 "AI_Profile"
    try {
        const v2_1_Profile = JSON.parse(record.fields.AI_Profile || '{}');
        if (v2_1_Profile.profileSource) {
            return calculateV2_1_Score(v2_1_Profile, goalBucket, searchText);
        }
    } catch (e) { /* Not a v2.1 profile, continue */ }

    // 2. Try to parse v1.2 "Rankings"
    try {
        const v1_2_Profile = JSON.parse(record.fields.Rankings || '{}');
        // Check if it's a non-empty object and NOT a v2.1 profile
        if (Object.keys(v1_2_Profile).length > 0 && !v1_2_Profile.profileSource) {
            return calculateV1_2_Score(v1_2_Profile, goalBucket);
        }
    } catch (e) { /* Not a v1.2 profile, continue */ }

    // 3. Fallback to basic search
    return calculateBasicSearchScore(record, searchText);
}

// --- END: RECOMMENDATION ENGINE ---

// --- (Existing Helper Functions) ---

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
        'sf': 'San Francisco', 'oakland': 'Oakland', 'peninsula': 'Peninsula',
        'south-bay': 'South Bay', 'north-bay': 'North Bay', 'east-bay': 'East Bay', 'other': 'Other'
    };
    const targetRegion = filterValueToRegion[locationFilter];
    return records.filter(record => {
        const recordRegions = record.fields['Region'] || [];
        if (recordRegions.length > 0) {
            return recordRegions.includes('All') || recordRegions.includes(targetRegion);
        }
        return false;
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
    // --- NEW: "Recommended" sort uses the master router ---
    if (sortBy === 'recommended') {
        const log = (typeof ui !== 'undefined' && ui.log) ? ui.log : console.log;
        log('Filtering', `Sorting by v2.1 "Recommended". Goal Bucket: [${goalBucket.join(', ')}]`);

        const scoredRecords = records.map(record => ({
            record,
            score: calculateRecommendationScore(record, goalBucket)
        }));

        scoredRecords.sort((a, b) => b.score - a.score);
        return scoredRecords.map(item => item.record);
    }
    
    // --- EXISTING LOGIC (Fallback) ---
    return records.sort((a, b) => {
        const aIsFeatured = a.fields[CONSTANTS.FIELD_NAMES.STATUS] === 'Featured';
        const bIsFeatured = b.fields[CONSTANTS.FIELD_NAMES.STATUS] === 'Featured';
        if (aIsFeatured && !bIsFeatured) return -1;
        if (!aIsFeatured && bIsFeatured) return 1;

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

// --- MAIN EXPORTED FUNCTION --

export function applyFiltersAndSort(imageCache) {
    const catalogContainer = document.getElementById('catalog-container');
    const catalogTitle = document.getElementById('catalog-title');
    const planFilterBtn = document.getElementById('plan-filter-btn');
    const likesFilterBtn = document.getElementById('liked-items-filter-btn');

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

    // --- NEW: Build the Goal Bucket for sorting ---
    const goalBucket = buildGoalBucket();

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
        
    } else {
         // --- Standard Category/All View ---
         recordsToDisplay = filterByCategoryAndSubcategory(baseRecordsToFilter, selectedCategory, activeSubcategories);
         recordsToDisplay = filterByStatus(recordsToDisplay, statusFilter);
         recordsToDisplay = filterByHeadcount(recordsToDisplay, headcountFilter, customHeadcount);
         recordsToDisplay = filterByLocation(recordsToDisplay, locationFilter);
         recordsToDisplay = filterByBudget(recordsToDisplay, budgetFilter);
         
         // --- WORKAROUND: If not sorting by recommended, use old search ---
         if (sortBy !== 'recommended' && searchTerm) {
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

    ui.updateCatalogHeader();
}
