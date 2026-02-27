/**
 * collabView.js — Standalone Collaborator View
 *
 * Built entirely on V1 infrastructure:
 * - state.js for state management
 * - api.js for Airtable session/item/image loading
 * - config.js for constants and emoji reactions
 * - utils.js for price helpers
 *
 * Loads a session by ?session=ID, displays all plan items
 * in a scrollable card feed with reactions and sharing.
 */

console.log('[collabView] 0. collabView.js file execution started.');

import { state, setState } from '../state.js';
console.log('[collabView] 1. Imported state.js successfully. state.session.id =', state.session.id);

import * as api from '../api.js';
console.log('[collabView] 2. Imported api.js successfully. Available exports:', Object.keys(api));

import { CONSTANTS, EMOJI_REACTIONS, REACTION_SCORES, CLOUDINARY_CLOUD_NAME } from '../config.js';
console.log('[collabView] 3. Imported config.js successfully. CLOUDINARY_CLOUD_NAME =', CLOUDINARY_CLOUD_NAME, 'EMOJI_REACTIONS count =', EMOJI_REACTIONS.length);

import { getRecordPrice, parseOptions } from '../utils.js';
console.log('[collabView] 4. Imported utils.js successfully. getRecordPrice type =', typeof getRecordPrice, 'parseOptions type =', typeof parseOptions);

import { log, injectDebugPanel } from '../utils/debug.js';
console.log('[collabView] 5. Imported debug.js successfully. injectDebugPanel type =', typeof injectDebugPanel);

// --- DOM References ---
console.log('[collabView] 6. Acquiring DOM references...');
const loadingEl = document.getElementById('collab-loading');
const rootEl = document.getElementById('collab-root');
const feedEl = document.getElementById('collab-feed');
const emptyEl = document.getElementById('collab-empty');
const eventNameEl = document.getElementById('collab-event-name');
const eventDateEl = document.getElementById('collab-event-date');
const eventGoalsEl = document.getElementById('collab-event-goals');
const shareBtn = document.getElementById('collab-share-btn');
const backLink = document.getElementById('collab-back-link');
const tabContainer = document.getElementById('collab-tabs');
const planSummaryEl = document.getElementById('collab-plan-summary');
const reactionOverviewEl = document.getElementById('collab-reaction-overview');
const costSummaryEl = document.getElementById('collab-cost-summary');
const tabCountLocked = document.getElementById('tab-count-locked');
const tabCountIdeas = document.getElementById('tab-count-ideas');

// Detail overlay
const detailOverlay = document.getElementById('collab-detail-overlay');
const detailCloseBtn = document.getElementById('collab-detail-close');
const detailMainImage = document.getElementById('collab-detail-main-image');
const detailThumbnails = document.getElementById('collab-detail-thumbnails');
const detailName = document.getElementById('collab-detail-name');
const detailPrice = document.getElementById('collab-detail-price');
const detailDescription = document.getElementById('collab-detail-description');
const detailNote = document.getElementById('collab-detail-note');
const detailNoteText = document.getElementById('collab-detail-note-text');
const detailReactionButtons = document.getElementById('collab-detail-reaction-buttons');
const detailReactionSummary = document.getElementById('collab-detail-reaction-summary');

const toastEl = document.getElementById('collab-toast');

// Verify all critical DOM elements
const domChecks = {
    loadingEl, rootEl, feedEl, emptyEl, eventNameEl, eventDateEl,
    eventGoalsEl, shareBtn, backLink, tabContainer, planSummaryEl,
    reactionOverviewEl, costSummaryEl, tabCountLocked, tabCountIdeas,
    detailOverlay, detailCloseBtn, detailMainImage, detailThumbnails,
    detailName, detailPrice, detailDescription, detailNote,
    detailNoteText, detailReactionButtons, detailReactionSummary, toastEl
};
const missingEls = Object.entries(domChecks).filter(([k, v]) => !v).map(([k]) => k);
if (missingEls.length > 0) {
    console.error('[collabView] MISSING DOM ELEMENTS:', missingEls.join(', '));
} else {
    console.log('[collabView] 7. All DOM references acquired successfully.');
}

let currentFilter = 'all';
let currentDetailRecordId = null;
let currentDetailImages = [];
let currentDetailImageIndex = 0;
const imageCache = new Map();

// --- User Identity ---
function getCurrentUser() {
    const authUser = state.session.user;
    if (authUser && authUser.isAuthenticated) {
        console.log('[collabView] getCurrentUser: Authenticated user -', authUser.name, authUser.id);
        return { id: authUser.id, name: authUser.name };
    }
    let userId = localStorage.getItem('chatUserId');
    if (!userId) {
        userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('chatUserId', userId);
        console.log('[collabView] getCurrentUser: Created new guest userId -', userId);
    }
    let userName = localStorage.getItem('chatUserName');
    if (!userName) {
        const adjectives = ['Happy', 'Sneaky', 'Wild', 'Chill', 'Brave', 'Lucky', 'Funky'];
        const nouns = ['Penguin', 'Taco', 'Dragon', 'Wizard', 'Otter', 'Phoenix', 'Ninja'];
        userName = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
        localStorage.setItem('chatUserName', userName);
        console.log('[collabView] getCurrentUser: Generated guest name -', userName);
    }
    return { id: userId, name: userName };
}

// --- Toast ---
function showToast(message, duration = 2000) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), duration);
}

// --- Save (debounced, reuses V1 api.saveSessionToAirtable) ---
let saveTimeout = null;
function triggerSave() {
    console.log('[collabView] triggerSave: Scheduling save in 1500ms...');
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        console.log('[collabView] triggerSave: Executing save now.');
        api.saveSessionToAirtable();
    }, 1500);
}

// --- Build Combined Items List ---
function buildCombinedList() {
    const items = [];

    console.log('[collabView] buildCombinedList: lockedItems.size =', state.cart.lockedItems.size, 'items.size =', state.cart.items.size, 'records.all.length =', state.records.all.length);

    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            items.push({ recordId, record, itemInfo, type: 'locked' });
        } else {
            console.warn('[collabView] buildCombinedList: Locked item recordId NOT found in records.all:', recordId);
        }
    }

    for (const [recordId, itemInfo] of state.cart.items.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            items.push({ recordId, record, itemInfo, type: 'ideas' });
        } else {
            console.warn('[collabView] buildCombinedList: Ideas item recordId NOT found in records.all:', recordId);
        }
    }

    console.log('[collabView] buildCombinedList: Returning', items.length, 'combined items (locked:', items.filter(i => i.type === 'locked').length, ', ideas:', items.filter(i => i.type === 'ideas').length, ')');
    return items;
}

// --- Reaction Helpers ---
function getReactionScore(recordId) {
    const reactions = state.session.reactions.get(recordId);
    if (!reactions || !(reactions instanceof Map)) return 0;
    let score = 0;
    for (const emoji of reactions.values()) {
        score += REACTION_SCORES[emoji] || 0;
    }
    return score;
}

function getReactionCounts(recordId) {
    const reactions = state.session.reactions.get(recordId);
    if (!reactions || !(reactions instanceof Map)) return {};
    const counts = {};
    for (const emoji of reactions.values()) {
        counts[emoji] = (counts[emoji] || 0) + 1;
    }
    return counts;
}

function renderReactionSummaryHTML(recordId) {
    const counts = getReactionCounts(recordId);
    const entries = Object.entries(counts);
    if (entries.length === 0) return '';
    return entries.map(([emoji, count]) => `<span class="collab-reaction-chip">${emoji} ${count}</span>`).join('');
}

function handleReaction(recordId, emoji) {
    const currentUser = getCurrentUser();
    console.log('[collabView] handleReaction:', recordId, emoji, 'user:', currentUser.id);

    if (!state.session.reactions.has(recordId)) {
        state.session.reactions.set(recordId, new Map());
    }

    const itemReactions = state.session.reactions.get(recordId);

    if (itemReactions.get(currentUser.id) === emoji) {
        itemReactions.delete(currentUser.id);
    } else {
        itemReactions.set(currentUser.id, emoji);
    }

    // Update the card's reaction display
    const card = feedEl.querySelector(`.collab-card[data-record-id="${recordId}"]`);
    if (card) {
        const summaryEl = card.querySelector('.collab-card-reactions-summary');
        if (summaryEl) summaryEl.innerHTML = renderReactionSummaryHTML(recordId);

        const scoreEl = card.querySelector('.collab-card-score');
        const score = getReactionScore(recordId);
        if (scoreEl) {
            scoreEl.textContent = score !== 0 ? (score > 0 ? `+${score}` : `${score}`) : '';
            scoreEl.className = `collab-card-score ${score > 0 ? 'positive' : score < 0 ? 'negative' : ''}`;
        }
    }

    // Update detail overlay if open for this record
    if (currentDetailRecordId === recordId) {
        renderDetailReactions(recordId);
    }

    // Update plan-level summary
    renderPlanSummary();

    triggerSave();
}

// --- Render Plan Header ---
function renderPlanHeader() {
    console.log('[collabView] renderPlanHeader: eventDetails.combined size =', state.eventDetails.combined.size);
    console.log('[collabView] renderPlanHeader: eventDetails keys =', Array.from(state.eventDetails.combined.keys()));

    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Shared Plan';
    eventNameEl.textContent = eventName;
    document.title = `${eventName} — Collaborator View`;
    console.log('[collabView] renderPlanHeader: Event name =', eventName);

    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    if (dateValue) {
        const date = Array.isArray(dateValue) ? new Date(dateValue[0]) : new Date(dateValue);
        if (!isNaN(date.getTime())) {
            eventDateEl.textContent = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        }
        console.log('[collabView] renderPlanHeader: Date =', dateValue);
    }

    const goals = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS);
    if (goals) {
        eventGoalsEl.textContent = goals;
        console.log('[collabView] renderPlanHeader: Goals =', goals);
    }

    // Back link includes session
    if (state.session.id) {
        backLink.href = `/?session=${state.session.id}`;
    }
}

// --- Render Plan Summary ---
function renderPlanSummary() {
    const items = buildCombinedList();
    if (items.length === 0) {
        planSummaryEl.style.display = 'none';
        return;
    }

    planSummaryEl.style.display = 'flex';

    // Aggregate reactions across all items
    const allCounts = {};
    let totalScore = 0;
    for (const item of items) {
        const counts = getReactionCounts(item.recordId);
        for (const [emoji, count] of Object.entries(counts)) {
            allCounts[emoji] = (allCounts[emoji] || 0) + count;
        }
        totalScore += getReactionScore(item.recordId);
    }

    const reactionChips = Object.entries(allCounts)
        .map(([emoji, count]) => `<span class="collab-reaction-chip">${emoji} ${count}</span>`)
        .join('');
    reactionOverviewEl.innerHTML = reactionChips || '<span class="collab-muted">No reactions yet</span>';

    // Cost summary for locked items
    let totalCost = 0;
    for (const item of items) {
        if (item.type === 'locked') {
            const price = item.itemInfo.overridePrice ?? getRecordPrice(item.record, item.itemInfo.selectedOptionIndex);
            const qty = parseInt(item.itemInfo.quantity) || 1;
            totalCost += price * qty;
        }
    }
    if (totalCost > 0) {
        costSummaryEl.innerHTML = `<span class="collab-cost-label">Plan Total:</span> <strong>$${totalCost.toFixed(2)}</strong>`;
    } else {
        costSummaryEl.innerHTML = '';
    }
}

// --- Render Tab Counts ---
function renderTabCounts() {
    const lockedCount = state.cart.lockedItems.size;
    const ideasCount = state.cart.items.size;
    console.log('[collabView] renderTabCounts: locked =', lockedCount, 'ideas =', ideasCount);
    tabCountLocked.textContent = lockedCount > 0 ? `(${lockedCount})` : '';
    tabCountIdeas.textContent = ideasCount > 0 ? `(${ideasCount})` : '';
}

// --- Create Item Card ---
async function createItemCard(item) {
    const { recordId, record, itemInfo, type } = item;
    const fields = record.fields;
    console.log('[collabView] createItemCard: Creating card for', fields.Name, '(', recordId, ') type =', type);

    const card = document.createElement('div');
    card.className = 'collab-card';
    card.dataset.recordId = recordId;
    card.dataset.type = type;

    // Get first image
    let imageUrl = '';
    try {
        console.log('[collabView] createItemCard: Fetching image for', recordId);
        const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, imageCache);
        console.log('[collabView] createItemCard: Got', (imageUrls || []).length, 'images for', recordId);
        if (imageUrls && imageUrls.length > 0) {
            imageUrl = imageUrls[0];
        }
    } catch (e) {
        console.warn(`[collabView] createItemCard: Failed to fetch image for ${recordId}`, e);
    }

    if (!imageUrl) {
        imageUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg`;
        console.log('[collabView] createItemCard: Using fallback image for', recordId);
    }

    const price = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);
    const qty = parseInt(itemInfo.quantity) || 1;
    const pricingType = fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const priceSuffix = pricingType === CONSTANTS.PRICING_TYPES.PER_GUEST ? '/guest' : '';

    // Option name
    let optionLabel = '';
    const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    if (itemInfo.selectedOptionIndex != null && options[itemInfo.selectedOptionIndex]) {
        optionLabel = options[itemInfo.selectedOptionIndex].name;
    }

    const reactionSummaryHTML = renderReactionSummaryHTML(recordId);
    const score = getReactionScore(recordId);
    const scoreDisplay = score !== 0 ? (score > 0 ? `+${score}` : `${score}`) : '';
    const scoreClass = score > 0 ? 'positive' : score < 0 ? 'negative' : '';

    const statusBadge = type === 'locked'
        ? '<span class="collab-badge collab-badge-locked">In Plan</span>'
        : '<span class="collab-badge collab-badge-idea">Idea</span>';

    card.innerHTML = `
        <div class="collab-card-image" style="background-image: url('${imageUrl}')">
            ${statusBadge}
        </div>
        <div class="collab-card-body">
            <div class="collab-card-header">
                <h3 class="collab-card-name">${fields.Name || 'Untitled'}</h3>
                <span class="collab-card-score ${scoreClass}">${scoreDisplay}</span>
            </div>
            ${optionLabel ? `<p class="collab-card-option">${optionLabel}</p>` : ''}
            <p class="collab-card-price">$${price.toFixed(2)}${priceSuffix}${qty > 1 ? ` × ${qty}` : ''}</p>
            ${itemInfo.note ? `<p class="collab-card-note">${itemInfo.note}</p>` : ''}
            <div class="collab-card-reactions">
                <div class="collab-card-reactions-summary">${reactionSummaryHTML}</div>
            </div>
            <div class="collab-card-actions">
                ${EMOJI_REACTIONS.map(emoji => {
                    const currentUser = getCurrentUser();
                    const itemReactions = state.session.reactions.get(recordId);
                    const isSelected = itemReactions instanceof Map && itemReactions.get(currentUser.id) === emoji;
                    return `<button class="collab-reaction-btn ${isSelected ? 'selected' : ''}" data-emoji="${emoji}" data-record-id="${recordId}">${emoji}</button>`;
                }).join('')}
            </div>
        </div>
    `;

    // Click card body to open detail
    card.querySelector('.collab-card-image').addEventListener('click', () => {
        openDetailOverlay(item);
    });
    card.querySelector('.collab-card-name').addEventListener('click', () => {
        openDetailOverlay(item);
    });

    // Reaction button clicks
    card.querySelectorAll('.collab-reaction-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const emoji = btn.dataset.emoji;
            const rid = btn.dataset.recordId;
            handleReaction(rid, emoji);
            // Update button selected states
            const currentUser = getCurrentUser();
            const itemReactions = state.session.reactions.get(rid);
            card.querySelectorAll('.collab-reaction-btn').forEach(b => {
                b.classList.toggle('selected', itemReactions instanceof Map && itemReactions.get(currentUser.id) === b.dataset.emoji);
            });
        });
    });

    return card;
}

// --- Render Feed ---
async function renderFeed() {
    console.log('[collabView] renderFeed: Starting render, currentFilter =', currentFilter);
    feedEl.innerHTML = '';
    const allItems = buildCombinedList();

    let filtered = allItems;
    if (currentFilter === 'locked') {
        filtered = allItems.filter(i => i.type === 'locked');
    } else if (currentFilter === 'ideas') {
        filtered = allItems.filter(i => i.type === 'ideas');
    }

    console.log('[collabView] renderFeed: Filtered to', filtered.length, 'items (from', allItems.length, 'total)');

    if (filtered.length === 0) {
        emptyEl.style.display = 'block';
        feedEl.style.display = 'none';
        console.log('[collabView] renderFeed: No items to show, displaying empty state.');
        return;
    }

    emptyEl.style.display = 'none';
    feedEl.style.display = 'grid';

    // Render cards (locked first, then ideas)
    const sorted = [...filtered].sort((a, b) => {
        if (a.type === 'locked' && b.type !== 'locked') return -1;
        if (a.type !== 'locked' && b.type === 'locked') return 1;
        return 0;
    });

    for (const item of sorted) {
        console.log('[collabView] renderFeed: Rendering card for', item.record.fields.Name, '(', item.recordId, ')');
        const card = await createItemCard(item);
        feedEl.appendChild(card);
    }
    console.log('[collabView] renderFeed: Finished rendering', sorted.length, 'cards.');
}

// --- Detail Overlay ---
async function openDetailOverlay(item) {
    const { recordId, record, itemInfo, type } = item;
    currentDetailRecordId = recordId;
    const fields = record.fields;

    detailName.textContent = fields.Name || 'Untitled';

    const price = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);
    const pricingType = fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const priceSuffix = pricingType === CONSTANTS.PRICING_TYPES.PER_GUEST ? ' per guest' : '';
    detailPrice.textContent = `$${price.toFixed(2)}${priceSuffix}`;

    detailDescription.textContent = fields.Description || '';

    if (itemInfo.note) {
        detailNote.style.display = 'block';
        detailNoteText.textContent = itemInfo.note;
    } else {
        detailNote.style.display = 'none';
    }

    // Images
    detailMainImage.style.backgroundImage = '';
    detailThumbnails.innerHTML = '<p class="collab-muted">Loading images...</p>';

    try {
        const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, imageCache);
        currentDetailImages = imageUrls || [];
    } catch (e) {
        currentDetailImages = [];
    }

    currentDetailImageIndex = 0;
    renderDetailImage();
    renderDetailReactions(recordId);

    detailOverlay.style.display = 'flex';
    document.body.classList.add('collab-overlay-open');
}

function renderDetailImage() {
    if (currentDetailImages.length === 0) {
        detailMainImage.style.backgroundImage = '';
        detailThumbnails.innerHTML = '<p class="collab-muted">No images available</p>';
        return;
    }

    detailMainImage.style.backgroundImage = `url('${currentDetailImages[currentDetailImageIndex]}')`;

    detailThumbnails.innerHTML = '';
    currentDetailImages.forEach((url, idx) => {
        const thumb = document.createElement('div');
        thumb.className = `collab-detail-thumb ${idx === currentDetailImageIndex ? 'active' : ''}`;
        thumb.style.backgroundImage = `url('${url}')`;
        thumb.addEventListener('click', () => {
            currentDetailImageIndex = idx;
            renderDetailImage();
        });
        detailThumbnails.appendChild(thumb);
    });
}

function renderDetailReactions(recordId) {
    const currentUser = getCurrentUser();
    let allReactions = state.session.reactions.get(recordId);
    if (!(allReactions instanceof Map)) {
        allReactions = new Map();
    }
    const currentUserReaction = allReactions.get(currentUser.id);

    detailReactionButtons.innerHTML = EMOJI_REACTIONS.map(emoji =>
        `<button class="collab-reaction-btn ${currentUserReaction === emoji ? 'selected' : ''}" data-emoji="${emoji}" data-record-id="${recordId}">${emoji}</button>`
    ).join('');

    // Show who reacted
    let summaryHTML = '';
    if (allReactions.size > 0) {
        summaryHTML = Array.from(allReactions.entries()).map(([userId, reaction]) => {
            const name = state.session.userProfiles.get(userId) || 'Someone';
            return `<span class="collab-reaction-who">${reaction} ${name}</span>`;
        }).join('');
    } else {
        summaryHTML = '<span class="collab-muted">No reactions yet — be the first!</span>';
    }
    detailReactionSummary.innerHTML = summaryHTML;

    // Wire up reaction buttons in detail
    detailReactionButtons.querySelectorAll('.collab-reaction-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            handleReaction(btn.dataset.recordId, btn.dataset.emoji);
        });
    });
}

function closeDetailOverlay() {
    detailOverlay.style.display = 'none';
    document.body.classList.remove('collab-overlay-open');
    currentDetailRecordId = null;
}

// --- Tab Filtering ---
function setupTabs() {
    tabContainer.addEventListener('click', (e) => {
        const tab = e.target.closest('.collab-tab');
        if (!tab) return;

        tabContainer.querySelectorAll('.collab-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.filter;
        renderFeed();
    });
}

// --- Share ---
function setupShare() {
    shareBtn.addEventListener('click', () => {
        const url = window.location.href;
        navigator.clipboard.writeText(url).then(() => {
            showToast('Link copied to clipboard!');
        }).catch(() => {
            showToast('Could not copy link');
        });
    });
}

// --- Detail Overlay Events ---
function setupDetailOverlay() {
    detailCloseBtn.addEventListener('click', closeDetailOverlay);
    detailOverlay.addEventListener('click', (e) => {
        if (e.target === detailOverlay) closeDetailOverlay();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && detailOverlay.style.display === 'flex') {
            closeDetailOverlay();
        }
    });
}

// --- Auth (lightweight: check JWT for user identity) ---
function checkAuth() {
    console.log('[collabView] checkAuth: Checking for JWT in localStorage...');
    const jwt = localStorage.getItem('jwt');
    if (jwt) {
        console.log('[collabView] checkAuth: JWT found (length:', jwt.length, ')');
        try {
            const payload = JSON.parse(atob(jwt.split('.')[1]));
            console.log('[collabView] checkAuth: JWT payload decoded. userId =', payload.userId, 'name =', payload.name, 'exp =', new Date(payload.exp * 1000).toISOString());
            if (payload.exp * 1000 > Date.now()) {
                console.log('[collabView] checkAuth: JWT is VALID (not expired). Setting authenticated state.');
                setState({
                    session: {
                        ...state.session,
                        user: {
                            ...state.session.user,
                            isAuthenticated: true,
                            id: payload.userId,
                            name: payload.name,
                            email: payload.email
                        }
                    }
                });
            } else {
                console.warn('[collabView] checkAuth: JWT is EXPIRED. Continuing as guest.');
            }
        } catch (e) {
            console.warn('[collabView] checkAuth: JWT decode failed:', e.message, '. Continuing as guest.');
        }
    } else {
        console.log('[collabView] checkAuth: No JWT found. Continuing as guest.');
    }
}

// --- Initialize ---
async function initialize() {
    console.log('[collabView] ========== INITIALIZATION START ==========');
    console.log('[collabView] initialize: URL =', window.location.href);
    console.log('[collabView] initialize: User-Agent =', navigator.userAgent);

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');
    console.log('[collabView] initialize: Extracted sessionId =', sessionId);

    if (!sessionId) {
        console.error('[collabView] initialize: NO SESSION ID in URL. Showing error.');
        loadingEl.innerHTML = `
            <p>No session specified.</p>
            <p style="margin-top: 10px;"><a href="/" style="color: #007bff;">Go to main app</a></p>
        `;
        injectDebugPanel();
        return;
    }

    try {
        // Check auth first
        console.log('[collabView] initialize: Step 1 — Checking auth...');
        checkAuth();
        console.log('[collabView] initialize: Step 1 DONE. isAuthenticated =', state.session.user.isAuthenticated);

        // Fetch all items (needed to resolve record data from session IDs)
        console.log('[collabView] initialize: Step 2 — Fetching stores and records from Airtable...');
        const fetchStart = Date.now();

        let stores, records;
        try {
            console.log('[collabView] initialize: Calling api.fetchAllStores()...');
            const storesPromise = api.fetchAllStores();
            console.log('[collabView] initialize: Calling api.fetchAllRecords()...');
            const recordsPromise = api.fetchAllRecords();
            [stores, records] = await Promise.all([storesPromise, recordsPromise]);
        } catch (fetchError) {
            console.error('[collabView] initialize: FETCH FAILED for stores/records:', fetchError.message);
            console.error('[collabView] initialize: Full error:', fetchError);
            throw fetchError;
        }

        const fetchDuration = Date.now() - fetchStart;
        console.log('[collabView] initialize: Step 2 DONE in', fetchDuration, 'ms. Stores:', stores.length, 'Records:', records.length);

        if (records.length > 0) {
            console.log('[collabView] initialize: First record sample:', records[0].id, '-', records[0].fields.Name);
            console.log('[collabView] initialize: First record fields:', Object.keys(records[0].fields).join(', '));
        } else {
            console.warn('[collabView] initialize: WARNING - 0 records returned from Airtable!');
        }

        console.log('[collabView] initialize: Step 3 — Setting state with stores and records...');
        setState({
            stores: { all: stores },
            records: { all: records }
        });
        console.log('[collabView] initialize: Step 3 DONE. state.records.all.length =', state.records.all.length, 'state.stores.all.length =', state.stores.all.length);

        // Load the session
        console.log('[collabView] initialize: Step 4 — Loading session', sessionId, 'from Airtable...');
        const sessionStart = Date.now();
        try {
            await api.loadSessionFromAirtable(sessionId);
        } catch (sessionError) {
            console.error('[collabView] initialize: LOAD SESSION FAILED:', sessionError.message);
            console.error('[collabView] initialize: Full error:', sessionError);
            throw sessionError;
        }
        const sessionDuration = Date.now() - sessionStart;
        console.log('[collabView] initialize: Step 4 DONE in', sessionDuration, 'ms.');

        console.log('[collabView] initialize: Session state after load:');
        console.log('[collabView]   session.id =', state.session.id);
        console.log('[collabView]   session.isOwned =', state.session.isOwned);
        console.log('[collabView]   session.storeId =', state.session.storeId);
        console.log('[collabView]   cart.items.size =', state.cart.items.size);
        console.log('[collabView]   cart.lockedItems.size =', state.cart.lockedItems.size);
        console.log('[collabView]   session.reactions.size =', state.session.reactions.size);
        console.log('[collabView]   session.userProfiles.size =', state.session.userProfiles.size);
        console.log('[collabView]   eventDetails.combined.size =', state.eventDetails.combined.size);

        if (state.cart.lockedItems.size > 0) {
            console.log('[collabView]   Locked item IDs:', Array.from(state.cart.lockedItems.keys()));
        }
        if (state.cart.items.size > 0) {
            console.log('[collabView]   Ideas item IDs:', Array.from(state.cart.items.keys()));
        }

        if (!state.session.id) {
            console.error('[collabView] initialize: state.session.id is NULL after loading! Session load likely failed silently.');
            loadingEl.innerHTML = `
                <p>Could not load this plan.</p>
                <p style="margin-top: 10px;"><a href="/" style="color: #007bff;">Go to main app</a></p>
            `;
            injectDebugPanel();
            return;
        }

        // Register the current user profile for reaction display
        const user = getCurrentUser();
        console.log('[collabView] initialize: Current user =', user.id, user.name);
        if (!state.session.userProfiles.has(user.id)) {
            state.session.userProfiles.set(user.id, user.name);
        }

        // Render everything
        console.log('[collabView] initialize: Step 5 — Rendering plan header...');
        renderPlanHeader();
        console.log('[collabView] initialize: Step 5a — Rendering tab counts...');
        renderTabCounts();
        console.log('[collabView] initialize: Step 5b — Rendering plan summary...');
        renderPlanSummary();
        console.log('[collabView] initialize: Step 5c — Rendering feed...');
        const renderStart = Date.now();
        await renderFeed();
        console.log('[collabView] initialize: Step 5c DONE. Feed rendered in', Date.now() - renderStart, 'ms.');

        // Show the UI
        console.log('[collabView] initialize: Step 6 — Showing UI (hiding loading, showing root)...');
        loadingEl.style.display = 'none';
        rootEl.style.display = 'block';

        // Setup interactions
        console.log('[collabView] initialize: Step 7 — Setting up interactions...');
        setupTabs();
        setupShare();
        setupDetailOverlay();

        console.log('[collabView] ========== INITIALIZATION COMPLETE ==========');

    } catch (error) {
        console.error('[collabView] ========== INITIALIZATION FAILED ==========');
        console.error('[collabView] Error:', error.message);
        console.error('[collabView] Stack:', error.stack);
        loadingEl.innerHTML = `
            <p style="color: #dc3545;">Error loading plan: ${error.message}</p>
            <p style="margin-top: 10px;"><a href="/" style="color: #007bff;">Go to main app</a></p>
        `;
    }

    // Always inject debug panel
    injectDebugPanel();
}

console.log('[collabView] 8. All function definitions complete. Calling initialize()...');
initialize();
