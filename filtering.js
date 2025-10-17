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

function filterByCategoryAndSubcategory(recordsInStore, selectedCategory, activeSubcategories) {
    if (selectedCategory === 'all') {
        // Show only top-level items (no Parent Item) in the "All" view
        return recordsInStore.filter(r => !r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]);
    }

    const selectedCategoryLower = selectedCategory.toLowerCase();
    // Start with items matching the main category
    let finalItems = recordsInStore.filter(record => {
        const itemCategories = (record.fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '')
            .split(',')
            .map(cat => cat.trim().toLowerCase());
        return itemCategories.includes(selectedCategoryLower);
    });
    // If subcategories are selected, further filter the results
    if (activeSubcategories.length > 0) {
        finalItems = finalItems.filter(record => {
            const itemSubcategories = (record.fields.Subcategories || '')
                .split(',')
                .map(sc => sc.trim().toLowerCase());
            // Item must match at least one of the active subcategories
            return activeSubcategories.some(activeSubcat => itemSubcategories.includes(activeSubcat));
        });
    }

    return finalItems; // Return items matching category and any selected subcategories
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

export function applyFiltersAndSort(imageCache) {
    const catalogTitle = document.getElementById('catalog-title');
    const planFilterBtn = document.getElementById('plan-filter-btn');

    // Handle "My Plan" view separately
    if (planFilterBtn && planFilterBtn.classList.contains('active')) {
        const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Your';
        if (catalogTitle) {
            catalogTitle.textContent = `${eventName} Plan & Ideas`;
            catalogTitle.style.display = 'block';
        }

        // Get IDs from both favorites and locked items
        const lockedItemIds = Array.from(state.cart.lockedItems.keys());
        const itemIds = Array.from(state.cart.items.keys());
        const allPlanRecordIds = [...lockedItemIds, ...itemIds];
        // Find the full records corresponding to these IDs
        const recordsToDisplay = allPlanRecordIds.map(id =>
            state.records.all.find(record => record.id === id)
        ).filter(Boolean); // Filter out any nulls if a record wasn't found

        state.records.filtered = recordsToDisplay; // Update state with filtered list
        state.ui.recordsCurrentlyDisplayed = 0; // Reset display count
        // Render these records
        ui.renderRecords(recordsToDisplay, imageCache, false).then(() => {
            state.ui.recordsCurrentlyDisplayed = recordsToDisplay.length;
        });
        return; // Exit early for "My Plan" view
    }

    // Hide catalog title if not in "My Plan" view
    if (catalogTitle) {
        catalogTitle.style.display = 'none';
    }

    // Get current filter values from the UI
    const activeCategoryButton = document.querySelector('#category-filters .filter-btn.active');
    const selectedCategory = activeCategoryButton ?
        (activeCategoryButton.dataset.filter === 'all' ? 'all' : activeCategoryButton.textContent) : 'all'; // Default to 'all'
    const activeSubcategoryNodes = document.querySelectorAll('#subcategory-filters .filter-btn.active');
    const activeSubcategories = Array.from(activeSubcategoryNodes).map(btn => btn.dataset.filter);
    const searchTerm = document.getElementById('name-filter').value.toLowerCase();
    const statusFilter = document.getElementById('status-filter').value;
    const headcountFilter = document.getElementById('headcount-filter').value;
    const customHeadcount = document.getElementById('headcount-custom').value;
    const locationFilter = document.getElementById('location-filter').value;
    const budgetFilter = document.getElementById('budget-filter').value;
    const sortBy = document.getElementById('sort-by').value;

    // Start with all records associated with the current store
    let recordsForCurrentStore = state.records.all.filter(record =>
        record.fields.Stores && record.fields.Stores.includes(state.ui.activeShopId)
    );

    // Apply filters sequentially
    let recordsToDisplay = filterByCategoryAndSubcategory(recordsForCurrentStore, selectedCategory, activeSubcategories);

    // --- DEBUG START ---
    console.log(`[DEBUG] Records BEFORE status filter ('${statusFilter}'):`, recordsToDisplay.length, recordsToDisplay.map(r => r.fields.Name + ':' + r.fields.Status));
    // --- DEBUG END ---

    recordsToDisplay = filterByStatus(recordsToDisplay, statusFilter);

    // --- DEBUG START ---
    console.log(`[DEBUG] Records AFTER status filter ('${statusFilter}'):`, recordsToDisplay.length, recordsToDisplay.map(r => r.fields.Name + ':' + r.fields.Status));
    // --- DEBUG END ---

    recordsToDisplay = filterByHeadcount(recordsToDisplay, headcountFilter, customHeadcount);
    recordsToDisplay = filterByLocation(recordsToDisplay, locationFilter);
    recordsToDisplay = filterByBudget(recordsToDisplay, budgetFilter);
    recordsToDisplay = filterBySearchTerm(recordsToDisplay, searchTerm);

    // Apply sorting last
    recordsToDisplay = sortRecords(recordsToDisplay, sortBy);

    // Update state with the final filtered and sorted list
    state.records.filtered = recordsToDisplay;
    state.ui.recordsCurrentlyDisplayed = 0; // Reset display count for rendering

    // Render the initial batch of records
    const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD);
    ui.renderRecords(initialRecords, imageCache, false).then(() => {
        state.ui.recordsCurrentlyDisplayed = initialRecords.length; // Update count after rendering
    });

    // Update UI elements like breadcrumbs
    ui.updateCatalogHeader();
}
