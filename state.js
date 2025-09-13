/**
 * state.js
 * This module acts as a centralized, in-memory database for the application's current state.
 */

import { calculatePrice, calculateDuration } from './utils.js';
import { CONSTANTS } from './config.js';

export const state = {
    // Stores all records fetched from the API
    records: {
        all: [],
        filtered: [],
        search: ''
    },
    // The user's current selections
    cart: {
        items: new Map(),
        lockedItems: [] // This will store the itinerary items once "locked in"
    },
    // Details about the event being planned
    eventDetails: {
        combined: new Map(),
        status: CONSTANTS.EVENT_STATUS.PLANNING
    }
};

/**
 * Adds an item to the cart.
 * @param {string} recordId
 * @param {string} quantity
 * @param {number|null} selectedOptionIndex
 */
export function addToCart(recordId, quantity = 1, selectedOptionIndex = null) {
    if (state.cart.items.has(recordId)) {
        state.cart.items.get(recordId).quantity += quantity;
    } else {
        state.cart.items.set(recordId, { quantity, selectedOptionIndex });
    }
    // TODO: Add notification or UI update logic
}

/**
 * Removes an item from the cart.
 * @param {string} recordId
 */
export function removeFromCart(recordId) {
    state.cart.items.delete(recordId);
    // TODO: Add UI update logic
}

/**
 * Locks in the current cart items and prepares the itinerary.
 * This function is critical for transitioning from the catalog view to the itinerary view.
 */
export function lockInItems() {
    state.cart.lockedItems = Array.from(state.cart.items.entries()).map(([recordId, itemInfo]) => {
        const record = state.records.all.find(r => r.id === recordId);
        return {
            id: recordId,
            name: record.fields[CONSTANTS.FIELD_NAMES.NAME],
            description: record.fields[CONSTANTS.FIELD_NAMES.DESCRIPTION],
            // New fields for Itinerary View
            cost: {
                perPersonCost: calculatePrice(record, itemInfo.selectedOptionIndex),
                bookingFee: 0 // Placeholder
            },
            status: 'Not Booked', // Placeholder status
            notes: '', // Placeholder for user notes
            address: record.fields[CONSTANTS.FIELD_NAMES.LOCATION],
            votes: {}, // New field for future collaborative voting
            // A simple start/end time, will be dynamically updated
            startTime: null,
            endTime: null
        };
    });
    // Clear the cart after locking in
    state.cart.items.clear();
}

// --- New Functions for Itinerary View ---

/**
 * Calculates the total estimated cost of all locked-in items.
 * @returns {number} The total cost.
 */
export function calculateTotalCost() {
    return state.cart.lockedItems.reduce((total, item) => {
        // Assume cost is per person for now, will expand later
        const perPersonCost = item.cost.perPersonCost || 0;
        const guestCount = parseInt(state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT), 10) || 1;
        return total + (perPersonCost * guestCount) + (item.cost.bookingFee || 0);
    }, 0);
}

/**
 * Calculates the total duration of all locked-in activities.
 * @returns {number} The total activity time in hours.
 */
export function calculateTotalActivityTime() {
    return state.cart.lockedItems.reduce((total, item) => {
        // Placeholder for now, will be updated to use item.endTime - item.startTime
        return total + (item.duration || 0);
    }, 0);
}

/**
 * Calculates the total estimated travel time between all locked-in items.
 * @returns {number} The total travel time in hours.
 */
export function calculateTotalTravelTime() {
    // Placeholder, as this requires the mapping API
    return 0;
}

/**
 * Checks for scheduling alerts or issues.
 * @returns {Array} A list of alert messages.
 */
export function getAlerts() {
    const alerts = [];
    // Placeholder for now, will implement logic to check for overlaps and insufficient travel time
    return alerts;
}
