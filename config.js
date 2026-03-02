// FILE: config.js
export const STRIPE_PUBLISHABLE_KEY = 'pk_live_opXi3umu9588LiitWvYhdk9H';
export const CLOUDINARY_CLOUD_NAME = 'daedqizre';
export const RECORDS_PER_LOAD = 10;
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
    '🎹': 1.46, '📸': 1.51, '🎥': 1.44, '🎬': 1.49, '🏊': 1.38, '🚴': 1.41, '🧘': 1.53, '🏋️': 1.46
};
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
        GUEST_COUNT: 'guestCount',
        GOALS: 'goals',
        SPECIAL_REQUESTS: 'specialRequests',
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
            console.log(`${name} (${selector}):`, {
                zIndex: computed.zIndex,
                inlineZIndex: el.style.zIndex || 'none',
                display: computed.display,
                position: computed.position,
                isActive,
                visible: computed.display !== 'none' && computed.visibility !== 'hidden'
            });
        }
    });

    console.groupEnd();
    return 'Z-index debug complete. Check console for details.';
}

// Expose debug function globally for console access
if (typeof window !== 'undefined') {
    window.debugZIndex = debugZIndex;
}
