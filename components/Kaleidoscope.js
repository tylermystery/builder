import { state } from '../state.js';
import { CONSTANTS } from '../config.js';
import { log } from '../utils/debug.js';

// --- Canvas & Animation State ---
let canvas, ctx;
let particles = [];
let lastTimestamp = 0;
let angle = 0;

// --- User-Controlled Settings ---
let settings = {
    segments: 6,   // "Kaleidoscope" (2 to 12)
    speed: 2,      // "Motion" (0.5 to 10)
    spin: 0.05,    // "Spin" (0 to 1)
    particleCount: 100 // Max number of lines
};

// --- Color Generation Logic (Moved from ui.js) ---
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

/**
 * Gets the current color palette based on items in the plan.
 */
function getColorPalette() {
    let colors = [];
    const defaultColors = VIBRANT_COLOR_PAIRS[5];
    
    if (state.cart.lockedItems.size === 0) {
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
    return [...new Set(colors)];
}

let currentPalette = getColorPalette();

/**
 * Public function to be called by sidebar.js when cart changes.
 */
export function updateColors() {
    currentPalette = getColorPalette();
    log('Kaleidoscope', 'Updated color palette', currentPalette);
}

// --- Particle Class ---
class Particle {
    constructor() {
        this.reset();
    }

    reset() {
        this.x = Math.random() * canvas.width - canvas.width / 2;
        this.y = Math.random() * canvas.height - canvas.height / 2;
        this.vx = (Math.random() - 0.5) * settings.speed;
        this.vy = (Math.random() - 0.5) * settings.speed;
        this.life = Math.random() * 100 + 100;
        this.color = currentPalette[Math.floor(Math.random() * currentPalette.length)];
    }

    update(deltaTime) {
        this.x += this.vx * deltaTime * (settings.speed / 2);
        this.y += this.vy * deltaTime * (settings.speed / 2);
        this.life -= 0.1 * deltaTime;

        // Reset particle if it's dead or off-screen
        if (this.life <= 0 || 
            this.x > canvas.width / 2 || this.x < -canvas.width / 2 ||
            this.y > canvas.height / 2 || this.y < -canvas.height / 2) {
            this.reset();
        }
    }

    draw(ctx, segmentAngle) {
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x - this.vx, this.y - this.vy); // Draw a short line
        ctx.stroke();

        // --- The Kaleidoscope Logic ---
        // Draw the mirrored and rotated segments
        for (let i = 1; i < settings.segments; i++) {
            ctx.save();
            ctx.rotate(i * segmentAngle);
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x - this.vx, this.y - this.vy);
            ctx.stroke();
            
            // Draw the mirror image
            ctx.scale(1, -1);
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x - this.vx, this.y - this.vy);
            ctx.stroke();
            
            ctx.restore();
        }
    }
}

/**
 * The main animation loop.
 */
function animate(timestamp) {
    if (!ctx) return; // Stop if canvas is gone
    
    const deltaTime = (timestamp - lastTimestamp) / 16.67; // Normalize to 60fps
    lastTimestamp = timestamp;

    // Clear canvas with a fade effect
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Center coordinate system
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    
    // Apply global spin
    angle += (settings.spin / 100) * deltaTime;
    ctx.rotate(angle);

    const segmentAngle = (Math.PI * 2) / settings.segments;

    // Update and draw all particles
    particles.forEach(p => {
        p.update(deltaTime);
        p.draw(ctx, segmentAngle);
    });
    
    ctx.restore();
    
    requestAnimationFrame(animate);
}

/**
 * Public function to update settings from sliders.
 */
export function updateKaleidoscopeSettings(newSettings) {
    if (newSettings.segments) {
        settings.segments = parseInt(newSettings.segments, 10);
    }
    if (newSettings.speed) {
        settings.speed = parseFloat(newSettings.speed);
    }
    if (newSettings.spin) {
        // Map spin slider (0-10) to a smaller rotation value
        settings.spin = parseFloat(newSettings.spin) / 20; 
    }
    log('Kaleidoscope', 'Settings updated', settings);
}

/**
 * Initializes the canvas and starts the animation.
 */
export function initKaleidoscope() {
    canvas = document.getElementById('kaleidoscope-bg');
    if (!canvas) {
        console.error('Failed to find #kaleidoscope-bg canvas element.');
        return;
    }
    ctx = canvas.getContext('2d');

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Create particles
    for (let i = 0; i < settings.particleCount; i++) {
        particles.push(new Particle());
    }

    // Start the loop
    lastTimestamp = performance.now();
    requestAnimationFrame(animate);
    log('Kaleidoscope', 'Engine Initialized.');
}
