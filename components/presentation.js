// FILE: components/presentation.js
import { state } from '../state.js';
import * as api from '../api.js';
import * as ui from '../ui.js';
import { CONSTANTS } from '../config.js';
import { log } from '../utils/debug.js';

const modal = document.getElementById('presentation-modal-overlay');
const closeBtn = document.getElementById('presentation-close-btn');
const titleEl = document.getElementById('presentation-title');
const counterEl = document.getElementById('presentation-counter');
const mainImageEl = document.getElementById('presentation-main-image');
const thumbStripEl = document.getElementById('presentation-thumbnail-strip');
const itemNameEl = document.getElementById('presentation-item-name');
const itemPriceEl = document.getElementById('presentation-item-price');
const itemDescEl = document.getElementById('presentation-item-description');
const itemNoteContainerEl = document.getElementById('presentation-item-note-container');
const itemNoteEl = document.getElementById('presentation-item-note');
const prevItemBtn = document.getElementById('presentation-prev-item-btn');
const nextItemBtn = document.getElementById('presentation-next-item-btn');

// New summary header elements
const summaryEventNameEl = document.getElementById('summary-event-name');
const summaryEventNotesEl = document.getElementById('summary-event-notes');
const summaryEventDateEl = document.getElementById('summary-event-date');
const summaryIdeasLink = document.getElementById('summary-ideas-link');
const summaryLockedLink = document.getElementById('summary-locked-link');

let currentList = [];
let currentIndex = 0;
let currentImages = [];
let currentImageIndex = 0;

function renderSummaryHeader() {
    summaryEventNameEl.textContent = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'N/A';
    summaryEventNotesEl.textContent = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || 'N/A';
    
    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    if (dateValue) {
        const date = Array.isArray(dateValue) ? new Date(dateValue[0]) : new Date(dateValue);
        summaryEventDateEl.textContent = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } else {
        summaryEventDateEl.textContent = 'N/A';
    }

    const ideasCount = state.cart.items.size;
    const lockedCount = state.cart.lockedItems.size;

    summaryIdeasLink.textContent = `${ideasCount} Ideas`;
    summaryLockedLink.textContent = `${lockedCount} Locked In`;
}

async function renderCurrentSlide() {
    if (currentList.length === 0) {
        hidePresentationView();
        return;
    }
    const recordId = currentList[currentIndex];
    const record = state.records.all.find(r => r.id === recordId);
    if (!record) {
        log('Presentation', `Record not found for ID: ${recordId}`);
        return;
    }
    
    // Update header
    counterEl.textContent = `Item ${currentIndex + 1} of ${currentList.length}`;

    // Update details
    const itemInfo = state.cart.items.get(recordId) || state.cart.lockedItems.get(recordId);
    itemNameEl.textContent = record.fields.Name || 'Untitled';
    const price = ui.getRecordPrice(record, itemInfo?.selectedOptionIndex);
    itemPriceEl.textContent = `$${price.toFixed(2)}`;
    itemDescEl.textContent = record.fields.Description || '';

    if (itemInfo?.note) {
        itemNoteContainerEl.style.display = 'block';
        itemNoteEl.textContent = itemInfo.note;
    } else {
        itemNoteContainerEl.style.display = 'none';
    }

    // Fetch and render images
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    currentImages = imageUrls || [];
    currentImageIndex = 0;
    renderCurrentImage();
}

function renderCurrentImage() {
    if (currentImages.length === 0) {
        mainImageEl.style.backgroundImage = '';
        thumbStripEl.innerHTML = '<p>No images available.</p>';
        return;
    }
    mainImageEl.style.backgroundImage = `url('${currentImages[currentImageIndex]}')`;

    thumbStripEl.innerHTML = '';
    currentImages.forEach((url, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail-img';
        thumb.style.backgroundImage = `url('${url}')`;
        if (index === currentImageIndex) {
            thumb.classList.add('active');
        }
        thumb.addEventListener('click', () => {
            currentImageIndex = index;
            renderCurrentImage();
        });
        thumbStripEl.appendChild(thumb);
    });
}

function navigateToSlide(direction) {
    const newIndex = currentIndex + direction;
    if (newIndex >= 0 && newIndex < currentList.length) {
        currentIndex = newIndex;
        renderCurrentSlide();
    }
}

function cycleImage(direction) {
    const newIndex = currentImageIndex + direction;
    if (newIndex >= 0 && newIndex < currentImages.length) {
        currentImageIndex = newIndex;
        renderCurrentImage();
    }
}

function handleKeyDown(e) {
    switch (e.key) {
        case 'ArrowDown':
            navigateToSlide(1);
            break;
        case 'ArrowUp':
            navigateToSlide(-1);
            break;
        case 'ArrowRight':
            cycleImage(1);
            break;
        case 'ArrowLeft':
            cycleImage(-1);
            break;
        case 'Escape':
            hidePresentationView();
            break;
    }
}

export function showPresentationView(listType) {
    log('Presentation', `Showing presentation for: ${listType}`);
    const listMap = listType === 'favorites' ? state.cart.items : state.cart.lockedItems;
    currentList = Array.from(listMap.keys());
    
    if (currentList.length === 0) {
        alert(`There are no items in your "${listType === 'favorites' ? 'Ideas' : 'Event Plan'}" list to present.`);
        return;
    }

    // Update summary header and link states
    renderSummaryHeader();
    summaryIdeasLink.classList.toggle('active', listType === 'favorites');
    summaryLockedLink.classList.toggle('active', listType === 'locked');
    summaryIdeasLink.disabled = listType === 'favorites';
    summaryLockedLink.disabled = listType === 'locked';

    titleEl.textContent = listType === 'favorites' ? 'Presenting Ideas' : 'Presenting Event Plan';
    currentIndex = 0;

    modal.classList.add('active');
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', handleKeyDown);
    
    renderCurrentSlide();
}

function hidePresentationView() {
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', handleKeyDown);
}

export function setupPresentationEventListeners() {
    closeBtn.addEventListener('click', hidePresentationView);
    prevItemBtn.addEventListener('click', () => navigateToSlide(-1));
    nextItemBtn.addEventListener('click', () => navigateToSlide(1));
    summaryIdeasLink.addEventListener('click', () => showPresentationView('favorites'));
    summaryLockedLink.addEventListener('click', () => showPresentationView('locked'));
}
