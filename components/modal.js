// REPLACE THE ENTIRE CONTENTS of components/modal.js

import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY } from '../config.js';
import { parseOptions, updateUrl, getGroupPriceRange, getRecordPrice, getActiveImageTag, getRecordDescription, flattenOptionGroups, debounce, loadStripe, loadFlatpickr, getEffectiveMinQuantity } from '../utils.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS, calculateMissingCategories, buildGoalBucket, calculateRecommendationScore, ATTRIBUTE_TO_KEYWORDS_MAP } from '../availability.js';
import { log } from '../utils/debug.js';
import { initializeItemChat } from '../chat.js';
import { showReceiptModal } from './receipt.js';

/**
 * [V3.7] Generates the "Intelligent Blurb" by calling the central recommendation engine.
 * @param {object} record - The item record being displayed.
 * @returns {string | null} The HTML string for the blurb, or null.
 */
function generateRecommendationBlurb(record) {
    // Get the current sort value from the DOM
    const sortBy = document.getElementById('sort-by')?.value || 'recommended';
    
    // 1. Get the current goal bucket, passing the sortBy value
    const goalBucket = buildGoalBucket(sortBy); // This import already exists
    
    if (goalBucket.length === 0) {
        // "Tip" blurb
        return "<span class='beta-tag-subtle' style='float: right; margin-left: 5px;'>Beta</span><strong style='color: #5a6268;'>Tip:</strong> Add goals to your 'Goals/Notes' or search to get personalized recommendations.";
    }

    // 2. Call the ONE, TRUE scoring function from availability.js
    const score = calculateRecommendationScore(record, goalBucket);

    // 3. Check if the item scored well
    if (score > 0) {
        // Create a simple, robust blurb
        let goalString = "goals"; // Default
        
        // Filter out pillar names (like "Food & Drink") from the blurb for cleaner text
        const displayGoals = goalBucket.filter(g => 
            !ATTRIBUTE_TO_KEYWORDS_MAP["Pillars.Activity"].includes(g.toLowerCase()) &&
            !ATTRIBUTE_TO_KEYWORDS_MAP["Pillars.Food & Drink"].includes(g.toLowerCase()) &&
            !ATTRIBUTE_TO_KEYWORDS_MAP["Pillars.Venues"].includes(g.toLowerCase()) &&
            !ATTRIBUTE_TO_KEYWORDS_MAP["Pillars.Extras"].includes(g.toLowerCase())
        );

        if (displayGoals.length > 2) {
            goalString = `'${displayGoals.slice(0, -1).join("', '")}', and '${displayGoals.slice(-1)}'`;
        } else if (displayGoals.length > 0) {
            goalString = `'${displayGoals.join("' and '")}'`;
        }

        // --- THIS IS THE CHANGE ---\
        // Adds the score directly into the recommendation blurb
        return `<span class='beta-tag-subtle' style='float: right; margin-left: 5px;'>Beta</span><strong style='color: #0056b3;'>Recommended for you (Score: ${score.toFixed(0)})</strong> This item is a good match for your ${goalString} goals.`;
        // --- END THE CHANGE ---\
    }

    return null; // No match
}

let stripe;
let elements; // To hold the Stripe elements instance
let paymentElement; // To hold the payment element
let currentClientSecret = null;
let currentBaseAmount = 0; // To store the amount *before* fees
let currentPaymentType = 'card'; // <-- ADD THIS LINE
let currentProcessingFee = 0; // To store the current fee

let currentShopSettings = {};
const modalOverlay = document.getElementById('detail-modal-overlay');
let currentItemChatRecordId = null;

// Quick Pay Modal Functions
const quickPayModalOverlay = document.getElementById('quick-pay-modal-overlay');

/**
 * Payment app configuration with icons and URL generators
 */
const PAYMENT_APPS = {
    zelle: {
        name: 'Zelle',
        icon: 'Z',
        cssClass: 'zelle',
        // Zelle doesn't have a universal deep link, show email/phone for manual entry
        getUrl: (handle, amount, itemName) => null,
        getDisplayHandle: (handle) => handle,
        getCopyText: (handle, amount, itemName) => {
            if (amount && amount > 0) {
                return `${handle} - Amount: $${amount.toFixed(2)}${itemName ? ` for ${itemName}` : ''}`;
            }
            return handle;
        }
    },
    venmo: {
        name: 'Venmo',
        icon: 'V',
        cssClass: 'venmo',
        // Venmo deep link format with optional amount and note
        getUrl: (handle, amount, itemName) => {
            const cleanHandle = handle.replace('@', '');
            let url = `https://venmo.com/${cleanHandle}`;
            if (amount && amount > 0) {
                url += `?txn=pay&amount=${amount.toFixed(2)}`;
                if (itemName) {
                    url += `&note=${encodeURIComponent(itemName)}`;
                }
            }
            return url;
        },
        getDisplayHandle: (handle) => handle.startsWith('@') ? handle : `@${handle}`
    },
    cashapp: {
        name: 'Cash App',
        icon: '$',
        cssClass: 'cashapp',
        // Cash App deep link format with optional amount
        getUrl: (handle, amount, itemName) => {
            const cleanHandle = handle.replace('$', '');
            let url = `https://cash.app/$${cleanHandle}`;
            if (amount && amount > 0) {
                url += `/${amount.toFixed(2)}`;
            }
            return url;
        },
        getDisplayHandle: (handle) => handle.startsWith('$') ? handle : `$${handle}`
    }
};

/**
 * Shows the Quick Pay modal with payment options for the current store
 * @param {Object} paymentOptions - Parsed App_Pay_JSON object from store
 * @param {number} amount - Total amount (price * quantity) for the item
 * @param {string} itemName - Name of the item being purchased
 * @param {number} quantity - Number of items being purchased
 */
export function showQuickPayModal(paymentOptions, amount = 0, itemName = '', quantity = 1) {
    if (!quickPayModalOverlay) return;

    const optionsContainer = document.getElementById('quick-pay-options-container');
    if (!optionsContainer) return;

    optionsContainer.innerHTML = '';

    // Add amount header if amount is provided
    if (amount && amount > 0) {
        const amountHeader = document.createElement('div');
        amountHeader.className = 'quick-pay-amount-header';
        const quantityText = quantity > 1 ? ` (${quantity} × $${(amount / quantity).toFixed(2)})` : '';
        amountHeader.innerHTML = `
            <div class="quick-pay-amount-total">Total: $${amount.toFixed(2)}${quantityText}</div>
            ${itemName ? `<div class="quick-pay-item-name">${itemName}</div>` : ''}
        `;
        optionsContainer.appendChild(amountHeader);
    }

    if (!paymentOptions || Object.keys(paymentOptions).length === 0) {
        optionsContainer.innerHTML += `
            <div class="quick-pay-no-options">
                <p>No quick pay options available for this store.</p>
            </div>
        `;
    } else {
        // Generate buttons for each payment option
        for (const [key, handle] of Object.entries(paymentOptions)) {
            const appConfig = PAYMENT_APPS[key.toLowerCase()];
            if (!appConfig || !handle) continue;

            const url = appConfig.getUrl(handle, amount, itemName);
            const displayHandle = appConfig.getDisplayHandle(handle);

            const optionElement = document.createElement(url ? 'a' : 'div');
            optionElement.className = 'quick-pay-option-btn';

            if (url) {
                optionElement.href = url;
                optionElement.target = '_blank';
                optionElement.rel = 'noopener noreferrer';
            }

            optionElement.innerHTML = `
                <div class="quick-pay-icon ${appConfig.cssClass}">${appConfig.icon}</div>
                <div class="quick-pay-option-info">
                    <span class="quick-pay-option-name">${appConfig.name}</span>
                    <span class="quick-pay-option-handle">${displayHandle}</span>
                </div>
                <span class="quick-pay-arrow">${url ? '→' : ''}</span>
            `;

            // For Zelle (no URL), add copy functionality with amount info
            if (!url) {
                optionElement.style.cursor = 'pointer';
                optionElement.title = 'Click to copy payment details';
                optionElement.addEventListener('click', () => {
                    const copyText = appConfig.getCopyText ? appConfig.getCopyText(handle, amount, itemName) : handle;
                    navigator.clipboard.writeText(copyText).then(() => {
                        const originalArrow = optionElement.querySelector('.quick-pay-arrow');
                        originalArrow.textContent = 'Copied!';
                        setTimeout(() => {
                            originalArrow.textContent = '';
                        }, 2000);
                    }).catch(err => {
                        console.error('Failed to copy:', err);
                    });
                });
            }

            optionsContainer.appendChild(optionElement);
        }

        // If no valid options were added
        if (optionsContainer.querySelectorAll('.quick-pay-option-btn').length === 0) {
            optionsContainer.innerHTML += `
                <div class="quick-pay-no-options">
                    <p>No quick pay options available for this store.</p>
                </div>
            `;
        }
    }

    // Set up modal event handlers
    const closeBtn = document.getElementById('quick-pay-close-btn');
    if (closeBtn) {
        closeBtn.onclick = hideQuickPayModal;
    }

    const handleQuickPayOverlayClick = (e) => {
        if (e.target === quickPayModalOverlay) {
            hideQuickPayModal();
        }
    };
    quickPayModalOverlay.addEventListener('click', handleQuickPayOverlayClick);
    quickPayModalOverlay._overlayClickHandler = handleQuickPayOverlayClick;

    // Show the modal
    quickPayModalOverlay.classList.add('active');
    quickPayModalOverlay.style.display = 'flex';
    document.body.classList.add('modal-open');

    log('Modal', `Quick Pay modal shown${amount > 0 ? ` for $${amount.toFixed(2)}` : ''}`);
}

/**
 * Hides the Quick Pay modal
 */
export function hideQuickPayModal() {
    if (!quickPayModalOverlay) return;

    // Clean up event handlers
    if (quickPayModalOverlay._overlayClickHandler) {
        quickPayModalOverlay.removeEventListener('click', quickPayModalOverlay._overlayClickHandler);
        delete quickPayModalOverlay._overlayClickHandler;
    }

    quickPayModalOverlay.classList.remove('active');
    setTimeout(() => {
        quickPayModalOverlay.style.display = 'none';
    }, 300);

    // Only remove modal-open if detail modal is also closed
    if (!modalOverlay.classList.contains('active')) {
        document.body.classList.remove('modal-open');
    }

    log('Modal', 'Quick Pay modal hidden');
}

/**
 * Gets the payment options for the current active store
 * @returns {Object|null} Parsed App_Pay_JSON or null
 */
function getStorePaymentOptions() {
    const activeShopId = state.ui.activeShopId;
    if (!activeShopId) return null;

    const activeShop = state.stores.all.find(s => s.id === activeShopId);
    if (!activeShop || !activeShop.fields) return null;

    const appPayJson = activeShop.fields.App_Pay_JSON;
    if (!appPayJson) return null;

    try {
        return JSON.parse(appPayJson);
    } catch (e) {
        console.error('Failed to parse App_Pay_JSON:', e);
        return null;
    }
}

/**
 * Checks if the current store has any quick pay options
 * @returns {boolean}
 */
export function hasQuickPayOptions() {
    const options = getStorePaymentOptions();
    return options && Object.keys(options).length > 0;
}

function closeDetailModal() {
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

async function updateCheckoutDisplay() {
    const finalTotal = parseFloat(document.getElementById('full-total-price').dataset.total || 0);
    const amountReceived = state.session.user.amountReceived || 0;
    const totalDue = finalTotal - amountReceived;
    const isFullyPaid = totalDue <= 0.009; // Check for paid status
    
    const choice = document.querySelector('input[name="paymentChoice"]:checked')?.value || 'deposit';
    let baseAmountToCharge = totalDue; // This is the amount *before* processing fees
    
    const isInitialDeposit = amountReceived === 0 && (currentShopSettings.paymentOptions !== 'DepositOrFull' || choice === 'deposit');
    
    const tipRow = document.querySelector('.tip-row');
    if (tipRow) {
        if (isInitialDeposit && totalDue > baseAmountToCharge * 1.05) {
            tipRow.style.display = 'none';
        } else {
            tipRow.style.display = 'flex';
        }
    }

    if (amountReceived === 0) {
        if (currentShopSettings.paymentOptions === 'DepositOrFull' && choice === 'full') {
            baseAmountToCharge = finalTotal;
            document.getElementById('deposit-label').textContent = 'Full Amount Due:';
        } else {
            baseAmountToCharge = finalTotal * 0.35;
            document.getElementById('deposit-label').textContent = '35% Deposit Due:';
        }
    } else {
        document.getElementById('deposit-label').textContent = 'Remaining Balance Due:';
    }
    const tipAmount = parseFloat(document.getElementById('tip-amount').value) || 0;
    
    let finalBaseAmount = baseAmountToCharge + tipAmount;
    document.getElementById('deposit-price').textContent = `$${finalBaseAmount.toFixed(2)}`;
    
    // Get fee/total elements
    const processingFeeEl = document.getElementById('processing-fee-price');
    const finalChargeEl = document.getElementById('final-charge-price');
    const paymentForm = document.getElementById('payment-form'); // Get form

    // --- NEW LOGIC FOR "RECEIPT" MODE ---
    if (isFullyPaid && finalBaseAmount <= 0) {
        log('Modal', 'Receipt mode: Plan is fully paid.');
        
        // Hide all payment form elements
        if (paymentForm) paymentForm.style.display = 'none';
        
        // Also hide the tip row
        if (tipRow) tipRow.style.display = 'none';

        return; // Stop here, don't create a payment intent
    }
    // --- END NEW LOGIC ---

    // If we're here, we need to pay. Show the form.
    if (paymentForm) paymentForm.style.display = 'block'; 

    // --- MINIMUM CHARGE FIX ---
    // Stripe's minimum charge is $0.50 (50 cents)
    if (finalBaseAmount > 0 && finalBaseAmount < 0.50) {
        finalBaseAmount = 0.50;
        log('Modal', 'Amount less than $0.50, rounding up to Stripe minimum $0.50');
    }
    // --- END FIX ---

    // --- LOGIC: Rebuild Payment Element ONLY if amount changed ---\
    if (finalBaseAmount !== currentBaseAmount) {
        log('Modal', `Price changed from ${currentBaseAmount} to ${finalBaseAmount}. Rebuilding PaymentElement.`);
        currentBaseAmount = finalBaseAmount; // Update module-level var
        
        if (processingFeeEl) processingFeeEl.textContent = 'Calculating...';
        if (finalChargeEl) finalChargeEl.textContent = 'Calculating...';

        try {
            // 1. Call create-payment-intent with the *current* payment type
            const intentResponse = await fetch('/api/create-payment-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    amount: Math.round(currentBaseAmount * 100), 
                    paymentMethodType: currentPaymentType // Use the stored payment type
                }),
            });
            if (!intentResponse.ok) throw new Error('Could not update payment intent.');
            
            const intentData = await intentResponse.json();
            const newClientSecret = intentData.clientSecret;
            const newProcessingFee = intentData.processingFeeInCents / 100;

            // 2. Update UI with new fees
            currentProcessingFee = newProcessingFee;
            if (processingFeeEl) processingFeeEl.textContent = `$${newProcessingFee.toFixed(2)}`;
            if (finalChargeEl) finalChargeEl.textContent = `$${(currentBaseAmount + newProcessingFee).toFixed(2)}`;

            // 3. Destroy old element and create/mount a new one
            if (paymentElement) {
                paymentElement.unmount();
            }
            
            currentClientSecret = newClientSecret; // Update the secret
            elements = stripe.elements({ clientSecret: currentClientSecret });
            paymentElement = elements.create('payment');
            paymentElement.mount('#payment-element');
            
            // 4. --- THIS IS THE FIX ---\
            // Add listener to update payment type AND fetch new fee
            paymentElement.on('change', debounce(handlePaymentTypeChange, 300));

        } catch (error) {
            console.error('Failed to update payment intent/element:', error);
            if (processingFeeEl) processingFeeEl.textContent = 'Error';
            if (finalChargeEl) finalChargeEl.textContent = 'Error';
        }
    } else {
         // --- ADDED THIS ELSE BLOCK ---\
         // Price did NOT change, but we should still update the final total
         // in case the processing fee was updated by the new listener.
         log('Modal', 'Price did not change, just updating fee display.');
         if (processingFeeEl) processingFeeEl.textContent = `$${currentProcessingFee.toFixed(2)}`;
         if (finalChargeEl) finalChargeEl.textContent = `$${(currentBaseAmount + currentProcessingFee).toFixed(2)}`;
         // --- END ADDED BLOCK ---\
    }
}

/**
 * Handles changes in the PaymentElement (e.g., switching from Card to ACH).
 * This function ONLY fetches the new fee and updates the UI, it does not
 * rebuild the PaymentElement.
 */
async function handlePaymentTypeChange(event) {
    if (!event.value.type || event.value.type === currentPaymentType) {
        // No change, or event is incomplete
        return;
    }
    
    currentPaymentType = event.value.type;
    log('Modal', `Payment type changed to: ${currentPaymentType}. Fetching new fee.`);

    const processingFeeEl = document.getElementById('processing-fee-price');
    const finalChargeEl = document.getElementById('final-charge-price');

    if (processingFeeEl) processingFeeEl.textContent = 'Calculating...';
    if (finalChargeEl) finalChargeEl.textContent = 'Calculating...';

    try {
        // 1. Call create-payment-intent to get the new fee
        const intentResponse = await fetch('/api/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                amount: Math.round(currentBaseAmount * 100), 
                paymentMethodType: currentPaymentType
            }),
        });
        if (!intentResponse.ok) throw new Error('Could not fetch new processing fee.');
        
        const intentData = await intentResponse.json();
        const newProcessingFee = intentData.processingFeeInCents / 100;

        // 2. Update UI with new fees
        currentProcessingFee = newProcessingFee;
        if (processingFeeEl) processingFeeEl.textContent = `$${newProcessingFee.toFixed(2)}`;
        if (finalChargeEl) finalChargeEl.textContent = `$${(currentBaseAmount + newProcessingFee).toFixed(2)}`;
        
        log('Modal', `New fee is ${newProcessingFee.toFixed(2)}`);

    } catch (error) {
        console.error('Failed to update fee on type change:', error);
        if (processingFeeEl) processingFeeEl.textContent = 'Error';
        if (finalChargeEl) finalChargeEl.textContent = 'Error';
    }
}

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
        modalHeaderActions: document.getElementById('modal-header-actions'),
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
        modalAdditionalDetails: document.getElementById('modal-additional-details'),
        modalRecommendationBlurb: document.getElementById('modal-recommendation-blurb')
    };
    for (const key in elements) {
        if (elements[key]) {
            if (key === 'modalItemNote') elements[key].value = '';
            else if (key === 'modalMainImage') elements[key].style.backgroundImage = '';
            else if (key === 'modalRecommendationBlurb') {
                elements[key].innerHTML = '';
                elements[key].style.display = 'none';
            }
            else elements[key].innerHTML = '';
        }
    }

    // Remove dynamically created event-specific sections that persist between modal opens
    const dynamicSections = document.querySelectorAll('.event-info-section, .rsvp-list-section, .calendar-export-section, .session-components-section');
    dynamicSections.forEach(section => section.remove());

    log('Modal', 'Reset modal state.');
}

/**
 * Initialize the plan items carousel
 */
async function initializePlanCarousel(componentRecords) {
    if (componentRecords.length === 0) return;

    let currentIndex = 0;
    const carouselImage = document.getElementById('plan-carousel-image');
    const carouselItemName = document.getElementById('carousel-item-name');
    const carouselItemDetails = document.getElementById('carousel-item-details');
    const dotsContainer = document.getElementById('carousel-dots-container');
    const prevButton = document.querySelector('.carousel-prev');
    const nextButton = document.querySelector('.carousel-next');

    if (!carouselImage || !carouselItemName || !carouselItemDetails || !dotsContainer) {
        console.warn('Carousel elements not found in DOM');
        return;
    }

    // Fetch images for all component records
    const componentImages = [];
    for (const componentData of componentRecords) {
        const record = componentData.record;
        let imageUrl = ui.getPlaceholderImage([]);

        if (!record.id.startsWith('custom-') && !record.id.startsWith('ai-search-')) {
            try {
                const { imageUrls: fetchedUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
                if (fetchedUrls && fetchedUrls.length > 0) {
                    imageUrl = fetchedUrls[0];
                }
            } catch (e) {
                console.warn('Failed to fetch image for component:', record.id, e);
            }
        }

        componentImages.push({
            ...componentData,
            imageUrl: imageUrl
        });
    }

    // Function to update the carousel display
    function updateCarousel() {
        const current = componentImages[currentIndex];
        const record = current.record;
        const history = current.history;
        const type = current.type;

        // Update image with optimization
        const optimizedImage = current.imageUrl.includes('cloudinary')
            ? current.imageUrl.replace('/upload/', '/upload/w_800,h_600,c_fill,f_auto,q_auto/')
            : current.imageUrl;
        carouselImage.src = optimizedImage;

        // Update item name with status badge
        const statusBadge = type === 'locked'
            ? '<span style="background: #28a745; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; margin-left: 8px;">✅ Locked In</span>'
            : '<span style="background: #ffc107; color: #000; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; margin-left: 8px;">💡 Idea</span>';
        carouselItemName.innerHTML = `${record.fields.Name || 'Untitled'} ${statusBadge}`;

        // Update item details
        const quantity = history?.quantity || 1;
        const note = history?.note || '';
        const isGhost = !state.records.all.find(r => r.id === record.id);

        let detailsHTML = '';
        if (quantity > 1) {
            detailsHTML += `Quantity: ${quantity}`;
        }
        if (isGhost) {
            detailsHTML += (detailsHTML ? ' • ' : '') + 'Archived Item';
        }
        if (note) {
            detailsHTML += (detailsHTML ? ' • ' : '') + `Note: ${note}`;
        }

        carouselItemDetails.innerHTML = detailsHTML || 'No additional details';

        // Update dots
        dotsContainer.innerHTML = '';
        componentImages.forEach((_, index) => {
            const dot = document.createElement('button');
            dot.style.cssText = `
                width: 10px;
                height: 10px;
                border-radius: 50%;
                border: none;
                cursor: pointer;
                transition: background-color 0.3s;
                ${index === currentIndex ? 'background-color: #007bff;' : 'background-color: #ccc;'}
            `;
            dot.addEventListener('click', () => {
                currentIndex = index;
                updateCarousel();
            });
            dotsContainer.appendChild(dot);
        });

        // Update button visibility
        if (prevButton && nextButton) {
            prevButton.style.display = componentImages.length > 1 ? 'block' : 'none';
            nextButton.style.display = componentImages.length > 1 ? 'block' : 'none';
        }
    }

    // Navigation handlers
    if (prevButton) {
        prevButton.addEventListener('click', () => {
            currentIndex = (currentIndex - 1 + componentImages.length) % componentImages.length;
            updateCarousel();
        });
    }

    if (nextButton) {
        nextButton.addEventListener('click', () => {
            currentIndex = (currentIndex + 1) % componentImages.length;
            updateCarousel();
        });
    }

    // Keyboard navigation
    const handleKeydown = (e) => {
        if (e.key === 'ArrowLeft' && componentImages.length > 1) {
            currentIndex = (currentIndex - 1 + componentImages.length) % componentImages.length;
            updateCarousel();
        } else if (e.key === 'ArrowRight' && componentImages.length > 1) {
            currentIndex = (currentIndex + 1) % componentImages.length;
            updateCarousel();
        }
    };
    document.addEventListener('keydown', handleKeydown);

    // Clean up on modal close
    const cleanup = () => {
        document.removeEventListener('keydown', handleKeydown);
    };
    modalOverlay.addEventListener('transitionend', cleanup, { once: true });

    // Initialize the carousel
    updateCarousel();
}

export async function showDetailModal(record, startPhotoIndex = 0) {
    const detailSpecs = [
        { fieldName: 'Duration', label: 'Duration' },
        { fieldName: 'Capacity', label: 'Capacity' },
        { fieldName: 'Location Details', label: 'Location Info' },
        { fieldName: 'Additional Information', label: 'Good to Know' },
    ];


    log('Modal', `Showing detail modal for \"${record.fields.Name}\"`);
    updateUrl({ openItem: record.id });
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
    const modalRecBlurb = document.getElementById('modal-recommendation-blurb');

    const closeBtn = document.getElementById('modal-close-btn');
    closeBtn.onclick = closeDetailModal;
    modalOverlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleEscapeKey);

    resetModalState();
    modalOverlay.dataset.recordId = record.id;

    // Check if this item is linked to a session (unified view mode)
    let linkedSession = null;
    let linkedSessionId = null;
    let itemIsContainedInSession = false; // Flag to indicate item is a component of a plan
    if (record.fields.LinkedSession && record.fields.LinkedSession.length > 0) {
        linkedSessionId = record.fields.LinkedSession[0];
        linkedSession = await api.fetchSessionById(linkedSessionId);
        log('Modal', `Item linked to session ${linkedSessionId}, using session chat context`);
        currentItemChatRecordId = linkedSessionId;
    } else {
        // FALLBACK: For Events that were published before LinkedSession was added,
        // try to find the session by searching for which session has this event in its LinkedItem field
        if (record.fields['Item Type'] === 'Event') {
            linkedSession = await api.fetchSessionByLinkedItem(record.id);
            if (linkedSession) {
                linkedSessionId = linkedSession.id;
                currentItemChatRecordId = linkedSessionId;
            } else {
                // NEW: Check if this event item is contained as a component in another plan
                // This handles the case where an event item was added to a plan via "Add to Plan"
                linkedSession = await api.fetchSessionContainingItem(record.id, state.ui.activeShopId);
                if (linkedSession) {
                    linkedSessionId = linkedSession.id;
                    currentItemChatRecordId = linkedSessionId;
                    itemIsContainedInSession = true; // This item is a component, not the parent event
                    log('Modal', `Event item found as component in session ${linkedSessionId}`);
                } else {
                    currentItemChatRecordId = record.id;
                }
            }
        } else {
            currentItemChatRecordId = record.id;
        }
    }

    const isLocked = state.cart.lockedItems.has(record.id);
    modalOverlay.dataset.mode = isLocked ? 'edit-locked' : 'edit-favorite';

    const itemState = isLocked ? state.cart.lockedItems.get(record.id) : ui.getItemState(record.id);
    if (addToPlanBtn) {
        addToPlanBtn.textContent = isLocked ? 'Update Plan' : 'Add to Plan';
        addToPlanBtn.dataset.tooltip = isLocked ? 'Update plan with changes' : 'Add to plan';
    }

    // Add Quick Pay button if store has payment options
    const existingQuickPayBtn = document.getElementById('modal-quick-pay-btn');
    if (existingQuickPayBtn) {
        existingQuickPayBtn.remove();
    }

    const paymentOptions = getStorePaymentOptions();
    if (paymentOptions && Object.keys(paymentOptions).length > 0) {
        const quickPayBtn = document.createElement('button');
        quickPayBtn.id = 'modal-quick-pay-btn';
        quickPayBtn.className = 'quick-pay-btn';

        // Calculate initial amount for button text
        const initialPrice = getRecordPrice(record, itemState.selectedOptionIndex);
        const initialQuantity = itemState.quantity || 1;
        const initialAmount = initialPrice * initialQuantity;

        // Update button text with amount
        const updateQuickPayButtonText = () => {
            const quantityInput = document.querySelector('#modal-quantity-selector .quantity-input');
            const currentQuantity = quantityInput ? parseInt(quantityInput.value, 10) || 1 : 1;
            // Get current selected option index from the modal's option selector
            const optionRadios = document.querySelectorAll('#modal-options-container input[type="radio"]:checked');
            let selectedOptionIndex = itemState.selectedOptionIndex || 0;
            if (optionRadios.length > 0) {
                const selectedValue = optionRadios[0].value;
                selectedOptionIndex = parseInt(selectedValue, 10) || 0;
            }
            const currentPrice = getRecordPrice(record, selectedOptionIndex);
            const currentAmount = currentPrice * currentQuantity;
            if (currentAmount > 0) {
                quickPayBtn.innerHTML = `<span>Quick Pay $${currentAmount.toFixed(2)}</span>`;
            } else {
                quickPayBtn.innerHTML = '<span>Quick Pay</span>';
            }
        };

        // Set initial button text
        if (initialAmount > 0) {
            quickPayBtn.innerHTML = `<span>Quick Pay $${initialAmount.toFixed(2)}</span>`;
        } else {
            quickPayBtn.innerHTML = '<span>Quick Pay</span>';
        }

        quickPayBtn.addEventListener('click', () => {
            // Get current quantity from the quantity input
            const quantityInput = document.querySelector('#modal-quantity-selector .quantity-input');
            const quantity = quantityInput ? parseInt(quantityInput.value, 10) || 1 : 1;
            // Get current selected option index
            const optionRadios = document.querySelectorAll('#modal-options-container input[type="radio"]:checked');
            let selectedOptionIndex = itemState.selectedOptionIndex || 0;
            if (optionRadios.length > 0) {
                const selectedValue = optionRadios[0].value;
                selectedOptionIndex = parseInt(selectedValue, 10) || 0;
            }
            const price = getRecordPrice(record, selectedOptionIndex);
            const amount = price * quantity;
            const itemName = record.fields.Name || 'Item';
            showQuickPayModal(paymentOptions, amount, itemName, quantity);
        });

        // Store reference to update function for quantity/option change handlers
        quickPayBtn._updateText = updateQuickPayButtonText;

        // Insert after Add to Plan button
        if (addToPlanBtn && addToPlanBtn.parentNode) {
            addToPlanBtn.parentNode.insertBefore(quickPayBtn, addToPlanBtn.nextSibling);
        }
    }

    let imageUrls = [];
    if (!record.id.startsWith('custom-') && !record.id.startsWith('ai-search-')) {
        const { imageUrls: fetchedUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
        imageUrls = fetchedUrls;
    }
    if (imageUrls.length === 0) {
        imageUrls = [ui.getPlaceholderImage([])];
    }
    
    modalItemName.textContent = record.fields.Name || 'Untitled';
    modalItemDescription.textContent = record.fields.Description || '';

    // Parse options and record names early for event logic
    const parsedOptionGroups = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const flatOptions = flattenOptionGroups(parsedOptionGroups);
    const allRecordNames = new Set(state.records.all.map(r => r.fields.Name));

    if (record.fields['Item Type'] === 'Event') {
        // Check if this event has child options that are themselves event records
        // (indicating this is a parent event with multiple date options)
        const hasChildEventOptions = flatOptions.some(opt => allRecordNames.has(opt.name));

        // Check if the current user has RSVPed (registered) to this event
        const rsvpYes = record.fields.RSVPs || [];
        const rsvpMaybe = record.fields.RSVPMaybe || [];
        const rsvpNo = record.fields.RSVPNo || [];
        const userId = state.session.user.id;
        const isUserRegistered = rsvpYes.includes(userId) || rsvpMaybe.includes(userId) || rsvpNo.includes(userId);

        // Only show event-specific sections for individual events, not parent events with child date options
        // For registered users, skip the RSVP list and duplicate event info sections
        if (!hasChildEventOptions && !isUserRegistered) {
        const eventDateStr = record.fields.Date;
        const eventTime = record.fields.Time || '';
        const eventLocation = record.fields.Location || '';

        if (eventDateStr) {
            // Parse date in local timezone to avoid timezone shift issues
            const eventDate = new Date(eventDateStr + 'T00:00:00');
            const dateStr = eventDate.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            const eventInfoSection = document.createElement('div');
            eventInfoSection.className = 'event-info-section';
            eventInfoSection.innerHTML = `
                <div class="event-date-time">
                    <strong>📅 ${dateStr}</strong>${eventTime ? ` at ${eventTime}` : ''}
                </div>
                ${eventLocation ? `<div class="event-location">📍 ${eventLocation}</div>` : ''}
            `;

            modalItemDescription.parentElement.insertBefore(eventInfoSection, modalItemDescription);
        }

        // RSVP list section - only shown for non-registered users
        if (rsvpYes.length > 0 || rsvpMaybe.length > 0 || rsvpNo.length > 0) {
            const rsvpListSection = document.createElement('div');
            rsvpListSection.className = 'rsvp-list-section';

            let rsvpHTML = '<div class="rsvp-list-header"><strong>RSVPs</strong></div>';

            if (rsvpYes.length > 0) {
                rsvpHTML += `<div class="rsvp-list-group">
                    <div class="rsvp-list-label">Going (${rsvpYes.length})</div>
                    <div class="rsvp-list-items">Anonymous users</div>
                </div>`;
            }

            if (rsvpMaybe.length > 0) {
                rsvpHTML += `<div class="rsvp-list-group">
                    <div class="rsvp-list-label">Maybe (${rsvpMaybe.length})</div>
                    <div class="rsvp-list-items">Anonymous users</div>
                </div>`;
            }

            if (rsvpNo.length > 0) {
                rsvpHTML += `<div class="rsvp-list-group">
                    <div class="rsvp-list-label">Can't Go (${rsvpNo.length})</div>
                    <div class="rsvp-list-items">Anonymous users</div>
                </div>`;
            }

            rsvpListSection.innerHTML = rsvpHTML;
            modalItemDescription.parentElement.insertBefore(rsvpListSection, modalItemDescription);
        }

        // Calendar export buttons removed for published events - not needed for viewing
        }
    }

    // Display session components if this is a published session/event
    // Skip for registered event users - they don't need to see plan components
    const isEventType = record.fields['Item Type'] === 'Event';
    const eventRsvpYes = record.fields.RSVPs || [];
    const eventRsvpMaybe = record.fields.RSVPMaybe || [];
    const eventRsvpNo = record.fields.RSVPNo || [];
    const currentUserId = state.session.user.id;
    const isCurrentUserRegistered = eventRsvpYes.includes(currentUserId) || eventRsvpMaybe.includes(currentUserId) || eventRsvpNo.includes(currentUserId);

    if (linkedSession && linkedSession.fields && !(isEventType && isCurrentUserRegistered)) {
        log('Modal', `Displaying session components for linked session ${linkedSessionId}`);

        // Parse session data to get locked items (components) and ideas
        let lockedInHistory = [];
        let ideasHistory = [];
        if (linkedSession.fields['Items with Variations']) {
            try {
                const sessionData = JSON.parse(linkedSession.fields['Items with Variations']);

                const lockedInItems = sessionData.lockedInItems || {};
                const ideasItems = sessionData.ideasItems || {};

                // Convert locked items to history format
                lockedInHistory = Object.entries(lockedInItems).map(([id, itemInfo]) => ({
                    id: id,
                    quantity: itemInfo.quantity || 1,
                    selectedOptionIndex: itemInfo.selectedOptionIndex,
                    note: itemInfo.note,
                    overridePrice: itemInfo.overridePrice
                }));

                // Convert ideas items to history format
                ideasHistory = Object.entries(ideasItems).map(([id, itemInfo]) => ({
                    id: id,
                    quantity: itemInfo.quantity || 1,
                    selectedOptionIndex: itemInfo.selectedOptionIndex,
                    note: itemInfo.note,
                    overridePrice: itemInfo.overridePrice
                }));

            } catch (e) {
                console.warn('Could not parse Items with Variations for session:', linkedSessionId, e);
                lockedInHistory = [];
                ideasHistory = [];
            }
        }

        const lockedComponentIds = lockedInHistory.map(item => item.id).filter(id => id);
        const ideaComponentIds = ideasHistory.map(item => item.id).filter(id => id);

        // Fetch any missing component items (ghost items) that aren't in state.records.all
        const allComponentIds = [...lockedComponentIds, ...ideaComponentIds];
        const missingItemIds = allComponentIds.filter(id =>
            !state.records.all.some(r => r.id === id) &&
            (!state.records.archive || !state.records.archive.some(r => r.id === id)) &&
            id.startsWith('rec') // Only fetch real Airtable IDs, not custom items
        );

        if (missingItemIds.length > 0) {
            log('Modal', `Found ${missingItemIds.length} missing component items, fetching...`);
            try {
                const ghostItems = await api.fetchGhostItems(missingItemIds);
                if (ghostItems.length > 0) {
                    // Merge with existing archive or create new archive array
                    const existingArchive = state.records.archive || [];
                    state.records.archive = [...existingArchive, ...ghostItems];
                    log('Modal', `Fetched and stored ${ghostItems.length} ghost component items`);
                }
            } catch (e) {
                console.warn('Failed to fetch ghost items for modal:', e);
            }
        }

        if (lockedComponentIds.length > 0 || ideaComponentIds.length > 0) {
            // Collect all component records for the carousel
            const allComponentRecords = [];
            const componentHistoryMap = new Map();

            // Process locked items
            for (const componentId of lockedComponentIds) {
                let componentRecord = state.records.all.find(r => r.id === componentId);
                if (!componentRecord && state.records.archive) {
                    componentRecord = state.records.archive.find(r => r.id === componentId);
                }
                if (componentRecord) {
                    allComponentRecords.push({
                        record: componentRecord,
                        type: 'locked',
                        history: lockedInHistory.find(item => item.id === componentId)
                    });
                    componentHistoryMap.set(componentId, lockedInHistory.find(item => item.id === componentId));
                }
            }

            // Process idea items
            for (const ideaId of ideaComponentIds) {
                let ideaRecord = state.records.all.find(r => r.id === ideaId);
                if (!ideaRecord && state.records.archive) {
                    ideaRecord = state.records.archive.find(r => r.id === ideaId);
                }
                if (ideaRecord) {
                    allComponentRecords.push({
                        record: ideaRecord,
                        type: 'idea',
                        history: ideasHistory.find(item => item.id === ideaId)
                    });
                    componentHistoryMap.set(ideaId, ideasHistory.find(item => item.id === ideaId));
                }
            }

            // Create the main session components section
            const sessionComponentsSection = document.createElement('div');
            sessionComponentsSection.className = 'session-components-section';
            sessionComponentsSection.style.cssText = 'margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;';

            // Use different header text based on whether this item is a contained component or the parent event
            const planName = linkedSession.fields.Name || 'Plan';
            let sectionHeader;
            if (itemIsContainedInSession) {
                // This event item is contained as a component in another plan
                sectionHeader = `<h4 style="margin-top: 0; color: #495057;">📋 Part of Plan: ${planName}</h4>`;
            } else {
                // This is the parent event with its own linked session
                sectionHeader = '<h4 style="margin-top: 0; color: #495057;">📋 Plan Components</h4>';
            }
            let componentsHTML = sectionHeader;

            // Add image carousel for browsing items
            if (allComponentRecords.length > 0) {
                componentsHTML += `
                    <div class="plan-items-carousel" style="margin: 15px 0; position: relative; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                        <div class="carousel-container" style="position: relative;">
                            <div class="carousel-image-container" style="width: 100%; height: 300px; position: relative; background: #000;">
                                <img id="plan-carousel-image" style="width: 100%; height: 100%; object-fit: cover;" src="" alt="Item image" loading="lazy">
                                <div class="carousel-overlay" style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(to top, rgba(0,0,0,0.8), transparent); padding: 15px; color: white;">
                                    <div id="carousel-item-name" style="font-weight: bold; font-size: 1.1em; margin-bottom: 5px;"></div>
                                    <div id="carousel-item-details" style="font-size: 0.9em; opacity: 0.9;"></div>
                                </div>
                            </div>
                            <button class="carousel-nav carousel-prev" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.9); border: none; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; font-size: 20px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.2); z-index: 10;">‹</button>
                            <button class="carousel-nav carousel-next" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.9); border: none; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; font-size: 20px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.2); z-index: 10;">›</button>
                        </div>
                        <div class="carousel-dots" style="display: flex; justify-content: center; padding: 10px; gap: 8px;" id="carousel-dots-container"></div>
                    </div>
                `;
            }

            // Display Locked In Items section
            if (lockedComponentIds.length > 0) {
                componentsHTML += '<div class="locked-in-section" style="margin-bottom: 15px;">';
                componentsHTML += '<h5 style="margin: 10px 0 8px 0; color: #28a745; font-size: 0.95em;">✅ Locked In</h5>';
                componentsHTML += '<div class="session-components-list">';

                // Fetch component items (check both active and archive)
                for (const componentId of lockedComponentIds) {
                    let componentRecord = state.records.all.find(r => r.id === componentId);

                    // If not found in active records, check archive
                    if (!componentRecord && state.records.archive) {
                        componentRecord = state.records.archive.find(r => r.id === componentId);
                    }

                    if (componentRecord) {
                        const componentName = componentRecord.fields.Name || 'Untitled';
                        const historyItem = lockedInHistory.find(item => item.id === componentId);
                        const quantity = historyItem?.quantity || 1;
                        const note = historyItem?.note || '';
                        const isGhost = !state.records.all.find(r => r.id === componentId);

                        componentsHTML += `
                            <div class="session-component-item" style="display: flex; justify-content: space-between; align-items: center; margin: 8px 0; padding: 8px; background-color: white; border-radius: 4px; border-left: 3px solid #28a745; ${isGhost ? 'opacity: 0.7;' : ''}">
                                <div>
                                    <strong>${componentName}</strong> ${quantity > 1 ? `(x${quantity})` : ''}
                                    ${isGhost ? '<span style="color: #6c757d; font-size: 0.85em; margin-left: 8px;">[Archived]</span>' : ''}
                                    ${note ? `<div style="font-size: 0.85em; color: #6c757d; margin-top: 4px;">Note: ${note}</div>` : ''}
                                </div>
                            </div>
                        `;
                    } else {
                        console.warn('Could not find record for locked component ID:', componentId);
                    }
                }

                componentsHTML += '</div></div>';
            }

            // Display Ideas section
            if (ideaComponentIds.length > 0) {
                componentsHTML += '<div class="ideas-section">';
                componentsHTML += '<h5 style="margin: 10px 0 8px 0; color: #ffc107; font-size: 0.95em;">💡 Ideas for the Session</h5>';
                componentsHTML += '<div class="session-ideas-list">';

                // Fetch idea items (check both active and archive)
                for (const ideaId of ideaComponentIds) {
                    let ideaRecord = state.records.all.find(r => r.id === ideaId);

                    // If not found in active records, check archive
                    if (!ideaRecord && state.records.archive) {
                        ideaRecord = state.records.archive.find(r => r.id === ideaId);
                    }

                    if (ideaRecord) {
                        const ideaName = ideaRecord.fields.Name || 'Untitled';
                        const historyItem = ideasHistory.find(item => item.id === ideaId);
                        const quantity = historyItem?.quantity || 1;
                        const note = historyItem?.note || '';
                        const isGhost = !state.records.all.find(r => r.id === ideaId);

                        componentsHTML += `
                            <div class="session-idea-item" style="display: flex; justify-content: space-between; align-items: center; margin: 8px 0; padding: 8px; background-color: white; border-radius: 4px; border-left: 3px solid #ffc107; ${isGhost ? 'opacity: 0.7;' : ''}">
                                <div>
                                    <strong>${ideaName}</strong> ${quantity > 1 ? `(x${quantity})` : ''}
                                    ${isGhost ? '<span style="color: #6c757d; font-size: 0.85em; margin-left: 8px;">[Archived]</span>' : ''}
                                    ${note ? `<div style="font-size: 0.85em; color: #6c757d; margin-top: 4px;">Note: ${note}</div>` : ''}
                                </div>
                            </div>
                        `;
                    } else {
                        console.warn('Could not find record for idea ID:', ideaId);
                    }
                }

                componentsHTML += '</div></div>';
            }

            sessionComponentsSection.innerHTML = componentsHTML;
            modalItemDescription.parentElement.insertBefore(sessionComponentsSection, modalItemDescription);

            // Initialize the carousel after the HTML is inserted
            if (allComponentRecords.length > 0) {
                initializePlanCarousel(allComponentRecords);
            }

            // Check if user is a collaborator, store owner, or has publish permission - add Edit Plan button inside the components section
            const isCollaborator = linkedSession.fields.Collaborators &&
                                   linkedSession.fields.Collaborators.includes(state.session.user.id);

            // Check if user owns the store that this session belongs to
            const sessionStoreId = linkedSession.fields.Stores && linkedSession.fields.Stores.length > 0
                                 ? linkedSession.fields.Stores[0]
                                 : null;
            const isOwnerOfSessionStore = state.session.user.isOwner &&
                                         state.session.user.ownedStoreId &&
                                         sessionStoreId === state.session.user.ownedStoreId;

            // Check if user has publish permission for the current store
            const userHasPublishAccess = api.userHasPublishPermission();

            if (isCollaborator || isOwnerOfSessionStore || userHasPublishAccess) {
                log('Modal', 'User is collaborator, owns the session store, or has publish access, showing Edit Plan button');
                const editPlanBtn = document.createElement('button');
                editPlanBtn.className = 'edit-plan-btn';
                editPlanBtn.style.cssText = 'margin: 15px 0 0 0; padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; width: 100%; font-size: 1em; transition: background-color 0.2s;';
                editPlanBtn.textContent = '✏️ Edit Plan';
                editPlanBtn.onmouseover = () => editPlanBtn.style.backgroundColor = '#0056b3';
                editPlanBtn.onmouseout = () => editPlanBtn.style.backgroundColor = '#007bff';
                editPlanBtn.addEventListener('click', () => {
                    log('Modal', `Navigating to edit session ${linkedSessionId}`);
                    closeDetailModal();
                    // Redirect to session with sidebar open
                    window.location.href = `${window.location.pathname}?session=${linkedSessionId}&shopId=${state.ui.activeShopId}`;
                });
                sessionComponentsSection.appendChild(editPlanBtn);
            }
        } else {
            // If there are no plan components (or the only component is this item itself)
            // but we still have a linked session, show appropriate content
            const isCollaborator = linkedSession.fields.Collaborators &&
                                   linkedSession.fields.Collaborators.includes(state.session.user.id);

            const sessionStoreId = linkedSession.fields.Stores && linkedSession.fields.Stores.length > 0
                                 ? linkedSession.fields.Stores[0]
                                 : null;
            const isOwnerOfSessionStore = state.session.user.isOwner &&
                                         state.session.user.ownedStoreId &&
                                         sessionStoreId === state.session.user.ownedStoreId;

            // Check if user has publish permission for the current store
            const userHasPublishAccess = api.userHasPublishPermission();

            // For contained items, show "Part of Plan" even without other components
            // Also show for collaborators, owners, or users with publish access
            if (itemIsContainedInSession || isCollaborator || isOwnerOfSessionStore || userHasPublishAccess) {
                const planName = linkedSession.fields.Name || 'Plan';
                const editPlanSection = document.createElement('div');
                editPlanSection.style.cssText = 'margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;';

                // Add header for contained items
                if (itemIsContainedInSession) {
                    const headerEl = document.createElement('h4');
                    headerEl.style.cssText = 'margin-top: 0; margin-bottom: 10px; color: #495057;';
                    headerEl.textContent = `Part of Plan: ${planName}`;
                    editPlanSection.appendChild(headerEl);
                    log('Modal', `Showing "Part of Plan" indicator for contained item in session ${linkedSessionId}`);
                } else {
                    log('Modal', 'User is collaborator, owns the session store, or has publish access (no components yet), showing Edit Plan button');
                }

                // Show Edit Plan button for collaborators/owners/users with publish access
                if (isCollaborator || isOwnerOfSessionStore || userHasPublishAccess) {
                    const editPlanBtn = document.createElement('button');
                    editPlanBtn.className = 'edit-plan-btn';
                    editPlanBtn.style.cssText = 'padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; width: 100%; font-size: 1em; transition: background-color 0.2s;';
                    editPlanBtn.textContent = '✏️ Edit Plan';
                    editPlanBtn.onmouseover = () => editPlanBtn.style.backgroundColor = '#0056b3';
                    editPlanBtn.onmouseout = () => editPlanBtn.style.backgroundColor = '#007bff';
                    editPlanBtn.addEventListener('click', () => {
                        log('Modal', `Navigating to edit session ${linkedSessionId}`);
                        closeDetailModal();
                        // Redirect to session with sidebar open
                        window.location.href = `${window.location.pathname}?session=${linkedSessionId}&shopId=${state.ui.activeShopId}`;
                    });
                    editPlanSection.appendChild(editPlanBtn);
                }

                modalItemDescription.parentElement.insertBefore(editPlanSection, modalItemDescription);
            }
        }
    }

    try {
        const blurbHtml = generateRecommendationBlurb(record);
        if (blurbHtml && modalRecBlurb) {
            modalRecBlurb.innerHTML = blurbHtml;
            modalRecBlurb.style.display = 'block';
        }
    } catch (e) {
        console.warn('Failed to generate recommendation blurb:', e);
    }

    if (modalAdditionalDetails) {
        modalAdditionalDetails.innerHTML = '';
        const fragment = document.createDocumentFragment();
        let hasRankings = false;
        const rankingsHtmlParts = [];

        detailSpecs.forEach(spec => {
            const value = record.fields[spec.fieldName];
            if (value) {
                const detailItem = document.createElement('div');
                detailItem.className = 'detail-item';
                detailItem.innerHTML = `
                    <span class="detail-label">${spec.label}</span>
                    <span class="detail-value">${String(value).replace(/\n/g, '<br>')}</span>
                `;
                fragment.appendChild(detailItem);
            }
        });

        // --- THIS IS THE CHANGE ---\
        const rankingsJsonString = record.fields['AI_Profile'] || record.fields['Rankings'];
        // --- END CHANGE ---\
        
        if (rankingsJsonString) {
            try {
                // --- V2.1: Check for new profile structure ---\
                const rankingsObject = JSON.parse(rankingsJsonString);

                let displayRankings = {};
                // Check if it's the new v2.1 profile
                if (rankingsObject.profileSource && rankingsObject.Vibe) {
                    // Extract vibe/intellect/physicality for display
                    displayRankings = { ...rankingsObject.Vibe, ...rankingsObject.Intellect, ...rankingsObject.Physicality };
                } else if (rankingsObject.Profile) {
                    // Handle AI_Profile structure where Profile is nested
                    displayRankings = rankingsObject.Profile;
                } else {
                    // Fallback to old v1.2 structure
                    displayRankings = rankingsObject;
                }
                
                for (const label in displayRankings) {
                    if (Object.hasOwnProperty.call(displayRankings, label)) {
                        const value = displayRankings[label];
                        if (typeof value === 'number' && value > 0) {
                            hasRankings = true;
                            // Show 0-10 scale as 0-5 stars
                            const stars = '★'.repeat(Math.round(value / 2)) + '☆'.repeat(Math.max(0, 5 - Math.round(value / 2)));
                            rankingsHtmlParts.push(`
                                <div class="ranking-item">
                                    <span class="ranking-label">${label}:</span>
                                    <span class="ranking-stars">${stars}</span>
                                </div>
                            `);
                        }
                    }
                }
            } catch (error) {
                console.error(`[Modal Debug] Error parsing Rankings JSON for item ${record.id}:`, error);
            }
        }

        if (hasRankings) {
            const rankingContainer = document.createElement('div');
            rankingContainer.className = 'ranking-list detail-item';
            rankingContainer.innerHTML = `
                <span class="detail-label">Rankings</span>
                ${rankingsHtmlParts.join('')}
            `;
            fragment.appendChild(rankingContainer);
        }
        modalAdditionalDetails.appendChild(fragment);
    }

    const isGrouping = !record.id.startsWith('custom-') && !record.id.startsWith('ai-search-') && record.fields['Item Type'] === 'Grouping'; 

    const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const pricingTypeHTML = pricingType ? `<span class="pricing-type"> / ${pricingType.toLowerCase()}</span>` : '';

    if (isGrouping) {
        const range = getGroupPriceRange(record);
        modalItemPrice.innerHTML = (range && typeof range.min === 'number') ? (range.min === range.max ? `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`) : 'Price Varies';
    } else {
        const price = getRecordPrice(record, itemState.selectedOptionIndex);
        let priceText = (typeof price === 'number' ? `$${price.toFixed(2)}` : 'N/A');
        if ((record.id.startsWith('custom-') || record.id.startsWith('ai-search-')) && price > 0) {
            priceText += ' (Est.)';
        }
        modalItemPrice.innerHTML = priceText + pricingTypeHTML;
    }

    let currentPhotoIndex = startPhotoIndex;
    // Optimize main image with proper size and format
    const optimizedMainImage = imageUrls[currentPhotoIndex].includes('cloudinary') 
        ? imageUrls[currentPhotoIndex].replace('/upload/', '/upload/w_1200,h_1000,c_fill,f_auto,q_auto,fl_progressive/')
        : imageUrls[currentPhotoIndex];
    modalMainImage.style.backgroundImage = `url('${optimizedMainImage}')`;
    modalThumbnailStrip.innerHTML = '';
    imageUrls.forEach((url, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail-img';
        // Optimize thumbnails with smaller size
        const optimizedThumb = url.includes('cloudinary')
            ? url.replace('/upload/', '/upload/w_150,h_150,c_fill,f_auto,q_auto/')
            : url;
        thumb.style.backgroundImage = `url('${optimizedThumb}')`;
        if (index === currentPhotoIndex) thumb.classList.add('active');
        thumb.addEventListener('click', () => {
            currentPhotoIndex = index;
            const optimizedClickImage = imageUrls[index].includes('cloudinary')
                ? imageUrls[index].replace('/upload/', '/upload/w_1200,h_1000,c_fill,f_auto,q_auto,fl_progressive/')
                : imageUrls[index];
            modalMainImage.style.backgroundImage = `url('${optimizedClickImage}')`;
            modalThumbnailStrip.querySelector('.active')?.classList.remove('active');
            thumb.classList.add('active');
        });
        modalThumbnailStrip.appendChild(thumb);
    });

    modalHeaderActions.innerHTML = '';
    const breadcrumbs = getBreadcrumbs(record);
    if (breadcrumbs.length > 0) {
        modalBreadcrumbs.innerHTML = breadcrumbs.map(name => `<a class="parent-link" data-parent-name="${name}" title="Go to ${name}">${name}</a>`).join(' > ');
    }

    const heartBtnContainer = document.createElement('div');
    heartBtnContainer.id = 'modal-heart-btn';
    heartBtnContainer.dataset.recordId = record.id;
    modalHeaderActions.appendChild(heartBtnContainer);

    if (record.fields['Item Type'] === 'Event') {
        const rsvpYes = record.fields.RSVPs || [];
        const rsvpMaybe = record.fields.RSVPMaybe || [];
        const rsvpNo = record.fields.RSVPNo || [];
        const userId = state.session.user.id;

        const hasRsvpdYes = rsvpYes.includes(userId);
        const hasRsvpdMaybe = rsvpMaybe.includes(userId);
        const hasRsvpdNo = rsvpNo.includes(userId);

        // Check if event has a linked session (is affiliated to a plan)
        const hasLinkedSession = !!(record.fields.LinkedSession && record.fields.LinkedSession.length > 0);

        // Check if user has publish permission
        const userHasPublishAccess = api.userHasPublishPermission();

        // Add edit button for publish access users on ALL events
        if (userHasPublishAccess) {
            if (hasLinkedSession) {
                // Event already has a linked session - show "Edit Event" button to navigate to it
                const editEventBtn = document.createElement('button');
                editEventBtn.className = 'card-action-btn edit-event-btn';
                editEventBtn.dataset.eventId = record.id;
                editEventBtn.dataset.sessionId = record.fields.LinkedSession[0];
                editEventBtn.textContent = 'Edit Event';
                editEventBtn.style.marginRight = '10px';
                modalHeaderActions.appendChild(editEventBtn);
            } else {
                // Unaffiliated event - show "Open to Edit" button to create a session
                const openToEditBtn = document.createElement('button');
                openToEditBtn.className = 'card-action-btn open-to-edit-btn';
                openToEditBtn.dataset.eventId = record.id;
                openToEditBtn.textContent = 'Open to Edit';
                openToEditBtn.style.marginRight = '10px';
                modalHeaderActions.appendChild(openToEditBtn);
            }
        }

        const rsvpContainer = document.createElement('div');
        rsvpContainer.className = 'rsvp-button-group';

        const yesBtn = document.createElement('button');
        yesBtn.className = `rsvp-btn rsvp-yes ${hasRsvpdYes ? 'active' : ''}`;
        yesBtn.dataset.recordId = record.id;
        yesBtn.dataset.rsvpType = 'yes';
        yesBtn.innerHTML = hasRsvpdYes ? "Going ✅" : 'Yes';

        const maybeBtn = document.createElement('button');
        maybeBtn.className = `rsvp-btn rsvp-maybe ${hasRsvpdMaybe ? 'active' : ''}`;
        maybeBtn.dataset.recordId = record.id;
        maybeBtn.dataset.rsvpType = 'maybe';
        maybeBtn.innerHTML = hasRsvpdMaybe ? "Maybe ❓" : 'Maybe';

        const noBtn = document.createElement('button');
        noBtn.className = `rsvp-btn rsvp-no ${hasRsvpdNo ? 'active' : ''}`;
        noBtn.dataset.recordId = record.id;
        noBtn.dataset.rsvpType = 'no';
        noBtn.innerHTML = hasRsvpdNo ? "Can't Go ❌" : 'No';

        rsvpContainer.appendChild(yesBtn);
        rsvpContainer.appendChild(maybeBtn);
        rsvpContainer.appendChild(noBtn);
        modalHeaderActions.appendChild(rsvpContainer);
    }

    modalOptionsContainer.innerHTML = '';

    // Parse options into groups
    const optionGroups = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);

    // Track current selections for this modal instance
    // Initialize from itemState.selections or build from legacy selectedOptionIndex
    let currentSelections = { ...itemState.selections } || {};

    // Backward compatibility: if using legacy selectedOptionIndex, map to selections
    if (Object.keys(currentSelections).length === 0 && itemState.selectedOptionIndex !== undefined) {
        const flatOptions = flattenOptionGroups(optionGroups);
        if (flatOptions.length > 0 && itemState.selectedOptionIndex < flatOptions.length) {
            // Find which group contains this option
            let flatIndex = 0;
            for (let gIdx = 0; gIdx < optionGroups.length; gIdx++) {
                const group = optionGroups[gIdx];
                for (let oIdx = 0; oIdx < group.options.length; oIdx++) {
                    if (flatIndex === itemState.selectedOptionIndex) {
                        currentSelections[`group${gIdx}`] = oIdx;
                        break;
                    }
                    flatIndex++;
                }
            }
        }
    }

    // Helper function to update UI when selections change
    const updateOptionsUI = () => {
        // Update price display
        const newPrice = getRecordPrice(record, currentSelections);
        modalItemPrice.innerHTML = (typeof newPrice === 'number' ? `$${newPrice.toFixed(2)}` : 'N/A') + pricingTypeHTML;

        // Update description with appended text from selected options
        const fullDescription = getRecordDescription(record, currentSelections);
        modalItemDescription.textContent = fullDescription;

        // Handle image tag changes
        const imageTag = getActiveImageTag(record, currentSelections);
        if (imageTag) {
            // Fetch and display the image by tag
            api.fetchImagesByTags(record, [imageTag], state.records.all).then(taggedImages => {
                if (taggedImages && taggedImages.length > 0) {
                    const optimizedImage = taggedImages[0].includes('cloudinary')
                        ? taggedImages[0].replace('/upload/', '/upload/w_1200,h_1000,c_fill,f_auto,q_auto,fl_progressive/')
                        : taggedImages[0];
                    modalMainImage.style.backgroundImage = `url('${optimizedImage}')`;
                }
            }).catch(err => {
                log('Modal', `Failed to fetch image for tag ${imageTag}: ${err.message}`);
            });
        }

        // Dispatch change event with selections
        modalOptionsContainer.dispatchEvent(new CustomEvent('change', {
            bubbles: true,
            detail: { selections: currentSelections }
        }));
    };

    // Render option groups
    if (optionGroups.length > 0) {
        optionGroups.forEach((group, groupIndex) => {
            // Create group container
            const groupContainer = document.createElement('div');
            groupContainer.className = 'option-group';
            groupContainer.dataset.groupIndex = groupIndex;

            // Only show group header if there are multiple groups or group has a non-default name
            if (optionGroups.length > 1 || group.name !== 'Options') {
                const groupHeader = document.createElement('h4');
                groupHeader.className = 'option-group-header';
                groupHeader.textContent = group.name;
                if (group.modifier) {
                    const modifierSpan = document.createElement('span');
                    modifierSpan.className = 'option-group-modifier';
                    modifierSpan.textContent = ` (${group.modifier})`;
                    groupHeader.appendChild(modifierSpan);
                }
                groupContainer.appendChild(groupHeader);
            }

            // Create options within this group
            const optionsWrapper = document.createElement('div');
            optionsWrapper.className = 'option-group-options';

            group.options.forEach((opt, optionIndex) => {
                const optionButton = document.createElement('button');
                optionButton.className = 'option-btn';
                optionButton.dataset.groupIndex = groupIndex;
                optionButton.dataset.optionIndex = optionIndex;

                // Check if this option is currently selected
                const groupKey = `group${groupIndex}`;
                if (currentSelections[groupKey] === optionIndex) {
                    optionButton.classList.add('selected');
                }

                // Build price modifier text
                let priceModText = '';
                if (opt.priceOverride !== null) {
                    priceModText = `$${opt.priceOverride.toFixed(2)}`;
                } else if (opt.priceModifier !== null) {
                    priceModText = `${opt.priceModifier >= 0 ? '+' : ''}$${opt.priceModifier.toFixed(2)}`;
                }

                // Build button content with optional image tag indicator
                let buttonContent = opt.name;
                if (priceModText) {
                    buttonContent += ` <span class="price-mod">${priceModText}</span>`;
                }
                if (opt.imageTag) {
                    buttonContent += ' <span class="image-indicator" title="Changes image">📷</span>';
                }
                optionButton.innerHTML = buttonContent;

                // Check if option name matches a child record (navigation option)
                if (allRecordNames.has(opt.name)) {
                    optionButton.dataset.childName = opt.name;
                    optionButton.classList.add('navigation-option');
                    optionButton.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const childName = e.currentTarget.dataset.childName;
                        const childRecord = state.records.all.find(r => r.fields.Name === childName);
                        if (childRecord) {
                            log('Modal', `Navigating from option to item: ${childName}`);
                            showDetailModal(childRecord);
                        } else {
                            log('Modal', `Could not find record for child option: ${childName}`);
                        }
                    });
                } else {
                    // Regular option selection
                    optionButton.addEventListener('click', (e) => {
                        e.stopPropagation();

                        // Deselect other options in the same group
                        optionsWrapper.querySelectorAll('.option-btn').forEach(btn => {
                            btn.classList.remove('selected');
                        });

                        // Select this option
                        e.currentTarget.classList.add('selected');

                        // Update selections
                        const gIdx = parseInt(e.currentTarget.dataset.groupIndex, 10);
                        const oIdx = parseInt(e.currentTarget.dataset.optionIndex, 10);
                        currentSelections[`group${gIdx}`] = oIdx;

                        // Update UI reactively
                        updateOptionsUI();

                        // Update Quick Pay button text when option changes
                        const quickPayBtn = document.getElementById('modal-quick-pay-btn');
                        if (quickPayBtn && quickPayBtn._updateText) {
                            quickPayBtn._updateText();
                        }
                    });
                }

                optionsWrapper.appendChild(optionButton);
            });

            groupContainer.appendChild(optionsWrapper);
            modalOptionsContainer.appendChild(groupContainer);
        });

        // Initialize UI based on current selections
        if (Object.keys(currentSelections).length > 0) {
            updateOptionsUI();
        }
    }

    // --- THIS IS THE FIX ---\
    // The listeners are now MOVED INSIDE this `if` block
    // Also hide notes for published events - they use the description field for goals/notes instead
    const isEvent = record.fields['Item Type'] === 'Event';
    if (!isGrouping) {
        modalActionsContainer.style.display = 'block';
        // Hide notes container for events - not needed for published event viewing
        modalNotesContainer.style.display = isEvent ? 'none' : 'block';
        modalItemNote.value = itemState.note;

        // Calculate effective minimum and Airtable minimum
        const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        const effectiveMin = getEffectiveMinQuantity(record);

        modalQuantitySelector.innerHTML = `<div class="quantity-selector" data-record-id="${record.id}"><button type="button" class="quantity-btn minus" aria-label="Decrease quantity">-</button><input type="number" class="quantity-input" value="${itemState.quantity}" min="${effectiveMin}" step="1"><button type="button" class="quantity-btn plus" aria-label="Increase quantity">+</button></div>`;

        // Remove any existing nudge/badge elements to prevent duplication
        const existingNudge = modalActionsContainer.querySelector('.umw-sales-nudge');
        const existingBadge = modalActionsContainer.querySelector('.umw-benefit-badge');
        if (existingNudge) existingNudge.remove();
        if (existingBadge) existingBadge.remove();

        // Add sales nudge or benefit badge
        let nudgeHTML = '';
        const currentQuantity = itemState.quantity || 1;
        if (effectiveMin < airtableMin && currentQuantity <= airtableMin) {
            // Scenario B: UMW is booked, restriction removed (only show when quantity is at or below the original minimum)
            nudgeHTML = `<div class="umw-benefit-badge">✅ UMW Benefit: ${airtableMin}-person minimum waived.</div>`;
        } else if (airtableMin > 1 && currentQuantity <= airtableMin) {
            // Scenario A: Restriction active, suggest UMW (only show when quantity is at or below minimum)
            nudgeHTML = `<div class="umw-sales-nudge">💡 <strong>Pro Tip:</strong> Host at <a href="#" class="search-link" data-term="Union Machine Works">Union Machine Works</a> to waive the ${airtableMin}-person minimum.</div>`;
        }

        if (nudgeHTML) {
            modalActionsContainer.insertAdjacentHTML('beforeend', nudgeHTML);

            // Add click handler for the search link if present
            const searchLink = modalActionsContainer.querySelector('.search-link');
            if (searchLink) {
                searchLink.addEventListener('click', async (e) => {
                    e.preventDefault();
                    const searchTerm = searchLink.dataset.term;

                    // Find the Union Machine Works record in the catalog
                    const umwRecord = state.records.all.find(r =>
                        r.fields.Name && r.fields.Name.includes(searchTerm)
                    );

                    if (umwRecord) {
                        // Open the Union Machine Works detail modal directly
                        closeDetailModal();
                        // Small delay to ensure current modal closes cleanly
                        setTimeout(() => {
                            showDetailModal(umwRecord, 0);
                        }, 100);
                    } else {
                        // Fallback to search filter if record not found
                        document.getElementById('name-filter').value = searchTerm;
                        closeDetailModal();
                        document.getElementById('name-filter').dispatchEvent(new Event('input', { bubbles: true }));
                    }
                });
            }
        }

        const plusBtn = modalQuantitySelector.querySelector('.plus');
        const minusBtn = modalQuantitySelector.querySelector('.minus');
        const input = modalQuantitySelector.querySelector('input');
        if (plusBtn && minusBtn && input) {
            // Function to update pro-tip visibility based on current quantity
            const updateProTipVisibility = () => {
                const currentQty = parseInt(input.value, 10) || 1;
                const existingNudge = modalActionsContainer.querySelector('.umw-sales-nudge');
                const existingBadge = modalActionsContainer.querySelector('.umw-benefit-badge');

                // Determine if pro-tip should be shown
                const shouldShowProTip = effectiveMin >= airtableMin && airtableMin > 1 && currentQty <= airtableMin;
                const shouldShowBadge = effectiveMin < airtableMin && currentQty <= airtableMin;

                // Update pro-tip display
                if (shouldShowProTip && !existingNudge) {
                    // Add pro-tip if it should be shown and doesn't exist
                    const nudgeHTML = `<div class="umw-sales-nudge">💡 <strong>Pro Tip:</strong> Host at <a href="#" class="search-link" data-term="Union Machine Works">Union Machine Works</a> to waive the ${airtableMin}-person minimum.</div>`;
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = nudgeHTML;
                    const nudgeElement = tempDiv.firstElementChild;
                    modalActionsContainer.appendChild(nudgeElement);

                    // Re-attach click handler for the search link
                    const searchLink = nudgeElement.querySelector('.search-link');
                    if (searchLink) {
                        searchLink.addEventListener('click', async (e) => {
                            e.preventDefault();
                            const searchTerm = searchLink.dataset.term;
                            const umwRecord = state.records.all.find(r =>
                                r.fields.Name && r.fields.Name.includes(searchTerm)
                            );
                            if (umwRecord) {
                                closeDetailModal();
                                setTimeout(() => {
                                    showDetailModal(umwRecord, 0);
                                }, 100);
                            } else {
                                document.getElementById('name-filter').value = searchTerm;
                                closeDetailModal();
                                document.getElementById('name-filter').dispatchEvent(new Event('input', { bubbles: true }));
                            }
                        });
                    }
                } else if (!shouldShowProTip && existingNudge) {
                    // Remove pro-tip if it shouldn't be shown but exists
                    existingNudge.remove();
                }

                // Update benefit badge display
                if (shouldShowBadge && !existingBadge) {
                    // Add badge if it should be shown and doesn't exist
                    const badgeHTML = `<div class="umw-benefit-badge">✅ UMW Benefit: ${airtableMin}-person minimum waived.</div>`;
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = badgeHTML;
                    const badgeElement = tempDiv.firstElementChild;
                    modalActionsContainer.appendChild(badgeElement);
                } else if (!shouldShowBadge && existingBadge) {
                    // Remove badge if it shouldn't be shown but exists
                    existingBadge.remove();
                }
            };

            const handlePlus = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const currentValue = parseInt(input.value, 10) || 1;
                input.value = currentValue + 1;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                updateProTipVisibility();
                // Update Quick Pay button text
                const quickPayBtn = document.getElementById('modal-quick-pay-btn');
                if (quickPayBtn && quickPayBtn._updateText) {
                    quickPayBtn._updateText();
                }
            };
            const handleMinus = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const currentValue = parseInt(input.value, 10) || 1;
                const minValue = parseInt(input.min, 10) || 1;
                if (currentValue > minValue) {
                    input.value = currentValue - 1;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    updateProTipVisibility();
                    // Update Quick Pay button text
                    const quickPayBtn = document.getElementById('modal-quick-pay-btn');
                    if (quickPayBtn && quickPayBtn._updateText) {
                        quickPayBtn._updateText();
                    }
                }
            };
            const handleTouchEnd = (e) => {
                e.preventDefault();
                const handler = e.currentTarget === plusBtn ? handlePlus : handleMinus;
                handler(e);
            };
            plusBtn.addEventListener('click', handlePlus);
            plusBtn.addEventListener('touchend', handleTouchEnd, { passive: false });
            minusBtn.addEventListener('click', handleMinus);
            minusBtn.addEventListener('touchend', handleTouchEnd, { passive: false });
        }
    } else {
        modalActionsContainer.style.display = 'none';
        modalNotesContainer.style.display = 'none';
        modalQuantitySelector.innerHTML = '';
    }
    // --- END THE FIX ---\

    modalCalendarContainer.innerHTML = '';
    const iCalUrl = record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL];

    // Hide availability calendar for events - not needed for published event viewing
    if (iCalUrl && !isEvent) {
        try {
            modalCalendarContainer.style.display = 'block';
            log('Modal', `iCal URL found for ${record.id}, initializing calendar.`);

            // Lazy load Flatpickr if needed
            if (!window.flatpickr) {
                log('Modal', 'Loading Flatpickr dynamically...');
                await loadFlatpickr();
            }

            if (!window.flatpickr) {
                throw new Error('Flatpickr not available after loading');
            }
            
            if (typeof window.flatpickr !== 'function') {
                throw new Error(`Flatpickr is not a function, got type: ${typeof window.flatpickr}`);
            }

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
                    if (window.tippy) {
                        tippy('.flatpickr-day', {
                            content: reference => reference.getAttribute('data-tippy-content'),
                            placement: 'top',
                            theme: 'light',
                            allowHTML: true,
                        });
                    }
                },
                onChange: (selectedDates) => {
                    if (selectedDates.length > 0 && selectedDates[0]) {
                        const eventDateInput = document.getElementById('event-date-picker');
                        if (eventDateInput && eventDateInput._flatpickr) {
                            try {
                                eventDateInput._flatpickr.setDate(selectedDates[0], true);
                            } catch (error) {
                                log('Modal', `Error syncing event date picker: ${error.message}`);
                            }
                        }
                    }
                }
            });
            
            const eventDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
            if (eventDate) {
                try {
                    const dateObj = new Date(eventDate);
                    if (!isNaN(dateObj.getTime())) {
                        calendarInstance.setDate(dateObj, true);
                    } else {
                        log('Modal', `Invalid event date: ${eventDate}`);
                    }
                } catch (error) {
                    log('Modal', `Error setting calendar date: ${error.message}`);
                }
            }
            
            log('Modal', 'Calendar initialized successfully');
        } catch (error) {
            log('Modal', `Error initializing calendar: ${error.message}`);
            console.error('Calendar initialization error:', error);
            modalCalendarContainer.style.display = 'none';
            modalCalendarContainer.innerHTML = '<p style="color: #dc3545; padding: 10px; text-align: center;">Unable to load calendar. Please try refreshing the page.</p>';
        }
    } else {
        modalCalendarContainer.style.display = 'none';
        log('Modal', `No iCal URL for ${record.id}, hiding calendar.`);
    }

    ui.updateCardIcon(record.id);

    modalOverlay.classList.add('active');
    modalOverlay.style.display = 'flex';
    document.body.classList.add('modal-open');
    setTimeout(() => {
        const chatContainer = document.getElementById('modal-chat-container');
        const isChatEnabledOnItem = record.fields['Chat Enabled'] || false;
        const isEvent = record.fields['Item Type'] === 'Event';
        const userRsvped = isEvent && (record.fields.RSVPs || []).includes(state.session.user.id);
        
        log('Modal Chat Init', {
            isAuthenticated: state.session.user.isAuthenticated,
            isChatEnabledOnItem: isChatEnabledOnItem,
            isEvent,
            userRsvped,
            chatContainerExists: !!chatContainer,
            user: state.session.user
        });
        if (state.session.user.isAuthenticated && chatContainer && (isChatEnabledOnItem || userRsvped)) {
            log('Modal', 'All conditions met. Initializing item chat.');
            chatContainer.style.display = 'flex';
            initializeItemChat(record.id);
        } else {
            log('Modal', 'Hiding chat. Reason:', {
                isAuthenticated: state.session.user.isAuthenticated,
                chatEnabled: isChatEnabledOnItem || userRsvped,
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
    const closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) {
        closeBtn.onclick = null;
    }
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

    // Get new fee/total elements
    const processingFeeEl = document.getElementById('processing-fee-price');
    const finalChargeEl = document.getElementById('final-charge-price');

    const totalLabel = document.getElementById('checkout-total-label');
    if (totalLabel) {
        if (state.session.user.amountReceived > 0) {
            totalLabel.textContent = 'Total Final Cost:';
        } else {
            totalLabel.textContent = 'Total Estimated Cost:';
        }
    }

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

    // --- 1. Calculate Base Total ---\
    summaryDetailsEl.innerHTML = '';
    tipAmountInput.value = '';
    let finalTotal = 0; // This is the plan subtotal
    const summaryList = document.createElement('ul');

    // Check if UMW is in plan
    let isUmwInPlan = false;
    for (const [id] of state.cart.lockedItems) {
        const lockedRecord = state.records.all.find(r => r.id === id);
        if (lockedRecord && lockedRecord.fields.Name && lockedRecord.fields.Name.includes("Union Machine Works")) {
            isUmwInPlan = true;
            break;
        }
    }

    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;

        const price = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);

        const itemTotal = price * (itemInfo.quantity || 1);
        finalTotal += itemTotal;
        const listItem = document.createElement('li');

        // Check for edge case notes
        const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        const effectiveMin = getEffectiveMinQuantity(record);
        let edgeCaseNote = '';

        if (airtableMin > 1) {
            if (!isUmwInPlan && itemInfo.quantity === effectiveMin) {
                // Off-site at minimum
                edgeCaseNote = '<small class="checkout-edge-case-note" style="color: #fd7e14; font-style: italic; display: block;">* At minimum headcount for off-site event</small>';
            } else if (isUmwInPlan && itemInfo.quantity < airtableMin) {
                // On-site below standard minimum
                edgeCaseNote = '<small class="checkout-edge-case-note" style="color: #28a745; font-style: italic; display: block;">✓ Below standard minimum (Union Machine Works venue)</small>';
            }
        }

        let noteHtml = '';
        if (itemInfo.note && itemInfo.note.trim() !== '') {
            noteHtml = `<small class="checkout-summary-note">Note: ${itemInfo.note}</small>`;
        }

        listItem.innerHTML = `
            <div class="summary-item-details">
                <span class="summary-item-name">${record.fields.Name} (x${itemInfo.quantity || 1})</span>
                ${edgeCaseNote}
                ${noteHtml}
            </div>
            <span class="summary-item-price">$${itemTotal.toFixed(2)}</span>
        `;
        summaryList.appendChild(listItem);
    }
    summaryDetailsEl.appendChild(summaryList);

    fullTotalEl.textContent = `$${finalTotal.toFixed(2)}`;
    fullTotalEl.dataset.total = finalTotal;
    
    const paymentHistory = state.session.user.paymentHistory || [];
    const amountReceived = state.session.user.amountReceived || 0;
    
    if (paymentHistory.length > 0) {
        const paymentsReceivedSection = document.createElement('div');
        paymentsReceivedSection.className = 'checkout-payments-received';
        paymentsReceivedSection.style.cssText = 'margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;';
        
        let paymentsHtml = '<h4 style="margin-top: 0; color: #28a745;">✅ Payments Received</h4>';
        paymentsHtml += '<div class="payment-receipts-list">';
        
        // Sort payments by date (oldest first) and create index mapping
        const sortedPayments = paymentHistory
            .map((payment, originalIndex) => ({ ...payment, originalIndex }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        
        sortedPayments.forEach((payment, displayIndex) => {
            const paymentDate = new Date(payment.date).toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric' 
            });
            paymentsHtml += `
                <div class="payment-receipt-row" style="display: flex; justify-content: space-between; align-items: center; margin: 8px 0; padding: 8px; background-color: white; border-radius: 4px;">
                    <div>
                        <strong>Payment ${displayIndex + 1}</strong>
                        <small style="display: block; color: #6c757d;">${paymentDate}</small>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-weight: bold;">$${payment.amount.toFixed(2)}</span>
                        <button class="receipt-btn" data-payment-index="${payment.originalIndex}" style="padding: 5px 10px; font-size: 0.85em; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Receipt</button>
                    </div>
                </div>
            `;
        });
        
        paymentsHtml += '</div>';
        paymentsHtml += `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #dee2e6; text-align: right;"><strong>Total Paid: $${amountReceived.toFixed(2)}</strong></div>`;
        
        paymentsReceivedSection.innerHTML = paymentsHtml;
        
        const totalDepositSection = document.querySelector('.checkout-total-deposit-section');
        if (totalDepositSection) {
            totalDepositSection.parentNode.insertBefore(paymentsReceivedSection, totalDepositSection);
        }
    }

    if (currentShopSettings.paymentOptions === 'DepositOrFull' && state.session.user.amountReceived === 0) {
        paymentChoiceContainer.style.display = 'block';
        // --- THIS IS CHANGED: Add async/await ---\
        document.querySelectorAll('input[name="paymentChoice"]').forEach(radio => {
            radio.addEventListener('change', async () => await updateCheckoutDisplay());
        });
    } else {
        paymentChoiceContainer.style.display = 'none';
    }

    if (termsContainer && currentShopSettings.terms) {
        termsContainer.innerHTML = `<h4>Simplified Terms</h4><p>${currentShopSettings.terms.replace(/\\n/g, '<br>')}</p>`;
    }

    // Initialize Stripe on demand (lazy load)
    try {
        if (!window.Stripe) {
            log('Modal', 'Loading Stripe.js dynamically...');
            await loadStripe();
        }
        stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
    } catch (err) {
        console.error("Failed to initialize Stripe:", err);
        alert(`Could not initialize payment system: ${err.message}.`);
        return;
    }

    // --- NEW: Ensure payment form is visible by default ---
    // updateCheckoutDisplay will hide it if the plan is paid
    const paymentForm = document.getElementById('payment-form');
    if (paymentForm) paymentForm.style.display = 'block';
    // --- END NEW ---

    // --- 2. Update UI (calculates tip and base amount due) ---\
    // This now updates module-level 'currentBaseAmount' and will create the payment element
    await updateCheckoutDisplay(); 
    tipAmountInput.addEventListener('input', debounce(async () => await updateCheckoutDisplay(), 500));

    // --- 3. Create Payment Intent (MOVED to updateCheckoutDisplay) ---\
    try {
        // --- 4. Call create-payment-intent (Happens in updateCheckoutDisplay) ---\
        // --- 5. Update UI with initial fees (Happens in updateCheckoutDisplay) ---\
        // --- 6. Create and Mount PaymentElement (Happens in updateCheckoutDisplay) ---\
        
        checkoutModalOverlay.cardElement = null; // Clear old reference

        // --- 8. Show Modal ---\
        checkoutModalOverlay.classList.add('active');
        setTimeout(() => {
            checkoutModalOverlay.style.display = 'flex';
            if(checkoutCloseBtn) checkoutCloseBtn.focus();
        }, 0); // <-- FIX: Removed stray \
        document.body.classList.add('modal-open');

    } catch (err) {
        // This catch block now only catches errors related to showing the modal,
        // as the payment init happens inside updateCheckoutDisplay
        console.error("Failed to show checkout modal:", err);
        alert(`Could not display checkout: ${err.message}.`);
        hideCheckoutModal();
    }
}

export function hideCheckoutModal() {
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    if (checkoutModalOverlay) {
        if (checkoutModalOverlay.removeEventListenerOnClick) {
            checkoutModalOverlay.removeEventListenerOnClick();
        }
        document.getElementById('tip-amount')?.removeEventListener('input', updateCheckoutDisplay);
        document.querySelectorAll('input[name="paymentChoice"]').forEach(radio => {
            radio.removeEventListener('change', updateCheckoutDisplay);
        });

        // --- ADD THIS ---\
        if (paymentElement) {
            paymentElement.unmount();
            paymentElement = null;
        }
        elements = null;
        currentClientSecret = null;
        currentBaseAmount = 0;
        currentProcessingFee = 0;
        // --- END ADD ---\

        checkoutModalOverlay.classList.remove('active');
        setTimeout(() => {
            const checkoutCloseBtn = document.getElementById('checkout-close-btn');
            if (checkoutCloseBtn) {
                checkoutCloseBtn.removeEventListener('click', hideCheckoutModal);
            }
            checkoutModalOverlay.style.display = 'none';
            log('Modal', 'Checkout modal hidden.');
        }, 300); // <-- FIX: Removed stray \
        document.body.classList.remove('modal-open');
    }
}

export function getStripeContext() {
    return { stripe, elements };
}
