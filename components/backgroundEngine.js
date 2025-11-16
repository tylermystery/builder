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

function animationLoop(timestamp) {
    if (!currentEffect) {
        animationFrameId = requestAnimationFrame(animationLoop);
        return;
    }

    const currentProgress = state.ui.currentProgress;
    
    loopIterations++;
    if (loopIterations % 120 === 0) {
        console.log('[BG-Engine] Animation loop check:');
        console.log('[BG-Engine]   - Iteration:', loopIterations);
        console.log('[BG-Engine]   - Progress:', currentProgress);
        console.log('[BG-Engine]   - Energy:', currentEnergy.toFixed(3));
        console.log('[BG-Engine]   - Effect:', currentEffect.type);
    }
    
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
            console.log('[BG-Engine] ========== PROGRESS CHANGED ==========');
            console.log('[BG-Engine] Iteration:', loopIterations);
            console.log('[BG-Engine] Progress:', lastProgressLog, '->', currentProgress);
            console.log('[BG-Engine] Energy:', currentEnergy.toFixed(3));
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
    console.log('[BG-Engine] ========== updateProgress CALLED ==========');
    console.log('[BG-Engine] Timestamp:', new Date().toISOString());
    console.log('[BG-Engine] Input weight:', weight);
    console.log('[BG-Engine] Progress multiplier:', progressMultiplier);
    console.log('[BG-Engine] Current progress:', state.ui.currentProgress);
    
    const adjustedWeight = weight * progressMultiplier;
    console.log('[BG-Engine] Adjusted weight:', adjustedWeight);
    
    let newProgress = state.ui.currentProgress + adjustedWeight;
    console.log('[BG-Engine] Calculated newProgress (before clamp):', newProgress);
    
    newProgress = Math.min(1.0, Math.max(0.0, newProgress));
    console.log('[BG-Engine] Clamped newProgress:', newProgress);

    if (newProgress !== state.ui.currentProgress) {
        log('BG-Engine', `Progress updated: ${state.ui.currentProgress.toFixed(3)} -> ${newProgress.toFixed(3)} (Weight: ${weight})`);
        console.log('[BG-Engine] Progress changed, updating state...');
        setState({
            ui: {
                ...state.ui,
                currentProgress: newProgress
            }
        });
        console.log('[BG-Engine] setState called');
        console.log('[BG-Engine] State after update:', state.ui.currentProgress);
        
        if (weight > 0) {
            currentEnergy = Math.min(1.0, currentEnergy + adjustedWeight * 5);
            console.log('[BG-Engine] Energy boosted to:', currentEnergy); 
        }
    } else {
        console.log('[BG-Engine] Progress unchanged, skipping state update');
    }
    console.log('[BG-Engine] ========== updateProgress COMPLETE ==========');
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
    log('BG-Engine', `Loading effect: ${effect.name}`);
    console.log('[BG-Engine] ========== loadEffect CALLED ==========');
    console.log('[BG-Engine] Effect name:', effect.name);
    console.log('[BG-Engine] Effect type:', effect.type);
    
    currentEffect = effect;
    settings = {};
    
    if (!canvas) {
        console.error('[BG-Engine] FATAL: Canvas not initialized before loadEffect!');
        return;
    }
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    console.log('[BG-Engine] Canvas reset to:', canvas.width, 'x', canvas.height);
            
    if (currentEffect.type === 'webgl') {
        console.log('[BG-Engine] Initializing WebGL context...');
        gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        ctx_2d = null;
        
        if (!gl) {
            console.error('[BG-Engine] FATAL: Could not get WebGL context!');
            console.log('[BG-Engine] Browser support:', {
                webgl: !!canvas.getContext('webgl'),
                experimental: !!canvas.getContext('experimental-webgl')
            });
            return;
        }
        
        console.log('[BG-Engine] WebGL context obtained successfully');
        console.log('[BG-Engine] WebGL info:', {
            version: gl.getParameter(gl.VERSION),
            vendor: gl.getParameter(gl.VENDOR),
            renderer: gl.getParameter(gl.RENDERER)
        });
        
        if (typeof currentEffect.init === 'function') {
            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
            console.log('[BG-Engine] Calling effect.init()...');
            currentEffect.init(gl);
            currentEffect.initialized = true;
            console.log('[BG-Engine] Effect initialized successfully');
        } else {
            console.error('[BG-Engine] Effect has no init function!');
        }
    } else if (currentEffect.type === 'canvas') {
        console.log('[BG-Engine] Initializing 2D canvas context...');
        ctx_2d = canvas.getContext('2d');
        gl = null;
        if (ctx_2d && typeof currentEffect.init === 'function') {
            ctx_2d.globalAlpha = 0.4;
            currentEffect.init(ctx_2d, canvas.width, canvas.height);
            currentEffect.initialized = true;
            console.log('[BG-Engine] 2D context initialized successfully');
        } else if (!ctx_2d) {
            console.error('[BG-Engine] FATAL: Could not get 2D context!');
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
    
    console.log('[BG-Engine] ========== loadEffect COMPLETE ==========');
}

export function initBackgroundEngine() {
    console.log('[BG-Engine] ========== initBackgroundEngine CALLED ==========');
    canvas = document.getElementById('kaleidoscope-bg'); 
    if (!canvas) {
        console.error('[BG-Engine] FATAL: Background canvas not found in DOM!');
        return;
    }
    console.log('[BG-Engine] Canvas element found:', canvas);
    console.log('[BG-Engine] Canvas dimensions:', canvas.width, 'x', canvas.height);
    console.log('[BG-Engine] Canvas display:', window.getComputedStyle(canvas).display);
    console.log('[BG-Engine] Canvas visibility:', window.getComputedStyle(canvas).visibility);
    console.log('[BG-Engine] Canvas z-index:', window.getComputedStyle(canvas).zIndex);
    
    const resizeCanvas = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        console.log('[BG-Engine] Canvas resized to:', canvas.width, 'x', canvas.height);
        
        if (currentEffect && typeof currentEffect.resize === 'function') {
            if (currentEffect.type === 'webgl' && gl) {
                gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
            } else if (currentEffect.type === 'canvas' && ctx_2d) {
                currentEffect.resize(canvas.width, canvas.height);
            }
        }
    };

    window.addEventListener('resize', resizeCanvas);
    
    startTime = performance.now();
    lastTimestamp_2d = startTime;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(animationLoop);
    
    initDebugPanel();
    
    log('BG-Engine', 'Hybrid WebGL/2D Engine Initialized.');
    console.log('[BG-Engine] ========== initBackgroundEngine COMPLETE ==========');
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
    
    console.log('[BG-Engine] Initializing debug panel...');
    
    const trigger = document.getElementById('bg-settings-trigger');
    if (trigger) {
        trigger.addEventListener('click', () => {
            debugPanel.style.display = debugPanel.style.display === 'none' ? 'block' : 'none';
            console.log('[BG-Engine] Debug panel toggled:', debugPanel.style.display);
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
            console.log('[BG-Engine] Manual progress change via slider:', newProgress);
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
            console.log('[BG-Engine] Manual energy change via slider:', currentEnergy);
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
            console.log('[BG-Engine] Energy decay rate changed:', energyDecayRate);
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
            console.log('[BG-Engine] Progress multiplier changed:', progressMultiplier);
        });
    }
    
    const testEnergyBtn = document.getElementById('bg-test-energy');
    if (testEnergyBtn) {
        testEnergyBtn.addEventListener('click', () => {
            console.log('[BG-Engine] Test energy button clicked');
            addEnergy();
        });
    }
    
    const testProgressBtn = document.getElementById('bg-test-progress');
    if (testProgressBtn) {
        testProgressBtn.addEventListener('click', () => {
            console.log('[BG-Engine] Test progress button clicked');
            updateProgress(0.1);
        });
    }
    
    console.log('[BG-Engine] Debug panel initialized successfully');
}
