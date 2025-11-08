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

// --- NEW --- Cutout Picker DOM Elements
const cutoutPicker = document.getElementById('cutout-picker-popover');
const cutoutPickerTitle = document.getElementById('cutout-picker-title');
const cutoutPickerThumbnails = document.getElementById('cutout-picker-thumbnails');
const cutoutPickerCloseBtn = document.getElementById('cutout-picker-close-btn');

// Module state for drag-and-drop
let zCounter = 10; // For managing item stacking (z-index)
let currentDragItem = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

// --- NEW --- State for pending cutout
let pendingCutout = null;

/**
 * Creates a single cutout from a *specific image URL* and makes it draggable
 */
function renderSingleCutout(uniqueId, pos) {
    if (!sceneCanvas) return;
    
    // 1. Get the specific image URL from the position object
    const imageUrl = pos.imageUrl;
    if (!imageUrl) return;

    // 2. 🪄 The Cloudinary AI Magic 🪄
    // We add 'e_background_removal' to get the AI cutout
    const cutoutUrl = imageUrl.replace('/upload/', '/upload/e_background_removal,w_150/');

    const img = document.createElement('img');
    img.src = cutoutUrl;
    img.className = 'scene-cutout';
    img.dataset.uniqueId = uniqueId; // Use unique ID
    img.style.left = `${pos.x}px`;
    img.style.top = `${pos.y}px`;
    img.style.zIndex = pos.z;
    img.setAttribute('draggable', false); // Prevent native img drag

    // 3. Add mousedown listener to start dragging
    img.addEventListener('mousedown', (e) => {
        e.preventDefault();
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
    zCounter = 10; // Reset z-index

    // Iterate over the Map [uniqueId, positionObject]
    for (const [uniqueId, pos] of state.session.itemPositions.entries()) {
        renderSingleCutout(uniqueId, pos);
        if (pos.z > zCounter) zCounter = pos.z; // Ensure new items are on top
    }
}

/**
 * --- MODIFIED ---
 * Renders the entire Scene Builder: Backgrounds, Palette (now with all items), and Cutouts
 */
async function renderScene() {
    if (!sceneCanvas || !bgThumbContainer || !itemPaletteContainer) {
        log('Itinerary', 'Scene Builder DOM elements not found.');
        return;
    }

    // 1. Find the Venue and render background thumbnails
    bgThumbContainer.innerHTML = '';
    const venueRecord = state.records.all.find(r => 
        state.cart.lockedItems.has(r.id) && 
        r.fields.Categories?.toLowerCase().includes('venue')
    );

    const bgDescription = bgThumbContainer.parentElement.querySelector('p.description');
    
    if (venueRecord) {
        if(bgDescription) bgDescription.style.display = 'none';
        
        const { imageUrls } = await api.fetchImagesForRecord(venueRecord, state.records.all, new Map()); //
        imageUrls.forEach(url => {
            const thumb = document.createElement('div');
            thumb.className = 'background-thumb';
            const thumbUrl = url.replace('/upload/', '/upload/c_fill,g_auto,w_50,h_50/');
            thumb.innerHTML = `<img src="${thumbUrl}" alt="Venue option"> <span>${venueRecord.fields.Name}</span>`;
            
            thumb.addEventListener('click', () => {
                sceneCanvas.style.backgroundImage = `url('${url}')`;
            });
            bgThumbContainer.appendChild(thumb);
        });
        
        if (imageUrls.length > 0 && !sceneCanvas.style.backgroundImage) {
            sceneCanvas.style.backgroundImage = `url('${imageUrls[0]}')`;
        }
    } else {
        if(bgDescription) bgDescription.style.display = 'block';
    }

    // 2. --- MODIFIED --- Render the palette with BOTH locked items and ideas
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

            const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map()); //
            const itemEl = document.createElement('div');
            // --- ADDED: 'locked' or 'idea' class ---
            itemEl.className = `palette-item ${type}`; 
            itemEl.setAttribute('draggable', true);
            
            const thumbUrl = (imageUrls[0] || ui.getPlaceholderImage([])).replace('/upload/', '/upload/c_fill,g_auto,w_50,h_50/');
            itemEl.innerHTML = `<img src="${thumbUrl}" alt="${record.fields.Name}"> <span>${record.fields.Name}</span>`;
            
            itemEl.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', recordId);
                e.dataTransfer.effectAllowed = 'copy';
            });
            itemPaletteContainer.appendChild(itemEl);
        }
    }
    
    // 3. Render all existing cutouts from state
    renderCutouts();
}

// --- NEW FUNCTION ---
// Shows the "Cutout Picker" popover
async function showCutoutPicker(record, x, y) {
    if (!cutoutPicker) return;

    // Store pending data
    pendingCutout = { record, x, y };

    // Set title and clear old thumbnails
    cutoutPickerTitle.textContent = `Select image for: ${record.fields.Name}`;
    cutoutPickerThumbnails.innerHTML = '';
    
    // Fetch all images for this item
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map()); //
    
    if (imageUrls.length === 0) {
        // If no images, just add the default placeholder
        addCutoutToScene(ui.getPlaceholderImage([]));
        return;
    }

    // Create a thumbnail for each image
    imageUrls.forEach(url => {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail-img';
        thumb.style.backgroundImage = `url('${url.replace('/upload/', '/upload/c_fill,g_auto,w_100,h_80/')}')`;
        
        // This is the important part!
        thumb.addEventListener('click', () => {
            addCutoutToScene(url);
        });
        cutoutPickerThumbnails.appendChild(thumb);
    });

    // Show the popover
    cutoutPicker.style.display = 'flex';
}

// --- NEW FUNCTION ---
// Hides the "Cutout Picker"
function hideCutoutPicker() {
    if (cutoutPicker) cutoutPicker.style.display = 'none';
    pendingCutout = null;
}

// --- NEW FUNCTION ---
// Final step: creates the cutout and saves it to state
function addCutoutToScene(imageUrl) {
    if (!pendingCutout) return;

    const { record, x, y } = pendingCutout;
    zCounter++;
    
    // Create a unique ID for this specific cutout
    const uniqueId = `cutout-${Date.now()}`;
    
    // This is our new, more detailed position object
    const newPosition = {
        recordId: record.id,
        imageUrl: imageUrl, // Save the *chosen* image URL
        x: x - 75, // Offset to center
        y: y - 75, // Offset to center
        z: zCounter
    };
            
    // Save to state (using uniqueId as the key)
    state.session.itemPositions.set(uniqueId, newPosition);
    triggerSave(); //
    
    // Draw the new cutout
    renderSingleCutout(uniqueId, newPosition);
    
    // Hide the picker
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

    // --- NEW --- Cutout Picker Listeners
    cutoutPickerCloseBtn.addEventListener('click', hideCutoutPicker);
    cutoutPicker.addEventListener('click', (e) => {
        if (e.target === cutoutPicker) {
            hideCutoutPicker();
        }
    });

    // 2. Scene Canvas drag-and-drop listeners
    if (sceneCanvas) {
        // A. Allow dropping *onto* the canvas (from palette)
        sceneCanvas.addEventListener('dragover', (e) => {
            e.preventDefault(); 
        });

        // B. --- MODIFIED --- Handle the drop event (from palette)
        sceneCanvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const recordId = e.dataTransfer.getData('text/plain');
            const record = state.records.all.find(r => r.id === recordId);
            if (!record) return;

            // Calculate position
            const rect = sceneCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // --- CHANGED ---
            // Instead of creating a cutout, show the picker
            showCutoutPicker(record, x, y);
        });

        // C. Handle dragging *within* the canvas
        sceneCanvas.addEventListener('mousemove', (e) => {
            if (!currentDragItem) return;
            
            const rect = sceneCanvas.getBoundingClientRect();
            let x = e.clientX - rect.left - dragOffsetX;
            let y = e.clientY - rect.top - dragOffsetY;

            // Constrain to canvas boundaries
            x = Math.max(0, Math.min(x, rect.width - currentDragItem.width));
            y = Math.max(0, Math.min(y, rect.height - currentDragItem.height));
            
            currentDragItem.style.left = `${x}px`;
            currentDragItem.style.top = `${y}px`;
        });
    }
    
    // D. --- MODIFIED --- Handle mouse up *anywhere* to stop dragging
    document.addEventListener('mouseup', () => {
        if (!currentDragItem) return;

        currentDragItem.classList.remove('is-dragging');
        currentDragItem.style.cursor = 'move';
        
        // Save new position
        const uniqueId = currentDragItem.dataset.uniqueId;
        const posObject = state.session.itemPositions.get(uniqueId);
        
        if (posObject) {
            // Update the object with new coordinates
            posObject.x = parseFloat(currentDragItem.style.left);
            posObject.y = parseFloat(currentDragItem.style.top);
            posObject.z = parseInt(currentDragItem.style.zIndex);
            
            // Save the *entire object* back into the map
            state.session.itemPositions.set(uniqueId, posObject);
            triggerSave(); //
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
    
    // Always render the scene
    renderScene(); 
    
    itineraryModal.classList.add('active');
    itineraryModal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

/**
 * Hides the Itinerary (Scene Builder) modal
 */
export function hideItineraryModal() {
    log('Itinerary', 'Hiding itinerary modal.');
    hideCutoutPicker(); // --- ADD THIS ---
    itineraryModal.classList.remove('active');
    setTimeout(() => {
        itineraryModal.style.display = 'none';
    }, 300);
    document.body.classList.remove('modal-open');
}

// --- REMOVED ALL OLD FUNCTIONS ---
