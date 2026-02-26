/**
 * Airtable Offline Cache & Write Queue
 *
 * Provides localStorage-based caching for Airtable catalog data (items + stores)
 * and session data, plus a write queue for pending saves when Airtable is unreachable.
 *
 * Cache keys:
 *   wtfun_cache_items      - Cached catalog items (records)
 *   wtfun_cache_stores     - Cached store records
 *   wtfun_cache_session_{id} - Cached session data (raw Airtable record)
 *   wtfun_cache_meta       - Cache metadata (timestamps, versions)
 *   wtfun_write_queue      - Pending write operations
 *   wtfun_airtable_status  - Last known Airtable health status
 */

const CACHE_KEYS = {
    ITEMS: 'wtfun_cache_items',
    STORES: 'wtfun_cache_stores',
    SESSION_PREFIX: 'wtfun_cache_session_',
    META: 'wtfun_cache_meta',
    WRITE_QUEUE: 'wtfun_write_queue',
    STATUS: 'wtfun_airtable_status'
};

// Cache TTL: 24 hours (data is still usable beyond this, but flagged as stale)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Max sessions to cache (to prevent localStorage bloat)
const MAX_CACHED_SESSIONS = 5;
// Health check interval: 30 seconds when offline
const HEALTH_CHECK_INTERVAL_MS = 30000;

let _healthCheckTimer = null;
let _isAirtableReachable = true;
let _onStatusChangeCallbacks = [];

/**
 * Register a callback for Airtable status changes (online/offline).
 * @param {function(boolean)} callback - Called with true (online) or false (offline)
 */
export function onAirtableStatusChange(callback) {
    if (typeof callback === 'function') {
        _onStatusChangeCallbacks.push(callback);
    }
}

/**
 * Get current Airtable reachability status.
 * @returns {boolean}
 */
export function isAirtableOnline() {
    return _isAirtableReachable;
}

/**
 * Update Airtable status and notify listeners.
 * @param {boolean} isOnline
 */
export function setAirtableStatus(isOnline) {
    const wasOnline = _isAirtableReachable;
    _isAirtableReachable = isOnline;

    try {
        localStorage.setItem(CACHE_KEYS.STATUS, JSON.stringify({
            online: isOnline,
            timestamp: Date.now()
        }));
    } catch (e) { /* localStorage may be full */ }

    if (wasOnline !== isOnline) {
        console.log(`[AirtableCache] Status changed: ${isOnline ? '✅ ONLINE' : '⚠️ OFFLINE'}`);
        for (const cb of _onStatusChangeCallbacks) {
            try { cb(isOnline); } catch (e) { console.error('[AirtableCache] Status callback error:', e); }
        }

        // When coming back online, flush the write queue
        if (isOnline) {
            flushWriteQueue();
        }
    }
}

// ─── CATALOG CACHING (Items & Stores) ───────────────────────────────

/**
 * Cache catalog items to localStorage.
 * @param {Array} records - Airtable item records [{id, fields, createdTime}, ...]
 */
export function cacheItems(records) {
    try {
        const data = JSON.stringify(records);
        localStorage.setItem(CACHE_KEYS.ITEMS, data);
        _updateMeta('items', records.length);
        console.log(`[AirtableCache] Cached ${records.length} items (${(data.length / 1024).toFixed(1)}KB)`);
    } catch (e) {
        console.warn('[AirtableCache] Failed to cache items (storage may be full):', e.message);
        // Try to free space by clearing old session caches
        _evictOldSessionCaches();
        try {
            localStorage.setItem(CACHE_KEYS.ITEMS, JSON.stringify(records));
        } catch (e2) {
            console.error('[AirtableCache] Still cannot cache items after eviction:', e2.message);
        }
    }
}

/**
 * Retrieve cached catalog items.
 * @returns {{ records: Array, timestamp: number, isStale: boolean } | null}
 */
export function getCachedItems() {
    try {
        const raw = localStorage.getItem(CACHE_KEYS.ITEMS);
        if (!raw) return null;
        const records = JSON.parse(raw);
        const meta = _getMeta();
        const timestamp = meta?.items?.timestamp || 0;
        const isStale = (Date.now() - timestamp) > CACHE_TTL_MS;
        return { records, timestamp, isStale };
    } catch (e) {
        console.warn('[AirtableCache] Failed to read cached items:', e.message);
        return null;
    }
}

/**
 * Cache store records to localStorage.
 * @param {Array} stores - Airtable store records
 */
export function cacheStores(stores) {
    try {
        const data = JSON.stringify(stores);
        localStorage.setItem(CACHE_KEYS.STORES, data);
        _updateMeta('stores', stores.length);
        console.log(`[AirtableCache] Cached ${stores.length} stores (${(data.length / 1024).toFixed(1)}KB)`);
    } catch (e) {
        console.warn('[AirtableCache] Failed to cache stores:', e.message);
    }
}

/**
 * Retrieve cached store records.
 * @returns {{ records: Array, timestamp: number, isStale: boolean } | null}
 */
export function getCachedStores() {
    try {
        const raw = localStorage.getItem(CACHE_KEYS.STORES);
        if (!raw) return null;
        const records = JSON.parse(raw);
        const meta = _getMeta();
        const timestamp = meta?.stores?.timestamp || 0;
        const isStale = (Date.now() - timestamp) > CACHE_TTL_MS;
        return { records, timestamp, isStale };
    } catch (e) {
        console.warn('[AirtableCache] Failed to read cached stores:', e.message);
        return null;
    }
}

// ─── SESSION CACHING ────────────────────────────────────────────────

/**
 * Cache a session's raw Airtable record for offline access.
 * @param {string} sessionId - The session ID
 * @param {Object} record - The raw Airtable record { id, fields, createdTime }
 */
export function cacheSession(sessionId, record) {
    if (!sessionId || !record) return;
    try {
        const key = CACHE_KEYS.SESSION_PREFIX + sessionId;
        localStorage.setItem(key, JSON.stringify(record));
        _updateMeta(`session_${sessionId}`, 1);
        console.log(`[AirtableCache] Cached session ${sessionId}`);
        _evictOldSessionCaches();
    } catch (e) {
        console.warn('[AirtableCache] Failed to cache session:', e.message);
    }
}

/**
 * Retrieve a cached session record.
 * @param {string} sessionId
 * @returns {{ record: Object, timestamp: number, isStale: boolean } | null}
 */
export function getCachedSession(sessionId) {
    if (!sessionId) return null;
    try {
        const key = CACHE_KEYS.SESSION_PREFIX + sessionId;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const record = JSON.parse(raw);
        const meta = _getMeta();
        const timestamp = meta?.[`session_${sessionId}`]?.timestamp || 0;
        const isStale = (Date.now() - timestamp) > CACHE_TTL_MS;
        return { record, timestamp, isStale };
    } catch (e) {
        console.warn('[AirtableCache] Failed to read cached session:', e.message);
        return null;
    }
}

// ─── WRITE QUEUE ────────────────────────────────────────────────────

/**
 * Add a write operation to the offline queue.
 * @param {Object} operation - { type: 'session_save' | 'session_create' | ..., url, method, headers, body, timestamp }
 */
export function enqueueWrite(operation) {
    try {
        const queue = _getWriteQueue();
        queue.push({
            ...operation,
            id: `wq_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            timestamp: Date.now(),
            retries: 0
        });
        localStorage.setItem(CACHE_KEYS.WRITE_QUEUE, JSON.stringify(queue));
        console.log(`[AirtableCache] Enqueued write operation: ${operation.type} (queue size: ${queue.length})`);
    } catch (e) {
        console.error('[AirtableCache] Failed to enqueue write:', e.message);
    }
}

/**
 * Get the current write queue.
 * @returns {Array}
 */
function _getWriteQueue() {
    try {
        const raw = localStorage.getItem(CACHE_KEYS.WRITE_QUEUE);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

/**
 * Get count of pending write operations.
 * @returns {number}
 */
export function getPendingWriteCount() {
    return _getWriteQueue().length;
}

/**
 * Flush pending write operations to Airtable.
 * Called automatically when Airtable comes back online.
 */
export async function flushWriteQueue() {
    const queue = _getWriteQueue();
    if (queue.length === 0) return;

    console.log(`[AirtableCache] Flushing ${queue.length} queued write operations...`);
    const remaining = [];

    for (const op of queue) {
        try {
            const response = await fetch(op.url, {
                method: op.method,
                headers: op.headers,
                body: op.body
            });

            if (response.ok) {
                console.log(`[AirtableCache] ✅ Flushed queued ${op.type} (queued ${_timeSince(op.timestamp)} ago)`);
            } else if (response.status >= 500) {
                // Server error — keep in queue for later
                op.retries = (op.retries || 0) + 1;
                if (op.retries < 5) {
                    remaining.push(op);
                    console.warn(`[AirtableCache] ⚠️ Server error flushing ${op.type}, will retry (attempt ${op.retries})`);
                } else {
                    console.error(`[AirtableCache] ❌ Dropped ${op.type} after ${op.retries} retries`);
                }
            } else {
                // Client error (4xx) — drop it, re-queuing won't help
                console.error(`[AirtableCache] ❌ Dropped ${op.type}: ${response.status}`);
            }
        } catch (e) {
            // Network error — Airtable still unreachable, stop flushing
            remaining.push(op);
            console.warn(`[AirtableCache] Network error flushing queue, stopping. Remaining: ${queue.length - queue.indexOf(op)}`);
            // Push remaining items back
            for (let i = queue.indexOf(op) + 1; i < queue.length; i++) {
                remaining.push(queue[i]);
            }
            break;
        }
    }

    localStorage.setItem(CACHE_KEYS.WRITE_QUEUE, JSON.stringify(remaining));
    if (remaining.length === 0) {
        console.log('[AirtableCache] ✅ Write queue fully flushed');
    } else {
        console.log(`[AirtableCache] ${remaining.length} operations still pending`);
    }
}

// ─── HEALTH CHECK ───────────────────────────────────────────────────

/**
 * Perform a lightweight Airtable health check.
 * Uses a HEAD request to the Stores table (minimal data transfer).
 * @param {string} pat - Airtable personal access token
 * @param {string} baseId - Airtable base ID
 * @returns {Promise<boolean>}
 */
export async function checkAirtableHealth(pat, baseId) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(
            `https://api.airtable.com/v0/${baseId}/Stores?maxRecords=1&fields%5B%5D=Name`,
            {
                headers: { 'Authorization': `Bearer ${pat}` },
                signal: controller.signal
            }
        );
        clearTimeout(timeoutId);
        const isOk = response.ok;
        setAirtableStatus(isOk);
        return isOk;
    } catch (e) {
        setAirtableStatus(false);
        return false;
    }
}

/**
 * Start periodic health checks when offline.
 * @param {string} pat - Airtable PAT
 * @param {string} baseId - Airtable base ID
 */
export function startHealthChecks(pat, baseId) {
    if (_healthCheckTimer) return; // already running
    console.log('[AirtableCache] Starting periodic Airtable health checks...');
    _healthCheckTimer = setInterval(async () => {
        if (!_isAirtableReachable) {
            const isBack = await checkAirtableHealth(pat, baseId);
            if (isBack) {
                console.log('[AirtableCache] ✅ Airtable is back online!');
                stopHealthChecks();
            }
        }
    }, HEALTH_CHECK_INTERVAL_MS);
}

/**
 * Stop periodic health checks.
 */
export function stopHealthChecks() {
    if (_healthCheckTimer) {
        clearInterval(_healthCheckTimer);
        _healthCheckTimer = null;
        console.log('[AirtableCache] Stopped health checks');
    }
}

// ─── CACHE INFO ─────────────────────────────────────────────────────

/**
 * Get a human-readable summary of what's cached.
 * @returns {Object}
 */
export function getCacheInfo() {
    const meta = _getMeta();
    const queue = _getWriteQueue();
    return {
        items: meta?.items ? {
            count: meta.items.count,
            cachedAt: new Date(meta.items.timestamp).toLocaleString(),
            age: _timeSince(meta.items.timestamp)
        } : null,
        stores: meta?.stores ? {
            count: meta.stores.count,
            cachedAt: new Date(meta.stores.timestamp).toLocaleString(),
            age: _timeSince(meta.stores.timestamp)
        } : null,
        pendingWrites: queue.length,
        isAirtableOnline: _isAirtableReachable
    };
}

/**
 * Clear all cache data.
 */
export function clearCache() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('wtfun_cache_'));
    keys.forEach(k => localStorage.removeItem(k));
    localStorage.removeItem(CACHE_KEYS.WRITE_QUEUE);
    localStorage.removeItem(CACHE_KEYS.STATUS);
    console.log(`[AirtableCache] Cleared ${keys.length} cache entries`);
}

// ─── INTERNAL HELPERS ───────────────────────────────────────────────

function _getMeta() {
    try {
        const raw = localStorage.getItem(CACHE_KEYS.META);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function _updateMeta(key, count) {
    try {
        const meta = _getMeta();
        meta[key] = { count, timestamp: Date.now() };
        localStorage.setItem(CACHE_KEYS.META, JSON.stringify(meta));
    } catch (e) { /* ignore */ }
}

function _evictOldSessionCaches() {
    try {
        const meta = _getMeta();
        const sessionKeys = Object.keys(meta)
            .filter(k => k.startsWith('session_'))
            .sort((a, b) => (meta[a]?.timestamp || 0) - (meta[b]?.timestamp || 0));

        while (sessionKeys.length > MAX_CACHED_SESSIONS) {
            const oldest = sessionKeys.shift();
            const sessionId = oldest.replace('session_', '');
            localStorage.removeItem(CACHE_KEYS.SESSION_PREFIX + sessionId);
            delete meta[oldest];
            console.log(`[AirtableCache] Evicted old session cache: ${sessionId}`);
        }
        localStorage.setItem(CACHE_KEYS.META, JSON.stringify(meta));
    } catch (e) { /* ignore */ }
}

function _timeSince(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}
