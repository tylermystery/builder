/*
 * Version: 1.0.0
 * Last Modified: 2025-08-17
 *
 * Changelog:
 *
 * v1.0.0 - 2025-08-17
 * - Initial versioning and changelog added.
 */

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
        STATUS: 'Status',
        DURATION: 'Duration (hours)',
        PRICING_TYPE: 'Pricing Type',
        HEADCOUNT_MIN: 'Headcount min',
        MEDIA_TAGS: 'Media Tags',
    },
    PRICING_TYPES: {
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
