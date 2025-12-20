import { state } from '../state.js';
import * as api from '../api.js';
import { CONSTANTS, EMOJI_REACTIONS } from '../config.js';
import { updateUrl, getRecordPrice } from '../utils.js';
import { log } from '../utils/debug.js';
import { getCurrentUser } from '../chat.js';
import { triggerSave } from '../events.js';

// DOM element references - lazily initialized to ensure DOM is ready
let modal = null;
let closeBtn = null;
let mainImageEl = null;
let thumbStripEl = null;
let itemNameEl = null;
let itemPriceEl = null;
let itemDescEl = null;
let itemNoteContainerEl = null;
let itemNoteEl = null;
let prevItemBtn = null;
let nextItemBtn = null;
let reactionButtonsEl = null;
let reactionSummaryEl = null;
let summaryEventNameEl = null;
let summaryEventNotesEl = null;
let summaryEventDateEl = null;
let shareBtn = null;

function ensureDOMElements() {
    if (modal) return true; // Already initialized

    modal = document.getElementById('presentation-modal-overlay');
    closeBtn = document.getElementById('presentation-close-btn');
    mainImageEl = document.getElementById('presentation-main-image');
    thumbStripEl = document.getElementById('presentation-thumbnail-strip');
    itemNameEl = document.getElementById('presentation-item-name');
    itemPriceEl = document.getElementById('presentation-item-price');
    itemDescEl = document.getElementById('presentation-item-description');
    itemNoteContainerEl = document.getElementById('presentation-item-note-container');
    itemNoteEl = document.getElementById('presentation-item-note');
    prevItemBtn = document.getElementById('presentation-prev-item-btn');
    nextItemBtn = document.getElementById('presentation-next-item-btn');
    reactionButtonsEl = document.getElementById('reaction-buttons');
    reactionSummaryEl = document.getElementById('reaction-summary');
    summaryEventNameEl = document.getElementById('summary-event-name');
    summaryEventNotesEl = document.getElementById('summary-event-notes');
    summaryEventDateEl = document.getElementById('summary-event-date');
    shareBtn = document.getElementById('presentation-share-btn');

    if (!modal) {
        console.error('[Presentation] Modal element #presentation-modal-overlay not found in DOM');
        return false;
    }

    // Debug: Log that DOM elements were successfully found
    log('Presentation', `DOM elements initialized. Modal classes: ${modal.className}`);
    return true;
}

let combinedList = [];
let globalCurrentIndex = 0;
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
}

function renderReactions(recordId) {
    const currentUser = getCurrentUser();
    let allReactions = state.session.reactions.get(recordId);
    if (!(allReactions instanceof Map)) {
        allReactions = new Map();
    }
    const currentUserReaction = allReactions.get(currentUser.id);

    reactionButtonsEl.innerHTML = EMOJI_REACTIONS.map(emoji => 
        `<button class="reaction-btn ${currentUserReaction === emoji ? 'selected' : ''}" data-emoji="${emoji}">${emoji}</button>`
    ).join('');
    let summaryHTML = 'Reactions: ';
    if (allReactions.size > 0) {
        summaryHTML += Array.from(allReactions.entries()).map(([userId, reaction]) => {
            const name = state.session.userProfiles.get(userId) || 'A User';
            return `<span>${name}: ${reaction}</span>`;
        }).join(' | ');
    } else {
        summaryHTML += 'None yet.';
    }
    reactionSummaryEl.innerHTML = summaryHTML;
}

async function renderCurrentSlide() {
    if (combinedList.length === 0) {
        hidePresentationView();
        return;
    }
    mainImageEl.style.backgroundImage = '';
    thumbStripEl.innerHTML = '<p>Loading images...</p>';

    const currentItem = combinedList[globalCurrentIndex];
    const { recordId, type } = currentItem;
    const record = state.records.all.find(r => r.id === recordId);
    if (!record) {
        log('Presentation', `Record not found for ID: ${recordId}`);
        return;
    }

    renderReactions(recordId);

    const itemInfo = type === 'favorites' ? state.cart.items.get(recordId) : state.cart.lockedItems.get(recordId);
    itemNameEl.textContent = record.fields.Name || 'Untitled';
    const price = getRecordPrice(record, itemInfo?.selectedOptionIndex);
    itemPriceEl.textContent = `$${price.toFixed(2)}`;
    itemDescEl.textContent = record.fields.Description || '';
    if (itemInfo?.note) {
        itemNoteContainerEl.style.display = 'block';
        itemNoteEl.textContent = itemInfo.note;
    } else {
        itemNoteContainerEl.style.display = 'none';
    }

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
    if (combinedList.length === 0) return;
    globalCurrentIndex = (globalCurrentIndex + direction + combinedList.length) % combinedList.length;
    renderCurrentSlide();
}

function cycleImage(direction) {
    const newIndex = (currentImageIndex + direction + currentImages.length) % currentImages.length;
    if (currentImages.length > 0) {
        currentImageIndex = newIndex;
        renderCurrentImage();
    }
}

function handleKeyDown(e) {
    switch (e.key) {
        case 'ArrowDown': navigateToSlide(1); break;
        case 'ArrowUp': navigateToSlide(-1); break;
        case 'ArrowRight': cycleImage(1); break;
        case 'ArrowLeft': cycleImage(-1); break;
        case 'Escape':
            updateUrl({ view: null });
            hidePresentationView();
            break;
    }
}

function handleReactionClick(e) {
    const button = e.target.closest('.reaction-btn');
    if (!button) return;

    const emoji = button.dataset.emoji;
    const currentUser = getCurrentUser();
    const recordId = combinedList[globalCurrentIndex].recordId;

    if (!state.session.reactions.has(recordId)) {
        state.session.reactions.set(recordId, new Map());
    }

    const itemReactions = state.session.reactions.get(recordId);
    
    if (itemReactions.get(currentUser.id) === emoji) {
        itemReactions.delete(currentUser.id);
    } else {
        itemReactions.set(currentUser.id, emoji);
    }
    
    renderReactions(recordId);
    triggerSave();
}

export function showPresentationView(listType, startRecordId = null) {
    log('Presentation', `Showing presentation for: ${listType}`);

    // Ensure DOM elements are available
    if (!ensureDOMElements()) {
        console.error('[Presentation] Cannot show presentation view - DOM elements not available');
        return;
    }

    // Debug: Log modal element state before showing
    const computedStyle = window.getComputedStyle(modal);
    log('Presentation', `Modal initial state - display: ${computedStyle.display}, position: ${computedStyle.position}, top: ${computedStyle.top}, left: ${computedStyle.left}, zIndex: ${computedStyle.zIndex}`);

    // This function no longer calls updateUrl. The event listener in events.js does.
    const favorites = Array.from(state.cart.items.keys()).map(id => ({ recordId: id, type: 'favorites' }));
    const locked = Array.from(state.cart.lockedItems.keys()).map(id => ({ recordId: id, type: 'locked' }));
    combinedList = [...favorites, ...locked];
    if (combinedList.length === 0) {
        alert(`There are no items in your lists to present.`);
        return;
    }

    if (startRecordId) {
        globalCurrentIndex = combinedList.findIndex(item => item.recordId === startRecordId);
    } else {
        const firstItemOfList = combinedList.find(item => item.type === listType);
        globalCurrentIndex = firstItemOfList ? combinedList.indexOf(firstItemOfList) : 0;
    }

    renderSummaryHeader();

    modal.classList.add('active');
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', handleKeyDown);

    // Debug: Log modal element state after showing
    const afterStyle = window.getComputedStyle(modal);
    log('Presentation', `Modal after activation - display: ${afterStyle.display}, position: ${afterStyle.position}, top: ${afterStyle.top}, left: ${afterStyle.left}, zIndex: ${afterStyle.zIndex}`);

    // Debug: Check if presentation-fullpage CSS class is properly applied
    if (afterStyle.position !== 'fixed') {
        console.warn('[Presentation] WARNING: Modal position is not "fixed". Expected "fixed" but got "' + afterStyle.position + '". CSS class .presentation-fullpage may not be loaded properly.');
    }

    renderCurrentSlide();
}

export function hidePresentationView() {
    if (!modal) return; // Guard against null modal
    modal.classList.remove('active');
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', handleKeyDown);
}

export function setupPresentationEventListeners() {
    // Ensure DOM elements are available before setting up listeners
    if (!ensureDOMElements()) {
        console.error('[Presentation] Cannot setup event listeners - DOM elements not available');
        return;
    }

    closeBtn.addEventListener('click', () => {
        updateUrl({ view: null });
        hidePresentationView();
    });
    prevItemBtn.addEventListener('click', () => navigateToSlide(-1));
    nextItemBtn.addEventListener('click', () => navigateToSlide(1));
    reactionButtonsEl.addEventListener('click', handleReactionClick);
    shareBtn.addEventListener('click', (e) => {
        const baseURL = window.location.origin + window.location.pathname;
        const sessionID = state.session.id;
        const shareURL = `${baseURL}?session=${sessionID}&view=present`;
        
        navigator.clipboard.writeText(shareURL).then(() => {
            const originalText = e.target.textContent;
            e.target.textContent = 'Copied!';
            setTimeout(() => {
               e.target.textContent = originalText;
            }, 1500);
        });
    });
}
