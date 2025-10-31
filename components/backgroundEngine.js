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
let animationFrameId = null;

// This object will be populated by the active plugin's controls
let settings = {}; 

// --- Color Generation Logic ---
// This lives in the engine, as all effects will use it
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
        animationFrameId = requestAnimationFrame(animationLoop);
        return;
    }
    
    const deltaTime = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    // Call the active effect's draw function
    // Pass it everything it needs to draw a frame
    currentEffect.draw(ctx, canvas.width, canvas.height, deltaTime, currentColors, settings);

    animationFrameId = requestAnimationFrame(animationLoop);
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
    
    // Check if records are loaded. If not, state.records might be undefined
    if (!state.records || !state.records.all || state.cart.lockedItems.size === 0) {
        colors.push(...defaultColors);
    } else {
        const categoriesInPlan = new Set();
        for (const [recordId] of state.cart.lockedItems.entries()) {
            const record = state.records.all.find(r => r.id === recordId);
            // Add a check here in case record isn't found (e.g., during initialization)
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
    
    // Pass new colors to the effect
    if (currentEffect && typeof currentEffect.updateColors === 'function') {
        currentEffect.updateColors(currentColors);
    }
}

/**
 * Called by event listeners in auth.js when sliders change.
 * @param {object} newSettings - e.g., { segments: 8, speed: 3, spin: 0.1 }
 */
export function updateSettings(newSettings) {
    settings = { ...settings, ...newSettings };
    // Pass the new settings to the active plugin
    if (currentEffect && typeof currentEffect.updateSettings === 'function') {
        currentEffect.updateSettings(settings);
    }
    log('BG-Engine', 'Settings updated:', settings);
}

/**
 * Loads a new effect, builds its controls, and starts it.
 * @param {object} effect - The effect plugin object.
 * @param {HTMLElement | null} controlsContainer - The div where sliders should be built (optional).
 */
export function loadEffect(effect, controlsContainer) {
    log('BG-Engine', `Loading effect: ${effect.name}`);
    currentEffect = effect;
    settings = {}; // Reset settings
    
    // --- THIS IS THE FIX ---
    // Only clear the container if it's provided
    if (controlsContainer) {
        controlsContainer.innerHTML = ''; // Clear old sliders
    }
    // --- END FIX ---

    // 1. Initialize the effect
    if (typeof currentEffect.init === 'function') {
        currentEffect.init(ctx, canvas.width, canvas.height);
    }

    // 2. Get controls from the plugin and build them in the UI
    if (typeof currentEffect.getControls === 'function') {
        const controls = currentEffect.getControls();
        controls.forEach(control => {
            // Set default value in our engine's settings
            settings[control.id] = control.defaultValue;

            // --- THIS IS THE FIX ---
            // Only build the UI if the container was provided
            if (controlsContainer) {
                // Create the UI
                const controlGroup = document.createElement('div');
                controlGroup.className = 'form-row-slider'; // A new class for styling
                
                const label = document.createElement('label');
                label.htmlFor = control.id;
                label.textContent = `${control.label}: `;
                
                const valueSpan = document.createElement('span');
                valueSpan.id = `${control.id}-value`;
                valueSpan.textContent = control.defaultValue;
                label.appendChild(valueSpan);

                const slider = document.createElement('input');
                slider.type = 'range';
                slider.id = control.id;
                slider.min = control.min;
                slider.max = control.max;
                slider.step = control.step;
                slider.value = control.defaultValue;
                
                // Add listener to update engine
                slider.addEventListener('input', (e) => {
                    const newValue = parseFloat(e.target.value);
                    valueSpan.textContent = newValue.toFixed(control.step < 1 ? 2 : 0);
                    updateSettings({ [control.id]: newValue });
                });

                controlGroup.appendChild(label);
                controlGroup.appendChild(slider);
                controlsContainer.appendChild(controlGroup);
            }
            // --- END FIX ---
        });
    }

    // 3. Pass current colors to the new effect
    if (typeof currentEffect.updateColors === 'function') {
        currentEffect.updateColors(currentColors);
    }
}

/**
 * Called once by main.js to start the engine.
 */
export function initBackgroundEngine() {
    canvas = document.getElementById('kaleidoscope-bg'); // We'll keep this ID
    if (!canvas) {
        console.error('Fatal: Background canvas not found.');
        return;
    }
    
    // Try to get a WebGL context for shaders, fall back to 2D
    let gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
        log('BG-Engine', 'WebGL context acquired. 3D effects are enabled.');
        ctx = gl; // ctx will be the WebGL context
    } else {
        log('BG-Engine', 'WebGL not supported. Falling back to 2D canvas context.');
        ctx = canvas.getContext('2d');
    }
    
    const resizeCanvas = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        // Handle context resizing
        if (gl) {
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        } else {
            ctx.globalAlpha = 0.4; // Default opacity for 2D effects
        }

        if (currentEffect && typeof currentEffect.resize === 'function') {
            currentEffect.resize(canvas.width, canvas.height);
        }
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas(); // Set initial size
    
    updateColors(); // Get initial colors
    
    // Start the animation loop (no effect loaded yet)
    lastTimestamp = performance.now();
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(animationLoop);
    log('BG-Engine', 'Engine Initialized.');
}
