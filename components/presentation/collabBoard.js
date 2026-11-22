// FILE: components/presentation/collabBoard.js
//
// The collab board: the store's community ideas, ranked by collab response, shown
// in the plan (collab) view. It is the default view when no plan is in progress
// (the plan is empty), and a toggle in the view opens it at any time.
//
// Sections follow the collab lifecycle; collab stays open in every section:
//   Open for collab — suggested (author/admins only), recommended, in catalog
//   Coming up       — scheduled, soonest first
//   Delivered       — delivered, so feedback can refine what comes next
import { state } from '../../state.js';
import {
    isPublicIdeaRecord, getCollabScore, collabStageOf, COLLAB_STAGE_LABELS, whenPublicIdeasLoaded
} from '../publicCatalog.js';
import { showDetailModal } from '../modal.js';
import { optimizeImageUrl } from '../../utils/imageOptimizer.js';

let showingBoard = false;      // board toggled on while the plan has items
let waitingForIdeas = false;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function isCollabBoardToggled() {
    return showingBoard;
}

export function setCollabBoardToggled(on) {
    showingBoard = !!on;
    updateToggleButton();
}

function boardIdeas() {
    const storeId = state.ui?.activeShopId;
    return (state.records?.all || []).filter(r => {
        if (!isPublicIdeaRecord(r)) return false;
        if (storeId && Array.isArray(r.fields?.Stores) && !r.fields.Stores.includes(storeId)) return false;
        const stage = r.collabStage || collabStageOf(r);
        return stage !== 'none' && stage !== 'declined';
    });
}

function imageFor(record) {
    const f = record.fields || {};
    const curated = Array.isArray(f['Curated Images']) ? f['Curated Images'][0]?.url : null;
    const url = curated || record.publicImageUrl || f.imageUrl || null;
    if (!url) return null;
    try { return optimizeImageUrl(url, { width: 480 }) || url; } catch { return url; }
}

function cardHTML(record) {
    const stage = record.collabStage || collabStageOf(record);
    const { reactions, comments } = getCollabScore(record);
    let stageLabel = COLLAB_STAGE_LABELS[stage] || '';
    if (stage === 'scheduled' && record.scheduledFor) {
        try { stageLabel += ` · ${new Date(record.scheduledFor).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`; } catch { /* keep label */ }
    }
    const img = imageFor(record);
    return `
        <button type="button" class="collab-board-card collab-stage-${esc(stage)}" data-collab-record="${esc(record.id)}" aria-label="${esc(record.fields?.Name || 'Idea')}, ${esc(stageLabel)}">
            <span class="collab-board-photo"${img ? ` style="background-image:url('${esc(img)}')"` : ''}>${img ? '' : '💡'}</span>
            <span class="collab-board-body">
                <span class="collab-board-stage">${esc(stageLabel)}</span>
                <span class="collab-board-name">${esc(record.fields?.Name || 'Untitled idea')}</span>
                <span class="collab-board-feedback">${reactions} reaction${reactions === 1 ? '' : 's'} · ${comments} comment${comments === 1 ? '' : 's'}</span>
            </span>
        </button>`;
}

function section(title, hint, records) {
    if (records.length === 0) return '';
    return `
        <section class="collab-board-section">
            <h3 class="collab-board-section-title">${title} <span class="collab-board-count">${records.length}</span></h3>
            <p class="collab-board-section-hint">${hint}</p>
            <div class="collab-board-grid">${records.map(cardHTML).join('')}</div>
        </section>`;
}

/**
 * Render the board into `container` (replacing its contents).
 * @param {HTMLElement} container
 * @param {{ planIsEmpty?: boolean, onRerender?: Function }} opts
 */
export function renderCollabBoard(container, { planIsEmpty = false, onRerender = null } = {}) {
    const ideas = boardIdeas();
    const ranked = ideas
        .map(r => ({ r, s: getCollabScore(r).score, stage: r.collabStage || collabStageOf(r) }))
        .sort((a, b) => b.s - a.s);
    const open = ranked.filter(x => ['suggested', 'recommended', 'catalog'].includes(x.stage)).map(x => x.r);
    const upcoming = ranked.filter(x => x.stage === 'scheduled')
        .sort((a, b) => new Date(a.r.scheduledFor) - new Date(b.r.scheduledFor)).map(x => x.r);
    const delivered = ranked.filter(x => x.stage === 'delivered').map(x => x.r);
    const storeName = state.stores?.all?.find?.(s => s.id === state.ui?.activeShopId)?.fields?.Name || 'this community';

    const body = ideas.length === 0
        ? `<div class="collab-board-empty">No collab ideas yet. Be the first to suggest one.</div>`
        : section('💡 Open for collab', 'Top ideas first. React and comment to move the best ones forward.', open) +
          section('📅 Coming up', 'Scheduled to be delivered. Collab stays open.', upcoming) +
          section('🎉 Delivered', 'How did it go? Your feedback refines what comes next.', delivered);

    container.classList.remove('board-view');
    container.innerHTML = `
        <section class="itinerary-section collab-board" data-section="collab-board" aria-label="Collab ideas board">
            <header class="collab-board-header">
                <h2 class="collab-board-title">Collab ideas at ${esc(storeName)}</h2>
                <p class="collab-board-tagline">Suggest it. React to it. The community's top ideas get scheduled and delivered.</p>
                <div class="collab-board-actions">
                    <button type="button" class="collab-board-suggest">＋ Suggest an idea</button>
                    ${planIsEmpty ? '' : '<button type="button" class="collab-board-back">📋 Back to my plan</button>'}
                </div>
            </header>
            ${body}
        </section>`;

    container.querySelectorAll('[data-collab-record]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const record = (state.records?.all || []).find(r => r.id === btn.dataset.collabRecord);
            if (record) showDetailModal(record);
        });
    });
    container.querySelector('.collab-board-suggest')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('presentation-add-btn')?.click();
    });
    container.querySelector('.collab-board-back')?.addEventListener('click', (e) => {
        e.stopPropagation();
        setCollabBoardToggled(false);
        onRerender?.();
    });

    // Ideas load in the background on page start; redraw once they arrive.
    if (!waitingForIdeas && onRerender) {
        waitingForIdeas = true;
        whenPublicIdeasLoaded().then(() => {
            waitingForIdeas = false;
            if (container.querySelector('.collab-board')) onRerender();
        });
    }
}

function updateToggleButton() {
    const btn = document.getElementById('presentation-collab-board-toggle');
    if (!btn) return;
    btn.classList.toggle('active', showingBoard);
    btn.setAttribute('aria-pressed', String(showingBoard));
    const label = btn.querySelector('.toggle-label');
    if (label) label.textContent = showingBoard ? 'My plan' : 'Collab board';
    const icon = btn.querySelector('.toggle-icon');
    if (icon) icon.textContent = showingBoard ? '📋' : '💡';
}

/** Wire the toggle in the plan view's toolbar. `rerender` redraws the board/plan area. */
export function initCollabBoardToggle(rerender) {
    const btn = document.getElementById('presentation-collab-board-toggle');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', () => {
        setCollabBoardToggled(!showingBoard);
        rerender();
    });
    updateToggleButton();
}
