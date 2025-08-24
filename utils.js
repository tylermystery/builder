// FILE: utils.js
/*
 * This is a shared utility module.
 * It should not have any dependencies on other project files.
 * It contains common helper functions used by multiple modules.
 */

export function parseOptions(optionsText) {
    if (!optionsText) return [];
    return optionsText.split('\n').map(line => {
        const parts = line.split(',').map(p => p.trim());
        const option = {
            name: parts[0], priceChange: null, absolutePrice: null,
            durationChange: null, description: null
        };
        parts.slice(1).forEach(part => {
            const [key, ...valueParts] = part.split(':').map(p => p.trim());
            const value = valueParts.join(':');
            switch (key.toLowerCase()) {
                case 'price change': option.priceChange = parseFloat(value.replace(/[^0-9.-]+/g, '')) || 0; break;
                case 'price': option.absolutePrice = parseFloat(value.replace(/[^0-9.-]+/g, '')) || 0; break;
                case 'duration change': option.durationChange = parseFloat(value.replace(/[^0-9.-]+/g, '')) || 0; break;
                case 'description': option.description = value.replace(/"/g, ''); break;
            }
        });
        return option;
    });
}

/**
 * Determines if a record is a "Grouping" by checking if its options are other records.
 * @param {Object} record - The Airtable record object.
 * @param {Array<Object>} allRecords - The complete list of all records.
 * @returns {boolean} True if the record is a grouping.
 */
export function isGrouping(record, allRecords) {
    if (!record || !record.fields) return false;
    const rawOptions = parseOptions(record.fields.Options);
    const allRecordNames = new Set(allRecords.map(r => r.fields.Name));
    return rawOptions.some(opt => allRecordNames.has(opt.name));
}

/**
 * Generates an acronym from a string (e.g., "Team Building" -> "TB").
 * @param {string} name - The string to convert.
 * @returns {string} The generated acronym.
 */
export function getInitials(name = '') {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
}
