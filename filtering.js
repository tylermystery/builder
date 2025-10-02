// FILE: filtering.js
// PASTE THIS ENTIRE CODE INTO: filtering.js
import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';

// --- START DEBUGGING LOGS ---
console.log('[Filtering] Initializing filtering.js. Total records loaded:', state.records.all.length, 'Total stores loaded:', state.stores.all.length);
// --- END DEBUGGING LOGS ---

function getDescendantBookableItems(record, allRecordsInStore, allRecordNames) {
    let bookableItems = [];
    // Find items within the current store whose Parent Item matches the record's name
    const children = allRecordsInStore.filter(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] === record.fields.Name);
    
    // --- START DEBUGGING LOGS ---
    console.log(`[getDescendantBookableItems] Finding children for "${record.fields.Name}". Found ${children.length} direct children.`);
    // --- END DEBUGGING LOGS ---

    for (const child of children) {
        if (isGrouping(child, allRecordNames)) {
            // If a child is a grouping (a sub-category), recurse to find its children
            bookableItems = bookableItems.concat(getDescendantBookableItems(child, allRecordsInStore, allRecordNames));
        } else {
            // If it's a final item, add it to the list
            bookableItems.push(child);
        }
    }
    return bookableItems;
}

function isGrouping(record, allRecordNames) {
    const rawOptions = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    return rawOptions.some(opt => allRecordNames.has(opt.name));
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
    const allRecordNames = new Set(recordsInStore.map(r => r.fields.Name));

    // If "All" is selected, show top-level grouping items, just like before.
    if (selectedCategory === 'all') {
        // This keeps the initial catalog view of "Grouping" items intact.
        const topLevelItems = recordsInStore.filter(r => !r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]);
        return topLevelItems;
    }

    // --- NEW HYBRID LOGIC ---

    // 1. Find all items that match the selected category via the comma-separated TAG field.
    // This is the core of your request.
    const selectedCategoryLower = selectedCategory.toLowerCase();
    let finalItems = recordsInStore.filter(record => {
        const itemCategories = (record.fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '')
            .split(',')
            .map(cat => cat.trim().toLowerCase());
        return itemCategories.includes(selectedCategoryLower);
    });

    // 2. Apply the EXISTING subcategory filter logic to the results from step 1.
    // This part remains untouched, as requested.
    if (activeSubcategories.length > 0) {
        // Note: This assumes subcategories are also "grouping" items in the hierarchy.
        // We find the items that are descendants of the selected subcategory groupings.
        let subcategoryItems = [];
        const subcategoryRecords = recordsInStore.filter(r => activeSubcategories.includes((r.fields.Name || '').toLowerCase()));
        
        subcategoryRecords.forEach(subcatRecord => {
            const descendantItems = getDescendantBookableItems(subcatRecord, recordsInStore, allRecordNames);
            subcategoryItems = subcategoryItems.concat(descendantItems);
        });

        // We now filter our category results to only include items that ALSO belong to the selected subcategories.
        const subcategoryItemIds = new Set(subcategoryItems.map(item => item.id));
        finalItems = finalItems.filter(item => subcategoryItemIds.has(item.id));
    }
    
    return finalItems;
}

function filterByStatus(records, statusFilter) {
    if (statusFilter === 'all') return records;
    return records.filter(record => record.fields[CONSTANTS.FIELD_NAMES.STATUS] === statusFilter);
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
        const price = ui.getGroupPriceRange(record)?.min ?? parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
        return price >= range.min && price <= range.max;
    });
}

function filterBySearchTerm(records, searchTerm) {
    if (!searchTerm) {
        return records;
    }

    const scoredRecords = [];
    records.forEach(record => {
        let score = 0;
        const fields = record.fields;
        
        const name = (fields[CONSTANTS.FIELD_NAMES.NAME] || '').toLowerCase();
        const description = (fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || '').toLowerCase();
        
        const optionNames = ui.parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]).map(opt => opt.name).join(' ');
        const allOtherText = [
            fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '',
            fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES] || '',
            fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS] || '',
            fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || '',
            fields['Location'] || '',
            optionNames
        ].join(' ').toLowerCase();

        if (name.includes(searchTerm)) {
            score = 3;
        } else if (description.includes(searchTerm)) {
            score = 2;
        } else if (allOtherText.includes(searchTerm)) {
            score = 1;
        }

        if (score > 0) {
            scoredRecords.push({ record, score });
        }
    });

    scoredRecords.sort((a, b) => b.score - a.score);
    return scoredRecords.map(item => item.record);
}

function sortRecords(records, sortBy) {
    return records.sort((a, b) => {
        const aPrice = ui.getGroupPriceRange(a)?.min ?? parseFloat(String(a.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
        const bPrice = ui.getGroupPriceRange(b)?.min ?? parseFloat(String(b.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
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

export function applyFiltersAndSort(imageCache) {
    const catalogTitle = document.getElementById('catalog-title');
    const planFilterBtn = document.getElementById('plan-filter-btn');

    // --- NEW: Special logic for the "My Plan" view ---
    if (planFilterBtn && planFilterBtn.classList.contains('active')) {
        const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Your';
        if (catalogTitle) {
            catalogTitle.textContent = `${eventName} Plan & Ideas`;
            catalogTitle.style.display = 'block';
        }

        // Get record IDs from locked items first, then from regular items
        const lockedItemIds = Array.from(state.cart.lockedItems.keys());
        const itemIds = Array.from(state.cart.items.keys());
        
        // Combine the lists
        const allPlanRecordIds = [...lockedItemIds, ...itemIds];

        // Map the IDs back to the full record objects from the main records list
        const recordsToDisplay = allPlanRecordIds.map(id =>
            state.records.all.find(record => record.id === id)
        ).filter(Boolean); // Filter out any null/undefined results

        state.records.filtered = recordsToDisplay;
        state.ui.recordsCurrentlyDisplayed = 0;
        
        // Render all plan/idea items at once, no "load more" needed for this view
        ui.renderRecords(recordsToDisplay, imageCache, false).then(() => {
            state.ui.recordsCurrentlyDisplayed = recordsToDisplay.length;
        });

        // IMPORTANT: Exit the function to bypass all other filtering logic
        return;
    }
    // --- END of new logic ---

    // If not in "My Plan" view, ensure the title is hidden and proceed with normal filtering
    if (catalogTitle) {
        catalogTitle.style.display = 'none';
    }

    const activeCategoryButton = document.querySelector('#category-filters .filter-btn.active');
    const selectedCategory = activeCategoryButton ? (activeCategoryButton.dataset.filter === 'all' ? 'all' : activeCategoryButton.textContent) : 'all';
    const activeSubcategoryNodes = document.querySelectorAll('#subcategory-filters .filter-btn.active');
    const activeSubcategories = Array.from(activeSubcategoryNodes).map(btn => btn.dataset.filter);
    const searchTerm = document.getElementById('name-filter').value.toLowerCase();
    const statusFilter = document.getElementById('status-filter').value;
    const headcountFilter = document.getElementById('headcount-filter').value;
    const customHeadcount = document.getElementById('headcount-custom').value;
    const locationFilter = document.getElementById('location-filter').value;
    const budgetFilter = document.getElementById('budget-filter').value;
    const sortBy = document.getElementById('sort-by').value;

    let recordsForCurrentStore = state.records.all.filter(record =>
        record.fields.Stores && record.fields.Stores.includes(state.ui.activeShopId)
    );

    let recordsToDisplay = filterByCategoryAndSubcategory(recordsForCurrentStore, selectedCategory, activeSubcategories);
    
    recordsToDisplay = filterByStatus(recordsToDisplay, statusFilter);
    recordsToDisplay = filterByHeadcount(recordsToDisplay, headcountFilter, customHeadcount);
    recordsToDisplay = filterByLocation(recordsToDisplay, locationFilter);
    recordsToDisplay = filterByBudget(recordsToDisplay, budgetFilter);
    recordsToDisplay = filterBySearchTerm(recordsToDisplay, searchTerm);
    recordsToDisplay = sortRecords(recordsToDisplay, sortBy);

    state.records.filtered = recordsToDisplay;
    state.ui.recordsCurrentlyDisplayed = 0;
    const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD);
    ui.renderRecords(initialRecords, imageCache, false).then(() => {
        state.ui.recordsCurrentlyDisplayed = initialRecords.length;
    });
}
