// Parses the 'Options' field from Airtable
export function parseOptions(optionsString) {
    if (!optionsString || typeof optionsString !== 'string') return [];

    return optionsString.split(';').map(opt => {
        const parts = opt.split('|').map(p => p.trim());
        if (parts.length === 0 || !parts[0]) return null;

        const option = {
            name: parts[0],
            priceChange: null,
            absolutePrice: null,
            description: parts[2] || null
        };

        if (parts[1]) {
            const pricePart = parts[1];
            if (pricePart.startsWith('=')) {
                option.absolutePrice = parseFloat(pricePart.substring(1));
            } else {
                option.priceChange = parseFloat(pricePart);
            }
        }
        return option;
    }).filter(Boolean);
}

