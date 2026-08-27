// FILE: components/planAtmosphere.js
//
// Single source of truth for a plan's background "atmosphere".
//
// The background used to be an accumulator: ~15 call sites each nudged a shared scalar by a
// hand-tuned weight. Two problems fell out of that. Any code path could move it — including
// the catalog's chunked card renderer, which is what made the background twitch while images
// loaded. And because the value was history-dependent, the same plan never looked the same
// twice across reloads.
//
// Here the atmosphere is DERIVED from the plan's own facts instead:
//   - a re-render cannot move it, because a re-render does not change the plan;
//   - undoing an action genuinely reverses it, because the undone fact stops contributing;
//   - the same plan always resolves to the same background.
//
// Both renderers (the catalog's components/backgroundEngine.js and the presentation view's
// components/presentation/backgroundEngine.js) read their frame from this module, so a plan
// looks identical wherever it is viewed.

import { state } from '../state.js';
import { getPlanSummary } from '../utils/planStateSync.js';
import { log } from '../utils/debug.js';

// --- Derivation -------------------------------------------------------------------------

// A payment of this fraction of the plan subtotal counts the plan as "reserved" — i.e.
// checkout / payment has occurred.
export const RESERVED_PAYMENT_THRESHOLD = 0.35;

// Task status string that marks a task done. Mirrors api.TASK_STATUS.COMPLETED; kept as a
// literal so this module stays free of the (very large) api.js dependency graph.
const TASK_STATUS_COMPLETED = 'completed';

// How far along the spectrum each stage of the journey can carry the background.
// These sum to 1.0.
const WEIGHTS = {
    explore:  0.13,  // ideas gathered
    commit:   0.25,  // items locked into the plan
    refine:   0.17,  // name / date / headcount / goals — 0.0425 each
    converse: 0.06,  // conversations started on the plan or its items
    scope:    0.05,  // components the plan is tracking at all, open or closed
    secure:   0.15,  // reserved, then paid off
    finish:   0.19,  // components actually closed out: items, tasks and chats
};

// Saturating curve. The 2nd locked item should feel like more movement than the 20th — that
// front-loading is what makes the arc read as a journey rather than as a progress bar.
function saturating(n, k) {
    return n > 0 ? n / (n + k) : 0;
}

function clamp01(v) {
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
}

/**
 * Count tasks belonging to the active plan. Tasks can be created in the presentation view or
 * out of chat; either way they land in state.tasks.
 */
function countPlanTasks() {
    const planId = state.session?.id;
    let tasks = [];

    if (planId && state.tasks?.byProject?.has(planId)) {
        tasks = state.tasks.byProject.get(planId) || [];
    } else if (state.tasks?.all?.size) {
        tasks = Array.from(state.tasks.all.values());
    }

    let done = 0;
    for (const task of tasks) {
        if ((task?.fields?.Status || '') === TASK_STATUS_COMPLETED) done++;
    }
    return { total: tasks.length, done };
}

// --- Conversation threads ----------------------------------------------------------------
//
// Every item and every conversation on a plan starts OPEN, and closing it out is what
// crystallizes the background. Chat messages are not held in state (they are fetched and
// rendered straight to the DOM), so the plan keeps a small set of the thread keys that exist,
// persisted with the session. Threads are components of the plan, not events: a second
// message in a thread that already exists changes nothing.

const THREAD_PLAN = 'plan';
const PLAN_COMMENT_PREFIX = /^\[PLAN_COMMENT:([A-Za-z]+)(?::([^\]]+))?\]/;

/**
 * Whether a record in the Messages table is actually part of a conversation.
 *
 * The Messages table also carries the plan's own history (system events written by
 * postPlanEvent) and soft-deleted messages. Neither is a conversation, and counting plan
 * events would give every plan a permanently open thread it never asked for.
 */
function isConversationMessage(fields) {
    if (!fields) return false;
    if (fields.SenderID === 'system' && fields.EventType) return false;
    if (fields.IsDeleted) return false;
    return true;
}

/**
 * Which conversation a message belongs to. Every chat message and component comment lives in
 * the same Messages table, distinguished by an Item Link or a [PLAN_COMMENT:...] prefix.
 *
 * Replies carry the same markers as the message they answer, so they land in the thread they
 * belong to rather than opening a new one.
 *
 * @param {Object} fields - the message record's Airtable fields
 * @returns {string|null} 'plan' | 'item:<recordId>' | 'component:<type>', or null if this
 *   record is not a conversation message at all.
 */
export function threadKeyForMessage(fields) {
    if (!isConversationMessage(fields)) return null;

    const itemLinks = fields && fields['Item Link'];
    if (Array.isArray(itemLinks) && itemLinks.length > 0 && itemLinks[0]) {
        return `item:${itemLinks[0]}`;
    }

    const match = PLAN_COMMENT_PREFIX.exec(String((fields && fields.Content) || ''));
    if (match) {
        const type = match[1].toLowerCase();
        if (type === 'item' && match[2]) return `item:${match[2]}`;
        return `component:${type}`;
    }

    return THREAD_PLAN;
}

function threadSet() {
    if (!state.session) return null;
    if (!(state.session.chatThreads instanceof Set)) state.session.chatThreads = new Set();
    return state.session.chatThreads;
}

/**
 * Note that a conversation exists on the active plan. Called when a message is sent, and when
 * one arrives from a collaborator, so the background moves live rather than on next load.
 *
 * Safe to call with anything: a bad record or a message for a different plan is ignored, and
 * nothing here is allowed to throw into a chat code path.
 *
 * @param {string} sessionId - the plan the message belongs to
 * @param {Object} fields - the message record's Airtable fields
 */
export function registerChatThread(sessionId, fields) {
    try {
        if (!sessionId || sessionId !== state.session?.id) return;
        const threads = threadSet();
        if (!threads) return;

        const key = threadKeyForMessage(fields);
        if (!key || threads.has(key)) return;

        threads.add(key);
        refreshFromPlan(`chat-thread-opened:${key}`);
    } catch (e) {
        // Never let the background break sending or receiving a message.
    }
}

/**
 * Register a conversation from a realtime (Pusher) payload rather than an Airtable record, so
 * a collaborator's message moves the background now instead of on the next load.
 *
 * @param {string} sessionId - the plan the message belongs to
 * @param {string} content - the message body, which may still carry a [PLAN_COMMENT:...] prefix
 * @param {string|null} itemId - the item the message is attached to, if any
 */
export function registerRealtimeChatThread(sessionId, content, itemId = null) {
    const fields = { Content: String(content || '') };

    if (itemId && String(itemId).startsWith('rec')) {
        fields['Item Link'] = [itemId];
    } else if (itemId) {
        // Custom item ids cannot be linked in Airtable, so they ride in the content prefix —
        // mirror that here so realtime and persisted messages resolve to the same thread.
        fields.Content = `[PLAN_COMMENT:item:${itemId}] ${fields.Content}`;
    }

    registerChatThread(sessionId, fields);
}

/**
 * Replace the active plan's thread set from a full fetch of its messages. Authoritative, so
 * conversations that were deleted stop counting.
 *
 * @param {string} sessionId - the plan the records belong to
 * @param {Array} records - message records as returned by api.fetchChatMessages
 */
export function syncChatThreadsFromMessages(sessionId, records) {
    try {
        if (!sessionId || sessionId !== state.session?.id) return;
        const threads = threadSet();
        if (!threads || !Array.isArray(records)) return;

        const next = new Set();
        for (const record of records) {
            const key = record && record.fields ? threadKeyForMessage(record.fields) : null;
            if (key) next.add(key);
        }

        let changed = next.size !== threads.size;
        if (!changed) {
            for (const key of next) {
                if (!threads.has(key)) { changed = true; break; }
            }
        }
        if (!changed) return;

        state.session.chatThreads = next;
        refreshFromPlan('chat-threads-synced');
    } catch (e) {
        // As above: a background refresh must never take the chat panel down with it.
    }
}

/**
 * Count the plan's conversations, and how many of them have been closed out.
 *
 * A conversation on an item resolves when that item is marked complete. Plan-level threads
 * have no "complete" action of their own, so they resolve once every item and task on the
 * plan is done — which is evaluated BEFORE chats are folded in, so a plan-level chat can
 * never be the thing preventing itself from resolving.
 *
 * Threads on items that are no longer committed to the plan are not counted at all, matching
 * how completed items only count while they are still locked in.
 */
function countChatThreads(itemsAndTasksComplete) {
    const threads = state.session?.chatThreads;
    if (!(threads instanceof Set) || threads.size === 0) return { total: 0, resolved: 0 };

    let total = 0;
    let resolved = 0;

    for (const key of threads) {
        if (key.startsWith('item:')) {
            const itemId = key.slice(5);
            if (!state.cart.lockedItems.has(itemId)) continue;
            total++;
            if (state.session.completedItems?.has(itemId)) resolved++;
        } else {
            total++;
            if (itemsAndTasksComplete) resolved++;
        }
    }

    return { total, resolved };
}

/**
 * Derive the whole atmosphere from the current plan.
 * Pure with respect to the background: calling it repeatedly never changes anything.
 *
 * @returns {{progress:number, crystal:number, paidRatio:number, isReserved:boolean,
 *            fulfillment:number, closure:number, scope:number, lockedCount:number,
 *            ideasCount:number,
 *            refinedDetails:number, tasks:{total:number, done:number},
 *            chats:{total:number, resolved:number}, openComponents:number}}
 */
export function computeAtmosphere() {
    const summary = getPlanSummary();

    const lockedCount = summary.lockedItemsCount || 0;
    const ideasCount = summary.ideasCount || 0;
    const subtotal = summary.subtotal || 0;
    const amountReceived = summary.amountReceived || 0;

    // "Reserved" = checkout/payment has occurred, i.e. at least 35% of the plan is paid.
    // When the subtotal is 0 but money has been received, nothing is owed, so treat it as
    // fully paid. This also covers the window right after a session loads but before the
    // catalog records are in memory, when every locked item still prices at 0.
    const paidRatio = subtotal > 0
        ? clamp01(amountReceived / subtotal)
        : (amountReceived > 0 ? 1 : 0);
    const isReserved = paidRatio >= RESERVED_PAYMENT_THRESHOLD;

    // Completed items only count while they are still committed to the plan.
    let completedItemCount = 0;
    if (state.session?.completedItems?.size) {
        for (const recordId of state.session.completedItems) {
            if (state.cart.lockedItems.has(recordId)) completedItemCount++;
        }
    }

    const tasks = countPlanTasks();

    const refinedDetails = [summary.eventName, summary.eventDate, summary.guestCount, summary.goals]
        .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
        .length;

    // Fulfillment: how much of what is open on this plan has actually been closed out.
    // Items, tasks and conversations are pooled into one set of "open components", so a plan
    // is not "finished" just because its items are — an open task or an open chat still
    // counts against it.
    const itemsAndTasksTotal = lockedCount + tasks.total;
    const itemsAndTasksDone = completedItemCount + tasks.done;
    const itemsAndTasksComplete = itemsAndTasksTotal > 0 && itemsAndTasksDone >= itemsAndTasksTotal;

    const chats = countChatThreads(itemsAndTasksComplete);

    const fulfillableTotal = itemsAndTasksTotal + chats.total;
    const fulfilledTotal = itemsAndTasksDone + chats.resolved;
    const fulfillment = fulfillableTotal > 0 ? clamp01(fulfilledTotal / fulfillableTotal) : 0;
    const openComponents = fulfillableTotal - fulfilledTotal;

    // Two different questions, deliberately measured differently:
    //
    //   closure     — how much the user has actually closed out with their own hands. An
    //                 absolute count of items completed and tasks done, because it feeds the
    //                 journey. A ratio here would let deleting an open item push the plan
    //                 forward (a ratio rises when its denominator shrinks). Resolved chats are
    //                 left out for the same reason: a chat resolves as a CONSEQUENCE of the
    //                 items and tasks being done, so deleting the last open one would resolve
    //                 every chat at once and read as forward movement. A conversation's step
    //                 forward is taken when it opens; its resolution shows up in the crystal.
    //   fulfillment — whether there is anything left open AT ALL. A ratio, because that is
    //                 what crystallization means: bought, and nothing outstanding.
    const closure = saturating(itemsAndTasksDone, 4);

    // Opening a component is itself a small step forward — the plan now has more to it than it
    // did. It also means closing one nets out to more than the scope it gives up, and deleting
    // one costs the plan that step back rather than being free.
    const scope = saturating(fulfillableTotal, 4);

    // Reserving the plan is the big move; paying off the balance keeps carrying it forward
    // rather than flattening out, so settling up still registers as progress.
    const payment = 0.6 * clamp01(paidRatio / RESERVED_PAYMENT_THRESHOLD) + 0.4 * paidRatio;

    const progress = clamp01(
        WEIGHTS.explore  * saturating(ideasCount, 4) +
        WEIGHTS.commit   * saturating(lockedCount, 5) +
        WEIGHTS.refine   * (refinedDetails / 4) +
        WEIGHTS.converse * saturating(chats.total, 2) +
        WEIGHTS.scope    * scope +
        WEIGHTS.secure   * payment +
        WEIGHTS.finish   * closure
    );

    // Crystallization: bought AND everything complete/fulfilled. These are multiplied rather
    // than added, so neither payment alone nor completion alone crystallizes a plan — it only
    // reaches 1.0 when the plan is fully paid and every item and task is done.
    const paymentFactor = paidRatio <= RESERVED_PAYMENT_THRESHOLD
        ? (paidRatio / RESERVED_PAYMENT_THRESHOLD) * 0.5
        : 0.5 + 0.5 * ((paidRatio - RESERVED_PAYMENT_THRESHOLD) / (1 - RESERVED_PAYMENT_THRESHOLD));

    const crystal = lockedCount > 0 ? clamp01(paymentFactor * fulfillment) : 0;

    // Progress and crystal are kept as two independent axes on purpose. Progress is distance
    // travelled, and only the user's own actions move it. Crystal is whether the plan is
    // locked in, and it is a ratio, so it can also rise when open work is DELETED. Letting it
    // feed progress would mean deleting the last open item nudged the journey forward, which
    // contradicts "removing something regresses". Crystallization is highly visible without
    // it: it facets the pattern, finalizes the colour, tightens the vignette, damps the swirl
    // and drives the shimmer.
    return {
        progress, crystal, paidRatio, isReserved, fulfillment, closure, scope,
        lockedCount, ideasCount, refinedDetails, tasks, chats, openComponents,
    };
}

// --- Seed: one unique background per plan ------------------------------------------------

function hashToUnit(key) {
    let h = 2166136261;
    const s = String(key);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 100000) / 100000;
}

let seedCache = { key: null, value: 0 };

/**
 * The plan's seed (0..1). Rotates the hue basis, noise offset and band count in the shader,
 * so two plans at identical progress still look like different places.
 *
 * A seed persisted with the session wins; otherwise it is derived from the session id, which
 * means collaborators on a shared plan see the same background without any extra plumbing.
 */
export function getSeed() {
    const stored = state.session?.backgroundSeed;
    if (typeof stored === 'number' && isFinite(stored)) return clamp01(stored);

    const sessionId = state.session?.id;
    const key = sessionId || 'new-plan';
    if (seedCache.key !== key) seedCache = { key, value: hashToUnit(key) };

    // Once the plan has a real id, lock the seed in so it gets persisted on the next save and
    // can never drift, even if the id scheme changes later. Before that, stay derived — a
    // brand-new plan must not freeze the 'new-plan' placeholder as its identity.
    if (sessionId) state.session.backgroundSeed = seedCache.value;

    return seedCache.value;
}

// --- Animated state (shared by every renderer) -------------------------------------------

// Respect users who asked the OS to minimize motion: no swirl at all, colour still eases.
const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let targetProgress = null;          // null until the first derivation
let displayedProgress = state.ui?.currentProgress ?? 0.3;
let targetCrystal = 0;
let displayedCrystal = 0;
let energy = 0;
let spin = 0;
let spinDirection = 1;
let manualProgress = null;          // debug-panel override; suspends derivation while set

let lastTickTimestamp = -1;

const EASE_TAU = 0.35;              // seconds — a change visually settles in ~0.8s
const SPIN_RATE = 1.2;              // radians of swirl per unit energy per second
const SETTLE_EPS = 0.0005;

// Shimmer: the one motion a settled background is allowed to have. A crystallizing plan
// catches the light instead of sitting dead, and it fades in with crystallization rather than
// appearing all at once at the end. It is a specular highlight only — it never touches
// progress, hue or the swirl, so it cannot be mistaken for the journey moving.
let shimmerPhase = 0;
const SHIMMER_MIN_CRYSTAL = 0.15;   // below this a plan is still fluid; no shimmer at all
const SHIMMER_CYCLE_SPEED = 0.07;   // sweeps per second at full crystal (~14s per pass)

// Shimmer renders on a throttle rather than every frame. A slow sweep does not need 60fps,
// and the phase is advanced from elapsed time, so the sweep runs at the same speed whatever
// cadence a renderer picks.
export const SHIMMER_FRAME_MS = 66; // ~15fps

// Energy decay is time-based, not per-frame. Per-frame decay meant a janky image load — which
// drops frames — changed how far the vortex actually spun, making the motion irreproducible.
// 0.906/s reproduces the old 0.985-per-frame feel at 60fps.
let energyDecayK = 0.906;

const listeners = new Set();

/** Subscribe to "something changed, a renderer should wake up". Returns an unsubscribe fn. */
export function onAtmosphereChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

function notify() {
    for (const callback of listeners) {
        try { callback(); } catch (e) { /* a sleeping renderer must never break a plan edit */ }
    }
}

/**
 * Re-derive the atmosphere from the plan and animate toward it.
 *
 * @param {string} reason - for logging only
 * @param {number} directionHint - sign of the triggering action, used only when the derived
 *   target did not move (e.g. browsing a category), to give a small acknowledgement pulse
 *   without advancing the journey.
 */
export function refreshFromPlan(reason = 'plan-change', directionHint = 0) {
    const next = computeAtmosphere();
    const firstRun = targetProgress === null;

    // While the app is still booting, plan facts land in bursts (catalog records, the session
    // blob, chat history). Snap to each derivation instead of sweeping toward it, so opening a
    // plan produces no visible motion at all.
    const booting = state.ui?.isInitializing === true;

    const delta = firstRun ? 0 : next.progress - targetProgress;
    const crystalDelta = firstRun ? 0 : next.crystal - targetCrystal;

    targetProgress = next.progress;
    targetCrystal = next.crystal;

    if (firstRun || booting) {
        // Opening an existing plan should show its background, not animate a catch-up sweep.
        displayedProgress = targetProgress;
        displayedCrystal = targetCrystal;
        if (state.ui) state.ui.currentProgress = displayedProgress;
        notify();
        return next;
    }

    const moved = Math.abs(delta) > SETTLE_EPS || Math.abs(crystalDelta) > SETTLE_EPS;

    if (moved) {
        // Forward progress swirls clockwise, undoing swirls counter-clockwise, and the size of
        // the action sets how much it swirls.
        spinDirection = (Math.abs(delta) > SETTLE_EPS ? Math.sign(delta) : Math.sign(crystalDelta)) || 1;
        energy = Math.min(1, energy + Math.min(0.5, Math.abs(delta) * 8 + Math.abs(crystalDelta) * 4));
        log('Atmosphere', `${reason}: progress ${displayedProgress.toFixed(3)} -> ${targetProgress.toFixed(3)}, crystal ${targetCrystal.toFixed(3)}`);
    } else if (directionHint !== 0) {
        spinDirection = directionHint >= 0 ? 1 : -1;
        energy = Math.min(1, energy + 0.08);
    }

    if (moved || directionHint !== 0) notify();
    return next;
}

// Some plan facts are written by the caller AFTER the api call that changed them returns
// (tasks, most notably: api.updateTask resolves and then the caller writes state.tasks). A
// short coalescing delay lets those writes land before the background re-derives, and folds a
// burst of updates into one movement. Re-derivation is idempotent, so a redundant tick is
// free and a mis-ordered one only costs a beat of lag, never a wrong value.
let scheduledRefresh = null;
const SCHEDULED_REFRESH_MS = 50;

export function scheduleAtmosphereRefresh(reason = 'plan-change') {
    if (scheduledRefresh !== null) return;
    scheduledRefresh = setTimeout(() => {
        scheduledRefresh = null;
        refreshFromPlan(reason);
    }, SCHEDULED_REFRESH_MS);
}

/** A brief swirl with no journey movement — for user actions that are not plan mutations. */
export function pulse(direction = spinDirection, amount = 0.35) {
    spinDirection = direction >= 0 ? 1 : -1;
    energy = Math.min(1, energy + amount);
    notify();
}

/** Forget animated state so the next derivation snaps instead of sweeping (session switch). */
export function resetAtmosphere() {
    targetProgress = null;
    targetCrystal = 0;
    displayedCrystal = 0;
    energy = 0;
    spin = 0;
    shimmerPhase = 0;
    lastTickTimestamp = -1;
}

/**
 * How strongly the plan should shimmer right now (0..1), ramping in from the point where
 * crystallization becomes visible. Zero when the user asked the OS to minimize motion.
 */
function shimmerIntensity() {
    if (prefersReducedMotion) return 0;
    if (displayedCrystal <= SHIMMER_MIN_CRYSTAL) return 0;
    return clamp01((displayedCrystal - SHIMMER_MIN_CRYSTAL) / (1 - SHIMMER_MIN_CRYSTAL));
}

/**
 * True when a renderer should keep drawing (slowly) even though the journey has settled.
 * Deliberately separate from isAtmosphereSettled(): the journey being still and the gem
 * catching light are different questions, and only the former decides whether the plan is
 * mid-movement.
 */
export function isShimmering() {
    return shimmerIntensity() > 0;
}

/** The current frame, without advancing anything. */
export function getAtmosphereFrame() {
    return {
        progress: displayedProgress,
        crystal: displayedCrystal,
        energy,
        spin,
        seed: getSeed(),
        shimmer: shimmerIntensity(),
        shimmerPhase,
    };
}

/**
 * Advance the shared state and return the frame to draw.
 *
 * Both engines can be live at once (entering the presentation view does not tear the catalog
 * background down), so only the first renderer to reach a given animation frame advances the
 * state — the second gets the same frame rather than double-stepping it.
 *
 * @param {number} timestamp - the requestAnimationFrame timestamp
 */
export function tickAtmosphere(timestamp) {
    if (targetProgress === null) refreshFromPlan('first-frame');

    if (timestamp <= lastTickTimestamp) return getAtmosphereFrame();

    // The clamp keeps the swirl integration sane after a stall. It is above the shimmer
    // throttle interval so a shimmer-only frame still advances by its true elapsed time.
    const dt = lastTickTimestamp < 0
        ? 0.016
        : Math.min(0.1, (timestamp - lastTickTimestamp) / 1000);
    lastTickTimestamp = timestamp;

    energy *= Math.exp(-energyDecayK * dt);
    if (energy < 0.01) energy = 0;

    // The swirl advances only while there is leftover energy from a real plan movement, in
    // that movement's direction. Idle => spin holds => the background is completely still.
    if (!prefersReducedMotion && energy > 0) {
        spin += spinDirection * energy * SPIN_RATE * dt;
    }

    const goalProgress = manualProgress !== null ? manualProgress : targetProgress;
    const k = 1 - Math.exp(-dt / EASE_TAU);

    displayedProgress += (goalProgress - displayedProgress) * k;
    displayedCrystal += (targetCrystal - displayedCrystal) * k;

    if (Math.abs(goalProgress - displayedProgress) < SETTLE_EPS) displayedProgress = goalProgress;
    if (Math.abs(targetCrystal - displayedCrystal) < SETTLE_EPS) displayedCrystal = targetCrystal;

    // Advance the shimmer sweep. It eases in with intensity so crystallization arrives as a
    // gathering glint rather than a highlight that switches on.
    const shimmer = shimmerIntensity();
    if (shimmer > 0) {
        shimmerPhase = (shimmerPhase + dt * SHIMMER_CYCLE_SPEED * (0.4 + 0.6 * shimmer)) % 1;
    }

    // Mirror into the legacy field that other modules still read.
    if (state.ui) state.ui.currentProgress = displayedProgress;

    return getAtmosphereFrame();
}

/** True when nothing is in flight, so a renderer can park its animation loop. */
export function isAtmosphereSettled() {
    const goalProgress = manualProgress !== null
        ? manualProgress
        : (targetProgress === null ? displayedProgress : targetProgress);

    return energy === 0
        && Math.abs(goalProgress - displayedProgress) < SETTLE_EPS
        && Math.abs(targetCrystal - displayedCrystal) < SETTLE_EPS;
}

// --- Debug-panel hooks --------------------------------------------------------------------

/** Pin progress to a value, suspending derivation. Pass null to hand control back. */
export function setManualProgress(value) {
    manualProgress = value === null ? null : clamp01(value);
    notify();
}

export function setEnergy(value) {
    energy = clamp01(value);
    notify();
}

/** Accepts the debug panel's per-frame decay rate and converts it to a per-second constant. */
export function setEnergyDecayPerFrame(rate) {
    const safe = Math.min(0.9999, Math.max(0.0001, rate));
    energyDecayK = -Math.log(safe) * 60;
    notify();
}

export function getAtmosphereDebugInfo() {
    return {
        targetProgress,
        displayedProgress,
        targetCrystal,
        displayedCrystal,
        energy,
        spin,
        spinDirection,
        seed: getSeed(),
        shimmer: shimmerIntensity(),
        shimmerPhase,
        manualProgress,
        settled: isAtmosphereSettled(),
        shimmering: isShimmering(),
        plan: computeAtmosphere(),
    };
}

// --- Session lifecycle --------------------------------------------------------------------

// Opening a different plan should show that plan's background immediately, not animate a
// sweep from the previous plan's position. resetAtmosphere() clears the animated state so the
// next derivation snaps into place.
if (typeof document !== 'undefined') {
    document.addEventListener('sessionReady', () => {
        resetAtmosphere();
        const derived = refreshFromPlan('session-loaded');
        log('Atmosphere', `Session background: progress ${derived.progress.toFixed(3)}, crystal ${derived.crystal.toFixed(3)}, seed ${getSeed().toFixed(3)}`);
    });
}
