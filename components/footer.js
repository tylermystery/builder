// FILE: components/footer.js
// Single-line store footer component displaying contact, social links, and policies

import { state } from '../state.js';
import { log } from '../utils/debug.js';

/**
 * Parses the "Store Details json" field from a store record
 * @param {Object} activeShop - The active store record
 * @returns {Object|null} Parsed store details or null
 */
function getStoreDetails(activeShop) {
    if (!activeShop || !activeShop.fields) return null;

    const detailsJson = activeShop.fields['Store Details json'];
    if (!detailsJson) {
        log('Footer', 'No Store Details json field found for this store');
        return null;
    }

    try {
        return JSON.parse(detailsJson);
    } catch (e) {
        console.warn('[Footer] Could not parse Store Details json:', e);
        return null;
    }
}

/**
 * Returns a safe, fully qualified store website URL.
 * @param {Object} storeDetails - Parsed store details object
 * @returns {string|null} Website URL or null when unavailable/invalid
 */
function getStoreWebsiteUrl(storeDetails) {
    const rawWebsiteUrl = storeDetails?.businessInfo?.websiteUrl;
    if (!rawWebsiteUrl || typeof rawWebsiteUrl !== 'string') return null;

    const websiteUrl = /^https?:\/\//i.test(rawWebsiteUrl.trim())
        ? rawWebsiteUrl.trim()
        : `https://${rawWebsiteUrl.trim()}`;

    try {
        const parsedUrl = new URL(websiteUrl);
        return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.href : null;
    } catch (error) {
        log('Footer', 'Invalid store website URL');
        return null;
    }
}

/**
 * Generates footer HTML based on store details
 * @param {Object} storeDetails - Parsed store details object
 * @returns {string} HTML string for footer content
 */
function generateFooterHTML(storeDetails) {
    if (!storeDetails || !storeDetails.businessInfo) {
        return '<a href="/crm-login.html">Admin Dashboard</a>';
    }

    const info = storeDetails.businessInfo;
    const footerItems = [];
    const websiteUrl = getStoreWebsiteUrl(storeDetails);

    // Copyright
    if (info.site?.copyright) {
        if (websiteUrl) {
            footerItems.push(`<a href="${websiteUrl}" target="_blank" rel="noopener noreferrer" class="footer-copyright footer-store-link" title="Visit website">${info.site.copyright}</a>`);
        } else {
            footerItems.push(`<span class="footer-copyright">${info.site.copyright}</span>`);
        }
    }

    // Contact info
    if (info.contact?.supportEmail) {
        footerItems.push(`<a href="mailto:${info.contact.supportEmail}" class="footer-contact">Contact</a>`);
    } else if (info.contact?.accountingEmail) {
        footerItems.push(`<a href="mailto:${info.contact.accountingEmail}" class="footer-contact">Contact</a>`);
    }

    if (info.contact?.phone) {
        footerItems.push(`<a href="tel:${info.contact.phone.replace(/[^\d+]/g, '')}" class="footer-phone">${info.contact.phone}</a>`);
    }

    // Social media links
    if (info.socialMedia) {
        if (info.socialMedia.instagram) {
            footerItems.push(`<a href="${info.socialMedia.instagram}" target="_blank" rel="noopener noreferrer" class="footer-social" title="Instagram">Instagram</a>`);
        }
        if (info.socialMedia.facebook) {
            footerItems.push(`<a href="${info.socialMedia.facebook}" target="_blank" rel="noopener noreferrer" class="footer-social" title="Facebook">Facebook</a>`);
        }
        if (info.socialMedia.twitter) {
            footerItems.push(`<a href="${info.socialMedia.twitter}" target="_blank" rel="noopener noreferrer" class="footer-social" title="Twitter">Twitter</a>`);
        }
        if (info.socialMedia.youtube) {
            footerItems.push(`<a href="${info.socialMedia.youtube}" target="_blank" rel="noopener noreferrer" class="footer-social" title="YouTube">YouTube</a>`);
        }
        if (info.socialMedia.tiktok) {
            footerItems.push(`<a href="${info.socialMedia.tiktok}" target="_blank" rel="noopener noreferrer" class="footer-social" title="TikTok">TikTok</a>`);
        }
    }

    // Policy links - check for policies object or individual fields
    const policies = info.policies || {};
    if (policies.refund || info.refundPolicy) {
        const refundUrl = policies.refund || info.refundPolicy;
        footerItems.push(`<a href="${refundUrl}" target="_blank" rel="noopener noreferrer" class="footer-policy">Refund Policy</a>`);
    }
    if (policies.privacy || info.privacyPolicy) {
        const privacyUrl = policies.privacy || info.privacyPolicy;
        footerItems.push(`<a href="${privacyUrl}" target="_blank" rel="noopener noreferrer" class="footer-policy">Privacy Policy</a>`);
    }
    if (policies.terms || info.termsOfService) {
        const termsUrl = policies.terms || info.termsOfService;
        footerItems.push(`<a href="${termsUrl}" target="_blank" rel="noopener noreferrer" class="footer-policy">Terms of Service</a>`);
    }

    // Admin dashboard link (always present)
    footerItems.push('<a href="/crm-login.html" class="footer-admin">Admin</a>');

    return footerItems.join('<span class="footer-separator">|</span>');
}

/**
 * Updates the hamburger menu website link based on store details
 * @param {Object} storeDetails - Parsed store details object
 */
function updateHamburgerMenuWebsiteLink(storeDetails) {
    const websiteLink = document.getElementById('menu-website-link');

    if (!websiteLink) {
        log('Footer', 'Hamburger menu website element not found');
        return;
    }

    const websiteUrl = getStoreWebsiteUrl(storeDetails);

    if (websiteUrl) {
        websiteLink.href = websiteUrl;
        websiteLink.style.display = 'flex';
        log('Footer', `Hamburger menu website link updated: ${websiteUrl}`);
    } else {
        websiteLink.style.display = 'none';
        log('Footer', 'No website URL found, hiding hamburger menu link');
    }
}

/**
 * Updates the footer element with store information
 * @param {Object} activeShop - The active store record (optional, will use state if not provided)
 */
export function updateFooter(activeShop = null) {
    const footerElement = document.querySelector('.footer-link');
    if (!footerElement) {
        log('Footer', 'Footer element not found');
        return;
    }

    // Use provided shop or get from state
    const shop = activeShop || state.stores.all.find(s => s.id === state.ui.activeShopId);

    if (!shop) {
        log('Footer', 'No active shop found');
        return;
    }

    const storeDetails = getStoreDetails(shop);
    const footerHTML = generateFooterHTML(storeDetails);

    footerElement.innerHTML = footerHTML;

    // Update the hamburger menu website link dynamically
    updateHamburgerMenuWebsiteLink(storeDetails);

    log('Footer', `Footer updated for store: ${shop.fields?.Name || 'Unknown'}`);
}

/**
 * Initializes the footer component
 */
export function initializeFooter() {
    // Footer will be updated when the active shop is set
    log('Footer', 'Footer component initialized');
}
