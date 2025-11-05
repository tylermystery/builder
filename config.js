// REPLACE THE ENTIRE CONTENTS of config.js

import { log } from './utils/debug.js';

export const CONSTANTS = {
    // This is your existing constants object
    AUTH_TOKEN_KEY: 'tmt_auth_token',
    DEFAULT_SHOP_ID: 'recZ3H42S4z380T5k',
    DETAIL_TYPES: {
        EVENT_NAME: 'eventName',
        DATE: 'date',
        GOALS: 'goals'
    },
    FIELD_NAMES: {
        NAME: 'Name',
        DESCRIPTION: 'Description',
        PRICE: 'Price',
        OPTIONS: 'Options',
        CATEGORIES: 'Categories',
        SUBCATEGORIES: 'Subcategories',
        MEDIA_TAGS: 'Media Tags',
        PARENT_ITEM: 'Parent Item',
        STATUS: 'Status',
        PRICING_TYPE: 'Pricing Type',
        HEADCOUNT_MIN: 'Headcount min',
        ICAL_URL: 'iCal URL',
        LEAD_TIME: 'Lead Time (days)'
    }
};

export const STRIPE_PUBLISHABLE_KEY = 'pk_live_51L0C5iHh28kEjv5qjW2tCi3kOOkT9V6fJ1sUqjV8s3j9k9PzGkYkF8sX8c8p2J8sX8c8p2J8sX8c8p2J8';
export const PUSHER_KEY = '236f480714e5001590b5';
export const PUSHER_CLUSTER = 'us3';

// --- THIS IS THE FIX ---
// Add the Cloudinary name as an export so other files can import it.
export const CLOUDINARY_CLOUD_NAME = 'daedqizre';
// --- END THE FIX ---
