// FILE: filtering.js
import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';

// --- NEW HELPER FUNCTIONS to get all nested items ---

function getDescendantBookableItems(record, allRecords, allRecordNames) {
    let bookableItems = [];
    const children = allRecords.filter(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] === record.fields.Name);
    for (const child of children) {
        if (isGrouping(child, allRecordNames)) {
            bookableItems = bookableItems.concat(getDescendantBookableItems(child, allRecords, allRecordNames));
        } else {
            bookableItems.push(child);
        }
    }
    return bookableItems;
}

function isGrouping(record, allRecordNames) {
    const rawOptions = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    return rawOptions.some(opt => allRecordNames.has(opt.name));
}

function getAllBookableItems(records) {
    const allRecordNames = new Set(records.map(r => r.fields.Name));
    return records.filter(record => !isGrouping(record, allRecordNames) && record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]);
}
// --- END HELPER FUNCTIONS ---


// Helper function to parse capacity strings
function parseCapacity(capacityStr) {
    if (!capacityStr || typeof capacityStr !== 'string') return { min: 0, max: Infinity };
    if (capacityStr.includes('+')) {
        return { min: parseInt(capacityStr, 10) || 0, max: Infinity };
    }
    const parts = capacityStr.split('-').map(p => parseInt(p, 10));
    return { min: parts[0] || 0, max: parts[1] || Infinity };
}

// --- MODIFIED: This function is now recursive and more accurate ---
function filterByCategoryAndSubcategory(records, selectedCategory, activeSubcategories) {
    const allRecordNames = new Set(records.map(r => r.fields.Name));

    if (selectedCategory === 'all') {
        // If "All" is selected, return all bookable items.
        return activeSubcategories.length === 0 ? getAllBookableItems(records) : records.filter(record => activeSubcategories.includes(record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]?.toLowerCase()));
    }

    // Find the record for the selected main category (e.g., "Activities")
    const categoryRecord = records.find(r => r.fields.Name === selectedCategory && !r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]);

    if (!categoryRecord) {
        return [];
    }
    
    // If subcategories are selected, filter by them directly.
    if (activeSubcategories.length > 0) {
        let items = [];
        const subcategoryRecords = records.filter(r => activeSubcategories.includes(r.fields.Name.toLowerCase()));
        subcategoryRecords.forEach(subcatRecord => {
            items = items.concat(getDescendantBookableItems(subcatRecord, records, allRecordNames));
        });
        return items;
    } else {
        // If only a main category is selected, get all its descendants.
        return getDescendantBookableItems(categoryRecord, records, allRecordNames);
    }
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

// Located in filtering.js
function filterByLocation(records, locationFilter) {
    if (locationFilter === 'any') {
        return records;
    }

    // Map filter values to an array of searchable keywords
    const locationKeywords = {
        'sf': ['san francisco', 'sf'],
        'oakland': ['oakland'],
        'peninsula': ['menlo park', 'palo alto', 'san mateo', 'redwood city', 'daly city', 'atherton', 'san carlos'],
        'south-bay': ['sunnyvale', 'san jose', 'santa clara', 'cupertino', 'campbell', 'milpitas', 'los gatos'],
        'north-bay': ['sausalito', 'san rafael', 'novato', 'mill valley', 'tiburon', 'marin'],
        'east-bay': ['oakland', 'berkeley', 'hayward', 'fremont', 'walnut creek', 'pleasanton', 'danville', 'livermore', 'alameda'],
        'other': ['other']
    };

    const keywords = locationKeywords[locationFilter] || [];

    return records.filter(record => {
        const recordLocation = record.fields['Location']?.toLowerCase() || '';

        // If location is "All", it should match any region filter.
        if (recordLocation.includes('all')) {
            return true;
        }

        // Check if the record's location string contains any of the keywords for the selected region.
        return keywords.some(keyword => recordLocation.includes(keyword));
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

// Filter records by the text search term
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

    // Apply broad category and attribute filters first.
    recordsToDisplay = filterByCategoryAndSubcategory(recordsToDisplay, selectedCategory, activeSubcategories);
    recordsToDisplay = filterByStatus(recordsToDisplay, statusFilter);
    recordsToDisplay = filterByHeadcount(recordsToDisplay, headcountFilter, customHeadcount);
    recordsToDisplay = filterByLocation(recordsToDisplay, locationFilter);
    recordsToDisplay = filterByBudget(recordsToDisplay, budgetFilter);
    
    // Apply the text search term LAST to refine the filtered results.
    recordsToDisplay = filterBySearchTerm(recordsToDisplay, searchTerm);

    // Sort the final list.
    recordsToDisplay = sortRecords(recordsToDisplay, sortBy);

    state.records.filtered = recordsToDisplay;
    state.ui.recordsCurrentlyDisplayed = 0;
    const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD);
    ui.renderRecords(initialRecords, imageCache, false).then(() => {
        state.ui.recordsCurrentlyDisplayed = initialRecords.length;
    });
}
