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

    // ... additional filters for headcount, location, budget would go here with similar logging ...

    if (searchTerm) {
        const scoredRecords = recordsToDisplay.map(record => {
            let score = 0;
            const name = (record.fields.Name || '').toLowerCase();
            if (name.includes(searchTerm)) score = 3;
            // Simplified for brevity, original logic is more complex
            return { record, score };
        }).filter(item => item.score > 0);

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
