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
    uniform float u_progress; // Where the plan sits along its journey (0.0 to 1.0)
    uniform float u_spin;     // Directional vortex rotation. Advances ONLY while the plan
                              // progresses (clockwise) or regresses (counter-clockwise),
                              // and holds steady when idle so the background is calm.
    uniform float u_crystal;  // 0 = fluid / in progress, 1 = bought and fully fulfilled.
                              // Facets the pattern, damps the swirl, and finalizes colour.
    uniform float u_seed;     // Per-plan seed (0.0 to 1.0). Rotates hue, offsets the noise
                              // field and varies band count, so every plan looks like its
                              // own place even at identical progress.
    uniform float u_shimmer;       // 0 = no shimmer. Ramps in with crystallization.
    uniform float u_shimmer_phase; // 0..1 position of the specular sweep across the facets.
                                   // A highlight only: it never touches progress or hue, so
                                   // it cannot read as the journey moving.

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
        // The swirl no longer drifts on its own. It is driven entirely by u_spin, which the
        // engine advances only when the user moves forward/backward in their plan. When idle,
        // u_spin holds its value, so the pattern is steady (no perpetual churn on load).
        // Crystallizing damps the twist, so a finished plan is visibly calmer than a live one.
        float vortex_speed = u_spin;
        float vortex_twist = u_energy * 1.5 * (1.0 - 0.7 * u_crystal);

        // The seed shifts how many bands the vortex has and where the noise field is sampled,
        // which is what makes two plans at the same progress read as different settings.
        float bands = 3.0 + vortex_twist + u_seed * 3.5;
        vec2 field = vec2(angle * bands + vortex_speed + u_seed * 24.0, radius * 2.0);

        // 5. Crystallize: snap the sampling grid so the smooth fluid bands harden into
        // facets as the plan gets bought and fulfilled. At u_crystal = 1 the pattern is
        // fully faceted and (with no energy left) completely static.
        float cells = 6.0 + floor(u_seed * 5.0);
        vec2 faceted = floor(field * cells) / cells;
        float n = noise(mix(field, faceted, u_crystal));

        // 6. Calculate colour from progress, rotated by the plan's seed.
        float base_wave = n * mix(1.5, 2.1, u_crystal)
                        + u_progress * 14.0
                        + u_seed * 6.28318;

        // Define the standard 120-degree phase shift for full spectrum HSL cycling
        const float PI_2_OVER_3 = 2.0943951;

        // Crystallizing raises contrast and drops the wash, settling into finalized colour.
        float exponent = mix(1.1, 0.78, u_crystal);
        float lift = mix(0.1, 0.02, u_crystal);

        float r = pow(sin(base_wave + 0.0) * 0.5 + 0.5, exponent) + lift;
        float g = pow(sin(base_wave + PI_2_OVER_3) * 0.5 + 0.5, exponent) + lift;
        float b = pow(sin(base_wave + PI_2_OVER_3 * 2.0) * 0.5 + 0.5, exponent) + lift;

        // 7. Vignette (darker edges), tightened as the plan crystallizes so a finished plan
        // reads more like a cut gem than an open field.
        float vignette = 1.0 - (radius * mix(0.2, 0.42, u_crystal));
        vec3 colour = vec3(r, g, b) * vignette;

        // 8. Shimmer. A crystallizing plan catches the light: a slow sweep travels across the
        // facets, lighting each one as it passes. Two components make it read as a single
        // light source rather than as noise:
        //   - spark: per-facet glints, keyed off the same faceted grid as the pattern, so the
        //            glints land ON facet boundaries and follow the plan's own geometry;
        //   - sheen: one broad diagonal band crossing the whole field.
        // Both are driven by u_shimmer_phase, never by u_time, so a shimmer frame drawn at a
        // throttled cadence still lands in exactly the right place.
        float band = fract(u_shimmer_phase);
        float facet_key = noise(faceted * 3.0 + vec2(u_seed * 17.0, u_seed * 29.0));
        float facet_dist = abs(fract(facet_key - band + 0.5) - 0.5);
        float spark = pow(1.0 - smoothstep(0.0, 0.16, facet_dist), 3.0);
        float sheen = pow(max(0.0, sin((st.x + st.y) * 2.0 - band * 6.28318)), 8.0);

        // Brightest toward the centre, so the highlight sits on the gem rather than the edges.
        float shimmer = u_shimmer * (spark * 0.75 + sheen * 0.25) * (1.0 - 0.4 * radius);
        colour += shimmer * 0.30;

        gl_FragColor = vec4(colour, 1.0);
    }
`;

// Exported so components/presentation/backgroundEngine.js renders the exact same
// background from the exact same source. A plan must look identical in both views.
export const fluidShaderSource = { vsSource, fsSource };

let gl;
let shader;

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

    // Draws one frame of the shared plan atmosphere: journey position (progress), the
    // directional swirl left over from the last action (energy/spin), how finalized the plan
    // is (crystal), the plan's own seed, and the crystalline shimmer sweep.
    draw: (gl, width, height, time, energy, progress, spin, crystal, seed, shimmer, shimmerPhase) => {
        if (!shader) return;

        shader.use();

        // Pass all our "uniform" variables to the shader
        gl.uniform2f(shader.getUniformLocation("u_resolution"), width, height);
        gl.uniform1f(shader.getUniformLocation("u_time"), time);
        gl.uniform1f(shader.getUniformLocation("u_energy"), energy);
        gl.uniform1f(shader.getUniformLocation("u_progress"), progress);
        gl.uniform1f(shader.getUniformLocation("u_spin"), spin || 0.0);
        gl.uniform1f(shader.getUniformLocation("u_crystal"), crystal || 0.0);
        gl.uniform1f(shader.getUniformLocation("u_seed"), seed || 0.0);
        gl.uniform1f(shader.getUniformLocation("u_shimmer"), shimmer || 0.0);
        gl.uniform1f(shader.getUniformLocation("u_shimmer_phase"), shimmerPhase || 0.0);

        // Draw the full-screen rectangle
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    
    // We don't need controls, so we return an empty array
    getControls: () => {
        return []; 
    }
};

export default fluidEffect;
