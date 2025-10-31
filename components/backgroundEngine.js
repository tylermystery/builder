// In: components/backgroundEngine.js
// Action: REPLACE THE ENTIRE FILE

// --- DEBUG ---
console.log('[backgroundEngine.js] File execution started.');
// --- DEBUG ---

import { log } from '../utils/debug.js';

let canvas, gl;
let animationFrameId = null;
let currentEffect = null; 

// --- NEW "Fluid Energy" State ---
let startTime = 0;
let currentEnergy = 0.0;
// --- END NEW ---

// --- Animation Loop ---
function animationLoop(timestamp) {
    if (!gl || !currentEffect) {
        animationFrameId = requestAnimationFrame(animationLoop);
        return;
    }
    
    // Calculate elapsed time in seconds
    const elapsedTime = (timestamp - startTime) / 1000.0;

    // --- NEW: Decay the energy slowly ---
    currentEnergy *= 0.95; // This creates the "fade out"
    if (currentEnergy < 0.01) currentEnergy = 0.0; // Clamp to zero
    // --- END NEW ---
    
    // Call the active effect's draw function
    currentEffect.draw(gl, canvas.width, canvas.height, elapsedTime, currentEnergy);

    animationFrameId = requestAnimationFrame(animationLoop);
}

// --- Public API Functions ---

/**
 * Public API: Called by events.js to add "energy" to the animation.
 */
export function addEnergy() {
    log('BG-Engine', 'Adding energy boost!');
    currentEnergy = 1.0; // Set energy to max
}

/**
 * Loads a new effect, builds its controls, and starts it.
 * @param {object} effect - The effect plugin object.
 */
export function loadEffect(effect) {
    // --- DEBUG ---
    console.log(`[backgroundEngine.js] loadEffect() called with effect: ${effect ? effect.name : 'null'}`);
    // --- DEBUG ---
    
    log('BG-Engine', `Loading effect: ${effect.name}`);
    currentEffect = effect;

    // Initialize the effect
    if (typeof currentEffect.init === 'function') {
        if (gl) {
            // --- DEBUG ---
            console.log(`[backgroundEngine.js] loadEffect: Calling init() for ${currentEffect.name}.`);
            // --- DEBUG ---
            currentEffect.init(gl);
            currentEffect.initialized = true;
        } else {
            // --- DEBUG ---
            console.log(`[backgroundEngine.js] loadEffect: gl context is NOT ready. Skipping init.`);
            // --- DEBUG ---
        }
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
    
    // --- THIS IS THE CRITICAL CHANGE ---
    // We are getting a 'webgl' context, not '2d'.
    gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    // --- END CRITICAL CHANGE ---
    
    if (!gl) {
        console.error('Fatal: Could not get WebGL context.');
        // We can hide the canvas so the user just sees white
        canvas.style.display = 'none';
        return;
    }
    
    const resizeCanvas = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        // Tell WebGL how to convert from clip space to pixels
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas(); // Set initial size
    
    startTime = performance.now();
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(animationLoop);
    log('BG-Engine', 'WebGL Engine Initialized.');
    // --- DEBUG ---
    console.log('[backgroundEngine.js] initBackgroundEngine() FINISHED. WebGL context is live.');
    // --- DEBUG ---
}
