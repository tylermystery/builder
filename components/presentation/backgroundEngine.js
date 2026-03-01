/**
 * Presentation Background Engine
 * WebGL shader animation that renders behind all presentation content.
 * Extracted from presentation.js — Phase 1 modularization.
 */

import { Shader } from '../../utils/shader.js';
import { log } from '../../utils/debug.js';

// --- WebGL Shader source ---
const vsSource = `
    attribute vec4 a_position;
    void main() {
        gl_Position = a_position;
    }
`;

const fsSource = `
    precision mediump float;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_energy;
    uniform float u_progress;

    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

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
        vec2 st = gl_FragCoord.xy / u_resolution.xy;
        st.x *= u_resolution.x / u_resolution.y;
        vec2 centered_st = st - vec2(0.5, 0.5);
        float angle = atan(centered_st.y, centered_st.x);
        float radius = length(centered_st);
        float vortex_speed = u_time * (0.2 + u_energy * 2.0);
        float vortex_twist = u_energy * 5.0;
        float n = noise(vec2(angle * (3.0 + vortex_twist) + vortex_speed, radius * 2.0));
        float base_wave = n * 1.5 + u_progress * 10.0;
        const float PI_2_OVER_3 = 2.0943951;
        float r = pow(sin(base_wave + 0.0) * 0.5 + 0.5, 1.1) + 0.1;
        float g = pow(sin(base_wave + PI_2_OVER_3) * 0.5 + 0.5, 1.1) + 0.1;
        float b = pow(sin(base_wave + PI_2_OVER_3 * 2.0) * 0.5 + 0.5, 1.1) + 0.1;
        float vignette = 1.0 - (radius * 0.2);
        gl_FragColor = vec4(r * vignette, g * vignette, b * vignette, 1.0);
    }
`;

// Module-level state
let bgCanvas = null;
let gl = null;
let shader = null;
let animationFrameId = null;
let bgStartTime = 0;
let bgEnergy = 0.0;
const ENERGY_DECAY_RATE = 0.985;

// Dependencies injected via init()
let _getState = null;
let _getModal = null;

/**
 * Initialize the background engine module.
 * @param {Object} deps
 * @param {Function} deps.getState - Returns the app state object
 * @param {Function} deps.getModal - Returns the presentation modal DOM element
 */
export function init({ getState, getModal }) {
    _getState = getState;
    _getModal = getModal;
}

/**
 * Initialize the WebGL context and shader.
 * @returns {boolean} Whether initialization succeeded
 */
function initBackground() {
    bgCanvas = document.getElementById('presentation-bg-canvas');
    if (!bgCanvas) {
        log('Presentation', 'Background canvas not found');
        return false;
    }

    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;

    gl = bgCanvas.getContext('webgl') || bgCanvas.getContext('experimental-webgl');
    if (!gl) {
        log('Presentation', 'WebGL not available for presentation background');
        return false;
    }

    shader = new Shader(gl, vsSource, fsSource);
    bgStartTime = performance.now();

    log('Presentation', 'Background engine initialized');
    return true;
}

/**
 * Start the background animation loop.
 */
export function startAnimation() {
    if (!gl || !shader) {
        if (!initBackground()) {
            return;
        }
    }

    bgStartTime = performance.now();
    bgEnergy = 0.3;

    const modal = _getModal?.();

    function animate(timestamp) {
        if (!modal || !modal.classList.contains('active')) {
            animationFrameId = null;
            return;
        }

        const elapsedTime = (timestamp - bgStartTime) / 1000.0;
        bgEnergy *= ENERGY_DECAY_RATE;
        if (bgEnergy < 0.01) bgEnergy = 0.0;

        const currentProgress = _getState?.()?.ui?.currentProgress || 0.5;

        shader.use();
        gl.uniform2f(shader.getUniformLocation("u_resolution"), bgCanvas.width, bgCanvas.height);
        gl.uniform1f(shader.getUniformLocation("u_time"), elapsedTime);
        gl.uniform1f(shader.getUniformLocation("u_energy"), bgEnergy);
        gl.uniform1f(shader.getUniformLocation("u_progress"), currentProgress);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        animationFrameId = requestAnimationFrame(animate);
    }

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    animationFrameId = requestAnimationFrame(animate);
    log('Presentation', 'Background animation started');
}

/**
 * Stop the background animation loop.
 */
export function stopAnimation() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        log('Presentation', 'Background animation stopped');
    }
}

/**
 * Resize the background canvas to match the window dimensions.
 */
export function resize() {
    if (bgCanvas && gl) {
        bgCanvas.width = window.innerWidth;
        bgCanvas.height = window.innerHeight;
        gl.viewport(0, 0, bgCanvas.width, bgCanvas.height);
    }
}

/**
 * Clean up all background engine resources.
 */
export function cleanup() {
    stopAnimation();
    bgCanvas = null;
    gl = null;
    shader = null;
}
