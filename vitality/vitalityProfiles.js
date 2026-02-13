// FILE: vitality/vitalityProfiles.js
// Maps Airtable Category labels to default Vitality Profiles.
// Each profile has four realm scores (float, -1.0 to 1.0):
//   cosmological (🌌): Universal/cosmic-level impact
//   planetary (🌍): Earth/environmental impact
//   collective (👥): Community/social impact
//   internal (🍄): Personal/local wellbeing impact

/**
 * Default Vitality Profiles keyed by Airtable Category label.
 * Scores represent the typical regenerative (+) or extractive (-) tendency
 * of items in that category across each realm.
 */
export const VITALITY_PROFILES = {
    // --- Primary Airtable Categories ---
    'Activities': {
        cosmological: 0.1,
        planetary: -0.1,
        collective: 0.7,
        internal: 0.8
    },
    'Food & Drink': {
        cosmological: 0.0,
        planetary: -0.3,
        collective: 0.5,
        internal: 0.6
    },
    'Venues': {
        cosmological: -0.05,
        planetary: -0.4,
        collective: 0.4,
        internal: 0.3
    },
    'Extras': {
        cosmological: 0.0,
        planetary: -0.2,
        collective: 0.3,
        internal: 0.4
    },

    // --- Subcategory / Expanded Profiles ---
    // These can override the parent category when a more specific match is found.
    'Live Music': {
        cosmological: 0.15,
        planetary: -0.05,
        collective: 0.85,
        internal: 0.9
    },
    'Catering': {
        cosmological: 0.0,
        planetary: -0.35,
        collective: 0.6,
        internal: 0.7
    },
    'Photography': {
        cosmological: 0.05,
        planetary: -0.05,
        collective: 0.6,
        internal: 0.5
    },
    'Transportation': {
        cosmological: -0.1,
        planetary: -0.6,
        collective: 0.3,
        internal: 0.2
    },
    'Decorations': {
        cosmological: 0.0,
        planetary: -0.5,
        collective: 0.4,
        internal: 0.5
    },
    'Entertainment': {
        cosmological: 0.1,
        planetary: -0.1,
        collective: 0.75,
        internal: 0.85
    },
    'Wellness': {
        cosmological: 0.2,
        planetary: 0.1,
        collective: 0.5,
        internal: 0.9
    },
    'Education': {
        cosmological: 0.3,
        planetary: 0.2,
        collective: 0.8,
        internal: 0.7
    },
    'Outdoor': {
        cosmological: 0.15,
        planetary: 0.3,
        collective: 0.6,
        internal: 0.8
    },
    'Technology': {
        cosmological: 0.05,
        planetary: -0.4,
        collective: 0.4,
        internal: 0.3
    },
    'Local Food': {
        cosmological: 0.1,
        planetary: 0.4,
        collective: 0.7,
        internal: 0.8
    },
    'Solar': {
        cosmological: 0.3,
        planetary: 0.8,
        collective: 0.5,
        internal: 0.3
    },
    'Recycling': {
        cosmological: 0.2,
        planetary: 0.7,
        collective: 0.6,
        internal: 0.2
    },
    'Teaching': {
        cosmological: 0.4,
        planetary: 0.2,
        collective: 0.9,
        internal: 0.6
    },
    'Waste': {
        cosmological: -0.3,
        planetary: -0.8,
        collective: -0.4,
        internal: -0.2
    }
};

/**
 * Fallback profile for items that don't match any known category.
 */
export const DEFAULT_PROFILE = {
    cosmological: 0.0,
    planetary: -0.1,
    collective: 0.3,
    internal: 0.3
};

/**
 * Time scope presets (in hours) that the user can select.
 * Determines how far into the future the vitality integral is evaluated.
 */
export const TIME_SCOPES = [
    { label: '1 Hour',    hours: 1 },
    { label: '1 Day',     hours: 24 },
    { label: '1 Week',    hours: 168 },
    { label: '1 Month',   hours: 720 },
    { label: '1 Year',    hours: 8760 },
    { label: '10 Years',  hours: 87600 },
    { label: '100 Years', hours: 876000 }
];

/**
 * Default time scope index (points to '1 Year' by default).
 */
export const DEFAULT_TIME_SCOPE_INDEX = 4;

/**
 * Realm metadata for UI display.
 */
export const REALM_META = {
    cosmological: { emoji: '🌌', label: 'Cosmological', color: '#6366f1' },
    planetary:    { emoji: '🌍', label: 'Planetary',    color: '#22c55e' },
    collective:   { emoji: '👥', label: 'Collective',   color: '#f59e0b' },
    internal:     { emoji: '🍄', label: 'Internal',     color: '#ec4899' }
};

/**
 * Net Emoji thresholds: maps a vitality score range to an emoji.
 * Ordered from most negative to most positive.
 */
export const NET_EMOJI_SCALE = [
    { min: -Infinity, max: -0.6, emoji: '💀', label: 'Critical Drain' },
    { min: -0.6,      max: -0.3, emoji: '🥀', label: 'Significant Drain' },
    { min: -0.3,      max: -0.1, emoji: '🍂', label: 'Mild Drain' },
    { min: -0.1,      max:  0.1, emoji: '⚖️', label: 'Neutral' },
    { min:  0.1,      max:  0.3, emoji: '🌱', label: 'Mild Growth' },
    { min:  0.3,      max:  0.6, emoji: '🌿', label: 'Strong Growth' },
    { min:  0.6,      max:  0.85, emoji: '🌳', label: 'Thriving' },
    { min:  0.85,     max:  Infinity, emoji: '✨', label: 'Universal Vitality' }
];

/**
 * Synergy pair definitions.
 * When two items from these categories coexist in a plan, they create a synergy bonus.
 * Each pair has a multiplier (>1.0 means the vitality is amplified).
 */
export const SYNERGY_PAIRS = [
    { a: 'Solar',      b: 'Local Food',   multiplier: 1.4, label: 'Sustainable Harvest' },
    { a: 'Education',  b: 'Outdoor',      multiplier: 1.3, label: 'Nature Learning' },
    { a: 'Teaching',   b: 'Wellness',     multiplier: 1.3, label: 'Mindful Growth' },
    { a: 'Recycling',  b: 'Local Food',   multiplier: 1.25, label: 'Circular Nourishment' },
    { a: 'Live Music', b: 'Local Food',   multiplier: 1.2, label: 'Community Feast' },
    { a: 'Outdoor',    b: 'Wellness',     multiplier: 1.25, label: 'Nature Healing' },
    { a: 'Solar',      b: 'Technology',   multiplier: 1.2, label: 'Clean Tech' },
    { a: 'Activities', b: 'Food & Drink', multiplier: 1.1, label: 'Shared Experience' },
    { a: 'Education',  b: 'Technology',   multiplier: 1.15, label: 'Digital Learning' }
];
