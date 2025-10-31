// In: components/effects/kaleidoscope.js
// Action: Create this new folder and file.

import { log } from '../../utils/debug.js';

// --- Private Plugin Variables ---
let particles = [];
let globalAngle = 0;
let settings = {
    segments: 6,
    speed: 2,
    spin: 0.0,
    particleCount: 100,
    opacity: 0.4,
    fade: 0.05
};

// --- Particle Class (Internal to this plugin) ---
class Particle {
    constructor(width, height, colors) {
        this.canvasWidth = width;
        this.canvasHeight = height;
        this.colors = colors;
        this.reset();
    }

    reset() {
        this.x = (Math.random() - 0.5) * this.canvasWidth;
        this.y = (Math.random() - 0.5) * this.canvasHeight;
        this.vx = (Math.random() - 0.5) * settings.speed;
        this.vy = (Math.random() - 0.5) * settings.speed;
        this.color = this.colors[Math.floor(Math.random() * this.colors.length)] || '#FFFFFF';
        this.life = Math.random() * 100 + 100;
    }

    update(deltaTime) {
        const speedMultiplier = deltaTime / 16.67; 
        this.x += this.vx * speedMultiplier;
        this.y += this.vy * speedMultiplier;
        this.life -= 1 * speedMultiplier;

        const bounds = this.canvasWidth / 2;
        if (this.life <= 0 || this.x < -bounds || this.x > bounds || this.y < -bounds || this.y > bounds) {
            this.reset();
        }
    }

    draw(ctx) {
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.x - this.vx, this.y - this.vy);
        ctx.lineTo(this.x, this.y);
        ctx.stroke();
    }
}

// --- Plugin Definition ---

const kaleidoscopeEffect = {
    name: "Kaleidoscope",

    /**
     * Called once by the engine when the plugin is loaded.
     */
    init: (ctx, width, height) => {
        log('Kaleidoscope-FX', 'Initializing...');
        ctx.globalAlpha = settings.opacity;
        particles = []; // Clear any old particles
        for (let i = 0; i < settings.particleCount; i++) {
            // Pass in an empty array for now, colors will be supplied in the draw loop
            particles.push(new Particle(width, height, []));
        }
    },

    /**
     * Called 60x per second by the engine.
     */
    draw: (ctx, width, height, deltaTime, colors, currentSettings) => {
        // Update local settings from engine
        settings = { ...settings, ...currentSettings };
        
        // Update particle colors if they've changed
        if (particles.length > 0 && particles[0].colors !== colors) {
            particles.forEach(p => p.colors = colors);
        }
        
        // Clear canvas with a fade effect
        ctx.fillStyle = `rgba(255, 255, 255, ${settings.fade})`;
        ctx.fillRect(0, 0, width, height);

        // Center coordinates
        ctx.save();
        ctx.translate(width / 2, height / 2);
        
        // Apply spin
        globalAngle += settings.spin * (deltaTime / 1000); 
        ctx.rotate(globalAngle);

        const sliceAngle = (Math.PI * 2) / settings.segments;

        for (let i = 0; i < settings.segments; i++) {
            ctx.save();
            ctx.rotate(i * sliceAngle);
            
            particles.forEach(p => {
                p.update(deltaTime);
                p.draw(ctx);
            });

            // Mirror
            ctx.scale(1, -1);
            particles.forEach(p => p.draw(ctx));
            
            ctx.restore();
        }

        ctx.restore(); // Restore origin
    },

    /**
     * Called by the engine when the browser is resized.
     */
    resize: (width, height) => {
        particles.forEach(p => {
            p.canvasWidth = width;
            p.canvasHeight = height;
        });
    },

    /**
     * Called by the engine to get the list of sliders this effect needs.
     */
    getControls: () => {
        return [
            { id: "segments", label: "Kaleidoscope", type: "range", min: 2, max: 12, step: 2, defaultValue: 6, unit: "segments" },
            { id: "speed", label: "Motion", type: "range", min: 1, max: 10, step: 1, defaultValue: 2, unit: "" },
            { id: "spin", label: "Spin", type: "range", min: 0.0, max: 1.0, step: 0.05, defaultValue: 0.0, unit: "" }
        ];
    }
};

export default kaleidoscopeEffect;
