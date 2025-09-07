import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';

export function applyFiltersAndSort(imageCache) {
    console.log("FILTER: Starting applyFiltersAndSort...");
    const activeCategoryNodes = document.querySelectorAll('#category-filters .category-filter-btn.active');
    const activeCategories = Array.from(activeCategoryNodes).map(btn => btn.dataset.filter.toLowerCase());
    const searchTerm = document.getElementById('name-filter').value.toLowerCase();
    const statusFilter = document.getElementById('status-filter').value;
    const headcountFilter = document.getElementById('headcount-filter').value;
    const customHeadcount = document.getElementById('headcount-custom').value;
    const locationFilter = document.getElementById('location-filter').value;
    const budgetFilter = document.getElementById('budget-filter').value;
    const sortBy = document.getElementById('sort-by').value;
    console.log("FILTER: Filter values read from DOM:", { statusFilter, headcountFilter, locationFilter, budgetFilter, sortBy, searchTerm });

    let recordsToDisplay = state.records.all;
    console.log(`FILTER: Starting with ${recordsToDisplay.length} total records.`);

    if (activeCategories.length > 0) {
        recordsToDisplay = recordsToDisplay.filter(record => {
            const getTagsFromString = (str) => (str ? str.split(',').map(tag => tag.trim().toLowerCase()) : []);
            const recordTags = [
                ...getTagsFromString(record.fields[CONSTANTS.FIELD_NAMES.CATEGORIES]),
                ...getTagsFromString(record.fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES])
            ];
            return activeCategories.some(cat => recordTags.includes(cat));
        });
        console.log(`FILTER: After Category filter, ${recordsToDisplay.length} records remain.`);
    }

    if (statusFilter !== 'all') {
        recordsToDisplay = recordsToDisplay.filter(record => record.fields.Status === statusFilter);
        console.log(`FILTER: After Status filter, ${recordsToDisplay.length} records remain.`);
    }
    
    // **FIXED FILTER LOGIC**: This section was missing or incomplete
    if (headcountFilter !== 'any' || (headcountFilter === 'custom' && customHeadcount)) {
        let filterMin = 0, filterMax = Infinity;
        if (headcountFilter === 'custom') {
            filterMin = parseInt(customHeadcount, 10) || 0;
            filterMax = filterMin;
        } else {
            const [minStr, maxStr] = headcountFilter.split('-');
            filterMin = parseInt(minStr, 10);
            filterMax = maxStr === 'plus' ? Infinity : parseInt(maxStr, 10);
        }

        const parseCapacity = (capacityStr) => {
            if (!capacityStr || typeof capacityStr !== 'string') return { min: 0, max: Infinity };
            if (capacityStr.includes('+')) {
                return { min: parseInt(capacityStr, 10) || 0, max: Infinity };
            }
            const parts = capacityStr.split('-').map(p => parseInt(p, 10));
            return { min: parts[0] || 0, max: parts[1] || Infinity };
        };
        recordsToDisplay = recordsToDisplay.filter(record => {
            const capacity = parseCapacity(record.fields['Capacity']);
            return filterMin <= capacity.max && filterMax >= capacity.min;
        });
        console.log(`FILTER: After Headcount filter, ${recordsToDisplay.length} records remain.`);
    }

    if (locationFilter !== 'any') {
        recordsToDisplay = recordsToDisplay.filter(record => {
            return record.fields['Location']?.toLowerCase().replace(/\s+/g, '-') === locationFilter;
        });
        console.log(`FILTER: After Location filter, ${recordsToDisplay.length} records remain.`);
    }

    if (budgetFilter !== 'any') {
        const BUDGET_RANGES = {
            'budget-friendly': { min: 0, max: 50 },
            'moderate': { min: 51, max: 100 },
            'executive': { min: 101, max: 250 },
            'luxury': { min: 251, max: Infinity }
        };
        const range = BUDGET_RANGES[budgetFilter];
        recordsToDisplay = recordsToDisplay.filter(record => {
             const price = ui.getGroupPriceRange(record)?.min ?? parseFloat(String(record.fields.Price || '0').replace(/[^0-9.-]+/g, ""));
             return price >= range.min && price <= range.max;
        });
        console.log(`FILTER: After Budget filter, ${recordsToDisplay.length} records remain.`);
    }
    
    if (searchTerm) {
        const scoredRecords = [];
        recordsToDisplay.forEach(record => {
            let score = 0;
            const fields = record.fields;
            const name = (fields.Name || '').toLowerCase();
            const description = (fields.Description || '').toLowerCase();
            const tags = [...(fields[CONSTANTS.FIELD_NAMES.CATEGORIES]?.split(',') || []), ...(fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES]?.split(',') || []), ...(fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS]?.split(',') || [])].map(t => t.toLowerCase().trim());
         
            if (name.includes(searchTerm)) score = 3;
            else if (description.includes(searchTerm)) score = 2;
            else if (tags.some(tag => tag.includes(searchTerm))) score = 1;
            if (score > 0) { scoredRecords.push({ record, score }); }
        });
        scoredRecords.sort((a, b) => b.score - a.score);
        recordsToDisplay = scoredRecords.map(item => item.record);
        console.log(`FILTER: After Search filter, ${recordsToDisplay.length} records remain.`);
    }
    
    recordsToDisplay.sort((a, b) => {
        const aPrice = ui.getGroupPriceRange(a)?.min ?? parseFloat(String(a.fields.Price || '0').replace(/[^0-9.-]+/g, ""));
        const bPrice = ui.getGroupPriceRange(b)?.min ?? parseFloat(String(b.fields.Price || '0').replace(/[^0-9.-]+/g, ""));
        const aName = a.fields.Name || '';
        const bName = b.fields.Name || '';
        switch (sortBy) {
            case 'price-asc': return aPrice - bPrice;
            case 'price-desc': return bPrice - aPrice;
            case 'name-asc': return aName.localeCompare(bName);
            default: return 0;
        }
    });
    console.log("FILTER: Sorting complete.");

    state.records.filtered = recordsToDisplay;
    state.ui.recordsCurrentlyDisplayed = 0;

    const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD);
    console.log(`FILTER: Passing ${initialRecords.length} records to ui.renderRecords.`);
    ui.renderRecords(initialRecords, imageCache, false).then(() => {
        state.ui.recordsCurrentlyDisplayed = initialRecords.length;
    });
}
