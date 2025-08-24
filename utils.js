/*
 * Version: 1.0.0
 * Last Modified: 2025-08-24
 *
 * Changelog:
 *
 * v1.0.0 - 2025-08-24
 * - Initial file created to break circular dependencies.
 * - Moved parseOptions function from ui.js.
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
