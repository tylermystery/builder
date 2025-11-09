// REPLACE THE ENTIRE CONTENTS OF: components/presentation.js

import { state } from '../state.js';
import * as api from '../api.js';
import { CONSTANTS, EMOJI_REACTIONS } from '../config.js';
import { updateUrl, getRecordPrice } from '../utils.js';
import { log } from '../utils/debug.js';
import { getCurrentUser } from '../chat.js';
import { triggerSave } from '../events.js';

// --- REMOVED: All top-level const declarations ---

let combinedList = [];
let globalCurrentIndex = 0;
let currentImages = [];
let currentImageIndex = 0;

function updateHeader(currentItem) {
    // --- ADDED: Queries inside function ---
    const titleEl = document.getElementById('presentation-title');
    const counterEl = document.getElementById('presentation-counter');
    const summaryIdeasLink = document.getElementById('summary-ideas-link');
    const summaryLockedLink = document.getElementById('summary-locked-link');
    // --- END ADD ---

    const listType = currentItem.type;
    
    // --- FIX: Add safety checks ---
    if (titleEl) titleEl.textContent = listType === 'favorites' ? 'Presenting Ideas' : 'Presenting Event Plan';
    if (counterEl) counterEl.textContent = `Item ${globalCurrentIndex + 1} of ${combinedList.length}`;
    if (summaryIdeasLink) summaryIdeasLink.classList.toggle('active', listType === 'favorites');
    if (summaryLockedLink) summaryLockedLink.classList.toggle('active', listType === 'locked');
    if (summaryIdeasLink) summaryIdeasLink.disabled = listType === 'favorites';
    if (summaryLockedLink) summaryLockedLink.disabled = listType === 'locked';
    // --- END FIX ---
}

function renderSummaryHeader() {
    // --- ADDED: Queries inside function ---
    const summaryEventNameEl = document.getElementById('summary-event-name');
    const summaryEventNotesEl = document.getElementById('summary-event-notes');
    const summaryEventDateEl = document.getElementById('summary-event-date');
    const summaryIdeasLink = document.getElementById('summary-ideas-link');
    const summaryLockedLink = document.getElementById('summary-locked-link');
    // --- END ADD ---

    // --- FIX: Add safety checks ---
    if (summaryEventNameEl) summaryEventNameEl.textContent = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'N/A';
    if (summaryEventNotesEl) summaryEventNotesEl.textContent = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || 'N/A';
    
    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    if (dateValue) {
        const date = Array.isArray(dateValue) ? new Date(dateValue[0]) : new Date(dateValue);
        if (summaryEventDateEl) summaryEventDateEl.textContent = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } else {
        if (summaryEventDateEl) summaryEventDateEl.textContent = 'N/A';
    }

    if (summaryIdeasLink) summaryIdeasLink.textContent = `${state.cart.items.size} Ideas`;
    if (summaryLockedLink) summaryLockedLink.textContent = `${state.cart.lockedItems.size} Locked In`;
    // --- END FIX ---
}

function renderReactions(recordId) {
    // --- ADDED: Queries inside function ---
    const reactionButtonsEl = document.getElementById('reaction-buttons');
    const reactionSummaryEl = document.getElementById('reaction-summary');
    // --- END ADD ---

    const currentUser = getCurrentUser();
    let allReactions = state.session.reactions.get(recordId);
    if (!(allReactions instanceof Map)) {
        allReactions = new Map();
    }
    const currentUserReaction = allReactions.get(currentUser.id);

    if (reactionButtonsEl) {
        reactionButtonsEl.innerHTML = EMOJI_REACTIONS.map(emoji => 
            `<button class=\"reaction-btn ${currentUserReaction === emoji ? 'selected' : ''}\" data-emoji=\"${emoji}\">${emoji}</button>`
        ).join('');
    }
    
    let summaryHTML = 'Reactions: ';
    if (allReactions.size > 0) {
        summaryHTML += Array.from(allReactions.entries()).map(([userId, reaction]) => {
            const name = state.session.userProfiles.get(userId) || 'A User';
            return `<span>${name}: ${reaction}</span>`;
        }).join(' | ');
    } else {
        summaryHTML += 'None yet.';
    }
    
    if (reactionSummaryEl) reactionSummaryEl.innerHTML = summaryHTML;
}

async function renderCurrentSlide() {
    // --- ADDED: Queries inside function ---
    const mainImageEl = document.getElementById('presentation-main-image');
    const thumbStripEl = document.getElementById('presentation-thumbnail-strip');
    const itemNameEl = document.getElementById('presentation-item-name');
    const itemPriceEl = document.getElementById('presentation-item-price');
    const itemDescEl = document.getElementById('presentation-item-description');
    const itemNoteContainerEl = document.getElementById('presentation-item-note-container');
    const itemNoteEl = document.getElementById('presentation-item-note');
    // --- END ADD ---

    if (combinedList.length === 0) {
        hidePresentationView();
        return;
    }
    
    // --- FIX: Add safety checks ---
    if (mainImageEl) mainImageEl.style.backgroundImage = '';
    if (thumbStripEl) thumbStripEl.innerHTML = '<p>Loading images...</p>';
    // --- END FIX ---

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
    
    // --- FIX: Add safety checks ---
    if (itemNameEl) itemNameEl.textContent = record.fields.Name || 'Untitled';
    const price = getRecordPrice(record, itemInfo?.selectedOptionIndex);
    if (itemPriceEl) itemPriceEl.textContent = `$${price.toFixed(2)}`;
    if (itemDescEl) itemDescEl.textContent = record.fields.Description || '';
    if (itemInfo?.note) {
        if (itemNoteContainerEl) itemNoteContainerEl.style.display = 'block';
        if (itemNoteEl) itemNoteEl.textContent = itemInfo.note;
    } else {
        if (itemNoteContainerEl) itemNoteContainerEl.style.display = 'none';
    }
    // --- END FIX ---

    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    currentImages = imageUrls || [];
    currentImageIndex = 0;
    renderCurrentImage();
}

function renderCurrentImage() {
    // --- ADDED: Queries inside function ---
    const mainImageEl = document.getElementById('presentation-main-image');
    const thumbStripEl = document.getElementById('presentation-thumbnail-strip');
    // --- END ADD ---

    // --- FIX: Add safety checks ---
    if (currentImages.length === 0) {
        if (mainImageEl) mainImageEl.style.backgroundImage = '';
        if (thumbStripEl) thumbStripEl.innerHTML = '<p>No images available.</p>';
        return;
    }
    if (mainImageEl) mainImageEl.style.backgroundImage = `url('${currentImages[currentImageIndex]}')`;

    if (thumbStripEl) {
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
    // --- END FIX ---
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
            // --- THIS IS THE FIX ---\n            updateUrl({ view: null });
            hidePresentationView();
            break;
    }
}

function handleReactionClick(e) {
    // --- ADDED: Query inside function ---
    const reactionButtonsEl = document.getElementById('reaction-buttons');
    if (!reactionButtonsEl) return;
    // --- END ADD ---

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
    // --- ADDED: Query inside function ---
    const modal = document.getElementById('presentation-modal-overlay');
    // --- END ADD ---

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
    
    // --- FIX: Add safety check ---
    if (modal) {
        modal.classList.add('active');
        modal.style.display = 'flex';
    }
    // --- END FIX ---
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', handleKeyDown);
    
    renderCurrentSlide();
}

export function hidePresentationView() {
    // --- ADDED: Query inside function ---
    const modal = document.getElementById('presentation-modal-overlay');
    // --- END ADD ---

    // This function now ONLY handles the UI.
    // --- FIX: Add safety check ---
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
    // --- END FIX ---
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', handleKeyDown);
}

export function setupPresentationEventListeners() {
    // --- ADDED: Queries inside function ---
    const modal = document.getElementById('presentation-modal-overlay');
    const closeBtn = document.getElementById('presentation-close-btn');
    const prevItemBtn = document.getElementById('presentation-prev-item-btn');
    const nextItemBtn = document.getElementById('presentation-next-item-btn');
    const reactionButtonsEl = document.getElementById('reaction-buttons');
    const summaryIdeasLink = document.getElementById('summary-ideas-link');
    const summaryLockedLink = document.getElementById('summary-locked-link');
    const shareBtn = document.getElementById('presentation-share-btn');
    // --- END ADD ---

    // --- FIX: Add safety checks ---
    closeBtn?.addEventListener('click', () => {
        updateUrl({ view: null });
        hidePresentationView();
    });
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) {
            updateUrl({ view: null });
            hidePresentationView();
        }
    });
    // --- END FIX ---\n    prevItemBtn?.addEventListener('click', () => navigateToSlide(-1));
    nextItemBtn?.addEventListener('click', () => navigateToSlide(1));
    reactionButtonsEl?.addEventListener('click', handleReactionClick);
    summaryIdeasLink?.addEventListener('click', () => {
        if (state.cart.items.size > 0) {
             showPresentationView('favorites');
        }
    });
    summaryLockedLink?.addEventListener('click', () => {
        if (state.cart.lockedItems.size > 0) {
            showPresentationView('locked');
        }
    });
    shareBtn?.addEventListener('click', (e) => {
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
