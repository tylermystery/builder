// FILE: components/actionMenu.js
// Unified Action Menu — merges the vitality badge, emoji reactions, and collaborator
// actions (drag-bucket functions) into a single radial menu accessible via clicking
// the vitality icon OR via drag/swipe on cards.
//
// Inner ring: emoji reactions (scroll/drag outward to reveal more tiers)
// Center: emoji summary + reaction count
// Outer ring: collaborator action buckets (goal, ideas, lock, merge, archive, delete, comment, done)

import { state, getRecordById } from '../state.js';
import { EMOJI_TIERS, REACTION_SCORES, getModalZIndex } from '../config.js';
import { requestVitalityRecalc, getNetEmoji } from '../vitality/vitalityEngine.js';
import { REALM_META } from '../vitality/vitalityProfiles.js';
import { getCurrentUser } from '../chat.js';
import { triggerSave } from '../events.js';
import { showToast } from '../ui.js';
import { log } from '../utils/debug.js';

console.log('[ActionMenu DEBUG] ✅ actionMenu.js MODULE LOADED');

// ─── Constants ───────────────────────────────────────────────────────────────
const INNER_RING_RADIUS = 100;       // distance from center to inner emoji ring
const INNER_RING_RADIUS_MOBILE = 85;
const OUTER_RING_RADIUS = 240;       // distance from center to outer action ring
const OUTER_RING_RADIUS_MOBILE = 200;
const EMOJI_ITEM_SIZE = 44;          // px, each emoji button
const EMOJI_ITEM_SIZE_MOBILE = 40;
const ACTION_ITEM_SIZE = 77;         // px, each action button (33% larger for readability)
const ACTION_ITEM_SIZE_MOBILE = 67;
const CENTER_SIZE = 76;              // px, center hub
const CENTER_SIZE_MOBILE = 64;

// The collaborator actions (outer ring) — default for plan items
const COLLABORATOR_ACTIONS = [
    { id: 'goal',           icon: '⭐', label: 'Goal',    bg: 'linear-gradient(135deg, rgba(255,193,7,0.95), rgba(255,160,0,0.95))' },
    { id: 'ideas',          icon: '💡', label: 'Ideas',   bg: 'linear-gradient(135deg, rgba(156,39,176,0.95), rgba(123,31,162,0.95))' },
    { id: 'lock',           icon: '🔒', label: 'Lock',    bg: 'linear-gradient(135deg, rgba(33,150,243,0.95), rgba(25,118,210,0.95))' },
    { id: 'merge',          icon: '🔗', label: 'Merge',   bg: 'linear-gradient(135deg, rgba(0,150,136,0.95), rgba(0,121,107,0.95))' },
    { id: 'quick-comment',  icon: '💬', label: 'Comment', bg: 'linear-gradient(135deg, rgba(0,188,212,0.95), rgba(0,151,167,0.95))' },
    { id: 'completed',      icon: '✓',  label: 'Done',    bg: 'linear-gradient(135deg, rgba(76,175,80,0.95), rgba(46,125,50,0.95))' },
    { id: 'archive',        icon: '📦', label: 'Archive', bg: 'linear-gradient(135deg, rgba(108,117,125,0.95), rgba(73,80,87,0.95))' },
    { id: 'delete',         icon: '🗑️', label: 'Delete',  bg: 'linear-gradient(135deg, rgba(220,53,69,0.95), rgba(176,42,55,0.95))' },
];

// Context-specific action sets — used when the menu is opened for different entity types.
// Each context maps to a subset/superset of actions appropriate for that entity.
const CONTEXT_ACTIONS = {
    // Default plan item actions (same as COLLABORATOR_ACTIONS)
    'plan-item': COLLABORATOR_ACTIONS,

    // Actions for chat messages / comments
    'chat': [
        { id: 'reply',         icon: '↩️', label: 'Reply',   bg: 'linear-gradient(135deg, rgba(59,130,246,0.95), rgba(37,99,235,0.95))' },
        { id: 'quick-comment', icon: '💬', label: 'Comment', bg: 'linear-gradient(135deg, rgba(0,188,212,0.95), rgba(0,151,167,0.95))' },
        { id: 'pin',           icon: '📌', label: 'Pin',     bg: 'linear-gradient(135deg, rgba(245,158,11,0.95), rgba(217,119,6,0.95))' },
        { id: 'flag',          icon: '🚩', label: 'Flag',    bg: 'linear-gradient(135deg, rgba(239,68,68,0.95), rgba(220,38,38,0.95))' },
        { id: 'completed',     icon: '✓',  label: 'Done',    bg: 'linear-gradient(135deg, rgba(76,175,80,0.95), rgba(46,125,50,0.95))' },
        { id: 'delete',        icon: '🗑️', label: 'Delete',  bg: 'linear-gradient(135deg, rgba(220,53,69,0.95), rgba(176,42,55,0.95))' },
    ],

    // Actions for images / media
    'image': [
        { id: 'quick-comment', icon: '💬', label: 'Comment', bg: 'linear-gradient(135deg, rgba(0,188,212,0.95), rgba(0,151,167,0.95))' },
        { id: 'goal',          icon: '⭐', label: 'Favorite', bg: 'linear-gradient(135deg, rgba(255,193,7,0.95), rgba(255,160,0,0.95))' },
        { id: 'flag',          icon: '🚩', label: 'Flag',    bg: 'linear-gradient(135deg, rgba(239,68,68,0.95), rgba(220,38,38,0.95))' },
        { id: 'share',         icon: '🔗', label: 'Share',   bg: 'linear-gradient(135deg, rgba(0,150,136,0.95), rgba(0,121,107,0.95))' },
        { id: 'delete',        icon: '🗑️', label: 'Delete',  bg: 'linear-gradient(135deg, rgba(220,53,69,0.95), rgba(176,42,55,0.95))' },
    ],

    // Actions for item variations / options
    'variation': [
        { id: 'quick-comment', icon: '💬', label: 'Comment', bg: 'linear-gradient(135deg, rgba(0,188,212,0.95), rgba(0,151,167,0.95))' },
        { id: 'goal',          icon: '⭐', label: 'Prefer',  bg: 'linear-gradient(135deg, rgba(255,193,7,0.95), rgba(255,160,0,0.95))' },
        { id: 'completed',     icon: '✓',  label: 'Select',  bg: 'linear-gradient(135deg, rgba(76,175,80,0.95), rgba(46,125,50,0.95))' },
        { id: 'flag',          icon: '🚩', label: 'Flag',    bg: 'linear-gradient(135deg, rgba(239,68,68,0.95), rgba(220,38,38,0.95))' },
    ],
};

// ─── State ───────────────────────────────────────────────────────────────────
let menuOverlay = null;
let isOpen = false;
let currentRecordId = null;
let currentContext = 'plan-item'; // active context type
let currentTierIndex = 0;       // which emoji tier is currently displayed
let previewEmoji = null;        // emoji being previewed (hovered)
let previewScore = null;        // transient goodness preview
let onActionCallback = null;    // callback from presentation.js for bucket actions
let registeredActionHandler = null; // globally registered action handler
let scrollAccumulator = 0;      // for mouse-wheel tier advancement
const SCROLL_TIER_THRESHOLD = 80;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a global action handler for collaborator actions.
 * Called by presentation.js once during init so that badge-triggered menus
 * have access to actions like setItemAsGoal, archiveItem, etc.
 * @param {function} handler - callback(actionId, recordId)
 */
export function registerActionHandler(handler) {
    console.log('[ActionMenu DEBUG] registerActionHandler() called, handler:', typeof handler, handler?.name || '(anonymous)');
    registeredActionHandler = handler;
}

/**
 * Open the unified action menu for a specific item.
 * @param {string} recordId - The item record ID (or entity ID for non-item contexts)
 * @param {object} opts
 * @param {number} opts.x - Center X (viewport)
 * @param {number} opts.y - Center Y (viewport)
 * @param {function} opts.onAction - callback(actionId, recordId, context) for collaborator actions
 * @param {string} opts.context - Context type: 'plan-item' (default), 'chat', 'image', 'variation'
 */
export function openActionMenu(recordId, { x, y, onAction, context } = {}) {
    console.log('[ActionMenu DEBUG] ──────────────────────────────────────');
    console.log('[ActionMenu DEBUG] openActionMenu() CALLED');
    console.log('[ActionMenu DEBUG]   recordId:', recordId);
    console.log('[ActionMenu DEBUG]   x:', x, 'y:', y);
    console.log('[ActionMenu DEBUG]   onAction:', typeof onAction, onAction?.name || '(none)');
    console.log('[ActionMenu DEBUG]   registeredActionHandler:', typeof registeredActionHandler, registeredActionHandler?.name || '(none)');
    console.log('[ActionMenu DEBUG]   isOpen (before):', isOpen);
    console.log('[ActionMenu DEBUG]   menuOverlay (before):', menuOverlay ? 'EXISTS' : 'null');
    console.log('[ActionMenu DEBUG]   SIZING: center=' + CENTER_SIZE + 'px inner=' + INNER_RING_RADIUS + 'px outer=' + OUTER_RING_RADIUS + 'px emoji=' + EMOJI_ITEM_SIZE + 'px action=' + ACTION_ITEM_SIZE + 'px');

    if (isOpen || menuOverlay) {
        console.log('[ActionMenu DEBUG]   Was already open, closing first...');
        closeActionMenu();
    }

    // Also clean up any stale overlay left in the DOM from a prior close animation
    const staleOverlay = document.getElementById('action-menu-overlay');
    if (staleOverlay) {
        console.log('[ActionMenu DEBUG]   Removing stale overlay from DOM');
        staleOverlay.remove();
    }

    currentRecordId = recordId;
    currentContext = context || 'plan-item';
    onActionCallback = onAction || registeredActionHandler || null;
    currentTierIndex = 0;
    previewEmoji = null;
    previewScore = null;
    scrollAccumulator = 0;

    console.log('[ActionMenu DEBUG]   context:', currentContext);
    console.log('[ActionMenu DEBUG]   onActionCallback resolved to:', typeof onActionCallback, onActionCallback?.name || '(none)');

    const record = getRecordById(recordId);
    if (!record && currentContext === 'plan-item') {
        console.error('[ActionMenu DEBUG]   ❌ getRecordById returned null/undefined for recordId:', recordId);
        console.log('[ActionMenu DEBUG]   ABORTING openActionMenu - no record found');
        return;
    }
    console.log('[ActionMenu DEBUG]   ✅ Record found:', record?.fields?.Name || '(non-item context or no name)');

    const isMobile = window.innerWidth < 768;
    console.log('[ActionMenu DEBUG]   isMobile:', isMobile, '(window.innerWidth:', window.innerWidth + ')');
    const outerR = isMobile ? OUTER_RING_RADIUS_MOBILE : OUTER_RING_RADIUS;
    const margin = outerR + 60;

    // Default position: center of viewport
    let cx = x ?? window.innerWidth / 2;
    let cy = y ?? window.innerHeight / 2;

    // Constrain to viewport
    cx = Math.max(margin, Math.min(window.innerWidth - margin, cx));
    cy = Math.max(margin, Math.min(window.innerHeight - margin, cy));

    // Build DOM
    menuOverlay = document.createElement('div');
    menuOverlay.className = 'action-menu-overlay';
    menuOverlay.id = 'action-menu-overlay';
    console.log('[ActionMenu DEBUG]   Created menuOverlay element');

    let zIndex = 100000;
    try {
        const modalZ = getModalZIndex('picker');
        zIndex = Math.max(modalZ, 100000); // Ensure we're always above everything else
    } catch (_) { /* default */ }
    menuOverlay.style.zIndex = zIndex;
    console.log('[ActionMenu DEBUG]   z-index set to:', zIndex);

    const menuRoot = document.createElement('div');
    menuRoot.className = 'action-menu-root';
    menuRoot.style.left = `${cx}px`;
    menuRoot.style.top = `${cy}px`;
    console.log('[ActionMenu DEBUG]   menuRoot positioned at cx:', cx, 'cy:', cy);

    // ── Center hub ──
    // For plan-item context, show vitality center hub; for other contexts, show a simpler hub
    const centerHub = buildCenterHub(recordId);
    menuRoot.appendChild(centerHub);
    console.log('[ActionMenu DEBUG]   ✅ Center hub built and appended');

    // ── Inner ring: emojis (reactions are available in all contexts) ──
    buildEmojiRing(menuRoot, recordId);
    console.log('[ActionMenu DEBUG]   ✅ Emoji ring built');

    // ── Outer ring: context-specific actions ──
    buildActionRing(menuRoot, recordId);
    console.log('[ActionMenu DEBUG]   ✅ Action ring built');

    // ── Vitality summary panel (only for plan-item context) ──
    if (currentContext === 'plan-item') {
        buildVitalitySummary(menuRoot, recordId);
        console.log('[ActionMenu DEBUG]   ✅ Vitality summary built');
    }

    // ── Tier label ──
    const tierLabel = document.createElement('div');
    tierLabel.className = 'action-menu-tier-label';
    tierLabel.id = 'action-menu-tier-label';
    tierLabel.textContent = EMOJI_TIERS[0].label;
    menuRoot.appendChild(tierLabel);
    console.log('[ActionMenu DEBUG]   ✅ Tier label built, tier:', EMOJI_TIERS[0].label);

    menuOverlay.appendChild(menuRoot);
    document.body.appendChild(menuOverlay);
    console.log('[ActionMenu DEBUG]   ✅ menuOverlay appended to document.body');
    console.log('[ActionMenu DEBUG]   menuOverlay in DOM:', document.body.contains(menuOverlay));

    // Critical CSS check — verify deferred.css action-menu styles are loaded
    const overlayCS = window.getComputedStyle(menuOverlay);
    const rootCS = window.getComputedStyle(menuRoot);
    const cssLoaded = overlayCS.position === 'fixed';
    console.log('[ActionMenu DEBUG]   ⚠️ CSS LOADED CHECK: position is "' + overlayCS.position + '" (expected "fixed") → CSS ' + (cssLoaded ? '✅ LOADED' : '❌ NOT LOADED — styles missing from deferred.css!'));
    console.log('[ActionMenu DEBUG]   menuOverlay display:', overlayCS.display, '(expect flex)');
    console.log('[ActionMenu DEBUG]   menuOverlay visibility:', overlayCS.visibility);
    console.log('[ActionMenu DEBUG]   menuOverlay opacity:', overlayCS.opacity);
    console.log('[ActionMenu DEBUG]   menuOverlay position:', overlayCS.position, '(expect fixed)');
    console.log('[ActionMenu DEBUG]   menuOverlay zIndex (computed):', overlayCS.zIndex);
    console.log('[ActionMenu DEBUG]   menuOverlay backdrop-filter:', overlayCS.backdropFilter || overlayCS.webkitBackdropFilter || 'none');
    console.log('[ActionMenu DEBUG]   menuRoot position:', rootCS.position, '(expect fixed)');
    console.log('[ActionMenu DEBUG]   menuRoot left:', rootCS.left, 'top:', rootCS.top);

    // Event listeners
    menuOverlay.addEventListener('click', handleOverlayClick);
    menuOverlay.addEventListener('wheel', handleWheel, { passive: false });
    document.addEventListener('keydown', handleEscKey);
    console.log('[ActionMenu DEBUG]   ✅ Event listeners attached (click, wheel, keydown)');

    // Touch/mouse scroll on the emoji ring for tier advancement
    menuRoot.addEventListener('touchstart', handleTouchStart, { passive: true });
    menuRoot.addEventListener('touchmove', handleTouchMove, { passive: false });
    menuRoot.addEventListener('touchend', handleTouchEnd);
    console.log('[ActionMenu DEBUG]   ✅ Touch listeners attached');

    // Listen for vitality recalculations to update preview in real time
    document.addEventListener('vitalityRecalculated', handleVitalityUpdate);
    console.log('[ActionMenu DEBUG]   ✅ vitalityRecalculated listener attached');

    isOpen = true;

    // Animate in
    requestAnimationFrame(() => {
        console.log('[ActionMenu DEBUG]   rAF: adding action-menu-visible class');
        menuOverlay.classList.add('action-menu-visible');
        console.log('[ActionMenu DEBUG]   rAF: menuOverlay classes:', menuOverlay.className);
        // Check computed styles after visibility class is applied
        setTimeout(() => {
            if (menuOverlay) {
                const cs = window.getComputedStyle(menuOverlay);
                const isFixedPosition = cs.position === 'fixed';
                const isFullScreen = parseInt(cs.width) >= window.innerWidth * 0.9 && parseInt(cs.height) >= window.innerHeight * 0.9;
                console.log('[ActionMenu DEBUG]   POST-VISIBLE STATUS:', isFixedPosition && isFullScreen ? '✅ MENU SHOULD BE VISIBLE' : '❌ MENU LIKELY NOT VISIBLE');
                console.log('[ActionMenu DEBUG]     position:', cs.position, '(need fixed)');
                console.log('[ActionMenu DEBUG]     display:', cs.display, '(need flex)');
                console.log('[ActionMenu DEBUG]     opacity:', cs.opacity, '(need 1)');
                console.log('[ActionMenu DEBUG]     pointerEvents:', cs.pointerEvents);
                console.log('[ActionMenu DEBUG]     dimensions:', cs.width, 'x', cs.height, '(need full viewport:', window.innerWidth, 'x', window.innerHeight + ')');
                // Check the root's children
                const root = menuOverlay.querySelector('.action-menu-root');
                if (root) {
                    const rcs = window.getComputedStyle(root);
                    console.log('[ActionMenu DEBUG]   menuRoot: position:', rcs.position, 'left:', rcs.left, 'top:', rcs.top);
                    console.log('[ActionMenu DEBUG]   menuRoot children:', root.children.length);
                    // Check center hub visibility
                    const centerHub = root.querySelector('.action-menu-center');
                    if (centerHub) {
                        const hubCS = window.getComputedStyle(centerHub);
                        const hubRect = centerHub.getBoundingClientRect();
                        console.log('[ActionMenu DEBUG]   centerHub: position:', hubCS.position, 'display:', hubCS.display, 'rect:', JSON.stringify({x: Math.round(hubRect.x), y: Math.round(hubRect.y), w: Math.round(hubRect.width), h: Math.round(hubRect.height)}));
                    }
                    // Check emoji ring
                    const emojiRing = root.querySelector('.action-menu-emoji-ring');
                    if (emojiRing) {
                        const emojiButtons = emojiRing.querySelectorAll('.action-menu-emoji-btn');
                        const firstBtnCS = emojiButtons.length > 0 ? window.getComputedStyle(emojiButtons[0]) : null;
                        console.log('[ActionMenu DEBUG]   emojiRing: buttons:', emojiButtons.length, '| first btn opacity:', firstBtnCS?.opacity, 'transform:', firstBtnCS?.transform);
                    }
                    // Check action ring
                    const actionRing = root.querySelector('.action-menu-action-ring');
                    if (actionRing) {
                        const actionButtons = actionRing.querySelectorAll('.action-menu-action-btn');
                        const firstBtnCS = actionButtons.length > 0 ? window.getComputedStyle(actionButtons[0]) : null;
                        console.log('[ActionMenu DEBUG]   actionRing: buttons:', actionButtons.length, '| first btn opacity:', firstBtnCS?.opacity, 'transform:', firstBtnCS?.transform);
                    }
                }
                // Check overlay bounding rect
                const overlayRect = menuOverlay.getBoundingClientRect();
                console.log('[ActionMenu DEBUG]   overlay boundingRect:', JSON.stringify({
                    top: overlayRect.top, left: overlayRect.left,
                    width: overlayRect.width, height: overlayRect.height
                }));
                // Check if deferred.css has loaded
                const sheets = Array.from(document.styleSheets);
                const deferredLoaded = sheets.some(s => s.href && s.href.includes('deferred.css'));
                console.log('[ActionMenu DEBUG]   deferred.css loaded:', deferredLoaded, '| total stylesheets:', sheets.length);
            }
        }, 150);
    });

    console.log('[ActionMenu DEBUG]   ✅ openActionMenu COMPLETE, isOpen:', isOpen);
    console.log('[ActionMenu DEBUG] ──────────────────────────────────────');

    log('ActionMenu', `Opened for item ${recordId} at (${Math.round(cx)}, ${Math.round(cy)})`);
}

/**
 * Close the action menu.
 */
export function closeActionMenu() {
    console.log('[ActionMenu DEBUG] closeActionMenu() called, menuOverlay:', menuOverlay ? 'EXISTS' : 'null', 'isOpen:', isOpen);
    if (!menuOverlay) {
        console.log('[ActionMenu DEBUG]   No menuOverlay to close, returning early');
        return;
    }

    // If we had a preview emoji active, clear the preview state
    if (previewEmoji) {
        previewEmoji = null;
        previewScore = null;
    }

    // Capture the reference to the current overlay so the timeout removes
    // the correct element even if openActionMenu() is called again immediately.
    const overlayToRemove = menuOverlay;
    overlayToRemove.classList.remove('action-menu-visible');
    overlayToRemove.classList.add('action-menu-closing');

    // Clear module-level references immediately so re-open works cleanly
    menuOverlay = null;
    isOpen = false;
    currentRecordId = null;
    currentContext = 'plan-item';
    onActionCallback = null;

    setTimeout(() => {
        if (overlayToRemove && overlayToRemove.parentElement) {
            overlayToRemove.remove();
            console.log('[ActionMenu DEBUG]   Deferred removal: old overlay removed from DOM');
        }
    }, 200);

    document.removeEventListener('keydown', handleEscKey);
    document.removeEventListener('vitalityRecalculated', handleVitalityUpdate);

    log('ActionMenu', 'Closed');
}

/**
 * Whether the action menu is currently open.
 */
export function isActionMenuOpen() {
    return isOpen;
}

/**
 * Get the list of available context types for the action menu.
 * @returns {string[]} Available context keys
 */
export function getActionMenuContexts() {
    return Object.keys(CONTEXT_ACTIONS);
}

// ─── DOM Builders ────────────────────────────────────────────────────────────

function getReactionSummary(recordId) {
    const reactions = state.session.reactions?.get(recordId);
    if (!reactions || !(reactions instanceof Map) || reactions.size === 0) {
        return { count: 0, total: 0, average: 0, summaryEmoji: '😊' };
    }

    let total = 0;
    let count = 0;
    reactions.forEach((emoji) => {
        total += (REACTION_SCORES[emoji] || 0);
        count += 1;
    });

    const average = count > 0 ? total / count : 0;

    let summaryEmoji = '😊';
    let closestDiff = Infinity;
    Object.entries(REACTION_SCORES).forEach(([emoji, score]) => {
        const diff = Math.abs(score - average);
        if (diff < closestDiff) {
            closestDiff = diff;
            summaryEmoji = emoji;
        }
    });

    return { count, total, average, summaryEmoji };
}

function getPreviewSummary(recordId, previewEmojiValue) {
    const reactions = state.session.reactions?.get(recordId);
    let total = 0;
    let count = 0;
    let currentUserReaction = null;

    let currentUser;
    try {
        currentUser = getCurrentUser();
    } catch (_) {
        currentUser = { id: 'anonymous', name: 'Anonymous' };
    }

    if (reactions && reactions instanceof Map) {
        reactions.forEach((emoji, userId) => {
            total += (REACTION_SCORES[emoji] || 0);
            count += 1;
            if (userId === currentUser.id) currentUserReaction = emoji;
        });
    }

    if (currentUserReaction) {
        total -= (REACTION_SCORES[currentUserReaction] || 0);
    } else {
        count += 1;
    }

    total += (REACTION_SCORES[previewEmojiValue] || 0);
    const average = count > 0 ? total / count : 0;

    let summaryEmoji = previewEmojiValue || '😊';
    let closestDiff = Infinity;
    Object.entries(REACTION_SCORES).forEach(([emoji, score]) => {
        const diff = Math.abs(score - average);
        if (diff < closestDiff) {
            closestDiff = diff;
            summaryEmoji = emoji;
        }
    });

    return { count, total, average, summaryEmoji };
}

function buildCenterHub(recordId) {
    const scores = state.vitality?.itemScores?.get(recordId);
    console.log('[ActionMenu DEBUG] buildCenterHub - recordId:', recordId, 'scores:', scores ? 'EXISTS' : 'null/undefined');
    if (scores) {
        console.log('[ActionMenu DEBUG]   scores.goodnessEmoji:', scores.goodnessEmoji, 'scores.netEmoji:', scores.netEmoji, 'scores.goodnessScore:', scores.goodnessScore, 'scores.net:', scores.net);
    }

    const reactionSummary = getReactionSummary(recordId);
    const summaryEmoji = reactionSummary.count > 0 ? reactionSummary.summaryEmoji : '😊';
    const summaryScore = reactionSummary.count > 0
        ? `${reactionSummary.average >= 0 ? '+' : ''}${reactionSummary.average.toFixed(2)}`
        : '—';
    const summaryLabel = reactionSummary.count > 0
        ? `${reactionSummary.count} reaction${reactionSummary.count !== 1 ? 's' : ''}`
        : 'Add a reaction';

    const hub = document.createElement('div');
    hub.className = 'action-menu-center';
    hub.id = 'action-menu-center';

    hub.innerHTML = `
        <div class="action-menu-center-emoji" id="action-menu-center-emoji">${summaryEmoji}</div>
        <div class="action-menu-center-score" id="action-menu-center-score">${summaryScore}</div>
        <div class="action-menu-center-label" id="action-menu-center-label">${summaryLabel}</div>
    `;

    return hub;
}

function buildEmojiRing(container, recordId) {
    console.log('[ActionMenu DEBUG] buildEmojiRing - tierIndex:', currentTierIndex, 'recordId:', recordId);
    const isMobile = window.innerWidth < 768;
    const radius = isMobile ? INNER_RING_RADIUS_MOBILE : INNER_RING_RADIUS;
    const itemSize = isMobile ? EMOJI_ITEM_SIZE_MOBILE : EMOJI_ITEM_SIZE;
    const halfItem = itemSize / 2;

    // Get current user reaction
    let currentUserEmoji = null;
    try {
        const user = getCurrentUser();
        const reactions = state.session.reactions?.get(recordId);
        if (reactions instanceof Map) {
            currentUserEmoji = reactions.get(user.id);
        }
    } catch (_) { /* anonymous */ }

    const tier = EMOJI_TIERS[currentTierIndex];
    const emojis = tier.emojis;
    const angleStep = (2 * Math.PI) / emojis.length;
    const startAngle = -Math.PI / 2;

    // Remove old ring
    const oldRing = container.querySelector('.action-menu-emoji-ring');
    if (oldRing) oldRing.remove();

    const ring = document.createElement('div');
    ring.className = 'action-menu-emoji-ring';
    ring.id = 'action-menu-emoji-ring';

    emojis.forEach((emoji, i) => {
        const angle = startAngle + i * angleStep;
        const x = Math.cos(angle) * radius - halfItem;
        const y = Math.sin(angle) * radius - halfItem;

        const score = REACTION_SCORES[emoji] || 0;
        const scoreLabel = score > 0 ? `+${score.toFixed(1)}` : score.toFixed(1);
        const isSelected = currentUserEmoji === emoji;

        const btn = document.createElement('button');
        btn.className = `action-menu-emoji-btn${isSelected ? ' selected' : ''}`;
        btn.dataset.emoji = emoji;
        btn.dataset.score = score;
        btn.title = `${emoji} ${scoreLabel} impact`;
        btn.style.left = `${x}px`;
        btn.style.top = `${y}px`;
        btn.style.width = `${itemSize}px`;
        btn.style.height = `${itemSize}px`;
        btn.style.transitionDelay = `${i * 20}ms`;

        btn.innerHTML = `
            <span class="action-menu-emoji-char">${emoji}</span>
            <span class="action-menu-emoji-score">${scoreLabel}</span>
        `;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleEmojiSelect(recordId, emoji);
        });

        // On touch devices, allow immediate reaction on finger lift after swipe-to-open.
        // The menu opens during a swipe, so the finger is still down — standard 'click'
        // only fires on a fresh tap. This touchend handler lets the user lift their finger
        // on an emoji to select it right away.
        btn.addEventListener('touchend', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const touch = e.changedTouches[0];
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            if (el && (el === btn || btn.contains(el))) {
                handleEmojiSelect(recordId, emoji);
            }
        });

        btn.addEventListener('pointerenter', () => {
            handleEmojiPreview(recordId, emoji);
        });

        btn.addEventListener('pointerleave', () => {
            clearEmojiPreview(recordId);
        });

        ring.appendChild(btn);
    });

    container.appendChild(ring);
}

function buildActionRing(container, recordId) {
    const isAuthenticated = state.session?.user?.isAuthenticated;
    const canShowActions = currentContext !== 'plan-item' || isAuthenticated;
    const isMobile = window.innerWidth < 768;
    const radius = isMobile ? OUTER_RING_RADIUS_MOBILE : OUTER_RING_RADIUS;
    const itemSize = isMobile ? ACTION_ITEM_SIZE_MOBILE : ACTION_ITEM_SIZE;
    const halfItem = itemSize / 2;

    const oldNote = container.querySelector('.action-menu-guest-note');
    if (oldNote) oldNote.remove();

    const actions = CONTEXT_ACTIONS[currentContext] || COLLABORATOR_ACTIONS;
    const angleStep = (2 * Math.PI) / actions.length;
    const startAngle = -Math.PI / 2;

    // Remove old ring
    const oldRing = container.querySelector('.action-menu-action-ring');
    if (oldRing) oldRing.remove();

    if (!canShowActions) {
        const note = document.createElement('div');
        note.className = 'action-menu-guest-note';
        note.textContent = 'Sign in to unlock actions';
        container.appendChild(note);
        return;
    }

    const ring = document.createElement('div');
    ring.className = 'action-menu-action-ring';
    ring.id = 'action-menu-action-ring';

    actions.forEach((action, i) => {
        const angle = startAngle + i * angleStep;
        const x = Math.cos(angle) * radius - halfItem;
        const y = Math.sin(angle) * radius - halfItem;

        const btn = document.createElement('button');
        btn.className = 'action-menu-action-btn';
        btn.dataset.action = action.id;
        btn.title = action.label;
        btn.style.left = `${x}px`;
        btn.style.top = `${y}px`;
        btn.style.width = `${itemSize}px`;
        btn.style.height = `${itemSize}px`;
        btn.style.background = action.bg;
        btn.style.transitionDelay = `${i * 25 + 100}ms`;

        btn.innerHTML = `
            <span class="action-menu-action-icon">${action.icon}</span>
            <span class="action-menu-action-label">${action.label}</span>
        `;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleActionSelect(recordId, action.id);
        });

        // Allow immediate activation on finger lift after swipe-to-open
        btn.addEventListener('touchend', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const touch = e.changedTouches[0];
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            if (el && (el === btn || btn.contains(el))) {
                handleActionSelect(recordId, action.id);
            }
        });

        ring.appendChild(btn);
    });

    container.appendChild(ring);
}

function buildVitalitySummary(container, recordId) {
    const scores = state.vitality?.itemScores?.get(recordId);
    console.log('[ActionMenu DEBUG] buildVitalitySummary - recordId:', recordId, 'scores:', scores ? 'EXISTS' : 'null/undefined');
    if (!scores) {
        console.log('[ActionMenu DEBUG]   No scores found, skipping vitality summary');
        return;
    }

    // Remove old
    const old = container.querySelector('.action-menu-vitality-summary');
    if (old) old.remove();

    const summary = document.createElement('div');
    summary.className = 'action-menu-vitality-summary action-menu-footnote';
    summary.id = 'action-menu-vitality-summary';

    const realms = ['cosmological', 'planetary', 'collective', 'internal'];
    const realmBars = realms.map(realm => {
        const val = scores[realm] || 0;
        const meta = REALM_META[realm];
        const pct = Math.min(Math.abs(val) * 100, 100);
        const isNeg = val < 0;
        return `
            <div class="action-menu-realm-row">
                <span class="action-menu-realm-icon">${meta.emoji}</span>
                <div class="action-menu-realm-bar-track">
                    <div class="action-menu-realm-bar-fill" style="width:${pct}%; background:${isNeg ? '#ef4444' : meta.color};"></div>
                </div>
                <span class="action-menu-realm-val" style="color:${isNeg ? '#ef4444' : meta.color}">${val >= 0 ? '+' : ''}${val.toFixed(2)}</span>
            </div>
        `;
    }).join('');

    // Community sentiment count
    const sentiment = scores.sentiment || { raw: 0, normalized: 0, count: 0 };
    const sentimentText = sentiment.count > 0
        ? `${sentiment.count} reaction${sentiment.count !== 1 ? 's' : ''}`
        : 'No reactions yet';

    summary.innerHTML = `
        <div class="action-menu-summary-title">Vitality Summary</div>
        ${realmBars}
        <div class="action-menu-summary-sentiment">${sentimentText}</div>
        <div class="action-menu-summary-formula">
            <span>70% Vitality</span> + <span>30% Sentiment</span> = <span class="action-menu-summary-goodness" id="action-menu-summary-goodness">${scores.goodnessEmoji || scores.netEmoji || '⚖️'}</span>
        </div>
    `;

    container.appendChild(summary);
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

function handleOverlayClick(e) {
    console.log('[ActionMenu DEBUG] handleOverlayClick - target:', e.target.className, 'tagName:', e.target.tagName);
    console.log('[ActionMenu DEBUG]   e.target === menuOverlay:', e.target === menuOverlay);
    console.log('[ActionMenu DEBUG]   e.target has action-menu-overlay class:', e.target.classList.contains('action-menu-overlay'));
    // Close if clicking the backdrop (not a child element)
    if (e.target === menuOverlay || e.target.classList.contains('action-menu-overlay')) {
        console.log('[ActionMenu DEBUG]   → Closing menu (backdrop click)');
        closeActionMenu();
    } else {
        console.log('[ActionMenu DEBUG]   → Click was on a child element, NOT closing');
    }
}

function handleEscKey(e) {
    if (e.key === 'Escape') {
        closeActionMenu();
    }
}

function handleWheel(e) {
    e.preventDefault();
    scrollAccumulator += e.deltaY;

    if (Math.abs(scrollAccumulator) >= SCROLL_TIER_THRESHOLD) {
        if (scrollAccumulator > 0 && currentTierIndex < EMOJI_TIERS.length - 1) {
            currentTierIndex++;
            refreshEmojiRing();
        } else if (scrollAccumulator < 0 && currentTierIndex > 0) {
            currentTierIndex--;
            refreshEmojiRing();
        }
        scrollAccumulator = 0;
    }
}

let touchStartY = null;
function handleTouchStart(e) {
    touchStartY = e.touches[0].clientY;
}

function handleTouchMove(e) {
    if (touchStartY === null) return;
    const dy = touchStartY - e.touches[0].clientY;
    // Vertical drag on the menu changes tier
    if (Math.abs(dy) > 40) {
        if (dy > 0 && currentTierIndex < EMOJI_TIERS.length - 1) {
            currentTierIndex++;
            refreshEmojiRing();
        } else if (dy < 0 && currentTierIndex > 0) {
            currentTierIndex--;
            refreshEmojiRing();
        }
        touchStartY = e.touches[0].clientY;
        e.preventDefault();
    }
}

function handleTouchEnd() {
    touchStartY = null;
}

function handleVitalityUpdate(e) {
    if (!isOpen || !currentRecordId) return;
    // Refresh center hub and summary with new scores
    updateCenterHub(currentRecordId);
    updateVitalitySummary(currentRecordId);
}

// ─── Emoji Interaction ───────────────────────────────────────────────────────

function handleEmojiSelect(recordId, emoji) {
    let currentUser;
    try {
        currentUser = getCurrentUser();
    } catch (_) {
        currentUser = { id: 'anonymous', name: 'Anonymous' };
    }

    if (!state.session.reactions) {
        state.session.reactions = new Map();
    }
    if (!state.session.reactions.has(recordId)) {
        state.session.reactions.set(recordId, new Map());
    }

    const itemReactions = state.session.reactions.get(recordId);

    // Toggle: same emoji removes, different emoji sets
    if (itemReactions.get(currentUser.id) === emoji) {
        itemReactions.delete(currentUser.id);
        showToast(`Removed ${emoji} reaction`, 'info');
    } else {
        itemReactions.set(currentUser.id, emoji);
        const record = getRecordById(recordId);
        const name = record?.fields?.Name || 'Item';
        showToast(`${emoji} added to "${name}"`, 'success');
    }

    // Trigger save & vitality recalc (real-time update)
    triggerSave();
    requestVitalityRecalc();

    // Refresh the emoji ring to show selected state
    refreshEmojiRing();
    updateCenterHub(recordId);

    // Also update presentation reactions if visible
    const presentationContainer = document.querySelector(`.itinerary-item-reactions[data-record-id="${recordId}"]`);
    if (presentationContainer && typeof window.renderPresentationReactions === 'function') {
        window.renderPresentationReactions(recordId, presentationContainer);
    }

    // Update reaction zone summary on compact cards (if present)
    const reactionZone = document.querySelector(`.compact-card-reaction-zone[data-record-id="${recordId}"]`);
    if (reactionZone) {
        const emojiEl = reactionZone.querySelector('.reaction-zone-summary-emoji');
        const textEl = reactionZone.querySelector('.reaction-zone-summary-text');
        const scoreEl = reactionZone.querySelector('.reaction-zone-summary-score');
        if (emojiEl || textEl || scoreEl) {
            // Recalculate summary
            const updatedReactions = state.session.reactions?.get(recordId);
            if (updatedReactions && updatedReactions instanceof Map && updatedReactions.size > 0) {
                let total = 0;
                const emojiCounts = {};
                updatedReactions.forEach((e) => { total += (REACTION_SCORES[e] || 0); emojiCounts[e] = (emojiCounts[e] || 0) + 1; });
                const avg = total / updatedReactions.size;
                let closestDiff = Infinity, bestEmoji = '😊';
                Object.entries(REACTION_SCORES).forEach(([e, s]) => { const d = Math.abs(s - avg); if (d < closestDiff) { closestDiff = d; bestEmoji = e; } });
                if (emojiEl) emojiEl.textContent = bestEmoji;
                if (textEl) { const sorted = Object.entries(emojiCounts).sort((a, b) => b[1] - a[1]); const top3 = sorted.slice(0, 3).map(([e, c]) => `${e}${c > 1 ? c : ''}`).join(' '); textEl.textContent = `${updatedReactions.size} reaction${updatedReactions.size !== 1 ? 's' : ''} ${top3}`; }
                if (scoreEl) { scoreEl.textContent = `${avg >= 0 ? '+' : ''}${avg.toFixed(1)}`; scoreEl.style.display = ''; }
            } else {
                if (emojiEl) emojiEl.textContent = '😊';
                if (textEl) textEl.textContent = 'React';
                if (scoreEl) { scoreEl.textContent = ''; scoreEl.style.display = 'none'; }
            }
        }
    }

    log('ActionMenu', `Reaction ${emoji} toggled for item ${recordId}`);
}

/**
 * Preview: show what the goodness score WOULD be if this emoji were selected.
 * Updates center hub in real-time without committing.
 */
function handleEmojiPreview(recordId, emoji) {
    previewEmoji = emoji;

    const emojiScore = REACTION_SCORES[emoji] || 0;
    const previewSummary = getPreviewSummary(recordId, emoji);
    previewScore = previewSummary.average;
    const scores = state.vitality?.itemScores?.get(recordId);

    // Update center hub with preview
    const centerEmoji = document.getElementById('action-menu-center-emoji');
    const centerScore = document.getElementById('action-menu-center-score');
    const centerLabel = document.getElementById('action-menu-center-label');

    if (centerEmoji) {
        centerEmoji.textContent = previewSummary.summaryEmoji;
        centerEmoji.classList.add('previewing');
    }
    if (centerScore) {
        centerScore.textContent = `${previewSummary.average >= 0 ? '+' : ''}${previewSummary.average.toFixed(2)}`;
        centerScore.classList.add('previewing');
    }
    if (centerLabel) {
        centerLabel.textContent = `Preview: ${emoji} ${emojiScore >= 0 ? '+' : ''}${emojiScore.toFixed(1)}`;
        centerLabel.classList.add('previewing');
    }

    // Update summary goodness
    const summaryGoodness = document.getElementById('action-menu-summary-goodness');
    if (summaryGoodness && scores) {
        const currentSentiment = scores.sentiment || { raw: 0, normalized: 0, count: 0 };
        const newRaw = currentSentiment.raw + emojiScore;
        const newCount = currentSentiment.count + 1;
        const newNormalized = Math.max(-1, Math.min(1, newRaw / (newCount * 5)));
        const blendedScore = scores.net * 0.7 + newNormalized * 0.3;
        const blendedEmoji = getNetEmoji(blendedScore);
        summaryGoodness.textContent = blendedEmoji;
        summaryGoodness.classList.add('previewing');
    }
}

function clearEmojiPreview(recordId) {
    if (!previewEmoji) return;
    previewEmoji = null;
    previewScore = null;

    // Restore actual scores
    updateCenterHub(recordId);

    const summaryGoodness = document.getElementById('action-menu-summary-goodness');
    if (summaryGoodness) {
        summaryGoodness.classList.remove('previewing');
        const scores = state.vitality?.itemScores?.get(recordId);
        summaryGoodness.textContent = scores?.goodnessEmoji || scores?.netEmoji || '⚖️';
    }
}

// ─── Action Handling ─────────────────────────────────────────────────────────

function handleActionSelect(recordId, actionId) {
    console.log('[ActionMenu DEBUG] handleActionSelect - actionId:', actionId, 'recordId:', recordId, 'context:', currentContext);
    console.log('[ActionMenu DEBUG]   onActionCallback:', typeof onActionCallback, onActionCallback?.name || '(none)');

    // Capture the callback and context BEFORE closing, since closeActionMenu() nullifies state
    const callback = onActionCallback;
    const ctx = currentContext;
    closeActionMenu();

    if (callback) {
        console.log('[ActionMenu DEBUG]   → Invoking captured callback with context:', ctx);
        callback(actionId, recordId, ctx);
    } else {
        console.warn('[ActionMenu DEBUG]   ⚠️ Action selected but NO callback registered');
        log('ActionMenu', `Action "${actionId}" selected but no callback registered`);
    }
}

// ─── Refresh helpers ─────────────────────────────────────────────────────────

function refreshEmojiRing() {
    if (!menuOverlay || !currentRecordId) return;

    const root = menuOverlay.querySelector('.action-menu-root');
    if (!root) return;

    buildEmojiRing(root, currentRecordId);

    // Update tier label
    const tierLabel = document.getElementById('action-menu-tier-label');
    if (tierLabel) {
        const tier = EMOJI_TIERS[currentTierIndex];
        tierLabel.textContent = `${tier.label} (${currentTierIndex + 1}/${EMOJI_TIERS.length})`;
        tierLabel.classList.add('tier-changed');
        setTimeout(() => tierLabel.classList.remove('tier-changed'), 300);
    }

    // Animate in
    requestAnimationFrame(() => {
        const ring = document.getElementById('action-menu-emoji-ring');
        if (ring) ring.classList.add('ring-visible');
    });
}

function updateCenterHub(recordId) {
    const reactionSummary = getReactionSummary(recordId);
    const summaryEmoji = reactionSummary.count > 0 ? reactionSummary.summaryEmoji : '😊';
    const summaryScore = reactionSummary.count > 0
        ? `${reactionSummary.average >= 0 ? '+' : ''}${reactionSummary.average.toFixed(2)}`
        : '—';
    const summaryLabel = reactionSummary.count > 0
        ? `${reactionSummary.count} reaction${reactionSummary.count !== 1 ? 's' : ''}`
        : 'Add a reaction';

    const centerEmoji = document.getElementById('action-menu-center-emoji');
    const centerScore = document.getElementById('action-menu-center-score');
    const centerLabel = document.getElementById('action-menu-center-label');

    if (centerEmoji) {
        centerEmoji.textContent = summaryEmoji;
        centerEmoji.classList.remove('previewing');
    }
    if (centerScore) {
        centerScore.textContent = summaryScore;
        centerScore.classList.remove('previewing');
    }
    if (centerLabel) {
        centerLabel.textContent = summaryLabel;
        centerLabel.classList.remove('previewing');
    }
}

function updateVitalitySummary(recordId) {
    if (!menuOverlay) return;
    const root = menuOverlay.querySelector('.action-menu-root');
    if (!root) return;
    buildVitalitySummary(root, recordId);
}

// ─── Global Debug Helper ─────────────────────────────────────────────────────
// Call window.debugActionMenu() from browser console for instant diagnostics
if (typeof window !== 'undefined') {
    window.debugActionMenu = function() {
        console.log('═══════════════════════════════════════════');
        console.log('  ACTION MENU DIAGNOSTIC REPORT');
        console.log('═══════════════════════════════════════════');
        console.log('Module loaded: YES');
        console.log('isOpen:', isOpen);
        console.log('menuOverlay:', menuOverlay ? 'EXISTS in memory' : 'null');
        console.log('currentRecordId:', currentRecordId);
        console.log('onActionCallback:', typeof onActionCallback, onActionCallback?.name || '(none)');
        console.log('registeredActionHandler:', typeof registeredActionHandler, registeredActionHandler?.name || '(none)');
        console.log('currentTierIndex:', currentTierIndex);

        // Check if overlay is in the DOM
        const overlayInDOM = document.getElementById('action-menu-overlay');
        console.log('Overlay in DOM (#action-menu-overlay):', overlayInDOM ? 'FOUND' : 'NOT FOUND');
        if (overlayInDOM) {
            const cs = window.getComputedStyle(overlayInDOM);
            console.log('  display:', cs.display);
            console.log('  visibility:', cs.visibility);
            console.log('  opacity:', cs.opacity);
            console.log('  pointerEvents:', cs.pointerEvents);
            console.log('  zIndex:', cs.zIndex);
            console.log('  classes:', overlayInDOM.className);
            console.log('  childNodes:', overlayInDOM.childNodes.length);
            const root = overlayInDOM.querySelector('.action-menu-root');
            if (root) {
                console.log('  menuRoot found, children:', root.children.length);
                Array.from(root.children).forEach((child, i) => {
                    console.log(`    child[${i}]:`, child.className);
                });
            }
        }

        // Check vitality badge elements in the DOM
        const vitalityBadges = document.querySelectorAll('.compact-card-vitality, .valuation-vitality-emoji, .vitality-score-badge, .modal-vitality-badge');
        console.log('\nVitality badge elements in DOM:', vitalityBadges.length);
        vitalityBadges.forEach((el, i) => {
            console.log(`  badge[${i}]:`, el.className, '| text:', el.textContent, '| _goodnessClickBound:', el._goodnessClickBound || false);
        });

        // Check state
        console.log('\nstate.vitality:', state.vitality ? 'EXISTS' : 'null/undefined');
        console.log('state.vitality?.itemScores:', state.vitality?.itemScores ? `Map(${state.vitality.itemScores.size})` : 'null/undefined');
        if (state.vitality?.itemScores?.size > 0) {
            const firstKey = state.vitality.itemScores.keys().next().value;
            console.log('  First item score key:', firstKey);
            const firstVal = state.vitality.itemScores.get(firstKey);
            console.log('  First item score:', JSON.stringify({
                net: firstVal?.net,
                netEmoji: firstVal?.netEmoji,
                goodnessEmoji: firstVal?.goodnessEmoji,
                goodnessScore: firstVal?.goodnessScore
            }));
        }

        // Check for z-index conflicts
        const allHighZ = [];
        document.querySelectorAll('[style*="z-index"], [style*="zIndex"]').forEach(el => {
            const z = parseInt(window.getComputedStyle(el).zIndex);
            if (z > 1000) {
                allHighZ.push({ element: el.tagName + '#' + el.id + '.' + el.className.substring(0, 30), zIndex: z });
            }
        });
        console.log('\nHigh z-index elements (>1000):', allHighZ.length);
        allHighZ.forEach(item => console.log(`  ${item.element}: z-index=${item.zIndex}`));

        // Check if deferred.css is loaded and contains action-menu styles
        const sheets = Array.from(document.styleSheets);
        const deferredSheet = sheets.find(s => s.href && s.href.includes('deferred.css'));
        console.log('\n--- CSS Loading Check ---');
        console.log('Total stylesheets:', sheets.length);
        console.log('deferred.css found:', deferredSheet ? 'YES (' + deferredSheet.href + ')' : 'NO');
        if (deferredSheet) {
            try {
                const rules = Array.from(deferredSheet.cssRules || []);
                const actionMenuRules = rules.filter(r => r.selectorText && r.selectorText.includes('action-menu'));
                console.log('action-menu rules in deferred.css:', actionMenuRules.length);
                if (actionMenuRules.length > 0) {
                    console.log('  First action-menu rule:', actionMenuRules[0].selectorText);
                }
            } catch (e) {
                console.log('Could not inspect deferred.css rules (CORS):', e.message);
            }
        }
        // Quick CSS test: create a temp element with action-menu-overlay class and check position
        const testEl = document.createElement('div');
        testEl.className = 'action-menu-overlay';
        testEl.style.display = 'none';
        document.body.appendChild(testEl);
        const testCS = window.getComputedStyle(testEl);
        console.log('CSS probe (.action-menu-overlay): position:', testCS.position, '(expect fixed)');
        testEl.remove();

        console.log('═══════════════════════════════════════════');
        return 'Diagnostic report complete. Check console output above.';
    };
    console.log('[ActionMenu DEBUG] ✅ window.debugActionMenu() helper registered - call from browser console for diagnostics');
}
