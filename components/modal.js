// REPLACE THE ENTIRE CONTENTS OF: components/modal.js

import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY } from '../config.js';
import { parseOptions, updateUrl, getGroupPriceRange, getRecordPrice } from '../utils.js'; // <-- UPDATED
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS } from '../availability.js';
import { log } from '../utils/debug.js';
import { initializeItemChat } from '../chat.js';

let stripe;
let currentShopSettings = {};
const modalOverlay = document.getElementById('detail-modal-overlay');
let currentItemChatRecordId = null;


// --- THIS IS THE FIX ---
// This new function safely closes the modal by updating the URL state
// and then hiding the UI, instead of using history.back().
function closeDetailModal() {
    updateUrl({ openItem: null }); // Remove the openItem param
    hideDetailModal(); // Handle the UI hiding
}


function handleEscapeKey(event) {
    if (event.key === 'Escape') {
        closeDetailModal();
    }
}

function handleOverlayClick(event) {
    // Only close if the click is directly on the overlay, not its children
    if (event.target === modalOverlay) {
        closeDetailModal();
    }
}
// --- END FIX ---
function updateCheckoutDisplay() {
    const fullTotalEl = document.getElementById('full-total-price');
    const finalTotal = parseFloat(fullTotalEl.dataset.total || 0);
    const amountReceived = state.session.user.amountReceived || 0;
    const totalDue = Math.max(0, finalTotal - amountReceived); // Ensure total due isn't negative

    const choice = document.querySelector('input[name="paymentChoice"]:checked')?.value || 'deposit';
    let baseAmountToCharge = totalDue; // Default to remaining balance if already paid deposit
    const depositLabel = document.getElementById('deposit-label');
    const depositPrice = document.getElementById('deposit-price');
    const paymentChoiceContainer = document.getElementById('payment-choice-container');

    if (amountReceived === 0) { // First payment
        if (currentShopSettings.paymentOptions === 'DepositOrFull') {
             paymentChoiceContainer.style.display = 'block'; // Show choices only on first payment if allowed
             if (choice === 'full') {
                 baseAmountToCharge = finalTotal;
                 depositLabel.textContent = 'Full Amount Due Today:';
             } else {
                 baseAmountToCharge = finalTotal * 0.35; // Calculate deposit
                 depositLabel.textContent = '35% Deposit Due Today:';
             }
         } else { // DepositOnly shops or subsequent payments
            paymentChoiceContainer.style.display = 'none';
            baseAmountToCharge = finalTotal * 0.35; // Always calculate deposit on first payment for DepositOnly
            depositLabel.textContent = '35% Deposit Due Today:';
        }
    } else { // Subsequent payments
        paymentChoiceContainer.style.display = 'none'; // No choices after first payment
        depositLabel.textContent = 'Remaining Balance Due:';
        baseAmountToCharge = totalDue; // Charge the rest
    }

    const tipAmount = parseFloat(document.getElementById('tip-amount').value) || 0;
    const finalAmountToCharge = baseAmountToCharge + tipAmount;
    
    // Ensure amount is at least $0.50 for Stripe
    depositPrice.textContent = (finalAmountToCharge >= 0.50) ? `$${finalAmountToCharge.toFixed(2)}` : '$0.00'; 
    
    // Disable payment button if amount is too low
    const submitBtn = document.getElementById('payment-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = finalAmountToCharge < 0.50;
    }
}


function getBreadcrumbs(record) {
    const breadcrumbs = [];
    let current = record;
    // Limit loop to prevent infinite recursion in case of data error
    let safetyCounter = 0; 
    while (current && current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] && safetyCounter < 10) {
        const parentName = current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
        breadcrumbs.unshift(parentName);
        // Find parent based on Name field matching the Parent Item field
        current = state.records.all.find(r => r.fields.Name === parentName);
        if (!current) break; // Exit if parent not found
        safetyCounter++;
    }
    return breadcrumbs;
}


function resetModalState() {
    const elementsToClear = [
        'modal-item-name', 'modal-item-price', 'modal-item-description',
        'modal-thumbnail-strip', 'modal-options-container', 
        'modal-quantity-selector', 'modal-calendar-container', 'modal-breadcrumbs'
    ];
    elementsToClear.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });

    const elementsToResetValue = ['modal-item-note'];
    elementsToResetValue.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    const imageEl = document.getElementById('modal-main-image');
    if (imageEl) imageEl.style.backgroundImage = '';
    
    // Reset specific display styles if necessary
    const actionsContainer = document.getElementById('modal-actions-container');
    if (actionsContainer) actionsContainer.style.display = 'block'; // Default display
    const notesContainer = document.getElementById('modal-notes-container');
    if (notesContainer) notesContainer.style.display = 'block'; // Default display

    log('Modal', 'Reset modal state.');
}


export async function showDetailModal(record, startPhotoIndex = 0) {
    console.log('[showDetailModal] Called for item:', record.id);
    log('Modal', `Showing detail modal for "${record.fields.Name}"`);
    updateUrl({ openItem: record.id }); // Update URL first

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
    const addToPlanBtn = document.getElementById('modal-add-to-plan-btn');
    const closeBtn = document.getElementById('modal-close-btn');

    // Remove previous listeners before adding new ones
    closeBtn.removeEventListener('click', closeDetailModal);
    modalOverlay.removeEventListener('click', handleOverlayClick);
    document.removeEventListener('keydown', handleEscapeKey);

    // Add new listeners
    closeBtn.addEventListener('click', closeDetailModal);
    modalOverlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleEscapeKey);


    resetModalState();
    modalOverlay.dataset.recordId = record.id;
    currentItemChatRecordId = record.id;
    
    const isLocked = state.cart.lockedItems.has(record.id);
    modalOverlay.dataset.mode = isLocked ? 'edit-locked' : 'edit-favorite';
    
    const itemState = isLocked ? state.cart.lockedItems.get(record.id) : ui.getItemState(record.id);
    if (addToPlanBtn) {
        addToPlanBtn.textContent = isLocked ? 'Update Plan' : 'Add to Plan';
        addToPlanBtn.dataset.tooltip = isLocked ? 'Update plan with changes' : 'Add to plan';
        addToPlanBtn.disabled = false; // Ensure button is enabled initially
    }

    // --- Image Loading ---
    let imageUrls = []; // Initialize as empty array
    try {
        const imageData = await api.fetchImagesForRecord(record, state.records.all, new Map());
        imageUrls = imageData.imageUrls || []; // Ensure it's an array even if null
    } catch (error) {
        console.error("Failed to fetch images for modal:", error);
        // Provide a fallback if needed, or leave imageUrls empty
    }
    
    modalItemName.textContent = record.fields.Name || 'Untitled';
    modalItemDescription.textContent = record.fields.Description || '';
    
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const allRecordNames = new Set(state.records.all.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => allRecordNames.has(opt.name));

    // --- New Price Logic ---
    const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];

    if (isGrouping) {
        const range = getGroupPriceRange(record);
        modalItemPrice.innerHTML = (range && typeof range.min === 'number')
            ? (range.min === range.max ? `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`)
            : 'Price Varies';
    } else {
        const unitPrice = getRecordPrice(record, itemState.selectedOptionIndex);
        if (headcountMin > 1 && typeof unitPrice === 'number' && unitPrice > 0) { // Added > 0 check
            const minimumTotalPrice = unitPrice * headcountMin;
            const typeLabel = pricingType ? pricingType.toLowerCase() : 'items';
            modalItemPrice.innerHTML = `$${minimumTotalPrice.toFixed(2)} <span class="pricing-type">for up to ${headcountMin} ${typeLabel}</span>`;
        } else if (typeof unitPrice === 'number') {
            const pricingTypeHTML = pricingType ? `<span class="pricing-type"> / ${pricingType.toLowerCase()}</span>` : '';
            modalItemPrice.innerHTML = `$${unitPrice.toFixed(2)}${pricingTypeHTML}`;
        } else {
             modalItemPrice.innerHTML = 'N/A';
        }
    }
    // --- End Price Logic ---

    // --- Image Gallery Display ---
    let currentPhotoIndex = startPhotoIndex < imageUrls.length ? startPhotoIndex : 0; // Ensure index is valid
    if (imageUrls.length > 0) {
        modalMainImage.style.backgroundImage = `url('${imageUrls[currentPhotoIndex]}')`;
        modalThumbnailStrip.innerHTML = ''; // Clear previous thumbnails
        imageUrls.forEach((url, index) => {
            const thumb = document.createElement('div');
            thumb.className = 'thumbnail-img';
            thumb.style.backgroundImage = `url('${url}')`;
            if (index === currentPhotoIndex) thumb.classList.add('active');
            thumb.addEventListener('click', () => {
                currentPhotoIndex = index;
                modalMainImage.style.backgroundImage = `url('${imageUrls[index]}')`;
                // Update active thumbnail
                modalThumbnailStrip.querySelector('.thumbnail-img.active')?.classList.remove('active');
                thumb.classList.add('active');
            });
            modalThumbnailStrip.appendChild(thumb);
        });
    } else {
        // Handle case with no images
        modalMainImage.style.backgroundImage = ''; // Or set a placeholder
        modalThumbnailStrip.innerHTML = '<p>No images available.</p>';
    }

    // --- Breadcrumbs & Header Actions ---
    modalHeaderActions.innerHTML = ''; // Clear previous actions
    const breadcrumbs = getBreadcrumbs(record);
    if (breadcrumbs.length > 0) {
        modalBreadcrumbs.innerHTML = breadcrumbs.map(name => `<a href="#" class="parent-link" data-parent-name="${name}" title="Go to ${name}">${name}</a>`).join(' &gt; ');
    } else {
        modalBreadcrumbs.innerHTML = ''; // Clear if no breadcrumbs
    }

    const heartBtnContainer = document.createElement('div');
    heartBtnContainer.id = 'modal-heart-btn';
    heartBtnContainer.dataset.recordId = record.id;
    modalHeaderActions.appendChild(heartBtnContainer);
    
    // --- Options ---
    modalOptionsContainer.innerHTML = ''; // Clear previous options
    rawOptions.forEach((opt, index) => {
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
        optionButton.innerHTML = `${opt.name} ${priceModText}`;

        const linkedRecord = state.records.all.find(r => r.fields.Name === opt.name && r.id !== record.id);

        if (linkedRecord) {
            optionButton.dataset.linkedRecordId = linkedRecord.id;
            optionButton.addEventListener('click', (e) => {
                e.stopPropagation(); 
                log('Modal', `Option clicked, linking to item: ${linkedRecord.fields.Name}`);
                closeDetailModal(); // Close current modal gracefully
                setTimeout(() => {
                    showDetailModal(linkedRecord); // Open modal for the linked item
                }, 50); 
            });
        } else {
            optionButton.addEventListener('click', (e) => {
                modalOptionsContainer.querySelectorAll('.option-btn').forEach(btn => btn.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                const newIndex = parseInt(e.currentTarget.dataset.optionIndex, 10);
                
                // Dispatch event BEFORE updating price display
                e.currentTarget.dispatchEvent(new CustomEvent('change', {
                    bubbles: true,
                    detail: { selectedOptionIndex: newIndex }
                }));

                // --- Update Price Display Logic inside Option Listener ---
                 modalItemDescription.textContent = opt.description || record.fields.Description || ''; // Update description too
                const updatedUnitPrice = getRecordPrice(record, newIndex); // Get unit price for the NEW option
                const currentHeadcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1; // Re-fetch min count
                const currentPricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE]; // Re-fetch type

                if (currentHeadcountMin > 1 && typeof updatedUnitPrice === 'number' && updatedUnitPrice > 0) { // Added > 0 check
                    const minimumTotalPrice = updatedUnitPrice * currentHeadcountMin;
                    const typeLabel = currentPricingType ? currentPricingType.toLowerCase() : 'items';
                    modalItemPrice.innerHTML = `$${minimumTotalPrice.toFixed(2)} <span class="pricing-type">for up to ${currentHeadcountMin} ${typeLabel}</span>`;
                } else if (typeof updatedUnitPrice === 'number') {
                    const pricingTypeHTML = currentPricingType ? `<span class="pricing-type"> / ${currentPricingType.toLowerCase()}</span>` : '';
                    modalItemPrice.innerHTML = `$${updatedUnitPrice.toFixed(2)}${pricingTypeHTML}`;
                } else {
                    modalItemPrice.innerHTML = 'N/A';
                }
                // --- End Update ---
            });
        }
        modalOptionsContainer.appendChild(optionButton);
    });
    
    // --- Quantity & Notes (Show/Hide based on type) ---
    if (!isGrouping) {
        modalActionsContainer.style.display = 'block';
        modalNotesContainer.style.display = 'block';
        modalItemNote.value = itemState.note;
        
        // Ensure quantity respects minimum
        const currentQuantity = Math.max(itemState.quantity, headcountMin);
        
        modalQuantitySelector.innerHTML = `<div class="quantity-selector" data-record-id="${record.id}"><button class="quantity-btn minus" aria-label="Decrease quantity">-</button><input type="number" class="quantity-input" value="${currentQuantity}" min="${headcountMin}"><button class="quantity-btn plus" aria-label="Increase quantity">+</button></div>`;
        
        // Re-add event listeners for quantity buttons
        const plusBtn = modalQuantitySelector.querySelector('.plus');
        const minusBtn = modalQuantitySelector.querySelector('.minus');
        const input = modalQuantitySelector.querySelector('input');
        if (plusBtn && minusBtn && input) {
            plusBtn.addEventListener('click', () => { input.stepUp(); input.dispatchEvent(new Event('change', { bubbles: true })); });
            minusBtn.addEventListener('click', () => { input.stepDown(); input.dispatchEvent(new Event('change', { bubbles: true })); });
        }
    } else {
        // Hide quantity, notes, and add-to-plan button for groupings
        modalActionsContainer.style.display = 'none';
        modalNotesContainer.style.display = 'none';
        modalQuantitySelector.innerHTML = '';
    }

    // --- Calendar ---
    modalCalendarContainer.innerHTML = ''; // Clear previous calendar
    let calendarInstance = null; // To store flatpickr instance
    try {
        const busyTimes = await api.fetchCalendarForRecord(record);
        calendarInstance = window.flatpickr(modalCalendarContainer, {
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
                 } else { // Handles NONE and cases where status might be missing
                     className = 'unavailable';
                 }
                 dayElem.classList.add(className);
                 // Use setAttribute for tippy content
                 dayElem.setAttribute('data-tippy-content', tooltip);
            },
            onReady: function (selectedDates, dateStr, instance) {
                // Initialize Tippy after Flatpickr is ready
                tippy(instance.calendarContainer.querySelectorAll('.flatpickr-day[data-tippy-content]'), { // Target only days with content
                    content: reference => reference.getAttribute('data-tippy-content'),
                    placement: 'top',
                    theme: 'light', // Optional: Choose a theme
                    allowHTML: true, // Allow HTML in tooltips if needed
                });
            },
            onChange: (selectedDates) => {
                if (selectedDates.length > 0) {
                    const eventDateInput = document.getElementById('event-date-picker');
                    // Update main event date picker only if it exists
                    if (eventDateInput && eventDateInput._flatpickr) {
                        eventDateInput._flatpickr.setDate(selectedDates[0], true); // Trigger its change event
                    }
                }
            }
        });
        
        // Set initial date on modal calendar if one exists in state
        const eventDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
        if (eventDate) {
             // Ensure eventDate is a valid date string or Date object
             try {
                const dateToSet = Array.isArray(eventDate) ? new Date(eventDate[0]) : new Date(eventDate);
                if (!isNaN(dateToSet.getTime())) { // Check if date is valid
                    calendarInstance.setDate(dateToSet, false); // Don't trigger onChange
                }
            } catch (e) {
                console.warn("Could not parse event date for modal calendar:", eventDate);
            }
        }
    } catch (error) {
        console.error("Failed to initialize calendar:", error);
        modalCalendarContainer.innerHTML = '<p>Could not load availability calendar.</p>';
    }
    
    // --- Final UI Updates ---
    ui.updateCardIcon(record.id); // Update heart icon state
    
    // --- Display Modal ---
    modalOverlay.classList.add('active');
    modalOverlay.style.display = 'flex'; // Use flex to center
    document.body.classList.add('modal-open'); // Prevent body scroll

    // Initialize item chat (deferred slightly to ensure DOM is ready)
    setTimeout(() => {
        const chatContainer = document.getElementById('modal-chat-container');
        const isChatEnabledOnItem = record.fields['Chat Enabled'] || false;
        log('Modal Chat Init', { isAuthenticated: state.session.user.isAuthenticated, isChatEnabledOnItem, chatContainerExists: !!chatContainer });
        
        if (state.session.user.isAuthenticated && chatContainer && isChatEnabledOnItem) {
            log('Modal', 'All conditions met. Initializing item chat.');
            chatContainer.style.display = 'flex'; // Use flex for column layout
            initializeItemChat(record.id);
        } else {
            log('Modal', 'Hiding chat. Reason:', { isAuthenticated: state.session.user.isAuthenticated, isChatEnabledOnItem, chatContainerExists: !!chatContainer });
            if (chatContainer) {
                chatContainer.style.display = 'none'; // Hide if conditions not met
            }
        }
    }, 0);
}


export function hideDetailModal() {
    console.log('[hideDetailModal] Called.');
    // --- THIS IS THE FIX ---
    // This function now ONLY handles the UI. It no longer touches the URL.
    const closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) closeBtn.removeEventListener('click', closeDetailModal); // Clean up listener
    if (modalOverlay) modalOverlay.removeEventListener('click', handleOverlayClick);
    document.removeEventListener('keydown', handleEscapeKey);

    if (currentItemChatRecordId) {
        log('Chat', `Closing item chat for recordId: ${currentItemChatRecordId}`);
        // Add any necessary cleanup for item chat here if needed
        currentItemChatRecordId = null;
    }

    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        // Use transitionend event for smoother cleanup
        const handleTransitionEnd = () => {
             modalOverlay.style.display = 'none';
             resetModalState(); // Reset content AFTER fade out
             modalOverlay.removeEventListener('transitionend', handleTransitionEnd); // Clean up listener
        };
        modalOverlay.addEventListener('transitionend', handleTransitionEnd);
        
        // Fallback timeout in case transitionend doesn't fire (e.g., if display changes immediately)
        setTimeout(() => {
             if (modalOverlay.style.display !== 'none') { // Check if already hidden by event listener
                 modalOverlay.style.display = 'none';
                 resetModalState();
                 modalOverlay.removeEventListener('transitionend', handleTransitionEnd); // Clean up listener just in case
             }
        }, 350); // Slightly longer than CSS transition (0.3s)

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
    const totalLabel = document.getElementById('checkout-total-label');
    const paymentForm = document.getElementById('payment-form');
    const successMessage = document.getElementById('payment-success-message');
    const cardErrors = document.getElementById('card-errors');

    if (!checkoutModalOverlay || !summaryDetailsEl || !fullTotalEl || !tipAmountInput || !paymentChoiceContainer || !paymentForm || !successMessage || !cardErrors) {
        console.error("One or more checkout modal elements not found.");
        return;
    }

    // Reset UI state
    paymentForm.style.display = 'block';
    successMessage.style.display = 'none';
    cardErrors.textContent = '';
    document.getElementById('customer-name').value = state.session.user.name || ''; // Pre-fill name if logged in
    document.getElementById('customer-email').value = state.session.user.email || ''; // Pre-fill email if logged in
    
    // --- Dynamically set the total cost label based on payment history ---
    if (totalLabel) {
        totalLabel.textContent = (state.session.user.amountReceived > 0) ? 'Total Final Cost:' : 'Total Estimated Cost:';
    }

    // --- Overlay Click Handler ---
    const handleCheckoutOverlayClick = (e) => {
        if (e.target === checkoutModalOverlay) {
            hideCheckoutModal();
        }
    };
    // Remove previous listener before adding
    checkoutModalOverlay.removeEventListener('click', handleCheckoutOverlayClick);
    checkoutModalOverlay.addEventListener('click', handleCheckoutOverlayClick);
    // Store handler for removal in hideCheckoutModal
    checkoutModalOverlay._eventListener = handleCheckoutOverlayClick; 

    // --- Close Button Handler ---
    if (checkoutCloseBtn) {
        checkoutCloseBtn.removeEventListener('click', hideCheckoutModal); // Remove previous
        checkoutCloseBtn.addEventListener('click', hideCheckoutModal);
    }
    
    // --- Build Summary ---
    summaryDetailsEl.innerHTML = ''; // Clear previous summary
    tipAmountInput.value = ''; // Reset tip
    let finalTotal = 0;
    const summaryList = document.createElement('ul');
    summaryList.id = 'checkout-summary-list'; // Add ID for potential styling

    // Ensure state.cart.lockedItems is iterable
    if (!(state.cart.lockedItems instanceof Map)) {
        console.error("state.cart.lockedItems is not a Map in showCheckoutModal");
        return; // Prevent errors if state is corrupt
    }

    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record || !record.fields) continue; // Skip if record not found or has no fields

        const price = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);
        // Ensure quantity respects minimum headcount
        const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        const effectiveQuantity = Math.max(itemInfo.quantity || 1, headcountMin);
        
        const itemTotal = price * effectiveQuantity;
        finalTotal += itemTotal;
        const listItem = document.createElement('li');
        
        let noteHtml = '';
        if (itemInfo.note && itemInfo.note.trim() !== '') {
            // Basic sanitization: replace < and > to prevent HTML injection
            const sanitizedNote = itemInfo.note.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            noteHtml = `<small class="checkout-summary-note">Note: ${sanitizedNote}</small>`;
        }
        
        listItem.innerHTML = `
            <div class="summary-item-details">
                <span class="summary-item-name">${record.fields.Name} (x${effectiveQuantity})</span> 
                ${noteHtml}
            </div>
            <span class="summary-item-price">$${itemTotal.toFixed(2)}</span>
        `;
        summaryList.appendChild(listItem);
    }

    summaryDetailsEl.appendChild(summaryList);

    // --- Totals & Payment Choices ---
    fullTotalEl.textContent = `$${finalTotal.toFixed(2)}`;
    fullTotalEl.dataset.total = finalTotal; // Store raw total for calculations

    // Reset radio buttons and add listeners
    const paymentRadios = document.querySelectorAll('input[name="paymentChoice"]');
    paymentRadios.forEach(radio => {
        radio.removeEventListener('change', updateCheckoutDisplay); // Remove previous listener
        radio.addEventListener('change', updateCheckoutDisplay);
        if (radio.value === 'deposit') radio.checked = true; // Default to deposit
    });
    
    // --- Terms ---
    if (termsContainer && currentShopSettings.terms) {
        // Basic sanitization for terms
        const sanitizedTerms = currentShopSettings.terms.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, '<br>');
        termsContainer.innerHTML = `<h4>Simplified Terms</h4><p>${sanitizedTerms}</p>`;
        termsContainer.style.display = 'block'; // Ensure it's visible
    } else if (termsContainer) {
         termsContainer.style.display = 'none'; // Hide if no terms
    }

    // --- Tip Listener ---
    tipAmountInput.removeEventListener('input', updateCheckoutDisplay); // Remove previous
    tipAmountInput.addEventListener('input', updateCheckoutDisplay);
    
    // --- Initial Calculation ---
    updateCheckoutDisplay(); // Calculate initial amount due
    
    // --- Stripe Initialization ---
    try {
        stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
        const elements = stripe.elements();
        const cardElementContainer = document.getElementById('card-element');
        if (cardElementContainer) cardElementContainer.innerHTML = ''; // Clear previous card element
        
        // Customize Stripe Element appearance if desired
        const cardElement = elements.create('card', { 
            // style: { base: { fontSize: '16px' } } 
        }); 
        cardElement.mount('#card-element');
        checkoutModalOverlay.cardElement = cardElement; // Store reference

        // Show modal after setup
        checkoutModalOverlay.style.display = 'flex';
        setTimeout(() => {
             checkoutModalOverlay.classList.add('active');
             if(checkoutCloseBtn) checkoutCloseBtn.focus(); // Focus close button for accessibility
        }, 10); // Small delay ensures transition triggers
        document.body.classList.add('modal-open');

    } catch (err) {
        console.error("Failed to initialize Stripe payment form:", err);
        alert(`Could not initialize payment form: ${err.message}. Please try again later.`);
        hideCheckoutModal(); // Hide if Stripe fails
    }
}


export function hideCheckoutModal() {
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    if (checkoutModalOverlay) {
        // --- Clean up event listeners ---
        if (checkoutModalOverlay._eventListener) {
            checkoutModalOverlay.removeEventListener('click', checkoutModalOverlay._eventListener);
            delete checkoutModalOverlay._eventListener; // Remove stored handler
        }
        const checkoutCloseBtn = document.getElementById('checkout-close-btn');
        if (checkoutCloseBtn) {
            checkoutCloseBtn.removeEventListener('click', hideCheckoutModal);
        }
        document.getElementById('tip-amount')?.removeEventListener('input', updateCheckoutDisplay);
        document.querySelectorAll('input[name="paymentChoice"]').forEach(radio => {
            radio.removeEventListener('change', updateCheckoutDisplay);
        });
        
        // --- Hide UI ---
        checkoutModalOverlay.classList.remove('active');
        // Use transitionend for smoother hiding and cleanup
        const handleTransitionEnd = () => {
             checkoutModalOverlay.style.display = 'none';
             // Optionally clear card element here if needed: checkoutModalOverlay.cardElement?.unmount();
             log('Modal', 'Checkout modal hidden.');
             checkoutModalOverlay.removeEventListener('transitionend', handleTransitionEnd);
        };
        checkoutModalOverlay.addEventListener('transitionend', handleTransitionEnd);

        // Fallback timeout
        setTimeout(() => {
             if (checkoutModalOverlay.style.display !== 'none') {
                 checkoutModalOverlay.style.display = 'none';
                 log('Modal', 'Checkout modal hidden (timeout fallback).');
                 checkoutModalOverlay.removeEventListener('transitionend', handleTransitionEnd);
             }
        }, 350); // Slightly longer than transition

        document.body.classList.remove('modal-open');
    }
}


export function getStripeContext() {
    const cardElement = document.getElementById('checkout-modal-overlay')?.cardElement;
    return { stripe, cardElement };
}
