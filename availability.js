// PASTE THIS ENTIRE CODE INTO: availability.js
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
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);
        return busyStart <= dayEnd && busyEnd >= dayStart;
    });

    if (busyPeriods.length === 0) {
        return { status: AVAILABILITY_STATUS.FULL, reason: 'Fully Available' };
    }

    const totalMinutes = 24 * 60;
    let busyMinutes = 0;
    busyPeriods.forEach(busy => {
        const start = new Date(Math.max(busy.start, dayStart));
        const end = new Date(Math.min(busy.end, dayEnd));
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
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);
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

    const availableSlots = [];
    let lastEnd = dayStart;

    busyTimes.sort((a, b) => new Date(a.start) - new Date(b.start));
    busyTimes.forEach(busy => {
        const start = new Date(Math.max(busy.start, dayStart));
        const end = new Date(Math.min(busy.end, dayEnd));

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

    return availableSlots.map(slot => {
        const startTime = new Date(slot.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const endTime = new Date(slot.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `${startTime} - ${endTime}`;
    }).join('\n') ||
        'No available slots';
}

export async function getCombinedPlanStatus(date, lockedItems) {
    let overallStatus = AVAILABILITY_STATUS.FULL;
    for (const record of lockedItems) {
        if (record && record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL]) {
            const busyTimes = await api.fetchCalendarForRecord(record);
            const status = getDayStatus(date, busyTimes, record).status;

            if (status === AVAILABILITY_STATUS.NONE) {
                return AVAILABILITY_STATUS.NONE;
                // If any item is unavailable, the whole plan is unavailable
            }
            if (status === AVAILABILITY_STATUS.PARTIAL) {
                overallStatus = AVAILABILITY_STATUS.PARTIAL;
                // If at least one is partial, the plan is partial
            }
        }
    }

    return overallStatus;
}

// In: availability.js
// Action: REPLACE the entire `calculateMissingCategories` function

/**
 * [Recommendation Engine v1.2]
 * Calculates the "health" of the event to find missing "Pillar" categories.
 * @returns {Array<string>} A list of missing categories (e.g., ["Venue", "Food/Drink"])
 */
export function calculateMissingCategories() {
    // Your 4 Pillars (Using the exact, case-sensitive names the UI will display)
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

/**
 * [v2.1] The "Goal Mapper" (Rosetta Stone).
 */
export const GOAL_PROFILE_MAP = {
    // --- Abstract Goals (from text) ---
    "fun": { "Vibe.Energy": 1.0, "Vibe.Novelty": 0.5, "Vibe.Relaxation": -0.5 },
    "exciting": { "Vibe.Energy": 1.0, "Physicality.Intensity": 0.5 },
    "social": { "Vibe.Energy": 0.5, "Vibe.Formality": -0.5, "Vibe.Relaxation": 0.5 },
    "joy": { "Vibe.Energy": 0.8, "Vibe.Novelty": 0.5 },
    "lively": { "Vibe.Energy": 1.0 },
    "calm": { "Vibe.Relaxation": 1.0, "Vibe.Energy": -0.8 },
    "quiet": { "Vibe.Relaxation": 1.0, "Vibe.Energy": -0.8 },
    "unique": { "Vibe.Novelty": 1.0 },
    "challenging": { "Intellect.Analytical": 0.7, "Physicality.Intensity": 0.5 },
    "relaxing": { "Vibe.Relaxation": 1.0, "Vibe.Energy": -1.0 },
    "chill": { "Vibe.Relaxation": 1.0, "Vibe.Energy": -1.0 },
    "creative": { "Intellect.Creative": 1.0, "Vibe.Novelty": 0.5 },
    "art": { "Intellect.Creative": 1.0 },
    "artistic": { "Intellect.Creative": 1.0 },
    "team-build": { "Intellect.Analytical": 0.5, "Intellect.Creative": 0.5 },
    "team building": { "Intellect.Analytical": 0.5, "Intellect.Creative": 0.5 },
    "bonding": { "Vibe.Relaxation": 0.5, "Vibe.Formality": -0.5 },
    "competitive": { "Physicality.Intensity": 0.5, "Tags": "competitive" },
    "celebration": { "Vibe.Energy": 0.5, "Vibe.Formality": 0.5 },
    "celebrate": { "Vibe.Energy": 0.5, "Vibe.Formality": 0.5 },
    // --- Location/Food Entities (Direct Tag Matches) ---
    "outdoor": { "Tags": "outdoor" },
    "outdoors": { "Tags": "outdoor" },
    "park": { "Tags": "outdoor" },
    "beach": { "Tags": "outdoor" },
    "indoor": { "Tags": "indoor" },
    "home": { "Tags": "indoor" },
    "office": { "Tags": "indoor" },
    "pizza": { "Tags": "pizza" },
    "porkchops": { "Tags": "porkchops" },
    "tacos": { "Tags": "tacos" },
    "burritos": { "Tags": "burritos" },
    "bar": { "Tags": "bar" },
    "wine": { "Tags": "wine" },
    "drink": { "Tags": "drink" },
    "food": { "Tags": "food" },
    // --- Pillar Goals (Implicit) ---
    "Activities": { "Pillars.Activity": 1.0 },
    "Food & Drink": { "Pillars.Food & Drink": 1.0 },
    "Venues": { "Pillars.Venues": 1.0 },
    "Extras": { "Pillars.Extras": 1.0 }
};

/**
 * [V3.6] Builds the user's complete "Goal Bucket" using multi-pass extraction.
 * @param {string} sortBy - The current sort mode.
 * @returns {Array<string>} A list of goals (e.g., ["Venue", "fun time with friends", "pizza"])
 */
export function buildGoalBucket(sortBy) {
    const goals = new Set();
    const isRecommendedSort = sortBy === 'recommended';
    const rawGoalText = document.getElementById('header-goals')?.value?.toLowerCase() || '';

    if (isRecommendedSort) {
        // 1. Implicit Goals (Missing Pillars) - ALWAYS INCLUDED
        const missingCategories = calculateMissingCategories();
        missingCategories.forEach(cat => goals.add(cat));
        
        // 2. Explicit Goals & Entity Extraction (V3.6 Pass) ---
        if (rawGoalText.length > 2) {
            // FIX: Use comma separation for clear multi-word phrases, keeping the goal as typed
            const phrases = rawGoalText.split(',').map(p => p.trim()).filter(p => p.length > 2 && p.toLowerCase() !== 'and'); 
            
            phrases.forEach(phrase => {
                // Check if the whole phrase matches a multi-word key in the map
                let matchFound = false;
                Object.keys(GOAL_PROFILE_MAP).forEach(keyword => {
                     if (phrase.includes(keyword)) {
                        goals.add(keyword);
                        matchFound = true;
                    }
                });
                
                if (!matchFound) {
                    // Fallback to searching word by word in the phrase for known tags
                    const wordsInPhrase = phrase.split(' ');
                    wordsInPhrase.forEach(word => {
                        if (GOAL_PROFILE_MAP[word]) {
                            goals.add(word);
                        }
                    });
                }
            });
        }

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
 * [V2.9] Calculates the "Universal Profile" score for an item.
 * NOTE: This is now exported for use in components/card.js and components/sidebar.js.
 * @param {object} record - The Airtable record.
 * @param {Array<string>} goalBucket - The user's master goal list.
 * @returns {number} The final recommendation score.
 */
export function calculateRecommendationScore(record, goalBucket) {
    let finalScore = 0;
    const currentSearchTerm = document.getElementById('name-filter')?.value?.trim().toLowerCase() || '';

    let profile;
    try {
        // Try to parse the new v2.1 AI_Profile
        profile = JSON.parse(record.fields.AI_Profile || '{}');
        if (!profile.profileSource) throw new Error('Not a v2.1 profile.');
    } catch (e) {
        // Fallback for old/empty items: retains basic keyword score
        return calculateBasicSearchScore(record, currentSearchTerm); 
    }

    const { profileSource, Tags = [], ...attributes } = profile;

    // --- HYBRID SCORING LOGIC ---
    goalBucket.forEach(goal => {
        const goalLower = goal.toLowerCase();

        // 1. Check "Brain 1" (The "Smart" Mapper)
        if (GOAL_PROFILE_MAP[goalLower]) {
            const mapper = GOAL_PROFILE_MAP[goalLower];
            for (const key in mapper) {
                const weight = mapper[key];
                
                if (key === 'Tags') {
                    if (Tags.includes(weight)) {
                        finalScore += 10;
                    }
                } else {
                    const itemScore = getProfileScore(attributes, key); 
                    finalScore += (itemScore * weight);
                }
            }
        }
        // 2. Check "Brain 2" (The "Robust" Tagger)
        // This handles explicit search terms or un-mapped goals that match a Tag
        else if (Tags.some(tag => tag.includes(goalLower))) { 
            const TAG_BONUS = 15; 
            finalScore += TAG_BONUS;
        }
    });

    return finalScore;
}
