// REPLACE THE ENTIRE CONTENTS of events.js
console.log('[MODULE DEBUG] events.js module starting to load...', performance.now().toFixed(2) + 'ms');

import { state, setState, invalidateRecordsIndex } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import * as api from './api.js';
import { applyFiltersAndSort } from './filtering.js';
import { log, setDebugMode } from './utils/debug.js';
import { AVAILABILITY_STATUS, getDayStatus, checkAvailability, getRangeStatus, getPlanDayStatusSync, logBusyTimeSummary } from './availability.js';
import { debounce, updateUrl, loadFlatpickr, getTempLikes, setTempLikes, getTempRsvps, setTempRsvps, getEffectiveMinQuantity, calculateDynamicPackagePrice, preloadStripe, getShopUrlParam, getTimeUnitMinutes, computeEndFromStartDuration } from './utils.js';
import { sendMessage, getCurrentUser, initializeSessionChat, initializeRecentChatsListeners, updateCurrentSessionName, toggleRecentChats, addPlanEventToHistory } from './chat.js';
import { publishItemToPublicLayer } from './components/publicCatalog.js';
import { closeRsvpSignupPopup, showRsvpSignupPopup } from './components/rsvpSignupPopup.js';
import { showItineraryModal, setupItineraryEventListeners } from './components/itinerary.js';
import { updateMobileBarAvailability } from './ui.js';
import { showUserModal, startEmailSignIn, generateAuthChannelId, listenForEmailSignIn } from './auth.js';
import { addEnergy, updateProgress, refreshAtmosphere } from './components/backgroundEngine.js';
import { showReceiptModal } from './components/receipt.js';
import { showProjectsPanel, hideProjectsPanel } from './components/projectsDashboard.js';
import { initializeProjectSelector, wasLongPress, resetLongPress } from './components/projectSelector.js';
import { broadcastItemAdded, broadcastItemRemoved } from './utils/realtimeUpdates.js';
import { showWtfPlansPanel, initializeWtfPlansPanel } from './components/wtfPlansPanel.js';
import { syncPlanState, initializePlanStateSync } from './utils/planStateSync.js';
import { initializeUnifiedChatPanel, showUnifiedChatPanel, toggleUnifiedChatPanel, setUCPGetCurrentUser, setUCPSendMessage } from './components/unifiedChatPanel.js';
import { createPlanInstanceId, createPlanInstanceRecord, cloneItemInfoForAnotherInstance, getCatalogRecordId, getPlanInstancesForCatalog } from './utils/planInstances.js';

console.log('[MODULE DEBUG] events.js imports resolved successfully.', performance.now().toFixed(2) + 'ms');

let mainDatePicker = null;
let saveTimeout = null;
let saveShareBtn = null;
let aiSearchController = null;

export function getMainDatePicker() {
    return mainDatePicker;
}

/**
 * Handler for when Union Machine Works is added to the plan
 * Adjusts all items back to their last attempted quantity (if below minimum)
 */
function handleUmwAddition() {
    let adjustedItems = [];

    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;

        // Skip UMW itself
        if (record.fields.Name && record.fields.Name.includes("Union Machine Works")) continue;

        const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        const lastAttempted = itemInfo.lastAttemptedQuantity || itemInfo.quantity;

        // If this item was forced to minimum and user wanted less, restore their original request
        if (airtableMin > 1 && itemInfo.quantity === airtableMin && lastAttempted < airtableMin) {
            itemInfo.quantity = lastAttempted;
            state.cart.lockedItems.set(recordId, itemInfo);
            adjustedItems.push(record.fields.Name);
        }
    }

    if (adjustedItems.length > 0) {
        ui.showEventPlanNotification(`Headcounts reduced to quantity requested per Union Machine Works inclusion in plan.`);
        // Update UI
        ui.updateEventPlanSection();
        ui.updateTotalCost();
    }
}

/**
 * Handler for when Union Machine Works is removed from the plan
 * Adjusts all items to meet minimum requirements
 */
function handleUmwRemoval() {
    let adjustedItems = [];

    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;

        const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;

        // If this item is now below minimum, adjust it
        if (airtableMin > 1 && itemInfo.quantity < airtableMin) {
            // Store current as last attempted before adjusting
            itemInfo.lastAttemptedQuantity = itemInfo.quantity;
            itemInfo.quantity = airtableMin;
            state.cart.lockedItems.set(recordId, itemInfo);
            adjustedItems.push(record.fields.Name);
        }
    }

    if (adjustedItems.length > 0) {
        ui.showEventPlanNotification(`Headcount adjusted to min per Union Machine Works removal.`);
        // Update UI
        ui.updateEventPlanSection();
        ui.updateTotalCost();
    }
}

// Image cache captured at init so the pagination observer and "Load more"
// fallback button can request additional batches without threading the
// reference through every call site.
let catalogImageCache = null;
let catalogPaginationWired = false;

function hasMoreCatalogRecords() {
    return state.ui.recordsCurrentlyDisplayed < state.records.filtered.length;
}

// True when the bottom sentinel is within ~300px of the viewport, i.e. the
// current batch did not fill the screen and more should be loaded.
function isCatalogSentinelNear() {
    const sentinel = document.getElementById('catalog-sentinel');
    if (!sentinel) return false;
    const rect = sentinel.getBoundingClientRect();
    return rect.top <= window.innerHeight + 300;
}

// Keep the visible "Load more" fallback button in sync with pagination state.
function updateLoadMoreUI() {
    const btn = document.getElementById('load-more-btn');
    if (!btn) return;
    if (!hasMoreCatalogRecords()) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = '';
    btn.disabled = state.ui.isLoadingMore;
    btn.textContent = state.ui.isLoadingMore ? 'Loading…' : 'Load more';
}

function loadMoreRecords(imageCache) {
    imageCache = imageCache || catalogImageCache;
    if (state.ui.isLoadingMore) return;
    if (!hasMoreCatalogRecords()) {
        updateLoadMoreUI();
        return;
    }

    // Skip past any batch that contains only Grouping records — they are
    // rendered as carousels in the initial pass, not in load-more batches.
    // Previously a grouping-only batch advanced the counter but never armed
    // the next batch, stalling pagination; here we keep advancing until we
    // find a batch with real items to render (or reach the end).
    let start = state.ui.recordsCurrentlyDisplayed;
    let end = start;
    let recordsToLoad = [];
    while (end < state.records.filtered.length && recordsToLoad.length === 0) {
        end = Math.min(start + RECORDS_PER_LOAD, state.records.filtered.length);
        recordsToLoad = state.records.filtered
            .slice(start, end)
            .filter(r => r.fields['Item Type'] !== 'Grouping');
        if (recordsToLoad.length === 0) start = end;
    }

    if (recordsToLoad.length === 0) {
        state.ui.recordsCurrentlyDisplayed = end;
        updateLoadMoreUI();
        return;
    }

    state.ui.isLoadingMore = true;
    updateLoadMoreUI();
    ui.renderRecords(recordsToLoad, imageCache, true).then(() => {
        state.ui.recordsCurrentlyDisplayed = end;
        state.ui.isLoadingMore = false;
        updateLoadMoreUI();
        // Top-up: if the sentinel is still near the viewport (the batch did
        // not fill the screen), keep loading until it does or records run out.
        if (hasMoreCatalogRecords() && isCatalogSentinelNear()) {
            loadMoreRecords(imageCache);
        }
    });
}

// Wire up reliable catalog pagination: an IntersectionObserver sentinel that
// loads the next batch as it nears the viewport (and tops up when the first
// batch underfills the screen), plus a visible "Load more" fallback button for
// accessibility and cases where no scroll occurs.
function setupCatalogPagination(imageCache) {
    catalogImageCache = imageCache;

    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn && !loadMoreBtn._wired) {
        loadMoreBtn._wired = true;
        loadMoreBtn.addEventListener('click', () => loadMoreRecords(catalogImageCache));
    }

    // Only attach the observer and global listener once per page, even if
    // listener initialization runs again.
    if (catalogPaginationWired) return;
    catalogPaginationWired = true;

    const sentinel = document.getElementById('catalog-sentinel');
    if (sentinel && 'IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            if (entries.some(e => e.isIntersecting)) {
                loadMoreRecords(catalogImageCache);
            }
        }, { rootMargin: '300px 0px' });
        observer.observe(sentinel);
    }

    // After each (re)filter render completes, refresh the button and top up if
    // the initial batch did not fill the viewport. filtering.js dispatches this
    // once recordsCurrentlyDisplayed reflects the initial render.
    window.addEventListener('catalog:rendered', () => {
        updateLoadMoreUI();
        if (hasMoreCatalogRecords() && isCatalogSentinelNear() && !state.ui.isLoadingMore) {
            loadMoreRecords(catalogImageCache);
        }
    });
}

export function updateSaveShareButton() {
    if (!saveShareBtn) return;
    switch (state.ui.saveState) {
        case 'MODIFIED':
            saveShareBtn.textContent = 'Changes pending...';
            saveShareBtn.disabled = true;
            saveShareBtn.dataset.tooltip = 'Saving your changes automatically...';
            break;
        case 'SAVING':
            saveShareBtn.textContent = '⚙️ Saving...';
            saveShareBtn.disabled = true;
            saveShareBtn.dataset.tooltip = 'Saving your changes...';
            break;
        case 'SAVED':
            saveShareBtn.textContent = '🔗 Copy Link';
            const hasContent = state.cart.items.size > 0 || state.cart.lockedItems.size > 0 || state.eventDetails.combined.size > 0;
            saveShareBtn.disabled = !hasContent;
            saveShareBtn.dataset.tooltip = !hasContent ? 'Add items or details to enable sharing' : 'Copy a shareable link to this plan';
            break;
    }
}

export function triggerSave() {
    if (state.ui.isInitializing) return;

    // Universal "the plan changed" chokepoint. Re-deriving the background here means plan
    // mutations that never called updateProgress (task completion, payments, chat-created
    // tasks) still move the journey. It is idempotent, so the extra call is free.
    refreshAtmosphere('triggerSave');

    clearTimeout(saveTimeout);
    state.ui.saveState = 'MODIFIED';
    updateSaveShareButton();
    saveTimeout = setTimeout(async () => {
        state.ui.saveState = 'SAVING';
        updateSaveShareButton();
        const success = await api.saveSessionToAirtable();
        if (success) {
            state.ui.saveState = 'SAVED';
            updateSaveShareButton();
        }
    }, 1500);
}

// Reflect a single RSVP selection across a Yes / Maybe / No button group without
// a full re-render. Used for the guest path, where there is no server-returned
// record to rebuild the modal from. Passing a null type clears every button.
function applyRsvpButtonState(clickedBtn, activeType) {
    const labels = {
        yes:   { on: 'Going ✅',    off: 'Yes' },
        maybe: { on: 'Maybe ❓',    off: 'Maybe' },
        no:    { on: "Can't Go ❌", off: 'No' },
    };
    const group = clickedBtn.closest('.rsvp-button-group');
    const buttons = group ? group.querySelectorAll('.rsvp-btn') : [clickedBtn];
    buttons.forEach(btn => {
        const type = btn.dataset.rsvpType;
        const isActive = !!activeType && type === activeType;
        btn.classList.toggle('active', isActive);
        if (labels[type]) btn.textContent = isActive ? labels[type].on : labels[type].off;
        btn.disabled = false;
    });
}

// Add an event to the plan (the "Event Plan", i.e. state.cart.lockedItems) as a
// lightweight side effect of an RSVP. This intentionally uses a minimal itemInfo
// rather than the full Add-to-Plan modal extraction (options/scheduling), which
// does not apply to a quick RSVP. No-op if the event is already in the plan.
export async function autoAddEventToPlan(record, partyQty = 1, rsvpType = null) {
    if (!record || !record.id) return;
    const recordId = record.id;
    const qty = (Number.isFinite(partyQty) && partyQty > 0) ? partyQty : 1;
    if (state.cart.lockedItems.has(recordId)) {
        const existing = state.cart.lockedItems.get(recordId) || {};
        existing.quantity = qty;
        existing.lastAttemptedQuantity = qty;
        if (rsvpType === 'yes' || rsvpType === 'maybe') existing.rsvpType = rsvpType;
        state.cart.lockedItems.set(recordId, existing);
        try {
            await ui.updateEventPlanSection();
            ui.updateTotalCost();
        } catch (err) {
            log('Events', `autoAddEventToPlan quantity sync issue: ${err.message}`);
        }
        syncPlanState('catalog', 'itemUpdated', { recordId, itemName: record.fields?.Name || 'Event', quantity: qty });
        triggerSave();
        return;
    }

    const itemInfo = { quantity: qty, selectedOptionIndex: 0, selections: {}, note: '', lastAttemptedQuantity: qty };
    if (rsvpType === 'yes' || rsvpType === 'maybe') itemInfo.rsvpType = rsvpType;
    state.cart.lockedItems.set(recordId, itemInfo);
    state.cart.items.delete(recordId);

    try {
        ui.updateCardIcon(recordId);
        ui.updateCardButtonText(recordId, true);
        await ui.updateIdeasCarousel();
        await ui.updateEventPlanSection();
        ui.updateTotalCost();
        await ui.updateLockedItemStatusIcons();
    } catch (err) {
        log('Events', `autoAddEventToPlan UI sync issue: ${err.message}`);
    }

    syncPlanState('catalog', 'itemAdded', { recordId, itemName: record.fields?.Name || 'Event' });
    triggerSave();
}

export async function updateAllCardAvailabilityIcons() {
    const allAvailabilityBtns = document.querySelectorAll('.availability-btn');

    if (!mainDatePicker || mainDatePicker.selectedDates.length < 2) {
        document.querySelectorAll('.availability-btn').forEach(icon => {
            if (icon._tippy) icon._tippy.destroy();
            icon.title = 'Select a date range to check availability';
            icon.textContent = '📅';
        });
        return;
    }
    const startDate = mainDatePicker.selectedDates[0];
    const requestedEnd = mainDatePicker.selectedDates[1];

    const cards = document.querySelectorAll('.event-card');

    // Build a Map for O(1) record lookups instead of O(n) .find() per card
    const recordMap = new Map(state.records.all.map(r => [r.id, r]));

    // Collect all card data for parallel processing
    const cardDataList = [];
    for (const card of cards) {
        const recordId = card.dataset.recordId;
        const record = recordMap.get(recordId);
        if (!record) continue;
        const icon = card.querySelector('.availability-btn');
        if (icon) {
            cardDataList.push({ record, icon });
        }
    }

    // Fetch all calendars in parallel (batched) instead of one-at-a-time
    const BATCH_SIZE = 5;
    for (let i = 0; i < cardDataList.length; i += BATCH_SIZE) {
        const batch = cardDataList.slice(i, i + BATCH_SIZE);
        const busyTimesResults = await Promise.all(
            batch.map(({ record }) => api.fetchCalendarForRecord(record))
        );

        busyTimesResults.forEach((busyTimes, idx) => {
            const { record, icon } = batch[idx];
            const rangeStatus = getRangeStatus(startDate, requestedEnd, record, busyTimes);

            if (icon._tippy) icon._tippy.destroy();
            let statusIcon;
            switch (rangeStatus.status) {
                case AVAILABILITY_STATUS.FULL: statusIcon = '✅'; break;
                case AVAILABILITY_STATUS.PARTIAL: statusIcon = '🟠'; break;
                case AVAILABILITY_STATUS.NONE: statusIcon = '❌'; break;
                default: statusIcon = '📅';
            }

            const dateRangeString = `${startDate.toLocaleDateString()} - ${requestedEnd.toLocaleDateString()}`;
            const tooltipContent = `<div style="text-align: left;"><strong>${dateRangeString}</strong><hr style="margin: 2px 0 5px;"><span>${statusIcon} ${record.fields.Name}: ${rangeStatus.reason}</span></div>`;
            tippy(icon, { content: tooltipContent, allowHTML: true, placement: 'top', arrow: true });
            icon.title = rangeStatus.reason;
            icon.textContent = statusIcon;
        });
    }
}

async function handlePaymentFormSubmit(event) {
    event.preventDefault();
    log('Events', 'Payment form submitted.');

    const submitBtn = document.getElementById('payment-submit-btn');
    const buttonText = submitBtn.querySelector('.button-text');
    const spinner = submitBtn.querySelector('.spinner');
    const cardErrors = document.getElementById('card-errors');
    cardErrors.textContent = '';

    // Free-registration checkout: a $0 plan has nothing to charge. Skip Stripe
    // entirely and register the visitor for the events in their plan.
    if (ui.getCheckoutIsFreeRegistration && ui.getCheckoutIsFreeRegistration()) {
        return handleFreeRegistration(submitBtn, buttonText, spinner);
    }

    submitBtn.disabled = true;
    buttonText.style.display = 'none';
    spinner.style.display = 'inline';

    const { stripe, elements } = ui.getStripeContext();

    console.log('[ACH DEBUG] handlePaymentFormSubmit called.', {
        stripeLoaded: !!stripe,
        elementsLoaded: !!elements,
        currentPaymentType: ui.getCurrentPaymentType ? ui.getCurrentPaymentType() : 'unknown'
    });

    if (!stripe || !elements) {
        cardErrors.textContent = 'Payment system is not initialized. Please close and reopen the checkout window.';
        submitBtn.disabled = false;
        buttonText.style.display = 'inline';
        spinner.style.display = 'none';
        return;
    }

    try {
        const customerName = document.getElementById('customer-name').value.trim();
        const customerEmail = document.getElementById('customer-email').value.trim();

        // Always collect a name + email so a receipt can be sent (and the merchant
        // knows who paid). The fields are marked required, but guard explicitly in
        // case the form is submitted programmatically.
        if (!customerName || !customerEmail) {
            cardErrors.textContent = 'Please enter your name and email so we can send your receipt.';
            (!customerName
                ? document.getElementById('customer-name')
                : document.getElementById('customer-email'))?.focus();
            submitBtn.disabled = false;
            buttonText.style.display = 'inline';
            spinner.style.display = 'none';
            return;
        }

        // Persist receipt recipients on the PaymentIntent before charging. The
        // webhook uses these fields to email both the purchaser and the store, so
        // do not accept payment until the receipt details are synchronized.
        const receiptDetailsSynced = await ui.syncCheckoutCustomerDetails(customerName, customerEmail);
        if (!receiptDetailsSynced) {
            throw new Error('We could not prepare your emailed receipt. Please check your connection and try again.');
        }

        // The webhook builds the receipt from the saved session, so persist the
        // latest cart quantities, RSVP labels, and item schedule before charging.
        try { await api.saveSessionToAirtable(); }
        catch (e) { console.warn('[CHECKOUT] pre-payment session save skipped:', e.message); }

        // Build return_url preserving the session param so the app reloads correctly after redirect
        const returnUrl = new URL(window.location.href);
        // Clear any old Stripe/payment params but keep session
        returnUrl.searchParams.delete('payment_intent');
        returnUrl.searchParams.delete('payment_intent_client_secret');
        returnUrl.searchParams.delete('redirect_status');
        returnUrl.searchParams.delete('payment_success');
        returnUrl.searchParams.set('payment_success', 'true');
        const returnUrlString = returnUrl.toString();

        console.log('[ACH DEBUG] Calling stripe.confirmPayment with:', {
            return_url: returnUrlString,
            customerName,
            customerEmail,
            redirect: 'if_required'
        });

        // Save payment context to localStorage before confirmPayment.
        // If ACH triggers a redirect (Financial Connections), the await never resolves,
        // so the return handler needs this context to complete the payment recording.
        try {
            const pendingPaymentCtx = {
                sessionId: state.session.id,
                timestamp: Date.now(),
                customerName,
                customerEmail,
                paymentType: ui.getCurrentPaymentType ? ui.getCurrentPaymentType() : 'unknown'
            };
            // Save chip-in context if applicable
            const chipInCtx = ui.getCheckoutChipInContext();
            if (chipInCtx.chipInAmount > 0 && chipInCtx.scope) {
                pendingPaymentCtx.chipIn = {
                    amount: chipInCtx.chipInAmount,
                    itemId: chipInCtx.scope.itemId,
                    itemName: chipInCtx.scope.itemName || 'Item',
                    goalAmount: chipInCtx.scope.price || 0,
                    storeId: state.shop?.id || state.session?.storeId || ''
                };
            }
            localStorage.setItem('pendingPaymentContext', JSON.stringify(pendingPaymentCtx));
            console.log('[ACH DEBUG] Saved pending payment context to localStorage.');
        } catch (e) {
            console.warn('[ACH DEBUG] Could not save pending payment context:', e);
        }

        const confirmStartTime = Date.now();
        const { error, paymentIntent } = await stripe.confirmPayment({
            elements,
            confirmParams: {
                return_url: returnUrlString,
                payment_method_data: {
                    billing_details: {
                        name: customerName,
                        email: customerEmail,
                    },
                },
            },
            redirect: 'if_required',
        });
        const confirmDuration = Date.now() - confirmStartTime;

        console.log('[ACH DEBUG] stripe.confirmPayment returned after', confirmDuration, 'ms:', {
            hasError: !!error,
            errorType: error?.type,
            errorCode: error?.code,
            errorMessage: error?.message,
            paymentIntentStatus: paymentIntent?.status,
            paymentIntentId: paymentIntent?.id,
            paymentMethodType: paymentIntent?.payment_method_type || paymentIntent?.payment_method?.type || 'unknown'
        });

        if (error) {
            if (error.type === "card_error" || error.type === "validation_error") {
                let userMessage = error.message;
                if (error.code === 'card_declined') {
                    userMessage = "Your card was declined. Please try another payment method.";
                } else if (error.code === 'insufficient_funds') {
                    userMessage = "Insufficient funds. Please use a different card.";
                } else if (error.code === 'expired_card') {
                    userMessage = "Your card has expired. Please use a different card.";
                } else if (error.code === 'incorrect_cvc') {
                    userMessage = "The security code (CVC) is incorrect. Please check and try again.";
                } else if (error.code === 'processing_error') {
                    userMessage = "An error occurred while processing your card. Please try again.";
                } else if (error.code === 'incorrect_number') {
                    userMessage = "The card number is incorrect. Please check and try again.";
                } else if (error.code === 'incorrect_zip') {
                    userMessage = "The ZIP/postal code doesn't match the card. Please check and try again.";
                }
                throw new Error(userMessage);
            } else if (error.type === "api_connection_error") {
                console.error('[ACH DEBUG] Stripe connection error:', error);
                throw new Error("We couldn't reach our payment processor. Please check your connection and try again.");
            } else if (error.type === "rate_limit_error") {
                console.error('[ACH DEBUG] Stripe rate limit error:', error);
                throw new Error("Too many requests. Please wait a moment and try again.");
            } else {
                console.error('[ACH DEBUG] Stripe confirmPayment non-card error:', error);
                throw new Error("An unexpected error occurred during payment. Please try again or contact support.");
            }
        }

        console.log('[ACH DEBUG] PaymentIntent full status:', paymentIntent.status);

        // Clean up pending payment context since confirmPayment resolved (no redirect happened)
        try { localStorage.removeItem('pendingPaymentContext'); } catch (e) { /* ignore */ }

        // Handle both 'succeeded' (card) and 'processing' (ACH/bank) statuses
        if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing') {
            const isACHProcessing = paymentIntent.status === 'processing';
            log('Events', isACHProcessing ? 'ACH payment submitted - processing (bank transfer takes 2-4 business days).' : 'Payment succeeded.');
            console.log('[ACH DEBUG] Payment accepted.', {
                status: paymentIntent.status,
                isACHProcessing,
                amount: paymentIntent.amount
            });

            const amountPaid = paymentIntent.amount / 100;

            // --- Track Community Fund chip-in to Airtable ---
            const chipInCtx = ui.getCheckoutChipInContext();
            if (chipInCtx.chipInAmount > 0 && chipInCtx.scope) {
                const storeId = state.shop?.id || state.session?.storeId || '';
                const goalAmount = chipInCtx.scope.price || 0;
                api.upsertCommunityFund(
                    chipInCtx.scope.itemId,
                    chipInCtx.scope.itemName || 'Item',
                    chipInCtx.chipInAmount,
                    goalAmount,
                    storeId
                ).then(result => {
                    log('Events', `Community fund tracked: $${chipInCtx.chipInAmount.toFixed(2)}`);
                }).catch(err => {
                    console.warn('[Events] Failed to track community fund:', err);
                });

                // Also update localStorage for offline/fallback tracking
                try {
                    const donationKey = `donation_fund_${chipInCtx.scope.itemId}`;
                    let localData = { raised: 0, contributors: 0 };
                    const stored = localStorage.getItem(donationKey);
                    if (stored) localData = JSON.parse(stored);
                    localData.raised = (localData.raised || 0) + chipInCtx.chipInAmount;
                    localData.contributors = (localData.contributors || 0) + 1;
                    localStorage.setItem(donationKey, JSON.stringify(localData));
                } catch (e) { /* storage full, ignore */ }
            }
            // --- End Community Fund tracking ---

            const paymentNote = isACHProcessing
                ? `ACH Bank Transfer on ${new Date().toLocaleDateString()} (processing)`
                : `Stripe Payment on ${new Date().toLocaleDateString()}`;
            const newPayment = {
                amount: amountPaid,
                date: new Date().toISOString(),
                note: paymentNote
            };
            const updatedPaymentHistory = [...state.session.user.paymentHistory, newPayment];

            await api.updatePaymentHistory(state.session.id, updatedPaymentHistory);

            state.session.user.paymentHistory = updatedPaymentHistory;
            state.session.user.amountReceived = updatedPaymentHistory.reduce((sum, p) => sum + p.amount, 0);

            ui.updateTotalCost();
            document.getElementById('payment-form').style.display = 'none';
            document.getElementById('checkout-summary-details').style.display = 'none';
            document.querySelector('.checkout-total-deposit-section').style.display = 'none';

            const feeRow = document.querySelector('.processing-fee-row');
            const totalRow = document.querySelector('.final-total-row');
            const divider = document.querySelector('.total-divider');
            if(feeRow) feeRow.style.display = 'none';
            if(totalRow) totalRow.style.display = 'none';
            if(divider) divider.style.display = 'none';

            document.querySelector('.terms-and-conditions').style.display = 'none';

            // Show appropriate success message for ACH vs card
            const successMsg = document.getElementById('payment-success-message');
            if (successMsg) {
                successMsg.replaceChildren();
                const statusLine = document.createElement('div');
                statusLine.textContent = isACHProcessing ? '✅ Bank Payment Submitted!' : '✅ Payment Successful!';
                successMsg.appendChild(statusLine);

                if (isACHProcessing) {
                    const processingNote = document.createElement('small');
                    processingNote.style.cssText = 'display: block; font-size: 0.7em; opacity: 0.85;';
                    processingNote.textContent = 'ACH transfers typically take 2-4 business days to complete.';
                    successMsg.appendChild(processingNote);
                }

                const receiptNote = document.createElement('small');
                receiptNote.style.cssText = 'display: block; margin-top: 8px; font-size: 0.7em; opacity: 0.85;';
                receiptNote.textContent = `A receipt will be emailed to ${customerEmail}.`;
                successMsg.appendChild(receiptNote);
                successMsg.style.display = 'block';
            }

            // If the guest opted in, create an account / sign in so this plan and
            // their RSVPs are saved to it. Uses the existing magic-link flow: a
            // confirmation email is sent; clicking it signs this tab in (Pusher),
            // which associates the session and flushes pending RSVPs (see auth.js).
            const acctCheckbox = document.getElementById('checkout-create-account');
            if (acctCheckbox && acctCheckbox.checked && !state.session.user.isAuthenticated && customerEmail) {
                try {
                    await startEmailSignIn(customerEmail);
                    ui.showToast(`Check ${customerEmail} for a link to finish saving your plan and RSVPs.`);
                } catch (err) {
                    log('Events', `Checkout account sign-in failed: ${err.message}`);
                }
            }

            setTimeout(() => { ui.hideCheckoutModal(); }, isACHProcessing ? 6000 : 4000);
        } else if (paymentIntent.status === 'requires_action' || paymentIntent.status === 'requires_confirmation') {
            // ACH may require additional verification steps (e.g., micro-deposits)
            console.warn('[ACH DEBUG] PaymentIntent requires additional action:', paymentIntent.status);
            cardErrors.textContent = 'Additional verification is required. Please follow the prompts to complete your bank payment.';
            submitBtn.disabled = false;
            buttonText.style.display = 'inline';
            spinner.style.display = 'none';
        } else {
            // Unexpected status - log and show error
            console.error('[ACH DEBUG] Unexpected PaymentIntent status:', paymentIntent.status, paymentIntent);
            throw new Error(`Payment returned unexpected status: "${paymentIntent.status}". Please try again or use a different payment method.`);
        }
    } catch (err) {
        log('Events', `Stripe payment error: ${err.message}`);
        console.error('[ACH DEBUG] Payment error caught:', err);
        cardErrors.textContent = err.message;
        submitBtn.disabled = false;
        buttonText.style.display = 'inline';
        spinner.style.display = 'none';
    }
}

/**
 * Completes a $0 (free) plan checkout. There is nothing to charge, so instead of
 * going through Stripe the visitor's name + email are collected and they are
 * registered (RSVP "yes") for every event included in their plan.
 *
 * - Signed-in users: each plan event is committed as their RSVP immediately.
 * - Guests: each plan event RSVP is held locally (the same store used by the
 *   normal guest RSVP flow) and committed when they create an account / sign in.
 *   If they tick "create an account (or sign in)", a magic sign-in link is sent;
 *   clicking it flushes the held RSVPs and saves the plan (see auth.js).
 */
/**
 * Registers the visitor for every Event in their plan (RSVP "yes") and — for a
 * guest who ticked the account box — emails a secure sign-in link so the plan
 * and RSVPs are saved to the account. Shared by the free ($0) checkout and the
 * "Pay Direct" (P2P) checkout, so the name/email collected at checkout always
 * results in a registration regardless of the payment path.
 * @param {string} customerEmail - The email entered at checkout (already trimmed)
 * @returns {Promise<number>} the number of events the visitor was registered for
 */
async function registerPlanEventsForCheckout(customerEmail, opts = {}) {
    const { suppressSignInEmail = false } = opts;
    // The events to register for are the "Event" records in the plan.
    const eventEntriesByCatalogId = new Map();
    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record && record.fields['Item Type'] === 'Event') {
            const catalogRecordId = getCatalogRecordId(recordId, itemInfo, record);
            const quantity = itemInfo.quantity || 1;
            const existing = eventEntriesByCatalogId.get(catalogRecordId);
            if (!existing || quantity > existing.quantity) {
                eventEntriesByCatalogId.set(catalogRecordId, { recordId: catalogRecordId, record, quantity });
            }
            itemInfo.rsvpType = itemInfo.rsvpType || 'yes';
            state.cart.lockedItems.set(recordId, itemInfo);
        }
    }
    const eventEntries = Array.from(eventEntriesByCatalogId.values());

    const isAuthed = state.session.user.isAuthenticated;

    if (isAuthed) {
        // Commit each RSVP directly. Best-effort per event so one failure
        // does not block the rest.
        await Promise.allSettled(eventEntries.map(async ({ recordId, quantity }) => {
            const updated = await api.updateRsvpForEvent(recordId, state.session.user.id, 'yes');
            if (updated) {
                const idx = state.records.all.findIndex(r => r.id === recordId);
                if (idx > -1) state.records.all[idx] = updated;
            }
            try { await api.saveEventRsvpQuantity(recordId, 'yes', quantity); } catch (e) { /* party size best-effort */ }
        }));
    } else {
        // Hold the RSVPs locally; they commit on sign-in (see auth.js).
        const tempRsvps = getTempRsvps();
        eventEntries.forEach(({ recordId, quantity }) => {
            tempRsvps[recordId] = { rsvpType: 'yes', quantity };
        });
        setTempRsvps(tempRsvps);
        // Remember the email so a returning guest is recognized at sign-in.
        if (customerEmail) {
            try { localStorage.setItem('lastSignInEmail', customerEmail); } catch (e) { /* ignore */ }
        }
    }

    // Reflect RSVP state on any visible cards.
    try { eventEntries.forEach(({ recordId }) => ui.updateCardIcon(recordId)); } catch (e) { /* non-fatal */ }

    // If a guest opted in, create an account / sign in so the plan and these
    // RSVPs are saved to it (mirrors the paid checkout path). Skipped when the
    // caller delivers the sign-in link inside the confirmation email instead, so
    // the guest never receives two separate emails.
    const acctCheckbox = document.getElementById('checkout-create-account');
    if (!suppressSignInEmail && acctCheckbox && acctCheckbox.checked && !isAuthed && customerEmail) {
        try {
            await startEmailSignIn(customerEmail);
            ui.showToast(`Check ${customerEmail} for a link to finish saving your plan and RSVPs.`);
        } catch (err) {
            log('Events', `Checkout account sign-in failed: ${err.message}`);
        }
    }

    return eventEntries.length;
}

/**
 * Handles a "Pay Direct" (P2P) option click during checkout. Enforces that a
 * name and email were entered (always collected, even for direct pay) and, the
 * first time the visitor proceeds, registers them for the events in their plan.
 * Runs in the capture phase so it can block the external payment link when the
 * required details are missing.
 */
async function handleP2PCheckoutClick(event) {
    const optionBtn = event.target.closest('.quick-pay-option-btn');
    if (!optionBtn) return;

    const nameEl = document.getElementById('customer-name');
    const emailEl = document.getElementById('customer-email');
    const customerName = (nameEl?.value || '').trim();
    const customerEmail = (emailEl?.value || '').trim();

    if (!customerName || !customerEmail) {
        event.preventDefault();
        event.stopPropagation();
        ui.showToast('Please enter your name and email before paying directly.');
        (!customerName ? nameEl : emailEl)?.focus();
        return;
    }

    // Register the visitor for their plan's events once per checkout. The flag
    // lives on the container and is cleared each time the options re-render
    // (renderCheckoutP2POptions). Fire-and-forget so the payment app still opens.
    const container = event.currentTarget;
    if (container.dataset.registered !== 'true') {
        container.dataset.registered = 'true';
        registerPlanEventsForCheckout(customerEmail)
            .then(count => {
                const acct = document.getElementById('checkout-create-account');
                const creatingAccount = acct && acct.checked && !state.session.user.isAuthenticated;
                if (count > 0 && !creatingAccount) {
                    ui.showToast(`You're registered for ${count === 1 ? 'the event' : `${count} events`} in your plan.`);
                }
            })
            .catch(err => log('Events', `P2P registration error: ${err.message}`));
    }
}

async function handleFreeRegistration(submitBtn, buttonText, spinner) {
    const cardErrors = document.getElementById('card-errors');
    if (cardErrors) cardErrors.textContent = '';

    const customerName = (document.getElementById('customer-name')?.value || '').trim();
    const customerEmail = (document.getElementById('customer-email')?.value || '').trim();

    // Always collect a name + email before registering.
    if (!customerName || !customerEmail) {
        ui.showToast('Please enter your name and email to complete registration.');
        const emptyEl = !customerName
            ? document.getElementById('customer-name')
            : document.getElementById('customer-email');
        if (emptyEl) emptyEl.focus();
        return;
    }

    submitBtn.disabled = true;
    if (buttonText) buttonText.style.display = 'none';
    if (spinner) spinner.style.display = 'inline';

    try {
        // For a guest, set up the sign-in channel first so the confirmation email
        // can carry a working sign-in link (instead of a separate magic-link email).
        const signInChannelId = setupGuestSignInChannel();
        const count = await registerPlanEventsForCheckout(customerEmail, { suppressSignInEmail: true });
        await api.saveSessionToAirtable();

        // Ensure the plan is persisted, then email both the purchaser and the
        // store a confirmation (with an "Open Plan & Pay" link). Non-fatal: the
        // registration above stands even if email delivery fails.
        try {
            if (!state.session.id) {
                console.log('[FREE-REG] No session id yet — saving plan to Airtable first.');
                await api.saveSessionToAirtable();
                console.log('[FREE-REG] Plan saved. session.id =', state.session.id);
            }
            const amountDue = getCheckoutAmountDue();
            console.log('[FREE-REG] Sending confirmation emails. amountDue =', amountDue);
            const emailResult = await sendCheckoutConfirmation({ customerEmail, customerName, amountDue, unpaid: true, signInChannelId });
            console.log('[FREE-REG] Confirmation email result:', emailResult);
        } catch (emailErr) {
            console.error('[FREE-REG] Confirmation email step failed (non-fatal):', emailErr.message);
        }

        // Swap the form for the success message.
        const paymentForm = document.getElementById('payment-form');
        if (paymentForm) paymentForm.style.display = 'none';
        const summaryDetails = document.getElementById('checkout-summary-details');
        if (summaryDetails) summaryDetails.style.display = 'none';
        const depositSection = document.querySelector('.checkout-total-deposit-section');
        if (depositSection) depositSection.style.display = 'none';
        const termsEl = document.querySelector('.terms-and-conditions');
        if (termsEl) termsEl.style.display = 'none';

        const successMsg = document.getElementById('payment-success-message');
        if (successMsg) {
            const heading = count > 0 ? "You're registered!" : 'All set!';
            const sub = count > 0
                ? `You're on the list for ${count === 1 ? 'this event' : `${count} events`} in your plan.`
                : 'Your details have been saved.';
            successMsg.innerHTML = `
                <div style="font-size: 64px; margin-bottom: 20px;">✅</div>
                <h3 style="color: #28a745; margin-bottom: 15px;">${heading}</h3>
                <p style="color: #6c757d;">${sub}</p>`;
            successMsg.style.display = 'block';
        }

        log('Events', `Free registration completed for ${count} event(s).`);
        setTimeout(() => { ui.hideCheckoutModal(); }, 4000);
    } catch (err) {
        log('Events', `Free registration error: ${err.message}`);
        // card-errors lives in the hidden payment row here, so surface via toast.
        ui.showToast(err.message || 'Could not complete registration. Please try again.');
        submitBtn.disabled = false;
        if (buttonText) buttonText.style.display = 'inline';
        if (spinner) spinner.style.display = 'none';
    }
}

/**
 * Reads the amount still owed from the live checkout display. Mirrors the
 * computation in updateCheckoutDisplay (modal.js): full total minus anything
 * already paid. Returns 0 if the elements aren't present.
 */
function getCheckoutAmountDue() {
    const totalEl = document.getElementById('full-total-price');
    const finalTotal = totalEl ? parseFloat(totalEl.dataset.total || '0') : 0;
    const amountReceived = (state.session.user && state.session.user.amountReceived) || 0;
    const due = finalTotal - amountReceived;
    return due > 0 ? due : 0;
}

/**
 * Sends the checkout confirmation emails (purchaser + store owner) via the
 * send-checkout-confirmation function. Non-fatal: a failure here is logged and
 * surfaced to the console but does not block the registration that already
 * happened. Requires a persisted session id so the server can resolve the plan.
 */
async function sendCheckoutConfirmation({ customerEmail, customerName, amountDue, unpaid = true, signInChannelId = null }) {
    if (!state.session.id) {
        console.warn('[CHECKOUT-EMAIL] No session id — cannot send confirmation emails.');
        return { ok: false, reason: 'no-session-id' };
    }
    const payload = { sessionId: state.session.id, customerEmail, customerName, amountDue, unpaid, signInChannelId };
    console.log('[CHECKOUT-EMAIL] POST /.netlify/functions/send-checkout-confirmation', payload);
    try {
        const res = await fetch('/.netlify/functions/send-checkout-confirmation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        console.log('[CHECKOUT-EMAIL] Response', res.status, data);
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    } catch (err) {
        console.error('[CHECKOUT-EMAIL] Failed to send confirmation:', err.message);
        return { ok: false, reason: err.message };
    }
}

/**
 * For an un-signed-in guest, mint a magic-link channel id and start listening on
 * it in THIS tab, so a sign-in link embedded in the checkout confirmation email
 * signs them in here when clicked. Returns the channel id to hand to
 * sendCheckoutConfirmation (or null for signed-in users / on failure). This
 * replaces the separate magic-link email — one email now carries both the
 * quote/receipt and the sign-in link.
 */
function setupGuestSignInChannel() {
    if (state.session.user.isAuthenticated) return null;
    try {
        const channelId = generateAuthChannelId();
        listenForEmailSignIn(channelId);
        return channelId;
    } catch (e) {
        log('Events', `Could not set up guest sign-in channel: ${e.message}`);
        return null;
    }
}

/**
 * "Save plan for later" checkout: persists the plan (if needed), registers the
 * visitor for the plan's events, and emails both the purchaser and the store a
 * confirmation containing an "Open Plan & Pay" link — all without taking a
 * payment. Doubles as a way to test that the confirmation emails fire.
 */
async function handleSavePlanForLater() {
    const btn = document.getElementById('save-plan-checkout-btn');
    const buttonText = btn && btn.querySelector('.button-text');
    const spinner = btn && btn.querySelector('.spinner');

    const customerName = (document.getElementById('customer-name')?.value || '').trim();
    const customerEmail = (document.getElementById('customer-email')?.value || '').trim();

    console.log('[SAVE-PLAN] Clicked.', { customerName, customerEmail, sessionId: state.session.id });

    if (!customerName || !customerEmail) {
        ui.showToast('Please enter your name and email to save your plan.');
        const emptyEl = !customerName
            ? document.getElementById('customer-name')
            : document.getElementById('customer-email');
        if (emptyEl) emptyEl.focus();
        return;
    }

    if (btn) btn.disabled = true;
    if (buttonText) buttonText.style.display = 'none';
    if (spinner) spinner.style.display = 'inline';

    try {
        // The server resolves the plan (and its store) by session id, and the
        // "Open Plan & Pay" email link is /?session=<id> — so the plan must be
        // persisted to Airtable first.
        if (!state.session.id) {
            console.log('[SAVE-PLAN] No session id yet — saving plan to Airtable first.');
            await api.saveSessionToAirtable();
            console.log('[SAVE-PLAN] Plan saved. session.id =', state.session.id);
        }

        // Register for the plan's events (honors the "create an account" checkbox).
        // The sign-in link rides along in the confirmation email below, so suppress
        // the separate magic-link email here.
        const signInChannelId = setupGuestSignInChannel();
        const count = await registerPlanEventsForCheckout(customerEmail, { suppressSignInEmail: true });
        await api.saveSessionToAirtable();
        console.log('[SAVE-PLAN] Registered for', count, 'event(s).');

        const amountDue = getCheckoutAmountDue();
        console.log('[SAVE-PLAN] amountDue =', amountDue);

        const result = await sendCheckoutConfirmation({ customerEmail, customerName, amountDue, unpaid: true, signInChannelId });
        console.log('[SAVE-PLAN] Confirmation email result:', result);

        // Swap the form for a success message (same pattern as free registration).
        const paymentForm = document.getElementById('payment-form');
        if (paymentForm) paymentForm.style.display = 'none';
        const summaryDetails = document.getElementById('checkout-summary-details');
        if (summaryDetails) summaryDetails.style.display = 'none';
        const successMsg = document.getElementById('payment-success-message');
        if (successMsg) {
            successMsg.innerHTML = `
                <div style="font-size: 64px; margin-bottom: 20px;">📧</div>
                <h3 style="color: #28a745; margin-bottom: 15px;">Plan saved!</h3>
                <p style="color: #6c757d;">We emailed <strong>${customerEmail}</strong> a link to open your plan and pay whenever you're ready.</p>`;
            successMsg.style.display = 'block';
        }
        ui.showToast(`Check ${customerEmail} for a link to open your plan and pay.`);
        setTimeout(() => { ui.hideCheckoutModal(); }, 4000);
    } catch (err) {
        console.error('[SAVE-PLAN] Error:', err);
        ui.showToast(err.message || 'Could not save your plan. Please try again.');
        if (btn) btn.disabled = false;
        if (buttonText) buttonText.style.display = 'inline';
        if (spinner) spinner.style.display = 'none';
    }
}

/**
 * Creates a carousel section for displaying items (catalog or AI-generated)
 * @param {string} title - The section title
 * @param {string} subtitle - Optional subtitle/description
 * @param {Array} records - Array of record objects to display in the carousel
 * @param {object} imageCache - Image cache reference
 * @param {string} searchTerm - The original search term (for AI items)
 * @param {boolean} isAISection - Whether this is an AI-sourced section
 * @returns {HTMLElement} The carousel section element
 */
async function createSearchResultCarousel(title, subtitle, records, imageCache, searchTerm, isAISection = false) {
    const section = document.createElement('div');
    section.className = `search-result-carousel-section ${isAISection ? 'ai-results-section' : 'catalog-results-section'}`;

    // Create header
    const header = document.createElement('div');
    header.className = 'search-carousel-header';
    header.innerHTML = `
        <div class="search-carousel-title-row">
            <h3 class="search-carousel-title">${title}</h3>
            ${isAISection ? '<span class="ai-badge">AI Discovery</span>' : ''}
            <span class="search-carousel-count">${records.length} items</span>
        </div>
        ${subtitle ? `<p class="search-carousel-subtitle">${subtitle}</p>` : ''}
    `;
    section.appendChild(header);

    // Create carousel wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'search-carousel-wrapper';

    // Create carousel container
    const container = document.createElement('div');
    container.className = 'search-carousel-container';

    // Create cards for all items
    for (const record of records) {
        const card = await ui.createInteractiveCard(record, state.records.all, imageCache);
        if (isAISection && searchTerm) {
            attachAddToPlanHandler(card, record, searchTerm, imageCache);
        }
        container.appendChild(card);
    }

    wrapper.appendChild(container);

    // Helper function to calculate scroll distance based on card width
    const getScrollDistance = () => {
        const card = container.querySelector('.event-card');
        if (card) {
            return card.offsetWidth + 20; // 20px gap
        }
        return container.clientWidth;
    };

    // Add navigation buttons
    const leftNav = document.createElement('button');
    leftNav.className = 'search-carousel-nav left';
    leftNav.innerHTML = '◄';
    leftNav.setAttribute('aria-label', 'Scroll left');
    leftNav.addEventListener('click', (e) => {
        e.stopPropagation();
        container.scrollBy({ left: -getScrollDistance(), behavior: 'smooth' });
    });

    const rightNav = document.createElement('button');
    rightNav.className = 'search-carousel-nav right';
    rightNav.innerHTML = '►';
    rightNav.setAttribute('aria-label', 'Scroll right');
    rightNav.addEventListener('click', (e) => {
        e.stopPropagation();
        container.scrollBy({ left: getScrollDistance(), behavior: 'smooth' });
    });

    wrapper.appendChild(leftNav);
    wrapper.appendChild(rightNav);

    // Update navigation button visibility based on scroll position
    const updateNavVisibility = () => {
        const hasOverflow = container.scrollWidth > container.clientWidth;

        if (hasOverflow) {
            wrapper.classList.add('has-overflow');
            leftNav.style.opacity = container.scrollLeft <= 0 ? '0.3' : '';
            leftNav.style.pointerEvents = container.scrollLeft <= 0 ? 'none' : '';
            const atEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 5;
            rightNav.style.opacity = atEnd ? '0.3' : '';
            rightNav.style.pointerEvents = atEnd ? 'none' : '';
        } else {
            wrapper.classList.remove('has-overflow');
        }
    };

    container.addEventListener('scroll', updateNavVisibility);
    setTimeout(updateNavVisibility, 100);
    setTimeout(updateNavVisibility, 500);

    section.appendChild(wrapper);

    return section;
}

/**
 * Handles the hybrid search display - showing both catalog matches and AI suggestions
 * @param {string} searchTerm - The search term
 * @param {object} imageCache - Image cache reference
 * @param {Array} catalogMatches - Matching catalog items (may be empty)
 */
async function handleHybridSearchDisplay(searchTerm, imageCache, catalogMatches = []) {
    if (aiSearchController) {
        aiSearchController.abort();
    }
    aiSearchController = new AbortController();
    const signal = aiSearchController.signal;

    const catalogContainer = document.getElementById('catalog-container');
    if (!catalogContainer) return;

    // Clear container and show loading state
    catalogContainer.innerHTML = '';

    // If we have catalog matches, show them first in a carousel
    if (catalogMatches.length > 0) {
        log('Events', `Showing ${catalogMatches.length} catalog matches for "${searchTerm}"`);

        const catalogSection = await createSearchResultCarousel(
            `Top Matches for "${searchTerm}"`,
            'From our curated catalog',
            catalogMatches,
            imageCache,
            searchTerm,
            false
        );
        catalogContainer.appendChild(catalogSection);
    }

    // Show loading indicator for AI results
    const loadingSection = document.createElement('div');
    loadingSection.className = 'ai-loading-section';
    loadingSection.innerHTML = `
        <div class="ai-loading-header">
            <span class="ai-badge">AI Discovery</span>
            <span class="ai-loading-text">Finding more options for "${searchTerm}"...</span>
        </div>
        <div class="ai-loading-spinner"></div>
    `;
    catalogContainer.appendChild(loadingSection);

    try {
        log('Events', 'Starting Hybrid AI search for:', searchTerm);

        // Call the AI function
        const response = await fetch('/.netlify/functions/process-weblink', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: searchTerm }),
            signal: signal
        });

        if (!response.ok) {
            throw new Error(`API returned status ${response.status}`);
        }

        if (signal.aborted) return;

        const aiData = await response.json();
        log('Events', 'AI Search Response:', aiData);

        // === IMAGE DEBUG: Log raw AI response image data ===
        console.log('[IMAGE DEBUG] ========== AI PARSE IMAGE DATA ==========');
        console.log('[IMAGE DEBUG] Full AI Response:', JSON.stringify(aiData, null, 2));
        if (aiData.itemType === 'Grouping' && aiData.children) {
            aiData.children.forEach((child, idx) => {
                console.log(`[IMAGE DEBUG] Child ${idx} "${child.Name}" - ImageKeywords:`, child.ImageKeywords);
            });
        } else if (aiData.Name) {
            console.log(`[IMAGE DEBUG] Single item "${aiData.Name}" - ImageKeywords:`, aiData.ImageKeywords);
        }
        console.log('[IMAGE DEBUG] =========================================');

        // Remove loading indicator
        loadingSection.remove();

        // Handle relatedKeywords for refinement chips
        if (aiData.relatedKeywords && Array.isArray(aiData.relatedKeywords)) {
            renderRefinementChips(aiData.relatedKeywords, imageCache);
        }

        // Create AI records from the response
        const aiRecords = [];
        const timestamp = Date.now();

        if (aiData.itemType === 'Grouping' && aiData.children && Array.isArray(aiData.children)) {
            // Handle GROUPING type - multiple AI recommendations
            aiData.children.forEach((child, index) => {
                const childId = `ai-child-${timestamp}-${index}`;

                // Build comprehensive Rankings JSON with AI profile scores
                const rankingsData = {
                    "profileSource": "ai_hybrid_search",
                    "Tags": [searchTerm.toLowerCase(), "ai-generated", "partner activity"]
                };
                // Add activity profile scores if provided by AI
                if (child.Rankings && typeof child.Rankings === 'object') {
                    rankingsData.Fun = child.Rankings.Fun || 0;
                    rankingsData.Social = child.Rankings.Social || 0;
                    rankingsData.Active = child.Rankings.Active || 0;
                    rankingsData.Creative = child.Rankings.Creative || 0;
                    rankingsData.Learning = child.Rankings.Learning || 0;
                    rankingsData.Relaxing = child.Rankings.Relaxing || 0;
                }

                // Build location details with availability and address
                let locationDetails = '';
                if (child.Location) locationDetails += child.Location;
                if (child.Availability) {
                    locationDetails += locationDetails ? '\n\n' : '';
                    locationDetails += `Hours: ${child.Availability}`;
                }

                // Build "Good to Know" / Additional Information with lead time and extra info
                let additionalInfo = '';
                if (child.LeadTime) additionalInfo += `Booking: ${child.LeadTime}`;
                if (child.GoodToKnow) {
                    additionalInfo += additionalInfo ? '\n\n' : '';
                    additionalInfo += child.GoodToKnow;
                }
                if (child.Website) {
                    additionalInfo += additionalInfo ? '\n\n' : '';
                    additionalInfo += `Website: ${child.Website}`;
                }

                // Ensure price is a number - handle all edge cases
                let childPrice = child.Price || 0;
                if (typeof childPrice === 'object') {
                    childPrice = 0;
                } else if (typeof childPrice === 'string') {
                    childPrice = parseFloat(childPrice.replace(/[^0-9.-]/g, '')) || 0;
                } else if (typeof childPrice !== 'number') {
                    childPrice = 0;
                }
                childPrice = isNaN(childPrice) ? 0 : childPrice;

                const childRecord = {
                    id: childId,
                    fields: {
                        Name: child.Name,
                        Description: child.Description,
                        Price: childPrice,
                        ServiceType: child.ServiceType || 'Partner Activity',
                        'Item Type': 'Bookable Item',
                        'Parent Item': aiData.name || `AI ${searchTerm} Options`,
                        Status: 'Available',
                        'Pricing Type': child.PricingType || 'flat rate',
                        Stores: [state.ui.activeShopId],
                        Rankings: JSON.stringify(rankingsData),
                        'Location Details': locationDetails || null,
                        'Additional Information': additionalInfo || null,
                        Options: null, 'Headcount min': null,
                        'Media Tags': child.ImageKeywords || null,
                        'Curated Images': null, Subcategories: null, 'iCal URL': null,
                        'Lead Time (days)': null, RSVPs: null, Date: null,
                        'Chat Enabled': false, Duration: null, Capacity: null,
                        // AI confidence score (0.0-1.0)
                        '_aiConfidence': child.Confidence || null,
                        // Store Website separately for image scraping
                        '_aiWebsite': child.Website || null
                    },
                    isAI: true
                };

                // === IMAGE DEBUG: Log created AI child record image fields ===
                console.log(`[IMAGE DEBUG] Created AI child record "${childId}":`, {
                    name: child.Name,
                    imageKeywordsFromAI: child.ImageKeywords,
                    mediaTagsFieldValue: childRecord.fields['Media Tags'],
                    curatedImagesFieldValue: childRecord.fields['Curated Images']
                });

                aiRecords.push(childRecord);
                state.records.all.push(childRecord);
                invalidateRecordsIndex();
            });
        } else if (aiData.Name) {
            // Handle SPECIFIC type - single AI result
            const customId = `ai-search-${timestamp}`;

            // Build comprehensive Rankings JSON with AI profile scores
            const rankingsData = {
                "profileSource": "ai_hybrid_search",
                "Tags": [searchTerm.toLowerCase(), "ai-generated", "partner activity"]
            };
            // Add activity profile scores if provided by AI
            if (aiData.Rankings && typeof aiData.Rankings === 'object') {
                rankingsData.Fun = aiData.Rankings.Fun || 0;
                rankingsData.Social = aiData.Rankings.Social || 0;
                rankingsData.Active = aiData.Rankings.Active || 0;
                rankingsData.Creative = aiData.Rankings.Creative || 0;
                rankingsData.Learning = aiData.Rankings.Learning || 0;
                rankingsData.Relaxing = aiData.Rankings.Relaxing || 0;
            }

            // Build location details with availability and address
            let locationDetails = '';
            if (aiData.Location) locationDetails += aiData.Location;
            if (aiData.Availability) {
                locationDetails += locationDetails ? '\n\n' : '';
                locationDetails += `Hours: ${aiData.Availability}`;
            }

            // Build "Good to Know" / Additional Information with lead time and extra info
            let additionalInfo = '';
            if (aiData.LeadTime) additionalInfo += `Booking: ${aiData.LeadTime}`;
            if (aiData.GoodToKnow) {
                additionalInfo += additionalInfo ? '\n\n' : '';
                additionalInfo += aiData.GoodToKnow;
            }
            if (aiData.Website) {
                additionalInfo += additionalInfo ? '\n\n' : '';
                additionalInfo += `Website: ${aiData.Website}`;
            }

            // Ensure price is a number - handle all edge cases
            let aiPrice = aiData.Price || 0;
            if (typeof aiPrice === 'object') {
                aiPrice = 0;
            } else if (typeof aiPrice === 'string') {
                aiPrice = parseFloat(aiPrice.replace(/[^0-9.-]/g, '')) || 0;
            } else if (typeof aiPrice !== 'number') {
                aiPrice = 0;
            }
            aiPrice = isNaN(aiPrice) ? 0 : aiPrice;

            const liveRecord = {
                id: customId,
                fields: {
                    Name: aiData.Name,
                    Description: aiData.Description,
                    Price: aiPrice,
                    ServiceType: aiData.ServiceType || 'Partner Activity',
                    'Item Type': 'Bookable Item',
                    Status: 'Available',
                    'Pricing Type': aiData.PricingType || 'flat rate',
                    Stores: [state.ui.activeShopId],
                    Rankings: JSON.stringify(rankingsData),
                    'Location Details': locationDetails || null,
                    'Additional Information': additionalInfo || null,
                    Options: null, 'Parent Item': null, 'Headcount min': null,
                    'Media Tags': aiData.ImageKeywords || null,
                    'Curated Images': null, Subcategories: null,
                    'iCal URL': null, 'Lead Time (days)': null, RSVPs: null, Date: null,
                    'Chat Enabled': false, Duration: null, Capacity: null,
                    // AI confidence score (0.0-1.0)
                    '_aiConfidence': aiData.Confidence || null,
                    // Store Website separately for image scraping
                    '_aiWebsite': aiData.Website || null
                },
                isAI: true
            };

            // === IMAGE DEBUG: Log created AI single-item record image fields ===
            console.log(`[IMAGE DEBUG] Created AI single-item record "${customId}":`, {
                name: aiData.Name,
                imageKeywordsFromAI: aiData.ImageKeywords,
                mediaTagsFieldValue: liveRecord.fields['Media Tags'],
                curatedImagesFieldValue: liveRecord.fields['Curated Images']
            });

            aiRecords.push(liveRecord);
            state.records.all.push(liveRecord);
            invalidateRecordsIndex();
        }

        // Display AI results in their own carousel
        if (aiRecords.length > 0) {
            log('Events', `Created ${aiRecords.length} AI-generated items for "${searchTerm}"`);

            const aiSection = await createSearchResultCarousel(
                `AI Discoveries for "${searchTerm}"`,
                'Additional options found by AI',
                aiRecords,
                imageCache,
                searchTerm,
                true
            );
            catalogContainer.appendChild(aiSection);
        }

        // Always add manual add option after AI results (whether AI found items or not)
        const manualAddSection = createManualAddOption(searchTerm);
        catalogContainer.appendChild(manualAddSection);

        // If no results at all from AI AND no catalog matches, show context
        if (aiRecords.length === 0 && catalogMatches.length === 0) {
            // The manual add section is already shown, but add some context
            const contextMsg = document.createElement('p');
            contextMsg.className = 'no-results-context';
            contextMsg.style.cssText = 'text-align: center; padding: 20px; color: #666;';
            contextMsg.textContent = `No exact matches found for "${searchTerm}". You can add it manually using the form above.`;
            catalogContainer.insertBefore(contextMsg, manualAddSection);
        }

    } catch (err) {
        if (err.name === 'AbortError') {
            log('Events', 'AI search aborted by new search.');
            return;
        }
        log('Events', `Proactive AI parse error: ${err.message}`);

        // Remove loading indicator on error
        loadingSection.remove();

        // Still show manual add option even when AI fails
        const manualAddSection = createManualAddOption(searchTerm);
        catalogContainer.appendChild(manualAddSection);

        // If no catalog matches either, show helpful context
        if (catalogMatches.length === 0) {
            const contextMsg = document.createElement('p');
            contextMsg.className = 'no-results-context';
            contextMsg.style.cssText = 'text-align: center; padding: 20px; color: #666;';
            contextMsg.textContent = `Could not find "${searchTerm}". You can add it manually using the form above.`;
            catalogContainer.insertBefore(contextMsg, manualAddSection);
        }
        // If we have catalog matches, user still sees them plus the manual add option
    } finally {
        aiSearchController = null;
    }
}

// Keep the old function for backward compatibility, but redirect to new implementation
async function handleProactiveAISearch(searchTerm, imageCache) {
    // Use the new hybrid display with empty catalog matches
    await handleHybridSearchDisplay(searchTerm, imageCache, []);
}

/**
 * Attaches the "Add to Plan" click handler to an AI-generated card
 * @param {HTMLElement} card - The card element
 * @param {object} record - The record data
 * @param {string} searchTerm - The original search term
 * @param {object} imageCache - Image cache reference
 */
function attachAddToPlanHandler(card, record, searchTerm, imageCache) {
    const addToPlanBtn = card.querySelector('.add-to-plan-btn');
    if (addToPlanBtn) {
        addToPlanBtn.textContent = 'Add to Plan';
        addToPlanBtn.disabled = false;

        const newBtn = addToPlanBtn.cloneNode(true);
        addToPlanBtn.parentNode.replaceChild(newBtn, addToPlanBtn);

        newBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            log('Events', `Adding AI-parsed item: ${record.id}`);

            state.cart.lockedItems.set(record.id, {
                quantity: 1,
                selectedOptionIndex: 0,
                note: `Added via AI search for: "${searchTerm}"`
            });

            // Add progress for AI-sourced item
            updateProgress(0.0002);

            // Broadcast item addition for real-time updates
            broadcastItemAdded(record.id, { quantity: 1, note: `AI search: "${searchTerm}"` });

            // Sync plan state across all views
            syncPlanState('aiSearch', 'itemAdded', { recordId: record.id, itemName: record.fields?.Name || 'AI Item' });

            ui.updateEventPlanSection();
            ui.updateTotalCost();
            triggerSave();

            // Publish-on-add: mirror this AI item into the public community layer
            // so others can discover and react to it (signed-in users only).
            publishItemToPublicLayer(record, 'ai');

            newBtn.textContent = 'Update Plan';
            newBtn.disabled = true;
        });
    }
}

/**
 * Creates a manual add item section that allows users to add a custom item
 * with the search term as the default name
 * @param {string} searchTerm - The search term to use as default item name
 * @returns {HTMLElement} The manual add section element
 */
function createManualAddOption(searchTerm) {
    const section = document.createElement('div');
    section.className = 'manual-add-section';
    section.innerHTML = `
        <div class="manual-add-header">
            <span class="manual-add-icon">+</span>
            <span class="manual-add-title">Can't find what you're looking for?</span>
        </div>
        <div class="manual-add-content">
            <p class="manual-add-description">Add a custom item to your plan:</p>
            <div class="manual-add-form">
                <input type="text" class="manual-add-name-input" value="${searchTerm.replace(/"/g, '&quot;')}" placeholder="Item name">
                <button class="manual-add-btn">Add to Plan</button>
            </div>
        </div>
    `;

    // Attach click handler for the add button
    const addBtn = section.querySelector('.manual-add-btn');
    const nameInput = section.querySelector('.manual-add-name-input');

    addBtn.addEventListener('click', () => {
        const itemName = nameInput.value.trim();
        if (!itemName) {
            nameInput.focus();
            return;
        }

        // Create a manual item record
        const timestamp = Date.now();
        const manualId = `manual-add-${timestamp}`;

        const manualRecord = {
            id: manualId,
            fields: {
                Name: itemName,
                Description: `Manually added item from search: "${searchTerm}"`,
                Price: 0,
                ServiceType: 'Custom Item',
                'Item Type': 'Bookable Item',
                Status: 'Available',
                'Pricing Type': 'flat rate',
                Stores: [state.ui.activeShopId],
                Rankings: JSON.stringify({
                    "profileSource": "manual_add",
                    "Tags": [searchTerm.toLowerCase(), "manual-add", "custom"]
                }),
                'Location Details': null,
                'Additional Information': null,
                Options: null,
                'Parent Item': null,
                'Headcount min': null,
                'Media Tags': null,
                'Curated Images': null,
                Subcategories: null,
                'iCal URL': null,
                'Lead Time (days)': null,
                RSVPs: null,
                Date: null,
                'Chat Enabled': false,
                Duration: null,
                Capacity: null
            },
            isManual: true
        };

        // Add to records
        state.records.all.push(manualRecord);
        invalidateRecordsIndex();
        // Add to plan
        state.cart.lockedItems.set(manualId, {
            quantity: 1,
            selectedOptionIndex: 0,
            note: `Manually added from search: "${searchTerm}"`
        });

        // Update progress
        updateProgress(0.0002);

        // Broadcast and sync
        broadcastItemAdded(manualId, { quantity: 1, note: `Manual add: "${itemName}"` });
        syncPlanState('manualAdd', 'itemAdded', { recordId: manualId, itemName: itemName });

        // Update UI
        ui.updateEventPlanSection();
        ui.updateTotalCost();
        triggerSave();

        // Publish-on-add: mirror this custom item into the public community layer
        // so others can discover and react to it (signed-in users only).
        publishItemToPublicLayer(manualRecord, 'custom');

        // Update button state
        addBtn.textContent = 'Added!';
        addBtn.disabled = true;
        nameInput.disabled = true;

        log('Events', `Manually added item: ${manualId} - "${itemName}"`);
    });

    // Allow Enter key to submit
    nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addBtn.click();
        }
    });

    return section;
}

/**
 * Renders AI-suggested refinement chips below the search bar
 * @param {string[]} keywords - Array of related keywords
 * @param {object} imageCache - Image cache reference
 */
function renderRefinementChips(keywords, imageCache) {
    // Find or create the refinement chips container
    let chipsContainer = document.getElementById('ai-refinement-chips-container');
    const searchBarContainer = document.getElementById('search-bar-container');

    if (!chipsContainer && searchBarContainer) {
        chipsContainer = document.createElement('div');
        chipsContainer.id = 'ai-refinement-chips-container';
        searchBarContainer.appendChild(chipsContainer);
    }

    if (!chipsContainer) return;

    // Clear existing chips
    chipsContainer.innerHTML = '';

    // Create chips for each keyword
    keywords.slice(0, 5).forEach(keyword => {
        const chip = document.createElement('button');
        chip.className = 'ai-refinement-chip';
        chip.textContent = keyword;
        chip.title = `Search for "${keyword}"`;

        chip.addEventListener('click', () => {
            // Update search input and trigger new search
            const nameFilterInput = document.getElementById('name-filter');
            if (nameFilterInput) {
                nameFilterInput.value = keyword;
                nameFilterInput.dispatchEvent(new Event('input', { bubbles: true }));

                // Trigger the search with a slight delay to allow debounce
                setTimeout(() => {
                    handleProactiveAISearch(keyword, imageCache);
                }, 100);
            }
        });

        chipsContainer.appendChild(chip);
    });
}

/**
 * Clears the AI refinement chips container
 */
function clearRefinementChips() {
    const chipsContainer = document.getElementById('ai-refinement-chips-container');
    if (chipsContainer) {
        chipsContainer.innerHTML = '';
    }
}


export function initializeEventListeners(imageCache, flatpickr, shopSettings) {
    console.log('[EVENTS DEBUG] initializeEventListeners called.', {
        hasImageCache: !!imageCache,
        hasFlatpickr: !!flatpickr,
        hasShopSettings: !!shopSettings,
        shopType: shopSettings?.shopType
    });
    const mainContent = document.querySelector('.main-content');
    const searchBarContainer = document.getElementById('search-bar-container');
    const leftSidebar = document.getElementById('left-sidebar');
    const rightSidebar = document.getElementById('right-sidebar');
    const catalogArea = document.getElementById('catalog-area');
    const filterControls = document.getElementById('filter-controls');

    // Initialize plan state synchronization system
    initializePlanStateSync();
    console.log('[Events DEBUG] Plan state sync system initialized');

    // Preload Stripe.js when user hovers over checkout button
    const checkoutBtnEl = document.getElementById('checkout-btn');
    if (checkoutBtnEl) {
        checkoutBtnEl.addEventListener('mouseenter', preloadStripe, { once: true });
        checkoutBtnEl.addEventListener('touchstart', preloadStripe, { once: true });
    }

    // Initialize sidebar sync callback for receiving updates from other views
    ui.initializeSidebarSync();
    console.log('[Events DEBUG] Sidebar sync initialized');

    const safeAddEventListener = (selector, event, handler) => {
        const element = document.getElementById(selector);
        if (element) element.addEventListener(event, handler);
    };

    if (window.innerWidth < 1000) {
        leftSidebar?.classList.add('collapsed');
        rightSidebar?.classList.add('collapsed');
    }

    const mobileViewPlanBtn = document.getElementById('mobile-view-plan-btn');
    let mobilePlanDrag = null;
    const setMobilePlanOpen = (isOpen) => {
        if (!rightSidebar || !mobileViewPlanBtn) return;

        mobilePlanDrag = null;
        rightSidebar.classList.remove('dragging');
        rightSidebar.style.removeProperty('--mobile-plan-drag-offset');
        rightSidebar.classList.toggle('collapsed', !isOpen);
        document.body.classList.toggle('mobile-plan-open', isOpen);
        mobileViewPlanBtn.setAttribute('aria-expanded', String(isOpen));
        mobileViewPlanBtn.textContent = isOpen ? 'Close Plan' : 'View Plan';
    };

    const interactivePlanControlSelector = 'button, input, textarea, select, a, [contenteditable="true"]';

    rightSidebar?.addEventListener('touchstart', (event) => {
        if (window.innerWidth >= 1000 || rightSidebar.classList.contains('collapsed') || event.touches.length !== 1) return;

        const touchTarget = event.target instanceof Element ? event.target : null;
        const startedOnHandle = Boolean(touchTarget?.closest('#mobile-plan-drag-handle'));
        const startedOnControl = Boolean(touchTarget?.closest(interactivePlanControlSelector));

        if (!startedOnHandle && (rightSidebar.scrollTop > 0 || startedOnControl)) return;

        const touch = event.touches[0];
        mobilePlanDrag = {
            startX: touch.clientX,
            startY: touch.clientY,
            startTime: performance.now(),
            active: false,
            startedOnHandle
        };
    }, { passive: true });

    rightSidebar?.addEventListener('touchmove', (event) => {
        if (!mobilePlanDrag || event.touches.length !== 1) return;

        const touch = event.touches[0];
        const deltaX = touch.clientX - mobilePlanDrag.startX;
        const deltaY = touch.clientY - mobilePlanDrag.startY;

        if (!mobilePlanDrag.active) {
            if (Math.abs(deltaX) > Math.abs(deltaY)) {
                mobilePlanDrag = null;
                return;
            }
            if (deltaY <= 6 || (!mobilePlanDrag.startedOnHandle && rightSidebar.scrollTop > 0)) return;

            mobilePlanDrag.active = true;
            rightSidebar.classList.add('dragging');
        }

        event.preventDefault();
        const dragOffset = Math.max(0, Math.min(deltaY * 0.88, window.innerHeight * 0.65));
        rightSidebar.style.setProperty('--mobile-plan-drag-offset', `${dragOffset}px`);
    }, { passive: false });

    const finishMobilePlanDrag = (event, allowClose) => {
        if (!mobilePlanDrag) return;

        const touch = event.changedTouches?.[0];
        const deltaY = touch ? touch.clientY - mobilePlanDrag.startY : 0;
        const duration = Math.max(performance.now() - mobilePlanDrag.startTime, 1);
        const velocity = deltaY / duration;
        const shouldClose = allowClose && mobilePlanDrag.active && (deltaY > 90 || (deltaY > 45 && velocity > 0.5));

        rightSidebar?.classList.remove('dragging');
        rightSidebar?.style.removeProperty('--mobile-plan-drag-offset');
        mobilePlanDrag = null;

        if (shouldClose) setMobilePlanOpen(false);
    };

    rightSidebar?.addEventListener('touchend', (event) => finishMobilePlanDrag(event, true));
    rightSidebar?.addEventListener('touchcancel', (event) => finishMobilePlanDrag(event, false));

    // New filter toggle button handler (replaces old mobile-filter-trigger)
    const filterToggleBtn = document.getElementById('filter-toggle-btn');
    if (filterToggleBtn) {
        filterToggleBtn.addEventListener('click', () => {
            const isExpanded = filterToggleBtn.getAttribute('aria-expanded') === 'true';
            filterToggleBtn.setAttribute('aria-expanded', !isExpanded);
            leftSidebar?.classList.toggle('collapsed');

            if (!isExpanded && window.innerWidth < 1000) {
                setMobilePlanOpen(false);
                window.setTimeout(() => {
                    leftSidebar?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 50);
            }
        });
    }

    // Show/hide clear search button based on input value
    const nameFilterInput = document.getElementById('name-filter');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    if (nameFilterInput && clearSearchBtn) {
        nameFilterInput.addEventListener('input', () => {
            clearSearchBtn.style.display = nameFilterInput.value.trim() ? 'block' : 'none';
        });
        // Initialize visibility on page load
        clearSearchBtn.style.display = nameFilterInput.value.trim() ? 'block' : 'none';
    }

    // Legacy mobile-filter-trigger (kept for backwards compatibility)
    safeAddEventListener('mobile-filter-trigger', 'click', () => {
        if (window.innerWidth < 1000) {
            leftSidebar?.classList.toggle('collapsed');
        }
    });
    mobileViewPlanBtn?.addEventListener('click', () => {
        const isOpen = !rightSidebar?.classList.contains('collapsed');
        setMobilePlanOpen(!isOpen);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && document.body.classList.contains('mobile-plan-open')) {
            setMobilePlanOpen(false);
            mobileViewPlanBtn?.focus();
        }
    });

    saveShareBtn = document.getElementById('save-share-btn');
    let debugEnabled = false;

    const betaTrigger = document.getElementById('beta-trigger');
    if (betaTrigger) {
        betaTrigger.addEventListener('click', () => {
            debugEnabled = !debugEnabled;
            setDebugMode(debugEnabled);
            log('Debug', `Debug mode is now ${debugEnabled ? 'ON' : 'OFF'}.`);
        });
    }

    // Reliable catalog pagination via an IntersectionObserver sentinel plus a
    // visible "Load more" fallback. Replaces the previous fragile scroll-math
    // trigger that could miss when the first batch did not fill the viewport.
    setupCatalogPagination(imageCache);

    // --- START CONSOLIDATED BUTTON GENERATION --
    const categoryFiltersRoot = document.getElementById('category-filters');
    if (categoryFiltersRoot) {
        const activeShop = state.stores.all.find(s => s.id === state.ui.activeShopId);
        const hasStoreCategories = activeShop && activeShop.fields && activeShop.fields.Items && activeShop.fields.Items.length > 0;

        // NO "All" button - user wants category-organized carousels on landing
        // If store has categories, they will be shown as carousels in renderRecords
        // Clicking a category filters to just that category's items

        if (hasStoreCategories) {
            const itemRecordIds = Array.isArray(activeShop.fields.Items)
                ? activeShop.fields.Items
                : activeShop.fields.Items.split(',').map(id => id.trim());

            // First category button should be active by default for landing page
            let isFirst = true;
            itemRecordIds.forEach(recordId => {
                if (!recordId.startsWith('rec')) return;

                const categoryRecord = state.records.all.find(r => r.id === recordId);
                if (categoryRecord && categoryRecord.fields && categoryRecord.fields.Name) {
                    const categoryName = categoryRecord.fields.Name;
                    const categoryBtn = document.createElement('button');
                    // First button is active by default only if no URL category is set
                    const params = new URLSearchParams(window.location.search);
                    const urlCategory = params.get('category');
                    const normalizedCategoryName = categoryName.toLowerCase().replace(/\s+/g, ' ');

                    if (isFirst && !urlCategory) {
                        // Don't pre-select first category - let carousels show on landing
                        categoryBtn.className = 'filter-btn category-filter-btn';
                    } else if (urlCategory === normalizedCategoryName) {
                        categoryBtn.className = 'filter-btn category-filter-btn active';
                    } else {
                        categoryBtn.className = 'filter-btn category-filter-btn';
                    }
                    isFirst = false;

                    categoryBtn.dataset.filter = normalizedCategoryName;
                    categoryBtn.textContent = categoryName;

                    categoryBtn.addEventListener('click', () => {
                        document.querySelectorAll('#category-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
                        categoryBtn.classList.add('active');
                        updateUrl({ category: normalizedCategoryName, subcategory: null, view: null });
                        applyFiltersAndSort(imageCache);
                    });
                    categoryFiltersRoot.appendChild(categoryBtn);
                }
            });
        }

    }  else {
        console.warn("Could not find #category-filters container to add category buttons.");
    }
    // --- END CONSOLIDATED BUTTON GENERATION --

    // --- START HAMBURGER MENU NAVIGATION BUTTONS ---
    const hamburgerMenuBtn = document.getElementById('hamburger-menu-btn');
    const hamburgerMenuDropdown = document.getElementById('hamburger-menu-dropdown');
    const menuCatalogBtn = document.getElementById('menu-catalog-btn');
    const menuPlanBtn = document.getElementById('menu-plan-btn');
    const menuLikesBtn = document.getElementById('menu-likes-btn');
    const menuSessionsBtn = document.getElementById('menu-sessions-btn');

    // Hamburger button directly opens WTF Plans panel (simplified navigation)
    if (hamburgerMenuBtn) {
        hamburgerMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Directly open WTF Plans panel instead of showing dropdown
            showWtfPlansPanel();
        });
    }

    if (menuCatalogBtn) {
        menuCatalogBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            updateUrl({ category: null, subcategory: null, view: null });
            applyFiltersAndSort(imageCache);
        });
    }

    if (menuPlanBtn) {
        menuPlanBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            updateUrl({ category: null, subcategory: null, view: 'plan' });
            applyFiltersAndSort(imageCache);
        });
    }

    if (menuLikesBtn) {
        menuLikesBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            updateUrl({ category: null, subcategory: null, view: 'likes' });
            applyFiltersAndSort(imageCache);
        });
    }

    if (menuSessionsBtn) {
        menuSessionsBtn.style.display = state.session.user.isAuthenticated ? 'flex' : 'none';
        menuSessionsBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            if (!state.session.user.isAuthenticated) {
                showUserModal();
                return;
            }
            updateUrl({ category: null, subcategory: null, view: 'my-sessions' });
            applyFiltersAndSort(imageCache);
        });
    }

    // My Projects button handler
    const menuProjectsBtn = document.getElementById('menu-projects-btn');
    if (menuProjectsBtn) {
        menuProjectsBtn.style.display = state.session.user.isAuthenticated ? 'flex' : 'none';
        menuProjectsBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            if (!state.session.user.isAuthenticated) {
                showUserModal();
                return;
            }
            // Show the projects panel
            showProjectsPanel();
        });
    }

    // WTF Plans button handler - opens the WTF Plans panel
    const menuWtfPlansBtn = document.getElementById('menu-wtf-plans-btn');
    if (menuWtfPlansBtn) {
        menuWtfPlansBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            // Show the WTF Plans panel (works for both authenticated and non-authenticated users)
            showWtfPlansPanel();
        });
    }

    // Quick Plan button handler - opens the quick plan modal
    const quickPlanBtn = document.getElementById('quick-plan-btn');
    const quickPlanModalOverlay = document.getElementById('quick-plan-modal-overlay');
    const quickPlanCloseBtn = document.getElementById('quick-plan-close-btn');
    const quickPlanIdeaInput = document.getElementById('quick-plan-idea-input');
    const quickPlanSubmitBtn = document.getElementById('quick-plan-submit-btn');
    const quickPlanError = document.getElementById('quick-plan-error');

    if (quickPlanBtn && quickPlanModalOverlay) {
        quickPlanBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            quickPlanModalOverlay.classList.add('active');
            if (quickPlanIdeaInput) {
                quickPlanIdeaInput.value = '';
                quickPlanIdeaInput.focus();
            }
            if (quickPlanError) {
                quickPlanError.style.display = 'none';
            }
        });
    }

    // Close quick plan modal
    if (quickPlanCloseBtn && quickPlanModalOverlay) {
        quickPlanCloseBtn.addEventListener('click', () => {
            quickPlanModalOverlay.classList.remove('active');
        });
    }

    // Close quick plan modal when clicking outside
    if (quickPlanModalOverlay) {
        quickPlanModalOverlay.addEventListener('click', (e) => {
            if (e.target === quickPlanModalOverlay) {
                quickPlanModalOverlay.classList.remove('active');
            }
        });
    }

    // Quick Plan form submission
    if (quickPlanSubmitBtn && quickPlanIdeaInput && quickPlanModalOverlay) {
        quickPlanSubmitBtn.addEventListener('click', async () => {
            const idea = quickPlanIdeaInput.value.trim();

            // Debug: Log quick plan submission start
            if (window.debugLog) {
                window.debugLog('[QUICK-PLAN] Starting quick plan submission', { ideaLength: idea.length, ideaPreview: idea.substring(0, 50) }, 'info');
            }

            if (!idea) {
                if (window.debugLog) {
                    window.debugLog('[QUICK-PLAN] Validation failed: empty idea', null, 'error');
                }
                if (quickPlanError) {
                    quickPlanError.textContent = 'Please enter a plan idea.';
                    quickPlanError.style.display = 'block';
                }
                return;
            }

            // Hide error and show loading state
            if (quickPlanError) {
                quickPlanError.style.display = 'none';
            }
            quickPlanSubmitBtn.classList.add('loading');
            quickPlanSubmitBtn.disabled = true;

            if (window.debugLog) {
                window.debugLog('[QUICK-PLAN] Calling /api/create-quick-plan...', { idea: idea }, 'info');
            }

            try {
                const response = await fetch('/api/create-quick-plan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ idea: idea })
                });

                if (window.debugLog) {
                    window.debugLog('[QUICK-PLAN] API response received', { status: response.status, ok: response.ok }, 'info');
                }

                const result = await response.json();

                if (window.debugLog) {
                    window.debugLog('[QUICK-PLAN] API response parsed', {
                        success: result.success,
                        newPlanId: result.newPlanId,
                        error: result.error || null
                    }, result.success ? 'success' : 'error');
                }

                if (!response.ok || !result.success) {
                    throw new Error(result.error || 'Failed to create plan');
                }

                // Success - close modal and navigate to the new plan
                quickPlanModalOverlay.classList.remove('active');
                quickPlanIdeaInput.value = '';

                // Navigate to the new plan using URL parameters
                if (result.newPlanId) {
                    if (window.debugLog) {
                        window.debugLog('[QUICK-PLAN] Navigating to new plan', { planId: result.newPlanId }, 'success');
                    }
                    updateUrl({ category: null, subcategory: null, view: 'plan', session: result.newPlanId });
                    applyFiltersAndSort(imageCache);

                    // Debug: Start polling for enrichment results
                    if (window.debugLog) {
                        window.debugLog('[QUICK-PLAN] Plan created - background enrichment triggered. Watch for AI enrichment results...', null, 'info');
                        // Poll for enrichment completion by watching for plan data updates
                        startQuickPlanEnrichmentPolling(result.newPlanId);
                    }
                }
            } catch (error) {
                console.error('Quick Plan error:', error);
                if (window.debugLog) {
                    window.debugLog('[QUICK-PLAN] Error creating plan', { error: error.message }, 'error');
                }
                if (quickPlanError) {
                    quickPlanError.textContent = error.message || 'Something went wrong. Please try again.';
                    quickPlanError.style.display = 'block';
                }
            } finally {
                quickPlanSubmitBtn.classList.remove('loading');
                quickPlanSubmitBtn.disabled = false;
            }
        });

        // Allow Enter key to submit (Shift+Enter for new line)
        quickPlanIdeaInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                quickPlanSubmitBtn.click();
            }
        });
    }

    /**
     * Poll for enrichment results after quick plan creation
     * This helps debug whether the AI enrichment is completing successfully
     * @param {string} planId - The new plan ID to poll for
     */
    window.startQuickPlanEnrichmentPolling = async function(planId) {
        if (!window.debugLog) return;

        window.debugLog('[QUICK-PLAN] Starting enrichment polling', { planId }, 'info');

        let attempts = 0;
        const maxAttempts = 15; // Poll for up to 30 seconds
        const pollInterval = 2000; // Poll every 2 seconds

        const poll = async () => {
            attempts++;
            window.debugLog(`[QUICK-PLAN] Enrichment poll attempt ${attempts}/${maxAttempts}`, { planId }, 'info');

            try {
                const response = await fetch(`/api/get-project?id=${planId}`);
                if (response.ok) {
                    const project = await response.json();

                    // Check if enrichment fields are populated (AI sets Plan_Type, Date, Goals, etc.)
                    const hasEnrichment = project.Plan_Type ||
                                          project.Date ||
                                          project['Guest Count'] ||
                                          project.Location ||
                                          (project.Goals && project.Goals !== project.Name);

                    window.debugLog('[QUICK-PLAN] Project data fetched', {
                        name: project.Name,
                        planType: project.Plan_Type || '(not set)',
                        date: project.Date || '(not set)',
                        goals: project.Goals ? project.Goals.substring(0, 100) : '(not set)',
                        guestCount: project['Guest Count'] || '(not set)',
                        location: project.Location || '(not set)',
                        hasEnrichment
                    }, hasEnrichment ? 'success' : 'data');

                    if (hasEnrichment) {
                        window.debugLog('[QUICK-PLAN] AI Enrichment completed!', {
                            extractedFields: {
                                name: project.Name,
                                type: project.Plan_Type,
                                date: project.Date,
                                goals: project.Goals,
                                guestCount: project['Guest Count'],
                                location: project.Location
                            }
                        }, 'success');
                        return; // Stop polling
                    }

                    if (attempts >= maxAttempts) {
                        window.debugLog('[QUICK-PLAN] Max polling attempts reached - enrichment may still be in progress or failed', null, 'error');
                        return; // Stop polling
                    }

                    // Continue polling
                    setTimeout(poll, pollInterval);
                } else {
                    window.debugLog('[QUICK-PLAN] Project fetch failed', { status: response.status }, 'error');
                    if (attempts < maxAttempts) {
                        setTimeout(poll, pollInterval);
                    }
                }
            } catch (error) {
                window.debugLog('[QUICK-PLAN] Enrichment poll error', { error: error.message }, 'error');
                if (attempts < maxAttempts) {
                    setTimeout(poll, pollInterval);
                }
            }
        };

        // Start polling after a short delay to give the backend time to start enrichment
        setTimeout(poll, 1500);
    };

    const menuRecentChatsBtn = document.getElementById('menu-recent-chats-btn');
    if (menuRecentChatsBtn) {
        menuRecentChatsBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            // Open the chat widget and expand the recent chats dropdown
            openChatWidget(true);
            // Use setTimeout to ensure the chat widget is visible before toggling
            setTimeout(() => {
                toggleRecentChats(true);
            }, 100);
        });
    }

    // Account/Settings button handler - opens the user profile modal
    const menuSettingsBtn = document.getElementById('menu-settings-btn');
    if (menuSettingsBtn) {
        menuSettingsBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            showUserModal();
        });
    }

    /**
     * Updates the active state of hamburger menu items based on current view
     */
    function updateHamburgerMenuActiveState() {
        const urlParams = new URLSearchParams(window.location.search);
        const currentView = urlParams.get('view');
        const currentCategory = urlParams.get('category');

        // Get all menu buttons that can have active states
        const menuButtons = {
            'menu-catalog-btn': !currentView && !currentCategory,
            'calendar-view-btn': currentView === 'calendar',
            'menu-plan-btn': currentView === 'plan',
            'menu-likes-btn': currentView === 'likes',
            'menu-sessions-btn': currentView === 'my-sessions',
            'menu-projects-btn': false // Projects panel doesn't use URL view
        };

        // Update active states
        Object.entries(menuButtons).forEach(([btnId, isActive]) => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.classList.toggle('active', isActive);
            }
        });
    }

    // Update active state on URL changes
    window.addEventListener('popstate', updateHamburgerMenuActiveState);

    // Initial active state update
    updateHamburgerMenuActiveState();

    // Also update when menu is opened (in case state changed)
    if (hamburgerMenuBtn) {
        const originalClickHandler = hamburgerMenuBtn.onclick;
        hamburgerMenuBtn.addEventListener('click', () => {
            updateHamburgerMenuActiveState();
        });
    }

    /**
     * Close hamburger menu on scroll
     */
    let lastScrollY = window.scrollY;
    let scrollThreshold = 50; // Minimum scroll distance to trigger close

    window.addEventListener('scroll', () => {
        if (hamburgerMenuDropdown && hamburgerMenuDropdown.style.display !== 'none') {
            const scrollDelta = Math.abs(window.scrollY - lastScrollY);
            if (scrollDelta > scrollThreshold) {
                hamburgerMenuDropdown.style.display = 'none';
                lastScrollY = window.scrollY;
            }
        } else {
            lastScrollY = window.scrollY;
        }
    }, { passive: true });

    // --- END HAMBURGER MENU NAVIGATION BUTTONS ---

    const toggleFilter = (elementId, settingName) => {
        const container = document.getElementById(elementId)?.parentElement;
        if (container) {
            if (elementId === 'subcategory-filters') {
                container.style.display = 'none';
            } else {
                container.style.display = shopSettings.enabledFilters.includes(settingName) ? 'flex' : 'none';
            }
        }
    };

    toggleFilter('subcategory-filters', 'Subcategories'); 
    toggleFilter('date-filter-group', 'Date & Time');
    toggleFilter('headcount-filter', 'Headcount');
    toggleFilter('location-filter', 'Location');
    toggleFilter('budget-filter', 'Budget');

    safeAddEventListener('status-filter', 'change', () => applyFiltersAndSort(imageCache));
    
    safeAddEventListener('name-filter', 'input', debounce((e) => {
        const searchTerm = e.target.value.trim();

        if (aiSearchController) {
            aiSearchController.abort();
        }

        applyFiltersAndSort(imageCache);

        // Only trigger hybrid search if search term is substantive (> 2 chars)
        if (searchTerm.length > 2) {
            const hasOtherFilters =
                document.getElementById('status-filter').value !== 'Available' ||
                document.getElementById('headcount-filter').value !== 'any' ||
                document.getElementById('location-filter').value !== 'any' ||
                document.getElementById('budget-filter').value !== 'any' ||
                (new URLSearchParams(window.location.search).get('category') !== null);

            // Don't trigger hybrid display if user has other filters active
            if (!hasOtherFilters) {
                // Get the current filtered results as "catalog matches"
                const catalogMatches = state.records.filtered.slice(0, 10); // Limit to top 10

                log('Events', `Triggering hybrid search for "${searchTerm}" with ${catalogMatches.length} catalog matches`);
                handleHybridSearchDisplay(searchTerm, imageCache, catalogMatches);
            }
        }


    }, 300)); 
    
    safeAddEventListener('clear-search-btn', 'click', () => {
        handleFilterChipClear({
            target: document.querySelector('#filter-chip-container .filter-chip[data-filter-type="name-filter"] button')
        });
        document.getElementById('name-filter').blur();
        // Clear AI refinement chips when search is cleared
        clearRefinementChips();
    });
    safeAddEventListener('headcount-custom', 'input', debounce(() => applyFiltersAndSort(imageCache), 300));
    safeAddEventListener('headcount-filter', 'change', (e) => {
        document.getElementById('headcount-custom').style.display = (e.target.value === 'custom') ? 'block' : 'none';
        applyFiltersAndSort(imageCache);
    });
    safeAddEventListener('location-filter', 'change', () => applyFiltersAndSort(imageCache));
    safeAddEventListener('budget-filter', 'change', () => applyFiltersAndSort(imageCache));
    safeAddEventListener('sort-by', 'change', () => applyFiltersAndSort(imageCache));

    safeAddEventListener('reset-filters-btn', 'click', () => {
        updateUrl({ category: null, subcategory: null, view: null });
        
        const allButton = document.querySelector('#category-filters .filter-btn[data-filter="all"]');
        if (allButton) {
            document.querySelectorAll('#category-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
            allButton.classList.add('active');
        }

        document.getElementById('name-filter').value = '';
        document.getElementById('status-filter').value = 'Available';
        document.getElementById('headcount-filter').selectedIndex = 0;
        document.getElementById('headcount-custom').value = '';
        document.getElementById('headcount-custom').style.display = 'none';
        document.getElementById('location-filter').selectedIndex = 0;
        document.getElementById('budget-filter').selectedIndex = 0;
        document.getElementById('sort-by').selectedIndex = 0;
        if (mainDatePicker) mainDatePicker.clear();
        applyFiltersAndSort(imageCache);
    });

    // Lazy load Flatpickr when date filter is focused
    const dateFilterInput = document.getElementById('date-filter');
    if (dateFilterInput) {
        const initializeDatePicker = async () => {
            if (!mainDatePicker) {
                try {
                    log('Events', 'Loading Flatpickr dynamically...');
                    await loadFlatpickr();
                    
                    if (!window.flatpickr) {
                        throw new Error('Flatpickr not available after loading');
                    }
                    
                    if (typeof window.flatpickr !== 'function') {
                        throw new Error(`Flatpickr is not a function, got type: ${typeof window.flatpickr}`);
                    }
                    
                    mainDatePicker = window.flatpickr(dateFilterInput, {
                        mode: "range",
                        dateFormat: "M j, Y",
                        onChange: async (selectedDates) => {
                            if (state.ui.isInitializing) return;
                            if (selectedDates.length > 0) {
                                if (selectedDates.length === 2) {
                                    selectedDates[1].setHours(23, 59, 59, 999);
                                }
                                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString()));
                                triggerSave();
                                await updateAllCardAvailabilityIcons();
                            } else {
                                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
                                triggerSave();
                                await updateAllCardAvailabilityIcons();
                                await updateMobileBarAvailability();
                            }
                        },
                    });
                    
                    // Store the flatpickr instance on the input element
                    dateFilterInput._flatpickr = mainDatePicker;
                    
                    // Open the calendar after initialization
                    mainDatePicker.open();
                    
                    log('Events', 'Date filter picker initialized successfully');
                } catch (error) {
                    log('Events', `Error initializing date picker: ${error.message}`);
                    console.error('Flatpickr initialization error:', error);
                }
            } else {
                // If already initialized, just open it
                mainDatePicker.open();
            }
        };
        
        dateFilterInput.addEventListener('focus', initializeDatePicker);
    }

    safeAddEventListener('date-filter-group', 'click', async (e) => {
        const quickButton = e.target.closest('[data-date-quick]');
        if (!quickButton) return;
        
        const dateFilterInput = document.getElementById('date-filter');
        if (!dateFilterInput) return;
        
        if (!mainDatePicker) {
            try {
                log('Events', 'Loading Flatpickr for quick select button...');
                await loadFlatpickr();
                
                if (!window.flatpickr) {
                    throw new Error('Flatpickr not available after loading');
                }
                
                if (typeof window.flatpickr !== 'function') {
                    throw new Error(`Flatpickr is not a function, got type: ${typeof window.flatpickr}`);
                }
                
                mainDatePicker = window.flatpickr(dateFilterInput, {
                    mode: "range",
                    dateFormat: "M j, Y",
                    onChange: async (selectedDates) => {
                        if (selectedDates.length === 2) {
                            selectedDates[1].setHours(23, 59, 59, 999);
                            state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString()));
                            triggerSave();
                            await updateAllCardAvailabilityIcons();
                        } else {
                            state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
                            triggerSave();
                            await updateAllCardAvailabilityIcons();
                            await updateMobileBarAvailability();
                        }
                    },
                });
                
                // Store the flatpickr instance on the input element
                dateFilterInput._flatpickr = mainDatePicker;
                
                log('Events', 'Date filter picker initialized from quick select');
            } catch (error) {
                log('Events', `Error initializing date picker: ${error.message}`);
                console.error('Flatpickr initialization error:', error);
                return;
            }
        }
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let startDate = new Date(today);
        let endDate = new Date(today);
        const quickFilterType = quickButton.dataset.dateQuick;
        switch (quickFilterType) {
            case 'tomorrow':
                startDate.setDate(today.getDate() + 1);
                endDate.setDate(today.getDate() + 1);
                break;
            case 'this-week':
                endDate.setDate(today.getDate() + (6 - today.getDay()));
                break;
            case 'next-2-weeks':
                endDate.setDate(today.getDate() + 14);
                break;
        }
        mainDatePicker.setDate([startDate, endDate], true);
    });

    safeAddEventListener('header-event-name', 'change', (e) => {
        if (state.ui.isInitializing) return;
        const hadValue = state.eventDetails.combined.has(CONSTANTS.DETAIL_TYPES.EVENT_NAME);
        const newValue = e.target.value.trim();
        if (newValue && !hadValue) {
            updateProgress(0.0001); // Adding event name progresses
        } else if (!newValue && hadValue) {
            updateProgress(-0.0001); // Removing event name regresses
        }
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        // Clear auto-generated flag when user manually edits the title
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.TITLE_AUTO_GENERATED, false);

        // Update the plan name in the recent chats list
        updateCurrentSessionName(e.target.value);

        triggerSave();
    });

    safeAddEventListener('header-goals', 'change', (e) => {
        if (state.ui.isInitializing) return;
        const hadValue = state.eventDetails.combined.has(CONSTANTS.DETAIL_TYPES.GOALS);
        const newValue = e.target.value.trim();
        if (newValue && !hadValue) {
            updateProgress(0.0001); // Adding goals progresses
        } else if (!newValue && hadValue) {
            updateProgress(-0.0001); // Removing goals regresses
        }
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        // Clear auto-generated flag when user manually edits the description
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DESCRIPTION_AUTO_GENERATED, false);
        triggerSave();
        if (document.getElementById('sort-by').value === 'recommended') {
            applyFiltersAndSort(imageCache);
        }
    });

    document.body.addEventListener('click', async (e) => {
        if (state.ui.isInitializing) {
            console.log('[EVENTS DEBUG] Body click ignored - still initializing');
            return;
        }

        const card = e.target.closest('.event-card');
        const heartIcon = e.target.closest('.heart-icon');
        const rsvpBtn = e.target.closest('.rsvp-btn');
        const ideaItem = e.target.closest('.favorite-item');
        const removeIdeaBtn = ideaItem?.querySelector('.remove-btn');
        const checkoutBtn = e.target.closest('#checkout-btn');
        const lockedItemCard = e.target.closest('.locked-item-card');
        const demoteBtn = e.target.closest('.demote-locked-item-btn');
        const parentLink = e.target.closest('.parent-link');
        const presentBtn = e.target.closest('.present-btn');
        const presentEventBtn = e.target.closest('.present-event-btn');
        const carouselNav = e.target.closest('.carousel-nav');
        const saveShareBtn = e.target.closest('#save-share-btn');
        const breadcrumbLink = e.target.closest('.breadcrumb-link');
        const addToPlanBtn = e.target.closest('.add-to-plan-btn, #modal-add-to-plan-btn');
        const addAnotherInstanceBtn = e.target.closest('#modal-add-another-instance-btn');
        const receiptLink = e.target.closest('.receipt-link, .receipt-btn');
        const openToEditBtn = e.target.closest('.open-to-edit-btn');
        const editEventBtn = e.target.closest('.edit-event-btn');
        const addPackageBtn = e.target.closest('.add-package-btn');

        const healthSuggestionBtn = e.target.closest('.health-suggestion-btn');

        // Handle "Add Package to Plan" button - Decision 6: populate locked items and ideas
        if (addPackageBtn) {
            e.stopPropagation();
            const recordId = addPackageBtn.dataset.recordId || addPackageBtn.closest('[data-record-id]')?.dataset.recordId;
            if (!recordId) return;

            addEnergy();

            const packageRecord = state.records.all.find(r => r.id === recordId);
            if (!packageRecord || packageRecord.fields['Item Type'] !== 'Package') {
                ui.showToast('Package not found');
                return;
            }

            // Get the package card to read stored data and selected headcount
            const packageCard = addPackageBtn.closest('.package-card');

            // Also check if this is from the detail modal
            const modalOverlay = addPackageBtn.closest('#detail-modal-overlay');
            const isFromModal = !!modalOverlay;

            // Fetch package contents from linked session
            let packageContents = { includedItems: [], addOnItems: [], tiers: [] };
            let packageMetadata = { discount: 0, tiers: [], price: 0, pricingType: null };
            const linkedSessionId = packageRecord.fields['LinkedSession'] ? packageRecord.fields['LinkedSession'][0] : null;

            if (linkedSessionId) {
                try {
                    const linkedSession = await api.fetchSessionById(linkedSessionId);
                    if (linkedSession && linkedSession.fields['Items with Variations']) {
                        const sessionData = JSON.parse(linkedSession.fields['Items with Variations']);

                        // Extract locked items as included items
                        const includedItems = [];
                        for (const [id, info] of Object.entries(sessionData.lockedInItems || {})) {
                            includedItems.push({
                                id,
                                quantity: info.quantity || 1,
                                options: info.selections || null,
                                locked: true
                            });
                        }

                        // Extract ideas as add-on items
                        const addOnItems = [];
                        for (const [id, info] of Object.entries(sessionData.ideasItems || {})) {
                            addOnItems.push({
                                id,
                                quantity: info.quantity || 1,
                                options: info.selections || null
                            });
                        }

                        packageContents = {
                            includedItems,
                            addOnItems,
                            tiers: sessionData.packageMetadata?.tiers || []
                        };

                        // Get package metadata if available
                        if (sessionData.packageMetadata) {
                            packageMetadata = sessionData.packageMetadata;
                        }
                    }
                } catch (e) {
                    console.warn('[Events] Could not fetch linked session for package', recordId, e);
                }
            }

            const includedItems = packageContents.includedItems || [];
            const addOnItems = packageContents.addOnItems || [];

            // Get selected tier if any
            const selectedTierBtn = packageCard?.querySelector('.tier-btn.selected');
            const selectedTierIndex = selectedTierBtn ? parseInt(selectedTierBtn.dataset.tierIndex, 10) : 0;

            // Get user-selected headcount from the package card or modal (for per-guest items)
            let selectedHeadcount = null;
            let defaultHeadcount = 1;

            if (isFromModal && modalOverlay) {
                // Get headcount from modal
                const modalHeadcountInput = modalOverlay.querySelector('.package-headcount-input');
                selectedHeadcount = modalHeadcountInput ? parseInt(modalHeadcountInput.value, 10) : null;
                // Also check the stored headcount in modal overlay's dataset
                if (!selectedHeadcount && modalOverlay.dataset.packageHeadcount) {
                    selectedHeadcount = parseInt(modalOverlay.dataset.packageHeadcount, 10);
                }
                defaultHeadcount = 1; // Modal sets proper defaults
            } else if (packageCard) {
                // Get headcount from catalog card
                const headcountInput = packageCard.querySelector('.package-headcount-input');
                selectedHeadcount = headcountInput ? parseInt(headcountInput.value, 10) : null;
                defaultHeadcount = packageCard.dataset.defaultHeadcount ? parseInt(packageCard.dataset.defaultHeadcount, 10) : 1;
            }

            const packageHeadcount = selectedHeadcount || defaultHeadcount;

            log('Events', `Adding package ${packageRecord.fields.Name} to plan`);
            log('Events', `Package has ${includedItems.length} included items and ${addOnItems.length} add-ons`);
            log('Events', `Package headcount: ${packageHeadcount}`);

            // Add all included items to lockedItems (Event Plan)
            let addedCount = 0;
            for (const itemRef of includedItems) {
                const itemId = itemRef.id || itemRef;
                const itemRecord = state.records.all.find(r => r.id === itemId);

                if (itemRecord && !state.cart.lockedItems.has(itemId)) {
                    // Check if this is a per-guest item - if so, use package headcount
                    // Items with null/missing pricing type are treated as flat rate (no headcount multiplication)
                    const pricingType = itemRecord.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
                    const isPerGuest = pricingType && pricingType.toLowerCase().includes('per guest');

                    // Use package headcount for per-guest items, otherwise use item's original quantity
                    let itemQuantity = itemRef.quantity || 1;
                    if (isPerGuest && packageHeadcount > itemQuantity) {
                        itemQuantity = packageHeadcount;
                    }

                    const itemInfo = {
                        quantity: itemQuantity,
                        selectedOptionIndex: itemRef.options?.group0 || 0,
                        selections: itemRef.options || {},
                        note: `From package: ${packageRecord.fields.Name}`,
                        packageId: recordId,
                        packageLocked: itemRef.locked !== false, // Locked items from package
                        packageHeadcount: isPerGuest ? packageHeadcount : null // Store headcount for per-guest items
                    };

                    // Enforce effective minimum quantity
                    const effectiveMin = getEffectiveMinQuantity(itemRecord);
                    if (itemInfo.quantity < effectiveMin) {
                        itemInfo.quantity = effectiveMin;
                    }

                    state.cart.lockedItems.set(itemId, itemInfo);
                    state.cart.items.delete(itemId); // Remove from ideas if present
                    addedCount++;
                    log('Events', `Added included item ${itemRecord.fields.Name} to locked items (qty: ${itemInfo.quantity}, perGuest: ${isPerGuest})`);
                }
            }

            // Add all add-on items to ideas (Save for Later section)
            let addOnCount = 0;
            for (const itemRef of addOnItems) {
                const itemId = itemRef.id || itemRef;
                const itemRecord = state.records.all.find(r => r.id === itemId);

                if (itemRecord && !state.cart.lockedItems.has(itemId) && !state.cart.items.has(itemId)) {
                    // Check if this is a per-guest item
                    // Items with null/missing pricing type are treated as flat rate (no headcount multiplication)
                    const pricingType = itemRecord.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
                    const isPerGuest = pricingType && pricingType.toLowerCase().includes('per guest');

                    let itemQuantity = itemRef.quantity || 1;
                    if (isPerGuest && packageHeadcount > itemQuantity) {
                        itemQuantity = packageHeadcount;
                    }

                    const itemInfo = {
                        quantity: itemQuantity,
                        selectedOptionIndex: itemRef.options?.group0 || 0,
                        selections: itemRef.options || {},
                        note: `Add-on from package: ${packageRecord.fields.Name}`,
                        packageId: recordId,
                        isPackageAddOn: true,
                        packageHeadcount: isPerGuest ? packageHeadcount : null
                    };

                    state.cart.items.set(itemId, itemInfo);
                    addOnCount++;
                    log('Events', `Added add-on item ${itemRecord.fields.Name} to ideas (qty: ${itemInfo.quantity}, perGuest: ${isPerGuest})`);
                }
            }

            // Store package metadata in session for reference
            if (!state.session.activePackages) {
                state.session.activePackages = new Map();
            }
            state.session.activePackages.set(recordId, {
                name: packageRecord.fields.Name,
                tierIndex: selectedTierIndex,
                headcount: packageHeadcount,
                discount: packageMetadata.discount || 0,
                addedAt: new Date().toISOString()
            });

            // Update progress
            const progressDelta = 0.0005 * (addedCount + addOnCount);
            updateProgress(progressDelta);

            // Update all UI
            ui.updateCardIcon(recordId);
            await ui.updateIdeasCarousel();
            await ui.updateEventPlanSection();
            ui.updateTotalCost();
            await updateAllCardAvailabilityIcons();
            await ui.updateLockedItemStatusIcons();
            updateMobileBarAvailability();

            // Close the modal if package was added from there
            if (isFromModal) {
                ui.hideDetailModal();
            }

            // Show success notification
            const notification = `Added package "${packageRecord.fields.Name}": ${addedCount} items to plan` +
                (addOnCount > 0 ? `, ${addOnCount} add-ons available in Ideas` : '');
            ui.showEventPlanNotification(notification);

            triggerSave();
            return;
        }

        // Handle "Edit Event" button for events that already have a linked session
        if (editEventBtn) {
            e.stopPropagation();
            const sessionId = editEventBtn.dataset.sessionId;
            if (!sessionId) {
                ui.showToast('Session not found');
                return;
            }

            log('Events', `Navigating to edit existing session ${sessionId}`);
            const currentShopId = state.ui.activeShopId;
            window.location.href = `${window.location.pathname}?session=${sessionId}&${getShopUrlParam(currentShopId, state.stores.all)}`;
            return;
        }

        // Handle "Present" button for events with linked sessions - view in presentation mode
        if (presentEventBtn) {
            e.stopPropagation();
            const sessionId = presentEventBtn.dataset.sessionId;
            const eventId = presentEventBtn.dataset.eventId;
            if (!sessionId) {
                ui.showToast('Session not found');
                return;
            }

            log('Events', `Opening presentation view for event session ${sessionId}`);

            // Show loading state
            presentEventBtn.disabled = true;
            const originalHTML = presentEventBtn.innerHTML;
            presentEventBtn.innerHTML = 'Loading...';

            try {
                // Navigate to the session with presentation view
                const currentShopId = state.ui.activeShopId;
                window.location.href = `${window.location.pathname}?session=${sessionId}&${getShopUrlParam(currentShopId, state.stores.all)}&view=present&eventId=${eventId}`;
            } catch (error) {
                console.error('Error opening presentation view:', error);
                ui.showToast(`Error: ${error.message}`);
                presentEventBtn.disabled = false;
                presentEventBtn.innerHTML = originalHTML;
            }
            return;
        }

        // Handle "Open to Edit" button for unaffiliated events
        if (openToEditBtn) {
            e.stopPropagation();
            const eventId = openToEditBtn.dataset.eventId;
            if (!eventId) return;

            const eventRecord = state.records.all.find(r => r.id === eventId);
            if (!eventRecord) {
                ui.showToast('Event not found');
                return;
            }

            // Show loading state
            openToEditBtn.disabled = true;
            const originalText = openToEditBtn.textContent;
            openToEditBtn.textContent = 'Creating Plan...';

            try {
                // Create a new session from this event
                const newSession = await api.createSessionFromEvent(
                    eventId,
                    eventRecord,
                    state.ui.activeShopId,
                    state.session.user.id
                );

                if (newSession && newSession.id) {
                    log('Events', `Created session ${newSession.id} from event ${eventId}, redirecting...`);

                    // Update the event record locally to reflect the new linked session
                    eventRecord.fields.LinkedSession = [newSession.id];

                    // Redirect to the new session for editing
                    const currentShopId = state.ui.activeShopId;
                    window.location.href = `${window.location.pathname}?session=${newSession.id}&${getShopUrlParam(currentShopId, state.stores.all)}`;
                } else {
                    throw new Error('Failed to create session');
                }
            } catch (error) {
                console.error('Error creating session from event:', error);
                ui.showToast(`Error: ${error.message}`);
                openToEditBtn.disabled = false;
                openToEditBtn.textContent = originalText;
            }
            return;
        }

        if (receiptLink) {
            e.preventDefault();
            e.stopPropagation();
            const paymentIndex = parseInt(receiptLink.dataset.paymentIndex, 10);
            if (!isNaN(paymentIndex)) {
                showReceiptModal(paymentIndex);
            }
        } else if (healthSuggestionBtn) {
            e.stopPropagation();
            const categoryToFilter = healthSuggestionBtn.dataset.categoryFilter;
            const normalizedCategory = categoryToFilter.toLowerCase().replace(/\s+/g, ' ');
            
            log('Events', `Health suggestion clicked. Filtering for: ${categoryToFilter}`);
            
            updateUrl({ category: normalizedCategory, subcategory: null, view: null });
            applyFiltersAndSort(imageCache);
            
            document.getElementById('catalog-area')?.scrollIntoView({ behavior: 'smooth' });
        }
        
        else if (saveShareBtn) {
            navigator.clipboard.writeText(window.location.href).then(() => {
                const originalText = saveShareBtn.textContent;
                saveShareBtn.textContent = 'Copied!';
                setTimeout(() => { saveShareBtn.textContent = originalText; }, 1500);
            }).catch(err => {
                console.error('Failed to copy link:', err);
                ui.showToast('Failed to copy link.');
            });
        } else if (breadcrumbLink) {
            e.preventDefault();
            const filterValue = breadcrumbLink.dataset.filter;
            if (filterValue === 'all') {
                updateUrl({ category: null, subcategory: null, view: null });
            } else {
                const normalizedFilter = filterValue.toLowerCase().replace(/\s+/g, ' ');
                updateUrl({ category: normalizedFilter, subcategory: null, view: null });
            }
            applyFiltersAndSort(imageCache);
        } else if (checkoutBtn) {
            ui.showCheckoutModal(shopSettings);
        } else if (rsvpBtn) {
            e.stopPropagation();
            const cardEl = rsvpBtn.closest('.event-card') || rsvpBtn.closest('[data-record-id]');
            const recordId = cardEl?.dataset.recordId;
            if (!recordId) return;

            const rsvpType = rsvpBtn.dataset.rsvpType || 'yes';
            const wasActive = rsvpBtn.classList.contains('active');

            // Party size ("number of RSVPs") from the detail modal, when present.
            // RSVP buttons on cards have no such control and stay at one spot.
            const partyQtyInput = document.getElementById('rsvp-quantity-input');
            const partyQty = partyQtyInput ? (parseInt(partyQtyInput.value, 10) || 1) : 1;

            let record = state.records.all.find(r => r.id === recordId);

            // --- Guest path: no sign-in wall. Hold the RSVP locally and add the
            // event to the plan; it is committed to Airtable when the guest creates
            // an account or signs in at checkout (see auth.js flush-on-login). ---
            if (!state.session.user.isAuthenticated) {
                const tempRsvps = getTempRsvps();
                if (wasActive) {
                    delete tempRsvps[recordId];
                    setTempRsvps(tempRsvps);
                    if (state.cart.lockedItems.has(recordId)) {
                        const info = state.cart.lockedItems.get(recordId) || {};
                        delete info.rsvpType;
                        state.cart.lockedItems.set(recordId, info);
                        triggerSave();
                    }
                    applyRsvpButtonState(rsvpBtn, null);
                    closeRsvpSignupPopup();
                    ui.showToast('RSVP removed.');
                } else {
                    tempRsvps[recordId] = { rsvpType, quantity: partyQty };
                    setTempRsvps(tempRsvps);
                    applyRsvpButtonState(rsvpBtn, rsvpType);

                    if (rsvpType === 'yes' || rsvpType === 'maybe') {
                        // Resolve the record if this is a deep-linked event not yet in memory.
                        if (!record) {
                            try {
                                const fetched = await api.fetchGhostItems([recordId]);
                                if (fetched && fetched.length) record = fetched[0];
                            } catch (err) {
                                log('Events', `Guest RSVP could not resolve event ${recordId}: ${err.message}`);
                            }
                        }
                        if (record) await autoAddEventToPlan(record, partyQty, rsvpType);
                    }

                    const labels = { yes: "You're going!", maybe: "Marked as maybe.", no: "Marked as can't go." };
                    const confirmMsg = labels[rsvpType] || 'RSVP updated!';
                    ui.showToast(confirmMsg);
                    if (rsvpType === 'yes' || rsvpType === 'maybe') {
                        showRsvpSignupPopup({ eventId: recordId, rsvpType, eventRecord: record });
                    } else {
                        closeRsvpSignupPopup();
                    }
                }
                return;
            }

            // --- Authenticated path: commit to Airtable / Postgres. ---
            rsvpBtn.disabled = true;
            const originalText = rsvpBtn.innerHTML;
            rsvpBtn.textContent = 'Saving...';

            try {
                let updatedRecord;
                if (wasActive) {
                    updatedRecord = await api.updateRsvpForEvent(recordId, state.session.user.id, null);
                    // Clearing the RSVP also clears the stored party size.
                    await api.clearEventRsvpQuantity(recordId);
                    if (state.cart.lockedItems.has(recordId)) {
                        const info = state.cart.lockedItems.get(recordId) || {};
                        delete info.rsvpType;
                        state.cart.lockedItems.set(recordId, info);
                        triggerSave();
                    }
                } else {
                    updatedRecord = await api.updateRsvpForEvent(recordId, state.session.user.id, rsvpType);
                    // Persist the party size alongside the response (best-effort).
                    await api.saveEventRsvpQuantity(recordId, rsvpType, partyQty);
                }

                if (updatedRecord) {
                    const recordIndex = state.records.all.findIndex(r => r.id === recordId);
                    if (recordIndex > -1) state.records.all[recordIndex] = updatedRecord;

                    // RSVPing yes / maybe also adds the event to the plan.
                    if (!wasActive && (rsvpType === 'yes' || rsvpType === 'maybe')) {
                        await autoAddEventToPlan(updatedRecord, partyQty, rsvpType);
                    }

                    if (document.getElementById('detail-modal-overlay')?.classList.contains('active')) {
                        ui.showDetailModal(updatedRecord);
                    }

                    // Show confirmation toast
                    if (wasActive) {
                        ui.showToast('RSVP removed.');
                    } else {
                        const labels = { yes: "You're going!", maybe: "Marked as maybe.", no: "Marked as can't go." };
                        const confirmMsg = labels[rsvpType] || 'RSVP updated!';
                        ui.showToast(rsvpType === 'yes' || rsvpType === 'maybe'
                            ? `${confirmMsg} A confirmation email is on its way.`
                            : confirmMsg
                        );
                    }
                } else {
                    throw new Error('RSVP update failed.');
                }
            } catch (error) {
                console.error("RSVP Error:", error);
                ui.showToast(`RSVP Error: ${error.message}`);
                rsvpBtn.innerHTML = originalText;
                rsvpBtn.disabled = false;
            }
        } else if (presentBtn) {
            const listType = presentBtn.dataset.listType;
            updateUrl({ view: 'present' });
            ui.showPresentationView(listType);
        } else if (carouselNav) {
            const carousel = document.getElementById('ideas-carousel'); 
            if (carousel) {
                const scrollAmount = 300;
                const direction = carouselNav.classList.contains('right') ? 1 : -1;
                carousel.scrollBy({ left: scrollAmount * direction, behavior: 'smooth' });
            }
        } else if (parentLink) {
            e.stopPropagation();
            const parentName = parentLink.dataset.parentName;
            if (parentName) {
                const parentRecord = state.records.all.find(r => r.fields.Name === parentName);
                if (parentRecord) {
                    const parentFilterName = parentName.toLowerCase().replace(/\s+/g, ' '); 
                    updateUrl({ category: parentFilterName, subcategory: null, view: null });
                    applyFiltersAndSort(imageCache);
                    
                    if (document.getElementById('detail-modal-overlay')?.classList.contains('active')) {
                        updateUrl({ openItem: null });
                        ui.hideDetailModal();
                    }
                }
            }
        } else if (heartIcon) {
            e.stopPropagation();
            addEnergy(); 
            const recordId = heartIcon.closest('[data-record-id]')?.dataset.recordId;
            if (!recordId) return;

            if (state.session.user.isAuthenticated) {
                try {
                    heartIcon.style.pointerEvents = 'none';
                    heartIcon.style.opacity = '0.6';
                    heartIcon.style.transform = 'scale(0.9)';

                    const result = await api.toggleUserLike(recordId);

                    if (result.success) {
                        if (result.liked) {
                            state.session.user.likedItemIds.add(recordId);
                            log('Events', `User liked item ${recordId}.`);
                        } else {
                            state.session.user.likedItemIds.delete(recordId);
                            log('Events', `User unliked item ${recordId}.`);
                        }
                        ui.updateCardIcon(recordId);

                        if (document.getElementById('liked-items-filter-btn')?.classList.contains('active')) {
                            applyFiltersAndSort(imageCache);
                        }
                    } else {
                         ui.showToast('Could not update like status. Please try again.');
                    }
                } catch (error) {
                    log('Events', `Error toggling like: ${error.message}`);
                    ui.showToast(`Error: ${error.message}`);
                } finally {
                    heartIcon.style.pointerEvents = 'auto';
                    heartIcon.style.opacity = '';
                    heartIcon.style.transform = '';
                }
            } else {
                log('Events', `Guest toggling temporary like for item ${recordId}.`);
                const tempLikesSet = getTempLikes();
                let currentlyLiked = false;
                if (tempLikesSet.has(recordId)) {
                    tempLikesSet.delete(recordId);
                    currentlyLiked = false;
                } else {
                    tempLikesSet.add(recordId);
                    currentlyLiked = true;
                }
                setTempLikes(tempLikesSet);
                log('Events', `Temporary likes updated: ${Array.from(tempLikesSet).join(', ')}`);
                ui.updateCardIcon(recordId);
                if (currentlyLiked) {
                     ui.showLoginPromptForLikes();
                }
                if (document.getElementById('liked-items-filter-btn')?.classList.contains('active')) {
                      applyFiltersAndSort(imageCache);
                 }
            }
        }
        
        else if (addAnotherInstanceBtn) {
            e.stopPropagation();

            const modalOverlay = document.getElementById('detail-modal-overlay');
            const currentRecordId = modalOverlay?.dataset.recordId;
            const currentRecord = state.records.all.find(record => record.id === currentRecordId)
                || window._solutionRecords?.get(currentRecordId);
            if (!currentRecordId || !currentRecord) return;

            const catalogRecordId = getCatalogRecordId(
                currentRecordId,
                state.cart.lockedItems.get(currentRecordId),
                currentRecord
            );
            const existingInstances = getPlanInstancesForCatalog(
                state.cart.lockedItems,
                catalogRecordId,
                id => state.records.all.find(record => record.id === id)
            );
            if (existingInstances.length === 0) return;

            addAnotherInstanceBtn.disabled = true;
            addAnotherInstanceBtn.textContent = 'Adding Instance…';

            try {
                const sourceInstance = existingInstances.find(instance => instance.recordId === currentRecordId) || existingInstances[0];
                const instanceId = createPlanInstanceId(catalogRecordId);
                const instanceRecord = createPlanInstanceRecord(currentRecord, instanceId, catalogRecordId);
                const instanceInfo = cloneItemInfoForAnotherInstance(sourceInstance.itemInfo, catalogRecordId);

                state.records.all.push(instanceRecord);
                invalidateRecordsIndex();
                state.cart.lockedItems.set(instanceId, instanceInfo);
                if (state.session.planItemOrder?.length > 0) state.session.planItemOrder.push(instanceId);
                triggerSave();

                const newCount = existingInstances.length + 1;
                addEnergy();
                updateProgress(0.0002 * (instanceInfo.quantity || 1));
                ui.updateCardButtonText(catalogRecordId, true);
                await ui.updateEventPlanSection();
                ui.updateTotalCost();
                await updateAllCardAvailabilityIcons();
                await ui.updateLockedItemStatusIcons();
                updateMobileBarAvailability();
                broadcastItemAdded(instanceId, currentRecord.fields?.Name || 'Item');

                addAnotherInstanceBtn.textContent = `Add Another Instance (${newCount} in plan)`;
                ui.showEventPlanNotification(`Added another instance of “${currentRecord.fields?.Name || 'Item'}”.`);
            } catch (error) {
                console.error('[PlanInstances] Failed to add another instance:', error);
                addAnotherInstanceBtn.textContent = 'Add Another Instance';
                ui.showToast('Could not add another instance. Please try again.');
            } finally {
                addAnotherInstanceBtn.disabled = false;
            }
        }

        else if (addToPlanBtn) {
            e.stopPropagation();
            const recordId = addToPlanBtn.closest('[data-record-id]')?.dataset.recordId;
            console.log('[DEBUG Events] Add to Plan clicked, recordId:', recordId);
            if (!recordId) {
                console.log('[DEBUG Events] No recordId found - exiting');
                return;
            }

            addEnergy();

            // Check if this is Union Machine Works being added
            let record = state.records.all.find(r => r.id === recordId);

            // DEBUG: Check if this is a solution item (not in state.records.all)
            const isSolutionItem = recordId?.startsWith('solution-');
            console.log('[DEBUG Events] Looking for record in state.records.all:', {
                recordId,
                found: !!record,
                isSolutionItem,
                solutionRecordsAvailable: !!window._solutionRecords,
                solutionRecordExists: window._solutionRecords?.has(recordId)
            });

            // If it's a solution item, try to get from the solution registry
            if (!record && isSolutionItem && window._solutionRecords) {
                record = window._solutionRecords.get(recordId);
                console.log('[DEBUG Events] Retrieved solution record from registry:', record);
            }

            if (!record) {
                console.log('[DEBUG Events] Record not found - exiting. This is the issue: solution items are not in state.records.all');
                return;
            }

            const isUmwBeingAdded = record.fields.Name && record.fields.Name.includes("Union Machine Works");

            // Store whether UMW was in plan BEFORE this addition
            const wasUmwInPlan = Array.from(state.cart.lockedItems.keys()).some(id => {
                const lockedRecord = state.records.all.find(r => r.id === id);
                return lockedRecord && lockedRecord.fields.Name && lockedRecord.fields.Name.includes("Union Machine Works");
            });

            if (state.cart.lockedItems.has(recordId)) {
                if (document.getElementById('detail-modal-overlay')?.classList.contains('active')) {
                    updateUrl({ openItem: null });
                    ui.hideDetailModal();
                }
                return;
            }

            let itemInfo;
            const modalOverlay = document.getElementById('detail-modal-overlay');
            if (modalOverlay?.classList.contains('active') && modalOverlay.dataset.recordId === recordId) {
                const isEventRecord = record.fields?.['Item Type'] === 'Event';
                const quantityInput = isEventRecord
                    ? document.getElementById('rsvp-quantity-input')
                    : document.querySelector('#modal-quantity-selector .quantity-input');
                const quantity = parseFloat(quantityInput?.value) || 1;
                const note = document.getElementById('modal-item-note')?.value || '';

                // Extract selections from option groups
                // Supports both single-select (returns number) and multi-select (returns array)
                const selections = {};
                const optionGroups = document.querySelectorAll('#modal-options-container .option-group');
                if (optionGroups.length > 0) {
                    optionGroups.forEach((group) => {
                        const groupIndex = group.dataset.groupIndex;
                        const selectedBtns = group.querySelectorAll('.option-btn.selected');
                        if (selectedBtns.length > 0 && groupIndex !== undefined) {
                            if (selectedBtns.length === 1) {
                                // Single selection - store as number
                                selections[`group${groupIndex}`] = parseInt(selectedBtns[0].dataset.optionIndex, 10) || 0;
                            } else {
                                // Multi-selection - store as sorted array
                                const indices = Array.from(selectedBtns)
                                    .map(btn => parseInt(btn.dataset.optionIndex, 10) || 0)
                                    .sort((a, b) => a - b);
                                selections[`group${groupIndex}`] = indices;
                            }
                        }
                    });
                } else {
                    // Legacy: single flat list of options
                    const selectedBtn = document.querySelector('#modal-options-container .option-btn.selected');
                    if (selectedBtn) {
                        const selectedOptionIndex = parseInt(selectedBtn.dataset.optionIndex, 10) || 0;
                        selections['group0'] = selectedOptionIndex;
                    }
                }

                // Compute legacy selectedOptionIndex from selections for backward compatibility
                let selectedOptionIndex = 0;
                if (Object.keys(selections).length > 0) {
                    // For now, use the first group's selection as the legacy index
                    const group0Selection = selections['group0'];
                    selectedOptionIndex = Array.isArray(group0Selection)
                        ? (group0Selection[0] || 0)
                        : (group0Selection || 0);
                }

                itemInfo = { quantity, selectedOptionIndex, selections, note };

                // Extract per-item time fields from modal (if populated)
                const modalItemStartTime = document.getElementById('modal-item-start-time')?.value || '';
                const modalItemDurationRaw = document.getElementById('modal-item-duration')?.value || '';
                const modalItemDateEl = document.getElementById('modal-item-date');
                if (modalItemStartTime) itemInfo.itemStartTime = modalItemStartTime;
                // Duration: dropdown value is minutes as a number string
                if (modalItemDurationRaw) {
                    const parsed = parseInt(modalItemDurationRaw, 10);
                    if (parsed > 0) itemInfo.itemDuration = parsed;
                }
                // For time-priced items (e.g. per hour) the quantity is the duration,
                // so derive itemDuration from quantity rather than the hidden dropdown.
                const itemUnitMinutes = getTimeUnitMinutes(record);
                if (itemUnitMinutes) {
                    itemInfo.itemDuration = Math.round((parseFloat(quantity) || 1) * itemUnitMinutes);
                }
                // Compute end time from start time + duration
                if (itemInfo.itemStartTime && itemInfo.itemDuration) {
                    const timeMatch = itemInfo.itemStartTime.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
                    if (timeMatch) {
                        let h = parseInt(timeMatch[1], 10);
                        const m = parseInt(timeMatch[2], 10);
                        const mer = timeMatch[3] ? timeMatch[3].toUpperCase() : null;
                        if (mer === 'PM' && h !== 12) h += 12;
                        else if (mer === 'AM' && h === 12) h = 0;
                        const endMin = (h * 60 + m + itemInfo.itemDuration) % (24 * 60);
                        const eH = Math.floor(endMin / 60);
                        const eM = endMin % 60;
                        const endStr = eH === 0 ? `12:${String(eM).padStart(2, '0')} AM` :
                                       eH < 12 ? `${eH}:${String(eM).padStart(2, '0')} AM` :
                                       eH === 12 ? `12:${String(eM).padStart(2, '0')} PM` :
                                       `${eH - 12}:${String(eM).padStart(2, '0')} PM`;
                        itemInfo.itemEndTime = endStr;
                    }
                }
                // Date: extract from Flatpickr instance (single date)
                if (modalItemDateEl?._flatpickr) {
                    const selectedDates = modalItemDateEl._flatpickr.selectedDates;
                    if (selectedDates.length >= 1) {
                        itemInfo.itemDate = selectedDates[0].toISOString();
                        delete itemInfo.itemDateEnd;
                    }
                } else {
                    const modalItemDate = modalItemDateEl?.value?.trim() || '';
                    if (modalItemDate) itemInfo.itemDate = modalItemDate;
                }

                // Preserve any locally-generated options
                // These are AI-generated options that were applied but not saved to catalog
                const existingItemInfo = state.cart.items.get(recordId);
                if (existingItemInfo?.generatedOptions) {
                    // Carry over from Ideas
                    itemInfo.generatedOptions = existingItemInfo.generatedOptions;
                } else if (record._locallyGeneratedOptions) {
                    // Capture newly generated options from this modal session
                    itemInfo.generatedOptions = record._locallyGeneratedOptions;
                    delete record._locallyGeneratedOptions; // Clean up the temporary marker
                }

                updateUrl({ openItem: null });
                ui.hideDetailModal();
            } else {
                itemInfo = ui.getItemState(recordId);
                // Also capture locally generated options if not already present
                if (!itemInfo.generatedOptions && record._locallyGeneratedOptions) {
                    itemInfo.generatedOptions = record._locallyGeneratedOptions;
                    delete record._locallyGeneratedOptions;
                }
            }

            // Store the last attempted quantity
            const lastAttemptedQuantity = itemInfo.quantity || 1;
            itemInfo.lastAttemptedQuantity = lastAttemptedQuantity;

            // Enforce effective minimum quantity
            const effectiveMin = getEffectiveMinQuantity(record);
            const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
            let quantityToSave = itemInfo.quantity || 1;

            // Check if UMW is in plan NOW (after potential addition)
            let isUmwInPlanNow = wasUmwInPlan || isUmwBeingAdded;

            if (quantityToSave < effectiveMin) {
                quantityToSave = effectiveMin;
                // Only show notification if UMW is NOT in the plan (off-site event)
                if (!isUmwInPlanNow && airtableMin > 1) {
                    ui.showEventPlanNotification(`Quantity adjusted to minimum (${effectiveMin}) for off-site event.`);
                } else if (isUmwInPlanNow && airtableMin > 1) {
                    // UMW is in plan, show different message
                    ui.showEventPlanNotification(`Headcount permitted below minimum as on-site at Union Machine Works.`);
                }
            }

            // Update itemInfo with enforced quantity
            itemInfo.quantity = quantityToSave;

            itemInfo.catalogRecordId = getCatalogRecordId(recordId, itemInfo, record);
            state.cart.lockedItems.set(recordId, itemInfo);
            state.cart.items.delete(recordId);

            console.log('[DEBUG Events] Successfully added item to lockedItems:', {
                recordId,
                itemName: record.fields?.Name,
                isSolution: record.isSolution,
                itemInfo
            });

            // Add progress for adding item to plan (scaled by quantity)
            const progressDelta = 0.0002 * (itemInfo.quantity || 1);
            updateProgress(progressDelta);

            ui.updateCardIcon(recordId);
            ui.updateCardButtonText(recordId, true);
            await ui.updateIdeasCarousel();
            await ui.updateEventPlanSection();
            ui.updateTotalCost();
            await updateAllCardAvailabilityIcons();
            await ui.updateLockedItemStatusIcons();
            updateMobileBarAvailability();

            // If UMW was just added, check all other items and adjust their quantities
            if (isUmwBeingAdded && !wasUmwInPlan) {
                handleUmwAddition();
            }

            // Phase 5: Broadcast the item addition to collaborators
            broadcastItemAdded(recordId, record.fields?.Name || 'Item');

            // Sync plan state across all views
            syncPlanState('catalog', 'itemAdded', { recordId, itemName: record.fields?.Name || 'Item' });

            // Post plan event to session history
            const sessionId = state.session.id;
            if (sessionId && sessionId.startsWith('rec')) {
                api.postPlanEvent(sessionId, api.PLAN_EVENT_TYPES.ITEM_ADDED, {
                    itemName: record.fields?.Name || 'Item',
                    itemId: recordId,
                    quantity: itemInfo.quantity || 1
                }).then(eventRecord => {
                    if (eventRecord) {
                        addPlanEventToHistory(eventRecord);
                    }
                }).catch(err => {
                    log('Events', `Failed to post item_added event: ${err.message}`);
                });
            }

            triggerSave();
        } else if (demoteBtn) {
            e.stopPropagation();
            const recordId = demoteBtn.closest('[data-record-id]')?.dataset.recordId;
            if (!recordId || !state.cart.lockedItems.has(recordId)) return;

            // Check if this is Union Machine Works being removed
            const record = state.records.all.find(r => r.id === recordId);
            const isUmwBeingRemoved = record && record.fields.Name && record.fields.Name.includes("Union Machine Works");

            const itemInfo = state.cart.lockedItems.get(recordId);
            state.cart.lockedItems.delete(recordId);
            state.cart.items.set(recordId, itemInfo);

            // Regress progress when demoting item from plan
            const progressDelta = -0.0002 * (itemInfo.quantity || 1);
            updateProgress(progressDelta);

            ui.updateCardIcon(recordId);
            ui.updateCardButtonText(recordId, false);
            await ui.updateEventPlanSection();
            await ui.updateIdeasCarousel();
            ui.updateTotalCost();
            await updateAllCardAvailabilityIcons();
            await ui.updateLockedItemStatusIcons();
            updateMobileBarAvailability();

            // If UMW was just removed, check all other items and adjust their quantities
            if (isUmwBeingRemoved) {
                handleUmwRemoval();
            }

            // Phase 5: Broadcast the item removal to collaborators
            broadcastItemRemoved(recordId, record?.fields?.Name || 'Item');

            // Sync plan state across all views
            syncPlanState('catalog', 'itemRemoved', { recordId, itemName: record?.fields?.Name || 'Item' });

            triggerSave();
        } else if (e.target.closest('.dig-solution-btn')) {
            // Handle "Dig Info" button for AI solution items - research and fill in details
            e.stopPropagation();
            const digBtn = e.target.closest('.dig-solution-btn');
            const recordId = digBtn.dataset.recordId;

            if (!recordId) {
                log('Events', 'Dig button clicked but no record ID found');
                return;
            }

            log('Events', `Digging for details on solution: ${recordId}`);

            // Find the solution record in the registry
            let solutionRecord = null;
            if (recordId.startsWith('solution-') && window._solutionRecords) {
                solutionRecord = window._solutionRecords.get(recordId);
            }

            if (!solutionRecord) {
                log('Events', `Solution record ${recordId} not found in registry`);
                ui.showToast('Could not find solution record');
                return;
            }

            // Update button to show loading state
            const originalContent = digBtn.innerHTML;
            digBtn.innerHTML = '<span style="font-size: 1em;">&#x23F3;</span> Researching...';
            digBtn.disabled = true;
            digBtn.style.opacity = '0.7';

            try {
                // Call the API to research the solution
                const result = await api.digSolutionDetails(solutionRecord);

                if (!result.success) {
                    throw new Error(result.error || 'Failed to research solution');
                }

                const research = result.research;
                log('Events', `Successfully researched solution ${recordId} with confidence ${research.confidence}`);

                // Update the solution record with research data
                solutionRecord._researchData = research;

                // Update fields with researched information
                if (research.name) solutionRecord.fields.Name = research.name;
                if (research.description) solutionRecord.fields.Description = research.description;
                if (research.price?.estimate) solutionRecord.fields.Price = research.price.estimate;
                if (research.price?.pricingType) solutionRecord.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] = research.price.pricingType;

                // Add location details
                if (research.location?.serviceArea) {
                    solutionRecord.fields['Location Details'] = research.location.serviceArea;
                    if (research.location.type) {
                        solutionRecord.fields['Location Details'] += ` (${research.location.type} service)`;
                    }
                }

                // Add availability/lead time info to Additional Information
                let additionalInfo = '';
                if (research.availability?.leadTime) {
                    additionalInfo += `Booking: ${research.availability.leadTime}`;
                }
                if (research.availability?.hours) {
                    additionalInfo += additionalInfo ? '\n\n' : '';
                    additionalInfo += `Hours: ${research.availability.hours}`;
                }
                if (research.goodToKnow) {
                    additionalInfo += additionalInfo ? '\n\n' : '';
                    additionalInfo += `Good to Know: ${research.goodToKnow}`;
                }
                if (additionalInfo) {
                    solutionRecord.fields['Additional Information'] = additionalInfo;
                }

                // Add rankings/profile data
                if (research.rankings) {
                    const rankingsData = {
                        profileSource: 'ai_solution_research',
                        Fun: research.rankings.Fun || 0,
                        Social: research.rankings.Social || 0,
                        Active: research.rankings.Active || 0,
                        Creative: research.rankings.Creative || 0,
                        Learning: research.rankings.Learning || 0,
                        Relaxing: research.rankings.Relaxing || 0,
                        Tags: research.imageKeywords || []
                    };
                    solutionRecord.fields.Rankings = JSON.stringify(rankingsData);
                }

                // Add media tags for image searching
                if (research.imageKeywords && research.imageKeywords.length > 0) {
                    solutionRecord.fields['Media Tags'] = research.imageKeywords.join(' ');
                }

                // Store confidence score on the record
                solutionRecord._aiConfidence = research.confidence;

                // Update the registry with the enriched record
                window._solutionRecords.set(recordId, solutionRecord);

                // Also update in state.records.all if present
                const stateIndex = state.records.all.findIndex(r => r.id === recordId);
                if (stateIndex !== -1) {
                    state.records.all[stateIndex] = solutionRecord;
                }

                // Refresh the sidebar to show the accuracy badge
                await ui.updateEventPlanSection();

                // Show success toast with accuracy score
                const accuracyPercent = Math.round(research.confidence * 100);
                ui.showToast(`Research complete! Accuracy: ${accuracyPercent}%`);

                addEnergy(); // Visual feedback

                // Save the session to persist the research data
                triggerSave();

            } catch (error) {
                console.error('Error researching solution:', error);
                ui.showToast('Failed to research solution. Try again.');

                // Restore button
                digBtn.innerHTML = originalContent;
                digBtn.disabled = false;
                digBtn.style.opacity = '1';
            }
        } else if (removeIdeaBtn && e.target === removeIdeaBtn) {
            e.stopPropagation();
            const recordId = ideaItem.dataset.recordId;
            if (!recordId || !state.cart.items.has(recordId)) return;

            const itemInfo = state.cart.items.get(recordId);
            state.cart.items.delete(recordId);

            // Regress progress when removing item from ideas
            updateProgress(-0.0001 * (itemInfo?.quantity || 1));

            await ui.updateIdeasCarousel();
            triggerSave();
        } else if (e.target.closest('.availability-btn')) {
            e.stopPropagation();
            const calendarBtn = e.target.closest('.availability-btn');
            const card = calendarBtn.closest('.event-card');
            if (!card) return;
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (!record) return;
            
            ui.showDetailModal(record);
        } else if (card && !e.target.closest('.quantity-selector, .heart-icon, .add-to-plan-btn, .availability-btn, .card-sentiment-chip')) {
            const recordId = card.dataset.recordId;
            console.log('[EVENTS DEBUG] Card clicked (detail modal trigger), recordId:', recordId);

            // First try to find in state.records.all
            let record = state.records.all.find(r => r.id === recordId);

            // If not found in all, check state.records.filtered (for session tiles, etc.)
            if (!record) {
                record = state.records.filtered.find(r => r.id === recordId);
            }

            if (!record) {
                console.warn('[EVENTS DEBUG] Card clicked but record NOT FOUND. recordId:', recordId, 'state.records.all.length:', state.records.all.length);
                return;
            }

            console.log('[EVENTS DEBUG] Record found:', { id: record.id, name: record.fields?.Name, itemType: record.fields?.['Item Type'] });

            if (record.id.startsWith('ai-search-')) {
                return;
            }

            // Handle session tile clicks - load session into event plan panel and chat
            if (record.isSession && record.sessionData) {
                log('Events', `Loading session from My Sessions view: ${record.id}`);

                // Update URL with session parameter and clear the my-sessions view
                updateUrl({ session: record.id, view: null, category: null, subcategory: null });

                // Load the session data (this will fire sessionReady event when complete)
                api.loadSessionFromAirtable(record.id).catch(err => {
                    log('Events', `Failed to load session: ${err.message}`);
                });

                // Refresh the catalog view to show items instead of sessions list
                applyFiltersAndSort(imageCache);

                return;
            }

            if (record.fields['Item Type'] === 'Grouping') {
                 const groupName = record.fields.Name;
                 const groupNameLower = groupName.toLowerCase().replace(/\s+/g, ' ');
                 const parentName = record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];

                 // Small progress for browsing categories
                 updateProgress(0.00002);

                 if (!parentName) {
                     updateUrl({ category: groupNameLower, subcategory: null, view: null });
                 } else {
                     const parentNameLower = parentName.toLowerCase().replace(/\s+/g, ' ');
                     updateUrl({ category: parentNameLower, subcategory: groupNameLower, view: null });
                 }
                 applyFiltersAndSort(imageCache);

            } else {
                // Small progress for viewing item details
                updateProgress(0.00001);
                console.log('[EVENTS DEBUG] Opening detail modal for:', record.fields?.Name, record.id);
                ui.showDetailModal(record);
            }
        } else if (lockedItemCard && !e.target.closest('.demote-locked-item-btn, .edit-btn, .dig-solution-btn')) {
            const recordId = lockedItemCard.dataset.recordId;
            console.log('[EVENTS DEBUG] Locked item card clicked, recordId:', recordId);
            let record = state.records.all.find(r => r.id === recordId);
            // Check solution records registry for AI-generated solution items
            if (!record && recordId && recordId.startsWith('solution-') && window._solutionRecords) {
                record = window._solutionRecords.get(recordId);
            }
            if (record) ui.showDetailModal(record);
        } else if (ideaItem && !e.target.closest('.add-to-plan-btn, .remove-btn')) {
            const recordId = ideaItem.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
             if (record) ui.showDetailModal(record);
        }
    }); // End of body click listener

    document.body.addEventListener('change', (e) => {
        if (state.ui.isInitializing) return;
        const target = e.target;
        const container = target.closest('[data-record-id]');
        if (!container) return;
        const recordId = container.dataset.recordId;
        const isLocked = state.cart.lockedItems.has(recordId);
        const isInIdeas = state.cart.items.has(recordId);
        let updates = {};

        // Track old quantity for progress calculation
        let oldQuantity = 0;
        if (target.matches('.quantity-input')) {
            const currentState = isLocked ? state.cart.lockedItems.get(recordId) : state.cart.items.get(recordId);
            oldQuantity = currentState?.quantity || 1;
            updates.quantity = parseFloat(target.value);
        } else if (target.matches('#modal-item-note')) {
            updates.note = target.value;
        } else if (e.detail?.selections !== undefined) {
            // New: Handle selections object from option groups (supports multi-select arrays)
            updates.selections = e.detail.selections;
            // Also update legacy selectedOptionIndex for backward compatibility
            if (Object.keys(e.detail.selections).length > 0) {
                const group0Selection = e.detail.selections['group0'];
                updates.selectedOptionIndex = Array.isArray(group0Selection)
                    ? (group0Selection[0] || 0)
                    : (group0Selection || 0);
            }
        } else if (e.detail?.selectedOptionIndex !== undefined) {
            // Legacy: Handle single selectedOptionIndex
            updates.selectedOptionIndex = e.detail.selectedOptionIndex;
            // Also create selections object for new format
            updates.selections = { group0: e.detail.selectedOptionIndex };
        }

        if (Object.keys(updates).length > 0) {
            // Calculate progress based on quantity changes
            if (updates.quantity !== undefined && updates.quantity !== oldQuantity) {
                const quantityDelta = updates.quantity - oldQuantity;
                updateProgress(0.0001 * quantityDelta);
            }

            if (isLocked) {
                ui.updateLockedItemState(recordId, updates);
                ui.updateEventPlanSection();
                ui.updateTotalCost();

                // Sync item update across all views
                syncPlanState('eventPlanPanel', 'itemUpdated', { recordId, updates });
            } else {
                ui.updateItemState(recordId, updates);
                if (!isInIdeas && target.matches('.quantity-input')) {
                    ui.updateIdeasCarousel();
                }
            }
            triggerSave();
        }
    });
    
    // Lazy load Flatpickr when event date picker is focused (now in range mode)
    let eventPlanDatePicker = null;
    const eventDateInput = document.getElementById('event-date-picker');
    if (eventDateInput) {
        const initializeEventDatePicker = async () => {
            if (!eventPlanDatePicker) {
                try {
                    log('Events', 'Loading Flatpickr dynamically for event date picker...');
                    await loadFlatpickr();

                    if (!window.flatpickr) {
                        throw new Error('Flatpickr not available after loading');
                    }

                    if (typeof window.flatpickr !== 'function') {
                        throw new Error(`Flatpickr is not a function, got type: ${typeof window.flatpickr}`);
                    }

                    // Clear placeholder text before initializing flatpickr to avoid parse errors
                    if (eventDateInput.value === 'Select a date' || eventDateInput.value === 'Select date or date range' || eventDateInput.value === 'Select date') {
                        eventDateInput.value = '';
                    }

                    eventPlanDatePicker = window.flatpickr(eventDateInput, {
                        mode: "single",
                        dateFormat: "M j, Y",
                        // Force the custom calendar on mobile so availability shading (via onDayCreate) renders;
                        // the native mobile date input bypasses onDayCreate and shows no availability colors.
                        disableMobile: true,
                        onDayCreate: (dObj, dStr, fp, dayElem) => {
                            const lockedRecords = Array.from(state.cart.lockedItems.keys())
                                .map(id => state.records.all.find(r => r.id === id))
                                .filter(r => r && r.fields[CONSTANTS.FIELD_NAMES.ICAL_URL]);
                            if (lockedRecords.length === 0) return;
                            const status = getPlanDayStatusSync(dayElem.dateObj, lockedRecords);
                            dayElem.classList.remove('available-full', 'available-partial', 'unavailable');
                            switch (status) {
                                case AVAILABILITY_STATUS.FULL: dayElem.classList.add('available-full'); break;
                                case AVAILABILITY_STATUS.PARTIAL: dayElem.classList.add('available-partial'); break;
                                case AVAILABILITY_STATUS.NONE: dayElem.classList.add('unavailable'); break;
                            }
                        },
                        onOpen: async (selectedDates, dateStr, instance) => {
                            const lockedRecords = Array.from(state.cart.lockedItems.keys())
                                .map(id => state.records.all.find(r => r.id === id))
                                .filter(r => r && r.fields[CONSTANTS.FIELD_NAMES.ICAL_URL]);
                            if (lockedRecords.length === 0) return;
                            console.log(`[ICAL] Plan calendar opened - fetching calendars for ${lockedRecords.length} items...`);
                            const results = await Promise.all(lockedRecords.map(r => api.fetchCalendarForRecord(r)));
                            results.forEach((busyTimes, i) => {
                                logBusyTimeSummary(`"${lockedRecords[i].fields.Name}"`, busyTimes);
                            });
                            if (instance.config) {
                                instance.redraw();
                            }
                        },
                        onChange: async (selectedDates) => {
                            if (state.ui.isInitializing) return;
                            if (selectedDates.length > 0) {
                                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates[0].toISOString());
                                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE_END);
                                console.log('[Events DEBUG] Date set:', selectedDates[0].toISOString());
                                updateProgress(0.00015);
                            } else {
                                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
                                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE_END);
                                updateProgress(-0.00015);
                                console.log('[Events DEBUG] Date cleared');
                            }
                            // Recompute end date/time from start + duration
                            computeAndStoreEndDateTime();
                            await ui.updateEventPlanDateDisplay();
                            await ui.updateLockedItemStatusIcons();
                            await updateMobileBarAvailability();

                            // Sync date change across all views
                            syncPlanState('eventDatePicker', 'dateChanged', {
                                date: selectedDates.length > 0 ? selectedDates[0].toISOString() : null,
                                dateEnd: state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE_END) || null
                            });

                            triggerSave();
                        }
                    });

                    // Store the flatpickr instance on the input element
                    eventDateInput._flatpickr = eventPlanDatePicker;

                    // Restore saved date into the picker (single date only)
                    const savedDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
                    if (savedDate) {
                        try {
                            eventPlanDatePicker.setDate(new Date(savedDate), false);
                        } catch (e) { /* ignore invalid */ }
                    }

                    // Open the calendar after initialization
                    eventPlanDatePicker.open();

                    log('Events', 'Event date picker initialized successfully (range mode)');
                } catch (error) {
                    log('Events', `Error initializing event date picker: ${error.message}`);
                    console.error('Flatpickr initialization error:', error);
                }
            } else {
                // If already initialized, just open it
                eventPlanDatePicker.open();
            }
        };

        eventDateInput.addEventListener('focus', initializeEventDatePicker);
    }

    // --- Plan-level start time & duration inputs (end time/date computed from start + duration) ---
    const startTimeInput = document.getElementById('event-start-time');
    const durationInput = document.getElementById('event-duration-input');
    const durationDisplay = document.getElementById('event-duration-display');

    /**
     * Populate a <select> with time options in 15-minute increments (12-hour format).
     */
    function populateTimeDropdown(selectEl) {
        if (!selectEl) return;
        // Keep the first "-- Select --" option
        while (selectEl.options.length > 1) selectEl.remove(1);
        for (let totalMin = 0; totalMin < 24 * 60; totalMin += 15) {
            const h = Math.floor(totalMin / 60);
            const m = totalMin % 60;
            let label;
            if (h === 0) label = `12:${String(m).padStart(2, '0')} AM`;
            else if (h < 12) label = `${h}:${String(m).padStart(2, '0')} AM`;
            else if (h === 12) label = `12:${String(m).padStart(2, '0')} PM`;
            else label = `${h - 12}:${String(m).padStart(2, '0')} PM`;
            const opt = document.createElement('option');
            opt.value = label;
            opt.textContent = label;
            selectEl.appendChild(opt);
        }
    }

    /**
     * Populate a <select> with duration options (15m increments up to 12h).
     */
    function populateDurationDropdown(selectEl) {
        if (!selectEl) return;
        while (selectEl.options.length > 1) selectEl.remove(1);
        const durations = [
            15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 300, 360, 420, 480, 540, 600, 660, 720
        ];
        durations.forEach(min => {
            const hrs = Math.floor(min / 60);
            const mins = min % 60;
            let label;
            if (hrs > 0 && mins > 0) label = `${hrs}h ${mins}m`;
            else if (hrs > 0) label = `${hrs}h`;
            else label = `${mins}m`;
            const opt = document.createElement('option');
            opt.value = String(min);
            opt.textContent = label;
            selectEl.appendChild(opt);
        });
    }

    // Populate the plan-level dropdowns
    populateTimeDropdown(startTimeInput);
    populateDurationDropdown(durationInput);

    /**
     * Parse a time string like "7:00 PM" or "14:30" to { hours, minutes }
     */
    function parseTimeString(timeStr) {
        if (!timeStr) return null;
        const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
        if (!match) return null;
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const meridiem = match[3] ? match[3].toUpperCase() : null;
        if (meridiem === 'PM' && hours !== 12) hours += 12;
        else if (meridiem === 'AM' && hours === 12) hours = 0;
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
        return { hours, minutes };
    }

    /**
     * Format minutes to a human-readable duration string like "2h 30m"
     */
    function formatDuration(totalMin) {
        if (!totalMin || totalMin <= 0) return '';
        const hrs = Math.floor(totalMin / 60);
        const mins = totalMin % 60;
        if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
        if (hrs > 0) return `${hrs}h`;
        return `${mins}m`;
    }

    /**
     * Format minutes to a 12-hour time string like "7:00 PM"
     */
    function formatTimeFromMinutes(totalMin) {
        totalMin = totalMin % (24 * 60);
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        if (h === 0) return `12:${String(m).padStart(2, '0')} AM`;
        if (h < 12) return `${h}:${String(m).padStart(2, '0')} AM`;
        if (h === 12) return `12:${String(m).padStart(2, '0')} PM`;
        return `${h - 12}:${String(m).padStart(2, '0')} PM`;
    }

    /**
     * Compute and store end time and end date from start time/date + duration.
     * Called whenever start time, start date, or duration changes.
     */
    function computeAndStoreEndDateTime() {
        const startStr = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.START_TIME);
        const durationMin = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DURATION);
        const startDateISO = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);

        if (startStr && durationMin && durationMin > 0) {
            const startParsed = parseTimeString(startStr);
            if (startParsed) {
                const startTotalMin = startParsed.hours * 60 + startParsed.minutes;
                const endTotalMin = startTotalMin + durationMin;
                const endTimeStr = formatTimeFromMinutes(endTotalMin);
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.END_TIME, endTimeStr);

                // If duration crosses midnight and we have a start date, compute end date
                if (endTotalMin >= 24 * 60 && startDateISO) {
                    const daysOverflow = Math.floor(endTotalMin / (24 * 60));
                    const endDate = new Date(startDateISO);
                    endDate.setDate(endDate.getDate() + daysOverflow);
                    endDate.setHours(23, 59, 59, 999);
                    state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE_END, endDate.toISOString());
                } else {
                    state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE_END);
                }

                // Show computed end time as hint
                if (durationDisplay) durationDisplay.textContent = `(ends ${endTimeStr})`;
            }
        } else {
            // Not enough info to compute end time
            state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.END_TIME);
            state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE_END);
            if (durationDisplay) durationDisplay.textContent = '';
        }
    }

    if (startTimeInput) {
        // Restore saved value
        const savedStart = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.START_TIME);
        if (savedStart) startTimeInput.value = savedStart;

        startTimeInput.addEventListener('change', () => {
            if (state.ui.isInitializing) return;
            const val = startTimeInput.value;
            if (val) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.START_TIME, val);
            } else {
                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.START_TIME);
            }
            computeAndStoreEndDateTime();
            triggerSave();
        });
    }

    if (durationInput) {
        // Restore saved duration value
        const savedDuration = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DURATION);
        if (savedDuration) durationInput.value = String(savedDuration);

        durationInput.addEventListener('change', () => {
            if (state.ui.isInitializing) return;
            const val = durationInput.value;
            if (val) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DURATION, parseInt(val, 10));
            } else {
                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DURATION);
            }
            computeAndStoreEndDateTime();
            triggerSave();
        });
    }

    // Initialize computed end from any restored session values
    computeAndStoreEndDateTime();

    // --- "Update all items" — push the plan date/time onto every locked item ---
    const applyToItemsBtn = document.getElementById('event-apply-to-items-btn');
    const applyToItemsMsg = document.getElementById('event-apply-to-items-msg');

    /** Briefly show a gentle inline message beside the apply button. */
    function showApplyToItemsMsg(text) {
        if (!applyToItemsMsg) return;
        applyToItemsMsg.textContent = text;
        clearTimeout(showApplyToItemsMsg._t);
        showApplyToItemsMsg._t = setTimeout(() => { applyToItemsMsg.textContent = ''; }, 4000);
    }

    if (applyToItemsBtn) {
        applyToItemsBtn.addEventListener('click', () => {
            if (state.ui.isInitializing) return;

            const planDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
            const planStart = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.START_TIME);
            const planDuration = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DURATION);

            if (!planDate) {
                showApplyToItemsMsg('Set an event date first.');
                return;
            }
            const itemCount = state.cart.lockedItems.size;
            if (itemCount === 0) {
                showApplyToItemsMsg('No items in the plan yet.');
                return;
            }
            if (!window.confirm(`Apply this date/time to all ${itemCount} item${itemCount === 1 ? '' : 's'}? This replaces dates already set on individual items.`)) {
                return;
            }

            for (const [recordId, info] of state.cart.lockedItems.entries()) {
                const record = state.records.all.find(r => r.id === recordId);

                info.itemDate = planDate;
                if (planStart) info.itemStartTime = planStart; else delete info.itemStartTime;

                // For time-priced items the duration is the quantity (e.g. hours), so keep
                // their own duration rather than overwriting it with the plan duration.
                const unitMinutes = record ? getTimeUnitMinutes(record) : null;
                let effectiveDuration;
                if (unitMinutes) {
                    const qty = parseFloat(info.quantity) || 1;
                    effectiveDuration = Math.round(qty * unitMinutes);
                    info.itemDuration = effectiveDuration;
                } else if (planDuration) {
                    effectiveDuration = planDuration;
                    info.itemDuration = planDuration;
                } else {
                    effectiveDuration = info.itemDuration || 0;
                }

                const { endTime, dateEnd } = computeEndFromStartDuration(info.itemStartTime, effectiveDuration, planDate);
                if (endTime) info.itemEndTime = endTime; else delete info.itemEndTime;
                if (dateEnd) info.itemDateEnd = dateEnd; else delete info.itemDateEnd;

                state.cart.lockedItems.set(recordId, info);
            }

            triggerSave();
            ui.updateEventPlanSection();
            syncPlanState('eventDatePicker', 'itemUpdated', { appliedToAllItems: true });
            showApplyToItemsMsg(`Applied to all ${itemCount} item${itemCount === 1 ? '' : 's'}.`);
        });
    }

    safeAddEventListener('itinerary-btn', 'click', () => {
        log('Events', 'Itinerary button clicked, showing modal.');
        showItineraryModal();
    });
    
    ui.setupPresentationEventListeners();
    safeAddEventListener('payment-form', 'submit', handlePaymentFormSubmit);

    // "Save plan for later" — persist the cart and email a pay-later link to the
    // purchaser and the store, with no payment taken.
    safeAddEventListener('save-plan-checkout-btn', 'click', handleSavePlanForLater);

    // "Pay Direct" (P2P) options: gate on name/email and register plan events.
    // Capture phase so a missing name/email can block the external payment link.
    const p2pOptionsContainer = document.getElementById('checkout-p2p-options');
    if (p2pOptionsContainer) {
        p2pOptionsContainer.addEventListener('click', handleP2PCheckoutClick, true);
    }

    setupItineraryEventListeners();

    // Phase 5: Initialize project selector for "Add to Project" functionality
    initializeProjectSelector();

    return { mainDatePicker, eventPlanDatePicker };
}

export function initializeChatEventListeners() {
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    if (messageForm) {
        messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const message = messageInput.value;
            if (message.trim() === '') return;
            sendMessage(message);
            messageInput.value = '';
        });
    }

    // Wire the chat bubble to open/close the Unified Chat Panel
    const chatToggleButton = document.getElementById('chat-toggle-button');
    if (chatToggleButton) {
        chatToggleButton.addEventListener('click', (e) => {
            e.stopPropagation();
            // Initialize UCP on first open (lazy init) and inject dependencies
            setUCPGetCurrentUser(getCurrentUser);
            setUCPSendMessage(sendMessage);
            initializeUnifiedChatPanel();
            toggleUnifiedChatPanel();
        });
    }

    // The Forum Panel is retired; its "Activity" trigger now opens the Unified
    // Chat Panel (the single conversation view).
    const activityTrigger = document.getElementById('forum-panel-trigger');
    if (activityTrigger) {
        activityTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            setUCPGetCurrentUser(getCurrentUser);
            setUCPSendMessage(sendMessage);
            initializeUnifiedChatPanel();
            toggleUnifiedChatPanel();
        });
    }

    // Keep the old chat widget toggle code dormant
    // (old toggleChatWindow and document click-outside handler are no longer active)

    // Initialize recent chats listeners
    initializeRecentChatsListeners();
}

export function openChatWidget(andKeepOpen = false) {
    // Now opens the Unified Chat Panel instead of the old chat widget
    setUCPGetCurrentUser(getCurrentUser);
    setUCPSendMessage(sendMessage);
    initializeUnifiedChatPanel();
    showUnifiedChatPanel();
}

// And add the handleFilterChipClear function to the end of events.js
function handleFilterChipClear(e) {
    // This is a dummy function to route the click back to ui.js logic 
    // to prevent deep import dependency issues. It requires ui.js to be loaded.
    if (typeof ui.handleFilterChipClear === 'function') {
        ui.handleFilterChipClear(e);
    } else {
         // Fallback for non-chip clearing
        document.getElementById('name-filter').value = '';
        window.applyFiltersAndSort(window.imageCache);
    }
}
