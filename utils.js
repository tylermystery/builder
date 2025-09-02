export function parseOptions(optionsString) {
    if (!optionsString || typeof optionsString !== 'string') {
        return [];
    }

    // 1. Split by new lines to correctly separate each option.
    const lines = optionsString.split('\n').filter(line => line.trim() !== '');

    return lines.map(line => {
        const option = {
            name: '',
            price: null,
            priceChange: null,
            description: null,
            duration: null
        };

        // 2. Use a robust regex to find attributes like "key: value" or "key: "quoted value""
        const attributeRegex = /(\w+\s*\w*):\s*("([^"]*)"|(-?\d*\.?\d+))/g;
        let lastIndex = 0;
        let match;
        
        let firstMatchIndex = line.length;

        // Temporarily find the first match to get the name
        const firstMatch = attributeRegex.exec(line);
        if (firstMatch) {
            firstMatchIndex = firstMatch.index;
        }
        option.name = line.substring(0, firstMatchIndex).trim();
        attributeRegex.lastIndex = 0; // Reset regex for the main loop

        while ((match = attributeRegex.exec(line)) !== null) {
            const key = match[1].toLowerCase().replace(/\s+/g, ''); // e.g., "price change" -> "pricechange"
            const value = match[3] !== undefined ? match[3] : parseFloat(match[4]); // Handle strings vs. numbers

            if (key === 'price') option.price = value;
            if (key === 'pricechange') option.priceChange = value;
            if (key === 'description') option.description = value;
            if (key === 'duration') option.duration = value;
        }

        // If the name is empty after all that, the whole line is the name.
        if (!option.name) {
            option.name = line.trim();
        }

        return option;
    });
}

