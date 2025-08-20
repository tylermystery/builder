/*
 * Version: 1.0.0
 * Last Modified: 2025-08-17
 *
 * Changelog:
 *
 * v1.0.0 - 2025-08-17
 * - Initial versioning and changelog added.
 [cite_start]*/ [cite: 401]
export const CLOUDINARY_CLOUD_NAME = 'daedqizre';
export const RECORDS_PER_LOAD = 10;
[cite_start]export const EMOJI_REACTIONS = ['🚀', '🔥', '🤩', '❤️', '👍', '🤔', '👎', '🤢']; [cite: 402]
[cite_start]export const REACTION_SCORES = { [cite: 403]
    '🚀': 4, '🔥': 3, '🤩': 2, '❤️': 1, '👍': 1,
    '🤔': -1, '👎': -2, '🤢': -3
};
[cite_start]export const CONSTANTS = { [cite: 404]
    FIELD_NAMES: {
        NAME: 'Name',
        PRICE: 'Price',
        DESCRIPTION: 'Description',
        OPTIONS: 'Options',
        STATUS: 'Status',
        DURATION: 'Duration (hours)',
        PRICING_TYPE: 'Pricing Type',
        HEADCOUNT_MIN: 'Headcount min',
        MEDIA_TAGS: 'Media Tags',
    },
  
    [cite_start]PRICING_TYPES: { [cite: 405]
        PER_GUEST: 'per guest',
    },
    DETAIL_TYPES: {
        EVENT_NAME: 'eventName',
        DATE: 'date',
        GUEST_COUNT: 'guestCount',
        LOCATION: 'location',
        SPECIAL_REQUESTS: 'specialRequests',
    }
};
