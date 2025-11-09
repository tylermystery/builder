// REPLACE THE ENTIRE CONTENTS OF: components/presentation.js

import { state } from '../state.js';
import * as api from '../api.js';
import { CONSTANTS, EMOJI_REACTIONS } from '../config.js';
import { updateUrl, getRecordPrice } from '../utils.js';
import { log } from '../utils/debug.js';
import { getCurrentUser } from '../chat.js';
import { triggerSave } from '../events.js';

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
const reactionButtonsEl = document.getElementById('reaction-buttons');
const reactionSummaryEl = document.getElementById('reaction-summary');
const summaryEventNameEl = document.getElementById('summary-event-name');
const summaryEventNotesEl = document.getElementById('summary-event-notes');
const summaryEventDateEl = document.getElementById('summary-event-date');
const summaryIdeasLink = document.getElementById('summary-ideas-link');
const summaryLockedLink = document.getElementById('summary-locked-link');
const shareBtn = document.getElementById('presentation-share-btn');

let combinedList = [];
let globalCurrentIndex = 0;
let currentImages = [];
let currentImageIndex = 0;

function updateHeader(currentItem) {
    const listType = currentItem.type;
    titleEl.textContent = listType === 'favorites' ?
        'Presenting Ideas' : 'Presenting Event Plan';
    counterEl.textContent = `Item ${globalCurrentIndex + 1} of ${combinedList.length}`;
    
    summaryIdeasLink.classList.toggle('active', listType === 'favorites');
    summaryLockedLink.classList.toggle('active', listType === 'locked');
    summaryIdeasLink.disabled = listType === 'favorites';
    summaryLockedLink.disabled = listType === 'locked';
}

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

    summaryIdeasLink.textContent = `${state.cart.items.size} Ideas`;
    summaryLockedLink.textContent = `${state.cart.lockedItems.size} Locked In`;
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
    
    updateHeader(currentItem);
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
            // --- THIS IS THE FIX ---
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
    
    renderCurrentSlide();
}

export function hidePresentationView() {
    // This function now ONLY handles the UI.
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', handleKeyDown);
}

export function setupPresentationEventListeners() {
    // --- THIS IS THE FIX ---
    closeBtn.addEventListener('click', () => {
        updateUrl({ view: null });
        hidePresentationView();
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            updateUrl({ view: null });
            hidePresentationView();
        }
    });
    // --- END FIX ---
    prevItemBtn.addEventListener('click', () => navigateToSlide(-1));
    nextItemBtn.addEventListener('click', () => navigateToSlide(1));
    reactionButtonsEl.addEventListener('click', handleReactionClick);
    summaryIdeasLink.addEventListener('click', () => {
        if (state.cart.items.size > 0) {
             showPresentationView('favorites');
        }
    });
    summaryLockedLink.addEventListener('click', () => {
        if (state.cart.lockedItems.size > 0) {
            showPresentationView('locked');
        }
    });
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
