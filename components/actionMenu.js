// FILE: components/actionMenu.js
// Vitality Canvas v2 — Full-screen immersive "People Layer" action menu.
// When the menu opens, the target item is highlighted prominently in the center
// (20-40% of screen), open comments/conversations are visible, and menu options
// surround the outer edges of the screen. Slight mouse/finger movement selects
// from all options easily.
//
// Architecture v2:
//   - Full-screen overlay with dim backdrop (item NOT blurred/blocked)
//   - Center: Clone of the target item card, elevated and highlighted
//   - Left edge: System actions (vertical stack)
//   - Right edge: Live comments/conversations panel
//   - Bottom edge: Emoji reactions (horizontal strip)
//   - Top edge: Vitality analytics + tier selector
//   - Magnetic cursor tracking with large selection zones

import { state, getRecordById } from '../state.js';
import { EMOJI_TIERS, REACTION_SCORES, getModalZIndex, computeDemocraticAverage } from '../config.js';
import { requestVitalityRecalc, getNetEmoji } from '../vitality/vitalityEngine.js';
import { REALM_META } from '../vitality/vitalityProfiles.js';
import { isVitalityUIDormant } from '../vitality/vitalityUI.js';
import { getCurrentUser } from '../chat.js';
import { triggerSave } from '../events.js';
import { showToast } from '../ui.js';
import { log } from '../utils/debug.js';

console.log('[ActionMenu DEBUG] Vitality Canvas v2 MODULE LOADED');

// ─── Constants ───────────────────────────────────────────────────────────────

const EMOJI_ITEM_SIZE = 48;
const EMOJI_ITEM_SIZE_MOBILE = 42;
const ACTION_ITEM_SIZE = 64;
const ACTION_ITEM_SIZE_MOBILE = 54;

// Magnetic highlighting
const MAGNETIC_RADIUS = 100;        // px, distance for magnetic snap
const MAGNETIC_SCALE = 1.6;         // Scale factor for closest item
const MAGNETIC_SCALE_NEIGHBOR = 1.15; // Scale for neighboring items

// The collaborator actions
const SYSTEM_ACTIONS = [
    { id: 'goal',           icon: '\u2B50', label: 'Goal',    bg: 'linear-gradient(135deg, rgba(255,193,7,0.95), rgba(255,160,0,0.95))' },
    { id: 'ideas',          icon: '\uD83D\uDCA1', label: 'Ideas',   bg: 'linear-gradient(135deg, rgba(156,39,176,0.95), rgba(123,31,162,0.95))' },
    { id: 'lock',           icon: '\uD83D\uDD12', label: 'Lock',    bg: 'linear-gradient(135deg, rgba(33,150,243,0.95), rgba(25,118,210,0.95))' },
    { id: 'merge',          icon: '\uD83D\uDD17', label: 'Merge',   bg: 'linear-gradient(135deg, rgba(0,150,136,0.95), rgba(0,121,107,0.95))' },
    { id: 'completed',      icon: '\u2713',  label: 'Done',    bg: 'linear-gradient(135deg, rgba(76,175,80,0.95), rgba(46,125,50,0.95))' },
    { id: 'archive',        icon: '\uD83D\uDCE6', label: 'Archive', bg: 'linear-gradient(135deg, rgba(108,117,125,0.95), rgba(73,80,87,0.95))' },
    { id: 'delete',         icon: '\uD83D\uDDD1\uFE0F', label: 'Delete',  bg: 'linear-gradient(135deg, rgba(220,53,69,0.95), rgba(176,42,55,0.95))' },
];

const COMMENT_PRESETS = [
    { id: 'quick-comment',  icon: '\uD83D\uDCAC', label: 'Comment', bg: 'linear-gradient(135deg, rgba(0,188,212,0.95), rgba(0,151,167,0.95))' },
    { id: 'quick-comment',  icon: '\uD83D\uDC4D', label: 'Love it!', bg: 'linear-gradient(135deg, rgba(59,130,246,0.95), rgba(37,99,235,0.95))', preset: 'Love it!' },
    { id: 'quick-comment',  icon: '\uD83E\uDD14', label: 'Hmm...',   bg: 'linear-gradient(135deg, rgba(245,158,11,0.95), rgba(217,119,6,0.95))', preset: 'Hmm...' },
    { id: 'quick-comment',  icon: '\uD83D\uDE4F', label: 'Yes!',     bg: 'linear-gradient(135deg, rgba(16,185,129,0.95), rgba(5,150,105,0.95))', preset: 'Yes!' },
];

// Full collaborator actions for backward compatibility
const COLLABORATOR_ACTIONS = [
    { id: 'goal',           icon: '\u2B50', label: 'Goal',    bg: 'linear-gradient(135deg, rgba(255,193,7,0.95), rgba(255,160,0,0.95))' },
    { id: 'ideas',          icon: '\uD83D\uDCA1', label: 'Ideas',   bg: 'linear-gradient(135deg, rgba(156,39,176,0.95), rgba(123,31,162,0.95))' },
    { id: 'lock',           icon: '\uD83D\uDD12', label: 'Lock',    bg: 'linear-gradient(135deg, rgba(33,150,243,0.95), rgba(25,118,210,0.95))' },
    { id: 'merge',          icon: '\uD83D\uDD17', label: 'Merge',   bg: 'linear-gradient(135deg, rgba(0,150,136,0.95), rgba(0,121,107,0.95))' },
    { id: 'quick-comment',  icon: '\uD83D\uDCAC', label: 'Comment', bg: 'linear-gradient(135deg, rgba(0,188,212,0.95), rgba(0,151,167,0.95))' },
    { id: 'completed',      icon: '\u2713',  label: 'Done',    bg: 'linear-gradient(135deg, rgba(76,175,80,0.95), rgba(46,125,50,0.95))' },
    { id: 'archive',        icon: '\uD83D\uDCE6', label: 'Archive', bg: 'linear-gradient(135deg, rgba(108,117,125,0.95), rgba(73,80,87,0.95))' },
    { id: 'delete',         icon: '\uD83D\uDDD1\uFE0F', label: 'Delete',  bg: 'linear-gradient(135deg, rgba(220,53,69,0.95), rgba(176,42,55,0.95))' },
];

// Context-specific action sets
const CONTEXT_ACTIONS = {
    'plan-item': COLLABORATOR_ACTIONS,
    'chat': [
        { id: 'reply',         icon: '\u21A9\uFE0F', label: 'Reply',   bg: 'linear-gradient(135deg, rgba(59,130,246,0.95), rgba(37,99,235,0.95))' },
        { id: 'quick-comment', icon: '\uD83D\uDCAC', label: 'Comment', bg: 'linear-gradient(135deg, rgba(0,188,212,0.95), rgba(0,151,167,0.95))' },
        { id: 'pin',           icon: '\uD83D\uDCCC', label: 'Pin',     bg: 'linear-gradient(135deg, rgba(245,158,11,0.95), rgba(217,119,6,0.95))' },
        { id: 'flag',          icon: '\uD83D\uDEA9', label: 'Flag',    bg: 'linear-gradient(135deg, rgba(239,68,68,0.95), rgba(220,38,38,0.95))' },
        { id: 'completed',     icon: '\u2713',  label: 'Done',    bg: 'linear-gradient(135deg, rgba(76,175,80,0.95), rgba(46,125,50,0.95))' },
        { id: 'delete',        icon: '\uD83D\uDDD1\uFE0F', label: 'Delete',  bg: 'linear-gradient(135deg, rgba(220,53,69,0.95), rgba(176,42,55,0.95))' },
    ],
    'image': [
        { id: 'quick-comment', icon: '\uD83D\uDCAC', label: 'Comment', bg: 'linear-gradient(135deg, rgba(0,188,212,0.95), rgba(0,151,167,0.95))' },
        { id: 'goal',          icon: '\u2B50', label: 'Favorite', bg: 'linear-gradient(135deg, rgba(255,193,7,0.95), rgba(255,160,0,0.95))' },
        { id: 'flag',          icon: '\uD83D\uDEA9', label: 'Flag',    bg: 'linear-gradient(135deg, rgba(239,68,68,0.95), rgba(220,38,38,0.95))' },
        { id: 'share',         icon: '\uD83D\uDD17', label: 'Share',   bg: 'linear-gradient(135deg, rgba(0,150,136,0.95), rgba(0,121,107,0.95))' },
        { id: 'delete',        icon: '\uD83D\uDDD1\uFE0F', label: 'Delete',  bg: 'linear-gradient(135deg, rgba(220,53,69,0.95), rgba(176,42,55,0.95))' },
    ],
    'variation': [
        { id: 'quick-comment', icon: '\uD83D\uDCAC', label: 'Comment', bg: 'linear-gradient(135deg, rgba(0,188,212,0.95), rgba(0,151,167,0.95))' },
        { id: 'goal',          icon: '\u2B50', label: 'Prefer',  bg: 'linear-gradient(135deg, rgba(255,193,7,0.95), rgba(255,160,0,0.95))' },
        { id: 'completed',     icon: '\u2713',  label: 'Select',  bg: 'linear-gradient(135deg, rgba(76,175,80,0.95), rgba(46,125,50,0.95))' },
        { id: 'flag',          icon: '\uD83D\uDEA9', label: 'Flag',    bg: 'linear-gradient(135deg, rgba(239,68,68,0.95), rgba(220,38,38,0.95))' },
    ],
};

// ─── State ───────────────────────────────────────────────────────────────────
let menuOverlay = null;
let isOpen = false;
let currentRecordId = null;
let currentContext = 'plan-item';
let currentTierIndex = 0;
let previewEmoji = null;
let previewScore = null;
let onActionCallback = null;
let registeredActionHandler = null;
let scrollAccumulator = 0;
const SCROLL_TIER_THRESHOLD = 80;

// Pointer tracking
let currentPointerX = 0;
let currentPointerY = 0;
let magneticTarget = null;
let allInteractiveElements = [];
let animFrameId = null;
let isPointerDown = false;
let pointerDownTime = 0;

// For origin point backward compat
let originX = 0;
let originY = 0;

// ─── Public API ──────────────────────────────────────────────────────────────

export function registerActionHandler(handler) {
    console.log('[VitalityCanvas v2] registerActionHandler() called');
    registeredActionHandler = handler;
}

export function openActionMenu(recordId, { x, y, onAction, context } = {}) {
    console.log('[VitalityCanvas v2] openActionMenu() CALLED, recordId:', recordId, 'context:', context);
    console.log('[VitalityCanvas v2] origin point:', x, y);

    if (isOpen || menuOverlay) {
        closeActionMenu();
    }

    // Clean up stale overlay
    const staleOverlay = document.getElementById('action-menu-overlay');
    if (staleOverlay) staleOverlay.remove();

    currentRecordId = recordId;
    currentContext = context || 'plan-item';
    onActionCallback = onAction || registeredActionHandler || null;
    currentTierIndex = 0;
    previewEmoji = null;
    previewScore = null;
    scrollAccumulator = 0;
    magneticTarget = null;
    allInteractiveElements = [];

    const record = getRecordById(recordId);
    if (!record && currentContext === 'plan-item') {
        console.error('[VitalityCanvas v2] No record found for recordId:', recordId);
        return;
    }

    const isMobile = window.innerWidth < 768;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    originX = x ?? vw / 2;
    originY = y ?? vh / 2;
    currentPointerX = originX;
    currentPointerY = originY;

    // ── Build DOM ──
    menuOverlay = document.createElement('div');
    menuOverlay.className = 'action-menu-overlay vitality-canvas vc2-fullscreen';
    menuOverlay.id = 'action-menu-overlay';

    let zIndex = 100000;
    try {
        const modalZ = getModalZIndex('picker');
        zIndex = Math.max(modalZ, 100000);
    } catch (_) { /* default */ }
    menuOverlay.style.zIndex = zIndex;

    // ── Layout grid ──
    const layout = document.createElement('div');
    layout.className = 'vc2-layout';
    layout.id = 'vc2-layout';

    // TOP BAR: Vitality analytics + tier selector
    const topBar = buildTopBar(recordId);
    layout.appendChild(topBar);

    // MIDDLE ROW: Left actions | Center item | Right comments
    const middleRow = document.createElement('div');
    middleRow.className = 'vc2-middle-row';

    // LEFT: System actions
    const leftPanel = buildLeftPanel(recordId);
    middleRow.appendChild(leftPanel);

    // CENTER: Highlighted item card
    const centerPanel = buildCenterPanel(recordId, record);
    middleRow.appendChild(centerPanel);

    // RIGHT: Comments/Conversations
    const rightPanel = buildRightPanel(recordId);
    middleRow.appendChild(rightPanel);

    layout.appendChild(middleRow);

    // BOTTOM BAR: Emoji reactions
    const bottomBar = buildBottomBar(recordId);
    layout.appendChild(bottomBar);

    menuOverlay.appendChild(layout);
    document.body.appendChild(menuOverlay);

    console.log('[VitalityCanvas v2] DOM built, attaching event listeners');

    // Event listeners
    menuOverlay.addEventListener('click', handleOverlayClick);
    menuOverlay.addEventListener('wheel', handleWheel, { passive: false });
    menuOverlay.addEventListener('pointermove', handlePointerMove);
    menuOverlay.addEventListener('pointerdown', handlePointerDown);
    menuOverlay.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('keydown', handleEscKey);
    document.addEventListener('vitalityRecalculated', handleVitalityUpdate);

    // Touch scroll for tier advancement
    layout.addEventListener('touchstart', handleTouchStart, { passive: true });
    layout.addEventListener('touchmove', handleTouchMove, { passive: false });
    layout.addEventListener('touchend', handleTouchEnd);

    // Collect all interactive elements for magnetic targeting
    collectInteractiveElements();

    isOpen = true;

    // Animate in
    requestAnimationFrame(() => {
        if (menuOverlay) {
            menuOverlay.classList.add('action-menu-visible');
            console.log('[VitalityCanvas v2] Overlay made visible');
        }
        startProximityLoop();
    });

    // Async: load comments for the right panel
    loadCommentsForPanel(recordId);

    log('ActionMenu', `Vitality Canvas v2 opened for ${recordId}`);
}

export function closeActionMenu() {
    if (!menuOverlay) return;
    console.log('[VitalityCanvas v2] closeActionMenu() called');

    if (previewEmoji) {
        previewEmoji = null;
        previewScore = null;
    }

    stopProximityLoop();

    const overlayToRemove = menuOverlay;
    overlayToRemove.classList.remove('action-menu-visible');
    overlayToRemove.classList.add('action-menu-closing');

    menuOverlay = null;
    isOpen = false;
    currentRecordId = null;
    currentContext = 'plan-item';
    onActionCallback = null;
    magneticTarget = null;
    allInteractiveElements = [];
    isPointerDown = false;

    setTimeout(() => {
        if (overlayToRemove && overlayToRemove.parentElement) {
            overlayToRemove.remove();
        }
    }, 350);

    document.removeEventListener('keydown', handleEscKey);
    document.removeEventListener('vitalityRecalculated', handleVitalityUpdate);

    log('ActionMenu', 'Vitality Canvas v2 closed');
}

export function isActionMenuOpen() {
    return isOpen;
}

export function getActionMenuContexts() {
    return Object.keys(CONTEXT_ACTIONS);
}

// ─── Proximity Engine ────────────────────────────────────────────────────────

function startProximityLoop() {
    if (animFrameId) return;
    const loop = () => {
        updateMagneticHighlight();
        animFrameId = requestAnimationFrame(loop);
    };
    animFrameId = requestAnimationFrame(loop);
}

function stopProximityLoop() {
    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
}

function updateMagneticHighlight() {
    if (!menuOverlay) return;

    let closestEl = null;
    let closestDist = Infinity;

    allInteractiveElements.forEach(el => {
        const rect = el.getBoundingClientRect();
        const elCx = rect.left + rect.width / 2;
        const elCy = rect.top + rect.height / 2;
        const dx = currentPointerX - elCx;
        const dy = currentPointerY - elCy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < closestDist && dist < MAGNETIC_RADIUS) {
            closestDist = dist;
            closestEl = el;
        }
    });

    if (closestEl !== magneticTarget) {
        clearMagneticHighlight();
        magneticTarget = closestEl;
        if (magneticTarget) {
            magneticTarget.classList.add('vc-magnetic-active');
            magneticTarget.style.transform = `scale(${MAGNETIC_SCALE})`;
            magneticTarget.style.zIndex = '30';

            // If it's an emoji button, trigger preview
            if (magneticTarget.dataset.emoji && currentRecordId) {
                handleEmojiPreview(currentRecordId, magneticTarget.dataset.emoji);
            }

            // Apply neighbor scaling for adjacent emoji buttons
            applyNeighborScale(magneticTarget);
        }
    }
}

function applyNeighborScale(target) {
    // Scale neighbors in the emoji bar slightly
    if (!target.dataset.emoji) return;
    const ring = target.closest('.vc2-emoji-strip');
    if (!ring) return;
    const buttons = Array.from(ring.querySelectorAll('.action-menu-emoji-btn'));
    const idx = buttons.indexOf(target);
    buttons.forEach((btn, i) => {
        if (btn === target) return;
        if (Math.abs(i - idx) === 1) {
            btn.style.transform = `scale(${MAGNETIC_SCALE_NEIGHBOR})`;
        } else if (!btn.classList.contains('vc-magnetic-active')) {
            btn.style.transform = '';
        }
    });
}

function clearMagneticHighlight() {
    if (magneticTarget) {
        magneticTarget.classList.remove('vc-magnetic-active');
        magneticTarget.style.transform = '';
        magneticTarget.style.zIndex = '';

        // Clear neighbor scaling
        const ring = magneticTarget.closest('.vc2-emoji-strip');
        if (ring) {
            ring.querySelectorAll('.action-menu-emoji-btn').forEach(btn => {
                if (!btn.classList.contains('vc-magnetic-active')) {
                    btn.style.transform = '';
                }
            });
        }

        if (magneticTarget.dataset.emoji && currentRecordId) {
            clearEmojiPreview(currentRecordId);
        }
        magneticTarget = null;
    }
}

function collectInteractiveElements() {
    allInteractiveElements = Array.from(
        document.querySelectorAll('.vc2-action-btn, .vc2-comment-preset-btn, .action-menu-emoji-btn')
    );
    console.log('[VitalityCanvas v2] Collected interactive elements:', allInteractiveElements.length);
}

// ─── DOM Builders ────────────────────────────────────────────────────────────

function buildTopBar(recordId) {
    const topBar = document.createElement('div');
    topBar.className = 'vc2-top-bar';

    const scores = state.vitality?.itemScores?.get(recordId);
    const reactionSummary = getReactionSummary(recordId);
    const vitalityDormant = isVitalityUIDormant();
    // When vitality is dormant, use reaction summary emoji; otherwise use goodness emoji
    const displayEmoji = vitalityDormant
        ? (reactionSummary.count > 0 ? reactionSummary.summaryEmoji : '\uD83D\uDE0A')
        : (scores?.goodnessEmoji || scores?.netEmoji || '\u2696\uFE0F');
    const record = getRecordById(recordId);
    const name = record?.fields?.Name || 'Item';

    // Item name as title
    const title = document.createElement('div');
    title.className = 'vc2-top-title';
    title.innerHTML = `<span class="vc2-top-goodness">${displayEmoji}</span> <span class="vc2-top-name">${escapeHtml(name)}</span>`;
    topBar.appendChild(title);

    // Vitality summary inline (skip when dormant)
    if (scores && !vitalityDormant) {
        const vitalityBar = document.createElement('div');
        vitalityBar.className = 'vc2-vitality-bar';
        vitalityBar.id = 'vc2-vitality-bar';
        const realms = ['cosmological', 'planetary', 'collective', 'internal'];
        realms.forEach(realm => {
            const val = scores[realm] || 0;
            const meta = REALM_META[realm];
            const pct = Math.min(Math.abs(val) * 100, 100);
            const isNeg = val < 0;
            const pip = document.createElement('div');
            pip.className = 'vc2-vitality-pip';
            pip.title = `${meta.emoji} ${realm}: ${val >= 0 ? '+' : ''}${val.toFixed(2)}`;
            pip.innerHTML = `<span class="vc2-pip-emoji">${meta.emoji}</span><div class="vc2-pip-bar"><div class="vc2-pip-fill" style="width:${pct}%;background:${isNeg ? '#ef4444' : meta.color}"></div></div>`;
            vitalityBar.appendChild(pip);
        });
        topBar.appendChild(vitalityBar);
    }

    // Reaction summary
    const reactionInfo = document.createElement('div');
    reactionInfo.className = 'vc2-top-reactions';
    reactionInfo.id = 'vc2-top-reactions';
    if (reactionSummary.count > 0) {
        reactionInfo.innerHTML = `<span class="vc2-reaction-emoji">${reactionSummary.summaryEmoji}</span> <span class="vc2-reaction-count">${reactionSummary.count} reaction${reactionSummary.count !== 1 ? 's' : ''}</span> <span class="vc2-reaction-score">${reactionSummary.average >= 0 ? '+' : ''}${reactionSummary.average.toFixed(1)}</span>`;
    } else {
        reactionInfo.innerHTML = `<span class="vc2-reaction-count">No reactions yet</span>`;
    }
    topBar.appendChild(reactionInfo);

    // Tier selector
    const tierSelector = document.createElement('div');
    tierSelector.className = 'vc2-tier-selector';
    tierSelector.id = 'vc2-tier-selector';
    const tier = EMOJI_TIERS[currentTierIndex];
    tierSelector.innerHTML = `<span class="vc2-tier-label">${tier.label}</span> <span class="vc2-tier-nav">${currentTierIndex + 1}/${EMOJI_TIERS.length}</span>`;
    topBar.appendChild(tierSelector);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'vc2-close-btn';
    closeBtn.innerHTML = '\u2715';
    closeBtn.title = 'Close (Esc)';
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeActionMenu();
    });
    topBar.appendChild(closeBtn);

    return topBar;
}

function buildLeftPanel(recordId) {
    const panel = document.createElement('div');
    panel.className = 'vc2-left-panel';

    const isAuthenticated = state.session?.user?.isAuthenticated;
    const actions = currentContext === 'plan-item'
        ? (isAuthenticated ? SYSTEM_ACTIONS : [])
        : (CONTEXT_ACTIONS[currentContext] || COLLABORATOR_ACTIONS);

    if (!isAuthenticated && currentContext === 'plan-item') {
        const note = document.createElement('div');
        note.className = 'vc2-guest-note';
        note.textContent = 'Sign in to unlock actions';
        panel.appendChild(note);
        return panel;
    }

    const label = document.createElement('div');
    label.className = 'vc2-panel-label';
    label.textContent = 'Actions';
    panel.appendChild(label);

    const isMobile = window.innerWidth < 768;
    const itemSize = isMobile ? ACTION_ITEM_SIZE_MOBILE : ACTION_ITEM_SIZE;

    actions.forEach((action, i) => {
        const btn = document.createElement('button');
        btn.className = 'action-menu-action-btn vc2-action-btn';
        btn.dataset.action = action.id;
        btn.title = action.label;
        btn.style.width = `${itemSize}px`;
        btn.style.height = `${itemSize}px`;
        btn.style.background = action.bg;
        btn.style.animationDelay = `${i * 40}ms`;

        btn.innerHTML = `
            <span class="action-menu-action-icon">${action.icon}</span>
            <span class="action-menu-action-label">${action.label}</span>
        `;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleActionSelect(recordId, action.id);
        });

        btn.addEventListener('touchend', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const touch = e.changedTouches[0];
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            if (el && (el === btn || btn.contains(el))) {
                handleActionSelect(recordId, action.id);
            }
        });

        panel.appendChild(btn);
    });

    // Add comment presets below actions for plan-item context
    if (currentContext === 'plan-item' && isAuthenticated) {
        const commentLabel = document.createElement('div');
        commentLabel.className = 'vc2-panel-label vc2-panel-label-comments';
        commentLabel.textContent = 'Quick Comment';
        panel.appendChild(commentLabel);

        COMMENT_PRESETS.forEach((preset, i) => {
            const btn = document.createElement('button');
            btn.className = 'action-menu-action-btn vc2-comment-preset-btn';
            btn.dataset.action = preset.id;
            btn.dataset.preset = preset.preset || '';
            btn.title = preset.label;
            btn.style.width = `${itemSize - 8}px`;
            btn.style.height = `${itemSize - 8}px`;
            btn.style.background = preset.bg;
            btn.style.animationDelay = `${(SYSTEM_ACTIONS.length + i) * 40}ms`;

            btn.innerHTML = `
                <span class="action-menu-action-icon">${preset.icon}</span>
                <span class="action-menu-action-label">${preset.label}</span>
            `;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleActionSelect(recordId, preset.id);
            });

            btn.addEventListener('touchend', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const touch = e.changedTouches[0];
                const el = document.elementFromPoint(touch.clientX, touch.clientY);
                if (el && (el === btn || btn.contains(el))) {
                    handleActionSelect(recordId, preset.id);
                }
            });

            panel.appendChild(btn);
        });
    }

    return panel;
}

function buildCenterPanel(recordId, record) {
    const panel = document.createElement('div');
    panel.className = 'vc2-center-panel';
    panel.id = 'vc2-center-panel';

    console.log('[VitalityCanvas v2] Building center panel for:', recordId);

    // Try to find and clone the existing card from the DOM
    const existingCard = document.querySelector(`.compact-card[data-record-id="${recordId}"]`) ||
                         document.querySelector(`.itinerary-item[data-record-id="${recordId}"]`);

    if (existingCard) {
        console.log('[VitalityCanvas v2] Found existing card, cloning');
        const clone = existingCard.cloneNode(true);
        clone.className = clone.className + ' vc2-highlighted-card';
        clone.removeAttribute('tabindex');
        // Remove click handlers from cloned elements
        clone.querySelectorAll('button, a, [data-record-id]').forEach(el => {
            el.style.pointerEvents = 'none';
        });
        panel.appendChild(clone);
    } else {
        console.log('[VitalityCanvas v2] No existing card found, building fallback');
        // Fallback: build a summary card
        const fallback = document.createElement('div');
        fallback.className = 'vc2-fallback-card';
        const name = record?.fields?.Name || 'Item';
        const description = record?.fields?.Description || record?.fields?.Notes || '';
        const price = parseFloat(record?.fields?.Price || record?.fields?.['Our Price'] || 0);

        fallback.innerHTML = `
            <h3 class="vc2-fallback-name">${escapeHtml(name)}</h3>
            ${price > 0 ? `<div class="vc2-fallback-price">$${price.toFixed(2)}</div>` : ''}
            ${description ? `<p class="vc2-fallback-desc">${escapeHtml(description.substring(0, 200))}</p>` : ''}
        `;
        panel.appendChild(fallback);
    }

    // Add the center hub analytics underneath the card
    const hub = buildCenterHub(recordId);
    panel.appendChild(hub);

    return panel;
}

function buildCenterHub(recordId) {
    const scores = state.vitality?.itemScores?.get(recordId);
    const reactionSummary = getReactionSummary(recordId);
    const vitalityDormant = isVitalityUIDormant();

    // When dormant, only show reaction-based summary; skip goodness score
    const summaryEmoji = reactionSummary.count > 0 ? reactionSummary.summaryEmoji : '\uD83D\uDE0A';
    const summaryScore = reactionSummary.count > 0
        ? `${reactionSummary.average >= 0 ? '+' : ''}${reactionSummary.average.toFixed(2)}`
        : '\u2014';
    const summaryLabel = reactionSummary.count > 0
        ? `${reactionSummary.count} reaction${reactionSummary.count !== 1 ? 's' : ''}`
        : 'Add a reaction below';

    const hub = document.createElement('div');
    hub.className = 'vc2-center-hub';
    hub.id = 'action-menu-center';

    // When vitality is dormant, skip the goodness emoji entirely
    const goodnessHTML = vitalityDormant ? '' : `<span class="vc2-hub-goodness" title="Goodness Score">${scores?.goodnessEmoji || scores?.netEmoji || '\u2696\uFE0F'}</span>`;

    hub.innerHTML = `
        <div class="vc2-hub-row">
            ${goodnessHTML}
            <span class="action-menu-center-emoji" id="action-menu-center-emoji">${summaryEmoji}</span>
            <span class="action-menu-center-score" id="action-menu-center-score">${summaryScore}</span>
        </div>
        <div class="action-menu-center-label" id="action-menu-center-label">${summaryLabel}</div>
    `;

    return hub;
}

function buildRightPanel(recordId) {
    const panel = document.createElement('div');
    panel.className = 'vc2-right-panel';
    panel.id = 'vc2-right-panel';

    const label = document.createElement('div');
    label.className = 'vc2-panel-label';
    label.textContent = 'Conversations';
    panel.appendChild(label);

    // Reactions "people layer" — show who reacted with what
    const reactionsSection = buildPeopleReactions(recordId);
    if (reactionsSection) {
        panel.appendChild(reactionsSection);
    }

    // Comments container — will be populated async
    const commentsContainer = document.createElement('div');
    commentsContainer.className = 'vc2-comments-container';
    commentsContainer.id = 'vc2-comments-container';
    commentsContainer.innerHTML = '<div class="vc2-comments-loading">Loading comments...</div>';
    panel.appendChild(commentsContainer);

    return panel;
}

function buildPeopleReactions(recordId) {
    const reactions = state.session.reactions?.get(recordId);
    if (!reactions || !(reactions instanceof Map) || reactions.size === 0) return null;

    const section = document.createElement('div');
    section.className = 'vc2-people-reactions';

    // Count total individual reactions across all users
    let totalReactionCount = 0;
    reactions.forEach((emojiData) => {
        const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
        totalReactionCount += emojis.size;
    });

    const label = document.createElement('div');
    label.className = 'vc2-people-label';
    label.textContent = `${totalReactionCount} reaction${totalReactionCount !== 1 ? 's' : ''} from ${reactions.size} user${reactions.size !== 1 ? 's' : ''}`;
    section.appendChild(label);

    // Group by emoji across all users
    const emojiGroups = new Map();
    reactions.forEach((emojiData, userId) => {
        const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
        for (const emoji of emojis) {
            if (!emojiGroups.has(emoji)) emojiGroups.set(emoji, []);
            emojiGroups.get(emoji).push(userId);
        }
    });

    emojiGroups.forEach((userIds, emoji) => {
        const row = document.createElement('div');
        row.className = 'vc2-people-row';

        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'vc2-people-emoji';
        emojiSpan.textContent = emoji;
        row.appendChild(emojiSpan);

        // Show user avatars/names
        const usersSpan = document.createElement('span');
        usersSpan.className = 'vc2-people-users';
        const userNames = userIds.map(uid => {
            // Try to get display name from session participants
            const participant = state.session?.participants?.find(p => p.id === uid);
            return participant?.name || participant?.email?.split('@')[0] || uid.substring(0, 8);
        });
        usersSpan.textContent = userNames.join(', ');
        row.appendChild(usersSpan);

        const score = REACTION_SCORES[emoji] || 0;
        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'vc2-people-score';
        scoreSpan.textContent = `${score >= 0 ? '+' : ''}${score.toFixed(1)}`;
        row.appendChild(scoreSpan);

        section.appendChild(row);
    });

    return section;
}

async function loadCommentsForPanel(recordId) {
    console.log('[VitalityCanvas v2] Loading comments for panel, recordId:', recordId);
    const container = document.getElementById('vc2-comments-container');
    if (!container) {
        console.log('[VitalityCanvas v2] No comments container found');
        return;
    }

    // Check cache first
    const cacheKey = `item:${recordId}`;
    let comments = null;

    // Try to access the componentCommentsCache from the window or presentation module
    // The cache is internal to presentation.js, so we check if comments are available
    // via the DOM (existing rendered comments)
    try {
        // Try to fetch comments via API if available
        const api = await import('../api.js');
        const sessionId = state.session?.id;
        if (sessionId && api.fetchComponentComments) {
            console.log('[VitalityCanvas v2] Fetching comments from API');
            comments = await api.fetchComponentComments(sessionId, api.COMPONENT_TYPES?.ITEM || 'item', recordId);
            console.log('[VitalityCanvas v2] Got', comments?.length || 0, 'comments');
        }
    } catch (err) {
        console.log('[VitalityCanvas v2] Could not fetch comments:', err.message);
    }

    if (!container || !document.getElementById('vc2-comments-container')) {
        console.log('[VitalityCanvas v2] Comments container gone (menu closed)');
        return;
    }

    if (!comments || comments.length === 0) {
        container.innerHTML = '<div class="vc2-comments-empty">No comments yet</div>';
        return;
    }

    renderCommentsInPanel(container, comments, recordId);
}

function renderCommentsInPanel(container, comments, recordId) {
    console.log('[VitalityCanvas v2] Rendering', comments.length, 'comments in panel');
    container.innerHTML = '';

    // Separate parents and replies
    const parents = [];
    const repliesByParent = new Map();

    comments.forEach(comment => {
        const parentId = comment.fields?.ParentMessageID;
        if (parentId) {
            if (!repliesByParent.has(parentId)) repliesByParent.set(parentId, []);
            repliesByParent.get(parentId).push(comment);
        } else {
            parents.push(comment);
        }
    });

    // Sort by timestamp (newest first for visibility)
    parents.sort((a, b) => {
        const tA = new Date(a.fields?.Timestamp || 0).getTime();
        const tB = new Date(b.fields?.Timestamp || 0).getTime();
        return tB - tA;
    });

    parents.forEach(comment => {
        const commentEl = createCommentBubble(comment, recordId);
        container.appendChild(commentEl);

        // Render replies
        const replies = repliesByParent.get(comment.id) || [];
        if (replies.length > 0) {
            const repliesContainer = document.createElement('div');
            repliesContainer.className = 'vc2-comment-replies';
            replies.sort((a, b) => {
                const tA = new Date(a.fields?.Timestamp || 0).getTime();
                const tB = new Date(b.fields?.Timestamp || 0).getTime();
                return tA - tB;
            });
            replies.forEach(reply => {
                repliesContainer.appendChild(createCommentBubble(reply, recordId, true));
            });
            container.appendChild(repliesContainer);
        }
    });
}

function createCommentBubble(comment, recordId, isReply = false) {
    const bubble = document.createElement('div');
    bubble.className = `vc2-comment-bubble${isReply ? ' vc2-comment-reply' : ''}`;

    const senderName = comment.fields?.SenderName || 'Anonymous';
    const content = (comment.fields?.Content || '').replace(/\[PLAN_COMMENT:.*?\]\s*/g, '').replace(/\[ATTACHMENTS:.*?\]$/g, '').trim();
    const timestamp = comment.fields?.Timestamp;
    const timeStr = timestamp ? formatRelativeTime(new Date(timestamp)) : '';

    // Parse reactions on the comment
    let reactionsHTML = '';
    try {
        const reactions = comment.fields?.Reactions;
        if (reactions) {
            const parsed = typeof reactions === 'string' ? JSON.parse(reactions) : reactions;
            const badges = Object.entries(parsed).map(([emoji, users]) => {
                const count = Array.isArray(users) ? users.length : 0;
                return count > 0 ? `<span class="vc2-comment-reaction">${emoji}${count > 1 ? count : ''}</span>` : '';
            }).filter(Boolean).join('');
            if (badges) reactionsHTML = `<div class="vc2-comment-reactions">${badges}</div>`;
        }
    } catch (_) { /* ignore parse errors */ }

    bubble.innerHTML = `
        <div class="vc2-comment-header">
            <span class="vc2-comment-sender">${escapeHtml(senderName)}</span>
            ${timeStr ? `<span class="vc2-comment-time">${timeStr}</span>` : ''}
        </div>
        <div class="vc2-comment-content">${escapeHtml(content)}</div>
        ${reactionsHTML}
    `;

    return bubble;
}

function formatRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildBottomBar(recordId) {
    const bottomBar = document.createElement('div');
    bottomBar.className = 'vc2-bottom-bar';
    bottomBar.id = 'vc2-bottom-bar';

    const strip = buildEmojiStrip(recordId);
    bottomBar.appendChild(strip);

    return bottomBar;
}

function buildEmojiStrip(recordId) {
    const isMobile = window.innerWidth < 768;
    const itemSize = isMobile ? EMOJI_ITEM_SIZE_MOBILE : EMOJI_ITEM_SIZE;

    let currentUserEmojiSet = null;
    try {
        const user = getCurrentUser();
        const reactions = state.session.reactions?.get(recordId);
        if (reactions instanceof Map) {
            const emojiData = reactions.get(user.id);
            if (emojiData instanceof Set) {
                currentUserEmojiSet = emojiData;
            } else if (typeof emojiData === 'string') {
                currentUserEmojiSet = new Set([emojiData]);
            }
        }
    } catch (_) { /* anonymous */ }

    const tier = EMOJI_TIERS[currentTierIndex];
    const emojis = tier.emojis;

    // Remove old strip
    const oldStrip = document.querySelector('.vc2-emoji-strip');
    if (oldStrip) oldStrip.remove();

    const strip = document.createElement('div');
    strip.className = 'vc2-emoji-strip action-menu-emoji-ring';
    strip.id = 'vc2-emoji-strip';

    emojis.forEach((emoji, i) => {
        const score = REACTION_SCORES[emoji] || 0;
        const scoreLabel = score > 0 ? `+${score.toFixed(1)}` : score.toFixed(1);
        const isSelected = currentUserEmojiSet instanceof Set ? currentUserEmojiSet.has(emoji) : false;

        const btn = document.createElement('button');
        btn.className = `action-menu-emoji-btn vc2-emoji-btn${isSelected ? ' selected' : ''}`;
        btn.dataset.emoji = emoji;
        btn.dataset.score = score;
        btn.title = `${emoji} ${scoreLabel} impact`;
        btn.style.width = `${itemSize}px`;
        btn.style.height = `${itemSize}px`;
        btn.style.animationDelay = `${i * 25}ms`;

        btn.innerHTML = `
            <span class="action-menu-emoji-char">${emoji}</span>
            <span class="action-menu-emoji-score">${scoreLabel}</span>
        `;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleEmojiSelect(recordId, emoji);
        });

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

        strip.appendChild(btn);
    });

    return strip;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getReactionSummary(recordId) {
    const reactions = state.session.reactions?.get(recordId);
    if (!reactions || !(reactions instanceof Map) || reactions.size === 0) {
        return { count: 0, total: 0, average: 0, summaryEmoji: '\uD83D\uDE0A' };
    }

    // Use democratic averaging for multi-emoji model
    const { democraticAverage, summaryEmoji, userCount, totalReactions } = computeDemocraticAverage(reactions);

    return { count: totalReactions, total: democraticAverage * userCount, average: democraticAverage, summaryEmoji };
}

function getPreviewSummary(recordId, previewEmojiValue) {
    const reactions = state.session.reactions?.get(recordId);

    let currentUser;
    try {
        currentUser = getCurrentUser();
    } catch (_) {
        currentUser = { id: 'anonymous', name: 'Anonymous' };
    }

    // Build a temporary copy with the preview emoji toggled
    const tempReactions = new Map();
    if (reactions && reactions instanceof Map) {
        for (const [userId, emojiData] of reactions) {
            const emojiSet = emojiData instanceof Set ? new Set(emojiData) : new Set([emojiData]);
            tempReactions.set(userId, emojiSet);
        }
    }

    // Toggle the preview emoji for the current user
    if (!tempReactions.has(currentUser.id)) {
        tempReactions.set(currentUser.id, new Set());
    }
    const userSet = tempReactions.get(currentUser.id);
    if (userSet.has(previewEmojiValue)) {
        userSet.delete(previewEmojiValue);
    } else {
        userSet.add(previewEmojiValue);
    }
    // Clean up empty set
    if (userSet.size === 0) {
        tempReactions.delete(currentUser.id);
    }

    const { democraticAverage, summaryEmoji, userCount, totalReactions } = computeDemocraticAverage(tempReactions);

    return { count: totalReactions, total: democraticAverage * userCount, average: democraticAverage, summaryEmoji };
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

function handleOverlayClick(e) {
    // Only close if clicking directly on the overlay background (not on child panels)
    if (e.target === menuOverlay || e.target.classList.contains('vc2-layout')) {
        closeActionMenu();
    }
}

function handleEscKey(e) {
    if (e.key === 'Escape') {
        closeActionMenu();
    }
}

function handlePointerMove(e) {
    currentPointerX = e.clientX;
    currentPointerY = e.clientY;
}

function handlePointerDown(e) {
    isPointerDown = true;
    pointerDownTime = Date.now();
    currentPointerX = e.clientX;
    currentPointerY = e.clientY;
}

function handlePointerUp(e) {
    if (!isPointerDown) return;
    isPointerDown = false;

    const elapsed = Date.now() - pointerDownTime;

    // Zero-click friction: if user press-swiped to a magnetic target within 800ms, select it
    if (magneticTarget && elapsed < 800) {
        const action = magneticTarget.dataset.action;
        const emoji = magneticTarget.dataset.emoji;

        if (emoji && currentRecordId) {
            handleEmojiSelect(currentRecordId, emoji);
        } else if (action && currentRecordId) {
            handleActionSelect(currentRecordId, action);
        }
    }
}

function handleWheel(e) {
    // Only intercept wheel on the bottom bar for tier scrolling
    const bottomBar = e.target.closest('.vc2-bottom-bar');
    if (!bottomBar) return;

    e.preventDefault();
    scrollAccumulator += e.deltaY;

    if (Math.abs(scrollAccumulator) >= SCROLL_TIER_THRESHOLD) {
        if (scrollAccumulator > 0 && currentTierIndex < EMOJI_TIERS.length - 1) {
            currentTierIndex++;
            refreshEmojiStrip();
        } else if (scrollAccumulator < 0 && currentTierIndex > 0) {
            currentTierIndex--;
            refreshEmojiStrip();
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
    currentPointerX = e.touches[0].clientX;
    currentPointerY = e.touches[0].clientY;

    const dy = touchStartY - e.touches[0].clientY;
    if (Math.abs(dy) > 40) {
        if (dy > 0 && currentTierIndex < EMOJI_TIERS.length - 1) {
            currentTierIndex++;
            refreshEmojiStrip();
        } else if (dy < 0 && currentTierIndex > 0) {
            currentTierIndex--;
            refreshEmojiStrip();
        }
        touchStartY = e.touches[0].clientY;
        e.preventDefault();
    }
}

function handleTouchEnd(e) {
    touchStartY = null;
    if (magneticTarget) {
        const touch = e.changedTouches?.[0];
        if (touch) {
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            if (el && magneticTarget.contains(el)) {
                const action = magneticTarget.dataset.action;
                const emoji = magneticTarget.dataset.emoji;
                if (emoji && currentRecordId) {
                    handleEmojiSelect(currentRecordId, emoji);
                } else if (action && currentRecordId) {
                    handleActionSelect(currentRecordId, action);
                }
            }
        }
    }
}

function handleVitalityUpdate(e) {
    if (!isOpen || !currentRecordId) return;
    updateCenterHub(currentRecordId);
    updateTopBar(currentRecordId);
}

// ─── Emoji Interaction ───────────────────────────────────────────────────────

function handleEmojiSelect(recordId, emoji) {
    let currentUser;
    try {
        currentUser = getCurrentUser();
    } catch (_) {
        currentUser = { id: 'anonymous', name: 'Anonymous' };
    }
    console.log(`[REACTIONS-DEBUG] handleEmojiSelect (actionMenu): recordId="${recordId}", emoji="${emoji}", userId="${currentUser.id}"`);

    if (!state.session.reactions) {
        state.session.reactions = new Map();
    }
    if (!state.session.reactions.has(recordId)) {
        state.session.reactions.set(recordId, new Map());
    }

    const itemReactions = state.session.reactions.get(recordId);

    // Multi-emoji model: each user has a Set of emojis
    let userEmojiSet = itemReactions.get(currentUser.id);
    if (!(userEmojiSet instanceof Set)) {
        // Migrate from legacy string format
        userEmojiSet = userEmojiSet ? new Set([userEmojiSet]) : new Set();
    }

    // Toggle: if emoji already in set, remove it; otherwise add it
    if (userEmojiSet.has(emoji)) {
        userEmojiSet.delete(emoji);
        showToast(`Removed ${emoji} reaction`, 'info');
    } else {
        userEmojiSet.add(emoji);
        const record = getRecordById(recordId);
        const name = record?.fields?.Name || 'Item';
        showToast(`${emoji} added to "${name}"`, 'success');
    }

    // Clean up empty sets, otherwise store the updated set
    if (userEmojiSet.size === 0) {
        itemReactions.delete(currentUser.id);
    } else {
        itemReactions.set(currentUser.id, userEmojiSet);
    }

    triggerSave();
    requestVitalityRecalc();

    // Broadcast via Pusher for real-time sync with other users
    if (typeof window.broadcastReactionUpdate === 'function') {
        window.broadcastReactionUpdate(recordId, itemReactions, currentUser.id);
    }

    // Refresh displays
    refreshEmojiStrip();
    updateCenterHub(recordId);
    updateTopBar(recordId);
    updatePeopleReactions(recordId);

    // Update presentation reactions if visible
    const presentationContainer = document.querySelector(`.itinerary-item-reactions[data-record-id="${recordId}"]`);
    if (presentationContainer && typeof window.renderPresentationReactions === 'function') {
        window.renderPresentationReactions(recordId, presentationContainer);
    }

    // Update reaction zone summary on compact cards
    const reactionZone = document.querySelector(`.compact-card-reaction-zone[data-record-id="${recordId}"]`);
    if (reactionZone) {
        const emojiEl = reactionZone.querySelector('.reaction-zone-summary-emoji');
        const textEl = reactionZone.querySelector('.reaction-zone-summary-text');
        const scoreEl = reactionZone.querySelector('.reaction-zone-summary-score');
        if (emojiEl || textEl || scoreEl) {
            const updatedReactions = state.session.reactions?.get(recordId);
            if (updatedReactions && updatedReactions instanceof Map && updatedReactions.size > 0) {
                // Use democratic averaging for multi-emoji model
                const { democraticAverage, summaryEmoji, totalReactions } = computeDemocraticAverage(updatedReactions);
                // Count individual emojis across all users for display
                const emojiCounts = {};
                updatedReactions.forEach((emojiData) => {
                    const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
                    for (const e of emojis) { emojiCounts[e] = (emojiCounts[e] || 0) + 1; }
                });
                if (emojiEl) emojiEl.textContent = summaryEmoji;
                if (textEl) { const sorted = Object.entries(emojiCounts).sort((a, b) => b[1] - a[1]); const top3 = sorted.slice(0, 3).map(([e, c]) => `${e}${c > 1 ? c : ''}`).join(' '); textEl.textContent = `${totalReactions} reaction${totalReactions !== 1 ? 's' : ''} ${top3}`; }
                if (scoreEl) { scoreEl.textContent = `${democraticAverage >= 0 ? '+' : ''}${democraticAverage.toFixed(1)}`; scoreEl.style.display = ''; }
            } else {
                if (emojiEl) emojiEl.textContent = '\uD83D\uDE0A';
                if (textEl) textEl.textContent = 'React';
                if (scoreEl) { scoreEl.textContent = ''; scoreEl.style.display = 'none'; }
            }
        }
    }

    log('ActionMenu', `Reaction ${emoji} toggled for item ${recordId}`);
}

function handleEmojiPreview(recordId, emoji) {
    previewEmoji = emoji;

    const emojiScore = REACTION_SCORES[emoji] || 0;
    const previewSummary = getPreviewSummary(recordId, emoji);
    previewScore = previewSummary.average;

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
}

function clearEmojiPreview(recordId) {
    if (!previewEmoji) return;
    previewEmoji = null;
    previewScore = null;
    updateCenterHub(recordId);
}

// ─── Action Handling ─────────────────────────────────────────────────────────

function handleActionSelect(recordId, actionId) {
    console.log('[VitalityCanvas v2] Action selected:', actionId, 'for', recordId);

    const callback = onActionCallback;
    const ctx = currentContext;
    closeActionMenu();

    if (callback) {
        callback(actionId, recordId, ctx);
    } else {
        console.warn('[VitalityCanvas v2] Action selected but no callback registered');
        log('ActionMenu', `Action "${actionId}" selected but no callback registered`);
    }
}

// ─── Refresh helpers ─────────────────────────────────────────────────────────

function refreshEmojiStrip() {
    if (!menuOverlay || !currentRecordId) return;

    const bottomBar = document.getElementById('vc2-bottom-bar');
    if (!bottomBar) return;

    // Replace emoji strip
    const oldStrip = bottomBar.querySelector('.vc2-emoji-strip');
    if (oldStrip) oldStrip.remove();

    const strip = buildEmojiStrip(currentRecordId);
    bottomBar.appendChild(strip);

    // Re-collect interactive elements
    collectInteractiveElements();

    // Update tier selector
    const tierSelector = document.getElementById('vc2-tier-selector');
    if (tierSelector) {
        const tier = EMOJI_TIERS[currentTierIndex];
        tierSelector.innerHTML = `<span class="vc2-tier-label">${tier.label}</span> <span class="vc2-tier-nav">${currentTierIndex + 1}/${EMOJI_TIERS.length}</span>`;
        tierSelector.classList.add('tier-changed');
        setTimeout(() => tierSelector.classList.remove('tier-changed'), 300);
    }

    // Trigger entrance animation
    requestAnimationFrame(() => {
        const buttons = document.querySelectorAll('.vc2-emoji-btn');
        buttons.forEach(btn => {
            btn.classList.add('vc2-emoji-entered');
        });
    });

    console.log('[VitalityCanvas v2] Emoji strip refreshed to tier', currentTierIndex);
}

function updateCenterHub(recordId) {
    const reactionSummary = getReactionSummary(recordId);
    const vitalityDormant = isVitalityUIDormant();

    const summaryEmoji = reactionSummary.count > 0 ? reactionSummary.summaryEmoji : '\uD83D\uDE0A';
    const summaryScore = reactionSummary.count > 0
        ? `${reactionSummary.average >= 0 ? '+' : ''}${reactionSummary.average.toFixed(2)}`
        : '\u2014';
    const summaryLabel = reactionSummary.count > 0
        ? `${reactionSummary.count} reaction${reactionSummary.count !== 1 ? 's' : ''}`
        : 'Add a reaction below';

    const goodnessEl = document.querySelector('.vc2-hub-goodness');
    const centerEmoji = document.getElementById('action-menu-center-emoji');
    const centerScore = document.getElementById('action-menu-center-score');
    const centerLabel = document.getElementById('action-menu-center-label');

    // When vitality is dormant, hide the goodness element
    if (goodnessEl) {
        if (vitalityDormant) {
            goodnessEl.style.display = 'none';
        } else {
            const scores = state.vitality?.itemScores?.get(recordId);
            goodnessEl.textContent = scores?.goodnessEmoji || scores?.netEmoji || '\u2696\uFE0F';
            goodnessEl.style.display = '';
        }
    }
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

function updateTopBar(recordId) {
    const reactionSummary = getReactionSummary(recordId);
    const reactionInfo = document.getElementById('vc2-top-reactions');
    if (reactionInfo) {
        if (reactionSummary.count > 0) {
            reactionInfo.innerHTML = `<span class="vc2-reaction-emoji">${reactionSummary.summaryEmoji}</span> <span class="vc2-reaction-count">${reactionSummary.count} reaction${reactionSummary.count !== 1 ? 's' : ''}</span> <span class="vc2-reaction-score">${reactionSummary.average >= 0 ? '+' : ''}${reactionSummary.average.toFixed(1)}</span>`;
        } else {
            reactionInfo.innerHTML = `<span class="vc2-reaction-count">No reactions yet</span>`;
        }
    }
}

function updatePeopleReactions(recordId) {
    const rightPanel = document.getElementById('vc2-right-panel');
    if (!rightPanel) return;

    const oldPeople = rightPanel.querySelector('.vc2-people-reactions');
    const newPeople = buildPeopleReactions(recordId);

    if (oldPeople && newPeople) {
        oldPeople.replaceWith(newPeople);
    } else if (!oldPeople && newPeople) {
        const commentsContainer = document.getElementById('vc2-comments-container');
        if (commentsContainer) {
            rightPanel.insertBefore(newPeople, commentsContainer);
        }
    } else if (oldPeople && !newPeople) {
        oldPeople.remove();
    }
}

// Backward compat: kept for vitality summary in older integrations
function buildVitalitySummary(container, recordId) {
    // Now integrated into topBar — noop for backward compat
}

function updateVitalitySummary(recordId) {
    updateTopBar(recordId);
}

// ─── Global Debug Helper ─────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
    window.debugActionMenu = function() {
        console.log('=== VITALITY CANVAS v2 DIAGNOSTIC ===');
        console.log('isOpen:', isOpen);
        console.log('menuOverlay:', menuOverlay ? 'EXISTS' : 'null');
        console.log('currentRecordId:', currentRecordId);
        console.log('currentContext:', currentContext);
        console.log('currentTierIndex:', currentTierIndex);
        console.log('originX:', originX, 'originY:', originY);
        console.log('currentPointerX:', currentPointerX, 'currentPointerY:', currentPointerY);
        console.log('magneticTarget:', magneticTarget?.className || 'none');
        console.log('magneticTarget text:', magneticTarget?.textContent?.substring(0, 30) || 'none');
        console.log('allInteractiveElements:', allInteractiveElements.length);
        console.log('registeredActionHandler:', typeof registeredActionHandler);
        console.log('onActionCallback:', typeof onActionCallback);

        const overlayInDOM = document.getElementById('action-menu-overlay');
        console.log('Overlay in DOM:', overlayInDOM ? 'FOUND' : 'NOT FOUND');
        if (overlayInDOM) {
            const cs = window.getComputedStyle(overlayInDOM);
            console.log('  position:', cs.position);
            console.log('  display:', cs.display);
            console.log('  opacity:', cs.opacity);
            console.log('  backdrop-filter:', cs.backdropFilter);
            console.log('  classes:', overlayInDOM.className);
            console.log('  children:', overlayInDOM.children.length);
        }

        const layout = document.getElementById('vc2-layout');
        console.log('Layout in DOM:', layout ? 'FOUND' : 'NOT FOUND');
        if (layout) {
            console.log('  Layout children:', layout.children.length);
            Array.from(layout.children).forEach(c => {
                console.log('    -', c.className, 'size:', c.offsetWidth + 'x' + c.offsetHeight);
            });
        }

        const centerPanel = document.getElementById('vc2-center-panel');
        console.log('Center panel:', centerPanel ? `${centerPanel.offsetWidth}x${centerPanel.offsetHeight}` : 'NOT FOUND');

        const commentsContainer = document.getElementById('vc2-comments-container');
        console.log('Comments container:', commentsContainer ? commentsContainer.children.length + ' children' : 'NOT FOUND');

        const emojiStrip = document.getElementById('vc2-emoji-strip');
        console.log('Emoji strip:', emojiStrip ? emojiStrip.children.length + ' emojis' : 'NOT FOUND');

        console.log('state.session.reactions:', state.session?.reactions ? `Map(${state.session.reactions.size})` : 'null');
        console.log('state.vitality?.itemScores:', state.vitality?.itemScores ? `Map(${state.vitality.itemScores.size})` : 'null');
        console.log('=====================================');
        return 'Vitality Canvas v2 diagnostic complete.';
    };
    console.log('[VitalityCanvas v2] window.debugActionMenu() registered');
}
