import { state } from '../state.js';
import * as api from '../api.js';
import { CONSTANTS, EMOJI_REACTIONS, EMOJI_CATEGORIES, REACTION_SCORES } from '../config.js';
import { updateUrl, getRecordPrice } from '../utils.js';
import { log } from '../utils/debug.js';
import { getCurrentUser, sendMessage as sendChatMessage, getReplyingToMessage, clearReplyState } from '../chat.js';
import { triggerSave } from '../events.js';
import { showDetailModal } from './modal.js';
import { Shader } from '../utils/shader.js';
import { showWtfPlansPanel } from './wtfPlansPanel.js';

// Quick emoji reactions available for messages
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

// Track message being replied to in presentation view
let presentationReplyingToMessage = null;

// Track message being edited in presentation view
let presentationEditingMessage = null;

// Track scroll position before scrolling to chat
let savedScrollPosition = null;

// Flag to track if catalog needs rendering when exiting presentation view
let catalogNeedsRender = false;

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

// Presentation header elements
let presentationBackBtn = null;
let presentationLogoContainer = null;
let presentationShopTitle = null;
let presentationEventLabel = null;
let presentationHeaderShareBtn = null;

// Embedded chat DOM elements
let presentationChatContainer = null;
let presentationMessageForm = null;
let presentationMessageInput = null;
let presentationUserNameInput = null;
let presentationWhosHereCount = null;
let presentationWhosHereList = null;

// Accordion summary elements
let headerSummaryEl = null;
let itemsSummaryEl = null;
let chatSummaryEl = null;

// Floating chat button
let floatingChatBtn = null;

// Reactions summary DOM element
let reactionsSummaryEl = null;

// Track loaded images for each item
const itemImagesCache = new Map();

// Track accordion state (all sections start expanded)
const accordionState = {
    header: true,
    items: true,
    chat: true
};

// Pusher instance for presentation chat
let presentationPusher = null;
let presentationChatChannel = null;

// --- Presentation Background Engine ---
// WebGL Shader code for the fluid effect (same as catalog background)
const vsSource = `
    attribute vec4 a_position;
    void main() {
        gl_Position = a_position;
    }
`;

const fsSource = `
    precision mediump float;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_energy;
    uniform float u_progress;

    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    float noise(vec2 st) {
        vec2 i = floor(st);
        vec2 f = fract(st);
        float a = random(i);
        float b = random(i + vec2(1.0, 0.0));
        float c = random(i + vec2(0.0, 1.0));
        float d = random(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.y * u.x;
    }

    void main() {
        vec2 st = gl_FragCoord.xy / u_resolution.xy;
        st.x *= u_resolution.x / u_resolution.y;
        vec2 centered_st = st - vec2(0.5, 0.5);
        float angle = atan(centered_st.y, centered_st.x);
        float radius = length(centered_st);
        float vortex_speed = u_time * (0.2 + u_energy * 2.0);
        float vortex_twist = u_energy * 5.0;
        float n = noise(vec2(angle * (3.0 + vortex_twist) + vortex_speed, radius * 2.0));
        float base_wave = n * 1.5 + u_progress * 10.0;
        const float PI_2_OVER_3 = 2.0943951;
        float r = pow(sin(base_wave + 0.0) * 0.5 + 0.5, 1.1) + 0.1;
        float g = pow(sin(base_wave + PI_2_OVER_3) * 0.5 + 0.5, 1.1) + 0.1;
        float b = pow(sin(base_wave + PI_2_OVER_3 * 2.0) * 0.5 + 0.5, 1.1) + 0.1;
        float vignette = 1.0 - (radius * 0.2);
        gl_FragColor = vec4(r * vignette, g * vignette, b * vignette, 1.0);
    }
`;

let presentationBgCanvas = null;
let presentationGl = null;
let presentationShader = null;
let presentationAnimationFrameId = null;
let presentationBgStartTime = 0;
let presentationBgEnergy = 0.0;
const presentationEnergyDecayRate = 0.985;

function initPresentationBackground() {
    presentationBgCanvas = document.getElementById('presentation-bg-canvas');
    if (!presentationBgCanvas) {
        log('Presentation', 'Background canvas not found');
        return false;
    }

    // Size canvas to fill the presentation view
    presentationBgCanvas.width = window.innerWidth;
    presentationBgCanvas.height = window.innerHeight;

    presentationGl = presentationBgCanvas.getContext('webgl') || presentationBgCanvas.getContext('experimental-webgl');
    if (!presentationGl) {
        log('Presentation', 'WebGL not available for presentation background');
        return false;
    }

    // Initialize shader
    presentationShader = new Shader(presentationGl, vsSource, fsSource);
    presentationBgStartTime = performance.now();

    log('Presentation', 'Background engine initialized');
    return true;
}

function startPresentationBackgroundAnimation() {
    if (!presentationGl || !presentationShader) {
        if (!initPresentationBackground()) {
            return;
        }
    }

    // Reset timing
    presentationBgStartTime = performance.now();
    presentationBgEnergy = 0.3; // Start with some energy for visual effect

    function animate(timestamp) {
        if (!modal || !modal.classList.contains('active')) {
            presentationAnimationFrameId = null;
            return;
        }

        const elapsedTime = (timestamp - presentationBgStartTime) / 1000.0;
        presentationBgEnergy *= presentationEnergyDecayRate;
        if (presentationBgEnergy < 0.01) presentationBgEnergy = 0.0;

        const currentProgress = state.ui.currentProgress || 0.5;

        presentationShader.use();
        presentationGl.uniform2f(presentationShader.getUniformLocation("u_resolution"), presentationBgCanvas.width, presentationBgCanvas.height);
        presentationGl.uniform1f(presentationShader.getUniformLocation("u_time"), elapsedTime);
        presentationGl.uniform1f(presentationShader.getUniformLocation("u_energy"), presentationBgEnergy);
        presentationGl.uniform1f(presentationShader.getUniformLocation("u_progress"), currentProgress);
        presentationGl.drawArrays(presentationGl.TRIANGLES, 0, 6);

        presentationAnimationFrameId = requestAnimationFrame(animate);
    }

    if (presentationAnimationFrameId) {
        cancelAnimationFrame(presentationAnimationFrameId);
    }
    presentationAnimationFrameId = requestAnimationFrame(animate);
    log('Presentation', 'Background animation started');
}

function stopPresentationBackgroundAnimation() {
    if (presentationAnimationFrameId) {
        cancelAnimationFrame(presentationAnimationFrameId);
        presentationAnimationFrameId = null;
        log('Presentation', 'Background animation stopped');
    }
}

function resizePresentationBackground() {
    if (presentationBgCanvas && presentationGl) {
        presentationBgCanvas.width = window.innerWidth;
        presentationBgCanvas.height = window.innerHeight;
        presentationGl.viewport(0, 0, presentationBgCanvas.width, presentationBgCanvas.height);
    }
}

function ensureDOMElements() {
    console.log('[Accordion DEBUG] ensureDOMElements called, modal already set:', !!modal);
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

    // Presentation header elements
    presentationBackBtn = document.getElementById('presentation-back-btn');
    presentationLogoContainer = document.getElementById('presentation-logo-container');
    presentationShopTitle = document.getElementById('presentation-shop-title');
    presentationEventLabel = document.getElementById('presentation-event-label');
    presentationHeaderShareBtn = document.getElementById('presentation-header-share-btn');

    // Embedded chat elements
    presentationChatContainer = document.getElementById('presentation-chat-container');
    presentationMessageForm = document.getElementById('presentation-message-form');
    presentationMessageInput = document.getElementById('presentation-message-input');
    presentationUserNameInput = document.getElementById('presentation-chat-user-name');
    presentationWhosHereCount = document.getElementById('presentation-whos-here-count');
    presentationWhosHereList = document.getElementById('presentation-whos-here-list');

    // Floating chat button
    floatingChatBtn = document.getElementById('presentation-floating-chat-btn');

    // Accordion summary elements
    headerSummaryEl = document.getElementById('header-summary');
    itemsSummaryEl = document.getElementById('items-summary');
    chatSummaryEl = document.getElementById('chat-summary');

    console.log('[Accordion DEBUG] DOM elements after init:', {
        modal: !!modal,
        closeBtn: !!closeBtn,
        headerSummaryEl: !!headerSummaryEl,
        itemsSummaryEl: !!itemsSummaryEl,
        chatSummaryEl: !!chatSummaryEl
    });

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

function renderPresentationHeader() {
    // Copy the shop logo from the main header
    const mainLogoContainer = document.getElementById('shop-logo-container');
    if (mainLogoContainer && presentationLogoContainer) {
        const mainLogo = mainLogoContainer.querySelector('img');
        if (mainLogo) {
            presentationLogoContainer.innerHTML = `<img src="${mainLogo.src}" alt="${mainLogo.alt || 'Logo'}">`;
        }
    }

    // Copy the shop title from the main header
    const mainShopTitle = document.getElementById('main-shop-title');
    if (mainShopTitle && presentationShopTitle) {
        presentationShopTitle.textContent = mainShopTitle.textContent;
    }

    // Set the event label in the center of the header
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Event Plan';
    if (presentationEventLabel) {
        presentationEventLabel.textContent = eventName;
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

// Calculate score for a single reaction
function getReactionScore(emoji) {
    return REACTION_SCORES[emoji] || 0;
}

// Calculate total reaction score for an item
function getItemReactionScore(recordId) {
    const reactions = state.session.reactions.get(recordId);
    if (!reactions || !(reactions instanceof Map)) return 0;

    let score = 0;
    reactions.forEach((emoji) => {
        score += getReactionScore(emoji);
    });
    return score;
}

// Get reaction count for an item
function getItemReactionCount(recordId) {
    const reactions = state.session.reactions.get(recordId);
    if (!reactions || !(reactions instanceof Map)) return 0;
    return reactions.size;
}

// Generate the expanded emoji picker HTML
function createEmojiPickerHTML(recordId) {
    let categoriesHTML = '';
    Object.entries(EMOJI_CATEGORIES).forEach(([categoryKey, category]) => {
        const emojisHTML = category.emojis.map(emoji => {
            const score = getReactionScore(emoji);
            const scoreClass = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
            return `<button class="emoji-picker-emoji ${scoreClass}" data-emoji="${emoji}" data-record-id="${recordId}" title="Score: ${score > 0 ? '+' : ''}${score.toFixed(2)}">${emoji}</button>`;
        }).join('');

        categoriesHTML += `
            <div class="emoji-picker-category" data-category="${categoryKey}">
                <div class="emoji-picker-category-label">${category.label}</div>
                <div class="emoji-picker-category-emojis">${emojisHTML}</div>
            </div>
        `;
    });

    return `
        <div class="emoji-picker-modal" data-record-id="${recordId}">
            <div class="emoji-picker-header">
                <span class="emoji-picker-title">Choose a Reaction</span>
                <button class="emoji-picker-close" title="Close">&times;</button>
            </div>
            <div class="emoji-picker-categories">${categoriesHTML}</div>
            <div class="emoji-picker-footer">
                <span class="emoji-score-legend">
                    <span class="legend-item positive">● Positive</span>
                    <span class="legend-item neutral">● Neutral</span>
                    <span class="legend-item negative">● Negative</span>
                </span>
            </div>
        </div>
    `;
}

// Show the expanded emoji picker
function showExpandedEmojiPicker(recordId, anchorElement) {
    // Close any existing picker
    closeExpandedEmojiPicker();

    const pickerHTML = createEmojiPickerHTML(recordId);
    const pickerContainer = document.createElement('div');
    pickerContainer.className = 'emoji-picker-overlay';
    pickerContainer.innerHTML = pickerHTML;

    // Add to DOM
    document.body.appendChild(pickerContainer);

    // Position near the anchor
    const picker = pickerContainer.querySelector('.emoji-picker-modal');
    const rect = anchorElement.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;

    // Center the picker on screen for mobile, near anchor for desktop
    if (window.innerWidth <= 768) {
        picker.style.position = 'fixed';
        picker.style.top = '50%';
        picker.style.left = '50%';
        picker.style.transform = 'translate(-50%, -50%)';
    } else {
        picker.style.position = 'absolute';
        picker.style.top = `${rect.bottom + scrollTop + 10}px`;
        picker.style.left = `${Math.max(10, rect.left - 100)}px`;
    }

    // Add event listeners
    pickerContainer.addEventListener('click', handleEmojiPickerClick);

    // Close on outside click
    pickerContainer.addEventListener('click', (e) => {
        if (e.target === pickerContainer) {
            closeExpandedEmojiPicker();
        }
    });

    // Close on Escape
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeExpandedEmojiPicker();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

// Close the expanded emoji picker
function closeExpandedEmojiPicker() {
    const existingPicker = document.querySelector('.emoji-picker-overlay');
    if (existingPicker) {
        existingPicker.remove();
    }
}

// Handle clicks within the emoji picker
function handleEmojiPickerClick(e) {
    // Close button
    if (e.target.classList.contains('emoji-picker-close')) {
        closeExpandedEmojiPicker();
        return;
    }

    // Emoji selection
    const emojiBtn = e.target.closest('.emoji-picker-emoji');
    if (emojiBtn) {
        const emoji = emojiBtn.dataset.emoji;
        const recordId = emojiBtn.dataset.recordId;
        selectEmoji(recordId, emoji);
        closeExpandedEmojiPicker();
    }
}

// Select an emoji reaction for an item
function selectEmoji(recordId, emoji) {
    const currentUser = getCurrentUser();

    if (!state.session.reactions.has(recordId)) {
        state.session.reactions.set(recordId, new Map());
    }

    const itemReactions = state.session.reactions.get(recordId);

    // Toggle if same emoji, otherwise set new
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

    // Update the reactions summary
    renderReactionsSummary();

    triggerSave();
}

function renderReactions(recordId, reactionContainer) {
    const currentUser = getCurrentUser();
    let allReactions = state.session.reactions.get(recordId);
    if (!(allReactions instanceof Map)) {
        allReactions = new Map();
    }
    const currentUserReaction = allReactions.get(currentUser.id);

    // Calculate score for this item
    const itemScore = getItemReactionScore(recordId);
    const scoreClass = itemScore > 0 ? 'positive' : itemScore < 0 ? 'negative' : 'neutral';

    // Quick reaction buttons (8 most common)
    const buttonsHTML = EMOJI_REACTIONS.map(emoji =>
        `<button class="reaction-btn ${currentUserReaction === emoji ? 'selected' : ''}" data-emoji="${emoji}" data-record-id="${recordId}">${emoji}</button>`
    ).join('');

    // More button to open full picker
    const moreButtonHTML = `<button class="reaction-btn reaction-more-btn" data-record-id="${recordId}" title="More reactions">+</button>`;

    // Summary showing who reacted
    let summaryHTML = '';
    if (allReactions.size > 0) {
        summaryHTML = Array.from(allReactions.entries()).map(([userId, reaction]) => {
            const name = state.session.userProfiles.get(userId) || 'A User';
            return `<span class="reaction-user">${name}: ${reaction}</span>`;
        }).join('');
    }

    // Score display
    const scoreHTML = `<span class="item-reaction-score ${scoreClass}" title="Reaction score">${itemScore > 0 ? '+' : ''}${itemScore.toFixed(2)}</span>`;

    reactionContainer.innerHTML = `
        <div class="reaction-bar-buttons">${buttonsHTML}${moreButtonHTML}</div>
        <div class="reaction-info-row">
            <div class="reaction-summary-display">${summaryHTML || 'No reactions yet'}</div>
            ${allReactions.size > 0 ? scoreHTML : ''}
        </div>
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

// Generate summary text for an item when collapsed in accordion
function generateItemSummary(record, itemInfo, type) {
    const name = record.fields.Name || 'Untitled Item';
    const price = getRecordPrice(record, itemInfo?.selectedOptionIndex);
    const quantity = itemInfo?.quantity || 1;
    const typeLabel = type === 'favorites' ? 'Idea' : 'Confirmed';
    const note = itemInfo?.note || '';

    // Get category/subcategory if available
    const category = record.fields.Category || '';
    const subcategory = record.fields.Subcategory || '';

    let summary = `<span class="item-summary-name">${name}</span>`;
    summary += ` &bull; <span class="item-summary-price">$${price.toFixed(2)}</span>`;

    if (quantity > 1) {
        summary += ` <span class="item-summary-qty">(×${quantity})</span>`;
    }

    summary += ` &bull; <span class="item-summary-type ${type === 'favorites' ? 'idea' : 'confirmed'}">${typeLabel}</span>`;

    // Add category hint if available
    if (category) {
        summary += ` &bull; <span class="item-summary-category">${category}</span>`;
    }

    // Show truncated note if present
    if (note) {
        const truncatedNote = note.length > 30 ? note.substring(0, 30) + '...' : note;
        summary += ` &bull; <span class="item-summary-note">"${truncatedNote}"</span>`;
    }

    return summary;
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

    // Generate summary for collapsed state
    const itemSummary = generateItemSummary(record, itemInfo, type);

    return `
        <article class="itinerary-item item-accordion expanded" data-record-id="${recordId}" data-index="${index}">
            <div class="item-accordion-header" data-record-id="${recordId}">
                <div class="item-accordion-title-row">
                    <div class="itinerary-item-number">${index + 1}</div>
                    <h3 class="item-accordion-title">${name}</h3>
                    <span class="itinerary-item-type ${typeClass}">${typeLabel}</span>
                    <span class="item-accordion-icon"></span>
                </div>
                <p class="item-accordion-summary">${itemSummary}</p>
            </div>
            <div class="item-accordion-content itinerary-item-clickable">
                <div class="itinerary-item-content">
                    ${mediaCarouselHTML}
                    <div class="itinerary-item-details">
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
            </div>
        </article>
    `;
}

async function renderAllItems() {
    const favorites = Array.from(state.cart.items.keys()).map(id => ({ recordId: id, type: 'favorites' }));
    const locked = Array.from(state.cart.lockedItems.keys()).map(id => ({ recordId: id, type: 'locked' }));
    const combinedList = [...locked, ...favorites]; // Confirmed items first, then ideas

    if (combinedList.length === 0) {
        // Show recommendations when no items exist
        // All 4 pillars are shown as suggestions since there are no items
        const allCategories = ["Activities", "Food & Drink", "Venues", "Extras"];
        let emptyStateHTML = `
            <div class="presentation-empty-state">
                <p class="itinerary-empty-title">Start Building Your Event Plan</p>
                <p class="itinerary-empty-subtitle">Add items from these categories to create your perfect event:</p>
                <div class="presentation-suggestions">
        `;

        allCategories.forEach(cat => {
            const filterTag = cat.toLowerCase().replace(/\s+/g, ' ');
            emptyStateHTML += `
                <button class="filter-btn presentation-suggestion-btn" data-category-filter="${filterTag}">
                    + Add ${cat}
                </button>
            `;
        });

        emptyStateHTML += `
                </div>
            </div>
        `;

        itineraryItemsListEl.innerHTML = emptyStateHTML;
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

    // Render the reactions summary after items
    renderReactionsSummary();
}

// Render the reactions summary section showing component rankings
function renderReactionsSummary() {
    if (!reactionsSummaryEl) {
        reactionsSummaryEl = document.getElementById('reactions-summary-container');
    }
    if (!reactionsSummaryEl) return;

    const favorites = Array.from(state.cart.items.keys()).map(id => ({ recordId: id, type: 'favorites' }));
    const locked = Array.from(state.cart.lockedItems.keys()).map(id => ({ recordId: id, type: 'locked' }));
    const combinedList = [...locked, ...favorites];

    // Calculate scores for all items
    const itemsWithScores = combinedList.map(item => {
        const record = state.records.all.find(r => r.id === item.recordId);
        const name = record?.fields.Name || 'Unknown Item';
        const reactions = state.session.reactions.get(item.recordId);
        const reactionCount = reactions instanceof Map ? reactions.size : 0;
        const score = getItemReactionScore(item.recordId);

        // Get emoji breakdown
        const emojiBreakdown = {};
        if (reactions instanceof Map) {
            reactions.forEach((emoji) => {
                emojiBreakdown[emoji] = (emojiBreakdown[emoji] || 0) + 1;
            });
        }

        return {
            recordId: item.recordId,
            type: item.type,
            name,
            score,
            reactionCount,
            emojiBreakdown
        };
    });

    // Calculate totals
    const totalScore = itemsWithScores.reduce((sum, item) => sum + item.score, 0);
    const totalReactions = itemsWithScores.reduce((sum, item) => sum + item.reactionCount, 0);
    const itemsWithReactions = itemsWithScores.filter(item => item.reactionCount > 0).length;

    // Sort by score (descending), then by reaction count
    const rankedItems = [...itemsWithScores].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.reactionCount - a.reactionCount;
    });

    // Generate ranking HTML
    let rankingHTML = '';
    if (totalReactions > 0) {
        rankingHTML = rankedItems.map((item, index) => {
            if (item.reactionCount === 0) return ''; // Skip items with no reactions

            const rank = index + 1;
            const scoreClass = item.score > 0 ? 'positive' : item.score < 0 ? 'negative' : 'neutral';
            const typeClass = item.type === 'favorites' ? 'idea' : 'confirmed';

            // Create emoji pills showing the breakdown
            const emojiPills = Object.entries(item.emojiBreakdown)
                .map(([emoji, count]) => `<span class="emoji-pill">${emoji}${count > 1 ? `<sup>${count}</sup>` : ''}</span>`)
                .join('');

            // Medal for top 3
            let medalHTML = '';
            if (rank === 1) medalHTML = '<span class="rank-medal gold">🥇</span>';
            else if (rank === 2) medalHTML = '<span class="rank-medal silver">🥈</span>';
            else if (rank === 3) medalHTML = '<span class="rank-medal bronze">🥉</span>';

            return `
                <div class="ranking-item ${scoreClass}" data-record-id="${item.recordId}">
                    <div class="ranking-position">
                        ${medalHTML}
                        <span class="ranking-number">#${rank}</span>
                    </div>
                    <div class="ranking-details">
                        <div class="ranking-name">${item.name}</div>
                        <div class="ranking-type ${typeClass}">${item.type === 'favorites' ? 'Idea' : 'Confirmed'}</div>
                    </div>
                    <div class="ranking-reactions">${emojiPills}</div>
                    <div class="ranking-score ${scoreClass}">
                        <span class="score-value">${item.score > 0 ? '+' : ''}${item.score.toFixed(2)}</span>
                        <span class="score-label">pts</span>
                    </div>
                </div>
            `;
        }).filter(html => html !== '').join('');
    }

    // Calculate sentiment analysis
    let sentimentHTML = '';
    if (totalReactions > 0) {
        const positiveItems = itemsWithScores.filter(item => item.score > 0).length;
        const negativeItems = itemsWithScores.filter(item => item.score < 0).length;
        const neutralItems = itemsWithScores.filter(item => item.score === 0 && item.reactionCount > 0).length;

        // Overall sentiment indicator
        let overallSentiment = 'neutral';
        let sentimentEmoji = '😐';
        let sentimentText = 'Mixed reactions';
        if (totalScore > 8) {
            overallSentiment = 'very-positive';
            sentimentEmoji = '🎉';
            sentimentText = 'Very enthusiastic!';
        } else if (totalScore > 3) {
            overallSentiment = 'positive';
            sentimentEmoji = '😊';
            sentimentText = 'Generally positive!';
        } else if (totalScore < -8) {
            overallSentiment = 'very-negative';
            sentimentEmoji = '😟';
            sentimentText = 'Needs attention';
        } else if (totalScore < -3) {
            overallSentiment = 'negative';
            sentimentEmoji = '😕';
            sentimentText = 'Some concerns';
        }

        sentimentHTML = `
            <div class="sentiment-analysis">
                <div class="sentiment-overall ${overallSentiment}">
                    <span class="sentiment-emoji">${sentimentEmoji}</span>
                    <span class="sentiment-text">${sentimentText}</span>
                </div>
                <div class="sentiment-breakdown">
                    <div class="sentiment-stat positive">
                        <span class="stat-icon">👍</span>
                        <span class="stat-value">${positiveItems}</span>
                        <span class="stat-label">positive</span>
                    </div>
                    <div class="sentiment-stat neutral">
                        <span class="stat-icon">🤷</span>
                        <span class="stat-value">${neutralItems}</span>
                        <span class="stat-label">neutral</span>
                    </div>
                    <div class="sentiment-stat negative">
                        <span class="stat-icon">👎</span>
                        <span class="stat-value">${negativeItems}</span>
                        <span class="stat-label">negative</span>
                    </div>
                </div>
            </div>
        `;
    }

    // No reactions state
    if (totalReactions === 0) {
        reactionsSummaryEl.innerHTML = `
            <div class="reactions-summary-empty">
                <span class="empty-icon">✨</span>
                <p>No reactions yet! React to items above to see how they rank.</p>
                <p class="empty-hint">Use emojis to express your preferences - positive reactions boost scores, negative ones lower them.</p>
            </div>
        `;
        return;
    }

    // Full summary HTML
    reactionsSummaryEl.innerHTML = `
        <div class="reactions-summary-header">
            <h3 class="reactions-summary-title">Reaction Rankings</h3>
            <div class="reactions-summary-stats">
                <span class="stat"><strong>${totalReactions}</strong> reactions</span>
                <span class="stat"><strong>${itemsWithReactions}</strong> items rated</span>
                <span class="stat total-score ${totalScore > 0 ? 'positive' : totalScore < 0 ? 'negative' : 'neutral'}">
                    <strong>${totalScore > 0 ? '+' : ''}${totalScore.toFixed(2)}</strong> total score
                </span>
            </div>
        </div>
        ${sentimentHTML}
        <div class="reactions-ranking-list">
            ${rankingHTML}
        </div>
        <div class="reactions-summary-footer">
            <p class="scoring-note">
                <span class="note-icon">ℹ️</span>
                Scores range from -4.82 to +4.92 per reaction based on sentiment analysis. Click any ranking to scroll to that item.
            </p>
        </div>
    `;

    // Add click handlers to scroll to items
    reactionsSummaryEl.querySelectorAll('.ranking-item').forEach(item => {
        item.addEventListener('click', () => {
            const recordId = item.dataset.recordId;
            const targetItem = document.querySelector(`.itinerary-item[data-record-id="${recordId}"]`);
            if (targetItem) {
                targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Brief highlight
                targetItem.classList.add('highlight');
                setTimeout(() => targetItem.classList.remove('highlight'), 2000);
            }
        });
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function addPresentationMessageToUI(sender, message, isSent, timestamp, senderId, options = {}) {
    if (!chatMessagesEl) return;

    const { messageId = null, reactions = {}, isEdited = false, isDeleted = false, replyCount = 0, parentMessageId = null, isReply = false } = options;
    const currentUser = getCurrentUser();

    // Skip deleted messages
    if (isDeleted) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'} deleted-message`;
        wrapper.innerHTML = `<div class="chat-message deleted"><em>This message was deleted</em></div>`;
        chatMessagesEl.appendChild(wrapper);
        return wrapper;
    }

    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'}${isReply ? ' is-reply' : ''}`;
    if (messageId) wrapper.dataset.messageId = messageId;

    const messageElement = document.createElement('div');
    const isFlagged = state.session.flaggedUsers.has(senderId);
    const isBanned = state.session.bannedUsers.has(senderId);
    const displayMessage = (isFlagged || isBanned) ? '[CENSORED BY MODERATOR]' : message;

    messageElement.className = 'chat-message';
    if (isBanned) messageElement.classList.add('banned');
    if (isFlagged) messageElement.classList.add('flagged');

    // Sender name
    const senderElement = document.createElement('div');
    senderElement.className = 'message-author';
    senderElement.innerText = isSent ? 'You' : sender;
    messageElement.appendChild(senderElement);

    // Message content container
    const contentElement = document.createElement('div');
    contentElement.className = 'message-content';
    contentElement.textContent = displayMessage;

    // Edited indicator
    if (isEdited) {
        const editedIndicator = document.createElement('span');
        editedIndicator.className = 'edited-indicator';
        editedIndicator.textContent = ' (edited)';
        contentElement.appendChild(editedIndicator);
    }

    messageElement.appendChild(contentElement);

    // --- Message Actions (hover menu) ---
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'message-actions';

    // Reaction button
    const reactionBtn = document.createElement('button');
    reactionBtn.className = 'msg-action-btn reaction-btn';
    reactionBtn.innerHTML = '😀';
    reactionBtn.title = 'Add reaction';
    reactionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showPresentationReactionPicker(wrapper, messageId, senderId);
    });
    actionsContainer.appendChild(reactionBtn);

    // Reply button
    const replyBtn = document.createElement('button');
    replyBtn.className = 'msg-action-btn reply-btn';
    replyBtn.innerHTML = '↩';
    replyBtn.title = 'Reply';
    replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startPresentationReply(messageId, sender, message);
    });
    actionsContainer.appendChild(replyBtn);

    // Edit button (only for own messages)
    if (isSent && messageId) {
        const editBtn = document.createElement('button');
        editBtn.className = 'msg-action-btn edit-btn';
        editBtn.innerHTML = '✏️';
        editBtn.title = 'Edit message';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startPresentationEdit(messageId, message, wrapper);
        });
        actionsContainer.appendChild(editBtn);
    }

    // Delete button (only for own messages)
    if (isSent && messageId) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'msg-action-btn delete-btn';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.title = 'Delete message';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            confirmPresentationDelete(messageId, wrapper);
        });
        actionsContainer.appendChild(deleteBtn);
    }

    // Moderation actions for owner (on others' messages)
    if (state.session.user.isOwner && !isSent) {
        const flagBtn = document.createElement('button');
        flagBtn.className = 'msg-action-btn flag-btn';
        flagBtn.innerHTML = isFlagged ? '✅' : '⚠️';
        flagBtn.title = isFlagged ? 'Un-flag user' : 'Flag user';
        flagBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isFlagged) {
                state.session.flaggedUsers.delete(senderId);
            } else {
                state.session.flaggedUsers.add(senderId);
            }
            await api.updateUserFlagStatus(senderId, !isFlagged);
            // Refresh chat to reflect changes
            await initializePresentationChat();
        });
        actionsContainer.appendChild(flagBtn);

        const banBtn = document.createElement('button');
        banBtn.className = 'msg-action-btn ban-btn';
        banBtn.innerHTML = '⛔';
        banBtn.title = 'Ban user';
        banBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await api.banUser(senderId);
        });
        actionsContainer.appendChild(banBtn);
    }

    messageElement.appendChild(actionsContainer);

    // --- Reactions Display ---
    if (reactions && Object.keys(reactions).length > 0) {
        const reactionsContainer = document.createElement('div');
        reactionsContainer.className = 'message-reactions';

        for (const [emoji, users] of Object.entries(reactions)) {
            if (users.length > 0) {
                const reactionBadge = document.createElement('button');
                reactionBadge.className = 'reaction-badge';
                const hasUserReacted = users.includes(currentUser?.id);
                if (hasUserReacted) reactionBadge.classList.add('user-reacted');
                reactionBadge.innerHTML = `${emoji} <span class="reaction-count">${users.length}</span>`;
                reactionBadge.title = users.length === 1 ? '1 reaction' : `${users.length} reactions`;
                reactionBadge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    togglePresentationReaction(messageId, emoji, !hasUserReacted, wrapper);
                });
                reactionsContainer.appendChild(reactionBadge);
            }
        }

        messageElement.appendChild(reactionsContainer);
    }

    // --- Thread indicator ---
    if (replyCount > 0) {
        const threadIndicator = document.createElement('button');
        threadIndicator.className = 'thread-indicator';
        threadIndicator.innerHTML = `↳ ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`;
        threadIndicator.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePresentationThreadView(messageId, wrapper);
        });
        messageElement.appendChild(threadIndicator);
    }

    // Timestamp
    const timestampElement = document.createElement('div');
    timestampElement.className = 'timestamp';
    const date = timestamp ? new Date(timestamp) : new Date();
    timestampElement.innerText = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    wrapper.appendChild(messageElement);
    wrapper.appendChild(timestampElement);
    chatMessagesEl.appendChild(wrapper);
    wrapper.scrollIntoView({ behavior: 'smooth' });

    return wrapper;
}

/**
 * Shows the emoji reaction picker near a message in presentation view
 */
function showPresentationReactionPicker(wrapper, messageId, senderId) {
    // Remove any existing picker
    document.querySelectorAll('.reaction-picker').forEach(p => p.remove());

    const picker = document.createElement('div');
    picker.className = 'reaction-picker';

    QUICK_REACTIONS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'reaction-picker-btn';
        btn.textContent = emoji;
        btn.addEventListener('click', async () => {
            picker.remove();
            await togglePresentationReaction(messageId, emoji, true, wrapper);
        });
        picker.appendChild(btn);
    });

    wrapper.appendChild(picker);

    // Close picker when clicking elsewhere
    const closePicker = (e) => {
        if (!picker.contains(e.target)) {
            picker.remove();
            document.removeEventListener('click', closePicker);
        }
    };
    setTimeout(() => document.addEventListener('click', closePicker), 0);
}

/**
 * Toggles a reaction on a message in presentation view
 */
async function togglePresentationReaction(messageId, emoji, add, wrapper) {
    const currentUser = getCurrentUser();
    if (!messageId || !currentUser) return;

    const result = await api.toggleMessageReaction(messageId, currentUser.id, emoji, add);
    if (result !== null) {
        // Update the reactions display
        updatePresentationReactionsDisplay(wrapper, result);

        // Broadcast via Pusher if available
        if (presentationChatChannel) {
            presentationChatChannel.trigger('client-reaction-update', {
                messageId,
                reactions: result,
                userId: currentUser.id
            });
        }
    }
}

/**
 * Updates the reactions display on a message wrapper in presentation view
 */
function updatePresentationReactionsDisplay(wrapper, reactions) {
    const messageElement = wrapper.querySelector('.chat-message');
    if (!messageElement) return;

    const currentUser = getCurrentUser();

    // Remove existing reactions container
    const existingReactions = messageElement.querySelector('.message-reactions');
    if (existingReactions) existingReactions.remove();

    // Add new reactions if any exist
    if (reactions && Object.keys(reactions).length > 0) {
        const reactionsContainer = document.createElement('div');
        reactionsContainer.className = 'message-reactions';

        for (const [emoji, users] of Object.entries(reactions)) {
            if (users.length > 0) {
                const reactionBadge = document.createElement('button');
                reactionBadge.className = 'reaction-badge';
                const hasUserReacted = users.includes(currentUser?.id);
                if (hasUserReacted) reactionBadge.classList.add('user-reacted');
                reactionBadge.innerHTML = `${emoji} <span class="reaction-count">${users.length}</span>`;
                const messageId = wrapper.dataset.messageId;
                reactionBadge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    togglePresentationReaction(messageId, emoji, !hasUserReacted, wrapper);
                });
                reactionsContainer.appendChild(reactionBadge);
            }
        }

        // Insert before thread indicator or at end
        const threadIndicator = messageElement.querySelector('.thread-indicator');
        if (threadIndicator) {
            messageElement.insertBefore(reactionsContainer, threadIndicator);
        } else {
            messageElement.appendChild(reactionsContainer);
        }
    }
}

/**
 * Starts replying to a message in presentation view
 */
function startPresentationReply(messageId, senderName, messagePreview) {
    presentationReplyingToMessage = { id: messageId, sender: senderName, preview: messagePreview };

    // Show reply indicator in the input area
    const formContainer = presentationMessageForm;
    if (!formContainer || !formContainer.parentElement) return;

    // Remove existing reply indicator
    const existingIndicator = formContainer.parentElement.querySelector('.reply-indicator');
    if (existingIndicator) existingIndicator.remove();

    const replyIndicator = document.createElement('div');
    replyIndicator.className = 'reply-indicator';
    replyIndicator.innerHTML = `
        <span class="reply-indicator-text">Replying to <strong>${escapeHtml(senderName)}</strong>: ${escapeHtml(messagePreview.substring(0, 50))}${messagePreview.length > 50 ? '...' : ''}</span>
        <button class="cancel-reply-btn" type="button">✕</button>
    `;

    replyIndicator.querySelector('.cancel-reply-btn').addEventListener('click', cancelPresentationReply);
    formContainer.parentElement.insertBefore(replyIndicator, formContainer);

    // Focus the input
    if (presentationMessageInput) presentationMessageInput.focus();
}

/**
 * Cancels the current reply in presentation view
 */
function cancelPresentationReply() {
    presentationReplyingToMessage = null;
    const formContainer = presentationMessageForm;
    if (formContainer && formContainer.parentElement) {
        const indicator = formContainer.parentElement.querySelector('.reply-indicator');
        if (indicator) indicator.remove();
    }
}

/**
 * Starts editing a message in presentation view
 */
function startPresentationEdit(messageId, currentContent, wrapper) {
    presentationEditingMessage = { id: messageId, originalContent: currentContent };

    const contentElement = wrapper.querySelector('.message-content');
    if (!contentElement) return;

    // Replace content with input
    const originalText = currentContent;
    contentElement.innerHTML = `
        <input type="text" class="edit-message-input" value="${escapeHtml(originalText)}">
        <div class="edit-actions">
            <button class="save-edit-btn" type="button">Save</button>
            <button class="cancel-edit-btn" type="button">Cancel</button>
        </div>
    `;

    const input = contentElement.querySelector('.edit-message-input');
    const saveBtn = contentElement.querySelector('.save-edit-btn');
    const cancelBtn = contentElement.querySelector('.cancel-edit-btn');
    const currentUser = getCurrentUser();

    input.focus();
    input.select();

    const saveEdit = async () => {
        const newContent = input.value.trim();
        if (newContent && newContent !== originalText) {
            const result = await api.updateChatMessage(messageId, newContent, currentUser.id);
            if (result) {
                contentElement.innerHTML = '';
                contentElement.textContent = newContent;
                const editedIndicator = document.createElement('span');
                editedIndicator.className = 'edited-indicator';
                editedIndicator.textContent = ' (edited)';
                contentElement.appendChild(editedIndicator);

                // Broadcast edit via Pusher
                if (presentationChatChannel) {
                    presentationChatChannel.trigger('client-message-edited', {
                        messageId,
                        newContent,
                        userId: currentUser.id
                    });
                }
            }
        } else {
            cancelEditMode();
        }
        presentationEditingMessage = null;
    };

    const cancelEditMode = () => {
        contentElement.innerHTML = '';
        contentElement.textContent = originalText;
        presentationEditingMessage = null;
    };

    saveBtn.addEventListener('click', saveEdit);
    cancelBtn.addEventListener('click', cancelEditMode);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') cancelEditMode();
    });
}

/**
 * Confirms and deletes a message in presentation view
 */
async function confirmPresentationDelete(messageId, wrapper) {
    if (!confirm('Delete this message? This cannot be undone.')) return;

    const currentUser = getCurrentUser();
    const result = await api.deleteChatMessage(messageId, currentUser.id);
    if (result) {
        wrapper.classList.add('deleted-message');
        wrapper.innerHTML = `<div class="chat-message deleted"><em>This message was deleted</em></div>`;

        // Broadcast delete via Pusher
        if (presentationChatChannel) {
            presentationChatChannel.trigger('client-message-deleted', {
                messageId,
                userId: currentUser.id
            });
        }
    }
}

/**
 * Toggles the thread view for a message in presentation view
 */
async function togglePresentationThreadView(messageId, wrapper) {
    const existingThread = wrapper.querySelector('.thread-replies');
    if (existingThread) {
        existingThread.remove();
        return;
    }

    const currentUser = getCurrentUser();
    const replies = await api.fetchMessageReplies(messageId);
    if (replies.length === 0) return;

    const threadContainer = document.createElement('div');
    threadContainer.className = 'thread-replies';

    replies.forEach(reply => {
        const { SenderID, SenderName, Content, Timestamp, IsEdited, IsDeleted, Reactions } = reply.fields;
        const isSent = SenderID === currentUser?.id;
        let parsedReactions = {};
        if (Reactions) {
            try { parsedReactions = JSON.parse(Reactions); } catch (e) {}
        }

        const replyWrapper = document.createElement('div');
        replyWrapper.className = `reply-message ${isSent ? 'sent' : 'received'}`;
        replyWrapper.dataset.messageId = reply.id;

        if (IsDeleted) {
            replyWrapper.innerHTML = `<em class="deleted-reply">This reply was deleted</em>`;
        } else {
            replyWrapper.innerHTML = `
                <span class="reply-sender">${isSent ? 'You' : escapeHtml(SenderName)}</span>
                <span class="reply-content">${escapeHtml(Content)}${IsEdited ? ' <em class="edited-indicator">(edited)</em>' : ''}</span>
                <span class="reply-time">${new Date(Timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            `;
        }

        threadContainer.appendChild(replyWrapper);
    });

    wrapper.appendChild(threadContainer);
}

function updatePresentationPresenceUI(members) {
    const count = members.count;
    if (presentationWhosHereCount) presentationWhosHereCount.innerText = count;

    if (presentationWhosHereList) {
        presentationWhosHereList.innerHTML = '';
        members.each((member) => {
            const currentUser = getCurrentUser();
            const profileId = state.session.user.isAuthenticated ? state.session.user.id : member.id;
            const profileName = state.session.user.isAuthenticated ? state.session.user.name : member.info.name;

            if (!state.session.userProfiles.has(profileId)) {
                state.session.userProfiles.set(profileId, profileName);
                triggerSave();
            }

            const userElement = document.createElement('div');
            userElement.className = 'presentation-presence-item';
            const displayName = member.id === currentUser.id ? currentUser.name : member.info.name;
            userElement.innerHTML = `<span class="presence-dot"></span>${displayName}${member.id === currentUser.id ? ' (You)' : ''}`;
            presentationWhosHereList.appendChild(userElement);
        });
    }
}

async function initializePresentationChat() {
    const currentUser = getCurrentUser();
    const sessionId = state.session.id || 'default-session';

    // Set up user name input
    if (presentationUserNameInput) {
        presentationUserNameInput.value = currentUser.name;
        presentationUserNameInput.addEventListener('change', (e) => {
            const newName = e.target.value.trim();
            if (newName && newName !== currentUser.name) {
                currentUser.name = newName;
                localStorage.setItem('chatUserName', newName);
                state.session.userProfiles.set(currentUser.id, newName);
                log('Presentation', `User name changed to: ${newName}`);
                if (presentationChatChannel && presentationChatChannel.members) {
                    updatePresentationPresenceUI(presentationChatChannel.members);
                }
                triggerSave();
            } else {
                e.target.value = currentUser.name;
            }
        });
    }

    // Load existing chat messages with enhanced data
    chatMessagesEl.innerHTML = '';
    try {
        const records = await api.fetchChatMessages(sessionId);

        // Count replies per message for thread indicators
        const replyCountMap = {};
        records.forEach(record => {
            const parentId = record.fields.ParentMessageID;
            if (parentId) {
                replyCountMap[parentId] = (replyCountMap[parentId] || 0) + 1;
            }
        });

        if (records.length > 0) {
            records.forEach(record => {
                const { SenderID, SenderName, Content, Timestamp, EventType, Reactions, IsEdited, IsDeleted, ParentMessageID } = record.fields;

                // Skip reply messages (they're shown in threads) and system events
                if (ParentMessageID) return;
                if (SenderID === 'system' && EventType) return;

                const isSent = SenderID === currentUser.id;
                let parsedReactions = {};
                if (Reactions) {
                    try { parsedReactions = JSON.parse(Reactions); } catch (e) {}
                }

                addPresentationMessageToUI(SenderName, Content, isSent, Timestamp, SenderID, {
                    messageId: record.id,
                    reactions: parsedReactions,
                    isEdited: IsEdited || false,
                    isDeleted: IsDeleted || false,
                    replyCount: replyCountMap[record.id] || 0
                });
            });
        } else {
            chatMessagesEl.innerHTML = '<p class="chat-empty">No messages yet. Start the conversation!</p>';
        }
    } catch (err) {
        log('Presentation', `Failed to load chat messages: ${err.message}`);
        chatMessagesEl.innerHTML = '<p class="chat-empty">Unable to load messages.</p>';
    }

    // Wait for Pusher library to be loaded
    if (typeof window.waitForPusher === 'function') {
        try {
            await window.waitForPusher();
        } catch (err) {
            if (presentationMessageInput) {
                presentationMessageInput.placeholder = 'Chat unavailable - please refresh';
                presentationMessageInput.disabled = true;
            }
            return;
        }
    } else if (typeof Pusher === 'undefined') {
        if (presentationMessageInput) {
            presentationMessageInput.placeholder = 'Chat unavailable - please refresh';
            presentationMessageInput.disabled = true;
        }
        return;
    }

    // Disconnect existing connection if any
    if (presentationPusher) {
        presentationPusher.disconnect();
    }

    // Initialize Pusher for real-time chat
    presentationPusher = new Pusher('236f480714e5001590b5', {
        cluster: 'us3',
        authEndpoint: '/api/pusher-auth',
        auth: {
            params: {
                user_id: currentUser.id,
                user_name: currentUser.name
            }
        }
    });

    const channelName = `presence-session-${sessionId}`;
    presentationChatChannel = presentationPusher.subscribe(channelName);

    // Bind presence events
    presentationChatChannel.bind('pusher:subscription_succeeded', (members) => {
        if (presentationMessageInput) {
            presentationMessageInput.disabled = false;
            presentationMessageInput.placeholder = 'Type a message...';
        }
        updatePresentationPresenceUI(members);
    });

    presentationChatChannel.bind('pusher:member_added', () => {
        updatePresentationPresenceUI(presentationChatChannel.members);
    });

    presentationChatChannel.bind('pusher:member_removed', () => {
        updatePresentationPresenceUI(presentationChatChannel.members);
    });

    // Bind to receive new messages
    presentationChatChannel.bind('client-new-message', (data) => {
        if (data.senderId !== currentUser.id) {
            // Remove empty state message if present
            const emptyMsg = chatMessagesEl.querySelector('.chat-empty');
            if (emptyMsg) emptyMsg.remove();

            addPresentationMessageToUI(data.senderName, data.content, false, data.timestamp, data.senderId, {
                messageId: data.messageId
            });
        }
    });

    // Handle real-time reaction updates from other users
    presentationChatChannel.bind('client-reaction-update', (data) => {
        if (data.userId !== currentUser.id) {
            const wrapper = chatMessagesEl.querySelector(`[data-message-id="${data.messageId}"]`);
            if (wrapper) {
                updatePresentationReactionsDisplay(wrapper, data.reactions);
            }
        }
    });

    // Handle real-time message edits from other users
    presentationChatChannel.bind('client-message-edited', (data) => {
        if (data.userId !== currentUser.id) {
            const wrapper = chatMessagesEl.querySelector(`[data-message-id="${data.messageId}"]`);
            if (wrapper) {
                const contentElement = wrapper.querySelector('.message-content');
                if (contentElement) {
                    contentElement.textContent = data.newContent;
                    if (!contentElement.querySelector('.edited-indicator')) {
                        const editedIndicator = document.createElement('span');
                        editedIndicator.className = 'edited-indicator';
                        editedIndicator.textContent = ' (edited)';
                        contentElement.appendChild(editedIndicator);
                    }
                }
            }
        }
    });

    // Handle real-time message deletes from other users
    presentationChatChannel.bind('client-message-deleted', (data) => {
        if (data.userId !== currentUser.id) {
            const wrapper = chatMessagesEl.querySelector(`[data-message-id="${data.messageId}"]`);
            if (wrapper) {
                wrapper.classList.add('deleted-message');
                wrapper.innerHTML = `<div class="chat-message deleted"><em>This message was deleted</em></div>`;
            }
        }
    });

    // Handle real-time replies from other users
    presentationChatChannel.bind('client-new-reply', (data) => {
        if (data.senderId !== currentUser.id) {
            const parentWrapper = chatMessagesEl.querySelector(`[data-message-id="${data.parentMessageId}"]`);
            if (parentWrapper) {
                const existingIndicator = parentWrapper.querySelector('.thread-indicator');
                if (existingIndicator) {
                    const currentCount = parseInt(existingIndicator.textContent.match(/\d+/)?.[0] || '0');
                    existingIndicator.innerHTML = `↳ ${currentCount + 1} ${currentCount + 1 === 1 ? 'reply' : 'replies'}`;
                } else {
                    const threadIndicator = document.createElement('button');
                    threadIndicator.className = 'thread-indicator';
                    threadIndicator.innerHTML = `↳ 1 reply`;
                    threadIndicator.addEventListener('click', (e) => {
                        e.stopPropagation();
                        togglePresentationThreadView(data.parentMessageId, parentWrapper);
                    });
                    parentWrapper.querySelector('.chat-message')?.appendChild(threadIndicator);
                }
            }
        }
    });

    // Set up message form submission
    if (presentationMessageForm) {
        const newForm = presentationMessageForm.cloneNode(true);
        presentationMessageForm.parentNode.replaceChild(newForm, presentationMessageForm);
        presentationMessageForm = newForm;

        const newInput = document.getElementById('presentation-message-input');
        presentationMessageInput = newInput;

        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const message = presentationMessageInput.value.trim();
            if (!message) return;

            // Remove empty state message if present
            const emptyMsg = chatMessagesEl.querySelector('.chat-empty');
            if (emptyMsg) emptyMsg.remove();

            const timestamp = new Date().toISOString();

            // Check if this is a reply
            if (presentationReplyingToMessage) {
                const result = await api.postReplyMessage(presentationReplyingToMessage.id, sessionId, null, currentUser.id, currentUser.name, message);
                if (result) {
                    // Update the parent message's reply count in UI
                    const parentWrapper = chatMessagesEl.querySelector(`[data-message-id="${presentationReplyingToMessage.id}"]`);
                    if (parentWrapper) {
                        const existingIndicator = parentWrapper.querySelector('.thread-indicator');
                        if (existingIndicator) {
                            const currentCount = parseInt(existingIndicator.textContent.match(/\d+/)?.[0] || '0');
                            existingIndicator.innerHTML = `↳ ${currentCount + 1} ${currentCount + 1 === 1 ? 'reply' : 'replies'}`;
                        } else {
                            const threadIndicator = document.createElement('button');
                            threadIndicator.className = 'thread-indicator';
                            threadIndicator.innerHTML = `↳ 1 reply`;
                            threadIndicator.addEventListener('click', (e) => {
                                e.stopPropagation();
                                togglePresentationThreadView(presentationReplyingToMessage.id, parentWrapper);
                            });
                            parentWrapper.querySelector('.chat-message')?.appendChild(threadIndicator);
                        }
                    }
                    presentationChatChannel.trigger('client-new-reply', {
                        parentMessageId: presentationReplyingToMessage.id,
                        content: message,
                        senderId: currentUser.id,
                        senderName: currentUser.name,
                        timestamp: timestamp
                    });
                }
                cancelPresentationReply();
            } else {
                // Regular message (not a reply)
                addPresentationMessageToUI(currentUser.name, message, true, timestamp, currentUser.id);

                // Send via API and broadcast
                try {
                    await api.postChatMessage(sessionId, currentUser.id, currentUser.name, message);
                    presentationChatChannel.trigger('client-new-message', {
                        content: message,
                        senderId: currentUser.id,
                        senderName: currentUser.name,
                        timestamp: timestamp
                    });
                } catch (err) {
                    log('Presentation', `Failed to send message: ${err.message}`);
                }
            }

            // Clear input
            presentationMessageInput.value = '';
        });
    }

    log('Presentation', 'Embedded chat initialized with enhanced features');
}

function cleanupPresentationChat() {
    // Disconnect Pusher when leaving presentation view
    if (presentationChatChannel) {
        presentationChatChannel.unbind_all();
    }
    if (presentationPusher) {
        presentationPusher.disconnect();
        presentationPusher = null;
        presentationChatChannel = null;
    }
    // Clear reply state
    presentationReplyingToMessage = null;
    presentationEditingMessage = null;
}

// Scroll handler reference for cleanup
let floatingChatScrollHandler = null;

/**
 * Initializes the floating chat button for the presentation view
 * Shows/hides based on scroll position and handles jump to chat functionality
 */
function initializeFloatingChatButton() {
    if (!floatingChatBtn || !modal) return;

    const presentationContent = modal.querySelector('.presentation-content');
    const chatSection = modal.querySelector('.itinerary-chat');

    if (!presentationContent || !chatSection) return;

    // Function to check if chat section is visible in viewport
    const isChatInView = () => {
        const chatRect = chatSection.getBoundingClientRect();
        const modalRect = modal.getBoundingClientRect();
        // Chat is "in view" if its top is visible within the modal
        return chatRect.top < modalRect.bottom - 100 && chatRect.bottom > modalRect.top;
    };

    // Scroll handler
    floatingChatScrollHandler = () => {
        const chatVisible = isChatInView();

        // Toggle scrolled-to-chat class for icon rotation
        if (chatVisible) {
            floatingChatBtn.classList.add('scrolled-to-chat');
            floatingChatBtn.title = 'Back to top';
        } else {
            floatingChatBtn.classList.remove('scrolled-to-chat');
            floatingChatBtn.title = 'Jump to Chat';
        }
    };

    // Add scroll listener to modal (presentation content scrolls within it)
    presentationContent.addEventListener('scroll', floatingChatScrollHandler);

    // Click handler for the floating button
    const clickHandler = () => {
        const chatVisible = isChatInView();

        if (chatVisible) {
            // If viewing chat, scroll back to top or saved position
            if (savedScrollPosition !== null) {
                presentationContent.scrollTo({ top: savedScrollPosition, behavior: 'smooth' });
                savedScrollPosition = null;
            } else {
                presentationContent.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } else {
            // Save current position and scroll to chat
            savedScrollPosition = presentationContent.scrollTop;
            chatSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

            // Also expand the chat accordion if it's collapsed
            if (!accordionState.chat) {
                const chatHeader = chatSection.querySelector('.itinerary-accordion-header');
                if (chatHeader) chatHeader.click();
            }

            // Focus the input after scrolling
            setTimeout(() => {
                if (presentationMessageInput) presentationMessageInput.focus();
            }, 500);
        }
    };

    // Store handler for cleanup
    floatingChatBtn._clickHandler = clickHandler;
    floatingChatBtn.addEventListener('click', clickHandler);

    // Show the button
    floatingChatBtn.classList.add('visible');

    // Initial check
    floatingChatScrollHandler();

    log('Presentation', 'Floating chat button initialized');
}

/**
 * Cleans up the floating chat button event listeners
 */
function cleanupFloatingChatButton() {
    if (floatingChatBtn) {
        floatingChatBtn.classList.remove('visible', 'scrolled-to-chat');

        if (floatingChatBtn._clickHandler) {
            floatingChatBtn.removeEventListener('click', floatingChatBtn._clickHandler);
            floatingChatBtn._clickHandler = null;
        }
    }

    if (floatingChatScrollHandler && modal) {
        const presentationContent = modal.querySelector('.presentation-content');
        if (presentationContent) {
            presentationContent.removeEventListener('scroll', floatingChatScrollHandler);
        }
        floatingChatScrollHandler = null;
    }

    savedScrollPosition = null;
    log('Presentation', 'Floating chat button cleaned up');
}

function renderChatMessages() {
    // Legacy function - now handled by initializePresentationChat
    // Kept for compatibility but no longer clones messages
    if (!chatMessagesEl) return;
    chatMessagesEl.innerHTML = '<p class="chat-empty">Loading chat...</p>';
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
    // Use the embedded presentation chat messages, not the sidebar chat
    if (!chatMessagesEl) {
        if (chatSummaryEl) {
            chatSummaryEl.textContent = 'No discussion yet';
        }
        return;
    }

    const messages = chatMessagesEl.querySelectorAll('.message-wrapper');
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
    console.log('[Accordion DEBUG] toggleAccordion called with section:', section);
    console.log('[Accordion DEBUG] modal element:', modal);

    const sectionEl = modal.querySelector(`.itinerary-accordion[data-section="${section}"]`);
    console.log('[Accordion DEBUG] Found section element:', sectionEl);

    if (!sectionEl) {
        console.warn('[Accordion DEBUG] Section element not found for:', section);
        return;
    }

    accordionState[section] = !accordionState[section];
    console.log('[Accordion DEBUG] New state for', section, ':', accordionState[section]);

    if (accordionState[section]) {
        sectionEl.classList.add('expanded');
        console.log('[Accordion DEBUG] Added expanded class to', section);
    } else {
        sectionEl.classList.remove('expanded');
        console.log('[Accordion DEBUG] Removed expanded class from', section);
    }

    console.log('[Accordion DEBUG] Section classList after toggle:', sectionEl.classList.toString());

    log('Presentation', `Accordion ${section} ${accordionState[section] ? 'expanded' : 'collapsed'}`);
}

// Toggle individual item accordion
function toggleItemAccordion(itemElement) {
    if (!itemElement) return;

    const isExpanded = itemElement.classList.contains('expanded');

    if (isExpanded) {
        itemElement.classList.remove('expanded');
    } else {
        itemElement.classList.add('expanded');
    }

    log('Presentation', `Item accordion ${isExpanded ? 'collapsed' : 'expanded'} for record ${itemElement.dataset.recordId}`);
}

// Handle item accordion header clicks
function handleItemAccordionClick(e) {
    // Check if clicking on the item accordion header specifically
    const itemAccordionHeader = e.target.closest('.item-accordion-header');
    if (!itemAccordionHeader) return;

    // Don't trigger accordion on interactive elements (buttons, links, etc.)
    if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.reaction-btn')) {
        return;
    }

    const itemElement = itemAccordionHeader.closest('.item-accordion');
    if (itemElement) {
        e.stopPropagation(); // Prevent triggering parent click handlers
        toggleItemAccordion(itemElement);
    }
}

// Initialize accordion states and update UI
function initializeAccordions() {
    console.log('[Accordion DEBUG] initializeAccordions called');
    console.log('[Accordion DEBUG] modal element:', modal);

    // Set all sections to expanded state initially
    Object.keys(accordionState).forEach(section => {
        accordionState[section] = true;
        const sectionEl = modal.querySelector(`.itinerary-accordion[data-section="${section}"]`);
        console.log(`[Accordion DEBUG] Initializing section "${section}":`, sectionEl);
        if (sectionEl) {
            sectionEl.classList.add('expanded');
            console.log(`[Accordion DEBUG] Section "${section}" classList after init:`, sectionEl.classList.toString());
        } else {
            console.warn(`[Accordion DEBUG] Section element not found for "${section}" during init`);
        }
    });

    // Generate all summaries
    generateHeaderSummary();
    generateItemsSummary();
    generateChatSummary();

    console.log('[Accordion DEBUG] initializeAccordions completed');
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

    const recordId = button.dataset.recordId;

    // Check if this is the "more" button to open expanded picker
    if (button.classList.contains('reaction-more-btn')) {
        showExpandedEmojiPicker(recordId, button);
        return;
    }

    const emoji = button.dataset.emoji;
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

    // Update the reactions summary
    renderReactionsSummary();

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

// Handle clicks on suggestion buttons (empty state recommendations)
function handleSuggestionClick(e) {
    const suggestionBtn = e.target.closest('.presentation-suggestion-btn');
    if (!suggestionBtn) return;

    e.stopPropagation();
    const categoryToFilter = suggestionBtn.dataset.categoryFilter;
    if (!categoryToFilter) return;

    const normalizedCategory = categoryToFilter.toLowerCase().replace(/\s+/g, ' ');

    log('Presentation', `Suggestion clicked. Filtering for: ${categoryToFilter}`);

    // Close the presentation view and navigate to the filtered catalog
    hidePresentationView();
    updateUrl({ category: normalizedCategory, subcategory: null, view: null });

    // Trigger filter update via the global function
    if (typeof window.applyFiltersAndSort === 'function') {
        setTimeout(() => {
            window.applyFiltersAndSort(window.imageCache);
            document.getElementById('catalog-area')?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    }
}

function handleKeyDown(e) {
    if (e.key === 'Escape') {
        updateUrl({ view: null });
        hidePresentationView();
    }
}

export async function showPresentationView(listType, startRecordId = null) {
    log('Presentation', `Showing itinerary presentation`);
    console.log('[Accordion DEBUG] showPresentationView called');

    if (!ensureDOMElements()) {
        console.error('[Presentation] Cannot show presentation view - DOM elements not available');
        console.error('[Accordion DEBUG] ensureDOMElements failed');
        return;
    }
    console.log('[Accordion DEBUG] ensureDOMElements succeeded');

    // Mark that catalog will need rendering when exiting presentation view
    // (since we skip catalog rendering while in presentation view)
    catalogNeedsRender = true;

    // Clear image cache for fresh load
    itemImagesCache.clear();

    // Render presentation header (copies logo and title from main header)
    renderPresentationHeader();

    // Render all sections
    renderEventHeader();
    renderCollaborators();
    await renderAllItems();
    renderChatMessages(); // Sets loading state

    // Initialize accordions and generate summaries (chat summary will be updated after chat loads)
    initializeAccordions();

    // Show modal
    modal.classList.add('active');
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', handleKeyDown);

    // Start the background animation
    startPresentationBackgroundAnimation();

    // Initialize the embedded chat (loads messages and sets up real-time connection)
    await initializePresentationChat();

    // Update chat summary after messages are loaded
    generateChatSummary();

    // Initialize the floating chat button
    initializeFloatingChatButton();

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

    // Stop the background animation
    stopPresentationBackgroundAnimation();

    // Clean up the presentation chat connection
    cleanupPresentationChat();

    // Clean up the floating chat button
    cleanupFloatingChatButton();

    modal.classList.remove('active');
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', handleKeyDown);

    // If catalog rendering was skipped when entering presentation view,
    // trigger it now via the global applyFiltersAndSort function
    if (catalogNeedsRender && typeof window.applyFiltersAndSort === 'function') {
        log('Presentation', 'Triggering catalog render after exiting presentation view');
        // Small delay to ensure URL is updated first
        setTimeout(() => {
            window.applyFiltersAndSort(window.imageCache);
        }, 50);
        catalogNeedsRender = false;
    }
}

export function setupPresentationEventListeners() {
    console.log('[Accordion DEBUG] setupPresentationEventListeners called');
    if (!ensureDOMElements()) {
        console.error('[Presentation] Cannot setup event listeners - DOM elements not available');
        console.error('[Accordion DEBUG] ensureDOMElements failed in setupPresentationEventListeners');
        return;
    }
    console.log('[Accordion DEBUG] ensureDOMElements succeeded in setupPresentationEventListeners');

    // Handle window resize for background canvas
    window.addEventListener('resize', () => {
        if (modal && modal.classList.contains('active')) {
            resizePresentationBackground();
        }
    });

    closeBtn.addEventListener('click', () => {
        updateUrl({ view: null });
        hidePresentationView();
    });

    // Presentation header hamburger button (opens WTF Plans panel)
    if (presentationBackBtn) {
        presentationBackBtn.addEventListener('click', () => {
            updateUrl({ view: null });
            hidePresentationView();
            // Open WTF Plans panel after closing presentation view
            showWtfPlansPanel();
        });
    }

    // Presentation header share button
    if (presentationHeaderShareBtn) {
        presentationHeaderShareBtn.addEventListener('click', () => {
            const baseURL = window.location.origin + window.location.pathname;
            const sessionID = state.session.id;
            const shareURL = `${baseURL}?session=${sessionID}&view=present`;

            navigator.clipboard.writeText(shareURL).then(() => {
                const originalHTML = presentationHeaderShareBtn.innerHTML;
                presentationHeaderShareBtn.innerHTML = '<span class="share-icon">✓</span>';
                presentationHeaderShareBtn.title = 'Link Copied!';
                setTimeout(() => {
                    presentationHeaderShareBtn.innerHTML = originalHTML;
                    presentationHeaderShareBtn.title = 'Share this plan';
                }, 1500);
            });
        });
    }

    // Handle accordion header clicks
    const scrollContainer = modal.querySelector('.presentation-itinerary-scroll');
    console.log('[Accordion DEBUG] setupPresentationEventListeners - scrollContainer:', scrollContainer);

    if (scrollContainer) {
        // Debug: Log all accordion headers found
        const accordionHeaders = scrollContainer.querySelectorAll('.itinerary-accordion-header');
        console.log('[Accordion DEBUG] Found accordion headers:', accordionHeaders.length);
        accordionHeaders.forEach((header, index) => {
            console.log(`[Accordion DEBUG] Header ${index}:`, header, 'data-section:', header.dataset.section);
        });

        scrollContainer.addEventListener('click', (e) => {
            console.log('[Accordion DEBUG] Click event on scrollContainer');
            console.log('[Accordion DEBUG] Click target:', e.target);
            console.log('[Accordion DEBUG] Target tagName:', e.target.tagName);
            console.log('[Accordion DEBUG] Target classList:', e.target.classList.toString());

            const accordionHeader = e.target.closest('.itinerary-accordion-header');
            console.log('[Accordion DEBUG] Closest .itinerary-accordion-header:', accordionHeader);

            if (!accordionHeader) {
                console.log('[Accordion DEBUG] No accordion header found - ignoring click');
                return;
            }

            // Don't trigger accordion on interactive elements inside
            if (e.target.closest('button') || e.target.closest('a')) {
                console.log('[Accordion DEBUG] Clicked on button/link inside header - ignoring');
                return;
            }

            const section = accordionHeader.dataset.section;
            console.log('[Accordion DEBUG] Section from data-section attribute:', section);

            if (section) {
                console.log('[Accordion DEBUG] Calling toggleAccordion for section:', section);
                toggleAccordion(section);
            } else {
                console.warn('[Accordion DEBUG] No section data attribute found on header');
            }
        });
        console.log('[Accordion DEBUG] Click listener added to scrollContainer');
    } else {
        console.error('[Accordion DEBUG] scrollContainer not found!');
    }

    // Handle thumbnail clicks for image carousel
    itineraryItemsListEl.addEventListener('click', handleThumbnailClick);

    // Handle reaction clicks
    itineraryItemsListEl.addEventListener('click', handleReactionClick);

    // Handle item accordion header clicks (for per-item collapse/expand)
    itineraryItemsListEl.addEventListener('click', handleItemAccordionClick);

    // Handle item clicks to open detail modal
    itineraryItemsListEl.addEventListener('click', handleItemClick);

    // Handle suggestion button clicks (for empty state recommendations)
    itineraryItemsListEl.addEventListener('click', handleSuggestionClick);

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
