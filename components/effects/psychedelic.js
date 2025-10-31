// In: components/effects/psychedelic.js
// Action: Create this new file.

// --- DEBUG ---
console.log('[psychedelic.js] File execution started.');
// --- DEBUG ---

const psychedelicEffect = {
    name: "Psychedelic Flow",
    type: "css", // Our new type identifier
    cssClass: "bg-effect-psychedelic", // The class to apply

    // This effect has no canvas init
    init: () => {}, 

    // This effect has no canvas draw loop
    draw: () => {}, 

    // We can still provide controls to make it "adjustable"!
    getControls: () => {
        return [
            { id: "speed", label: "Flow Speed (s)", min: 5, max: 40, step: 1, defaultValue: 20 }
        ];
    }
};

export default psychedelicEffect;
