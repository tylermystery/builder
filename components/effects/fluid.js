// In: components/effects/fluid.js
// Action: REPLACE THE ENTIRE FILE

// --- DEBUG ---
console.log('[fluid.js] File execution started. (Progress-Controlled)');
// --- DEBUG ---

import { Shader } from '../../utils/shader.js';

// --- GLSL (Shader Language) Code ---
// This is the code that runs on the GPU.

// 1. Vertex Shader (Standard boilerplate)
// It just creates a full-screen rectangle to draw on.
const vsSource = `
    attribute vec4 a_position;
    void main() {
        gl_Position = a_position;
    }
`;

// 2. Fragment Shader (The "Vortex" / "Tie-Dye")
// We replace the reliance on u_time for color with u_progress.
const fsSource = `
    precision mediump float;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_energy; 
    uniform float u_progress; // NEW: Controls the base color of the spectrum (0.0 to 1.0)

    // This is a function that creates organic-looking "noise"
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    // This is a "noise" function that creates smooth, fluid patterns
    float noise(vec2 st) {
        vec2 i = floor(st);
        vec2 f = fract(st);
        float a = random(i);
        float b = random(i + vec2(1.0, 0.0));
        float c = random(i + vec2(0.0, 1.0));
        float d = random(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.y * u.x;
    }

    void main() {
        // 1. Normalize coordinates (from 0.0 to 1.0)
        vec2 st = gl_FragCoord.xy / u_resolution.xy;
        st.x *= u_resolution.x / u_resolution.y; // Fix aspect ratio

        // 2. Center the coordinates (now -0.5 to 0.5)
        vec2 centered_st = st - vec2(0.5, 0.5);

        // 3. Convert to polar coordinates (angle and distance)
        float angle = atan(centered_st.y, centered_st.x);
        float radius = length(centered_st);

        // 4. Create the "vortex"
        // The vortex movement still depends on time and the energy boost.
        float vortex_speed = u_time * (0.2 + u_energy * 2.0);
        float vortex_twist = u_energy * 5.0;
        float n = noise(vec2(angle * (3.0 + vortex_twist) + vortex_speed, radius * 2.0));

        // 5. Calculate Color from Progress
        // We use the progress variable to define the base hue.
        // The noise still creates the fluid bands, but they shift based on u_progress.
        // Multiplier of 50.0 creates a full spectrum cycle across the 0.0-1.0 progress range
        // Adding the slow vortex_speed creates continuous animation independent of progress
        float base_wave = n * 1.5 + (u_progress * 50.0) + (vortex_speed * 0.3); // Combine progress and animation
        
        // DEBUG: Add a subtle visual indicator when progress is exactly 0.3 (starting value)
        // If progress hasn't changed from 0.3, we'll see a specific color pattern
        
        // Define the standard 120-degree phase shift for full spectrum HSL cycling
        const float PI_2_OVER_3 = 2.0943951; 
        
        // Maintain brightness boost and exponent
        float r = pow(sin(base_wave + 0.0) * 0.5 + 0.5, 1.1) + 0.1; 
        float g = pow(sin(base_wave + PI_2_OVER_3) * 0.5 + 0.5, 1.1) + 0.1;
        float b = pow(sin(base_wave + PI_2_OVER_3 * 2.0) * 0.5 + 0.5, 1.1) + 0.1;
        
        // 6. Final color with a vignette (darker edges)
        float vignette = 1.0 - (radius * 0.2);
        gl_FragColor = vec4(r * vignette, g * vignette, b * vignette, 1.0);
    }
`;

// Module-level variables to persist between function calls
let gl = null;
let shader = null;

// Track draw calls for debugging
let drawCallCount = 0;
let lastLoggedProgress = null;

const fluidEffect = {
    name: "Fluid Energy",
    type: "webgl", // This is our new type

    init: (context) => {
        // --- DEBUG ---
        console.log('[fluid.js] init() called.');
        // --- DEBUG ---
        gl = context;
        shader = new Shader(gl, vsSource, fsSource);
    }, 

    // MODIFIED: Added 'progress' to the draw function
    draw: (gl, width, height, time, energy, progress) => { 
        if (!shader) return;

        drawCallCount++;
        
        // Log every 120 frames (~2 seconds at 60fps) OR when progress changes
        const shouldLog = (drawCallCount % 120 === 0) || (progress !== lastLoggedProgress);
        
        if (shouldLog) {
            console.log('[fluid.js] ========== draw() stats ==========');
            console.log('[fluid.js] Draw call #:', drawCallCount);
            console.log('[fluid.js]   - width:', width);
            console.log('[fluid.js]   - height:', height);
            console.log('[fluid.js]   - time:', time.toFixed(2));
            console.log('[fluid.js]   - energy:', energy.toFixed(3));
            console.log('[fluid.js]   - progress:', progress);
            if (progress !== lastLoggedProgress) {
                console.log('[fluid.js]   - PROGRESS CHANGED:', lastLoggedProgress, '->', progress);
            }
            lastLoggedProgress = progress;
        }

        shader.use();

        // Pass all our "uniform" variables to the shader
        gl.uniform2f(shader.getUniformLocation("u_resolution"), width, height);
        gl.uniform1f(shader.getUniformLocation("u_time"), time);
        gl.uniform1f(shader.getUniformLocation("u_energy"), energy);
        gl.uniform1f(shader.getUniformLocation("u_progress"), progress); // NEW: Pass progress
        
        // Draw the full-screen rectangle
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    
    // We don't need controls, so we return an empty array
    getControls: () => {
        return []; 
    }
};

export default fluidEffect;
