// FILE: config.js
export const STRIPE_PUBLISHABLE_KEY = 'pk_live_opXi3umu9588LiitWvYhdk9H';
export const CLOUDINARY_CLOUD_NAME = 'daedqizre';
export const RECORDS_PER_LOAD = 10;
export const EMOJI_REACTIONS = ['🚀', '🔥', '🤩', '❤️', '👍', '🤔', '👎', '🤢'];
export const REACTION_SCORES = {
    '🚀': 4, '🔥': 3, '🤩': 2, '❤️': 1, '👍': 1,
    '🤔': -1, '👎': -2, '🤢': -3
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
        MEDIA_TAGS: 'Media Tags',
        CATEGORIES: 'Categories',
        SUBCATEGORIES: 'Subcategories',
        ICAL_URL: 'iCal URL',
        LEAD_TIME: 'Lead Time (days)',
        COLLABORATOR_IDS_FIELD: 'CollaboratorIDs',
        
        // Session Chat Fields
        SESSION_ID_FIELD: 'SessionID',
        TIMESTAMP_FIELD: 'Timestamp',
        SESSION_ID_ROLLUP_FIELD: 'SessionID_Rollup',

        // Item Chat Fields (to mirror session chat)
        ITEM_ID_FIELD: 'ItemID',
        ITEM_ID_ROLLUP_FIELD: 'ItemID_Rollup',
    },
    PRICING_TYPES: {
        PER_GUEST: 'per guest',
    },
    DETAIL_TYPES: {
        EVENT_NAME: 'eventName',
        DATE: 'date',
        GUEST_COUNT: 'guestCount',
        GOALS: 'goals',
        SPECIAL_REQUESTS: 'specialRequests',
    }
};
