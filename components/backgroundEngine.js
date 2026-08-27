import { state } from '../state.js';
import { CONSTANTS } from '../config.js';
import { log } from '../utils/debug.js';
import {
    tickAtmosphere,
    isAtmosphereSettled,
    isShimmering,
    SHIMMER_FRAME_MS,
    getAtmosphereFrame,
    refreshFromPlan,
    pulse,
    onAtmosphereChange,
    setManualProgress,
    setEnergy,
    setEnergyDecayPerFrame,
    getAtmosphereDebugInfo,
} from './planAtmosphere.js';

let canvas;
let gl, ctx_2d;
let animationFrameId = null;
let shimmerTimerId = null;
let currentEffect = null;
let debugPanel = null;

let startTime = 0;

// All journey state (progress, crystallization, energy, swirl direction, per-plan seed) lives
// in components/planAtmosphere.js, because the presentation view renders the same background
// from the same values. This module is now just the catalog's renderer.

let lastTimestamp_2d = 0;
let currentColors = [];
let settings = {};

let loopIterations = 0;
let isPageVisible = true;

let hasDrawnFirstFrame = false;

/**
 * True while something is actually in flight and worth drawing.
 *
 * 2D canvas effects animate off deltaTime, so they always keep running. The WebGL atmosphere
 * only changes when the user moves their plan, so its loop parks as soon as everything has
 * settled. That is what makes "only user interactions move the background" true by
 * construction rather than by vigilance: with nothing pending, there is no frame being drawn
 * at all, so no unrelated work (image decode, layout, a re-render) can show up on screen.
 */
function shouldKeepAnimating() {
    if (!currentEffect) return true;                 // waiting for loadEffect
    if (currentEffect.type !== 'webgl') return true; // 2D effects are continuously animated
    if (!hasDrawnFirstFrame) return true;
    return !isAtmosphereSettled();
}

/**
 * Wake the render loop. Safe to call from anywhere, any number of times.
 *
 * @param {number} delayMs - wait this long before drawing. Used for the shimmer, which is a
 *   slow sweep and does not need a frame per refresh; a timer keeps a crystallized plan from
 *   holding the compositor at 60fps for the rest of the session.
 */
export function requestRender(delayMs = 0) {
    if (animationFrameId !== null) return;

    if (delayMs > 0) {
        if (shimmerTimerId !== null) return;
        shimmerTimerId = setTimeout(() => {
            shimmerTimerId = null;
            animationFrameId = requestAnimationFrame(animationLoop);
        }, delayMs);
        return;
    }

    // A real request outranks a queued shimmer tick, so a plan edit or a resize still redraws
    // on the very next frame rather than waiting out the throttle.
    if (shimmerTimerId !== null) {
        clearTimeout(shimmerTimerId);
        shimmerTimerId = null;
    }
    animationFrameId = requestAnimationFrame(animationLoop);
}

/** Drop any pending frame or shimmer tick. */
function cancelPendingRender() {
    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (shimmerTimerId !== null) {
        clearTimeout(shimmerTimerId);
        shimmerTimerId = null;
    }
}

function animationLoop(timestamp) {
    animationFrameId = null;

    if (!currentEffect) {
        requestRender();
        return;
    }

    // Pause rendering when page is hidden to save CPU/GPU resources
    if (!isPageVisible) {
        return; // visibilitychange re-arms the loop
    }

    loopIterations++;

    if (currentEffect.type === 'webgl') {
        if (!gl) {
            requestRender();
            return;
        }

        const elapsedTime = (timestamp - startTime) / 1000.0;
        const frame = tickAtmosphere(timestamp);

        updateDebugPanel(frame.progress, frame.energy, elapsedTime, loopIterations);

        currentEffect.draw(
            gl, canvas.width, canvas.height,
            elapsedTime, frame.energy, frame.progress, frame.spin, frame.crystal, frame.seed,
            frame.shimmer, frame.shimmerPhase
        );
        hasDrawnFirstFrame = true;

    } else if (currentEffect.type === 'canvas') {
        if (!ctx_2d) {
            requestRender();
            return;
        }
        const deltaTime = timestamp - lastTimestamp_2d;
        lastTimestamp_2d = timestamp;
        updateDebugPanel(state.ui.currentProgress, 0, (timestamp - startTime) / 1000.0, loopIterations);
        currentEffect.draw(ctx_2d, canvas.width, canvas.height, deltaTime, currentColors, settings);
        hasDrawnFirstFrame = true;
    }

    if (shouldKeepAnimating()) {
        requestRender();
    } else if (currentEffect.type === 'webgl' && isShimmering()) {
        // Journey settled, but the plan is crystallizing — keep the glint moving, throttled.
        requestRender(SHIMMER_FRAME_MS);
    }
}

/**
 * A brief acknowledgement swirl with no journey movement.
 * Kept for the existing call sites that fire on a user action which is not itself a plan
 * mutation (hearting an item, opening a package, finishing a research "dig").
 */
export function addEnergy(direction = 1) {
    pulse(direction);
    requestRender();
}

/**
 * Re-derive the background from the plan.
 *
 * The signature is unchanged so every existing call site keeps working, but the meaning is
 * not: the passed weight is no longer accumulated. Progress is now derived from the plan's
 * own facts (see components/planAtmosphere.js), so this call is idempotent — calling it twice
 * for one action, or during a re-render, cannot drift the background. The weight's sign is
 * still used, but only as a hint for which way to swirl when the derived target did not move.
 *
 * @param {number} weight - legacy weight; only its sign is consulted.
 */
export function updateProgress(weight = 0) {
    refreshFromPlan('updateProgress', Math.sign(weight || 0));
    requestRender();
}

/** Explicit "the plan changed, re-derive the background" entry point. */
export function refreshAtmosphere(reason = 'plan-change') {
    refreshFromPlan(reason, 0);
    requestRender();
}

function updateColors() {
    log('BG-Engine', 'Updating 2D colors...');
    let colors = [];
    const VIBRANT_COLOR_PAIRS = [ 
        ['#ff9a8b', '#ff6a88'], ['#00c9a7', '#84fab0'], ['#fbc2eb', '#a6c1ee'],
        ['#ff7e5f', '#feb47b'], ['#a18cd1', '#fbc2eb'], ['#89f7fe', '#66a6ff']
    ];
    const defaultColors = VIBRANT_COLOR_PAIRS[5];
    
    if (!state.records || !state.records.all || state.cart.lockedItems.size === 0) {
        colors.push(...defaultColors);
    } else {
        const categoriesInPlan = new Set();
        for (const [recordId] of state.cart.lockedItems.entries()) {
            const record = state.records.all.find(r => r.id === recordId);
            const categoryString = record?.fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '';
            categoryString.split(',').map(c => c.trim().toLowerCase()).filter(Boolean).forEach(c => categoriesInPlan.add(c));
        }
        if (categoriesInPlan.size === 0) {
             colors.push(...defaultColors);
        } else {
            categoriesInPlan.forEach(catName => {
                let hash = 0, i, chr;
                for (i = 0; i < catName.length; i++) {
                    chr = catName.charCodeAt(i);
                    hash = ((hash << 5) - hash) + chr;
                    hash |= 0;
                }
                const colorIndex = Math.abs(hash) % VIBRANT_COLOR_PAIRS.length;
                colors.push(...VIBRANT_COLOR_PAIRS[colorIndex]);
            });
        }
    }
    currentColors = [...new Set(colors)];
}

function updateSettings(newSettings) {
    settings = { ...settings, ...newSettings };
    if (currentEffect && typeof currentEffect.updateSettings === 'function') {
        currentEffect.updateSettings(settings);
    }
    log('BG-Engine', '2D Settings updated:', settings);
}

export function loadEffect(effect, controlsContainer) {
    console.log('[BG-ENGINE DEBUG] loadEffect called.', {
        effectName: effect?.name,
        effectType: effect?.type,
        hasInit: typeof effect?.init === 'function',
        hasDraw: typeof effect?.draw === 'function',
        canvasReady: !!canvas
    });
    log('BG-Engine', `Loading effect: ${effect.name}`);

    currentEffect = effect;
    settings = {};

    if (!canvas) {
        console.error('[BG-ENGINE DEBUG] FATAL: Canvas not initialized before loadEffect!');
        return;
    }

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    if (currentEffect.type === 'webgl') {
        gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        ctx_2d = null;

        if (!gl) {
            console.error('[BG-ENGINE DEBUG] FATAL: Could not get WebGL context!');
            return;
        }
        console.log('[BG-ENGINE DEBUG] WebGL context obtained successfully.');

        if (typeof currentEffect.init === 'function') {
            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
            try {
                currentEffect.init(gl);
                currentEffect.initialized = true;
                console.log('[BG-ENGINE DEBUG] WebGL effect initialized successfully.');
            } catch (e) {
                console.error('[BG-ENGINE DEBUG] WebGL effect init FAILED:', e.message, e.stack);
            }
        } else {
            console.error('[BG-ENGINE DEBUG] Effect has no init function!');
        }
    } else if (currentEffect.type === 'canvas') {
        ctx_2d = canvas.getContext('2d');
        gl = null;
        if (ctx_2d && typeof currentEffect.init === 'function') {
            ctx_2d.globalAlpha = 0.4;
            try {
                currentEffect.init(ctx_2d, canvas.width, canvas.height);
                currentEffect.initialized = true;
                console.log('[BG-ENGINE DEBUG] Canvas 2D effect initialized successfully.');
            } catch (e) {
                console.error('[BG-ENGINE DEBUG] Canvas 2D effect init FAILED:', e.message, e.stack);
            }
        } else if (!ctx_2d) {
            console.error('[BG-ENGINE DEBUG] FATAL: Could not get 2D context!');
        }
    }

    if (controlsContainer) {
        controlsContainer.innerHTML = '';
    }

    if (typeof currentEffect.getControls === 'function') {
        const controls = currentEffect.getControls();
        controls.forEach(control => {
            settings[control.id] = control.defaultValue;

            if (controlsContainer) {
                const controlGroup = document.createElement('div');
                controlGroup.className = 'form-row-slider';
                
                const label = document.createElement('label');
                label.htmlFor = control.id;
                label.textContent = `${control.label}: `;
                
                const valueSpan = document.createElement('span');
                valueSpan.id = `${control.id}-value`;
                valueSpan.textContent = control.defaultValue;
                label.appendChild(valueSpan);

                const slider = document.createElement('input');
                slider.type = 'range';
                slider.id = control.id;
                slider.min = control.min;
                slider.max = control.max;
                slider.step = control.step;
                slider.value = control.defaultValue;
                
                slider.addEventListener('input', (e) => {
                    const newValue = parseFloat(e.target.value);
                    valueSpan.textContent = newValue.toFixed(control.step < 1 ? 2 : 0);
                    updateSettings({ [control.id]: newValue });
                });

                controlGroup.appendChild(label);
                controlGroup.appendChild(slider);
                controlsContainer.appendChild(controlGroup);
            }
        });
    }

    if (currentEffect.type === 'canvas') {
        updateColors();
    }

    hasDrawnFirstFrame = false;
    requestRender();
}

export function initBackgroundEngine() {
    console.log('[BG-ENGINE DEBUG] initBackgroundEngine called.');
    canvas = document.getElementById('kaleidoscope-bg');
    if (!canvas) {
        console.error('[BG-ENGINE DEBUG] FATAL: Background canvas #kaleidoscope-bg not found in DOM!');
        console.error('[BG-ENGINE DEBUG] Available canvas elements:', document.querySelectorAll('canvas').length);
        return;
    }
    console.log('[BG-ENGINE DEBUG] Canvas found:', { width: canvas.width, height: canvas.height, id: canvas.id });

    // Resize is debounced and no-ops when the dimensions did not actually change.
    // As images load the page grows, a scrollbar appears, and window.innerWidth drops by
    // ~15px — which fired a resize and, because the shader corrects for aspect ratio, made
    // the whole pattern jump. That was a visible twitch with no user action behind it.
    const applyCanvasSize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        if (canvas.width === width && canvas.height === height) return;

        canvas.width = width;
        canvas.height = height;

        if (currentEffect && typeof currentEffect.resize === 'function') {
            if (currentEffect.type === 'webgl' && gl) {
                gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
            } else if (currentEffect.type === 'canvas' && ctx_2d) {
                currentEffect.resize(canvas.width, canvas.height);
            }
        }

        hasDrawnFirstFrame = false; // redraw once at the new size
        requestRender();
    };

    let resizeTimer = null;
    const resizeCanvas = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(applyCanvasSize, 120);
    };

    window.addEventListener('resize', resizeCanvas);

    // Wake the (possibly parked) loop whenever the plan's atmosphere changes.
    onAtmosphereChange(requestRender);

    // Use Page Visibility API to pause animations when tab is hidden
    document.addEventListener('visibilitychange', () => {
        isPageVisible = !document.hidden;
        if (isPageVisible) {
            // Reset timestamp to prevent large time jumps
            lastTimestamp_2d = performance.now();
            hasDrawnFirstFrame = false; // draw one frame so the canvas is never stale
            requestRender();
            log('BG-Engine', 'Page visible - resuming animations');
        } else {
            cancelPendingRender(); // don't let a queued shimmer tick fire behind a hidden tab
            log('BG-Engine', 'Page hidden - pausing animations to save resources');
        }
    });

    startTime = performance.now();
    lastTimestamp_2d = startTime;
    cancelPendingRender();
    requestRender();

    initDebugPanel();

    console.log('[BG-ENGINE DEBUG] Hybrid WebGL/2D Engine Initialized. animationFrameId:', animationFrameId);
    log('BG-Engine', 'Hybrid WebGL/2D Engine Initialized with Page Visibility optimization.');
}

function updateDebugPanel(progress, energy, time, drawCalls) {
    if (!debugPanel || debugPanel.style.display === 'none') return;
    
    const progressElem = document.getElementById('bg-progress-value');
    const energyElem = document.getElementById('bg-energy-value');
    const timeElem = document.getElementById('bg-time-value');
    const drawCallsElem = document.getElementById('bg-draw-calls');
    const statusText = document.getElementById('bg-status-text');
    const statusIndicator = document.getElementById('bg-status-indicator');
    
    const frame = getAtmosphereFrame();
    if (progressElem) {
        progressElem.textContent = `${progress.toFixed(3)} (crystal ${frame.crystal.toFixed(2)}, shimmer ${frame.shimmer.toFixed(2)}, seed ${frame.seed.toFixed(3)})`;
    }
    if (energyElem) energyElem.textContent = energy.toFixed(3);
    if (timeElem) timeElem.textContent = time.toFixed(1) + 's';
    if (drawCallsElem) drawCallsElem.textContent = drawCalls;
    
    if (statusText && statusIndicator) {
        if (currentEffect && gl) {
            statusText.textContent = 'Running (' + currentEffect.name + ')';
            statusIndicator.style.color = '#28a745';
        } else if (currentEffect && ctx_2d) {
            statusText.textContent = 'Running 2D (' + currentEffect.name + ')';
            statusIndicator.style.color = '#28a745';
        } else {
            statusText.textContent = 'Error: No effect loaded';
            statusIndicator.style.color = '#dc3545';
        }
    }
}

function initDebugPanel() {
    debugPanel = document.getElementById('bg-settings-panel');
    if (!debugPanel) {
        console.error('[BG-Engine] Debug panel not found in DOM');
        return;
    }
    
    const trigger = document.getElementById('bg-settings-trigger');
    if (trigger) {
        trigger.addEventListener('click', () => {
            debugPanel.style.display = debugPanel.style.display === 'none' ? 'block' : 'none';
        });
    }
    
    const closeBtn = document.getElementById('bg-settings-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            debugPanel.style.display = 'none';
        });
    }
    
    // Progress is derived from the plan now, so dragging this slider pins it to a manual
    // value and suspends derivation. Double-click the slider to hand control back.
    const progressSlider = document.getElementById('bg-progress-slider');
    if (progressSlider) {
        progressSlider.value = state.ui.currentProgress;
        progressSlider.addEventListener('input', (e) => {
            setManualProgress(parseFloat(e.target.value));
        });
        progressSlider.addEventListener('dblclick', () => {
            setManualProgress(null);
            refreshAtmosphere('debug-release');
            log('BG-Engine', 'Manual progress override released; derivation resumed.');
        });
    }

    const energySlider = document.getElementById('bg-energy-slider');
    if (energySlider) {
        energySlider.addEventListener('input', (e) => {
            setEnergy(parseFloat(e.target.value));
        });
    }

    const energyDecaySlider = document.getElementById('bg-energy-decay');
    if (energyDecaySlider) {
        energyDecaySlider.value = 0.985;
        energyDecaySlider.addEventListener('input', (e) => {
            const rate = parseFloat(e.target.value);
            setEnergyDecayPerFrame(rate);
            const valueDisplay = document.getElementById('bg-energy-decay-value');
            if (valueDisplay) {
                valueDisplay.textContent = rate.toFixed(2);
            }
        });
    }

    // The old progress multiplier scaled the per-action weights. Those weights no longer
    // accumulate, so the slider now reports the derived state instead of scaling it.
    const progressMultiplierSlider = document.getElementById('bg-progress-multiplier');
    if (progressMultiplierSlider) {
        progressMultiplierSlider.addEventListener('input', () => {
            log('BG-Engine', 'Progress is derived from the plan; multiplier has no effect.', getAtmosphereDebugInfo());
        });
    }
    
    const testEnergyBtn = document.getElementById('bg-test-energy');
    if (testEnergyBtn) {
        testEnergyBtn.addEventListener('click', () => {
            addEnergy();
        });
    }
    
    const testProgressBtn = document.getElementById('bg-test-progress');
    if (testProgressBtn) {
        testProgressBtn.addEventListener('click', () => {
            updateProgress(0.1);
        });
    }
}
