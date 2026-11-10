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
import { isPlanReadOnly } from './planAccess.js';

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

let notifyQueued = false;

// Announced on the next tick, so links saved right after a task is created (in the
// same flow) are already in place when listeners read the counts.
function notify() {
    if (notifyQueued) return;
    notifyQueued = true;
    setTimeout(() => {
        notifyQueued = false;
        window.dispatchEvent(new CustomEvent('open-conversations-updated'));
        scheduleSnapshotSave();
    }, 0);
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
        scheduleLinkRepair();
    });
    window.addEventListener('plan-chat-activity', () => scheduleOpenConversationsRefresh());
    window.addEventListener('tasks-state-updated', () => { notify(); scheduleLinkRepair(); });
    // A chat was just turned into a task (the link is saved right after the task).
    window.addEventListener('task-created-from-message', () => setTimeout(notify, 0));
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

    const tasks = projectTasks();
    const taskThreads = recordsSessionId === sessionId ? getTaskThreadRoots(tasks).roots : new Set();
    const resolved = getResolvedThreads();

    if (recordsSessionId === sessionId) {
        for (const record of records) {
            const fields = record?.fields;
            if (!fields || fields.SenderID === 'system' || fields.IsDeleted) continue;
            const itemId = itemIdForFields(fields);
            plan.comments++;
            if (itemId) bucket(byItem, itemId).comments++;

            if (fields.ParentMessageID) continue; // replies belong to their thread
            // A chat turned into a task is the same conversation: its task counts instead.
            if (taskThreads.has(record.id)) continue;
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

// ===== Chat ↔ task linking =====

const LEADING_TAGS = /^(?:\s*\[(?:PLAN_COMMENT:item:[^\]]+|TASK:[^\]]+|IDEA)\]\s*)+/;
const normalize = text => String(text || '').replace(LEADING_TAGS, '').replace(/\s+/g, ' ').trim().toLowerCase();
const MATCH_SKEW_MS = 2 * 60 * 1000;

function recordTime(record) {
    return Date.parse(record?.fields?.Timestamp || record?.createdTime || '') || 0;
}

// Tasks created from a chat copy its text into their name ("first 100 chars…") and
// description. Used to recognise conversions whose saved link went missing.
function taskMatchesMessage(task, text) {
    if (text.length < 3) return false;
    let name = normalize(task.fields?.Name).replace(/^\[[^\]]*\]\s*/, '');
    const truncated = name.endsWith('...');
    if (truncated) name = name.slice(0, -3).trim();
    if (name.length >= 3 && (truncated ? text.startsWith(name) : text === name || text.slice(0, 100) === name)) return true;
    const description = normalize(task.fields?.Description);
    return text.length >= 12 && description.endsWith(text);
}

/**
 * Which chat threads are represented by a task.
 * @returns {{ roots: Set<string>, inferred: Map<string, string> }} thread root ids, and
 *          links recognised from content only (message id -> task id)
 */
export function getTaskThreadRoots(tasks = projectTasks()) {
    const links = state.eventDetails?.combined?.get('_commentTaskLinks') || {};
    const taskIds = new Set(tasks.map(task => task.id));
    const byId = new Map(records.map(record => [record.id, record]));
    const rootOf = (id) => {
        let current = byId.get(id);
        for (let hops = 0; current?.fields?.ParentMessageID && hops < 50; hops++) {
            const parent = byId.get(current.fields.ParentMessageID);
            if (!parent) break;
            current = parent;
        }
        return current?.id || id;
    };

    const linkedTasks = new Set();
    const roots = new Set();
    const mark = (messageId, taskId) => {
        if (!messageId || !taskIds.has(taskId)) return;
        linkedTasks.add(taskId);
        roots.add(rootOf(messageId)); // a reply turned into a task covers its whole thread
    };
    for (const [messageId, taskId] of Object.entries(links)) mark(messageId, taskId);
    for (const task of tasks) if (task.fields?.SourceCommentId) mark(task.fields.SourceCommentId, task.id);
    for (const record of records) {
        const taskId = taskMessageId(record?.fields?.Content || '');
        if (taskId) mark(record.id, taskId);
    }

    // Fallback: match unlinked tasks to the latest unlinked thread that carries their text.
    const inferred = new Map();
    const candidates = records.filter(record => record?.fields && !record.fields.IsDeleted &&
        record.fields.SenderID !== 'system' && !roots.has(rootOf(record.id)));
    for (const task of tasks) {
        if (linkedTasks.has(task.id)) continue;
        const created = Date.parse(task.fields?.CreatedTime || task.createdTime || '') || Infinity;
        let best = null;
        for (const record of candidates) {
            if (roots.has(rootOf(record.id)) || recordTime(record) > created + MATCH_SKEW_MS) continue;
            if (!taskMatchesMessage(task, normalize(record.fields.Content))) continue;
            if (!best || recordTime(record) > recordTime(best)) best = record;
        }
        if (best) {
            inferred.set(best.id, task.id);
            roots.add(rootOf(best.id));
        }
    }
    return { roots, inferred };
}

let repairTimer = null;

// Save links recognised from content so every view (and every collaborator) treats
// the chat and its task as one from now on. Only for people who can edit the plan.
function scheduleLinkRepair() {
    clearTimeout(repairTimer);
    repairTimer = setTimeout(() => {
        repairTimer = null;
        const sessionId = state.session?.id;
        if (!sessionId || recordsSessionId !== sessionId || !deps.triggerSave) return;
        if (!state.session.user?.isAuthenticated || isPlanReadOnly()) return;
        if (!getProjectTaskLoadState(sessionId).loaded) return;
        const { inferred } = getTaskThreadRoots();
        if (inferred.size === 0) return;
        const links = { ...(state.eventDetails.combined.get('_commentTaskLinks') || {}) };
        for (const [messageId, taskId] of inferred) {
            links[messageId] = taskId;
            const task = state.tasks.all.get(taskId);
            if (task?.fields && !task.fields.SourceCommentId) task.fields.SourceCommentId = messageId;
        }
        state.eventDetails.combined.set('_commentTaskLinks', links);
        deps.triggerSave();
        window.dispatchEvent(new CustomEvent('open-conversations-updated'));
    }, 1500);
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
