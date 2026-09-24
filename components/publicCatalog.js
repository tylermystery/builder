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
import { EMOJI_REACTIONS, computeDemocraticAverage } from '../config.js';
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

    // A row a publisher promoted into the store catalog renders as an ordinary
    // catalog item: 'Available' is what the default status filter admits, so the
    // item simply shows up alongside the curated ones. Everything else keeps the
    // "Public Idea" status it has always had and stays under that filter.
    const catalogStatus = row.catalogStatus || 'none';
    f.Status = catalogStatus === 'published' ? 'Available' : PUBLIC_IDEA_STATUS;

    // Anchor to the originating store so the store-scoped catalog filter includes it.
    f.Stores = [storeId];
    if (!f['Item Type']) f['Item Type'] = 'Bookable Item';

    record.isPublicIdea = true;
    record.publicItemId = row.id;
    record.publicSource = row.source || 'custom';
    record.publicImageUrl = row.imageUrl || null;
    // Carried so cards/modals can label the row and so the publisher control knows
    // whether it is offering "add to catalog" or "remove from catalog".
    record.catalogStatus = catalogStatus;
    record.publicAuthorId = row.authorId || null;

    // If a publisher pointed the catalog at one of the item's variations, that is
    // the version everyone browsing sees. Plans keep whatever version they were
    // added with — see the plan-pinning helpers further down.
    applyCurrentVariationFields(record, row);

    return record;
}

// Overlay the item's current variation (if any) onto a record's display fields.
// A no-op when the row has no current variation, which is every row until a
// publisher explicitly switches one on.
function applyCurrentVariationFields(record, row) {
    const variation = currentVariationOfRow(row);
    if (!variation) return;
    const f = record.fields;
    if (variation.name) f.Name = variation.name;
    if (variation.description) f.Description = variation.description;
    if (variation.price != null) {
        const asNumber = Number(variation.price);
        f.Price = Number.isFinite(asNumber) ? asNumber : variation.price;
    }
    if (variation.imageUrl) {
        f.imageUrl = variation.imageUrl;
        record.publicImageUrl = variation.imageUrl;
    }
    record.currentVariationId = variation.id;
}

// The approved variation a row currently presents, or null for the base version.
function currentVariationOfRow(row) {
    if (!row || row.currentVariationId == null) return null;
    const variation = (row.variations || []).find(v => v.id === row.currentVariationId);
    return variation && variation.status === 'approved' ? variation : null;
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
        if (row.catalogItemId) {
            communityRowByCatalogId.set(row.catalogItemId, row);
            applyCurrentVariationToCatalogItem(row);
        } else {
            ideaRows.push(row);
        }
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
        if (adoptOriginRecord(row, record)) continue;
        const existingIdx = state.records.all.findIndex(r => r.id === record.id);
        if (existingIdx >= 0) state.records.all[existingIdx] = record;
        else state.records.all.push(record);
    }
    invalidateRecordsIndex();
}

// A published row whose origin item is still present in THIS session's catalog
// (the AI / manual record the publisher added moments ago) would render as a
// second, identical card. Instead of injecting the twin, tag the origin record
// with the public identity so it shows the published badge and the publisher
// control, and report that the row has been accounted for. Visitors who never
// had the origin record fall through and get the injected row as usual.
function adoptOriginRecord(row, record) {
    if (!row || row.catalogStatus !== 'published' || !row.originItemId) return false;
    const origin = state.records.all.find(
        r => r.id === row.originItemId && !isPublicIdeaRecord(r)
    );
    if (!origin) return false;
    origin.publicItemId = row.id;
    origin.catalogStatus = 'published';
    origin.publicAuthorId = row.authorId || null;
    if (origin.fields) origin.fields.Status = 'Available';
    // Drop any previously injected twin of this row.
    const twinIdx = state.records.all.findIndex(r => r.id === record.id);
    if (twinIdx >= 0) state.records.all.splice(twinIdx, 1);
    return true;
}

// A curated Airtable item renders from Airtable, not from its community
// container — so when a publisher points that item at one of its variations, the
// new version has to be overlaid onto the loaded record. The untouched fields are
// snapshotted first so clearing the current variation restores the curated copy
// without a reload. Items whose container has no current variation (all of them,
// until a publisher picks one) are left exactly as Airtable sent them.
function applyCurrentVariationToCatalogItem(row) {
    const record = state.records.all.find(r => r.id === row.catalogItemId);
    if (!record || !record.fields) return;

    const variation = currentVariationOfRow(row);
    if (!variation) {
        if (record._variationBaseFields) {
            Object.assign(record.fields, record._variationBaseFields);
            delete record._variationBaseFields;
            delete record.currentVariationId;
        }
        return;
    }

    if (!record._variationBaseFields) {
        record._variationBaseFields = {
            Name: record.fields.Name,
            Description: record.fields.Description,
            Price: record.fields.Price,
            imageUrl: record.fields.imageUrl
        };
    }
    applyCurrentVariationFields(record, row);
}

// Inject (or refresh) a single public-layer row into the live catalog without
// clearing the rest of the index. Used by publish-on-add so a freshly created
// public idea appears immediately under the "Public Ideas" filter and its
// reactions/comments panel can render right away — no page reload required.
function injectOnePublicRow(row, storeId) {
    const record = transformPublicRowToRecord(row, storeId);
    publicIdeaIndex.set(record.id, row);
    if (adoptOriginRecord(row, record)) {
        invalidateRecordsIndex();
        return record;
    }
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

// --- Publisher: add an item to / remove it from the store catalog -----------
//
// Phase 1 of the catalog-contribution work. A user with publish permission on
// the active store can promote an AI, manual, or public-idea item into the
// store's catalog, where it renders like any other available item for everyone.
// The promotion lives in the Postgres public layer (`public_items.catalog_status`)
// — Airtable is not written to, so curated catalog data is untouched. The server
// re-checks publish permission on every call; the checks here only decide whether
// to OFFER the control.

// Records that can be promoted: a session-local AI/manual item, or a public idea.
// Curated Airtable records ("rec…") are already in the catalog, and community
// containers for them are not promotable either.
export function canOfferCatalogPublish(record) {
    if (!record) return false;
    if (typeof record.id === 'string' && record.id.startsWith('rec')) return false;
    // Events keep their own dedicated publish/edit flow in the modal.
    if (record.fields?.['Item Type'] === 'Event') return false;
    if (!state.session?.user?.isAuthenticated) return false;
    return api.userHasPublishPermission();
}

// True when the record is currently part of the store catalog via the public layer.
// Everyone else's version of the control above: a signed-in user without
// publish permission may *suggest* that an item join the catalog. The
// suggestion lands as a pending item that only its author and the store's
// publishers can see until it is approved.
export function canOfferCatalogSuggestion(record) {
    if (!record) return false;
    if (typeof record.id === 'string' && record.id.startsWith('rec')) return false;
    if (record.fields?.['Item Type'] === 'Event') return false;
    if (!state.session?.user?.isAuthenticated) return false;
    if (api.userHasPublishPermission()) return false;
    if (record.catalogStatus === 'published') return false;
    // Only your own idea is yours to put forward — a suggestion makes the item
    // visible to its author and the store's publishers alone until it is
    // approved, so it must never be applied to someone else's visible idea.
    const authorId = record.publicAuthorId || null;
    return !authorId || authorId === currentUser().id;
}

export function isRecordAwaitingCatalogReview(record) {
    return !!(record && record.catalogStatus === 'pending');
}

export async function suggestRecordForCatalog(record) {
    if (!record) return { ok: false, error: 'No item' };
    if (!state.session?.user?.isAuthenticated) {
        requireSignIn();
        return { ok: false, error: 'Login required' };
    }

    const storeId = storeIdForRecord(record);
    const fields = record.fields || {};

    try {
        const row = await api.suggestPublicItem({
            publicItemId: record.publicItemId ?? undefined,
            storeId,
            source: record.publicSource || (record.isManual ? 'custom' : 'ai'),
            name: fields.Name || 'Untitled item',
            description: fields.Description || '',
            imageUrl: fields.imageUrl || record.publicImageUrl || null,
            price: fields.Price != null ? String(fields.Price) : null,
            data: record,
            originSessionId: state.session?.id || null,
            originItemId: record.id || null
        });
        if (!row) return { ok: false, error: 'Could not send the suggestion' };

        const cached = publicIdeaIndex.get(publicRecordId(row));
        if (cached) cached.catalogStatus = row.catalogStatus;
        record.publicItemId = row.id;
        record.catalogStatus = row.catalogStatus;

        log('PublicCatalog', `Suggested item ${record.id} for the store catalog`);
        return { ok: true, row };
    } catch (error) {
        console.error('[PublicCatalog] suggestRecordForCatalog error:', error);
        return { ok: false, error: 'Something went wrong' };
    }
}

export function isRecordInStoreCatalog(record) {
    return !!(record && record.catalogStatus === 'published');
}

/**
 * Promote a record into the active store's catalog, or take it back out.
 * Returns { ok, row, error }. Never throws.
 *
 * Publishing is idempotent: the server first looks for an existing public row by
 * id, then by origin identity (this session + the original item id), so an item
 * that publish-on-add already mirrored is promoted rather than duplicated.
 */
export async function setRecordCatalogMembership(record, publish) {
    if (!record) return { ok: false, error: 'No item' };
    if (!state.session?.user?.isAuthenticated) {
        requireSignIn();
        return { ok: false, error: 'Login required' };
    }

    const storeId = storeIdForRecord(record);
    const fields = record.fields || {};

    try {
        let row;
        if (publish) {
            row = await api.publishPublicItem({
                publicItemId: record.publicItemId ?? undefined,
                storeId,
                source: record.publicSource || (record.isManual ? 'custom' : 'ai'),
                name: fields.Name || 'Untitled item',
                description: fields.Description || '',
                imageUrl: fields.imageUrl || record.publicImageUrl || null,
                price: fields.Price != null ? String(fields.Price) : null,
                data: record,
                originSessionId: state.session?.id || null,
                originItemId: record.id || null
            });
        } else {
            if (record.publicItemId == null) return { ok: false, error: 'Not published' };
            row = await api.unpublishPublicItem(record.publicItemId);
        }

        if (!row) return { ok: false, error: publish ? 'Could not add to catalog' : 'Could not remove from catalog' };

        // Keep the cached row and the on-screen record in sync, then re-render so
        // the item moves between the catalog and the Public Ideas filter without
        // a reload.
        const publicId = publicRecordId(row);
        const cached = publicIdeaIndex.get(publicId);
        if (cached) cached.catalogStatus = row.catalogStatus;
        injectOnePublicRow(row, row.storeId || storeId);

        record.publicItemId = row.id;
        record.catalogStatus = row.catalogStatus;
        if (record.fields) {
            record.fields.Status = row.catalogStatus === 'published'
                ? 'Available'
                : (isPublicIdeaRecord(record) ? PUBLIC_IDEA_STATUS : record.fields.Status);
        }
        invalidateRecordsIndex();
        if (typeof window.applyFiltersAndSort === 'function') {
            window.applyFiltersAndSort(window.imageCache);
        }

        log('PublicCatalog', `${publish ? 'Added' : 'Removed'} item ${record.id} ${publish ? 'to' : 'from'} store catalog`);
        return { ok: true, row };
    } catch (error) {
        console.error('[PublicCatalog] setRecordCatalogMembership error:', error);
        return { ok: false, error: 'Something went wrong' };
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
    // An AI / manual item that was published and then adopted back onto its
    // origin record (so the plan's reference survives) keeps its public identity
    // on the record itself — use that row rather than opening a second container.
    const adopted = adoptedCommunityRow(record);
    if (adopted) return adopted;

    let row = communityRowByCatalogId.get(record.id);
    if (!row) {
        row = { id: record.publicItemId ?? null, catalogItemId: record.id, reactions: {}, comments: [] };
        communityRowByCatalogId.set(record.id, row);
    } else if (row.id == null && record.publicItemId != null) {
        // The record was promoted or suggested since this row was created; point
        // it at the real container instead of opening another one.
        row.id = record.publicItemId;
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
    return adoptedCommunityRow(record) || communityRowByCatalogId.get(record.id) || null;
}

// The public row behind a record that was published from this session and then
// adopted onto its origin item, if it is loaded.
function adoptedCommunityRow(record) {
    if (!record || record.publicItemId == null) return null;
    return publicIdeaIndex.get(`public-${record.publicItemId}`) || null;
}

// Build a Map<userId, Set<emoji>> from a community row's reactions so the
// democratic-average scorer can read it. Count-only entries (no user list) are
// expanded into synthetic anonymous users so an aggregate count still scores.
function communityRowToUserMap(row) {
    const map = new Map();
    const reactions = (row && row.reactions) || {};
    let synthetic = 0;
    for (const [emoji, data] of Object.entries(reactions)) {
        const users = data && Array.isArray(data.users) ? data.users : [];
        if (users.length) {
            for (const uid of users) {
                if (!map.has(uid)) map.set(uid, new Set());
                map.get(uid).add(emoji);
            }
        } else {
            const count = (data && data.count) || 0;
            for (let i = 0; i < count; i++) map.set(`anon:${synthetic++}`, new Set([emoji]));
        }
    }
    return map;
}

/**
 * Community (global) sentiment for a record, derived from its cached community
 * row — the same data behind the detail modal's 🌐 chip. Returns the democratic
 * average `score`, the summary emoji, the reaction `total`, and `has` (whether
 * any reactions exist). Items with no community reactions resolve to a neutral
 * score of 0, which is how the catalog's "Sort by: Sentiment" mode treats them.
 */
export function getCommunitySentimentScore(record) {
    const row = record ? getCommunityRowForRecord(record) : null;
    const { democraticAverage, summaryEmoji, totalReactions } = computeDemocraticAverage(communityRowToUserMap(row));
    return { score: democraticAverage, summaryEmoji, total: totalReactions, has: totalReactions > 0 };
}

/**
 * Toggle the current user's community (global) reaction for a record's item and
 * update the locally cached community row in place. Centralizes the community
 * toggle (sign-in gate + API call + optimistic local update) so callers outside
 * this module — e.g. the detail modal's global sentiment popup — reuse the exact
 * same path the inline community picker uses.
 * @returns {Promise<boolean>} true if applied, false if blocked (signed out) or errored.
 */
export async function toggleCommunityReactionForRecord(record, emoji) {
    if (!record) return false;
    if (!requireSignIn()) return false;
    const row = getOrInitCommunityRow(record);
    if (!row) return false;
    const me = currentUser();
    // No container yet -> send catalog identity so the server creates one.
    const result = await api.togglePublicReaction(
        row.id, emoji, null, row.id == null ? communityWriteOpts(record) : {});
    if (!result) return false;
    if (row.id == null && result.publicItemId != null) row.id = result.publicItemId;
    applyReactionToggle(row, emoji, me.id, result.reacted);
    return true;
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

// ===========================================================================
// VARIATIONS
// ---------------------------------------------------------------------------
// A variation is an alternative version of an item — an edit, an AI rewrite, a
// manual rework — authored by any signed-in user and stored in the public layer
// next to the item it varies. Three rules shape everything below:
//
//   1. A publisher's variation is live immediately; anyone else's is a
//      suggestion, visible only to its author and the store's publishers until
//      a publisher approves or denies it inline in this accordion.
//   2. The catalog presents ONE version at a time (the item's "current"
//      variation, or its base fields). A publisher switches that over.
//   3. A plan keeps the version it was added with. Switching the catalog over
//      never rewrites anybody's plan; the plan's owner moves across when they
//      choose to, from this same accordion.
// ===========================================================================

// Where an item's versions come from: 'edit' (someone edited the item), 'ai'
// (an AI-generated alternative), 'manual' (written from scratch).
const VARIATION_SOURCE_BADGES = { edit: '✏️', ai: '🤖', manual: '✍️' };

// Resolve a display name for a user id, falling back politely when the session
// has never seen that person (they collaborated from another plan).
function userLabel(userId) {
    if (!userId) return 'Someone';
    const me = currentUser();
    if (me.id && userId === me.id) return 'You';
    return state.session?.userProfiles?.get(userId) || 'A collaborator';
}

// "Version 2" unless the author named it.
function variationLabel(variation, index) {
    if (variation && variation.label) return variation.label;
    return `Version ${(index == null ? 0 : index) + 2}`;
}

// The variations of a record that the current viewer may act on, in display
// order. The server already filtered out other people's pending/rejected ones.
function visibleVariations(row) {
    return (row?.variations || [])
        .slice()
        .sort((a, b) => (a.position || 0) - (b.position || 0) || a.id - b.id);
}

// True when this viewer may approve/deny suggestions for the record's store.
function viewerCanReview() {
    return !!(state.session?.user?.isAuthenticated && api.userHasPublishPermission());
}

/**
 * The version of `record` the CATALOG currently presents: a variation id, or
 * null for the item's own base fields.
 */
export function currentVariationIdForRecord(record) {
    const row = getCommunityRowForRecord(record);
    const variation = currentVariationOfRow(row);
    return variation ? variation.id : null;
}

/**
 * Plan pinning. A plan item's `variationId` records the version it was added
 * with: a variation id, or null for the base version. The key is stamped once —
 * items restored from a saved session are stamped null on load (they predate
 * variations), and an item added during this session is stamped with whatever
 * the catalog presents at that moment. After that the pin only ever changes
 * when the plan's owner switches it here.
 */
export function stampPlanVariation(record, itemInfo) {
    if (!itemInfo || typeof itemInfo !== 'object') return itemInfo;
    if (!('variationId' in itemInfo)) {
        itemInfo.variationId = currentVariationIdForRecord(record);
    }
    return itemInfo;
}

/**
 * Return the record as this plan item should be displayed: the pinned
 * variation's fields overlaid on a shallow copy, or the record itself when the
 * item is pinned to the base version (the overwhelmingly common case).
 */
export function applyPlanVariation(record, itemInfo) {
    const variationId = itemInfo && itemInfo.variationId;
    if (!record || variationId == null) return record;

    const row = getCommunityRowForRecord(record);
    const variation = (row?.variations || []).find(v => v.id === variationId);
    if (!variation) return record;

    const view = { ...record, fields: { ...record.fields } };
    if (variation.name) view.fields.Name = variation.name;
    if (variation.description) view.fields.Description = variation.description;
    if (variation.price != null) {
        const asNumber = Number(variation.price);
        view.fields.Price = Number.isFinite(asNumber) ? asNumber : variation.price;
    }
    if (variation.imageUrl) view.fields.imageUrl = variation.imageUrl;
    view.planVariationId = variationId;
    return view;
}

/**
 * True when the plan holds this item on an older version than the catalog now
 * presents — what the "update to the newest version" prompt keys off.
 */
export function planVariationIsBehind(record) {
    const itemInfo = state.cart?.lockedItems?.get(record?.id);
    if (!itemInfo || !('variationId' in itemInfo)) return false;
    return itemInfo.variationId !== currentVariationIdForRecord(record);
}

// Move this plan's copy of the item onto `variationId` (null = base version).
// Returns false when the item is not in the plan.
function setPlanVariation(recordId, variationId) {
    const itemInfo = state.cart?.lockedItems?.get(recordId);
    if (!itemInfo) return false;
    itemInfo.variationId = variationId;
    state.cart.lockedItems.set(recordId, itemInfo);
    return true;
}

/**
 * Record an edit as a variation of a CATALOG item. Called after the item modal
 * saves an edit, so editing a catalog item proposes a new version of it instead
 * of changing only the editor's own plan. Returns null when the edit was to a
 * plan-local item (nothing to propose) or the user is signed out — in both cases
 * the edit stays exactly as local as it has always been.
 *
 * @param {object} record - the record that was edited (already mutated in place)
 * @param {{name?, description?, price?, imageUrl?, source?, label?, makeCurrent?}} changes
 */
export async function recordEditAsVariation(record, changes = {}) {
    if (!record || !isCatalogEditTarget(record)) return null;
    if (!state.session?.user?.isAuthenticated) return null;

    const publicItemId = record.publicItemId ?? null;
    const payload = {
        ...(publicItemId != null
            ? { publicItemId }
            : communityWriteOpts(record)),
        name: changes.name ?? record.fields?.Name ?? null,
        description: changes.description ?? record.fields?.Description ?? null,
        imageUrl: changes.imageUrl ?? record.fields?.imageUrl ?? null,
        price: changes.price != null ? String(changes.price) : null,
        source: changes.source || 'edit',
        label: changes.label || null,
        basedOnVariationId: currentVariationIdForRecord(record),
        makeCurrent: !!changes.makeCurrent
    };

    const result = await api.addPublicVariation(payload);
    if (!result) return null;

    mergeVariationIntoCache(record, result);
    return result;
}

/**
 * Items whose edits are proposals rather than private changes: anything that is
 * part of the store catalog, whether curated in Airtable or promoted from the
 * public layer. A plan-local AI/manual item keeps its plain local edit.
 */
export function isCatalogEditTarget(record) {
    if (!record) return false;
    if (typeof record.id === 'string' && record.id.startsWith('rec')) return true;
    return record.catalogStatus === 'published';
}

// Fold a variation write's response back into the cached row so the accordion
// re-renders without refetching the store.
function mergeVariationIntoCache(record, result) {
    const row = getOrInitCommunityRow(record);
    if (!row) return;
    if (row.id == null && result.item?.id != null) row.id = result.item.id;
    if (record && record.publicItemId == null && row.id != null) record.publicItemId = row.id;

    row.variations = row.variations || [];
    if (result.variation) {
        const existing = row.variations.findIndex(v => v.id === result.variation.id);
        const merged = {
            reactions: {},
            comments: [],
            ...(existing >= 0 ? row.variations[existing] : {}),
            ...result.variation
        };
        if (existing >= 0) row.variations[existing] = merged;
        else row.variations.push(merged);
    }
    if (result.item && 'currentVariationId' in result.item) {
        row.currentVariationId = result.item.currentVariationId;
    }
}

/**
 * Render the variation accordion for a record into `section`.
 *
 * This is the one place where versions are read and acted on: it lists the base
 * version and every variation the viewer may see, marks which one the catalog
 * presents and which one this plan holds, and carries the inline controls —
 * approve/deny for publishers, "use in my plan" for everyone, and a composer for
 * suggesting a new version.
 *
 * @param {HTMLElement} section
 * @param {object} record
 * @param {{expanded?: boolean}} [opts]
 */
export function renderItemVariations(section, record, opts = {}) {
    if (!section || !record) return;

    const row = getCommunityRowForRecord(record);
    const variations = visibleVariations(row);
    const canReview = viewerCanReview();
    const inPlan = !!state.cart?.lockedItems?.has(record.id);

    // Nothing to show and nothing to propose: stay out of the way entirely.
    // (Anyone signed in may propose a version of a catalog item; a plan-local
    // item with no versions has no catalog to propose anything to.)
    const canSuggest = !!state.session?.user?.isAuthenticated && isCatalogEditTarget(record);
    // A suggested item (someone without publish permission asked for it to join
    // the catalog) is reviewed here too, so publishers never have to go looking
    // for a separate queue.
    const needsItemReview = canReview && row?.catalogStatus === 'pending' && row?.id != null;
    if (variations.length === 0 && !canSuggest && !needsItemReview) {
        section.style.display = 'none';
        return;
    }

    const pendingCount = variations.filter(v => v.status === 'pending').length;
    const expanded = opts.expanded === true || pendingCount > 0 || needsItemReview;

    section.style.display = 'block';
    section.classList.add('modal-rsb-host', 'item-variations-host');
    section.innerHTML = '';

    const summaryParts = [`${variations.length + 1} version${variations.length ? 's' : ''}`];
    if (pendingCount > 0) summaryParts.push(`${pendingCount} awaiting review`);
    if (needsItemReview) summaryParts.push('suggested for the catalog');

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'modal-rsb-accordion-header' + (expanded ? ' expanded' : '');
    header.innerHTML = `
        <span class="modal-rsb-accordion-chevron">${expanded ? '▾' : '▸'}</span>
        <span class="modal-rsb-accordion-summary">${escapeHtml(summaryParts.join(' · '))}</span>
        <span class="item-variations-tag">🧬 Versions</span>
    `;

    const body = document.createElement('div');
    body.className = 'modal-rsb-accordion-body item-variations-body' + (expanded ? ' expanded' : '');

    header.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = body.classList.toggle('expanded');
        header.classList.toggle('expanded', isOpen);
        header.querySelector('.modal-rsb-accordion-chevron').textContent = isOpen ? '▾' : '▸';
    });

    const currentId = row && row.currentVariationId != null ? row.currentVariationId : null;
    const planItem = state.cart?.lockedItems?.get(record.id);
    const planId = planItem && 'variationId' in planItem ? planItem.variationId : null;

    const ctx = { section, record, row, canReview, inPlan, currentId, planId, opts };

    if (needsItemReview) body.appendChild(buildItemReviewBar(ctx));

    // The base version always comes first: it is what the item was before anyone
    // proposed anything.
    body.appendChild(buildVariationCard(ctx, null, -1));
    variations.forEach((variation, index) => {
        body.appendChild(buildVariationCard(ctx, variation, index));
    });

    if (canSuggest) body.appendChild(buildSuggestVersionBlock(ctx));

    section.appendChild(header);
    section.appendChild(body);
}

// Re-render in place, keeping the accordion open (the viewer just acted).
function rerenderVariations(ctx) {
    renderItemVariations(ctx.section, ctx.record, { ...ctx.opts, expanded: true });
}

// One row in the accordion. `variation` is null for the item's base version,
// which cannot be reviewed or deleted but can be the catalog's current version
// The inline review of a *suggested item* (as opposed to a suggested version).
// Approving promotes it to the catalog; denying leaves it with its author as an
// ordinary community idea and records the note.
function buildItemReviewBar(ctx) {
    const { record, row } = ctx;
    const wrap = document.createElement('div');
    wrap.className = 'variation-item-review';
    wrap.innerHTML = `
        <div class="variation-item-review-text">
            ${escapeHtml(userLabel(row?.authorId))} suggested this item for the store catalog.
        </div>
    `;

    const actions = document.createElement('div');
    actions.className = 'variation-actions';

    const addButton = (label, className, handler) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `variation-action-btn ${className}`;
        btn.textContent = label;
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            btn.disabled = true;
            await handler();
            btn.disabled = false;
        });
        actions.appendChild(btn);
    };

    addButton('✅ Add to the catalog', 'variation-approve-btn', async () => {
        const item = await api.reviewPublicItem(row.id, 'approve');
        if (!item) return notify(ctx, 'Could not approve that item.', 'error');
        applyItemReviewResult(record, row, item);
        refreshAfterVariationChange(ctx);
        notify(ctx, 'Added to the store catalog.', 'success');
    });

    addButton('✖️ Decline', 'variation-deny-btn', async () => {
        const note = prompt('Optional note back to the author:', '');
        if (note === null) return;
        const item = await api.reviewPublicItem(row.id, 'reject', note || null);
        if (!item) return notify(ctx, 'Could not decline that item.', 'error');
        applyItemReviewResult(record, row, item);
        refreshAfterVariationChange(ctx);
        notify(ctx, 'Suggestion declined.', 'success');
    });

    wrap.appendChild(actions);
    return wrap;
}

// Mirror an item review decision onto the cached row and the on-screen record so
// the item moves between the catalog and Public Ideas without a reload. An
// approved item carries the 'Available' status the rest of the app filters on;
// a declined one goes back to being an ordinary community idea.
function applyItemReviewResult(record, row, item) {
    if (row) row.catalogStatus = item.catalogStatus;
    const cachedRow = publicIdeaIndex.get(publicRecordId(row || item));
    if (cachedRow) cachedRow.catalogStatus = item.catalogStatus;

    if (!record) return;
    record.catalogStatus = item.catalogStatus;
    if (record.fields) {
        record.fields.Status = item.catalogStatus === 'published'
            ? 'Available'
            : PUBLIC_IDEA_STATUS;
    }
}

// and can be what a plan holds.
function buildVariationCard(ctx, variation, index) {
    const { record, row, canReview, inPlan, currentId, planId } = ctx;
    const variationId = variation ? variation.id : null;
    const isCurrent = currentId === variationId;
    const isPlanned = inPlan && planId === variationId;
    const status = variation ? variation.status : 'approved';

    const card = document.createElement('div');
    card.className = 'variation-card'
        + (isCurrent ? ' is-current' : '')
        + (isPlanned ? ' is-planned' : '')
        + (status !== 'approved' ? ` is-${status}` : '');

    const fields = record.fields || {};
    const name = variation ? (variation.name || fields.Name) : fields.Name;
    const description = variation ? (variation.description || '') : (fields.Description || '');
    const price = variation ? variation.price : fields.Price;
    const sourceBadge = variation ? (VARIATION_SOURCE_BADGES[variation.source] || '✏️') : '📄';
    const title = variation ? variationLabel(variation, index) : 'Original';
    const author = variation ? userLabel(variation.authorId) : userLabel(row?.authorId);

    const chips = [];
    if (isCurrent) chips.push('<span class="variation-chip is-current-chip">In the catalog</span>');
    if (isPlanned) chips.push('<span class="variation-chip is-planned-chip">In your plan</span>');
    if (status === 'pending') chips.push('<span class="variation-chip is-pending-chip">Awaiting review</span>');
    if (status === 'rejected') chips.push('<span class="variation-chip is-rejected-chip">Not accepted</span>');

    const priceText = price == null || price === ''
        ? ''
        : `<span class="variation-price">${escapeHtml(typeof price === 'number' ? `$${price}` : price)}</span>`;

    card.innerHTML = `
        <div class="variation-card-head">
            <span class="variation-source">${sourceBadge}</span>
            <span class="variation-title">${escapeHtml(title)}</span>
            <span class="variation-author">by ${escapeHtml(author)}</span>
            ${priceText}
            <span class="variation-chips">${chips.join('')}</span>
        </div>
        <div class="variation-name">${escapeHtml(name || 'Untitled')}</div>
        ${description ? `<div class="variation-description">${escapeHtml(description)}</div>` : ''}
        ${variation && variation.reviewNote ? `<div class="variation-review-note">Reviewer: ${escapeHtml(variation.reviewNote)}</div>` : ''}
    `;

    card.appendChild(buildVariationReactionRow(ctx, variation));
    card.appendChild(buildVariationActions(ctx, variation, { isCurrent, isPlanned, status }));
    card.appendChild(buildVariationComments(ctx, variation));
    return card;
}

// Reaction chips scoped to one version. The public layer has carried a
// variation id on reactions since it was built, so this needed no new plumbing.
function buildVariationReactionRow(ctx, variation) {
    const { record, row } = ctx;
    const wrap = document.createElement('div');
    wrap.className = 'variation-reaction-row';

    const me = currentUser();
    const summary = (variation ? variation.reactions : row?.reactions) || {};

    EMOJI_REACTIONS.forEach(emoji => {
        const data = summary[emoji] || { count: 0, users: [] };
        const mine = me.id && Array.isArray(data.users) && data.users.includes(me.id);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'public-reaction-btn variation-reaction-btn' + (mine ? ' reacted' : '');
        btn.innerHTML = `<span class="pr-emoji">${emoji}</span>${data.count ? `<span class="pr-count">${data.count}</span>` : ''}`;
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!requireSignIn()) return;
            btn.disabled = true;
            const target = getOrInitCommunityRow(record);
            const result = await api.togglePublicReaction(
                target?.id ?? null,
                emoji,
                variation ? variation.id : null,
                target?.id == null ? communityWriteOpts(record) : {}
            );
            btn.disabled = false;
            if (!result) return;
            if (target && target.id == null && result.publicItemId != null) target.id = result.publicItemId;
            applyReactionToggle(variation || target, emoji, me.id, result.reacted);
            rerenderVariations(ctx);
        });
        wrap.appendChild(btn);
    });

    return wrap;
}

// The inline controls: approve/deny (publishers), switch the catalog over
// (publishers), and move this plan across (anyone whose plan holds the item).
function buildVariationActions(ctx, variation, flags) {
    const { record, canReview, inPlan } = ctx;
    const wrap = document.createElement('div');
    wrap.className = 'variation-actions';

    const addButton = (label, className, handler) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `variation-action-btn ${className}`;
        btn.textContent = label;
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            btn.disabled = true;
            await handler(btn);
            btn.disabled = false;
        });
        wrap.appendChild(btn);
        return btn;
    };

    if (variation && canReview && flags.status === 'pending') {
        addButton('✅ Approve', 'variation-approve-btn', async () => {
            const makeCurrent = confirm(
                'Approve this version.\n\nPress OK to also make it the version the catalog shows. ' +
                'Plans that already added this item keep the version they have.'
            );
            const result = await api.reviewPublicVariation(variation.id, 'approve', { makeCurrent });
            if (!result) return notify(ctx, 'Could not approve that version.', 'error');
            mergeVariationIntoCache(record, result);
            refreshAfterVariationChange(ctx);
            notify(ctx, makeCurrent ? 'Approved and shown in the catalog.' : 'Version approved.', 'success');
        });

        addButton('✖️ Deny', 'variation-deny-btn', async () => {
            const note = prompt('Optional note back to the author:', '');
            if (note === null) return;
            const result = await api.reviewPublicVariation(variation.id, 'reject', { reviewNote: note || null });
            if (!result) return notify(ctx, 'Could not deny that version.', 'error');
            mergeVariationIntoCache(record, result);
            refreshAfterVariationChange(ctx);
            notify(ctx, 'Version denied.', 'success');
        });
    }

    if (canReview && !flags.isCurrent && flags.status === 'approved' && ctx.row?.id != null) {
        addButton(
            variation ? '🏬 Show this in the catalog' : '🏬 Show the original in the catalog',
            'variation-current-btn',
            async () => {
                const item = await api.setCurrentVariation(ctx.row.id, variation ? variation.id : null);
                if (!item) return notify(ctx, 'Could not update the catalog.', 'error');
                mergeVariationIntoCache(record, { item });
                refreshAfterVariationChange(ctx);
                notify(ctx, 'The catalog now shows this version.', 'success');
            }
        );
    }

    if (inPlan && !flags.isPlanned) {
        addButton('📋 Use this version in my plan', 'variation-plan-btn', async () => {
            if (!setPlanVariation(record.id, variation ? variation.id : null)) return;
            if (typeof window.triggerSave === 'function') window.triggerSave();
            refreshAfterVariationChange(ctx);
            notify(ctx, 'Your plan now uses this version.', 'success');
        });
    }

    return wrap;
}

// A compact per-version comment thread. Comments have carried a variation id
// since the public layer was built, so each version keeps its own conversation.
function buildVariationComments(ctx, variation) {
    const { record, row } = ctx;
    const variationId = variation ? variation.id : null;
    const thread = (row?.comments || []).filter(c =>
        (c.variationId == null ? null : c.variationId) === variationId);

    const wrap = document.createElement('div');
    wrap.className = 'variation-comments';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'variation-comments-toggle';
    toggle.textContent = thread.length
        ? `💬 ${thread.length} comment${thread.length !== 1 ? 's' : ''}`
        : '💬 Comment on this version';
    wrap.appendChild(toggle);

    const panel = document.createElement('div');
    panel.className = 'variation-comments-panel';
    panel.style.display = 'none';
    wrap.appendChild(panel);

    thread.forEach(c => {
        const line = document.createElement('div');
        line.className = 'variation-comment';
        line.innerHTML = `<strong>${escapeHtml(c.authorName || userLabel(c.authorId))}:</strong> ${escapeHtml(c.body)}`;
        panel.appendChild(line);
    });

    const composer = document.createElement('div');
    composer.className = 'variation-comment-composer';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add a comment…';
    const send = document.createElement('button');
    send.type = 'button';
    send.textContent = 'Post';
    composer.append(input, send);
    panel.appendChild(composer);

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        if (panel.style.display === 'block') input.focus();
    });

    const post = async () => {
        const text = input.value.trim();
        if (!text) return;
        if (!requireSignIn()) return;
        send.disabled = true;
        const target = getOrInitCommunityRow(record);
        const me = currentUser();
        const created = await api.addPublicComment(
            target?.id ?? null,
            text,
            me.name,
            variationId,
            target?.id == null ? communityWriteOpts(record) : {}
        );
        send.disabled = false;
        if (!created) return notify(ctx, 'Could not post that comment.', 'error');
        if (target && target.id == null && created.publicItemId != null) target.id = created.publicItemId;
        target.comments = target.comments || [];
        target.comments.push(created);
        rerenderVariations(ctx);
    };
    send.addEventListener('click', (e) => { e.stopPropagation(); post(); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); post(); }
    });

    return wrap;
}

// The composer for proposing a new version. For a publisher it goes live; for
// everyone else it becomes a suggestion the store reviews here.
function buildSuggestVersionBlock(ctx) {
    const { record } = ctx;
    const canReview = viewerCanReview();

    const wrap = document.createElement('div');
    wrap.className = 'variation-suggest';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'variation-suggest-toggle';
    toggle.textContent = canReview ? '➕ Add a version' : '💡 Suggest a version';
    wrap.appendChild(toggle);

    const form = document.createElement('div');
    form.className = 'variation-suggest-form';
    form.style.display = 'none';
    form.innerHTML = `
        <input type="text" class="variation-input-label" placeholder="Name this version (optional)">
        <input type="text" class="variation-input-name" placeholder="Item name">
        <textarea class="variation-input-description" rows="3" placeholder="Describe this version"></textarea>
        <input type="text" class="variation-input-price" placeholder="Price (optional)">
        <div class="variation-suggest-actions">
            <button type="button" class="variation-suggest-submit"></button>
            <span class="variation-suggest-hint"></span>
        </div>
    `;
    wrap.appendChild(form);

    const nameInput = form.querySelector('.variation-input-name');
    const descInput = form.querySelector('.variation-input-description');
    const priceInput = form.querySelector('.variation-input-price');
    const labelInput = form.querySelector('.variation-input-label');
    const submit = form.querySelector('.variation-suggest-submit');
    const hint = form.querySelector('.variation-suggest-hint');

    nameInput.value = record.fields?.Name || '';
    descInput.value = record.fields?.Description || '';
    priceInput.value = record.fields?.Price != null ? String(record.fields.Price) : '';
    submit.textContent = canReview ? 'Save version' : 'Send suggestion';
    hint.textContent = canReview
        ? 'Saved live. You choose whether the catalog switches to it.'
        : 'A store publisher reviews this before anyone else sees it.';

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        form.style.display = form.style.display === 'none' ? 'flex' : 'none';
        if (form.style.display === 'flex') nameInput.focus();
    });

    submit.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!requireSignIn()) return;
        if (!nameInput.value.trim() && !descInput.value.trim()) {
            notify(ctx, 'Give the version a name or a description.', 'error');
            return;
        }
        submit.disabled = true;
        const makeCurrent = canReview && confirm(
            'Save this version.\n\nPress OK to also make it the version the catalog shows. ' +
            'Plans that already added this item keep the version they have.'
        );
        const result = await recordEditAsVariation(record, {
            name: nameInput.value.trim() || record.fields?.Name,
            description: descInput.value.trim(),
            price: priceInput.value.trim() || null,
            label: labelInput.value.trim() || null,
            source: 'manual',
            makeCurrent
        });
        submit.disabled = false;
        if (!result) return notify(ctx, 'Could not save that version.', 'error');
        refreshAfterVariationChange(ctx);
        notify(
            ctx,
            canReview ? 'Version saved.' : 'Suggestion sent to the store for review.',
            'success'
        );
    });

    return wrap;
}

// Re-render the accordion and, when the catalog's current version moved, the
// catalog and plan views behind it.
function refreshAfterVariationChange(ctx) {
    const row = getCommunityRowForRecord(ctx.record);
    if (row) {
        if (row.catalogItemId) applyCurrentVariationToCatalogItem(row);
        else applyCurrentVariationFields(ctx.record, row);
    }
    invalidateRecordsIndex();
    rerenderVariations(ctx);
    if (typeof window.applyFiltersAndSort === 'function') {
        window.applyFiltersAndSort(window.imageCache);
    }
    if (typeof window.updateEventPlanSection === 'function') {
        window.updateEventPlanSection();
    }
}

// Toast when the host page offers one; otherwise stay silent rather than
// interrupting with an alert.
function notify(ctx, message, type) {
    if (typeof window.showToast === 'function') {
        window.showToast(message, 5000, type === 'error' ? 'error' : 'success');
    } else {
        log('PublicCatalog', message);
    }
}
