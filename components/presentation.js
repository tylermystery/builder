import { state } from '../state.js';
import * as api from '../api.js';
import { CONSTANTS, EMOJI_REACTIONS } from '../config.js';
import { updateUrl, getRecordPrice } from '../utils.js';
import { log } from '../utils/debug.js';
import { getCurrentUser } from '../chat.js';
import { triggerSave } from '../events.js';
import { showDetailModal } from './modal.js';

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

// Accordion summary elements
let headerSummaryEl = null;
let itemsSummaryEl = null;
let chatSummaryEl = null;

// Track loaded images for each item
const itemImagesCache = new Map();

// Track accordion state (all sections start expanded)
const accordionState = {
    header: true,
    items: true,
    chat: true
};

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

    // Accordion summary elements
    headerSummaryEl = document.getElementById('header-summary');
    itemsSummaryEl = document.getElementById('items-summary');
    chatSummaryEl = document.getElementById('chat-summary');

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
        <article class="itinerary-item itinerary-item-clickable" data-record-id="${recordId}" data-index="${index}">
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

// Generate summary for the event header section
function generateHeaderSummary() {
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Untitled Event';
    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    const collaboratorCount = state.session.userProfiles.size;

    let datePart = '';
    if (dateValue) {
        const date = Array.isArray(dateValue) ? new Date(dateValue[0]) : new Date(dateValue);
        datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    let summary = `<span class="summary-highlight">${eventName}</span>`;
    if (datePart) {
        summary += ` on ${datePart}`;
    }
    if (collaboratorCount > 0) {
        const hostWord = collaboratorCount === 1 ? 'host' : 'hosts';
        summary += ` &bull; <span class="summary-count">${collaboratorCount}</span> ${hostWord}`;
    }

    if (headerSummaryEl) {
        headerSummaryEl.innerHTML = summary;
    }
}

// Generate summary for the items section
function generateItemsSummary() {
    const favoritesCount = state.cart.items.size;
    const lockedCount = state.cart.lockedItems.size;
    const totalCount = favoritesCount + lockedCount;

    if (totalCount === 0) {
        if (itemsSummaryEl) {
            itemsSummaryEl.textContent = 'No items added yet';
        }
        return;
    }

    // Get first few item names for preview
    const allItems = [...state.cart.lockedItems.keys(), ...state.cart.items.keys()];
    const itemNames = allItems.slice(0, 3).map(id => {
        const record = state.records.all.find(r => r.id === id);
        return record?.fields?.Name || 'Item';
    });

    let summary = `<span class="summary-count">${totalCount}</span> item${totalCount !== 1 ? 's' : ''}`;

    if (lockedCount > 0 && favoritesCount > 0) {
        summary += ` (<span class="summary-count">${lockedCount}</span> confirmed, <span class="summary-count">${favoritesCount}</span> idea${favoritesCount !== 1 ? 's' : ''})`;
    } else if (lockedCount > 0) {
        summary += ` (all confirmed)`;
    } else {
        summary += ` (all ideas)`;
    }

    if (itemNames.length > 0) {
        const namePreview = itemNames.join(', ');
        const moreCount = totalCount - itemNames.length;
        summary += ` &bull; <span class="item-preview">${namePreview}${moreCount > 0 ? ` +${moreCount} more` : ''}</span>`;
    }

    if (itemsSummaryEl) {
        itemsSummaryEl.innerHTML = summary;
    }
}

// Generate summary for the chat section
function generateChatSummary() {
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) {
        if (chatSummaryEl) {
            chatSummaryEl.textContent = 'No discussion yet';
        }
        return;
    }

    const messages = messagesList.querySelectorAll('.message-wrapper');
    const messageCount = messages.length;

    if (messageCount === 0) {
        if (chatSummaryEl) {
            chatSummaryEl.textContent = 'No messages yet';
        }
        return;
    }

    // Get unique participants
    const participants = new Set();
    messages.forEach(msg => {
        const authorEl = msg.querySelector('.message-author');
        if (authorEl) {
            participants.add(authorEl.textContent.trim());
        }
    });

    let summary = `<span class="summary-count">${messageCount}</span> message${messageCount !== 1 ? 's' : ''}`;

    if (participants.size > 0) {
        summary += ` from <span class="summary-count">${participants.size}</span> participant${participants.size !== 1 ? 's' : ''}`;
    }

    // Get preview of latest message
    const lastMessage = messages[messages.length - 1];
    const lastContent = lastMessage?.querySelector('.message-content');
    if (lastContent) {
        const text = lastContent.textContent.trim();
        if (text) {
            const truncated = text.length > 50 ? text.substring(0, 50) + '...' : text;
            summary += ` &bull; "${truncated}"`;
        }
    }

    if (chatSummaryEl) {
        chatSummaryEl.innerHTML = summary;
    }
}

// Toggle accordion section
function toggleAccordion(section) {
    const sectionEl = modal.querySelector(`.itinerary-accordion[data-section="${section}"]`);
    if (!sectionEl) return;

    accordionState[section] = !accordionState[section];

    if (accordionState[section]) {
        sectionEl.classList.add('expanded');
    } else {
        sectionEl.classList.remove('expanded');
    }

    log('Presentation', `Accordion ${section} ${accordionState[section] ? 'expanded' : 'collapsed'}`);
}

// Initialize accordion states and update UI
function initializeAccordions() {
    // Set all sections to expanded state initially
    Object.keys(accordionState).forEach(section => {
        accordionState[section] = true;
        const sectionEl = modal.querySelector(`.itinerary-accordion[data-section="${section}"]`);
        if (sectionEl) {
            sectionEl.classList.add('expanded');
        }
    });

    // Generate all summaries
    generateHeaderSummary();
    generateItemsSummary();
    generateChatSummary();
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

function handleItemClick(e) {
    // Don't trigger if clicking on reactions, thumbnails, or other interactive elements
    if (e.target.closest('.reaction-btn') ||
        e.target.closest('.itinerary-thumbnail') ||
        e.target.closest('.itinerary-item-reactions')) {
        return;
    }

    const itemElement = e.target.closest('.itinerary-item-clickable');
    if (!itemElement) return;

    const recordId = itemElement.dataset.recordId;
    if (!recordId) return;

    const record = state.records.all.find(r => r.id === recordId);
    if (!record) {
        log('Presentation', `Record not found for ID: ${recordId}`);
        return;
    }

    log('Presentation', `Opening detail modal for: ${record.fields.Name}`);
    showDetailModal(record);
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

    // Initialize accordions and generate summaries
    initializeAccordions();

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

    // Handle accordion header clicks
    const scrollContainer = modal.querySelector('.presentation-itinerary-scroll');
    if (scrollContainer) {
        scrollContainer.addEventListener('click', (e) => {
            const accordionHeader = e.target.closest('.itinerary-accordion-header');
            if (!accordionHeader) return;

            // Don't trigger accordion on interactive elements inside
            if (e.target.closest('button') || e.target.closest('a')) return;

            const section = accordionHeader.dataset.section;
            if (section) {
                toggleAccordion(section);
            }
        });
    }

    // Handle thumbnail clicks for image carousel
    itineraryItemsListEl.addEventListener('click', handleThumbnailClick);

    // Handle reaction clicks
    itineraryItemsListEl.addEventListener('click', handleReactionClick);

    // Handle item clicks to open detail modal
    itineraryItemsListEl.addEventListener('click', handleItemClick);

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
