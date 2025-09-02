export function parseOptions(optionsString) {
    if (!optionsString || typeof optionsString !== 'string') {
        return [];
    }

    // 1. Split by new lines, not commas.
    const lines = optionsString.split('\n').filter(line => line.trim() !== '');

    return lines.map(line => {
        const option = {
            name: '',
            price: null,
            priceChange: null,
            description: null,
            duration: null
        };

        // 2. Use a more robust regex to find attributes like "key: value" or "key: ""quoted value"""
        const attributeRegex = /(\w+):\s*("([^"]*)"|(-?\d*\.?\d+))/g;
        let lastIndex = 0;
        let match;
        
        while ((match = attributeRegex.exec(line)) !== null) {
            // The text before the first attribute is the name
            if (option.name === '') {
                option.name = line.substring(0, match.index).trim();
            }
            
            const key = match[1].toLowerCase().replace(/\s+/g, ''); // e.g., "price change" -> "pricechange"
            const value = match[3] !== undefined ? match[3] : parseFloat(match[4]); // Handle strings vs. numbers

            if (key === 'price') option.price = value;
            if (key === 'pricechange') option.priceChange = value;
            if (key === 'description') option.description = value;
            if (key === 'duration') option.duration = value;
            
            lastIndex = attributeRegex.lastIndex;
        }

        // If no attributes were found, the whole line is the name
        if (option.name === '') {
            option.name = line.trim();
        }

        return option;
    });
}

