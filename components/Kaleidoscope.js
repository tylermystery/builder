// In: components/kaleidoscope.js
// Action: Create this new file.

import { state } from '../state.js';
import { CONSTANTS } from '../config.js';
import { log } from '../utils/debug.js';

// --- Private Module Variables ---

let canvas, ctx;
let particles = [];
let lastTimestamp = 0;
let globalAngle = 0;
let currentColors = [];

// Default settings, will be controlled by sliders
let settings = {
    segments: 6,     // "Kaleidoscope" (2 to 12)
    speed: 2,        // "Motion" (1 to 10)
    spin: 0.0,       // "Spin" (0 to 1)
    particleCount: 100, // Internal setting
    opacity: 0.4,       // Master opacity
    fade: 0.05         // How fast the trails fade
};

// --- Color Generation Logic (Moved from ui.js) ---

/**
 * Simple hash function to convert a string to a positive integer.
 * This lets us map any category name to a color index.
 * @param {string} str The string to hash
 * @returns {number} A positive integer.
 */
function stringToHash(str) {
    let hash = 0, i, chr;
    if (!str || str.length === 0) return hash;
    for (i = 0; i < str.length; i++) {
        chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

// A list of vibrant, pre-approved "adventure-themed" color pairs.
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


// --- Particle Class ---

class Particle {
    constructor() {
        this.reset();
    }

    reset() {
        if (!canvas) return;
        // Start at a random point
        this.x = (Math.random() - 0.5) * canvas.width;
        this.y = (Math.random() - 0.5) * canvas.height;
        // Give it a random velocity based on the "Motion" slider
        this.vx = (Math.random() - 0.5) * settings.speed;
        this.vy = (Math.random() - 0.5) * settings.speed;
        // Give it a random color from our plan's palette
        this.color = currentColors[Math.floor(Math.random() * currentColors.length)] || '#FFFFFF';
        // Give it a random lifespan
        this.life = Math.random() * 100 + 100;
    }

    update(deltaTime) {
        // Adjust speed based on a 60fps frame (approx 16.67ms)
        const speedMultiplier = deltaTime / 16.67; 
        this.x += this.vx * speedMultiplier;
        this.y += this.vy * speedMultiplier;
        this.life -= 1 * speedMultiplier; // Make lifespan frame-rate independent

        // Reset particle if it's dead or way off-screen
        const bounds = canvas.width / 2;
        if (this.life <= 0 || this.x < -bounds || this.x > bounds || this.y < -bounds || this.y > bounds) {
            this.reset();
        }
    }

    draw(context) {
        context.strokeStyle = this.color;
        context.lineWidth = 2;
        context.beginPath();
        // Draw a short line from its previous position to its new one
        context.moveTo(this.x - this.vx, this.y - this.vy);
        context.lineTo(this.x, this.y);
        context.stroke();
    }
}

// --- Animation Loop ---

function draw(timestamp) {
    if (!ctx) return; // Stop if canvas isn't ready
    const deltaTime = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    // Clear the canvas with a faint trail effect
    ctx.fillStyle = `rgba(255, 255, 255, ${settings.fade})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Center the coordinate system
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    
    // Apply global spin based on the "Spin" slider
    // (deltaTime / 1000) converts ms to seconds, making spin speed consistent
    globalAngle += settings.spin * (deltaTime / 1000); 
    ctx.rotate(globalAngle);

    const sliceAngle = (Math.PI * 2) / settings.segments;

    for (let i = 0; i < settings.segments; i++) {
        ctx.save();
        ctx.rotate(i * sliceAngle);
        
        // Draw all particles
        particles.forEach(p => {
            p.update(deltaTime);
            p.draw(ctx);
        });

        // Mirror (this is the core kaleidoscope/fractal effect)
        ctx.scale(1, -1);
        particles.forEach(p => p.draw(ctx));
        
        ctx.restore();
    }

    ctx.restore(); // Restore origin from center
    requestAnimationFrame(draw);
}

// --- Public API Functions ---

/**
 * Called by sidebar.js when the cart changes.
 * This updates the color palette for the animation.
 */
export function updateColors() {
    log('Kaleidoscope', 'Updating colors based on plan...');
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
    log('Kaleidoscope', `Colors updated to: ${currentColors.join(', ')}`);
}

/**
 * Called by event listeners in auth.js when sliders change.
 * @param {object} newSettings - e.g., { segments: 8, speed: 3, spin: 0.1 }
 */
export function updateKaleidoscopeSettings(newSettings) {
    settings = { ...settings, ...newSettings };
    log('Kaleidoscope', 'Settings updated:', settings);
}

/**
 * Called once by main.js to start the engine.
 */
export function initKaleidoscope() {
    canvas = document.getElementById('kaleidoscope-bg');
    if (!canvas) {
        console.error('Fatal: Kaleidoscope canvas not found.');
        return;
    }
    ctx = canvas.getContext('2d');
    
    const resizeCanvas = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        ctx.globalAlpha = settings.opacity;
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas(); // Set initial size
    
    updateColors(); // Get initial colors

    // Create initial particles
    for (let i = 0; i < settings.particleCount; i++) {
        particles.push(new Particle());
    }

    // Start the animation
    lastTimestamp = performance.now();
    requestAnimationFrame(draw);
    log('Kaleidoscope', 'Engine Initialized.');
}
