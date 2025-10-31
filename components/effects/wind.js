// In: components/effects/wind.js
// Action: Create this new file.

import { log } from '../../utils/debug.js';

let particles = [];
let settings = {};

class Particle {
    constructor(width, height, colors, speed, angle) {
        this.canvasWidth = width;
        this.canvasHeight = height;
        this.colors = colors;
        this.speed = speed;
        // Convert angle from degrees (0 = right) to radians
        const rad = angle * (Math.PI / 180); 
        this.vx = Math.cos(rad) * speed;
        this.vy = Math.sin(rad) * speed;
        this.reset();
    }

    reset() {
        // Start anywhere on screen
        this.x = Math.random() * this.canvasWidth;
        this.y = Math.random() * this.canvasHeight;
        this.color = this.colors[Math.floor(Math.random() * this.colors.length)] || '#FFFFFF';
        this.life = Math.random() * 200 + 100; // Live longer
    }

    update(deltaTime) {
        const speedMultiplier = deltaTime / 16.67;
        this.x += this.vx * speedMultiplier;
        this.y += this.vy * speedMultiplier;
        this.life -= 1 * speedMultiplier;

        // Wrap around screen
        if (this.life <= 0) this.reset();
        if (this.x > this.canvasWidth) this.x = 0;
        if (this.x < 0) this.x = this.canvasWidth;
        if (this.y > this.canvasHeight) this.y = 0;
        if (this.y < 0) this.y = this.canvasHeight;
    }

    draw(ctx) {
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        // Draw a tail
        ctx.moveTo(this.x - this.vx * 3, this.y - this.vy * 3);
        ctx.lineTo(this.x, this.y);
        ctx.stroke();
    }
}

const windEffect = {
    name: "Wind",

    init: (ctx, width, height) => {
        log('FX:Wind', 'Initializing...');
        ctx.globalAlpha = 0.2; // Wind is more subtle
        particles = []; 
    },
    
    draw: (ctx, width, height, deltaTime, colors, currentSettings) => {
        settings = currentSettings;
        
        // Slower fade for wind trails
        ctx.fillStyle = `rgba(255, 255, 255, 0.03)`;
        ctx.fillRect(0, 0, width, height);

        // Lazily create particles
        if (particles.length < 200) {
            particles.push(new Particle(width, height, colors, settings.speed, settings.angle));
        }

        particles.forEach(p => {
            if (p.colors !== colors) p.colors = colors;
            p.update(deltaTime);
            p.draw(ctx);
        });
    },

    resize: (width, height) => {
        particles.forEach(p => {
            p.canvasWidth = width;
            p.canvasHeight = height;
        });
    },
    
    updateSettings: (newSettings) => {
        // Update all particles with new settings
        const rad = newSettings.angle * (Math.PI / 180);
        particles.forEach(p => {
            p.speed = newSettings.speed;
            p.vx = Math.cos(rad) * newSettings.speed;
            p.vy = Math.sin(rad) * newSettings.speed;
        });
    },

    getControls: () => {
        return [
            { id: "speed", label: "Speed", min: 1, max: 15, step: 1, defaultValue: 4 },
            { id: "angle", label: "Angle", min: 0, max: 360, step: 5, defaultValue: 45 }
        ];
    }
};

export default windEffect;
