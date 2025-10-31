// In: components/effects/water.js
// Action: Create this new file.

import { log } from '../../utils/debug.js';

let ripples = [];
let settings = {};
let lastSpawn = 0;

class Ripple {
    constructor(x, y, color, speed) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.radius = 0;
        this.maxRadius = 100 + Math.random() * 100;
        this.speed = speed; // How fast radius grows
        this.life = 1; // Opacity
    }

    update(deltaTime) {
        const speedMultiplier = deltaTime / 16.67;
        this.radius += this.speed * speedMultiplier;
        this.life -= 0.01 * speedMultiplier;
    }

    draw(ctx) {
        if (this.life <= 0) return;
        ctx.strokeStyle = this.color;
        ctx.globalAlpha = this.life;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.stroke();
    }
}

const waterEffect = {
    name: "Water",

    init: (ctx, width, height) => {
        log('FX:Water', 'Initializing...');
        ripples = [];
    },

    draw: (ctx, width, height, deltaTime, colors, currentSettings) => {
        settings = currentSettings;
        lastSpawn += deltaTime;
        
        // Spawn a new ripple based on "density"
        const spawnInterval = 1100 - (settings.density * 100);
        if (lastSpawn > spawnInterval) {
            lastSpawn = 0;
            const x = Math.random() * width;
            const y = Math.random() * height;
            const color = colors[Math.floor(Math.random() * colors.length)] || '#FFFFFF';
            ripples.push(new Ripple(x, y, color, settings.speed));
        }
        
        // Clear canvas (no fade)
        ctx.clearRect(0, 0, width, height);

        // Update and draw ripples
        for (let i = ripples.length - 1; i >= 0; i--) {
            const ripple = ripples[i];
            ripple.update(deltaTime);
            ripple.draw(ctx);
            
            // Remove dead ripples
            if (ripple.life <= 0) {
                ripples.splice(i, 1);
            }
        }
    },
    
    updateSettings: (newSettings) => {
        // Update all ripples with new speed
        ripples.forEach(r => r.speed = newSettings.speed);
    },

    getControls: () => {
        return [
            { id: "speed", label: "Ripple Speed", min: 0.2, max: 2.0, step: 0.1, defaultValue: 0.5 },
            { id: "density", label: "Ripple Density", min: 1, max: 10, step: 1, defaultValue: 3 }
        ];
    }
};

export default waterEffect;
