// Open chat/task counts for the plan view.
//
// "Open" means:
//   • a task on this plan whose status is not completed, and
//   • a top-level chat thread that nobody has marked resolved yet.
// A chat thread that has been turned into a task (or is a task's own discussion)
// is represented by that task, so it is never counted twice.
//
// Resolved threads are stored with the plan's saved details (like comment↔task
// links), so every collaborator sees the same state without a schema change.
import { state } from '../state.js';
import { taskMessageId } from './taskDiscussion.js';
import { getProjectTaskLoadState } from './projectTasks.js';

export const RESOLVED_THREADS_KEY = '_resolvedChatThreads';
const PLAN_COMMENT_PREFIX = /^\[PLAN_COMMENT:item:([^\]]+)\]/;
const REFRESH_DELAY_MS = 1200;
const SNAPSHOT_DELAY_MS = 4000;

let deps = { fetchChatMessages: null, triggerSave: null, saveSnapshot: null };
let snapshotTimer = null;
let records = [];
let recordsSessionId = null;
let refreshTimer = null;
let listening = false;

function notify() {
    window.dispatchEvent(new CustomEvent('open-conversations-updated'));
    scheduleSnapshotSave();
}

export function initOpenConversations({ fetchChatMessages, triggerSave, saveSnapshot } = {}) {
    if (fetchChatMessages) deps.fetchChatMessages = fetchChatMessages;
    if (triggerSave) deps.triggerSave = triggerSave;
    if (saveSnapshot) deps.saveSnapshot = saveSnapshot;
    if (listening) return;
    listening = true;
    // Any full message fetch (this module's, the conversation panel's, ...) is authoritative.
    window.addEventListener('plan-messages-loaded', (event) => {
        const { sessionId, records: loaded } = event.detail || {};
        if (!sessionId || sessionId !== state.session?.id || !Array.isArray(loaded)) return;
        clearTimeout(refreshTimer);
        refreshTimer = null;
        records = loaded;
        recordsSessionId = sessionId;
        notify();
    });
    window.addEventListener('plan-chat-activity', () => scheduleOpenConversationsRefresh());
    window.addEventListener('tasks-state-updated', notify);
    document.addEventListener('planStateChanged', () => {
        if (recordsSessionId !== state.session?.id) scheduleOpenConversationsRefresh(0);
        else notify();
    });
}

/** Re-read the plan's messages soon; collapses bursts of activity into one request. */
export function scheduleOpenConversationsRefresh(delay = REFRESH_DELAY_MS) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        const sessionId = state.session?.id;
        if (!sessionId || !deps.fetchChatMessages) return;
        // The fetch announces its result via 'plan-messages-loaded'.
        Promise.resolve(deps.fetchChatMessages(sessionId)).catch(() => {});
    }, delay);
}

export function getResolvedThreads() {
    const value = state.eventDetails?.combined?.get(RESOLVED_THREADS_KEY);
    return value && typeof value === 'object' ? value : {};
}

export function isThreadResolved(messageId) {
    return !!(messageId && getResolvedThreads()[messageId]);
}

export function setThreadResolved(messageId, resolved, user = null) {
    if (!messageId) return;
    const next = { ...getResolvedThreads() };
    if (resolved) {
        next[messageId] = { by: user?.id || null, byName: user?.name || null, at: new Date().toISOString() };
    } else {
        delete next[messageId];
    }
    state.eventDetails.combined.set(RESOLVED_THREADS_KEY, next);
    deps.triggerSave?.();
    notify();
}

function itemIdForFields(fields) {
    const link = fields['Item Link'];
    const linked = Array.isArray(link) ? link[0] : link;
    if (linked) return linked;
    return String(fields.Content || '').match(PLAN_COMMENT_PREFIX)?.[1] || null;
}

function projectTasks() {
    const projectId = state.session?.id;
    if (!projectId) return [];
    return (state.tasks.byProject.get(projectId) || []).map(task => state.tasks.all.get(task.id) || task);
}

function bucket(map, key) {
    if (!map.has(key)) map.set(key, { chats: 0, tasks: 0, comments: 0, total: 0 });
    return map.get(key);
}

/**
 * @returns {{ plan: {chats:number, tasks:number, comments:number, total:number},
 *             byItem: Map<string, {chats:number, tasks:number, comments:number, total:number}> }}
 */
export function getOpenConversationCounts() {
    const plan = { chats: 0, tasks: 0, comments: 0, total: 0 };
    const byItem = new Map();
    const sessionId = state.session?.id;
    if (!sessionId) return { plan, byItem };

    const links = state.eventDetails.combined.get('_commentTaskLinks') || {};
    const tasks = projectTasks();
    const taskSources = new Set(tasks.map(task => task.fields?.SourceCommentId).filter(Boolean));
    const resolved = getResolvedThreads();

    if (recordsSessionId === sessionId) {
        for (const record of records) {
            const fields = record?.fields;
            if (!fields || fields.SenderID === 'system' || fields.IsDeleted) continue;
            const itemId = itemIdForFields(fields);
            plan.comments++;
            if (itemId) bucket(byItem, itemId).comments++;

            if (fields.ParentMessageID) continue; // replies belong to their thread
            if (links[record.id] || taskSources.has(record.id) || taskMessageId(fields.Content || '')) continue;
            if (resolved[record.id]) continue;
            plan.chats++;
            if (itemId) bucket(byItem, itemId).chats++;
        }
    }

    for (const task of tasks) {
        if ((task.fields?.Status || 'pending') === 'completed') continue;
        plan.tasks++;
        for (const itemId of new Set(task.fields?.LinkedItem || [])) bucket(byItem, itemId).tasks++;
    }

    plan.total = plan.chats + plan.tasks;
    for (const counts of byItem.values()) counts.total = counts.chats + counts.tasks;
    return { plan, byItem };
}

export function describeOpenCounts(counts, { emptyLabel = 'No open chats or tasks' } = {}) {
    const parts = [];
    if (counts.chats) parts.push(`${counts.chats} open chat${counts.chats !== 1 ? 's' : ''}`);
    if (counts.tasks) parts.push(`${counts.tasks} open task${counts.tasks !== 1 ? 's' : ''}`);
    const head = parts.join(' · ') || emptyLabel;
    return counts.comments ? `${head} (${counts.comments} message${counts.comments !== 1 ? 's' : ''} total)` : head;
}

/** Combined counts for several items (e.g. an option group); a task linked to several counts once. */
export function getOpenCountsForItems(itemIds = []) {
    const ids = new Set(itemIds);
    const { byItem } = getOpenConversationCounts();
    const counts = { chats: 0, tasks: 0, comments: 0, total: 0 };
    for (const id of ids) {
        const c = byItem.get(id);
        if (c) { counts.chats += c.chats; counts.comments += c.comments; }
    }
    for (const task of projectTasks()) {
        if ((task.fields?.Status || 'pending') === 'completed') continue;
        if ((task.fields?.LinkedItem || []).some(id => ids.has(id))) counts.tasks++;
    }
    counts.total = counts.chats + counts.tasks;
    return counts;
}

// ===== Saved snapshot (used by the plans list for plans that aren't open) =====

/**
 * The current plan's open counts, or null while its messages or tasks are still
 * loading (so a partial count is never saved over a good one).
 */
export function getOpenConversationSnapshot() {
    const sessionId = state.session?.id;
    if (!sessionId || recordsSessionId !== sessionId) return null;
    if (!getProjectTaskLoadState(sessionId).loaded) return null;
    const { plan } = getOpenConversationCounts();
    return { chats: plan.chats, tasks: plan.tasks, total: plan.total, at: new Date().toISOString() };
}

/** The snapshot to write with a full plan save: fresh when known, otherwise the last saved one. */
export function getOpenConversationSnapshotForSave() {
    const fresh = getOpenConversationSnapshot();
    if (fresh) {
        state.session.openConversationsSnapshot = fresh;
        return fresh;
    }
    return state.session?.openConversationsSnapshot || undefined;
}

export function readSavedOpenConversations(planData) {
    const snap = planData?.openConversations;
    if (!snap || typeof snap !== 'object') return null;
    const chats = Number(snap.chats) || 0;
    const tasks = Number(snap.tasks) || 0;
    return { chats, tasks, total: chats + tasks, at: snap.at || null };
}

// When the live count drifts from the saved one (e.g. a new chat arrived), save
// just the snapshot after things settle, so the plans list stays close to current.
function scheduleSnapshotSave() {
    if (!deps.saveSnapshot) return;
    clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
        snapshotTimer = null;
        const sessionId = state.session?.id;
        const fresh = getOpenConversationSnapshot();
        if (!sessionId || !fresh) return;
        const saved = state.session.openConversationsSnapshot;
        if (saved && saved.chats === fresh.chats && saved.tasks === fresh.tasks) return;
        Promise.resolve(deps.saveSnapshot(sessionId, fresh)).then(ok => {
            if (ok && state.session?.id === sessionId) state.session.openConversationsSnapshot = fresh;
        }).catch(() => {});
    }, SNAPSHOT_DELAY_MS);
}
