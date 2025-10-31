// In: components/backgroundEngine.js
// Action: Create this new file.

import { state } from '../state.js';
import { CONSTANTS } from '../config.js';
import { log } from '../utils/debug.js';

// --- Private Module Variables ---
let canvas, ctx;
let lastTimestamp = 0;
let currentEffect = null; // This will hold the active plugin (e.g., kaleidoscope)
let currentColors = [];

// Default settings object - this will be updated by sliders
let settings = {}; 

// --- Color Generation Logic ---
// (This lives in the engine, as all effects will use it)
function stringToHash(str) {
    let hash = 0, i, chr;
    if (!str || str.length === 0) return hash;
    for (i = 0; i < str.length; i++) {
        chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return Math.abs(hash);
}

const VIBRANT_COLOR_PAIRS = [
    ['#ff9a8b', '#ff6a88'], // Active: Red/Pink
    ['#00c9a7', '#84fab0'], // Nature: Green/Teal
    ['#fbc2eb', '#a6c1ee'], // Indulgent: Purple/Blue
    ['#ff7e5f', '#feb47b'], // Discovery: Orange/Yellow
    ['#a18cd1', '#fbc2eb'], // Calm: Lavender/Pink
    ['#89f7fe', '#66a6ff'], // Default: Calm Blue/Cyan
    ['#f6d365', '#fda085'], // Sunset: Gold/Orange
    ['#c2e9fb', '#a1c4fd'], // Sky: Light Blue
    ['#d4fc79', '#96e6a1'], // Fresh: Lime/Green
    ['#fa709a', '#fee140']  // Vibrant: Hot Pink/Yellow
];

// --- Animation Loop ---
function animationLoop(timestamp) {
    if (!ctx || !currentEffect) {
        requestAnimationFrame(animationLoop);
        return;
    }
    
    const deltaTime = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    // Call the active effect's draw function
    // Pass it everything it needs to draw a frame
    currentEffect.draw(ctx, canvas.width, canvas.height, deltaTime, currentColors, settings);

    requestAnimationFrame(animationLoop);
}

// --- Public API Functions ---

/**
 * Called by sidebar.js when the cart changes.
 * This updates the color palette for the animation.
 */
export function updateColors() {
    log('BG-Engine', 'Updating colors...');
    let colors = [];
    const defaultColors = VIBRANT_COLOR_PAIRS[5]; // Default
    
    if (!state.records.all || state.cart.lockedItems.size === 0) {
        colors.push(...defaultColors);
    } else {
        const categoriesInPlan = new Set();
        for (const [recordId] of state.cart.lockedItems.entries()) {
            const record = state.records.all.find(r => r.id === recordId);
            const categoryString = record?.fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '';
            
            categoryString.split(',')
                .map(cat => cat.trim().toLowerCase())
                .filter(Boolean)
                .forEach(cat => categoriesInPlan.add(cat));
        }
        
        if (categoriesInPlan.size === 0) {
             colors.push(...defaultColors);
        } else {
            categoriesInPlan.forEach(catName => {
                const hash = stringToHash(catName);
                const colorIndex = hash % VIBRANT_COLOR_PAIRS.length;
                colors.push(...VIBRANT_COLOR_PAIRS[colorIndex]);
            });
        }
    }
    currentColors = [...new Set(colors)];
    log('BG-Engine', `Colors updated to: ${currentColors.join(', ')}`);
}

/**
 * Called by event listeners in auth.js when sliders change.
 * @param {object} newSettings - e.g., { segments: 8, speed: 3, spin: 0.1 }
 */
export function updateSettings(newSettings) {
    settings = { ...settings, ...newSettings };
    // Pass the new settings to the active plugin
    if (currentEffect && typeof currentEffect.updateSettings === 'function') {
        currentEffect.updateSettings(newSettings);
    }
    log('BG-Engine', 'Settings updated:', settings);
}

/**
 * Called by main.js to start the engine.
 * We pass in the *first* effect we want to load.
 * @param {object} initialEffect - The effect plugin object (e.g., from kaleidoscope.js)
 */
export function initBackgroundEngine(initialEffect) {
    canvas = document.getElementById('kaleidoscope-bg'); // We'll keep this ID for simplicity
    if (!canvas) {
        console.error('Fatal: Background canvas not found.');
        return;
    }
    ctx = canvas.getContext('2d');
    
    const resizeCanvas = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        // Tell the plugin about the resize
        if (currentEffect && typeof currentEffect.resize === 'function') {
            currentEffect.resize(canvas.width, canvas.height);
        }
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas(); // Set initial size
    
    updateColors(); // Get initial colors
    
    // Load and initialize the first plugin
    currentEffect = initialEffect;
    if (typeof currentEffect.init === 'function') {
        currentEffect.init(ctx, canvas.width, canvas.height);
    }

    // Get default settings from the plugin
    if (typeof currentEffect.getControls === 'function') {
        const controls = currentEffect.getControls();
        controls.forEach(control => {
            settings[control.id] = control.defaultValue;
        });
    }
    
    // Start the animation
    lastTimestamp = performance.now();
    requestAnimationFrame(animationLoop);
    log('BG-Engine', 'Engine Initialized with effect:', currentEffect.name);
}

// This function will be used in Step 6 to build the dynamic slider UI
export function getControlsForCurrentEffect() {
    if (currentEffect && typeof currentEffect.getControls === 'function') {
        return currentEffect.getControls();
    }
    return [];
}
