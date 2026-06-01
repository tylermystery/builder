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

// catalogItemId (an ordinary catalog item's stable id) -> its community container
// row. These rows back the "Community" card on existing curated catalog items.
// A row may have a null `id` until the first interaction lazily creates it server
// side; from then on `id` is the public_items id used for subsequent writes.
const communityRowByCatalogId = new Map();

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
// keeping the rest of state.records.all untouched. Rows that are community
// containers for existing catalog items (they carry a `catalogItemId`) are NOT
// injected as catalog records — they would duplicate the curated item. They are
// stashed in `communityRowByCatalogId` so the item's Community card can use them.
function injectPublicRecords(rows, storeId) {
    // Refresh the catalog-item community containers for this store.
    communityRowByCatalogId.clear();
    const ideaRows = [];
    for (const row of rows) {
        if (row.catalogItemId) communityRowByCatalogId.set(row.catalogItemId, row);
        else ideaRows.push(row);
    }

    const fresh = new Set(ideaRows.map(publicRecordId));

    // Drop stale public records that belonged to this store (by store match) and
    // are no longer present, so re-loads don't accumulate duplicates.
    state.records.all = state.records.all.filter(r => {
        if (!isPublicIdeaRecord(r)) return true;
        const belongsToStore = r.fields && Array.isArray(r.fields.Stores) && r.fields.Stores.includes(storeId);
        if (!belongsToStore) return true;
        return fresh.has(r.id); // keep only ones we're about to refresh below
    });

    publicIdeaIndex.clear();
    for (const row of ideaRows) {
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

// --- Detail-modal reactions & comments (the "Community" layer) --------------
//
// This panel renders the GLOBAL community reactions/comments for ANY catalog
// item — promoted "Public Idea" items (which are their own public row) and
// ordinary curated catalog items alike. For an ordinary item the community
// container is created lazily on the first reaction/comment, so the catalog is
// never pre-seeded. The per-plan ("This Plan") layer is rendered separately by
// the modal and is untouched here.

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

function storeIdForRecord(record) {
    if (state.ui?.activeShopId) return state.ui.activeShopId;
    const stores = record?.fields?.Stores;
    return Array.isArray(stores) && stores.length ? stores[0] : null;
}

// The metadata the server uses to create a catalog item's community container on
// first interaction. Kept lightweight — the curated item itself still renders
// from Airtable, so the container only needs enough to identify itself.
function communityWriteOpts(record) {
    const f = record.fields || {};
    return {
        catalogItemId: record.id,
        storeId: storeIdForRecord(record),
        name: f.Name || 'Catalog item',
        description: f.Description || '',
        imageUrl: f.imageUrl || record.publicImageUrl || null,
        price: f.Price != null ? String(f.Price) : null
    };
}

// Resolve the community row backing a record. Promoted ideas are their own row
// (in publicIdeaIndex). Ordinary items get a synthetic, initially-empty row whose
// `id` stays null until the first interaction creates it server side.
function getOrInitCommunityRow(record) {
    if (isPublicIdeaRecord(record)) {
        return publicIdeaIndex.get(record.id) || null;
    }
    let row = communityRowByCatalogId.get(record.id);
    if (!row) {
        row = { id: null, catalogItemId: record.id, reactions: {}, comments: [] };
        communityRowByCatalogId.set(record.id, row);
    }
    return row;
}

/**
 * Render the Community reactions + comments accordion for a record into the given
 * section. Works for every item; backed entirely by the public API.
 * @param {HTMLElement} section
 * @param {object} record
 * @param {{expanded?: boolean, comments?: boolean, onSeeConversation?: function}} [opts]
 *   - expanded: start expanded? (default true)
 *   - comments: render the inline comments thread + composer? (default true). When
 *     false, the comments are replaced by a "See conversation" button so the
 *     community thread is read/written from the conversation view instead.
 *   - onSeeConversation: click handler for the "See conversation" button (used when
 *     comments === false). Receives no arguments.
 */
export function renderPublicReactions(section, record, opts = {}) {
    const row = getOrInitCommunityRow(record);
    if (!row) { section.style.display = 'none'; return; }

    const expanded = opts.expanded !== false;
    const showComments = opts.comments !== false;

    section.style.display = 'block';
    // Additive so a host wrapper class (e.g. modal-community-layer) is preserved.
    section.classList.add('modal-rsb-host', 'public-reactions-host');

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
    const summaryText = summaryParts.length ? summaryParts.join(' · ') : 'React & comment with the community';

    section.innerHTML = '';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'modal-rsb-accordion-header' + (expanded ? ' expanded' : '');
    header.innerHTML = `
        <span class="modal-rsb-accordion-chevron">${expanded ? '▾' : '▸'}</span>
        <span class="modal-rsb-accordion-summary">${escapeHtml(summaryText)}</span>
        <span class="public-reactions-tag">🌐 Community</span>
    `;

    const body = document.createElement('div');
    body.className = 'modal-rsb-accordion-body public-reactions-body' + (expanded ? ' expanded' : '');

    header.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = body.classList.toggle('expanded');
        header.classList.toggle('expanded', isOpen);
        header.querySelector('.modal-rsb-accordion-chevron').textContent = isOpen ? '▾' : '▸';
    });

    body.appendChild(buildReactionRow(section, record, row, opts));
    if (showComments) {
        body.appendChild(buildCommentsBlock(section, record, row, opts));
    } else {
        body.appendChild(buildSeeConversationButton(opts));
    }

    section.appendChild(header);
    section.appendChild(body);
}

// A "See conversation" button shown in place of the inline comments thread. The
// community comments themselves live in the conversation view's Global tab.
function buildSeeConversationButton(opts) {
    const wrap = document.createElement('div');
    wrap.className = 'public-see-conversation-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'public-see-conversation-btn';
    btn.innerHTML = '💬 See conversation';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof opts.onSeeConversation === 'function') opts.onSeeConversation();
    });
    wrap.appendChild(btn);
    return wrap;
}

// Re-render the community panel keeping it open (the user just interacted),
// preserving the caller's options (comments visibility, See-conversation handler).
function rerenderOpen(section, record, opts = {}) {
    renderPublicReactions(section, record, { ...opts, expanded: true });
}

function buildReactionRow(section, record, row, opts = {}) {
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
            // No container yet -> send catalog identity so the server creates one.
            const result = await api.togglePublicReaction(
                row.id, emoji, null, row.id == null ? communityWriteOpts(record) : {});
            btn.disabled = false;
            if (!result) return;
            if (row.id == null && result.publicItemId != null) row.id = result.publicItemId;
            applyReactionToggle(row, emoji, me.id, result.reacted);
            rerenderOpen(section, record, opts);
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

function buildCommentsBlock(section, record, row, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'public-comments-block';

    const list = document.createElement('div');
    list.className = 'public-comments-list';
    const me = currentUser();

    const all = (row.comments || []).slice();
    // Group replies under their parent; top-level comments carry no parentCommentId.
    const repliesByParent = new Map();
    all.forEach(c => {
        if (c.parentCommentId != null) {
            const key = String(c.parentCommentId);
            if (!repliesByParent.has(key)) repliesByParent.set(key, []);
            repliesByParent.get(key).push(c);
        }
    });
    const byCreated = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    const topLevel = all.filter(c => c.parentCommentId == null).sort(byCreated);

    if (topLevel.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'public-comments-empty';
        empty.textContent = 'No comments yet — start the conversation.';
        list.appendChild(empty);
    } else {
        topLevel.forEach(c => {
            list.appendChild(buildCommentEl(section, record, row, c, me, opts, false));
            const replies = (repliesByParent.get(String(c.id)) || []).sort(byCreated);
            if (replies.length > 0) {
                const repliesWrap = document.createElement('div');
                repliesWrap.className = 'public-comment-replies';
                replies.forEach(r =>
                    repliesWrap.appendChild(buildCommentEl(section, record, row, r, me, opts, true)));
                list.appendChild(repliesWrap);
            }
        });
    }
    wrap.appendChild(list);

    // Composer for a new top-level comment.
    wrap.appendChild(buildComposer(section, record, row, me, opts, null));

    return wrap;
}

// A comment/reply composer. `parentCommentId` null posts a top-level comment; set
// it to reply to a comment. Returns the composer element.
function buildComposer(section, record, row, me, opts, parentCommentId) {
    const composer = document.createElement('div');
    composer.className = 'public-comment-composer' + (parentCommentId != null ? ' public-reply-composer' : '');
    const ta = document.createElement('textarea');
    ta.className = 'public-comment-input';
    ta.rows = parentCommentId != null ? 1 : 2;
    ta.placeholder = me.isAuthenticated
        ? (parentCommentId != null ? 'Write a reply…' : 'Add a comment…')
        : (parentCommentId != null ? 'Sign in to reply…' : 'Sign in to comment…');
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'public-comment-send';
    sendBtn.textContent = parentCommentId != null ? 'Reply' : 'Post';
    sendBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!requireSignIn()) return;
        const text = ta.value.trim();
        if (!text) { ta.focus(); return; }
        sendBtn.disabled = true;
        const writeOpts = row.id == null ? communityWriteOpts(record) : {};
        if (parentCommentId != null) writeOpts.parentCommentId = parentCommentId;
        const created = await api.addPublicComment(row.id, text, me.name, null, writeOpts);
        sendBtn.disabled = false;
        if (!created) return;
        if (row.id == null && created.publicItemId != null) row.id = created.publicItemId;
        row.comments = row.comments || [];
        row.comments.push(created);
        ta.value = '';
        rerenderOpen(section, record, opts);
    });
    composer.appendChild(ta);
    composer.appendChild(sendBtn);
    return composer;
}

function buildCommentEl(section, record, row, comment, me, opts = {}, isReply = false) {
    const el = document.createElement('div');
    el.className = 'public-comment' + (isReply ? ' public-comment-reply' : '');
    const author = comment.authorName || 'Someone';

    const head = document.createElement('div');
    head.innerHTML = `
        <div class="public-comment-author">${escapeHtml(author)}</div>
        <div class="public-comment-body">${escapeHtml(comment.body)}</div>
    `;
    el.appendChild(head);

    // Reaction chips (only emoji that have at least one reaction).
    const chips = buildCommentReactionChips(section, record, row, comment, me, opts);
    if (chips) el.appendChild(chips);

    // Actions: React (everywhere) and Reply (top-level only — one level of nesting).
    const actions = document.createElement('div');
    actions.className = 'public-comment-actions';

    const reactBtn = document.createElement('button');
    reactBtn.type = 'button';
    reactBtn.className = 'public-comment-action';
    reactBtn.innerHTML = '😊 React';
    actions.appendChild(reactBtn);

    const picker = buildCommentEmojiPicker(section, record, row, comment, me, opts);
    picker.style.display = 'none';
    reactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
    });

    let replyComposer = null;
    if (!isReply) {
        const replyBtn = document.createElement('button');
        replyBtn.type = 'button';
        replyBtn.className = 'public-comment-action';
        replyBtn.innerHTML = '↩ Reply';
        replyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!requireSignIn()) return;
            if (!replyComposer) {
                replyComposer = buildComposer(section, record, row, me, opts, comment.id);
                el.appendChild(replyComposer);
                const input = replyComposer.querySelector('.public-comment-input');
                if (input) input.focus();
            } else {
                replyComposer.remove();
                replyComposer = null;
            }
        });
        actions.appendChild(replyBtn);
    }

    if (me.id && comment.userId === me.id) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'public-comment-action public-comment-action-delete';
        del.innerHTML = '✕ Delete';
        del.addEventListener('click', async (e) => {
            e.stopPropagation();
            del.disabled = true;
            const ok = await api.deletePublicResource('comments', comment.id);
            if (!ok) { del.disabled = false; return; }
            // Drop the comment and any of its replies (the server cascades; mirror it locally).
            row.comments = (row.comments || []).filter(
                c => c.id !== comment.id && c.parentCommentId !== comment.id);
            rerenderOpen(section, record, opts);
        });
        actions.appendChild(del);
    }

    el.appendChild(actions);
    el.appendChild(picker);
    return el;
}

// Reaction chips summarising a comment's reactions, each toggling the user's own.
// Returns null when the comment has no reactions yet.
function buildCommentReactionChips(section, record, row, comment, me, opts) {
    const reactions = comment.reactions || {};
    const entries = Object.entries(reactions).filter(([, d]) => (d.count || 0) > 0);
    if (entries.length === 0) return null;

    const chipsRow = document.createElement('div');
    chipsRow.className = 'public-comment-reactions';
    entries.forEach(([emoji, data]) => {
        const mine = me.id && Array.isArray(data.users) && data.users.includes(me.id);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'public-comment-reaction' + (mine ? ' reacted' : '');
        chip.innerHTML = `${emoji} <span class="pcr-count">${data.count}</span>`;
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCommentReaction(section, record, row, comment, emoji, me, opts, chip);
        });
        chipsRow.appendChild(chip);
    });
    return chipsRow;
}

// The "React" emoji picker for a comment (the full community emoji set).
function buildCommentEmojiPicker(section, record, row, comment, me, opts) {
    const picker = document.createElement('div');
    picker.className = 'public-comment-emoji-picker';
    EMOJI_REACTIONS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'public-comment-emoji-pick';
        btn.textContent = emoji;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCommentReaction(section, record, row, comment, emoji, me, opts, btn);
        });
        picker.appendChild(btn);
    });
    return picker;
}

// Toggle the current user's `emoji` reaction on a single comment, optimistically
// updating the cached summary and re-rendering the open panel.
async function toggleCommentReaction(section, record, row, comment, emoji, me, opts, btn) {
    if (!requireSignIn()) return;
    if (btn) btn.disabled = true;
    const result = await api.togglePublicReaction(row.id, emoji, null, { commentId: comment.id });
    if (btn) btn.disabled = false;
    if (!result) return;
    comment.reactions = comment.reactions || {};
    applyReactionToggle(comment, emoji, me.id, result.reacted);
    rerenderOpen(section, record, opts);
}

// --- Read-only aggregated community feed (conversation view "Global" tab, plan-wide) -

/**
 * Return the community row backing a record WITHOUT creating one. Promoted ideas
 * are their own row; ordinary catalog items use the lazily-loaded container.
 * Returns null when no community data has been loaded for the record.
 */
export function getCommunityRowForRecord(record) {
    if (!record) return null;
    if (isPublicIdeaRecord(record)) return publicIdeaIndex.get(record.id) || null;
    return communityRowByCatalogId.get(record.id) || null;
}

function communityRowActivity(row) {
    const reactionTotal = Object.values(row?.reactions || {}).reduce((s, r) => s + (r.count || 0), 0);
    const commentCount = (row?.comments || []).length;
    return { reactionTotal, commentCount };
}

/**
 * Render a read-only feed of the community threads across a set of records (the
 * plan's items), one entry per item that has any community reactions or comments.
 * Each entry links into that item via onOpenItem(recordId). Posting happens from
 * within an item's own community thread, not here.
 * @param {HTMLElement} container
 * @param {Array<object>} records
 * @param {(recordId: string) => void} onOpenItem
 */
export function renderAggregatedCommunityFeed(container, records, onOpenItem) {
    container.innerHTML = '';

    const entries = [];
    (records || []).forEach(record => {
        if (!record) return;
        const row = getCommunityRowForRecord(record);
        if (!row) return;
        const { reactionTotal, commentCount } = communityRowActivity(row);
        if (reactionTotal === 0 && commentCount === 0) return;
        entries.push({ record, row, reactionTotal, commentCount });
    });

    const intro = document.createElement('div');
    intro.className = 'ucp-global-intro';
    intro.textContent = 'Community reactions & comments across this plan’s items. Open an item to join in.';
    container.appendChild(intro);

    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'ucp-global-empty';
        empty.innerHTML = '<span class="ucp-empty-icon">🌐</span><div>No community activity on this plan’s items yet.</div>';
        container.appendChild(empty);
        return;
    }

    // Most-active first.
    entries.sort((a, b) =>
        (b.reactionTotal + b.commentCount) - (a.reactionTotal + a.commentCount));

    entries.forEach(({ record, row, reactionTotal, commentCount }) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'ucp-global-card';

        const name = record.fields?.Name || 'Item';
        const topReactions = Object.entries(row.reactions || {})
            .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
            .slice(0, 3).map(([e]) => e).join('');

        const metaParts = [];
        if (reactionTotal > 0) metaParts.push(`${topReactions} ${reactionTotal}`);
        if (commentCount > 0) metaParts.push(`💬 ${commentCount}`);

        const latest = (row.comments || []).slice().sort((a, b) =>
            new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
        const snippet = latest
            ? `<div class="ucp-global-card-snippet"><strong>${escapeHtml(latest.authorName || 'Someone')}:</strong> ${escapeHtml(latest.body)}</div>`
            : '';

        card.innerHTML = `
            <div class="ucp-global-card-head">
                <span class="ucp-global-card-name">${escapeHtml(name)}</span>
                <span class="ucp-global-card-meta">${metaParts.join(' · ')}</span>
            </div>
            ${snippet}
        `;
        card.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof onOpenItem === 'function') onOpenItem(record.id);
        });
        container.appendChild(card);
    });
}
