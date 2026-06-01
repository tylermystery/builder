/**
 * Public Community Catalog ("Public Ideas")
 * -----------------------------------------
 * Front-end glue for the Postgres-backed public layer. It does three things:
 *
 *   1. Loads a store's public items and injects them into the normal catalog
 *      pipeline as records carrying a new "Public Idea" status, so they flow
 *      through the existing filter/render machinery. They are hidden under the
 *      default "Available" filter and surfaced via the "Public Ideas" filter (or
 *      "Show All"); the long-term plan is to merge them fully into the catalog.
 *
 *   2. Publishes newly added AI / custom items to the public layer on add
 *      (publish-on-add), for signed-in users.
 *
 *   3. Renders public reactions and comments for a public-idea item inside the
 *      detail modal, reusing the existing reaction emoji set and accordion look.
 *      These are GLOBAL per item (everyone sees the same thread) — distinct from
 *      the per-plan reactions/comments that the plan view continues to use.
 *
 * Writes (react / comment / publish) require a signed-in user; guests are
 * prompted to sign in. Reads are open to everyone.
 */

import { state, getRecordById, invalidateRecordsIndex } from '../state.js';
import * as api from '../api.js';
import { EMOJI_REACTIONS } from '../config.js';
import { showUserModal } from '../auth.js';
import { log } from '../utils/debug.js';

export const PUBLIC_IDEA_STATUS = 'Public Idea';

// recordId (e.g. "public-12") -> the raw public row from the API, including its
// summarised reactions / comments / variations. Kept in sync as the user reacts
// and comments so the modal can re-render without a full refetch.
const publicIdeaIndex = new Map();

// True for a catalog record that originated from the public layer.
export function isPublicIdeaRecord(record) {
    return !!(record && (record.isPublicIdea || (typeof record.id === 'string' && record.id.startsWith('public-'))));
}

function publicRecordId(row) {
    return `public-${row.id}`;
}

// Turn a public-layer row into a catalog record the existing UI can render.
// When the row preserved the full original record (the backfill stores it under
// `data`), we start from that so options/images/details render faithfully, then
// override identity + status. Otherwise we synthesise a minimal record.
function transformPublicRowToRecord(row, storeId) {
    const id = publicRecordId(row);
    let record;

    const original = row.data && typeof row.data === 'object' ? row.data : null;
    if (original && original.fields) {
        // Clone so we never mutate the cached API payload.
        record = JSON.parse(JSON.stringify(original));
        record.fields = record.fields || {};
    } else {
        record = { fields: {} };
    }

    record.id = id;
    const f = record.fields;
    f.Name = row.name || f.Name || 'Untitled idea';
    if (row.description) f.Description = row.description;
    if (row.imageUrl && !f['Curated Images']) f.imageUrl = row.imageUrl;
    if (row.price != null && f.Price == null) f.Price = row.price;
    f.Status = PUBLIC_IDEA_STATUS;
    // Anchor to the originating store so the store-scoped catalog filter includes it.
    f.Stores = [storeId];
    if (!f['Item Type']) f['Item Type'] = 'Bookable Item';

    record.isPublicIdea = true;
    record.publicItemId = row.id;
    record.publicSource = row.source || 'custom';
    record.publicImageUrl = row.imageUrl || null;

    return record;
}

// Replace any previously injected public-idea records for this store with `rows`,
// keeping the rest of state.records.all untouched.
function injectPublicRecords(rows, storeId) {
    const fresh = new Set(rows.map(publicRecordId));

    // Drop stale public records that belonged to this store (by store match) and
    // are no longer present, so re-loads don't accumulate duplicates.
    state.records.all = state.records.all.filter(r => {
        if (!isPublicIdeaRecord(r)) return true;
        const belongsToStore = r.fields && Array.isArray(r.fields.Stores) && r.fields.Stores.includes(storeId);
        if (!belongsToStore) return true;
        return fresh.has(r.id); // keep only ones we're about to refresh below
    });

    publicIdeaIndex.clear();
    for (const row of rows) {
        const record = transformPublicRowToRecord(row, storeId);
        publicIdeaIndex.set(record.id, row);
        const existingIdx = state.records.all.findIndex(r => r.id === record.id);
        if (existingIdx >= 0) state.records.all[existingIdx] = record;
        else state.records.all.push(record);
    }
    invalidateRecordsIndex();
}

// Inject (or refresh) a single public-layer row into the live catalog without
// clearing the rest of the index. Used by publish-on-add so a freshly created
// public idea appears immediately under the "Public Ideas" filter and its
// reactions/comments panel can render right away — no page reload required.
function injectOnePublicRow(row, storeId) {
    const record = transformPublicRowToRecord(row, storeId);
    publicIdeaIndex.set(record.id, row);
    const existingIdx = state.records.all.findIndex(r => r.id === record.id);
    if (existingIdx >= 0) state.records.all[existingIdx] = record;
    else state.records.all.push(record);
    invalidateRecordsIndex();
    return record;
}

/**
 * Fetch the public ideas for a store and inject them into the catalog, then
 * re-run the filter/render pipeline. Fire-and-forget safe: never throws, and a
 * failure leaves the existing catalog exactly as it was.
 */
export async function loadPublicIdeasForStore(storeId) {
    if (!storeId) return;
    try {
        const rows = await api.getPublicCatalog(storeId);
        if (!Array.isArray(rows) || rows.length === 0) {
            log('PublicCatalog', `No public ideas for store ${storeId}`);
            return;
        }
        injectPublicRecords(rows, storeId);
        log('PublicCatalog', `Injected ${rows.length} public idea(s) for store ${storeId}`);
        if (typeof window.applyFiltersAndSort === 'function') {
            window.applyFiltersAndSort(window.imageCache);
        }
    } catch (error) {
        console.error('[PublicCatalog] loadPublicIdeasForStore error:', error);
    }
}

/**
 * Publish-on-add: when a signed-in user adds a new AI / custom / manual item, mirror
 * it into the public layer so others can discover, react to, and comment on it.
 * No-op for guests (the item still lives in their own plan) and for records that
 * are already public ideas. Fire-and-forget.
 */
export async function publishItemToPublicLayer(record, source = 'custom') {
    if (!record || isPublicIdeaRecord(record)) return;
    if (!state.session?.user?.isAuthenticated) return;
    try {
        const fields = record.fields || {};
        const storeId = state.ui.activeShopId;
        const created = await api.createPublicItem({
            storeId,
            source,
            name: fields.Name || 'Untitled item',
            description: fields.Description || '',
            imageUrl: fields.imageUrl || record.publicImageUrl || null,
            price: fields.Price != null ? String(fields.Price) : null,
            data: record,
            originSessionId: state.session?.id || null,
            originItemId: record.id || null
        });
        if (created) {
            log('PublicCatalog', `Published item to public layer: ${record.id}`);
            // Surface it in the catalog immediately (as a "Public Idea" record) and
            // register it in the reactions index so its detail-modal panel works,
            // then re-run the filter/render pipeline. Without this the new idea only
            // appeared after a full page reload.
            injectOnePublicRow(created, created.storeId || storeId);
            if (typeof window.applyFiltersAndSort === 'function') {
                window.applyFiltersAndSort(window.imageCache);
            }
        }
    } catch (error) {
        console.error('[PublicCatalog] publishItemToPublicLayer error:', error);
    }
}

// --- Detail-modal reactions & comments for public-idea items ---------------

function currentUser() {
    const u = state.session?.user || {};
    return { id: u.id, name: u.name || 'You', isAuthenticated: !!u.isAuthenticated };
}

// Promote the user to sign in for any public write. Returns true if already signed in.
function requireSignIn() {
    if (state.session?.user?.isAuthenticated) return true;
    try { showUserModal(); } catch (_) {}
    return false;
}

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Render the public reactions + comments accordion for a public-idea record into
 * the modal's reactions section. Mirrors the look of the normal modal reaction
 * accordion but is backed entirely by the public API.
 */
export function renderPublicReactions(section, record) {
    const row = publicIdeaIndex.get(record.id);
    if (!row) { section.style.display = 'none'; return; }

    section.style.display = 'block';
    section.className = 'modal-reactions-section modal-rsb-host public-reactions-host';

    const reactionTotal = Object.values(row.reactions || {}).reduce((sum, r) => sum + (r.count || 0), 0);
    const commentCount = (row.comments || []).length;

    const summaryParts = [];
    if (reactionTotal > 0) {
        const top = Object.entries(row.reactions || {})
            .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
            .slice(0, 3).map(([e]) => e).join('');
        summaryParts.push(`${top} ${reactionTotal} reaction${reactionTotal !== 1 ? 's' : ''}`);
    }
    if (commentCount > 0) summaryParts.push(`💬 ${commentCount} comment${commentCount !== 1 ? 's' : ''}`);
    const summaryText = summaryParts.length ? summaryParts.join(' · ') : 'React & Comment on this community idea';

    section.innerHTML = '';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'modal-rsb-accordion-header expanded';
    header.innerHTML = `
        <span class="modal-rsb-accordion-chevron">▾</span>
        <span class="modal-rsb-accordion-summary">${escapeHtml(summaryText)}</span>
        <span class="public-reactions-tag">Community</span>
    `;

    const body = document.createElement('div');
    body.className = 'modal-rsb-accordion-body expanded public-reactions-body';

    header.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = body.classList.toggle('expanded');
        header.classList.toggle('expanded', expanded);
        header.querySelector('.modal-rsb-accordion-chevron').textContent = expanded ? '▾' : '▸';
    });

    body.appendChild(buildReactionRow(section, record, row));
    body.appendChild(buildCommentsBlock(section, record, row));

    section.appendChild(header);
    section.appendChild(body);
}

function buildReactionRow(section, record, row) {
    const wrap = document.createElement('div');
    wrap.className = 'public-reaction-row';

    const me = currentUser();
    EMOJI_REACTIONS.forEach(emoji => {
        const data = (row.reactions || {})[emoji] || { count: 0, users: [] };
        const mine = me.id && Array.isArray(data.users) && data.users.includes(me.id);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'public-reaction-btn' + (mine ? ' reacted' : '');
        btn.innerHTML = `<span class="pr-emoji">${emoji}</span>${data.count ? `<span class="pr-count">${data.count}</span>` : ''}`;
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!requireSignIn()) return;
            btn.disabled = true;
            const result = await api.togglePublicReaction(row.id, emoji, null);
            btn.disabled = false;
            if (!result) return;
            applyReactionToggle(row, emoji, me.id, result.reacted);
            renderPublicReactions(section, record); // re-render with fresh counts
        });
        wrap.appendChild(btn);
    });

    return wrap;
}

// Optimistically update the locally cached reaction summary after a toggle.
function applyReactionToggle(row, emoji, userId, reacted) {
    row.reactions = row.reactions || {};
    const entry = row.reactions[emoji] || { count: 0, users: [] };
    if (reacted) {
        if (!entry.users.includes(userId)) { entry.users.push(userId); entry.count += 1; }
    } else {
        entry.users = entry.users.filter(u => u !== userId);
        entry.count = Math.max(0, entry.count - 1);
    }
    if (entry.count > 0) row.reactions[emoji] = entry;
    else delete row.reactions[emoji];
}

function buildCommentsBlock(section, record, row) {
    const wrap = document.createElement('div');
    wrap.className = 'public-comments-block';

    const list = document.createElement('div');
    list.className = 'public-comments-list';
    const me = currentUser();
    const comments = (row.comments || []).slice().sort((a, b) =>
        new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

    if (comments.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'public-comments-empty';
        empty.textContent = 'No comments yet — start the conversation.';
        list.appendChild(empty);
    } else {
        comments.forEach(c => list.appendChild(buildCommentEl(section, record, row, c, me)));
    }
    wrap.appendChild(list);

    // Composer
    const composer = document.createElement('div');
    composer.className = 'public-comment-composer';
    const ta = document.createElement('textarea');
    ta.className = 'public-comment-input';
    ta.rows = 2;
    ta.placeholder = me.isAuthenticated ? 'Add a comment…' : 'Sign in to comment…';
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'public-comment-send';
    sendBtn.textContent = 'Post';
    sendBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!requireSignIn()) return;
        const text = ta.value.trim();
        if (!text) { ta.focus(); return; }
        sendBtn.disabled = true;
        const created = await api.addPublicComment(row.id, text, me.name, null);
        sendBtn.disabled = false;
        if (!created) return;
        row.comments = row.comments || [];
        row.comments.push(created);
        ta.value = '';
        renderPublicReactions(section, record);
    });
    composer.appendChild(ta);
    composer.appendChild(sendBtn);
    wrap.appendChild(composer);

    return wrap;
}

function buildCommentEl(section, record, row, comment, me) {
    const el = document.createElement('div');
    el.className = 'public-comment';
    const author = comment.authorName || 'Someone';
    el.innerHTML = `
        <div class="public-comment-author">${escapeHtml(author)}</div>
        <div class="public-comment-body">${escapeHtml(comment.body)}</div>
    `;
    if (me.id && comment.userId === me.id) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'public-comment-delete';
        del.title = 'Delete your comment';
        del.textContent = '✕';
        del.addEventListener('click', async (e) => {
            e.stopPropagation();
            del.disabled = true;
            const ok = await api.deletePublicResource('comments', comment.id);
            if (!ok) { del.disabled = false; return; }
            row.comments = (row.comments || []).filter(c => c.id !== comment.id);
            renderPublicReactions(section, record);
        });
        el.appendChild(del);
    }
    return el;
}
