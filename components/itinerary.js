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
const cutoutPickerSubmitBtn = document.getElementById('cutout-picker-submit-btn');
// --- NEW --- Context Thumbnail
const cutoutContextThumb = document.getElementById('cutout-context-thumb');

// Module state
let zCounter = 10;
let currentDragItem = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let pendingCutout = null; // Stores { record, x, y, selectedUrl }

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

/**
 * --- MODIFIED ---
 * Creates a single cutout from a specific image URL and AI prompt.
 */
function renderSingleCutout(uniqueId, pos) {
    if (!sceneCanvas) return;
    
    const { imageUrl, prompt } = pos;
    if (!imageUrl) return;

    // 2. 🪄 The Cloudinary AI Magic 🪄
    let cutoutUrl;
    if (prompt && prompt.trim() !== '') {
        // Use new Generative Remove with a prompt
        // --- ADDED a_ignore --- to prevent text overlay
        const encodedPrompt = encodeURIComponent(prompt.trim());
        cutoutUrl = imageUrl.replace('/upload/', `/upload/e_gen_remove:prompt_${encodedPrompt},w_150,a_ignore/`);
        log('Itinerary', `Using Generative Remove, prompt: ${prompt}`);
    } else {
        // Fallback to simple background removal
        cutoutUrl = imageUrl.replace('/upload/', '/upload/e_background_removal,w_150/');
        log('Itinerary', 'No prompt, using simple background removal.');
    }

    const img = document.createElement('img');
    img.src = cutoutUrl;
    img.className = 'scene-cutout';
    img.dataset.uniqueId = uniqueId;
    img.style.left = `${pos.x}px`;
    img.style.top = `${pos.y}px`;
    img.style.zIndex = pos.z;
    img.setAttribute('draggable', false);

    // Add status update on load
    img.onload = () => updateSceneStatus("Item added! Drag to move.");
    img.onerror = () => updateSceneStatus("❌ Error creating cutout. Try a different prompt.");
    
    img.addEventListener('mousedown', (e) => {
        e.preventDefault();
        updateSceneStatus("Dragging item...");
        currentDragItem = img;
        currentDragItem.classList.add('is-dragging');
        
        const rect = img.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        
        zCounter++; 
        img.style.zIndex = zCounter;
        img.style.cursor = 'grabbing';
    });
    
    sceneCanvas.appendChild(img);
}

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
    
    // Show the "Drop" message only if the canvas is empty
    if(state.session.itemPositions.size === 0) {
        updateSceneStatus("Drag items from the palette onto the canvas.");
    }
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
    const venueRecord = state.records.all.find(r => 
        state.cart.lockedItems.has(r.id) && 
        r.fields.Categories?.toLowerCase().includes('venue')
    );
    const bgDescription = bgThumbContainer.parentElement.querySelector('p.description');
    if (venueRecord) {
        if(bgDescription) bgDescription.style.display = 'none';
        const { imageUrls } = await api.fetchImagesForRecord(venueRecord, state.records.all, new Map());
        imageUrls.forEach(url => {
            const thumb = document.createElement('div');
            thumb.className = 'background-thumb';
            const thumbUrl = url.replace('/upload/', '/upload/c_fill,g_auto,w_50,h_50/');
            thumb.innerHTML = `<img src="${thumbUrl}" alt="Venue option"> <span>${venueRecord.fields.Name}</span>`;
            thumb.addEventListener('click', () => {
                sceneCanvas.style.backgroundImage = `url('${url}')`;
                updateSceneStatus("Background set!");
            });
            bgThumbContainer.appendChild(thumb);
        });
        if (imageUrls.length > 0 && !sceneCanvas.style.backgroundImage) {
            sceneCanvas.style.backgroundImage = `url('${imageUrls[0]}')`;
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
            itemEl.innerHTML = `<img src="${thumbUrl}" alt="${record.fields.Name}"> <span>${record.fields.Name}</span>`;
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

function hideCutoutPicker() {
    if (cutoutPicker) cutoutPicker.style.display = 'none';
    pendingCutout = null;
}

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
    
    const newPosition = {
        recordId: record.id,
        imageUrl: imageUrl, // Save the *chosen* image URL
        prompt: promptText, // Save the AI prompt
        x: x - 75,
        y: y - 75,
        z: zCounter
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

        sceneCanvas.addEventListener('mousemove', (e) => {
            if (!currentDragItem) return;
            
            const rect = sceneCanvas.getBoundingClientRect();
            let x = e.clientX - rect.left - dragOffsetX;
            let y = e.clientY - rect.top - dragOffsetY;

            x = Math.max(0, Math.min(x, rect.width - currentDragItem.width));
            y = Math.max(0, Math.min(y, rect.height - currentDragItem.height));
            
            currentDragItem.style.left = `${x}px`;
            currentDragItem.style.top = `${y}px`;
        });
    }
    
    // 4. Mouse up listener (for saving drag position)
    document.addEventListener('mouseup', () => {
        if (!currentDragItem) return;

        currentDragItem.classList.remove('is-dragging');
        currentDragItem.style.cursor = 'move';
        updateSceneStatus("Position saved!");
        
        const uniqueId = currentDragItem.dataset.uniqueId;
        const posObject = state.session.itemPositions.get(uniqueId);
        
        if (posObject) {
            posObject.x = parseFloat(currentDragItem.style.left);
            posObject.y = parseFloat(currentDragItem.style.top);
            posObject.z = parseInt(currentDragItem.style.zIndex);
            
            state.session.itemPositions.set(uniqueId, posObject);
            triggerSave();
        }
        
        currentDragItem = null;
    });
}

/**
 * Shows the Itinerary (Scene Builder) modal
 */
export function showItineraryModal() {
    updateUrl({ view: 'itinerary' });
    log('Itinerary', 'Showing itinerary modal (Scene Builder).');
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
