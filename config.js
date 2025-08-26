/*
 * Version: 1.2.0
 * Last Modified: 2025-08-26
 *
 * Changelog:
 *
 * v1.2.0 - 2025-08-26
 * - Added ICAL_URL field name constant.
 *
 * v1.1.1 - 2025-08-22
 * - Added CATEGORIES and SUBCATEGORIES constants.
 *
 * v1.1.0 - 2025-08-21
 * - Added GOALS constant for the new header field.
 * - Removed obsolete LOCATION constant.
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
        PARENT_ITEM: 'Parent Item',
        STATUS: 'Status',
        DURATION: 'Duration (hours)',
        PRICING_TYPE: 'Pricing Type',
        HEADCOUNT_MIN: 'Headcount min',
      
        MEDIA_TAGS: 'Media Tags',
        CATEGORIES: 'Categories',
        SUBCATEGORIES: 'Subcategories',
        ICAL_URL: 'iCal URL',
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
