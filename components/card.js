// REPLACE THE ENTIRE CONTENTS of components/card.js
console.log('[MODULE DEBUG] card.js module starting to load...', performance.now().toFixed(2) + 'ms');

import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
// VVV FINAL IMPORT FIX VVV
import { buildGoalBucket, calculateRecommendationScore } from '../availability.js';
// ^^^ END FINAL IMPORT FIX ^^^
import { CONSTANTS } from '../config.js';
import { getRecordPrice, getTempLikes, getEffectiveMinQuantity, calculateDynamicPackagePrice, getPackageDefaultHeadcount } from '../utils.js';
import { log } from '../utils/debug.js';

// Shared SVG constant - avoids re-creating the string for each card/icon update
const HEART_SVG = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>`;

// Helper to generate optimized Cloudinary URLs with responsive sizing
function getOptimizedImageUrl(url, width = 600, quality = 'auto') {
    if (!url || !url.includes('cloudinary')) return url;

    // Extract the upload segment and insert transformations
    const uploadIndex = url.indexOf('/upload/');
    if (uploadIndex === -1) return url;

    // Check if transformations already exist after /upload/
    // Cloudinary URLs with transformations have patterns like: /upload/c_fill,w_600,.../
    const afterUpload = url.slice(uploadIndex + 8);
    const hasExistingTransformations = /^[a-z]_[^/]+/.test(afterUpload);

    if (hasExistingTransformations) {
        // URL already has transformations, return as-is to avoid double-transforming
        return url;
    }

    // Add progressive loading and auto format for better compression
    const transformations = `c_fill,w_${width},q_${quality},f_auto,fl_progressive`;
    return url.slice(0, uploadIndex + 8) + transformations + '/' + url.slice(uploadIndex + 8);
}

// Generate srcset for responsive images at different screen densities and sizes
function generateSrcSet(url, baseWidth = 600) {
    if (!url || !url.includes('cloudinary')) return '';
    
    const sizes = [
        { width: Math.floor(baseWidth * 0.5), descriptor: '400w' },
        { width: baseWidth, descriptor: '600w' },
        { width: Math.floor(baseWidth * 1.5), descriptor: '900w' },
        { width: baseWidth * 2, descriptor: '1200w' }
    ];
    
    return sizes.map(({ width, descriptor }) => {
        const optimized = getOptimizedImageUrl(url, width);
        return `${optimized} ${descriptor}`;
    }).join(', ');
}

// Generate low-quality placeholder for blur-up effect
function getLowQualityPlaceholder(url) {
    if (!url || !url.includes('cloudinary')) return url;

    const uploadIndex = url.indexOf('/upload/');
    if (uploadIndex === -1) return url;

    // Check if transformations already exist after /upload/
    const afterUpload = url.slice(uploadIndex + 8);
    const hasExistingTransformations = /^[a-z]_[^/]+/.test(afterUpload);

    if (hasExistingTransformations) {
        // URL already has transformations - prepend blur transformations before existing ones
        const transformations = 'c_fill,w_50,q_30,f_auto,e_blur:300';
        return url.slice(0, uploadIndex + 8) + transformations + '/' + url.slice(uploadIndex + 8);
    }

    const transformations = 'c_fill,w_50,q_30,f_auto,e_blur:300';
    return url.slice(0, uploadIndex + 8) + transformations + '/' + url.slice(uploadIndex + 8);
}

// --- THIS IS THE FIX ---
// Added "export" so other modules (like modal.js) can use it
export function getPlaceholderImage(imageUrls) {
// --- END THE FIX ---
    if (!imageUrls || imageUrls.length === 0) {
        return `https://res.cloudinary.com/${CONSTANTS.CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520,f_auto,q_auto/ww71meppejsewxsxr4x7.jpg`;
    }
    const randomIndex = Math.floor(Math.random() * imageUrls.length);
    return getOptimizedImageUrl(imageUrls[randomIndex], 600);
}

// Export helper functions for use in other modules
export { getOptimizedImageUrl, generateSrcSet };

export function updateCardIcon(recordId) {
    let isLiked = false;

    if (state.session.user.isAuthenticated) {
        isLiked = state.session.user.likedItemIds.has(recordId);
    } else {
        isLiked = getTempLikes().has(recordId);
    }

    const elements = document.querySelectorAll(`.event-card[data-record-id="${recordId}"] .heart-icon, #modal-heart-btn[data-record-id="${recordId}"]`);

    elements.forEach(icon => {
        if (!icon) return;

        if (isLiked) {
            icon.className = 'heart-icon hearted';
            icon.title = 'Unlike this item';
            icon.setAttribute('aria-label', 'Unlike this item');
            icon.innerHTML = HEART_SVG;
            icon.style.display = 'block';
            icon.style.pointerEvents = 'auto';
        } else {
            icon.className = 'heart-icon';
            icon.title = 'Like this item';
            icon.setAttribute('aria-label', 'Like this item');
            icon.innerHTML = HEART_SVG;
            icon.style.display = 'block';
            icon.style.pointerEvents = 'auto';
        }
    });
}

export function batchUpdateCardIcons(recordIds) {
    const likedItems = state.session.user.isAuthenticated 
        ? state.session.user.likedItemIds
        : getTempLikes();

    recordIds.forEach(recordId => {
        const isLiked = likedItems.has(recordId);
        const elements = document.querySelectorAll(`.event-card[data-record-id="${recordId}"] .heart-icon, #modal-heart-btn[data-record-id="${recordId}"]`);

        elements.forEach(icon => {
            if (!icon) return;

            icon.className = isLiked ? 'heart-icon hearted' : 'heart-icon';
            icon.title = isLiked ? 'Unlike this item' : 'Like this item';
            icon.setAttribute('aria-label', isLiked ? 'Unlike this item' : 'Like this item');
            icon.innerHTML = HEART_SVG;
            icon.style.display = 'block';
            icon.style.pointerEvents = 'auto';
        });
    });
}

export function updateCardButtonText(recordId, isLocked) {
    const cardButtons = document.querySelectorAll(`.event-card[data-record-id="${recordId}"] .add-to-plan-btn`);
    const modalButton = document.getElementById('modal-add-to-plan-btn');
    
    cardButtons.forEach(btn => {
        if (btn) {
            btn.textContent = isLocked ? 'Update Plan' : 'Add to Plan';
            btn.disabled = isLocked;
            btn.dataset.tooltip = isLocked ? 'Update plan with changes' : 'Add to plan';
        }
    });
    
    const modalOverlay = document.getElementById('detail-modal-overlay');
    if (modalButton && modalOverlay?.dataset.recordId === recordId) {
        modalButton.textContent = isLocked ? 'Update Plan' : 'Add to Plan';
        modalButton.dataset.tooltip = isLocked ? 'Update plan with changes' : 'Add to plan';
    }
}

export async function createInteractiveCard(record, allRecords, imageCache) {
    log('Card', `Creating card for "${record.fields.Name}"`);

    const eventCard = document.createElement('div');
    eventCard.dataset.recordId = record.id;
    const fields = record.fields;

    // --- ADD THIS "PARTNER" BADGE LOGIC ---
    let partnerBadge = '';
    if (fields.ServiceType === 'Partner Activity') {
        partnerBadge = '<span class="partner-badge">Partner</span>';
    }
    // --- END NEW LOGIC ---

    // --- AI-SOURCED CARD DETECTION ---
    const isAISourced = record.id.startsWith('custom-') ||
                        record.id.startsWith('ai-search-') ||
                        record.id.startsWith('ai-group-') ||
                        record.id.startsWith('ai-child-');
    const isAIGrouping = record.id.startsWith('ai-group-');

    // Build AI badge HTML
    let aiDiscoveryBadge = '';
    if (isAISourced) {
        if (isAIGrouping) {
            aiDiscoveryBadge = '<span class="ai-grouping-badge">AI Suggestions</span>';
        } else {
            aiDiscoveryBadge = '<span class="ai-discovery-badge">AI Discovery</span>';
        }
    }
    // --- END AI-SOURCED CARD DETECTION ---

    // --- VVV SCORE LOGIC REMOVED VVV ---
    // The scoreBanner variable is now always empty
    const scoreBanner = '';
    // --- ^^^ END SCORE LOGIC REMOVAL ^^^

    // --- This block handles image loading for all items ---
    // AI-sourced items now go through the multi-tier fallback (website scrape -> catalog -> placeholder)
    let imageUrlToLoad;
    let imageLoadingStatusOverlay = '';

    if (isAISourced) {
        // For AI items, show loading status indicator while fetching
        imageLoadingStatusOverlay = `<div class="image-loading-status" data-record-id="${record.id}">
            <div class="loading-spinner"></div>
            <span class="status-text">Loading image...</span>
        </div>`;
    }

    // Fetch images for all items (AI items will now go through website scraping)
    const { imageUrls, status } = await api.fetchImagesForRecord(record, allRecords, imageCache);
    imageUrlToLoad = getPlaceholderImage(imageUrls);
    // --- END BLOCK ---

    if (fields['Item Type'] === 'Grouping') {
        const groupingCard = eventCard;
        // Apply AI-sourced styling if this is an AI-generated grouping
        const aiGroupingClass = isAISourced ? ' ai-sourced-card ai-grouping-card' : '';
        groupingCard.className = 'event-card grouping-card' + aiGroupingClass;
        groupingCard.dataset.categoryName = fields.Name;
        const groupingNameForFilter = fields.Name.toLowerCase().replace(/\s+/g, ' ');
        const childItems = allRecords.filter(r => {
            if (r.fields['Item Type'] !== 'Bookable Item' && r.fields['Item Type'] !== 'Event') return false;
            const itemCategories = (r.fields.Categories || '')
                .split(',')
                .map(cat => cat.trim().toLowerCase().replace(/\s+/g, ' '));
            return itemCategories.includes(groupingNameForFilter);
        });

        const imagePromises = childItems.slice(0, 4).map(item => api.fetchImagesForRecord(item, allRecords, new Map()));
        const imageResults = await Promise.all(imagePromises);
        const collageImages = imageResults.flatMap(res => res.imageUrls);

        let imageContainerHTML = `<div class="event-card-image-container collage-container">`;
        if (collageImages.length > 0) {
            const optimizedImages = collageImages.slice(0, 4).map(url => getOptimizedImageUrl(url, 300));
            imageContainerHTML += optimizedImages.map(url => {
                const placeholder = getLowQualityPlaceholder(url);
                return `<div class="collage-image lazy-load" style="background-image: url('${placeholder}')" data-bg-image="${url}"></div>`;
            }).join('');
        } else {
            const placeholder = getLowQualityPlaceholder(imageUrlToLoad);
            imageContainerHTML += `<div class="collage-image lazy-load" style="background-image: url('${placeholder}')" data-bg-image="${imageUrlToLoad}"></div>`;
        }
        imageContainerHTML += `<button class="heart-icon" data-record-id="${record.id}" aria-label="Like this item" tabindex="0"></button>`;
        imageContainerHTML += `<button class="availability-btn" title="Select a date range to check availability" aria-label="Check availability">📅</button>`;
        // Add AI badge to grouping cards
        if (isAISourced) {
            imageContainerHTML += aiDiscoveryBadge;
        }
        imageContainerHTML += `</div>`;
        groupingCard.innerHTML = `
            ${imageContainerHTML}
            <div class="event-card-content">
                <h3>${fields.Name || 'Untitled Category'}</h3>
                <p class="description">${fields.Description || ''}</p>
            </div>
            <div class="card-footer">
                <button class="card-action-btn view-options-btn">View Collection (${childItems.length})</button>
            </div>
        `;

        return groupingCard;
    }

    if (fields['Item Type'] === 'Event') {
        // Apply AI-sourced styling if this is an AI-generated event
        const aiEventClass = isAISourced ? ' ai-sourced-card' : '';
        eventCard.className = 'event-card event-type-card' + aiEventClass;
        const eventDate = fields.Date ? new Date(fields.Date + 'T00:00:00') : null;
        const month = eventDate ? eventDate.toLocaleString('default', { month: 'short' }).toUpperCase() : 'TBD';
        const day = eventDate ? eventDate.getDate() : '??';
        const eventTime = fields.Time || '';
        const hasRsvpd = (record.fields.RSVPs || []).includes(state.session.user.id);

        // Check if event has a linked session (is affiliated to a plan)
        const hasLinkedSession = !!(fields.LinkedSession && fields.LinkedSession.length > 0);

        // Check if user has publish permission
        const userHasPublishAccess = api.userHasPublishPermission();

        // Determine which buttons to show
        let footerButtonsHTML = '';

        // Regular RSVP button for all events
        const buttonText = hasRsvpd ? "You're Going! ✅" : 'RSVP';
        footerButtonsHTML = `<button class="card-action-btn rsvp-btn" ${hasRsvpd ? 'disabled' : ''}>${buttonText}</button>`;

        // Add edit button for publish access users
        if (userHasPublishAccess) {
            if (hasLinkedSession) {
                // Event already has a linked session - show "Edit Event" button to navigate to it
                footerButtonsHTML += `
                    <button class="card-action-btn edit-event-btn" data-event-id="${record.id}" data-session-id="${fields.LinkedSession[0]}">Edit Event</button>
                `;
            } else {
                // Unaffiliated event - show "Open to Edit" button to create a session
                footerButtonsHTML += `
                    <button class="card-action-btn open-to-edit-btn" data-event-id="${record.id}">Open to Edit</button>
                `;
            }
        }

        const placeholder = getLowQualityPlaceholder(imageUrlToLoad);

        eventCard.innerHTML = `
            <div class="event-card-image-container lazy-load" style="background-image: url('${placeholder}')" data-bg-image="${imageUrlToLoad}">
                <button class="heart-icon" data-record-id="${record.id}" aria-label="Like this event" tabindex="0"></button>
                <button class="availability-btn" title="Select a date range to check availability" aria-label="Check availability">📅</button>
                ${partnerBadge}
                ${aiDiscoveryBadge}
                ${scoreBanner}
            </div>
            <div class="event-card-content">
                <div class="event-date-display">
                    <span class="month">${month}</span>
                    <span class="day">${day}</span>
                    ${eventTime ? `<span class="time">${eventTime}</span>` : ''}
                </div>
                <div class="event-details">
                    <h3>${fields.Name || 'Untitled Event'}</h3>
                    <p class="description">${fields.Description || ''}</p>
                </div>
            </div>
            <div class="card-footer">
                ${footerButtonsHTML}
            </div>
        `;

        return eventCard;
    }

    // === PACKAGE CARD - Special tile for package bundles ===
    if (fields['Item Type'] === 'Package') {
        const packageCard = eventCard;
        packageCard.className = 'event-card package-card';

        // Fetch package contents from linked session (stored in session's Items with Variations field)
        let packageContents = { includedItems: [], addOnItems: [], tiers: [] };
        let packageMetadata = { discount: 0, tiers: [], price: 0, pricingType: null };
        const linkedSessionId = fields['LinkedSession'] ? fields['LinkedSession'][0] : null;

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
                console.warn('[Package] Could not fetch linked session for package', record.id, e);
            }
        }

        // Calculate total included items count
        const includedCount = (packageContents.includedItems || []).length;
        const addOnCount = (packageContents.addOnItems || []).length;

        // Get images from included items for collage
        const includedItemIds = (packageContents.includedItems || []).map(item => item.id || item);
        const includedRecords = includedItemIds.slice(0, 4).map(id =>
            allRecords.find(r => r.id === id)
        ).filter(Boolean);

        const imagePromises = includedRecords.map(item => api.fetchImagesForRecord(item, allRecords, new Map()));
        const imageResults = await Promise.all(imagePromises);
        const collageImages = imageResults.flatMap(res => res.imageUrls);

        // Build image container with collage
        let imageContainerHTML = `<div class="event-card-image-container collage-container package-collage">`;
        if (collageImages.length > 0) {
            const optimizedImages = collageImages.slice(0, 4).map(url => getOptimizedImageUrl(url, 300));
            imageContainerHTML += optimizedImages.map(url => {
                const placeholder = getLowQualityPlaceholder(url);
                return `<div class="collage-image lazy-load" style="background-image: url('${placeholder}')" data-bg-image="${url}"></div>`;
            }).join('');
        } else {
            const placeholder = getLowQualityPlaceholder(imageUrlToLoad);
            imageContainerHTML += `<div class="collage-image lazy-load" style="background-image: url('${placeholder}')" data-bg-image="${imageUrlToLoad}"></div>`;
        }
        imageContainerHTML += `<div class="package-badge">📦 Package</div>`;
        imageContainerHTML += `<button class="heart-icon" data-record-id="${record.id}" aria-label="Like this package" tabindex="0"></button>`;
        imageContainerHTML += `<button class="availability-btn" title="Select a date range to check availability" aria-label="Check availability">📅</button>`;
        imageContainerHTML += `</div>`;

        // DYNAMIC PRICING: Calculate package price from current component item prices
        const defaultHeadcount = getPackageDefaultHeadcount(packageContents, allRecords);
        const dynamicPricing = calculateDynamicPackagePrice(packageContents, packageMetadata, allRecords, defaultHeadcount);

        const discount = parseFloat(packageMetadata.discount || 0);
        const pricingType = fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || packageMetadata.pricingType;

        // Build headcount selector if package has per-guest items
        let headcountSelectorHTML = '';
        if (dynamicPricing.hasPerGuestItems) {
            headcountSelectorHTML = `
                <div class="package-headcount-selector">
                    <label>Guests:</label>
                    <div class="quantity-selector package-quantity">
                        <button type="button" class="quantity-btn minus" aria-label="Decrease guest count">-</button>
                        <input type="number" class="quantity-input package-headcount-input" value="${defaultHeadcount}" min="${defaultHeadcount}" step="1" aria-label="Number of guests">
                        <button type="button" class="quantity-btn plus" aria-label="Increase guest count">+</button>
                    </div>
                </div>
            `;
        }

        // Show savings if there's a discount
        let savingsHTML = '';
        if (discount > 0 && dynamicPricing.discountAmount > 0) {
            savingsHTML = `<span class="package-savings">Save $${dynamicPricing.discountAmount.toFixed(0)} (${discount}% off)</span>`;
        }

        // Build tier options HTML if tiers exist
        let tiersHTML = '';
        const tiers = packageContents.tiers || [];
        if (tiers.length > 0) {
            tiersHTML = `<div class="package-tiers">`;
            tiers.forEach((tier, idx) => {
                const tierPrice = tier.price || dynamicPricing.totalPrice;
                const tierLabel = tier.name || `Tier ${idx + 1}`;
                tiersHTML += `<button class="tier-btn ${idx === 0 ? 'selected' : ''}" data-tier-index="${idx}" data-price="${tierPrice}">${tierLabel} - $${tierPrice.toFixed(0)}</button>`;
            });
            tiersHTML += `</div>`;
        }

        // Format the price display - show per-guest cost when applicable
        const displayPrice = dynamicPricing.hasPerGuestItems
            ? dynamicPricing.totalPrice / defaultHeadcount
            : dynamicPricing.totalPrice;
        const perGuestLabel = dynamicPricing.hasPerGuestItems ? '<span class="pricing-type">/ per guest</span>' : '';
        const priceHTML = displayPrice === 0 ? 'Free' : `$${displayPrice.toFixed(2)} ${perGuestLabel}`;

        // Store package data on the card for dynamic updates
        packageCard.dataset.packageContents = JSON.stringify(packageContents);
        packageCard.dataset.packageMetadata = JSON.stringify(packageMetadata);
        packageCard.dataset.defaultHeadcount = defaultHeadcount;

        packageCard.innerHTML = `
            ${imageContainerHTML}
            <div class="event-card-content">
                <h3>${fields.Name || 'Untitled Package'}</h3>
                <p class="description">${fields.Description || ''}</p>
                <div class="package-summary">
                    <span class="package-item-count">${includedCount} items included</span>
                    ${addOnCount > 0 ? `<span class="package-addon-count">+ ${addOnCount} add-ons available</span>` : ''}
                </div>
            </div>
            <div class="card-footer">
                ${headcountSelectorHTML}
                <div class="price-wrapper">
                    <div class="price package-dynamic-price">${priceHTML}</div>
                    <div class="package-savings-wrapper">${savingsHTML}</div>
                </div>
                ${tiersHTML}
                <button class="card-action-btn add-package-btn" data-record-id="${record.id}">Add Package to Plan</button>
            </div>
        `;

        // Add headcount change handler for dynamic price updates
        if (dynamicPricing.hasPerGuestItems) {
            const headcountInput = packageCard.querySelector('.package-headcount-input');
            const plusBtn = packageCard.querySelector('.package-quantity .plus');
            const minusBtn = packageCard.querySelector('.package-quantity .minus');
            const priceEl = packageCard.querySelector('.package-dynamic-price');
            const savingsEl = packageCard.querySelector('.package-savings-wrapper');

            const updatePackagePrice = () => {
                const currentHeadcount = parseInt(headcountInput.value, 10) || defaultHeadcount;
                const updatedPricing = calculateDynamicPackagePrice(packageContents, packageMetadata, allRecords, currentHeadcount);

                // Update price display - show per-guest cost when applicable
                const updatedDisplayPrice = updatedPricing.hasPerGuestItems
                    ? updatedPricing.totalPrice / currentHeadcount
                    : updatedPricing.totalPrice;
                const newPriceHTML = updatedDisplayPrice === 0 ? 'Free' : `$${updatedDisplayPrice.toFixed(2)} ${perGuestLabel}`;
                priceEl.innerHTML = newPriceHTML;

                // Update savings display
                if (discount > 0 && updatedPricing.discountAmount > 0) {
                    savingsEl.innerHTML = `<span class="package-savings">Save $${updatedPricing.discountAmount.toFixed(0)} (${discount}% off)</span>`;
                } else {
                    savingsEl.innerHTML = '';
                }

                // Store current headcount for when adding to plan
                packageCard.dataset.currentHeadcount = currentHeadcount;
            };

            if (headcountInput) {
                headcountInput.addEventListener('change', updatePackagePrice);
                headcountInput.addEventListener('input', updatePackagePrice);
            }

            if (plusBtn && minusBtn) {
                plusBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const currentValue = parseInt(headcountInput.value, 10) || defaultHeadcount;
                    headcountInput.value = currentValue + 1;
                    updatePackagePrice();
                });

                minusBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const currentValue = parseInt(headcountInput.value, 10) || defaultHeadcount;
                    const minValue = parseInt(headcountInput.min, 10) || 1;
                    if (currentValue > minValue) {
                        headcountInput.value = currentValue - 1;
                        updatePackagePrice();
                    }
                });
            }
        }

        // Add tier selection functionality
        const tierBtns = packageCard.querySelectorAll('.tier-btn');
        tierBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                tierBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                // Update displayed price based on selected tier
                const tierPrice = parseFloat(btn.dataset.price);
                const priceEl = packageCard.querySelector('.package-dynamic-price');
                if (priceEl && tierPrice > 0) {
                    priceEl.innerHTML = `$${tierPrice.toFixed(2)} ${perGuestLabel}`;
                }
            });
        });

        return packageCard;
    }

    // Apply AI-sourced styling if this is an AI-generated bookable item
    const aiBookableClass = isAISourced ? ' ai-sourced-card' : '';
    eventCard.className = 'event-card' + aiBookableClass;
    const itemState = ui.getItemState(record.id);
    const effectiveMin = getEffectiveMinQuantity(record);
    const isLocked = state.cart.lockedItems.has(record.id);
    const quantitySelectorHTML = `<div class="quantity-selector"><button type="button" class="quantity-btn minus" aria-label="Decrease quantity">-</button><input type="number" class="quantity-input" value="${itemState.quantity}" min="${effectiveMin}" step="1" aria-label="Quantity"><button type="button" class="quantity-btn plus" aria-label="Increase quantity">+</button></div>`;
    const displayPrice = getRecordPrice(record, itemState.selectedOptionIndex);
    const pricingType = fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const pricingTypeHTML = pricingType ? `<span class="pricing-type">/ ${pricingType.toLowerCase()}</span>` : '';
    const priceHTML = displayPrice === 0 ? 'Free' : `$${displayPrice.toFixed(2)} ${pricingTypeHTML}`;
    const addToPlanBtnHTML = `<button class="card-action-btn add-to-plan-btn" ${isLocked ? 'disabled' : ''}>${isLocked ? 'Update Plan' : 'Add to Plan'}</button>`;
    const placeholder = getLowQualityPlaceholder(imageUrlToLoad);

    // Build image source indicator for AI items
    let imageSourceIndicator = '';
    if (isAISourced && status) {
        // Determine if the image is verified (from website, curated, etc.) or AI-approximated/generated
        const verifiedSources = ['og:image', 'twitter:image', 'link:image_src', 'website', 'clearbit_logo', 'google_favicon', 'curated', 'media_tags', 'custom_upload'];
        const isVerified = verifiedSources.includes(status);
        const isApproximate = status === 'placeholder' || status === 'ai_approximation';
        const isAIGenerated = status === 'ai_generated' || status === 'mixed_ai_custom';

        if (isVerified) {
            // Show "Verified" badge for images found from real sources
            imageSourceIndicator = `<span class="ai-image-source polished">Verified</span>`;
        } else if (isAIGenerated) {
            // Show "AI Generated" badge with pulse animation for AI-generated images
            imageSourceIndicator = `<span class="ai-image-source approximation">AI Generated</span>`;
        } else if (isApproximate) {
            // Show "AI Approx" badge with pulse animation for AI-approximated images
            imageSourceIndicator = `<span class="ai-image-source approximation">AI Approx</span>`;
        }
    }

    eventCard.innerHTML = `
        <div class="event-card-image-container lazy-load" style="background-image: url('${placeholder}')" data-bg-image="${imageUrlToLoad}">
            <button class="heart-icon" data-record-id="${record.id}" aria-label="Like this item" tabindex="0"></button>
            <button class="availability-btn" title="Select a date range to check availability" aria-label="Check availability">📅</button>
            ${partnerBadge}
            ${aiDiscoveryBadge}
            ${imageSourceIndicator}
            ${scoreBanner}
            </div>
        <div class="event-card-content">
            <h3>${fields.Name || 'Untitled Event'}</h3>
            <p class="description">${fields.Description || ''}</p>
        </div>
        <div class="card-footer">
            <div class="price-wrapper"><div class="price">${priceHTML}</div></div>
            <div class="actions-wrapper">${quantitySelectorHTML}${addToPlanBtnHTML}</div>
        </div>
    `;

    // Quantity buttons are handled via event delegation on the catalog container
    // in ui.js renderRecords() for better performance (avoids per-card listeners)

    return eventCard;
}
