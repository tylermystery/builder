// In: components/backgroundEngine.js
// Action: REPLACE THE ENTIRE FILE

// --- DEBUG ---
console.log('[backgroundEngine.js] File execution started.');
// --- DEBUG ---

import { state } from '../state.js';
import { CONSTANTS } from '../config.js';
import { log } from '../utils/debug.js';

// --- Private Module Variables ---
let canvas, ctx;
let solidBgElement; // The new background div
let lastTimestamp = 0;
let currentEffect = null; // This will hold the active plugin
let currentColors = [];
let animationFrameId = null;
let settings = {}; 
// --- NEW ---
let boostTimeout = null; // To manage the boost effect
// --- END NEW ---

// (Color Generation Logic remains the same...)
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
    if (!ctx || !currentEffect || currentEffect.type !== 'canvas') {
        animationFrameId = requestAnimationFrame(animationLoop);
        return;
    }
    
    const deltaTime = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    currentEffect.draw(ctx, canvas.width, canvas.height, deltaTime, currentColors, settings);
    animationFrameId = requestAnimationFrame(animationLoop);
}

// --- Public API Functions ---

// --- NEW PUBLIC FUNCTION ---
/**
 * Triggers a temporary "boost" effect on the background.
 */
export function triggerBoost() {
    if (boostTimeout) {
        clearTimeout(boostTimeout); // Clear previous timeout
        solidBgElement.classList.remove('bg-boost');
        // Force reflow to restart transition
        void solidBgElement.offsetWidth; 
    }
    
    log('BG-Engine', 'Triggering boost!');
    solidBgElement.classList.add('bg-boost');

    // Remove the boost class after the animation (0.5s) + transition (0.2s)
    boostTimeout = setTimeout(() => {
        solidBgElement.classList.remove('bg-boost');
        boostTimeout = null;
    }, 700); // 500ms anim + 200ms transition = 700ms
}
// --- END NEW FUNCTION ---


export function updateColors() {
    log('BG-Engine', 'Updating colors...');
    let colors = [];
    const defaultColors = VIBRANT_COLOR_PAIRS[5]; // Default
    
    if (!state.records || !state.records.all || state.cart.lockedItems.size === 0) {
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
    
    if (currentEffect && typeof currentEffect.updateColors === 'function') {
        currentEffect.updateColors(currentColors);
    }
}

export function updateSettings(newSettings) {
    settings = { ...settings, ...newSettings };
    
    // --- MODIFIED: Use CSS Variables ---
    if (currentEffect && currentEffect.type === 'css') {
        if (newSettings.speed) {
            // This is more flexible than changing animationDuration
            solidBgElement.style.setProperty('--vortex-speed', `${newSettings.speed}s`);
        }
    }
    // --- END MODIFIED ---

    if (currentEffect && typeof currentEffect.updateSettings === 'function') {
        currentEffect.updateSettings(settings);
    }
    log('BG-Engine', 'Settings updated:', settings);
}

export function loadEffect(effect, controlsContainer) {
    // --- DEBUG ---
    console.log(`[backgroundEngine.js] loadEffect() called with effect: ${effect ? effect.name : 'null'}`);
    // --- DEBUG ---
    
    log('BG-Engine', `Loading effect: ${effect.name}`);
    currentEffect = effect;
    settings = {}; 

    // --- HYBRID SWITCH LOGIC ---
    solidBgElement.className = '';
    // --- MODIFIED ---
    solidBgElement.style.setProperty('--vortex-speed', ''); // Reset CSS var
    // --- END MODIFIED ---
    canvas.style.display = 'block'; 

    if (effect.type === 'css') {
        solidBgElement.className = `${effect.cssClass} bg-active`;
        canvas.style.display = 'none'; 
    } else {
        currentEffect.type = 'canvas'; 
        if (typeof currentEffect.init === 'function') {
            if (ctx) {
                // --- DEBUG ---
                console.log(`[backgroundEngine.js] loadEffect: Calling init() for ${currentEffect.name}.`);
                // --- DEBUG ---
                currentEffect.init(ctx, canvas.width, canvas.height);
                currentEffect.initialized = true;
            } else {
                // --- DEBUG ---
                console.log(`[backgroundEngine.js] loadEffect: ctx is NOT ready. Skipping init for ${currentEffect.name}.`);
                // --- DEBUG ---
            }
        }
    }
    
    if (controlsContainer) {
        controlsContainer.innerHTML = ''; // Clear old sliders
    }

    if (typeof currentEffect.getControls === 'function') {
        const controls = currentEffect.getControls();
        // --- DEBUG ---
        console.log(`[backgroundEngine.js] loadEffect: Building ${controls.length} controls for ${currentEffect.name}.`);
        // --- DEBUG ---
        controls.forEach(control => {
            settings[control.id] = control.defaultValue;

            // --- MODIFIED: Set default CSS Variable ---
            if (currentEffect.type === 'css' && control.id === 'speed') {
                 solidBgElement.style.setProperty('--vortex-speed', `${control.defaultValue}s`);
            }
            // --- END MODIFIED ---

            if (controlsContainer) {
                const controlGroup = document.createElement('div');
                controlGroup.className = 'form-row-slider';
                
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
                
                slider.addEventListener('input', (e) => {
                    const newValue = parseFloat(e.target.value);
                    valueSpan.textContent = newValue.toFixed(control.step < 1 ? 2 : 0);
                    updateSettings({ [control.id]: newValue });
                });

                controlGroup.appendChild(label);
                controlGroup.appendChild(slider);
                controlsContainer.appendChild(controlGroup);
            }
        });
    }

    if (typeof currentEffect.updateColors === 'function') {
        currentEffect.updateColors(currentColors);
    }
    
    if (ctx && !currentEffect.initialized && currentEffect.type === 'canvas') { 
        if (typeof currentEffect.init === 'function') {
            // --- DEBUG ---
            console.log(`[backgroundEngine.js] loadEffect: Running *late* init() for ${currentEffect.name}.`);
            // --- DEBUG ---
            currentEffect.init(ctx, canvas.width, canvas.height);
            currentEffect.initialized = true;
        }
    }
}

export function initBackgroundEngine() {
    // --- DEBUG ---
    console.log('[backgroundEngine.js] initBackgroundEngine() called.');
    // --- DEBUG ---
    canvas = document.getElementById('kaleidoscope-bg');
    solidBgElement = document.getElementById('solid-bg'); // Get the new div

    if (!canvas || !solidBgElement) {
        console.error('Fatal: Background canvas or solid-bg element not found.');
        return;
    }
    
    log('BG-Engine', 'Requesting 2D canvas context.');
    ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error('Fatal: Could not get 2D canvas context.');
        return;
    }
    
    const resizeCanvas = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        ctx.globalAlpha = 0.4; // Default opacity for 2D effects

        if (currentEffect && typeof currentEffect.resize === 'function') {
            currentEffect.resize(canvas.width, canvas.height);
        }
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas(); // Set initial size
    
    updateColors(); // Get initial colors
    
    lastTimestamp = performance.now();
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(animationLoop);
    log('BG-Engine', 'Engine Initialized.');
    // --- DEBUG ---
    console.log('[backgroundEngine.js] initBackgroundEngine() FINISHED. Canvas and loop are live.');
    // --- DEBUG ---
}
