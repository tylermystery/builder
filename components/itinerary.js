// FILE: components/itinerary.js
import { state } from '../state.js';
import { CONSTANTS } from '../config.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { log } from '../utils/debug.js';
import { triggerSave } from '../events.js';
import { debounce } from '../utils.js';

const Sortable = window.Sortable;
const itineraryModal = document.getElementById('itinerary-modal-overlay');
const timelineContainer = document.getElementById('event-timeline-column');
const paletteContainer = document.getElementById('event-palette-column');
const closeBtn = document.getElementById('itinerary-close-btn');

let timelineSortable, paletteSortable, itineraryDatePicker;

/**
 * Initializes all event listeners for the itinerary modal, including SortableJS and header inputs.
 */
export function setupItineraryEventListeners() {
    log('Itinerary', 'Initializing Itinerary with SortableJS for Canvas view.');
    
    const canvasPage = document.getElementById('canvas-page-container');
    const timelineContainer = document.getElementById('event-timeline-column');
    const paletteContainer = document.getElementById('event-palette-column');
    const closeBtn = document.getElementById('canvas-close-btn');
    if (!canvasPage || !timelineContainer || !paletteContainer || !closeBtn) {
        console.error('Itinerary page elements could not be found in the DOM.');
        return;
    }

    new Sortable(timelineContainer, {
        group: 'shared',
        animation: 150,
        ghostClass: 'itinerary-item-ghost',
        onEnd: function(evt) {
            const recordId = evt.item.dataset.recordId;
            if (evt.from.id !== evt.to.id) {
                if (state.cart.items.has(recordId)) {
       
             const itemInfo = state.cart.items.get(recordId);
                    state.cart.items.delete(recordId);
                    state.cart.lockedItems.set(recordId, itemInfo);
                }
            }
            const newOrder = 
 Array.from(timelineContainer.children).map(child => child.dataset.recordId).filter(Boolean);
            const newLockedItems = new Map();
            newOrder.forEach(id => {
                if (state.cart.lockedItems.has(id)) {
                    newLockedItems.set(id, state.cart.lockedItems.get(id));
                }
            });
 
            state.cart.lockedItems = newLockedItems;
            renderItinerary();
            triggerSave();
        }
    });

    new Sortable(paletteContainer, {
        group: 'shared',
        animation: 150,
        ghostClass: 'itinerary-item-ghost',
        onEnd: function(evt) {
            if (evt.from.id !== evt.to.id) {
                const recordId = evt.item.dataset.recordId;
                if (state.cart.lockedItems.has(recordId)) {
   
                 const itemInfo = state.cart.lockedItems.get(recordId);
                    state.cart.lockedItems.delete(recordId);
                    state.cart.items.set(recordId, itemInfo);
                }
            }
           
 renderItinerary();
            triggerSave();
        }
    });
    closeBtn.addEventListener('click', ui.hideCanvasPage);
    
    const debouncedSave = debounce(triggerSave, 500);
    document.getElementById('itinerary-event-name').addEventListener('input', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        debouncedSave();
    });
    document.getElementById('itinerary-goals').addEventListener('input', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        debouncedSave();
    });
    document.getElementById('itinerary-guest-count').addEventListener('input', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GUEST_COUNT, e.target.value);
        renderItinerary(); // Recalculate costs
        debouncedSave();
    });
    flatpickr("#itinerary-date-picker", {
        enableTime: true,
        dateFormat: "M j, Y h:i K",
        onChange: (selectedDates) => {
            if (selectedDates.length > 0) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString()));
            } else {
                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
 
            }
            renderItinerary();
            triggerSave();
        }
    });
}

export function renderItineraryHeader() {
    document.getElementById('itinerary-event-name').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    document.getElementById('itinerary-goals').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
    document.getElementById('itinerary-guest-count').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT) || '';
    
    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    const datePicker = document.getElementById('itinerary-date-picker')._flatpickr;
    if (datePicker) {
        if (dateValue) {
            datePicker.setDate(dateValue.map(d => new Date(d)), false);
        } else {
            datePicker.clear();
        }
    }
}

export async function renderItinerary() {
    const timelineContainer = document.getElementById('event-timeline-column');
    const paletteContainer = document.getElementById('event-palette-column');
    if (!timelineContainer || !paletteContainer) return;

    timelineContainer.innerHTML = '';
    paletteContainer.innerHTML = '';
    // Render Palette
    if (state.cart.items.size === 0) {
        paletteContainer.innerHTML = `<p class="description">Your saved ideas will appear here.</p>`;
    } else {
        for (const [recordId, itemInfo] of state.cart.items.entries()) {
            const record = state.records.all.find(r => r.id === recordId);
            if (record) paletteContainer.appendChild(await createItineraryItem(record, itemInfo, 'favorite'));
        }
    }

    // Render Timeline
    if (state.cart.lockedItems.size === 0) {
        timelineContainer.innerHTML = `<p class="description">Drag ideas here to build your timeline.</p>`;
    } else {
        const lockedItemsArray = Array.from(state.cart.lockedItems.entries());
        let currentTime;
        const eventDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
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
            if (i > 0) {
                const prevRecord = state.records.all.find(r => r.id === lockedItemsArray[i-1][0]);
                if (prevRecord) {
                    const origin = prevRecord.fields['Location'];
                    const destination = record.fields['Location'];
                    const travelInfo = await api.fetchTravelTime(origin, destination);
                    if (travelInfo.duration > 0) {
                        timelineContainer.appendChild(createTravelSegmentElement(travelInfo));
                        currentTime.setMinutes(currentTime.getMinutes() + travelInfo.duration);
                    }
                }
            }
            const startTime = new Date(currentTime);
            const durationHours = record.fields[CONSTANTS.FIELD_NAMES.DURATION] || 1;
            currentTime.setMinutes(currentTime.getMinutes() + (durationHours * 60));
            const endTime = new Date(currentTime);
            timelineContainer.appendChild(await createItineraryItem(record, itemInfo, 'locked', { startTime, endTime }));
        }
    }
}

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

// --- FIX: Corrected the function definition syntax ---
async function createItineraryItem(record, itemInfo, type, timeInfo = null) {
    const fields = record.fields;
    const itemElement = document.createElement('div');
    itemElement.className = `itinerary-item ${type}`;
    itemElement.dataset.recordId = record.id;
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    
    const options = ui.parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const selectedOption = options[itemInfo.selectedOptionIndex];
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
            ${selectedOption ?
`<p class="locked-item-option">${selectedOption.name}</p>` : ''}
        </div>
        <div class="locked-item-actions">
            <button class="remove-btn" title="Remove">×</button>
        </div>
    `;
    return itemElement;
}
