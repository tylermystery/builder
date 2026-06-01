// FILE: config.js
export const STRIPE_PUBLISHABLE_KEY = 'pk_live_opXi3umu9588LiitWvYhdk9H';
export const CLOUDINARY_CLOUD_NAME = 'daedqizre';
export const RECORDS_PER_LOAD = 10;

// --- Agora Live Stream Configuration (v3.8) ---
export const AGORA_APP_ID = typeof window !== 'undefined' && window.__AGORA_APP_ID__ || '';
export const AGORA_SDK_URL = 'https://download.agora.io/sdk/release/AgoraRTC_N-4.22.0.js';
export const LIVE_STREAM_CONFIG = {
    codec: 'vp8',
    mode: 'live',             // 'live' mode for broadcast scenario (host + audience)
    role: 'host',             // default role, overridden per user
    videoProfile: {
        width: 640,
        height: 360,
        frameRate: 15,
        bitrateMin: 200,
        bitrateMax: 600,
    },
    audioProfile: 'speech_low_quality',  // optimized for voice, lower bandwidth
};

// Ryry AI Assistant voice command configuration
export const RYRY_CONFIG = {
    wakeWord: 'ryry',
    commands: {
        LOG_TASK: { keywords: ['log task', 'add task', 'create task', 'new task'], description: 'Create a new task in the current plan' },
        SET_PRIORITY: { keywords: ['set priority', 'priority', 'mark priority', 'change priority'], description: 'Set priority on the most recent task' },
        PROJECT_UPDATE: { keywords: ['project update', 'post update', 'send update', 'status update'], description: 'Post a project update to the plan chat' },
    },
    confirmationTimeoutMs: 5000,  // 5 second undo window for voice commands
};

// Base categories for item classification
export const BASE_CATEGORIES = [
    { id: 'Activities', label: 'Activities', icon: '🎯', color: '#1565c0', bg: '#e3f2fd', border: '#90caf9' },
    { id: 'Food & Drink', label: 'Food & Drink', icon: '🍽️', color: '#e65100', bg: '#fff3e0', border: '#ffcc80' },
    { id: 'Venues', label: 'Venues', icon: '📍', color: '#2e7d32', bg: '#e8f5e9', border: '#a5d6a7' },
    { id: 'Extras', label: 'Extras', icon: '✨', color: '#7b1fa2', bg: '#f3e5f5', border: '#ce93d8' },
];

// Tags organized by theme for the tag picker
export const TAG_GROUPS = [
    { label: 'Audience', tags: ['Family Friendly', 'Kids', 'Adults Only', 'All Ages', 'Couples', 'Groups', 'Solo'] },
    { label: 'Setting', tags: ['Outdoors', 'Indoors', 'Waterfront', 'Rooftop', 'Beachside'] },
    { label: 'Vibe', tags: ['Luxury', 'Budget Friendly', 'Casual', 'Formal', 'Themed', 'Unique', 'Classic', 'Trendy', 'Rustic', 'Elegant'] },
    { label: 'Experience', tags: ['Interactive', 'Live Entertainment', 'Music', 'DIY', 'Educational', 'Hands-On', 'Spectator', 'Relaxing', 'Adventurous', 'Cultural'] },
    { label: 'Event Fit', tags: ['Wedding', 'Birthday', 'Corporate', 'Holiday', 'Date Night', 'Team Building', 'Celebration', 'Festival'] },
    { label: 'Timing', tags: ['Late Night', 'Daytime', 'Seasonal', 'Year Round', 'Weekend', 'Private', 'Public'] },
    { label: 'Food & Drink', tags: ['Catering', 'Bar Service', 'Desserts', 'Local Cuisine', 'Dietary Options', 'BYOB'] },
    { label: 'Venue', tags: ['Photo Worthy', 'Scenic', 'Spacious', 'Intimate', 'Historic', 'Modern'] },
];
// Quick reaction emojis shown by default
export const EMOJI_REACTIONS = ['🚀', '🔥', '🤩', '❤️', '👍', '🤔', '👎', '🤢'];

// Extended emoji categories for the full emoji picker
export const EMOJI_CATEGORIES = {
    favorites: {
        label: 'Favorites',
        emojis: ['🚀', '🔥', '🤩', '❤️', '👍', '🎉', '⭐', '💯']
    },
    positive: {
        label: 'Positive',
        emojis: ['😍', '🥰', '😊', '🤗', '👏', '🙌', '💪', '✨', '🌟', '💖', '💕', '🎊', '🏆', '👌', '🤝', '💐']
    },
    excited: {
        label: 'Excited',
        emojis: ['🎉', '🥳', '🎊', '🎈', '🎁', '🎯', '🎶', '🕺', '💃', '🍾', '🥂', '🎪', '🎠', '🎡', '🎢', '🎭']
    },
    love: {
        label: 'Love',
        emojis: ['❤️', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💗', '💓', '💝', '💘', '💌', '😘', '😻', '🫶']
    },
    neutral: {
        label: 'Neutral',
        emojis: ['🤔', '😐', '🙂', '😶', '🤷', '💭', '📝', '👀', '🔍', '⏳', '📊', '📈', '🎲', '🎴', '🃏', '⚖️']
    },
    negative: {
        label: 'Negative',
        emojis: ['👎', '😕', '😟', '😢', '😞', '💔', '🙁', '😔', '😩', '😫', '🤦', '🙅', '❌', '⛔', '🚫', '⚠️']
    },
    dislike: {
        label: 'Dislike',
        emojis: ['🤢', '🤮', '😤', '😠', '💢', '🗑️', '👻', '💀', '☠️', '🚨', '🆘', '⛈️', '🌧️', '🥶', '🥵', '😱']
    },
    food: {
        label: 'Food & Drink',
        emojis: ['🍕', '🍔', '🌮', '🍣', '🍜', '🍰', '🎂', '🍦', '🍩', '🍪', '☕', '🍷', '🍺', '🥗', '🍝', '🥘']
    },
    nature: {
        label: 'Nature',
        emojis: ['🌸', '🌺', '🌻', '🌹', '🌷', '🌴', '🌊', '🏔️', '🌅', '🌈', '☀️', '🌙', '⭐', '🦋', '🐬', '🦜']
    },
    activities: {
        label: 'Activities',
        emojis: ['⚽', '🏀', '🎾', '🏈', '🎮', '🎨', '🎸', '🎻', '🎹', '📸', '🎥', '🎬', '🏊', '🚴', '🧘', '🏋️']
    }
};

// Score values for all emojis - positive numbers increase ranking, negative decrease
// Scores now use precise decimal values for more accurate sentiment analysis
export const REACTION_SCORES = {
    // Favorites (high positive)
    '🚀': 4.87, '🔥': 3.62, '🤩': 3.41, '❤️': 2.34, '👍': 2.18, '🎉': 3.56, '⭐': 2.43, '💯': 4.92,
    // Positive
    '😍': 3.47, '🥰': 3.38, '😊': 2.24, '🤗': 2.31, '👏': 2.27, '🙌': 3.29, '💪': 2.36, '✨': 2.41,
    '🌟': 2.38, '💖': 2.45, '💕': 2.29, '🎊': 3.44, '🏆': 4.83, '👌': 2.22, '🤝': 1.47, '💐': 2.33,
    // Excited
    '🥳': 3.52, '🎈': 2.26, '🎁': 2.35, '🎯': 2.28, '🎶': 1.42, '🕺': 2.21, '💃': 2.23, '🍾': 2.37,
    '🥂': 2.32, '🎪': 1.38, '🎠': 1.33, '🎡': 1.36, '🎢': 1.41, '🎭': 1.44,
    // Love
    '💛': 2.42, '💚': 2.39, '💙': 2.44, '💜': 2.47, '🖤': 1.28, '🤍': 1.31, '🤎': 1.26, '💗': 2.46,
    '💓': 2.38, '💝': 2.51, '💘': 2.48, '💌': 2.29, '😘': 2.36, '😻': 2.41, '🫶': 2.44,
    // Neutral
    '🤔': -1.23, '😐': 0.04, '🙂': 1.18, '😶': 0.02, '🤷': 0.06, '💭': 0.08, '📝': 0.03, '👀': 0.07,
    '🔍': 0.05, '⏳': 0.04, '📊': 0.06, '📈': 1.21, '🎲': 0.03, '🎴': 0.02, '🃏': 0.04, '⚖️': 0.01,
    // Negative
    '👎': -2.34, '😕': -1.28, '😟': -1.36, '😢': -2.41, '😞': -1.32, '💔': -2.47, '🙁': -1.24, '😔': -1.29,
    '😩': -2.38, '😫': -2.43, '🤦': -1.41, '🙅': -2.28, '❌': -3.52, '⛔': -3.47, '🚫': -3.44, '⚠️': -1.18,
    // Dislike
    '🤢': -3.38, '🤮': -4.76, '😤': -2.31, '😠': -2.44, '💢': -2.36, '🗑️': -4.82, '👻': -1.22, '💀': -3.41,
    '☠️': -3.46, '🚨': -2.27, '🆘': -3.34, '⛈️': -1.19, '🌧️': -1.14, '🥶': -1.26, '🥵': -1.23, '😱': -2.48,
    // Food & Drink (mostly neutral-positive)
    '🍕': 1.47, '🍔': 1.42, '🌮': 1.44, '🍣': 1.51, '🍜': 1.38, '🍰': 1.46, '🎂': 2.28, '🍦': 1.36,
    '🍩': 1.33, '🍪': 1.31, '☕': 1.43, '🍷': 1.48, '🍺': 1.39, '🥗': 1.27, '🍝': 1.34, '🥘': 1.41,
    // Nature (mostly positive)
    '🌸': 2.26, '🌺': 2.34, '🌻': 2.38, '🌹': 2.42, '🌷': 2.31, '🌴': 1.47, '🌊': 1.52, '🏔️': 1.44,
    '🌅': 2.48, '🌈': 2.53, '☀️': 2.36, '🌙': 1.38, '🦋': 1.43, '🐬': 1.46, '🦜': 1.41,
    // Activities (neutral-positive)
    '⚽': 1.42, '🏀': 1.38, '🎾': 1.36, '🏈': 1.44, '🎮': 1.47, '🎨': 1.52, '🎸': 1.48, '🎻': 1.43,
    '🎹': 1.46, '📸': 1.51, '🎥': 1.44, '🎬': 1.49, '🏊': 1.38, '🚴': 1.41, '🧘': 1.53, '🏋️': 1.46,
    // Tier 3: Uncommon (modal picker - deeper scroll)
    '🦄': 3.89, '🪄': 2.67, '🫧': 1.54, '🪩': 2.73, '🧿': 0.12, '🎐': 1.29, '🪬': 0.09,
    '🫀': -0.87, '🧠': 1.62, '🦷': -0.42, '🦴': -0.91, '👁️': 0.14, '🫂': 2.16, '🤌': 1.73,
    '🤙': 1.68, '🦾': 2.41, '🧶': 1.17, '🪡': 0.83, '🧊': -0.67, '🫗': 0.21,
    // Tier 4: Rare / Atypical (modal picker - even deeper)
    '🪸': 1.37, '🪻': 1.82, '🪷': 2.08, '🫎': 0.76, '🦣': 0.43, '🦤': -1.56, '🪿': 0.91,
    '🪺': 1.14, '🫏': 0.62, '🦫': 0.88, '🦭': 1.23, '🪼': 0.47, '🦩': 1.58, '🦚': 1.94,
    '🪶': 1.11, '🪵': 0.68, '🪨': -0.34, '🪐': 1.76, '🧪': 0.52, '🧬': 0.71,
    // Tier 5: Obscure / Cryptic (modal picker - deepest scroll)
    '🏺': 0.33, '⚗️': 0.47, '🔮': 1.83, '📿': 0.28, '🪘': 0.94,
    '🪗': 0.86, '🪕': 1.02, '🪈': 0.79, '🪆': 0.56, '🪅': 1.67,
    '🪤': -2.88, '🪃': 1.32, '🪙': 1.78, '⚱️': -1.44
};

// ─── Score → Adjective Mapping ───────────────────────────────────────────────
// A single shared vocabulary so that every place a sentiment score is shown — the
// aggregate community average (chips, popups, summaries) and the fixed score of an
// individual emoji (picker tooltips) — can pair the number with a plain-language
// word. The bands are symmetric across the −4.9…+4.9 scale used by REACTION_SCORES
// and the feeling-based wording reads naturally for both an aggregate ("the
// community is Loved on this") and a single emoji ("🚀 +4.9 · Ecstatic").
//
// Note: this maps a numeric score only. The "no reactions yet" state has no score
// and is intentionally left wordless by its callers — an untouched item is never
// labelled "Neutral".
export const SCORE_ADJECTIVE_BANDS = [
    { min: 4.0, label: 'Ecstatic' },
    { min: 3.0, label: 'Adored' },
    { min: 2.0, label: 'Loved' },
    { min: 1.0, label: 'Liked' },
    { min: -1.0, label: 'Neutral' },
    { min: -2.0, label: 'Lukewarm' },
    { min: -3.0, label: 'Disliked' },
    { min: -4.0, label: 'Rough' },
    { min: -Infinity, label: 'Panned' },
];

/**
 * Map a sentiment score to its plain-language adjective. Used everywhere a score
 * is displayed so a number is never shown alone.
 * @param {number} score - A value on the REACTION_SCORES scale (~ −4.9…+4.9).
 * @returns {string} The matching adjective (e.g. "Loved").
 */
export function scoreToAdjective(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return 'Neutral';
    for (const band of SCORE_ADJECTIVE_BANDS) {
        if (n >= band.min) return band.label;
    }
    return 'Neutral';
}

// Tiered emoji picker for the detail modal - begins standard, scrolls to obscure
// Each tier has a label, description, and the emojis get progressively more unusual
export const EMOJI_TIERS = [
    {
        label: 'Quick Reactions',
        description: 'The essentials - high impact on ranking',
        emojis: ['🚀', '🔥', '🤩', '❤️', '👍', '🎉', '💯', '🤔', '👎', '🤢']
    },
    {
        label: 'Positive Vibes',
        description: 'Show your enthusiasm - moderate positive impact',
        emojis: ['😍', '🥰', '😊', '🤗', '👏', '🙌', '💪', '✨', '🌟', '💖', '🏆', '🥳', '💃', '🕺', '🍾', '🥂']
    },
    {
        label: 'Mixed Feelings',
        description: 'Neutral to slightly negative - minimal ranking effect',
        emojis: ['🙂', '😐', '🤷', '💭', '👀', '📊', '⚖️', '🎲', '🃏', '😶', '📝', '🔍', '⏳', '📈']
    },
    {
        label: 'Not Feeling It',
        description: 'Negative signals - will lower ranking',
        emojis: ['😕', '😟', '😢', '😞', '💔', '😩', '🤦', '🙅', '❌', '⛔', '🚫', '⚠️', '😤', '😠', '💢', '🗑️']
    },
    {
        label: 'Themed',
        description: 'Category vibes - slight positive ranking nudge',
        emojis: ['🍕', '🍔', '🌮', '🍣', '☕', '🍷', '🌸', '🌊', '🏔️', '🌅', '🌈', '⚽', '🎮', '🎨', '🎸', '📸']
    },
    {
        label: 'Uncommon Picks',
        description: 'Stand out from the crowd - varied ranking effects',
        emojis: ['🦄', '🪄', '🪩', '🧠', '🤌', '🤙', '🦾', '🫂', '🧶', '🧊', '🫗', '👁️', '🫀', '🦷', '🦴', '🪡']
    },
    {
        label: 'Rare Finds',
        description: 'Deep cuts - subtle ranking influence',
        emojis: ['🪸', '🪻', '🪷', '🦣', '🦤', '🪿', '🦫', '🦭', '🪼', '🦩', '🦚', '🪶', '🪐', '🧪', '🧬', '🪺']
    },
    {
        label: 'Cryptic & Obscure',
        description: 'The rarest reactions - mysterious ranking effects',
        emojis: ['🏺', '⚗️', '🔮', '📿', '🪘', '🪗', '🪕', '🪈', '🪆', '🪅', '🪤', '🪃', '🪙', '⚱️', '🧿', '🎐']
    }
];

// ─── Democratic Averaging & Multi-Emoji Utilities ────────────────────────────

/**
 * Compute the democratic average score from multi-emoji reactions.
 * Algorithm:
 *   1. For each user, compute the average of their emoji scores.
 *   2. The democratic average = mean of all per-user averages.
 * This ensures each user has equal weight regardless of how many emojis they added.
 *
 * @param {Map<string, Set<string>>} reactionsMap - Map<userId, Set<emoji>>
 * @returns {{ democraticAverage: number, summaryEmoji: string, userCount: number, totalReactions: number }}
 */
export function computeDemocraticAverage(reactionsMap) {
    if (!reactionsMap || !(reactionsMap instanceof Map) || reactionsMap.size === 0) {
        return { democraticAverage: 0, summaryEmoji: '😊', userCount: 0, totalReactions: 0 };
    }

    let userCount = 0;
    let totalReactions = 0;
    let sumOfUserAverages = 0;

    for (const [, emojiData] of reactionsMap) {
        // Support both Set (new) and string (legacy) formats
        const emojiSet = emojiData instanceof Set ? emojiData : new Set([emojiData]);
        if (emojiSet.size === 0) continue;

        let userTotal = 0;
        for (const emoji of emojiSet) {
            userTotal += (REACTION_SCORES[emoji] || 0);
            totalReactions++;
        }
        const userAvg = userTotal / emojiSet.size;
        sumOfUserAverages += userAvg;
        userCount++;
    }

    if (userCount === 0) {
        return { democraticAverage: 0, summaryEmoji: '😊', userCount: 0, totalReactions: 0 };
    }

    const democraticAverage = sumOfUserAverages / userCount;

    // Find the closest emoji from the full REACTION_SCORES table
    let summaryEmoji = '😊';
    let closestDiff = Infinity;
    for (const [emoji, score] of Object.entries(REACTION_SCORES)) {
        const diff = Math.abs(score - democraticAverage);
        if (diff < closestDiff) {
            closestDiff = diff;
            summaryEmoji = emoji;
        }
    }

    return { democraticAverage, summaryEmoji, userCount, totalReactions };
}

/**
 * Convert message-format reactions to the democratic average input format.
 * Messages store reactions as { emoji: [userId1, userId2] } while item reactions
 * use Map<userId, Set<emoji>>. This bridges the two models so computeDemocraticAverage
 * can be used on message/thread reactions too.
 *
 * @param {Object} msgReactions - Message reactions in { emoji: [userId, ...] } format
 * @returns {Map<string, Set<string>>} Map<userId, Set<emoji>> suitable for computeDemocraticAverage
 */
export function convertMessageReactions(msgReactions) {
    const userMap = new Map();
    if (!msgReactions || typeof msgReactions !== 'object') return userMap;
    for (const [emoji, userIds] of Object.entries(msgReactions)) {
        if (!Array.isArray(userIds)) continue;
        for (const userId of userIds) {
            if (!userMap.has(userId)) userMap.set(userId, new Set());
            userMap.get(userId).add(emoji);
        }
    }
    console.log(`[SUMMARY-DEBUG] convertMessageReactions: ${Object.keys(msgReactions).length} emoji types → ${userMap.size} users`);
    return userMap;
}

/**
 * Generate a short hash for a photo URL to create stable compound reaction keys.
 * Format: recordId::photo::hash
 * @param {string} url - The photo URL
 * @returns {string} An 8-character hex hash
 */
export function hashPhotoUrl(url) {
    if (!url) return '00000000';
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
        const char = url.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    // Convert to positive hex string, pad to 8 chars
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Build a compound reaction key for a photo.
 * @param {string} recordId - The parent item record ID
 * @param {string} photoUrl - The photo URL
 * @returns {string} Compound key like "recordId::photo::a1b2c3d4"
 */
export function getPhotoReactionKey(recordId, photoUrl) {
    return `${recordId}::photo::${hashPhotoUrl(photoUrl)}`;
}

export const CONSTANTS = {
    CLOUDINARY_CLOUD_NAME: 'daedqizre',
    FIELD_NAMES: {
        NAME: 'Name',
        PRICE: 'Price',
        DESCRIPTION: 'Description',
        OPTIONS: 'Options',
        PARENT_ITEM: 'Parent Item',
        STATUS: 'Status',
        DURATION: 'Duration (hours)',
        PRICING_TYPE: 'Pricing Type',
        HEADCOUNT_MIN: 'Headcount min',
        MEDIA_TAGS: 'Media Tags', // <-- ORIGINAL FIELD (LIVE SITE USES THIS)
        CURATED_IMAGES_LINK: 'Curated Images', // <-- NEW FIELD FOR AI LINKS (SETUP IN AIRTABLE)
        CATEGORIES: 'Categories',
        SUBCATEGORIES: 'Subcategories',
        ICAL_URL: 'iCal URL',
        LEAD_TIME: 'Lead Time (days)',
        COLLABORATOR_IDS_FIELD: 'CollaboratorIDs',
        SESSION_ID_FIELD: 'SessionID',
        TIMESTAMP_FIELD: 'Timestamp',
        // Package-specific fields
        PACKAGE_CONTENTS: 'Package Contents', // JSON field storing included items and add-ons
        PACKAGE_DISCOUNT: 'Package Discount', // Percentage discount for package
        PACKAGE_TIERS: 'Package Tiers', // Tiered pricing configuration
    },
    PRICING_TYPES: {
        PER_GUEST: 'per guest',
        PER_PERSON: 'per person',
        PER_CHARTER: 'per charter',
        PER_BUS: 'per bus',
        PER_VEHICLE: 'per vehicle',
        PER_HOUR: 'per hour',
        PER_GROUP: 'per group',
        FLAT_RATE: 'flat rate',
    },
    ITEM_TYPES: {
        BOOKABLE_ITEM: 'Bookable Item',
        EVENT: 'Event',
        GROUPING: 'Grouping',
        PACKAGE: 'Package',
    },
    // This part is crucial for session loading
    DETAIL_TYPES: {
        EVENT_NAME: 'eventName',
        DATE: 'date',
        DATE_END: 'dateEnd',
        START_TIME: 'startTime',
        END_TIME: 'endTime',
        DURATION: 'duration',
        GUEST_COUNT: 'guestCount',
        GOALS: 'goals',
        SPECIAL_REQUESTS: 'specialRequests',
        TITLE_AUTO_GENERATED: 'titleAutoGenerated',
        DESCRIPTION_AUTO_GENERATED: 'descriptionAutoGenerated',
    },
    // Centralized z-index values for proper layering hierarchy
    // Higher numbers appear above lower numbers
    Z_INDEX: {
        // Base layers
        KALEIDOSCOPE_BG: -1,           // Background canvas behind everything
        CONTENT: 1,                     // Main page content

        // Header and navigation
        HEADER: 1000,                   // Main header (sticky)
        HAMBURGER_DROPDOWN: 1000,       // Hamburger menu dropdown

        // Presentation view (fullscreen mode)
        PRESENTATION_VIEW: 1000,        // Presentation fullpage overlay
        PRESENTATION_CONTENT: 1,        // Content within presentation (relative)

        // Modals - base level (when no presentation active)
        MODAL_OVERLAY: 1000,            // Base modal overlay
        MODAL_CLOSE_BTN: 1010,          // Modal close button

        // Modals - elevated level (when presentation is active)
        MODAL_OVERLAY_ELEVATED: 1100,   // Modal overlay above presentation

        // Chat widget
        CHAT_TOGGLE: 1001,              // Chat toggle button
        CHAT_CONTAINER: 1050,           // Chat widget container

        // Popups and pickers
        REACTION_PICKER: 10001,         // Reaction picker popup (very high to ensure visibility)

        // Merge dialog (must be above radial menu which uses 99999)
        MERGE_DIALOG: 100001,           // Merge options dialog

        // Search modal in presentation
        PRESENTATION_SEARCH: 3000,      // Presentation search modal
        PRESENTATION_SEARCH_CONTENT: 2000, // Presentation search content

        // Debug and system
        DEBUG_PANEL: 10000,             // Debug panel
        TASK_DETAIL_MODAL: 10002,       // Task detail modal (admin)

        // Netlify Identity (external)
        NETLIFY_IDENTITY: 100000,       // Netlify identity widget
    }
};

/**
 * Get the appropriate z-index for modals based on current state
 * @param {string} type - The type of z-index ('modal', 'checkout', 'picker')
 * @returns {number} - The z-index value to use
 */
export function getModalZIndex(type = 'modal') {
    const isPresentationActive = document.body.classList.contains('presentation-active');

    switch (type) {
        case 'modal':
        case 'checkout':
        case 'detail':
            return isPresentationActive
                ? CONSTANTS.Z_INDEX.MODAL_OVERLAY_ELEVATED
                : CONSTANTS.Z_INDEX.MODAL_OVERLAY;
        case 'picker':
        case 'reaction':
            return CONSTANTS.Z_INDEX.REACTION_PICKER;
        case 'close-btn':
            return CONSTANTS.Z_INDEX.MODAL_CLOSE_BTN;
        default:
            return isPresentationActive
                ? CONSTANTS.Z_INDEX.MODAL_OVERLAY_ELEVATED
                : CONSTANTS.Z_INDEX.MODAL_OVERLAY;
    }
}

/**
 * Debug function to log all z-index values for visible elements
 * Call this from console: window.debugZIndex()
 */
export function debugZIndex() {
    const elements = [
        { selector: '#presentation-modal-overlay', name: 'Presentation View' },
        { selector: '#presentation-drag-buckets', name: 'Drag Buckets Container' },
        { selector: '.drag-zone-left', name: 'Drag Zone Left' },
        { selector: '.drag-zone-right', name: 'Drag Zone Right' },
        { selector: '#drag-action-tooltip', name: 'Drag Action Tooltip' },
        { selector: '#drag-merge-indicator', name: 'Drag Merge Indicator' },
        { selector: '#detail-modal-overlay', name: 'Detail Modal' },
        { selector: '#checkout-modal-overlay', name: 'Checkout Modal' },
        { selector: '.reaction-picker', name: 'Reaction Picker' },
        { selector: '.comment-reaction-picker', name: 'Comment Reaction Picker' },
        { selector: '#main-header', name: 'Main Header' },
        { selector: '.hamburger-dropdown', name: 'Hamburger Dropdown' },
        { selector: '#chat-widget-container', name: 'Chat Widget' },
        { selector: '.modal-overlay.active', name: 'Active Modal Overlay' },
    ];

    console.group('[Z-INDEX DEBUG] Current z-index values:');
    console.log('Presentation Active:', document.body.classList.contains('presentation-active'));

    elements.forEach(({ selector, name }) => {
        const el = document.querySelector(selector);
        if (el) {
            const computed = window.getComputedStyle(el);
            const isActive = el.classList.contains('active');
            const hasBucketsShown = el.classList.contains('buckets-shown');
            const hasDragActive = el.classList.contains('drag-active');
            console.log(`${name} (${selector}):`, {
                zIndex: computed.zIndex,
                inlineZIndex: el.style.zIndex || 'none',
                display: computed.display,
                visibility: computed.visibility,
                opacity: computed.opacity,
                position: computed.position,
                isActive,
                hasBucketsShown,
                hasDragActive,
                visible: computed.display !== 'none' && computed.visibility !== 'hidden'
            });
        } else {
            console.log(`${name} (${selector}): NOT FOUND`);
        }
    });

    console.groupEnd();
    return 'Z-index debug complete. Check console for details.';
}

/**
 * Debug function specifically for drag element visibility issues
 * Call this from console: window.debugDragElements()
 * Use when drag bucket text appears in unexpected places
 */
export function debugDragElements() {
    console.group('[DRAG DEBUG] Comprehensive drag element analysis:');

    // Check body state
    console.log('Body State:', {
        presentationActive: document.body.classList.contains('presentation-active'),
        modalOpen: document.body.classList.contains('modal-open'),
        classList: Array.from(document.body.classList)
    });

    // Check all drag-related elements
    const dragElements = [
        '#presentation-drag-buckets',
        '.drag-zone-left',
        '.drag-zone-right',
        '#drag-action-tooltip',
        '#drag-merge-indicator',
        '.drag-bucket'
    ];

    dragElements.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) {
            console.log(`${selector}: NOT FOUND`);
            return;
        }

        elements.forEach((el, index) => {
            const computed = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            const isVisible = computed.display !== 'none' &&
                              computed.visibility !== 'hidden' &&
                              parseFloat(computed.opacity) > 0;

            console.log(`${selector}${elements.length > 1 ? `[${index}]` : ''}:`, {
                display: computed.display,
                visibility: computed.visibility,
                opacity: computed.opacity,
                zIndex: computed.zIndex,
                position: computed.position,
                inlineStyle: el.style.cssText || 'none',
                classList: Array.from(el.classList),
                boundingRect: {
                    top: Math.round(rect.top),
                    left: Math.round(rect.left),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                },
                isEffectivelyVisible: isVisible,
                isInViewport: rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0
            });

            // If element appears visible when it shouldn't be
            if (isVisible && !document.body.classList.contains('presentation-active')) {
                console.warn(`⚠️ ${selector} IS VISIBLE but presentation is NOT active!`);
            }
        });
    });

    // Check parent presentation modal
    const presentationModal = document.getElementById('presentation-modal-overlay');
    if (presentationModal) {
        const modalComputed = window.getComputedStyle(presentationModal);
        console.log('Presentation Modal Container:', {
            display: modalComputed.display,
            visibility: modalComputed.visibility,
            hasActiveClass: presentationModal.classList.contains('active'),
            inlineStyle: presentationModal.style.cssText || 'none'
        });
    }

    console.groupEnd();
    return 'Drag debug complete. Check console for details.';
}

// Expose debug function globally for console access
if (typeof window !== 'undefined') {
    window.debugZIndex = debugZIndex;
    window.debugDragElements = debugDragElements;
}
