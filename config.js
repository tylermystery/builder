/*
 * Version: 1.3.0
 * Last Modified: 2025-08-28
 *
 * Changelog:
 *
 * v1.3.0 - 2025-08-28
 * - Added Stripe Publishable Key constant.
 *
 * v1.2.1 - 2025-08-26
 * - Added LEAD_TIME field name constant.
 */

// ACTION REQUIRED: Replace with your actual Stripe Publishable Key
export const STRIPE_PUBLISHABLE_KEY = 'pk_test_mK3MLvoZurxcqIQHyWB7eqlY';

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
