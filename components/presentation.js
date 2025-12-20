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
let summaryEventNameEl = null;
let summaryEventNotesEl = null;
let summaryEventDateEl = null;
let shareBtn = null;
let collaboratorsListEl = null;
let itineraryItemsListEl = null;
let chatMessagesEl = null;

// Track loaded images for each item
const itemImagesCache = new Map();

function ensureDOMElements() {
    if (modal) return true; // Already initialized

    modal = document.getElementById('presentation-modal-overlay');
    closeBtn = document.getElementById('presentation-close-btn');
    summaryEventNameEl = document.getElementById('summary-event-name');
    summaryEventNotesEl = document.getElementById('summary-event-notes');
    summaryEventDateEl = document.getElementById('summary-event-date');
    shareBtn = document.getElementById('presentation-share-btn');
    collaboratorsListEl = document.getElementById('itinerary-collaborators-list');
    itineraryItemsListEl = document.getElementById('itinerary-items-list');
    chatMessagesEl = document.getElementById('itinerary-chat-messages');

    if (!modal) {
        console.error('[Presentation] Modal element #presentation-modal-overlay not found in DOM');
        return false;
    }

    log('Presentation', `DOM elements initialized for itinerary view`);
    return true;
}

function renderEventHeader() {
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Event Itinerary';
    const goals = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);

    summaryEventNameEl.textContent = eventName;
    summaryEventNotesEl.textContent = goals;

    if (dateValue) {
        const date = Array.isArray(dateValue) ? new Date(dateValue[0]) : new Date(dateValue);
        summaryEventDateEl.textContent = date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
    } else {
        summaryEventDateEl.textContent = '';
    }
}

function renderCollaborators() {
    const userProfiles = state.session.userProfiles;

    if (userProfiles.size === 0) {
        collaboratorsListEl.innerHTML = '<p class="no-collaborators">No collaborators yet</p>';
        return;
    }

    let html = '';
    userProfiles.forEach((name, odId) => {
        const isCurrentUser = state.session.user.id === odId;
        const badge = isCurrentUser ? '<span class="collaborator-badge">You</span>' : '';
        html += `
            <div class="collaborator-item">
                <span class="collaborator-avatar">${name.charAt(0).toUpperCase()}</span>
                <span class="collaborator-name">${name}${badge}</span>
            </div>
        `;
    });

    collaboratorsListEl.innerHTML = html;
}

function renderReactions(recordId, reactionContainer) {
    const currentUser = getCurrentUser();
    let allReactions = state.session.reactions.get(recordId);
    if (!(allReactions instanceof Map)) {
        allReactions = new Map();
    }
    const currentUserReaction = allReactions.get(currentUser.id);

    const buttonsHTML = EMOJI_REACTIONS.map(emoji =>
        `<button class="reaction-btn ${currentUserReaction === emoji ? 'selected' : ''}" data-emoji="${emoji}" data-record-id="${recordId}">${emoji}</button>`
    ).join('');

    let summaryHTML = '';
    if (allReactions.size > 0) {
        summaryHTML = Array.from(allReactions.entries()).map(([userId, reaction]) => {
            const name = state.session.userProfiles.get(userId) || 'A User';
            return `<span>${name}: ${reaction}</span>`;
        }).join(' | ');
    }

    reactionContainer.innerHTML = `
        <div class="reaction-bar-buttons">${buttonsHTML}</div>
        <div class="reaction-summary-display">${summaryHTML || 'No reactions yet'}</div>
    `;
}

function createMediaCarousel(images, recordId) {
    if (!images || images.length === 0) {
        return '<div class="itinerary-item-no-images">No images available</div>';
    }

    const currentIndex = itemImagesCache.get(recordId)?.currentIndex || 0;

    const thumbnails = images.map((url, index) =>
        `<div class="itinerary-thumbnail ${index === currentIndex ? 'active' : ''}"
              data-record-id="${recordId}"
              data-index="${index}"
              style="background-image: url('${url}')"></div>`
    ).join('');

    return `
        <div class="itinerary-media-carousel" data-record-id="${recordId}">
            <div class="itinerary-main-image" style="background-image: url('${images[currentIndex]}')"></div>
            ${images.length > 1 ? `
                <div class="itinerary-thumbnails">${thumbnails}</div>
            ` : ''}
        </div>
    `;
}

async function renderItineraryItem(item, index) {
    const { recordId, type } = item;
    const record = state.records.all.find(r => r.id === recordId);

    if (!record) {
        return '';
    }

    const itemInfo = type === 'favorites' ? state.cart.items.get(recordId) : state.cart.lockedItems.get(recordId);
    const name = record.fields.Name || 'Untitled Item';
    const description = record.fields.Description || '';
    const price = getRecordPrice(record, itemInfo?.selectedOptionIndex);
    const quantity = itemInfo?.quantity || 1;
    const note = itemInfo?.note || '';

    // Fetch images if not cached
    if (!itemImagesCache.has(recordId)) {
        const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
        itemImagesCache.set(recordId, { images: imageUrls || [], currentIndex: 0 });
    }

    const cachedImages = itemImagesCache.get(recordId);
    const mediaCarouselHTML = createMediaCarousel(cachedImages.images, recordId);

    const typeLabel = type === 'favorites' ? 'Idea' : 'Confirmed';
    const typeClass = type === 'favorites' ? 'item-type-idea' : 'item-type-confirmed';

    return `
        <article class="itinerary-item" data-record-id="${recordId}" data-index="${index}">
            <div class="itinerary-item-number">${index + 1}</div>
            <div class="itinerary-item-content">
                ${mediaCarouselHTML}
                <div class="itinerary-item-details">
                    <div class="itinerary-item-header">
                        <h3 class="itinerary-item-name">${name}</h3>
                        <span class="itinerary-item-type ${typeClass}">${typeLabel}</span>
                    </div>
                    <div class="itinerary-item-price-qty">
                        <span class="itinerary-item-price">$${price.toFixed(2)}</span>
                        ${quantity > 1 ? `<span class="itinerary-item-qty">× ${quantity}</span>` : ''}
                    </div>
                    ${description ? `<p class="itinerary-item-description">${description}</p>` : ''}
                    ${note ? `
                        <div class="itinerary-item-note">
                            <strong>Note:</strong> ${note}
                        </div>
                    ` : ''}
                    <div class="itinerary-item-reactions" data-record-id="${recordId}"></div>
                </div>
            </div>
        </article>
    `;
}

async function renderAllItems() {
    const favorites = Array.from(state.cart.items.keys()).map(id => ({ recordId: id, type: 'favorites' }));
    const locked = Array.from(state.cart.lockedItems.keys()).map(id => ({ recordId: id, type: 'locked' }));
    const combinedList = [...locked, ...favorites]; // Confirmed items first, then ideas

    if (combinedList.length === 0) {
        itineraryItemsListEl.innerHTML = '<p class="itinerary-empty">No items in your event plan yet.</p>';
        return;
    }

    itineraryItemsListEl.innerHTML = '<p class="itinerary-loading">Loading items...</p>';

    // Render all items
    const itemsHTML = [];
    for (let i = 0; i < combinedList.length; i++) {
        const html = await renderItineraryItem(combinedList[i], i);
        if (html) {
            itemsHTML.push(html);
        }
    }

    itineraryItemsListEl.innerHTML = itemsHTML.join('');

    // Render reactions for each item
    combinedList.forEach(item => {
        const reactionContainer = itineraryItemsListEl.querySelector(`.itinerary-item-reactions[data-record-id="${item.recordId}"]`);
        if (reactionContainer) {
            renderReactions(item.recordId, reactionContainer);
        }
    });
}

function renderChatMessages() {
    // Get chat messages from state or session history
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) {
        chatMessagesEl.innerHTML = '<p class="chat-empty">Chat messages will appear here.</p>';
        return;
    }

    // Clone the chat messages to display in the itinerary view
    const messages = messagesList.querySelectorAll('.message-wrapper, .event-history-wrapper');

    if (messages.length === 0) {
        chatMessagesEl.innerHTML = '<p class="chat-empty">No messages yet. Start the conversation!</p>';
        return;
    }

    // Copy messages to the itinerary chat section
    chatMessagesEl.innerHTML = '';
    messages.forEach(msg => {
        const clone = msg.cloneNode(true);
        chatMessagesEl.appendChild(clone);
    });
}

function handleThumbnailClick(e) {
    const thumbnail = e.target.closest('.itinerary-thumbnail');
    if (!thumbnail) return;

    const recordId = thumbnail.dataset.recordId;
    const index = parseInt(thumbnail.dataset.index, 10);

    if (!itemImagesCache.has(recordId)) return;

    const cached = itemImagesCache.get(recordId);
    cached.currentIndex = index;

    // Update the main image
    const carousel = document.querySelector(`.itinerary-media-carousel[data-record-id="${recordId}"]`);
    if (carousel) {
        const mainImage = carousel.querySelector('.itinerary-main-image');
        if (mainImage && cached.images[index]) {
            mainImage.style.backgroundImage = `url('${cached.images[index]}')`;
        }

        // Update active thumbnail
        carousel.querySelectorAll('.itinerary-thumbnail').forEach((thumb, i) => {
            thumb.classList.toggle('active', i === index);
        });
    }
}

function handleReactionClick(e) {
    const button = e.target.closest('.reaction-btn');
    if (!button) return;

    const emoji = button.dataset.emoji;
    const recordId = button.dataset.recordId;
    const currentUser = getCurrentUser();

    if (!state.session.reactions.has(recordId)) {
        state.session.reactions.set(recordId, new Map());
    }

    const itemReactions = state.session.reactions.get(recordId);

    if (itemReactions.get(currentUser.id) === emoji) {
        itemReactions.delete(currentUser.id);
    } else {
        itemReactions.set(currentUser.id, emoji);
    }

    // Re-render reactions for this item
    const reactionContainer = document.querySelector(`.itinerary-item-reactions[data-record-id="${recordId}"]`);
    if (reactionContainer) {
        renderReactions(recordId, reactionContainer);
    }

    triggerSave();
}

function handleKeyDown(e) {
    if (e.key === 'Escape') {
        updateUrl({ view: null });
        hidePresentationView();
    }
}

export async function showPresentationView(listType, startRecordId = null) {
    log('Presentation', `Showing itinerary presentation`);

    if (!ensureDOMElements()) {
        console.error('[Presentation] Cannot show presentation view - DOM elements not available');
        return;
    }

    // Check if there are any items
    const hasItems = state.cart.items.size > 0 || state.cart.lockedItems.size > 0;
    if (!hasItems) {
        alert('There are no items in your lists to present.');
        return;
    }

    // Clear image cache for fresh load
    itemImagesCache.clear();

    // Render all sections
    renderEventHeader();
    renderCollaborators();
    await renderAllItems();
    renderChatMessages();

    // Show modal
    modal.classList.add('active');
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', handleKeyDown);

    // Scroll to specific item if provided
    if (startRecordId) {
        const targetItem = document.querySelector(`.itinerary-item[data-record-id="${startRecordId}"]`);
        if (targetItem) {
            setTimeout(() => {
                targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    }

    log('Presentation', 'Itinerary view rendered successfully');
}

export function hidePresentationView() {
    if (!modal) return;
    modal.classList.remove('active');
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', handleKeyDown);
}

export function setupPresentationEventListeners() {
    if (!ensureDOMElements()) {
        console.error('[Presentation] Cannot setup event listeners - DOM elements not available');
        return;
    }

    closeBtn.addEventListener('click', () => {
        updateUrl({ view: null });
        hidePresentationView();
    });

    // Handle thumbnail clicks for image carousel
    itineraryItemsListEl.addEventListener('click', handleThumbnailClick);

    // Handle reaction clicks
    itineraryItemsListEl.addEventListener('click', handleReactionClick);

    // Share button
    shareBtn.addEventListener('click', (e) => {
        const baseURL = window.location.origin + window.location.pathname;
        const sessionID = state.session.id;
        const shareURL = `${baseURL}?session=${sessionID}&view=present`;

        navigator.clipboard.writeText(shareURL).then(() => {
            const originalText = e.target.textContent;
            e.target.textContent = 'Link Copied!';
            setTimeout(() => {
               e.target.textContent = originalText;
            }, 1500);
        });
    });
}
