export function parseOptions(optionsString) {
    if (!optionsString || typeof optionsString !== 'string') {
        return [];
    }

    // 1. Split the string by commas to handle multiple options.
    const optionParts = optionsString.split(',');

    // 2. This regex now processes each individual part.
    const optionRegex = /([\w\s'-]+)(?:\s?\(\+?\$?(-?\d*\.?\d+)\)?)?/;

    // 3. Map over each part to extract its name and price modification.
    return optionParts.map(part => {
        const match = part.trim().match(optionRegex);
        if (!match) {
            return { name: part.trim(), priceChange: null, absolutePrice: null };
        }
        const name = match[1].trim();
        const priceChange = match[2] ? parseFloat(match[2]) : null;
        return { name, priceChange, absolutePrice: null };
    });
}

