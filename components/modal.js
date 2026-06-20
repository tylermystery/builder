// REPLACE THE ENTIRE CONTENTS of components/modal.js
console.log('[MODULE DEBUG] modal.js module starting to load...', performance.now().toFixed(2) + 'ms');

import { state, getRecordById, getAggregateReactions, invalidateRecordsIndex } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY, getModalZIndex, EMOJI_TIERS, REACTION_SCORES, EMOJI_REACTIONS, BASE_CATEGORIES, TAG_GROUPS, computeDemocraticAverage, scoreToAdjective } from '../config.js';
import { getCurrentUser } from '../chat.js';
import { parseOptions, updateUrl, getGroupPriceRange, getRecordPrice, getActiveImageTag, getRecordDescription, flattenOptionGroups, debounce, loadStripe, preloadStripe, loadFlatpickr, getEffectiveMinQuantity, generateSlug, calculateDynamicPackagePrice, getPackageDefaultHeadcount, storeSlug, getShopUrlParam, formatItemSchedule, getTimeUnitMinutes, computeEndFromStartDuration, formatEventTimeRange, getTempRsvps, encodeSelections } from '../utils.js';
import { log } from '../utils/debug.js';
import { getDayStatus, AVAILABILITY_STATUS, logBusyTimeSummary, describeSelectedAvailability } from '../availability.js';
import { showReceiptModal } from './receipt.js';
import { applyCloudinaryTransform } from '../utils/imageOptimizer.js';
import { resizeImageForUpload } from '../utils/imageResizer.js';
import { triggerSave } from '../events.js';
import { createCalendarExportButtons, initializeCalendarExportListeners, resolvePlanVenueAddress } from '../utils/calendarExport.js';
import { openUCPForItem, openUCPGlobalForItem } from './unifiedChatPanel.js';
import { requestVitalityRecalc } from '../vitality/vitalityEngine.js';
import { showGoodnessReport, updateModalVitalityBadge, isVitalityUIDormant } from '../vitality/vitalityUI.js';
import { openActionMenu } from './actionMenu.js';
import { syncPlanState as syncPlanStateAcrossViews } from '../utils/planStateSync.js';
import { getCommunityRowForRecord, toggleCommunityReactionForRecord, isPublicIdeaRecord } from './publicCatalog.js';
import { ensureStorePromotionsLoaded, bestDisplayPromoForItem, rewardLabel, promoTimingHint, quoteCart } from '../utils/promotions-client.js';

// Decorate the detail-modal price with an active promotion (struck-through
// original + discounted price + a small deal line). Best-effort and async: if
// no deal applies, or anything fails, the price is left exactly as rendered.
async function decorateModalPriceWithPromo(record, basePriceCents) {
    try {
        const el = document.getElementById('modal-item-price');
        if (!el || typeof basePriceCents !== 'number' || basePriceCents <= 0) return;
        const fields = record.fields || {};
        const storeIds = Array.isArray(fields.Stores) ? fields.Stores : (fields.Stores ? [fields.Stores] : []);
        if (storeIds.length === 0) return;
        await Promise.all(storeIds.map(s => ensureStorePromotionsLoaded(s)));
        const catRaw = fields[CONSTANTS.FIELD_NAMES.CATEGORIES];
        const categories = Array.isArray(catRaw) ? catRaw : (typeof catRaw === 'string' ? catRaw.split(',') : []);
        const best = bestDisplayPromoForItem({ itemId: record.id, storeIds, categories, basePriceCents });
        if (!best) return;
        // Remove a stale promo line from a previous open.
        document.getElementById('modal-promo-line')?.remove();
        const label = rewardLabel(best.promo);
        const hint = promoTimingHint(best.promo);
        const left = (best.remaining !== null && best.remaining !== undefined) ? ` · ${best.remaining} left` : '';
        if (best.eligible && best.discountCents > 0) {
            const orig = `$${(basePriceCents / 100).toFixed(2)}`;
            const now = `$${(best.discountedCents / 100).toFixed(2)}`;
            el.innerHTML = `<span class="price-original">${orig}</span> <span class="price-discounted">${now}</span>`;
        }
        const line = document.createElement('div');
        line.id = 'modal-promo-line';
        line.className = 'modal-promo-line';
        line.innerHTML = `<span class="promo-badge" style="position:static">${label}</span><span>${best.promo.name || ''}${hint ? ' — ' + hint : ''}${left}</span>`;
        el.insertAdjacentElement('afterend', line);
    } catch (e) { /* leave price untouched on any error */ }
}

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
    const activeShop = state.stores.all.find(s => s.id === state.ui.activeShopId);
    const shopName = activeShop?.fields?.Name || '';
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    document.title = eventName || (shopName ? `${shopName} WTFun` : 'WTFun');
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
let currentPaymentIntentId = null;
let currentBaseAmount = 0; // To store the amount *before* fees
let currentPaymentType = 'card'; // <-- ADD THIS LINE
let currentProcessingFee = 0; // To store the current fee

let currentShopSettings = {};
let currentChipInAmount = 0; // Chip-in community contribution amount
let currentCheckoutScope = null; // { mode: 'plan' | 'item', itemId, itemName, quantity, price, record, highlightChipIn }
let currentCheckoutIsFree = false; // True when the plan total is $0 — checkout becomes a no-payment registration

// --- Promotion / discount checkout state -----------------------------------
// The server is authoritative for the discount: /api/promotions/quote returns a
// signed token, create-payment-intent applies it. These just carry the current
// token + amount so a payment-method switch keeps the same deal, and the UI can
// show the discount line. Zero/null here means "no deal" and checkout behaves
// exactly as it did before promotions existed.
let currentDiscountToken = null;
let currentDiscountInCents = 0;
let currentDiscountName = 'Discount';

// Build the cart lines a promotion can be quoted against. Only used when the
// full item subtotal is being charged (item purchases / full upfront payment) —
// deposits and remaining-balance payments are intentionally left untouched.
// Best-effort: returns [] on anything unexpected so checkout never breaks.
function buildPromotableCartLines(quoteStoreId) {
    try {
        const lines = [];
        const toLine = (record, unitPrice, qty, itemDate) => {
            if (!record) return null;
            const fields = record.fields || {};
            const storeIds = Array.isArray(fields.Stores) ? fields.Stores : (fields.Stores ? [fields.Stores] : []);
            const primaryStore = storeIds.includes(quoteStoreId) ? quoteStoreId : (storeIds[0] || quoteStoreId || null);
            const catRaw = fields[CONSTANTS.FIELD_NAMES.CATEGORIES];
            const categories = Array.isArray(catRaw) ? catRaw : (typeof catRaw === 'string' ? catRaw.split(',') : []);
            return {
                itemId: record.id,
                storeId: primaryStore,
                categories,
                unitPriceCents: Math.round((Number(unitPrice) || 0) * 100),
                quantity: Number(qty) || 1,
                eventDate: itemDate || null,
            };
        };

        if (currentCheckoutScope && currentCheckoutScope.mode === 'item') {
            const s = currentCheckoutScope;
            const l = toLine(s.record, s.price, s.quantity, s.itemDate || s.eventDate);
            if (l) lines.push(l);
        } else {
            const locked = state.cart && state.cart.lockedItems;
            if (locked && typeof locked.forEach === 'function') {
                locked.forEach((info, recordId) => {
                    const record = getRecordById(recordId);
                    if (!record) return;
                    const priceParam = (info.selections && Object.keys(info.selections).length > 0)
                        ? info.selections : info.selectedOptionIndex;
                    const unit = (info.overridePrice != null) ? info.overridePrice : getRecordPrice(record, priceParam);
                    const l = toLine(record, unit, info.quantity, info.itemDate);
                    if (l) lines.push(l);
                });
            }
        }
        return lines;
    } catch (e) {
        return [];
    }
}

// Insert/update/remove the "discount" line in the checkout summary, just above
// the processing-fee row. No-op-safe if the expected layout isn't found.
function renderCheckoutDiscountRow(discountInCents, name) {
    const existing = document.getElementById('checkout-discount-row');
    if (!(discountInCents > 0)) { if (existing) existing.remove(); return; }
    const html = `<span>${name || 'Discount'}</span><span>-$${(discountInCents / 100).toFixed(2)}</span>`;
    if (existing) { existing.innerHTML = html; return; }
    const feeEl = document.getElementById('processing-fee-price');
    const feeRow = feeEl ? feeEl.closest('div') : null;
    if (!feeRow || !feeRow.parentElement) return;
    const row = document.createElement('div');
    row.id = 'checkout-discount-row';
    row.className = 'checkout-discount-row';
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 0;';
    row.innerHTML = html;
    feeRow.parentElement.insertBefore(row, feeRow);
}
let currentCheckoutItemQty = 0; // Tracks quantity in chip-in checkout (0 = donation only)
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
 * Payment app configuration with icons and URL generators.
 *
 * Recognized keys in `App_Pay_JSON`: `zelle`, `venmo`, `cashapp`, `paypal`, `check`.
 * Any other key is rendered as a generic copy-to-clipboard "manual entry" via
 * `getPaymentAppConfig` below, so the JSON is open-ended.
 *
 * Value shape per key:
 *   - string — the handle / username / instructions text (most common)
 *   - object — `{ instructions: string, url?: string }` for entries that need
 *     both copyable text and a clickable link
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
    check: {
        name: 'Check',
        icon: '✓',
        cssClass: 'check',
        // Checks are paid offline; no deep link, copy the instructions for the customer.
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

/**
 * Resolves a payment-method config for a given `App_Pay_JSON` key.
 * Returns the first-class entry from `PAYMENT_APPS` when one exists, otherwise
 * synthesizes a generic copy-to-clipboard config so unknown keys still render
 * as a usable manual-entry button instead of being silently skipped.
 *
 * @param {string} key - Raw key from `App_Pay_JSON` (case-insensitive)
 * @returns {object} Payment app config with name/icon/cssClass and getters
 */
function getPaymentAppConfig(key) {
    const lowerKey = String(key || '').toLowerCase();
    if (PAYMENT_APPS[lowerKey]) return PAYMENT_APPS[lowerKey];

    const rawKey = String(key || '');
    const displayName = rawKey.charAt(0).toUpperCase() + rawKey.slice(1).toLowerCase();
    const iconChar = (displayName.charAt(0) || '?').toUpperCase();

    // Allow object values shaped like { instructions, url } for the manual-entry fallback.
    const extractText = (handle) => {
        if (handle && typeof handle === 'object') {
            return handle.instructions || handle.url || '';
        }
        return String(handle || '');
    };
    const extractUrl = (handle) => {
        if (handle && typeof handle === 'object' && handle.url) return handle.url;
        return null;
    };

    return {
        name: displayName,
        icon: iconChar,
        cssClass: 'generic',
        getUrl: (handle) => extractUrl(handle),
        getDisplayHandle: (handle) => extractText(handle),
        getCopyText: (handle, amount, itemName) => {
            const base = extractText(handle);
            if (amount && amount > 0) {
                return `${base}${base ? ' - ' : ''}Amount: $${amount.toFixed(2)}${itemName ? ` for ${itemName}` : ''}`;
            }
            return base;
        }
    };
}

/**
 * Serializes a handle value (string or object) for storage in a dataset attribute.
 * Object values come from the generic-fallback `{ instructions, url }` shape.
 */
function serializeHandle(handle) {
    return handle && typeof handle === 'object' ? JSON.stringify(handle) : String(handle ?? '');
}

/**
 * Inverse of serializeHandle — restores objects when the stored value is JSON.
 */
function deserializeHandle(serialized) {
    if (typeof serialized !== 'string') return serialized;
    const trimmed = serialized.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { return JSON.parse(trimmed); } catch { /* fall through */ }
    }
    return serialized;
}

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
            const handleRaw = btn.dataset.handle;
            if (!appKey || handleRaw === undefined) return;

            const appConfig = getPaymentAppConfig(appKey);
            const handle = deserializeHandle(handleRaw);

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
            // Skip empty values, but allow any key — unknown keys get a generic
            // manual-entry config from getPaymentAppConfig.
            const isEmpty = handle === null || handle === undefined || handle === ''
                || (typeof handle === 'object' && !handle.instructions && !handle.url);
            if (isEmpty) continue;

            const appConfig = getPaymentAppConfig(key);

            const url = appConfig.getUrl(handle, amount, itemName);
            const displayHandle = appConfig.getDisplayHandle(handle);

            const optionElement = document.createElement(url ? 'a' : 'div');
            optionElement.className = 'quick-pay-option-btn';
            // Store data attributes for tip updates
            optionElement.dataset.appKey = key.toLowerCase();
            optionElement.dataset.handle = serializeHandle(handle);
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
 * Renders P2P payment option buttons into the checkout modal's P2P section.
 * Called during showCheckoutModal initialization.
 * @param {Object} paymentOptions - Parsed App_Pay_JSON object from store
 * @param {number} amount - Total amount to display
 * @param {string} itemName - Description/name for the payment
 */
function renderCheckoutP2POptions(paymentOptions, amount, itemName) {
    const p2pContainer = document.getElementById('checkout-p2p-options');
    if (!p2pContainer) return;

    p2pContainer.innerHTML = '';
    // New checkout session for these options — allow registration to run once
    // when the visitor proceeds with a direct-pay option (see events.js).
    delete p2pContainer.dataset.registered;
    if (!paymentOptions || Object.keys(paymentOptions).length === 0) {
        return;
    }

    for (const [key, handle] of Object.entries(paymentOptions)) {
        const isEmpty = handle === null || handle === undefined || handle === ''
            || (typeof handle === 'object' && !handle.instructions && !handle.url);
        if (isEmpty) continue;

        const appConfig = getPaymentAppConfig(key);

        const url = appConfig.getUrl(handle, amount, itemName);
        const displayHandle = appConfig.getDisplayHandle(handle);

        const optionElement = document.createElement(url ? 'a' : 'div');
        optionElement.className = 'quick-pay-option-btn';
        optionElement.dataset.appKey = key.toLowerCase();
        optionElement.dataset.handle = serializeHandle(handle);
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

        // For Zelle (no URL), add copy functionality
        if (!url) {
            optionElement.style.cursor = 'pointer';
            optionElement.title = 'Click to copy payment details';
            optionElement.addEventListener('click', () => {
                const currentAmount = parseFloat(optionElement.dataset.amount) || amount;
                const copyText = appConfig.getCopyText ? appConfig.getCopyText(handle, currentAmount, itemName) : handle;
                navigator.clipboard.writeText(copyText).then(() => {
                    const originalArrow = optionElement.querySelector('.quick-pay-arrow');
                    originalArrow.textContent = 'Copied!';
                    setTimeout(() => { originalArrow.textContent = ''; }, 2000);
                }).catch(err => console.error('Failed to copy:', err));
            });
        }

        p2pContainer.appendChild(optionElement);
    }
}

/**
 * Updates P2P payment links in the checkout modal with a new amount.
 * Called whenever the total changes (tip, chip-in, etc.)
 * @param {number} amount - New total amount
 */
function updateP2PPaymentLinks(amount) {
    const p2pContainer = document.getElementById('checkout-p2p-options');
    if (!p2pContainer) return;

    const paymentBtns = p2pContainer.querySelectorAll('.quick-pay-option-btn');
    paymentBtns.forEach(btn => {
        const appKey = btn.dataset.appKey;
        const handleRaw = btn.dataset.handle;
        if (!appKey || handleRaw === undefined) return;

        const appConfig = getPaymentAppConfig(appKey);
        const handle = deserializeHandle(handleRaw);

        const itemName = currentCheckoutScope?.itemName || 'Plan Checkout';
        const url = appConfig.getUrl(handle, amount, itemName);
        if (url) {
            btn.href = url;
        }
        btn.dataset.amount = amount.toFixed(2);
    });

    // Update the amount display
    const p2pAmountEl = document.getElementById('checkout-p2p-amount');
    if (p2pAmountEl) {
        p2pAmountEl.textContent = `$${amount.toFixed(2)}`;
    }
}

/**
 * Sets up the Chip In section in the checkout modal.
 * Initializes option buttons, preset amounts, and custom input handlers.
 * @param {number} cartSubtotal - The cart subtotal to use for "Match My Cart"
 */
function setupCheckoutChipIn(cartSubtotal) {
    const chipInSection = document.getElementById('checkout-chip-in-section');
    if (!chipInSection) return;

    // Reset state
    currentChipInAmount = 0;

    // Show the section
    chipInSection.style.display = 'block';

    // Set the match amount display
    const matchAmountEl = document.getElementById('chip-in-match-amount');
    if (matchAmountEl) {
        matchAmountEl.textContent = `+$${cartSubtotal.toFixed(2)}`;
    }

    // Get UI elements
    const optionBtns = chipInSection.querySelectorAll('.checkout-chip-in-option-btn');
    const customInputContainer = document.getElementById('checkout-chip-in-custom-input');
    const customAmountInput = document.getElementById('checkout-chip-in-amount');
    const chipInSummary = document.getElementById('checkout-chip-in-summary');
    const chipInTotalEl = document.getElementById('checkout-chip-in-total');
    const presetBtns = chipInSection.querySelectorAll('.chip-in-preset-btn');

    // Helper to update chip-in amount and refresh checkout display
    const setChipInAmount = (amount) => {
        currentChipInAmount = amount;
        if (chipInSummary) {
            chipInSummary.style.display = amount > 0 ? 'flex' : 'none';
        }
        if (chipInTotalEl) {
            chipInTotalEl.textContent = `$${amount.toFixed(2)}`;
        }
        updateCheckoutDisplay();
    };

    // Option button handlers (Match / Chip In / Skip)
    optionBtns.forEach(btn => {
        // Clone to remove old listeners
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', () => {
            // Update active states
            chipInSection.querySelectorAll('.checkout-chip-in-option-btn').forEach(b => b.classList.remove('active'));
            newBtn.classList.add('active');

            const chipInType = newBtn.dataset.chipIn;

            if (chipInType === 'match') {
                // Match full cart
                if (customInputContainer) customInputContainer.style.display = 'none';
                setChipInAmount(cartSubtotal);
            } else if (chipInType === 'custom') {
                // Show custom input
                if (customInputContainer) customInputContainer.style.display = 'block';
                const currentCustom = parseFloat(customAmountInput?.value) || 0;
                setChipInAmount(currentCustom);
            } else {
                // Skip
                if (customInputContainer) customInputContainer.style.display = 'none';
                setChipInAmount(0);
            }
        });
    });

    // Preset amount buttons
    presetBtns.forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', () => {
            chipInSection.querySelectorAll('.chip-in-preset-btn').forEach(b => b.classList.remove('active'));
            newBtn.classList.add('active');

            const presetAmount = parseFloat(newBtn.dataset.amount);
            if (customAmountInput) customAmountInput.value = presetAmount.toFixed(2);
            setChipInAmount(presetAmount);
        });
    });

    // Custom amount input handler
    if (customAmountInput) {
        const newInput = customAmountInput.cloneNode(true);
        customAmountInput.parentNode.replaceChild(newInput, customAmountInput);

        newInput.addEventListener('input', debounce(() => {
            // Clear preset button active states when typing custom amount
            chipInSection.querySelectorAll('.chip-in-preset-btn').forEach(b => b.classList.remove('active'));
            const customAmount = parseFloat(newInput.value) || 0;
            setChipInAmount(customAmount);
        }, 300));
    }

    // Ensure default state: Skip is active, custom input hidden, amount = 0
    if (customInputContainer) customInputContainer.style.display = 'none';
    if (chipInSummary) chipInSummary.style.display = 'none';

    // Accordion: collapse the Community Fund by default and wire up the toggle.
    // Callers that want it open (e.g. the Chip In flow) expand it after setup.
    chipInSection.classList.remove('expanded');
    const toggleBtn = document.getElementById('checkout-chip-in-toggle');
    if (toggleBtn) {
        // Clone to remove old listeners
        const newToggle = toggleBtn.cloneNode(true);
        toggleBtn.parentNode.replaceChild(newToggle, toggleBtn);
        newToggle.setAttribute('aria-expanded', 'false');
        newToggle.addEventListener('click', () => {
            const expanded = chipInSection.classList.toggle('expanded');
            newToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        });
    }
}

/**
 * Updates the checkout item quantity display when +/- buttons are clicked.
 * Recalculates item total, updates the cart summary and the full total, then
 * refreshes the checkout display (fees, payment intent, etc.).
 * @param {Object} scope - The checkout scope (item mode)
 */
function buildItemOptionDetailsHtml(scope) {
    if (!scope || !scope.record) return '';
    const optionGroups = parseOptions(scope.record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    if (!optionGroups || optionGroups.length === 0) return '';

    const optionLines = [];
    // Prefer the full selections object (supports multiple groups / multi-select)
    if (scope.selections && Object.keys(scope.selections).length > 0) {
        const sortedKeys = Object.keys(scope.selections).sort((a, b) => {
            return (parseInt(a.replace('group', ''), 10) || 0) - (parseInt(b.replace('group', ''), 10) || 0);
        });
        for (const groupKey of sortedKeys) {
            const optionValue = scope.selections[groupKey];
            const groupIndexMatch = groupKey.match(/^group(\d+)$/);
            if (!groupIndexMatch) continue;
            const groupIndex = parseInt(groupIndexMatch[1], 10);
            const group = optionGroups[groupIndex];
            if (!group || !group.options) continue;
            const optionIndices = Array.isArray(optionValue) ? optionValue : [optionValue];
            for (const optIdx of optionIndices) {
                const option = group.options[optIdx];
                if (!option || !option.name) continue;
                const groupLabel = group.name && group.name !== 'Options' ? `${group.name}: ` : '';
                optionLines.push(`${groupLabel}${option.name}`);
            }
        }
    } else if (scope.selectedOptionIndex != null) {
        // Legacy fallback: single flat option index
        const flatOptions = flattenOptionGroups(optionGroups);
        const option = flatOptions[scope.selectedOptionIndex];
        if (option && option.name) {
            optionLines.push(option.name);
        }
    }

    if (optionLines.length === 0) return '';
    return optionLines.map(l => `<small class="checkout-option-detail">› ${l}</small>`).join('');
}

function updateCheckoutItemQtyDisplay(scope) {
    const qty = currentCheckoutItemQty;
    const price = scope.price || 0;
    const itemTotal = price * qty;
    const itemName = scope.itemName || 'Item';
    const itemOptionDetailsHtml = buildItemOptionDetailsHtml(scope);

    // Update qty value display
    const qtyValueEl = document.getElementById('checkout-item-qty');
    if (qtyValueEl) qtyValueEl.textContent = qty;

    // Update hint text
    const qtyHint = document.getElementById('checkout-qty-hint');
    if (qtyHint) {
        qtyHint.textContent = qty === 0
            ? 'Quantity 0 = donation only. Increase to also buy.'
            : `Quantity ${qty} — item will be purchased + donation.`;
    }

    // Update the cart summary line item
    const scopeItem = document.getElementById('checkout-scope-item');
    if (scopeItem) {
        if (qty === 0) {
            scopeItem.innerHTML = `
                <div class="summary-item-details">
                    <span class="summary-item-name">${itemName}</span>
                    ${itemOptionDetailsHtml}
                    <small class="summary-item-donation-note">Chip in to crowdfund this item</small>
                </div>
                <span class="summary-item-price">—</span>
            `;
        } else {
            scopeItem.innerHTML = `
                <div class="summary-item-details">
                    <span class="summary-item-name">${itemName} (x${qty})</span>
                    ${itemOptionDetailsHtml}
                </div>
                <span class="summary-item-price">$${itemTotal.toFixed(2)}</span>
            `;
        }
    }

    // Update full total
    const fullTotalEl = document.getElementById('full-total-price');
    if (fullTotalEl) {
        fullTotalEl.textContent = `$${itemTotal.toFixed(2)}`;
        fullTotalEl.dataset.total = itemTotal;
    }

    // Update the "Match My Cart" amount in chip-in section
    const matchAmountEl = document.getElementById('chip-in-match-amount');
    if (matchAmountEl) {
        matchAmountEl.textContent = `+$${itemTotal.toFixed(2)}`;
    }

    // Refresh the checkout display (recalculates fees, updates payment intent)
    updateCheckoutDisplay();
}

/**
 * Loads and displays crowdfunding progress from Airtable for the given item.
 * Falls back to localStorage data if the Airtable fetch fails.
 * @param {string} itemRecordId - The item's Airtable record ID
 * @param {number} goalAmount - The fundraising goal (item price)
 */
async function loadCrowdfundProgress(itemRecordId, goalAmount) {
    const progressContainer = document.getElementById('checkout-crowdfund-progress');
    if (!progressContainer) return;

    // Try Airtable first
    let raised = 0;
    let contributors = 0;

    try {
        const fundRecord = await api.fetchCommunityFund(itemRecordId);
        if (fundRecord) {
            raised = fundRecord.fields.Total_Raised || 0;
            contributors = fundRecord.fields.Contributor_Count || 0;
        }
    } catch (e) {
        console.warn('[ChipIn] Failed to load from Airtable, falling back to localStorage', e);
    }

    // Fallback: merge localStorage data if Airtable had nothing
    if (raised === 0) {
        try {
            const stored = localStorage.getItem(`donation_fund_${itemRecordId}`);
            if (stored) {
                const localData = JSON.parse(stored);
                raised = localData.raised || 0;
                contributors = localData.contributors || 0;
            }
        } catch (e) { /* ignore */ }
    }

    // Only show progress if there is any
    if (raised > 0 || goalAmount > 0) {
        progressContainer.style.display = 'block';
        const effectiveGoal = goalAmount > 0 ? goalAmount : 5;
        const percent = Math.min(100, (raised / effectiveGoal) * 100);

        const barFill = document.getElementById('crowdfund-bar-fill');
        const raisedEl = document.getElementById('crowdfund-raised');
        const goalEl = document.getElementById('crowdfund-goal');
        const contribEl = document.getElementById('crowdfund-contributors');

        if (barFill) {
            requestAnimationFrame(() => { barFill.style.width = `${percent}%`; });
        }
        if (raisedEl) raisedEl.textContent = `$${raised.toFixed(2)}`;
        if (goalEl) goalEl.textContent = `$${effectiveGoal.toFixed(2)}`;
        if (contribEl) {
            contribEl.textContent = contributors > 0
                ? ` · ${contributors} ${contributors === 1 ? 'contributor' : 'contributors'}`
                : '';
        }
    } else {
        progressContainer.style.display = 'none';
    }
}

/**
 * Returns the currently selected checkout payment method ('stripe' or 'p2p').
 * Defaults to 'stripe' when no toggle/active tab is present.
 */
function getActivePaymentMethod() {
    const activeTab = document.querySelector('#checkout-payment-method-toggle .payment-method-tab.active');
    return activeTab ? activeTab.dataset.method : 'stripe';
}

/**
 * Applies visibility for the chosen payment method WITHOUT hiding the name/email
 * (and guest account) inputs — those are always collected, including for the
 * "Pay Direct" (P2P) option. Only the pay mechanism toggles: Stripe shows the
 * card entry + "Pay Now"; P2P hides those and shows the direct-pay options.
 * @param {'stripe'|'p2p'} method
 */
function applyPaymentMethodVisibility(method) {
    const paymentForm = document.getElementById('payment-form');
    const paymentDetailsRow = document.getElementById('checkout-payment-details-row');
    const submitBtn = document.getElementById('payment-submit-btn');
    const p2pSection = document.getElementById('checkout-p2p-section');

    // Name/email/account row live inside the form and must stay visible for both.
    if (paymentForm) paymentForm.style.display = 'block';

    if (method === 'p2p') {
        if (paymentDetailsRow) paymentDetailsRow.style.display = 'none';
        if (submitBtn) submitBtn.style.display = 'none';
        if (p2pSection) p2pSection.style.display = 'block';
    } else {
        if (paymentDetailsRow) paymentDetailsRow.style.display = '';
        if (submitBtn) submitBtn.style.display = '';
        if (p2pSection) p2pSection.style.display = 'none';
    }
}

/**
 * Sets up the payment method toggle (Stripe vs P2P) in the checkout modal.
 */
function setupPaymentMethodToggle() {
    const toggleContainer = document.getElementById('checkout-payment-method-toggle');

    if (!toggleContainer) return;

    const tabs = toggleContainer.querySelectorAll('.payment-method-tab');

    tabs.forEach(tab => {
        const newTab = tab.cloneNode(true);
        tab.parentNode.replaceChild(newTab, tab);

        newTab.addEventListener('click', () => {
            toggleContainer.querySelectorAll('.payment-method-tab').forEach(t => t.classList.remove('active'));
            newTab.classList.add('active');
            applyPaymentMethodVisibility(newTab.dataset.method);
        });
    });
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

    // In single-item mode, don't apply payment history deductions or deposit logic
    const isItemMode = currentCheckoutScope && currentCheckoutScope.mode === 'item';
    const amountReceived = isItemMode ? 0 : (state.session.user.amountReceived || 0);
    const totalDue = finalTotal - amountReceived;
    const isFullyPaid = totalDue <= 0.009; // Check for paid status

    const choice = document.querySelector('input[name="paymentChoice"]:checked')?.value || 'deposit';
    let baseAmountToCharge = totalDue; // This is the amount *before* processing fees

    const isInitialDeposit = !isItemMode && amountReceived === 0 && (currentShopSettings.paymentOptions !== 'DepositOrFull' || choice === 'deposit');

    const tipRow = document.querySelector('.tip-row');
    if (tipRow) {
        if (isInitialDeposit && totalDue > baseAmountToCharge * 1.05) {
            tipRow.style.display = 'none';
        } else {
            tipRow.style.display = 'flex';
        }
    }

    if (isItemMode) {
        // Single-item mode: charge full amount, no deposit logic
        baseAmountToCharge = finalTotal;
        // Adjust label based on whether this is donation-only or purchase + donation
        const isDonationOnly = currentCheckoutItemQty === 0 && currentCheckoutScope && currentCheckoutScope.highlightChipIn;
        if (isDonationOnly && currentChipInAmount > 0) {
            document.getElementById('deposit-label').textContent = 'Donation Amount:';
        } else if (isDonationOnly) {
            document.getElementById('deposit-label').textContent = 'Amount Due:';
        } else {
            document.getElementById('deposit-label').textContent = 'Amount Due:';
        }
    } else if (amountReceived === 0) {
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

    let finalBaseAmount = baseAmountToCharge + tipAmount + currentChipInAmount;
    document.getElementById('deposit-price').textContent = `$${finalBaseAmount.toFixed(2)}`;

    // Update P2P amount display if visible
    const p2pAmountEl = document.getElementById('checkout-p2p-amount');
    if (p2pAmountEl) {
        p2pAmountEl.textContent = `$${finalBaseAmount.toFixed(2)}`;
    }
    // Update P2P payment links with new amount
    updateP2PPaymentLinks(finalBaseAmount);
    
    // Get fee/total elements
    const processingFeeEl = document.getElementById('processing-fee-price');
    const finalChargeEl = document.getElementById('final-charge-price');
    const paymentForm = document.getElementById('payment-form'); // Get form
    const paymentDetailsRow = document.getElementById('checkout-payment-details-row');

    // --- FREE REGISTRATION MODE ---
    // A plan whose total is $0 (free events, nothing previously paid) should still
    // be checkout-able: the visitor provides name + email to register for the
    // events included in their plan. There is nothing to charge, so the Stripe
    // payment UI is hidden and the form's submit becomes a "Complete Registration"
    // action (handled in events.js handlePaymentFormSubmit -> handleFreeRegistration).
    // This is distinct from "receipt mode" below, which is for a plan already paid
    // off (amountReceived > 0).
    const isFreeRegistration = !isItemMode && amountReceived === 0 && finalTotal <= 0.009 && finalBaseAmount <= 0.009;
    currentCheckoutIsFree = isFreeRegistration;
    if (isFreeRegistration) {
        log('Modal', 'Free-registration mode: $0 plan, collecting name/email only.');
        if (paymentForm) paymentForm.style.display = 'block';
        // Hide everything payment-related; keep name/email/account inputs.
        if (paymentDetailsRow) paymentDetailsRow.style.display = 'none';
        if (tipRow) tipRow.style.display = 'none';
        const paymentMethodToggle = document.getElementById('checkout-payment-method-toggle');
        if (paymentMethodToggle) paymentMethodToggle.style.display = 'none';
        const p2pSection = document.getElementById('checkout-p2p-section');
        if (p2pSection) p2pSection.style.display = 'none';
        const paymentChoiceContainer = document.getElementById('payment-choice-container');
        if (paymentChoiceContainer) paymentChoiceContainer.style.display = 'none';
        const depositLabel = document.getElementById('deposit-label');
        if (depositLabel) depositLabel.textContent = 'Amount Due:';
        const submitBtn = document.getElementById('payment-submit-btn');
        if (submitBtn) {
            const btnText = submitBtn.querySelector('.button-text');
            if (btnText) btnText.textContent = 'Complete Registration';
        }
        return; // Nothing to charge — skip the payment intent entirely.
    }
    // Leaving free mode (e.g. a tip / chip-in was added): restore the payment UI.
    if (paymentDetailsRow) paymentDetailsRow.style.display = '';
    if (!isItemMode) {
        const submitBtn = document.getElementById('payment-submit-btn');
        const btnText = submitBtn && submitBtn.querySelector('.button-text');
        if (btnText && btnText.textContent === 'Complete Registration') btnText.textContent = 'Pay Now';
    }

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

    // --- DONATION-ONLY MODE: Hide payment until chip-in selected ---
    const isDonationOnlyPending = isItemMode && currentCheckoutItemQty === 0 && currentChipInAmount <= 0 && finalBaseAmount <= 0;
    if (isDonationOnlyPending) {
        log('Modal', 'Donation-only mode: waiting for chip-in selection.');
        if (paymentForm) paymentForm.style.display = 'none';
        const paymentMethodToggle = document.getElementById('checkout-payment-method-toggle');
        if (paymentMethodToggle) paymentMethodToggle.style.display = 'none';
        const p2pSection = document.getElementById('checkout-p2p-section');
        if (p2pSection) p2pSection.style.display = 'none';
        // Update submit button text
        const submitBtn = document.getElementById('payment-submit-btn');
        if (submitBtn) {
            const btnText = submitBtn.querySelector('.button-text');
            if (btnText) btnText.textContent = 'Pay Now';
        }
        return;
    }
    // --- END DONATION-ONLY MODE ---

    // If we're here, we need to pay. Show the form — but respect the currently
    // selected payment method so re-renders (e.g. a tip change) don't snap a
    // "Pay Direct" view back to the Stripe card entry.
    if (paymentForm) paymentForm.style.display = 'block';
    applyPaymentMethodVisibility(getActivePaymentMethod());

    // Re-show payment method toggle if P2P options exist (may have been hidden in donation-only pending state)
    if (isItemMode && currentCheckoutScope && currentCheckoutScope.highlightChipIn) {
        const paymentMethodToggle = document.getElementById('checkout-payment-method-toggle');
        const storePaymentOptions = getStorePaymentOptions();
        const hasP2POptions = storePaymentOptions && Object.keys(storePaymentOptions).length > 0;
        if (paymentMethodToggle && hasP2POptions) {
            paymentMethodToggle.style.display = 'block';
        }
        // Update pay button text for donation context
        const submitBtn = document.getElementById('payment-submit-btn');
        if (submitBtn) {
            const btnText = submitBtn.querySelector('.button-text');
            if (btnText) {
                btnText.textContent = currentCheckoutItemQty === 0 ? 'Donate Now' : 'Pay Now';
            }
        }
    }

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
            // 0. Ask the promotions engine for an authoritative discount, but
            //    only when the full item subtotal is being charged (not a 35%
            //    deposit or a remaining balance, where a deal discount is
            //    ambiguous). The server re-validates the token and does the
            //    actual subtraction, so this can never undercharge.
            currentDiscountToken = null;
            currentDiscountInCents = 0;
            const chargingFullSubtotal = isItemMode || (amountReceived === 0 && Math.abs(baseAmountToCharge - finalTotal) < 0.01);
            if (chargingFullSubtotal) {
                const quoteStoreId = state.session?.storeId || state.ui?.activeShopId || null;
                const lines = quoteStoreId ? buildPromotableCartLines(quoteStoreId) : [];
                if (quoteStoreId && lines.length) {
                    try {
                        const q = await quoteCart(quoteStoreId, lines, state.session?.id || null);
                        if (q && q.discountCents > 0 && q.token) {
                            currentDiscountToken = q.token;
                            currentDiscountName = q.promotionName || 'Discount';
                        }
                    } catch (e) { /* no discount on quote failure */ }
                }
            }

            // 1. Call create-payment-intent with the *current* payment type
            console.log('[PAY-TAB DEBUG] updateCheckoutDisplay: Creating PaymentIntent.', {
                amount: Math.round(currentBaseAmount * 100),
                paymentMethodType: currentPaymentType,
                hasDiscountToken: !!currentDiscountToken
            });
            const intentResponse = await fetch('/api/create-payment-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: Math.round(currentBaseAmount * 100),
                    paymentMethodType: currentPaymentType,
                    sessionId: state.session?.id || null,
                    customerEmail: document.getElementById('customer-email')?.value || null,
                    discountToken: currentDiscountToken || undefined
                }),
            });
            if (!intentResponse.ok) throw new Error('Could not update payment intent.');

            const intentData = await intentResponse.json();
            const newClientSecret = intentData.clientSecret;
            const newProcessingFee = intentData.processingFeeInCents / 100;
            currentDiscountInCents = intentData.discountInCents || 0;

            // Capture the PaymentIntent ID for future updates (avoids creating
            // new PIs when the user switches payment methods)
            if (intentData.paymentIntentId) {
                currentPaymentIntentId = intentData.paymentIntentId;
            }

            console.log('[PAY-TAB DEBUG] updateCheckoutDisplay: PaymentIntent created.', {
                paymentIntentId: currentPaymentIntentId,
                hasClientSecret: !!newClientSecret,
                clientSecretSuffix: newClientSecret ? '...' + newClientSecret.slice(-8) : 'null',
                processingFee: newProcessingFee,
                paymentType: currentPaymentType
            });

            // 2. Update UI with new fees
            currentProcessingFee = newProcessingFee;
            if (processingFeeEl) processingFeeEl.textContent = `$${newProcessingFee.toFixed(2)}`;
            renderCheckoutDiscountRow(currentDiscountInCents, currentDiscountName);
            if (finalChargeEl) finalChargeEl.textContent = `$${(currentBaseAmount - currentDiscountInCents / 100 + newProcessingFee).toFixed(2)}`;

            // 3. Destroy old element and create/mount a new one
            if (paymentElement) {
                paymentElement.unmount();
            }

            currentClientSecret = newClientSecret; // Update the secret
            elements = stripe.elements({ clientSecret: currentClientSecret });
            paymentElement = elements.create('payment', {
                fields: {
                    billingDetails: { name: 'never', email: 'never' }
                }
            });
            paymentElement.mount('#payment-element');

            // 4. Add listener to update payment type AND fetch new fee
            paymentElement.on('change', debounce(handlePaymentTypeChange, 300));
            console.log('[PAY-TAB DEBUG] updateCheckoutDisplay: PaymentElement mounted with change listener.');

        } catch (error) {
            console.error('[PAY-TAB DEBUG] Failed to update payment intent/element:', error);
            if (processingFeeEl) processingFeeEl.textContent = 'Error';
            if (finalChargeEl) finalChargeEl.textContent = 'Error';
        }
    } else {
         // --- ADDED THIS ELSE BLOCK ---\
         // Price did NOT change, but we should still update the final total
         // in case the processing fee was updated by the new listener.
         log('Modal', 'Price did not change, just updating fee display.');
         if (processingFeeEl) processingFeeEl.textContent = `$${currentProcessingFee.toFixed(2)}`;
         renderCheckoutDiscountRow(currentDiscountInCents, currentDiscountName);
         if (finalChargeEl) finalChargeEl.textContent = `$${(currentBaseAmount - currentDiscountInCents / 100 + currentProcessingFee).toFixed(2)}`;
         // --- END ADDED BLOCK ---\
    }
}

/**
 * Handles changes in the PaymentElement (e.g., switching from Card to ACH).
 * Updates the existing PaymentIntent's amount (to reflect the new fee) without
 * rebuilding the PaymentElement, so the user's payment-method selection is preserved.
 */
let suppressPaymentTypeChange = false;

async function handlePaymentTypeChange(event) {
    console.log('[PAY-TAB DEBUG] handlePaymentTypeChange fired:', {
        eventValue: event?.value,
        eventType: event?.value?.type,
        currentPaymentType,
        currentBaseAmount,
        currentPaymentIntentId,
        suppressPaymentTypeChange
    });

    if (suppressPaymentTypeChange) {
        console.log('[PAY-TAB DEBUG] Suppressed (post-rebuild guard). Ignoring.');
        return;
    }

    if (!event.value.type || event.value.type === currentPaymentType) {
        console.log('[PAY-TAB DEBUG] Payment type unchanged or incomplete, skipping.');
        return;
    }

    const previousType = currentPaymentType;
    currentPaymentType = event.value.type;
    log('Modal', `Payment type changed from ${previousType} to: ${currentPaymentType}. Updating fee.`);

    const processingFeeEl = document.getElementById('processing-fee-price');
    const finalChargeEl = document.getElementById('final-charge-price');

    if (processingFeeEl) processingFeeEl.textContent = 'Calculating...';
    if (finalChargeEl) finalChargeEl.textContent = 'Calculating...';

    try {
        // Update the existing PaymentIntent with the recalculated fee for the
        // new payment type. By updating instead of creating, the clientSecret
        // stays the same and the PaymentElement does NOT need to be rebuilt —
        // the user's current tab selection (card / ACH / etc.) is preserved.
        const requestBody = {
            amount: Math.round(currentBaseAmount * 100),
            paymentMethodType: currentPaymentType,
            sessionId: state.session?.id || null,
            customerEmail: document.getElementById('customer-email')?.value || null,
            discountToken: currentDiscountToken || undefined
        };
        if (currentPaymentIntentId) {
            requestBody.paymentIntentId = currentPaymentIntentId;
        }
        console.log('[PAY-TAB DEBUG] Sending PI update/create request:', {
            paymentIntentId: currentPaymentIntentId || '(new)',
            paymentMethodType: currentPaymentType,
            amountCents: requestBody.amount
        });

        const intentResponse = await fetch('/api/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        if (!intentResponse.ok) {
            const errBody = await intentResponse.text();
            console.error('[PAY-TAB DEBUG] PaymentIntent update failed:', intentResponse.status, errBody);
            throw new Error('Could not fetch new processing fee.');
        }

        const intentData = await intentResponse.json();
        const newProcessingFee = intentData.processingFeeInCents / 100;
        const newClientSecret = intentData.clientSecret;

        if (intentData.paymentIntentId) {
            currentPaymentIntentId = intentData.paymentIntentId;
        }

        console.log('[PAY-TAB DEBUG] PI response received:', {
            paymentIntentId: currentPaymentIntentId,
            newProcessingFee,
            clientSecretChanged: newClientSecret !== currentClientSecret
        });

        // Update fee display
        currentProcessingFee = newProcessingFee;
        currentDiscountInCents = intentData.discountInCents || 0;
        if (processingFeeEl) processingFeeEl.textContent = `$${newProcessingFee.toFixed(2)}`;
        renderCheckoutDiscountRow(currentDiscountInCents, currentDiscountName);
        if (finalChargeEl) finalChargeEl.textContent = `$${(currentBaseAmount - currentDiscountInCents / 100 + newProcessingFee).toFixed(2)}`;

        // When we successfully updated the existing PI, the clientSecret is
        // unchanged. No element rebuild is needed — the user stays on their
        // selected payment tab.
        if (newClientSecret && newClientSecret !== currentClientSecret) {
            // Fallback: if for any reason a new PI was created (e.g. the
            // update failed and the server fell through to create), rebuild
            // the element. This path should rarely execute.
            console.log('[PAY-TAB DEBUG] clientSecret changed — rebuilding PaymentElement (fallback path).');
            if (paymentElement) {
                paymentElement.unmount();
            }
            currentClientSecret = newClientSecret;
            elements = stripe.elements({ clientSecret: currentClientSecret });
            paymentElement = elements.create('payment', {
                fields: {
                    billingDetails: { name: 'never', email: 'never' }
                }
            });
            paymentElement.mount('#payment-element');

            suppressPaymentTypeChange = true;
            console.log('[PAY-TAB DEBUG] Post-rebuild suppression enabled.');
            setTimeout(() => {
                suppressPaymentTypeChange = false;
                console.log('[PAY-TAB DEBUG] Post-rebuild suppression lifted.');
            }, 1000);

            paymentElement.on('change', debounce(handlePaymentTypeChange, 300));
        } else {
            console.log('[PAY-TAB DEBUG] clientSecret unchanged — no element rebuild needed. User stays on', currentPaymentType);
        }

        log('Modal', `New fee is ${newProcessingFee.toFixed(2)} for ${currentPaymentType}`);

    } catch (error) {
        console.error('[PAY-TAB DEBUG] Failed to update fee on type change:', error);
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

// ============================================
// MODAL REACTIONS & COMMENTS SYSTEM
// ============================================

// Cache for modal comments to avoid refetching on every open
let modalCommentsCache = new Map(); // recordId -> { messages: [], timestamp }
let modalReplyingTo = null; // { messageId, senderName }

// =============================================================================
// CONSOLIDATED RSB FOR DETAIL MODAL
// Mirrors the presentation view RSB with modal-appropriate styling
// =============================================================================

// RSB layout configs (same as presentation.js)
const MODAL_RSB_LAYOUTS = [
    { id: 'bar', label: 'Tiered Rows', icon: '☰' },
    { id: 'radial-grid', label: 'Radial Grid', icon: '◎' },
    { id: 'orbit', label: 'Orbit', icon: '◌' },
    { id: 'minimal', label: 'Minimal', icon: '—' }
];

const MODAL_RSB_INITIAL_TIERS = 2;
let modalRSBRadialTierIndex = 0;
let modalRSBReplyingTo = null;

function getModalRSBLayout() {
    return document.body.dataset.rsbLayout || 'bar';
}

/**
 * Initialize the reactions section in the detail modal as two stacked layers:
 *
 *   • "This Plan" (top, elevated) — the per-plan reactions/comments for this item,
 *     rendered only when the modal is opened inside a plan or presentation.
 *     Expanded by default (the viewer's current focus).
 *   • "Community" (bottom, grounded) — the GLOBAL reactions/comments shared by
 *     everyone, backed by the public catalog API. Always present, for every item.
 *     Collapsed when a plan layer sits above it; expanded when it stands alone in
 *     the catalog view.
 *
 * @param {string} recordId - The item record ID
 */
/**
 * The per-item reaction surfaces now live in two compact, anchored popups opened
 * from the global / plan sentiment chips placed immediately after the item name
 * (see updateModalSentimentChips / openItemSentimentPopup). The older stacked
 * "This Plan" / "Community" accordion section is retired so the detail modal stays
 * clean; this simply ensures that host section is emptied and hidden on each open.
 *
 * @param {string} recordId - The item record ID
 */
function initModalReactions(recordId) {
    const section = document.getElementById('modal-reactions-section');
    if (!section) return;
    section.innerHTML = '';
    section.style.display = 'none';
}

/**
 * Build a Map<userId, Set<emoji>> from a community row's reaction summary
 * ({ emoji: { count, users } }) so the democratic-average helper can score the
 * global (community) layer the same way it scores the per-plan layer. When a row
 * carries counts but no per-user lists (older/aggregate data), synthesize one
 * placeholder user per reaction so the count still contributes to the average.
 */
function communityReactionsToUserMap(row) {
    const map = new Map();
    const reactions = (row && row.reactions) || {};
    let synthetic = 0;
    for (const [emoji, data] of Object.entries(reactions)) {
        const users = data && Array.isArray(data.users) ? data.users : [];
        if (users.length) {
            for (const uid of users) {
                if (!map.has(uid)) map.set(uid, new Set());
                map.get(uid).add(emoji);
            }
        } else {
            const count = (data && data.count) || 0;
            for (let i = 0; i < count; i++) map.set(`anon:${synthetic++}`, new Set([emoji]));
        }
    }
    return map;
}

/**
 * Resolve the sentiment for one scope of an item:
 *   - 'plan'   → the per-plan reactions store (state.session.reactions), saved to
 *                the plan. This is the PLAN ITEM's sentiment.
 *   - 'global' → the community store shared by everyone. This is the GLOBAL
 *                ITEM's sentiment.
 * Returns per-emoji counts, the viewer's own reactions, and a summary
 * (summaryEmoji / democraticAverage / total). Keeping the two stores strictly
 * separate here is the "mend": a reaction in one scope never bleeds into the other.
 */
function getScopeSentiment(recordId, scope) {
    const emojiCounts = {};
    const mine = new Set();
    let userMap = new Map();
    let me = null;
    try { me = getCurrentUser(); } catch (_) { me = null; }

    if (scope === 'global') {
        const record = getRecordById(recordId);
        const row = record ? getCommunityRowForRecord(record) : null;
        const reactions = (row && row.reactions) || {};
        for (const [emoji, data] of Object.entries(reactions)) {
            const count = (data && data.count) || 0;
            if (count > 0) emojiCounts[emoji] = count;
            const users = data && Array.isArray(data.users) ? data.users : [];
            if (me && me.id && users.includes(me.id)) mine.add(emoji);
        }
        userMap = communityReactionsToUserMap(row);
    } else {
        const agg = getAggregateReactions(recordId); // Map<userId, Set<emoji>>
        if (agg instanceof Map) {
            agg.forEach((set) => {
                const emojis = set instanceof Set ? set : new Set([set]);
                for (const e of emojis) emojiCounts[e] = (emojiCounts[e] || 0) + 1;
            });
            userMap = agg;
            const mySet = me && me.id ? agg.get(me.id) : null;
            if (mySet instanceof Set) mySet.forEach(e => mine.add(e));
            else if (typeof mySet === 'string') mine.add(mySet);
        }
    }

    const { democraticAverage, summaryEmoji, totalReactions } = computeDemocraticAverage(userMap);
    const total = totalReactions || Object.values(emojiCounts).reduce((s, c) => s + c, 0);
    return { emojiCounts, mine, summaryEmoji, democraticAverage, total, has: total > 0 };
}

// True when the modal is open inside a plan / presentation (so a plan-item
// sentiment exists to show).
function modalIsInPlanContext() {
    const hasSession = state.session.id && state.session.id.startsWith('rec');
    return hasSession || document.body.classList.contains('presentation-active');
}

/**
 * Populate and wire one scoped sentiment chip (global or plan). The chip renders
 * its scope marker, the scope's summary sentiment emoji and a count; clicking it
 * opens an anchored popup next to the chip (see openItemSentimentPopup).
 */
export function renderSentimentChip(chip, recordId, scope) {
    if (!chip) return;
    const s = getScopeSentiment(recordId, scope);
    const icon = scope === 'global' ? '🌐' : '👥';
    const label = scope === 'global' ? 'Global item' : 'This plan';

    chip.style.display = 'inline-flex';
    chip.classList.add('clickable');

    if (s.has) {
        chip.innerHTML = `<span class="sentiment-chip-scope">${icon}</span><span class="emoji-indicator-emoji">${s.summaryEmoji}</span>${s.total > 1 ? `<span class="emoji-indicator-count">${s.total}</span>` : ''}`;
        chip.classList.add('has-reactions');
        chip.classList.remove('no-reactions');
        const sign = s.democraticAverage >= 0 ? '+' : '';
        chip.title = `${label} sentiment ${s.summaryEmoji} ${scoreToAdjective(s.democraticAverage)} (${sign}${s.democraticAverage.toFixed(1)}) · ${s.total} reaction${s.total !== 1 ? 's' : ''} — tap to weigh in`;
    } else {
        chip.innerHTML = `<span class="sentiment-chip-scope">${icon}</span><span class="emoji-indicator-prompt">React</span>`;
        chip.classList.remove('has-reactions');
        chip.classList.add('no-reactions');
        chip.title = `${label} — no reactions yet, tap to react`;
    }

    chip.onclick = (e) => { e.stopPropagation(); openItemSentimentPopup(chip, recordId, scope); };
    chip.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openItemSentimentPopup(chip, recordId, scope); }
    };
}

/**
 * Refresh the sentiment chip after the item name. Only the global-item chip lives
 * here now — the plan-item sentiment is surfaced by the button inside the "In your
 * plan" block instead, so the item name carries just the one glanceable marker.
 */
function updateModalSentimentChips(recordId) {
    const globalChip = document.getElementById('modal-item-sentiment-chip');
    const planChip = document.getElementById('modal-plan-sentiment-chip');
    // The plan-item chip is retired from the name row; the "In your plan" button
    // is now the plan sentiment control (see renderInPlanSummary).
    if (planChip) planChip.style.display = 'none';
    if (!recordId) {
        if (globalChip) globalChip.style.display = 'none';
        return;
    }
    if (globalChip) renderSentimentChip(globalChip, recordId, 'global');
}

// ── Anchored sentiment popup (chat-message style) ───────────────────────────
let _sentimentPopupCleanup = null;

function closeItemSentimentPopup() {
    document.querySelectorAll('.item-sentiment-popup').forEach(el => el.remove());
    if (_sentimentPopupCleanup) { _sentimentPopupCleanup(); _sentimentPopupCleanup = null; }
}

// Pin the popup just below (or above, if no room) the chip that opened it, kept
// within the viewport — the same approach the chat-message reaction picker uses.
function positionSentimentPopup(popup, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    popup.style.position = 'fixed';
    const pw = popup.offsetWidth || 240;
    const ph = popup.offsetHeight || 130;
    let top = rect.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, rect.top - ph - 8);
    let left = rect.left;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
    popup.style.top = `${Math.max(8, top)}px`;
    popup.style.left = `${Math.max(8, left)}px`;
}

/**
 * Open the anchored reaction popup for one scope (global / plan) next to the chip
 * that was clicked. The popup shows a compact summary (only when reactions exist)
 * above the standard eight-emoji picker, plus a "See conversation" link into the
 * matching thread. Replaces the old behavior of expanding a large GUI inside the
 * modal — this is local to the clicked emoji, like a chat-message emoji menu.
 */
function openItemSentimentPopup(anchorEl, recordId, scope) {
    closeItemSentimentPopup();
    if (!recordId || !anchorEl) return;
    if (scope === 'plan' && !modalIsInPlanContext()) return;

    const s = getScopeSentiment(recordId, scope);

    const popup = document.createElement('div');
    popup.className = 'item-sentiment-popup';
    popup.dataset.scope = scope;
    popup.dataset.recordId = recordId;

    const head = document.createElement('div');
    head.className = 'sentiment-popup-head';
    head.textContent = scope === 'global' ? '🌐 Global item' : '👥 This plan';
    popup.appendChild(head);

    // Summary — only when this scope already has reactions.
    if (s.has) {
        const summary = document.createElement('div');
        summary.className = 'sentiment-popup-summary';
        const sign = s.democraticAverage >= 0 ? '+' : '';
        const pills = Object.entries(s.emojiCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([e, c]) => {
                const eScore = REACTION_SCORES[e] || 0;
                const title = `${e} ${eScore >= 0 ? '+' : ''}${eScore.toFixed(1)} · ${scoreToAdjective(eScore)}`;
                return `<span class="sentiment-pill" title="${title}">${e}<span class="sentiment-pill-count">${c}</span></span>`;
            })
            .join('');
        summary.innerHTML = `
            <div class="sentiment-popup-avg">
                <span class="sentiment-popup-avg-emoji">${s.summaryEmoji}</span>
                <span class="sentiment-popup-avg-score">${sign}${s.democraticAverage.toFixed(1)}</span>
                <span class="sentiment-popup-avg-word">${scoreToAdjective(s.democraticAverage)}</span>
                <span class="sentiment-popup-avg-label">avg · ${s.total} reaction${s.total !== 1 ? 's' : ''}</span>
            </div>
            <div class="sentiment-popup-pills">${pills}</div>
        `;
        popup.appendChild(summary);
    }

    const picker = document.createElement('div');
    picker.className = 'sentiment-popup-picker';
    EMOJI_REACTIONS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sentiment-popup-emoji' + (s.mine.has(emoji) ? ' reacted' : '');
        btn.textContent = emoji;
        const score = REACTION_SCORES[emoji] || 0;
        btn.title = `${emoji} ${score >= 0 ? '+' : ''}${score.toFixed(1)} · ${scoreToAdjective(score)}`;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleScopeReaction(recordId, scope, emoji, anchorEl);
        });
        picker.appendChild(btn);
    });
    popup.appendChild(picker);

    const convo = document.createElement('button');
    convo.type = 'button';
    convo.className = 'sentiment-popup-convo';
    convo.innerHTML = '💬 See conversation';
    convo.addEventListener('click', (e) => {
        e.stopPropagation();
        closeItemSentimentPopup();
        if (scope === 'global') openUCPGlobalForItem(recordId);
        else openUCPForItem(recordId);
    });
    popup.appendChild(convo);

    document.body.appendChild(popup);
    positionSentimentPopup(popup, anchorEl);

    const onDocClick = (e) => {
        if (!popup.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) {
            closeItemSentimentPopup();
        }
    };
    const onKey = (e) => { if (e.key === 'Escape') closeItemSentimentPopup(); };
    setTimeout(() => {
        document.addEventListener('click', onDocClick);
        document.addEventListener('keydown', onKey);
    }, 0);
    _sentimentPopupCleanup = () => {
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onKey);
    };
}

/**
 * Toggle the viewer's reaction within a single scope, then refresh the chips and
 * re-open the popup so it reflects the new state. Plan reactions go to the plan
 * store; global reactions go to the community store — never crossing over.
 */
async function toggleScopeReaction(recordId, scope, emoji, anchorEl) {
    if (scope === 'plan') {
        handleModalRSBEmojiSelect(recordId, emoji);
    } else {
        const record = getRecordById(recordId);
        if (!record) return;
        const ok = await toggleCommunityReactionForRecord(record, emoji);
        if (!ok) return; // signed out (sign-in prompt shown) or errored
    }
    updateModalSentimentChips(recordId);
    // If the popup was opened from a catalog card's sentiment chip (beta "Sort by:
    // Sentiment" mode) rather than the modal, refresh that chip in place too so it
    // reflects the new reaction without waiting for a catalog re-render.
    if (anchorEl && anchorEl.classList && anchorEl.classList.contains('card-sentiment-chip')) {
        renderSentimentChip(anchorEl, recordId, scope);
    }
    if (scope === 'plan') refreshInPlanReactButton(recordId);
    // Re-open the popup in place to show the updated picker/summary.
    openItemSentimentPopup(anchorEl, recordId, scope);
}

/**
 * Re-render just the label/title of the "In your plan" sentiment button so it
 * reflects the latest plan-item summary after a reaction is toggled, without
 * rebuilding the whole block.
 */
function refreshInPlanReactButton(recordId) {
    const btn = document.querySelector('#modal-in-plan-summary .in-plan-react-btn');
    if (!btn) return;
    const planS = getScopeSentiment(recordId, 'plan');
    if (planS.has) {
        btn.innerHTML = `👥 ${planS.summaryEmoji}${planS.total > 1 ? ` ${planS.total}` : ''}`;
        const sign = planS.democraticAverage >= 0 ? '+' : '';
        btn.title = `Plan sentiment ${planS.summaryEmoji} ${scoreToAdjective(planS.democraticAverage)} (${sign}${planS.democraticAverage.toFixed(1)}) · ${planS.total} reaction${planS.total !== 1 ? 's' : ''} — tap to weigh in`;
        btn.classList.add('has-reactions');
    } else {
        btn.innerHTML = '👥 React';
        btn.title = 'Plan sentiment — no reactions yet, tap to react';
        btn.classList.remove('has-reactions');
    }
}

/**
 * Render the "In your plan" summary block shown in the detail modal when the
 * item is already part of the plan. It replaces the bare "Update Plan" call to
 * action with a confirmation of what was specifically added (quantity, adjusted
 * total, and any note) and carries a reactions affordance that opens the same
 * standard sentiment surface. The "Update plan" button is preserved beneath it
 * so editing options stays possible. Pass isLocked=false to clear the block.
 */
function renderInPlanSummary(record, itemState, isLocked) {
    const container = document.getElementById('modal-actions-container');
    if (!container) return;
    // The modal DOM is reused across opens — always clear any prior instance.
    const existing = document.getElementById('modal-in-plan-summary');
    if (existing) existing.remove();
    if (!isLocked || !record) return;

    const qty = (itemState && itemState.quantity) ? itemState.quantity : 1;
    const optIndex = (itemState && itemState.selectedOptionIndex) || 0;
    let unitPrice = 0;
    try { unitPrice = getRecordPrice(record, optIndex) || 0; } catch (_) {}
    const total = unitPrice * qty;
    const note = (itemState && itemState.note) ? String(itemState.note) : '';

    const details = [`<span class="in-plan-qty">Qty ${qty}</span>`];
    if (total > 0) details.push(`<span class="in-plan-price">$${total.toFixed(2)}</span>`);

    const block = document.createElement('div');
    block.id = 'modal-in-plan-summary';
    block.className = 'modal-in-plan-summary';
    // The plan sentiment control now lives here, as the block's button: it shows
    // the plan-item summary emoji and count (or a "React" prompt) and opens the
    // anchored plan sentiment popup. The name row keeps only the global chip.
    const planS = getScopeSentiment(record.id, 'plan');
    let reactLabel, reactTitle;
    if (planS.has) {
        reactLabel = `👥 ${planS.summaryEmoji}${planS.total > 1 ? ` ${planS.total}` : ''}`;
        const sign = planS.democraticAverage >= 0 ? '+' : '';
        reactTitle = `Plan sentiment ${planS.summaryEmoji} ${scoreToAdjective(planS.democraticAverage)} (${sign}${planS.democraticAverage.toFixed(1)}) · ${planS.total} reaction${planS.total !== 1 ? 's' : ''} — tap to weigh in`;
    } else {
        reactLabel = '👥 React';
        reactTitle = 'Plan sentiment — no reactions yet, tap to react';
    }
    block.innerHTML = `
        <div class="in-plan-head">
            <span class="in-plan-check">✓</span>
            <span class="in-plan-title">In your plan</span>
            <button type="button" class="in-plan-react-btn${planS.has ? ' has-reactions' : ''}" title="${escapeHtml(reactTitle)}">${reactLabel}</button>
        </div>
        <div class="in-plan-details">${details.join('<span class="in-plan-sep">·</span>')}</div>
        ${note ? `<div class="in-plan-note">${escapeHtml(note)}</div>` : ''}
    `;
    const reactBtn = block.querySelector('.in-plan-react-btn');
    if (reactBtn) reactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openItemSentimentPopup(reactBtn, record.id, 'plan');
    });

    container.insertBefore(block, container.firstChild);
}

/**
 * Build the "This Plan" reactions card (the existing per-plan RSB accordion),
 * labelled and ready to sit above the Community layer. Returns the card element.
 */
function buildPlanReactionsCard(recordId, startExpanded) {
    const card = document.createElement('div');
    card.className = 'modal-plan-layer modal-rsb-host';

    // Build summary text for the collapsed state.
    const allReactions = getAggregateReactions(recordId);
    let reactionCount = 0;
    if (allReactions instanceof Map) {
        allReactions.forEach((emojiData) => {
            reactionCount += (emojiData instanceof Set) ? emojiData.size : 1;
        });
    }
    const commentCount = modalCommentsCache.get(recordId)?.messages?.length || 0;

    let summaryText = '';
    if (reactionCount > 0 || commentCount > 0) {
        const parts = [];
        if (reactionCount > 0) {
            // Get top emojis for preview
            const emojiCounts = {};
            allReactions.forEach((emojiData) => {
                const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
                for (const emoji of emojis) {
                    emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1;
                }
            });
            const topEmojis = Object.entries(emojiCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([e]) => e)
                .join('');
            parts.push(`${topEmojis} ${reactionCount} reaction${reactionCount !== 1 ? 's' : ''}`);
        }
        if (commentCount > 0) {
            parts.push(`💬 ${commentCount} comment${commentCount !== 1 ? 's' : ''}`);
        }
        summaryText = parts.join(' · ');
    } else {
        summaryText = 'React & comment within this plan';
    }

    // Accordion header
    const header = document.createElement('button');
    header.className = 'modal-rsb-accordion-header' + (startExpanded ? ' expanded' : '');
    header.type = 'button';
    header.innerHTML = `
        <span class="modal-rsb-accordion-chevron">${startExpanded ? '▾' : '▸'}</span>
        <span class="modal-rsb-accordion-summary">${summaryText}</span>
        <span class="plan-reactions-tag">👥 This Plan</span>
    `;

    // Accordion body
    const body = document.createElement('div');
    body.className = 'modal-rsb-accordion-body' + (startExpanded ? ' expanded' : '');
    body.appendChild(buildModalRSBPanelDOM(recordId));

    header.addEventListener('click', (e) => {
        e.stopPropagation();
        const isExpanded = body.classList.toggle('expanded');
        header.classList.toggle('expanded', isExpanded);
        header.querySelector('.modal-rsb-accordion-chevron').textContent = isExpanded ? '▾' : '▸';
    });

    card.appendChild(header);
    card.appendChild(body);
    return card;
}

/**
 * Build the consolidated RSB panel DOM for the modal.
 */
function buildModalRSBPanelDOM(recordId) {
    const panel = document.createElement('div');
    panel.className = 'rsb-panel rsb-panel--modal visible';
    panel.dataset.recordId = recordId;

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'rsb-tabs';

    // Use hierarchical aggregate for reaction count
    const allReactions = getAggregateReactions(recordId);
    let reactionCount = 0;
    if (allReactions instanceof Map) {
        allReactions.forEach((emojiData) => {
            reactionCount += (emojiData instanceof Set) ? emojiData.size : 1;
        });
    }
    console.log(`[SUMMARY-DEBUG] buildModalRSBPanelDOM(${recordId}): hierarchical reactionCount=${reactionCount}, users=${allReactions instanceof Map ? allReactions.size : 0}`);

    // We don't have direct access to the presentation's componentCommentsCache,
    // so we'll use the modal's own cache mechanism
    const commentCount = modalCommentsCache.get(recordId)?.messages?.length || 0;

    const tabConfigs = [
        { id: 'reactions', label: 'React', badge: '' },
        { id: 'summary', label: 'Summary', badge: reactionCount > 0 ? reactionCount : '' }
    ];

    tabConfigs.forEach((tc, idx) => {
        const tab = document.createElement('button');
        tab.className = `rsb-tab${idx === 0 ? ' active' : ''}`;
        tab.dataset.tab = tc.id;
        tab.innerHTML = `${tc.label}${tc.badge ? `<span class="rsb-tab-badge">${tc.badge}</span>` : ''}`;
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            switchModalRSBTab(panel, tc.id);
        });
        tabs.appendChild(tab);
    });
    panel.appendChild(tabs);

    // Tab: Reactions
    const reactionsContent = document.createElement('div');
    reactionsContent.className = 'rsb-tab-content active';
    reactionsContent.dataset.tabContent = 'reactions';
    buildModalRSBReactionsContent(reactionsContent, recordId);
    panel.appendChild(reactionsContent);

    // Tab: Summary
    const summaryContent = document.createElement('div');
    summaryContent.className = 'rsb-tab-content';
    summaryContent.dataset.tabContent = 'summary';
    buildModalRSBSummaryContent(summaryContent, recordId);
    panel.appendChild(summaryContent);

    // Comments live in the conversation view's Comments tab now — jump in instead
    // of an inline thread.
    const seeConvo = document.createElement('button');
    seeConvo.type = 'button';
    seeConvo.className = 'rsb-see-conversation-btn';
    seeConvo.innerHTML = '💬 See conversation';
    seeConvo.addEventListener('click', (e) => {
        e.stopPropagation();
        openUCPForItem(recordId);
    });
    panel.appendChild(seeConvo);

    return panel;
}

function switchModalRSBTab(panel, tabId) {
    panel.querySelectorAll('.rsb-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    panel.querySelectorAll('.rsb-tab-content').forEach(c => c.classList.toggle('active', c.dataset.tabContent === tabId));
}

/**
 * Build the reactions tab for the modal RSB.
 */
function buildModalRSBReactionsContent(container, recordId) {
    container.innerHTML = '';

    // Standardized reaction picker: a single row of the eight quick reactions,
    // visually and behaviourally identical to the Community layer's picker so
    // "This Plan" and "Community" read as the same control (differing only in
    // which store they write to). The earlier multi-layout tiered picker has
    // been retired from this surface to keep every reaction menu consistent.
    let currentUserEmoji = new Set();
    try {
        const user = getCurrentUser();
        const reactions = state.session.reactions?.get(recordId);
        if (reactions instanceof Map) {
            const emojiData = reactions.get(user.id);
            // Multi-emoji model: normalize to a Set for membership checks.
            if (emojiData instanceof Set) {
                currentUserEmoji = emojiData;
            } else if (typeof emojiData === 'string') {
                currentUserEmoji = new Set([emojiData]);
            }
        }
    } catch (_) {}

    // Per-emoji counts across the hierarchical aggregate (matches the Summary tab).
    const aggregate = getAggregateReactions(recordId);
    const emojiCounts = {};
    if (aggregate instanceof Map) {
        aggregate.forEach((emojiData) => {
            const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
            for (const emoji of emojis) emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1;
        });
    }

    const row = document.createElement('div');
    row.className = 'public-reaction-row rsb-standard-reaction-row';
    EMOJI_REACTIONS.forEach(emoji => {
        const count = emojiCounts[emoji] || 0;
        const mine = currentUserEmoji.has(emoji);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'public-reaction-btn' + (mine ? ' reacted' : '');
        btn.dataset.emoji = emoji;
        btn.dataset.recordId = recordId;
        btn.innerHTML = `<span class="pr-emoji">${emoji}</span>${count ? `<span class="pr-count">${count}</span>` : ''}`;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleModalRSBEmojiSelect(recordId, emoji);
        });
        row.appendChild(btn);
    });
    container.appendChild(row);
}

function buildModalRSBEmojiButton(emoji, recordId, currentUserEmoji) {
    const btn = document.createElement('button');
    // Multi-emoji: check if the emoji is in the user's Set
    const isSelected = currentUserEmoji instanceof Set ? currentUserEmoji.has(emoji) : currentUserEmoji === emoji;
    btn.className = `rsb-emoji-btn${isSelected ? ' selected' : ''}`;
    btn.textContent = emoji;
    btn.dataset.emoji = emoji;
    btn.dataset.recordId = recordId;
    const score = REACTION_SCORES[emoji] || 0;
    btn.dataset.scoreLabel = `${score >= 0 ? '+' : ''}${score.toFixed(1)} · ${scoreToAdjective(score)}`;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleModalRSBEmojiSelect(recordId, emoji);
    });
    return btn;
}

function buildModalRSBTieredRows(container, recordId, currentUserEmoji) {
    const tiersEl = document.createElement('div');
    tiersEl.className = 'rsb-emoji-tiers';

    const tiers = EMOJI_TIERS;
    const initialCount = Math.min(MODAL_RSB_INITIAL_TIERS, tiers.length);

    for (let i = 0; i < initialCount; i++) {
        tiersEl.appendChild(buildModalRSBTierRow(tiers[i], recordId, currentUserEmoji));
    }

    if (tiers.length > initialCount) {
        const expandBtn = document.createElement('div');
        expandBtn.className = 'rsb-expand-more';
        expandBtn.textContent = `Show ${tiers.length - initialCount} more tiers...`;
        expandBtn.dataset.expanded = 'false';
        expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (expandBtn.dataset.expanded === 'false') {
                for (let i = initialCount; i < tiers.length; i++) {
                    tiersEl.insertBefore(buildModalRSBTierRow(tiers[i], recordId, currentUserEmoji), expandBtn);
                }
                expandBtn.textContent = 'Show fewer';
                expandBtn.dataset.expanded = 'true';
            } else {
                const rows = tiersEl.querySelectorAll('.rsb-emoji-tier');
                for (let i = rows.length - 1; i >= initialCount; i--) rows[i].remove();
                expandBtn.textContent = `Show ${tiers.length - initialCount} more tiers...`;
                expandBtn.dataset.expanded = 'false';
            }
        });
        tiersEl.appendChild(expandBtn);
    }

    container.appendChild(tiersEl);
}

function buildModalRSBTierRow(tier, recordId, currentUserEmoji) {
    const row = document.createElement('div');
    row.className = 'rsb-emoji-tier';
    const label = document.createElement('div');
    label.className = 'rsb-emoji-tier-label';
    label.innerHTML = `${tier.label} <span class="rsb-emoji-tier-hint">${tier.description}</span>`;
    row.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'rsb-emoji-tier-grid';
    tier.emojis.forEach(emoji => {
        grid.appendChild(buildModalRSBEmojiButton(emoji, recordId, currentUserEmoji));
    });
    row.appendChild(grid);
    return row;
}

function buildModalRSBRadialGrid(container, recordId, currentUserEmoji, parentContainer) {
    const radial = document.createElement('div');
    radial.className = 'rsb-radial-container';

    const center = document.createElement('div');
    center.className = 'rsb-radial-center';
    // Use hierarchical aggregate for the radial center score
    const reactions = getAggregateReactions(recordId);
    let summaryEmoji = '😊';
    let avgScore = 0;
    if (reactions && reactions instanceof Map && reactions.size > 0) {
        const result = computeDemocraticAverage(reactions);
        avgScore = result.democraticAverage;
        summaryEmoji = result.summaryEmoji;
        console.log(`[SUMMARY-DEBUG] buildModalRSBRadialGrid(${recordId}): hierarchical democraticAverage=${avgScore.toFixed(2)}, summaryEmoji=${summaryEmoji}, users=${result.userCount}`);
    }
    center.innerHTML = `
        <span class="rsb-radial-center-emoji">${summaryEmoji}</span>
        <span class="rsb-radial-center-score">${avgScore !== 0 ? (avgScore >= 0 ? '+' : '') + avgScore.toFixed(1) : ''}</span>
    `;
    if (avgScore !== 0) center.title = `${avgScore >= 0 ? '+' : ''}${avgScore.toFixed(1)} · ${scoreToAdjective(avgScore)}`;
    radial.appendChild(center);

    const tiers = EMOJI_TIERS;
    const innerTier = tiers[modalRSBRadialTierIndex] || tiers[0];
    const outerTier = tiers[Math.min(modalRSBRadialTierIndex + 1, tiers.length - 1)] || tiers[0];

    const ring1 = document.createElement('div');
    ring1.className = 'rsb-radial-ring';
    ring1.dataset.ring = '1';
    const r1 = 65;
    innerTier.emojis.forEach((emoji, i) => {
        const angle = (i / innerTier.emojis.length) * Math.PI * 2 - Math.PI / 2;
        const btn = buildModalRSBEmojiButton(emoji, recordId, currentUserEmoji);
        btn.style.left = `calc(50% + ${Math.cos(angle) * r1}px - 18px)`;
        btn.style.top = `calc(50% + ${Math.sin(angle) * r1}px - 18px)`;
        ring1.appendChild(btn);
    });
    radial.appendChild(ring1);

    if (outerTier !== innerTier) {
        const ring2 = document.createElement('div');
        ring2.className = 'rsb-radial-ring';
        ring2.dataset.ring = '2';
        const r2 = 100;
        outerTier.emojis.slice(0, 12).forEach((emoji, i) => {
            const count = Math.min(outerTier.emojis.length, 12);
            const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
            const btn = buildModalRSBEmojiButton(emoji, recordId, currentUserEmoji);
            btn.style.left = `calc(50% + ${Math.cos(angle) * r2}px - 14px)`;
            btn.style.top = `calc(50% + ${Math.sin(angle) * r2}px - 14px)`;
            ring2.appendChild(btn);
        });
        radial.appendChild(ring2);
    }

    // Navigation
    const navPrev = document.createElement('button');
    navPrev.className = 'rsb-radial-nav';
    navPrev.textContent = '◀';
    navPrev.style.cssText = 'left: 4px; top: 50%; transform: translateY(-50%);';
    navPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        modalRSBRadialTierIndex = Math.max(0, modalRSBRadialTierIndex - 1);
        buildModalRSBReactionsContent(parentContainer, recordId);
    });

    const navNext = document.createElement('button');
    navNext.className = 'rsb-radial-nav';
    navNext.textContent = '▶';
    navNext.style.cssText = 'right: 4px; top: 50%; transform: translateY(-50%);';
    navNext.addEventListener('click', (e) => {
        e.stopPropagation();
        modalRSBRadialTierIndex = Math.min(tiers.length - 2, modalRSBRadialTierIndex + 1);
        buildModalRSBReactionsContent(parentContainer, recordId);
    });
    radial.appendChild(navPrev);
    radial.appendChild(navNext);

    const tierLabel = document.createElement('div');
    tierLabel.className = 'rsb-emoji-tier-label';
    tierLabel.style.textAlign = 'center';
    tierLabel.style.justifyContent = 'center';
    tierLabel.innerHTML = `${innerTier.label} <span class="rsb-emoji-tier-hint">(${modalRSBRadialTierIndex + 1}/${tiers.length})</span>`;
    radial.appendChild(tierLabel);

    container.appendChild(radial);
}

function buildModalRSBOrbit(container, recordId, currentUserEmoji) {
    const orbit = document.createElement('div');
    orbit.className = 'rsb-orbit-container';

    const center = document.createElement('div');
    center.className = 'rsb-radial-center';
    center.innerHTML = '<span class="rsb-radial-center-emoji">😊</span>';
    orbit.appendChild(center);

    const tiers = EMOJI_TIERS;
    const track1 = document.createElement('div');
    track1.className = 'rsb-orbit-track';
    track1.dataset.track = '1';
    tiers[0].emojis.forEach((emoji, i) => {
        const angle = (i / tiers[0].emojis.length) * 360;
        const btn = buildModalRSBEmojiButton(emoji, recordId, currentUserEmoji);
        btn.style.left = '50%';
        btn.style.top = '0';
        btn.style.transform = `rotate(${angle}deg) translateY(-75px) rotate(-${angle}deg)`;
        track1.appendChild(btn);
    });
    orbit.appendChild(track1);

    if (tiers.length > 1) {
        const track2 = document.createElement('div');
        track2.className = 'rsb-orbit-track';
        track2.dataset.track = '2';
        tiers[1].emojis.slice(0, 10).forEach((emoji, i) => {
            const angle = (i / 10) * 360;
            const btn = buildModalRSBEmojiButton(emoji, recordId, currentUserEmoji);
            btn.style.left = '50%';
            btn.style.top = '0';
            btn.style.transform = `rotate(${angle}deg) translateY(-110px) rotate(-${angle}deg)`;
            track2.appendChild(btn);
        });
        orbit.appendChild(track2);
    }

    container.appendChild(orbit);
}

function buildModalRSBMinimal(container, recordId, currentUserEmoji) {
    const row = document.createElement('div');
    row.className = 'rsb-minimal-row';
    EMOJI_TIERS[0].emojis.forEach(emoji => {
        row.appendChild(buildModalRSBEmojiButton(emoji, recordId, currentUserEmoji));
    });
    container.appendChild(row);
}

/**
 * Handle emoji selection from the modal RSB.
 */
function handleModalRSBEmojiSelect(recordId, emoji) {
    let currentUser;
    try { currentUser = getCurrentUser(); }
    catch (_) { currentUser = { id: 'anonymous', name: 'Anonymous' }; }
    console.log(`[REACTIONS-DEBUG] handleModalRSBEmojiSelect: recordId="${recordId}", emoji="${emoji}", userId="${currentUser.id}"`);

    if (!state.session.reactions.has(recordId)) {
        state.session.reactions.set(recordId, new Map());
    }

    const itemReactions = state.session.reactions.get(recordId);

    // Multi-emoji model: each user has a Set of emojis
    let userEmojiSet = itemReactions.get(currentUser.id);
    if (!(userEmojiSet instanceof Set)) {
        userEmojiSet = userEmojiSet ? new Set([userEmojiSet]) : new Set();
    }

    // Toggle: if emoji already in set, remove it; otherwise add it
    if (userEmojiSet.has(emoji)) {
        userEmojiSet.delete(emoji);
    } else {
        userEmojiSet.add(emoji);
    }

    // Clean up empty sets, otherwise store the updated set
    if (userEmojiSet.size === 0) {
        itemReactions.delete(currentUser.id);
    } else {
        itemReactions.set(currentUser.id, userEmojiSet);
    }

    // Re-render the modal RSB
    initModalReactions(recordId);

    // Keep the after-name sentiment chips in sync with the new reaction.
    updateModalSentimentChips(recordId);

    // Update presentation view if active
    const emojiIndicator = document.querySelector(`.item-emoji-indicator[data-record-id="${recordId}"]`);
    if (emojiIndicator && typeof window.updatePresentationEmojiIndicator === 'function') {
        window.updatePresentationEmojiIndicator(recordId);
    }

    // Trigger save and vitality recalc
    triggerSave();
    requestVitalityRecalc();

    // Broadcast via Pusher for real-time sync with other users
    if (typeof window.broadcastReactionUpdate === 'function') {
        window.broadcastReactionUpdate(recordId, itemReactions, currentUser.id);
    }

    log('Modal', `RSB reaction ${emoji} set for item ${recordId} by ${currentUser.id}`);
}

/**
 * Build the summary tab for the modal RSB.
 */
function buildModalRSBSummaryContent(container, recordId) {
    container.innerHTML = '';
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'rsb-reaction-summary';

    // Use hierarchical aggregate: direct + variations
    const allReactions = getAggregateReactions(recordId);
    console.log(`[SUMMARY-DEBUG] buildModalRSBSummaryContent(${recordId}): hierarchical reactions size=${allReactions.size}`);
    if (!allReactions || allReactions.size === 0) {
        summaryDiv.innerHTML = '<div class="rsb-summary-empty">No reactions yet — use the React tab to be first!</div>';
        container.appendChild(summaryDiv);
        return;
    }

    // Use democratic averaging for multi-emoji model
    const { democraticAverage, summaryEmoji: avgEmoji, userCount, totalReactions } = computeDemocraticAverage(allReactions);
    console.log(`[SUMMARY-DEBUG] buildModalRSBSummaryContent(${recordId}): avg=${democraticAverage.toFixed(2)}, emoji=${avgEmoji}, ${userCount} users, ${totalReactions} reactions`);

    // Count individual emojis across all users
    const emojiCounts = {};
    allReactions.forEach((emojiData) => {
        const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
        for (const emoji of emojis) {
            emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1;
        }
    });

    // Pills
    const pillsDiv = document.createElement('div');
    pillsDiv.className = 'rsb-summary-pills';
    Object.entries(emojiCounts).sort((a, b) => b[1] - a[1]).forEach(([emoji, count]) => {
        const score = REACTION_SCORES[emoji] || 0;
        const pill = document.createElement('span');
        pill.className = 'rsb-summary-pill';
        pill.title = `${emoji} ${score >= 0 ? '+' : ''}${score.toFixed(1)} · ${scoreToAdjective(score)}`;
        pill.innerHTML = `
            <span class="rsb-summary-pill-emoji">${emoji}</span>
            <span class="rsb-summary-pill-count">${count}</span>
            <span class="rsb-summary-pill-score">${score >= 0 ? '+' : ''}${score.toFixed(1)}</span>
        `;
        pillsDiv.appendChild(pill);
    });
    summaryDiv.appendChild(pillsDiv);

    // Who
    const whoDiv = document.createElement('div');
    whoDiv.className = 'rsb-summary-who';
    const names = [];
    allReactions.forEach((emojiData, userId) => {
        const name = state.session.userProfiles?.get(userId) || 'Someone';
        const emojiStr = emojiData instanceof Set ? Array.from(emojiData).join('') : emojiData;
        names.push(`${name} ${emojiStr}`);
    });
    whoDiv.textContent = names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} & ${names.length - 2} more`;
    summaryDiv.appendChild(whoDiv);

    // Average
    let closestEmoji = avgEmoji;
    const avgDiv = document.createElement('div');
    avgDiv.className = 'rsb-summary-avg';
    avgDiv.innerHTML = `
        <span class="rsb-summary-avg-emoji">${closestEmoji}</span>
        <span class="rsb-summary-avg-label">Average Sentiment</span>
        <span class="rsb-summary-avg-word">${scoreToAdjective(democraticAverage)}</span>
        <span class="rsb-summary-avg-score">${democraticAverage >= 0 ? '+' : ''}${democraticAverage.toFixed(2)}</span>
    `;
    summaryDiv.appendChild(avgDiv);

    container.appendChild(summaryDiv);
}

/**
 * Build the comments tab for the modal RSB.
 */
function buildModalRSBCommentsContent(container, recordId) {
    container.innerHTML = '';
    const section = document.createElement('div');
    section.className = 'rsb-comments-section';

    // Load comments asynchronously
    loadModalRSBComments(section, recordId);

    container.appendChild(section);
}

async function loadModalRSBComments(section, recordId) {
    const cached = modalCommentsCache.get(recordId);
    let comments = [];

    if (cached && (Date.now() - cached.timestamp) < 30000) {
        comments = cached.messages || [];
    } else {
        try {
            const allMessages = await api.fetchChatMessages(state.session.id);
            comments = allMessages.filter(msg => {
                const itemLink = msg.fields?.['Item Link'];
                return itemLink && (Array.isArray(itemLink) ? itemLink.includes(recordId) : itemLink === recordId);
            });
            modalCommentsCache.set(recordId, { messages: comments, timestamp: Date.now() });
        } catch (err) {
            log('Modal', `Error loading RSB comments: ${err.message}`);
        }
    }

    // Comments list
    const list = document.createElement('div');
    list.className = 'rsb-comments-list';

    if (comments.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'rsb-comments-empty';
        empty.textContent = 'No comments yet. Start the conversation!';
        list.appendChild(empty);
    } else {
        comments.forEach(comment => {
            const commentEl = document.createElement('div');
            commentEl.className = 'rsb-comment';
            const author = comment.fields?.SenderName || 'Someone';
            const content = comment.fields?.Content || '';
            const time = comment.fields?.CreatedTime || '';
            let timeStr = '';
            if (time) {
                try { timeStr = new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) {}
            }
            commentEl.innerHTML = `
                <span class="rsb-comment-author">${escapeHtml(author)}</span>
                <span class="rsb-comment-text">${escapeHtml(content)}</span>
                ${timeStr ? `<span class="rsb-comment-time">${timeStr}</span>` : ''}
                <button class="rsb-comment-reply-btn" data-author="${escapeHtml(author)}">↩</button>
            `;
            const replyBtn = commentEl.querySelector('.rsb-comment-reply-btn');
            if (replyBtn) {
                replyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    modalRSBReplyingTo = { author, commentId: comment.id };
                    const indicator = section.querySelector('.rsb-comment-reply-indicator');
                    if (indicator) {
                        indicator.style.display = 'flex';
                        indicator.querySelector('span').textContent = `Replying to ${author}`;
                    }
                    const input = section.querySelector('.rsb-comment-input');
                    if (input) input.focus();
                });
            }
            list.appendChild(commentEl);
        });
        requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    }
    section.appendChild(list);

    // Reply indicator
    const replyIndicator = document.createElement('div');
    replyIndicator.className = 'rsb-comment-reply-indicator';
    replyIndicator.style.display = 'none';
    replyIndicator.innerHTML = `<span>Replying to ...</span><button class="rsb-comment-reply-cancel">✕</button>`;
    replyIndicator.querySelector('.rsb-comment-reply-cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        modalRSBReplyingTo = null;
        replyIndicator.style.display = 'none';
    });
    section.appendChild(replyIndicator);

    // Input row
    const inputRow = document.createElement('div');
    inputRow.className = 'rsb-comment-input-row';
    const input = document.createElement('textarea');
    input.className = 'rsb-comment-input';
    input.placeholder = 'Add a comment...';
    input.rows = 1;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitModalRSBComment(recordId, section);
        }
    });
    inputRow.appendChild(input);

    const submitBtn = document.createElement('button');
    submitBtn.className = 'rsb-comment-submit-btn';
    submitBtn.textContent = '→';
    submitBtn.title = 'Send';
    submitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        submitModalRSBComment(recordId, section);
    });
    inputRow.appendChild(submitBtn);
    section.appendChild(inputRow);

    // Open full button
    const openFullBtn = document.createElement('button');
    openFullBtn.className = 'rsb-open-full-btn';
    openFullBtn.textContent = 'Open Full Conversation →';
    openFullBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openUCPForItem(recordId);
    });
    section.appendChild(openFullBtn);
}

async function submitModalRSBComment(recordId, section) {
    const input = section.querySelector('.rsb-comment-input');
    if (!input) return;
    let content = input.value.trim();
    if (!content) return;

    let currentUser;
    try { currentUser = getCurrentUser(); } catch (_) { return; }
    if (!state.session.id || !currentUser) return;

    if (modalRSBReplyingTo) {
        content = `@${modalRSBReplyingTo.author}: ${content}`;
    }

    input.disabled = true;

    try {
        // Use the chat message API to post the comment linked to this item
        await api.postChatMessage(
            state.session.id,
            currentUser.id,
            currentUser.name || currentUser.email || 'Anonymous',
            content,
            recordId
        );

        input.value = '';
        modalRSBReplyingTo = null;
        const indicator = section.querySelector('.rsb-comment-reply-indicator');
        if (indicator) indicator.style.display = 'none';

        // Invalidate cache and refresh
        modalCommentsCache.delete(recordId);
        section.innerHTML = '';
        await loadModalRSBComments(section, recordId);

        ui.showToast('Comment posted!', 'success');
    } catch (err) {
        log('Modal', `Error posting RSB comment: ${err.message}`);
        ui.showToast('Failed to post comment.', 'error');
    } finally {
        input.disabled = false;
        input.focus();
    }
}

// Keep the old functions as stubs to avoid breaking any external references
function renderTieredEmojiPicker() { /* consolidated into RSB */ }
function handleModalReactionSelect(recordId, emoji) {
    handleModalRSBEmojiSelect(recordId, emoji);
}
function renderModalReactionsSummary() { /* consolidated into RSB summary tab */ }

// ============================================
// MODAL COMMENTS SYSTEM
// ============================================

/**
 * Initialize the discussion button in the detail modal reactions bar.
 * Opens the Unified Chat Panel (in presentation view) or Forum Panel (outside presentation)
 * filtered to this item's comments.
 * @param {string} recordId - The item record ID
 */
async function initModalComments(recordId) {
    const discussionBtn = document.getElementById('modal-open-discussion-btn');
    const countEl = document.getElementById('modal-comments-count');

    if (!discussionBtn) return;

    // Only show discussion button if we have a session (plan context)
    const hasSession = state.session.id && state.session.id.startsWith('rec');
    const isPresentationActive = document.body.classList.contains('presentation-active');

    if (!hasSession && !isPresentationActive) {
        discussionBtn.style.display = 'none';
        return;
    }

    discussionBtn.style.display = 'inline-flex';

    // Load comment count for this item (non-blocking)
    loadModalCommentCount(recordId, countEl);

    // Open the unified conversation view filtered to this item's comments.
    discussionBtn.onclick = () => {
        openUCPForItem(recordId);
    };
}

/**
 * Load comment count for an item to display on the Discussion button badge.
 */
async function loadModalCommentCount(recordId, countEl) {
    if (!countEl) return;

    try {
        // Check cache (valid for 30 seconds)
        const cached = modalCommentsCache.get(recordId);
        let messages;
        if (cached && (Date.now() - cached.timestamp) < 30000) {
            messages = cached.messages;
        } else {
            const allMessages = await api.fetchChatMessages(state.session.id);
            messages = allMessages.filter(msg => {
                const itemLink = msg.fields?.['Item Link'];
                return itemLink && (Array.isArray(itemLink) ? itemLink.includes(recordId) : itemLink === recordId);
            });
            modalCommentsCache.set(recordId, { messages, timestamp: Date.now() });
        }

        const total = messages.length;
        countEl.textContent = total > 0 ? `${total}` : '';
        countEl.style.display = total > 0 ? 'inline-flex' : 'none';
    } catch (err) {
        log('Modal', `Error loading comment count: ${err.message}`);
    }
}

/**
 * Simple HTML escaper for content
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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

    // Undo the published-event RSVP restructure (the primary RSVP block and the
    // "…" overflow menu) so a subsequently opened non-event item is never left
    // with event-only controls. The relocated Add to Plan button is rescued back
    // into the action zone first, and the item-quantity stepper that events hide
    // is made visible again.
    const actionsContainerReset = document.getElementById('modal-actions-container');
    if (actionsContainerReset) {
        const stowedAddBtn = actionsContainerReset.querySelector('.modal-secondary-menu #modal-add-to-plan-btn');
        if (stowedAddBtn) actionsContainerReset.appendChild(stowedAddBtn);
        actionsContainerReset.querySelectorAll('.modal-rsvp-primary, .modal-secondary-menu').forEach(el => el.remove());
    }
    const quantitySelectorReset = document.getElementById('modal-quantity-selector');
    if (quantitySelectorReset) quantitySelectorReset.style.display = '';

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

    // Reset reactions & comments sections
    const reactionsSection = document.getElementById('modal-reactions-section');
    if (reactionsSection) {
        reactionsSection.style.display = 'none';
        const quickBar = document.getElementById('modal-reactions-quick-bar');
        if (quickBar) quickBar.innerHTML = '';
        const picker = document.getElementById('modal-reactions-picker');
        if (picker) { picker.innerHTML = ''; picker.style.display = 'none'; }
        const summary = document.getElementById('modal-reactions-summary');
        if (summary) summary.innerHTML = '';
        const scoreBadge = document.getElementById('modal-reactions-score-badge');
        if (scoreBadge) { scoreBadge.textContent = ''; scoreBadge.style.display = 'none'; }
        const expandBtn = document.getElementById('modal-reactions-expand-btn');
        if (expandBtn) {
            const icon = expandBtn.querySelector('.expand-btn-icon');
            if (icon) icon.textContent = '+';
        }
    }
    const discussionBtn = document.getElementById('modal-open-discussion-btn');
    if (discussionBtn) {
        discussionBtn.style.display = 'none';
        const commentsCount = document.getElementById('modal-comments-count');
        if (commentsCount) { commentsCount.textContent = ''; commentsCount.style.display = 'none'; }
    }
    modalReplyingTo = null;

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
    const originalPricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || 'flat rate';

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

    // Add Pricing Type selector
    const pricingTypeContainer = document.createElement('div');
    pricingTypeContainer.className = 'item-edit-container item-edit-pricing-type-container';
    const pricingTypeOptions = [
        { value: 'flat rate', label: 'Flat Rate' },
        { value: 'per guest', label: 'Per Guest' },
        { value: 'per hour', label: 'Per Hour' },
        { value: 'per group', label: 'Per Group' },
        { value: 'per vehicle', label: 'Per Vehicle' }
    ];
    pricingTypeContainer.innerHTML = `
        <label class="item-edit-label">Pricing Type</label>
        <select class="item-edit-input item-edit-pricing-type-select">
            ${pricingTypeOptions.map(opt => `<option value="${opt.value}"${originalPricingType.toLowerCase() === opt.value ? ' selected' : ''}>${opt.label}</option>`).join('')}
        </select>
    `;
    if (priceEl && priceEl.parentNode) {
        priceEl.parentNode.insertBefore(pricingTypeContainer, priceContainer.nextSibling);
    } else {
        descContainer.parentNode.insertBefore(pricingTypeContainer, descContainer.nextSibling);
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

    // Insert photos container after pricing type container
    if (pricingTypeContainer && pricingTypeContainer.parentNode) {
        pricingTypeContainer.parentNode.insertBefore(photosContainer, pricingTypeContainer.nextSibling);
    } else if (priceEl && priceEl.parentNode) {
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

            // Validate file size (max 10MB before resize)
            if (file.size > 10 * 1024 * 1024) {
                if (typeof ui !== 'undefined' && ui.showToast) {
                    ui.showToast('Image must be less than 10MB', 'error');
                }
                continue;
            }

            try {
                // Resize image if needed (handles large mobile photos)
                const dataUrl = await resizeImageForUpload(file);
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
            } catch (err) {
                console.error('[Modal] Error processing image:', err);
            }
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

    // ============================================================
    // CATEGORIES & TAGS section (inline in edit mode)
    // ============================================================
    const categorizeEditContainer = document.createElement('div');
    categorizeEditContainer.className = 'item-edit-container item-edit-categorize-container';

    // Track selected categories and tags
    const selectedCategories = new Set(record._categorization?.baseCategories || []);
    const selectedTags = new Set(record._categorization?.tags || []);

    categorizeEditContainer.innerHTML = `<label class="item-edit-label">Categories & Tags</label>`;

    // -- Base Categories chips --
    const catSectionEl = document.createElement('div');
    catSectionEl.style.cssText = 'margin-bottom: 10px;';
    const catSubLabel = document.createElement('div');
    catSubLabel.style.cssText = 'font-size: 0.75em; color: #666; margin-bottom: 6px; font-weight: 500;';
    catSubLabel.textContent = 'Categories (select at least one)';
    catSectionEl.appendChild(catSubLabel);

    const catChipsRow = document.createElement('div');
    catChipsRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px;';

    BASE_CATEGORIES.forEach(catDef => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'cat-editor-chip';
        chip.dataset.catId = catDef.id;
        applyCategoryChipStyle(chip, catDef, selectedCategories.has(catDef.id));
        chip.innerHTML = `<span>${catDef.icon}</span> ${catDef.label}`;
        chip.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            if (selectedCategories.has(catDef.id)) {
                if (selectedCategories.size <= 1) {
                    if (typeof ui !== 'undefined' && ui.showToast) {
                        ui.showToast('Item must have at least one category');
                    }
                    return;
                }
                selectedCategories.delete(catDef.id);
            } else {
                selectedCategories.add(catDef.id);
            }
            applyCategoryChipStyle(chip, catDef, selectedCategories.has(catDef.id));
        });
        catChipsRow.appendChild(chip);
    });
    catSectionEl.appendChild(catChipsRow);
    categorizeEditContainer.appendChild(catSectionEl);

    // -- Tags section --
    const tagSectionEl = document.createElement('div');
    tagSectionEl.style.cssText = 'margin-bottom: 10px;';
    const tagSubLabel = document.createElement('div');
    tagSubLabel.style.cssText = 'font-size: 0.75em; color: #666; margin-bottom: 6px; font-weight: 500;';
    tagSubLabel.textContent = 'Tags';
    tagSectionEl.appendChild(tagSubLabel);

    const tagPickerContainer = document.createElement('div');
    tagPickerContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; max-height: 180px; overflow-y: auto; padding-right: 4px;';

    TAG_GROUPS.forEach(group => {
        const groupDiv = document.createElement('div');
        const groupLabel = document.createElement('div');
        groupLabel.style.cssText = 'font-size: 0.7em; color: #999; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.5px;';
        groupLabel.textContent = group.label;
        groupDiv.appendChild(groupLabel);

        const tagsRow = document.createElement('div');
        tagsRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px;';

        group.tags.forEach(tag => {
            const tagChip = document.createElement('button');
            tagChip.type = 'button';
            tagChip.className = 'tag-editor-chip';
            tagChip.dataset.tag = tag;
            applyTagChipStyle(tagChip, selectedTags.has(tag));
            tagChip.textContent = tag;
            tagChip.addEventListener('click', (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                if (selectedTags.has(tag)) {
                    selectedTags.delete(tag);
                } else {
                    selectedTags.add(tag);
                }
                applyTagChipStyle(tagChip, selectedTags.has(tag));
            });
            tagsRow.appendChild(tagChip);
        });

        groupDiv.appendChild(tagsRow);
        tagPickerContainer.appendChild(groupDiv);
    });

    // Custom tag input row
    const customTagRow = document.createElement('div');
    customTagRow.style.cssText = 'display: flex; gap: 6px; align-items: center; margin-top: 4px;';
    const customTagInput = document.createElement('input');
    customTagInput.type = 'text';
    customTagInput.placeholder = 'Add custom tag...';
    customTagInput.maxLength = 30;
    customTagInput.style.cssText = 'flex: 1; padding: 4px 8px; border: 1px solid #ddd; border-radius: 8px; font-size: 0.75em; outline: none;';
    const addCustomTagBtn = document.createElement('button');
    addCustomTagBtn.type = 'button';
    addCustomTagBtn.textContent = '+ Add';
    addCustomTagBtn.style.cssText = 'padding: 4px 10px; border: 1px solid #1565c0; background: #e3f2fd; color: #1565c0; border-radius: 8px; font-size: 0.75em; cursor: pointer; white-space: nowrap;';

    function addCustomTagInEditMode() {
        const val = customTagInput.value.trim();
        if (val && val.length <= 30 && !selectedTags.has(val)) {
            selectedTags.add(val);
            const customChip = document.createElement('button');
            customChip.type = 'button';
            customChip.className = 'tag-editor-chip';
            customChip.dataset.tag = val;
            applyTagChipStyle(customChip, true);
            customChip.textContent = val;
            customChip.addEventListener('click', (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                if (selectedTags.has(val)) {
                    selectedTags.delete(val);
                } else {
                    selectedTags.add(val);
                }
                applyTagChipStyle(customChip, selectedTags.has(val));
            });
            customTagRow.before(customChip);
            customTagInput.value = '';
        }
    }

    addCustomTagBtn.addEventListener('click', addCustomTagInEditMode);
    customTagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCustomTagInEditMode();
        }
    });
    customTagRow.appendChild(customTagInput);
    customTagRow.appendChild(addCustomTagBtn);
    tagPickerContainer.appendChild(customTagRow);

    tagSectionEl.appendChild(tagPickerContainer);
    categorizeEditContainer.appendChild(tagSectionEl);

    // -- AI Suggest button for categories & tags --
    const aiSuggestRow = document.createElement('div');
    aiSuggestRow.style.cssText = 'display: flex; gap: 8px; margin-top: 4px;';
    const aiSuggestBtn = document.createElement('button');
    aiSuggestBtn.type = 'button';
    aiSuggestBtn.style.cssText = `
        padding: 6px 14px;
        border: 1px solid #43a047;
        background: white;
        color: #43a047;
        border-radius: 8px;
        font-size: 0.8em;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    `;
    aiSuggestBtn.innerHTML = '🤖 AI Suggest';
    aiSuggestBtn.addEventListener('click', async (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        aiSuggestBtn.disabled = true;
        aiSuggestBtn.innerHTML = '⏳ Thinking...';

        try {
            let itemRecord = record;
            if (record.id?.startsWith('solution-') && window._solutionRecords) {
                const sr = window._solutionRecords.get(record.id);
                if (sr) itemRecord = sr;
            }
            if (!itemRecord.fields && state.records.all) {
                const sr = getRecordById(record.id);
                if (sr) itemRecord = sr;
            }

            const result = await api.categorizeItem(itemRecord);
            if (result.success && result.categorization) {
                selectedCategories.clear();
                (result.categorization.baseCategories || []).forEach(c => selectedCategories.add(c));
                selectedTags.clear();
                (result.categorization.tags || []).forEach(t => selectedTags.add(t));

                // Re-apply styles to category chips
                catChipsRow.querySelectorAll('.cat-editor-chip').forEach(chip => {
                    const catDef = BASE_CATEGORIES.find(c => c.id === chip.dataset.catId);
                    if (catDef) applyCategoryChipStyle(chip, catDef, selectedCategories.has(catDef.id));
                });
                // Re-apply styles to tag chips
                tagPickerContainer.querySelectorAll('.tag-editor-chip').forEach(chip => {
                    applyTagChipStyle(chip, selectedTags.has(chip.dataset.tag));
                });

                if (typeof ui !== 'undefined' && ui.showToast) {
                    ui.showToast('AI suggestions applied! Adjust as needed.');
                }
            }
        } catch (err) {
            console.error('AI suggest failed:', err);
            if (typeof ui !== 'undefined' && ui.showToast) {
                ui.showToast('AI suggestion failed. Try again.');
            }
        }

        aiSuggestBtn.disabled = false;
        aiSuggestBtn.innerHTML = '🤖 AI Suggest';
    });
    aiSuggestRow.appendChild(aiSuggestBtn);
    categorizeEditContainer.appendChild(aiSuggestRow);

    // Store selected sets on the container for the save handler to access
    categorizeEditContainer._selectedCategories = selectedCategories;
    categorizeEditContainer._selectedTags = selectedTags;

    // Insert categorize section after photos container
    if (photosContainer && photosContainer.parentNode) {
        photosContainer.parentNode.insertBefore(categorizeEditContainer, photosContainer.nextSibling);
    } else if (pricingTypeContainer && pricingTypeContainer.parentNode) {
        pricingTypeContainer.parentNode.insertBefore(categorizeEditContainer, pricingTypeContainer.nextSibling);
    } else {
        descContainer.parentNode.insertBefore(categorizeEditContainer, descContainer.nextSibling);
    }

    // Add Save button container
    const saveContainer = document.createElement('div');
    saveContainer.className = 'item-edit-save-container';
    saveContainer.innerHTML = `
        <button class="item-edit-save-btn">💾 Save Changes</button>
        <button class="item-edit-delete-btn" type="button">🗑️ Delete ${isPublicIdeaRecord(record) ? 'Public Idea' : 'Item'}</button>
    `;

    // Insert save button before the Add to Plan button
    const actionsContainer = document.getElementById('modal-actions-container');
    if (actionsContainer) {
        actionsContainer.insertBefore(saveContainer, actionsContainer.firstChild);
    }

    // Save button handler
    const saveBtn = saveContainer.querySelector('.item-edit-save-btn');

    // Delete button handler — removes the item from the bottom of edit mode. Public
    // ideas are deleted from the community layer (authors and publish-access users);
    // any other editable item is removed from the current plan and the local catalog.
    const deleteBtn = saveContainer.querySelector('.item-edit-delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleItemDelete(record, deleteBtn);
        });
    }

    saveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        const newName = nameContainer.querySelector('.item-edit-name-input').value.trim();
        const newDesc = descContainer.querySelector('.item-edit-desc-input').value.trim();
        const newPrice = parseFloat(priceContainer.querySelector('.item-edit-price-input').value) || 0;
        const newPricingType = pricingTypeContainer.querySelector('.item-edit-pricing-type-select').value;

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
                console.log('[AI IMAGE DEBUG] No photos detected - checking if manual or solution item');
                // Check if this is a manual or solution item that could benefit from AI image
                const isManualItem = record.isManual === true ||
                                     record.id?.startsWith('manual-add-') ||
                                     record.id?.startsWith('manual-presentation-') ||
                                     record.id?.startsWith('ai-search-') ||
                                     record.id?.startsWith('ai-child-') ||
                                     record.id?.startsWith('ai-presentation-');
                const isSolutionItem = record.isSolution === true ||
                                       record.id?.startsWith('solution-');
                const isAIImageEligible = isManualItem || isSolutionItem;

                console.log('[AI IMAGE DEBUG] isManualItem check:', {
                    'record.isManual': record.isManual,
                    'starts with manual-add-': record.id?.startsWith('manual-add-'),
                    'starts with manual-presentation-': record.id?.startsWith('manual-presentation-'),
                    'starts with ai-search-': record.id?.startsWith('ai-search-'),
                    'starts with ai-child-': record.id?.startsWith('ai-child-'),
                    'starts with ai-presentation-': record.id?.startsWith('ai-presentation-'),
                    'record.isSolution': record.isSolution,
                    'starts with solution-': record.id?.startsWith('solution-'),
                    'final isManualItem': isManualItem,
                    'final isSolutionItem': isSolutionItem,
                    'final isAIImageEligible': isAIImageEligible
                });

                if (isAIImageEligible) {
                    log('Modal', `No photos provided for ${isSolutionItem ? 'solution' : 'manual'} item "${newName}" - generating AI image approximation...`);
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
                    console.log('[AI IMAGE DEBUG] NOT a manual or solution item - skipping AI image generation');
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
                state.records.all[recordIndex].fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] = newPricingType;
                // Store custom images in a special field
                if (allPhotos.length > 0) {
                    state.records.all[recordIndex].fields._customImages = allPhotos;
                    // Track if any are AI-generated
                    if (aiGeneratedImage) {
                        state.records.all[recordIndex].fields._hasAIGeneratedImage = true;
                    }
                }
            }

            // Also update the solution records registry if this is a solution item
            if (window._solutionRecords && window._solutionRecords.has(record.id)) {
                const solutionRec = window._solutionRecords.get(record.id);
                solutionRec.fields.Name = newName;
                solutionRec.fields.Description = newDesc;
                solutionRec.fields.Price = newPrice;
                solutionRec.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] = newPricingType;
                if (allPhotos.length > 0) {
                    solutionRec.fields._customImages = allPhotos;
                    if (aiGeneratedImage) {
                        solutionRec.fields._hasAIGeneratedImage = true;
                    }
                }
            }

            // Also update the record reference passed to the modal
            record.fields.Name = newName;
            record.fields.Description = newDesc;
            record.fields.Price = newPrice;
            record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] = newPricingType;
            if (allPhotos.length > 0) {
                record.fields._customImages = allPhotos;
                if (aiGeneratedImage) {
                    record.fields._hasAIGeneratedImage = true;
                }
            }

            // ============================================================
            // SAVE CATEGORIZATION: Save categories & tags from edit mode
            // ============================================================
            const categorizeEl = document.querySelector('.item-edit-categorize-container');
            if (categorizeEl && categorizeEl._selectedCategories && categorizeEl._selectedTags) {
                const selCats = Array.from(categorizeEl._selectedCategories);
                const selTags = Array.from(categorizeEl._selectedTags);

                // Only save if user has selected at least one category
                if (selCats.length > 0 || selTags.length > 0) {
                    console.log('[CATEGORIZATION DEBUG] Saving categorization (edit mode)', {
                        recordId: record.id,
                        recordName: record.fields?.Name,
                        selectedCategories: selCats,
                        selectedTags: selTags,
                        fieldsCategories: record.fields?.Categories,
                        fieldsCategory: record.fields?.Category,
                        isCustom: record.id?.startsWith('ai-') || record.id?.startsWith('manual-') || record.id?.startsWith('solution-')
                    });
                    const newCategorization = {
                        ...(record._categorization || {}),
                        baseCategories: selCats,
                        tags: selTags,
                        categorizedAt: new Date().toISOString(),
                        _manuallyEdited: true,
                    };

                    record._categorization = newCategorization;

                    // Update solution registry if applicable
                    if (record.id?.startsWith('solution-') && window._solutionRecords) {
                        const sr = window._solutionRecords.get(record.id);
                        if (sr) sr._categorization = newCategorization;
                    }

                    // Update in state.records.all if present
                    const catStateIndex = state.records.all.findIndex(r => r.id === record.id);
                    if (catStateIndex !== -1) {
                        state.records.all[catStateIndex]._categorization = newCategorization;
                    }

                    log('Modal', `Saved categorization for item ${record.id}: ${selCats.length} categories, ${selTags.length} tags`);
                }
            }

            // Update solutionData on the record if this is a solution item
            if (record.isSolution && record.solutionData) {
                record.solutionData.name = newName;
                record.solutionData.description = newDesc;
                if (newPrice > 0) {
                    record.solutionData.estimatedPrice = `$${newPrice.toFixed(2)}`;
                }
                // Also update the parent concept's _generatedSolutions array if available
                if (record.parentConceptRecord && record.parentConceptRecord._generatedSolutions) {
                    const solutionIndex = record.parentConceptRecord._generatedSolutions.findIndex(
                        s => s.name === originalName || s.id === record.solutionData.id
                    );
                    if (solutionIndex !== -1) {
                        record.parentConceptRecord._generatedSolutions[solutionIndex].name = newName;
                        record.parentConceptRecord._generatedSolutions[solutionIndex].description = newDesc;
                        if (newPrice > 0) {
                            record.parentConceptRecord._generatedSolutions[solutionIndex].estimatedPrice = `$${newPrice.toFixed(2)}`;
                        }
                        log('Modal', `Updated parent concept's solution data at index ${solutionIndex}`);
                    }
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
                const pricingTypeHTML = newPricingType ? `<span class="pricing-type"> / ${newPricingType.toLowerCase()}</span>` : '';
                priceEl.innerHTML = (newPrice > 0 ? `$${newPrice.toFixed(2)}` : 'Free') + pricingTypeHTML;
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
 * Delete the item currently shown in the detail modal, invoked from the Delete
 * button in edit mode. Behaviour depends on what the record actually is:
 *   - A community "Public Idea" is deleted from the public layer. The endpoint
 *     authorises the idea's author and any user with publish permission on the
 *     owning store, so this is the moderation path for publish-access users.
 *   - Any other editable item (a manual/AI/solution plan item, or a curated
 *     catalog item a publish user opened) is removed from the plan and from the
 *     local catalog view.
 * In every case the record is dropped from local state, the modal is closed, and
 * the catalog is re-rendered so the item disappears immediately.
 * @param {object} record
 * @param {HTMLElement} [btn] - the Delete button, disabled while the request runs
 */
async function handleItemDelete(record, btn) {
    if (!record) return;
    const isPublicIdea = isPublicIdeaRecord(record);
    const name = record.fields?.Name || 'this item';
    const confirmMsg = isPublicIdea
        ? `Delete the public idea "${name}"? This removes it for everyone — including its reactions and comments — and cannot be undone.`
        : `Delete "${name}"? This removes it from your plan and cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    const restoreBtn = () => {
        if (btn) {
            btn.disabled = false;
            btn.textContent = `🗑️ Delete ${isPublicIdea ? 'Public Idea' : 'Item'}`;
        }
    };
    if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }

    try {
        // Public ideas live in the community (Postgres) layer; delete there first so a
        // failed/forbidden request leaves everything untouched.
        if (isPublicIdea) {
            const ok = await api.deletePublicResource('items', record.publicItemId);
            if (!ok) {
                const msg = 'Could not delete this idea — you may not have permission.';
                if (typeof ui !== 'undefined' && ui.showToast) ui.showToast(msg, 'error');
                else alert(msg);
                restoreBtn();
                return;
            }
        }

        // Drop the item from any plan membership (no-op if it was never added) and
        // from the local catalog so it disappears from every view immediately.
        try { state.cart?.lockedItems?.delete?.(record.id); } catch (_) {}
        try { state.cart?.items?.delete?.(record.id); } catch (_) {}
        try { state.cart?.customItems?.delete?.(record.id); } catch (_) {}
        state.records.all = state.records.all.filter(r => r.id !== record.id);
        invalidateRecordsIndex();

        // Persist plan changes for ordinary (non-public) items; public-idea deletion
        // is already persisted server-side above.
        if (!isPublicIdea && typeof triggerSave === 'function') {
            try { await triggerSave(); } catch (_) {}
        }
        try { syncPlanStateAcrossViews('modal', 'itemDeleted', { recordId: record.id, itemName: name }); } catch (_) {}

        closeDetailModal();

        if (typeof window.applyFiltersAndSort === 'function') {
            window.applyFiltersAndSort(window.imageCache);
        }
        if (typeof renderAllItems === 'function') {
            try { await renderAllItems(); } catch (_) {}
        }

        const okMsg = isPublicIdea ? 'Public idea deleted.' : 'Item deleted.';
        if (typeof ui !== 'undefined' && ui.showToast) ui.showToast(okMsg, 'success');
        log('Modal', `Deleted ${isPublicIdea ? 'public idea' : 'item'}: ${record.id}`);
    } catch (error) {
        console.error('[Modal] handleItemDelete error:', error);
        restoreBtn();
        alert('Failed to delete. Please try again.');
    }
}

/**
 * Build cards for the components that make up a saved plan.
 * @param {HTMLElement} container - Container element to append cards to
 * @param {Array} componentRecords - Array of component data objects
 * @param {string} sessionId - ID of the linked session
 */
async function buildPlanComponentCards(container, componentRecords, sessionId) {
    // Import getRecordPrice for price calculation
    const { getRecordPrice } = await import('../utils.js');

    // === PERFORMANCE: Fetch all component images in parallel instead of sequentially ===
    const imageResults = await Promise.all(
        componentRecords.map(async (componentData) => {
            try {
                const { imageUrls: fetchedUrls } = await api.fetchImagesForRecord(componentData.record, state.records.all, new Map());
                return fetchedUrls || [];
            } catch (e) {
                console.warn('Failed to fetch images for component:', componentData.record.id, e);
                return [];
            }
        })
    );

    for (let i = 0; i < componentRecords.length; i++) {
        const componentData = componentRecords[i];
        const record = componentData.record;
        const type = componentData.type;
        const history = componentData.history;

        let imageUrls = imageResults[i];
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

/**
 * Opens an inline categorization editor panel in the modal.
 * Lets users toggle base categories and tags, then apply changes.
 */
function openCategorizationEditor(record, parentContainer, existingBadgesEl) {
    // Remove any existing editor
    const sidebarColumn = document.querySelector('.modal-sidebar-column');
    const existingEditor = sidebarColumn?.querySelector('.categorization-editor') || parentContainer.closest('.modal-content')?.querySelector('.categorization-editor');
    if (existingEditor) {
        existingEditor.remove();
        return; // Toggle off
    }

    // Create working copies of the current state
    const selectedCategories = new Set(record._categorization?.baseCategories || []);
    const selectedTags = new Set(record._categorization?.tags || []);

    const editor = document.createElement('div');
    editor.className = 'categorization-editor';
    editor.style.cssText = `
        background: #fafafa;
        border: 1px solid #e0e0e0;
        border-radius: 12px;
        padding: 16px;
        margin: 12px 0;
        animation: slideDown 0.2s ease-out;
    `;

    // -- Header row --
    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
    headerRow.innerHTML = `
        <span style="font-weight: 600; font-size: 0.9em; color: #333;">Edit Categories & Tags</span>
    `;
    const closeEditorBtn = document.createElement('button');
    closeEditorBtn.style.cssText = 'background: none; border: none; cursor: pointer; font-size: 1.1em; color: #999; padding: 2px 6px;';
    closeEditorBtn.textContent = '✕';
    closeEditorBtn.addEventListener('click', () => editor.remove());
    headerRow.appendChild(closeEditorBtn);
    editor.appendChild(headerRow);

    // -- Base Categories section --
    const catSection = document.createElement('div');
    catSection.style.cssText = 'margin-bottom: 14px;';
    catSection.innerHTML = '<div style="font-size: 0.8em; color: #666; margin-bottom: 6px; font-weight: 500;">Categories</div>';

    const catGrid = document.createElement('div');
    catGrid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px;';

    BASE_CATEGORIES.forEach(catDef => {
        const chip = document.createElement('button');
        const isSelected = selectedCategories.has(catDef.id);
        chip.className = 'cat-editor-chip';
        chip.dataset.catId = catDef.id;
        applyCategoryChipStyle(chip, catDef, isSelected);
        chip.innerHTML = `<span>${catDef.icon}</span> ${catDef.label}`;
        chip.addEventListener('click', () => {
            if (selectedCategories.has(catDef.id)) {
                // Don't allow removing the last category
                if (selectedCategories.size <= 1) {
                    if (typeof ui !== 'undefined' && ui.showToast) {
                        ui.showToast('Item must have at least one category');
                    }
                    return;
                }
                selectedCategories.delete(catDef.id);
            } else {
                selectedCategories.add(catDef.id);
            }
            applyCategoryChipStyle(chip, catDef, selectedCategories.has(catDef.id));
        });
        catGrid.appendChild(chip);
    });
    catSection.appendChild(catGrid);
    editor.appendChild(catSection);

    // -- Tags section --
    const tagSection = document.createElement('div');
    tagSection.style.cssText = 'margin-bottom: 14px;';
    tagSection.innerHTML = '<div style="font-size: 0.8em; color: #666; margin-bottom: 6px; font-weight: 500;">Tags</div>';

    const tagContainer = document.createElement('div');
    tagContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto; padding-right: 4px;';

    TAG_GROUPS.forEach(group => {
        const groupDiv = document.createElement('div');
        const groupLabel = document.createElement('div');
        groupLabel.style.cssText = 'font-size: 0.7em; color: #999; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.5px;';
        groupLabel.textContent = group.label;
        groupDiv.appendChild(groupLabel);

        const tagsRow = document.createElement('div');
        tagsRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px;';

        group.tags.forEach(tag => {
            const tagChip = document.createElement('button');
            tagChip.className = 'tag-editor-chip';
            tagChip.dataset.tag = tag;
            applyTagChipStyle(tagChip, selectedTags.has(tag));
            tagChip.textContent = tag;
            tagChip.addEventListener('click', () => {
                if (selectedTags.has(tag)) {
                    selectedTags.delete(tag);
                } else {
                    selectedTags.add(tag);
                }
                applyTagChipStyle(tagChip, selectedTags.has(tag));
            });
            tagsRow.appendChild(tagChip);
        });

        groupDiv.appendChild(tagsRow);
        tagContainer.appendChild(groupDiv);
    });

    // Custom tag input
    const customTagRow = document.createElement('div');
    customTagRow.style.cssText = 'display: flex; gap: 6px; align-items: center; margin-top: 4px;';
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = 'Add custom tag...';
    customInput.maxLength = 30;
    customInput.style.cssText = `
        flex: 1;
        padding: 4px 8px;
        border: 1px solid #ddd;
        border-radius: 8px;
        font-size: 0.75em;
        outline: none;
    `;
    const addTagBtn = document.createElement('button');
    addTagBtn.textContent = '+ Add';
    addTagBtn.style.cssText = `
        padding: 4px 10px;
        border: 1px solid #1565c0;
        background: #e3f2fd;
        color: #1565c0;
        border-radius: 8px;
        font-size: 0.75em;
        cursor: pointer;
        white-space: nowrap;
    `;

    function addCustomTag() {
        const val = customInput.value.trim();
        if (val && val.length <= 30 && !selectedTags.has(val)) {
            selectedTags.add(val);
            // Add a visual chip for the custom tag
            const customChip = document.createElement('button');
            customChip.className = 'tag-editor-chip';
            customChip.dataset.tag = val;
            applyTagChipStyle(customChip, true);
            customChip.textContent = val;
            customChip.addEventListener('click', () => {
                if (selectedTags.has(val)) {
                    selectedTags.delete(val);
                } else {
                    selectedTags.add(val);
                }
                applyTagChipStyle(customChip, selectedTags.has(val));
            });
            // Insert before the custom input row
            customTagRow.before(customChip);
            customInput.value = '';
        }
    }

    addTagBtn.addEventListener('click', addCustomTag);
    customInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCustomTag();
        }
    });
    customTagRow.appendChild(customInput);
    customTagRow.appendChild(addTagBtn);
    tagContainer.appendChild(customTagRow);

    tagSection.appendChild(tagContainer);
    editor.appendChild(tagSection);

    // -- Action buttons --
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;';

    const aiSuggestBtn = document.createElement('button');
    aiSuggestBtn.style.cssText = `
        padding: 6px 14px;
        border: 1px solid #43a047;
        background: white;
        color: #43a047;
        border-radius: 8px;
        font-size: 0.8em;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    `;
    aiSuggestBtn.innerHTML = '🤖 AI Suggest';
    aiSuggestBtn.addEventListener('click', async () => {
        aiSuggestBtn.disabled = true;
        aiSuggestBtn.innerHTML = '⏳ Thinking...';

        try {
            let itemRecord = record;
            if (record.id?.startsWith('solution-') && window._solutionRecords) {
                const sr = window._solutionRecords.get(record.id);
                if (sr) itemRecord = sr;
            }
            if (!itemRecord.fields && state.records.all) {
                const sr = getRecordById(record.id);
                if (sr) itemRecord = sr;
            }

            const result = await api.categorizeItem(itemRecord);
            if (result.success && result.categorization) {
                // Update selections with AI suggestions
                selectedCategories.clear();
                (result.categorization.baseCategories || []).forEach(c => selectedCategories.add(c));
                selectedTags.clear();
                (result.categorization.tags || []).forEach(t => selectedTags.add(t));

                // Re-apply styles to all chips
                catGrid.querySelectorAll('.cat-editor-chip').forEach(chip => {
                    const catDef = BASE_CATEGORIES.find(c => c.id === chip.dataset.catId);
                    if (catDef) applyCategoryChipStyle(chip, catDef, selectedCategories.has(catDef.id));
                });
                tagContainer.querySelectorAll('.tag-editor-chip').forEach(chip => {
                    applyTagChipStyle(chip, selectedTags.has(chip.dataset.tag));
                });

                if (typeof ui !== 'undefined' && ui.showToast) {
                    ui.showToast('AI suggestions applied! Adjust as needed.');
                }
            }
        } catch (err) {
            console.error('AI suggest failed:', err);
            if (typeof ui !== 'undefined' && ui.showToast) {
                ui.showToast('AI suggestion failed. Try again.');
            }
        }

        aiSuggestBtn.disabled = false;
        aiSuggestBtn.innerHTML = '🤖 AI Suggest';
    });

    const applyBtn = document.createElement('button');
    applyBtn.style.cssText = `
        padding: 6px 14px;
        border: none;
        background: linear-gradient(135deg, #43a047 0%, #1b5e20 100%);
        color: white;
        border-radius: 8px;
        font-size: 0.8em;
        cursor: pointer;
        font-weight: 600;
    `;
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', () => {
        // Save the categorization to the record
        const newCategorization = {
            ...(record._categorization || {}),
            baseCategories: Array.from(selectedCategories),
            tags: Array.from(selectedTags),
            categorizedAt: new Date().toISOString(),
            _manuallyEdited: true,
        };

        console.log('[CATEGORIZATION DEBUG] Apply categorization editor changes', {
            recordId: record.id,
            recordName: record.fields?.Name,
            selectedCategories: Array.from(selectedCategories),
            selectedTags: Array.from(selectedTags),
            fieldsCategories: record.fields?.Categories,
            fieldsCategory: record.fields?.Category,
            isCustom: record.id?.startsWith('ai-') || record.id?.startsWith('manual-') || record.id?.startsWith('solution-')
        });

        record._categorization = newCategorization;

        // Update solution registry if applicable
        if (record.id?.startsWith('solution-') && window._solutionRecords) {
            const sr = window._solutionRecords.get(record.id);
            if (sr) sr._categorization = newCategorization;
        }

        // Update in state.records.all if present
        const stateIndex = state.records.all.findIndex(r => r.id === record.id);
        if (stateIndex !== -1) {
            state.records.all[stateIndex]._categorization = newCategorization;
        }

        if (typeof ui !== 'undefined' && ui.showToast) {
            ui.showToast('Categories & tags updated!');
        }

        // Re-render the modal to show updated badges
        showDetailModal(record);
    });

    actionRow.appendChild(aiSuggestBtn);
    actionRow.appendChild(applyBtn);
    editor.appendChild(actionRow);

    // Insert editor right after the header actions row in the sidebar
    const modalHeaderActionsEl = document.getElementById('modal-header-actions');
    if (modalHeaderActionsEl && modalHeaderActionsEl.nextElementSibling) {
        modalHeaderActionsEl.parentElement.insertBefore(editor, modalHeaderActionsEl.nextElementSibling);
    } else if (modalHeaderActionsEl) {
        modalHeaderActionsEl.parentElement.appendChild(editor);
    } else {
        // Fallback: insert after the trigger container
        const insertTarget = parentContainer.closest('.modal-header-actions-row') || parentContainer;
        if (insertTarget.nextElementSibling) {
            insertTarget.parentElement.insertBefore(editor, insertTarget.nextElementSibling);
        } else {
            insertTarget.parentElement.appendChild(editor);
        }
    }
}

/**
 * Apply styling to a base category chip based on selection state
 */
function applyCategoryChipStyle(chip, catDef, isSelected) {
    chip.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 5px 12px;
        border-radius: 20px;
        font-size: 0.8em;
        cursor: pointer;
        transition: all 0.15s;
        border: 2px solid ${isSelected ? catDef.color : '#ddd'};
        background: ${isSelected ? catDef.bg : 'white'};
        color: ${isSelected ? catDef.color : '#888'};
        font-weight: ${isSelected ? '600' : '400'};
        opacity: ${isSelected ? '1' : '0.7'};
    `;
}

/**
 * Apply styling to a tag chip based on selection state
 */
function applyTagChipStyle(chip, isSelected) {
    chip.style.cssText = `
        padding: 3px 8px;
        border-radius: 12px;
        font-size: 0.7em;
        cursor: pointer;
        transition: all 0.15s;
        border: 1px solid ${isSelected ? '#1565c0' : '#e0e0e0'};
        background: ${isSelected ? '#e3f2fd' : 'white'};
        color: ${isSelected ? '#1565c0' : '#888'};
        font-weight: ${isSelected ? '500' : '400'};
        white-space: nowrap;
    `;
}

// Guard to prevent concurrent modal rendering
let isModalRendering = false;

/**
 * Wire up a collapsible accordion section in the detail modal (Add Notes, Item Scheduling).
 * Resets the section to collapsed and rebinds its toggle so listeners don't stack across opens.
 */
function setupModalAccordion(containerId, toggleId) {
    const container = document.getElementById(containerId);
    const toggle = document.getElementById(toggleId);
    if (!container || !toggle) return;
    // Start collapsed every time the modal opens.
    container.classList.remove('expanded');
    // Clone to drop any previously attached listeners.
    const freshToggle = toggle.cloneNode(true);
    toggle.parentNode.replaceChild(freshToggle, toggle);
    freshToggle.setAttribute('aria-expanded', 'false');
    freshToggle.addEventListener('click', () => {
        const expanded = container.classList.toggle('expanded');
        freshToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
}

/**
 * Resolve the display names of the items that make up a published plan, for use
 * in a calendar entry's "What's Included" notes. Reads the linked session's
 * locked-in items and resolves each id against the loaded records (and the
 * ghost-item archive), appending a quantity hint when more than one. Returns []
 * when there is no linked session or its component data can't be parsed.
 *
 * @param {Object|null} linkedSession - The event's linked session record
 * @returns {string[]} Component item names (possibly empty)
 */
function resolvePlanComponentNames(linkedSession) {
    if (!linkedSession || !linkedSession.fields || !linkedSession.fields['Items with Variations']) return [];

    let lockedInItems = {};
    try {
        const data = JSON.parse(linkedSession.fields['Items with Variations']);
        lockedInItems = data.lockedInItems || {};
    } catch (e) {
        return [];
    }

    const recordMap = new Map((state.records.all || []).map(r => [r.id, r]));
    const archiveMap = state.records.archive ? new Map(state.records.archive.map(r => [r.id, r])) : null;

    const names = [];
    for (const [id, info] of Object.entries(lockedInItems)) {
        const rec = recordMap.get(id) || (archiveMap && archiveMap.get(id));
        const name = rec?.fields?.Name;
        if (name) {
            const qty = info && info.quantity > 1 ? ` (x${info.quantity})` : '';
            names.push(`${name}${qty}`);
        }
    }
    return names;
}

export async function showDetailModal(record, startPhotoIndex = 0, fromGroup = null) {
    // Prevent concurrent modal renders that could cause duplicate content
    if (isModalRendering) {
        log('Modal', 'Modal is already rendering, skipping duplicate call');
        return;
    }
    isModalRendering = true;

    try {

    // DEBUG: Comprehensive entry point logging for direct modal URL debugging
    const deferredCssLink = document.querySelector('link[href*="deferred.css"]');
    const deferredCssLoaded = deferredCssLink && deferredCssLink.rel === 'stylesheet';

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

    // === PERFORMANCE: Show modal immediately with loading placeholder for image ===
    // Show the modal overlay right away so the user sees instant feedback.
    // Synchronous data (name, price, description) populates immediately.
    // Async data (images, session lookups) fills in progressively.
    const modalMainImageLoading = document.createElement('div');
    modalMainImageLoading.className = 'modal-image-loading-placeholder';
    modalMainImageLoading.innerHTML = '<div class="loading-spinner"></div>';
    modalMainImage.appendChild(modalMainImageLoading);

    // Show the overlay immediately (before any async work)
    const isPresentationActiveEarly = document.body.classList.contains('presentation-active');
    const modalZIndexEarly = getModalZIndex('detail');
    modalOverlay.classList.add('active');
    modalOverlay.style.cssText = `
        display: flex;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.6);
        z-index: ${modalZIndexEarly};
        justify-content: center;
        align-items: center;
        opacity: 1;
        pointer-events: auto;
    `;
    const modalContentElEarly = modalOverlay.querySelector('.modal-content');
    if (modalContentElEarly) {
        const isMobileEarly = window.innerWidth <= 768;
        modalContentElEarly.style.cssText = `
            background: #fff;
            border-radius: 12px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
            width: 90%;
            max-width: 1100px;
            height: ${isMobileEarly ? 'auto' : '90vh'};
            max-height: ${isMobileEarly ? '95vh' : '700px'};
            display: flex;
            flex-direction: ${isMobileEarly ? 'column' : 'row'};
            overflow: hidden;
            position: relative;
            color: #333;
            transform: scale(1);
            opacity: 1;
            pointer-events: auto;
        `;
    }
    document.body.classList.add('modal-open');

    // Start session lookups asynchronously (don't block modal display)
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
            // Run both fallback lookups in parallel for speed
            const [byLinkedItem, containingItem] = await Promise.all([
                api.fetchSessionByLinkedItem(record.id),
                api.fetchSessionContainingItem(record.id, state.ui.activeShopId)
            ]);
            if (byLinkedItem) {
                linkedSession = byLinkedItem;
                linkedSessionId = byLinkedItem.id;
            } else if (containingItem) {
                linkedSession = containingItem;
                linkedSessionId = containingItem.id;
                itemIsContainedInSession = true; // This item is a component, not the parent event
                log('Modal', `Event item found as component in session ${linkedSessionId}`);
            }
        }
    }

    const isLocked = state.cart.lockedItems.has(record.id);
    modalOverlay.dataset.mode = isLocked ? 'edit-locked' : 'edit-favorite';

    const itemState = isLocked ? state.cart.lockedItems.get(record.id) : ui.getItemState(record.id);

    // Check if this is a package - packages have their own button handling later
    const isPackageItem = record.fields['Item Type'] === 'Package';

    if (addToPlanBtn) {
        // Show Add to Plan / Update Plan button for all items including free ones
        addToPlanBtn.style.display = '';
        addToPlanBtn.textContent = isLocked ? 'Update plan' : 'Add to Plan';
        addToPlanBtn.dataset.tooltip = isLocked ? 'Update plan with changes' : 'Add to plan';
    }

    // When the item is already in the plan, surface what specifically was added
    // (quantity, total, note) plus a reactions affordance, above the update button.
    // Always called so any stale block from a prior modal open is cleared; only
    // renders for non-package locked items (packages have their own button flow).
    renderInPlanSummary(record, itemState, isLocked && !isPackageItem);

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

        // Read the live option selections from the rendered option buttons in the
        // detail modal. Mirrors the logic used by "Add to Plan" (see events.js) so
        // Rapid Pay / Chip In reflect the same adjusted price and selected options.
        // Returns a selections object like { group0: 1, group1: [0, 2] }.
        const readLiveSelections = () => {
            const selections = {};
            const optionGroupEls = document.querySelectorAll('#modal-options-container .option-group');
            if (optionGroupEls.length > 0) {
                optionGroupEls.forEach((group) => {
                    const groupIndex = group.dataset.groupIndex;
                    const selectedBtns = group.querySelectorAll('.option-btn.selected');
                    if (selectedBtns.length > 0 && groupIndex !== undefined) {
                        if (selectedBtns.length === 1) {
                            selections[`group${groupIndex}`] = parseInt(selectedBtns[0].dataset.optionIndex, 10) || 0;
                        } else {
                            selections[`group${groupIndex}`] = Array.from(selectedBtns)
                                .map(btn => parseInt(btn.dataset.optionIndex, 10) || 0)
                                .sort((a, b) => a - b);
                        }
                    }
                });
            } else {
                const selectedBtn = document.querySelector('#modal-options-container .option-btn.selected');
                if (selectedBtn) {
                    selections['group0'] = parseInt(selectedBtn.dataset.optionIndex, 10) || 0;
                }
            }
            return selections;
        };

        // Compute legacy selectedOptionIndex from a selections object for backward compatibility.
        const legacyIndexFromSelections = (selections) => {
            if (!selections || Object.keys(selections).length === 0) {
                return itemState.selectedOptionIndex || 0;
            }
            const group0Selection = selections['group0'];
            return Array.isArray(group0Selection)
                ? (group0Selection[0] || 0)
                : (group0Selection || 0);
        };

        // Calculate initial amount for rapid pay
        const initialPrice = getRecordPrice(record, itemState.selectedOptionIndex);
        const initialQuantity = itemState.quantity || 1;
        const initialAmount = initialPrice * initialQuantity;

        // Update Rapid Pay button label dynamically
        const updateRapidPayLabel = () => {
            if (!rapidPayBtn) return;
            const quantityInput = document.querySelector('#modal-quantity-selector .quantity-input');
            const currentQuantity = quantityInput ? parseFloat(quantityInput.value) || 1 : 1;
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

        // Rapid Pay click - opens unified checkout modal scoped to this item
        if (rapidPayBtn) {
            // Remove old listeners by cloning
            const newRapidPayBtn = rapidPayBtn.cloneNode(true);
            rapidPayBtn.parentNode.replaceChild(newRapidPayBtn, rapidPayBtn);
            newRapidPayBtn._updateText = updateRapidPayLabel;

            // Preload Stripe.js on hover so it's ready when checkout opens
            newRapidPayBtn.addEventListener('mouseenter', preloadStripe, { once: true });
            newRapidPayBtn.addEventListener('touchstart', preloadStripe, { once: true });

            newRapidPayBtn.addEventListener('click', () => {
                const quantityInput = document.querySelector('#modal-quantity-selector .quantity-input');
                const quantity = quantityInput ? parseFloat(quantityInput.value) || 1 : 1;
                const selections = readLiveSelections();
                const priceParam = Object.keys(selections).length > 0
                    ? selections
                    : (itemState.selectedOptionIndex || 0);
                const selectedOptionIndex = legacyIndexFromSelections(selections);
                const price = getRecordPrice(record, priceParam);
                const amount = price * quantity;
                const itemName = record.fields.Name || 'Item';
                const shopSettings = getShopSettings();
                showCheckoutModal(shopSettings, {
                    mode: 'item',
                    itemId: record.id,
                    itemName: itemName,
                    quantity: quantity,
                    price: price,
                    record: record,
                    selectedOptionIndex: selectedOptionIndex,
                    selections: selections,
                    highlightChipIn: false,
                    ...captureModalNoteAndSchedule()
                });
            });
        }

        // Chip In click - opens unified checkout modal scoped to this item with chip-in highlighted
        if (chipInBtn) {
            const newChipInBtn = chipInBtn.cloneNode(true);
            chipInBtn.parentNode.replaceChild(newChipInBtn, chipInBtn);

            // Preload Stripe.js on hover so it's ready when checkout opens
            newChipInBtn.addEventListener('mouseenter', preloadStripe, { once: true });
            newChipInBtn.addEventListener('touchstart', preloadStripe, { once: true });

            newChipInBtn.addEventListener('click', () => {
                const quantityInput = document.querySelector('#modal-quantity-selector .quantity-input');
                const quantity = quantityInput ? parseFloat(quantityInput.value) || 1 : 1;
                const selections = readLiveSelections();
                const priceParam = Object.keys(selections).length > 0
                    ? selections
                    : (itemState.selectedOptionIndex || 0);
                const selectedOptionIndex = legacyIndexFromSelections(selections);
                const price = getRecordPrice(record, priceParam);
                const itemName = record.fields.Name || 'Item';
                const shopSettings = getShopSettings();
                showCheckoutModal(shopSettings, {
                    mode: 'item',
                    itemId: record.id,
                    itemName: itemName,
                    quantity: 0,
                    maxQuantity: quantity,
                    price: price,
                    record: record,
                    selectedOptionIndex: selectedOptionIndex,
                    selections: selections,
                    highlightChipIn: true,
                    ...captureModalNoteAndSchedule()
                });
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

        // Fire AI image generation in the background — don't block modal rendering.
        // A loading indicator is shown on the image area; when the AI image arrives,
        // the modal's main image, thumbnails, cache, and indicators are updated live.
        const aiGenRecordId = record.id;
        const aiGenRequestPayload = {
            name: record.fields?.Name || 'Unnamed Item',
            description: record.fields?.Description || '',
            category: record.fields?.Category || '',
            serviceType: record.fields?.ServiceType || record.fields?.['Service Type'] || '',
            tags: record.fields?.['Media Tags'] || '',
            itemId: record.id,
            sessionId: state.session?.id || 'unsaved'
        };

        console.log('[AI IMAGE AUTO-GEN] Request payload:', JSON.stringify(aiGenRequestPayload));

        // Show loading indicator on the image area
        const aiImageLoadingIndicator = document.createElement('div');
        aiImageLoadingIndicator.className = 'modal-ai-image-loading';
        aiImageLoadingIndicator.innerHTML = `
            <div class="modal-ai-image-spinner"></div>
            <span class="modal-ai-image-loading-text">Generating AI image...</span>
        `;
        // Append to modalMainImage (will overlay on top of placeholder)
        modalMainImage.appendChild(aiImageLoadingIndicator);

        fetch('/.netlify/functions/generate-ai-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(aiGenRequestPayload)
        }).then(async (aiImageResponse) => {
            console.log('[AI IMAGE AUTO-GEN] Response status:', aiImageResponse.status);

            if (aiImageResponse.ok) {
                const aiImageResult = await aiImageResponse.json();
                console.log('[AI IMAGE AUTO-GEN] Response JSON:', JSON.stringify(aiImageResult));

                if (aiImageResult.success && aiImageResult.imageUrl) {
                    // Store the AI image in the record so it persists
                    const aiGeneratedImage = {
                        url: aiImageResult.imageUrl,
                        isAIGenerated: true,
                        prompt: aiImageResult.prompt
                    };

                    // Update record in state
                    const recordIndex = state.records.all.findIndex(r => r.id === aiGenRecordId);
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

                    // Update the modal live if it's still showing this record
                    const currentModalOverlay = document.getElementById('detail-modal-overlay');
                    if (currentModalOverlay && currentModalOverlay.dataset.recordId === aiGenRecordId && currentModalOverlay.classList.contains('active')) {
                        const liveMainImage = document.getElementById('modal-main-image');
                        if (liveMainImage) {
                            // Remove loading indicator
                            const loadingEl = liveMainImage.querySelector('.modal-ai-image-loading');
                            if (loadingEl) loadingEl.remove();

                            // Update main image
                            const optimizedUrl = aiImageResult.imageUrl.includes('cloudinary')
                                ? applyCloudinaryTransform(aiImageResult.imageUrl, 'w_1200,h_1000,c_fill,f_auto,q_auto,fl_progressive')
                                : aiImageResult.imageUrl;
                            liveMainImage.style.backgroundImage = `url('${optimizedUrl}')`;

                            // Update AI indicator
                            const existingIndicator = liveMainImage.querySelector('.ai-image-source-modal');
                            if (existingIndicator) {
                                existingIndicator.textContent = 'AI Generated';
                                existingIndicator.className = 'ai-image-source-modal approximation';
                                existingIndicator.title = 'This image was AI-generated based on item details. Upload your own photos to replace it.';
                            }

                            // Update first thumbnail if it exists
                            const liveThumbnailStrip = document.getElementById('modal-thumbnail-strip');
                            if (liveThumbnailStrip) {
                                const firstThumb = liveThumbnailStrip.querySelector('.thumbnail-img');
                                if (firstThumb) {
                                    const optimizedThumb = aiImageResult.imageUrl.includes('cloudinary')
                                        ? applyCloudinaryTransform(aiImageResult.imageUrl, 'w_150,h_150,c_fill,f_auto,q_auto')
                                        : aiImageResult.imageUrl;
                                    firstThumb.style.backgroundImage = `url('${optimizedThumb}')`;
                                }
                            }
                        }

                        // Update image cache
                        if (typeof window.itemImagesCache !== 'undefined') {
                            window.itemImagesCache.set(aiGenRecordId, { images: [aiImageResult.imageUrl], currentIndex: 0 });
                        }
                    } else {
                        // Modal closed or showing different record — remove loading indicator if still in DOM
                        const staleLoading = document.querySelector('.modal-ai-image-loading');
                        if (staleLoading) staleLoading.remove();
                    }
                } else {
                    console.log('[AI IMAGE AUTO-GEN] Response OK but missing success or imageUrl:', aiImageResult);
                    window._aiImageGenerationAttempted.add(aiGenRecordId);
                    // Remove loading indicator
                    const loadingEl = document.querySelector('.modal-ai-image-loading');
                    if (loadingEl) loadingEl.remove();
                }
            } else {
                const errorText = await aiImageResponse.text();
                console.warn('[AI IMAGE AUTO-GEN] FAILED:', errorText);
                window._aiImageGenerationAttempted.add(aiGenRecordId);
                const loadingEl = document.querySelector('.modal-ai-image-loading');
                if (loadingEl) loadingEl.remove();
            }
        }).catch((aiError) => {
            console.warn('[AI IMAGE AUTO-GEN] EXCEPTION:', aiError.message);
            window._aiImageGenerationAttempted.add(aiGenRecordId);
            const loadingEl = document.querySelector('.modal-ai-image-loading');
            if (loadingEl) loadingEl.remove();
        }).finally(() => {
            window._aiImageGenerationInProgress.delete(aiGenRecordId);
        });
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

    // Display confidence styling for AI-parsed items, AI solutions, and manually added items
    const isAIRecord = record?.id?.startsWith('ai-child-') || record?.id?.startsWith('ai-search-') || record?.id?.startsWith('ai-presentation-') || record?.isAI === true;
    const isSolutionRecord = record?.isSolution === true || record?.id?.startsWith('solution-');
    const isManualRecord = record?.isManual === true ||
                           record?.id?.startsWith('manual-add-') ||
                           record?.id?.startsWith('manual-presentation-');
    const needsConfidenceStyling = isAIRecord || isSolutionRecord || isManualRecord;

    console.log('[DEBUG Modal] showDetailModal called:', {
        recordId: record?.id,
        isAIRecord,
        isSolutionRecord,
        isManualRecord,
        needsConfidenceStyling,
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

    if (needsConfidenceStyling) {
        // Resolve numeric confidence from multiple sources:
        // 1. Research data (post-dig) takes priority
        // 2. AI confidence fields for AI items
        // 3. Solution string confidence mapped to numeric for solutions
        // 4. Default 0.5 for manually added items (pen/approximated tier)
        let confidence;
        if (record._researchData?.confidence != null) {
            confidence = record._researchData.confidence;
        } else if (isAIRecord) {
            confidence = record.fields?.['_aiConfidence'] ?? record._aiConfidence ?? null;
        } else if (isSolutionRecord && record.solutionData?.confidence) {
            // Map solution string confidence to numeric value
            const solutionConfidenceMap = { high: 0.85, medium: 0.6, low: 0.35 };
            confidence = solutionConfidenceMap[record.solutionData.confidence] ?? 0.6;
        } else if (isManualRecord) {
            confidence = 0.5; // Manual items default to 50% (pen/approximated)
        } else {
            confidence = null;
        }
        console.log('[DEBUG Modal] Record confidence:', { confidence, type: typeof confidence, isAIRecord, isSolutionRecord, isManualRecord });

        // Determine confidence style tier
        let confidenceStyle, confidenceTooltip;

        if (confidence === null || confidence === undefined) {
            confidenceStyle = 'pencil';
            confidenceTooltip = 'Draft information - please verify all details';
        } else if (confidence < 0.5) {
            confidenceStyle = 'pencil';
            confidenceTooltip = `~${Math.round(confidence * 100)}% confident - Sketchy draft, please verify details`;
        } else if (confidence < 0.75) {
            confidenceStyle = 'pen';
            confidenceTooltip = isManualRecord
                ? `~${Math.round(confidence * 100)}% - Manually added, approximated details`
                : `~${Math.round(confidence * 100)}% confident - Handwritten quality, some details may need verification`;
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
        // Show the published plan's start/end time (the same Start_time/End_time
        // the "Add to Calendar" buttons use), falling back to the legacy Time range.
        let eventTime = formatEventTimeRange(record.fields.Start_time, record.fields.End_time)
            || record.fields.Time || '';
        // If the record carries no synced time (it predates schedule syncing, or the
        // cached copy is stale) but this event belongs to the plan currently loaded,
        // fall back to the live plan times — the same source the presentation/plan
        // view reads — so the detail modal matches what's shown there.
        if (!eventTime && state.session.id
            && Array.isArray(record.fields.LinkedSession)
            && record.fields.LinkedSession.includes(state.session.id)) {
            eventTime = formatEventTimeRange(
                state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.START_TIME),
                state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.END_TIME)
            );
        }
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

        // Calendar export buttons - available for ALL users (no auth required)
        if (record.fields.Date) {
            const existingCalendarExport = document.querySelector('.modal-calendar-export');
            if (existingCalendarExport) existingCalendarExport.remove();

            // When this event belongs to the plan currently loaded and carries no
            // synced location, backfill the venue address from live plan state so
            // the calendar export includes the address (matches the plan view).
            if (!record.fields['Location Details'] && state.session.id
                && Array.isArray(record.fields.LinkedSession)
                && record.fields.LinkedSession.includes(state.session.id)) {
                const venueAddress = resolvePlanVenueAddress(state.records?.all, state.cart?.lockedItems);
                if (venueAddress) {
                    record.fields['Location Details'] = venueAddress;
                }
            }

            const calendarContainer = document.createElement('div');
            calendarContainer.className = 'modal-calendar-export calendar-export-compact';
            // Attach the plan's component names so the calendar entry's notes can
            // list "What's Included" alongside the description and "Good to Know"
            // details. Resolved here where live plan state is available; the
            // calendar utility reads it off the record at export time.
            const planComponentNames = resolvePlanComponentNames(linkedSession);
            record.fields._calendarComponents = planComponentNames;
            calendarContainer.innerHTML = createCalendarExportButtons(record);
            modalItemDescription.parentElement.insertBefore(calendarContainer, modalItemDescription);
            initializeCalendarExportListeners(record, calendarContainer);
        }
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
                    <div class="rsvp-list-label" data-rsvp-type="yes">Going (${rsvpYes.length})</div>
                    <div class="rsvp-list-items" data-rsvp-type="yes">Loading...</div>
                </div>`;
            }

            if (rsvpMaybe.length > 0) {
                rsvpHTML += `<div class="rsvp-list-group">
                    <div class="rsvp-list-label" data-rsvp-type="maybe">Maybe (${rsvpMaybe.length})</div>
                    <div class="rsvp-list-items" data-rsvp-type="maybe">Loading...</div>
                </div>`;
            }

            if (rsvpNo.length > 0) {
                rsvpHTML += `<div class="rsvp-list-group">
                    <div class="rsvp-list-label" data-rsvp-type="no">Can't Go (${rsvpNo.length})</div>
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
        // Custom items (ai-*, manual-*, solution-*) live only inside the session's
        // saved data, not in Airtable. Capture them here so the components carousel
        // can render them even if they haven't been restored into state.records.all
        // yet (avoids a race where custom items appear only on some page loads).
        let sessionCustomRecords = {};
        if (linkedSession.fields['Items with Variations']) {
            try {
                const sessionData = JSON.parse(linkedSession.fields['Items with Variations']);

                const lockedInItems = sessionData.lockedInItems || {};
                const ideasItems = sessionData.ideasItems || {};
                sessionCustomRecords = sessionData.aiRecords || {};

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

            // Resolve a component id to a record. Real Airtable items come from
            // state (live or archived); custom items (ai-*, manual-*, solution-*)
            // fall back to the records saved inside the session's own data so they
            // render consistently regardless of session-restore timing.
            const resolveComponentRecord = (componentId) => {
                let resolved = recordMap.get(componentId) || (archiveMap && archiveMap.get(componentId));
                if (!resolved) {
                    const saved = sessionCustomRecords[componentId];
                    if (saved && saved.fields) {
                        resolved = { id: saved.id || componentId, fields: saved.fields };
                        if (saved.isManual) resolved.isManual = true;
                        if (saved.isSolution) resolved.isSolution = true;
                    }
                }
                return resolved;
            };

            // Process locked items
            for (const componentId of lockedComponentIds) {
                const componentRecord = resolveComponentRecord(componentId);
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
                const ideaRecord = resolveComponentRecord(ideaId);
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
                    window.location.href = `${window.location.pathname}?session=${linkedSessionId}&${getShopUrlParam(state.ui.activeShopId, state.stores.all)}`;
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
                        window.location.href = `${window.location.pathname}?session=${linkedSessionId}&${getShopUrlParam(state.ui.activeShopId, state.stores.all)}`;
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
        if (typeof price === 'number' && price > 0) {
            decorateModalPriceWithPromo(record, Math.round(price * 100));
        }
    }

    // Inject vitality/goodness badge next to the price (skip when vitality UI is dormant)
    if (modalItemPrice && !isVitalityUIDormant()) {
        // Remove any previous badge
        const existingBadge = document.getElementById('modal-vitality-badge');
        if (existingBadge) existingBadge.remove();

        const vitalityScores = state.vitality?.itemScores?.get(record.id);
        const goodnessEmoji = vitalityScores?.goodnessEmoji || vitalityScores?.netEmoji || '';
        const goodnessLabel = vitalityScores?.goodnessLabel || vitalityScores?.netLabel || 'Neutral';
        if (goodnessEmoji) {
            const badge = document.createElement('span');
            badge.id = 'modal-vitality-badge';
            badge.className = 'modal-vitality-badge';
            badge.textContent = goodnessEmoji;
            badge.title = `Goodness: ${goodnessLabel} (click for actions)`;
            badge.addEventListener('click', (e) => {
                console.log('[Modal DEBUG] modal-vitality-badge CLICKED for record:', record.id);
                const rect = badge.getBoundingClientRect();
                console.log('[Modal DEBUG]   badge rect:', JSON.stringify({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }));
                console.log('[Modal DEBUG]   → calling openActionMenu');
                openActionMenu(record.id, {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                });
            });
            // Insert badge right after the price element
            modalItemPrice.parentNode.insertBefore(badge, modalItemPrice.nextSibling);
        }
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

        // Build share URL with shop slug but WITHOUT session
        const shareUrl = new URL(`${window.location.origin}/item/${slug}`);

        // Include shop slug if available (from current state or URL)
        const currentShopId = state.activeShop?.id || state.ui?.activeShopId || new URLSearchParams(window.location.search).get('shopId');
        if (currentShopId) {
            const shop = state.stores?.all?.find(s => s.id === currentShopId);
            if (shop?.fields?.Name) {
                shareUrl.searchParams.set('shop', storeSlug(shop.fields.Name));
            } else {
                shareUrl.searchParams.set('shopId', currentShopId);
            }
        } else {
            const shopSlugParam = new URLSearchParams(window.location.search).get('shop');
            if (shopSlugParam) {
                shareUrl.searchParams.set('shop', shopSlugParam);
            }
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

    // Add "Dig Info" button for AI-generated solution items, AI items, and manually added items
    // This allows users to research the item and get detailed information with accuracy scores
    const isSolutionItem = record.isSolution === true || record.id?.startsWith('solution-');
    const isAIItem = record.id?.startsWith('ai-child-') ||
                     record.id?.startsWith('ai-presentation-') ||
                     record.id?.startsWith('ai-search-');
    const isManualItem = record.isManual === true ||
                         record.id?.startsWith('manual-add-') ||
                         record.id?.startsWith('manual-presentation-');
    const isResearchableItem = isSolutionItem || isAIItem || isManualItem;
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

    // Categorization UI (Categories & Tags) is now only accessible from Edit Mode
    // See the Categories & Tags section in enableItemEditMode()

    // Add Edit Item button for manual/custom items, AI discovery items, and AI-generated solutions
    const isManuallyEditableItem = record.isManual === true ||
                         record.id?.startsWith('manual-add-') ||
                         record.id?.startsWith('manual-presentation-') ||
                         record.id?.startsWith('ai-search-') ||
                         record.id?.startsWith('ai-child-') ||
                         record.id?.startsWith('ai-presentation-') ||
                         record.isSolution === true ||
                         record.id?.startsWith('solution-');

    // Publish-access users can edit (and, via the in-edit Delete button, remove) ANY
    // non-event item — including curated catalog items and community "Public Idea"
    // records. Events keep their dedicated Edit Event / Open to Edit flow below, so
    // they are excluded here to avoid two competing edit controls.
    const isEventItemForEdit = record.fields?.['Item Type'] === 'Event';
    const userCanPublishForEdit = api.userHasPublishPermission();
    const isEditableItem = isManuallyEditableItem || (userCanPublishForEdit && !isEventItemForEdit);

    if (isEditableItem) {
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

        // Add Present button for events with a linked plan. Presentation mode is a
        // host/collaborator tool, so it is shown only to the plan's collaborators,
        // the owner of the plan's store, and users with publish access — not to
        // every guest.
        if (hasLinkedSession) {
            const gateCollaborator = linkedSession?.fields?.Collaborators &&
                linkedSession.fields.Collaborators.includes(state.session.user.id);
            const gateSessionStoreId = linkedSession?.fields?.Stores && linkedSession.fields.Stores.length > 0
                ? linkedSession.fields.Stores[0]
                : null;
            const gateIsOwner = state.session.user.isOwner &&
                state.session.user.ownedStoreId &&
                gateSessionStoreId === state.session.user.ownedStoreId;
            const canPresent = gateCollaborator || gateIsOwner || userHasPublishAccess;

            if (canPresent) {
                const presentBtn = document.createElement('button');
                presentBtn.className = 'card-action-btn present-event-btn';
                presentBtn.dataset.eventId = record.id;
                presentBtn.dataset.sessionId = record.fields.LinkedSession[0];
                presentBtn.innerHTML = '▶️ Present';
                presentBtn.title = 'View in presentation mode';
                presentBtn.style.marginRight = '10px';
                modalHeaderActions.appendChild(presentBtn);
            }
        }

        // NOTE: the Yes / Maybe / No RSVP buttons used to live here in the header
        // strip. They now render as the modal's PRIMARY action — together with a
        // party-size ("number of RSVPs") stepper — down in the action zone. See
        // setupEventRsvpActionZone(), called once the action zone is built.
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
                } else if (opt.pricePercent !== null && opt.pricePercent !== undefined) {
                    priceModText = `${opt.pricePercent >= 0 ? '+' : ''}${opt.pricePercent}%`;
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
                        // Refresh the quantity total since the selected option may change price
                        if (modalQuantitySelector && modalQuantitySelector._updateTotal) {
                            modalQuantitySelector._updateTotal();
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

    // Add AI Top Options / edit button (sparkles button)
    // Availability rules:
    //   - Users with publish access for the active store see it on ALL items.
    //   - All users see it on AI discoveries, custom items, and items they manually created.
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

    // Decide whether to show the edit/AI options button.
    // Publish-access users get it on every item; everyone else sees it on
    // AI discoveries, custom items, and items they manually created.
    const isManuallyCreatedItem = record.isManual === true ||
                                  record.id?.startsWith('manual-add-') ||
                                  record.id?.startsWith('manual-presentation-');
    const isAiDiscoveryItem = record.id?.startsWith('ai-search-') ||
                              record.id?.startsWith('ai-child-') ||
                              record.id?.startsWith('ai-presentation-');
    const isCustomItem = record.id?.startsWith('custom-');
    // Solution items are drilled-down results of a concept's "Find Solutions" flow.
    // They are still custom/AI items, so all users should be able to estimate options on them.
    // (isSolutionItem is already computed earlier in this function for the "Dig Info" button.)
    const showAiOptionsButton = userHasPublishPermissionForOptions || isManuallyCreatedItem || isAiDiscoveryItem || isCustomItem || isSolutionItem;

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
                    parentConceptId: record.id, // Store ID for serialization
                    parentConceptRecord: record, // Store reference to parent concept (in-memory only)
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

    // For concept items, the button above is "Find Solutions". Concept items are still
    // custom/AI items, so users should also be able to estimate options directly on them.
    // Build a separate, self-contained "Estimate Options" block (kept independent of the
    // solutions flow above so neither affects the other) and append it alongside.
    const buildConceptOptionsBlock = () => {
        const container = document.createElement('div');
        container.className = 'ai-top-options-container ai-estimate-options-container';
        container.style.marginTop = '10px';

        const estimateBtnText = hasExistingOptions ? '✨ Re-Estimate Options' : '✨ Estimate Options';
        container.innerHTML = `
            <button class="ai-top-options-btn" title="Use AI to estimate recommended options/variations">
                ${estimateBtnText}
            </button>
            <div class="ai-options-result" style="display: none;">
                <div class="ai-options-preview-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <span style="font-weight: 600; color: #333;">AI Generated Options</span>
                    <button class="ai-options-close-btn" style="background: none; border: none; cursor: pointer; font-size: 1.2em; color: #666;">×</button>
                </div>
                <textarea class="ai-options-editor" placeholder="Loading..." style="width: 100%; min-height: 120px; font-family: monospace; font-size: 0.9em; padding: 10px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;"></textarea>
                <div class="ai-options-actions" style="margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap;">
                    <button class="ai-options-apply-btn" style="padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">Apply to Item</button>
                    ${userIsAuthenticated && (isRealRecord && userHasPublishPermissionForOptions) ? '<button class="ai-options-save-catalog-btn" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Save to Catalog</button>' : ''}
                    <span class="ai-options-status" style="align-self: center; font-size: 0.85em; color: #666;"></span>
                </div>
            </div>
        `;

        const estBtn = container.querySelector('.ai-top-options-btn');
        const estResult = container.querySelector('.ai-options-result');
        const estEditor = container.querySelector('.ai-options-editor');
        const estCloseBtn = container.querySelector('.ai-options-close-btn');
        const estApplyBtn = container.querySelector('.ai-options-apply-btn');
        const estSaveCatalogBtn = container.querySelector('.ai-options-save-catalog-btn');
        const estStatus = container.querySelector('.ai-options-status');

        // Generate options on click
        estBtn.addEventListener('click', async () => {
            estBtn.disabled = true;
            estResult.style.display = 'block';
            estStatus.textContent = '';
            estBtn.textContent = '✨ Estimating...';
            estEditor.value = 'Estimating AI recommendations...';

            try {
                const result = await api.generateTopOptions(record);
                if (result.success && result.options) {
                    estEditor.value = result.options;
                    estStatus.textContent = 'Options estimated!';
                    estStatus.style.color = '#28a745';
                } else {
                    throw new Error(result.error || 'Failed to estimate options');
                }
            } catch (error) {
                estEditor.value = '';
                estStatus.textContent = `Error: ${error.message}`;
                estStatus.style.color = '#dc3545';
                console.error('AI options generation failed:', error);
            } finally {
                estBtn.disabled = false;
                estBtn.textContent = hasExistingOptions ? '✨ Re-Estimate Options' : '✨ Estimate Options';
            }
        });

        // Close button
        estCloseBtn.addEventListener('click', () => {
            estResult.style.display = 'none';
        });

        // Apply to item (works for all users - updates locally for this session)
        estApplyBtn.addEventListener('click', () => {
            const optionsText = estEditor?.value;
            if (!optionsText?.trim()) {
                estStatus.textContent = 'No options to apply';
                estStatus.style.color = '#dc3545';
                return;
            }

            record.fields[CONSTANTS.FIELD_NAMES.OPTIONS] = optionsText;
            record._locallyGeneratedOptions = optionsText;

            const isLocked = state.cart.lockedItems.has(record.id);
            const isIdea = state.cart.items.has(record.id);

            if (isLocked) {
                const itemInfo = state.cart.lockedItems.get(record.id);
                itemInfo.generatedOptions = optionsText;
                state.cart.lockedItems.set(record.id, itemInfo);
                triggerSave();
                log('Modal', `Saved generated options for locked item ${record.id}`);
            } else if (isIdea) {
                const itemInfo = state.cart.items.get(record.id);
                itemInfo.generatedOptions = optionsText;
                state.cart.items.set(record.id, itemInfo);
                triggerSave();
                log('Modal', `Saved generated options for idea item ${record.id}`);
            }

            estStatus.textContent = 'Applied! Refreshing...';
            estStatus.style.color = '#28a745';
            setTimeout(() => {
                showDetailModal(record);
            }, 500);
        });

        // Save to Catalog (only present for publish users on real records)
        if (estSaveCatalogBtn) {
            estSaveCatalogBtn.addEventListener('click', async () => {
                const optionsText = estEditor?.value;
                if (!optionsText?.trim()) {
                    estStatus.textContent = 'No options to save';
                    estStatus.style.color = '#dc3545';
                    return;
                }

                estSaveCatalogBtn.disabled = true;
                estStatus.textContent = 'Saving to catalog...';
                estStatus.style.color = '#666';

                try {
                    const result = await api.updateItemOptions(record.id, optionsText);
                    if (result) {
                        record.fields[CONSTANTS.FIELD_NAMES.OPTIONS] = optionsText;
                        estStatus.textContent = 'Saved to catalog!';
                        estStatus.style.color = '#28a745';
                        setTimeout(() => {
                            showDetailModal(record);
                        }, 1000);
                    } else {
                        throw new Error('Failed to save');
                    }
                } catch (error) {
                    estStatus.textContent = 'Error saving. Try again.';
                    estStatus.style.color = '#dc3545';
                    console.error('Error saving options to catalog:', error);
                } finally {
                    estSaveCatalogBtn.disabled = false;
                }
            });
        }

        return container;
    };

    // Only surface the edit/AI options button when the current user is allowed to use it
    // (publish access on any item, or an AI discovery / custom / solution / manually-created item for everyone else).
    if (showAiOptionsButton) {
        modalOptionsContainer.appendChild(aiOptionsContainer);
        // Concept items get both "Find Solutions" (above) and a separate "Estimate Options" block.
        if (isConceptItem) {
            modalOptionsContainer.appendChild(buildConceptOptionsBlock());
        }
    }

    // --- THIS IS THE FIX ---\
    // The listeners are now MOVED INSIDE this `if` block
    // Also hide notes for published events - they use the description field for goals/notes instead
    const isEvent = record.fields['Item Type'] === 'Event';
    if (!isGrouping && !isPackage) {
        modalActionsContainer.style.display = 'block';
        // Hide notes container for events - not needed for published event viewing
        modalNotesContainer.style.display = isEvent ? 'none' : 'block';
        modalItemNote.value = itemState.note;
        // Add Notes is a collapsible accordion, collapsed by default each open.
        setupModalAccordion('modal-notes-container', 'modal-notes-toggle');

        // Calculate effective minimum and Airtable minimum
        const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        const effectiveMin = getEffectiveMinQuantity(record);

        modalQuantitySelector.innerHTML = `<div class="quantity-total-row"><div class="quantity-selector" data-record-id="${record.id}"><button type="button" class="quantity-btn minus" aria-label="Decrease quantity">-</button><input type="number" class="quantity-input" value="${itemState.quantity}" min="${effectiveMin}" step="0.1"><button type="button" class="quantity-btn plus" aria-label="Increase quantity">+</button></div><span class="quantity-total-display" aria-live="polite"></span></div>`;

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
        const totalDisplay = modalQuantitySelector.querySelector('.quantity-total-display');

        // Keep a running total (unit price × quantity) shown beside the quantity selector
        // so the user always sees the current cost with quantity and options accounted for.
        const updateQuantityTotal = () => {
            if (!totalDisplay) return;
            const qty = input ? (parseFloat(input.value) || 1) : (itemState.quantity || 1);
            // Read the current option selections straight from the DOM so this stays
            // self-contained (the earlier readLiveSelections helper is in a nested scope).
            const selections = {};
            const optionGroupEls = document.querySelectorAll('#modal-options-container .option-group');
            if (optionGroupEls.length > 0) {
                optionGroupEls.forEach((group) => {
                    const groupIndex = group.dataset.groupIndex;
                    const selectedBtns = group.querySelectorAll('.option-btn.selected');
                    if (selectedBtns.length > 0 && groupIndex !== undefined) {
                        if (selectedBtns.length === 1) {
                            selections[`group${groupIndex}`] = parseInt(selectedBtns[0].dataset.optionIndex, 10) || 0;
                        } else {
                            selections[`group${groupIndex}`] = Array.from(selectedBtns)
                                .map(btn => parseInt(btn.dataset.optionIndex, 10) || 0)
                                .sort((a, b) => a - b);
                        }
                    }
                });
            } else {
                const selectedBtn = document.querySelector('#modal-options-container .option-btn.selected');
                if (selectedBtn) {
                    selections['group0'] = parseInt(selectedBtn.dataset.optionIndex, 10) || 0;
                }
            }
            const priceParam = Object.keys(selections).length > 0
                ? selections
                : (itemState.selectedOptionIndex || 0);
            const unitPrice = getRecordPrice(record, priceParam);
            if (typeof unitPrice !== 'number') {
                totalDisplay.textContent = '';
                return;
            }
            const total = unitPrice * qty;
            totalDisplay.textContent = total > 0 ? `Total: $${total.toFixed(2)}` : 'Total: Free';
        };
        // Expose so option-change handlers can refresh the total.
        modalQuantitySelector._updateTotal = updateQuantityTotal;
        updateQuantityTotal();

        if (plusBtn && minusBtn && input) {
            input.addEventListener('change', updateQuantityTotal);
            input.addEventListener('input', updateQuantityTotal);
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
                updateQuantityTotal();
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
                    updateQuantityTotal();
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

        // --- Item-level time scheduling (shown for locked items or when adding to plan) ---
        const modalTimeContainer = document.getElementById('modal-item-time-container');
        if (modalTimeContainer) {
            const isItemLocked = state.cart.lockedItems.has(record.id);
            const lockedInfo = isItemLocked ? state.cart.lockedItems.get(record.id) : null;

            // Show time section
            modalTimeContainer.style.display = 'block';
            // Item Scheduling is a collapsible accordion, collapsed by default each open.
            setupModalAccordion('modal-item-time-container', 'modal-time-toggle');

            // Populate from saved item info
            const modalItemStartTimeInput = document.getElementById('modal-item-start-time');
            const modalItemDurationInput = document.getElementById('modal-item-duration');
            const modalItemDateInput = document.getElementById('modal-item-date');
            const modalItemDurationSource = document.getElementById('modal-item-duration-source');

            if (modalItemStartTimeInput) modalItemStartTimeInput.value = lockedInfo?.itemStartTime || '';

            // Duration: show catalog default vs override (now using dropdown)
            const catalogDurationHours = parseFloat(record.fields?.['Duration (hours)'] || 0);
            const catalogDurationMin = Math.round(catalogDurationHours * 60);

            /** Format minutes to readable duration string */
            const fmtDur = (min) => {
                if (!min || min <= 0) return '';
                const h = Math.floor(min / 60);
                const m = min % 60;
                if (h > 0 && m > 0) return `${h}h ${m}m`;
                if (h > 0) return `${h}h`;
                return `${m}m`;
            };

            /** Parse time string like "7:00 PM" or "14:30" */
            const parseTime = (timeStr) => {
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
            };

            /** Format minutes to a 12-hour time string */
            const fmtTime = (totalMin) => {
                totalMin = totalMin % (24 * 60);
                const h = Math.floor(totalMin / 60);
                const m = totalMin % 60;
                if (h === 0) return `12:${String(m).padStart(2, '0')} AM`;
                if (h < 12) return `${h}:${String(m).padStart(2, '0')} AM`;
                if (h === 12) return `12:${String(m).padStart(2, '0')} PM`;
                return `${h - 12}:${String(m).padStart(2, '0')} PM`;
            };

            /** Populate a <select> with time options in 15-min increments */
            const populateModalTimeDropdown = (selectEl) => {
                if (!selectEl) return;
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
            };

            /** Populate a <select> with duration options */
            const populateModalDurationDropdown = (selectEl) => {
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
            };

            // Populate dropdowns
            populateModalTimeDropdown(modalItemStartTimeInput);
            populateModalDurationDropdown(modalItemDurationInput);

            // Restore saved values
            if (modalItemStartTimeInput && lockedInfo?.itemStartTime) {
                modalItemStartTimeInput.value = lockedInfo.itemStartTime;
            }

            if (modalItemDurationInput) {
                if (lockedInfo?.itemDuration) {
                    modalItemDurationInput.value = String(lockedInfo.itemDuration);
                } else {
                    modalItemDurationInput.value = '';
                }
            }
            if (modalItemDurationSource) {
                if (lockedInfo?.itemDuration) {
                    modalItemDurationSource.textContent = 'custom override';
                } else if (catalogDurationMin > 0) {
                    modalItemDurationSource.textContent = `catalog: ${fmtDur(catalogDurationMin)}`;
                } else {
                    modalItemDurationSource.textContent = '';
                }
            }

            // Live-update lockedItems on change (for items already in plan)
            const saveTimeField = (field, value) => {
                if (!isItemLocked) return; // Will be captured during "Add to Plan"
                const info = state.cart.lockedItems.get(record.id);
                if (!info) return;
                if (value) {
                    info[field] = value;
                } else {
                    delete info[field];
                }
                state.cart.lockedItems.set(record.id, info);
                if (typeof triggerSave === 'function') triggerSave();
            };

            /** Compute and store end time from start time + duration */
            const computeItemEndTime = () => {
                const startVal = modalItemStartTimeInput?.value;
                const startParsed = parseTime(startVal);
                const durVal = modalItemDurationInput?.value;
                const durMin = (durVal ? parseInt(durVal, 10) : null) || (lockedInfo?.itemDuration) || catalogDurationMin;

                if (startParsed && durMin && durMin > 0) {
                    const endTotalMin = (startParsed.hours * 60 + startParsed.minutes) + durMin;
                    const endTimeStr = fmtTime(endTotalMin);
                    saveTimeField('itemEndTime', endTimeStr);
                    if (modalItemDurationSource) {
                        const durLabel = durVal ? 'custom override' : (catalogDurationMin > 0 ? `catalog: ${fmtDur(catalogDurationMin)}` : '');
                        modalItemDurationSource.textContent = durLabel ? `${durLabel} \u2022 ends ${endTimeStr}` : `ends ${endTimeStr}`;
                    }
                } else {
                    saveTimeField('itemEndTime', null);
                }
            };

            // --- Persistent availability display for the selected date/time ---
            const modalItemAvailabilityEl = document.getElementById('modal-item-availability');

            /** Resolve the date currently selected in the modal, if any. */
            const getSelectedModalDate = () => {
                if (modalItemDatePicker?.selectedDates?.length >= 1) {
                    return modalItemDatePicker.selectedDates[0];
                }
                if (lockedInfo?.itemDate) {
                    const d = new Date(lockedInfo.itemDate);
                    if (!isNaN(d.getTime())) return d;
                }
                return null;
            };

            /** Compute the current end-time string from start time + duration. */
            const getCurrentEndTime = () => {
                const startParsed = parseTime(modalItemStartTimeInput?.value);
                const durVal = modalItemDurationInput?.value;
                const durMin = (durVal ? parseInt(durVal, 10) : null) || (lockedInfo?.itemDuration) || catalogDurationMin;
                if (startParsed && durMin && durMin > 0) {
                    return fmtTime(startParsed.hours * 60 + startParsed.minutes + durMin);
                }
                return '';
            };

            /** Paint an availability descriptor into the modal line. */
            const renderModalAvailability = (info) => {
                if (!modalItemAvailabilityEl) return;
                modalItemAvailabilityEl.className = 'modal-item-availability';
                if (!info) {
                    modalItemAvailabilityEl.style.display = 'none';
                    return;
                }
                modalItemAvailabilityEl.style.display = 'flex';
                let icon = '🟢';
                if (info.status === AVAILABILITY_STATUS.PARTIAL) { modalItemAvailabilityEl.classList.add('available-partial'); icon = '🟠'; }
                else if (info.status === AVAILABILITY_STATUS.NONE) { modalItemAvailabilityEl.classList.add('unavailable'); icon = '🔴'; }
                else { modalItemAvailabilityEl.classList.add('available-full'); }
                let text = info.label;
                if (info.slots) {
                    const slotText = info.slots.split('\n').filter(Boolean).join(', ');
                    if (slotText) text += `: ${slotText}`;
                }
                modalItemAvailabilityEl.innerHTML = `<span class="avail-icon">${icon}</span> <span class="avail-text">${text}</span>`;
            };

            /** Refresh the availability line from the current date/time selection. */
            const updateModalItemAvailability = async () => {
                if (!modalItemAvailabilityEl) return;
                const icalUrl = record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL];
                if (!icalUrl || !getSelectedModalDate()) {
                    modalItemAvailabilityEl.style.display = 'none';
                    return;
                }
                modalItemAvailabilityEl.style.display = 'flex';
                modalItemAvailabilityEl.className = 'modal-item-availability is-pending';
                modalItemAvailabilityEl.textContent = 'Checking availability…';
                let busyTimes;
                try {
                    busyTimes = await api.fetchCalendarForRecord(record);
                } catch (e) {
                    modalItemAvailabilityEl.style.display = 'none';
                    return;
                }
                // Read the latest selection after the (possibly async) fetch.
                const selectedDate = getSelectedModalDate();
                if (!selectedDate) {
                    modalItemAvailabilityEl.style.display = 'none';
                    return;
                }
                renderModalAvailability(describeSelectedAvailability(record, busyTimes, {
                    date: selectedDate,
                    startTime: modalItemStartTimeInput?.value || '',
                    endTime: getCurrentEndTime(),
                }));
            };

            // Initialize date field with Flatpickr single mode (lazy-loaded)
            let modalItemDatePicker = null;
            if (modalItemDateInput) {
                // Clean up previous Flatpickr instance and listener from prior modal opens
                if (modalItemDateInput._flatpickr) {
                    try { modalItemDateInput._flatpickr.destroy(); } catch (_) {}
                    delete modalItemDateInput._flatpickr;
                }
                if (modalItemDateInput._initHandler) {
                    modalItemDateInput.removeEventListener('focus', modalItemDateInput._initHandler);
                }

                const initModalDatePicker = async () => {
                    if (modalItemDatePicker) {
                        modalItemDatePicker.open();
                        return;
                    }
                    try {
                        await loadFlatpickr();
                        if (typeof window.flatpickr !== 'function') return;

                        modalItemDatePicker = window.flatpickr(modalItemDateInput, {
                            mode: "single",
                            dateFormat: "M j, Y",
                            // Force the custom calendar on mobile so availability shading (via onDayCreate) renders;
                            // the native mobile date input bypasses onDayCreate and shows no availability colors.
                            disableMobile: true,
                            onDayCreate: (dObj, dStr, fp, dayElem) => {
                                const icalUrl = record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL];
                                if (!icalUrl) return;
                                const busyTimes = state.calendar.busyTimes.get(icalUrl);
                                if (!busyTimes || busyTimes.length === 0) return;
                                const status = getDayStatus(dayElem.dateObj, busyTimes, record);
                                dayElem.classList.remove('available-full', 'available-partial', 'unavailable');
                                switch (status.status) {
                                    case AVAILABILITY_STATUS.FULL: dayElem.classList.add('available-full'); break;
                                    case AVAILABILITY_STATUS.PARTIAL: dayElem.classList.add('available-partial'); break;
                                    case AVAILABILITY_STATUS.NONE: dayElem.classList.add('unavailable'); break;
                                }
                                dayElem.title = status.reason;
                            },
                            onOpen: async (selectedDates, dateStr, instance) => {
                                if (record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL]) {
                                    console.log(`[ICAL] Modal calendar opened for "${record.fields.Name || record.id}"`);
                                    const busyTimes = await api.fetchCalendarForRecord(record);
                                    logBusyTimeSummary(`"${record.fields.Name || record.id}"`, busyTimes);
                                    if (busyTimes && busyTimes.length > 0 && instance.config) {
                                        instance.redraw();
                                    }
                                }
                            },
                            onChange: (selectedDates) => {
                                if (selectedDates.length >= 1) {
                                    saveTimeField('itemDate', selectedDates[0].toISOString());
                                    saveTimeField('itemDateEnd', null);
                                } else {
                                    saveTimeField('itemDate', null);
                                    saveTimeField('itemDateEnd', null);
                                }
                                updateModalItemAvailability();
                            }
                        });
                        modalItemDateInput._flatpickr = modalItemDatePicker;

                        // Restore saved date
                        if (lockedInfo?.itemDate) {
                            modalItemDatePicker.setDate(new Date(lockedInfo.itemDate), false);
                        }

                        modalItemDatePicker.open();
                    } catch (e) {
                        console.error('Modal date picker init error:', e);
                    }
                };

                modalItemDateInput._initHandler = initModalDatePicker;
                modalItemDateInput.addEventListener('focus', initModalDatePicker);

                // If there's already a saved date, show it in the input
                if (lockedInfo?.itemDate) {
                    const d = new Date(lockedInfo.itemDate);
                    modalItemDateInput.value = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                }
            }

            if (modalItemStartTimeInput) {
                modalItemStartTimeInput.addEventListener('change', () => {
                    saveTimeField('itemStartTime', modalItemStartTimeInput.value || null);
                    computeItemEndTime();
                    updateModalItemAvailability();
                });
            }
            if (modalItemDurationInput) {
                modalItemDurationInput.addEventListener('change', () => {
                    const val = modalItemDurationInput.value;
                    const parsed = val ? parseInt(val, 10) : null;
                    saveTimeField('itemDuration', parsed || null);
                    if (modalItemDurationSource) {
                        modalItemDurationSource.textContent = val ? 'custom override' : (catalogDurationMin > 0 ? `catalog: ${fmtDur(catalogDurationMin)}` : '');
                    }
                    computeItemEndTime();
                    updateModalItemAvailability();
                });
            }

            // --- "Update plan & all items" — push this item's date/time everywhere ---
            const applyAllBtn = document.getElementById('modal-item-apply-all-btn');
            const applyAllMsg = document.getElementById('modal-item-apply-all-msg');
            const showApplyAllMsg = (text) => {
                if (!applyAllMsg) return;
                applyAllMsg.textContent = text;
                clearTimeout(showApplyAllMsg._t);
                showApplyAllMsg._t = setTimeout(() => { applyAllMsg.textContent = ''; }, 4000);
            };

            /** Resolve this item's effective duration in minutes from its current modal selection. */
            const getModalEffectiveDuration = () => {
                const unitMinutes = getTimeUnitMinutes(record);
                if (unitMinutes) {
                    const qtyVal = (typeof input !== 'undefined' && input) ? (parseFloat(input.value) || 1) : (lockedInfo?.quantity || 1);
                    return Math.round(qtyVal * unitMinutes);
                }
                const durVal = modalItemDurationInput?.value;
                return (durVal ? parseInt(durVal, 10) : null) || lockedInfo?.itemDuration || catalogDurationMin || 0;
            };

            if (applyAllBtn) {
                applyAllBtn.onclick = () => {
                    const selDate = getSelectedModalDate();
                    if (!selDate || isNaN(selDate.getTime())) {
                        showApplyAllMsg('Select a date first.');
                        return;
                    }
                    const dateISO = selDate.toISOString();
                    const startTime = modalItemStartTimeInput?.value || '';
                    const durationMin = getModalEffectiveDuration();

                    const itemCount = state.cart.lockedItems.size;
                    if (!window.confirm(`Apply this date/time to the plan${itemCount ? ` and all ${itemCount} item${itemCount === 1 ? '' : 's'}` : ''}? This replaces the plan date and any dates set on individual items.`)) {
                        return;
                    }

                    // 1) Write the plan-level date/time.
                    const combined = state.eventDetails.combined;
                    combined.set(CONSTANTS.DETAIL_TYPES.DATE, dateISO);
                    if (startTime) combined.set(CONSTANTS.DETAIL_TYPES.START_TIME, startTime);
                    else combined.delete(CONSTANTS.DETAIL_TYPES.START_TIME);
                    if (durationMin > 0) combined.set(CONSTANTS.DETAIL_TYPES.DURATION, durationMin);
                    else combined.delete(CONSTANTS.DETAIL_TYPES.DURATION);
                    const planEnd = computeEndFromStartDuration(startTime, durationMin, dateISO);
                    if (planEnd.endTime) combined.set(CONSTANTS.DETAIL_TYPES.END_TIME, planEnd.endTime);
                    else combined.delete(CONSTANTS.DETAIL_TYPES.END_TIME);
                    if (planEnd.dateEnd) combined.set(CONSTANTS.DETAIL_TYPES.DATE_END, planEnd.dateEnd);
                    else combined.delete(CONSTANTS.DETAIL_TYPES.DATE_END);

                    // 2) Write each locked item, keeping time-priced durations tied to quantity.
                    for (const [recordId, info] of state.cart.lockedItems.entries()) {
                        const itemRecord = state.records.all.find(r => r.id === recordId);
                        info.itemDate = dateISO;
                        if (startTime) info.itemStartTime = startTime; else delete info.itemStartTime;

                        const unitMinutes = itemRecord ? getTimeUnitMinutes(itemRecord) : null;
                        let effDuration;
                        if (unitMinutes) {
                            const qty = parseFloat(info.quantity) || 1;
                            effDuration = Math.round(qty * unitMinutes);
                            info.itemDuration = effDuration;
                        } else if (durationMin > 0) {
                            effDuration = durationMin;
                            info.itemDuration = durationMin;
                        } else {
                            effDuration = info.itemDuration || 0;
                        }
                        const itemEnd = computeEndFromStartDuration(info.itemStartTime, effDuration, dateISO);
                        if (itemEnd.endTime) info.itemEndTime = itemEnd.endTime; else delete info.itemEndTime;
                        if (itemEnd.dateEnd) info.itemDateEnd = itemEnd.dateEnd; else delete info.itemDateEnd;
                        state.cart.lockedItems.set(recordId, info);
                    }

                    // 3) Refresh the plan toolbar controls and both surfaces.
                    const planStartSelect = document.getElementById('event-start-time');
                    if (planStartSelect) planStartSelect.value = startTime || '';
                    const planDurSelect = document.getElementById('event-duration-input');
                    if (planDurSelect) planDurSelect.value = durationMin > 0 ? String(durationMin) : '';
                    const planDurDisplay = document.getElementById('event-duration-display');
                    if (planDurDisplay) planDurDisplay.textContent = planEnd.endTime ? `(ends ${planEnd.endTime})` : '';

                    if (typeof triggerSave === 'function') triggerSave();
                    if (typeof ui.updateEventPlanDateDisplay === 'function') ui.updateEventPlanDateDisplay();
                    if (typeof ui.updateEventPlanSection === 'function') ui.updateEventPlanSection();
                    syncPlanStateAcrossViews('modal', 'itemUpdated', { appliedToPlanAndItems: true });
                    updateModalItemAvailability();
                    showApplyAllMsg(`Applied to the plan${itemCount ? ` and all ${itemCount} item${itemCount === 1 ? '' : 's'}` : ''}.`);
                };
            }

            // --- Time-priced items: quantity IS the duration (collapse the Duration control) ---
            // Reset any prior time-priced adjustments first (the modal DOM is reused across opens).
            const durationGroupEl = document.querySelector('#modal-item-time-container .modal-duration-group');
            if (durationGroupEl) durationGroupEl.style.display = '';
            const staleQtyHint = document.getElementById('modal-item-qty-duration-hint');
            if (staleQtyHint) staleQtyHint.remove();
            // Clear any quantity→duration sync handler left from a previous modal open
            // (these are assigned, not addEventListener, so updateQuantityTotal is untouched).
            if (typeof input !== 'undefined' && input) { input.onchange = null; input.oninput = null; }

            const timeUnitMinutes = getTimeUnitMinutes(record);
            if (timeUnitMinutes) {
                if (durationGroupEl) durationGroupEl.style.display = 'none';

                const unitLabel = timeUnitMinutes === 60 ? 'hours'
                    : timeUnitMinutes === 24 * 60 ? 'days'
                    : timeUnitMinutes === 7 * 24 * 60 ? 'weeks'
                    : timeUnitMinutes === 30 * 24 * 60 ? 'months' : 'units';

                const qtyHint = document.createElement('p');
                qtyHint.id = 'modal-item-qty-duration-hint';
                qtyHint.className = 'time-duration-source';
                const fieldsEl = document.querySelector('#modal-item-time-container .modal-time-fields');
                if (fieldsEl) fieldsEl.appendChild(qtyHint);

                const syncDurationFromQuantity = () => {
                    const qty = (typeof input !== 'undefined' && input) ? (parseFloat(input.value) || 1) : (lockedInfo?.quantity || 1);
                    const durMin = Math.round(qty * timeUnitMinutes);
                    // Mirror into the hidden duration input so downstream readers stay consistent.
                    if (modalItemDurationInput) modalItemDurationInput.value = String(durMin);
                    saveTimeField('itemDuration', durMin);
                    qtyHint.textContent = `Duration follows quantity: ${qty} ${unitLabel} (${fmtDur(durMin)})`;
                    computeItemEndTime();
                    updateModalItemAvailability();
                };

                syncDurationFromQuantity();
                if (typeof input !== 'undefined' && input) {
                    input.onchange = syncDurationFromQuantity;
                    input.oninput = syncDurationFromQuantity;
                }
            }

            // Initialize computed end time hint
            computeItemEndTime();
            // Show availability for any pre-selected date/time on open.
            updateModalItemAvailability();
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

    // Published events with RSVP options: make RSVP the primary action (with a
    // party-size "number of RSVPs" stepper), tuck Add to Plan into a "…" menu,
    // and remove item scheduling. Scoped to events; all other items are untouched.
    if (record.fields['Item Type'] === 'Event') {
        setupEventRsvpActionZone(record, linkedSession);
    }
    // --- END THE FIX ---\

    ui.updateCardIcon(record.id);

    // Remove the image loading placeholder now that the real image is set
    const loadingPlaceholder = modalMainImage.querySelector('.modal-image-loading-placeholder');
    if (loadingPlaceholder) loadingPlaceholder.remove();

    // Re-apply z-index in case presentation state changed during async work
    const isPresentationActive = document.body.classList.contains('presentation-active');
    const modalZIndex = getModalZIndex('detail');
    modalOverlay.style.zIndex = modalZIndex;

    // Apply critical styles to modal columns (depends on final content being populated)
    const modalContentEl = modalOverlay.querySelector('.modal-content');
    if (modalContentEl) {
        const isMobile = window.innerWidth <= 768;

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
                computedOpacity: window.getComputedStyle(modalContent).opacity,
                computedFlexDirection: window.getComputedStyle(modalContent).flexDirection,
                inlineFlexDirection: modalContent.style.flexDirection,
                windowWidth: window.innerWidth
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

    // Initialize reactions & comments sections for this item
    const modalRecordId = modalOverlay.dataset.recordId;
    if (modalRecordId) {
        initModalReactions(modalRecordId);
        initModalComments(modalRecordId);
        updateModalSentimentChips(modalRecordId);
    }

    } catch (error) {
        console.error('[MODAL DEBUG] Error in showDetailModal:', error);
    } finally {
        // Always reset the rendering guard, even if an error occurred
        isModalRendering = false;
    }
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

    try {

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
            const gridClass = imageUrls.length === 1 ? 'single' : imageUrls.length === 2 ? 'two' : imageUrls.length === 3 ? 'three' : 'multi';
            modalMainImage.innerHTML = `
                <div class="group-modal-image-grid ${gridClass}">
                    ${imageUrls.slice(0, 6).map(url => `
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
                <button class="group-dissolve-modal-btn" data-group-id="${group.id}">✂ Split All ${group.items.length} Items Apart</button>
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
                        if (typeof ui !== 'undefined' && ui.showToast) {
                            ui.showToast(`"${removedName}" removed, group dissolved`, 'success');
                        }
                        window.dispatchEvent(new CustomEvent('groupDissolved', { detail: { groupId } }));
                    } else {
                        if (!Array.isArray(grp)) {
                            grp.items = items;
                        }
                        if (typeof ui !== 'undefined' && ui.showToast) {
                            ui.showToast(`"${removedName}" removed from group`, 'success');
                        }
                        // Reset rendering guard so modal can re-render
                        isModalRendering = false;
                        // Re-render the group modal with updated items instead of closing
                        showGroupDetailModal(grp, allRecords);
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
                    const grp = state.session.relatedGroups.find(g => g.id === groupId);
                    const grpName = grp?.name || 'Group';
                    state.session.relatedGroups = state.session.relatedGroups.filter(g => g.id !== groupId);
                    hideDetailModal();
                    if (typeof ui !== 'undefined' && ui.showToast) {
                        ui.showToast(`"${grpName}" split apart`, 'success');
                    }
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
                flex-direction: row;
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

    } catch (error) {
        console.error('[MODAL DEBUG] Error in showGroupDetailModal:', error);
    } finally {
        // Always reset the rendering guard, even if an error occurred
        isModalRendering = false;
    }
}

export function hideDetailModal() {
    console.log('[MODAL DEBUG] hideDetailModal called.', {
        wasActive: !!modalOverlay && modalOverlay.classList.contains('active'),
        recordId: modalOverlay?.dataset?.recordId || null,
        url: window.location.pathname + window.location.search
    });
    // Reset the rendering guard when modal is closed
    isModalRendering = false;

    // Dismiss any open sentiment popup so it never lingers over the page.
    closeItemSentimentPopup();

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
            // Skip cleanup if the modal was re-opened during the 300ms transition
            // window. This happens on direct /item/ URL loads (and refreshes while a
            // modal is open) where syncUiWithUrl calls hideDetailModal first to clear
            // any stale state, then showDetailModal a moment later — without this
            // guard the deferred cleanup wiped the freshly opened modal and the
            // visitor saw the modal flash then disappear back to the catalog.
            if (modalOverlay.classList.contains('active')) {
                console.log('[MODAL DEBUG] hideDetailModal deferred cleanup skipped — modal was reopened during the 300ms transition.');
                return;
            }
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

/**
 * Reorders the checkout modal's Community Fund and "Also purchase this item?" sections.
 * In the Chip In flow we lead with the Community Fund, then show the also-purchase prompt
 * beneath it. Other flows (plan checkout, Rapid Pay) keep the default layout where the
 * Community Fund sits inside the totals block. The reordering is reversible and idempotent,
 * so reopening the modal in any mode always lands in the correct layout.
 */
function applyChipInSectionOrder(chipInLead) {
    const summaryEl = document.getElementById('checkout-summary-details');
    const qtyToggle = document.getElementById('checkout-item-quantity-toggle');
    const chipInSection = document.getElementById('checkout-chip-in-section');
    if (!summaryEl || !qtyToggle || !chipInSection) return;

    if (chipInLead) {
        // Lead with the Community Fund, then the "Also purchase this item?" prompt.
        summaryEl.insertAdjacentElement('afterend', chipInSection);
        chipInSection.insertAdjacentElement('afterend', qtyToggle);
    } else {
        // Default layout: qty prompt directly after the summary, Community Fund inside totals.
        summaryEl.insertAdjacentElement('afterend', qtyToggle);
        const totalRow = document.querySelector('.checkout-total-deposit-section .checkout-total');
        if (totalRow) totalRow.insertAdjacentElement('afterend', chipInSection);
    }
}

/**
 * Read the note and per-item scheduling fields straight from the detail modal
 * DOM so they can be carried into the checkout (Rapid Pay / Chip In) scope.
 * Mirrors the capture logic used when adding an item to the plan. Returns an
 * object with only the fields that are actually set.
 */
// Holds the single outside-click handler that closes the event "…" menu, so we
// can swap it on each modal open without leaking listeners across opens.
let _eventMenuOutsideHandler = null;

// Streamline a published event's action zone:
//   • RSVP (a party-size "number of RSVPs" stepper + Yes / Maybe / No) becomes
//     the prominent primary action.
//   • Add to Plan collapses into a secondary "…" overflow menu (its id and data
//     attributes are preserved, so its existing click handler is unaffected).
//   • Item scheduling is removed and the item-quantity stepper is hidden — for an
//     event the meaningful quantity IS the party size.
// Scoped to events and safe to call on every modal open (it tears down anything a
// previous open left behind before rebuilding).
function setupEventRsvpActionZone(record, linkedSession) {
    const actions = document.getElementById('modal-actions-container');
    if (!actions) return;

    const userId = state.session.user.id;
    const rsvpYes = record.fields.RSVPs || [];
    const rsvpMaybe = record.fields.RSVPMaybe || [];
    const rsvpNo = record.fields.RSVPNo || [];
    let hasYes = rsvpYes.includes(userId);
    let hasMaybe = rsvpMaybe.includes(userId);
    let hasNo = rsvpNo.includes(userId);

    // Guests have no user id in the Airtable lists, so reflect their pending RSVP
    // (held in localStorage until they sign in at checkout) as the active state.
    let guestPartyQty = null;
    if (!state.session.user.isAuthenticated) {
        const pending = getTempRsvps()[record.id];
        if (pending) {
            hasYes = pending.rsvpType === 'yes';
            hasMaybe = pending.rsvpType === 'maybe';
            hasNo = pending.rsvpType === 'no';
            guestPartyQty = pending.quantity;
        }
    }

    // Hide the item-quantity stepper for events (party size replaces it).
    const qtySel = document.getElementById('modal-quantity-selector');
    if (qtySel) qtySel.style.display = 'none';

    // Remove item scheduling entirely, and clear any stale schedule the shared
    // inputs may carry from a prior (non-event) modal open so Add to Plan never
    // picks up a phantom time for the event.
    const timeContainer = document.getElementById('modal-item-time-container');
    if (timeContainer) {
        timeContainer.style.display = 'none';
        const st = document.getElementById('modal-item-start-time');
        const du = document.getElementById('modal-item-duration');
        const dt = document.getElementById('modal-item-date');
        if (st) st.value = '';
        if (du) du.value = '';
        if (dt && dt._flatpickr) dt._flatpickr.clear();
        else if (dt) dt.value = '';
    }

    actions.style.display = 'block';

    // Tear down anything from a previous open. The Add to Plan button is rescued
    // back to the actions container first so it is never lost across reopens.
    const priorMenu = actions.querySelector('.modal-secondary-menu');
    if (priorMenu) {
        const moved = priorMenu.querySelector('#modal-add-to-plan-btn');
        if (moved) actions.appendChild(moved);
        priorMenu.remove();
    }
    const priorRsvp = actions.querySelector('.modal-rsvp-primary');
    if (priorRsvp) priorRsvp.remove();

    // --- Secondary "…" menu holding Add to Plan ----------------------------
    const addBtn = document.getElementById('modal-add-to-plan-btn');
    const menu = document.createElement('div');
    menu.className = 'modal-secondary-menu';
    const menuToggle = document.createElement('button');
    menuToggle.type = 'button';
    menuToggle.className = 'modal-secondary-menu-toggle';
    menuToggle.setAttribute('aria-label', 'More actions');
    menuToggle.setAttribute('aria-haspopup', 'true');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.textContent = '⋯';
    const menuDropdown = document.createElement('div');
    menuDropdown.className = 'modal-secondary-menu-dropdown';
    menuDropdown.hidden = true;
    if (addBtn) {
        addBtn.style.display = '';
        menuDropdown.appendChild(addBtn); // relocate the existing button as-is
    }
    menu.appendChild(menuToggle);
    menu.appendChild(menuDropdown);
    menuToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = menuDropdown.hidden;
        menuDropdown.hidden = !willOpen;
        menuToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    // Single, de-duplicated outside-click close (no per-open listener leak).
    if (_eventMenuOutsideHandler) document.removeEventListener('click', _eventMenuOutsideHandler);
    _eventMenuOutsideHandler = (e) => {
        if (!menu.isConnected) return;
        if (!menu.contains(e.target)) {
            menuDropdown.hidden = true;
            menuToggle.setAttribute('aria-expanded', 'false');
        }
    };
    document.addEventListener('click', _eventMenuOutsideHandler);

    // --- RSVP primary block ------------------------------------------------
    const block = document.createElement('div');
    block.className = 'modal-rsvp-primary';
    block.innerHTML = `
        <div class="rsvp-party-row">
            <label class="rsvp-party-label" for="rsvp-quantity-input">Number of RSVPs</label>
            <div class="quantity-selector rsvp-quantity-selector">
                <button type="button" class="quantity-btn minus" aria-label="Fewer RSVPs">-</button>
                <input type="number" id="rsvp-quantity-input" class="quantity-input" value="1" min="1" step="1" inputmode="numeric">
                <button type="button" class="quantity-btn plus" aria-label="More RSVPs">+</button>
            </div>
        </div>
        <div class="rsvp-button-group rsvp-primary-group">
            <button class="rsvp-btn rsvp-yes ${hasYes ? 'active' : ''}" data-record-id="${record.id}" data-rsvp-type="yes">${hasYes ? 'Going ✅' : 'Yes'}</button>
            <button class="rsvp-btn rsvp-maybe ${hasMaybe ? 'active' : ''}" data-record-id="${record.id}" data-rsvp-type="maybe">${hasMaybe ? 'Maybe ❓' : 'Maybe'}</button>
            <button class="rsvp-btn rsvp-no ${hasNo ? 'active' : ''}" data-record-id="${record.id}" data-rsvp-type="no">${hasNo ? "Can't Go ❌" : 'No'}</button>
        </div>`;

    // Primary block first, then the "…" menu — both at the top of the zone.
    actions.insertBefore(menu, actions.firstChild);
    actions.insertBefore(block, actions.firstChild);

    // Party-size stepper wiring (always clamped to >= 1).
    const qtyInput = block.querySelector('#rsvp-quantity-input');
    // Prefill a guest's pending party size (signed-in users are filled below from the server).
    if (guestPartyQty && qtyInput) qtyInput.value = String(guestPartyQty);
    const minusBtn = block.querySelector('.minus');
    const plusBtn = block.querySelector('.plus');
    const clampQty = () => {
        let v = parseInt(qtyInput.value, 10);
        if (!Number.isFinite(v) || v < 1) v = 1;
        if (v > 999) v = 999;
        qtyInput.value = String(v);
    };
    if (plusBtn) plusBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        qtyInput.value = String((parseInt(qtyInput.value, 10) || 1) + 1); clampQty();
    });
    if (minusBtn) minusBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        qtyInput.value = String((parseInt(qtyInput.value, 10) || 1) - 1); clampQty();
    });
    if (qtyInput) qtyInput.addEventListener('change', clampQty);

    // Prefill the guest's saved party size, and reflect summed headcount totals
    // in the RSVP list. Totals are computed here against the authoritative
    // Airtable RSVP lists, folding in each guest's stored party size (guests with
    // no stored size — e.g. anyone who responded before this feature — count as a
    // single spot). Best-effort: on any failure the people-count labels stand.
    api.fetchEventRsvpData(record.id).then((data) => {
        if (!data) return;
        if (data.mine && data.mine.quantity && qtyInput) qtyInput.value = String(data.mine.quantity);
        const quantities = data.quantities || {};
        const section = document.querySelector('.rsvp-list-section');
        if (section) {
            const sumSpots = (ids) => ids.reduce((acc, id) => acc + (Number(quantities[id]) || 1), 0);
            const setLabel = (type, word, ids) => {
                const el = section.querySelector(`.rsvp-list-label[data-rsvp-type="${type}"]`);
                if (el && ids.length > 0) el.textContent = `${word} (${sumSpots(ids)})`;
            };
            setLabel('yes', 'Going', rsvpYes);
            setLabel('maybe', 'Maybe', rsvpMaybe);
            setLabel('no', "Can't Go", rsvpNo);
        }
    }).catch(() => { /* defaults stand */ });
}

function captureModalNoteAndSchedule() {
    const result = {};
    const note = document.getElementById('modal-item-note')?.value || '';
    if (note && note.trim() !== '') result.note = note;

    const startTime = document.getElementById('modal-item-start-time')?.value || '';
    const durationRaw = document.getElementById('modal-item-duration')?.value || '';
    if (startTime) result.itemStartTime = startTime;
    if (durationRaw) {
        const parsed = parseInt(durationRaw, 10);
        if (parsed > 0) result.itemDuration = parsed;
    }

    // Compute end time from start time + duration
    if (result.itemStartTime && result.itemDuration) {
        const timeMatch = result.itemStartTime.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
        if (timeMatch) {
            let h = parseInt(timeMatch[1], 10);
            const m = parseInt(timeMatch[2], 10);
            const mer = timeMatch[3] ? timeMatch[3].toUpperCase() : null;
            if (mer === 'PM' && h !== 12) h += 12;
            else if (mer === 'AM' && h === 12) h = 0;
            const endMin = (h * 60 + m + result.itemDuration) % (24 * 60);
            const eH = Math.floor(endMin / 60);
            const eM = endMin % 60;
            result.itemEndTime = eH === 0 ? `12:${String(eM).padStart(2, '0')} AM` :
                eH < 12 ? `${eH}:${String(eM).padStart(2, '0')} AM` :
                eH === 12 ? `12:${String(eM).padStart(2, '0')} PM` :
                `${eH - 12}:${String(eM).padStart(2, '0')} PM`;
        }
    }

    // Date: prefer the Flatpickr instance's selected date, else the raw input value
    const dateEl = document.getElementById('modal-item-date');
    if (dateEl?._flatpickr && dateEl._flatpickr.selectedDates.length >= 1) {
        result.itemDate = dateEl._flatpickr.selectedDates[0].toISOString();
    } else if (dateEl?.value?.trim()) {
        result.itemDate = dateEl.value.trim();
    }

    return result;
}

// ── Shareable checkout deep links ─────────────────────────────────────────
// Power users share a checkout flow simply by copying the browser URL: whenever
// a checkout modal is open, the address bar reflects the exact flow (Rapid Pay /
// Chip In / plan checkout) plus the selected options and quantity. No extra
// buttons are added — the address bar is the share affordance. The params are
// written with replaceState on open and stripped again on close, so refreshing
// or back/forward never re-fires anything unexpectedly and a clean URL remains
// once the user leaves checkout. Following such a link never charges anyone; it
// only re-opens the same checkout modal for the recipient to confirm.
const CHECKOUT_URL_PARAMS = ['action', 'qty', 'opts'];

function clearCheckoutUrlState() {
    try {
        const url = new URL(window.location);
        let changed = false;
        CHECKOUT_URL_PARAMS.forEach(p => {
            if (url.searchParams.has(p)) { url.searchParams.delete(p); changed = true; }
        });
        if (changed) history.replaceState(history.state, '', url.toString());
    } catch (e) {
        log('Modal', `clearCheckoutUrlState failed: ${e.message}`);
    }
}

function writeCheckoutUrlState(scope) {
    try {
        const url = new URL(window.location);
        const sp = url.searchParams;
        // Start from a clean slate so stale params from a previous flow never leak in.
        CHECKOUT_URL_PARAMS.forEach(p => sp.delete(p));

        if (scope && scope.mode === 'item') {
            const isChipIn = !!scope.highlightChipIn;
            sp.set('action', isChipIn ? 'chipin' : 'rapidpay');
            // For Chip In the item-modal quantity is carried as maxQuantity
            // (scope.quantity is the donation count, which begins at 0).
            const qty = isChipIn ? (scope.maxQuantity || 1) : (scope.quantity || 1);
            if (qty && qty !== 1) sp.set('qty', String(qty));
            const optsStr = encodeSelections(scope.selections);
            if (optsStr) sp.set('opts', optsStr);
        } else {
            // Plan checkout (no item scope) — the session id is already in the URL.
            sp.set('action', 'checkout');
        }
        history.replaceState(history.state, '', url.toString());
    } catch (e) {
        log('Modal', `writeCheckoutUrlState failed: ${e.message}`);
    }
}

/**
 * Restore a shared checkout deep link inside the already-open item detail modal,
 * then trigger the matching Rapid Pay / Chip In flow. It drives the real option
 * buttons and quantity input so every pricing/selection rule runs exactly as if
 * the recipient had clicked through by hand. No auto-charge happens — the
 * triggered button only opens the checkout modal for confirmation.
 *
 * @param {Object} opts
 * @param {string} opts.action - 'rapidpay' or 'chipin'.
 * @param {number|string} [opts.qty] - Quantity selected by the sharer.
 * @param {Object} [opts.selections] - Decoded option selections keyed by "groupN".
 */
export async function applyCheckoutDeepLink({ action, qty, selections } = {}) {
    if (action !== 'rapidpay' && action !== 'chipin') return;

    // Restore option selections by activating the matching option buttons. Only
    // touch buttons that aren't already selected (clicking a selected one would
    // toggle it off) and skip navigation options (which open a different item
    // rather than record a selection).
    if (selections && typeof selections === 'object') {
        Object.keys(selections).forEach(groupKey => {
            const m = /^group(\d+)$/.exec(groupKey);
            if (!m) return;
            const groupIndex = m[1];
            const value = selections[groupKey];
            const indices = Array.isArray(value) ? value : [value];
            indices.forEach(optionIndex => {
                const btn = document.querySelector(
                    `#modal-options-container .option-btn[data-group-index="${groupIndex}"][data-option-index="${optionIndex}"]`
                );
                if (btn && !btn.classList.contains('navigation-option') && !btn.classList.contains('selected')) {
                    btn.click();
                }
            });
        });
    }

    // Restore quantity (the input handlers refresh the running total/price).
    const qtyNum = parseFloat(qty);
    if (!isNaN(qtyNum) && qtyNum > 0) {
        const input = document.querySelector('#modal-quantity-selector .quantity-input');
        if (input) {
            input.value = qtyNum;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    // Trigger the matching flow. The existing button handlers build the correct
    // checkout scope (reading the live selections/quantity we just restored).
    const btnId = action === 'chipin' ? 'modal-chip-in-btn' : 'modal-rapid-pay-btn';
    const payBtn = document.getElementById(btnId);
    if (payBtn) {
        payBtn.click();
    } else {
        log('Modal', `applyCheckoutDeepLink: #${btnId} not found`);
    }
}

export async function showCheckoutModal(shopSettings, scope = null) {
    currentShopSettings = shopSettings;
    currentCheckoutScope = scope; // { mode: 'item', itemId, itemName, quantity, price, record, selectedOptionIndex, selections, highlightChipIn } or null (plan mode)
    currentChipInAmount = 0; // Reset chip-in on each open
    log('Modal', `Showing checkout modal. Scope: ${scope ? scope.mode : 'plan'}`);
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    const fullTotalEl = document.getElementById('full-total-price');
    const checkoutCloseBtn = document.getElementById('checkout-close-btn');
    const summaryDetailsEl = document.getElementById('checkout-summary-details');
    const tipAmountInput = document.getElementById('tip-amount');
    const paymentChoiceContainer = document.getElementById('payment-choice-container');
    const termsContainer = document.querySelector('.terms-and-conditions');

    // Update modal title based on scope
    const checkoutTitle = document.getElementById('checkout-modal-title');
    if (checkoutTitle) {
        if (scope && scope.highlightChipIn) {
            checkoutTitle.textContent = 'Chip In';
        } else if (scope && scope.mode === 'item') {
            checkoutTitle.textContent = 'Checkout';
        } else {
            checkoutTitle.textContent = 'Checkout Summary';
        }
    }

    // Get new fee/total elements
    const processingFeeEl = document.getElementById('processing-fee-price');
    const finalChargeEl = document.getElementById('final-charge-price');

    const totalLabel = document.getElementById('checkout-total-label');
    if (totalLabel) {
        if (scope && scope.highlightChipIn && (scope.quantity === 0 || !scope.quantity)) {
            totalLabel.textContent = 'Item Price:';
        } else if (state.session.user.amountReceived > 0) {
            totalLabel.textContent = 'Total Final Cost:';
        } else {
            totalLabel.textContent = 'Total Estimated Cost:';
        }
    }

    if (!checkoutModalOverlay) return;

    // Reflect this checkout flow in the URL so it can be copied & shared.
    writeCheckoutUrlState(scope);

    // Guest "create an account / sign in" option vs. signed-in prefill.
    const accountRow = document.getElementById('checkout-account-row');
    const accountCheckbox = document.getElementById('checkout-create-account');
    const nameInput = document.getElementById('customer-name');
    const emailInput = document.getElementById('customer-email');
    const isAuthed = state.session.user.isAuthenticated;
    if (accountCheckbox) accountCheckbox.checked = false;
    if (accountRow) accountRow.style.display = isAuthed ? 'none' : '';
    if (isAuthed) {
        if (nameInput && !nameInput.value) nameInput.value = state.session.user.name || '';
        if (emailInput && !emailInput.value) emailInput.value = state.session.user.email || '';
    } else {
        // Returning guests recognize their email; prefill from the last sign-in attempt.
        const lastEmail = localStorage.getItem('lastSignInEmail');
        if (emailInput && !emailInput.value && lastEmail) emailInput.value = lastEmail;
    }

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
    // Reset any leftover "success/receipt" state from a previous checkout in this
    // session (the success path hides these and, for a free registration, the page
    // is not reloaded — so reopening the modal must restore the form view).
    const successMsgEl = document.getElementById('payment-success-message');
    if (successMsgEl) successMsgEl.style.display = 'none';
    if (summaryDetailsEl) summaryDetailsEl.style.display = '';
    const depositSectionEl = document.querySelector('.checkout-total-deposit-section');
    if (depositSectionEl) depositSectionEl.style.display = '';
    const termsSectionEl = document.querySelector('.terms-and-conditions');
    if (termsSectionEl) termsSectionEl.style.display = '';
    summaryDetailsEl.innerHTML = '';
    tipAmountInput.value = '';
    let finalTotal = 0; // This is the plan subtotal
    const summaryList = document.createElement('ul');

    if (scope && scope.mode === 'item') {
        // Single-item mode: show only the specified item
        const initialQty = scope.quantity || 0;
        currentCheckoutItemQty = initialQty;
        const itemTotal = (scope.price || 0) * initialQty;
        finalTotal = itemTotal;

        // Build option detail lines for item mode (supports multiple groups / multi-select)
        const itemOptionDetailsHtml = buildItemOptionDetailsHtml(scope);

        // Note and per-item scheduling carried from the detail modal
        let itemNoteHtml = '';
        if (scope.note && scope.note.trim() !== '') {
            itemNoteHtml = `<small class="checkout-summary-note">Note: ${scope.note}</small>`;
        }
        const itemScheduleStr = formatItemSchedule(scope);
        const itemScheduleHtml = itemScheduleStr
            ? `<small class="checkout-summary-schedule"><span class="schedule-icon">🕐</span> ${itemScheduleStr}</small>`
            : '';

        const listItem = document.createElement('li');
        listItem.id = 'checkout-scope-item';
        if (initialQty === 0) {
            // Donation-only mode: show item name without price (no purchase)
            listItem.innerHTML = `
                <div class="summary-item-details">
                    <span class="summary-item-name">${scope.itemName || 'Item'}</span>
                    ${itemOptionDetailsHtml}
                    ${itemScheduleHtml}
                    ${itemNoteHtml}
                    <small class="summary-item-donation-note">Chip in to crowdfund this item</small>
                </div>
                <span class="summary-item-price">—</span>
            `;
        } else {
            listItem.innerHTML = `
                <div class="summary-item-details">
                    <span class="summary-item-name">${scope.itemName || 'Item'} (x${initialQty})</span>
                    ${itemOptionDetailsHtml}
                    ${itemScheduleHtml}
                    ${itemNoteHtml}
                </div>
                <span class="summary-item-price">$${itemTotal.toFixed(2)}</span>
            `;
        }
        summaryList.appendChild(listItem);

        // Show/setup quantity toggle for chip-in mode (when highlightChipIn is true)
        const qtyToggle = document.getElementById('checkout-item-quantity-toggle');
        if (qtyToggle && scope.highlightChipIn) {
            qtyToggle.style.display = 'block';
            const qtyValueEl = document.getElementById('checkout-item-qty');
            const qtyHint = document.getElementById('checkout-qty-hint');
            if (qtyValueEl) qtyValueEl.textContent = initialQty;
            if (qtyHint) {
                qtyHint.textContent = initialQty === 0
                    ? 'Quantity 0 = donation only. Increase to also buy.'
                    : `Quantity ${initialQty} — item will be purchased + donation.`;
            }

            // Wire up +/- buttons
            const minusBtn = qtyToggle.querySelector('.checkout-qty-minus');
            const plusBtn = qtyToggle.querySelector('.checkout-qty-plus');

            // Clone to remove old listeners
            if (minusBtn) {
                const newMinus = minusBtn.cloneNode(true);
                minusBtn.parentNode.replaceChild(newMinus, minusBtn);
                newMinus.addEventListener('click', () => {
                    if (currentCheckoutItemQty > 0) {
                        currentCheckoutItemQty--;
                        updateCheckoutItemQtyDisplay(scope);
                    }
                });
            }
            if (plusBtn) {
                const newPlus = plusBtn.cloneNode(true);
                plusBtn.parentNode.replaceChild(newPlus, plusBtn);
                newPlus.addEventListener('click', () => {
                    currentCheckoutItemQty++;
                    updateCheckoutItemQtyDisplay(scope);
                });
            }
        } else if (qtyToggle) {
            qtyToggle.style.display = 'none';
        }
    } else {
    // Plan mode (original behavior): show all locked items
    // Hide quantity toggle in plan mode
    const qtyToggle = document.getElementById('checkout-item-quantity-toggle');
    if (qtyToggle) qtyToggle.style.display = 'none';
    currentCheckoutItemQty = 0;

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

        // Per-item scheduling line (date / time / duration)
        const scheduleStr = formatItemSchedule(itemInfo);
        const scheduleHtml = scheduleStr
            ? `<small class="checkout-summary-schedule"><span class="schedule-icon">🕐</span> ${scheduleStr}</small>`
            : '';

        // Build option detail lines
        let optionDetailsHtml = '';
        const optionGroups = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        if (optionGroups && optionGroups.length > 0) {
            const optionLines = [];
            if (itemInfo.selections && Object.keys(itemInfo.selections).length > 0) {
                const sortedKeys = Object.keys(itemInfo.selections).sort((a, b) => {
                    return (parseInt(a.replace('group', ''), 10) || 0) - (parseInt(b.replace('group', ''), 10) || 0);
                });
                for (const groupKey of sortedKeys) {
                    const optionValue = itemInfo.selections[groupKey];
                    const groupIndexMatch = groupKey.match(/^group(\d+)$/);
                    if (!groupIndexMatch) continue;
                    const groupIndex = parseInt(groupIndexMatch[1], 10);
                    const group = optionGroups[groupIndex];
                    if (!group || !group.options) continue;
                    const optionIndices = Array.isArray(optionValue) ? optionValue : [optionValue];
                    for (const optIdx of optionIndices) {
                        const option = group.options[optIdx];
                        if (!option || !option.name) continue;
                        const groupLabel = group.name && group.name !== 'Options' ? `${group.name}: ` : '';
                        optionLines.push(`${groupLabel}${option.name}`);
                    }
                }
            } else if (itemInfo.selectedOptionIndex != null) {
                const flatOptions = flattenOptionGroups(optionGroups);
                const option = flatOptions[itemInfo.selectedOptionIndex];
                if (option && option.name) {
                    optionLines.push(option.name);
                }
            }
            if (optionLines.length > 0) {
                optionDetailsHtml = optionLines.map(l => `<small class="checkout-option-detail">› ${l}</small>`).join('');
            }
        }

        listItem.innerHTML = `
            <div class="summary-item-details">
                <span class="summary-item-name">${record.fields.Name} (x${itemInfo.quantity || 1})</span>
                ${optionDetailsHtml}
                ${edgeCaseNote}
                ${scheduleHtml}
                ${noteHtml}
            </div>
            <span class="summary-item-price">$${itemTotal.toFixed(2)}</span>
        `;
        summaryList.appendChild(listItem);
    }
    } // end plan mode
    summaryDetailsEl.appendChild(summaryList);

    // Show the per-unit price as reference in chip-in mode with qty=0
    if (scope && scope.highlightChipIn && currentCheckoutItemQty === 0 && scope.price > 0) {
        fullTotalEl.textContent = `$${scope.price.toFixed(2)}`;
        fullTotalEl.dataset.total = 0; // actual charge total is 0 (donation only)
    } else {
        fullTotalEl.textContent = `$${finalTotal.toFixed(2)}`;
        fullTotalEl.dataset.total = finalTotal;
    }
    
    const paymentHistory = state.session.user.paymentHistory || [];
    const amountReceived = state.session.user.amountReceived || 0;

    // In single-item mode, skip payment history display
    if (paymentHistory.length > 0 && !(scope && scope.mode === 'item')) {
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

    if (!(scope && scope.mode === 'item') && currentShopSettings.paymentOptions === 'DepositOrFull' && state.session.user.amountReceived === 0) {
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

    // --- UNIFIED CHECKOUT: Setup Chip In Section ---
    setupCheckoutChipIn(finalTotal);

    // Section ordering: the Chip In flow leads with the Community Fund and shows the
    // "Also purchase this item?" prompt beneath it; other flows keep the default layout.
    applyChipInSectionOrder(scope && scope.highlightChipIn);

    // If scope says to highlight chip-in, pre-expand it
    if (scope && scope.highlightChipIn) {
        const chipInSection = document.getElementById('checkout-chip-in-section');
        if (chipInSection) {
            // Open the accordion so the Community Fund options are visible immediately
            chipInSection.classList.add('expanded');
            const toggleBtn = document.getElementById('checkout-chip-in-toggle');
            if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
            const customBtn = chipInSection.querySelector('[data-chip-in="custom"]');
            const skipBtn = chipInSection.querySelector('[data-chip-in="skip"]');
            if (customBtn && skipBtn) {
                skipBtn.classList.remove('active');
                customBtn.classList.add('active');
                customBtn.click();
            }
        }
        // Load crowdfunding progress from Airtable for this item
        if (scope.itemId && scope.price) {
            loadCrowdfundProgress(scope.itemId, scope.price);
        }
    }

    // --- UNIFIED CHECKOUT: Setup P2P Payment Options ---
    const storePaymentOptions = getStorePaymentOptions();
    const hasP2POptions = storePaymentOptions && Object.keys(storePaymentOptions).length > 0;
    const paymentMethodToggle = document.getElementById('checkout-payment-method-toggle');
    const p2pSection = document.getElementById('checkout-p2p-section');

    if (hasP2POptions) {
        // Render P2P buttons
        const p2pItemName = scope && scope.mode === 'item' ? (scope.itemName || 'Item') : 'Plan Checkout';
        renderCheckoutP2POptions(storePaymentOptions, finalTotal, p2pItemName);
        // Show the payment method toggle
        if (paymentMethodToggle) paymentMethodToggle.style.display = 'block';
        // Ensure P2P section starts hidden (Stripe is default)
        if (p2pSection) p2pSection.style.display = 'none';
        // Setup toggle handlers
        setupPaymentMethodToggle();
    } else {
        // No P2P options - hide toggle and P2P section
        if (paymentMethodToggle) paymentMethodToggle.style.display = 'none';
        if (p2pSection) p2pSection.style.display = 'none';
    }

    // === PERFORMANCE: Show checkout modal immediately with loading state for payment ===
    // The summary is populated synchronously above. Show the modal now so the user
    // sees instant feedback while Stripe loads in the background.
    const paymentForm = document.getElementById('payment-form');
    if (paymentForm) {
        paymentForm.style.display = 'block';
        // Show loading placeholder while Stripe loads
        const stripeLoadingPlaceholder = document.createElement('div');
        stripeLoadingPlaceholder.className = 'stripe-loading-placeholder';
        stripeLoadingPlaceholder.innerHTML = '<div class="loading-spinner"></div><span>Loading payment...</span>';
        stripeLoadingPlaceholder.id = 'stripe-loading-placeholder';
        paymentForm.insertBefore(stripeLoadingPlaceholder, paymentForm.firstChild);
    }

    // Get the appropriate z-index based on presentation state
    const isPresentationActive = document.body.classList.contains('presentation-active');
    const checkoutZIndex = getModalZIndex('checkout');

    checkoutModalOverlay.classList.add('active');
    setTimeout(() => {
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
    }, 0);
    document.body.classList.add('modal-open');

    // Initialize Stripe on demand (lazy load) — now happens after modal is visible
    try {
        if (!window.Stripe) {
            log('Modal', 'Loading Stripe.js dynamically...');
            await loadStripe();
        }
        stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
    } catch (err) {
        console.error("Failed to initialize Stripe:", err);
        // Remove loading placeholder on error
        const placeholder = document.getElementById('stripe-loading-placeholder');
        if (placeholder) placeholder.remove();
        alert(`Could not initialize payment system: ${err.message}.`);
        return;
    }

    // Remove the Stripe loading placeholder now that Stripe is ready
    const stripePlaceholder = document.getElementById('stripe-loading-placeholder');
    if (stripePlaceholder) stripePlaceholder.remove();

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
        currentPaymentIntentId = null;
        currentBaseAmount = 0;
        currentProcessingFee = 0;
        currentChipInAmount = 0;
        currentCheckoutScope = null;
        currentCheckoutItemQty = 0;
        currentCheckoutIsFree = false;
        currentPaymentType = 'card'; // Reset to default
        suppressPaymentTypeChange = false; // Clear any pending suppression
        // Strip the shareable deep-link params now that checkout is closing, so a
        // clean URL remains and a refresh/back won't re-open the checkout modal.
        clearCheckoutUrlState();
        // Reset quantity toggle and crowdfund progress
        const qtyToggle = document.getElementById('checkout-item-quantity-toggle');
        if (qtyToggle) qtyToggle.style.display = 'none';
        const crowdfundProgress = document.getElementById('checkout-crowdfund-progress');
        if (crowdfundProgress) crowdfundProgress.style.display = 'none';
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

export function getCurrentPaymentType() {
    return currentPaymentType;
}

export function getCheckoutChipInContext() {
    return {
        chipInAmount: currentChipInAmount,
        scope: currentCheckoutScope,
        itemQty: currentCheckoutItemQty
    };
}

// True when the checkout is a $0 plan registration (no payment). events.js reads
// this on form submit to branch into the no-payment registration flow.
export function getCheckoutIsFreeRegistration() {
    return currentCheckoutIsFree;
}

// Refresh the live PaymentIntent's metadata with the name + email the customer
// typed, WITHOUT changing the amount (it re-sends the same base amount and
// payment type). The Stripe webhook reads customerEmail/customerName from this
// metadata to send the receipt, so this guarantees a receipt address is on the
// intent before it is confirmed — the email field is usually still empty when
// the intent is first created. Best-effort: returns false on any failure so the
// caller can proceed with the charge regardless.
export async function syncCheckoutCustomerDetails(customerName, customerEmail) {
    if (!currentPaymentIntentId) return false;
    try {
        const res = await fetch('/api/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: Math.round(currentBaseAmount * 100),
                paymentMethodType: currentPaymentType,
                sessionId: state.session?.id || null,
                customerEmail: customerEmail || null,
                customerName: customerName || null,
                paymentIntentId: currentPaymentIntentId,
                discountToken: currentDiscountToken || undefined,
            }),
        });
        return res.ok;
    } catch (e) {
        console.warn('[checkout] Could not sync customer details to PaymentIntent:', e.message);
        return false;
    }
}
