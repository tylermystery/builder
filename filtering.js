// FILE: filtering.js
import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';

// Helper function to parse capacity strings
function parseCapacity(capacityStr) {
    if (!capacityStr || typeof capacityStr !== 'string') return { min: 0, max: Infinity };
    if (capacityStr.includes('+')) {
        return { min: parseInt(capacityStr, 10) || 0, max: Infinity };
    }
    const parts = capacityStr.split('-').map(p => parseInt(p, 10));
    return { min: parts[0] || 0, max: parts[1] || Infinity };
}

// Filter records based on selected category and subcategories
function filterByCategoryAndSubcategory(records, selectedCategory, activeSubcategories) {
    if (selectedCategory === 'all' && activeSubcategories.length === 0) {
        return records.filter(record => !record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]);
    }
    
    const topLevelItems = records.filter(record => !record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]);
    if (selectedCategory !== 'all') {
        const selectedCategoryRecord = topLevelItems.find(record => record.fields.Name === selectedCategory);
        if (selectedCategoryRecord && activeSubcategories.length === 0) {
            records = records.filter(record => 
                record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] === selectedCategoryRecord.fields.Name
            );
        } else if (activeSubcategories.length > 0) {
            records = records.filter(record => 
                activeSubcategories.includes(record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]?.toLowerCase())
            );
        } else {
            records = records.filter(record => 
                record.fields[CONSTANTS.FIELD_NAMES.NAME] === selectedCategory
            );
        }
    } else {
        records = topLevelItems;
    }
    
    return records;
}

// Filter records by status
function filterByStatus(records, statusFilter) {
    if (statusFilter === 'all') {
        return records;
    }
    return records.filter(record => record.fields[CONSTANTS.FIELD_NAMES.STATUS] === statusFilter);
}

// Filter records by headcount
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

// Filter records by location
function filterByLocation(records, locationFilter) {
    if (locationFilter === 'any') {
        return records;
    }
    return records.filter(record => {
        return record.fields['Location']?.toLowerCase().replace(/\s+/g, '-') === locationFilter;
    });
}

// Filter records by budget
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

// --- MODIFIED: Expanded the search logic ---
function filterBySearchTerm(records, searchTerm) {
    if (!searchTerm) {
        return records;
    }

    const scoredRecords = [];
    records.forEach(record => {
        let score = 0;
        const fields = record.fields;
        
        // Gather all searchable text fields into simple variables
        const name = (fields[CONSTANTS.FIELD_NAMES.NAME] || '').toLowerCase();
        const description = (fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || '').toLowerCase();
        
        // Combine all tags, options, and other metadata into a single searchable string
        const optionNames = ui.parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]).map(opt => opt.name).join(' ');
        const allOtherText = [
            fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '',
            fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES] || '',
            fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS] || '',
            fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || '',
            fields['Location'] || '',
            optionNames
        ].join(' ').toLowerCase();

        // Apply scoring based on where the match was found
        if (name.includes(searchTerm)) {
            score = 3; // Highest priority for matches in the name
        } else if (description.includes(searchTerm)) {
            score = 2; // Second priority for matches in the description
        } else if (allOtherText.includes(searchTerm)) {
            score = 1; // Lowest priority for matches in any other metadata
        }

        if (score > 0) {
            scoredRecords.push({ record, score });
        }
    });

    scoredRecords.sort((a, b) => b.score - a.score);
    return scoredRecords.map(item => item.record);
}
// --- END MODIFICATION ---

// Sort the final filtered records
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
    const activeCategoryButton = document.querySelector('#category-filters .filter-btn.active');
    // --- MODIFIED: Handle the new "All" button ---
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

    let recordsToDisplay = state.records.all;

    // --- REORDERED LOGIC ---
    // 1. Apply the global search term filter FIRST.
    recordsToDisplay = filterBySearchTerm(recordsToDisplay, searchTerm);

    // 2. Filter by category, status, and other attributes on the search results.
    recordsToDisplay = filterByCategoryAndSubcategory(recordsToDisplay, selectedCategory, activeSubcategories);
    recordsToDisplay = filterByStatus(recordsToDisplay, statusFilter);
    recordsToDisplay = filterByHeadcount(recordsToDisplay, headcountFilter, customHeadcount);
    recordsToDisplay = filterByLocation(recordsToDisplay, locationFilter);
    recordsToDisplay = filterByBudget(recordsToDisplay, budgetFilter);
    
    // 3. Sort the final results.
    recordsToDisplay = sortRecords(recordsToDisplay, sortBy);
    // --- END REORDERED LOGIC ---

    state.records.filtered = recordsToDisplay;
    state.ui.recordsCurrentlyDisplayed = 0;
    const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD);
    
    ui.renderRecords(initialRecords, imageCache, false).then(() => {
        state.ui.recordsCurrentlyDisplayed = initialRecords.length;
    });
}
