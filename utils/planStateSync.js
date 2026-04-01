// FILE: utils/planStateSync.js
// Centralized plan state synchronization module
// Handles cross-view UI synchronization for event plan data

import { state, getRecordById, getAggregateReactions } from '../state.js';
import { log } from './debug.js';
import { CONSTANTS, computeDemocraticAverage, REACTION_SCORES } from '../config.js';
import { getRecordPrice } from '../utils.js';
import { requestVitalityRecalc } from '../vitality/vitalityEngine.js';

// Track pending updates to debounce rapid changes
let updateDebounceTimer = null;
const UPDATE_DEBOUNCE_MS = 100;

// Registered callbacks for different UI components
const syncCallbacks = {
    sidebar: null,
    presentation: null,
    catalog: null,
    hamburgerMenu: null,
    detailModal: null,
    wtfPlansPanel: null
};

// Debug mode flag for comprehensive logging - defaults to OFF for performance
let debugMode = false;

/**
 * Enable or disable debug mode for sync operations
 * @param {boolean} enabled - Whether debug mode is enabled
 */
export function setDebugMode(enabled) {
    debugMode = enabled;
    console.log(`[PlanSync DEBUG] Debug mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
}

/**
 * Log sync operation with debug prefix
 * @param {string} message - Message to log
 * @param {any} data - Optional data to include
 */
function debugLog(message, data = null) {
    if (debugMode) {
        if (data !== null) {
            console.log(`[PlanSync DEBUG] ${message}`, data);
        } else {
            console.log(`[PlanSync DEBUG] ${message}`);
        }
    }
    log('PlanSync', message);
}

/**
 * Register a callback for a specific UI component
 * @param {string} component - Component name ('sidebar', 'presentation', 'catalog', 'hamburgerMenu', 'detailModal')
 * @param {Function} callback - Callback function to invoke on sync events
 */
export function registerSyncCallback(component, callback) {
    if (syncCallbacks.hasOwnProperty(component)) {
        syncCallbacks[component] = callback;
        debugLog(`Registered callback for: ${component}`);
    } else {
        console.warn(`[PlanSync] Unknown component: ${component}`);
    }
}

/**
 * Unregister a callback for a specific UI component
 * @param {string} component - Component name
 */
export function unregisterSyncCallback(component) {
    if (syncCallbacks.hasOwnProperty(component)) {
        syncCallbacks[component] = null;
        debugLog(`Unregistered callback for: ${component}`);
    }
}

/**
 * Get current plan summary data for UI updates
 * @returns {Object} Plan summary with item count, total cost, date, etc.
 */
export function getPlanSummary() {
    const lockedItemsCount = state.cart.lockedItems.size;
    const ideasCount = state.cart.items.size;

    // Calculate total cost
    let totalCost = 0;
    let subtotal = 0;

    state.cart.lockedItems.forEach((itemInfo, recordId) => {
        const record = getRecordById(recordId);
        if (!record) return;

        // Get price - use getRecordPrice with selections/selectedOptionIndex to handle option price modifiers
        let unitPrice = itemInfo.overridePrice;
        if (unitPrice == null) {
            // Use selections if available, otherwise fall back to selectedOptionIndex
            const priceParam = (itemInfo.selections && Object.keys(itemInfo.selections).length > 0)
                ? itemInfo.selections
                : itemInfo.selectedOptionIndex;
            unitPrice = getRecordPrice(record, priceParam);
        }

        // Apply package discount if applicable
        if (itemInfo.packageId && state.session.activePackages) {
            const packageInfo = state.session.activePackages.get(itemInfo.packageId);
            if (packageInfo && packageInfo.discount > 0) {
                unitPrice = unitPrice * (1 - packageInfo.discount / 100);
            }
        }

        const quantity = parseInt(itemInfo.quantity) || 1;
        subtotal += unitPrice * quantity;
    });

    const amountReceived = state.session.user?.amountReceived || 0;
    totalCost = subtotal - amountReceived;

    // Get event date
    const eventDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME);
    const goals = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS);
    const guestCount = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT);

    // --- Phase 2: Plan-level reaction summary ---
    const allItemIds = [...new Set([
        ...Array.from(state.cart.lockedItems.keys()),
        ...Array.from(state.cart.items.keys())
    ])];
    const componentAverages = [];
    let planTotalReactions = 0;
    for (const itemId of allItemIds) {
        const agg = getAggregateReactions(itemId);
        if (!agg || agg.size === 0) continue;
        const { democraticAverage, totalReactions } = computeDemocraticAverage(agg);
        if (totalReactions > 0) {
            componentAverages.push(democraticAverage);
            planTotalReactions += totalReactions;
        }
    }
    let planReactionEmoji = '';
    let planReactionScore = 0;
    let planReactedItemCount = componentAverages.length;
    if (componentAverages.length > 0) {
        planReactionScore = componentAverages.reduce((s, a) => s + a, 0) / componentAverages.length;
        let closestDiff = Infinity;
        for (const [emoji, score] of Object.entries(REACTION_SCORES)) {
            const diff = Math.abs(score - planReactionScore);
            if (diff < closestDiff) { closestDiff = diff; planReactionEmoji = emoji; }
        }
    }
    const summary = {
        lockedItemsCount,
        ideasCount,
        totalItems: lockedItemsCount + ideasCount,
        subtotal,
        totalCost,
        amountReceived,
        eventDate,
        eventName,
        goals,
        guestCount,
        sessionId: state.session.id,
        isAuthenticated: state.session.user?.isAuthenticated || false,
        // Vitality data (available after first recalculation)
        planNetVitality: state.vitality ? state.vitality.planNet : 0,
        planNetEmoji: state.vitality ? state.vitality.planNetEmoji : '⚖️',
        // Phase 2: Reaction summary data
        planReactionEmoji,
        planReactionScore,
        planTotalReactions,
        planReactedItemCount,
    };

    debugLog('Plan summary generated:', summary);
    return summary;
}

/**
 * Sync the plan state across all registered UI components
 * @param {string} source - The source component triggering the sync (to avoid loops)
 * @param {string} changeType - Type of change ('itemAdded', 'itemRemoved', 'itemUpdated', 'dateChanged', 'detailsChanged', 'fullRefresh')
 * @param {Object} changeData - Optional data about what changed
 */
export function syncPlanState(source, changeType = 'fullRefresh', changeData = {}) {
    debugLog(`========== SYNC TRIGGERED ==========`);
    debugLog(`Source: ${source}, ChangeType: ${changeType}`, changeData);
    debugLog(`Current lockedItems size: ${state.cart.lockedItems.size}`);
    debugLog(`Current eventDetails size: ${state.eventDetails.combined.size}`);

    // Debounce rapid updates
    if (updateDebounceTimer) {
        clearTimeout(updateDebounceTimer);
    }

    updateDebounceTimer = setTimeout(() => {
        const summary = getPlanSummary();

        // Notify all registered callbacks except the source
        Object.entries(syncCallbacks).forEach(([component, callback]) => {
            if (callback && component !== source) {
                try {
                    debugLog(`Notifying component: ${component}`);
                    callback(changeType, summary, changeData);
                } catch (error) {
                    console.error(`[PlanSync] Error notifying ${component}:`, error);
                }
            }
        });

        // Also dispatch a custom DOM event for components that prefer event listeners
        const event = new CustomEvent('planStateChanged', {
            detail: {
                source,
                changeType,
                summary,
                changeData
            }
        });
        document.dispatchEvent(event);
        debugLog(`Dispatched planStateChanged event`);

        // Trigger vitality recalculation on every plan change
        requestVitalityRecalc();

        debugLog(`========== SYNC COMPLETE ==========`);
    }, UPDATE_DEBOUNCE_MS);
}

/**
 * Force immediate sync without debouncing
 * @param {string} source - The source component
 * @param {string} changeType - Type of change
 * @param {Object} changeData - Change data
 */
export function syncPlanStateImmediate(source, changeType = 'fullRefresh', changeData = {}) {
    debugLog(`========== IMMEDIATE SYNC ==========`);
    debugLog(`Source: ${source}, ChangeType: ${changeType}`, changeData);

    const summary = getPlanSummary();

    Object.entries(syncCallbacks).forEach(([component, callback]) => {
        if (callback && component !== source) {
            try {
                debugLog(`Notifying component: ${component}`);
                callback(changeType, summary, changeData);
            } catch (error) {
                console.error(`[PlanSync] Error notifying ${component}:`, error);
            }
        }
    });

    const event = new CustomEvent('planStateChanged', {
        detail: {
            source,
            changeType,
            summary,
            changeData
        }
    });
    document.dispatchEvent(event);

    // Trigger vitality recalculation immediately
    requestVitalityRecalc();

    debugLog(`========== IMMEDIATE SYNC COMPLETE ==========`);
}

/**
 * Update the mobile summary bar (hamburger menu area) with current plan data
 */
export function updateMobileSummaryBar() {
    debugLog('Updating mobile summary bar...');

    const summary = getPlanSummary();

    const itemCountEl = document.getElementById('mobile-bar-item-count');
    const totalCostEl = document.getElementById('mobile-bar-total-cost');

    if (itemCountEl) {
        const count = summary.lockedItemsCount;
        itemCountEl.textContent = `${count} item${count !== 1 ? 's' : ''}`;
        debugLog(`Updated mobile item count: ${count}`);
    } else {
        debugLog('WARNING: mobile-bar-item-count element not found');
    }

    if (totalCostEl) {
        totalCostEl.textContent = `$${summary.totalCost.toFixed(2)}`;
        debugLog(`Updated mobile total cost: $${summary.totalCost.toFixed(2)}`);
    } else {
        debugLog('WARNING: mobile-bar-total-cost element not found');
    }
}

/**
 * Initialize plan state sync system
 * Sets up event listeners and performs initial sync
 */
export function initializePlanStateSync() {
    debugLog('Initializing plan state sync system...');

    // Listen for sessionReady to do initial sync
    document.addEventListener('sessionReady', () => {
        debugLog('sessionReady event received - triggering full sync');
        syncPlanStateImmediate('system', 'sessionLoaded', {});
        updateMobileSummaryBar();
    });

    // Listen for planStateChanged to update mobile bar
    document.addEventListener('planStateChanged', (e) => {
        updateMobileSummaryBar();
    });

    debugLog('Plan state sync system initialized');
}

// Export a helper to get sync status for debugging
export function getSyncStatus() {
    return {
        registeredCallbacks: Object.keys(syncCallbacks).filter(k => syncCallbacks[k] !== null),
        debugMode,
        currentPlanSummary: getPlanSummary()
    };
}
