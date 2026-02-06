import { state, setState } from '../state.js';
import { CONSTANTS } from '../config.js';
import { log } from '../utils/debug.js';

let canvas;
let gl, ctx_2d;
let animationFrameId = null;
let currentEffect = null;
let debugPanel = null;

let startTime = 0;
let currentEnergy = 0.0;

let progressMultiplier = 1.0;
let energyDecayRate = 0.985;

let lastTimestamp_2d = 0;
let currentColors = [];
let settings = {};

let loopIterations = 0;
let lastProgressLog = 0;
let isPageVisible = true;

function animationLoop(timestamp) {
    if (!currentEffect) {
        animationFrameId = requestAnimationFrame(animationLoop);
        return;
    }

    // Pause rendering when page is hidden to save CPU/GPU resources
    if (!isPageVisible) {
        animationFrameId = requestAnimationFrame(animationLoop);
        return;
    }

    const currentProgress = state.ui.currentProgress;

    loopIterations++;

    updateDebugPanel(currentProgress, currentEnergy, timestamp / 1000.0, loopIterations);

    if (currentEffect.type === 'webgl') {
        if (!gl) {
             animationFrameId = requestAnimationFrame(animationLoop);
             return;
        }
        const elapsedTime = (timestamp - startTime) / 1000.0;
        currentEnergy *= energyDecayRate;
        if (currentEnergy < 0.01) currentEnergy = 0.0;

        if (currentProgress !== lastProgressLog) {
            lastProgressLog = currentProgress;
        }

        currentEffect.draw(gl, canvas.width, canvas.height, elapsedTime, currentEnergy, currentProgress);

    } else if (currentEffect.type === 'canvas') {
        if (!ctx_2d) {
            animationFrameId = requestAnimationFrame(animationLoop);
            return;
        }
        const deltaTime = timestamp - lastTimestamp_2d;
        lastTimestamp_2d = timestamp;
        currentEffect.draw(ctx_2d, canvas.width, canvas.height, deltaTime, currentColors, settings);
    }

    animationFrameId = requestAnimationFrame(animationLoop);
}

export function addEnergy() {
    log('BG-Engine', 'Adding energy boost!');
    currentEnergy = 1.0;
}

export function updateProgress(weight) {
    const adjustedWeight = weight * progressMultiplier;
    let newProgress = state.ui.currentProgress + adjustedWeight;
    newProgress = Math.min(1.0, Math.max(0.0, newProgress));

    if (newProgress !== state.ui.currentProgress) {
        setState({
            ui: {
                ...state.ui,
                currentProgress: newProgress
            }
        });
        
        if (weight > 0) {
            currentEnergy = Math.min(1.0, currentEnergy + adjustedWeight * 5);
        }
    }
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

    const resizeCanvas = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        if (currentEffect && typeof currentEffect.resize === 'function') {
            if (currentEffect.type === 'webgl' && gl) {
                gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
            } else if (currentEffect.type === 'canvas' && ctx_2d) {
                currentEffect.resize(canvas.width, canvas.height);
            }
        }
    };

    window.addEventListener('resize', resizeCanvas);

    // Use Page Visibility API to pause animations when tab is hidden
    document.addEventListener('visibilitychange', () => {
        isPageVisible = !document.hidden;
        if (isPageVisible) {
            // Reset timestamp to prevent large time jumps
            lastTimestamp_2d = performance.now();
            log('BG-Engine', 'Page visible - resuming animations');
        } else {
            log('BG-Engine', 'Page hidden - pausing animations to save resources');
        }
    });

    startTime = performance.now();
    lastTimestamp_2d = startTime;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(animationLoop);

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
    
    if (progressElem) progressElem.textContent = progress.toFixed(3);
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
    
    const progressSlider = document.getElementById('bg-progress-slider');
    if (progressSlider) {
        progressSlider.value = state.ui.currentProgress;
        progressSlider.addEventListener('input', (e) => {
            const newProgress = parseFloat(e.target.value);
            setState({
                ui: {
                    ...state.ui,
                    currentProgress: newProgress
                }
            });
        });
    }
    
    const energySlider = document.getElementById('bg-energy-slider');
    if (energySlider) {
        energySlider.addEventListener('input', (e) => {
            currentEnergy = parseFloat(e.target.value);
        });
    }
    
    const energyDecaySlider = document.getElementById('bg-energy-decay');
    if (energyDecaySlider) {
        energyDecaySlider.value = 0.985;
        energyDecaySlider.addEventListener('input', (e) => {
            energyDecayRate = parseFloat(e.target.value);
            const valueDisplay = document.getElementById('bg-energy-decay-value');
            if (valueDisplay) {
                valueDisplay.textContent = energyDecayRate.toFixed(2);
            }
        });
    }
    
    const progressMultiplierSlider = document.getElementById('bg-progress-multiplier');
    if (progressMultiplierSlider) {
        progressMultiplierSlider.addEventListener('input', (e) => {
            progressMultiplier = parseFloat(e.target.value);
            const valueDisplay = document.getElementById('bg-progress-multiplier-value');
            if (valueDisplay) {
                valueDisplay.textContent = progressMultiplier.toFixed(1);
            }
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
