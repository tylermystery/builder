// In: components/effects/vortex.js
// Action: Create this new file.

// --- DEBUG ---
console.log('[vortex.js] File execution started.');
// --- DEBUG ---

const vortexEffect = {
    name: "Color Vortex",
    type: "css", // It's a CSS effect
    cssClass: "bg-effect-vortex", // The class to apply

    // This effect has no canvas init or draw
    init: () => {}, 
    draw: () => {}, 

    // It provides a "speed" control
    getControls: () => {
        return [
            { id: "speed", label: "Vortex Speed (s)", min: 3, max: 30, step: 1, defaultValue: 15 }
        ];
    }
};

export default vortexEffect;
