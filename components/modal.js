// REPLACE THE ENTIRE CONTENTS of components/modal.js
console.log('[MODULE DEBUG] modal.js module starting to load...', performance.now().toFixed(2) + 'ms');

import { state, getRecordById } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY, getModalZIndex } from '../config.js';
import { parseOptions, updateUrl, getGroupPriceRange, getRecordPrice, getActiveImageTag, getRecordDescription, flattenOptionGroups, debounce, loadStripe, loadFlatpickr, getEffectiveMinQuantity, generateSlug, calculateDynamicPackagePrice, getPackageDefaultHeadcount } from '../utils.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS, calculateMissingCategories, buildGoalBucket, calculateRecommendationScore, ATTRIBUTE_TO_KEYWORDS_MAP } from '../availability.js';
import { log } from '../utils/debug.js';
import { showReceiptModal } from './receipt.js';
import { applyCloudinaryTransform } from '../utils/imageOptimizer.js';
import { triggerSave } from '../events.js';

console.log('[MODULE DEBUG] modal.js imports resolved successfully.', performance.now().toFixed(2) + 'ms');

/**
 * Helper to create or update a meta tag
 * @param {string} selector - CSS selector to find existing tag
 * @param {Object} attributes - Attributes to set on the tag
 */
function setMetaTag(selector, attributes) {
    let tag = document.querySelector(selector);
    if (!tag) {
        tag = document.createElement('meta');
        document.head.appendChild(tag);
    }
    for (const [key, value] of Object.entries(attributes)) {
        tag.setAttribute(key, value);
    }
}

/**
 * Helper to create or update a link tag
 * @param {string} selector - CSS selector to find existing tag
 * @param {Object} attributes - Attributes to set on the tag
 */
function setLinkTag(selector, attributes) {
    let tag = document.querySelector(selector);
    if (!tag) {
        tag = document.createElement('link');
        document.head.appendChild(tag);
    }
    for (const [key, value] of Object.entries(attributes)) {
        tag.setAttribute(key, value);
    }
}

/**
 * Comprehensive SEO meta tags update including Open Graph, Twitter Cards, keywords, and canonical URL.
 * @param {Object} record - The item record for SEO metadata.
 * @param {string} title - The page title.
 * @param {string} description - The page description.
 * @param {string[]} tags - AI-generated tags for keywords.
 * @param {string} imageUrl - Image URL for social sharing.
 */
function updateFullSeoMetadata(record, title, description, tags = [], imageUrl = '') {
    // Update page title
    document.title = title;

    // Basic meta description
    setMetaTag('meta[name="description"]', { name: 'description', content: description });

    // Keywords from AI profile tags
    if (tags.length > 0) {
        setMetaTag('meta[name="keywords"]', { name: 'keywords', content: tags.join(', ') });
    }

    // Generate canonical URL with AI tags for SEO
    const slug = generateSlug(record.fields.Name, record.id, tags);
    const canonicalUrl = `${window.location.origin}/item/${slug}`;
    setLinkTag('link[rel="canonical"]', { rel: 'canonical', href: canonicalUrl });

    // Open Graph meta tags for Facebook, LinkedIn, etc.
    setMetaTag('meta[property="og:type"]', { property: 'og:type', content: record.fields['Item Type'] === 'Event' ? 'event' : 'product' });
    setMetaTag('meta[property="og:title"]', { property: 'og:title', content: title });
    setMetaTag('meta[property="og:description"]', { property: 'og:description', content: description });
    setMetaTag('meta[property="og:url"]', { property: 'og:url', content: canonicalUrl });
    setMetaTag('meta[property="og:site_name"]', { property: 'og:site_name', content: 'WTFun' });

    if (imageUrl) {
        setMetaTag('meta[property="og:image"]', { property: 'og:image', content: imageUrl });
        setMetaTag('meta[property="og:image:alt"]', { property: 'og:image:alt', content: record.fields.Name || 'Item image' });
    }

    // Twitter Card meta tags
    setMetaTag('meta[name="twitter:card"]', { name: 'twitter:card', content: imageUrl ? 'summary_large_image' : 'summary' });
    setMetaTag('meta[name="twitter:title"]', { name: 'twitter:title', content: title });
    setMetaTag('meta[name="twitter:description"]', { name: 'twitter:description', content: description });

    if (imageUrl) {
        setMetaTag('meta[name="twitter:image"]', { name: 'twitter:image', content: imageUrl });
        setMetaTag('meta[name="twitter:image:alt"]', { name: 'twitter:image:alt', content: record.fields.Name || 'Item image' });
    }

    // Additional structured meta tags for events
    if (record.fields['Item Type'] === 'Event') {
        if (record.fields['Start Date'] || record.fields['Event Date'] || record.fields.Date) {
            const eventDate = record.fields['Start Date'] || record.fields['Event Date'] || record.fields.Date;
            setMetaTag('meta[property="event:start_time"]', { property: 'event:start_time', content: eventDate });
        }
        if (record.fields.Location) {
            setMetaTag('meta[property="event:location"]', { property: 'event:location', content: record.fields.Location });
        }
    }

    // Product-specific meta for non-events
    if (record.fields['Item Type'] !== 'Event' && record.fields.Price) {
        setMetaTag('meta[property="product:price:amount"]', { property: 'product:price:amount', content: record.fields.Price.toString() });
        setMetaTag('meta[property="product:price:currency"]', { property: 'product:price:currency', content: 'USD' });
    }
}

/**
 * Resets SEO meta tags to default values when modal is closed.
 */
function resetSeoMetadata() {
    document.title = 'WTFun | Plan Your Perfect Event';
    setMetaTag('meta[name="description"]', { name: 'description', content: 'Plan your perfect event with WTFun.' });

    // Remove item-specific meta tags
    const tagsToRemove = [
        'meta[name="keywords"]',
        'link[rel="canonical"]',
        'meta[property="og:type"]',
        'meta[property="og:title"]',
        'meta[property="og:description"]',
        'meta[property="og:url"]',
        'meta[property="og:image"]',
        'meta[property="og:image:alt"]',
        'meta[name="twitter:card"]',
        'meta[name="twitter:title"]',
        'meta[name="twitter:description"]',
        'meta[name="twitter:image"]',
        'meta[name="twitter:image:alt"]',
        'meta[property="event:start_time"]',
        'meta[property="event:location"]',
        'meta[property="product:price:amount"]',
        'meta[property="product:price:currency"]'
    ];

    tagsToRemove.forEach(selector => {
        const tag = document.querySelector(selector);
        if (tag && selector !== 'meta[name="description"]') {
            tag.remove();
        }
    });

    // Reset Open Graph site name
    setMetaTag('meta[property="og:site_name"]', { property: 'og:site_name', content: 'WTFun' });
}

/**
 * Copies a share link to clipboard and provides visual feedback on the button.
 * @param {string} url - The URL to copy to clipboard.
 * @param {HTMLButtonElement} buttonEl - The button element to show feedback on.
 */
async function copyShareLinkToClipboard(url, buttonEl) {
    try {
        await navigator.clipboard.writeText(url);
        const originalHTML = buttonEl.innerHTML;
        buttonEl.innerHTML = '<span class="share-icon">&#10003;</span> Copied!';
        buttonEl.classList.add('share-copied');
        log('Modal', `Copied share link to clipboard: ${url}`);
        setTimeout(() => {
            buttonEl.innerHTML = originalHTML;
            buttonEl.classList.remove('share-copied');
        }, 1500);
    } catch (err) {
        console.error('Failed to copy share link:', err);
        // Show error feedback briefly
        const originalHTML = buttonEl.innerHTML;
        buttonEl.innerHTML = '<span class="share-icon">&#x26A0;</span> Failed';
        setTimeout(() => {
            buttonEl.innerHTML = originalHTML;
        }, 1500);
    }
}

/**
 * Updates the page's title and meta description for SEO purposes.
 * @param {string} title - The new page title.
 * @param {string} description - The new meta description.
 * @deprecated Use updateFullSeoMetadata for comprehensive SEO support.
 */
function updatePageMetadata(title, description) {
    document.title = title;

    let metaDescription = document.querySelector('meta[name="description"]');
    if (!metaDescription) {
        metaDescription = document.createElement('meta');
        metaDescription.setAttribute('name', 'description');
        document.head.appendChild(metaDescription);
    }
    metaDescription.setAttribute('content', description);
}

/**
 * Updates the JSON-LD Schema markup for SEO purposes.
 * Generates schema.org/Event or schema.org/Product based on the item type.
 * Includes AI-generated tags as keywords for better search visibility.
 * @param {Object} record - The item record to generate schema for.
 */
function updateSchema(record) {
    const itemType = record.fields['Item Type'];
    const name = record.fields.Name || 'Untitled';
    const description = record.fields.Description || '';
    const price = record.fields.Price || 0;

    // Get image URL from first attachment if available
    let imageUrl = '';
    if (record.fields.Images && record.fields.Images.length > 0) {
        imageUrl = record.fields.Images[0].url || '';
    }

    // Extract AI-generated tags for schema keywords
    let tags = [];
    const aiProfileString = record.fields.AI_Profile || record.fields.Rankings;
    if (aiProfileString) {
        try {
            const aiProfile = JSON.parse(aiProfileString);
            tags = aiProfile.Tags || aiProfile.SearchTerms || [];
        } catch (e) {
            // Ignore parsing errors
        }
    }

    let schemaData;

    if (itemType === 'Event') {
        // Generate schema.org/Event
        schemaData = {
            '@context': 'https://schema.org',
            '@type': 'Event',
            'name': name,
            'startDate': record.fields['Start Date'] || record.fields['Event Date'] || record.fields.Date || '',
            'location': {
                '@type': 'Place',
                'name': record.fields.Location || 'Unknown Location'
            },
            'offers': {
                '@type': 'Offer',
                'price': price,
                'priceCurrency': 'USD'
            },
            'organizer': {
                '@type': 'Organization',
                'name': 'WTFun',
                'url': window.location.origin
            }
        };

        // Add image if available
        if (imageUrl) {
            schemaData.image = imageUrl;
        }

        // Add description if available
        if (description) {
            schemaData.description = description;
        }

        // Add AI-generated tags as keywords
        if (tags.length > 0) {
            schemaData.keywords = tags.join(', ');
        }
    } else {
        // Generate schema.org/Product for all other item types
        schemaData = {
            '@context': 'https://schema.org',
            '@type': 'Product',
            'name': name,
            'description': description,
            'offers': {
                '@type': 'Offer',
                'price': price,
                'priceCurrency': 'USD',
                'availability': 'https://schema.org/InStock'
            },
            'brand': {
                '@type': 'Organization',
                'name': 'WTFun'
            }
        };

        // Add image if available
        if (imageUrl) {
            schemaData.image = imageUrl;
        }

        // Add AI-generated tags as keywords
        if (tags.length > 0) {
            schemaData.keywords = tags.join(', ');
        }
    }

    // Find or create the JSON-LD script tag
    let scriptTag = document.getElementById('dynamic-schema');
    if (!scriptTag) {
        scriptTag = document.createElement('script');
        scriptTag.type = 'application/ld+json';
        scriptTag.id = 'dynamic-schema';
        document.head.appendChild(scriptTag);
    }

    // Set the schema content
    scriptTag.textContent = JSON.stringify(schemaData);
}

/**
 * Resets the JSON-LD Schema to a default Organization schema.
 * Called when modal is closed to prevent stale data.
 */
function resetSchema() {
    let scriptTag = document.getElementById('dynamic-schema');

    // Default Organization schema
    const defaultSchema = {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        'name': 'WTFun',
        'url': window.location.origin,
        'description': 'Plan your perfect event with WTFun.'
    };

    if (scriptTag) {
        scriptTag.textContent = JSON.stringify(defaultSchema);
    }
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
console.log('[MODAL DEBUG] modalOverlay initialized at module load:', !!modalOverlay);

/**
 * Get shop settings from the current active shop
 * Mirrors the logic in main.js for constructing shopSettings
 * @returns {Object} Shop settings object
 */
export function getShopSettings() {
    const activeShop = state.stores.all.find(s => s.id === state.ui.activeShopId);
    if (!activeShop || !activeShop.fields) {
        return {
            shopType: 'Events',
            enabledFilters: ['Date & Time', 'Headcount', 'Location', 'Subcategories'],
            paymentOptions: 'DepositOnly',
            terms: 'Default terms and conditions text.',
            cartLabels: {}
        };
    }

    const settings = {
        shopType: activeShop.fields.ShopType || 'Events',
        enabledFilters: activeShop.fields.EnabledFilters || ['Date & Time', 'Headcount', 'Location', 'Subcategories'],
        paymentOptions: activeShop.fields.PaymentOptions || 'DepositOnly',
        terms: activeShop.fields.TermsAndConditions || 'Default terms and conditions text.',
        cartLabels: {}
    };

    try {
        settings.cartLabels = JSON.parse(activeShop.fields.CartLabels || '{}');
    } catch (e) {
        console.warn('Could not parse CartLabels JSON, using defaults.');
    }

    return settings;
}

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
    },
    paypal: {
        name: 'PayPal',
        icon: 'P',
        cssClass: 'paypal',
        // PayPal.Me deep link format with optional amount
        getUrl: (handle, amount, itemName) => {
            // Handle can be PayPal.Me username or full URL
            let url = handle.startsWith('http') ? handle : `https://paypal.me/${handle}`;
            if (amount && amount > 0) {
                // PayPal.Me format: paypal.me/username/amount
                url += `/${amount.toFixed(2)}`;
            }
            return url;
        },
        getDisplayHandle: (handle) => {
            // If it's a PayPal.Me URL, extract username
            if (handle.includes('paypal.me/')) {
                const username = handle.split('paypal.me/')[1]?.split('/')[0];
                return username ? `@${username}` : handle;
            }
            // If it's just a username
            return handle.includes('@') ? handle : `@${handle}`;
        }
    }
};

// Tip percentages for quick pay
const TIP_OPTIONS = [
    { label: 'No Tip', percent: 0 },
    { label: '10%', percent: 10 },
    { label: '15%', percent: 15 },
    { label: '20%', percent: 20 },
    { label: 'Custom', percent: -1 } // -1 indicates custom
];

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

    // Track current tip amount
    let currentTipAmount = 0;
    const baseAmount = amount;

    // Function to calculate tip from percentage
    const calculateTip = (percent) => {
        if (percent <= 0) return 0;
        return baseAmount * (percent / 100);
    };

    // Function to update total display and payment links
    const updateTotalAndPayments = (tipAmount) => {
        currentTipAmount = tipAmount;
        const totalWithTip = baseAmount + tipAmount;

        // Update total display
        const totalDisplay = optionsContainer.querySelector('.quick-pay-amount-total');
        if (totalDisplay) {
            const quantityText = quantity > 1 ? ` (${quantity} × $${(baseAmount / quantity).toFixed(2)})` : '';
            if (tipAmount > 0) {
                totalDisplay.innerHTML = `Total: $${totalWithTip.toFixed(2)}${quantityText}<br><span class="quick-pay-tip-included">(includes $${tipAmount.toFixed(2)} tip)</span>`;
            } else {
                totalDisplay.innerHTML = `Total: $${totalWithTip.toFixed(2)}${quantityText}`;
            }
        }

        // Update payment option links/amounts
        const paymentBtns = optionsContainer.querySelectorAll('.quick-pay-option-btn');
        paymentBtns.forEach(btn => {
            const appKey = btn.dataset.appKey;
            const handle = btn.dataset.handle;
            if (!appKey || !handle) return;

            const appConfig = PAYMENT_APPS[appKey];
            if (!appConfig) return;

            const url = appConfig.getUrl(handle, totalWithTip, itemName);
            if (url) {
                btn.href = url;
            }
            // Update stored amount for copy functionality
            btn.dataset.amount = totalWithTip.toFixed(2);
        });
    };

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

        // Add tip selector
        const tipSelector = document.createElement('div');
        tipSelector.className = 'quick-pay-tip-selector';
        tipSelector.innerHTML = `
            <div class="quick-pay-tip-label">Add a tip?</div>
            <div class="quick-pay-tip-options">
                ${TIP_OPTIONS.map((opt, index) => `
                    <button class="quick-pay-tip-btn${index === 0 ? ' active' : ''}" data-percent="${opt.percent}">
                        ${opt.label}
                    </button>
                `).join('')}
            </div>
            <div class="quick-pay-tip-custom-input" style="display: none;">
                <span class="quick-pay-tip-currency">$</span>
                <input type="number" class="quick-pay-tip-input" placeholder="0.00" min="0" step="0.01">
            </div>
        `;
        optionsContainer.appendChild(tipSelector);

        // Set up tip button handlers
        const tipBtns = tipSelector.querySelectorAll('.quick-pay-tip-btn');
        const customInput = tipSelector.querySelector('.quick-pay-tip-custom-input');
        const tipInput = tipSelector.querySelector('.quick-pay-tip-input');

        tipBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                // Remove active from all buttons
                tipBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const percent = parseInt(btn.dataset.percent, 10);
                if (percent === -1) {
                    // Show custom input
                    customInput.style.display = 'flex';
                    tipInput.focus();
                    // Use current custom value or 0
                    const customValue = parseFloat(tipInput.value) || 0;
                    updateTotalAndPayments(customValue);
                } else {
                    // Hide custom input
                    customInput.style.display = 'none';
                    tipInput.value = '';
                    const tipAmount = calculateTip(percent);
                    updateTotalAndPayments(tipAmount);
                }
            });
        });

        // Handle custom tip input
        tipInput.addEventListener('input', () => {
            const customValue = parseFloat(tipInput.value) || 0;
            updateTotalAndPayments(customValue);
        });
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
            // Store data attributes for tip updates
            optionElement.dataset.appKey = key.toLowerCase();
            optionElement.dataset.handle = handle;
            optionElement.dataset.amount = amount.toFixed(2);

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

            // For Zelle (no URL), add copy functionality with amount info (including tip)
            if (!url) {
                optionElement.style.cursor = 'pointer';
                optionElement.title = 'Click to copy payment details';
                optionElement.addEventListener('click', () => {
                    // Use stored amount which includes any tip
                    const currentAmount = parseFloat(optionElement.dataset.amount) || amount;
                    const copyText = appConfig.getCopyText ? appConfig.getCopyText(handle, currentAmount, itemName) : handle;
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

/**
 * Sets up the donation meter for an item, showing community fund progress
 * and allowing users to chip in toward making the item free for someone in need.
 * Donation state is stored per-item in localStorage.
 * @param {Object} record - The item record
 * @param {Object} paymentOptions - Store payment options
 * @param {Object} itemState - Current item state (quantity, options, etc.)
 */
function setupDonationMeter(record, paymentOptions, itemState) {
    const donationMeter = document.getElementById('modal-donation-meter');
    if (!donationMeter) return;

    const price = getRecordPrice(record, itemState.selectedOptionIndex);
    // Goal is the item price (to fund one free giveaway), minimum $5 for free items
    const goalAmount = price > 0 ? price : 5;

    // Load donation progress from localStorage (per-item tracking)
    const donationKey = `donation_fund_${record.id}`;
    let donationData = { raised: 0, contributors: 0 };
    try {
        const stored = localStorage.getItem(donationKey);
        if (stored) donationData = JSON.parse(stored);
    } catch (e) { /* ignore parse errors */ }

    const raised = donationData.raised || 0;
    const contributors = donationData.contributors || 0;
    const percent = Math.min(100, (raised / goalAmount) * 100);

    // Update meter display
    const statsEl = donationMeter.querySelector('.donation-meter-stats');
    const barFill = donationMeter.querySelector('.donation-meter-bar-fill');
    const descEl = donationMeter.querySelector('.donation-meter-description');

    if (statsEl) {
        statsEl.textContent = `$${raised.toFixed(2)} / $${goalAmount.toFixed(2)}`;
    }
    if (barFill) {
        // Small delay so animation plays visibly
        requestAnimationFrame(() => {
            barFill.style.width = `${percent}%`;
        });
    }

    if (descEl) {
        if (percent >= 100) {
            descEl.textContent = 'Goal reached! This item can be given to someone in need.';
        } else {
            const remaining = (goalAmount - raised).toFixed(2);
            descEl.textContent = `$${remaining} more to fund a free giveaway for someone in need. ${contributors > 0 ? `${contributors} ${contributors === 1 ? 'person has' : 'people have'} chipped in.` : 'Be the first to chip in!'}`;
        }
    }

    // Setup preset buttons
    const presetBtns = donationMeter.querySelectorAll('.donation-preset-btn');
    const customInput = donationMeter.querySelector('.donation-custom-input');
    const amountInput = donationMeter.querySelector('.donation-amount-input');

    presetBtns.forEach(btn => {
        // Clone to remove old listeners
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', () => {
            donationMeter.querySelectorAll('.donation-preset-btn').forEach(b => b.classList.remove('active'));
            newBtn.classList.add('active');

            const presetAmount = newBtn.dataset.amount;
            if (presetAmount === 'custom') {
                customInput.style.display = 'flex';
                amountInput.focus();
            } else {
                customInput.style.display = 'none';
                amountInput.value = parseFloat(presetAmount).toFixed(2);
            }
        });
    });

    // Setup donate/submit button
    const submitBtn = donationMeter.querySelector('.donation-submit-btn');
    if (submitBtn) {
        const newSubmitBtn = submitBtn.cloneNode(true);
        submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);

        newSubmitBtn.addEventListener('click', () => {
            // Determine donation amount
            const activePreset = donationMeter.querySelector('.donation-preset-btn.active');
            let donationAmount = 0;

            if (activePreset && activePreset.dataset.amount !== 'custom') {
                donationAmount = parseFloat(activePreset.dataset.amount) || 0;
            } else {
                donationAmount = parseFloat(amountInput.value) || 0;
            }

            if (donationAmount <= 0) {
                // Shake the input to indicate an amount is needed
                const inputEl = customInput.style.display !== 'none' ? customInput : donationMeter.querySelector('.donation-amount-presets');
                inputEl.style.animation = 'none';
                requestAnimationFrame(() => {
                    inputEl.style.animation = 'donationMeterSlideIn 0.3s ease-out';
                });
                return;
            }

            // Open quick pay modal with the donation amount
            const itemName = `Donation: ${record.fields.Name || 'Item'} (Community Fund)`;
            showQuickPayModal(paymentOptions, donationAmount, itemName, 1);

            // Update local donation tracking (optimistic - user is going to pay)
            donationData.raised = (donationData.raised || 0) + donationAmount;
            donationData.contributors = (donationData.contributors || 0) + 1;
            try {
                localStorage.setItem(donationKey, JSON.stringify(donationData));
            } catch (e) { /* storage full, ignore */ }

            // Refresh the meter display
            const newPercent = Math.min(100, (donationData.raised / goalAmount) * 100);
            if (statsEl) {
                statsEl.textContent = `$${donationData.raised.toFixed(2)} / $${goalAmount.toFixed(2)}`;
            }
            if (barFill) {
                barFill.style.width = `${newPercent}%`;
            }
            if (descEl) {
                if (newPercent >= 100) {
                    descEl.textContent = 'Goal reached! This item can be given to someone in need.';
                } else {
                    const remaining = (goalAmount - donationData.raised).toFixed(2);
                    descEl.textContent = `$${remaining} more to fund a free giveaway for someone in need. ${donationData.contributors} ${donationData.contributors === 1 ? 'person has' : 'people have'} chipped in.`;
                }
            }
        });
    }

    // Initialize - show custom input by default since "Custom" is active initially
    if (customInput) customInput.style.display = 'flex';
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
    console.log('[MODAL DEBUG] resetModalState called.');
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
        modalAdditionalDetails: document.getElementById('modal-additional-details')
    };
    for (const key in elements) {
        if (elements[key]) {
            if (key === 'modalItemNote') elements[key].value = '';
            else if (key === 'modalMainImage') {
                elements[key].style.backgroundImage = '';
                // Remove any package collage overlays or component name overlays
                const collageOverlay = elements[key].querySelector('.package-collage-overlay');
                if (collageOverlay) collageOverlay.remove();
                const nameOverlay = elements[key].querySelector('.package-component-name-overlay');
                if (nameOverlay) nameOverlay.remove();
            }
            else elements[key].innerHTML = '';
        }
    }

    // Remove dynamically created event-specific sections that persist between modal opens
    const dynamicSections = document.querySelectorAll('.event-info-section, .rsvp-list-section, .calendar-export-section, .session-components-section, .edit-plan-section');
    dynamicSections.forEach(section => section.remove());

    // Also remove edit mode UI elements
    const editModeElements = document.querySelectorAll('.item-edit-container, .item-edit-save-container');
    editModeElements.forEach(el => el.remove());

    // Reset donation meter and price action buttons
    const donationMeter = document.getElementById('modal-donation-meter');
    if (donationMeter) donationMeter.style.display = 'none';
    const chipInBtn = document.getElementById('modal-chip-in-btn');
    if (chipInBtn) chipInBtn.classList.remove('active');
    const priceActions = document.getElementById('modal-price-actions');
    if (priceActions) priceActions.classList.add('hidden');

    log('Modal', 'Reset modal state.');
}

/**
 * Updates the AI image indicator on the modal main image.
 * Shows or hides the "AI Generated" badge based on whether the current image is AI-generated.
 * @param {boolean} isAIGenerated - Whether the current image is AI-generated
 */
function updateModalAIImageIndicator(isAIGenerated) {
    const modalMainImage = document.getElementById('modal-main-image');
    if (!modalMainImage) return;

    // Remove existing indicator if any
    const existingIndicator = modalMainImage.querySelector('.ai-image-source-modal');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    // Add new indicator if this is an AI-generated image
    if (isAIGenerated) {
        const indicator = document.createElement('span');
        indicator.className = 'ai-image-source-modal ai-image-source approximation';
        indicator.textContent = 'AI Generated';
        indicator.title = 'This image was automatically generated by AI based on the item details';
        modalMainImage.appendChild(indicator);
        log('Modal', 'Added AI image indicator to modal');
    }
}

/**
 * Enables edit mode for a manually added item in the detail modal.
 * Converts name and description to editable input fields with a save button.
 * @param {Object} record - The item record being edited
 * @param {HTMLElement} nameEl - The modal item name element
 * @param {HTMLElement} descEl - The modal item description element
 */
function enableItemEditMode(record, nameEl, descEl) {
    log('Modal', `Entering edit mode for item: ${record.id}`);

    // Store original values for cancel functionality
    const originalName = record.fields.Name || '';
    const originalDescription = record.fields.Description || '';
    const originalPrice = record.fields.Price || 0;

    // Replace name element with editable input
    const nameContainer = document.createElement('div');
    nameContainer.className = 'item-edit-container item-edit-name-container';
    nameContainer.innerHTML = `
        <label class="item-edit-label">Item Name</label>
        <input type="text" class="item-edit-input item-edit-name-input" value="${originalName.replace(/"/g, '&quot;')}" placeholder="Enter item name..." />
    `;
    nameEl.style.display = 'none';
    nameEl.parentNode.insertBefore(nameContainer, nameEl);

    // Replace description element with editable textarea
    const descContainer = document.createElement('div');
    descContainer.className = 'item-edit-container item-edit-desc-container';
    descContainer.innerHTML = `
        <label class="item-edit-label">Description</label>
        <textarea class="item-edit-input item-edit-desc-input" placeholder="Enter item description...">${originalDescription}</textarea>
    `;
    descEl.style.display = 'none';
    descEl.parentNode.insertBefore(descContainer, descEl);

    // Add price editor
    const priceEl = document.getElementById('modal-item-price');
    const priceContainer = document.createElement('div');
    priceContainer.className = 'item-edit-container item-edit-price-container';
    priceContainer.innerHTML = `
        <label class="item-edit-label">Price ($)</label>
        <input type="number" class="item-edit-input item-edit-price-input" value="${originalPrice}" placeholder="0.00" min="0" step="0.01" />
    `;
    if (priceEl) {
        priceEl.style.display = 'none';
        priceEl.parentNode.insertBefore(priceContainer, priceEl);
    }

    // Add Photo Upload section
    const photosContainer = document.createElement('div');
    photosContainer.className = 'item-edit-container item-edit-photos-container';

    // Get existing custom images for this record (if any)
    const existingCustomImages = record.fields._customImages || [];

    photosContainer.innerHTML = `
        <label class="item-edit-label">Photos</label>
        <div class="item-edit-photos-upload">
            <input type="file" id="item-edit-photo-input" accept="image/*" multiple class="item-edit-photo-input" />
            <label for="item-edit-photo-input" class="item-edit-photo-btn">
                <span class="photo-btn-icon">📷</span>
                <span class="photo-btn-text">Add Photo(s)</span>
            </label>
            <div class="item-edit-photos-preview" id="item-edit-photos-preview">
                ${existingCustomImages.map((img, idx) => `
                    <div class="photo-preview-item" data-index="${idx}" data-existing="true">
                        <img src="${img.url || img}" alt="Photo ${idx + 1}" />
                        <button type="button" class="photo-remove-btn" data-index="${idx}" title="Remove photo">&times;</button>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    // Insert photos container after price container
    if (priceEl && priceEl.parentNode) {
        priceEl.parentNode.insertBefore(photosContainer, priceContainer.nextSibling);
    } else {
        descContainer.parentNode.insertBefore(photosContainer, descContainer.nextSibling);
    }

    // Track pending photos for upload
    const pendingPhotos = [];
    const existingPhotosToKeep = [...existingCustomImages];

    // Photo input change handler
    const photoInput = photosContainer.querySelector('#item-edit-photo-input');
    const photosPreview = photosContainer.querySelector('#item-edit-photos-preview');

    photoInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        for (const file of files) {
            if (!file.type.startsWith('image/')) continue;

            // Read file as data URL for preview and storage
            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUrl = event.target.result;
                pendingPhotos.push({ url: dataUrl, name: file.name });

                // Add preview
                const previewItem = document.createElement('div');
                previewItem.className = 'photo-preview-item';
                previewItem.dataset.index = existingPhotosToKeep.length + pendingPhotos.length - 1;
                previewItem.dataset.pending = 'true';
                previewItem.innerHTML = `
                    <img src="${dataUrl}" alt="${file.name}" />
                    <button type="button" class="photo-remove-btn" title="Remove photo">&times;</button>
                `;

                // Add remove handler for this preview
                previewItem.querySelector('.photo-remove-btn').addEventListener('click', (evt) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    const idx = pendingPhotos.findIndex(p => p.url === dataUrl);
                    if (idx !== -1) {
                        pendingPhotos.splice(idx, 1);
                    }
                    previewItem.remove();
                });

                photosPreview.appendChild(previewItem);
            };
            reader.readAsDataURL(file);
        }

        // Clear input to allow re-selecting same files
        photoInput.value = '';
    });

    // Add remove handlers for existing photos
    photosPreview.querySelectorAll('.photo-remove-btn').forEach(btn => {
        btn.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            const idx = parseInt(btn.dataset.index, 10);
            if (!isNaN(idx) && idx < existingPhotosToKeep.length) {
                existingPhotosToKeep.splice(idx, 1);
            }
            btn.closest('.photo-preview-item').remove();
        });
    });

    // Store references for save handler
    photosContainer._pendingPhotos = pendingPhotos;
    photosContainer._existingPhotosToKeep = existingPhotosToKeep;

    // Add Save button container
    const saveContainer = document.createElement('div');
    saveContainer.className = 'item-edit-save-container';
    saveContainer.innerHTML = `
        <button class="item-edit-save-btn">💾 Save Changes</button>
    `;

    // Insert save button before the Add to Plan button
    const actionsContainer = document.getElementById('modal-actions-container');
    if (actionsContainer) {
        actionsContainer.insertBefore(saveContainer, actionsContainer.firstChild);
    }

    // Save button handler
    const saveBtn = saveContainer.querySelector('.item-edit-save-btn');
    saveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        const newName = nameContainer.querySelector('.item-edit-name-input').value.trim();
        const newDesc = descContainer.querySelector('.item-edit-desc-input').value.trim();
        const newPrice = parseFloat(priceContainer.querySelector('.item-edit-price-input').value) || 0;

        if (!newName) {
            alert('Please enter an item name.');
            return;
        }

        // Track if description/name changed for AI regeneration purposes
        const descriptionChanged = newDesc !== originalDescription;
        const nameChanged = newName !== originalName;
        const detailsChanged = descriptionChanged || nameChanged;

        console.log('[AI IMAGE REGEN] Details change detection:', {
            nameChanged,
            descriptionChanged,
            detailsChanged,
            originalName,
            newName,
            originalDescription: originalDescription?.substring(0, 50) + '...',
            newDesc: newDesc?.substring(0, 50) + '...'
        });

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
            // Collect photos to save - combine existing kept photos with newly added ones
            const photosContainerEl = document.querySelector('.item-edit-photos-container');
            const allPhotos = [];
            if (photosContainerEl) {
                const existingKept = photosContainerEl._existingPhotosToKeep || [];
                const pending = photosContainerEl._pendingPhotos || [];

                // Process existing photos - migrate base64 to Cloudinary if needed
                const existingBase64ToMigrate = [];
                for (const img of existingKept) {
                    const url = img.url || img;
                    if (url.startsWith('http')) {
                        // Already a Cloudinary/HTTP URL, keep as-is
                        allPhotos.push({ url });
                    } else if (url.startsWith('data:')) {
                        // Old base64 format - need to migrate to Cloudinary
                        existingBase64ToMigrate.push({ url });
                    }
                }

                // Combine existing base64 that need migration with new pending photos
                const allToUpload = [...existingBase64ToMigrate, ...pending];

                // Upload all base64 images to Cloudinary
                let failedUploadCount = 0;
                if (allToUpload.length > 0) {
                    saveBtn.textContent = 'Uploading photos...';
                    log('Modal', `Uploading ${allToUpload.length} photos to Cloudinary...`);

                    for (const photo of allToUpload) {
                        const photoUrl = photo.url || photo;
                        // Check if it's a base64 data URL that needs uploading
                        if (photoUrl.startsWith('data:')) {
                            try {
                                // Debug logging for upload request
                                console.log('[Modal DEBUG] Preparing Cloudinary upload request');
                                console.log('[Modal DEBUG] Photo URL length:', photoUrl.length);
                                console.log('[Modal DEBUG] Photo URL starts with:', photoUrl.substring(0, 50));
                                console.log('[Modal DEBUG] Session ID:', state.session?.id || 'unsaved');
                                console.log('[Modal DEBUG] Record ID:', record.id);

                                const requestBody = {
                                    imageData: photoUrl,
                                    sessionId: state.session?.id || 'unsaved',
                                    itemId: record.id
                                };

                                console.log('[Modal DEBUG] Request body keys:', Object.keys(requestBody));
                                console.log('[Modal DEBUG] Request body imageData present:', !!requestBody.imageData);
                                console.log('[Modal DEBUG] Request body JSON length:', JSON.stringify(requestBody).length);

                                const uploadResponse = await fetch('/.netlify/functions/cloudinary-upload', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(requestBody)
                                });

                                console.log('[Modal DEBUG] Upload response status:', uploadResponse.status);
                                console.log('[Modal DEBUG] Upload response ok:', uploadResponse.ok);

                                if (uploadResponse.ok) {
                                    const uploadResult = await uploadResponse.json();
                                    console.log('[Modal DEBUG] Upload result:', uploadResult);
                                    if (uploadResult.secure_url) {
                                        allPhotos.push({ url: uploadResult.secure_url });
                                        log('Modal', `Uploaded photo to Cloudinary: ${uploadResult.secure_url}`);
                                    } else {
                                        console.warn('[Modal] Upload succeeded but no secure_url returned, result:', uploadResult);
                                        failedUploadCount++;
                                    }
                                } else {
                                    const errorText = await uploadResponse.text();
                                    console.error('[Modal DEBUG] Upload failed - status:', uploadResponse.status);
                                    console.error('[Modal DEBUG] Upload failed - response text:', errorText);
                                    let errorData = {};
                                    try {
                                        errorData = JSON.parse(errorText);
                                    } catch (e) {
                                        // Netlify returns "Internal Error. ID: xxx" for crashed functions
                                        if (errorText.startsWith('Internal Error')) {
                                            errorData = { error: 'Image upload service error. Please try again or use a smaller image.' };
                                        } else {
                                            errorData = { rawError: errorText };
                                        }
                                    }
                                    console.error('[Modal] Failed to upload photo to Cloudinary:', errorData);
                                    // DO NOT fall back to base64 - it will exceed Airtable field size limits
                                    // Skip this photo and notify user
                                    console.warn('[Modal] Skipping photo due to upload failure - base64 fallback disabled to prevent Airtable errors');
                                    failedUploadCount++;
                                }
                            } catch (uploadError) {
                                console.error('[Modal DEBUG] Upload exception:', uploadError);
                                console.error('[Modal] Error uploading photo:', uploadError);
                                // DO NOT fall back to base64 - it will exceed Airtable field size limits
                                console.warn('[Modal] Skipping photo due to upload error - base64 fallback disabled to prevent Airtable errors');
                                failedUploadCount++;
                            }
                        } else if (photoUrl.startsWith('http')) {
                            // Already a URL, keep it
                            allPhotos.push({ url: photoUrl });
                        }
                    }
                    saveBtn.textContent = 'Saving...';

                    // Notify user if any uploads failed
                    if (failedUploadCount > 0) {
                        const photoText = failedUploadCount === 1 ? 'photo' : 'photos';
                        alert(`${failedUploadCount} ${photoText} failed to upload. The item will be saved without ${failedUploadCount === 1 ? 'this photo' : 'these photos'}. Please try again.`);
                    }
                }
            }

            // ============================================================
            // AI IMAGE APPROXIMATION: Generate AI image if no photos provided
            // ============================================================
            let aiGeneratedImage = null;

            // DEBUG: Log the decision-making process for AI image generation
            console.log('[AI IMAGE DEBUG] === AI Image Generation Decision ===');
            console.log('[AI IMAGE DEBUG] allPhotos.length:', allPhotos.length);
            console.log('[AI IMAGE DEBUG] allPhotos contents:', JSON.stringify(allPhotos));
            console.log('[AI IMAGE DEBUG] record.id:', record.id);
            console.log('[AI IMAGE DEBUG] record.isManual:', record.isManual);
            console.log('[AI IMAGE DEBUG] photosContainerEl._existingPhotosToKeep:', photosContainerEl?._existingPhotosToKeep?.length || 0);
            console.log('[AI IMAGE DEBUG] photosContainerEl._pendingPhotos:', photosContainerEl?._pendingPhotos?.length || 0);

            if (allPhotos.length === 0) {
                console.log('[AI IMAGE DEBUG] No photos detected - checking if manual item');
                // Check if this is a manual item that could benefit from AI image
                const isManualItem = record.isManual === true ||
                                     record.id?.startsWith('manual-add-') ||
                                     record.id?.startsWith('manual-presentation-') ||
                                     record.id?.startsWith('ai-search-') ||
                                     record.id?.startsWith('ai-child-') ||
                                     record.id?.startsWith('ai-presentation-');

                console.log('[AI IMAGE DEBUG] isManualItem check:', {
                    'record.isManual': record.isManual,
                    'starts with manual-add-': record.id?.startsWith('manual-add-'),
                    'starts with manual-presentation-': record.id?.startsWith('manual-presentation-'),
                    'starts with ai-search-': record.id?.startsWith('ai-search-'),
                    'starts with ai-child-': record.id?.startsWith('ai-child-'),
                    'starts with ai-presentation-': record.id?.startsWith('ai-presentation-'),
                    'final isManualItem': isManualItem
                });

                if (isManualItem) {
                    log('Modal', `No photos provided for manual item "${newName}" - generating AI image approximation...`);
                    console.log('[AI IMAGE DEBUG] TRIGGERING AI image generation for:', newName);
                    saveBtn.textContent = 'Generating AI image...';

                    try {
                        const requestPayload = {
                            name: newName,
                            description: newDesc,
                            category: record.fields?.Category || '',
                            serviceType: record.fields?.ServiceType || record.fields?.['Service Type'] || '',
                            tags: record.fields?.['Media Tags'] || '',
                            itemId: record.id,
                            sessionId: state.session?.id || 'unsaved'
                        };
                        console.log('[AI IMAGE DEBUG] Request payload:', JSON.stringify(requestPayload));
                        console.log('[AI IMAGE DEBUG] Calling /.netlify/functions/generate-ai-image');

                        const aiImageResponse = await fetch('/.netlify/functions/generate-ai-image', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(requestPayload)
                        });

                        console.log('[AI IMAGE DEBUG] Response status:', aiImageResponse.status);
                        console.log('[AI IMAGE DEBUG] Response ok:', aiImageResponse.ok);

                        if (aiImageResponse.ok) {
                            const aiImageResult = await aiImageResponse.json();
                            console.log('[AI IMAGE DEBUG] Response JSON:', JSON.stringify(aiImageResult));
                            if (aiImageResult.success && aiImageResult.imageUrl) {
                                aiGeneratedImage = {
                                    url: aiImageResult.imageUrl,
                                    isAIGenerated: true,
                                    prompt: aiImageResult.prompt
                                };
                                allPhotos.push(aiGeneratedImage);
                                console.log('[AI IMAGE DEBUG] SUCCESS - AI image added to allPhotos:', aiGeneratedImage.url);
                                log('Modal', `AI image generated successfully: ${aiImageResult.imageUrl}`);
                            } else {
                                console.log('[AI IMAGE DEBUG] Response OK but missing success or imageUrl:', aiImageResult);
                            }
                        } else {
                            const errorText = await aiImageResponse.text();
                            console.warn('[AI IMAGE DEBUG] FAILED - AI image generation failed:', errorText);
                            console.warn('[Modal] AI image generation failed:', errorText);
                            // Continue without AI image - not a critical failure
                        }
                    } catch (aiError) {
                        console.warn('[AI IMAGE DEBUG] EXCEPTION:', aiError.message);
                        console.warn('[AI IMAGE DEBUG] EXCEPTION stack:', aiError.stack);
                        console.warn('[Modal] AI image generation error:', aiError.message);
                        // Continue without AI image - not a critical failure
                    }

                    saveBtn.textContent = 'Saving...';
                } else {
                    console.log('[AI IMAGE DEBUG] NOT a manual item - skipping AI image generation');
                }
            } else {
                console.log('[AI IMAGE DEBUG] Photos already exist - skipping initial AI image generation');

                // ============================================================
                // AI IMAGE REGENERATION: If description/name changed and item has AI image, regenerate it
                // ============================================================
                if (detailsChanged) {
                    // Check if current images include an AI-generated one
                    const hasExistingAIImage = allPhotos.some(p => p.isAIGenerated === true) ||
                                               record.fields._hasAIGeneratedImage === true;

                    console.log('[AI IMAGE REGEN] Checking for AI image regeneration:', {
                        detailsChanged,
                        hasExistingAIImage,
                        allPhotosCount: allPhotos.length
                    });

                    if (hasExistingAIImage) {
                        console.log('[AI IMAGE REGEN] TRIGGERING AI image regeneration due to description/name change');
                        saveBtn.textContent = 'Regenerating AI image...';

                        try {
                            const requestPayload = {
                                name: newName,
                                description: newDesc,
                                category: record.fields?.Category || '',
                                serviceType: record.fields?.ServiceType || record.fields?.['Service Type'] || '',
                                tags: record.fields?.['Media Tags'] || '',
                                itemId: record.id,
                                sessionId: state.session?.id || 'unsaved'
                            };
                            console.log('[AI IMAGE REGEN] Request payload:', JSON.stringify(requestPayload));

                            const aiImageResponse = await fetch('/.netlify/functions/generate-ai-image', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(requestPayload)
                            });

                            console.log('[AI IMAGE REGEN] Response status:', aiImageResponse.status);

                            if (aiImageResponse.ok) {
                                const aiImageResult = await aiImageResponse.json();
                                console.log('[AI IMAGE REGEN] Response body:', aiImageResult);
                                if (aiImageResult.success && aiImageResult.imageUrl) {
                                    const newAIImage = {
                                        url: aiImageResult.imageUrl,
                                        isAIGenerated: true,
                                        prompt: aiImageResult.prompt
                                    };

                                    // Replace the old AI image in allPhotos
                                    const aiImageIndex = allPhotos.findIndex(p => p.isAIGenerated === true);
                                    if (aiImageIndex !== -1) {
                                        allPhotos[aiImageIndex] = newAIImage;
                                        console.log('[AI IMAGE REGEN] Replaced existing AI image at index', aiImageIndex);
                                    } else {
                                        // Add as first image if no AI image found (edge case)
                                        allPhotos.unshift(newAIImage);
                                        console.log('[AI IMAGE REGEN] Added new AI image as first image');
                                    }

                                    aiGeneratedImage = newAIImage;
                                    console.log('[AI IMAGE REGEN] SUCCESS - New AI image:', newAIImage.url);
                                    log('Modal', `AI image regenerated for updated details: ${aiImageResult.imageUrl}`);
                                } else {
                                    console.log('[AI IMAGE REGEN] Response OK but missing success or imageUrl:', aiImageResult);
                                }
                            } else {
                                const errorText = await aiImageResponse.text();
                                console.warn('[AI IMAGE REGEN] FAILED:', errorText);
                            }
                        } catch (aiRegenError) {
                            console.warn('[AI IMAGE REGEN] EXCEPTION:', aiRegenError.message);
                            // Continue without regeneration - not a critical failure
                        }

                        saveBtn.textContent = 'Saving...';
                    }
                }
            }

            // ============================================================
            // INVALIDATE CACHED SOLUTIONS: Clear when description changes
            // ============================================================
            if (detailsChanged && record._generatedSolutions && record._generatedSolutions.length > 0) {
                console.log('[SOLUTIONS] Description/name changed - marking solutions as stale');
                // Store original description to track staleness
                record._solutionsGeneratedWith = {
                    name: originalName,
                    description: originalDescription
                };
                record._solutionsStale = true;
                log('Modal', `Solutions marked stale due to description/name change for: ${record.id}`);
            }

            // Update the record in state.records.all
            const recordIndex = state.records.all.findIndex(r => r.id === record.id);
            if (recordIndex !== -1) {
                state.records.all[recordIndex].fields.Name = newName;
                state.records.all[recordIndex].fields.Description = newDesc;
                state.records.all[recordIndex].fields.Price = newPrice;
                // Store custom images in a special field
                if (allPhotos.length > 0) {
                    state.records.all[recordIndex].fields._customImages = allPhotos;
                    // Track if any are AI-generated
                    if (aiGeneratedImage) {
                        state.records.all[recordIndex].fields._hasAIGeneratedImage = true;
                    }
                }
            }

            // Also update the record reference passed to the modal
            record.fields.Name = newName;
            record.fields.Description = newDesc;
            record.fields.Price = newPrice;
            if (allPhotos.length > 0) {
                record.fields._customImages = allPhotos;
                if (aiGeneratedImage) {
                    record.fields._hasAIGeneratedImage = true;
                }
            }

            // Trigger save to persist changes
            if (typeof triggerSave === 'function') {
                await triggerSave();
            }

            // Sync plan state across all views
            if (typeof syncPlanState === 'function') {
                syncPlanState('modal', 'itemUpdated', { recordId: record.id, itemName: newName });
            }

            // Update UI to show saved values
            nameEl.textContent = newName;
            descEl.textContent = newDesc;
            if (priceEl) {
                priceEl.innerHTML = newPrice > 0 ? `$${newPrice.toFixed(2)}` : 'Free';
            }

            // Update thumbnail strip if photos were added
            if (allPhotos.length > 0) {
                const modalThumbnailStrip = document.getElementById('modal-thumbnail-strip');
                const modalMainImage = document.getElementById('modal-main-image');
                if (modalThumbnailStrip && modalMainImage) {
                    // Get existing non-custom images from the strip
                    const existingThumbs = Array.from(modalThumbnailStrip.querySelectorAll('.thumbnail-img'));
                    const existingUrls = existingThumbs.map(t => {
                        const style = t.style.backgroundImage;
                        return style.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
                    });

                    // Add new custom images to the thumbnail strip
                    allPhotos.forEach((photo, idx) => {
                        const photoUrl = photo.url || photo;
                        const isAI = photo.isAIGenerated === true;
                        // Skip if already in strip
                        if (existingUrls.some(url => url.includes(photoUrl.substring(0, 50)))) return;

                        const thumb = document.createElement('div');
                        thumb.className = 'thumbnail-img custom-photo-thumb' + (isAI ? ' ai-generated-thumb' : '');
                        thumb.style.backgroundImage = `url('${photoUrl}')`;
                        thumb.title = isAI ? 'AI-generated image approximation' : 'Custom photo';
                        thumb.addEventListener('click', () => {
                            modalMainImage.style.backgroundImage = `url('${photoUrl}')`;
                            modalThumbnailStrip.querySelector('.active')?.classList.remove('active');
                            thumb.classList.add('active');
                            // Update the AI image indicator on the main image
                            updateModalAIImageIndicator(isAI);
                        });
                        modalThumbnailStrip.appendChild(thumb);
                    });

                    // If this is the first photo added, also update main image
                    if (allPhotos.length > 0 && existingThumbs.length === 0) {
                        const firstPhoto = allPhotos[0];
                        const firstPhotoUrl = firstPhoto.url || firstPhoto;
                        const isFirstAI = firstPhoto.isAIGenerated === true;
                        modalMainImage.style.backgroundImage = `url('${firstPhotoUrl}')`;
                        // Add AI indicator if the first image is AI-generated
                        updateModalAIImageIndicator(isFirstAI);
                    }

                    log('Modal', `Added ${allPhotos.length} custom photos to thumbnail strip${aiGeneratedImage ? ' (includes AI-generated)' : ''}`);
                }
            }

            // Exit edit mode
            disableItemEditMode(record, nameEl, descEl);

            // Reset the edit button state
            const editBtn = document.getElementById('modal-edit-item-btn');
            if (editBtn) {
                editBtn.innerHTML = '✏️ Edit Item';
                editBtn.classList.remove('editing');
            }

            // Update presentation view if visible
            if (typeof renderAllItems === 'function') {
                await renderAllItems();
            }

            // Update event plan section
            if (typeof ui !== 'undefined' && typeof ui.updateEventPlanSection === 'function') {
                ui.updateEventPlanSection();
            }

            log('Modal', `Saved changes for item: ${record.id} - "${newName}"`);

        } catch (error) {
            console.error('Failed to save item changes:', error);
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save Changes';
            alert('Failed to save changes. Please try again.');
        }
    });
}

/**
 * Disables edit mode for a manually added item and restores original display.
 * @param {Object} record - The item record
 * @param {HTMLElement} nameEl - The modal item name element
 * @param {HTMLElement} descEl - The modal item description element
 */
function disableItemEditMode(record, nameEl, descEl) {
    log('Modal', `Exiting edit mode for item: ${record.id}`);

    // Remove edit containers
    const editContainers = document.querySelectorAll('.item-edit-container, .item-edit-save-container');
    editContainers.forEach(container => container.remove());

    // Restore original elements
    nameEl.style.display = '';
    descEl.style.display = '';

    const priceEl = document.getElementById('modal-item-price');
    if (priceEl) {
        priceEl.style.display = '';
    }
}

/**
 * Build plan component cards with media collage
 * @param {HTMLElement} container - Container element to append cards to
 * @param {Array} componentRecords - Array of component data objects
 * @param {string} sessionId - ID of the linked session
 */
async function buildPlanComponentCards(container, componentRecords, sessionId) {
    // Import getRecordPrice for price calculation
    const { getRecordPrice } = await import('../utils.js');

    for (const componentData of componentRecords) {
        const record = componentData.record;
        const type = componentData.type;
        const history = componentData.history;

        // Fetch all images for this component (including AI-sourced items)
        let imageUrls = [];
        try {
            const { imageUrls: fetchedUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
            imageUrls = fetchedUrls || [];
        } catch (e) {
            console.warn('Failed to fetch images for component:', record.id, e);
        }
        if (imageUrls.length === 0) {
            imageUrls = [ui.getPlaceholderImage([])];
        }

        // Create the card element
        const card = document.createElement('div');
        card.className = `plan-component-card ${type}`;
        card.dataset.recordId = record.id;
        card.dataset.componentType = type;

        // Build media container with collage or single image
        const mediaContainer = document.createElement('div');
        mediaContainer.className = 'plan-component-media';

        if (imageUrls.length === 1) {
            // Single image display
            const optimizedUrl = imageUrls[0].includes('cloudinary')
                ? applyCloudinaryTransform(imageUrls[0], 'w_400,h_400,c_fill,f_auto,q_auto')
                : imageUrls[0];
            mediaContainer.innerHTML = `<img class="single-image" src="${optimizedUrl}" alt="${record.fields.Name || 'Component'}" loading="lazy">`;
        } else {
            // Collage display (up to 4 images)
            const collageClass = imageUrls.length === 2 ? 'two-images' : imageUrls.length === 3 ? 'three-images' : '';
            const collageDiv = document.createElement('div');
            collageDiv.className = `media-collage ${collageClass}`;

            imageUrls.slice(0, 4).forEach((url, idx) => {
                const optimizedUrl = url.includes('cloudinary')
                    ? applyCloudinaryTransform(url, 'w_200,h_200,c_fill,f_auto,q_auto')
                    : url;
                const img = document.createElement('img');
                img.className = 'collage-img';
                img.src = optimizedUrl;
                img.alt = `${record.fields.Name || 'Component'} image ${idx + 1}`;
                img.loading = 'lazy';
                collageDiv.appendChild(img);
            });

            mediaContainer.appendChild(collageDiv);

            // Show image count if more than 4
            if (imageUrls.length > 4) {
                const countBadge = document.createElement('span');
                countBadge.className = 'image-count';
                countBadge.textContent = imageUrls.length;
                mediaContainer.appendChild(countBadge);
            }
        }

        // Add status badge
        const badge = document.createElement('span');
        badge.className = `plan-component-badge ${type}`;
        badge.textContent = type === 'locked' ? '✅' : '💡';
        mediaContainer.appendChild(badge);

        card.appendChild(mediaContainer);

        // Build info section
        const infoDiv = document.createElement('div');
        infoDiv.className = 'plan-component-info';

        const nameEl = document.createElement('h4');
        nameEl.className = 'plan-component-name';
        nameEl.textContent = record.fields.Name || 'Untitled';
        nameEl.title = record.fields.Name || 'Untitled';
        infoDiv.appendChild(nameEl);

        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'plan-component-details';

        // Add quantity if > 1
        const quantity = history?.quantity || 1;
        if (quantity > 1) {
            const qtySpan = document.createElement('span');
            qtySpan.className = 'plan-component-quantity';
            qtySpan.textContent = `×${quantity}`;
            detailsDiv.appendChild(qtySpan);
        }

        // Add price
        const price = getRecordPrice(record, history?.selectedOptionIndex);
        if (price > 0) {
            const priceSpan = document.createElement('span');
            priceSpan.className = 'plan-component-price';
            priceSpan.textContent = `$${(price * quantity).toFixed(0)}`;
            detailsDiv.appendChild(priceSpan);
        }

        // Add note indicator if has note
        if (history?.note) {
            const noteSpan = document.createElement('span');
            noteSpan.className = 'plan-component-note-indicator';
            noteSpan.textContent = '📝';
            noteSpan.title = history.note;
            detailsDiv.appendChild(noteSpan);
        }

        infoDiv.appendChild(detailsDiv);
        card.appendChild(infoDiv);

        // Add click handler to open component detail modal
        card.addEventListener('click', () => {
            showComponentDetailModal(record, imageUrls, history, type, sessionId);
        });

        container.appendChild(card);
    }
}

/**
 * Show the component detail modal with image gallery, notes, and quantity controls
 */
async function showComponentDetailModal(record, imageUrls, history, componentType, sessionId) {
    const { getRecordPrice } = await import('../utils.js');

    // Remove any existing component detail modal
    const existingOverlay = document.querySelector('.component-detail-overlay');
    if (existingOverlay) existingOverlay.remove();

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'component-detail-overlay';

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'component-detail-modal';

    const quantity = history?.quantity || 1;
    const note = history?.note || '';
    const price = getRecordPrice(record, history?.selectedOptionIndex);

    // Header
    const header = document.createElement('div');
    header.className = 'component-detail-header';
    header.innerHTML = `
        <h3>${componentType === 'locked' ? '✅' : '💡'} ${record.fields.Name || 'Component Details'}</h3>
        <button class="component-detail-close" aria-label="Close">&times;</button>
    `;
    modal.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'component-detail-body';

    // Image gallery
    let currentImageIndex = 0;
    const galleryDiv = document.createElement('div');
    galleryDiv.className = 'component-detail-gallery';

    const mainImageUrl = imageUrls[0].includes('cloudinary')
        ? applyCloudinaryTransform(imageUrls[0], 'w_800,h_500,c_fill,f_auto,q_auto')
        : imageUrls[0];

    galleryDiv.innerHTML = `
        <div class="component-detail-main-image" style="background-image: url('${mainImageUrl}')"></div>
        <div class="component-detail-thumbnails"></div>
    `;

    const mainImageEl = galleryDiv.querySelector('.component-detail-main-image');
    const thumbsContainer = galleryDiv.querySelector('.component-detail-thumbnails');

    // Build thumbnails if multiple images
    if (imageUrls.length > 1) {
        imageUrls.forEach((url, idx) => {
            const thumbUrl = url.includes('cloudinary')
                ? applyCloudinaryTransform(url, 'w_120,h_120,c_fill,f_auto,q_auto')
                : url;
            const thumb = document.createElement('div');
            thumb.className = `component-detail-thumb ${idx === 0 ? 'active' : ''}`;
            thumb.style.backgroundImage = `url('${thumbUrl}')`;
            thumb.addEventListener('click', () => {
                currentImageIndex = idx;
                const fullUrl = url.includes('cloudinary')
                    ? applyCloudinaryTransform(url, 'w_800,h_500,c_fill,f_auto,q_auto')
                    : url;
                mainImageEl.style.backgroundImage = `url('${fullUrl}')`;
                thumbsContainer.querySelectorAll('.component-detail-thumb').forEach(t => t.classList.remove('active'));
                thumb.classList.add('active');
            });
            thumbsContainer.appendChild(thumb);
        });
    }

    body.appendChild(galleryDiv);

    // Info section
    const infoDiv = document.createElement('div');
    infoDiv.className = 'component-detail-info';
    infoDiv.innerHTML = `
        <h4 class="component-detail-name">${record.fields.Name || 'Untitled'}</h4>
        ${record.fields.Description ? `<p class="component-detail-description">${record.fields.Description}</p>` : ''}
    `;
    body.appendChild(infoDiv);

    // Quantity controls
    const quantityDiv = document.createElement('div');
    quantityDiv.className = 'component-detail-quantity';
    quantityDiv.innerHTML = `
        <label>Quantity:</label>
        <div class="quantity-selector">
            <button type="button" class="quantity-btn minus">−</button>
            <input type="number" class="quantity-input" value="${quantity}" min="1" step="1">
            <button type="button" class="quantity-btn plus">+</button>
        </div>
        <span class="quantity-price">${price > 0 ? `$${(price * quantity).toFixed(2)}` : 'Free'}</span>
    `;

    const qtyInput = quantityDiv.querySelector('.quantity-input');
    const priceDisplay = quantityDiv.querySelector('.quantity-price');
    const minusBtn = quantityDiv.querySelector('.minus');
    const plusBtn = quantityDiv.querySelector('.plus');

    const updatePrice = () => {
        const newQty = parseInt(qtyInput.value, 10) || 1;
        priceDisplay.textContent = price > 0 ? `$${(price * newQty).toFixed(2)}` : 'Free';
    };

    minusBtn.addEventListener('click', () => {
        const current = parseInt(qtyInput.value, 10) || 1;
        if (current > 1) {
            qtyInput.value = current - 1;
            updatePrice();
        }
    });

    plusBtn.addEventListener('click', () => {
        const current = parseInt(qtyInput.value, 10) || 1;
        qtyInput.value = current + 1;
        updatePrice();
    });

    qtyInput.addEventListener('change', updatePrice);
    qtyInput.addEventListener('input', updatePrice);

    body.appendChild(quantityDiv);

    // Notes section
    const notesDiv = document.createElement('div');
    notesDiv.className = 'component-detail-notes';
    notesDiv.innerHTML = `
        <label>Notes & Customizations:</label>
        <textarea placeholder="Add notes about customization, timing, or special requests...">${note}</textarea>
    `;
    body.appendChild(notesDiv);

    modal.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'component-detail-footer';
    footer.innerHTML = `
        <button class="component-view-btn">View Full Details</button>
        <button class="component-save-btn">Save Changes</button>
    `;
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Event handlers
    const closeModal = () => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
    };

    header.querySelector('.component-detail-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // View full details - open the main item detail modal
    footer.querySelector('.component-view-btn').addEventListener('click', () => {
        closeModal();
        // Close the parent modal first, then open item detail
        closeDetailModal();
        setTimeout(() => {
            showDetailModal(record);
        }, 300);
    });

    // Save changes - update session data (this would need to integrate with the session save logic)
    footer.querySelector('.component-save-btn').addEventListener('click', async () => {
        const newQty = parseInt(qtyInput.value, 10) || 1;
        const newNote = notesDiv.querySelector('textarea').value;

        log('Modal', `Saving component changes: quantity=${newQty}, note="${newNote}" for ${record.id}`);

        // Update the local state and trigger a session save
        // This dispatches an event that can be caught by the main app
        const event = new CustomEvent('componentUpdated', {
            detail: {
                recordId: record.id,
                sessionId: sessionId,
                componentType: componentType,
                quantity: newQty,
                note: newNote
            }
        });
        document.dispatchEvent(event);

        // Show feedback
        const saveBtn = footer.querySelector('.component-save-btn');
        saveBtn.textContent = 'Saved!';
        saveBtn.style.backgroundColor = '#28a745';

        setTimeout(() => {
            closeModal();
        }, 800);
    });

    // Escape key to close
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);

    // Animate in
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });
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

    // Fetch images for all component records (including AI-sourced items)
    const componentImages = [];
    for (const componentData of componentRecords) {
        const record = componentData.record;
        let imageUrl = ui.getPlaceholderImage([]);

        try {
            const { imageUrls: fetchedUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
            if (fetchedUrls && fetchedUrls.length > 0) {
                imageUrl = fetchedUrls[0];
            }
        } catch (e) {
            console.warn('Failed to fetch image for component:', record.id, e);
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
            ? applyCloudinaryTransform(current.imageUrl, 'w_800,h_600,c_fill,f_auto,q_auto')
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
        const isGhost = !getRecordById(record.id);

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

// Guard to prevent concurrent modal rendering
let isModalRendering = false;

export async function showDetailModal(record, startPhotoIndex = 0, fromGroup = null) {
    console.log('[MODAL DEBUG] ========== showDetailModal called ==========');
    console.log('[MODAL DEBUG] record:', record?.id, record?.fields?.Name);
    console.log('[MODAL DEBUG] modalOverlay element:', !!modalOverlay);
    console.log('[MODAL DEBUG] isModalRendering:', isModalRendering);

    // Prevent concurrent modal renders that could cause duplicate content
    if (isModalRendering) {
        log('Modal', 'Modal is already rendering, skipping duplicate call');
        console.log('[MODAL DEBUG] BLOCKED: Modal is already rendering, skipping.');
        return;
    }
    isModalRendering = true;

    // DEBUG: Comprehensive entry point logging for direct modal URL debugging
    const deferredCssLink = document.querySelector('link[href*="deferred.css"]');
    const deferredCssLoaded = deferredCssLink && deferredCssLink.rel === 'stylesheet';
    const isDirectUrlAccess = !document.referrer || document.referrer === '' ||
                              (new URL(document.referrer).pathname !== window.location.pathname);

    console.log('[MODAL-DEBUG] showDetailModal entry:', {
        recordId: record.id,
        recordName: record.fields?.Name,
        timestamp: performance.now().toFixed(2) + 'ms',
        isDirectUrlAccess,
        documentReferrer: document.referrer || 'none',
        // CSS Loading State
        deferredCssRel: deferredCssLink ? deferredCssLink.rel : 'not found',
        deferredCssLoaded,
        totalStylesheets: document.styleSheets.length,
        // DOM State
        documentReadyState: document.readyState,
        modalOverlayExists: !!document.getElementById('detail-modal-overlay'),
        modalOverlayDisplay: modalOverlay ? window.getComputedStyle(modalOverlay).display : 'N/A',
        bodyClasses: document.body.className
    });

    // If CSS not loaded yet, add a note (main.js now handles waiting for CSS on direct URL access)
    if (!deferredCssLoaded) {
        console.log('[MODAL-DEBUG] Note: Deferred CSS not yet loaded. main.js should have waited for it on direct URL access.');
    }

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
    } else {
        // FALLBACK: For Events that were published before LinkedSession was added,
        // try to find the session by searching for which session has this event in its LinkedItem field
        if (record.fields['Item Type'] === 'Event') {
            linkedSession = await api.fetchSessionByLinkedItem(record.id);
            if (linkedSession) {
                linkedSessionId = linkedSession.id;
            } else {
                // NEW: Check if this event item is contained as a component in another plan
                // This handles the case where an event item was added to a plan via "Add to Plan"
                linkedSession = await api.fetchSessionContainingItem(record.id, state.ui.activeShopId);
                if (linkedSession) {
                    linkedSessionId = linkedSession.id;
                    itemIsContainedInSession = true; // This item is a component, not the parent event
                    log('Modal', `Event item found as component in session ${linkedSessionId}`);
                }
            }
        }
    }

    const isLocked = state.cart.lockedItems.has(record.id);
    modalOverlay.dataset.mode = isLocked ? 'edit-locked' : 'edit-favorite';

    const itemState = isLocked ? state.cart.lockedItems.get(record.id) : ui.getItemState(record.id);

    // Check if event is free ($0 price)
    const currentPrice = getRecordPrice(record, itemState.selectedOptionIndex);
    const isFreeEvent = currentPrice === 0;

    // Check if this is a package - packages have their own button handling later
    const isPackageItem = record.fields['Item Type'] === 'Package';

    if (addToPlanBtn) {
        if (isFreeEvent && !isPackageItem) {
            // Hide Add to Plan button for free events (but not packages, which use dynamic pricing)
            addToPlanBtn.style.display = 'none';
        } else {
            addToPlanBtn.style.display = '';
            addToPlanBtn.textContent = isLocked ? 'Update Plan' : 'Add to Plan';
            addToPlanBtn.dataset.tooltip = isLocked ? 'Update plan with changes' : 'Add to plan';
        }
    }

    // Setup Price Action Row buttons (Rapid Pay + Chip In) next to price
    const rapidPayBtn = document.getElementById('modal-rapid-pay-btn');
    const chipInBtn = document.getElementById('modal-chip-in-btn');
    const priceActionsContainer = document.getElementById('modal-price-actions');
    const donationMeter = document.getElementById('modal-donation-meter');

    const paymentOptions = getStorePaymentOptions();
    const hasPaymentOptions = paymentOptions && Object.keys(paymentOptions).length > 0;

    if (hasPaymentOptions && !isPackageItem) {
        // Show price action buttons
        if (priceActionsContainer) priceActionsContainer.classList.remove('hidden');

        // Calculate initial amount for rapid pay
        const initialPrice = getRecordPrice(record, itemState.selectedOptionIndex);
        const initialQuantity = itemState.quantity || 1;
        const initialAmount = initialPrice * initialQuantity;

        // Update Rapid Pay button label dynamically
        const updateRapidPayLabel = () => {
            if (!rapidPayBtn) return;
            const quantityInput = document.querySelector('#modal-quantity-selector .quantity-input');
            const currentQuantity = quantityInput ? parseInt(quantityInput.value, 10) || 1 : 1;
            const optionRadios = document.querySelectorAll('#modal-options-container input[type="radio"]:checked');
            let selectedOptionIndex = itemState.selectedOptionIndex || 0;
            if (optionRadios.length > 0) {
                const selectedValue = optionRadios[0].value;
                selectedOptionIndex = parseInt(selectedValue, 10) || 0;
            }
            const currentPrice = getRecordPrice(record, selectedOptionIndex);
            const currentAmount = currentPrice * currentQuantity;
            const labelEl = rapidPayBtn.querySelector('.price-action-label');
            if (labelEl) {
                labelEl.textContent = currentAmount > 0 ? `Rapid Pay` : 'Rapid Pay';
            }
        };

        // Store update function for quantity/option change handlers
        if (rapidPayBtn) {
            rapidPayBtn._updateText = updateRapidPayLabel;
        }

        // Rapid Pay click - opens quick pay modal
        if (rapidPayBtn) {
            // Remove old listeners by cloning
            const newRapidPayBtn = rapidPayBtn.cloneNode(true);
            rapidPayBtn.parentNode.replaceChild(newRapidPayBtn, rapidPayBtn);
            newRapidPayBtn._updateText = updateRapidPayLabel;

            newRapidPayBtn.addEventListener('click', () => {
                const quantityInput = document.querySelector('#modal-quantity-selector .quantity-input');
                const quantity = quantityInput ? parseInt(quantityInput.value, 10) || 1 : 1;
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
        }

        // Chip In click - toggles donation meter
        if (chipInBtn) {
            const newChipInBtn = chipInBtn.cloneNode(true);
            chipInBtn.parentNode.replaceChild(newChipInBtn, chipInBtn);

            newChipInBtn.addEventListener('click', () => {
                if (donationMeter) {
                    const isVisible = donationMeter.style.display !== 'none';
                    if (isVisible) {
                        donationMeter.style.display = 'none';
                        newChipInBtn.classList.remove('active');
                    } else {
                        donationMeter.style.display = 'block';
                        newChipInBtn.classList.add('active');
                        setupDonationMeter(record, paymentOptions, itemState);
                    }
                }
            });
        }
    } else {
        // No payment options or is a package - hide action buttons
        if (priceActionsContainer) priceActionsContainer.classList.add('hidden');
        if (donationMeter) donationMeter.style.display = 'none';
    }

    // Fetch images for all items (including AI-sourced items)
    let imageUrls = [];
    let imageSource = null; // Track where the image came from for AI indicator
    try {
        console.log('[AI IMAGE DEBUG Modal] About to fetch images for modal record:', {
            recordId: record?.id,
            recordName: record?.fields?.Name,
            isAI: record?.id?.startsWith('ai-') || record?.isAI
        });
        const { imageUrls: fetchedUrls, status } = await api.fetchImagesForRecord(record, state.records.all, new Map());
        imageUrls = fetchedUrls || [];
        imageSource = status;
        console.log('[AI IMAGE DEBUG Modal] fetchImagesForRecord returned:', {
            recordId: record?.id,
            imageUrlsCount: imageUrls.length,
            imageSource: imageSource,
            firstImageUrl: imageUrls[0]?.substring(0, 80)
        });
    } catch (e) {
        console.warn('Failed to fetch images for record:', record.id, e);
    }

    // ============================================================
    // AUTO AI IMAGE GENERATION: For manual items with only placeholders
    // ============================================================
    // Track records that have already attempted AI generation to prevent repeated attempts
    if (!window._aiImageGenerationAttempted) {
        window._aiImageGenerationAttempted = new Set();
    }
    if (!window._aiImageGenerationInProgress) {
        window._aiImageGenerationInProgress = new Set();
    }

    const isManualItemForAutoGen = record.isManual === true ||
                                    record.id?.startsWith('manual-add-') ||
                                    record.id?.startsWith('manual-presentation-') ||
                                    record.id?.startsWith('solution-');
    const isAIDiscoveryForAutoGen = record.id?.startsWith('ai-search-') ||
                                     record.id?.startsWith('ai-child-') ||
                                     record.id?.startsWith('ai-presentation-');
    const needsAutoGen = isManualItemForAutoGen || isAIDiscoveryForAutoGen;
    const hasOnlyPlaceholder = imageSource === 'placeholder' || imageSource === 'using_placeholder' || imageSource === 'ai_approximation';
    const hasNoCustomImages = !record.fields?._customImages || record.fields._customImages.length === 0;
    const alreadyAttempted = window._aiImageGenerationAttempted.has(record.id);
    const inProgress = window._aiImageGenerationInProgress.has(record.id);

    console.log('[AI IMAGE AUTO-GEN] Checking if auto-generation needed:', {
        recordId: record.id,
        isManualItemForAutoGen,
        isAIDiscoveryForAutoGen,
        needsAutoGen,
        hasOnlyPlaceholder,
        hasNoCustomImages,
        alreadyAttempted,
        inProgress,
        imageSource,
        _customImages: record.fields?._customImages
    });

    if (needsAutoGen && hasOnlyPlaceholder && hasNoCustomImages && !alreadyAttempted && !inProgress) {
        console.log('[AI IMAGE AUTO-GEN] TRIGGERING auto AI image generation for:', record.fields?.Name);

        // Mark as in-progress to prevent duplicate attempts
        window._aiImageGenerationInProgress.add(record.id);

        try {
            const requestPayload = {
                name: record.fields?.Name || 'Unnamed Item',
                description: record.fields?.Description || '',
                category: record.fields?.Category || '',
                serviceType: record.fields?.ServiceType || record.fields?.['Service Type'] || '',
                tags: record.fields?.['Media Tags'] || '',
                itemId: record.id,
                sessionId: state.session?.id || 'unsaved'
            };

            console.log('[AI IMAGE AUTO-GEN] Request payload:', JSON.stringify(requestPayload));

            const aiImageResponse = await fetch('/.netlify/functions/generate-ai-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestPayload)
            });

            console.log('[AI IMAGE AUTO-GEN] Response status:', aiImageResponse.status);

            if (aiImageResponse.ok) {
                const aiImageResult = await aiImageResponse.json();
                console.log('[AI IMAGE AUTO-GEN] Response JSON:', JSON.stringify(aiImageResult));

                if (aiImageResult.success && aiImageResult.imageUrl) {
                    // Update imageUrls with the AI-generated image
                    imageUrls = [aiImageResult.imageUrl];
                    imageSource = 'ai_generated';

                    // Store the AI image in the record so it persists
                    const aiGeneratedImage = {
                        url: aiImageResult.imageUrl,
                        isAIGenerated: true,
                        prompt: aiImageResult.prompt
                    };

                    // Update record in state
                    const recordIndex = state.records.all.findIndex(r => r.id === record.id);
                    if (recordIndex !== -1) {
                        state.records.all[recordIndex].fields._customImages = [aiGeneratedImage];
                        state.records.all[recordIndex].fields._hasAIGeneratedImage = true;
                    }
                    record.fields._customImages = [aiGeneratedImage];
                    record.fields._hasAIGeneratedImage = true;

                    // Trigger save to persist the AI image
                    if (typeof triggerSave === 'function') {
                        triggerSave();
                    }

                    console.log('[AI IMAGE AUTO-GEN] SUCCESS - AI image stored:', aiImageResult.imageUrl);
                    log('Modal', `AI image auto-generated for ${record.fields?.Name}: ${aiImageResult.imageUrl}`);
                } else {
                    console.log('[AI IMAGE AUTO-GEN] Response OK but missing success or imageUrl:', aiImageResult);
                    // Mark as attempted even if no image returned (to prevent retry loops)
                    window._aiImageGenerationAttempted.add(record.id);
                }
            } else {
                const errorText = await aiImageResponse.text();
                console.warn('[AI IMAGE AUTO-GEN] FAILED:', errorText);
                // Mark as attempted to prevent retry on failure
                window._aiImageGenerationAttempted.add(record.id);
            }
        } catch (aiError) {
            console.warn('[AI IMAGE AUTO-GEN] EXCEPTION:', aiError.message);
            console.warn('[AI IMAGE AUTO-GEN] Stack:', aiError.stack);
            // Mark as attempted to prevent retry on exception
            window._aiImageGenerationAttempted.add(record.id);
        } finally {
            // Always remove from in-progress when done
            window._aiImageGenerationInProgress.delete(record.id);
        }
    }

    // Merge comment-uploaded images from presentation view's itemImagesCache
    // These are images uploaded via comments that aren't stored in the record
    if (typeof window.itemImagesCache !== 'undefined' && window.itemImagesCache.has(record.id)) {
        const cachedImages = window.itemImagesCache.get(record.id);
        if (cachedImages && cachedImages.images && Array.isArray(cachedImages.images)) {
            // Filter out duplicates and add comment images
            const existingUrls = new Set(imageUrls.map(url => url.toLowerCase()));
            const commentImages = cachedImages.images.filter(url => !existingUrls.has(url.toLowerCase()));
            if (commentImages.length > 0) {
                console.log('[Modal DEBUG] Adding comment-uploaded images:', {
                    recordId: record.id,
                    commentImageCount: commentImages.length,
                    existingImageCount: imageUrls.length
                });
                imageUrls = [...imageUrls, ...commentImages];
                // If we added comment images, the source is now mixed
                if (imageSource === 'ai_approximation' || imageSource === 'placeholder') {
                    imageSource = 'mixed';
                }
            }
        }
    }

    if (imageUrls.length === 0) {
        imageUrls = [ui.getPlaceholderImage([])];
    }

    // Sync imageUrls back to itemImagesCache so the presentation view stays consistent
    // This ensures both views have the same images in the same order
    if (typeof window.itemImagesCache !== 'undefined') {
        const cachedImages = window.itemImagesCache.get(record.id);
        if (cachedImages) {
            // Update the cache with the merged image list
            cachedImages.images = [...imageUrls];
        } else {
            // Initialize the cache if it doesn't exist
            window.itemImagesCache.set(record.id, { images: [...imageUrls], currentIndex: 0 });
        }
    }

    // Check if this item is a hybrid merge target — use AI-generated name and description
    let displayName = record.fields.Name || 'Untitled';
    let displayDescription = record.fields.Description || '';
    const combinedEntry = state.session?.combinedItems?.get(record.id);
    if (combinedEntry && !(combinedEntry instanceof Set) && combinedEntry.hybridData) {
        if (combinedEntry.hybridData.hybridName) {
            displayName = combinedEntry.hybridData.hybridName;
        }
        if (combinedEntry.hybridData.hybridDescription) {
            displayDescription = combinedEntry.hybridData.hybridDescription;
        }
    }

    modalItemName.textContent = displayName;
    modalItemDescription.textContent = displayDescription;

    // Show "Combined from" indicator for hybrid merged items
    const existingMergeInfo = document.querySelector('.modal-merge-info');
    if (existingMergeInfo) existingMergeInfo.remove();

    if (combinedEntry && !(combinedEntry instanceof Set) && combinedEntry.sources) {
        const sourceIds = combinedEntry.sources instanceof Set
            ? Array.from(combinedEntry.sources)
            : (Array.isArray(combinedEntry.sources) ? combinedEntry.sources : []);

        if (sourceIds.length > 0) {
            const sourceNames = sourceIds.map(sourceId => {
                const sourceRecord = state.records?.all?.find(r => r.id === sourceId);
                return sourceRecord?.fields?.Name || 'Item';
            });
            // Include the target item's original name
            const targetOriginalName = record.fields.Name || 'Item';
            const allNames = [targetOriginalName, ...sourceNames];

            const mergeInfoEl = document.createElement('div');
            mergeInfoEl.className = 'modal-merge-info';
            mergeInfoEl.innerHTML = `
                <span class="merge-info-icon">✨</span>
                <span class="merge-info-text">Combined from: ${allNames.join(' + ')}</span>
            `;
            modalItemDescription.parentNode.insertBefore(mergeInfoEl, modalItemDescription.nextSibling);
        }
    }

    // Display AI confidence badge for AI-parsed items
    const isAIRecord = record?.id?.startsWith('ai-child-') || record?.id?.startsWith('ai-search-') || record?.id?.startsWith('ai-presentation-') || record?.isAI === true;
    console.log('[DEBUG Modal] showDetailModal called:', {
        recordId: record?.id,
        isAIRecord,
        fields_aiConfidence: record?.fields?.['_aiConfidence'],
        record_aiConfidence: record?._aiConfidence,
        record_isAI: record?.isAI
    });

    const existingConfidenceBadge = document.querySelector('.ai-confidence-badge');
    if (existingConfidenceBadge) existingConfidenceBadge.remove();

    // Also remove any existing confidence text indicator
    const existingConfidenceText = document.querySelector('.ai-confidence-text');
    if (existingConfidenceText) existingConfidenceText.remove();

    // Get the modal container to apply confidence styling to the entire modal
    const modalContainer = document.getElementById('detail-modal-overlay');

    // Remove previous confidence classes from modal
    if (modalContainer) {
        modalContainer.classList.remove('modal-confidence-pencil', 'modal-confidence-pen', 'modal-confidence-typed', 'modal-confidence-premium');
    }

    if (isAIRecord) {
        const confidence = record.fields?.['_aiConfidence'] ?? record._aiConfidence ?? null;
        console.log('[DEBUG Modal] AI record confidence:', { confidence, type: typeof confidence });

        // Determine confidence style tier
        let confidenceStyle, confidenceTooltip;

        if (confidence === null || confidence === undefined) {
            confidenceStyle = 'pencil';
            confidenceTooltip = 'Draft information - please verify all details';
        } else if (confidence < 0.5) {
            confidenceStyle = 'pencil';
            confidenceTooltip = `${Math.round(confidence * 100)}% confident - Sketchy draft, please verify details`;
        } else if (confidence < 0.75) {
            confidenceStyle = 'pen';
            confidenceTooltip = `${Math.round(confidence * 100)}% confident - Handwritten quality, some details may need verification`;
        } else if (confidence < 0.95) {
            confidenceStyle = 'typed';
            confidenceTooltip = `${Math.round(confidence * 100)}% confident - Typed quality, reliable information`;
        } else {
            confidenceStyle = 'premium';
            confidenceTooltip = `${Math.round(confidence * 100)}% confident - Premium verified information`;
        }

        console.log('[DEBUG Modal] Applying confidence style to modal:', { confidenceStyle });

        // Apply confidence class to the entire modal — this drives visual styling
        // of the title, description, and background (no explicit text label needed)
        if (modalContainer) {
            modalContainer.classList.add(`modal-confidence-${confidenceStyle}`);
        }

        // Set tooltip on the item name so users can hover to see confidence info
        if (modalItemName) {
            modalItemName.title = confidenceTooltip;
        }
    }

    // Display solution badge for AI-generated solution items
    const existingSolutionBadge = document.querySelector('.solution-type-badge');
    if (existingSolutionBadge) existingSolutionBadge.remove();

    if (record.isSolution && record.solutionData) {
        const solutionBadge = document.createElement('div');
        solutionBadge.className = 'solution-type-badge';

        // Use confidence from solution data
        const confidence = record.solutionData.confidence;
        const confidenceColors = {
            high: '#28a745',
            medium: '#ffc107',
            low: '#6c757d'
        };
        const bgColor = confidenceColors[confidence] || confidenceColors.medium;

        solutionBadge.innerHTML = `<span class="solution-badge-dot" style="background: ${bgColor};"></span> AI Solution`;
        solutionBadge.title = `${confidence ? confidence.charAt(0).toUpperCase() + confidence.slice(1) : 'Medium'} confidence - This is an AI-suggested solution for your concept`;

        // Insert badge after the item name (or after AI badge if present)
        const insertAfter = document.querySelector('.ai-confidence-badge') || modalItemName;
        insertAfter.parentNode.insertBefore(solutionBadge, insertAfter.nextSibling);
    }

    // --- SEO: Update page title, meta description, schema markup, OG tags, etc. ---
    const itemName = record.fields.Name || 'Untitled';
    const seoTitle = `${itemName} | WTFun`;
    let seoDescription = record.fields.Description || '';

    // Extract AI-generated tags for SEO (keywords, URL slug, etc.)
    let seoTags = [];
    const aiProfileString = record.fields.AI_Profile || record.fields.Rankings;
    if (aiProfileString) {
        try {
            const aiProfile = JSON.parse(aiProfileString);
            seoTags = aiProfile.Tags || aiProfile.SearchTerms || [];
        } catch (e) {
            // Ignore parsing errors
        }
    }

    // Generate description from AI tags if none exists
    if (!seoDescription && seoTags.length > 0) {
        seoDescription = `Book ${itemName}. Features: ${seoTags.join(', ')}.`;
    }

    // Fallback description if still empty
    if (!seoDescription) {
        seoDescription = `Check out ${itemName} on WTFun.`;
    }

    // Truncate to 160 characters for SEO best practices
    if (seoDescription.length > 160) {
        seoDescription = seoDescription.substring(0, 157) + '...';
    }

    // Get image URL for social sharing
    let seoImageUrl = '';
    if (imageUrls.length > 0 && !imageUrls[0].includes('placeholder')) {
        seoImageUrl = imageUrls[0];
    }

    // Use comprehensive SEO function with AI tags exposed
    updateFullSeoMetadata(record, seoTitle, seoDescription, seoTags, seoImageUrl);
    updateSchema(record);
    // --- END SEO ---

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
        // Show event info for ALL users (both registered and non-registered) - date/time is important info
        const userIsAuthenticatedForRsvp = state.session.user.isAuthenticated;
        if (!hasChildEventOptions) {
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

            // Remove any existing event info section before creating new one
            const existingEventInfo = document.querySelector('.event-info-section');
            if (existingEventInfo) existingEventInfo.remove();

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

        // Calendar export buttons removed for published events - not needed for viewing
        }

        // RSVP list section - only shown for authenticated users (moved outside the isUserRegistered check)
        if (!hasChildEventOptions && userIsAuthenticatedForRsvp && (rsvpYes.length > 0 || rsvpMaybe.length > 0 || rsvpNo.length > 0)) {
            // Remove any existing RSVP list section before creating new one
            const existingRsvpList = document.querySelector('.rsvp-list-section');
            if (existingRsvpList) existingRsvpList.remove();

            const rsvpListSection = document.createElement('div');
            rsvpListSection.className = 'rsvp-list-section';

            // Initial HTML with loading placeholders
            let rsvpHTML = '<div class="rsvp-list-header"><strong>RSVPs</strong></div>';

            if (rsvpYes.length > 0) {
                rsvpHTML += `<div class="rsvp-list-group">
                    <div class="rsvp-list-label">Going (${rsvpYes.length})</div>
                    <div class="rsvp-list-items" data-rsvp-type="yes">Loading...</div>
                </div>`;
            }

            if (rsvpMaybe.length > 0) {
                rsvpHTML += `<div class="rsvp-list-group">
                    <div class="rsvp-list-label">Maybe (${rsvpMaybe.length})</div>
                    <div class="rsvp-list-items" data-rsvp-type="maybe">Loading...</div>
                </div>`;
            }

            if (rsvpNo.length > 0) {
                rsvpHTML += `<div class="rsvp-list-group">
                    <div class="rsvp-list-label">Can't Go (${rsvpNo.length})</div>
                    <div class="rsvp-list-items" data-rsvp-type="no">Loading...</div>
                </div>`;
            }

            rsvpListSection.innerHTML = rsvpHTML;
            modalItemDescription.parentElement.insertBefore(rsvpListSection, modalItemDescription);

            // Fetch user names asynchronously and update the display
            const allUserIds = [...rsvpYes, ...rsvpMaybe, ...rsvpNo];
            api.fetchUserNamesByIds(allUserIds).then(userNameMap => {
                // Helper to format names list
                const formatNames = (userIds) => {
                    if (userIds.length === 0) return '';
                    const names = userIds.map(id => userNameMap.get(id) || 'Guest');
                    return names.join(', ');
                };

                // Update each RSVP group with actual names
                const yesEl = rsvpListSection.querySelector('[data-rsvp-type="yes"]');
                if (yesEl) yesEl.textContent = formatNames(rsvpYes) || 'Guest';

                const maybeEl = rsvpListSection.querySelector('[data-rsvp-type="maybe"]');
                if (maybeEl) maybeEl.textContent = formatNames(rsvpMaybe) || 'Guest';

                const noEl = rsvpListSection.querySelector('[data-rsvp-type="no"]');
                if (noEl) noEl.textContent = formatNames(rsvpNo) || 'Guest';
            }).catch(err => {
                console.error('[Modal] Error fetching RSVP user names:', err);
                // Fallback to generic text on error
                const items = rsvpListSection.querySelectorAll('.rsvp-list-items');
                items.forEach(el => el.textContent = 'Guests');
            });
        }
    }

    // Display session components if this is a published session/event
    // Skip for registered event users - they don't need to see plan components
    // BUT always show for users with publish access so they can manage the plan
    const isEventType = record.fields['Item Type'] === 'Event';
    const eventRsvpYes = record.fields.RSVPs || [];
    const eventRsvpMaybe = record.fields.RSVPMaybe || [];
    const eventRsvpNo = record.fields.RSVPNo || [];
    const currentUserId = state.session.user.id;
    const isCurrentUserRegistered = eventRsvpYes.includes(currentUserId) || eventRsvpMaybe.includes(currentUserId) || eventRsvpNo.includes(currentUserId);
    const userHasPublishAccessForComponents = api.userHasPublishPermission();

    if (linkedSession && linkedSession.fields && (userHasPublishAccessForComponents || !(isEventType && isCurrentUserRegistered))) {
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
        // Use Sets for O(1) lookups instead of O(n) .some() calls
        const allComponentIds = [...lockedComponentIds, ...ideaComponentIds];
        const recordIdSet = new Set(state.records.all.map(r => r.id));
        const archiveIdSet = state.records.archive ? new Set(state.records.archive.map(r => r.id)) : null;
        const missingItemIds = allComponentIds.filter(id =>
            !recordIdSet.has(id) &&
            (!archiveIdSet || !archiveIdSet.has(id)) &&
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
            // Build Maps for O(1) lookups instead of repeated O(n) .find() calls
            const recordMap = new Map(state.records.all.map(r => [r.id, r]));
            const archiveMap = state.records.archive ? new Map(state.records.archive.map(r => [r.id, r])) : null;
            const lockedHistoryMap = new Map(lockedInHistory.map(item => [item.id, item]));
            const ideasHistoryMap = new Map(ideasHistory.map(item => [item.id, item]));

            const allComponentRecords = [];
            const componentHistoryMap = new Map();

            // Process locked items
            for (const componentId of lockedComponentIds) {
                const componentRecord = recordMap.get(componentId) || (archiveMap && archiveMap.get(componentId));
                if (componentRecord) {
                    const history = lockedHistoryMap.get(componentId);
                    allComponentRecords.push({
                        record: componentRecord,
                        type: 'locked',
                        history
                    });
                    componentHistoryMap.set(componentId, history);
                }
            }

            // Process idea items
            for (const ideaId of ideaComponentIds) {
                const ideaRecord = recordMap.get(ideaId) || (archiveMap && archiveMap.get(ideaId));
                if (ideaRecord) {
                    const history = ideasHistoryMap.get(ideaId);
                    allComponentRecords.push({
                        record: ideaRecord,
                        type: 'idea',
                        history
                    });
                    componentHistoryMap.set(ideaId, history);
                }
            }

            // Remove any existing session components section before creating new one
            const existingSessionComponents = document.querySelector('.session-components-section');
            if (existingSessionComponents) existingSessionComponents.remove();

            // Create the main session components section
            const sessionComponentsSection = document.createElement('div');
            sessionComponentsSection.className = 'session-components-section';
            sessionComponentsSection.style.cssText = 'margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 8px;';

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
            sessionComponentsSection.innerHTML = sectionHeader;

            // Create scrollable carousel container for component cards
            if (allComponentRecords.length > 0) {
                const carouselContainer = document.createElement('div');
                carouselContainer.className = 'plan-components-carousel';

                // Build cards for each component (async)
                await buildPlanComponentCards(carouselContainer, allComponentRecords, linkedSessionId);

                sessionComponentsSection.appendChild(carouselContainer);
            }

            // Add component summary counts
            const summaryDiv = document.createElement('div');
            summaryDiv.style.cssText = 'display: flex; gap: 15px; margin-top: 12px; font-size: 0.85em;';
            if (lockedComponentIds.length > 0) {
                summaryDiv.innerHTML += `<span style="color: #28a745;"><strong>✅ ${lockedComponentIds.length}</strong> Locked In</span>`;
            }
            if (ideaComponentIds.length > 0) {
                summaryDiv.innerHTML += `<span style="color: #856404;"><strong>💡 ${ideaComponentIds.length}</strong> Ideas</span>`;
            }
            if (summaryDiv.innerHTML) {
                sessionComponentsSection.appendChild(summaryDiv);
            }

            modalItemDescription.parentElement.insertBefore(sessionComponentsSection, modalItemDescription);

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
                // Remove any existing edit plan section before creating new one
                const existingEditPlanSection = document.querySelector('.edit-plan-section');
                if (existingEditPlanSection) existingEditPlanSection.remove();

                const planName = linkedSession.fields.Name || 'Plan';
                const editPlanSection = document.createElement('div');
                editPlanSection.className = 'edit-plan-section';
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

        // Get rankings data - could be a JSON string (from Airtable) or an object (from AI-generated items)
        const rankingsData = record.fields['AI_Profile'] || record.fields['Rankings'];

        if (rankingsData) {
            try {
                // Handle both JSON strings and objects (AI-generated items pass objects directly)
                const rankingsObject = typeof rankingsData === 'string' ? JSON.parse(rankingsData) : rankingsData;

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

        // Add Variations Parsing Tool for authorized users (publish permission)
        // Now available for all item types: real catalog items, AI-parsed items, and custom items
        const userHasPublishPermission = api.userHasPublishPermission();
        const isRealRecord = !record.id.startsWith('custom-') && !record.id.startsWith('ai-search-') && !record.id.startsWith('ai-child-') && !record.id.startsWith('ai-presentation-');

        if (userHasPublishPermission) {
            const variationsToolContainer = document.createElement('div');
            variationsToolContainer.className = 'variations-tool-container detail-item';
            variationsToolContainer.style.gridColumn = '1 / -1';

            const currentOptionsString = record.fields[CONSTANTS.FIELD_NAMES.OPTIONS] || '';
            const parsedGroups = parseOptions(currentOptionsString);
            const hasExistingOptions = parsedGroups.length > 0 && parsedGroups.some(g => g.options.length > 0);

            variationsToolContainer.innerHTML = `
                <div class="variations-tool-header" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                    <span class="detail-label" style="margin-bottom: 0;">Variations & Options</span>
                    <button class="variations-toggle-btn" style="background: none; border: none; cursor: pointer; font-size: 1.2em; color: #007bff;">
                        ${hasExistingOptions ? '▼' : '+ Add'}
                    </button>
                </div>
                <div class="variations-tool-content" style="display: none; margin-top: 10px;">
                    <div class="variations-help-text" style="font-size: 0.85em; color: #666; margin-bottom: 10px; padding: 8px; background: #f8f9fa; border-radius: 4px;">
                        <strong>Format:</strong> Use <code>[Group Name]</code> for groups, then add options below.<br>
                        <strong>Modifiers:</strong> <code>[price: +10]</code> <code>[price: 25]</code> (override) <code>[img: tag]</code> <code>[desc: text]</code> <code>[time: +30]</code>
                    </div>
                    <textarea class="variations-editor" placeholder="[Size] (required)
Small [price: -5]
Medium
Large [price: +5]

[Add-ons]
Extra cheese [price: +2]
Bacon [price: +3] [img: bacon_option]" style="width: 100%; min-height: 150px; font-family: monospace; font-size: 0.9em; padding: 10px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;">${currentOptionsString}</textarea>
                    <div class="variations-preview" style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px; display: none;">
                        <strong style="font-size: 0.85em; color: #333;">Preview:</strong>
                        <div class="variations-preview-content" style="margin-top: 8px;"></div>
                    </div>
                    <div class="variations-actions" style="margin-top: 10px; display: flex; gap: 10px;">
                        <button class="variations-preview-btn" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">Preview</button>
                        <button class="variations-save-btn" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Save Variations</button>
                        <span class="variations-status" style="align-self: center; font-size: 0.85em; color: #666;"></span>
                    </div>
                </div>
            `;

            // Toggle show/hide variations tool
            const header = variationsToolContainer.querySelector('.variations-tool-header');
            const content = variationsToolContainer.querySelector('.variations-tool-content');
            const toggleBtn = variationsToolContainer.querySelector('.variations-toggle-btn');

            header.addEventListener('click', () => {
                const isVisible = content.style.display !== 'none';
                content.style.display = isVisible ? 'none' : 'block';
                toggleBtn.textContent = isVisible ? (hasExistingOptions ? '▼' : '+ Add') : '▲';
            });

            // Preview functionality
            const textarea = variationsToolContainer.querySelector('.variations-editor');
            const previewContainer = variationsToolContainer.querySelector('.variations-preview');
            const previewContent = variationsToolContainer.querySelector('.variations-preview-content');
            const previewBtn = variationsToolContainer.querySelector('.variations-preview-btn');
            const saveBtn = variationsToolContainer.querySelector('.variations-save-btn');
            const statusSpan = variationsToolContainer.querySelector('.variations-status');

            previewBtn.addEventListener('click', () => {
                const optionsText = textarea.value;
                const groups = parseOptions(optionsText);

                if (groups.length === 0 || !groups.some(g => g.options.length > 0)) {
                    previewContent.innerHTML = '<em style="color: #666;">No valid options found. Add options using the format above.</em>';
                } else {
                    let previewHtml = '';
                    groups.forEach(group => {
                        if (group.options.length > 0) {
                            previewHtml += `<div style="margin-bottom: 10px;">
                                <strong style="color: #333;">${group.name}</strong>${group.modifier ? ` <span style="color: #666; font-size: 0.85em;">(${group.modifier})</span>` : ''}
                                <ul style="margin: 5px 0 0 15px; padding: 0;">`;
                            group.options.forEach(opt => {
                                let priceText = '';
                                if (opt.priceOverride !== null) {
                                    priceText = ` <span style="color: #28a745;">$${opt.priceOverride.toFixed(2)}</span>`;
                                } else if (opt.priceModifier !== null) {
                                    priceText = ` <span style="color: ${opt.priceModifier >= 0 ? '#28a745' : '#dc3545'}">${opt.priceModifier >= 0 ? '+' : ''}$${opt.priceModifier.toFixed(2)}</span>`;
                                }
                                let extras = [];
                                if (opt.imageTag) extras.push(`img: ${opt.imageTag}`);
                                if (opt.descriptionAppend) extras.push(`desc: "${opt.descriptionAppend.substring(0, 20)}${opt.descriptionAppend.length > 20 ? '...' : ''}"`);
                                if (opt.durationChange !== null) extras.push(`time: ${opt.durationChange >= 0 ? '+' : ''}${opt.durationChange}min`);
                                const extrasText = extras.length > 0 ? ` <span style="color: #888; font-size: 0.85em;">[${extras.join(', ')}]</span>` : '';
                                previewHtml += `<li style="margin: 3px 0;">${opt.name}${priceText}${extrasText}</li>`;
                            });
                            previewHtml += '</ul></div>';
                        }
                    });
                    previewContent.innerHTML = previewHtml;
                }
                previewContainer.style.display = 'block';
            });

            // Save functionality
            saveBtn.addEventListener('click', async () => {
                const optionsText = textarea.value;
                statusSpan.textContent = 'Saving...';
                statusSpan.style.color = '#666';
                saveBtn.disabled = true;

                try {
                    let saveSuccess = false;

                    // For AI-parsed and custom items, save locally only (no API call)
                    if (!isRealRecord) {
                        // Store options directly on the record object
                        record.fields[CONSTANTS.FIELD_NAMES.OPTIONS] = optionsText;
                        saveSuccess = true;
                        statusSpan.textContent = 'Saved locally!';
                        statusSpan.style.color = '#28a745';
                    } else {
                        // For real catalog items, persist to Airtable
                        const result = await api.updateItemOptions(record.id, optionsText);
                        if (result) {
                            saveSuccess = true;
                            statusSpan.textContent = 'Saved successfully!';
                            statusSpan.style.color = '#28a745';

                            // Update the record's options field locally
                            record.fields[CONSTANTS.FIELD_NAMES.OPTIONS] = optionsText;
                        } else {
                            throw new Error('Failed to save');
                        }
                    }

                    if (saveSuccess) {
                        // Refresh the options display in the modal
                        const newGroups = parseOptions(optionsText);
                        const hasNewOptions = newGroups.length > 0 && newGroups.some(g => g.options.length > 0);
                        toggleBtn.textContent = hasNewOptions ? '▲' : '+ Add';

                        // Trigger re-render of the options buttons
                        setTimeout(() => {
                            showDetailModal(record);
                        }, 1000);
                    }
                } catch (error) {
                    statusSpan.textContent = 'Error saving. Please try again.';
                    statusSpan.style.color = '#dc3545';
                    console.error('Error saving variations:', error);
                } finally {
                    saveBtn.disabled = false;
                    setTimeout(() => {
                        statusSpan.textContent = '';
                    }, 3000);
                }
            });

            fragment.appendChild(variationsToolContainer);
        }

        modalAdditionalDetails.appendChild(fragment);
    }

    const isGrouping = !record.id.startsWith('custom-') && !record.id.startsWith('ai-search-') && !record.id.startsWith('ai-child-') && !record.id.startsWith('ai-presentation-') && record.fields['Item Type'] === 'Grouping';
    const isPackage = record.fields['Item Type'] === 'Package';

    const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const pricingTypeHTML = pricingType ? `<span class="pricing-type"> / ${pricingType.toLowerCase()}</span>` : '';

    // Store package data for use throughout modal (will be populated if isPackage)
    let packageContents = null;
    let packageMetadata = null;
    let packageHeadcount = 1;
    let packagePricing = null;

    if (isGrouping) {
        const range = getGroupPriceRange(record);
        modalItemPrice.innerHTML = (range && typeof range.min === 'number') ? (range.min === range.max ? (range.min === 0 ? 'Free' : `$${range.min.toFixed(2)}`) : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`) : 'Price Varies';
    } else if (isPackage) {
        // Handle package pricing - fetch contents and calculate dynamic price
        const linkedSessionId = record.fields['LinkedSession'] ? record.fields['LinkedSession'][0] : null;

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

                    if (sessionData.packageMetadata) {
                        packageMetadata = sessionData.packageMetadata;
                    } else {
                        packageMetadata = { discount: 0, tiers: [], price: 0, pricingType: null };
                    }
                }
            } catch (e) {
                log('Modal', `Could not fetch linked session for package ${record.id}: ${e.message}`);
            }
        }

        // Calculate default headcount and dynamic pricing
        if (packageContents) {
            packageHeadcount = getPackageDefaultHeadcount(packageContents, state.records.all);
            packagePricing = calculateDynamicPackagePrice(packageContents, packageMetadata, state.records.all, packageHeadcount);

            const discount = parseFloat(packageMetadata?.discount || 0);
            const perGuestLabel = packagePricing.hasPerGuestItems ? '<span class="pricing-type"> / per guest pricing</span>' : '';
            let priceText = packagePricing.totalPrice === 0 ? 'Free' : `$${packagePricing.totalPrice.toFixed(2)}`;

            // Show savings if there's a discount
            if (discount > 0 && packagePricing.discountAmount > 0) {
                priceText += ` <span class="package-modal-savings">(Save $${packagePricing.discountAmount.toFixed(0)})</span>`;
            }

            modalItemPrice.innerHTML = priceText + perGuestLabel;
        } else {
            // Fallback to base price if package contents couldn't be loaded
            const price = getRecordPrice(record, itemState.selectedOptionIndex);
            let priceText = (typeof price === 'number' ? (price === 0 ? 'Free' : `$${price.toFixed(2)}`) : 'N/A');
            modalItemPrice.innerHTML = priceText + pricingTypeHTML;
        }
    } else {
        const price = getRecordPrice(record, itemState.selectedOptionIndex);
        let priceText = (typeof price === 'number' ? (price === 0 ? 'Free' : `$${price.toFixed(2)}`) : 'N/A');
        if ((record.id.startsWith('custom-') || record.id.startsWith('ai-search-') || record.id.startsWith('ai-child-')) && price > 0) {
            priceText += ' (Est.)';
        }
        modalItemPrice.innerHTML = priceText + pricingTypeHTML;
    }

    let currentPhotoIndex = startPhotoIndex;

    // Get the current cover photo index from the plan item (if it's in the plan)
    const isInPlan = state.cart.lockedItems.has(record.id);
    const planItemInfo = isInPlan ? state.cart.lockedItems.get(record.id) : null;
    const savedCoverIndex = planItemInfo?.selectedImageIndex ?? 0;

    // Setup "Set as Cover" button functionality
    const setCoverBtn = document.getElementById('set-cover-photo-btn');
    const setCoverContainer = document.getElementById('set-cover-photo-container');

    // Function to update the cover photo for this plan item
    const updateCoverPhoto = async (newIndex) => {
        if (!isInPlan) {
            log('Modal', 'Cannot set cover - item is not in plan');
            return;
        }

        // Update the item info with the new selected image index
        const itemInfo = state.cart.lockedItems.get(record.id);
        itemInfo.selectedImageIndex = newIndex;
        state.cart.lockedItems.set(record.id, itemInfo);

        // Trigger save to persist across views and users
        if (typeof triggerSave === 'function') {
            triggerSave();
        }

        // Update the cover indicator on thumbnails
        modalThumbnailStrip.querySelectorAll('.thumbnail-img').forEach((t, idx) => {
            t.classList.toggle('is-cover', idx === newIndex);
        });

        // Update sidebar to show new cover
        if (typeof ui !== 'undefined' && typeof ui.updateEventPlanSection === 'function') {
            ui.updateEventPlanSection();
        }

        // Update presentation view if visible
        if (typeof window.itemImagesCache !== 'undefined') {
            const cached = window.itemImagesCache?.get(record.id);
            if (cached) {
                cached.currentIndex = newIndex;

                // Also update the visible carousel in presentation view
                const carousel = document.querySelector(`.itinerary-media-carousel[data-record-id="${record.id}"]`);
                if (carousel && cached.images && cached.images[newIndex]) {
                    // Update main image
                    const mainImage = carousel.querySelector('.itinerary-main-image');
                    if (mainImage) {
                        mainImage.style.backgroundImage = `url('${cached.images[newIndex]}')`;
                    }
                    // Update active thumbnail
                    const thumbnails = carousel.querySelectorAll('.itinerary-thumbnail');
                    thumbnails.forEach((thumb, idx) => {
                        thumb.classList.toggle('active', idx === newIndex);
                    });
                    log('Modal', `Updated presentation carousel to show image ${newIndex}`);
                }
            }
        }

        log('Modal', `Set cover photo index to ${newIndex} for item ${record.id}`);

        // Show success feedback
        if (setCoverBtn) {
            setCoverBtn.textContent = '✓ Cover Set!';
            setCoverBtn.classList.add('success');
            setTimeout(() => {
                setCoverBtn.classList.remove('visible', 'success');
                setCoverBtn.textContent = '⭐ Set as Cover';
            }, 1500);
        }
    };

    // Show/hide the "Set as Cover" button based on whether item is in plan and photo changed
    const updateSetCoverButton = (selectedIndex) => {
        if (!setCoverBtn || !setCoverContainer) return;

        // Only show if item is in plan and current photo is different from cover
        const currentCover = state.cart.lockedItems.get(record.id)?.selectedImageIndex ?? 0;
        if (isInPlan && selectedIndex !== currentCover && imageUrls.length > 1) {
            setCoverBtn.classList.add('visible');
        } else {
            setCoverBtn.classList.remove('visible');
        }
    };

    // Setup click handler for "Set as Cover" button
    if (setCoverBtn) {
        // Clone to remove old handlers
        const newSetCoverBtn = setCoverBtn.cloneNode(true);
        setCoverBtn.parentNode.replaceChild(newSetCoverBtn, setCoverBtn);

        newSetCoverBtn.addEventListener('click', () => {
            updateCoverPhoto(currentPhotoIndex);
        });
    }

    // Optimize main image with proper size and format
    const optimizedMainImage = imageUrls[currentPhotoIndex].includes('cloudinary')
        ? applyCloudinaryTransform(imageUrls[currentPhotoIndex], 'w_1200,h_1000,c_fill,f_auto,q_auto,fl_progressive')
        : imageUrls[currentPhotoIndex];
    modalMainImage.style.backgroundImage = `url('${optimizedMainImage}')`;

    // Add AI image source indicator for AI items or manually added items with AI-generated images
    const existingAiImageSource = modalMainImage.querySelector('.ai-image-source-modal');
    if (existingAiImageSource) existingAiImageSource.remove();

    // Check if this item has AI-generated images (either AI-sourced record or manual item with AI image)
    const hasAIGeneratedImage = record?.fields?._hasAIGeneratedImage === true ||
                                imageSource === 'ai_generated' ||
                                imageSource === 'mixed_ai_custom';
    const shouldShowAIIndicator = (isAIRecord && imageSource) || hasAIGeneratedImage;

    console.log('[AI IMAGE DEBUG Modal] Checking whether to show AI image indicator:', {
        isAIRecord: isAIRecord,
        imageSource: imageSource,
        hasAIGeneratedImage: hasAIGeneratedImage,
        recordId: record?.id,
        willShowIndicator: shouldShowAIIndicator,
        modalMainImageExists: !!modalMainImage
    });

    if (shouldShowAIIndicator) {
        // For manually added items with AI images, always show as "AI Generated"
        // For AI-sourced items, check if the image is polished (from a real source)
        const isPolished = !hasAIGeneratedImage && imageSource !== 'ai_approximation' && imageSource !== 'placeholder';
        console.log('[AI IMAGE DEBUG Modal] Creating AI image indicator:', {
            isPolished: isPolished,
            hasAIGeneratedImage: hasAIGeneratedImage,
            imageSource: imageSource,
            cssClass: `ai-image-source-modal ${isPolished ? 'polished' : 'approximation'}`
        });
        const aiImageSourceIndicator = document.createElement('span');
        aiImageSourceIndicator.className = `ai-image-source-modal ${isPolished ? 'polished' : 'approximation'}`;
        aiImageSourceIndicator.textContent = hasAIGeneratedImage ? 'AI Generated' : (isPolished ? '✓ Verified Image' : 'AI Approximated');
        aiImageSourceIndicator.title = hasAIGeneratedImage
            ? 'This image was AI-generated based on item details. Upload your own photos to replace it.'
            : (isPolished
                ? `Image source: ${imageSource}`
                : 'This is an AI-approximated placeholder. Use "Dig Into" to find better images.');
        modalMainImage.appendChild(aiImageSourceIndicator);
        console.log('[AI IMAGE DEBUG Modal] Appended AI image indicator to modalMainImage');
    } else {
        console.log('[AI IMAGE DEBUG Modal] NOT showing AI image indicator because:', {
            isAIRecord: isAIRecord,
            imageSource: imageSource,
            reason: !isAIRecord ? 'not an AI record' : (!imageSource ? 'no imageSource' : 'unknown')
        });
    }

    modalThumbnailStrip.innerHTML = '';
    imageUrls.forEach((url, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail-img';
        // Add is-cover class if this is the saved cover photo
        if (isInPlan && index === savedCoverIndex) {
            thumb.classList.add('is-cover');
        }
        // Optimize thumbnails with smaller size
        const optimizedThumb = url.includes('cloudinary')
            ? applyCloudinaryTransform(url, 'w_150,h_150,c_fill,f_auto,q_auto')
            : url;
        thumb.style.backgroundImage = `url('${optimizedThumb}')`;
        if (index === currentPhotoIndex) thumb.classList.add('active');
        thumb.addEventListener('click', () => {
            currentPhotoIndex = index;
            const optimizedClickImage = imageUrls[index].includes('cloudinary')
                ? applyCloudinaryTransform(imageUrls[index], 'w_1200,h_1000,c_fill,f_auto,q_auto,fl_progressive')
                : imageUrls[index];
            // Remove any package collage overlay when switching to a regular thumbnail
            const existingCollage = modalMainImage.querySelector('.package-collage-overlay');
            if (existingCollage) existingCollage.remove();
            const existingNameOverlay = modalMainImage.querySelector('.package-component-name-overlay');
            if (existingNameOverlay) existingNameOverlay.style.display = 'none';
            // Restore AI image indicator if present
            const aiIndicator = modalMainImage.querySelector('.ai-image-source-modal');
            if (aiIndicator) aiIndicator.style.display = '';
            modalMainImage.style.backgroundImage = `url('${optimizedClickImage}')`;
            modalThumbnailStrip.querySelectorAll('.active').forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');
            // Update "Set as Cover" button visibility
            updateSetCoverButton(index);
        });
        modalThumbnailStrip.appendChild(thumb);
    });

    // Initialize the "Set as Cover" button state
    updateSetCoverButton(currentPhotoIndex);

    // ============================================================
    // PACKAGE COMPONENT COLLAGES: For packages, fetch images for each
    // included component and add collage thumbnails to the media carousel
    // ============================================================
    if (isPackage && packageContents) {
        const includedItems = packageContents.includedItems || [];
        const addOnItems = packageContents.addOnItems || [];
        const allPackageItems = [...includedItems, ...addOnItems];

        if (allPackageItems.length > 0) {
            // Add a separator label before component collages
            const separator = document.createElement('div');
            separator.className = 'thumbnail-separator';
            separator.textContent = 'Included Items';
            modalThumbnailStrip.appendChild(separator);

            // Track all component collage data for main image display
            const componentCollages = [];

            // Fetch images for each component in parallel
            const componentImagePromises = allPackageItems.map(async (itemRef) => {
                const itemId = itemRef.id || itemRef;
                const itemRecord = getRecordById(itemId);
                if (!itemRecord) return null;

                let componentImageUrls = [];
                try {
                    const { imageUrls: fetchedUrls } = await api.fetchImagesForRecord(itemRecord, state.records.all, new Map());
                    componentImageUrls = fetchedUrls || [];
                } catch (e) {
                    console.warn('Failed to fetch images for package component:', itemId, e);
                }
                if (componentImageUrls.length === 0) {
                    componentImageUrls = [ui.getPlaceholderImage([])];
                }

                return {
                    record: itemRecord,
                    imageUrls: componentImageUrls,
                    isAddOn: addOnItems.some(a => (a.id || a) === itemId)
                };
            });

            const componentResults = await Promise.all(componentImagePromises);

            for (const compData of componentResults) {
                if (!compData) continue;

                const { record: compRecord, imageUrls: compImages, isAddOn } = compData;
                const collageIndex = componentCollages.length;

                componentCollages.push({
                    record: compRecord,
                    imageUrls: compImages,
                    isAddOn
                });

                // Create a collage thumbnail for this component
                const thumb = document.createElement('div');
                thumb.className = 'thumbnail-img thumbnail-collage' + (isAddOn ? ' thumbnail-addon' : '');
                thumb.title = compRecord.fields.Name || 'Component';

                // Build collage preview inside thumbnail
                if (compImages.length === 1) {
                    const optimizedUrl = compImages[0].includes('cloudinary')
                        ? applyCloudinaryTransform(compImages[0], 'w_150,h_150,c_fill,f_auto,q_auto')
                        : compImages[0];
                    thumb.style.backgroundImage = `url('${optimizedUrl}')`;
                } else {
                    // Multi-image collage thumbnail
                    thumb.style.backgroundImage = 'none';
                    const miniCollage = document.createElement('div');
                    miniCollage.className = 'thumbnail-mini-collage';
                    const collageClass = compImages.length === 2 ? 'two-images' : compImages.length === 3 ? 'three-images' : '';
                    miniCollage.classList.add(collageClass || 'four-images');

                    compImages.slice(0, 4).forEach((url) => {
                        const img = document.createElement('img');
                        img.className = 'mini-collage-img';
                        img.src = url.includes('cloudinary')
                            ? applyCloudinaryTransform(url, 'w_80,h_80,c_fill,f_auto,q_auto')
                            : url;
                        img.loading = 'lazy';
                        miniCollage.appendChild(img);
                    });
                    thumb.appendChild(miniCollage);
                }

                // Add component name label
                const label = document.createElement('span');
                label.className = 'thumbnail-collage-label';
                label.textContent = compRecord.fields.Name || '';
                thumb.appendChild(label);

                // Click handler: show component collage in main image area
                thumb.addEventListener('click', () => {
                    // Remove active state from all thumbnails
                    modalThumbnailStrip.querySelectorAll('.active').forEach(t => t.classList.remove('active'));
                    thumb.classList.add('active');

                    // Build collage display in the main image area
                    const collageData = componentCollages[collageIndex];
                    const mainImages = collageData.imageUrls;

                    // Clear any existing collage overlay
                    const existingCollage = modalMainImage.querySelector('.package-collage-overlay');
                    if (existingCollage) existingCollage.remove();

                    // Hide AI image indicator when showing component images
                    const aiIndicator = modalMainImage.querySelector('.ai-image-source-modal');
                    if (aiIndicator) aiIndicator.style.display = 'none';

                    if (mainImages.length === 1) {
                        // Single image: just set as background
                        const optimizedUrl = mainImages[0].includes('cloudinary')
                            ? applyCloudinaryTransform(mainImages[0], 'w_1200,h_1000,c_fill,f_auto,q_auto,fl_progressive')
                            : mainImages[0];
                        modalMainImage.style.backgroundImage = `url('${optimizedUrl}')`;
                    } else {
                        // Multiple images: show collage grid overlay
                        modalMainImage.style.backgroundImage = 'none';
                        const collageOverlay = document.createElement('div');
                        collageOverlay.className = 'package-collage-overlay';
                        const gridClass = mainImages.length === 2 ? 'two-images' : mainImages.length === 3 ? 'three-images' : '';
                        collageOverlay.classList.add(gridClass || 'four-plus-images');

                        mainImages.slice(0, 4).forEach((url) => {
                            const img = document.createElement('img');
                            img.className = 'package-collage-img';
                            img.src = url.includes('cloudinary')
                                ? applyCloudinaryTransform(url, 'w_600,h_500,c_fill,f_auto,q_auto')
                                : url;
                            collageOverlay.appendChild(img);
                        });

                        // If more than 4 images, show count badge
                        if (mainImages.length > 4) {
                            const badge = document.createElement('span');
                            badge.className = 'package-collage-count';
                            badge.textContent = `+${mainImages.length - 4}`;
                            collageOverlay.appendChild(badge);
                        }

                        modalMainImage.appendChild(collageOverlay);
                    }

                    // Show component name overlay on main image
                    let nameOverlay = modalMainImage.querySelector('.package-component-name-overlay');
                    if (!nameOverlay) {
                        nameOverlay = document.createElement('div');
                        nameOverlay.className = 'package-component-name-overlay';
                        modalMainImage.appendChild(nameOverlay);
                    }
                    nameOverlay.textContent = collageData.record.fields.Name || '';
                    nameOverlay.style.display = 'block';
                });

                modalThumbnailStrip.appendChild(thumb);
            }

            // Auto-select the first component collage if the package itself only has a placeholder
            if (componentCollages.length > 0 && (imageSource === 'placeholder' || imageSource === 'using_placeholder' || imageSource === 'ai_approximation')) {
                // Click the first component collage thumbnail to show it
                const firstCollageThumb = modalThumbnailStrip.querySelector('.thumbnail-collage');
                if (firstCollageThumb) {
                    firstCollageThumb.click();
                }
            }
        }
    }

    // Setup "Search More Photos" button for AI-sourced items
    const searchPhotosContainer = document.getElementById('modal-search-photos-container');
    const searchPhotosBtn = document.getElementById('modal-search-photos-btn');
    const searchPhotosResults = document.getElementById('search-photos-results');
    const searchPhotosGrid = document.getElementById('search-photos-grid');
    const saveSelectedPhotosBtn = document.getElementById('save-selected-photos-btn');
    const cancelPhotoSelectionBtn = document.getElementById('cancel-photo-selection-btn');
    // Note: isAIRecord was already declared earlier in this function (line ~2093)

    if (searchPhotosContainer && searchPhotosBtn) {
        // Show button for AI records that might benefit from additional photo searches
        if (isAIRecord) {
            searchPhotosContainer.style.display = 'block';

            // Reset the photo selection UI state
            if (searchPhotosResults) {
                searchPhotosResults.classList.remove('active');
            }
            if (searchPhotosGrid) {
                searchPhotosGrid.innerHTML = '';
            }

            // Track selected photos for saving
            let selectedPhotoUrls = [];

            // Remove previous listener if any (to avoid duplicates)
            const newSearchBtn = searchPhotosBtn.cloneNode(true);
            searchPhotosBtn.parentNode.replaceChild(newSearchBtn, searchPhotosBtn);

            newSearchBtn.addEventListener('click', async () => {
                newSearchBtn.classList.add('loading');
                newSearchBtn.disabled = true;
                const originalText = newSearchBtn.textContent;
                newSearchBtn.textContent = 'Searching website...';

                try {
                    // For AI-parsed items, scrape the item's website for photos
                    // These items are not in the catalog yet, so Cloudinary won't have relevant photos
                    const websiteUrl = record.fields?.['_aiWebsite'];
                    const businessName = record.fields?.Name || '';

                    log('Modal', `Searching for more photos from website: ${websiteUrl || 'none'}`);

                    // Build set of existing image URLs to filter duplicates
                    const existingUrls = new Set(imageUrls.map(url => url.toLowerCase()));

                    // Also check existing custom images
                    const existingCustomImages = record.fields._customImages || [];
                    existingCustomImages.forEach(img => {
                        const url = img.url || img;
                        if (url) existingUrls.add(url.toLowerCase());
                    });

                    let newImageUrls = [];

                    // Step 1: Try scraping the website for photos
                    if (websiteUrl) {
                        newSearchBtn.textContent = 'Scanning website...';
                        const scrapeResult = await api.scrapeWebsitePhotos(websiteUrl, businessName, 10);

                        if (scrapeResult.success && scrapeResult.images && scrapeResult.images.length > 0) {
                            log('Modal', `Website scrape found ${scrapeResult.images.length} images from sources:`, scrapeResult.sources);

                            // Filter out duplicates
                            for (const img of scrapeResult.images) {
                                if (!existingUrls.has(img.url.toLowerCase())) {
                                    newImageUrls.push(img.url);
                                    existingUrls.add(img.url.toLowerCase());
                                }
                            }

                            log('Modal', `After deduplication: ${newImageUrls.length} new images`);
                        } else {
                            log('Modal', 'Website scrape returned no images');
                        }
                    } else {
                        log('Modal', 'No website URL available for scraping');
                    }

                    if (newImageUrls.length > 0) {
                        // Show the photo selection UI instead of immediately adding to thumbnail strip
                        selectedPhotoUrls = []; // Reset selection
                        searchPhotosGrid.innerHTML = '';

                        newImageUrls.forEach((url, index) => {
                            const photoItem = document.createElement('div');
                            photoItem.className = 'search-photo-item';
                            photoItem.dataset.url = url;
                            photoItem.innerHTML = `
                                <img src="${url}" alt="Photo ${index + 1}" loading="lazy" />
                                <div class="photo-select-indicator"></div>
                            `;

                            // Toggle selection on click
                            photoItem.addEventListener('click', () => {
                                photoItem.classList.toggle('selected');

                                if (photoItem.classList.contains('selected')) {
                                    if (!selectedPhotoUrls.includes(url)) {
                                        selectedPhotoUrls.push(url);
                                    }
                                } else {
                                    selectedPhotoUrls = selectedPhotoUrls.filter(u => u !== url);
                                }

                                // Update save button text and state
                                const saveBtn = document.getElementById('save-selected-photos-btn');
                                if (saveBtn) {
                                    saveBtn.textContent = `💾 Save Selected (${selectedPhotoUrls.length})`;
                                    saveBtn.disabled = selectedPhotoUrls.length === 0;
                                }
                            });

                            searchPhotosGrid.appendChild(photoItem);
                        });

                        // Show the selection UI
                        searchPhotosResults.classList.add('active');

                        // Add fallback class to parent for browsers without :has() support
                        const modalMainColumn = document.querySelector('.modal-main-column');
                        if (modalMainColumn) {
                            modalMainColumn.classList.add('search-photos-active');
                        }

                        // Reset save button
                        if (saveSelectedPhotosBtn) {
                            saveSelectedPhotosBtn.textContent = '💾 Save Selected (0)';
                            saveSelectedPhotosBtn.disabled = true;
                        }

                        newSearchBtn.textContent = `Found ${newImageUrls.length} photos!`;
                        setTimeout(() => {
                            newSearchBtn.textContent = originalText;
                        }, 2000);
                    } else {
                        // No images found from website
                        newSearchBtn.textContent = websiteUrl ? 'No website photos found' : 'No website available';
                        setTimeout(() => {
                            newSearchBtn.textContent = originalText;
                        }, 2000);
                    }
                } catch (error) {
                    console.error('Error searching for more photos:', error);
                    newSearchBtn.textContent = 'Search failed';
                    setTimeout(() => {
                        newSearchBtn.textContent = originalText;
                    }, 2000);
                } finally {
                    newSearchBtn.classList.remove('loading');
                    newSearchBtn.disabled = false;
                }
            });

            // Save Selected Photos button handler
            if (saveSelectedPhotosBtn) {
                const newSaveBtn = saveSelectedPhotosBtn.cloneNode(true);
                saveSelectedPhotosBtn.parentNode.replaceChild(newSaveBtn, saveSelectedPhotosBtn);

                newSaveBtn.addEventListener('click', async () => {
                    if (selectedPhotoUrls.length === 0) return;

                    newSaveBtn.disabled = true;
                    newSaveBtn.textContent = 'Saving photos...';

                    try {
                        // Get existing custom images
                        const existingCustomImages = record.fields._customImages || [];

                        // Create new photos array with URL objects
                        const newPhotos = selectedPhotoUrls.map(url => ({ url }));

                        // Combine existing and new photos
                        const allPhotos = [...existingCustomImages, ...newPhotos];

                        // Update the record in state.records.all
                        const recordIndex = state.records.all.findIndex(r => r.id === record.id);
                        if (recordIndex !== -1) {
                            state.records.all[recordIndex].fields._customImages = allPhotos;
                        }

                        // Also update the record reference passed to the modal
                        record.fields._customImages = allPhotos;

                        log('Modal', `Saved ${selectedPhotoUrls.length} new photos to item. Total photos: ${allPhotos.length}`);

                        // Trigger save to persist changes to Airtable
                        if (typeof triggerSave === 'function') {
                            await triggerSave();
                        }

                        // Sync plan state across all views
                        if (typeof syncPlanState === 'function') {
                            syncPlanState('modal', 'itemUpdated', { recordId: record.id, itemName: record.fields.Name });
                        }

                        // Add the new photos to the thumbnail strip
                        selectedPhotoUrls.forEach((url) => {
                            // Add to imageUrls array for the modal
                            imageUrls.push(url);

                            // Create thumbnail
                            const thumb = document.createElement('div');
                            thumb.className = 'thumbnail-img custom-photo-thumb';
                            thumb.style.backgroundImage = `url('${url}')`;
                            thumb.addEventListener('click', () => {
                                currentPhotoIndex = imageUrls.indexOf(url);
                                modalMainImage.style.backgroundImage = `url('${url}')`;
                                modalThumbnailStrip.querySelector('.active')?.classList.remove('active');
                                thumb.classList.add('active');
                            });
                            modalThumbnailStrip.appendChild(thumb);
                        });

                        // Hide the selection UI
                        searchPhotosResults.classList.remove('active');
                        searchPhotosGrid.innerHTML = '';
                        selectedPhotoUrls = [];

                        // Remove fallback class from parent
                        const modalMainColumn = document.querySelector('.modal-main-column');
                        if (modalMainColumn) {
                            modalMainColumn.classList.remove('search-photos-active');
                        }

                        // Show success message on the search button
                        const searchBtn = document.getElementById('modal-search-photos-btn');
                        if (searchBtn) {
                            const originalText = searchBtn.textContent;
                            searchBtn.textContent = '✓ Photos saved!';
                            setTimeout(() => {
                                searchBtn.textContent = originalText;
                            }, 2000);
                        }

                    } catch (error) {
                        console.error('Error saving selected photos:', error);
                        alert('Failed to save photos. Please try again.');
                    } finally {
                        newSaveBtn.textContent = '💾 Save Selected (0)';
                        newSaveBtn.disabled = true;
                    }
                });
            }

            // Cancel button handler
            if (cancelPhotoSelectionBtn) {
                const newCancelBtn = cancelPhotoSelectionBtn.cloneNode(true);
                cancelPhotoSelectionBtn.parentNode.replaceChild(newCancelBtn, cancelPhotoSelectionBtn);

                newCancelBtn.addEventListener('click', () => {
                    // Hide the selection UI
                    searchPhotosResults.classList.remove('active');
                    searchPhotosGrid.innerHTML = '';
                    selectedPhotoUrls = [];

                    // Remove fallback class from parent
                    const modalMainColumn = document.querySelector('.modal-main-column');
                    if (modalMainColumn) {
                        modalMainColumn.classList.remove('search-photos-active');
                    }

                    // Reset save button
                    const saveBtn = document.getElementById('save-selected-photos-btn');
                    if (saveBtn) {
                        saveBtn.textContent = '💾 Save Selected (0)';
                        saveBtn.disabled = true;
                    }
                });
            }
        } else {
            searchPhotosContainer.style.display = 'none';
            // Also reset the photo selection UI when viewing non-AI records
            if (searchPhotosResults) {
                searchPhotosResults.classList.remove('active');
            }
            if (searchPhotosGrid) {
                searchPhotosGrid.innerHTML = '';
            }
            // Remove fallback class from parent
            const modalMainColumn = document.querySelector('.modal-main-column');
            if (modalMainColumn) {
                modalMainColumn.classList.remove('search-photos-active');
            }
        }
    }

    modalHeaderActions.innerHTML = '';
    const breadcrumbs = getBreadcrumbs(record);

    // If opened from a group detail modal, show breadcrumb back to group
    if (fromGroup && fromGroup.id) {
        const groupName = fromGroup.name || 'Options';
        modalBreadcrumbs.innerHTML = `
            <a class="group-back-link" data-group-id="${fromGroup.id}" title="Back to ${groupName}">
                ← ${groupName}
            </a>
            <span class="breadcrumb-separator">›</span>
            <span class="breadcrumb-current">${record.fields.Name}</span>
        `;

        // Add click handler for back navigation to group
        const groupBackLink = modalBreadcrumbs.querySelector('.group-back-link');
        if (groupBackLink) {
            groupBackLink.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                log('Modal', `Navigating back to options group: ${groupName}`);
                showGroupDetailModal(fromGroup, state.records.all);
            });
        }
    } else if (record.isSolution && record.parentConceptRecord) {
        // Solution items get special breadcrumb with back arrow to parent concept
        const parentConcept = record.parentConceptRecord;
        modalBreadcrumbs.innerHTML = `
            <a class="solution-back-link" data-concept-id="${parentConcept.id}" title="Back to ${parentConcept.fields.Name}">
                ← ${parentConcept.fields.Name}
            </a>
            <span class="breadcrumb-separator">›</span>
            <span class="breadcrumb-current">${record.fields.Name}</span>
        `;

        // Add click handler for back navigation to parent concept
        const backLink = modalBreadcrumbs.querySelector('.solution-back-link');
        if (backLink) {
            backLink.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                log('Modal', `Navigating back to parent concept: ${parentConcept.fields.Name}`);
                showDetailModal(parentConcept);
            });
        }
    } else if (breadcrumbs.length > 0) {
        modalBreadcrumbs.innerHTML = breadcrumbs.map(name => `<a class="parent-link" data-parent-name="${name}" title="Go to ${name}">${name}</a>`).join(' > ');
    }

    const heartBtnContainer = document.createElement('div');
    heartBtnContainer.id = 'modal-heart-btn';
    heartBtnContainer.dataset.recordId = record.id;
    modalHeaderActions.appendChild(heartBtnContainer);

    // Add share button for sharing item URL (without session)
    const shareBtn = document.createElement('button');
    shareBtn.className = 'card-action-btn modal-share-btn';
    shareBtn.id = 'modal-share-btn';
    shareBtn.title = 'Share this item';
    shareBtn.innerHTML = '<span class="share-icon">&#x1F517;</span> Share';
    shareBtn.dataset.recordId = record.id;
    shareBtn.dataset.itemName = record.fields.Name || '';
    modalHeaderActions.appendChild(shareBtn);

    // Share button click handler
    shareBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        // Generate slug for pretty URL
        const slug = generateSlug(record.fields.Name, record.id);

        // Build share URL with shopId but WITHOUT session
        const shareUrl = new URL(`${window.location.origin}/item/${slug}`);

        // Include shopId if available (from current state or URL)
        const currentShopId = state.activeShop?.id || new URLSearchParams(window.location.search).get('shopId');
        if (currentShopId) {
            shareUrl.searchParams.set('shopId', currentShopId);
        }

        const shareData = {
            title: record.fields.Name || 'Check out this item',
            text: record.fields.Description ? record.fields.Description.substring(0, 100) + '...' : 'Check out this item on WTFun!',
            url: shareUrl.toString()
        };

        // Try Web Share API first (mobile-friendly)
        if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
            try {
                await navigator.share(shareData);
                log('Modal', `Shared item via Web Share API: ${record.fields.Name}`);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Share failed:', err);
                    // Fallback to clipboard
                    await copyShareLinkToClipboard(shareUrl.toString(), shareBtn);
                }
            }
        } else {
            // Fallback to clipboard copy
            await copyShareLinkToClipboard(shareUrl.toString(), shareBtn);
        }
    });

    // Add "Dig Info" button for AI-generated solution items and AI items
    // This allows users to research the solution and get detailed information with accuracy scores
    const isSolutionItem = record.isSolution === true || record.id?.startsWith('solution-');
    const isAIItem = record.id?.startsWith('ai-child-') ||
                     record.id?.startsWith('ai-presentation-') ||
                     record.id?.startsWith('ai-search-');
    const isResearchableItem = isSolutionItem || isAIItem;
    const hasResearchData = isResearchableItem && record._researchData?.confidence != null;

    if (isResearchableItem) {
        if (hasResearchData) {
            // Show accuracy badge for already-researched solutions
            const confidenceScore = Math.round(record._researchData.confidence * 100);
            const confidenceLevel = confidenceScore >= 80 ? 'high' : confidenceScore >= 50 ? 'medium' : 'low';
            const confidenceColors = { high: '#28a745', medium: '#ffc107', low: '#6c757d' };

            const accuracyBadge = document.createElement('span');
            accuracyBadge.className = 'modal-accuracy-badge card-action-btn';
            accuracyBadge.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 4px;
                background: ${confidenceColors[confidenceLevel]}20;
                color: ${confidenceColors[confidenceLevel]};
                padding: 4px 10px;
                border-radius: 12px;
                font-size: 0.85em;
                margin-right: 10px;
                border: 1px solid ${confidenceColors[confidenceLevel]}40;
                cursor: help;
            `;
            accuracyBadge.innerHTML = `<span style="font-size: 0.9em;">&#x2714;</span> ${confidenceScore}% Accuracy`;
            accuracyBadge.title = record._researchData.confidenceNotes || 'Based on AI research';
            modalHeaderActions.appendChild(accuracyBadge);

            // Initialize Tippy tooltip if available
            if (window.tippy) {
                tippy(accuracyBadge, {
                    content: `AI research accuracy: ${confidenceScore}%<br><em>${record._researchData.confidenceNotes || 'Based on AI research'}</em>`,
                    allowHTML: true,
                    placement: 'bottom',
                    arrow: true
                });
            }

            log('Modal', `Showing accuracy badge for researched item: ${record.id} (${confidenceScore}%)`);
        } else {
            // Show "Dig Info" button for unresearched AI/solution items
            const digInfoBtn = document.createElement('button');
            digInfoBtn.className = 'card-action-btn modal-dig-info-btn dig-solution-btn';
            digInfoBtn.id = 'modal-dig-info-btn';
            digInfoBtn.dataset.recordId = record.id;
            digInfoBtn.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 4px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                padding: 6px 12px;
                border-radius: 12px;
                font-size: 0.85em;
                margin-right: 10px;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
            `;
            digInfoBtn.innerHTML = '<span style="font-size: 1em;">&#x1F50D;</span> Dig Info';
            digInfoBtn.title = 'Research this solution and get detailed information with accuracy score';
            modalHeaderActions.appendChild(digInfoBtn);

            // Initialize Tippy tooltip if available
            if (window.tippy) {
                tippy(digInfoBtn, {
                    content: 'Click to research this solution and get detailed information with accuracy score',
                    placement: 'bottom',
                    arrow: true
                });
            }

            // Add click handler for the Dig Info button
            digInfoBtn.addEventListener('click', async (e) => {
                e.stopPropagation();

                log('Modal', `Dig Info clicked for solution: ${record.id}`);

                // Find the solution record in the registry
                let solutionRecord = null;
                if (record.id.startsWith('solution-') && window._solutionRecords) {
                    solutionRecord = window._solutionRecords.get(record.id);
                }

                // Fallback to the record passed to the modal
                if (!solutionRecord) {
                    solutionRecord = record;
                }

                if (!solutionRecord) {
                    log('Modal', `Solution record ${record.id} not found`);
                    if (typeof ui !== 'undefined' && ui.showToast) {
                        ui.showToast('Could not find solution record');
                    }
                    return;
                }

                // Update button to show loading state
                const originalContent = digInfoBtn.innerHTML;
                digInfoBtn.innerHTML = '<span style="font-size: 1em;">&#x23F3;</span> Researching...';
                digInfoBtn.disabled = true;
                digInfoBtn.style.opacity = '0.7';

                try {
                    // Call the API to research the solution
                    const result = await api.digSolutionDetails(solutionRecord);

                    if (!result.success) {
                        throw new Error(result.error || 'Failed to research solution');
                    }

                    const research = result.research;
                    log('Modal', `Successfully researched solution ${record.id} with confidence ${research.confidence}`);

                    // Update the solution record with research data
                    solutionRecord._researchData = research;

                    // Update fields with researched information
                    if (research.name) solutionRecord.fields.Name = research.name;
                    if (research.description) solutionRecord.fields.Description = research.description;
                    if (research.price?.estimate) solutionRecord.fields.Price = research.price.estimate;

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
                    if (window._solutionRecords) {
                        window._solutionRecords.set(record.id, solutionRecord);
                    }

                    // Also update in state.records.all if present
                    const stateIndex = state.records.all.findIndex(r => r.id === record.id);
                    if (stateIndex !== -1) {
                        state.records.all[stateIndex] = solutionRecord;
                    }

                    // Show success toast with accuracy score
                    const accuracyPercent = Math.round(research.confidence * 100);
                    if (typeof ui !== 'undefined' && ui.showToast) {
                        ui.showToast(`Research complete! Accuracy: ${accuracyPercent}%`);
                    }

                    // Add energy visual feedback if available
                    if (typeof addEnergy === 'function') {
                        addEnergy();
                    }

                    // Re-render the modal to show updated info and accuracy badge
                    showDetailModal(solutionRecord);

                    // Also update the sidebar if the item is in the plan
                    if (typeof ui !== 'undefined' && ui.updateEventPlanSection) {
                        await ui.updateEventPlanSection();
                    }

                    // Trigger save to persist the research data
                    if (typeof triggerSave === 'function') {
                        triggerSave();
                    }

                } catch (error) {
                    console.error('Error researching solution:', error);
                    if (typeof ui !== 'undefined' && ui.showToast) {
                        ui.showToast('Failed to research solution. Try again.');
                    }

                    // Restore button
                    digInfoBtn.innerHTML = originalContent;
                    digInfoBtn.disabled = false;
                    digInfoBtn.style.opacity = '1';
                }
            });

            log('Modal', `Showing Dig Info button for unresearched item: ${record.id}`);
        }
    }

    // Add "Categorize" button for ALL items (both catalog and solution items)
    // This allows users to see what event types an item would be best suited for
    const hasCategorization = record._categorization?.categories?.length > 0;

    if (hasCategorization) {
        // Show category badges for already-categorized items
        const categoriesContainer = document.createElement('div');
        categoriesContainer.className = 'modal-categories-container';
        categoriesContainer.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-right: 10px;
            flex-wrap: wrap;
        `;

        // Add a small label
        const categoryLabel = document.createElement('span');
        categoryLabel.style.cssText = `
            font-size: 0.75em;
            color: #666;
            margin-right: 2px;
        `;
        categoryLabel.textContent = 'Good for:';
        categoriesContainer.appendChild(categoryLabel);

        record._categorization.categories.forEach((cat, index) => {
            const relevancePercent = Math.round(cat.relevance * 100);
            const badge = document.createElement('span');
            badge.className = 'category-badge';
            badge.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 3px;
                background: ${index === 0 ? '#e8f5e9' : index === 1 ? '#fff3e0' : '#f3e5f5'};
                color: ${index === 0 ? '#2e7d32' : index === 1 ? '#e65100' : '#7b1fa2'};
                padding: 3px 8px;
                border-radius: 10px;
                font-size: 0.75em;
                border: 1px solid ${index === 0 ? '#a5d6a7' : index === 1 ? '#ffcc80' : '#ce93d8'};
                cursor: help;
            `;
            badge.textContent = cat.name;
            badge.title = cat.reason || `${relevancePercent}% match`;

            // Initialize Tippy tooltip if available
            if (window.tippy) {
                tippy(badge, {
                    content: `<strong>${cat.name}</strong><br><em>${cat.reason || 'Recommended for this event type'}</em><br>Relevance: ${relevancePercent}%`,
                    allowHTML: true,
                    placement: 'bottom',
                    arrow: true
                });
            }

            categoriesContainer.appendChild(badge);
        });

        modalHeaderActions.appendChild(categoriesContainer);
        log('Modal', `Showing category badges for categorized item: ${record.id}`);
    } else {
        // Show "Categorize" button for uncategorized items
        const categorizeBtn = document.createElement('button');
        categorizeBtn.className = 'card-action-btn modal-categorize-btn categorize-item-btn';
        categorizeBtn.id = 'modal-categorize-btn';
        categorizeBtn.dataset.recordId = record.id;
        categorizeBtn.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: linear-gradient(135deg, #43a047 0%, #1b5e20 100%);
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 12px;
            font-size: 0.85em;
            margin-right: 10px;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        `;
        categorizeBtn.innerHTML = '<span style="font-size: 1em;">🏷️</span> Categorize';
        categorizeBtn.title = 'Find the best event types for this item';
        modalHeaderActions.appendChild(categorizeBtn);

        // Initialize Tippy tooltip if available
        if (window.tippy) {
            tippy(categorizeBtn, {
                content: 'Click to see what types of events this item is best suited for',
                placement: 'bottom',
                arrow: true
            });
        }

        // Add click handler for the Categorize button
        categorizeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();

            log('Modal', `Categorize clicked for item: ${record.id}`);

            // Get the item record - check various sources
            let itemRecord = record;

            // If it's a solution, check the registry
            if (record.id?.startsWith('solution-') && window._solutionRecords) {
                const solutionRecord = window._solutionRecords.get(record.id);
                if (solutionRecord) {
                    itemRecord = solutionRecord;
                }
            }

            // Also check state.records.all for catalog items
            if (!itemRecord.fields && state.records.all) {
                const stateRecord = getRecordById(record.id);
                if (stateRecord) {
                    itemRecord = stateRecord;
                }
            }

            if (!itemRecord || !itemRecord.fields) {
                log('Modal', `Item record ${record.id} not found`);
                if (typeof ui !== 'undefined' && ui.showToast) {
                    ui.showToast('Could not find item record');
                }
                return;
            }

            // Update button to show loading state
            const originalContent = categorizeBtn.innerHTML;
            categorizeBtn.innerHTML = '<span style="font-size: 1em;">⏳</span> Analyzing...';
            categorizeBtn.disabled = true;
            categorizeBtn.style.opacity = '0.7';

            try {
                // Call the API to categorize the item
                const result = await api.categorizeItem(itemRecord);

                if (!result.success) {
                    throw new Error(result.error || 'Failed to categorize item');
                }

                const categorization = result.categorization;
                log('Modal', `Successfully categorized item ${record.id} with ${categorization.categories?.length || 0} categories`);

                // Store the categorization on the record
                itemRecord._categorization = categorization;

                // Update the solution registry if it's a solution
                if (record.id?.startsWith('solution-') && window._solutionRecords) {
                    window._solutionRecords.set(record.id, itemRecord);
                }

                // Update in state.records.all if present
                const stateIndex = state.records.all.findIndex(r => r.id === record.id);
                if (stateIndex !== -1) {
                    state.records.all[stateIndex]._categorization = categorization;
                }

                // Show success toast
                const topCategory = categorization.categories?.[0]?.name || 'events';
                if (typeof ui !== 'undefined' && ui.showToast) {
                    ui.showToast(`Perfect for ${topCategory}!`);
                }

                // Add energy visual feedback if available
                if (typeof addEnergy === 'function') {
                    addEnergy();
                }

                // Re-render the modal to show the category badges
                showDetailModal(itemRecord);

            } catch (error) {
                console.error('Error categorizing item:', error);
                if (typeof ui !== 'undefined' && ui.showToast) {
                    ui.showToast('Failed to categorize item. Try again.');
                }

                // Restore button
                categorizeBtn.innerHTML = originalContent;
                categorizeBtn.disabled = false;
                categorizeBtn.style.opacity = '1';
            }
        });

        log('Modal', `Showing Categorize button for item: ${record.id}`);
    }

    // Add Edit Item button for manual/custom items and AI discovery items
    const isManualItem = record.isManual === true ||
                         record.id?.startsWith('manual-add-') ||
                         record.id?.startsWith('manual-presentation-') ||
                         record.id?.startsWith('ai-search-') ||
                         record.id?.startsWith('ai-child-') ||
                         record.id?.startsWith('ai-presentation-');

    if (isManualItem) {
        const editItemBtn = document.createElement('button');
        editItemBtn.className = 'card-action-btn edit-item-btn';
        editItemBtn.id = 'modal-edit-item-btn';
        editItemBtn.dataset.recordId = record.id;
        editItemBtn.innerHTML = '✏️ Edit Item';
        editItemBtn.title = 'Edit item details';
        editItemBtn.style.marginRight = '10px';
        modalHeaderActions.appendChild(editItemBtn);

        // Track edit mode state
        let isEditMode = false;

        editItemBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isEditMode = !isEditMode;

            if (isEditMode) {
                // Enter edit mode
                editItemBtn.innerHTML = '❌ Cancel Edit';
                editItemBtn.classList.add('editing');
                enableItemEditMode(record, modalItemName, modalItemDescription);
            } else {
                // Exit edit mode without saving
                editItemBtn.innerHTML = '✏️ Edit Item';
                editItemBtn.classList.remove('editing');
                disableItemEditMode(record, modalItemName, modalItemDescription);
            }
        });
    }

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

        // Add Present button for events with linked sessions - allows viewing in presentation mode
        if (hasLinkedSession) {
            const presentBtn = document.createElement('button');
            presentBtn.className = 'card-action-btn present-event-btn';
            presentBtn.dataset.eventId = record.id;
            presentBtn.dataset.sessionId = record.fields.LinkedSession[0];
            presentBtn.innerHTML = '▶️ Present';
            presentBtn.title = 'View in presentation mode';
            presentBtn.style.marginRight = '10px';
            modalHeaderActions.appendChild(presentBtn);
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
        modalItemPrice.innerHTML = (typeof newPrice === 'number' ? (newPrice === 0 ? 'Free' : `$${newPrice.toFixed(2)}`) : 'N/A') + pricingTypeHTML;

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
                        ? applyCloudinaryTransform(taggedImages[0], 'w_1200,h_1000,c_fill,f_auto,q_auto,fl_progressive')
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

            // Determine if this group is required or optional (multi-select allowed for optional)
            const isRequired = group.modifier && group.modifier.toLowerCase() === 'required';
            const isMultiSelect = !isRequired; // Optional groups allow multi-select

            group.options.forEach((opt, optionIndex) => {
                const optionButton = document.createElement('button');
                optionButton.className = 'option-btn';
                optionButton.dataset.groupIndex = groupIndex;
                optionButton.dataset.optionIndex = optionIndex;

                // Check if this option is currently selected
                // Support both single selection (number) and multi-select (array) formats
                const groupKey = `group${groupIndex}`;
                const groupSelection = currentSelections[groupKey];
                const isSelected = Array.isArray(groupSelection)
                    ? groupSelection.includes(optionIndex)
                    : groupSelection === optionIndex;
                if (isSelected) {
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
                    // Regular option selection - supports toggle and multi-select for optional groups
                    optionButton.addEventListener('click', (e) => {
                        e.stopPropagation();

                        const gIdx = parseInt(e.currentTarget.dataset.groupIndex, 10);
                        const oIdx = parseInt(e.currentTarget.dataset.optionIndex, 10);
                        const groupKey = `group${gIdx}`;
                        const currentGroup = optionGroups[gIdx];
                        const groupIsRequired = currentGroup.modifier && currentGroup.modifier.toLowerCase() === 'required';
                        const groupIsMultiSelect = !groupIsRequired;

                        const currentlySelected = e.currentTarget.classList.contains('selected');

                        if (groupIsMultiSelect) {
                            // Multi-select: toggle individual options
                            let currentArray = Array.isArray(currentSelections[groupKey])
                                ? [...currentSelections[groupKey]]
                                : (typeof currentSelections[groupKey] === 'number' ? [currentSelections[groupKey]] : []);

                            if (currentlySelected) {
                                // Remove from selection
                                currentArray = currentArray.filter(idx => idx !== oIdx);
                                e.currentTarget.classList.remove('selected');
                            } else {
                                // Add to selection
                                currentArray.push(oIdx);
                                currentArray.sort((a, b) => a - b); // Keep sorted
                                e.currentTarget.classList.add('selected');
                            }

                            // Store as array for multi-select (or remove key if empty)
                            if (currentArray.length === 0) {
                                delete currentSelections[groupKey];
                            } else {
                                currentSelections[groupKey] = currentArray;
                            }
                        } else {
                            // Single-select with toggle: deselect all others first
                            optionsWrapper.querySelectorAll('.option-btn').forEach(btn => {
                                btn.classList.remove('selected');
                            });

                            if (currentlySelected) {
                                // Toggle off - remove selection
                                delete currentSelections[groupKey];
                            } else {
                                // Select this option
                                e.currentTarget.classList.add('selected');
                                currentSelections[groupKey] = oIdx;
                            }
                        }

                        // Update UI reactively
                        updateOptionsUI();

                        // Update Rapid Pay button text when option changes
                        const rapidPayBtnRef = document.getElementById('modal-rapid-pay-btn');
                        if (rapidPayBtnRef && rapidPayBtnRef._updateText) {
                            rapidPayBtnRef._updateText();
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

    // Add AI Top Options button for ALL users (sparkles button)
    // This allows any user to generate AI-recommended options for the item
    const hasExistingOptions = optionGroups.length > 0 && optionGroups.some(g => g.options.length > 0);
    const isRealRecord = !record.id.startsWith('custom-') && !record.id.startsWith('ai-search-') && !record.id.startsWith('ai-child-') && !record.id.startsWith('ai-presentation-');
    const userHasPublishPermissionForOptions = api.userHasPublishPermission();
    const userIsAuthenticated = state.session.user.isAuthenticated;

    // Determine if this is a concept item (manual/idea item that should generate solutions)
    // Solution items (drilled down from concepts) are treated as specific items with variations
    const isConceptItem = !record.isSolution && (
                          record.isManual === true ||
                          record.id?.startsWith('manual-add-') ||
                          record.id?.startsWith('manual-presentation-'));

    // Check if this item already has solutions stored
    const hasExistingSolutions = record._generatedSolutions && record._generatedSolutions.length > 0;
    const solutionsAreStale = record._solutionsStale === true;

    // Create the AI top options button container
    const aiOptionsContainer = document.createElement('div');
    aiOptionsContainer.className = 'ai-top-options-container';
    aiOptionsContainer.style.marginTop = hasExistingOptions ? '15px' : '0';

    // Button text changes based on item type and existing options/solutions
    let buttonText;
    let buttonTitle;
    if (isConceptItem) {
        if (solutionsAreStale) {
            buttonText = '⚠️ Re-Find Solutions (Stale)';
            buttonTitle = 'Description changed - click to regenerate solutions with updated details';
        } else {
            buttonText = hasExistingSolutions ? '✨ Re-Find Solutions' : '✨ Find Solutions';
            buttonTitle = 'Use AI to find specific solutions for this concept';
        }
    } else {
        buttonText = hasExistingOptions ? '✨ Re-Estimate Options' : '✨ Estimate Options';
        buttonTitle = 'Use AI to estimate recommended options/variations';
    }

    aiOptionsContainer.innerHTML = `
        <button class="ai-top-options-btn" title="${buttonTitle}">
            ${buttonText}
        </button>
        <div class="ai-options-result" style="display: none;">
            <div class="ai-options-preview-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <span style="font-weight: 600; color: #333;">${isConceptItem ? 'AI Generated Solutions' : 'AI Generated Options'}</span>
                <button class="ai-options-close-btn" style="background: none; border: none; cursor: pointer; font-size: 1.2em; color: #666;">×</button>
            </div>
            ${isConceptItem ? `
                <div class="ai-solutions-edit-mode" style="display: none;">
                    <textarea class="ai-solutions-editor" placeholder="Edit solutions as JSON..." style="width: 100%; min-height: 200px; font-family: monospace; font-size: 0.85em; padding: 10px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;"></textarea>
                    <div class="ai-solutions-edit-actions" style="margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap;">
                        <button class="ai-solutions-apply-btn" style="padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">Apply Solutions</button>
                        <button class="ai-solutions-cancel-edit-btn" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
                        <button class="ai-solutions-add-btn" style="padding: 8px 16px; background: #17a2b8; color: white; border: none; border-radius: 4px; cursor: pointer;">+ Add Solution</button>
                    </div>
                </div>
                <div class="ai-solutions-preview-mode">
                    <div class="ai-solutions-container"></div>
                    <div class="ai-solutions-preview-actions" style="margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap;">
                        <button class="ai-solutions-edit-all-btn" style="padding: 6px 12px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85em;">✏️ Edit All</button>
                    </div>
                </div>
                <span class="ai-options-status" style="display: block; margin-top: 10px; font-size: 0.85em; color: #666;"></span>
            ` : `
                <textarea class="ai-options-editor" placeholder="Loading..." style="width: 100%; min-height: 120px; font-family: monospace; font-size: 0.9em; padding: 10px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;"></textarea>
                <div class="ai-options-actions" style="margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap;">
                    <button class="ai-options-apply-btn" style="padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">Apply to Item</button>
                    ${userIsAuthenticated && (isRealRecord && userHasPublishPermissionForOptions) ? '<button class="ai-options-save-catalog-btn" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Save to Catalog</button>' : ''}
                    <span class="ai-options-status" style="align-self: center; font-size: 0.85em; color: #666;"></span>
                </div>
            `}
        </div>
    `;

    // Add event listeners for the AI options button
    const aiOptionsBtn = aiOptionsContainer.querySelector('.ai-top-options-btn');
    const aiOptionsResult = aiOptionsContainer.querySelector('.ai-options-result');
    const aiOptionsEditor = aiOptionsContainer.querySelector('.ai-options-editor');
    const aiOptionsCloseBtn = aiOptionsContainer.querySelector('.ai-options-close-btn');
    const aiOptionsApplyBtn = aiOptionsContainer.querySelector('.ai-options-apply-btn');
    const aiOptionsSaveCatalogBtn = aiOptionsContainer.querySelector('.ai-options-save-catalog-btn');
    const aiOptionsStatus = aiOptionsContainer.querySelector('.ai-options-status');
    const aiSolutionsContainer = aiOptionsContainer.querySelector('.ai-solutions-container');

    // New solution editing elements
    const aiSolutionsEditMode = aiOptionsContainer.querySelector('.ai-solutions-edit-mode');
    const aiSolutionsPreviewMode = aiOptionsContainer.querySelector('.ai-solutions-preview-mode');
    const aiSolutionsEditor = aiOptionsContainer.querySelector('.ai-solutions-editor');
    const aiSolutionsApplyBtn = aiOptionsContainer.querySelector('.ai-solutions-apply-btn');
    const aiSolutionsCancelEditBtn = aiOptionsContainer.querySelector('.ai-solutions-cancel-edit-btn');
    const aiSolutionsAddBtn = aiOptionsContainer.querySelector('.ai-solutions-add-btn');
    const aiSolutionsEditAllBtn = aiOptionsContainer.querySelector('.ai-solutions-edit-all-btn');

    // Helper function to convert solutions array to editable JSON text
    const solutionsToEditableText = (solutions) => {
        return JSON.stringify(solutions, null, 2);
    };

    // Helper function to parse edited JSON text back to solutions array
    const parseEditedSolutions = (text) => {
        try {
            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed)) {
                throw new Error('Solutions must be an array');
            }
            // Validate each solution has required fields
            return parsed.map(s => ({
                name: s.name || 'Unnamed Solution',
                description: s.description || '',
                estimatedPrice: s.estimatedPrice || '$0',
                confidence: s.confidence || 'medium',
                searchTerms: s.searchTerms || []
            }));
        } catch (e) {
            throw new Error(`Invalid JSON: ${e.message}`);
        }
    };

    // Helper function to switch between edit and preview modes
    const setEditMode = (editModeActive) => {
        if (aiSolutionsEditMode && aiSolutionsPreviewMode) {
            if (editModeActive) {
                aiSolutionsEditMode.style.display = 'block';
                aiSolutionsPreviewMode.style.display = 'none';
            } else {
                aiSolutionsEditMode.style.display = 'none';
                aiSolutionsPreviewMode.style.display = 'block';
            }
        }
    };

    // Helper function to render solutions as rectangular badges
    const renderSolutions = (solutions) => {
        if (!aiSolutionsContainer) return;

        aiSolutionsContainer.innerHTML = '';

        solutions.forEach((solution, index) => {
            const solutionWrapper = document.createElement('div');
            solutionWrapper.className = 'solution-item-wrapper';
            solutionWrapper.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';

            const solutionBadge = document.createElement('button');
            solutionBadge.className = 'solution-item-badge';
            solutionBadge.dataset.solutionIndex = index;
            solutionBadge.style.cssText = 'flex: 1;';

            // Confidence badge color
            const confidenceColors = {
                high: '#28a745',
                medium: '#ffc107',
                low: '#6c757d'
            };
            const confidenceColor = confidenceColors[solution.confidence] || confidenceColors.medium;

            solutionBadge.innerHTML = `
                <span class="solution-badge-indicator" style="background: ${confidenceColor};" title="${solution.confidence} confidence"></span>
                <span class="solution-badge-name">${solution.name}</span>
                <span class="solution-badge-price">${solution.estimatedPrice}</span>
            `;
            solutionBadge.title = solution.description || solution.name;

            // Click handler to navigate to solution item
            solutionBadge.addEventListener('click', () => {
                // Create a temporary record for the solution that links back to the concept
                const solutionRecord = {
                    id: `solution-${record.id}-${index}`,
                    fields: {
                        Name: solution.name,
                        Description: solution.description || '',
                        Price: parseFloat(solution.estimatedPrice.replace(/[^0-9.-]+/g, '')) || 0,
                        [CONSTANTS.FIELD_NAMES.PARENT_ITEM]: record.fields.Name, // Link back to concept
                        Category: record.fields.Category || 'Solution'
                    },
                    isSolution: true,
                    parentConceptRecord: record, // Store reference to parent concept
                    solutionData: solution,
                    searchTerms: solution.searchTerms || []
                };

                // Store the solution data on the parent concept for persistence
                if (!record._generatedSolutions) {
                    record._generatedSolutions = [];
                }
                record._generatedSolutions[index] = solution;

                // DEBUG: Store solution record in a temporary registry for Add to Plan
                if (!window._solutionRecords) {
                    window._solutionRecords = new Map();
                }
                window._solutionRecords.set(solutionRecord.id, solutionRecord);
                console.log('[DEBUG Modal] Solution record created and stored:', {
                    solutionId: solutionRecord.id,
                    solutionName: solutionRecord.fields.Name,
                    parentConceptId: record.id,
                    parentConceptName: record.fields.Name,
                    isSolution: solutionRecord.isSolution,
                    solutionData: solutionRecord.solutionData
                });

                log('Modal', `Navigating to solution: ${solution.name} (from concept: ${record.fields.Name})`);
                showDetailModal(solutionRecord);
            });

            // Edit button for individual solution
            const editBtn = document.createElement('button');
            editBtn.className = 'solution-edit-btn';
            editBtn.innerHTML = '✏️';
            editBtn.title = 'Edit this solution';
            editBtn.style.cssText = 'padding: 6px 10px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 0.9em;';
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Switch to edit mode with just this solution
                if (aiSolutionsEditor) {
                    aiSolutionsEditor.value = JSON.stringify([solution], null, 2);
                    aiSolutionsEditor.dataset.editIndex = index; // Track which solution is being edited
                    setEditMode(true);
                    aiOptionsStatus.textContent = 'Editing solution...';
                    aiOptionsStatus.style.color = '#666';
                }
            });

            // Delete button for individual solution
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'solution-delete-btn';
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.title = 'Remove this solution';
            deleteBtn.style.cssText = 'padding: 6px 10px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 0.9em;';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Remove "${solution.name}" from solutions?`)) {
                    const updatedSolutions = [...(record._generatedSolutions || [])];
                    updatedSolutions.splice(index, 1);
                    record._generatedSolutions = updatedSolutions;
                    renderSolutions(updatedSolutions);
                    aiOptionsStatus.textContent = 'Solution removed.';
                    aiOptionsStatus.style.color = '#666';
                }
            });

            solutionWrapper.appendChild(solutionBadge);
            solutionWrapper.appendChild(editBtn);
            solutionWrapper.appendChild(deleteBtn);
            aiSolutionsContainer.appendChild(solutionWrapper);
        });
    };

    // Display existing solutions if available
    if (isConceptItem && hasExistingSolutions) {
        aiOptionsResult.style.display = 'block';
        renderSolutions(record._generatedSolutions);
        // Show stale indicator if description changed since solutions were generated
        if (solutionsAreStale) {
            aiOptionsStatus.textContent = '⚠️ Item details changed - solutions may be outdated. Click "Re-Find Solutions" to regenerate based on updated description.';
            aiOptionsStatus.style.color = '#856404';
            aiOptionsStatus.style.backgroundColor = '#fff3cd';
            aiOptionsStatus.style.padding = '8px 12px';
            aiOptionsStatus.style.borderRadius = '4px';
            aiOptionsStatus.style.marginTop = '10px';
        }
    }

    // Generate AI options/solutions on click
    aiOptionsBtn.addEventListener('click', async () => {
        aiOptionsBtn.disabled = true;
        aiOptionsResult.style.display = 'block';
        aiOptionsStatus.textContent = '';

        if (isConceptItem) {
            // Generate solutions for concept items
            aiOptionsBtn.textContent = '✨ Finding Solutions...';
            if (aiSolutionsContainer) {
                aiSolutionsContainer.innerHTML = '<div class="solutions-loading">Searching for solutions...</div>';
            }
            // Show loading in edit mode area too
            setEditMode(false);

            try {
                // Log the current record description being used for solution generation
                console.log('[SOLUTIONS] Generating solutions with current record data:', {
                    name: record.fields?.Name,
                    description: record.fields?.Description?.substring(0, 100) + '...',
                    category: record.fields?.Category
                });

                const result = await api.generateConceptSolutions(record);
                if (result.success && result.solutions && result.solutions.length > 0) {
                    // Clear the stale flag since we just regenerated with current data
                    record._solutionsStale = false;
                    delete record._solutionsGeneratedWith;
                    console.log('[SOLUTIONS] Cleared stale flag after successful generation');

                    // Instead of immediately rendering, show in edit mode first for user to modify
                    if (aiSolutionsEditor) {
                        aiSolutionsEditor.value = solutionsToEditableText(result.solutions);
                        delete aiSolutionsEditor.dataset.editIndex; // Clear any single-edit tracking
                    }
                    // Switch to edit mode to let user review/modify before applying
                    setEditMode(true);
                    aiOptionsStatus.textContent = `Found ${result.solutions.length} solutions! Review and edit below, then click "Apply Solutions".`;
                    aiOptionsStatus.style.color = '#17a2b8';
                } else {
                    throw new Error(result.error || 'No solutions found');
                }
            } catch (error) {
                if (aiSolutionsContainer) {
                    aiSolutionsContainer.innerHTML = '';
                }
                setEditMode(false);
                aiOptionsStatus.textContent = `Error: ${error.message}`;
                aiOptionsStatus.style.color = '#dc3545';
                console.error('AI solutions generation failed:', error);
            } finally {
                aiOptionsBtn.disabled = false;
                // Update button text - now without stale indicator since we just regenerated
                aiOptionsBtn.textContent = hasExistingSolutions || record._generatedSolutions?.length > 0
                    ? '✨ Re-Find Solutions'
                    : '✨ Find Solutions';
            }
        } else {
            // Generate options for specific items (existing behavior)
            aiOptionsBtn.textContent = '✨ Estimating...';
            if (aiOptionsEditor) {
                aiOptionsEditor.value = 'Estimating AI recommendations...';
            }

            try {
                const result = await api.generateTopOptions(record);
                if (result.success && result.options) {
                    if (aiOptionsEditor) {
                        aiOptionsEditor.value = result.options;
                    }
                    aiOptionsStatus.textContent = 'Options estimated!';
                    aiOptionsStatus.style.color = '#28a745';
                } else {
                    throw new Error(result.error || 'Failed to estimate options');
                }
            } catch (error) {
                if (aiOptionsEditor) {
                    aiOptionsEditor.value = '';
                }
                aiOptionsStatus.textContent = `Error: ${error.message}`;
                aiOptionsStatus.style.color = '#dc3545';
                console.error('AI options generation failed:', error);
            } finally {
                aiOptionsBtn.disabled = false;
                aiOptionsBtn.textContent = hasExistingOptions ? '✨ Re-Estimate Options' : '✨ Estimate Options';
            }
        }
    });

    // Close button
    aiOptionsCloseBtn.addEventListener('click', () => {
        aiOptionsResult.style.display = 'none';
    });

    // Solutions editing buttons (for concept items)
    // "Edit All" button - switches to edit mode with all solutions
    if (aiSolutionsEditAllBtn) {
        aiSolutionsEditAllBtn.addEventListener('click', () => {
            if (aiSolutionsEditor && record._generatedSolutions) {
                aiSolutionsEditor.value = solutionsToEditableText(record._generatedSolutions);
                delete aiSolutionsEditor.dataset.editIndex; // Clear any single-edit tracking
                setEditMode(true);
                aiOptionsStatus.textContent = 'Edit solutions below, then click "Apply Solutions".';
                aiOptionsStatus.style.color = '#666';
            }
        });
    }

    // "Apply Solutions" button - parses edited JSON and updates solutions
    if (aiSolutionsApplyBtn) {
        aiSolutionsApplyBtn.addEventListener('click', () => {
            const editorText = aiSolutionsEditor?.value;
            if (!editorText?.trim()) {
                aiOptionsStatus.textContent = 'No solutions to apply';
                aiOptionsStatus.style.color = '#dc3545';
                return;
            }

            try {
                const parsedSolutions = parseEditedSolutions(editorText);

                // Check if we're editing a single solution or all solutions
                const editIndex = aiSolutionsEditor?.dataset.editIndex;
                if (editIndex !== undefined && editIndex !== '') {
                    // Single solution edit - merge back into the array
                    const idx = parseInt(editIndex, 10);
                    const existingSolutions = [...(record._generatedSolutions || [])];
                    if (parsedSolutions.length === 1) {
                        existingSolutions[idx] = parsedSolutions[0];
                    } else {
                        // User added more solutions in single-edit mode, splice them in
                        existingSolutions.splice(idx, 1, ...parsedSolutions);
                    }
                    record._generatedSolutions = existingSolutions;
                } else {
                    // Bulk edit - replace all solutions
                    record._generatedSolutions = parsedSolutions;
                }

                // Re-render the badges and switch back to preview mode
                renderSolutions(record._generatedSolutions);
                setEditMode(false);
                aiOptionsStatus.textContent = `Applied ${record._generatedSolutions.length} solutions! Click one to explore.`;
                aiOptionsStatus.style.color = '#28a745';
                log('Modal', `Applied ${record._generatedSolutions.length} edited solutions`);
            } catch (error) {
                aiOptionsStatus.textContent = `Error: ${error.message}`;
                aiOptionsStatus.style.color = '#dc3545';
                console.error('Failed to parse edited solutions:', error);
            }
        });
    }

    // "Cancel" button - switches back to preview mode without saving
    if (aiSolutionsCancelEditBtn) {
        aiSolutionsCancelEditBtn.addEventListener('click', () => {
            setEditMode(false);
            // Re-render existing solutions (if any)
            if (record._generatedSolutions && record._generatedSolutions.length > 0) {
                renderSolutions(record._generatedSolutions);
                aiOptionsStatus.textContent = `${record._generatedSolutions.length} solutions. Click one to explore.`;
                aiOptionsStatus.style.color = '#666';
            } else {
                aiOptionsStatus.textContent = 'Edit cancelled. No solutions applied.';
                aiOptionsStatus.style.color = '#666';
            }
        });
    }

    // "Add Solution" button - adds a template solution to the editor
    if (aiSolutionsAddBtn) {
        aiSolutionsAddBtn.addEventListener('click', () => {
            try {
                const currentText = aiSolutionsEditor?.value?.trim() || '[]';
                let currentSolutions = [];
                try {
                    currentSolutions = JSON.parse(currentText);
                    if (!Array.isArray(currentSolutions)) currentSolutions = [];
                } catch (e) {
                    currentSolutions = [];
                }

                // Add a template solution
                currentSolutions.push({
                    name: "New Solution",
                    description: "Describe this solution...",
                    estimatedPrice: "$0",
                    confidence: "medium",
                    searchTerms: []
                });

                aiSolutionsEditor.value = solutionsToEditableText(currentSolutions);
                aiOptionsStatus.textContent = 'New solution added. Edit and apply when ready.';
                aiOptionsStatus.style.color = '#17a2b8';
            } catch (error) {
                aiOptionsStatus.textContent = 'Error adding solution';
                aiOptionsStatus.style.color = '#dc3545';
            }
        });
    }

    // Apply to item (works for all users - updates locally for this session)
    // Only for non-concept items (product variations)
    if (aiOptionsApplyBtn) {
        aiOptionsApplyBtn.addEventListener('click', () => {
            const optionsText = aiOptionsEditor?.value;
            if (!optionsText?.trim()) {
                aiOptionsStatus.textContent = 'No options to apply';
                aiOptionsStatus.style.color = '#dc3545';
                return;
            }

            // Store options on the record object locally
            record.fields[CONSTANTS.FIELD_NAMES.OPTIONS] = optionsText;
            // Mark that these options were locally generated (for persistence when adding to plan)
            record._locallyGeneratedOptions = optionsText;

            // Also persist the generated options in the plan item info
            // This ensures options survive page reload
            const isLocked = state.cart.lockedItems.has(record.id);
            const isIdea = state.cart.items.has(record.id);

            if (isLocked) {
                const itemInfo = state.cart.lockedItems.get(record.id);
                itemInfo.generatedOptions = optionsText;
                state.cart.lockedItems.set(record.id, itemInfo);
                triggerSave(); // Persist to session
                log('Modal', `Saved generated options for locked item ${record.id}`);
            } else if (isIdea) {
                const itemInfo = state.cart.items.get(record.id);
                itemInfo.generatedOptions = optionsText;
                state.cart.items.set(record.id, itemInfo);
                triggerSave(); // Persist to session
                log('Modal', `Saved generated options for idea item ${record.id}`);
            }

            aiOptionsStatus.textContent = 'Applied! Refreshing...';
            aiOptionsStatus.style.color = '#28a745';

            // Refresh the modal to show the new options
            setTimeout(() => {
                showDetailModal(record);
            }, 500);
        });
    }

    // Save to Catalog (only for authenticated users with publish permission on real records)
    if (aiOptionsSaveCatalogBtn) {
        aiOptionsSaveCatalogBtn.addEventListener('click', async () => {
            const optionsText = aiOptionsEditor?.value;
            if (!optionsText?.trim()) {
                aiOptionsStatus.textContent = 'No options to save';
                aiOptionsStatus.style.color = '#dc3545';
                return;
            }

            aiOptionsSaveCatalogBtn.disabled = true;
            aiOptionsStatus.textContent = 'Saving to catalog...';
            aiOptionsStatus.style.color = '#666';

            try {
                const result = await api.updateItemOptions(record.id, optionsText);
                if (result) {
                    record.fields[CONSTANTS.FIELD_NAMES.OPTIONS] = optionsText;
                    aiOptionsStatus.textContent = 'Saved to catalog!';
                    aiOptionsStatus.style.color = '#28a745';

                    // Refresh the modal
                    setTimeout(() => {
                        showDetailModal(record);
                    }, 1000);
                } else {
                    throw new Error('Failed to save');
                }
            } catch (error) {
                aiOptionsStatus.textContent = 'Error saving. Try again.';
                aiOptionsStatus.style.color = '#dc3545';
                console.error('Error saving options to catalog:', error);
            } finally {
                aiOptionsSaveCatalogBtn.disabled = false;
            }
        });
    }

    modalOptionsContainer.appendChild(aiOptionsContainer);

    // --- THIS IS THE FIX ---\
    // The listeners are now MOVED INSIDE this `if` block
    // Also hide notes for published events - they use the description field for goals/notes instead
    const isEvent = record.fields['Item Type'] === 'Event';
    if (!isGrouping && !isPackage) {
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
                // Update Rapid Pay button text
                const rapidPayBtnPlus = document.getElementById('modal-rapid-pay-btn');
                if (rapidPayBtnPlus && rapidPayBtnPlus._updateText) {
                    rapidPayBtnPlus._updateText();
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
                    // Update Rapid Pay button text
                    const rapidPayBtnMinus = document.getElementById('modal-rapid-pay-btn');
                    if (rapidPayBtnMinus && rapidPayBtnMinus._updateText) {
                        rapidPayBtnMinus._updateText();
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
    } else if (isPackage && packageContents) {
        // Package-specific UI: show headcount selector and package contents
        modalActionsContainer.style.display = 'block';
        modalNotesContainer.style.display = 'none'; // No notes for packages

        // Build package contents display
        const includedItems = packageContents.includedItems || [];
        const addOnItems = packageContents.addOnItems || [];
        const discount = parseFloat(packageMetadata?.discount || 0);

        // Create package contents section in the options container
        let packageContentsHTML = '<div class="package-modal-contents">';
        packageContentsHTML += `<h4 class="package-contents-header">What's Included (${includedItems.length} items)</h4>`;
        packageContentsHTML += '<ul class="package-included-list">';

        for (const itemRef of includedItems) {
            const itemId = itemRef.id || itemRef;
            const itemRecord = getRecordById(itemId);
            if (itemRecord) {
                const itemName = itemRecord.fields[CONSTANTS.FIELD_NAMES.NAME] || 'Unknown Item';
                const itemQty = itemRef.quantity || 1;
                const pricingType = itemRecord.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
                const isPerGuest = pricingType && pricingType.toLowerCase().includes('per guest');
                const qtyLabel = isPerGuest ? '(per guest)' : `x${itemQty}`;
                packageContentsHTML += `<li class="package-item"><span class="package-item-name">${itemName}</span> <span class="package-item-qty">${qtyLabel}</span></li>`;
            }
        }
        packageContentsHTML += '</ul>';

        if (addOnItems.length > 0) {
            packageContentsHTML += `<h4 class="package-contents-header package-addons-header">Available Add-ons (${addOnItems.length})</h4>`;
            packageContentsHTML += '<ul class="package-addon-list">';
            for (const itemRef of addOnItems) {
                const itemId = itemRef.id || itemRef;
                const itemRecord = getRecordById(itemId);
                if (itemRecord) {
                    const itemName = itemRecord.fields[CONSTANTS.FIELD_NAMES.NAME] || 'Unknown Item';
                    packageContentsHTML += `<li class="package-item package-addon-item">${itemName}</li>`;
                }
            }
            packageContentsHTML += '</ul>';
        }

        if (discount > 0) {
            packageContentsHTML += `<div class="package-discount-badge">${discount}% package discount applied</div>`;
        }

        packageContentsHTML += '</div>';
        modalOptionsContainer.innerHTML = packageContentsHTML;

        // Build headcount selector if package has per-guest items
        if (packagePricing && packagePricing.hasPerGuestItems) {
            modalQuantitySelector.innerHTML = `
                <div class="package-headcount-selector modal-package-headcount">
                    <label>Number of Guests:</label>
                    <div class="quantity-selector package-quantity" data-record-id="${record.id}">
                        <button type="button" class="quantity-btn minus" aria-label="Decrease guests">-</button>
                        <input type="number" class="quantity-input package-headcount-input" value="${packageHeadcount}" min="${packageHeadcount}" step="1">
                        <button type="button" class="quantity-btn plus" aria-label="Increase guests">+</button>
                    </div>
                </div>
            `;

            // Add headcount change handler for dynamic price updates
            const headcountInput = modalQuantitySelector.querySelector('.package-headcount-input');
            const plusBtn = modalQuantitySelector.querySelector('.plus');
            const minusBtn = modalQuantitySelector.querySelector('.minus');

            const updatePackageModalPrice = () => {
                const currentHeadcount = parseInt(headcountInput.value, 10) || packageHeadcount;
                const updatedPricing = calculateDynamicPackagePrice(packageContents, packageMetadata, state.records.all, currentHeadcount);

                const perGuestLabel = updatedPricing.hasPerGuestItems ? '<span class="pricing-type"> / per guest pricing</span>' : '';
                let priceText = updatedPricing.totalPrice === 0 ? 'Free' : `$${updatedPricing.totalPrice.toFixed(2)}`;

                if (discount > 0 && updatedPricing.discountAmount > 0) {
                    priceText += ` <span class="package-modal-savings">(Save $${updatedPricing.discountAmount.toFixed(0)})</span>`;
                }

                modalItemPrice.innerHTML = priceText + perGuestLabel;

                // Store current headcount on modal for use when adding to plan
                modalOverlay.dataset.packageHeadcount = currentHeadcount;
            };

            // Initialize stored headcount
            modalOverlay.dataset.packageHeadcount = packageHeadcount;

            if (headcountInput) {
                headcountInput.addEventListener('change', updatePackageModalPrice);
                headcountInput.addEventListener('input', updatePackageModalPrice);
            }

            if (plusBtn && minusBtn) {
                plusBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const currentValue = parseInt(headcountInput.value, 10) || packageHeadcount;
                    headcountInput.value = currentValue + 1;
                    updatePackageModalPrice();
                });

                minusBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const currentValue = parseInt(headcountInput.value, 10) || packageHeadcount;
                    const minValue = parseInt(headcountInput.min, 10) || 1;
                    if (currentValue > minValue) {
                        headcountInput.value = currentValue - 1;
                        updatePackageModalPrice();
                    }
                });
            }
        } else {
            modalQuantitySelector.innerHTML = '';
            modalOverlay.dataset.packageHeadcount = 1;
        }

        // Update Add to Plan button for packages
        if (addToPlanBtn) {
            // Check if this package is already in the plan
            const isPackageInPlan = state.session.activePackages && state.session.activePackages.has(record.id);

            // Also check if any locked items have this package as their source
            let hasPackageItemsInPlan = false;
            for (const [itemId, itemInfo] of state.cart.lockedItems.entries()) {
                if (itemInfo.packageId === record.id) {
                    hasPackageItemsInPlan = true;
                    break;
                }
            }

            const packageAlreadyAdded = isPackageInPlan || hasPackageItemsInPlan;

            addToPlanBtn.textContent = packageAlreadyAdded ? 'Update Plan' : 'Add Package to Plan';
            addToPlanBtn.dataset.tooltip = packageAlreadyAdded ? 'Update plan with any changes' : 'Add all package items to your plan';
            addToPlanBtn.classList.add('add-package-btn');
            addToPlanBtn.dataset.recordId = record.id;
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

    // Get the appropriate z-index based on presentation state
    const isPresentationActive = document.body.classList.contains('presentation-active');
    const modalZIndex = getModalZIndex('detail');

    // DEBUG: Log modal overlay state before activation
    console.log('[Modal DEBUG] Before activation:', {
        overlayId: modalOverlay.id,
        overlayClasses: modalOverlay.className,
        computedDisplay: window.getComputedStyle(modalOverlay).display,
        computedOpacity: window.getComputedStyle(modalOverlay).opacity,
        computedBgColor: window.getComputedStyle(modalOverlay).backgroundColor,
        computedPosition: window.getComputedStyle(modalOverlay).position,
        computedZIndex: window.getComputedStyle(modalOverlay).zIndex,
        deferredCssLoaded: !!document.querySelector('link[href*="deferred.css"][rel="stylesheet"]'),
        criticalCssExists: !!document.querySelector('style'),
        isPresentationActive,
        calculatedZIndex: modalZIndex
    });

    modalOverlay.classList.add('active');
    console.log('[MODAL DEBUG] Detail modal overlay activated (classList.add active)');

    // CRITICAL FIX: Apply essential overlay styles inline to ensure they work
    // even if CSS hasn't fully loaded (direct URL access scenario)
    // Use dynamic z-index based on presentation state (1100 when presentation active, 1000 otherwise)
    modalOverlay.style.cssText = `
        display: flex;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.6);
        z-index: ${modalZIndex};
        justify-content: center;
        align-items: center;
        opacity: 1;
        pointer-events: auto;
    `;

    // Also ensure modal-content has critical styles applied
    const modalContentEl = modalOverlay.querySelector('.modal-content');
    if (modalContentEl) {
        // Check if we're on mobile for responsive styles
        const isMobile = window.innerWidth <= 768;

        // Apply critical modal content styles inline
        if (isMobile) {
            modalContentEl.style.cssText = `
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                width: 90%;
                max-width: 1100px;
                height: auto;
                max-height: 95vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                position: relative;
                color: #333;
                transform: scale(1);
                opacity: 1;
                pointer-events: auto;
            `;
        } else {
            modalContentEl.style.cssText = `
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                width: 90%;
                max-width: 1100px;
                height: 90vh;
                max-height: 700px;
                display: flex;
                overflow: hidden;
                position: relative;
                color: #333;
                transform: scale(1);
                opacity: 1;
                pointer-events: auto;
            `;
        }

        // Apply critical styles to modal columns
        const modalMainColumn = modalContentEl.querySelector('.modal-main-column');
        if (modalMainColumn) {
            if (isMobile) {
                modalMainColumn.style.cssText = `
                    flex: none;
                    height: 250px;
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                `;
            } else {
                modalMainColumn.style.cssText = `
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                `;
            }
        }

        const modalSidebarColumn = modalContentEl.querySelector('.modal-sidebar-column');
        if (modalSidebarColumn) {
            if (isMobile) {
                modalSidebarColumn.style.cssText = `
                    flex: 1;
                    padding: 20px;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                `;
            } else {
                modalSidebarColumn.style.cssText = `
                    flex: 1;
                    padding: 30px;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                `;
            }
        }
    }

    document.body.classList.add('modal-open');

    // DEBUG: Log modal overlay state after activation
    requestAnimationFrame(() => {
        const presentationEl = document.getElementById('presentation-modal-overlay');
        const presentationZIndex = presentationEl ? window.getComputedStyle(presentationEl).zIndex : 'N/A';

        console.log('[Modal DEBUG] After activation (next frame):', {
            overlayClasses: modalOverlay.className,
            computedDisplay: window.getComputedStyle(modalOverlay).display,
            computedOpacity: window.getComputedStyle(modalOverlay).opacity,
            computedBgColor: window.getComputedStyle(modalOverlay).backgroundColor,
            computedPosition: window.getComputedStyle(modalOverlay).position,
            computedZIndex: window.getComputedStyle(modalOverlay).zIndex,
            computedWidth: window.getComputedStyle(modalOverlay).width,
            computedHeight: window.getComputedStyle(modalOverlay).height,
            inlineStyles: modalOverlay.style.cssText,
            isPresentationActive: document.body.classList.contains('presentation-active'),
            presentationZIndex,
            isModalAbovePresentation: parseInt(window.getComputedStyle(modalOverlay).zIndex) > parseInt(presentationZIndex)
        });

        // Check if modal-content is rendered correctly
        const modalContent = modalOverlay.querySelector('.modal-content');
        if (modalContent) {
            console.log('[Modal DEBUG] Modal content styles:', {
                computedBgColor: window.getComputedStyle(modalContent).backgroundColor,
                computedTransform: window.getComputedStyle(modalContent).transform,
                computedOpacity: window.getComputedStyle(modalContent).opacity
            });
        }

        // Additional debug: Check if background-color is actually being rendered
        const overlayBgColor = window.getComputedStyle(modalOverlay).backgroundColor;
        if (overlayBgColor === 'rgba(0, 0, 0, 0)' || overlayBgColor === 'transparent') {
            console.error('[Modal DEBUG] WARNING: Overlay background is transparent! This should not happen.');
        }

        // Z-index layering check
        if (document.body.classList.contains('presentation-active')) {
            const modalZ = parseInt(window.getComputedStyle(modalOverlay).zIndex);
            const presZ = parseInt(presentationZIndex);
            if (modalZ <= presZ) {
                console.error('[Modal DEBUG] WARNING: Modal z-index is NOT above presentation view!', {
                    modalZIndex: modalZ,
                    presentationZIndex: presZ
                });
            } else {
                console.log('[Modal DEBUG] ✓ Modal is correctly above presentation view');
            }
        }
    });

    // DEBUG: Log final modal rendering completion state
    console.log('[MODAL-DEBUG] showDetailModal complete:', {
        recordId: record.id,
        timestamp: performance.now().toFixed(2) + 'ms',
        deferredCssLoadedNow: !!document.querySelector('link[href*="deferred.css"][rel="stylesheet"]'),
        modalOverlayActive: modalOverlay.classList.contains('active'),
        modalContentVisible: !!modalOverlay.querySelector('.modal-content'),
        // Check background page elements to see if they have proper styling
        pageElementStyles: {
            eventPlanPanel: (() => {
                const el = document.getElementById('event-plan-panel');
                if (!el) return 'not found';
                const styles = window.getComputedStyle(el);
                return {
                    backgroundColor: styles.backgroundColor,
                    backdropFilter: styles.backdropFilter || styles.webkitBackdropFilter || 'none',
                    display: styles.display,
                    position: styles.position,
                    visibility: styles.visibility,
                    // Expected from deferred.css: rgba(255, 255, 255, 0.7)
                    hasExpectedBg: styles.backgroundColor.includes('rgba(255, 255, 255') || styles.backgroundColor.includes('255, 255, 255')
                };
            })(),
            filterControls: (() => {
                const el = document.getElementById('filter-controls');
                if (!el) return 'not found';
                const styles = window.getComputedStyle(el);
                return {
                    backgroundColor: styles.backgroundColor,
                    backdropFilter: styles.backdropFilter || styles.webkitBackdropFilter || 'none',
                    display: styles.display,
                    // Expected from deferred.css: rgba(255, 255, 255, 0.7)
                    hasExpectedBg: styles.backgroundColor.includes('rgba(255, 255, 255') || styles.backgroundColor.includes('255, 255, 255')
                };
            })(),
            sidebarContainer: (() => {
                const el = document.getElementById('sidebar-container');
                if (!el) return 'not found';
                const styles = window.getComputedStyle(el);
                return {
                    display: styles.display,
                    width: styles.width,
                    visibility: styles.visibility
                };
            })(),
            header: (() => {
                const el = document.querySelector('header, .header, #header');
                if (!el) return 'not found';
                const styles = window.getComputedStyle(el);
                return {
                    backgroundColor: styles.backgroundColor,
                    position: styles.position
                };
            })(),
            catalogBgColor: (() => {
                const el = document.querySelector('#catalog-container, .catalog-container');
                return el ? window.getComputedStyle(el).backgroundColor : 'not found';
            })()
        }
    });

    // Reset the rendering guard after modal is fully displayed
    isModalRendering = false;
}

/**
 * Show the detail modal for an options group, displaying each item as a selectable option.
 * @param {Object} group - The group object { id, name, description, items: string[] }
 * @param {Object[]} allRecords - All records for looking up item details
 */
export async function showGroupDetailModal(group, allRecords) {
    console.log('[MODAL DEBUG] showGroupDetailModal called. group:', group?.name, 'items:', group?.items?.length);
    if (!group || !group.items || group.items.length === 0) return;

    // Prevent concurrent modal renders
    if (isModalRendering) {
        log('Modal', 'Modal is already rendering, skipping duplicate call');
        return;
    }
    isModalRendering = true;

    log('Modal', `Showing group detail modal for: ${group.name}`);

    const modalHeaderActions = document.getElementById('modal-header-actions');
    const modalItemName = document.getElementById('modal-item-name');
    const modalItemPrice = document.getElementById('modal-item-price');
    const modalItemDescription = document.getElementById('modal-item-description');
    const modalMainImage = document.getElementById('modal-main-image');
    const modalThumbnailStrip = document.getElementById('modal-thumbnail-strip');
    const modalOptionsContainer = document.getElementById('modal-options-container');
    const modalQuantitySelector = document.getElementById('modal-quantity-selector');
    const modalNotesContainer = document.getElementById('modal-notes-container');
    const modalCalendarContainer = document.getElementById('modal-calendar-container');
    const modalActionsContainer = document.getElementById('modal-actions-container');
    const modalBreadcrumbs = document.getElementById('modal-breadcrumbs');
    const modalAdditionalDetails = document.getElementById('modal-additional-details');

    // Reset modal state first
    resetModalState();

    // Set the group name and description
    modalItemName.textContent = group.name || 'Options';
    modalItemDescription.textContent = group.description || 'Choose from the available options below.';

    // Clear sections not needed for group view
    if (modalItemPrice) modalItemPrice.innerHTML = '';
    const priceActionsGroup = document.getElementById('modal-price-actions');
    if (priceActionsGroup) priceActionsGroup.classList.add('hidden');
    const donationMeterGroup = document.getElementById('modal-donation-meter');
    if (donationMeterGroup) donationMeterGroup.style.display = 'none';
    if (modalQuantitySelector) modalQuantitySelector.innerHTML = '';
    if (modalNotesContainer) modalNotesContainer.style.display = 'none';
    if (modalCalendarContainer) modalCalendarContainer.innerHTML = '';
    if (modalActionsContainer) modalActionsContainer.style.display = 'none';
    if (modalAdditionalDetails) modalAdditionalDetails.innerHTML = '';
    if (modalHeaderActions) modalHeaderActions.innerHTML = '';

    // Clear breadcrumbs for group view (this is the top-level group)
    if (modalBreadcrumbs) {
        modalBreadcrumbs.innerHTML = `
            <span class="breadcrumb-current group-breadcrumb-label">📂 Options Group</span>
        `;
    }

    // Build a collage/grid of images from the group's items
    const imageUrls = [];
    const groupRecords = [];
    for (const itemId of group.items) {
        const record = allRecords.find(r => r.id === itemId);
        if (record) {
            groupRecords.push(record);
            // Get images from cache or fetch
            if (window.itemImagesCache && window.itemImagesCache.has(itemId)) {
                const cached = window.itemImagesCache.get(itemId);
                if (cached.images && cached.images.length > 0) {
                    imageUrls.push(cached.images[cached.currentIndex || 0]);
                }
            } else {
                try {
                    const { imageUrls: fetched } = await api.fetchImagesForRecord(record, allRecords, new Map());
                    if (fetched && fetched.length > 0) {
                        imageUrls.push(fetched[0]);
                        if (window.itemImagesCache) {
                            window.itemImagesCache.set(itemId, { images: fetched, currentIndex: 0 });
                        }
                    }
                } catch (err) {
                    console.warn('Failed to fetch images for group item:', itemId, err);
                }
            }
        }
    }

    // Show a grid of images in the main image area
    if (modalMainImage) {
        if (imageUrls.length > 0) {
            const gridClass = imageUrls.length === 1 ? 'single' : imageUrls.length === 2 ? 'two' : 'multi';
            modalMainImage.innerHTML = `
                <div class="group-modal-image-grid ${gridClass}">
                    ${imageUrls.slice(0, 4).map(url => `
                        <div class="group-modal-image-cell" style="background-image: url('${url}');"></div>
                    `).join('')}
                </div>
            `;
        } else {
            modalMainImage.innerHTML = `
                <div class="group-modal-image-placeholder">
                    <span class="group-modal-image-placeholder-icon">📂</span>
                    <span>Options Group</span>
                </div>
            `;
        }
    }
    if (modalThumbnailStrip) modalThumbnailStrip.innerHTML = '';

    // Build the options list - each item as a clickable option card
    if (modalOptionsContainer) {
        const optionCardsHTML = groupRecords.map((record, idx) => {
            const name = record.fields.Name || 'Untitled';
            const desc = record.fields.Description || '';
            const truncDesc = desc.length > 80 ? desc.substring(0, 80) + '...' : desc;
            const price = record.fields.Price ? `$${parseFloat(record.fields.Price).toFixed(2)}` : '';
            const imgUrl = imageUrls[idx] || '';
            const imgStyle = imgUrl ? `background-image: url('${imgUrl}');` : '';

            return `
                <div class="group-option-card" data-record-id="${record.id}" data-group-id="${group.id}" role="button" tabindex="0">
                    <div class="group-option-card-image" style="${imgStyle}">
                        ${!imgUrl ? '<span class="group-option-card-no-img">📷</span>' : ''}
                    </div>
                    <div class="group-option-card-info">
                        <div class="group-option-card-name">${name}</div>
                        ${truncDesc ? `<div class="group-option-card-desc">${truncDesc}</div>` : ''}
                        ${price ? `<div class="group-option-card-price">${price}</div>` : ''}
                    </div>
                    <button class="group-option-card-remove" data-record-id="${record.id}" data-group-id="${group.id}" title="Remove from group">✕</button>
                    <div class="group-option-card-arrow">→</div>
                </div>
            `;
        }).join('');

        modalOptionsContainer.innerHTML = `
            <div class="group-options-container">
                <div class="group-options-label">${group.items.length} options available</div>
                ${optionCardsHTML}
                <button class="group-dissolve-modal-btn" data-group-id="${group.id}">Ungroup All</button>
            </div>
        `;

        // Add click handlers for option cards
        const optionCards = modalOptionsContainer.querySelectorAll('.group-option-card');
        optionCards.forEach(card => {
            card.addEventListener('click', (e) => {
                // Don't navigate if clicking the remove button
                if (e.target.closest('.group-option-card-remove')) return;
                e.stopPropagation();
                const recordId = card.dataset.recordId;
                const record = allRecords.find(r => r.id === recordId);
                if (record) {
                    log('Modal', `Navigating to option item: ${record.fields.Name}`);
                    // Open item detail with group breadcrumb context
                    showDetailModal(record, 0, group);
                }
            });
            // Keyboard support
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    card.click();
                }
            });
        });

        // Add remove-from-group button handlers
        const removeBtns = modalOptionsContainer.querySelectorAll('.group-option-card-remove');
        removeBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const recordId = btn.dataset.recordId;
                const groupId = btn.dataset.groupId;
                if (recordId && groupId && state.session.relatedGroups) {
                    const grp = state.session.relatedGroups.find(g => g.id === groupId);
                    if (!grp) return;
                    const items = Array.isArray(grp) ? grp : (grp.items || []);
                    const itemIndex = items.indexOf(recordId);
                    if (itemIndex === -1) return;
                    items.splice(itemIndex, 1);

                    const removedRecord = allRecords.find(r => r.id === recordId);
                    const removedName = removedRecord?.fields?.Name || 'Item';

                    // If fewer than 2 items remain, dissolve the group
                    if (items.length < 2) {
                        state.session.relatedGroups = state.session.relatedGroups.filter(g => g.id !== groupId);
                        hideDetailModal();
                        window.dispatchEvent(new CustomEvent('groupDissolved', { detail: { groupId } }));
                    } else {
                        if (!Array.isArray(grp)) {
                            grp.items = items;
                        }
                        // Re-render the modal with updated group
                        hideDetailModal();
                        window.dispatchEvent(new CustomEvent('groupItemRemoved', { detail: { groupId, recordId } }));
                    }
                }
            });
        });

        // Add dissolve/ungroup button handler
        const dissolveBtn = modalOptionsContainer.querySelector('.group-dissolve-modal-btn');
        if (dissolveBtn) {
            dissolveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const groupId = dissolveBtn.dataset.groupId;
                if (groupId && state.session.relatedGroups) {
                    state.session.relatedGroups = state.session.relatedGroups.filter(g => g.id !== groupId);
                    hideDetailModal();
                    // Trigger re-render (the presentation module will handle this via event)
                    window.dispatchEvent(new CustomEvent('groupDissolved', { detail: { groupId } }));
                }
            });
        }
    }

    // Show the modal
    const modalZIndex = getModalZIndex('detail');

    modalOverlay.classList.add('active');
    modalOverlay.style.cssText = `
        display: flex;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.6);
        z-index: ${modalZIndex};
        justify-content: center;
        align-items: center;
        opacity: 1;
        pointer-events: auto;
    `;

    const modalContentEl = modalOverlay.querySelector('.modal-content');
    if (modalContentEl) {
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            modalContentEl.style.cssText = `
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                width: 90%;
                max-width: 1100px;
                height: auto;
                max-height: 95vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                position: relative;
                color: #333;
                transform: scale(1);
                opacity: 1;
                pointer-events: auto;
            `;
        } else {
            modalContentEl.style.cssText = `
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                width: 90%;
                max-width: 1100px;
                height: 90vh;
                max-height: 700px;
                display: flex;
                overflow: hidden;
                position: relative;
                color: #333;
                transform: scale(1);
                opacity: 1;
                pointer-events: auto;
            `;
        }
    }

    document.body.classList.add('modal-open');

    // Set up close handlers
    const closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) {
        closeBtn.onclick = closeDetailModal;
    }
    modalOverlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleEscapeKey);

    // Hide search photos container
    const searchPhotosContainer = document.getElementById('modal-search-photos-container');
    if (searchPhotosContainer) searchPhotosContainer.style.display = 'none';

    // Hide set cover photo container
    const setCoverPhotoContainer = document.getElementById('set-cover-photo-container');
    if (setCoverPhotoContainer) setCoverPhotoContainer.style.display = 'none';

    isModalRendering = false;
}

export function hideDetailModal() {
    console.log('[MODAL DEBUG] hideDetailModal called. modalOverlay:', !!modalOverlay, 'isActive:', modalOverlay?.classList?.contains('active'));
    // Reset the rendering guard when modal is closed
    isModalRendering = false;

    // Refresh presentation carousel if images may have been updated
    const recordId = modalOverlay?.dataset?.recordId;
    if (recordId && typeof window.itemImagesCache !== 'undefined' && window.itemImagesCache.has(recordId)) {
        const cached = window.itemImagesCache.get(recordId);
        const carousel = document.querySelector(`.itinerary-media-carousel[data-record-id="${recordId}"]`);
        if (carousel && cached && cached.images && cached.images.length > 0) {
            // Check if the carousel needs re-rendering (e.g., new images were added)
            const currentThumbnailCount = carousel.querySelectorAll('.itinerary-thumbnail').length;
            if (currentThumbnailCount !== cached.images.length || cached.images.length === 1) {
                // Re-render the carousel with updated images
                const currentIndex = cached.currentIndex || 0;
                const thumbnails = cached.images.map((url, index) =>
                    `<div class="itinerary-thumbnail ${index === currentIndex ? 'active' : ''}"
                          data-record-id="${recordId}"
                          data-index="${index}"
                          style="background-image: url('${url}')"></div>`
                ).join('');

                const newCarouselHTML = `
                    <div class="itinerary-media-carousel" data-record-id="${recordId}">
                        <div class="itinerary-main-image" style="background-image: url('${cached.images[currentIndex]}')"></div>
                        ${cached.images.length > 1 ? `
                            <div class="itinerary-thumbnails">${thumbnails}</div>
                        ` : ''}
                    </div>
                `;
                carousel.outerHTML = newCarouselHTML;
                console.log('[Modal DEBUG] Re-rendered presentation carousel with updated images');
            }
        }
    }

    const closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) {
        closeBtn.onclick = null;
    }
    modalOverlay.removeEventListener('click', handleOverlayClick);
    document.removeEventListener('keydown', handleEscapeKey);

    // --- SEO: Reset all SEO meta tags and schema markup ---
    resetSeoMetadata();
    resetSchema();
    // --- END SEO ---

    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        setTimeout(() => {
            // Clear inline styles that were set for the direct URL access fix
            modalOverlay.style.cssText = '';
            modalOverlay.style.display = 'none';

            // Also clear modal-content and column inline styles
            const modalContentEl = modalOverlay.querySelector('.modal-content');
            if (modalContentEl) {
                modalContentEl.style.cssText = '';

                const modalMainColumn = modalContentEl.querySelector('.modal-main-column');
                if (modalMainColumn) {
                    modalMainColumn.style.cssText = '';
                }

                const modalSidebarColumn = modalContentEl.querySelector('.modal-sidebar-column');
                if (modalSidebarColumn) {
                    modalSidebarColumn.style.cssText = '';
                }
            }

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
        const lockedRecord = getRecordById(id);
        if (lockedRecord && lockedRecord.fields.Name && lockedRecord.fields.Name.includes("Union Machine Works")) {
            isUmwInPlan = true;
            break;
        }
    }

    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = getRecordById(recordId);
        if (!record) continue;

        // Use selections if available, otherwise fall back to selectedOptionIndex
        const priceParam = (itemInfo.selections && Object.keys(itemInfo.selections).length > 0)
            ? itemInfo.selections
            : itemInfo.selectedOptionIndex;
        const price = itemInfo.overridePrice ?? getRecordPrice(record, priceParam);

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

        // Get the appropriate z-index based on presentation state
        const isPresentationActive = document.body.classList.contains('presentation-active');
        const checkoutZIndex = getModalZIndex('checkout');

        console.log('[Checkout Modal DEBUG] Before activation:', {
            isPresentationActive,
            calculatedZIndex: checkoutZIndex
        });

        // --- 8. Show Modal ---\
        checkoutModalOverlay.classList.add('active');
        setTimeout(() => {
            // Apply inline styles with proper z-index for presentation mode
            checkoutModalOverlay.style.cssText = `
                display: flex;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.6);
                z-index: ${checkoutZIndex};
                justify-content: center;
                align-items: center;
                opacity: 1;
                pointer-events: auto;
            `;
            if(checkoutCloseBtn) checkoutCloseBtn.focus();

            // DEBUG: Log z-index after showing
            requestAnimationFrame(() => {
                const presentationEl = document.getElementById('presentation-modal-overlay');
                const presentationZIndex = presentationEl ? window.getComputedStyle(presentationEl).zIndex : 'N/A';
                console.log('[Checkout Modal DEBUG] After activation:', {
                    computedZIndex: window.getComputedStyle(checkoutModalOverlay).zIndex,
                    isPresentationActive: document.body.classList.contains('presentation-active'),
                    presentationZIndex,
                    isModalAbovePresentation: parseInt(window.getComputedStyle(checkoutModalOverlay).zIndex) > parseInt(presentationZIndex)
                });
            });
        }, 0);
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
            // Clear inline styles that were set for presentation mode z-index fix
            checkoutModalOverlay.style.cssText = '';
            checkoutModalOverlay.style.display = 'none';
            log('Modal', 'Checkout modal hidden.');
        }, 300);
        document.body.classList.remove('modal-open');
    }
}

export function getStripeContext() {
    return { stripe, elements };
}
