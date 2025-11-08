// FILE: components/itinerary.js (REPLACE ENTIRE FILE)

import { state } from '../state.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from '../config.js';
import { updateUrl, getRecordPrice } from '../utils.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { log } from '../utils/debug.js';
import { triggerSave } from '../events.js';

// Get DOM elements
const itineraryModal = document.getElementById('itinerary-modal-overlay');
const closeBtn = document.getElementById('itinerary-close-btn');
const sceneCanvas = document.getElementById('scene-builder-canvas');
const bgThumbContainer = document.querySelector('.background-thumbnails');
const itemPaletteContainer = document.querySelector('.palette-items');
const statusText = document.getElementById('scene-status-text');

// Cutout Picker DOM Elements
const cutoutPicker = document.getElementById('cutout-picker-popover');
const cutoutPickerTitle = document.getElementById('cutout-picker-title');
const cutoutPickerThumbnails = document.getElementById('cutout-picker-thumbnails');
const cutoutPickerCloseBtn = document.getElementById('cutout-picker-close-btn');
const cutoutPromptContainer = document.getElementById('cutout-prompt-container');
const cutoutAiPrompt = document.getElementById('cutout-ai-prompt');
const cutoutPickerSubmitBtn = document.getElementById('cutout-picker-submit-btn'); // <-- Fix: Added this definition
// --- NEW --- Context Thumbnail
const cutoutContextThumb = document.getElementById('cutout-context-thumb');

// Module state
let zCounter = 10;
let currentDragItem = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let pendingCutout = null; // Stores { record, x, y, selectedUrl }

// --- ADD THESE NEW VARIABLES ---
let currentTransformAction = null; // 'resize', 'rotate', or null
let startX = 0;
let startY = 0;
let startScale = 1;
let startRotation = 0;
let startAngle = 0;
let startDistance = 1;
let transformOrigin = { x: 0, y: 0 };
let startFlipped = false;
// --- END ADD ---


// --- ADD THIS NEW HELPER FUNCTION ---
/**
 * Replaces any existing transformations in a Cloudinary URL with a new one.
 * @param {string} originalUrl - The URL from the API (e.g., .../upload/c_fill,f_jpg/v123/img.jpg)
 * @param {string} newTransform - The new transformation (e.g., e_background_removal,f_png)
 * @returns {string} The new URL (e.g., .../upload/e_background_removal,f_png/v123/img.jpg)
 */
function replaceCloudinaryTransform(originalUrl, newTransform) {
    try {
        const url = new URL(originalUrl);
        const parts = url.pathname.split('/upload/');
        if (parts.length !== 2) return originalUrl; // Not a standard Cloudinary URL

        // parts[1] is something like "c_fill,f_jpg/v12345/my/image.jpg" OR "v12345/my/image.jpg"
        const pathSegments = parts[1].split('/');
        
        // Check if the first segment is a transformation (doesn't start with 'v' + digits)
        if (pathSegments.length > 1 && (!pathSegments[0].startsWith('v') || !/v\d+/.test(pathSegments[0]))) {
            // It's a transformation, so remove it
            pathSegments.shift();
        }

        // Rebuild the path
        const publicIdPath = pathSegments.join('/');
        
        // Construct the new URL
        url.pathname = `${parts[0]}/upload/${newTransform}/${publicIdPath}`;
        return url.toString();
    } catch (e) {
        console.error("Error parsing/replacing Cloudinary URL:", e);
        return originalUrl; // Fallback
    }
}
// --- END NEW HELPER FUNCTION ---


// --- NEW HELPER ---
/**
 * Updates the status text overlay on the canvas.
 * @param {string} text - The message to display.
 * @param {boolean} [isLoading=false] - If true, adds a spinner.
 */
function updateSceneStatus(text, isLoading = false) {
    if (statusText) {
        statusText.innerHTML = `${isLoading ? '⚙️ ' : ''}${text}`;
        statusText.style.opacity = 1;
        
        // Don't fade out if it's a loading message
        if (!isLoading) {
            setTimeout(() => {
                // Only fade if the text hasn't been replaced by a new message
                if (statusText.innerHTML === text) {
                    statusText.style.opacity = 0;
                }
            }, 3000);
        }
    }
}

// --- REPLACE THIS ENTIRE FUNCTION ---
function renderSingleCutout(uniqueId, pos) {
    if (!sceneCanvas) return;
    
    const { imageUrl, prompt } = pos;
    if (!imageUrl) return;

    // 1. 🪄 The Cloudinary AI Magic 🪄
    let cutoutUrl;
    let newTransform; // This will hold our desired transformation string

    if (prompt && prompt.trim() !== '') {
        const encodedPrompt = encodeURIComponent(prompt.trim());
        // Define the *new* transform string (w_250, f_png)
        newTransform = `e_gen_remove:prompt_${encodedPrompt},w_250,a_ignore,f_png`;
        log('Itinerary', `Using Generative Remove, prompt: ${prompt}`);
    } else {
        // Define the *new* transform string (w_250, f_png)
        newTransform = 'e_background_removal,w_250,f_png';
        log('Itinerary', 'No prompt, using simple background removal.');
    }

    // Use the new helper function to *replace* any existing transforms (like f_jpg)
    // with our new background removal transform.
    cutoutUrl = replaceCloudinaryTransform(imageUrl, newTransform);

    // 2. Create a wrapper for the image and its controls
    const wrapper = document.createElement('div');
    wrapper.className = 'scene-item-wrapper';
    wrapper.dataset.uniqueId = uniqueId;
    wrapper.style.left = `${pos.x}px`;
    wrapper.style.top = `${pos.y}px`;
    wrapper.style.zIndex = pos.z;
    // Apply saved scale, rotation, and flip
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
        <div class="scene-flip-handle" data-action="flip" title="Flip">⇋</div>
        <div class="scene-rotate-handle" data-action="rotate" title="Rotate">↻</div>
        <div class="scene-resize-handle" data-action="resize" title="Resize">⤭</div>
    `;

    wrapper.appendChild(img);

    // --- ADD THIS BLOCK: Display time and note ---
    let infoHtml = '';
    if (pos.time) {
        infoHtml += `<div class="scene-item-time">${pos.time}</div>`;
    }
    if (pos.note) {
        infoHtml += `<div class="scene-item-note">${pos.note}</div>`;
    }
    
    if (infoHtml) {
        const infoEl = document.createElement('div');
        infoEl.className = 'scene-item-info';
        infoEl.innerHTML = infoHtml;
        wrapper.appendChild(infoEl);
    }
    // --- END ADD ---

    wrapper.appendChild(controls);

    // 5. Wire up mouse events to the WRAPPER
    wrapper.addEventListener('mousedown', (e) => {
        e.preventDefault();
        
        const action = e.target.dataset.action;
        
        if (action === 'rotate' || action === 'resize') {
            // Pass to the new transform handler
            handleTransformStart(e, wrapper, action);
        } else if (action === 'flip') {
            // Pass to the new flip handler
            handleFlipToggle(wrapper);
        } else {
            // Default drag behavior (move)
            updateSceneStatus("Dragging item...");
            currentDragItem = wrapper; // <-- Drag the wrapper
            currentDragItem.classList.add('is-dragging');
            
            const rect = wrapper.getBoundingClientRect(); // <-- Get wrapper rect
            // Calculate offset relative to the *scaled/rotated* element
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            
            zCounter++; 
            wrapper.style.zIndex = zCounter; // <-- Set wrapper z-index
            wrapper.style.cursor = 'grabbing';
        }
    });
    
    sceneCanvas.appendChild(wrapper);
}
// --- END REPLACE ---


/**
 * Draws all saved cutouts from state onto the canvas
 */
function renderCutouts() {
    if (!sceneCanvas) return;
    sceneCanvas.innerHTML = ''; // Clear existing cutouts
    sceneCanvas.appendChild(statusText); // Re-add status text
    zCounter = 10; 

    for (const [uniqueId, pos] of state.session.itemPositions.entries()) {
        renderSingleCutout(uniqueId, pos);
        if (pos.z > zCounter) zCounter = pos.z;
    }
    
    // Show the \"Drop\" message only if the canvas is empty
    if(state.session.itemPositions.size === 0) {
        updateSceneStatus("Drag items from the palette onto the canvas.");
    }
}

// --- ADD THIS ENTIRE NEW FUNCTION ---
/**
 * Initializes a resize or rotate transform operation.
 * @param {MouseEvent} e - The mousedown event.
 * @param {HTMLElement} wrapper - The scene item wrapper being transformed.
 * @param {string} action - 'resize' or 'rotate'.
 */
function handleTransformStart(e, wrapper, action) {
    currentTransformAction = action;
    currentDragItem = wrapper; // The item being transformed
    currentDragItem.classList.add('is-dragging');
    zCounter++;
    currentDragItem.style.zIndex = zCounter;

    const rect = wrapper.getBoundingClientRect();
    // Get center of the element for rotation/scaling calculations
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
        // Calculate the starting angle between the mouse and the element's center
        const dx = e.clientX - centerX;
        const dy = e.clientY - centerY;
        startAngle = Math.atan2(dy, dx) * (180 / Math.PI) - startRotation;
    } else if (action === 'resize') {
        updateSceneStatus("Resizing item...");
        // Calculate the initial distance from the center to the mouse
        const dx = e.clientX - centerX;
        const dy = e.clientY - centerY;
        startDistance = Math.hypot(dx, dy);
        // startScale (the item's scale) is already set
    }
}

// --- ADD THIS ENTIRE NEW FUNCTION ---
/**
 * Immediately toggles the horizontal flip state of a scene item.
 * @param {HTMLElement} wrapper - The scene item wrapper to flip.
 */
function handleFlipToggle(wrapper) {
    if (!wrapper) return;

    const uniqueId = wrapper.dataset.uniqueId;
    const pos = state.session.itemPositions.get(uniqueId);
    if (!pos) return;

    // Toggle the flipped state
    pos.flipped = !pos.flipped;

    // Re-apply the transform immediately
    const flipTransform = pos.flipped ? 'scaleX(-1)' : '';
    const scale = pos.scale || 1;
    const rotation = pos.rotation || 0;
    wrapper.style.transform = `scale(${scale}) rotate(${rotation}deg) ${flipTransform}`;
    
    // Save the change
    state.session.itemPositions.set(uniqueId, pos);
    triggerSave();
    updateSceneStatus(pos.flipped ? "Item flipped" : "Item un-flipped");
}


/**
 * Renders the palette with BOTH locked items and ideas
 */
async function renderScene() {
    if (!sceneCanvas || !bgThumbContainer || !itemPaletteContainer) {
        log('Itinerary', 'Scene Builder DOM elements not found.');
        return;
    }

    // 1. Find Venue and render backgrounds
    bgThumbContainer.innerHTML = '';

    // --- THIS IS THE FIX (Part 1) ---
    // Use .filter() to find ALL locked-in venues, not just the first one.
    const venueRecords = state.records.all.filter(r => 
        state.cart.lockedItems.has(r.id) && 
        r.fields.Categories?.toLowerCase().includes('venue')
    );
    // --- END FIX ---

    const bgDescription = bgThumbContainer.parentElement.querySelector('p.description');
    
    // --- THIS IS THE FIX (Part 2) ---
    // Check if the array has any venues.
    if (venueRecords.length > 0) {
        if(bgDescription) bgDescription.style.display = 'none';
        
        let hasSetDefaultBackground = false;

        // Loop over each venue record found
        for (const venueRecord of venueRecords) {
            const { imageUrls } = await api.fetchImagesForRecord(venueRecord, state.records.all, new Map());
            
            // This loop now correctly adds all images from all venues.
            // Clicking any of them will set the background (this part already worked).
            imageUrls.forEach(url => {
                const thumb = document.createElement('div');
                thumb.className = 'background-thumb';
                const thumbUrl = url.replace('/upload/', '/upload/c_fill,g_auto,w_50,h_50/');
                thumb.innerHTML = `<img src=\"${thumbUrl}\" alt=\"Venue option\"> <span>${venueRecord.fields.Name}</span>`;
                thumb.addEventListener('click', () => {
                    sceneCanvas.style.backgroundImage = `url('${url}')`;
                    updateSceneStatus("Background set!");
                });
                bgThumbContainer.appendChild(thumb);
            });

            // Set the default background image *once* from the first image found
            if (imageUrls.length > 0 && !hasSetDefaultBackground && !sceneCanvas.style.backgroundImage) {
                sceneCanvas.style.backgroundImage = `url('${imageUrls[0]}')`;
                hasSetDefaultBackground = true;
            }
        }
    } else {
        if(bgDescription) bgDescription.style.display = 'block';
    }
    // --- END FIX ---


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
            itemEl.innerHTML = `<img src=\"${thumbUrl}\" alt=\"${record.fields.Name}\"> <span>${record.fields.Name}</span>`;
            itemEl.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', recordId);
                e.dataTransfer.effectAllowed = 'copy';
                updateSceneStatus("Release to choose cutout...");
            });
            itemPaletteContainer.appendChild(itemEl);
        }
    }
    
    // 3. Render all existing cutouts from state
    renderCutouts();
}

/**
 * --- MODIFIED ---
 * Shows the "Cutout Picker" popover and populates it with context.
 */
async function showCutoutPicker(record, x, y) {
    if (!cutoutPicker) return;
    updateSceneStatus("Fetching image options...", true);

    // Store pending data
    pendingCutout = { record, x, y, selectedUrl: null };

    // Reset UI
    cutoutPickerTitle.textContent = `Select image for: ${record.fields.Name}`;
    cutoutPickerThumbnails.innerHTML = '';
    cutoutAiPrompt.value = '';
    // --- ADD THIS: Reset new fields ---
    document.getElementById('cutout-item-time').value = '';
    document.getElementById('cutout-item-note').value = '';
    // --- END ADD ---
    cutoutPromptContainer.style.display = 'none';
    
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    
    // --- NEW: Set Context Thumbnail ---
    const contextThumbUrl = (imageUrls[0] || ui.getPlaceholderImage([])).replace('/upload/', '/upload/c_fill,g_auto,w_50,h_50/');
    if (cutoutContextThumb) cutoutContextThumb.style.backgroundImage = `url('${contextThumbUrl}')`;
    // --- END NEW ---

    if (imageUrls.length === 0) {
        updateSceneStatus("Item has no images, adding placeholder.");
        addCutoutToScene(ui.getPlaceholderImage([]), ''); // Add with no prompt
        return;
    }

    // Create a thumbnail for each image
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
    
    // --- ADD THIS BLOCK ---
    // Use requestAnimationFrame to ensure 'display' is set before 'active'
    // so the fade-in transition works correctly.
    requestAnimationFrame(() => {
        cutoutPicker.classList.add('active');
    });
    // --- END ADD ---
}

// --- REPLACE THIS FUNCTION ---
function hideCutoutPicker() {
    if (cutoutPicker) {
        cutoutPicker.classList.remove('active');
        // Wait for the 300ms opacity transition to finish before hiding
        setTimeout(() => {
            cutoutPicker.style.display = 'none';
        }, 300); 
    }
    pendingCutout = null;
}
// --- END REPLACE ---


/**
 * --- MODIFIED ---
 * Final step: creates the cutout and saves it to state with the AI prompt.
 */
function addCutoutToScene(imageUrl, promptText) {
    if (!pendingCutout) return;
    updateSceneStatus("⚙️ AI is generating cutout...", true);

    const { record, x, y } = pendingCutout;
    zCounter++;
    
    const uniqueId = `cutout-${Date.now()}`;

    // --- ADD THIS: Read new values ---
    const itemTime = document.getElementById('cutout-item-time').value.trim() || null;
    const itemNote = document.getElementById('cutout-item-note').value.trim() || null;
    // --- END ADD ---
    
    const newPosition = {
        recordId: record.id,
        imageUrl: imageUrl, // Save the *chosen* image URL
        prompt: promptText, // Save the AI prompt
        x: x - 75,
        y: y - 75,
        z: zCounter,
        scale: 1,      
        rotation: 0,   
        flipped: false,
        time: itemTime,   // <-- ADD THIS
        note: itemNote    // <-- ADD THIS
    };
            
    state.session.itemPositions.set(uniqueId, newPosition);
    triggerSave();
    
    renderSingleCutout(uniqueId, newPosition);
    hideCutoutPicker();
}

/**
 * Sets up all event listeners for the Itinerary (Scene Builder) modal
 */
export function setupItineraryEventListeners() {
    log('Itinerary', 'Initializing Scene Builder listeners.');

    // 1. Close buttons
    closeBtn.addEventListener('click', () => {
        updateUrl({ view: null });
        hideItineraryModal();
    });
    itineraryModal.addEventListener('click', (e) => {
        if (e.target === itineraryModal) {
            updateUrl({ view: null });
            hideItineraryModal();
        }
    });

    // 2. Cutout Picker Listeners
    cutoutPickerCloseBtn.addEventListener('click', hideCutoutPicker);
    cutoutPicker.addEventListener('click', (e) => {
        if (e.target === cutoutPicker) hideCutoutPicker();
    });
    
    cutoutPickerSubmitBtn.addEventListener('click', () => {
        if (pendingCutout && pendingCutout.selectedUrl) {
            addCutoutToScene(pendingCutout.selectedUrl, cutoutAiPrompt.value);
        } else {
            log('Itinerary', 'Cutout submit clicked, but no image was selected.');
            updateSceneStatus("Please select an image first.");
        }
    });

    // 3. Scene Canvas drag-and-drop listeners
    if (sceneCanvas) {
        sceneCanvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            // Don't update status here, it's too noisy.
        });
        
        sceneCanvas.addEventListener('dragleave', (e) => {
            if(state.session.itemPositions.size === 0) {
                 updateSceneStatus("Drag items from the palette onto the canvas.");
            } else {
                statusText.style.opacity = 0; // Fade out status
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

        // --- REMOVE THE OLD 'mousemove' LISTENER ---
    }
    
    // 4. Mouse move listener (FOR DRAG, RESIZE, ROTATE)
    // --- ADD THIS NEW LISTENER ---
    document.addEventListener('mousemove', (e) => {
        if (!currentDragItem) return;
        e.preventDefault(); // Prevent text selection while dragging

        // --- ADD THIS LINE ---
        const flipTransform = startFlipped ? 'scaleX(-1)' : '';

        if (currentTransformAction === 'rotate') {
            const dx = e.clientX - transformOrigin.x;
            const dy = e.clientY - transformOrigin.y;
            const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
            const rotation = Math.round(currentAngle - startAngle);
            
            // --- THIS LINE IS MODIFIED ---
            currentDragItem.style.transform = `scale(${startScale}) rotate(${rotation}deg) ${flipTransform}`;
            // Store the value directly on the DOM element for mouseup
            currentDragItem.dataset.currentRotation = rotation; 

        } else if (currentTransformAction === 'resize') {
            const dx = e.clientX - transformOrigin.x;
            const dy = e.clientY - transformOrigin.y;
            const currentDistance = Math.hypot(dx, dy);
            
            // Calculate new scale based on distance change
            let scale = (currentDistance / startDistance) * startScale;
            scale = Math.max(0.1, Math.min(scale, 5)); // Clamp scale
            
            // --- THIS LINE IS MODIFIED ---
            currentDragItem.style.transform = `scale(${scale}) rotate(${startRotation}deg) ${flipTransform}`;
            // Store the value directly on the DOM element for mouseup
            currentDragItem.dataset.currentScale = scale;

        } else { 
            // Default 'move' logic
            const rect = sceneCanvas.getBoundingClientRect();
            let x = e.clientX - rect.left - dragOffsetX;
            let y = e.clientY - rect.top - dragOffsetY;

            // Clamp position to canvas bounds (allowing part of it to be off-screen)
            const itemRect = currentDragItem.getBoundingClientRect();
            x = Math.max(-itemRect.width / 2, Math.min(x, rect.width - itemRect.width / 2));
            y = Math.max(-itemRect.height / 2, Math.min(y, rect.height - itemRect.height / 2));
            
            currentDragItem.style.left = `${x}px`;
            currentDragItem.style.top = `${y}px`;
        }
    });

    // 5. Mouse up listener (for saving drag position)
    // --- REPLACE THE EXISTING 'mouseup' LISTENER ---
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
                posObject.rotation = startRotation; // Keep original rotation
                posObject.flipped = startFlipped; // <-- ADD THIS LINE
            } else if (currentTransformAction === 'rotate') {
                posObject.scale = startScale; // Keep original scale
                posObject.rotation = parseFloat(currentDragItem.dataset.currentRotation) || startRotation;
                posObject.flipped = startFlipped; // <-- ADD THIS LINE
            } else {
                // 'move' action
                posObject.x = parseFloat(currentDragItem.style.left);
                posObject.y = parseFloat(currentDragItem.style.top);
            }
            // Always update z-index
            posObject.z = parseInt(currentDragItem.style.zIndex); 
            
            state.session.itemPositions.set(uniqueId, posObject);
            triggerSave();
        }
        
        // Clear all drag/transform state
        currentDragItem = null;
        currentTransformAction = null;
        startX = 0;
        startY = 0;
        startScale = 1;
        startRotation = 0;
        startAngle = 0;
        startDistance = 1;
    });
}

/**
 * Shows the Itinerary (Scene Builder) modal
 */
export function showItineraryModal() {
    updateUrl({ view: 'itinerary' });
    log('Itinerary', 'Showing itinerary modal (Scene Builder).');

    // --- ADD THIS BLOCK: Populate Scene Header ---
    const titleEl = document.getElementById('scene-header-title');
    const dateEl = document.getElementById('scene-header-date');
    
    if (titleEl && dateEl) {
        const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME);
        titleEl.textContent = eventName || 'Your Event Scene';
        
        const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
        if (dateValue) {
            // Handle both single date (from picker) and array (from session)
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
    // --- End Populate ---

    renderScene(); 
    itineraryModal.classList.add('active');
    itineraryModal.style.display = 'flex';
    document.body.classList.add('modal-open');
    // Status update is now handled by renderCutouts
}

/**
 * Hides the Itinerary (Scene Builder) modal
 */
export function hideItineraryModal() {
    log('Itinerary', 'Hiding itinerary modal.');
    hideCutoutPicker();
    itineraryModal.classList.remove('active');
    setTimeout(() => {
        itineraryModal.style.display = 'none';
    }, 300);
    document.body.classList.remove('modal-open');
}
