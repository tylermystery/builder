// utils/promotions-client.js
//
// Browser-side companion to the promotions engine. It is DISPLAY + QUOTE only:
// it draws badges, struck-through prices and "N left" indicators, and it asks
// the server for an authoritative checkout quote. It never decides what a
// customer is charged — create-payment-intent does that from the signed token
// the quote endpoint returns. The small amount of matching logic duplicated
// here is intentional and only affects what the shopper *sees*.

// storeId -> { loadedAt, promos: [...] }   and an in-flight promise cache so
// concurrent card renders trigger a single network fetch.
const _cache = new Map();
const _inflight = new Map();

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const DAY_MS = 24 * 60 * 60 * 1000;

// Fetch (once) and cache the active, in-stock promotions for a store. Safe to
// call repeatedly; failures cache an empty list so a promo outage never blocks
// or slows browsing.
export async function ensureStorePromotionsLoaded(storeId) {
    if (!storeId) return [];
    if (_cache.has(storeId)) return _cache.get(storeId).promos;
    if (_inflight.has(storeId)) return _inflight.get(storeId);

    const p = (async () => {
        try {
            // Bound the request so a slow/hung promotions endpoint can never
            // stall catalog rendering — degrade to "no deals" instead.
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 4000);
            let promos = [];
            try {
                const res = await fetch(`/api/promotions?storeId=${encodeURIComponent(storeId)}`, { signal: ctrl.signal });
                const data = res.ok ? await res.json() : { promotions: [] };
                promos = Array.isArray(data.promotions) ? data.promotions : [];
            } finally {
                clearTimeout(timer);
            }
            _cache.set(storeId, { loadedAt: Date.now(), promos });
            return promos;
        } catch (e) {
            _cache.set(storeId, { loadedAt: Date.now(), promos: [] });
            return [];
        } finally {
            _inflight.delete(storeId);
        }
    })();
    _inflight.set(storeId, p);
    return p;
}

// Drop a store's cached promotions so the next render refetches (e.g. after a
// publisher edits a deal, or a redemption changes the remaining count).
export function invalidateStorePromotions(storeId) {
    if (storeId) { _cache.delete(storeId); _inflight.delete(storeId); }
    else { _cache.clear(); _inflight.clear(); }
}

export function getCachedStorePromotions(storeId) {
    const entry = storeId && _cache.get(storeId);
    return entry ? entry.promos : [];
}

function dateEligibleNow(promo, eventDate, now) {
    if (promo.eligibilityMode === 'rolling') {
        if (!promo.windowDays || !eventDate) return false;
        const t = new Date(eventDate).getTime();
        if (Number.isNaN(t)) return false;
        const daysOut = (t - now) / DAY_MS;
        return daysOut >= -0.5 && daysOut <= promo.windowDays;
    }
    if (promo.startsAt && now < new Date(promo.startsAt).getTime()) return false;
    if (promo.endsAt && now > new Date(promo.endsAt).getTime()) return false;
    return true;
}

function scopeMatch(promo, item) {
    if (promo.scopeType === 'item') return !!item.itemId && item.itemId === promo.target;
    if (promo.scopeType === 'store') {
        return Array.isArray(item.storeIds) && item.storeIds.includes(promo.storeId);
    }
    if (promo.scopeType === 'category') {
        if (!Array.isArray(item.storeIds) || !item.storeIds.includes(promo.storeId)) return false;
        return (item.categories || []).map(norm).includes(norm(promo.target));
    }
    return false;
}

function discountCents(promo, baseCents) {
    if (!(baseCents > 0)) return 0;
    if (promo.rewardType === 'amount') return Math.min(promo.rewardValue, baseCents);
    const pct = Math.max(0, Math.min(100, promo.rewardValue));
    return Math.min(baseCents, Math.round((baseCents * pct) / 100));
}

export function rewardLabel(promo) {
    if (!promo) return '';
    return promo.rewardType === 'amount'
        ? `$${(promo.rewardValue / 100).toFixed(0)} OFF`
        : `${promo.rewardValue}% OFF`;
}

// Plain-language "ends in 3 days" / "3 left" hints for the badge tooltip / sub-line.
export function promoTimingHint(promo, now = Date.now()) {
    if (promo.eligibilityMode === 'rolling' && promo.windowDays) {
        return `Last-minute · event within ${promo.windowDays} days`;
    }
    if (promo.endsAt) {
        const days = Math.ceil((new Date(promo.endsAt).getTime() - now) / DAY_MS);
        if (days <= 0) return 'Ends today';
        if (days === 1) return 'Ends tomorrow';
        return `Ends in ${days} days`;
    }
    return '';
}

/**
 * Best promotion to advertise for a single catalog item.
 * @param {Object} item { itemId, storeIds:[], categories:[], basePriceCents, eventDate? }
 * @returns {null | { promo, eligible, discountCents, discountedCents, remaining }}
 *   `eligible` is true when the deal's date gate is open right now (so a
 *   struck-through price is appropriate); otherwise the deal is shown as a
 *   forward-looking badge only (e.g. a last-minute deal on a card with no date).
 */
export function bestDisplayPromoForItem(item) {
    // Gather promos from every store the item belongs to.
    const candidates = [];
    const seenStores = new Set();
    for (const sid of item.storeIds || []) {
        if (seenStores.has(sid)) continue;
        seenStores.add(sid);
        for (const promo of getCachedStorePromotions(sid)) {
            if (scopeMatch(promo, item)) candidates.push(promo);
        }
    }
    if (candidates.length === 0) return null;

    const now = Date.now();
    const base = Math.round(item.basePriceCents || 0);
    let best = null;
    for (const promo of candidates) {
        if (promo.remaining !== null && promo.remaining !== undefined && promo.remaining <= 0) continue;
        const eligible = dateEligibleNow(promo, item.eventDate, now);
        // For fixed-end deals, only advertise when the date gate is actually
        // open (no struck price or badge for an expired or not-yet-started
        // deadline). Rolling deals may be advertised even without a date in
        // hand, since their eligibility depends on the specific event date.
        if (!eligible && promo.eligibilityMode !== 'rolling') continue;
        const d = discountCents(promo, base);
        // Prefer eligible deals with a real discount; fall back to advertising an
        // not-yet-eligible rolling deal (last-minute) when nothing is live yet.
        const score = (eligible ? 1e9 : 0) + d;
        if (!best || score > best.score) {
            best = { promo, eligible, discountCents: d, discountedCents: Math.max(0, base - d), remaining: promo.remaining ?? null, score };
        }
    }
    if (!best) return null;
    delete best.score;
    return best;
}

/**
 * Ask the server for an authoritative checkout quote.
 * @returns {Promise<{discountCents:number, promotionId?, promotionName?, token?, perLine?, remaining?}>}
 */
export async function quoteCart(storeId, cart, sessionId) {
    try {
        const res = await fetch('/api/promotions/quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storeId, cart, sessionId: sessionId || null }),
        });
        if (!res.ok) return { discountCents: 0 };
        return await res.json();
    } catch (e) {
        return { discountCents: 0 };
    }
}
