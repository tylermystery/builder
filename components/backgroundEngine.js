// In: components/backgroundEngine.js
// Action: REPLACE THE ENTIRE FILE

// --- DEBUG ---
console.log('[backgroundEngine.js] File execution started. (Progress Engine)');
// --- DEBUG ---

import { state, setState } from '../state.js'; // Import setState
import { CONSTANTS } from '../config.js';
import { log } from '../utils/debug.js';

// --- Private Module Variables ---
let canvas;
let gl, ctx_2d; // We will now get these in loadEffect
let animationFrameId = null;
let currentEffect = null; 

// --- "Fluid Energy" State (for WebGL) ---
let startTime = 0;
let currentEnergy = 0.0;

// --- "Canvas 2D" State ---
let lastTimestamp_2d = 0;
let currentColors = [];
let settings = {};

// --- Animation Loop ---
function animationLoop(timestamp) {
    if (!currentEffect) {
        animationFrameId = requestAnimationFrame(animationLoop);
        return;
    }

    const currentProgress = state.ui.currentProgress; // Get the progress

    // --- NEW: Hybrid Loop ---
    if (currentEffect.type === 'webgl') {
        // --- WebGL (Fluid) Path ---
        if (!gl) { // Safety check
             animationFrameId = requestAnimationFrame(animationLoop);
             return;
        }
        // Calculate elapsed time in seconds
        const elapsedTime = (timestamp - startTime) / 1000.0;
        // Decay the energy slowly
        currentEnergy *= 0.95; 
        if (currentEnergy < 0.01) currentEnergy = 0.0;
        
        // MODIFIED: Pass currentProgress to the draw function
        currentEffect.draw(gl, canvas.width, canvas.height, elapsedTime, currentEnergy, currentProgress);

    } else if (currentEffect.type === 'canvas') {
        // --- Canvas 2D (Fractal) Path ---
        if (!ctx_2d) { // Safety check
            animationFrameId = requestAnimationFrame(animationLoop);
            return;
        }
        const deltaTime = timestamp - lastTimestamp_2d;
        lastTimestamp_2d = timestamp;

        // 2D effects don't use progress, but we still draw them
        currentEffect.draw(ctx_2d, canvas.width, canvas.height, deltaTime, currentColors, settings);
    }
    // --- END Hybrid Loop ---

    animationFrameId = requestAnimationFrame(animationLoop);
}

// --- Public API Functions ---

/**
 * Public API: Called by events.js to add "energy" to the animation.
 * This will only affect WebGL shaders that use the 'energy' uniform.
 */
export function addEnergy() {
    log('BG-Engine', 'Adding energy boost!');
    currentEnergy = 1.0; // Set energy to max
}

/**
 * Public API: Updates the color progress variable based on user action.
 * @param {number} weight - The positive or negative value to add to progress.
 */
export function updateProgress(weight) {
    let newProgress = state.ui.currentProgress + weight;
    
    // Clamp the value between 0.0 and 1.0
    newProgress = Math.min(1.0, Math.max(0.0, newProgress));

    if (newProgress !== state.ui.currentProgress) {
        log('BG-Engine', `Progress updated: ${state.ui.currentProgress.toFixed(3)} -> ${newProgress.toFixed(3)} (Weight: ${weight})`);
        setState({
            ui: {
                ...state.ui,
                currentProgress: newProgress
            }
        });
        
        // Optional: Add a subtle energy boost on forward progress to make it pop
        if (weight > 0) {
            currentEnergy = Math.min(1.0, currentEnergy + weight * 5); 
        }
    }
}

// This function is for 2D effects (like Fractal)
function updateColors() {
    log('BG-Engine', 'Updating 2D colors...');
    let colors = [];
    // Define VIBRANT_COLOR_PAIRS locally as it's only used here
    const VIBRANT_COLOR_PAIRS = [ 
        ['#ff9a8b', '#ff6a88'], ['#00c9a7', '#84fab0'], ['#fbc2eb', '#a6c1ee'],
        ['#ff7e5f', '#feb47b'], ['#a18cd1', '#fbc2eb'], ['#89f7fe', '#66a6ff']
    ];
    const defaultColors = VIBRANT_COLOR_PAIRS[5];
    
    if (!state.records || !state.records.all || state.cart.lockedItems.size === 0) {
        colors.push(...defaultColors);
    } else {
        const categoriesInPlan = new Set();
        for (const [recordId] of state.cart.lockedItems.entries()) {
            const record = state.records.all.find(r => r.id === recordId);
            const categoryString = record?.fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '';
            categoryString.split(',').map(c => c.trim().toLowerCase()).filter(Boolean).forEach(c => categoriesInPlan.add(c));
        }
        if (categoriesInPlan.size === 0) {
             colors.push(...defaultColors);
        } else {
            categoriesInPlan.forEach(catName => {
                let hash = 0, i, chr;
                for (i = 0; i < catName.length; i++) {
                    chr = catName.charCodeAt(i);
                    hash = ((hash << 5) - hash) + chr;
                    hash |= 0;
                }
                const colorIndex = Math.abs(hash) % VIBRANT_COLOR_PAIRS.length;
                colors.push(...VIBRANT_COLOR_PAIRS[colorIndex]);
            });
        }
    }
    currentColors = [...new Set(colors)];
}

// This function is for 2D effects
function updateSettings(newSettings) {
    settings = { ...settings, ...newSettings };
    if (currentEffect && typeof currentEffect.updateSettings === 'function') {
        currentEffect.updateSettings(settings);
    }
    log('BG-Engine', '2D Settings updated:', settings);
}

/**
 * Loads a new effect, builds its controls, and starts it.
 */
export function loadEffect(effect, controlsContainer) {
    // --- DEBUG ---
    console.log(`[backgroundEngine.js] loadEffect() called with effect: ${effect ? effect.name : 'null'}`);
    // --- DEBUG ---
    
    log('BG-Engine', `Loading effect: ${effect.name}`);
    currentEffect = effect;
    settings = {}; // Reset 2D settings
    
    // --- NEW: Context Switching ---
    // We must clear/reset the canvas when switching, as the contexts interfere
    // A common trick is to reset the canvas dimensions
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
            
    if (currentEffect.type === 'webgl') {
        // --- DEBUG ---
        console.log('[backgroundEngine.js] Effect type is WebGL. Getting WebGL context.');
        // --- DEBUG ---
        gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        ctx_2d = null; // Ensure 2D context is null
        if (gl && typeof currentEffect.init === 'function') {
            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
            currentEffect.init(gl);
            currentEffect.initialized = true;
        } else if (!gl) {
            console.error('Fatal: Could not get WebGL context for WebGL effect.');
        }
    } else if (currentEffect.type === 'canvas') {
        // --- DEBUG ---
        console.log('[backgroundEngine.js] Effect type is Canvas 2D. Getting 2D context.');
        // --- DEBUG ---
        ctx_2d = canvas.getContext('2d');
        gl = null; // Ensure WebGL context is null
        if (ctx_2d && typeof currentEffect.init === 'function') {
            ctx_2d.globalAlpha = 0.4;
            currentEffect.init(ctx_2d, canvas.width, canvas.height);
            currentEffect.initialized = true;
        } else if (!ctx_2d) {
            console.error('Fatal: Could not get 2D context for Canvas effect.');
        }
    }
    // --- END NEW ---

    // --- UI Control Logic (for 2D/Canvas effects) ---
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

    if (currentEffect.type === 'canvas') {
        updateColors(); // Update colors for 2D effects
    }
}

/**
 * Called once by main.js to start the engine.
 */
export function initBackgroundEngine() {
    // --- DEBUG ---
    console.log('[backgroundEngine.js] initBackgroundEngine() called.');
    // --- DEBUG ---
    canvas = document.getElementById('kaleidoscope-bg'); 
    if (!canvas) {
        console.error('Fatal: Background canvas not found.');
        return;
    }
    
    // --- FIX: We no longer get contexts here. We just set up the loop. ---
    
    const resizeCanvas = () => {
        // This resize will be used by loadEffect when it resets the context
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        // Also call the effect's resize method if it exists
        if (currentEffect && typeof currentEffect.resize === 'function') {
            if (currentEffect.type === 'webgl' && gl) {
                gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
                // WebGL effects typically don't need a special resize function
            } else if (currentEffect.type === 'canvas' && ctx_2d) {
                currentEffect.resize(canvas.width, canvas.height);
            }
        }
    };

    window.addEventListener('resize', resizeCanvas);
    // Don't call resizeCanvas() yet, wait for loadEffect
    
    startTime = performance.now();
    lastTimestamp_2d = startTime;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(animationLoop);
    log('BG-Engine', 'Hybrid WebGL/2D Engine Initialized.');
    // --- DEBUG ---
    console.log('[backgroundEngine.js] initBackgroundEngine() FINISHED. Loop is live.');
    // --- DEBUG ---
}
