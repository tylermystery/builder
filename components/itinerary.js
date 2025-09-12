// FILE: components/itinerary.js
import { state } from '../state.js';
import { CONSTANTS } from '../config.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { log } from '../utils/debug.js';
import { triggerSave } from '../events.js';
import { debounce, getRecordPrice } from '../utils.js';

const Sortable = window.Sortable;
const itineraryModal = document.getElementById('itinerary-modal-overlay');
// --- MODIFIED: Use new timeline and palette IDs ---
const timelineContainer = document.getElementById('event-timeline-column');
const paletteContainer = document.getElementById('event-palette-column');
const closeBtn = document.getElementById('itinerary-close-btn');

let timelineSortable, paletteSortable, itineraryDatePicker;

/**
 * Initializes all event listeners for the itinerary modal, including SortableJS and header inputs.
 */
export function setupItineraryEventListeners() {
    log('Itinerary', 'Initializing Itinerary with SortableJS for Canvas view.');

    // --- MODIFIED: SortableJS for the "Event Timeline" (locked) items column ---
    timelineSortable = new Sortable(timelineContainer, {
        group: 'shared',
        animation: 150,
        ghostClass: 'itinerary-item-ghost',
        onEnd: function(evt) {
            log('Itinerary', 'Drag ended in timeline.');
            const recordId = evt.item.dataset.recordId;

            // An item was moved from the palette to the timeline
            if (evt.from.id !== evt.to.id) {
                if (state.cart.items.has(recordId)) {
                    const itemInfo = state.cart.items.get(recordId);
                    state.cart.items.delete(recordId);
                    // Add to lockedItems - we'll re-order it next
                    state.cart.lockedItems.set(recordId, itemInfo);
                }
            }

            // Re-order the state based on the new DOM order
            const newOrder = timelineSortable.toArray();
            const newLockedItems = new Map();
            newOrder.forEach(id => {
                if (state.cart.lockedItems.has(id)) {
                    newLockedItems.set(id, state.cart.lockedItems.get(id));
                }
            });
            state.cart.lockedItems = newLockedItems;

            // --- MODIFIED: A re-render of the timeline is now required to update times ---
            renderItinerary();
            ui.updateFavoritesCarousel();
            ui.updateTotalCost();
            triggerSave();
        }
    });

    // --- MODIFIED: SortableJS for the "Ideas" (palette) items column ---
    paletteSortable = new Sortable(paletteContainer, {
        group: 'shared',
        animation: 150,
        ghostClass: 'itinerary-item-ghost',
        onEnd: function(evt) {
            log('Itinerary', 'Drag ended in palette.');
            // An item was moved from the timeline back to the palette
            if (evt.from.id !== evt.to.id) {
                const recordId = evt.item.dataset.recordId;
                if (state.cart.lockedItems.has(recordId)) {
                    const itemInfo = state.cart.lockedItems.get(recordId);
                    state.cart.lockedItems.delete(recordId);
                    state.cart.items.set(recordId, itemInfo);
                }
            }
            
            // Re-rendering the timeline isn't required, but updating other UI is
            renderItinerary(); // Re-render both columns to be safe
            ui.updateFavoritesCarousel();
            ui.updateTotalCost();
            triggerSave();
        }
    });

    // Listeners for the modal itself and the close button
    closeBtn.addEventListener('click', hideItineraryModal);
    itineraryModal.addEventListener('click', (e) => {
        if (e.target === itineraryModal) {
            hideItineraryModal();
        }
    });

    // Event listeners for header inputs to sync changes
    const debouncedSave = debounce(triggerSave, 500);
    document.getElementById('itinerary-event-name').addEventListener('input', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        ui.updateHeader();
        debouncedSave();
    });
    document.getElementById('itinerary-goals').addEventListener('input', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        ui.updateHeader();
        debouncedSave();
    });
    document.getElementById('itinerary-guest-count').addEventListener('input', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GUEST_COUNT, e.target.value);
        ui.updateTotalCost();
        debouncedSave();
    });
    itineraryDatePicker = flatpickr("#itinerary-date-picker", {
        enableTime: true,
        dateFormat: "M j, Y h:i K",
        onChange: (selectedDates) => {
            if (selectedDates.length > 0) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString()));
            } else {
                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
            }
            renderItinerary(); // Re-render the timeline with the new start time
            ui.updateEventPlanDateDisplay();
            triggerSave();
        }
    });
}


export function showItineraryModal() {
    log('Itinerary', 'Showing itinerary modal.');
    renderItineraryHeader();
    renderItinerary(); // Render after header to ensure date is set
    itineraryModal.classList.add('active');
    itineraryModal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

export function hideItineraryModal() {
    log('Itinerary', 'Hiding itinerary modal.');
    itineraryModal.classList.remove('active');
    setTimeout(() => {
        itineraryModal.style.display = 'none';
    }, 300);
    document.body.classList.remove('modal-open');
}

export function renderItineraryHeader() {
    document.getElementById('itinerary-event-name').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    document.getElementById('itinerary-goals').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
    document.getElementById('itinerary-guest-count').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT) || '';
    
    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    if (dateValue && itineraryDatePicker) {
        itineraryDatePicker.setDate(dateValue.map(d => new Date(d)), false);
    } else if (itineraryDatePicker) {
        itineraryDatePicker.clear();
    }
}

// --- MODIFIED: This is the core new rendering logic for the canvas view ---
export async function renderItinerary() {
    log('Itinerary', 'Rendering itinerary canvas and palette.');
    timelineContainer.innerHTML = '';
    paletteContainer.innerHTML = '';
    
    // --- Render Palette (Ideas) ---
    if (state.cart.items.size === 0) {
        paletteContainer.innerHTML = `<p class="description">Drag items from the Event Plan here to unsave them.</p>`;
    } else {
        for (const [recordId, itemInfo] of state.cart.items.entries()) {
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                const itemElement = await createItineraryItem(record, itemInfo, 'favorite');
                paletteContainer.appendChild(itemElement);
            }
        }
    }

    // --- Render Timeline (Canvas) ---
    if (state.cart.lockedItems.size === 0) {
        timelineContainer.innerHTML = `<p class="description">Drag items from Ideas here to build your timeline.</p>`;
    } else {
        const lockedItemsArray = Array.from(state.cart.lockedItems.entries());
        let currentTime;
        const eventDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
        
        // Default to today at 9am if no date is set
        if (eventDate) {
            currentTime = new Date(eventDate[0]);
        } else {
            currentTime = new Date();
            currentTime.setHours(9, 0, 0, 0);
        }

        for (let i = 0; i < lockedItemsArray.length; i++) {
            const [recordId, itemInfo] = lockedItemsArray[i];
            const record = state.records.all.find(r => r.id === recordId);
            if (!record) continue;

            // --- Calculate and Render Travel Segment ---
            if (i > 0) {
                const prevRecord = state.records.all.find(r => r.id === lockedItemsArray[i-1][0]);
                if (prevRecord) {
                    const origin = prevRecord.fields['Location'];
                    const destination = record.fields['Location'];
                    
                    const travelInfo = await api.fetchTravelTime(origin, destination);
                    if (travelInfo.duration > 0) {
                        const travelElement = createTravelSegmentElement(travelInfo);
                        timelineContainer.appendChild(travelElement);
                        currentTime.setMinutes(currentTime.getMinutes() + travelInfo.duration);
                    }
                }
            }

            // --- Render Timeline Item with calculated times ---
            const startTime = new Date(currentTime);
            const durationHours = record.fields[CONSTANTS.FIELD_NAMES.DURATION] || 1;
            const durationMinutes = durationHours * 60;
            currentTime.setMinutes(currentTime.getMinutes() + durationMinutes);
            const endTime = new Date(currentTime);

            const itemElement = await createItineraryItem(record, itemInfo, 'locked', { startTime, endTime });
            timelineContainer.appendChild(itemElement);
        }
    }
}

// --- NEW: Helper to create the travel segment element ---
function createTravelSegmentElement(travelInfo) {
    const element = document.createElement('div');
    element.className = 'travel-segment';
    const travelEmoji = travelInfo.mode === 'car' ? '🚗' : '🚶';
    element.innerHTML = `
        <div class="travel-line"></div>
        <div class="travel-details">${travelEmoji} Travel: ~${travelInfo.duration} min (${travelInfo.distance} miles)</div>
        <div class="travel-line"></div>
    `;
    return element;
}

/**
 * Creates an individual item element for the itinerary/ideas columns.
 * @param {object} record The Airtable record object.
 * @param {object} itemInfo The state information for the item.
 * @param {string} type 'locked' or 'favorite'.
 * @param {object} [timeInfo] Optional object with {startTime, endTime} for timeline items.
 * @returns {Promise<HTMLElement>} The created DOM element.
 */
async function createItineraryItem(record, itemInfo, type, timeInfo = null) {
    const fields = record.fields;
    const itemElement = document.createElement('div');
    itemElement.className = `itinerary-item ${type}`;
    itemElement.dataset.recordId = record.id;
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    
    const options = ui.parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const selectedOption = options[itemInfo.selectedOptionIndex];

    // --- MODIFIED: Add time display for timeline items ---
    let timeHTML = '';
    if (type === 'locked' && timeInfo) {
        const formatTime = (date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        timeHTML = `<p class="itinerary-item-time">${formatTime(timeInfo.startTime)} - ${formatTime(timeInfo.endTime)}</p>`;
    }
    
    itemElement.innerHTML = `
        <img src="${imageUrls[0]}" class="locked-item-thumbnail" alt="${fields.Name}">
        <div class="locked-item-details">
            ${timeHTML}
            <p class="locked-item-name">${fields.Name}</p>
            ${selectedOption ? `<p class="locked-item-option">${selectedOption.name}</p>` : ''}
        </div>
        <div class="locked-item-actions">
            <button class="remove-btn" title="Remove">×</button>
        </div>
    `;

    // --- Add event listeners for removing items ---
    itemElement.querySelector('.remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const recordId = e.target.closest('.itinerary-item').dataset.recordId;
        if (state.cart.lockedItems.has(recordId)) {
            state.cart.lockedItems.delete(recordId);
        } else if (state.cart.items.has(recordId)) {
            state.cart.items.delete(recordId);
        }
        renderItinerary(); // Re-render everything after removal
        ui.updateAllUI();
        triggerSave();
    });

    return itemElement;
}
