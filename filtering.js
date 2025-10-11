// REPLACE THE ENTIRE CONTENTS OF: filtering.js

import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import { getGroupPriceRange, getRecordPrice, parseOptions } from './utils.js'; // <-- UPDATED
import { getItemStatus } from '../availability.js';

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

function filterByCategoryAndSubcategory(recordsInStore, selectedCategory, activeSubcategories) {
    if (selectedCategory === 'all') {
        return recordsInStore.filter(r => !r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]);
    }

    const selectedCategoryLower = selectedCategory.toLowerCase();
    let finalItems = recordsInStore.filter(record => {
        const itemCategories = (record.fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '')
            .split(',')
            .map(cat => cat.trim().toLowerCase());
        return itemCategories.includes(selectedCategoryLower);
    });
    if (activeSubcategories.length > 0) {
        finalItems = finalItems.filter(record => {
            const itemSubcategories = (record.fields.Subcategories || '')
                .split(',')
                .map(sc => sc.trim().toLowerCase());
            return activeSubcategories.some(activeSubcat => itemSubcategories.includes(activeSubcat));
        });
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
        const price = getGroupPriceRange(record)?.min ?? parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, "")); // <-- UPDATED
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
        
        const optionNames = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]).map(opt => opt.name).join(' '); // <-- UPDATED
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
        const aPrice = getGroupPriceRange(a)?.min ?? parseFloat(String(a.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, "")); // <-- UPDATED
        const bPrice = getGroupPriceRange(b)?.min ?? parseFloat(String(b.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, "")); // <-- UPDATED
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

export async function applyFiltersAndSort(imageCache) {
    const catalogTitle = document.getElementById('catalog-title');
    const planFilterBtn = document.getElementById('plan-filter-btn');
    if (planFilterBtn && planFilterBtn.classList.contains('active')) {
        const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Your';
        if (catalogTitle) {
            catalogTitle.textContent = `${eventName} Plan & Ideas`;
            catalogTitle.style.display = 'block';
        }

        const lockedItemIds = Array.from(state.cart.lockedItems.keys());
        const itemIds = Array.from(state.cart.items.keys());
        
        const allPlanRecordIds = [...lockedItemIds, ...itemIds];
        const recordsToDisplay = allPlanRecordIds.map(id =>
            state.records.all.find(record => record.id === id)
        ).filter(Boolean);

        state.records.filtered = recordsToDisplay;
        state.ui.recordsCurrentlyDisplayed = 0;
        ui.renderRecords(recordsToDisplay, imageCache, false).then(() => {
            state.ui.recordsCurrentlyDisplayed = recordsToDisplay.length;
        });
        return;
    }

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

// --- NEW LOGIC START ---
// Gather the current criteria from the filters
const mainDatePicker = window.flatpickr.get('#date-filter');
const criteria = {
    headcount: parseInt(customHeadcount, 10) || null,
    startDate: mainDatePicker?.selectedDates[0] || null,
    endDate: mainDatePicker?.selectedDates[1] || null
};

// Use Promise.all to run all status checks in parallel for better performance
const recordsWithStatus = await Promise.all(recordsToDisplay.map(async record => {
    const statusInfo = await getItemStatus(record, criteria);
    // Return a new object that includes the original record data plus its new statusInfo
    return { ...record, statusInfo };
}));

// Use the new array of records that now includes the status info
state.records.filtered = recordsWithStatus;
// --- NEW LOGIC END ---

state.ui.recordsCurrentlyDisplayed = 0;
    const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD);
    ui.renderRecords(initialRecords, imageCache, false).then(() => {
        state.ui.recordsCurrentlyDisplayed = initialRecords.length;
    });
    ui.updateCatalogHeader();
}
