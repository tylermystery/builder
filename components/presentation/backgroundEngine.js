/**
 * Presentation Background Engine
 * WebGL shader animation that renders behind all presentation content.
 * Extracted from presentation.js — Phase 1 modularization.
 *
 * This renders the SAME background as the catalog view. Both the shader source and the
 * animated state are shared, so a plan looks identical wherever it is viewed:
 *   - the GLSL comes from components/effects/fluid.js;
 *   - progress / crystallization / swirl / seed come from components/planAtmosphere.js.
 *
 * It previously drifted on a timer (autoProgressDrift), which meant the background moved
 * without any user action. That drift is gone — like the catalog, this view only advances
 * when the user moves their plan forward or back.
 */

import { Shader } from '../../utils/shader.js';
import { log } from '../../utils/debug.js';
import { fluidShaderSource } from '../effects/fluid.js';
import {
    tickAtmosphere,
    isAtmosphereSettled,
    isShimmering,
    SHIMMER_FRAME_MS,
    onAtmosphereChange,
} from '../planAtmosphere.js';

const { vsSource, fsSource } = fluidShaderSource;

// Module-level state
let bgCanvas = null;
let gl = null;
let shader = null;
let animationFrameId = null;
let shimmerTimerId = null;
let bgStartTime = 0;
let unsubscribeAtmosphere = null;
let hasDrawnFirstFrame = false;

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
    hasDrawnFirstFrame = false;

    // Wake the (possibly parked) loop whenever the plan's atmosphere changes.
    if (!unsubscribeAtmosphere) {
        unsubscribeAtmosphere = onAtmosphereChange(requestRender);
    }

    requestRender();
    log('Presentation', 'Background animation started');
}

/**
 * Wake the render loop. Safe to call from anywhere, any number of times.
 *
 * @param {number} delayMs - wait this long before drawing. Used only for the shimmer, which is
 *   a slow sweep and does not need a frame per refresh.
 */
function requestRender(delayMs = 0) {
    if (animationFrameId !== null) return;

    if (delayMs > 0) {
        if (shimmerTimerId !== null) return;
        shimmerTimerId = setTimeout(() => {
            shimmerTimerId = null;
            animationFrameId = requestAnimationFrame(animate);
        }, delayMs);
        return;
    }

    // A real request outranks a queued shimmer tick.
    if (shimmerTimerId !== null) {
        clearTimeout(shimmerTimerId);
        shimmerTimerId = null;
    }
    animationFrameId = requestAnimationFrame(animate);
}

function animate(timestamp) {
    animationFrameId = null;

    const modal = _getModal?.();
    if (!modal || !modal.classList.contains('active')) {
        return;
    }

    const elapsedTime = (timestamp - bgStartTime) / 1000.0;
    const frame = tickAtmosphere(timestamp);

    shader.use();
    gl.uniform2f(shader.getUniformLocation("u_resolution"), bgCanvas.width, bgCanvas.height);
    gl.uniform1f(shader.getUniformLocation("u_time"), elapsedTime);
    gl.uniform1f(shader.getUniformLocation("u_energy"), frame.energy);
    gl.uniform1f(shader.getUniformLocation("u_progress"), frame.progress);
    gl.uniform1f(shader.getUniformLocation("u_spin"), frame.spin);
    gl.uniform1f(shader.getUniformLocation("u_crystal"), frame.crystal);
    gl.uniform1f(shader.getUniformLocation("u_seed"), frame.seed);
    gl.uniform1f(shader.getUniformLocation("u_shimmer"), frame.shimmer);
    gl.uniform1f(shader.getUniformLocation("u_shimmer_phase"), frame.shimmerPhase);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const wasFirstFrame = !hasDrawnFirstFrame;
    hasDrawnFirstFrame = true;

    // Park once everything has settled; a plan edit or a resize re-arms the loop.
    if (wasFirstFrame || !isAtmosphereSettled()) {
        requestRender();
    } else if (isShimmering()) {
        // Journey settled, but the plan is crystallizing — keep the glint moving, throttled.
        requestRender(SHIMMER_FRAME_MS);
    }
}

/**
 * Stop the background animation loop.
 */
export function stopAnimation() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (shimmerTimerId !== null) {
        clearTimeout(shimmerTimerId);
        shimmerTimerId = null;
    }

    // Drop the wake-up subscription too. The presentation view is hidden via stopAnimation()
    // rather than cleanup(), so without this every later plan edit in the catalog would keep
    // scheduling a no-op frame for a closed view. startAnimation() re-subscribes.
    if (unsubscribeAtmosphere) {
        unsubscribeAtmosphere();
        unsubscribeAtmosphere = null;
    }

    log('Presentation', 'Background animation stopped');
}

/**
 * Resize the background canvas to match the window dimensions.
 */
export function resize() {
    if (!bgCanvas || !gl) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    if (bgCanvas.width === width && bgCanvas.height === height) return;

    bgCanvas.width = width;
    bgCanvas.height = height;
    gl.viewport(0, 0, bgCanvas.width, bgCanvas.height);

    // The shader corrects for aspect ratio, so a size change needs one redraw even when the
    // plan itself has not moved.
    hasDrawnFirstFrame = false;
    requestRender();
}

/**
 * Clean up all background engine resources.
 */
export function cleanup() {
    stopAnimation(); // also drops the atmosphere subscription
    bgCanvas = null;
    gl = null;
    shader = null;
}
