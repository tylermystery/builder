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

// Module state for drag-and-drop
let zCounter = 10; // For managing item stacking (z-index)
let currentDragItem = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

/**
 * Creates a single cutout, applies AI transform, and makes it draggable
 */
async function renderSingleCutout(record, pos) {
    if (!sceneCanvas) return;
    
    // 1. Get the image URL for the item
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map()); //
    if (imageUrls.length === 0) return; // No image to make a cutout from

    // 2. 🪄 The Cloudinary AI Magic 🪄
    // We add 'e_background_removal' to get the AI cutout
    const cutoutUrl = imageUrls[0].replace('/upload/', '/upload/e_background_removal,w_150/');

    const img = document.createElement('img');
    img.src = cutoutUrl;
    img.className = 'scene-cutout';
    img.dataset.recordId = record.id;
    img.style.left = `${pos.x}px`;
    img.style.top = `${pos.y}px`;
    img.style.zIndex = pos.z;
    img.setAttribute('draggable', false); // Prevent native img drag

    // 3. Add mousedown listener to start dragging
    img.addEventListener('mousedown', (e) => {
        e.preventDefault();
        currentDragItem = img;
        currentDragItem.classList.add('is-dragging');
        
        // Calculate offset from mouse to top-left corner of image
        const rect = img.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        
        // Bring to front
        zCounter++; 
        img.style.zIndex = zCounter;
        img.style.cursor = 'grabbing';
    });
    
    sceneCanvas.appendChild(img);
}

/**
 * Draws all saved cutouts from state onto the canvas
 */
async function renderCutouts() {
    if (!sceneCanvas) return;
    sceneCanvas.innerHTML = ''; // Clear existing cutouts
    zCounter = 10; // Reset z-index

    for (const [recordId, pos] of state.session.itemPositions.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            renderSingleCutout(record, pos);
            if (pos.z > zCounter) zCounter = pos.z; // Ensure new items are on top
        }
    }
}

/**
 * Renders the entire Scene Builder: Backgrounds, Palette, and Cutouts
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
            // Transform for a small thumbnail
            const thumbUrl = url.replace('/upload/', '/upload/c_fill,g_auto,w_50,h_50/');
            thumb.innerHTML = `<img src="${thumbUrl}" alt="Venue option"> <span>${venueRecord.fields.Name}</span>`;
            
            thumb.addEventListener('click', () => {
                // Set the full-size image as the background
                sceneCanvas.style.backgroundImage = `url('${url}')`;
            });
            bgThumbContainer.appendChild(thumb);
        });
        
        // Set first image as default background if one isn't set
        if (imageUrls.length > 0 && !sceneCanvas.style.backgroundImage) {
            sceneCanvas.style.backgroundImage = `url('${imageUrls[0]}')`;
        }
    } else {
        if(bgDescription) bgDescription.style.display = 'block';
    }

    // 2. Render the "Ideas" palette (items the user can drag)
    itemPaletteContainer.innerHTML = '';
    const paletteDescription = itemPaletteContainer.parentElement.querySelector('p.description');

    if (state.cart.items.size === 0) {
        if(paletteDescription) paletteDescription.style.display = 'block';
    } else {
        if(paletteDescription) paletteDescription.style.display = 'none';
        
        for (const [recordId, itemInfo] of state.cart.items.entries()) {
            const record = state.records.all.find(r => r.id === recordId);
            if (!record) continue;

            const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map()); //
            const itemEl = document.createElement('div');
            itemEl.className = 'palette-item';
            itemEl.setAttribute('draggable', true); // Make it draggable
            
            const thumbUrl = (imageUrls[0] || ui.getPlaceholderImage([])).replace('/upload/', '/upload/c_fill,g_auto,w_50,h_50/');
            itemEl.innerHTML = `<img src="${thumbUrl}" alt="${record.fields.Name}"> <span>${record.fields.Name}</span>`;
            
            // Add drag start listener
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

/**
 * Sets up all event listeners for the Itinerary (Scene Builder) modal
 */
export function setupItineraryEventListeners() {
    log('Itinerary', 'Initializing Scene Builder listeners.');

    // --- REMOVED: All SortableJS logic ---

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

    // 2. Scene Canvas drag-and-drop listeners
    if (sceneCanvas) {
        // A. Allow dropping *onto* the canvas (from palette)
        sceneCanvas.addEventListener('dragover', (e) => {
            e.preventDefault(); // This is necessary to allow a drop
        });

        // B. Handle the drop event (from palette)
        sceneCanvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const recordId = e.dataTransfer.getData('text/plain');
            const record = state.records.all.find(r => r.id === recordId);
            if (!record) return;

            // Calculate position relative to the canvas
            const rect = sceneCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            zCounter++; // Place it on top

            const newPosition = { x: x - 75, y: y - 75, z: zCounter }; // Offset to center on cursor (150px wide)
            
            // Save to state and trigger save
            state.session.itemPositions.set(recordId, newPosition);
            triggerSave(); //
            
            // Draw the new cutout
            renderSingleCutout(record, newPosition);
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
    
    // D. Handle mouse up *anywhere* to stop dragging
    document.addEventListener('mouseup', () => {
        if (!currentDragItem) return;

        currentDragItem.classList.remove('is-dragging');
        currentDragItem.style.cursor = 'move';
        
        // Save new position
        const recordId = currentDragItem.dataset.recordId;
        const newPos = { 
            x: parseFloat(currentDragItem.style.left), 
            y: parseFloat(currentDragItem.style.top), 
            z: parseInt(currentDragItem.style.zIndex) 
        };
        state.session.itemPositions.set(recordId, newPos);
        triggerSave(); //
        
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
    
    // This function is still used for the header inputs (Event Name, Goals)
    renderItineraryHeader(); //
    
    itineraryModal.classList.add('active');
    itineraryModal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

/**
 * Hides the Itinerary (Scene Builder) modal
 */
export function hideItineraryModal() {
    log('Itinerary', 'Hiding itinerary modal.');
    // Note: We don't call updateUrl({ view: null }) here anymore,
    // because the close button listener does it.
    itineraryModal.classList.remove('active');
    setTimeout(() => {
        itineraryModal.style.display = 'none';
    }, 300);
    document.body.classList.remove('modal-open');
}

/**
 * Renders the data in the small header of the itinerary modal
 * (This function is unchanged)
 */
export function renderItineraryHeader() {
    document.getElementById('itinerary-event-name').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'My Awesome Event';
    document.getElementById('itinerary-goals').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
}


// --- REMOVED: renderItinerary() ---
// --- REMOVED: createItineraryItem() ---
// This work is now done by the main sidebar (updateEventPlanSection)
