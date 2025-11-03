// REPLACE THE ENTIRE CONTENTS OF: components/modal.js

import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY } from '../config.js';
import { parseOptions, updateUrl, getGroupPriceRange, getRecordPrice } from '../utils.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS } from '../availability.js';
import { log } from '../utils/debug.js';
import { initializeItemChat } from '../chat.js';
// Note: updateProgressForAction is imported via events.js

let stripe;
let currentShopSettings = {};
const modalOverlay = document.getElementById('detail-modal-overlay');
let currentItemChatRecordId = null;

// --- NEW MODAL HISTORY STATE ---
// Stores { recordId: string, shopId: string }
let modalHistory = []; 
let historyIndex = -1;
// --- END NEW ---

// --- NEW GLOBAL: HTML for the Processing Fee Line Item ---
const PROCESSING_FEE_ROW_HTML = `<div class=\"total-row processing-fee-row\" style=\"display: none;\"><span>Processing Fee:</span><span id=\"processing-fee-cost\">$0.00</span></div>`;
// This helper function safely inserts the fee row into the DOM
(function insertProcessingFeeRow() {
    const section = document.querySelector('.checkout-total-deposit-section');
    if (section) {
        section.insertAdjacentHTML('afterbegin', PROCESSING_FEE_ROW_HTML);
    }
})();
// --- END NEW GLOBAL ---

function closeDetailModal() {
    // Reset history when closing the modal entirely
    modalHistory = [];
    historyIndex = -1;
    updateUrl({ openItem: null });
    hideDetailModal();
}

function handleEscapeKey(event) {
    if (event.key === 'Escape') {
        closeDetailModal();
    }
}

function handleOverlayClick(event) {
    if (event.target === modalOverlay) {
        closeDetailModal();
    }
}

// --- NEW: Modal Navigation Handler ---
function navigateModalHistory(direction) {
    const newIndex = historyIndex + direction;
    if (newIndex >= 0 && newIndex < modalHistory.length) {
        historyIndex = newIndex;
        const target = modalHistory[newIndex];
        const record = state.records.all.find(r => r.id === target.recordId);
        if (record) {
             // 1. Update the URL via pushState to reflect the new state (so browser buttons work correctly)
             updateUrl({ openItem: record.id });
             
             // 2. The fourth argument signals isFromBrowserHistory = true
             showDetailModal(record, 0, true); 
             // Note: Assuming a global utility function like updateProgressForAction exists and is accessible.
        } else {
             // Failed to find the record, snap back to a valid state
             historyIndex -= direction;
        }
    }
}

// Attach global listeners for modal navigation buttons
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('modal-back-btn')?.addEventListener('click', () => navigateModalHistory(-1));
    document.getElementById('modal-forward-btn')?.addEventListener('click', () => navigateModalHistory(1));
});

// --- MODIFIED FUNCTION: Fetches the fee from the server and updates the UI (Fee is returned in cents) ---
export async function updateProcessingFeeDisplay() {
    const fullTotalEl = document.getElementById('full-total-price');
    const finalTotal = parseFloat(fullTotalEl?.dataset.total || 0); // Read the current (recalculated) total from the element
    const tipAmount = parseFloat(document.getElementById('tip-amount')?.value) || 0;
    const amountReceived = state.session.user.amountReceived || 0;
    
    // Determine base amount due (Deposit vs. Full)
    const totalDueBeforeFee = finalTotal - amountReceived;
    let amountToChargeBeforeFee = totalDueBeforeFee;
    const isFirstPayment = amountReceived === 0;

    // --- NEW LOGIC: If balance is paid, allow only tip payment/adjustment ---
    if (totalDueBeforeFee <= 0) {
        amountToChargeBeforeFee = tipAmount; // Only charge the tip amount
        document.getElementById('deposit-label').textContent = 'Additional Payment/Tip:';
    } else if (isFirstPayment) {
    // --- Existing logic for deposit/full choice ---
        const choice = document.querySelector('input[name=\"paymentChoice\"]:checked')?.value || 'deposit';
        const isFullPayment = currentShopSettings.paymentOptions === 'DepositOrFull' && choice === 'full';

        if (!isFullPayment) {
             // 35% Deposit
             amountToChargeBeforeFee = finalTotal * 0.35;
             document.getElementById('deposit-label').textContent = '35% Deposit Due:';
        } else {
             // Full Amount
             amountToChargeBeforeFee = finalTotal;
             document.getElementById('deposit-label').textContent = 'Full Amount Due:';
        }
    } else {
        // Remaining Balance Due
        document.getElementById('deposit-label').textContent = 'Remaining Balance Due:';
    }
    
    // Add tip to the amount to charge
    amountToChargeBeforeFee += tipAmount;

    const amountInCentsBeforeFee = Math.round(amountToChargeBeforeFee * 100);
    
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    const elements = checkoutModalOverlay?.stripeElements;
    
    // --- CRITICAL FIX START: Reliably get the selected payment method type ---
    let selectedPaymentMethod = 'card'; // Default fallback
    if (elements) {
         try {
             // Use getValue() to pull the current payment method type selected by the user.
             const paymentElement = elements.getElement('payment');
             const valueResult = await paymentElement.getValue();
             if (valueResult.value?.type) {
                 selectedPaymentMethod = valueResult.value.type;
             }
             // 🐛 DEBUG: Log the detected payment type in the browser console
             console.log(`[Stripe Debug] Detected Payment Type: ${selectedPaymentMethod}`);
         } catch (e) {
             // 🐛 DEBUG: Log error if getValue() fails
             console.error('[Stripe Debug] Error calling getValue() on Payment Element:', e);
             log('Stripe', 'Warning: Could not get live payment method type from Stripe Element, defaulting to card.', e);
         }
    }
    log('Stripe', `Recalculating fee for method type: ${selectedPaymentMethod}`);
    // --- CRITICAL FIX END ---\n

    try {
        // We only proceed if the amount is valid 
        if (amountInCentsBeforeFee <= 0) {
            document.getElementById('processing-fee-cost').textContent = `$0.00`;
            document.querySelector('.processing-fee-row').style.display = 'none';
            document.getElementById('deposit-price').textContent = `$0.00`;
            return;
        }

        // Step 1: Request the fee calculation and a NEW clientSecret from the server
        const intentResponse = await fetch('/api/create-payment-intent', {
            method: 'POST',\
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                amount: amountInCentsBeforeFee, 
                paymentMethodType: selectedPaymentMethod 
            }),
        });
        
        // 🐛 DEBUG: Log the fetch status in the browser console
        console.log(`[Stripe Debug] Sent fetch request. Server response status: ${intentResponse.status}`);
        
        if (!intentResponse.ok) throw new Error('Fee calculation failed.');
        const paymentIntentData = await intentResponse.json();
        const feeInCents = paymentIntentData.processingFeeInCents;
        const clientSecret = paymentIntentData.clientSecret;
        const fee = feeInCents / 100;

        // Step 2: Update the UI with the fee
        const feeEl = document.getElementById('processing-fee-cost');
        const feeRowEl = document.querySelector('.processing-fee-row');
        
        if (fee > 0) {
            feeEl.textContent = `$${fee.toFixed(2)}`;
            feeRowEl.style.display = 'flex';
        } else {
            feeRowEl.style.display = 'none';
        }

        // Step 3: Update the Final Due amount (including the fee)
        const totalDueWithFee = amountToChargeBeforeFee + fee;
        document.getElementById('deposit-price').textContent = `$${totalDueWithFee.toFixed(2)}`;
        
        // Step 4: Update the existing Stripe Elements instance with the new Client Secret
        if (elements && clientSecret) {
            elements.update({ clientSecret: clientSecret });
        }

    } catch (err) {
        console.error('Failed to update processing fee:', err);
        // Fallback logic
        const fee = 0; 
        document.getElementById('processing-fee-cost').textContent = `$${fee.toFixed(2)}`;
        document.querySelector('.processing-fee-row').style.display = 'none';
        document.getElementById('deposit-price').textContent = `$${amountToChargeBeforeFee.toFixed(2)}`;
    }
}
// --- END MODIFIED FUNCTION ---


function getBreadcrumbs(record) {
    const breadcrumbs = [];
    let current = record;
    while (current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]) {
        const parentName = current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
        breadcrumbs.unshift(parentName);
        current = state.records.all.find(r => r.fields.Name === parentName);
        if (!current) break;
    }
    return breadcrumbs;
}

function resetModalState() {
    const elements = {
        modalItemName: document.getElementById('modal-item-name'),
        modalItemPrice: document.getElementById('modal-item-price'),
        modalItemDescription: document.getElementById('modal-item-description'),
        modalMainImage: document.getElementById('modal-main-image'),
        modalThumbnailStrip: document.getElementById('modal-thumbnail-strip'),
        modalOptionsContainer: document.getElementById('modal-options-container'),
        modalQuantitySelector: document.getElementById('modal-quantity-selector'),
        modalItemNote: document.getElementById('modal-item-note'),
        modalCalendarContainer: document.getElementById('modal-calendar-container'),
        modalBreadcrumbs: document.getElementById('modal-breadcrumbs'),
        modalAdditionalDetails: document.getElementById('modal-additional-details')
    };
    for (const key in elements) {
        if (elements[key]) {
            if (key === 'modalItemNote') elements[key].value = '';
            else if (key === 'modalMainImage') elements[key].style.backgroundImage = '';
            else elements[key].innerHTML = '';
        }
    }
    document.getElementById('modal-store-links')?.remove(); // Remove dynamic store links container
    log('Modal', 'Reset modal state.');
}

/**
 * Displays the detail modal for a given record.
 * @param {Object} record - The Airtable record object.
 * @param {number} [startPhotoIndex=0] - The index of the photo to start viewing.
 * @param {boolean} [isInternalNavigation=false] - Flag to skip adding to internal modal history stack.
 */
export async function showDetailModal(record, startPhotoIndex = 0, isInternalNavigation = false) {
    // Re-check for external browser history change only if NOT an internal navigation event
    const isFromBrowserHistory = !isInternalNavigation && new URLSearchParams(window.location.search).get('openItem') === record.id;
    
    const detailSpecs = [
        { fieldName: 'Duration', label: 'Duration' },
        { fieldName: 'Capacity', label: 'Capacity' },
        { fieldName: 'Location Details', label: 'Location Info' },
        { fieldName: 'Additional Information', label: 'Good to Know' },
    ];

    console.log('[showDetailModal] Called for item:', record.id, 'Internal Nav:', isInternalNavigation, 'Browser Popstate/Initial Load Check:', isFromBrowserHistory);
    log('Modal', `Showing detail modal for \"${record.fields.Name}\"`);
    
    // --- HISTORY MANAGEMENT: Handle internal drill-down, sync state on browser history change ---
    if (!isInternalNavigation) {
        // Only update URL if this didn't originate from a browser history event, otherwise history is fine.
        if (!isFromBrowserHistory) {
            updateUrl({ openItem: record.id });
        }

        const currentEntry = { recordId: record.id, shopId: state.ui.activeShopId };
        
        // If coming from a button click (not internal nav, not browser back/forward), push the new item.
        if (!isInternalNavigation) {
            // If drilling down, wipe out the \"forward\" history
            if (historyIndex > -1 && historyIndex < modalHistory.length - 1) {
                modalHistory = modalHistory.slice(0, historyIndex + 1);
            }
            // Push the new item and update the index
            modalHistory.push(currentEntry);
            historyIndex = modalHistory.length - 1;
        } else if (isFromBrowserHistory) {
             // If from browser history, find the matching index to sync the internal buttons
             historyIndex = modalHistory.findIndex(entry => entry.recordId === record.id);
             if (historyIndex === -1) {
                 // Fallback: If item wasn't in modal history, treat it as the single new entry
                 modalHistory = [currentEntry];
                 historyIndex = 0;
             }
        }
        log('Modal', 'History updated:', modalHistory.map(e => e.recordId), 'Index:', historyIndex);
    } 
    // --- END HISTORY MANAGEMENT ---

    const modalHeaderActions = document.getElementById('modal-header-actions');
    const modalItemName = document.getElementById('modal-item-name');
    const modalItemPrice = document.getElementById('modal-item-price');
    const modalItemDescription = document.getElementById('modal-item-description');
    const modalMainImage = document.getElementById('modal-main-image');
    const modalThumbnailStrip = document.getElementById('modal-thumbnail-strip');
    const modalOptionsContainer = document.getElementById('modal-options-container');
    const modalQuantitySelector = document.getElementById('modal-quantity-selector');
    const modalNotesContainer = document.getElementById('modal-notes-container');
    const modalItemNote = document.getElementById('modal-item-note');
    const modalCalendarContainer = document.getElementById('modal-calendar-container');
    const modalActionsContainer = document.getElementById('modal-actions-container');
    const modalBreadcrumbs = document.getElementById('modal-breadcrumbs');
    const modalAdditionalDetails = document.getElementById('modal-additional-details');
    const addToPlanBtn = document.getElementById('modal-add-to-plan-btn');
    
    // Get Navigation Buttons (now defined in index.html)
    const backBtn = document.getElementById('modal-back-btn');
    const forwardBtn = document.getElementById('modal-forward-btn');
    
    // --- Store Links Container (Need to create it if missing) ---
    let modalStoreLinksContainer = document.getElementById('modal-store-links');
    if (!modalStoreLinksContainer) {
        modalStoreLinksContainer = document.createElement('div');
        modalStoreLinksContainer.id = 'modal-store-links';
        // Insert before modalAdditionalDetails
        modalAdditionalDetails.parentNode.insertBefore(modalStoreLinksContainer, modalAdditionalDetails);
    }
    modalStoreLinksContainer.innerHTML = ''; // Clear previous links
    // --- End Store Links Container ---


    log('Modal', 'Setting up modal listeners.');
    const closeBtn = document.getElementById('modal-close-btn');
    closeBtn.onclick = closeDetailModal;
    modalOverlay.addEventListener('click', handleOverlayClick);
    document.removeEventListener('keydown', handleEscapeKey); // Ensure only one listener is active
    document.addEventListener('keydown', handleEscapeKey);


    resetModalState(); // Reset UI elements *before* populating
    modalOverlay.dataset.recordId = record.id;
    currentItemChatRecordId = record.id;

    const isLocked = state.cart.lockedItems.has(record.id);
    modalOverlay.dataset.mode = isLocked ? 'edit-locked' : 'edit-favorite';

    const itemState = isLocked ? state.cart.lockedItems.get(record.id) : ui.getItemState(record.id);
    if (addToPlanBtn) {
        addToPlanBtn.textContent = isLocked ? 'Update Plan' : 'Add to Plan';
        addToPlanBtn.dataset.tooltip = isLocked ? 'Update plan with changes' : 'Add to plan';
    }

    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    modalItemName.textContent = record.fields.Name || 'Untitled';
    modalItemDescription.textContent = record.fields.Description || '';

    // --- POPULATE ADDITIONAL DETAILS (Cleaned Quotes in template literals) ---
    if (modalAdditionalDetails) {
        modalAdditionalDetails.innerHTML = ''; 
        const fragment = document.createDocumentFragment();
        let hasRankings = false;
        const rankingsHtmlParts = [];
        const detailSpecs = [
            { fieldName: 'Duration', label: 'Duration' },
            { fieldName: 'Capacity', label: 'Capacity' },
            { fieldName: 'Location Details', label: 'Location Info' },
            { fieldName: 'Additional Information', label: 'Good to Know' },
        ];
        detailSpecs.forEach(spec => {
            const value = record.fields[spec.fieldName];
            if (value) {
                const detailItem = document.createElement('div');
                detailItem.className = 'detail-item';
                // Cleaned up innerHTML: using template literal and minimizing quote conflicts
                detailItem.innerHTML = `
                    <span class=\"detail-label\">${spec.label}</span>
                    <span class=\"detail-value\">${String(value).replace(/\n/g, '<br>')}</span>
                `;
                fragment.appendChild(detailItem);
            }
        });
        const rankingsJsonString = record.fields['Rankings'];
        if (rankingsJsonString) {
            try {
                const rankingsObject = JSON.parse(rankingsJsonString);
                for (const label in rankingsObject) {
                    if (Object.hasOwnProperty.call(rankingsObject, label)) {
                        const value = rankingsObject[label];
                        if (typeof value === 'number' && value > 0) {
                            hasRankings = true;
                            const stars = '★'.repeat(value) + '☆'.repeat(Math.max(0, 5 - value));
                            // Cleaned up innerHTML: using template literal and minimizing quote conflicts
                            rankingsHtmlParts.push(`
                                <div class=\"ranking-item\">\
                                    <span class=\"ranking-label\">${label}:</span>
                                    <span class=\"ranking-stars\">${stars}</span>
                                </div>
                            `);
                        }
                    }
                }
            } catch (error) {
                console.error(`[Modal Debug] Error parsing Rankings JSON for item ${record.id}:`, error);
                const errorItem = document.createElement('div');
                errorItem.className = 'detail-item';
                // Cleaned up innerHTML
                errorItem.innerHTML = `<span class=\"detail-label\">Rankings</span><span class=\"detail-value\" style=\"color: red;\">Error loading rankings</span>`;
                fragment.appendChild(errorItem);
            }
        }\
        if (hasRankings) {\
            const rankingContainer = document.createElement('div');
            rankingContainer.className = 'ranking-list detail-item';
            // Cleaned up innerHTML
            rankingContainer.innerHTML = `
                <span class=\"detail-label\">Rankings</span>
                ${rankingsHtmlParts.join('')}
            `;
            fragment.appendChild(rankingContainer);
        }
        modalAdditionalDetails.appendChild(fragment);
    }
    // --- END POPULATE ADDITIONAL DETAILS ---

    // --- NEW: GO TO STORE BUTTONS & DYNAMIC NAVIGATION BUTTONS ---
    
    // Update Navigation Buttons state
    if (backBtn) backBtn.disabled = historyIndex <= 0;
    if (forwardBtn) forwardBtn.disabled = historyIndex >= modalHistory.length - 1;

    // GO TO STORE BUTTONS (for collaborative items)
    const linkedStoreIds = record.fields.Stores || [];
    const currentShopId = state.ui.activeShopId;

    // Check for collaborative items (linked to more than one store, excluding the current one)
    if (linkedStoreIds.length > 1) {
        const otherStoreIds = linkedStoreIds.filter(id => id !== currentShopId);
        
        if (otherStoreIds.length > 0) {
            const storeDetails = await api.fetchStoreDetailsByIds(otherStoreIds);
            
            let storeLinksHTML = '<h4>Also available at:</h4>';
            storeDetails.forEach(store => {\
                const storeName = store.shopTitle || store.name;\
                // Cleaned up innerHTML
                storeLinksHTML += `<button class=\"primary-action-btn go-to-store-btn\" data-store-id=\"${store.id}\" style=\"margin-top: 5px; margin-bottom: 5px; background-color: #5a6268; font-size: 0.9em;\">Go to ${storeName} Store</button>`;
            });
            modalStoreLinksContainer.innerHTML = storeLinksHTML;
            modalStoreLinksContainer.style.marginBottom = '20px';

            // Add event listeners for the new buttons
            modalStoreLinksContainer.querySelectorAll('.go-to-store-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    // FIX: Changed data-store-id retrieval to correctly match HTML attribute
                    const storeId = e.currentTarget.dataset.storeId;
                    // Open in a new window as requested by the user
                    window.open(`/?shopId=${storeId}`, '_blank');
                    e.stopPropagation();
                });
            });
        }
    }
    // --- END NEW: GO TO STORE BUTTONS ---

    // ... (rest of function remains the same, ensuring no stray backslashes in existing lines) ...
    // ...
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const allRecordNames = new Set(state.records.all.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => allRecordNames.has(opt.name));

    const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const pricingTypeHTML = pricingType ? `<span class=\"pricing-type\"> / ${pricingType.toLowerCase()}</span>` : '';

    if (isGrouping) {
        const range = getGroupPriceRange(record);
        modalItemPrice.innerHTML = (range && typeof range.min === 'number') ? (range.min === range.max ? `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`) : 'Price Varies';
    } else {
        const price = getRecordPrice(record, itemState.selectedOptionIndex);
        modalItemPrice.innerHTML = (typeof price === 'number' ? `$${price.toFixed(2)}` : 'N/A') + pricingTypeHTML;
    }

    let currentPhotoIndex = startPhotoIndex;
    modalMainImage.style.backgroundImage = `url('${imageUrls[currentPhotoIndex]}')`;
    modalThumbnailStrip.innerHTML = '';
    imageUrls.forEach((url, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail-img';
        thumb.style.backgroundImage = `url('${url}')`;
        if (index === currentPhotoIndex) thumb.classList.add('active');
        thumb.addEventListener('click', () => {
            currentPhotoIndex = index;
            modalMainImage.style.backgroundImage = `url('${url}')`;
            modalThumbnailStrip.querySelector('.active')?.classList.remove('active');
            thumb.classList.add('active');
        });
        modalThumbnailStrip.appendChild(thumb);
    });
    
    const heartBtnContainer = document.createElement('div');
    heartBtnContainer.id = 'modal-heart-btn';
    heartBtnContainer.dataset.recordId = record.id;
    modalHeaderActions.appendChild(heartBtnContainer);

    modalOptionsContainer.innerHTML = '';
    rawOptions.forEach((opt, index) => {\
        const optionButton = document.createElement('button');
        optionButton.className = 'option-btn';
        optionButton.dataset.optionIndex = index;
        if (itemState.selectedOptionIndex === index) {
            optionButton.classList.add('selected');
        }
        let priceModText = '';
        if (opt.price !== null) {
            priceModText = `$${opt.price.toFixed(2)}`;
        } else if (opt.priceChange !== null) {
            priceModText = `${opt.priceChange >= 0 ? '+' : ''}$${opt.priceChange.toFixed(2)}`;
        }
        optionButton.innerHTML = `${opt.name} <span class=\"price-mod\">${priceModText}</span>`;

        if (allRecordNames.has(opt.name)) {
            optionButton.dataset.childName = opt.name;
            optionButton.addEventListener('click', (e) => {
                e.stopPropagation();
                const childName = e.currentTarget.dataset.childName;
                const childRecord = state.records.all.find(r => r.fields.Name === childName);
                if (childRecord) {
                    log('Modal', `Navigating from option to item: ${childName}`);
                    // When drilling down from an option, call showDetailModal without isInternalNavigation = true
                    showDetailModal(childRecord);
                } else {
                    log('Modal', `Could not find record for child option: ${childName}`);
                }
            });
        } else {
            optionButton.addEventListener('click', (e) => {
                modalOptionsContainer.querySelectorAll('.option-btn').forEach(btn => btn.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                const newIndex = parseInt(e.currentTarget.dataset.optionIndex, 10);
                e.currentTarget.dispatchEvent(new CustomEvent('change', {
                    bubbles: true,
                    detail: { selectedOptionIndex: newIndex }
                }));
                modalItemDescription.textContent = opt.description || record.fields.Description || '';
                const newPrice = getRecordPrice(record, newIndex);
                modalItemPrice.innerHTML = (typeof newPrice === 'number' ? `$${newPrice.toFixed(2)}` : 'N/A') + pricingTypeHTML;
            });
        }
        modalOptionsContainer.appendChild(optionButton);
    });

    if (!isGrouping) {
        modalActionsContainer.style.display = 'block';
        modalNotesContainer.style.display = 'block';
        modalItemNote.value = itemState.note;
        const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        modalQuantitySelector.innerHTML = `<div class=\"quantity-selector\" data-record-id=\"${record.id}\"><button class=\"quantity-btn minus\" aria-label=\"Decrease quantity\">-</button><input type=\"number\" class=\"quantity-input\" value=\"${itemState.quantity}\" min=\"${headcountMin}\"><button class=\"quantity-btn plus\" aria-label=\"Increase quantity\">+</button></div>`;
        const plusBtn = modalQuantitySelector.querySelector('.plus');
        const minusBtn = modalQuantitySelector.querySelector('.minus');
        const input = modalQuantitySelector.querySelector('input');
        plusBtn.addEventListener('click', () => { input.stepUp(); input.dispatchEvent(new Event('change', { bubbles: true })); });
        minusBtn.addEventListener('click', () => { input.stepDown(); input.dispatchEvent(new Event('change', { bubbles: true })); });
    } else {
        modalActionsContainer.style.display = 'none';
        modalNotesContainer.style.display = 'none';
        modalQuantitySelector.innerHTML = '';
    }

// --- Calendar Initialization (same as before) ---
    modalCalendarContainer.innerHTML = ''; // Clear previous calendar
    const iCalUrl = record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL]; // Get iCal URL

    if (iCalUrl) {
        modalCalendarContainer.style.display = 'block'; // Show container if URL exists
        log('Modal', `iCal URL found for ${record.id}, initializing calendar.`);

        const busyTimes = await api.fetchCalendarForRecord(record);
        const calendarInstance = window.flatpickr(modalCalendarContainer, {
            inline: true,
            showMonths: 1,
            disable: [(date) => {
                const status = getDayStatus(date, busyTimes, record);
                return status.status === AVAILABILITY_STATUS.NONE;
            }],
            onDayCreate: function (dObj, dStr, fp, dayElem) {
                const day = dayElem.dateObj;
                const status = getDayStatus(day, busyTimes, record);
                let className = '';
                let tooltip = status.reason;
                if (status.status === AVAILABILITY_STATUS.FULL) {
                    className = 'available-full';
                } else if (status.status === AVAILABILITY_STATUS.PARTIAL) {
                    className = 'available-partial';
                    tooltip = `${status.reason}\nAvailable slots: ${getAvailableSlotsForDay(day, busyTimes) || 'None'}`;
                } else {
                    className = 'unavailable';
                }
                dayElem.classList.add(className);
                dayElem.setAttribute('data-tippy-content', tooltip);
            },
            onReady: function () {
                tippy('.flatpickr-day', {
                    content: reference => reference.getAttribute('data-tippy-content'),
                    placement: 'top',
                    theme: 'light',
                    allowHTML: true,
                });
            },
            onChange: (selectedDates) => {
                if (selectedDates.length > 0) {
                    const eventDateInput = document.getElementById('event-date-picker');
                    if (eventDateInput && eventDateInput._flatpickr) {
                        eventDateInput._flatpickr.setDate(selectedDates[0], true);
                    }
                }
            }
        });
        const eventDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
        if (eventDate) {
            calendarInstance.setDate(new Date(eventDate), true);
        }
    } else {
        modalCalendarContainer.style.display = 'none'; // Hide container if no URL
        log('Modal', `No iCal URL for ${record.id}, hiding calendar.`);
    }
    // --- End Calendar Logic ---

    ui.updateCardIcon(record.id);

    modalOverlay.classList.add('active');
    modalOverlay.style.display = 'flex';
    document.body.classList.add('modal-open');
    setTimeout(() => {
        const chatContainer = document.getElementById('modal-chat-container');
        const isChatEnabledOnItem = record.fields['Chat Enabled'] || false;
        log('Modal Chat Init', {
            isAuthenticated: state.session.user.isAuthenticated,
            isChatEnabledOnItem: isChatEnabledOnItem,
            chatContainerExists: !!chatContainer,
            user: state.session.user
        });
        if (state.session.user.isAuthenticated && chatContainer && isChatEnabledOnItem) {
            log('Modal', 'All conditions met. Initializing item chat.');
            chatContainer.style.display = 'flex';
            initializeItemChat(record.id);
        } else {
            log('Modal', 'Hiding chat. Reason:', {
                isAuthenticated: state.session.user.isAuthenticated,
                isChatEnabledOnItem: isChatEnabledOnItem,
                chatContainerExists: !!chatContainer
            });
            if (chatContainer) {
                chatContainer.style.display = 'none';
            }
        }
    }, 0);
}

export function hideDetailModal() {
    console.log('[hideDetailModal] Called.');
    // --- THIS IS THE FIX ---
    // This function now ONLY handles the UI. It no longer touches the URL.
    const closeBtn = document.getElementById('modal-close-btn');
    closeBtn.onclick = null; // Remove the listener
    modalOverlay.removeEventListener('click', handleOverlayClick);
    document.removeEventListener('keydown', handleEscapeKey);
    if (currentItemChatRecordId) {
        log('Chat', `Closing item chat for recordId: ${currentItemChatRecordId}`);
        currentItemChatRecordId = null;
    }

    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        setTimeout(() => {
            modalOverlay.style.display = 'none';
            resetModalState();
        }, 300);
        document.body.classList.remove('modal-open');
    }
    // --- END FIX ---
}

export async function showCheckoutModal(shopSettings) {
    currentShopSettings = shopSettings;
    log('Modal', 'Showing checkout modal.');
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    const fullTotalEl = document.getElementById('full-total-price');
    const checkoutCloseBtn = document.getElementById('checkout-close-btn');
    const summaryDetailsEl = document.getElementById('checkout-summary-details');
    const tipAmountInput = document.getElementById('tip-amount');
    const paymentChoiceContainer = document.getElementById('payment-choice-container');
    const termsContainer = document.querySelector('.terms-and-conditions');
    const paymentForm = document.getElementById('payment-form');
    const paymentSuccessMessage = document.getElementById('payment-success-message');
    const checkoutTotalDepositSection = document.querySelector('.checkout-total-deposit-section');


    if (!checkoutModalOverlay) return;

    const handleOverlayClick = (e) => {
        if (e.target === checkoutModalOverlay) {
            hideCheckoutModal();
        }
    };
    checkoutModalOverlay.addEventListener('click', handleOverlayClick);
    
    checkoutModalOverlay.removeEventListenerOnClick = () => {
        checkoutModalOverlay.removeEventListener('click', handleOverlayClick);
    };

    if (checkoutCloseBtn) checkoutCloseBtn.addEventListener('click', hideCheckoutModal);
    
    // 1. RE-CALCULATE FINAL TOTAL & RENDER SUMMARY LIST
    summaryDetailsEl.innerHTML = '';
    tipAmountInput.value = '';
    let finalTotal = 0;
    const summaryList = document.createElement('ul');
    const paymentHistoryList = document.createElement('ul');
    paymentHistoryList.innerHTML = '<h4>Payment History</h4>';

    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;

        const itemState = state.cart.lockedItems.get(recordId) || {};
        const price = itemState.overridePrice ?? getRecordPrice(record, itemState.selectedOptionIndex);
        const itemTotal = price * (itemState.quantity || 1);
        finalTotal += itemTotal;
        
        const listItem = document.createElement('li');
        let noteHtml = '';
        if (itemState.note && itemState.note.trim() !== '') {
            // Cleaned up innerHTML
            noteHtml = `<small class=\"checkout-summary-note\">Note: ${itemState.note}</small>`;
        }
        
        // Cleaned up innerHTML
        listItem.innerHTML = `
            <div class=\"summary-item-details\">
                <span class=\"summary-item-name\">${record.fields.Name} (x${itemState.quantity || 1})</span>
                ${noteHtml}
            </div>
            <span class=\"summary-item-price\">$${itemTotal.toFixed(2)}</span>
        `;
        summaryList.appendChild(listItem);
    }
    summaryDetailsEl.appendChild(summaryList);
    
    // Populate Payment History
    const paymentHistory = state.session.user.paymentHistory || [];
    paymentHistory.forEach(p => {
        const date = new Date(p.date).toLocaleDateString();
        const historyItem = document.createElement('li');
        // Cleaned up innerHTML
        historyItem.innerHTML = `
            <div class=\"summary-item-details\">
                <span class=\"summary-item-name\">${p.note}</span>
                <small>${date}</small>
            </div>
            <span class=\"summary-item-price paid-amount\">+$${p.amount.toFixed(2)}</span>
        `;
        paymentHistoryList.appendChild(historyItem);
    });

    // Update the DOM element with the now-calculated total
    fullTotalEl.textContent = `$${finalTotal.toFixed(2)}`;
    fullTotalEl.dataset.total = finalTotal;

    const amountReceived = state.session.user.amountReceived || 0;
    const totalDue = finalTotal - amountReceived;
    const isPlanEmpty = finalTotal <= 0;
    const isFullyPaid = totalDue <= 0.009;


    // Dynamically set the total cost label
    const totalLabel = document.getElementById('checkout-total-label');
    if (totalLabel) {
        totalLabel.textContent = isFullyPaid ? 'Total Plan Cost:' : 'Total Estimated Cost:';
    }


    if (termsContainer && currentShopSettings.terms) {
        // Cleaned up innerHTML
        termsContainer.innerHTML = `<h4>Simplified Terms</h4><p>${currentShopSettings.terms.replace(/\n/g, '<br>')}</p>`;
    }


    // 2. CHECKOUT LOGIC FLOW CONTROL

    if (isPlanEmpty) {
        log('Modal', 'Checkout plan is empty, showing modal placeholder.');
        // Hide payment form/controls and show message
        paymentForm.style.display = 'none';
        checkoutTotalDepositSection.style.display = 'none';
        summaryDetailsEl.innerHTML = '<p style=\"text-align: center; color: #dc3545;\">Please add items to your locked plan before checking out.</p>';
        paymentSuccessMessage.style.display = 'none';
        
    } else if (isFullyPaid) {
        log('Modal', 'Plan is fully paid, showing payment history and additional tip option.');
        // Display payment history
        summaryDetailsEl.appendChild(paymentHistoryList);
        
        // Hide payment choice (deposit/full)
        paymentChoiceContainer.style.display = 'none';
        
        // Ensure tip section is set up for ADDITIONAL PAYMENT
        const tipRow = document.querySelector('.tip-row');
        tipRow.style.display = 'flex'; 

        // Change the main section to accommodate tip/extra payment
        paymentForm.style.display = 'block'; // Keep the form visible for tip/extra payment
        paymentSuccessMessage.style.display = 'none';

        // Update the form's total display fields manually
        document.getElementById('deposit-label').textContent = 'Additional Payment/Tip:';
        tipAmountInput.placeholder = '$0.00';
        tipAmountInput.value = '';

        // Recalculate display amount based only on tip for initial load
        await updateProcessingFeeDisplay(); 

    } else {
        log('Modal', 'Plan has balance due, proceeding to payment initialization.');
        
        // Display payment choice if applicable
        if (currentShopSettings.paymentOptions === 'DepositOrFull' && amountReceived === 0) {
            paymentChoiceContainer.style.display = 'block';
        } else {
            paymentChoiceContainer.style.display = 'none';
        }
        
        paymentForm.style.display = 'block';
        checkoutTotalDepositSection.style.display = 'block';
        paymentSuccessMessage.style.display = 'none';


        // 3. Initialize Stripe Elements
        try {
            const totalDue = finalTotal - amountReceived;
            let amountInCentsBeforeFee = Math.round(totalDue * 100);
            
            // 3.1. Fetch the FIRST Payment Intent
            const intentResponse = await fetch('/api/create-payment-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    amount: amountInCentsBeforeFee, 
                    paymentMethodType: 'card' // Initial default
                }),
            });
            if (!intentResponse.ok) {
                 const errorData = await intentResponse.json();
                 throw new Error(`Failed to create Payment Intent: ${errorData.error}`);
            }
            const paymentIntentData = await intentResponse.json();
            const clientSecret = paymentIntentData.clientSecret;

            // 3.2. Initialize Stripe
            stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
            const elements = stripe.elements({ clientSecret, appearance: { theme: 'stripe' } }); 
            
            const cardElementContainer = document.getElementById('card-element');
            if (cardElementContainer) cardElementContainer.innerHTML = '';
            
            // 3.3. Create and mount the unified Payment Element
            const paymentElement = elements.create('payment');
            paymentElement.mount('#card-element');
            
            // 3.4. Store elements instance and update display
            checkoutModalOverlay.stripeElements = elements;
            checkoutModalOverlay.paymentElement = paymentElement;
            
            // 3.5. Calculate initial fee and final payment amount.
            await updateProcessingFeeDisplay(); 

            // 3.6. Attach listeners
            tipAmountInput.addEventListener('input', updateProcessingFeeDisplay);
            paymentElement.on('change', () => updateProcessingFeeDisplay()); 
            
        } catch (err) {
            console.error("Failed to initialize payment form:", err);
            alert(`Could not initialize payment form: ${err.message}. Please try again later.`);
            hideCheckoutModal();
            return;
        }
    }

    // Final UI show
    checkoutModalOverlay.classList.add('active');
    setTimeout(() => {
        checkoutModalOverlay.style.display = 'flex';
        if(checkoutCloseBtn) checkoutCloseBtn.focus();
    }, 0);
    document.body.classList.add('modal-open');
}


export function hideCheckoutModal() {
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    if (checkoutModalOverlay) {
        if (checkoutModalOverlay.removeEventListenerOnClick) {
            checkoutModalOverlay.removeEventListenerOnClick();
        }
        document.getElementById('tip-amount')?.removeEventListener('input', updateProcessingFeeDisplay);
        document.querySelectorAll('input[name=\"paymentChoice\"]').forEach(radio => {
            radio.removeEventListener('change', updateProcessingFeeDisplay);
        });
        // Note: The Payment Element's 'change' listener is removed when the element instance is garbage collected.

        checkoutModalOverlay.classList.remove('active');
        setTimeout(() => {
            const checkoutCloseBtn = document.getElementById('checkout-close-btn');
            if (checkoutCloseBtn) {
                checkoutCloseBtn.removeEventListener('click', hideCheckoutModal);
            }
            checkoutModalOverlay.style.display = 'none';
            log('Modal', 'Checkout modal hidden.');
        }, 300);
        document.body.classList.remove('modal-open');
    }
}

export function getStripeContext() {
    const cardElement = document.getElementById('checkout-modal-overlay')?.cardElement;
    const elements = document.getElementById('checkout-modal-overlay')?.stripeElements;
    return { stripe, elements };
}
