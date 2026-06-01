import { CONSTANTS } from './config.js';
import { log } from './utils/debug.js';
import * as api from './api.js';
import { state } from './state.js';

export const AVAILABILITY_STATUS = {
    FULL: 'full',
    PARTIAL: 'partial',
    NONE: 'none',
};

export function parseICalDate(dateString) {
    if (!dateString) return null;
    const year = parseInt(dateString.substring(0, 4), 10);
    const month = parseInt(dateString.substring(4, 6), 10) - 1;
    const day = parseInt(dateString.substring(6, 8), 10);
    const hour = parseInt(dateString.substring(9, 11), 10);
    const minute = parseInt(dateString.substring(11, 13), 10);
    const second = parseInt(dateString.substring(13, 15), 10);
    return new Date(Date.UTC(year, month, day, hour, minute, second));
}

function toBusyDate(val) {
    if (!val) return new Date(NaN);
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
    return parseICalDate(val) || new Date(NaN);
}

export function logBusyTimeSummary(label, busyTimes) {
    if (!busyTimes || busyTimes.length === 0) {
        console.log(`[ICAL] ${label}: no busy times`);
        return;
    }
    const dates = busyTimes.map(b => {
        const s = new Date(b.start);
        const e = new Date(b.end);
        return `${s.toLocaleDateString()} ${s.toLocaleTimeString()} - ${e.toLocaleTimeString()}`;
    });
    console.log(`[ICAL] ${label}: ${busyTimes.length} busy times:`);
    dates.forEach((d, i) => console.log(`[ICAL]   [${i}] ${d} (raw: ${busyTimes[i].start} -> ${busyTimes[i].end})`));
}

export function getDayStatus(day, busyTimes, record) {
    const leadTime = parseInt(record.fields[CONSTANTS.FIELD_NAMES.LEAD_TIME] || 0, 10);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const leadTimeDate = new Date(today.getTime() + leadTime * 24 * 60 * 60 * 1000);
    if (day < leadTimeDate) {
        return { status: AVAILABILITY_STATUS.NONE, reason: `Unavailable due to ${leadTime} day lead time.` };
    }

    if (!busyTimes || busyTimes.length === 0) {
        return { status: AVAILABILITY_STATUS.FULL, reason: 'Fully Available' };
    }

    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    const busyPeriods = busyTimes.filter(busy => {
        const busyStart = toBusyDate(busy.start);
        const busyEnd = toBusyDate(busy.end);
        return busyStart <= dayEnd && busyEnd >= dayStart;
    });

    if (busyPeriods.length === 0) {
        return { status: AVAILABILITY_STATUS.FULL, reason: 'Fully Available' };
    }

    const totalMinutes = 24 * 60;
    let busyMinutes = 0;
    busyPeriods.forEach(busy => {
        const start = new Date(Math.max(toBusyDate(busy.start), dayStart));
        const end = new Date(Math.min(toBusyDate(busy.end), dayEnd));
        const minutes = (end - start) / (1000 * 60);
        busyMinutes += minutes;
    });

    const availablePercentage = ((totalMinutes - busyMinutes) / totalMinutes) * 100;
    if (availablePercentage > 50) {
        return { status: AVAILABILITY_STATUS.PARTIAL, reason: 'Partially Available (some times are booked).' };
    } else {
        return { status: AVAILABILITY_STATUS.NONE, reason: 'No availability today (all time slots are booked).' };
    }
}

export function getRangeStatus(start, end, record, busyTimes) {
    const leadTime = parseInt(record.fields[CONSTANTS.FIELD_NAMES.LEAD_TIME] || 0, 10);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const leadTimeCutoffDate = new Date(today.getTime() + leadTime * 24 * 60 * 60 * 1000);

    if (end < leadTimeCutoffDate) {
        return { status: AVAILABILITY_STATUS.NONE, reason: `Unavailable due to ${leadTime} day lead time.` };
    }

    if (start < leadTimeCutoffDate) {
        const availableDate = leadTimeCutoffDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return { status: AVAILABILITY_STATUS.PARTIAL, reason: `Partially available due to lead time. Becomes available on ${availableDate}.` };
    }

    if (checkAvailability(start, end, busyTimes) === false) {
        return { status: AVAILABILITY_STATUS.PARTIAL, reason: 'Partially available. Some days or times within this period are booked.' };
    }

    return { status: AVAILABILITY_STATUS.FULL, reason: 'Fully available during this period.' };
}

export function checkAvailability(start, end, busyTimes) {
    // Add a check to ensure busyTimes is an array before iterating
    if (!Array.isArray(busyTimes)) return true;

    for (const event of busyTimes) {
        const eventStart = toBusyDate(event.start);
        const eventEnd = toBusyDate(event.end);
        if (start < eventEnd && end > eventStart) {
            return false;
        }
    }
    return true;
}

export function getAvailableSlotsForDay(day, busyTimes) {
    if (!busyTimes || busyTimes.length === 0) {
        return '8:00 AM - 5:00 PM';
        // Default availability if no data
    }

    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    // Only consider busy events that actually overlap the requested day. Events
    // on other days would otherwise produce bogus "gap" windows that span across
    // days and render as nonsensical time ranges (e.g. "10:30 PM - 11:30 AM").
    const dayBusy = busyTimes
        .map(busy => ({ start: toBusyDate(busy.start), end: toBusyDate(busy.end) }))
        .filter(busy => !isNaN(busy.start.getTime()) && !isNaN(busy.end.getTime())
            && busy.start <= dayEnd && busy.end >= dayStart)
        .sort((a, b) => a.start - b.start);

    const availableSlots = [];
    let lastEnd = dayStart;

    dayBusy.forEach(busy => {
        const start = new Date(Math.max(busy.start.getTime(), dayStart.getTime()));
        const end = new Date(Math.min(busy.end.getTime(), dayEnd.getTime()));

        if (start > lastEnd) {
            availableSlots.push({
                start: lastEnd,
                end: start
            });
        }
        lastEnd = end > lastEnd ? end : lastEnd;
    });
    if (lastEnd < dayEnd) {
        availableSlots.push({
            start: lastEnd,
            end: dayEnd
        });
    }

    return availableSlots
        // Drop sub-minute slivers so the window list stays meaningful.
        .filter(slot => slot.end - slot.start >= 60 * 1000)
        .map(slot => {
            const startTime = new Date(slot.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endTime = new Date(slot.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `${startTime} - ${endTime}`;
        }).join('\n') ||
        'No available slots';
}

/** Parse a clock string like "7:00 PM" or "14:30" into { hours, minutes }. */
function parseClockTime(timeStr) {
    if (!timeStr) return null;
    const m = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!m) return null;
    let hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    const mer = m[3] ? m[3].toUpperCase() : null;
    if (mer === 'PM' && hours !== 12) hours += 12;
    else if (mer === 'AM' && hours === 12) hours = 0;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes };
}

/** Apply a clock-time string to a given day, in local time. */
function combineLocalDateTime(day, timeStr) {
    const parsed = parseClockTime(timeStr);
    if (!parsed) return null;
    const d = new Date(day);
    d.setHours(parsed.hours, parsed.minutes, 0, 0);
    return d;
}

/**
 * Build a persistent, human-readable availability description for a single
 * item's selected date (and optional time window). Used by both the plan
 * panel and the detail modal so the two stay consistent.
 *
 * Behavior follows the user's selection granularity:
 *  - date only: report the day status and, when partially open, the free
 *    time windows for that day.
 *  - date + start/end time: evaluate that exact slot against the calendar
 *    and report whether the chosen time is free or conflicts with a booking.
 *
 * @param {Object} record - The Airtable record (for lead time + iCal).
 * @param {Array} busyTimes - Busy times for the record's calendar.
 * @param {Object} selection - { date: Date|string, startTime?: string, endTime?: string }
 * @returns {{ status: string, label: string, slots?: string } | null}
 *          null when no usable date is provided.
 */
export function describeSelectedAvailability(record, busyTimes, selection = {}) {
    const { date, startTime, endTime } = selection;
    if (!date) return null;
    const day = new Date(date);
    if (isNaN(day.getTime())) return null;

    const dayStatus = getDayStatus(day, busyTimes, record);

    // Lead time blocks the whole day regardless of the chosen time.
    if (dayStatus.status === AVAILABILITY_STATUS.NONE && /lead time/i.test(dayStatus.reason || '')) {
        return { status: AVAILABILITY_STATUS.NONE, label: dayStatus.reason };
    }

    // A specific time was selected: evaluate that exact slot.
    if (startTime) {
        const startDate = combineLocalDateTime(day, startTime);
        if (startDate) {
            let endDate = endTime ? combineLocalDateTime(day, endTime) : null;
            // End time before/equal start means it rolls into the next day.
            if (endDate && endDate <= startDate) endDate.setDate(endDate.getDate() + 1);
            // Assume a 1-hour window if only a start time is known.
            const slotEnd = endDate || new Date(startDate.getTime() + 60 * 60 * 1000);
            const timeLabel = endTime ? `${startTime} – ${endTime}` : startTime;
            if (checkAvailability(startDate, slotEnd, busyTimes)) {
                return { status: AVAILABILITY_STATUS.FULL, label: `Available at ${timeLabel}` };
            }
            return { status: AVAILABILITY_STATUS.NONE, label: `Booked during ${timeLabel} — try another time` };
        }
    }

    // Date only: describe the day and surface open windows when partial.
    if (dayStatus.status === AVAILABILITY_STATUS.NONE) {
        return { status: AVAILABILITY_STATUS.NONE, label: 'Fully booked this day' };
    }
    if (dayStatus.status === AVAILABILITY_STATUS.FULL) {
        return { status: AVAILABILITY_STATUS.FULL, label: 'Available all day' };
    }
    // Partial: list the free windows (copy the array so the cache isn't mutated).
    const slots = getAvailableSlotsForDay(day, Array.isArray(busyTimes) ? busyTimes.slice() : busyTimes);
    return { status: AVAILABILITY_STATUS.PARTIAL, label: 'Open', slots };
}

/**
 * Check combined availability for all locked items in a plan.
 * Supports per-item date overrides: if an item has an itemDate, only that date is checked.
 * For items without an itemDate in a multi-day plan, all dates in the range are checked.
 * @param {Date} date - The plan start date
 * @param {Array} lockedItems - Array of record objects
 * @param {Object} [options] - Optional: { dateEnd: Date, lockedItemsMap: Map }
 * @returns {Promise<string>} Availability status
 */
export async function getCombinedPlanStatus(date, lockedItems, options = {}) {
    const { dateEnd, lockedItemsMap } = options;
    let overallStatus = AVAILABILITY_STATUS.FULL;

    for (const record of lockedItems) {
        if (record && record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL]) {
            const busyTimes = await api.fetchCalendarForRecord(record);

            const itemInfo = lockedItemsMap?.get(record.id);
            const itemDate = itemInfo?.itemDate;

            if (itemDate) {
                const assignedDate = new Date(itemDate);
                const status = getDayStatus(assignedDate, busyTimes, record).status;
                if (status === AVAILABILITY_STATUS.NONE) return AVAILABILITY_STATUS.NONE;
                if (status === AVAILABILITY_STATUS.PARTIAL) overallStatus = AVAILABILITY_STATUS.PARTIAL;
            } else if (dateEnd) {
                const start = new Date(date);
                const end = new Date(dateEnd);
                let anyAvailable = false;
                let allAvailable = true;
                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                    const dayStatus = getDayStatus(new Date(d), busyTimes, record).status;
                    if (dayStatus !== AVAILABILITY_STATUS.NONE) anyAvailable = true;
                    if (dayStatus !== AVAILABILITY_STATUS.FULL) allAvailable = false;
                }
                if (!anyAvailable) return AVAILABILITY_STATUS.NONE;
                if (!allAvailable) overallStatus = AVAILABILITY_STATUS.PARTIAL;
            } else {
                const status = getDayStatus(date, busyTimes, record).status;
                if (status === AVAILABILITY_STATUS.NONE) return AVAILABILITY_STATUS.NONE;
                if (status === AVAILABILITY_STATUS.PARTIAL) overallStatus = AVAILABILITY_STATUS.PARTIAL;
            }
        }
    }

    return overallStatus;
}

export function getPlanDayStatusSync(day, lockedRecords) {
    let overallStatus = AVAILABILITY_STATUS.FULL;
    for (const record of lockedRecords) {
        const icalUrl = record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL];
        if (!icalUrl) continue;
        const busyTimes = state.calendar.busyTimes.get(icalUrl);
        if (!busyTimes || busyTimes.length === 0) continue;
        const dayStatus = getDayStatus(day, busyTimes, record);
        if (dayStatus.status === AVAILABILITY_STATUS.NONE) return AVAILABILITY_STATUS.NONE;
        if (dayStatus.status === AVAILABILITY_STATUS.PARTIAL) overallStatus = AVAILABILITY_STATUS.PARTIAL;
    }
    return overallStatus;
}

// In: availability.js

/**
 * Returns the list of "Pillar" category names configured for the active store in
 * the Stores table. Pillars are the health "components" recommended for a store,
 * and each pillar corresponds to a category. A store can define two or more.
 *
 * The column may arrive as an array (multi-select or linked records) or as a
 * comma-separated text value, so both shapes are normalized here. Linked-record
 * references are resolved to the linked category's display name. Returns an empty
 * array when the store has no pillars configured.
 *
 * @returns {Array<string>} Pillar category display names (e.g., ["Activities", "Food & Drink"]).
 */
export function getActiveStorePillars() {
    const activeStore = state.stores.all.find(s => s.id === state.ui.activeShopId);
    const raw = activeStore?.fields?.Pillars;
    if (!raw) return [];

    let values;
    if (Array.isArray(raw)) {
        values = raw;
    } else if (typeof raw === 'string') {
        values = raw.split(',');
    } else {
        return [];
    }

    const RECORD_ID_PATTERN = /^rec[A-Za-z0-9]{14}$/;
    return values
        .map(value => {
            if (typeof value !== 'string') return '';
            // Linked-record references resolve to the linked category's name.
            if (RECORD_ID_PATTERN.test(value)) {
                const rec = state.records.all.find(r => r.id === value);
                return rec?.fields?.Name?.trim() || '';
            }
            return value.trim();
        })
        .filter(Boolean);
}

// Action: REPLACE the entire `calculateMissingCategories` function

/**
 * [Recommendation Engine v2.0]
 * Calculates the "health" of the event by finding which of the store's recommended
 * "Pillar" categories are not yet represented in the locked plan. A plan is healthy
 * when it contains at least one item from each pillar.
 *
 * Pillars are read from the active store's `Pillars` column (see getActiveStorePillars).
 * Stores that do not define pillars fall back to the original default component set so
 * recommendation sorting behaves exactly as it did before for them.
 *
 * @returns {Array<string>} A list of missing pillar categories (e.g., ["Venues", "Extras"])
 */
export function calculateMissingCategories() {
    const pillars = getActiveStorePillars();

    // No store-defined pillars: preserve the original default behavior.
    if (pillars.length === 0) {
        return calculateMissingDefaultCategories();
    }

    // A pillar is "covered" when at least one locked item belongs to that category.
    // Matching mirrors the catalog's category filtering (comma-split + normalized).
    const covered = new Set();
    for (const recordId of state.cart.lockedItems.keys()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;
        const itemCategories = (record.fields.Categories || '')
            .split(',')
            .map(cat => cat.trim().toLowerCase().replace(/\s+/g, ' '));
        pillars.forEach(pillar => {
            const pillarNorm = pillar.toLowerCase().replace(/\s+/g, ' ');
            if (itemCategories.includes(pillarNorm)) covered.add(pillar);
        });
    }

    return pillars.filter(pillar => !covered.has(pillar));
}

/**
 * Original default "4 Pillars" health calculation, retained for stores that have
 * no pillars configured so their recommendation goal bucket is unchanged.
 * @returns {Array<string>} A list of missing default categories.
 */
function calculateMissingDefaultCategories() {
    // The default 4 Pillars (Using the exact, case-sensitive names the UI will display)
    const requiredCategories = {
        "Activities": false,
        "Food & Drink": false, // Key matches desired display
        "Venues": false,     // Key matches desired display
        "Extras": false,
    };

    for (const recordId of state.cart.lockedItems.keys()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;
        // The itemCategories string is a lowercased, comma-separated list of categories from Airtable
        const itemCategories = (record.fields.Categories || '').toLowerCase();

        // Check against our "required" list. We check for common lowercase variations.
        if (itemCategories.includes('activities')) {
            requiredCategories["Activities"] = true;
        }

        // --- FIXED: Robust check for all Food & Drink variations ---
        if (itemCategories.includes('food & drink') ||  // "Food & Drink"
            itemCategories.includes('food/drink') ||    // "Food/Drink" (from original data)
            itemCategories.includes('food') ||          // "Food"
            itemCategories.includes('drink')) {         // "Drink"
            requiredCategories["Food & Drink"] = true;
        }
        // --- ^^^ END FIXED ^^^

        if (itemCategories.includes('venues') || itemCategories.includes('venue')) {
            requiredCategories["Venues"] = true;
        }

        if (itemCategories.includes('extras')) {
            requiredCategories["Extras"] = true;
        }
    }

    let suggestions = [];
    for (const category in requiredCategories) {
        if (!requiredCategories[category]) {
            suggestions.push(category);
        }
    }
    return suggestions;
}

// --- START V2.1/V3.6: NEW FUNCTIONS (Centralized Scoring Helpers) ---

export const ATTRIBUTE_TO_KEYWORDS_MAP = {
    // Vibe Attributes
    "Vibe.Energy": [
        "fun", "exciting", "social", "joy", "lively", "party", "active", "energetic", 
        "fast", "upbeat", "loud", "dance", "dancing", "high-energy", "vibrant", 
        "festive", "dynamic"
    ],
    "Vibe.Relaxation": [
        "calm", "quiet", "relaxing", "chill", "bonding", "mellow", "peaceful", 
        "serene", "tranquil", "low-key", "casual", "unwind", "restful", "cozy",
        "spa", "mindfulness", "meditation"
    ],
    "Vibe.Novelty": [
        "unique", "silly", "goofy", "weird", "new", "different", "surprising", 
        "unusual", "novel", "quirky", "unexpected", "strange", "bizarre", "zany",
        "wacky"
    ],
    "Vibe.Formality": [
        "celebration", "celebrate", "formal", "fancy", "executive", "luxury", 
        "elegant", "sophisticated", "classy", "upscale", "premium", "corporate",
        "professional", "gala", "banquet"
    ],
    
    // Intellect Attributes
    "Intellect.Creative": [
        "creative", "art", "artistic", "design", "painting", "crafty", "crafts",
        "drawing", "diy", "hands-on", "build", "expressive", "music", "writing"
    ],
    "Intellect.Analytical": [
        "team-build", "team building", "challenging", "problem-solving", "smart", 
        "puzzle", "puzzles", "logic", "strategy", "strategic", "escape room", 
        "brainy", "intellectual", "trivia", "collaboration", "collaborative"
    ],
    
    // Physicality Attributes
    "Physicality.Intensity": [
        "competitive", "physical", "active", "intense", "sporty", "sports", 
        "fitness", "hiking", "running", "outdoor", "outdoors", "adventure",
        "competition", "vs", "versus"
    ],
    
    // Pillar Attributes (for implicit goals & core needs)
    "Pillars.Activity": [
        "activities", "activity", "do", "something", "team"
    ],
    "Pillars.Food & Drink": [
        "food & drink", "food/drink", "food", "drink", "eat", "wine", "bar", 
        "drinks", "cocktails", "beer", "catering", "restaurant", "lunch", "dinner",
        "snacks", "appetizers", "tacos", "pizza", "cuisine"
    ],
    "Pillars.Venues": [
        "venues", "venue", "place", "location", "space", "rent", "room"
    ],
    "Pillars.Extras": [
        "extras", "swag", "gifts", "photography", "transportation", "music", 
        "dj", "entertainment", "decor"
    ]
};
// In: availability.js
// Action: REPLACE the entire `buildGoalBucket` function (around line 290)

/**
 * [V3.6] Builds the user's complete "Goal Bucket" using multi-pass extraction.
 * @param {string} sortBy - The current sort mode.
 * @returns {Array<string>} A list of goals (e.g., ["Venues", "anniversary", "party", "bob", "pizza"])
 */
export function buildGoalBucket(sortBy) {
    const goals = new Set();
    const isRecommendedSort = sortBy === 'recommended';
    const rawGoalText = document.getElementById('header-goals')?.value?.toLowerCase() || '';

    // --- NEW: List of common "stop words" to ignore ---
    const STOP_WORDS = new Set([
        'a', 'an', 'the', 'for', 'with', 'and', 'is', 'of', 'to', 'in', 'on', 
        'at', 'my', 'it', 'big', 'small', 'all', 'new', 'old', 'about', 'want'
    ]);

    if (isRecommendedSort) {
        // 1. Implicit Goals (Missing Pillars) - ALWAYS INCLUDED
        const missingCategories = calculateMissingCategories();
        missingCategories.forEach(cat => goals.add(cat));
        
        // --- SIMPLIFIED & ROBUST GOAL PARSING ---
        if (rawGoalText.length > 2) {
            // Split by any space or comma, then filter
            const words = rawGoalText.split(/[\s,]+/); 
            words.forEach(word => {
                // Add any word that is long enough and not a stop word
                if (word.length > 2 && !STOP_WORDS.has(word)) {
                    goals.add(word);
                }
            });
        }
        // --- END SIMPLIFIED LOGIC ---

        // 3. Search Goal (From "Search" input) - ALWAYS INCLUDED
        const searchText = document.getElementById('name-filter')?.value?.trim().toLowerCase() || '';
        if (searchText.length > 2) {
            goals.add(searchText);
        }
    }

    return Array.from(goals);
}

/**
 * [v2.1] Helper to safely get a nested value (e.g., "Vibe.Energy") from a profile.
 */
export function getProfileScore(profile, key) {
    if (!profile || !key) return 0;
    const keys = key.split('.');
    if (keys.length === 2) {
        // Accessing nested profile[keys[0]][keys[1]]
        return profile[keys[0]]?.[keys[1]] || 0;
    }
    return 0;
}

/**
 * [V2.9] Fallback scoring for un-profiled items.
 * @param {object} record - The Airtable record.
 * @param {string} searchTerm - The user's search query.
 * @returns {number} A simple keyword-match score.
 */
export function calculateBasicSearchScore(record, searchTerm) {
    if (!searchTerm) return 0;
    
    const name = (record.fields.Name || '').toLowerCase();
    const description = (record.fields.Description || '').toLowerCase();
    const tags = (record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS] || '').toLowerCase();
    
    if (name.includes(searchTerm)) return 10;
    if (description.includes(searchTerm)) return 5;
    if (tags.includes(searchTerm)) return 3;
    return 0;
}


/**
 * [V3.7] Calculates the "Universal Profile" score using the robust "Reverse Map" engine.
 * @param {object} record - The Airtable record.
 * @param {Array<string>} goalBucket - The user's master goal list.
 * @returns {number} The final recommendation score.
 */
export function calculateRecommendationScore(record, goalBucket) {
    let finalScore = 0;
    if (goalBucket.length === 0) return 0;
    
    let profile;
    try {
        profile = JSON.parse(record.fields.AI_Profile || '{}');
        if (!profile.profileSource) throw new Error('Not a v2.1 profile.');
    } catch (e) {
        // Fallback for old/empty items: retains basic keyword score
        const currentSearchTerm = document.getElementById('name-filter')?.value?.trim().toLowerCase() || '';
        return calculateBasicSearchScore(record, currentSearchTerm); 
    }

    const { Tags = [], ...attributes } = profile;
    const itemTags = new Set(Tags.map(t => t.toLowerCase())); // Optimize tag lookup

    // --- NEW "REVERSE MAP" SCORING LOGIC ---

    goalBucket.forEach(goal => {
        const goalLower = goal.toLowerCase();
        let goalScored = false;

        // 1. Check "Brain 1" (The "Smart" Reverse Map)
        // Iterate through our map of attributes (e.g., "Vibe.Energy")
        for (const attributeKey in ATTRIBUTE_TO_KEYWORDS_MAP) {
            // Check if that attribute's keyword list includes the user's goal
            if (ATTRIBUTE_TO_KEYWORDS_MAP[attributeKey].includes(goalLower)) {
                // IT'S A MATCH!
                // Get the item's score for that attribute (e.g., Vibe.Energy = 7)
                const itemScoreForAttribute = getProfileScore(attributes, attributeKey);
                
                // Add that score to the total.
                // An item with {Vibe.Energy: 7} gets +7 points for the goal "party"
                finalScore += itemScoreForAttribute;
                goalScored = true;
            }
        }

        // 2. Check "Brain 2" (The "Tag" Match)
        // If the goal wasn't scored by the "Smart" map (e.g., "costume" or "pizza"),
        // check if it exists in the item's direct AI Tags.
        if (!goalScored && itemTags.has(goalLower)) {
            const TAG_BONUS = 15; // Give a high bonus for specific keyword matches
            finalScore += TAG_BONUS;
        }
    });

    return finalScore;
}
