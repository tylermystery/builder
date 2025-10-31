// In: components/effects/kaleidoscope.js
// Action: Create this new file.

import { log } from '../../utils/debug.js';

let particles = [];
let globalAngle = 0;
let settings = {};

class Particle {
    constructor(width, height, colors, speed) {
        this.canvasWidth = width;
        this.canvasHeight = height;
        this.colors = colors;
        this.speed = speed;
        this.reset();
    }

    reset() {
        this.x = (Math.random() - 0.5) * this.canvasWidth;
        this.y = (Math.random() - 0.5) * this.canvasHeight;
        this.vx = (Math.random() - 0.5) * this.speed;
        this.vy = (Math.random() - 0.5) * this.speed;
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

const kaleidoscopeEffect = {
    name: "Kaleidoscope",

    init: (ctx, width, height) => {
        log('FX:Kaleidoscope', 'Initializing...');
        ctx.globalAlpha = 0.4;
        particles = [];
        // Use settings.particleCount or a default
        const count = settings.particleCount || 100;
        for (let i = 0; i < count; i++) {
            particles.push(new Particle(width, height, [], settings.speed));
        }
    },

    draw: (ctx, width, height, deltaTime, colors, currentSettings) => {
        settings = currentSettings;
        
        // Clear canvas with a fade effect
        ctx.fillStyle = `rgba(255, 255, 255, 0.05)`; // Slower fade
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.translate(width / 2, height / 2);
        
        globalAngle += (settings.spin || 0) * (deltaTime / 1000); 
        ctx.rotate(globalAngle);

        const segments = settings.segments || 6;
        const sliceAngle = (Math.PI * 2) / segments;

        for (let i = 0; i < segments; i++) {
            ctx.save();
            ctx.rotate(i * sliceAngle);
            
            particles.forEach(p => {
                if (p.colors !== colors) p.colors = colors;
                p.update(deltaTime);
                p.draw(ctx);
            });

            ctx.scale(1, -1);
            particles.forEach(p => p.draw(ctx));
            
            ctx.restore();
        }
        ctx.restore();
    },

    resize: (width, height) => {
        particles.forEach(p => {
            p.canvasWidth = width;
            p.canvasHeight = height;
        });
    },
    
    updateSettings: (newSettings) => {
        // This is called when a slider moves
        if (newSettings.speed) {
            particles.forEach(p => {
                p.speed = newSettings.speed;
            });
        }
    },

    getControls: () => {
        return [
            { id: "segments", label: "Kaleidoscope", min: 2, max: 12, step: 2, defaultValue: 6 },
            { id: "speed", label: "Motion", min: 1, max: 10, step: 1, defaultValue: 2 },
            { id: "spin", label: "Spin", min: 0.0, max: 1.0, step: 0.05, defaultValue: 0.0 }
        ];
    }
};

export default kaleidoscopeEffect;
