// FILE: components/itinerary.js (REPLACE ENTIRE FILE)

import { state } from '../state.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from '../config.js';
import { updateUrl, getRecordPrice } from '../utils.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { log } from '../utils/debug.js';
import { triggerSave } from '../events.js';

// --- REMOVED: All top-level const declarations ---

// Module state
let zCounter = 10;
let currentDragItem = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let pendingCutout = null; 

let currentTransformAction = null; 
let startX = 0;
let startY = 0;
let startScale = 1;
let startRotation = 0;
let startAngle = 0;
let startDistance = 1;
let transformOrigin = { x: 0, y: 0 };
let startFlipped = false;


/**
 * Replaces any existing transformations in a Cloudinary URL with a new one.
 */
function replaceCloudinaryTransform(originalUrl, newTransform) {
    try {
        const url = new URL(originalUrl);
        const parts = url.pathname.split('/upload/');
        if (parts.length !== 2) return originalUrl; 
        const pathSegments = parts[1].split('/');
        if (pathSegments.length > 1 && (!pathSegments[0].startsWith('v') || !/v\\d+/.test(pathSegments[0]))) {
            pathSegments.shift();
        }
        const publicIdPath = pathSegments.join('/');
        url.pathname = `${parts[0]}/upload/${newTransform}/${publicIdPath}`;
        return url.toString();
    } catch (e) {
        console.error("Error parsing/replacing Cloudinary URL:", e);
        return originalUrl;
    }
}


/**
 * Updates the status text overlay on the canvas.
 */
function updateSceneStatus(text, isLoading = false) {
    // --- ADDED: Query inside function ---
    const statusText = document.getElementById('scene-status-text');
    // --- END ADD ---

    if (statusText) {
        statusText.innerHTML = `${isLoading ? '⚙️ ' : ''}${text}`;
        statusText.style.opacity = 1;
        
        if (!isLoading) {
            setTimeout(() => {
                if (statusText.innerHTML === text) {
                    statusText.style.opacity = 0;
                }
            }, 3000);
        }
    }
}


// --- NEW HELPER: Format Time String ---\n/**
 * Formats an HH:mm string (from type=\"time\") into a 12-hour AM/PM string.
 * @param {string} timeString - The \"HH:mm\" time string.
 * @returns {string} Formatted time (e.g., \"7:30 PM\").
 */
function formatTimeFromInput(timeString) {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12; // 0 or 12 should be 12
    return `${hours12}:${minutes < 10 ? '0' : ''}${minutes} ${ampm}`;
}

// --- UPDATED HELPER: Parse Time String ---\n/**
 * Parses an \"HH:mm\" time string into a sortable Date object.
 * @param {string} timeString - The \"HH:mm\" time string from state.
 * @returns {Date | null} A Date object or null if invalid.
 */
function parseItemTime(timeString) {
    if (!timeString) return null;

    const now = new Date();
    const [hours, minutes] = timeString.split(':').map(Number);
    
    if (isNaN(hours) || isNaN(minutes)) return null;
    
    now.setHours(hours, minutes, 0, 0);
    return now;
}


// --- UPDATED FEATURE: Draw SVG Path ---\n/**
 * Finds all cutouts with times, sorts them, and draws an animated SVG path between their centers.
 */
function drawItineraryPath() {
    // --- ADDED: Query inside function ---
    const svg = document.getElementById('scene-path-svg');
    // --- END ADD ---
    if (!svg) return;
    svg.innerHTML = '';

    // 1. Get and sort items with a valid start time
    const timedItems = [];
    for (const [uniqueId, pos] of state.session.itemPositions.entries()) {
        const parsedTime = parseItemTime(pos.timeStart); // <-- Use timeStart
        if (parsedTime) {
            timedItems.push({ uniqueId, pos, parsedTime });
        }
    }

    if (timedItems.length < 2) {
        return; // Not enough items to draw a path
    }

    timedItems.sort((a, b) => a.parsedTime - b.parsedTime);

    // 2. Get center points from the DOM
    const points = timedItems.map(({ uniqueId }) => {
        const wrapper = document.querySelector(`.scene-item-wrapper[data-unique-id=\"${uniqueId}\"]`);
        if (!wrapper) return null;
        
        const x = wrapper.offsetLeft + wrapper.offsetWidth / 2;
        const y = wrapper.offsetTop + wrapper.offsetHeight / 2;
        return { x, y };
    }).filter(Boolean); 

    // 3. Create arched paths
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        const archHeight = len * 0.15; 
        const controlX = midX - (dy / len) * archHeight;
        const controlY = midY + (dx / len) * archHeight;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const pathData = `M ${p1.x},${p1.y} Q ${controlX},${controlY} ${p2.x},${p2.y}`;
        
        path.setAttribute('d', pathData);
        path.setAttribute('class', 'itinerary-path-line');
        
        // --- ANIMATION FIX ---\n        // 1. Get approx length and set dasharray/offset to that length (line is invisible)
        const approxLength = Math.hypot(p1.x - controlX, p1.y - controlY) + Math.hypot(p2.x - controlX, p2.y - controlY);
        path.style.strokeDasharray = `${approxLength} ${approxLength}`;
        path.style.strokeDashoffset = approxLength;
        svg.appendChild(path);

        // 2. Trigger animation by setting offset to 0 after a stagger
        setTimeout(() => {
            path.style.strokeDashoffset = 0;
            // 3. After line draws, set to dotted for final state
            setTimeout(() => {
                path.style.strokeDasharray = `8 8`;
            }, 2000); // 2s transition
        }, 100 + i * 500); // Stagger the line animations
        // --- END ANIMATION FIX ---\n    }
}


/**
 * Renders a single cutout wrapper, image, and controls onto the canvas.
 */
function renderSingleCutout(uniqueId, pos) {
    // --- ADDED: Query inside function ---
    const sceneCanvas = document.getElementById('scene-builder-canvas');
    // --- END ADD ---
    if (!sceneCanvas) return;
    
    const { imageUrl, prompt } = pos;
    if (!imageUrl) return;

    // 1. 🪄 The Cloudinary AI Magic 🪄
    let cutoutUrl;
    let newTransform; 

    if (prompt && prompt.trim() !== '') {
        const encodedPrompt = encodeURIComponent(prompt.trim());
        newTransform = `e_gen_remove:prompt_${encodedPrompt},w_250,a_ignore,f_png`;
        log('Itinerary', `Using Generative Remove, prompt: ${prompt}`);
    } else {
        newTransform = 'e_background_removal,w_250,f_png';
        log('Itinerary', 'No prompt, using simple background removal.');
    }
    cutoutUrl = replaceCloudinaryTransform(imageUrl, newTransform);

    // 2. Create a wrapper for the image and its controls
    const wrapper = document.createElement('div');
    wrapper.className = 'scene-item-wrapper';
    wrapper.dataset.uniqueId = uniqueId;
    wrapper.style.left = `${pos.x}px`;
    wrapper.style.top = `${pos.y}px`;
    wrapper.style.zIndex = pos.z;
    const flipTransform = pos.flipped ? 'scaleX(-1)' : '';
    wrapper.style.transform = `scale(${pos.scale || 1}) rotate(${pos.rotation || 0}deg) ${flipTransform}`;

    // 3. Create the image
    const img = document.createElement('img');
    img.src = cutoutUrl;
    img.className = 'scene-cutout';
    img.setAttribute('draggable', false);
    img.onload = () => updateSceneStatus("Item added! Drag to move.");
    img.onerror = () => updateSceneStatus("❌ Error creating cutout. Try a different prompt.");

    // 4. Add transform controls (flip, rotate, resize)
    const controls = document.createElement('div');
    controls.className = 'scene-item-controls';
    controls.innerHTML = `
        <div class=\"scene-flip-handle\" data-action=\"flip\" title=\"Flip\">⇋</div>
        <div class=\"scene-rotate-handle\" data-action=\"rotate\" title=\"Rotate\">↻</div>
        <div class=\"scene-resize-handle\" data-action=\"resize\" title=\"Resize\">⤭</div>
    `;

    wrapper.appendChild(img);

    // --- UPDATED BLOCK: Display formatted time/note ---\n    let infoHtml = '';
    if (pos.timeStart) {
        let timeText = formatTimeFromInput(pos.timeStart);
        if (pos.timeEnd) {
            timeText += ` - ${formatTimeFromInput(pos.timeEnd)}`;
        }
        infoHtml += `<div class=\"scene-item-time\">${timeText}</div>`;
    }
    if (pos.note) {
        infoHtml += `<div class=\"scene-item-note\">${pos.note}</div>`;
    }
    
    if (infoHtml) {
        const infoEl = document.createElement('div');
        infoEl.className = 'scene-item-info';
        infoEl.innerHTML = infoHtml;
        wrapper.appendChild(infoEl);
    }
    // --- END UPDATED BLOCK ---\n
    wrapper.appendChild(controls);

    // 5. Wire up mouse events to the WRAPPER
    wrapper.addEventListener('mousedown', (e) => {
        e.preventDefault();
        
        const action = e.target.dataset.action;
        
        if (action === 'rotate' || action === 'resize') {
            handleTransformStart(e, wrapper, action);
        } else if (action === 'flip') {
            handleFlipToggle(wrapper);
        } else {
            // Default drag behavior (move)
            updateSceneStatus("Dragging item...");
            currentDragItem = wrapper; 
            currentDragItem.classList.add('is-dragging');
            const rect = wrapper.getBoundingClientRect(); 
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            zCounter++; 
            wrapper.style.zIndex = zCounter; 
            wrapper.style.cursor = 'grabbing';
        }
    });
    
    // --- FIX: Query sceneCanvas again for safety ---
    const canvasForEvent = document.getElementById('scene-builder-canvas');
    if (canvasForEvent) {
        canvasForEvent.appendChild(wrapper);
    }
    // --- END FIX ---
}


/**
 * Draws all saved cutouts from state onto the canvas
 */
function renderCutouts() {
    // --- ADDED: Queries inside function ---
    const sceneCanvas = document.getElementById('scene-builder-canvas');
    const statusText = document.getElementById('scene-status-text');
    const scenePathSvg = document.getElementById('scene-path-svg');
    // --- END ADD ---

    if (!sceneCanvas) return;
    sceneCanvas.innerHTML = ''; 
    if (statusText) sceneCanvas.appendChild(statusText); 
    if (scenePathSvg) sceneCanvas.appendChild(scenePathSvg); 
    zCounter = 10; 

    for (const [uniqueId, pos] of state.session.itemPositions.entries()) {
        renderSingleCutout(uniqueId, pos);
        if (pos.z > zCounter) zCounter = pos.z;
    }
    
    drawItineraryPath();
    
    if(state.session.itemPositions.size === 0) {
        updateSceneStatus("Drag items from the palette onto the canvas.");
    }
}

/**
 * Initializes a resize or rotate transform operation.
 */
function handleTransformStart(e, wrapper, action) {
    currentTransformAction = action;
    currentDragItem = wrapper; 
    currentDragItem.classList.add('is-dragging');
    zCounter++;
    currentDragItem.style.zIndex = zCounter;

    const rect = wrapper.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    transformOrigin = { x: centerX, y: centerY };
    startX = e.clientX;
    startY = e.clientY;

    const uniqueId = wrapper.dataset.uniqueId;
    const pos = state.session.itemPositions.get(uniqueId);
    
    startScale = pos.scale || 1;
    startRotation = pos.rotation || 0;
    startFlipped = pos.flipped || false; 
    
    if (action === 'rotate') {
        updateSceneStatus("Rotating item...");
        const dx = e.clientX - centerX;
        const dy = e.clientY - centerY;
        startAngle = Math.atan2(dy, dx) * (180 / Math.PI) - startRotation;
    } else if (action === 'resize') {
        updateSceneStatus("Resizing item...");
        const dx = e.clientX - centerX;
        const dy = e.clientY - centerY;
        startDistance = Math.hypot(dx, dy);
    }
}

/**
 * Immediately toggles the horizontal flip state of a scene item.
 */
function handleFlipToggle(wrapper) {
    if (!wrapper) return;

    const uniqueId = wrapper.dataset.uniqueId;
    const pos = state.session.itemPositions.get(uniqueId);
    if (!pos) return;

    pos.flipped = !pos.flipped;

    const flipTransform = pos.flipped ? 'scaleX(-1)' : '';
    const scale = pos.scale || 1;
    const rotation = pos.rotation || 0;
    wrapper.style.transform = `scale(${scale}) rotate(${rotation}deg) ${flipTransform}`;
    
    state.session.itemPositions.set(uniqueId, pos);
    triggerSave();
    updateSceneStatus(pos.flipped ? "Item flipped" : "Item un-flipped");
    
    drawItineraryPath();
}


/**
 * Renders the palette with BOTH locked items and ideas
 */
async function renderScene() {
    // --- ADDED: Queries inside function ---
    const sceneCanvas = document.getElementById('scene-builder-canvas');
    const bgThumbContainer = document.querySelector('.background-thumbnails');
    const itemPaletteContainer = document.querySelector('.palette-items');
    // --- END ADD ---

    if (!sceneCanvas || !bgThumbContainer || !itemPaletteContainer) {
        log('Itinerary', 'Scene Builder DOM elements not found.');
        return;
    }

    // 1. Find Venue and render backgrounds
    bgThumbContainer.innerHTML = '';
    const venueRecords = state.records.all.filter(r => 
        state.cart.lockedItems.has(r.id) && 
        r.fields.Categories?.toLowerCase().includes('venue')
    );
    const bgDescription = bgThumbContainer.parentElement.querySelector('p.description');
    
    if (venueRecords.length > 0) {
        if(bgDescription) bgDescription.style.display = 'none';
        
        let hasSetDefaultBackground = false;

        for (const venueRecord of venueRecords) {
            const { imageUrls } = await api.fetchImagesForRecord(venueRecord, state.records.all, new Map());
            
            imageUrls.forEach(url => {
                const thumb = document.createElement('div');
                thumb.className = 'background-thumb';
                const thumbUrl = url.replace('/upload/', '/upload/c_fill,g_auto,w_50,h_50/');
                thumb.innerHTML = `<img src=\\\"${thumbUrl}\\\" alt=\\\"Venue option\\\"> <span>${venueRecord.fields.Name}</span>`;
                thumb.addEventListener('click', () => {
                    sceneCanvas.style.backgroundImage = `url('${url}')`;
                    updateSceneStatus("Background set!");
                });
                bgThumbContainer.appendChild(thumb);
            });

            if (imageUrls.length > 0 && !hasSetDefaultBackground && !sceneCanvas.style.backgroundImage) {
                sceneCanvas.style.backgroundImage = `url('${imageUrls[0]}')`;
                hasSetDefaultBackground = true;
            }
        }
    } else {
        if(bgDescription) bgDescription.style.display = 'block';
    }

    // 2. Render the palette with BOTH locked items and ideas
    itemPaletteContainer.innerHTML = '';
    const paletteDescription = itemPaletteContainer.parentElement.querySelector('p.description');
    const allItems = new Map([
        ...Array.from(state.cart.lockedItems.entries()).map(([id, info]) => [id, { info, type: 'locked' }]),
        ...Array.from(state.cart.items.entries()).map(([id, info]) => [id, { info, type: 'idea' }])
    ]);

    if (allItems.size === 0) {
        if(paletteDescription) paletteDescription.style.display = 'block';
    } else {
        if(paletteDescription) paletteDescription.style.display = 'none';
        for (const [recordId, { info, type }] of allItems.entries()) {
            const record = state.records.all.find(r => r.id === recordId);
            if (!record) continue;
            const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
            const itemEl = document.createElement('div');
            itemEl.className = `palette-item ${type}`; 
            itemEl.setAttribute('draggable', true);
            const thumbUrl = (imageUrls[0] || ui.getPlaceholderImage([])).replace('/upload/', '/upload/c_fill,g_auto,w_50,h_50/');
            itemEl.innerHTML = `<img src=\\\"${thumbUrl}\\\" alt=\\\"${record.fields.Name}\\\"> <span>${record.fields.Name}</span>`;
            itemEl.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', recordId);
                e.dataTransfer.effectAllowed = 'copy';
                updateSceneStatus("Release to choose cutout...");
            });
            itemPaletteContainer.appendChild(itemEl);
        }
    }
    
    // 3. Render all existing cutouts from state
    renderCutouts(); // This will now also call drawItineraryPath()\n}

/**
 * Shows the \"Cutout Picker\" popover and populates it with context.
 */
async function showCutoutPicker(record, x, y) {
    // --- ADDED: Queries inside function ---
    const cutoutPicker = document.getElementById('cutout-picker-popover');
    const cutoutPickerTitle = document.getElementById('cutout-picker-title');
    const cutoutPickerThumbnails = document.getElementById('cutout-picker-thumbnails');
    const cutoutAiPrompt = document.getElementById('cutout-ai-prompt');
    const cutoutPromptContainer = document.getElementById('cutout-prompt-container');
    const cutoutContextThumb = document.getElementById('cutout-context-thumb');
    // --- END ADD ---

    if (!cutoutPicker) return;
    updateSceneStatus("Fetching image options...", true);

    pendingCutout = { record, x, y, selectedUrl: null };

    // Reset UI
    cutoutPickerTitle.textContent = `Select image for: ${record.fields.Name}`;
    cutoutPickerThumbnails.innerHTML = '';
    cutoutAiPrompt.value = '';
    // --- UPDATED: Reset new time fields ---\n    document.getElementById('cutout-item-time-start').value = '';
    document.getElementById('cutout-item-time-end').value = '';
    document.getElementById('cutout-item-note').value = '';
    // --- END UPDATE ---\n    cutoutPromptContainer.style.display = 'none';
    
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    
    const contextThumbUrl = (imageUrls[0] || ui.getPlaceholderImage([])).replace('/upload/', '/upload/c_fill,g_auto,w_50,h_50/');
    if (cutoutContextThumb) cutoutContextThumb.style.backgroundImage = `url('${contextThumbUrl}')`;

    if (imageUrls.length === 0) {
        updateSceneStatus("Item has no images, adding placeholder.");
        addCutoutToScene(ui.getPlaceholderImage([]), ''); 
        return;
    }

    imageUrls.forEach(url => {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail-img';
        thumb.style.backgroundImage = `url('${url.replace('/upload/', '/upload/c_fill,g_auto,w_100,h_80/')}')`;
        
        thumb.addEventListener('click', () => {
            cutoutPickerThumbnails.querySelectorAll('.thumbnail-img').forEach(t => t.classList.remove('selected'));
            thumb.classList.add('selected');
            
            pendingCutout.selectedUrl = url;
            cutoutPromptContainer.style.display = 'block';
            cutoutAiPrompt.focus();
            updateSceneStatus("Now, tell the AI what to cut out.");
        });
        cutoutPickerThumbnails.appendChild(thumb);
    });

    updateSceneStatus("Select an image to use as the cutout source.");
    cutoutPicker.style.display = 'flex';
    
    requestAnimationFrame(() => {
        cutoutPicker.classList.add('active');
    });
}

/**
 * Hides the \"Cutout Picker\" popover.
 */
function hideCutoutPicker() {
    // --- ADDED: Query inside function ---
    const cutoutPicker = document.getElementById('cutout-picker-popover');
    // --- END ADD ---
    if (cutoutPicker) {
        cutoutPicker.classList.remove('active');
        setTimeout(() => {
            cutoutPicker.style.display = 'none';
        }, 300); 
    }
    pendingCutout = null;
}


/**
 * Final step: creates the cutout and saves it to state.
 */
function addCutoutToScene(imageUrl, promptText) {
    if (!pendingCutout) return;
    updateSceneStatus("⚙️ AI is generating cutout...", true);

    const { record, x, y } = pendingCutout;
    zCounter++;
    
    const uniqueId = `cutout-${Date.now()}`;

    // --- UPDATED: Read new time values ---\n    const itemTimeStart = document.getElementById('cutout-item-time-start').value || null;
    const itemTimeEnd = document.getElementById('cutout-item-time-end').value || null;
    const itemNote = document.getElementById('cutout-item-note').value.trim() || null;
    // --- END UPDATE ---\n    
    const newPosition = {
        recordId: record.id,
        imageUrl: imageUrl, 
        prompt: promptText, 
        x: x - 75,
        y: y - 75,
        z: zCounter,
        scale: 1,      
        rotation: 0,   
        flipped: false,
        timeStart: itemTimeStart, // <-- UPDATED\n        timeEnd: itemTimeEnd,     // <-- ADDED\n        note: itemNote
    };
            
    state.session.itemPositions.set(uniqueId, newPosition);
    triggerSave();
    
    renderSingleCutout(uniqueId, newPosition);
    drawItineraryPath();
    hideCutoutPicker();
}

/**
 * Sets up all event listeners for the Itinerary (Scene Builder) modal
 */
export function setupItineraryEventListeners() {
    // --- ADDED: Queries inside function ---
    const itineraryModal = document.getElementById('itinerary-modal-overlay');
    const closeBtn = document.getElementById('itinerary-close-btn');
    const cutoutPicker = document.getElementById('cutout-picker-popover');
    const cutoutPickerCloseBtn = document.getElementById('cutout-picker-close-btn');
    const cutoutPickerSubmitBtn = document.getElementById('cutout-picker-submit-btn');
    const cutoutAiPrompt = document.getElementById('cutout-ai-prompt');
    const sceneCanvas = document.getElementById('scene-builder-canvas');
    const fullscreenBtn = document.getElementById('scene-fullscreen-btn');
    // --- END ADD ---

    log('Itinerary', 'Initializing Scene Builder listeners.');

    // --- FIX: Add safety checks ---
    closeBtn?.addEventListener('click', () => {
        updateUrl({ view: null });
        hideItineraryModal();
    });
    itineraryModal?.addEventListener('click', (e) => {
        if (e.target === itineraryModal) {
            updateUrl({ view: null });
            hideItineraryModal();
        }
    });

    cutoutPickerCloseBtn?.addEventListener('click', hideCutoutPicker);
    cutoutPicker?.addEventListener('click', (e) => {
        if (e.target === cutoutPicker) hideCutoutPicker();
    });
    
    cutoutPickerSubmitBtn?.addEventListener('click', () => {
        if (pendingCutout && pendingCutout.selectedUrl) {
            addCutoutToScene(pendingCutout.selectedUrl, cutoutAiPrompt?.value);
        } else {
            log('Itinerary', 'Cutout submit clicked, but no image was selected.');
            updateSceneStatus("Please select an image first.");
        }
    });

    if (sceneCanvas) {
        sceneCanvas.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        
        sceneCanvas.addEventListener('dragleave', (e) => {
            if(state.session.itemPositions.size === 0) {
                 updateSceneStatus("Drag items from the palette onto the canvas.");
            } else {
                const statusText = document.getElementById('scene-status-text');
                if (statusText) statusText.style.opacity = 0; 
            }
        });

        sceneCanvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const recordId = e.dataTransfer.getData('text/plain');
            const record = state.records.all.find(r => r.id === recordId);
            if (!record) return;

            const rect = sceneCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            showCutoutPicker(record, x, y);
        });
    }
    
    document.addEventListener('mousemove', (e) => {
        if (!currentDragItem) return;
        e.preventDefault(); 

        const flipTransform = startFlipped ? 'scaleX(-1)' : '';

        if (currentTransformAction === 'rotate') {
            const dx = e.clientX - transformOrigin.x;
            const dy = e.clientY - transformOrigin.y;
            const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
            const rotation = Math.round(currentAngle - startAngle);
            currentDragItem.style.transform = `scale(${startScale}) rotate(${rotation}deg) ${flipTransform}`;
            currentDragItem.dataset.currentRotation = rotation; 
        } else if (currentTransformAction === 'resize') {
            const dx = e.clientX - transformOrigin.x;
            // --- THIS IS THE FIX: Use transformOrigin.y instead of centerY ---
            const dy = e.clientY - transformOrigin.y;
            // --- END FIX ---
            const currentDistance = Math.hypot(dx, dy);
            let scale = (currentDistance / startDistance) * startScale;
            scale = Math.max(0.1, Math.min(scale, 5)); 
            currentDragItem.style.transform = `scale(${scale}) rotate(${startRotation}deg) ${flipTransform}`;
            currentDragItem.dataset.currentScale = scale;
        } else { 
            const canvasForMove = document.getElementById('scene-builder-canvas');
            if (!canvasForMove) return;
            const rect = canvasForMove.getBoundingClientRect();
            let x = e.clientX - rect.left - dragOffsetX;
            let y = e.clientY - rect.top - dragOffsetY;
            const itemRect = currentDragItem.getBoundingClientRect();
            x = Math.max(-itemRect.width / 2, Math.min(x, rect.width - itemRect.width / 2));
            y = Math.max(-itemRect.height / 2, Math.min(y, rect.height - itemRect.height / 2));
            currentDragItem.style.left = `${x}px`;
            currentDragItem.style.top = `${y}px`;
        }
        
        drawItineraryPath();
    });

    document.addEventListener('mouseup', () => {
        if (!currentDragItem) return;

        currentDragItem.classList.remove('is-dragging');
        currentDragItem.style.cursor = 'move';
        updateSceneStatus("Position saved!");
        
        const uniqueId = currentDragItem.dataset.uniqueId;
        const posObject = state.session.itemPositions.get(uniqueId);
        
        if (posObject) {
            if (currentTransformAction === 'resize') {
                posObject.scale = parseFloat(currentDragItem.dataset.currentScale) || startScale;
                posObject.rotation = startRotation; 
                posObject.flipped = startFlipped; 
            } else if (currentTransformAction === 'rotate') {
                posObject.scale = startScale; 
                posObject.rotation = parseFloat(currentDragItem.dataset.currentRotation) || startRotation;
                posObject.flipped = startFlipped; 
            } else {
                posObject.x = parseFloat(currentDragItem.style.left);
                posObject.y = parseFloat(currentDragItem.style.top);
            }
            posObject.z = parseInt(currentDragItem.style.zIndex); 
            
            state.session.itemPositions.set(uniqueId, posObject);
            triggerSave();
        }
        
        drawItineraryPath();
        
        currentDragItem = null;
        currentTransformAction = null;
        startX = 0;
        startY = 0;
        startScale = 1;
        startRotation = 0;
        startAngle = 0;
        startDistance = 1;
    });

    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            const modalContent = document.querySelector('#itinerary-modal-overlay .modal-content');
            if (!modalContent) return;

            if (!document.fullscreenElement) {
                modalContent.requestFullscreen().catch(err => {
                    alert(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
                });
            } else {
                document.exitFullscreen();
            }
        });
    }
    // --- END FIX ---
}

/**
 * Shows the Itinerary (Scene Builder) modal
 */
export function showItineraryModal() {
    // --- ADDED: Query inside function ---
    const itineraryModal = document.getElementById('itinerary-modal-overlay');
    // --- END ADD ---

    updateUrl({ view: 'itinerary' });
    log('Itinerary', 'Showing itinerary modal (Scene Builder).');

    const titleEl = document.getElementById('scene-header-title');
    const dateEl = document.getElementById('scene-header-date');
    
    if (titleEl && dateEl) {
        const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME);
        titleEl.textContent = eventName || 'Your Event Scene';
        
        const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
        if (dateValue) {
            const dateStr = Array.isArray(dateValue) ? dateValue[0] : dateValue;
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                dateEl.textContent = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            } else {
                dateEl.textContent = 'Invalid date';
            }
        } else {
            dateEl.textContent = 'No date set';
        }
    }

    renderScene(); 
    
    // --- FIX: Add safety check ---
    if (itineraryModal) {
        itineraryModal.classList.add('active');
        itineraryModal.style.display = 'flex';
    }
    // --- END FIX ---
    document.body.classList.add('modal-open');
}

/**
 * Hides the Itinerary (Scene Builder) modal
 */
export function hideItineraryModal() {
    // --- ADDED: Query inside function ---
    const itineraryModal = document.getElementById('itinerary-modal-overlay');
    // --- END ADD ---

    log('Itinerary', 'Hiding itinerary modal.');
    hideCutoutPicker();
    
    // --- FIX: Add safety check ---
    if (itineraryModal) {
        itineraryModal.classList.remove('active');
        setTimeout(() => {
            itineraryModal.style.display = 'none';
        }, 300);
    }
    // --- END FIX ---
    document.body.classList.remove('modal-open');
}
