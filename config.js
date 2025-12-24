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
export const REACTION_SCORES = {
    // Favorites (high positive)
    '🚀': 4, '🔥': 3, '🤩': 3, '❤️': 2, '👍': 2, '🎉': 3, '⭐': 2, '💯': 4,
    // Positive
    '😍': 3, '🥰': 3, '😊': 2, '🤗': 2, '👏': 2, '🙌': 3, '💪': 2, '✨': 2,
    '🌟': 2, '💖': 2, '💕': 2, '🎊': 3, '🏆': 4, '👌': 2, '🤝': 1, '💐': 2,
    // Excited
    '🥳': 3, '🎈': 2, '🎁': 2, '🎯': 2, '🎶': 1, '🕺': 2, '💃': 2, '🍾': 2,
    '🥂': 2, '🎪': 1, '🎠': 1, '🎡': 1, '🎢': 1, '🎭': 1,
    // Love
    '💛': 2, '💚': 2, '💙': 2, '💜': 2, '🖤': 1, '🤍': 1, '🤎': 1, '💗': 2,
    '💓': 2, '💝': 2, '💘': 2, '💌': 2, '😘': 2, '😻': 2, '🫶': 2,
    // Neutral
    '🤔': -1, '😐': 0, '🙂': 1, '😶': 0, '🤷': 0, '💭': 0, '📝': 0, '👀': 0,
    '🔍': 0, '⏳': 0, '📊': 0, '📈': 1, '🎲': 0, '🎴': 0, '🃏': 0, '⚖️': 0,
    // Negative
    '👎': -2, '😕': -1, '😟': -1, '😢': -2, '😞': -1, '💔': -2, '🙁': -1, '😔': -1,
    '😩': -2, '😫': -2, '🤦': -1, '🙅': -2, '❌': -3, '⛔': -3, '🚫': -3, '⚠️': -1,
    // Dislike
    '🤢': -3, '🤮': -4, '😤': -2, '😠': -2, '💢': -2, '🗑️': -4, '👻': -1, '💀': -3,
    '☠️': -3, '🚨': -2, '🆘': -3, '⛈️': -1, '🌧️': -1, '🥶': -1, '🥵': -1, '😱': -2,
    // Food & Drink (mostly neutral-positive)
    '🍕': 1, '🍔': 1, '🌮': 1, '🍣': 1, '🍜': 1, '🍰': 1, '🎂': 2, '🍦': 1,
    '🍩': 1, '🍪': 1, '☕': 1, '🍷': 1, '🍺': 1, '🥗': 1, '🍝': 1, '🥘': 1,
    // Nature (mostly positive)
    '🌸': 2, '🌺': 2, '🌻': 2, '🌹': 2, '🌷': 2, '🌴': 1, '🌊': 1, '🏔️': 1,
    '🌅': 2, '🌈': 2, '☀️': 2, '🌙': 1, '🦋': 1, '🐬': 1, '🦜': 1,
    // Activities (neutral-positive)
    '⚽': 1, '🏀': 1, '🎾': 1, '🏈': 1, '🎮': 1, '🎨': 1, '🎸': 1, '🎻': 1,
    '🎹': 1, '📸': 1, '🎥': 1, '🎬': 1, '🏊': 1, '🚴': 1, '🧘': 1, '🏋️': 1
};
export const CONSTANTS = {
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
    }
};
