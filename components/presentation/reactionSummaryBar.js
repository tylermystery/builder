/**
 * Reaction Summary Bar (RSB)
 * Consolidated reactions + comments + emoji picker for compact cards & detail modal.
 * Extracted from presentation.js — Phase 4A modularization.
 */

import { log } from '../../utils/debug.js';

// Module state
let activeRSBPanel = null;
let rsbLayoutMode = 'bar';
const RSB_INITIAL_TIERS = 2;
let rsbRadialTierIndex = 0;
let rsbReplyingTo = null;

const RSB_LAYOUTS = [
    { id: 'bar', label: 'Tiered Rows', icon: '☰', description: 'Classic tiered layout' },
    { id: 'radial-grid', label: 'Radial Grid', icon: '◎', description: 'Circular emoji arrangement' },
    { id: 'orbit', label: 'Orbit', icon: '◌', description: 'Animated orbital layout' },
    { id: 'minimal', label: 'Minimal', icon: '—', description: 'Quick row only' }
];

// Dependencies injected via init()
let _deps = null;

export function init(deps) {
    _deps = deps;
}

export function cleanup() {
    activeRSBPanel = null;
    rsbReplyingTo = null;
    document.removeEventListener('click', handleRSBOutsideClick);
    _deps = null;
}

export function getRSBLayout() {
    return document.body.dataset.rsbLayout || rsbLayoutMode || 'bar';
}

export function setRSBLayout(layout) {
    rsbLayoutMode = layout;
    document.body.dataset.rsbLayout = layout;
    if (activeRSBPanel) {
        const zone = activeRSBPanel;
        const recordId = zone.dataset.recordId;
        closeRSBPanel(zone);
        const oldPanel = zone.querySelector('.rsb-panel');
        if (oldPanel) oldPanel.remove();
        openRSBPanel(zone, recordId);
    }
    try { localStorage.setItem('rsb-layout', layout); } catch (_) {}
}

export function initRSBLayoutToggle() {
    try {
        const saved = localStorage.getItem('rsb-layout');
        if (saved && RSB_LAYOUTS.some(l => l.id === saved)) {
            rsbLayoutMode = saved;
            document.body.dataset.rsbLayout = saved;
        }
    } catch (_) {}

    if (document.querySelector('.rsb-layout-toggle-fab')) return;

    const fab = document.createElement('button');
    fab.className = 'rsb-layout-toggle-fab';
    fab.title = 'Switch reaction bar layout';
    fab.textContent = '⚙';
    fab.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleRSBLayoutPopup();
    });
    document.body.appendChild(fab);

    const popup = document.createElement('div');
    popup.className = 'rsb-layout-popup';
    popup.id = 'rsb-layout-popup';
    RSB_LAYOUTS.forEach(layout => {
        const item = document.createElement('button');
        item.className = `rsb-layout-popup-item${layout.id === getRSBLayout() ? ' active' : ''}`;
        item.dataset.layout = layout.id;
        item.innerHTML = `<span class="rsb-layout-popup-icon">${layout.icon}</span> ${layout.label}`;
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            setRSBLayout(layout.id);
            popup.querySelectorAll('.rsb-layout-popup-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            popup.classList.remove('visible');
        });
        popup.appendChild(item);
    });
    document.body.appendChild(popup);

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.rsb-layout-toggle-fab') && !e.target.closest('.rsb-layout-popup')) {
            popup.classList.remove('visible');
        }
    });
}

function toggleRSBLayoutPopup() {
    const popup = document.getElementById('rsb-layout-popup');
    if (popup) popup.classList.toggle('visible');
}

export function initializeReactionZones() {
    const itineraryItemsListEl = _deps.getItineraryItemsListEl();
    if (!itineraryItemsListEl) return;

    const zones = itineraryItemsListEl.querySelectorAll('.compact-card-reaction-zone[data-record-id]');
    zones.forEach(zone => {
        const recordId = zone.dataset.recordId;

        let hoverTimer = null;
        zone.addEventListener('mouseenter', () => {
            hoverTimer = setTimeout(() => {
                openRSBPanel(zone, recordId);
            }, 300);
        });

        zone.addEventListener('mouseleave', (e) => {
            clearTimeout(hoverTimer);
            const related = e.relatedTarget;
            if (related && (related.closest('.rsb-panel') || related.closest('.compact-card-reaction-zone'))) return;
            closeRSBPanel(zone);
        });

        const summary = zone.querySelector('.reaction-zone-summary');
        if (summary) {
            summary.addEventListener('click', (e) => {
                e.stopPropagation();
                const panel = zone.querySelector('.rsb-panel');
                if (panel && panel.classList.contains('visible')) {
                    closeRSBPanel(zone);
                } else {
                    openRSBPanel(zone, recordId);
                }
            });
        }

        const commentsBtn = zone.querySelector('.reaction-zone-comments-btn');
        if (commentsBtn) {
            commentsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const rid = commentsBtn.dataset.recordId;
                openRSBPanel(zone, rid, 'comments');
            });
        }
    });

    document.addEventListener('click', handleRSBOutsideClick);
    initRSBLayoutToggle();
}

function handleRSBOutsideClick(e) {
    if (activeRSBPanel && !e.target.closest('.compact-card-reaction-zone') && !e.target.closest('.rsb-panel')) {
        closeRSBPanel(activeRSBPanel);
    }
}

export function openRSBPanel(zone, recordId, activeTab) {
    if (activeRSBPanel && activeRSBPanel !== zone) {
        closeRSBPanel(activeRSBPanel);
    }

    let panel = zone.querySelector('.rsb-panel');
    if (!panel) {
        panel = buildRSBPanelDOM(recordId, false);
        zone.appendChild(panel);

        panel.addEventListener('mouseenter', () => { panel._keepOpen = true; });
        panel.addEventListener('mouseleave', (e) => {
            panel._keepOpen = false;
            const related = e.relatedTarget;
            if (!related || !related.closest('.compact-card-reaction-zone')) {
                closeRSBPanel(zone);
            }
        });
    } else {
        refreshRSBPanel(panel, recordId);
    }

    if (activeTab) switchRSBTab(panel, activeTab);

    requestAnimationFrame(() => { panel.classList.add('visible'); });
    activeRSBPanel = zone;
}

export function closeRSBPanel(zone) {
    if (!zone) return;
    const panel = zone.querySelector('.rsb-panel');
    if (panel && panel._keepOpen) return;
    if (panel) panel.classList.remove('visible');
    const summary = zone.querySelector('.reaction-zone-summary');
    if (summary) summary.classList.remove('previewing');
    if (activeRSBPanel === zone) activeRSBPanel = null;
    rsbReplyingTo = null;
}

function buildRSBPanelDOM(recordId, isModal) {
    const panel = document.createElement('div');
    panel.className = `rsb-panel${isModal ? ' rsb-panel--modal' : ''}`;
    panel.dataset.recordId = recordId;

    const tabs = document.createElement('div');
    tabs.className = 'rsb-tabs';

    const reactionCount = _deps.getItemReactionCount(recordId);
    const commentCacheKey = `item:${recordId}`;
    const comments = _deps.componentComments.getCache().get(commentCacheKey) || [];

    const tabConfigs = [
        { id: 'reactions', label: 'React', badge: '' },
        { id: 'summary', label: 'Summary', badge: reactionCount > 0 ? reactionCount : '' },
        { id: 'comments', label: 'Comments', badge: comments.length > 0 ? comments.length : '' }
    ];

    tabConfigs.forEach((tc, idx) => {
        const tab = document.createElement('button');
        tab.className = `rsb-tab${idx === 0 ? ' active' : ''}`;
        tab.dataset.tab = tc.id;
        tab.innerHTML = `${tc.label}${tc.badge ? `<span class="rsb-tab-badge">${tc.badge}</span>` : ''}`;
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            switchRSBTab(panel, tc.id);
        });
        tabs.appendChild(tab);
    });
    panel.appendChild(tabs);

    const reactionsContent = document.createElement('div');
    reactionsContent.className = 'rsb-tab-content active';
    reactionsContent.dataset.tabContent = 'reactions';
    buildRSBReactionsContent(reactionsContent, recordId, isModal);
    panel.appendChild(reactionsContent);

    const summaryContent = document.createElement('div');
    summaryContent.className = 'rsb-tab-content';
    summaryContent.dataset.tabContent = 'summary';
    buildRSBSummaryContent(summaryContent, recordId);
    panel.appendChild(summaryContent);

    const commentsContent = document.createElement('div');
    commentsContent.className = 'rsb-tab-content';
    commentsContent.dataset.tabContent = 'comments';
    buildRSBCommentsContent(commentsContent, recordId);
    panel.appendChild(commentsContent);

    return panel;
}

function switchRSBTab(panel, tabId) {
    panel.querySelectorAll('.rsb-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabId);
    });
    panel.querySelectorAll('.rsb-tab-content').forEach(c => {
        c.classList.toggle('active', c.dataset.tabContent === tabId);
    });
}

function buildRSBReactionsContent(container, recordId, isModal) {
    container.innerHTML = '';
    const layout = getRSBLayout();

    const toggleRow = document.createElement('div');
    toggleRow.className = 'rsb-layout-toggle';
    RSB_LAYOUTS.forEach(l => {
        const btn = document.createElement('button');
        btn.className = `rsb-layout-btn${l.id === layout ? ' active' : ''}`;
        btn.title = l.description;
        btn.textContent = l.icon;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            setRSBLayout(l.id);
        });
        toggleRow.appendChild(btn);
    });
    container.appendChild(toggleRow);

    let currentUserEmoji = null;
    try {
        const user = _deps.getCurrentUser();
        const state = _deps.getState();
        const reactions = state.session.reactions?.get(recordId);
        if (reactions instanceof Map) currentUserEmoji = reactions.get(user.id);
    } catch (_) {}

    const emojiLayout = document.createElement('div');
    emojiLayout.className = 'rsb-emoji-layout';

    switch (layout) {
        case 'radial-grid':
            buildRSBRadialGrid(emojiLayout, recordId, currentUserEmoji, isModal);
            break;
        case 'orbit':
            buildRSBOrbit(emojiLayout, recordId, currentUserEmoji, isModal);
            break;
        case 'minimal':
            buildRSBMinimal(emojiLayout, recordId, currentUserEmoji);
            break;
        default:
            buildRSBTieredRows(emojiLayout, recordId, currentUserEmoji);
            break;
    }

    container.appendChild(emojiLayout);
}

function buildRSBTieredRows(container, recordId, currentUserEmoji) {
    const tiersEl = document.createElement('div');
    tiersEl.className = 'rsb-emoji-tiers';

    const tiers = _deps.EMOJI_TIERS;
    const initialCount = Math.min(RSB_INITIAL_TIERS, tiers.length);

    for (let i = 0; i < initialCount; i++) {
        tiersEl.appendChild(buildRSBTierRow(tiers[i], recordId, currentUserEmoji));
    }

    if (tiers.length > initialCount) {
        const expandBtn = document.createElement('div');
        expandBtn.className = 'rsb-expand-more';
        expandBtn.textContent = `Show ${tiers.length - initialCount} more tiers...`;
        expandBtn.dataset.expanded = 'false';
        expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (expandBtn.dataset.expanded === 'false') {
                for (let i = initialCount; i < tiers.length; i++) {
                    tiersEl.insertBefore(buildRSBTierRow(tiers[i], recordId, currentUserEmoji), expandBtn);
                }
                expandBtn.textContent = 'Show fewer';
                expandBtn.dataset.expanded = 'true';
            } else {
                const rows = tiersEl.querySelectorAll('.rsb-emoji-tier');
                for (let i = rows.length - 1; i >= initialCount; i--) rows[i].remove();
                expandBtn.textContent = `Show ${tiers.length - initialCount} more tiers...`;
                expandBtn.dataset.expanded = 'false';
            }
        });
        tiersEl.appendChild(expandBtn);
    }

    container.appendChild(tiersEl);
}

function buildRSBTierRow(tier, recordId, currentUserEmoji) {
    const row = document.createElement('div');
    row.className = 'rsb-emoji-tier';

    const label = document.createElement('div');
    label.className = 'rsb-emoji-tier-label';
    label.innerHTML = `${tier.label} <span class="rsb-emoji-tier-hint">${tier.description}</span>`;
    row.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'rsb-emoji-tier-grid';
    tier.emojis.forEach(emoji => {
        grid.appendChild(buildRSBEmojiButton(emoji, recordId, currentUserEmoji));
    });
    row.appendChild(grid);
    return row;
}

function buildRSBEmojiButton(emoji, recordId, currentUserEmoji) {
    const btn = document.createElement('button');
    const isSelected = currentUserEmoji instanceof Set ? currentUserEmoji.has(emoji) : currentUserEmoji === emoji;
    btn.className = `rsb-emoji-btn${isSelected ? ' selected' : ''}`;
    btn.textContent = emoji;
    btn.dataset.emoji = emoji;
    btn.dataset.recordId = recordId;
    const score = _deps.REACTION_SCORES[emoji] || 0;
    btn.dataset.scoreLabel = `${score >= 0 ? '+' : ''}${score.toFixed(1)}`;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleRSBEmojiSelect(recordId, emoji, btn);
    });
    btn.addEventListener('mouseenter', () => { handleRSBEmojiPreview(recordId, emoji); });
    btn.addEventListener('mouseleave', () => { clearRSBEmojiPreview(recordId); });

    return btn;
}

function buildRSBRadialGrid(container, recordId, currentUserEmoji, isModal) {
    const radial = document.createElement('div');
    radial.className = 'rsb-radial-container';

    const center = document.createElement('div');
    center.className = 'rsb-radial-center';
    const summaryEmoji = _deps.getItemSummaryEmoji(recordId) || '😊';
    const reactions = _deps.getAggregateReactions(recordId);
    let avgScore = 0;
    if (reactions && reactions instanceof Map && reactions.size > 0) {
        const { democraticAverage } = _deps.computeDemocraticAverage(reactions);
        avgScore = democraticAverage;
    }
    center.innerHTML = `
        <span class="rsb-radial-center-emoji">${summaryEmoji}</span>
        <span class="rsb-radial-center-score">${avgScore !== 0 ? (avgScore >= 0 ? '+' : '') + avgScore.toFixed(1) : ''}</span>
    `;
    radial.appendChild(center);

    const tiers = _deps.EMOJI_TIERS;
    const innerTier = tiers[rsbRadialTierIndex] || tiers[0];
    const outerTier = tiers[Math.min(rsbRadialTierIndex + 1, tiers.length - 1)] || tiers[0];

    const ring1 = document.createElement('div');
    ring1.className = 'rsb-radial-ring';
    ring1.dataset.ring = '1';
    const r1 = 65;
    innerTier.emojis.forEach((emoji, i) => {
        const angle = (i / innerTier.emojis.length) * Math.PI * 2 - Math.PI / 2;
        const btn = buildRSBEmojiButton(emoji, recordId, currentUserEmoji);
        const x = Math.cos(angle) * r1;
        const y = Math.sin(angle) * r1;
        btn.style.left = `calc(50% + ${x}px - 18px)`;
        btn.style.top = `calc(50% + ${y}px - 18px)`;
        ring1.appendChild(btn);
    });
    radial.appendChild(ring1);

    if (outerTier !== innerTier) {
        const ring2 = document.createElement('div');
        ring2.className = 'rsb-radial-ring';
        ring2.dataset.ring = '2';
        const r2 = 100;
        outerTier.emojis.slice(0, 12).forEach((emoji, i) => {
            const count = Math.min(outerTier.emojis.length, 12);
            const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
            const btn = buildRSBEmojiButton(emoji, recordId, currentUserEmoji);
            const x = Math.cos(angle) * r2;
            const y = Math.sin(angle) * r2;
            btn.style.left = `calc(50% + ${x}px - 14px)`;
            btn.style.top = `calc(50% + ${y}px - 14px)`;
            ring2.appendChild(btn);
        });
        radial.appendChild(ring2);
    }

    const navPrev = document.createElement('button');
    navPrev.className = 'rsb-radial-nav';
    navPrev.textContent = '◀';
    navPrev.style.cssText = 'left: 4px; top: 50%; transform: translateY(-50%);';
    navPrev.title = 'Previous tier';
    navPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        rsbRadialTierIndex = Math.max(0, rsbRadialTierIndex - 1);
        rebuildRSBReactionsContent(container.closest('.rsb-tab-content') || container.closest('[data-tab-content="reactions"]'), recordId, isModal);
    });

    const navNext = document.createElement('button');
    navNext.className = 'rsb-radial-nav';
    navNext.textContent = '▶';
    navNext.style.cssText = 'right: 4px; top: 50%; transform: translateY(-50%);';
    navNext.title = 'Next tier';
    navNext.addEventListener('click', (e) => {
        e.stopPropagation();
        rsbRadialTierIndex = Math.min(tiers.length - 2, rsbRadialTierIndex + 1);
        rebuildRSBReactionsContent(container.closest('.rsb-tab-content') || container.closest('[data-tab-content="reactions"]'), recordId, isModal);
    });

    radial.appendChild(navPrev);
    radial.appendChild(navNext);

    const tierLabel = document.createElement('div');
    tierLabel.className = 'rsb-emoji-tier-label';
    tierLabel.style.textAlign = 'center';
    tierLabel.style.justifyContent = 'center';
    tierLabel.innerHTML = `${innerTier.label} <span class="rsb-emoji-tier-hint">(${rsbRadialTierIndex + 1}/${tiers.length})</span>`;
    radial.appendChild(tierLabel);

    container.appendChild(radial);
}

function buildRSBOrbit(container, recordId, currentUserEmoji, isModal) {
    const orbit = document.createElement('div');
    orbit.className = 'rsb-orbit-container';

    const center = document.createElement('div');
    center.className = 'rsb-radial-center';
    const summaryEmoji = _deps.getItemSummaryEmoji(recordId) || '😊';
    center.innerHTML = `<span class="rsb-radial-center-emoji">${summaryEmoji}</span>`;
    orbit.appendChild(center);

    const tiers = _deps.EMOJI_TIERS;
    const track1 = document.createElement('div');
    track1.className = 'rsb-orbit-track';
    track1.dataset.track = '1';
    const t1Emojis = tiers[0].emojis;
    t1Emojis.forEach((emoji, i) => {
        const angle = (i / t1Emojis.length) * 360;
        const btn = buildRSBEmojiButton(emoji, recordId, currentUserEmoji);
        btn.style.left = '50%';
        btn.style.top = '0';
        btn.style.transform = `rotate(${angle}deg) translateY(-75px) rotate(-${angle}deg)`;
        track1.appendChild(btn);
    });
    orbit.appendChild(track1);

    if (tiers.length > 1) {
        const track2 = document.createElement('div');
        track2.className = 'rsb-orbit-track';
        track2.dataset.track = '2';
        const t2Emojis = tiers[1].emojis.slice(0, 10);
        t2Emojis.forEach((emoji, i) => {
            const angle = (i / t2Emojis.length) * 360;
            const btn = buildRSBEmojiButton(emoji, recordId, currentUserEmoji);
            btn.style.left = '50%';
            btn.style.top = '0';
            btn.style.transform = `rotate(${angle}deg) translateY(-110px) rotate(-${angle}deg)`;
            track2.appendChild(btn);
        });
        orbit.appendChild(track2);
    }

    container.appendChild(orbit);
}

function buildRSBMinimal(container, recordId, currentUserEmoji) {
    const row = document.createElement('div');
    row.className = 'rsb-minimal-row';

    const quickEmojis = _deps.EMOJI_TIERS[0].emojis;
    quickEmojis.forEach(emoji => {
        row.appendChild(buildRSBEmojiButton(emoji, recordId, currentUserEmoji));
    });

    container.appendChild(row);
}

function rebuildRSBReactionsContent(contentEl, recordId, isModal) {
    if (!contentEl) return;
    buildRSBReactionsContent(contentEl, recordId, isModal);
}

function buildRSBSummaryContent(container, recordId) {
    container.innerHTML = '';

    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'rsb-reaction-summary';

    const reactions = _deps.getAggregateReactions(recordId);
    try {
        const commentReactions = _deps.getComponentMessageReactions(recordId);
        if (commentReactions && commentReactions.size > 0) {
            for (const [userId, emojiSet] of commentReactions) {
                if (!reactions.has(userId)) reactions.set(userId, new Set());
                const userSet = reactions.get(userId);
                for (const emoji of emojiSet) userSet.add(emoji);
            }
        }
    } catch (e) {}

    if (!reactions || reactions.size === 0) {
        summaryDiv.innerHTML = '<div class="rsb-summary-empty">No reactions yet — react to be the first!</div>';
        container.appendChild(summaryDiv);
        return;
    }

    const emojiCounts = {};
    let totalEmojiCount = 0;
    reactions.forEach((emojiData) => {
        const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
        for (const emoji of emojis) {
            emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1;
            totalEmojiCount++;
        }
    });
    const { democraticAverage: avg, summaryEmoji: democraticEmoji } = _deps.computeDemocraticAverage(reactions);

    const pillsDiv = document.createElement('div');
    pillsDiv.className = 'rsb-summary-pills';
    const sorted = Object.entries(emojiCounts).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([emoji, count]) => {
        const score = _deps.REACTION_SCORES[emoji] || 0;
        const pill = document.createElement('span');
        pill.className = 'rsb-summary-pill';
        pill.innerHTML = `
            <span class="rsb-summary-pill-emoji">${emoji}</span>
            <span class="rsb-summary-pill-count">${count}</span>
            <span class="rsb-summary-pill-score">${score >= 0 ? '+' : ''}${score.toFixed(1)}</span>
        `;
        pillsDiv.appendChild(pill);
    });
    summaryDiv.appendChild(pillsDiv);

    const state = _deps.getState();
    const whoDiv = document.createElement('div');
    whoDiv.className = 'rsb-summary-who';
    const userNames = [];
    reactions.forEach((emojiData, userId) => {
        const name = state.session.userProfiles?.get(userId) || 'Someone';
        const emojiStr = emojiData instanceof Set ? Array.from(emojiData).join('') : emojiData;
        userNames.push(`${name} ${emojiStr}`);
    });
    const whoText = userNames.length <= 3
        ? userNames.join(', ')
        : `${userNames.slice(0, 2).join(', ')} & ${userNames.length - 2} more`;
    whoDiv.textContent = whoText;
    summaryDiv.appendChild(whoDiv);

    const avgDiv = document.createElement('div');
    avgDiv.className = 'rsb-summary-avg';
    avgDiv.innerHTML = `
        <span class="rsb-summary-avg-emoji">${democraticEmoji}</span>
        <span class="rsb-summary-avg-label">Average Sentiment</span>
        <span class="rsb-summary-avg-score">${avg >= 0 ? '+' : ''}${avg.toFixed(2)}</span>
    `;
    summaryDiv.appendChild(avgDiv);

    container.appendChild(summaryDiv);
}

function buildRSBCommentsContent(container, recordId) {
    container.innerHTML = '';

    const section = document.createElement('div');
    section.className = 'rsb-comments-section';

    const cacheKey = `item:${recordId}`;
    const comments = _deps.componentComments.getCache().get(cacheKey) || [];
    const escapeHtml = _deps.escapeHtml;

    const list = document.createElement('div');
    list.className = 'rsb-comments-list';

    if (comments.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'rsb-comments-empty';
        empty.textContent = 'No comments yet. Start the conversation!';
        list.appendChild(empty);
    } else {
        comments.forEach(comment => {
            const commentEl = document.createElement('div');
            commentEl.className = 'rsb-comment';
            const author = comment.fields?.SenderName || comment.senderName || 'Someone';
            const content = comment.fields?.Content || comment.content || '';
            const time = comment.fields?.CreatedTime || comment.createdTime || '';
            let timeStr = '';
            if (time) {
                try {
                    const d = new Date(time);
                    timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                } catch (_) {}
            }

            commentEl.innerHTML = `
                <span class="rsb-comment-author">${escapeHtml(author)}</span>
                <span class="rsb-comment-text">${escapeHtml(content)}</span>
                ${timeStr ? `<span class="rsb-comment-time">${timeStr}</span>` : ''}
                <button class="rsb-comment-reply-btn" data-author="${escapeHtml(author)}">↩</button>
            `;

            const replyBtn = commentEl.querySelector('.rsb-comment-reply-btn');
            if (replyBtn) {
                replyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    rsbReplyingTo = { author, commentId: comment.id };
                    const replyIndicator = container.querySelector('.rsb-comment-reply-indicator');
                    if (replyIndicator) {
                        replyIndicator.style.display = 'flex';
                        replyIndicator.querySelector('span').textContent = `Replying to ${author}`;
                    }
                    const input = container.querySelector('.rsb-comment-input');
                    if (input) input.focus();
                });
            }

            list.appendChild(commentEl);
        });
        requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    }
    section.appendChild(list);

    const replyIndicator = document.createElement('div');
    replyIndicator.className = 'rsb-comment-reply-indicator';
    replyIndicator.style.display = 'none';
    replyIndicator.innerHTML = `
        <span>Replying to ...</span>
        <button class="rsb-comment-reply-cancel">✕</button>
    `;
    replyIndicator.querySelector('.rsb-comment-reply-cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        rsbReplyingTo = null;
        replyIndicator.style.display = 'none';
    });
    section.appendChild(replyIndicator);

    const inputRow = document.createElement('div');
    inputRow.className = 'rsb-comment-input-row';

    const input = document.createElement('textarea');
    input.className = 'rsb-comment-input';
    input.placeholder = 'Add a comment...';
    input.rows = 1;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitRSBComment(recordId, container);
        }
    });
    inputRow.appendChild(input);

    const submitBtn = document.createElement('button');
    submitBtn.className = 'rsb-comment-submit-btn';
    submitBtn.textContent = '→';
    submitBtn.title = 'Send';
    submitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        submitRSBComment(recordId, container);
    });
    inputRow.appendChild(submitBtn);
    section.appendChild(inputRow);

    const openFullBtn = document.createElement('button');
    openFullBtn.className = 'rsb-open-full-btn';
    openFullBtn.textContent = 'Open Full Conversation →';
    openFullBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _deps.openConversationForItem(recordId);
    });
    section.appendChild(openFullBtn);

    container.appendChild(section);
}

async function submitRSBComment(recordId, container) {
    const input = container.querySelector('.rsb-comment-input');
    if (!input) return;

    let content = input.value.trim();
    if (!content) return;

    const state = _deps.getState();
    const sessionId = state.session.id;
    let currentUser;
    try { currentUser = _deps.getCurrentUser(); } catch (_) { return; }
    if (!sessionId || !currentUser) return;

    if (rsbReplyingTo) {
        content = `@${rsbReplyingTo.author}: ${content}`;
    }

    input.disabled = true;

    try {
        await _deps.api.postComponentComment(
            sessionId,
            _deps.api.COMPONENT_TYPES.ITEM,
            recordId,
            currentUser.id,
            currentUser.name || currentUser.email || 'Anonymous',
            content,
            rsbReplyingTo?.commentId || null
        );

        input.value = '';
        rsbReplyingTo = null;
        const replyIndicator = container.querySelector('.rsb-comment-reply-indicator');
        if (replyIndicator) replyIndicator.style.display = 'none';

        const cacheKey = `item:${recordId}`;
        const freshComments = await _deps.api.fetchComponentComments(sessionId, _deps.api.COMPONENT_TYPES.ITEM, recordId);
        _deps.componentComments.getCache().set(cacheKey, freshComments);
        buildRSBCommentsContent(container, recordId);

        const zone = document.querySelector(`.compact-card-reaction-zone[data-record-id="${recordId}"]`);
        if (zone) {
            const countEl = zone.querySelector('.reaction-zone-comments-btn span:last-child');
            if (countEl) countEl.textContent = freshComments.length || '';
        }

        const panel = container.closest('.rsb-panel');
        if (panel) {
            const commentsTab = panel.querySelector('.rsb-tab[data-tab="comments"]');
            if (commentsTab) {
                const badge = commentsTab.querySelector('.rsb-tab-badge');
                if (badge) badge.textContent = freshComments.length;
                else if (freshComments.length > 0) {
                    commentsTab.innerHTML += `<span class="rsb-tab-badge">${freshComments.length}</span>`;
                }
            }
        }
    } catch (err) {
        log('RSB', `Error posting comment: ${err.message}`);
        _deps.showToast('Failed to post comment. Please try again.', 'error');
    } finally {
        input.disabled = false;
        input.focus();
    }
}

export function handleRSBEmojiSelect(recordId, emoji, btn) {
    _deps.selectEmoji(recordId, emoji);

    let currentUserSet = null;
    try {
        const user = _deps.getCurrentUser();
        const state = _deps.getState();
        const reactions = state.session.reactions?.get(recordId);
        if (reactions instanceof Map) currentUserSet = reactions.get(user.id);
    } catch (_) {}
    document.querySelectorAll(`.rsb-emoji-btn[data-record-id="${recordId}"]`).forEach(b => {
        const isInSet = currentUserSet instanceof Set ? currentUserSet.has(b.dataset.emoji) : false;
        b.classList.toggle('selected', isInSet);
    });

    const zone = document.querySelector(`.compact-card-reaction-zone[data-record-id="${recordId}"]`);
    if (zone) {
        const panel = zone.querySelector('.rsb-panel');
        if (panel) refreshRSBPanel(panel, recordId);
    }

    const modalPanel = document.querySelector('.rsb-panel--modal[data-record-id="' + recordId + '"]');
    if (modalPanel) refreshRSBPanel(modalPanel, recordId);

    updateReactionZoneSummary(recordId);
}

export function handleRSBEmojiPreview(recordId, emoji) {
    const zone = document.querySelector(`.compact-card-reaction-zone[data-record-id="${recordId}"]`);
    if (!zone) return;

    const summaryEl = zone.querySelector('.reaction-zone-summary');
    const emojiEl = zone.querySelector('.reaction-zone-summary-emoji');
    const textEl = zone.querySelector('.reaction-zone-summary-text');
    const scoreEl = zone.querySelector('.reaction-zone-summary-score');
    if (!summaryEl) return;

    const previewData = calculateReactionPreview(recordId, emoji);

    summaryEl.classList.add('previewing');
    if (emojiEl) emojiEl.textContent = previewData.summaryEmoji;
    if (textEl) textEl.textContent = `Preview: ${emoji} → ${previewData.summaryEmoji}`;
    if (scoreEl) scoreEl.textContent = `${previewData.average >= 0 ? '+' : ''}${previewData.average.toFixed(1)}`;
}

export function clearRSBEmojiPreview(recordId) {
    const zone = document.querySelector(`.compact-card-reaction-zone[data-record-id="${recordId}"]`);
    if (!zone) return;
    const summaryEl = zone.querySelector('.reaction-zone-summary');
    if (!summaryEl) return;
    summaryEl.classList.remove('previewing');
    updateReactionZoneSummary(recordId);
}

export function calculateReactionPreview(recordId, previewEmojiValue) {
    const state = _deps.getState();
    const reactions = state.session.reactions?.get(recordId);

    let currentUser;
    try { currentUser = _deps.getCurrentUser(); }
    catch (_) { currentUser = { id: 'anonymous', name: 'Anonymous' }; }

    const tempReactions = new Map();
    if (reactions && reactions instanceof Map) {
        for (const [userId, emojiData] of reactions) {
            const emojiSet = emojiData instanceof Set ? new Set(emojiData) : new Set([emojiData]);
            tempReactions.set(userId, emojiSet);
        }
    }

    if (!tempReactions.has(currentUser.id)) tempReactions.set(currentUser.id, new Set());
    const userSet = tempReactions.get(currentUser.id);
    const isToggleOff = userSet.has(previewEmojiValue);
    if (isToggleOff) userSet.delete(previewEmojiValue);
    else userSet.add(previewEmojiValue);
    if (userSet.size === 0) tempReactions.delete(currentUser.id);

    const { democraticAverage, summaryEmoji, totalReactions } = _deps.computeDemocraticAverage(tempReactions);

    return { count: totalReactions, total: democraticAverage * tempReactions.size, average: democraticAverage, summaryEmoji, isToggleOff };
}

export function updateReactionZoneSummary(recordId) {
    const zone = document.querySelector(`.compact-card-reaction-zone[data-record-id="${recordId}"]`);
    if (!zone) return;

    const emojiEl = zone.querySelector('.reaction-zone-summary-emoji');
    const textEl = zone.querySelector('.reaction-zone-summary-text');
    const scoreEl = zone.querySelector('.reaction-zone-summary-score');

    const reactions = _deps.getAggregateReactions(recordId);
    try {
        const commentReactions = _deps.getComponentMessageReactions(recordId);
        if (commentReactions && commentReactions.size > 0) {
            for (const [userId, emojiSet] of commentReactions) {
                if (!reactions.has(userId)) reactions.set(userId, new Set());
                const userSet = reactions.get(userId);
                for (const emoji of emojiSet) userSet.add(emoji);
            }
        }
    } catch (e) {}

    let summaryEmoji = '😊';
    let summaryText = 'React';
    let scoreText = '';

    if (reactions && reactions instanceof Map && reactions.size > 0) {
        const { democraticAverage, summaryEmoji: bestEmoji, totalReactions } = _deps.computeDemocraticAverage(reactions);
        const emojiCounts = {};
        reactions.forEach((emojiData) => {
            const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
            for (const emoji of emojis) emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1;
        });
        summaryEmoji = bestEmoji;
        scoreText = `${democraticAverage >= 0 ? '+' : ''}${democraticAverage.toFixed(1)}`;
        const sorted = Object.entries(emojiCounts).sort((a, b) => b[1] - a[1]);
        const top3 = sorted.slice(0, 3).map(([emoji, count]) => `${emoji}${count > 1 ? count : ''}`).join(' ');
        summaryText = `${totalReactions} reaction${totalReactions !== 1 ? 's' : ''} ${top3}`;
    }

    if (emojiEl) emojiEl.textContent = summaryEmoji;
    if (textEl) textEl.textContent = summaryText;
    if (scoreEl) {
        scoreEl.textContent = scoreText;
        scoreEl.style.display = scoreText ? '' : 'none';
    }
}

export function refreshRSBPanel(panel, recordId) {
    const reactionCount = _deps.getItemReactionCount(recordId);
    const cacheKey = `item:${recordId}`;
    const comments = _deps.componentComments.getCache().get(cacheKey) || [];

    const summaryTab = panel.querySelector('.rsb-tab[data-tab="summary"]');
    const commentsTab = panel.querySelector('.rsb-tab[data-tab="comments"]');
    if (summaryTab) {
        let badge = summaryTab.querySelector('.rsb-tab-badge');
        if (reactionCount > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'rsb-tab-badge';
                summaryTab.appendChild(badge);
            }
            badge.textContent = reactionCount;
        } else if (badge) badge.remove();
    }
    if (commentsTab) {
        let badge = commentsTab.querySelector('.rsb-tab-badge');
        if (comments.length > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'rsb-tab-badge';
                commentsTab.appendChild(badge);
            }
            badge.textContent = comments.length;
        } else if (badge) badge.remove();
    }

    const activeContent = panel.querySelector('.rsb-tab-content.active');
    if (activeContent) {
        const tabId = activeContent.dataset.tabContent;
        const isModal = panel.classList.contains('rsb-panel--modal');
        switch (tabId) {
            case 'reactions': buildRSBReactionsContent(activeContent, recordId, isModal); break;
            case 'summary': buildRSBSummaryContent(activeContent, recordId); break;
            case 'comments': buildRSBCommentsContent(activeContent, recordId); break;
        }
    }
}

export function buildModalRSBPanel(recordId) {
    const panel = buildRSBPanelDOM(recordId, true);
    panel.classList.add('visible');
    return panel;
}
