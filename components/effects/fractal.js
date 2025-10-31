// In: components/effects/fractal.js
// Action: Create this new file.

import { log } from '../../utils/debug.js';

let settings = {};
let angle = 0;

const fractalEffect = {
    name: "Fractal (Simple)",

    init: (ctx, width, height) => {
        log('FX:Fractal', 'Initializing...');
    },

    draw: (ctx, width, height, deltaTime, colors, currentSettings) => {
        settings = currentSettings;
        
        // Clear canvas
        ctx.fillStyle = `rgba(255, 255, 255, 0.05)`;
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.translate(width / 2, height / 2);
        
        // Simple spinning "fractal-like" object
        angle += (settings.spin * 0.001) * deltaTime;
        ctx.rotate(angle);
        
        const maxLevels = Math.floor(settings.complexity);
        const branchLength = settings.zoom;

        function drawBranch(level) {
            if (level > maxLevels) return;

            ctx.strokeStyle = colors[level % colors.length] || '#000000';
            ctx.lineWidth = maxLevels - level + 1;
            
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -branchLength);
            ctx.stroke();

            ctx.translate(0, -branchLength);
            
            // Left branch
            ctx.save();
            ctx.rotate(-0.5); // ~30 degrees
            drawBranch(level + 1);
            ctx.restore();
            
            // Right branch
            ctx.save();
            ctx.rotate(0.5); // ~30 degrees
            drawBranch(level + 1);
            ctx.restore();
        }

        drawBranch(0); // Start drawing
        ctx.restore();
    },

    getControls: () => {
        return [
            { id: "complexity", label: "Complexity", min: 1, max: 8, step: 1, defaultValue: 5 },
            { id: "zoom", label: "Zoom", min: 20, max: 150, step: 5, defaultValue: 80 },
            { id: "spin", label: "Spin", min: 0.0, max: 1.0, step: 0.05, defaultValue: 0.1 }
        ];
    }
};

export default fractalEffect;
