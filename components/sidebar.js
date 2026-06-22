// REPLACE THE ENTIRE CONTENTS of components/sidebar.js

import { state, getRecordById } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from '../config.js';
import { calculateMissingCategories, buildGoalBucket } from '../availability.js';
import { calculateRecommendationScore } from '../availability.js';
import { parseOptions, getRecordPrice, getEffectiveMinQuantity, flattenOptionGroups, getShopUrlParam } from '../utils.js';
import { log } from '../utils/debug.js';
import * as backgroundEngine from './backgroundEngine.js';
import { showReceiptModal } from './receipt.js';
import { syncPlanState, registerSyncCallback, updateMobileSummaryBar } from '../utils/planStateSync.js';
import { applyCloudinaryTransform, hasCloudinaryTransformations } from '../utils/imageOptimizer.js';


async function createFavoriteCardElement(record, itemInfo, imageCache) {
    const fields = record.fields;
    const itemCard = document.createElement('div');
    itemCard.className = `favorite-item lazy-load`;
    itemCard.dataset.recordId = record.id;

    // This will use the default placeholder for custom items, which is correct
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, imageCache);

    // Optimize background image with proper Cloudinary transformations
    const defaultPlaceholder = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520,f_auto,q_auto/ww71meppejsewxsxr4x7.jpg`;
    const bgImageUrl = imageUrls[0] || defaultPlaceholder;
    itemCard.dataset.bgImage = bgImageUrl.includes('cloudinary')
        ? applyCloudinaryTransform(bgImageUrl, 'c_fill,w_600,h_520,f_auto,q_auto')
        : bgImageUrl;

    // Use selections for price if available, otherwise fall back to selectedOptionIndex
    const priceParam = (itemInfo.selections && Object.keys(itemInfo.selections).length > 0)
        ? itemInfo.selections
        : itemInfo.selectedOptionIndex;

    const price = getRecordPrice(record, priceParam);
    const tooltipContent = `
        <strong>${fields.Name || 'Untitled'}</strong><br>
        <small>${fields.Description || 'No description.'}</small><br>
        <strong>Price: $${price.toFixed(2)}</strong>
    `;
    itemCard.innerHTML = `
        <div class="card-actions">
            <button class="action-btn add-to-plan-btn" title="Add to Plan">+</button>
            <button class="action-btn remove-btn" title="Remove">×</button>
        </div>
        <div class="favorite-item-overlay"
            data-tippy-content="${tooltipContent.replace(/"/g, '&quot;')}"
        >
            <span class="favorite-item-name">${fields.Name || 'Untitled'}</span>
        </div>
    `;
    if (window.tippy) {
        tippy(itemCard.querySelector('.favorite-item-overlay'), {
            content: tooltipContent,
            allowHTML: true,
            placement: 'top',
            theme: 'light',
        });
    }
    return itemCard;
}


// --- 1. THIS FUNCTION IS REPLACED ---\
// It now receives the *full record* instead of just the ID
// It also fixes the 404 error for the partner icon
async function createLockedInItemElement(record, itemInfo) {
    const fields = record.fields;

    // === DIG INFO DEBUG START ===
    console.log('[DIG-INFO DEBUG] createLockedInItemElement called for:', {
        recordId: record.id,
        recordName: fields?.Name,
        isSolutionFlag: record.isSolution,
        startsWithSolution: record.id.startsWith('solution-'),
        hasResearchData: !!record._researchData,
        researchConfidence: record._researchData?.confidence,
        recordKeys: Object.keys(record)
    });
    // === DIG INFO DEBUG END ===

    // Determine if this is a custom/AI-generated item (affects price display and image sourcing)
    const isCustomItem = record.id.startsWith('custom-') ||
                         record.id.startsWith('ai-search-') ||
                         record.id.startsWith('ai-child-') ||
                         record.id.startsWith('ai-presentation-');

    // Check if this is a solution item (AI-generated from concept) or a manually added item
    // Manual items (manual-add-*, manual-presentation-*) are also researchable - they are user concepts
    // AI items (ai-child-*, ai-presentation-*, ai-search-*) are also researchable
    const isSolutionItem = record.id.startsWith('solution-') || record.isSolution === true;
    const isManualItem = record.id.startsWith('manual-add-') ||
                         record.id.startsWith('manual-presentation-') ||
                         record.isManual === true;
    const isAIItem = record.id.startsWith('ai-child-') ||
                     record.id.startsWith('ai-presentation-') ||
                     record.id.startsWith('ai-search-');
    const isResearchableItem = isSolutionItem || isManualItem || isAIItem;

    // === DIG INFO DEBUG START ===
    console.log('[DIG-INFO DEBUG] Solution item check:', {
        recordId: record.id,
        isSolutionItem: isSolutionItem,
        isManualItem: isManualItem,
        isAIItem: isAIItem,
        isResearchableItem: isResearchableItem,
        checkResult1_startsWithSolution: record.id.startsWith('solution-'),
        checkResult2_isSolutionTrue: record.isSolution === true,
        checkResult3_startsWithManualAdd: record.id.startsWith('manual-add-'),
        checkResult4_startsWithManualPresentation: record.id.startsWith('manual-presentation-'),
        checkResult5_isManualTrue: record.isManual === true,
        checkResult6_startsWithAiChild: record.id.startsWith('ai-child-'),
        checkResult7_startsWithAiPresentation: record.id.startsWith('ai-presentation-'),
        checkResult8_startsWithAiSearch: record.id.startsWith('ai-search-')
    });
    // === DIG INFO DEBUG END ===

    // Fetch images for all items (including AI-parsed and custom items)
    // The fetchImagesForRecord function now handles multi-tier image sourcing
    let imageUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_60,h_60/ww71meppejsewxsxr4x7.jpg`;
    try {
        const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
        if (imageUrls && imageUrls.length > 0) {
            // Use the selectedImageIndex from itemInfo if set, otherwise default to first image
            const selectedIndex = itemInfo?.selectedImageIndex ?? 0;
            const validIndex = Math.min(selectedIndex, imageUrls.length - 1);
            const url = imageUrls[validIndex];
            const uploadIndex = url.indexOf('/upload/');
            if (uploadIndex !== -1) {
                const afterUpload = url.slice(uploadIndex + 8);
                const hasExistingTransformations = /^[a-z]_[^/]+/.test(afterUpload);
                if (hasExistingTransformations) {
                    // URL already has transformations - prepend thumbnail size
                    imageUrl = url.slice(0, uploadIndex + 8) + 'c_fill,g_auto,w_60,h_60/' + url.slice(uploadIndex + 8);
                } else {
                    imageUrl = url.replace('/upload/', '/upload/c_fill,g_auto,w_60,h_60/');
                }
            } else {
                imageUrl = url;
            }
        }
    } catch (e) {
        console.warn('Failed to fetch image for locked item:', record.id, e);
    }

    const itemElement = document.createElement('div');
    itemElement.className = 'locked-item-card';
    itemElement.dataset.recordId = record.id;

    // Build selected options display with group names and price effects
    let optionDetailsHtml = '';
    const optionGroups = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);

    if (itemInfo.selections && Object.keys(itemInfo.selections).length > 0) {
        const sortedKeys = Object.keys(itemInfo.selections).sort((a, b) => {
            const indexA = parseInt(a.replace('group', ''), 10) || 0;
            const indexB = parseInt(b.replace('group', ''), 10) || 0;
            return indexA - indexB;
        });

        const optionLines = [];
        for (const groupKey of sortedKeys) {
            const optionValue = itemInfo.selections[groupKey];
            const groupIndexMatch = groupKey.match(/^group(\d+)$/);
            if (!groupIndexMatch) continue;

            const groupIndex = parseInt(groupIndexMatch[1], 10);
            const group = optionGroups[groupIndex];
            if (!group || !group.options) continue;

            const optionIndices = Array.isArray(optionValue) ? optionValue : [optionValue];

            for (const optionIndex of optionIndices) {
                const option = group.options[optionIndex];
                if (!option || !option.name) continue;

                const groupLabel = group.name && group.name !== 'Options' ? `${group.name}: ` : '';
                optionLines.push(`<span class="option-detail-line">${groupLabel}<strong>${option.name}</strong></span>`);
            }
        }
        if (optionLines.length > 0) {
            optionDetailsHtml = optionLines.join('<br>');
        }
    } else if (itemInfo.selectedOptionIndex != null) {
        const flatOptions = flattenOptionGroups(optionGroups);
        const option = flatOptions[itemInfo.selectedOptionIndex];
        if (option && option.name) {
            optionDetailsHtml = `<span class="option-detail-line"><strong>${option.name}</strong></span>`;
        }
    }

    // Use selections for price if available, otherwise fall back to selectedOptionIndex
    const priceParam = (itemInfo.selections && Object.keys(itemInfo.selections).length > 0)
        ? itemInfo.selections
        : itemInfo.selectedOptionIndex;

    let price = itemInfo.overridePrice ?? getRecordPrice(record, priceParam);
    const originalPrice = price; // Store original price for discount display

    // Apply package discount if this item came from a package
    let packageDiscount = 0;
    let packageName = null;
    if (itemInfo.packageId && state.session.activePackages) {
        const packageInfo = state.session.activePackages.get(itemInfo.packageId);
        if (packageInfo && packageInfo.discount > 0) {
            packageDiscount = packageInfo.discount;
            packageName = packageInfo.name;
            price = price * (1 - packageDiscount / 100);
        }
    }

    const total = (price || 0) * (itemInfo.quantity || 1);
    let priceDisplay = `$${(price || 0).toFixed(2)}`;

    if (isCustomItem && itemInfo.overridePrice == null && price > 0) {
        priceDisplay = `$${price.toFixed(2)} (Est.)`;
    }

    if (itemInfo.overridePrice != null) {
        let prevOriginalPrice = getRecordPrice(record, priceParam);
        priceDisplay = `$${price.toFixed(2)} <em class="price-original">(was $${prevOriginalPrice.toFixed(2)})</em>`;
    } else if (packageDiscount > 0) {
        // Show package discount savings
        priceDisplay = `$${price.toFixed(2)} <span class="package-discount-indicator" data-tippy-content="${packageDiscount}% package discount from ${packageName}">(${packageDiscount}% off)</span>`;
    }

    // Calculate effective minimum and add warning if applicable
    const effectiveMin = getEffectiveMinQuantity(record);
    const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    let quantityDisplay = `Qty ${itemInfo.quantity || 1}`;

    // Check if UMW is in plan
    let isUmwInPlan = false;
    for (const [id] of state.cart.lockedItems) {
        const lockedRecord = getRecordById(id);
        if (lockedRecord && lockedRecord.fields.Name && lockedRecord.fields.Name.includes("Union Machine Works")) {
            isUmwInPlan = true;
            break;
        }
    }

    // Add warning/note for edge cases
    if (airtableMin > 1) {
        if (!isUmwInPlan && itemInfo.quantity === effectiveMin) {
            // Off-site at minimum: show asterisk with tooltip
            quantityDisplay += ` <span class="min-qty-warning" data-tippy-content="Minimum of ${effectiveMin} required for off-site events.<br><strong>Host at Union Machine Works to waive.</strong>">*</span>`;
        } else if (isUmwInPlan && itemInfo.quantity < airtableMin) {
            // On-site below minimum: show check mark with tooltip
            quantityDisplay += ` <span class="umw-benefit-indicator" data-tippy-content="Below standard minimum of ${airtableMin}<br><strong>Allowed due to Union Machine Works venue</strong>" style="color: #28a745; font-weight: bold; cursor: help; margin-left: 2px;">✓</span>`;
        }
    }

    // Check if this solution has been researched (has research data with confidence)
    const hasResearchData = isResearchableItem && record._researchData?.confidence != null;
    const confidenceScore = hasResearchData ? Math.round(record._researchData.confidence * 100) : null;
    const confidenceLevel = confidenceScore >= 80 ? 'high' : confidenceScore >= 50 ? 'medium' : 'low';
    const confidenceColors = { high: '#28a745', medium: '#ffc107', low: '#6c757d' };

    // === DIG INFO DEBUG START ===
    console.log('[DIG-INFO DEBUG] Research data check:', {
        recordId: record.id,
        isSolutionItem: isSolutionItem,
        isManualItem: isManualItem,
        isResearchableItem: isResearchableItem,
        hasResearchData: hasResearchData,
        confidenceRaw: record._researchData?.confidence,
        confidenceScore: confidenceScore,
        confidenceLevel: confidenceLevel
    });
    // === DIG INFO DEBUG END ===

    // Build the AI solution indicator and dig button for researchable items (solutions and manual items)
    let solutionBadgeHtml = '';
    if (isResearchableItem) {
        // === DIG INFO DEBUG START ===
        console.log('[DIG-INFO DEBUG] Entering isResearchableItem block, hasResearchData:', hasResearchData);
        // === DIG INFO DEBUG END ===
        if (hasResearchData) {
            // Show accuracy score badge for researched items
            // === DIG INFO DEBUG START ===
            console.log('[DIG-INFO DEBUG] Rendering accuracy badge for researched item:', record.id);
            // === DIG INFO DEBUG END ===
            solutionBadgeHtml = `
                <span class="solution-accuracy-badge"
                      style="display: inline-flex; align-items: center; gap: 4px; background: ${confidenceColors[confidenceLevel]}20; color: ${confidenceColors[confidenceLevel]}; padding: 2px 6px; border-radius: 10px; font-size: 0.7em; margin-left: 6px; border: 1px solid ${confidenceColors[confidenceLevel]}40;"
                      data-tippy-content="AI research accuracy: ${confidenceScore}%<br><em>${record._researchData.confidenceNotes || 'Based on AI research'}</em>">
                    <span style="font-size: 0.9em;">&#x2714;</span> ${confidenceScore}%
                </span>`;
        } else {
            // Show dig/research button for unresearched items
            // === DIG INFO DEBUG START ===
            console.log('[DIG-INFO DEBUG] Rendering Dig Info button for unresearched item:', record.id);
            // === DIG INFO DEBUG END ===
            solutionBadgeHtml = `
                <button class="dig-solution-btn"
                        data-record-id="${record.id}"
                        style="display: inline-flex; align-items: center; gap: 3px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 2px 8px; border-radius: 10px; font-size: 0.7em; margin-left: 6px; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;"
                        data-tippy-content="Click to research this item and get detailed information with accuracy score">
                    <span style="font-size: 1em;">&#x1F50D;</span> Dig Info
                </button>`;
        }
        // === DIG INFO DEBUG START ===
        console.log('[DIG-INFO DEBUG] solutionBadgeHtml generated:',
            'recordId=' + record.id +
            ', htmlLength=' + solutionBadgeHtml.length +
            ', htmlPreview="' + solutionBadgeHtml.substring(0, 150).replace(/\n/g, ' ').replace(/\s+/g, ' ') + '..."');
        // === DIG INFO DEBUG END ===
    } else {
        // === DIG INFO DEBUG START ===
        console.log('[DIG-INFO DEBUG] NOT a researchable item, no badge will be shown:', record.id);
        // === DIG INFO DEBUG END ===
    }

    itemElement.innerHTML = `
        <img class="locked-item-thumbnail lazy-load" data-src="${imageUrl}" width="60" height="60" alt="${fields.Name}" loading="lazy">
        <div class="locked-item-details">
            <p class="locked-item-name"><span class="locked-item-name-text">${fields.Name}</span>${solutionBadgeHtml}</p>
            ${optionDetailsHtml ? `<div class="locked-item-options">${optionDetailsHtml}</div>` : ''}
            <p class="locked-item-pricing">${quantityDisplay} @ ${priceDisplay} = <strong>$${total.toFixed(2)}</strong></p>
            ${itemInfo.note ? `<p class="locked-item-note"><em>Note: ${itemInfo.note}</em></p>` : ''}
        </div>
        <div class="locked-item-actions">
            <button class="demote-locked-item-btn" title="Remove from Plan">Unsave</button>
        </div>
    `;

    // === DIG INFO DEBUG START ===
    console.log('[DIG-INFO DEBUG] After setting innerHTML:',
        'recordId=' + record.id +
        ', htmlContainsDigBtn=' + itemElement.innerHTML.includes('dig-solution-btn') +
        ', htmlContainsDigText=' + itemElement.innerHTML.includes('Dig Info') +
        ', itemNameElementText=' + (itemElement.querySelector('.locked-item-name')?.innerHTML?.substring(0, 150) || 'null'));
    // === DIG INFO DEBUG END ===

    // Initialize Tippy tooltip for the warning asterisk if present
    const warningSpan = itemElement.querySelector('.min-qty-warning');
    if (warningSpan && window.tippy) {
        tippy(warningSpan, {
            content: warningSpan.dataset.tippyContent,
            allowHTML: true,
            placement: 'top',
            arrow: true
        });
    }

    // Initialize Tippy tooltip for the UMW benefit indicator if present
    const benefitSpan = itemElement.querySelector('.umw-benefit-indicator');
    if (benefitSpan && window.tippy) {
        tippy(benefitSpan, {
            content: benefitSpan.dataset.tippyContent,
            allowHTML: true,
            placement: 'top',
            arrow: true
        });
    }

    // Initialize Tippy tooltip for the package discount indicator if present
    const packageDiscountSpan = itemElement.querySelector('.package-discount-indicator');
    if (packageDiscountSpan && window.tippy) {
        tippy(packageDiscountSpan, {
            content: packageDiscountSpan.dataset.tippyContent,
            allowHTML: true,
            placement: 'top',
            arrow: true
        });
    }

    // Initialize Tippy tooltip for the dig solution button if present
    const digBtn = itemElement.querySelector('.dig-solution-btn');
    // === DIG INFO DEBUG START ===
    console.log('[DIG-INFO DEBUG] Dig button query result:',
        'recordId=' + record.id +
        ', digBtnFound=' + (!!digBtn) +
        ', digBtnOuterHTML=' + (digBtn ? digBtn.outerHTML.substring(0, 100) : 'null') +
        ', tippyAvailable=' + (!!window.tippy));
    // === DIG INFO DEBUG END ===
    if (digBtn && window.tippy) {
        tippy(digBtn, {
            content: digBtn.dataset.tippyContent,
            allowHTML: true,
            placement: 'top',
            arrow: true
        });
        // === DIG INFO DEBUG START ===
        console.log('[DIG-INFO DEBUG] Tippy initialized for dig button:', record.id);
        // === DIG INFO DEBUG END ===
    }

    // Initialize Tippy tooltip for the accuracy badge if present
    const accuracyBadge = itemElement.querySelector('.solution-accuracy-badge');
    if (accuracyBadge && window.tippy) {
        tippy(accuracyBadge, {
            content: accuracyBadge.dataset.tippyContent,
            allowHTML: true,
            placement: 'top',
            arrow: true
        });
    }

    // === DIG INFO DEBUG START ===
    console.log('[DIG-INFO DEBUG] createLockedInItemElement COMPLETE for:', record.id);
    // === DIG INFO DEBUG END ===

    return itemElement;
}
// --- END REPLACED FUNCTION ---\

// --- VVV NEW SCORE LOGIC VVV ---\

/**
 * [V3.3] Calculates and returns the total recommendation score for the entire locked plan.
 * @returns {number} The total score.
 */
function calculateTotalPlanScore() {
    if (state.cart.lockedItems.size === 0) return 0;

    const sortBy = document.getElementById('sort-by')?.value || 'recommended'; // Assume recommended if checking score
    // The goal bucket is built based on ALL goals and missing pillars.
    const goalBucket = buildGoalBucket(sortBy); 
    
    let totalScore = 0;
    
    for (const recordId of state.cart.lockedItems.keys()) {
        const record = getRecordById(recordId);
        if (record) {
            const score = calculateRecommendationScore(record, goalBucket);
            totalScore += score;
        }
    }
    return totalScore;
}


function updateTotalPlanScoreDisplay(score) {
    const container = document.getElementById('event-health-score'); // Reuse the container
    
    if (!container) return;

    let scoreEl = container.querySelector('.plan-score-display');
    
    if (score > 0) {
        if (!scoreEl) {
             scoreEl = document.createElement('h5');
             scoreEl.className = 'plan-score-display';
             scoreEl.style.cssText = 'margin: 5px 0 0 0; text-align: center; color: #007bff; font-size: 1.2em;';
             // Prepend the score above the health score text
             container.prepend(scoreEl);
        }
        // --- THIS IS THE CHANGE ---\
        scoreEl.innerHTML = `Overall Score: ${score.toFixed(0)} Points<span class='beta-tag-subtle'>Beta</span>`;
        // --- END THE CHANGE ---\
    } else if (scoreEl) {
        // If score is 0 and element exists, remove it or hide it
        scoreEl.remove();
    }
}

// --- 2. THIS FUNCTION IS REPLACED ---
let isUpdatingEventPlan = false;
let pendingEventPlanUpdate = false;
let shareMenuInitialized = false;

/**
 * Positions a dropdown menu to ensure it stays within the viewport
 * @param {HTMLElement} dropdown - The dropdown element to position
 * @param {HTMLElement} button - The button that triggered the dropdown
 */
function positionDropdownWithinViewport(dropdown, button) {
    // Reset any inline positioning first
    dropdown.style.left = '';
    dropdown.style.right = '';
    dropdown.style.transform = '';

    // Get button and dropdown dimensions
    const buttonRect = button.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    // Calculate if dropdown overflows to the right
    const dropdownRightEdge = buttonRect.right;
    const dropdownLeftEdge = dropdownRightEdge - dropdownRect.width;

    // If dropdown would overflow left side of viewport, constrain it
    if (dropdownLeftEdge < 10) {
        // Position from left edge with some padding
        dropdown.style.left = '10px';
        dropdown.style.right = 'auto';
        dropdown.style.position = 'fixed';
        dropdown.style.top = (buttonRect.bottom + 8) + 'px';
    } else {
        // Default: align dropdown's right edge with button's right edge
        dropdown.style.right = '0';
        dropdown.style.left = 'auto';
        dropdown.style.position = 'absolute';
        dropdown.style.top = '';
    }
}

/**
 * Handle sync updates from other views (e.g., presentation, modal)
 * @param {string} changeType - Type of change
 * @param {Object} summary - Current plan summary
 * @param {Object} changeData - Details about the change
 */
async function handleSidebarSyncUpdate(changeType, summary, changeData) {
    console.log('[Sidebar DEBUG] Received sync update:', changeType, changeData);

    switch (changeType) {
        case 'itemAdded':
        case 'itemRemoved':
        case 'itemUpdated':
            // Re-render the event plan section and ideas carousel
            await updateEventPlanSection();
            await updateIdeasCarousel();
            updateTotalCost();
            break;
        case 'dateChanged':
            // Update date display in sidebar
            await ui.updateEventPlanDateDisplay();
            await ui.updateLockedItemStatusIcons();
            break;
        case 'detailsChanged':
            // Update header with new event details
            updateHeader();
            break;
        case 'sessionLoaded':
        case 'fullRefresh':
            // Full refresh
            updateHeader();
            await updateEventPlanSection();
            await updateIdeasCarousel();
            updateTotalCost();
            await ui.updateEventPlanDateDisplay();
            break;
        default:
            console.log('[Sidebar DEBUG] Unknown sync change type:', changeType);
    }
}

/**
 * Initialize sidebar sync with the plan state synchronization system
 */
export function initializeSidebarSync() {
    registerSyncCallback('sidebar', handleSidebarSyncUpdate);
    console.log('[Sidebar DEBUG] Registered sidebar sync callback');
}

/**
 * Initializes the Share menu button event listeners (called once)
 */
export function initializeShareMenu() {
    if (shareMenuInitialized) return;

    const shareMenuBtn = document.getElementById('share-menu-btn');
    const shareMenuDropdown = document.getElementById('share-menu-dropdown');
    const shareCopyLinkBtn = document.getElementById('share-copy-link-btn');
    const shareInviteBtn = document.getElementById('share-invite-btn');
    const sharePublishBtn = document.getElementById('share-publish-btn');
    const shareUpdatePublishedBtn = document.getElementById('share-update-published-btn');

    if (!shareMenuBtn || !shareMenuDropdown) {
        console.warn('[Share Menu] Share menu elements not found');
        return;
    }

    // Toggle dropdown on button click
    shareMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = shareMenuDropdown.style.display === 'block';
        if (isVisible) {
            shareMenuDropdown.style.display = 'none';
        } else {
            shareMenuDropdown.style.display = 'block';
            // Ensure dropdown doesn't overflow the viewport
            positionDropdownWithinViewport(shareMenuDropdown, shareMenuBtn);
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!shareMenuBtn.contains(e.target) && !shareMenuDropdown.contains(e.target)) {
            shareMenuDropdown.style.display = 'none';
            // Reset inline positioning styles when closed
            shareMenuDropdown.style.position = '';
            shareMenuDropdown.style.top = '';
            shareMenuDropdown.style.left = '';
            shareMenuDropdown.style.right = '';
        }
    });

    // Copy Link handler
    if (shareCopyLinkBtn) {
        shareCopyLinkBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(window.location.href).then(() => {
                const originalHTML = shareCopyLinkBtn.innerHTML;
                shareCopyLinkBtn.innerHTML = '<span class="menu-item-icon">&#10003;</span> Copied!';
                setTimeout(() => {
                    shareCopyLinkBtn.innerHTML = originalHTML;
                }, 1500);
            }).catch(err => {
                console.error('Failed to copy link:', err);
            });
            shareMenuDropdown.style.display = 'none';
        });
    }

    // Invite Collaborator handler - opens the invite popup
    if (shareInviteBtn) {
        shareInviteBtn.addEventListener('click', () => {
            shareMenuDropdown.style.display = 'none';
            openInvitePopup();
        });
    }

    // Invite Guest handler - opens the guest invite popup
    const shareInviteGuestBtn = document.getElementById('share-invite-guest-btn');
    if (shareInviteGuestBtn) {
        shareInviteGuestBtn.addEventListener('click', () => {
            shareMenuDropdown.style.display = 'none';
            openInviteGuestPopup();
        });
    }

    // Publish as Public Event handler
    if (sharePublishBtn) {
        sharePublishBtn.addEventListener('click', async () => {
            shareMenuDropdown.style.display = 'none';
            await handlePublishEvent();
        });
    }

    // Update Published Event handler
    if (shareUpdatePublishedBtn) {
        shareUpdatePublishedBtn.addEventListener('click', async () => {
            shareMenuDropdown.style.display = 'none';
            await handlePublishEvent();
        });
    }

    // Publish as Package handler
    const sharePublishPackageBtn = document.getElementById('share-publish-package-btn');
    if (sharePublishPackageBtn) {
        sharePublishPackageBtn.addEventListener('click', async () => {
            shareMenuDropdown.style.display = 'none';
            await handlePublishPackage();
        });
    }

    // Update Package handler
    const shareUpdatePackageBtn = document.getElementById('share-update-package-btn');
    if (shareUpdatePackageBtn) {
        shareUpdatePackageBtn.addEventListener('click', async () => {
            shareMenuDropdown.style.display = 'none';
            await handlePublishPackage();
        });
    }

    // --- NEW SESSION MANAGEMENT BUTTONS ---

    // Save & New handler
    const planSaveNewBtn = document.getElementById('plan-save-new-btn');
    if (planSaveNewBtn) {
        planSaveNewBtn.addEventListener('click', async () => {
            shareMenuDropdown.style.display = 'none';
            await handleSaveAndNew();
        });
    }

    // Delete & New handler
    const planDeleteNewBtn = document.getElementById('plan-delete-new-btn');
    if (planDeleteNewBtn) {
        planDeleteNewBtn.addEventListener('click', async () => {
            shareMenuDropdown.style.display = 'none';
            await handleDeleteAndNew();
        });
    }

    // See Sessions handler
    const planSeeSessionsBtn = document.getElementById('plan-see-sessions-btn');
    if (planSeeSessionsBtn) {
        planSeeSessionsBtn.addEventListener('click', async () => {
            shareMenuDropdown.style.display = 'none';
            await showSessionsModal();
        });
    }

    // Archive Plan handler
    const planArchiveBtn = document.getElementById('plan-archive-btn');
    if (planArchiveBtn) {
        planArchiveBtn.addEventListener('click', async () => {
            shareMenuDropdown.style.display = 'none';
            await handleArchivePlan();
        });
    }

    // Delete Plan handler
    const planDeleteBtn = document.getElementById('plan-delete-btn');
    if (planDeleteBtn) {
        planDeleteBtn.addEventListener('click', async () => {
            shareMenuDropdown.style.display = 'none';
            await handleDeletePlan();
        });
    }

    shareMenuInitialized = true;
    log('Sidebar', 'Share menu initialized');
}

let invitePopupInitialized = false;

/**
 * Opens the invite collaborator popup
 */
function openInvitePopup() {
    const popup = document.getElementById('invite-popup');
    if (!popup) return;

    // Initialize popup event listeners if not done
    initializeInvitePopup();

    // Show the popup
    popup.style.display = 'block';

    // Clear any previous inputs and status
    const emailInput = document.getElementById('collab-email');
    const statusEl = document.getElementById('invite-status');
    const btn = document.getElementById('invite-btn');

    if (emailInput) emailInput.value = '';
    if (statusEl) statusEl.textContent = '';
    if (btn) {
        btn.textContent = 'Send Invite';
        btn.disabled = false;
    }

    // Focus on the email input
    if (emailInput) emailInput.focus();
}

/**
 * Closes the invite collaborator popup
 */
function closeInvitePopup() {
    const popup = document.getElementById('invite-popup');
    if (popup) {
        popup.style.display = 'none';
    }
}

/**
 * Initializes the invite popup event listeners (called once)
 */
function initializeInvitePopup() {
    if (invitePopupInitialized) return;

    const popup = document.getElementById('invite-popup');
    const closeBtn = document.getElementById('invite-popup-close');
    const inviteBtn = document.getElementById('invite-btn');

    if (!popup) return;

    // Close button handler
    if (closeBtn) {
        closeBtn.addEventListener('click', closeInvitePopup);
    }

    // Close when clicking outside the popup (on the container)
    document.addEventListener('click', (e) => {
        if (popup.style.display === 'block' &&
            !popup.contains(e.target) &&
            !document.getElementById('share-invite-btn')?.contains(e.target)) {
            closeInvitePopup();
        }
    });

    // Invite button handler
    if (inviteBtn) {
        inviteBtn.addEventListener('click', async () => {
            await handleInvite();
        });
    }

    // Allow Enter key to submit
    popup.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleInvite();
        }
    });

    invitePopupInitialized = true;
    log('Sidebar', 'Invite popup initialized');
}

let inviteGuestPopupInitialized = false;

/**
 * Opens the invite guest popup
 */
function openInviteGuestPopup() {
    const popup = document.getElementById('invite-guest-popup');
    if (!popup) return;

    // Initialize popup event listeners if not done
    initializeInviteGuestPopup();

    // Show the popup
    popup.style.display = 'block';

    // Clear any previous inputs and status
    const nameInput = document.getElementById('guest-name');
    const emailInput = document.getElementById('guest-email');
    const statusEl = document.getElementById('invite-guest-status');
    const btn = document.getElementById('invite-guest-btn');

    if (nameInput) nameInput.value = '';
    if (emailInput) emailInput.value = '';
    if (statusEl) statusEl.textContent = '';
    if (btn) {
        btn.textContent = 'Send Invitation';
        btn.disabled = false;
    }

    // Focus on the name input
    if (nameInput) nameInput.focus();
}

/**
 * Closes the invite guest popup
 */
function closeInviteGuestPopup() {
    const popup = document.getElementById('invite-guest-popup');
    if (popup) {
        popup.style.display = 'none';
    }
}

/**
 * Initializes the invite guest popup event listeners (called once)
 */
function initializeInviteGuestPopup() {
    if (inviteGuestPopupInitialized) return;

    const popup = document.getElementById('invite-guest-popup');
    const closeBtn = document.getElementById('invite-guest-popup-close');
    const inviteBtn = document.getElementById('invite-guest-btn');

    if (!popup) return;

    // Close button handler
    if (closeBtn) {
        closeBtn.addEventListener('click', closeInviteGuestPopup);
    }

    // Close when clicking outside the popup (on the container)
    document.addEventListener('click', (e) => {
        if (popup.style.display === 'block' &&
            !popup.contains(e.target) &&
            !document.getElementById('share-invite-guest-btn')?.contains(e.target)) {
            closeInviteGuestPopup();
        }
    });

    // Invite button handler
    if (inviteBtn) {
        inviteBtn.addEventListener('click', async () => {
            await handleInviteGuest();
        });
    }

    // Allow Enter key to submit
    popup.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleInviteGuest();
        }
    });

    inviteGuestPopupInitialized = true;
    log('Sidebar', 'Invite guest popup initialized');
}

/**
 * Handles sending a guest invitation (read-only view)
 */
async function handleInviteGuest() {
    const nameInput = document.getElementById('guest-name');
    const emailInput = document.getElementById('guest-email');
    const statusEl = document.getElementById('invite-guest-status');
    const btn = document.getElementById('invite-guest-btn');

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();

    if (!name || !email) {
        statusEl.textContent = "Please enter both name and email.";
        statusEl.style.color = "#dc3545";
        return;
    }

    btn.disabled = true;
    btn.textContent = "Sending...";
    statusEl.textContent = "";

    try {
        // Generate summary HTML for the guest invitation
        let summaryHtml = `
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <thead>
                    <tr style="background-color: #f8f9fa; text-align: left;">
                        <th style="padding: 8px; border-bottom: 2px solid #dee2e6;">Item</th>
                        <th style="padding: 8px; border-bottom: 2px solid #dee2e6; text-align: center;">Qty</th>
                    </tr>
                </thead>
                <tbody>
        `;

        state.cart.lockedItems.forEach((info, id) => {
            const record = getRecordById(id);
            if (record) {
                summaryHtml += `
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${record.fields.Name}</strong></td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${info.quantity || 1}</td>
                    </tr>
                `;
            }
        });
        summaryHtml += '</tbody></table>';

        // Get event details for the invitation
        const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Event';
        const eventDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
        const hostName = state.session.user?.name || "Your host";

        const response = await fetch('/api/invite-guest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: state.session.id,
                guestName: name,
                guestEmail: email,
                hostName: hostName,
                eventName: eventName,
                eventDate: eventDate,
                planSummaryHtml: summaryHtml
            })
        });

        if (response.ok) {
            statusEl.textContent = "Invitation sent!";
            statusEl.style.color = "#28a745";
            nameInput.value = '';
            emailInput.value = '';
            // Close the popup after showing success message
            setTimeout(() => {
                closeInviteGuestPopup();
                statusEl.textContent = "";
                btn.textContent = "Send Invitation";
                btn.disabled = false;
            }, 1500);
        } else {
            const err = await response.json();
            throw new Error(err.error || 'Failed to send');
        }
    } catch (e) {
        console.error(e);
        statusEl.textContent = "Error sending invitation.";
        statusEl.style.color = "#dc3545";
        btn.textContent = "Send Invitation";
        btn.disabled = false;
    }
}

/**
 * Updates the Share menu button visibility and options based on session state
 */
async function updateShareMenuState() {
    const shareMenuBtn = document.getElementById('share-menu-btn');
    const shareMenuDropdown = document.getElementById('share-menu-dropdown');
    const sharePublishBtn = document.getElementById('share-publish-btn');
    const shareUpdatePublishedBtn = document.getElementById('share-update-published-btn');
    const sharePublishPackageBtn = document.getElementById('share-publish-package-btn');
    const shareUpdatePackageBtn = document.getElementById('share-update-package-btn');
    const publishDivider = shareMenuDropdown?.querySelector('.publish-divider');
    const publishSectionLabel = shareMenuDropdown?.querySelector('.publish-section-label');

    if (!shareMenuBtn) return;

    // Show the share button only if we have an active session
    if (!state.session.id) {
        shareMenuBtn.style.display = 'none';
        return;
    }

    // Show the share button
    shareMenuBtn.style.display = 'flex';

    // Initialize the menu if not already done
    initializeShareMenu();

    // Check publish permissions
    const activeStore = state.stores.all.find(s => s.id === state.ui.activeShopId);
    const currentUser = state.session.user;
    let hasPublishPermission = false;

    if (activeStore && currentUser) {
        const allowedUsers = activeStore.fields.PublishPermission || [];
        hasPublishPermission = allowedUsers.includes(currentUser.id);
    }

    // Update publish/update buttons visibility based on permissions
    if (!hasPublishPermission) {
        if (sharePublishBtn) sharePublishBtn.style.display = 'none';
        if (shareUpdatePublishedBtn) shareUpdatePublishedBtn.style.display = 'none';
        if (sharePublishPackageBtn) sharePublishPackageBtn.style.display = 'none';
        if (shareUpdatePackageBtn) shareUpdatePackageBtn.style.display = 'none';
        if (publishDivider) publishDivider.style.display = 'none';
        if (publishSectionLabel) publishSectionLabel.style.display = 'none';
        return;
    }

    // Show the publish divider and label since we have publish permissions
    if (publishDivider) publishDivider.style.display = 'block';
    if (publishSectionLabel) publishSectionLabel.style.display = 'block';

    try {
        const session = await api.fetchSessionById(state.session.id);
        if (!session) return;

        // Check if this session is linked to a published event
        const linkedItemId = session.fields.LinkedItem ? session.fields.LinkedItem[0] : null;
        // Check if this session is linked to a published package
        const linkedPackageId = session.fields.LinkedPackage ? session.fields.LinkedPackage[0] : null;

        // Handle event publish/update buttons
        if (linkedItemId) {
            // Session is published as event - show update button, hide publish button
            if (sharePublishBtn) sharePublishBtn.style.display = 'none';
            if (shareUpdatePublishedBtn) {
                shareUpdatePublishedBtn.style.display = 'flex';

                // Update RSVP stats in dropdown if event is published
                const linkedItem = getRecordById(linkedItemId);
                if (linkedItem) {
                    updateShareMenuRsvpStats(linkedItem);
                }
            }
        } else {
            // Session is not published as event - show publish button, hide update button
            if (sharePublishBtn) sharePublishBtn.style.display = 'flex';
            if (shareUpdatePublishedBtn) shareUpdatePublishedBtn.style.display = 'none';

            // Remove any RSVP stats section
            const existingRsvpStats = shareMenuDropdown?.querySelector('.share-rsvp-stats');
            if (existingRsvpStats) existingRsvpStats.remove();
        }

        // Handle package publish/update buttons
        if (linkedPackageId) {
            // Session is published as package - show update button, hide publish button
            if (sharePublishPackageBtn) sharePublishPackageBtn.style.display = 'none';
            if (shareUpdatePackageBtn) shareUpdatePackageBtn.style.display = 'flex';
        } else {
            // Session is not published as package - show publish button if has items, hide update button
            if (sharePublishPackageBtn) {
                // Only show if session has locked items
                sharePublishPackageBtn.style.display = state.cart.lockedItems.size > 0 ? 'flex' : 'none';
            }
            if (shareUpdatePackageBtn) shareUpdatePackageBtn.style.display = 'none';
        }

        log('Sidebar', 'Share menu state updated');
    } catch (error) {
        console.error('Error updating share menu state:', error);
    }
}

/**
 * Updates the RSVP statistics display in the share dropdown
 */
function updateShareMenuRsvpStats(linkedItem) {
    const shareMenuDropdown = document.getElementById('share-menu-dropdown');
    if (!shareMenuDropdown || !linkedItem) return;

    const rsvpYes = linkedItem.fields.RSVPs ? linkedItem.fields.RSVPs.length : 0;
    const rsvpMaybe = linkedItem.fields.RSVPMaybe ? linkedItem.fields.RSVPMaybe.length : 0;
    const rsvpNo = linkedItem.fields.RSVPNo ? linkedItem.fields.RSVPNo.length : 0;

    // Remove existing RSVP stats if present
    const existingRsvpStats = shareMenuDropdown.querySelector('.share-rsvp-stats');
    if (existingRsvpStats) existingRsvpStats.remove();

    // Create new RSVP stats section
    const rsvpStatsHTML = `
        <div class="share-rsvp-stats">
            <h5>RSVP Statistics</h5>
            <div class="share-rsvp-row">
                <div class="share-rsvp-item">
                    <span class="share-rsvp-count going">${rsvpYes}</span>
                    <span class="share-rsvp-label">Going</span>
                </div>
                <div class="share-rsvp-item">
                    <span class="share-rsvp-count maybe">${rsvpMaybe}</span>
                    <span class="share-rsvp-label">Maybe</span>
                </div>
                <div class="share-rsvp-item">
                    <span class="share-rsvp-count no">${rsvpNo}</span>
                    <span class="share-rsvp-label">Can't Go</span>
                </div>
            </div>
        </div>
    `;

    // Insert at the beginning of the dropdown
    shareMenuDropdown.insertAdjacentHTML('afterbegin', rsvpStatsHTML);
}

/**
 * Legacy function - now updates the share menu instead of creating inline controls
 * Keeping the name for backwards compatibility with existing calls
 */
async function updateSessionPublishingControls() {
    // Remove any legacy publishing controls if they exist
    const existingControls = document.getElementById('session-publishing-controls');
    if (existingControls) {
        existingControls.remove();
    }

    // Update the share menu state instead
    await updateShareMenuState();
}

/**
 * Handles publishing or updating a session as a public event
 */
async function handlePublishEvent() {
    if (!state.session.id) {
        alert('No active session to publish');
        return;
    }

    try {
        // Gather event data from session details
        const rawDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
        console.log('[PUBLISH DEBUG - Sidebar] Raw date from state:', rawDate);
        console.log('[PUBLISH DEBUG - Sidebar] Raw date type:', typeof rawDate);

        const eventData = {
            Name: state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Untitled Event',
            Date: rawDate,
            Goals: state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS),
            GuestCount: state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT)
        };

        console.log('[PUBLISH DEBUG - Sidebar] Complete eventData object:', eventData);
        log('Sidebar', `Publishing session ${state.session.id} as event with data:`, eventData);

        // Disable the button to prevent double-clicks
        const publishBtn = document.getElementById('publish-event-btn');
        const updateBtn = document.getElementById('update-published-event-btn');
        if (publishBtn) {
            publishBtn.disabled = true;
            publishBtn.textContent = 'Publishing...';
        }
        if (updateBtn) {
            updateBtn.disabled = true;
            updateBtn.textContent = 'Updating...';
        }

        // Call the API to publish/update
        const result = await api.publishSessionAsEvent(state.session.id, eventData);

        log('Sidebar', 'Event published/updated successfully:', result);
        alert('Event published successfully! It will now appear in the catalog.');

        // Reload to show updated RSVP stats
        await updateSessionPublishingControls();

    } catch (error) {
        console.error('Error publishing event:', error);
        alert(`Failed to publish event: ${error.message}`);

        // Re-enable the button
        const publishBtn = document.getElementById('publish-event-btn');
        const updateBtn = document.getElementById('update-published-event-btn');
        if (publishBtn) {
            publishBtn.disabled = false;
            publishBtn.textContent = '🌐 Publish as Public Event';
        }
        if (updateBtn) {
            updateBtn.disabled = false;
            updateBtn.textContent = '🔄 Update Published Event';
        }
    }
}

/**
 * Handles publishing or updating a session as a reusable Package (Decision 5 - Option B)
 */
async function handlePublishPackage() {
    console.log('[SIDEBAR PACKAGE DEBUG] ========== handlePublishPackage CALLED ==========');
    console.log('[SIDEBAR PACKAGE DEBUG] state.session.id:', state.session.id);
    console.log('[SIDEBAR PACKAGE DEBUG] state.cart.lockedItems.size:', state.cart.lockedItems.size);

    if (!state.session.id) {
        console.error('[SIDEBAR PACKAGE DEBUG] No active session to publish');
        alert('No active session to publish as package');
        return;
    }

    // Check if session has items to package
    if (state.cart.lockedItems.size === 0) {
        console.error('[SIDEBAR PACKAGE DEBUG] No locked items in cart');
        alert('Add some items to your Event Plan before publishing as a package.');
        return;
    }

    try {
        // Prompt for package details
        const packageName = prompt(
            'Enter a name for this package:',
            state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'My Package'
        );

        if (!packageName) {
            console.log('[SIDEBAR PACKAGE DEBUG] User cancelled - no package name');
            return; // User cancelled
        }
        console.log('[SIDEBAR PACKAGE DEBUG] Package name:', packageName);

        const packageDescription = prompt(
            'Enter a description for this package:',
            state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || ''
        );

        // Calculate suggested package price from locked items
        let totalPrice = 0;
        console.log('[SIDEBAR PACKAGE DEBUG] Calculating price from locked items...');
        console.log('[SIDEBAR PACKAGE DEBUG] state.records.all count:', state.records.all?.length || 0);
        for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
            const record = getRecordById(recordId);
            if (record) {
                const rawPrice = record.fields[CONSTANTS.FIELD_NAMES.PRICE];
                const price = parseFloat(rawPrice || 0);
                const qty = itemInfo.quantity || 1;
                console.log('[SIDEBAR PACKAGE DEBUG] Item:', recordId, 'rawPrice:', rawPrice, 'parsedPrice:', price, 'qty:', qty);
                if (!isNaN(price)) {
                    totalPrice += price * qty;
                }
            } else {
                console.log('[SIDEBAR PACKAGE DEBUG] Record NOT FOUND in state.records.all:', recordId);
            }
        }
        console.log('[SIDEBAR PACKAGE DEBUG] Calculated totalPrice:', totalPrice);

        const priceInput = prompt(
            'Enter the package price (or leave empty for free/no price):',
            totalPrice > 0 ? totalPrice.toFixed(2) : ''
        );

        // Handle price input - when user cancels (null) or explicitly leaves empty, don't set a price
        // This allows packages to be created as "free" if the user wants
        let packagePrice = undefined;
        console.log('[SIDEBAR PACKAGE DEBUG] priceInput:', priceInput, 'type:', typeof priceInput);

        if (priceInput === null) {
            // User cancelled the prompt - use calculated price as fallback
            packagePrice = totalPrice > 0 ? totalPrice : undefined;
            console.log('[SIDEBAR PACKAGE DEBUG] User cancelled, using fallback:', packagePrice);
        } else if (priceInput.trim() === '') {
            // User explicitly left the field empty - no price (free)
            packagePrice = undefined;
            console.log('[SIDEBAR PACKAGE DEBUG] User left blank - no price set (free)');
        } else {
            // User entered a value - parse it
            const parsedPrice = parseFloat(priceInput);
            if (!isNaN(parsedPrice) && isFinite(parsedPrice) && parsedPrice >= 0) {
                packagePrice = parsedPrice;
                console.log('[SIDEBAR PACKAGE DEBUG] User entered valid price:', packagePrice);
            } else {
                // Invalid input - fall back to calculated price
                packagePrice = totalPrice > 0 ? totalPrice : undefined;
                console.log('[SIDEBAR PACKAGE DEBUG] Invalid input, using fallback:', packagePrice);
            }
        }
        console.log('[SIDEBAR PACKAGE DEBUG] Final packagePrice:', packagePrice);

        const discountInput = prompt('Enter a discount percentage (0-100, or leave empty for no discount):', '0');
        const discount = discountInput ? Math.min(100, Math.max(0, parseFloat(discountInput))) : 0;

        log('Sidebar', `Publishing session ${state.session.id} as package with name: ${packageName}`);
        console.log('[SIDEBAR PACKAGE DEBUG] About to call api.publishSessionAsPackage');
        console.log('[SIDEBAR PACKAGE DEBUG] Session ID:', state.session.id);

        // Disable the button to prevent double-clicks
        const publishPackageBtn = document.getElementById('share-publish-package-btn');
        const updatePackageBtn = document.getElementById('share-update-package-btn');
        if (publishPackageBtn) {
            publishPackageBtn.disabled = true;
            publishPackageBtn.textContent = 'Publishing...';
        }
        if (updatePackageBtn) {
            updatePackageBtn.disabled = true;
            updatePackageBtn.textContent = 'Updating...';
        }

        // Call the API to publish/update package
        const packageData = {
            Name: packageName,
            Description: packageDescription || '',
            Price: packagePrice,
            Discount: discount > 0 ? discount : undefined
        };
        console.log('[SIDEBAR PACKAGE DEBUG] packageData being sent:', JSON.stringify(packageData, null, 2));

        const result = await api.publishSessionAsPackage(state.session.id, packageData);

        console.log('[SIDEBAR PACKAGE DEBUG] ========== API CALL COMPLETE ==========');
        console.log('[SIDEBAR PACKAGE DEBUG] Result received:', result);
        console.log('[SIDEBAR PACKAGE DEBUG] Result ID:', result?.id);
        console.log('[SIDEBAR PACKAGE DEBUG] Result fields:', JSON.stringify(result?.fields, null, 2));
        log('Sidebar', 'Package published/updated successfully:', result);
        alert(`Package "${packageName}" published successfully! It will now appear in the catalog.`);

        // Reload to show updated state
        await updateSessionPublishingControls();

        // Re-enable buttons with updated text
        if (publishPackageBtn) {
            publishPackageBtn.style.display = 'none';
        }
        if (updatePackageBtn) {
            updatePackageBtn.disabled = false;
            updatePackageBtn.textContent = '📦 Update Package';
            updatePackageBtn.style.display = 'flex';
        }

    } catch (error) {
        console.error('[SIDEBAR PACKAGE DEBUG] ========== ERROR PUBLISHING PACKAGE ==========');
        console.error('[SIDEBAR PACKAGE DEBUG] Error:', error);
        console.error('[SIDEBAR PACKAGE DEBUG] Error message:', error.message);
        console.error('[SIDEBAR PACKAGE DEBUG] Error stack:', error.stack);
        console.error('Error publishing package:', error);
        alert(`Failed to publish package: ${error.message}`);

        // Re-enable buttons
        const publishPackageBtn = document.getElementById('share-publish-package-btn');
        const updatePackageBtn = document.getElementById('share-update-package-btn');
        if (publishPackageBtn) {
            publishPackageBtn.disabled = false;
            publishPackageBtn.textContent = '📦 Publish as Package';
        }
        if (updatePackageBtn) {
            updatePackageBtn.disabled = false;
            updatePackageBtn.textContent = '📦 Update Package';
        }
    }
}

// ==============================================
// SESSION MANAGEMENT HANDLERS
// ==============================================

/**
 * Handles Save & New action - saves current session and creates a new one
 */
async function handleSaveAndNew() {
    log('Sidebar', 'Save & New clicked');

    if (!state.session.user.isAuthenticated) {
        alert('Please sign in to manage sessions.');
        return;
    }

    try {
        // First, save the current session
        await api.saveSessionToAirtable();
        log('Sidebar', 'Current session saved');

        // Create a new session
        const newSessionId = await api.createNewSession(
            state.ui.activeShopId,
            state.session.user.id,
            'New Plan'
        );

        if (newSessionId) {
            // Navigate to the new session
            const newUrl = `${window.location.pathname}?session=${newSessionId}${state.ui.activeShopId ? `&${getShopUrlParam(state.ui.activeShopId, state.stores.all)}` : ''}`;
            window.location.href = newUrl;
        } else {
            throw new Error('Failed to create new session');
        }
    } catch (error) {
        console.error('Error in Save & New:', error);
        alert('Failed to create new session. Please try again.');
    }
}

/**
 * Handles Delete & New action - deletes current session and creates a new one
 */
async function handleDeleteAndNew() {
    log('Sidebar', 'Delete & New clicked');

    if (!state.session.user.isAuthenticated) {
        alert('Please sign in to manage sessions.');
        return;
    }

    if (!state.session.id) {
        // No current session, just create a new one
        await handleSaveAndNew();
        return;
    }

    // Show confirmation dialog
    const confirmed = await showConfirmDialog(
        'Delete & Start New?',
        'This will permanently delete the current plan and start a new one. This action cannot be undone.',
        'Delete & Start New',
        true
    );

    if (!confirmed) return;

    try {
        const currentSessionId = state.session.id;

        // Delete the current session
        const deleted = await api.deleteSession(currentSessionId);

        if (!deleted) {
            throw new Error('Failed to delete session');
        }

        log('Sidebar', `Session ${currentSessionId} deleted`);

        // Create a new session
        const newSessionId = await api.createNewSession(
            state.ui.activeShopId,
            state.session.user.id,
            'New Plan'
        );

        if (newSessionId) {
            // Navigate to the new session
            const newUrl = `${window.location.pathname}?session=${newSessionId}${state.ui.activeShopId ? `&${getShopUrlParam(state.ui.activeShopId, state.stores.all)}` : ''}`;
            window.location.href = newUrl;
        } else {
            // If creating new session fails, go to store root
            const newUrl = `${window.location.pathname}${state.ui.activeShopId ? `?${getShopUrlParam(state.ui.activeShopId, state.stores.all)}` : ''}`;
            window.location.href = newUrl;
        }
    } catch (error) {
        console.error('Error in Delete & New:', error);
        alert('Failed to delete session. Please try again.');
    }
}

/**
 * Handles Archive Plan action
 */
async function handleArchivePlan() {
    log('Sidebar', 'Archive Plan clicked');

    if (!state.session.user.isAuthenticated) {
        alert('Please sign in to archive sessions.');
        return;
    }

    if (!state.session.id) {
        alert('No active session to archive.');
        return;
    }

    const confirmed = await showConfirmDialog(
        'Archive Plan?',
        'This plan will be archived and hidden from your sessions list. You can still recover it later.',
        'Archive',
        false
    );

    if (!confirmed) return;

    try {
        const archived = await api.archiveSession(state.session.id);

        if (archived) {
            alert('Plan archived successfully.');
            // Navigate to a new session or store root
            const newUrl = `${window.location.pathname}${state.ui.activeShopId ? `?${getShopUrlParam(state.ui.activeShopId, state.stores.all)}` : ''}`;
            window.location.href = newUrl;
        } else {
            throw new Error('Failed to archive session');
        }
    } catch (error) {
        console.error('Error archiving plan:', error);
        alert('Failed to archive plan. Please try again.');
    }
}

/**
 * Handles Delete Plan action
 */
async function handleDeletePlan() {
    log('Sidebar', 'Delete Plan clicked');

    if (!state.session.user.isAuthenticated) {
        alert('Please sign in to delete sessions.');
        return;
    }

    if (!state.session.id) {
        alert('No active session to delete.');
        return;
    }

    const confirmed = await showConfirmDialog(
        'Permanently Delete Plan?',
        'This will permanently delete this plan and all its contents. This action cannot be undone.',
        'Delete Permanently',
        true
    );

    if (!confirmed) return;

    try {
        const deleted = await api.deleteSession(state.session.id);

        if (deleted) {
            alert('Plan deleted successfully.');
            // Navigate to store root
            const newUrl = `${window.location.pathname}${state.ui.activeShopId ? `?${getShopUrlParam(state.ui.activeShopId, state.stores.all)}` : ''}`;
            window.location.href = newUrl;
        } else {
            throw new Error('Failed to delete session');
        }
    } catch (error) {
        console.error('Error deleting plan:', error);
        alert('Failed to delete plan. Please try again.');
    }
}

/**
 * Shows a confirmation dialog and returns a promise that resolves to true/false
 */
function showConfirmDialog(title, message, confirmText, isDanger = false) {
    return new Promise((resolve) => {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'confirm-dialog-overlay';

        // Create dialog
        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';
        dialog.innerHTML = `
            <h4>${title}</h4>
            <p>${message}</p>
            <div class="confirm-dialog-actions">
                <button class="btn-cancel">Cancel</button>
                <button class="btn-confirm ${isDanger ? '' : 'btn-primary'}">${confirmText}</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // Handle clicks
        const cancelBtn = dialog.querySelector('.btn-cancel');
        const confirmBtn = dialog.querySelector('.btn-confirm');

        const cleanup = () => {
            overlay.remove();
        };

        cancelBtn.addEventListener('click', () => {
            cleanup();
            resolve(false);
        });

        confirmBtn.addEventListener('click', () => {
            cleanup();
            resolve(true);
        });

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve(false);
            }
        });

        // Close on Escape
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', handleEscape);
                cleanup();
                resolve(false);
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
}

/**
 * Shows the sessions modal with list of user's sessions
 */
async function showSessionsModal() {
    log('Sidebar', 'See Sessions clicked');

    if (!state.session.user.isAuthenticated) {
        alert('Please sign in to view your sessions.');
        return;
    }

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'sessions-modal-overlay';
    overlay.innerHTML = `
        <div class="sessions-modal">
            <div class="sessions-modal-header">
                <h3>My Sessions</h3>
                <button class="sessions-modal-close">&times;</button>
            </div>
            <div class="sessions-modal-body">
                <div class="bulk-actions-bar" style="display: none;">
                    <label class="bulk-select-all">
                        <input type="checkbox" id="sessions-select-all">
                        <span>Select All</span>
                    </label>
                    <div class="bulk-actions-buttons">
                        <button class="session-action-btn" id="bulk-archive-btn">Archive Selected</button>
                        <button class="session-action-btn btn-danger" id="bulk-delete-btn">Delete Selected</button>
                    </div>
                </div>
                <div class="sessions-list" id="sessions-list">
                    <p style="text-align: center; color: #6c757d;">Loading sessions...</p>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Close handlers
    const closeModal = () => {
        overlay.remove();
    };

    const closeBtn = overlay.querySelector('.sessions-modal-close');
    closeBtn.addEventListener('click', closeModal);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    document.addEventListener('keydown', function handleEscape(e) {
        if (e.key === 'Escape') {
            document.removeEventListener('keydown', handleEscape);
            closeModal();
        }
    });

    // Load sessions
    try {
        const sessions = await api.fetchUserSessions(state.session.user.id, state.ui.activeShopId);
        const sessionsList = overlay.querySelector('#sessions-list');
        const bulkActionsBar = overlay.querySelector('.bulk-actions-bar');
        const selectAllCheckbox = overlay.querySelector('#sessions-select-all');
        const bulkArchiveBtn = overlay.querySelector('#bulk-archive-btn');
        const bulkDeleteBtn = overlay.querySelector('#bulk-delete-btn');

        if (sessions.length === 0) {
            sessionsList.innerHTML = `
                <div class="sessions-empty-state">
                    <p>No sessions found. Start planning to create your first session!</p>
                </div>
            `;
            return;
        }

        // Show bulk actions bar
        bulkActionsBar.style.display = 'flex';

        // Render sessions
        sessionsList.innerHTML = sessions.map(session => {
            const isCurrentSession = session.id === state.session.id;
            const sessionData = session.fields['Items with Variations'];
            let itemCount = 0;

            if (sessionData) {
                try {
                    const parsed = JSON.parse(sessionData);
                    itemCount = Object.keys(parsed.lockedInItems || {}).length +
                                Object.keys(parsed.ideasItems || {}).length;
                } catch (e) {
                    // Ignore parse errors
                }
            }

            const dateStr = session.fields.Date
                ? new Date(session.fields.Date).toLocaleDateString()
                : 'No date';

            return `
                <div class="session-list-item ${isCurrentSession ? 'current-session' : ''}" data-session-id="${session.id}">
                    <input type="checkbox" class="session-list-checkbox" ${isCurrentSession ? 'disabled' : ''}>
                    <div class="session-list-info">
                        <div class="session-list-name">${session.fields.Name || 'Untitled Session'}${isCurrentSession ? ' (Current)' : ''}</div>
                        <div class="session-list-meta">
                            <span>📅 ${dateStr}</span>
                            <span>📦 ${itemCount} items</span>
                        </div>
                    </div>
                    <div class="session-list-actions">
                        ${!isCurrentSession ? `
                            <button class="session-action-btn btn-primary session-open-btn" data-session-id="${session.id}">Open</button>
                            <button class="session-action-btn btn-danger session-delete-btn" data-session-id="${session.id}">Delete</button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Handle individual session actions
        sessionsList.addEventListener('click', async (e) => {
            const openBtn = e.target.closest('.session-open-btn');
            const deleteBtn = e.target.closest('.session-delete-btn');

            if (openBtn) {
                const sessionId = openBtn.dataset.sessionId;
                const newUrl = `${window.location.pathname}?session=${sessionId}${state.ui.activeShopId ? `&${getShopUrlParam(state.ui.activeShopId, state.stores.all)}` : ''}`;
                window.location.href = newUrl;
            }

            if (deleteBtn) {
                const sessionId = deleteBtn.dataset.sessionId;
                const confirmed = await showConfirmDialog(
                    'Delete Session?',
                    'This will permanently delete this session. This action cannot be undone.',
                    'Delete',
                    true
                );

                if (confirmed) {
                    const deleted = await api.deleteSession(sessionId);
                    if (deleted) {
                        // Remove from list
                        const item = sessionsList.querySelector(`[data-session-id="${sessionId}"]`);
                        if (item) item.remove();

                        // Check if list is now empty
                        if (sessionsList.querySelectorAll('.session-list-item').length === 0) {
                            sessionsList.innerHTML = `
                                <div class="sessions-empty-state">
                                    <p>No sessions found. Start planning to create your first session!</p>
                                </div>
                            `;
                            bulkActionsBar.style.display = 'none';
                        }
                    }
                }
            }
        });

        // Handle select all
        selectAllCheckbox.addEventListener('change', () => {
            const checkboxes = sessionsList.querySelectorAll('.session-list-checkbox:not(:disabled)');
            checkboxes.forEach(cb => {
                cb.checked = selectAllCheckbox.checked;
                cb.closest('.session-list-item').classList.toggle('selected', selectAllCheckbox.checked);
            });
        });

        // Handle individual checkbox changes
        sessionsList.addEventListener('change', (e) => {
            if (e.target.classList.contains('session-list-checkbox')) {
                e.target.closest('.session-list-item').classList.toggle('selected', e.target.checked);

                // Update select all state
                const checkboxes = sessionsList.querySelectorAll('.session-list-checkbox:not(:disabled)');
                const checkedCount = sessionsList.querySelectorAll('.session-list-checkbox:checked').length;
                selectAllCheckbox.checked = checkedCount === checkboxes.length && checkboxes.length > 0;
                selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
            }
        });

        // Bulk archive
        bulkArchiveBtn.addEventListener('click', async () => {
            const selectedIds = Array.from(sessionsList.querySelectorAll('.session-list-checkbox:checked'))
                .map(cb => cb.closest('.session-list-item').dataset.sessionId);

            if (selectedIds.length === 0) {
                alert('No sessions selected.');
                return;
            }

            const confirmed = await showConfirmDialog(
                `Archive ${selectedIds.length} Session(s)?`,
                'Selected sessions will be archived and hidden from your sessions list.',
                'Archive',
                false
            );

            if (confirmed) {
                const result = await api.archiveSessionsBulk(selectedIds);
                alert(`Archived ${result.success} session(s).${result.failed > 0 ? ` ${result.failed} failed.` : ''}`);

                // Refresh the list
                selectedIds.forEach(id => {
                    const item = sessionsList.querySelector(`[data-session-id="${id}"]`);
                    if (item) item.remove();
                });

                if (sessionsList.querySelectorAll('.session-list-item').length === 0) {
                    sessionsList.innerHTML = `
                        <div class="sessions-empty-state">
                            <p>No sessions found. Start planning to create your first session!</p>
                        </div>
                    `;
                    bulkActionsBar.style.display = 'none';
                }
            }
        });

        // Bulk delete
        bulkDeleteBtn.addEventListener('click', async () => {
            const selectedIds = Array.from(sessionsList.querySelectorAll('.session-list-checkbox:checked'))
                .map(cb => cb.closest('.session-list-item').dataset.sessionId);

            if (selectedIds.length === 0) {
                alert('No sessions selected.');
                return;
            }

            const confirmed = await showConfirmDialog(
                `Permanently Delete ${selectedIds.length} Session(s)?`,
                'This will permanently delete the selected sessions. This action cannot be undone.',
                'Delete All',
                true
            );

            if (confirmed) {
                const result = await api.deleteSessionsBulk(selectedIds);
                alert(`Deleted ${result.success} session(s).${result.failed > 0 ? ` ${result.failed} failed.` : ''}`);

                // Refresh the list
                selectedIds.forEach(id => {
                    const item = sessionsList.querySelector(`[data-session-id="${id}"]`);
                    if (item) item.remove();
                });

                if (sessionsList.querySelectorAll('.session-list-item').length === 0) {
                    sessionsList.innerHTML = `
                        <div class="sessions-empty-state">
                            <p>No sessions found. Start planning to create your first session!</p>
                        </div>
                    `;
                    bulkActionsBar.style.display = 'none';
                }
            }
        });

    } catch (error) {
        console.error('Error loading sessions:', error);
        const sessionsList = overlay.querySelector('#sessions-list');
        sessionsList.innerHTML = `
            <div class="sessions-empty-state">
                <p>Failed to load sessions. Please try again.</p>
            </div>
        `;
    }
}

export async function updateEventPlanSection() {
    console.log('[PUBLISH DEBUG] ========== updateEventPlanSection CALLED ==========');
    console.log('[PUBLISH DEBUG] state.session.id at entry:', state.session.id);
    console.log('[PUBLISH DEBUG] state.cart.lockedItems.size:', state.cart.lockedItems.size);

    // If already updating, mark that another update is needed and return
    if (isUpdatingEventPlan) {
        pendingEventPlanUpdate = true;
        log('Sidebar', 'Event plan update already in progress, will retry after completion.');
        console.log('[PUBLISH DEBUG] Already updating, will retry later');
        return;
    }

    isUpdatingEventPlan = true;
    pendingEventPlanUpdate = false;

    try {
        log('Sidebar', 'Updating event plan panel.');
        const container = document.getElementById('cart-items-container');
        if (!container) {
            console.log('[PUBLISH DEBUG] ERROR: cart-items-container not found!');
            return;
        }

        // Clear container to prevent duplicates
        container.innerHTML = '';

        // Check if this session is published and display RSVP stats + Publish button
        console.log('[PUBLISH DEBUG] About to call updateSessionPublishingControls');
        await updateSessionPublishingControls();
        // Invite section removed - now accessible via Share menu popup
        console.log('[PUBLISH DEBUG] updateSessionPublishingControls completed');

        if (state.cart.lockedItems.size === 0) {
            container.innerHTML = `<p style="font-size: 0.9em; color: #6c757d;">No items locked in yet.</p>`;
        } else {
            // Create a document fragment to batch DOM updates
            const fragment = document.createDocumentFragment();

            // === DIG INFO DEBUG START ===
            console.log('[DIG-INFO DEBUG] ========== RENDERING LOCKED ITEMS ==========');
            console.log('[DIG-INFO DEBUG] Total locked items:', state.cart.lockedItems.size);
            console.log('[DIG-INFO DEBUG] Locked item IDs:', [...state.cart.lockedItems.keys()]);
            console.log('[DIG-INFO DEBUG] window._solutionRecords exists:', !!window._solutionRecords);
            console.log('[DIG-INFO DEBUG] window._solutionRecords size:', window._solutionRecords?.size || 0);
            if (window._solutionRecords) {
                console.log('[DIG-INFO DEBUG] Solution records keys:', [...window._solutionRecords.keys()]);
            }
            // === DIG INFO DEBUG END ===

            for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
                // === DIG INFO DEBUG START ===
                console.log('[DIG-INFO DEBUG] Processing locked item:', recordId);
                // === DIG INFO DEBUG END ===

                // Find the record in state.records.all or state.records.archive (for ghost items)
                let record = getRecordById(recordId);
                // === DIG INFO DEBUG START ===
                console.log('[DIG-INFO DEBUG] Found in state.records.all:', !!record);
                // === DIG INFO DEBUG END ===
                if (!record) {
                    record = state.records.archive.find(r => r.id === recordId);
                    // === DIG INFO DEBUG START ===
                    console.log('[DIG-INFO DEBUG] Found in state.records.archive:', !!record);
                    // === DIG INFO DEBUG END ===
                }

                // Check solution records registry for AI-generated solution items
                if (!record && recordId.startsWith('solution-') && window._solutionRecords) {
                    record = window._solutionRecords.get(recordId);
                    // === DIG INFO DEBUG START ===
                    console.log('[DIG-INFO DEBUG] Found in window._solutionRecords:', !!record);
                    if (record) {
                        console.log('[DIG-INFO DEBUG] Solution record details:', {
                            id: record.id,
                            isSolution: record.isSolution,
                            hasFields: !!record.fields,
                            fieldKeys: record.fields ? Object.keys(record.fields) : []
                        });
                    }
                    // === DIG INFO DEBUG END ===
                    if (record) {
                        log('Sidebar', `Found solution record in registry: ${recordId}`);
                    }
                }

                if (record) {
                    const itemElement = await createLockedInItemElement(record, itemInfo); // Pass the full record
                    fragment.appendChild(itemElement);
                } else {
                    log('Sidebar', `Could not render item ${recordId}, not found in state.records.all or archive.`);
                    // === DIG INFO DEBUG START ===
                    console.log('[DIG-INFO DEBUG] FAILED to find record:', recordId);
                    // === DIG INFO DEBUG END ===
                }
            }

            // Append all items at once to minimize reflows
            container.appendChild(fragment);
        }

        ui.observeLazyImages(container);

        updateEventHealthScore(); // --- ADDED THIS LINE ---
        updateTotalPlanScoreDisplay(calculateTotalPlanScore()); // --- ADDED THIS LINE ---
    } finally {
        isUpdatingEventPlan = false;

        // If another update was requested while we were updating, run it now
        if (pendingEventPlanUpdate) {
            log('Sidebar', 'Running pending event plan update.');
            updateEventPlanSection();
        }
    }
}
// --- END REPLACED FUNCTION ---

async function handleInvite() {
    const emailInput = document.getElementById('collab-email');
    const roleSelect = document.getElementById('collab-role');
    const statusEl = document.getElementById('invite-status');
    const btn = document.getElementById('invite-btn');

    const email = emailInput.value.trim();
    const role = roleSelect ? roleSelect.value : 'editor';

    if (!email) {
        statusEl.textContent = "Please enter an email address.";
        statusEl.style.color = "#dc3545";
        return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        statusEl.textContent = "Please enter a valid email address.";
        statusEl.style.color = "#dc3545";
        return;
    }

    btn.disabled = true;
    btn.textContent = "Sending...";
    statusEl.textContent = "";

    try {
        const inviterName = state.session.user?.name || "A friend";
        const sessionName = state.eventDetails?.combined?.get?.('eventName') || state.eventDetails?.combined?.get?.('Event Name') || '';

        const response = await fetch('/api/send-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: email,
                sessionId: state.session.id,
                invitedBy: state.session.user?.id || '',
                inviterName: inviterName,
                role: role,
                sessionName: sessionName,
                storeId: state.session.storeId || ''
            })
        });

        if (response.ok) {
            statusEl.textContent = "Invitation sent!";
            statusEl.style.color = "#28a745";
            emailInput.value = '';
            if (roleSelect) roleSelect.value = 'editor';
            setTimeout(() => {
                 closeInvitePopup();
                 statusEl.textContent = "";
                 btn.textContent = "Send Invite";
                 btn.disabled = false;
            }, 1500);
        } else {
            const err = await response.json();
            throw new Error(err.error || 'Failed to send');
        }
    } catch (e) {
        console.error(e);
        statusEl.textContent = "Error sending invite.";
        statusEl.style.color = "#dc3545";
        btn.textContent = "Send Invite";
        btn.disabled = false;
    }
}

async function updateInviteControls() {
    // Locate the container for the event plan items
    const container = document.getElementById('cart-items-container');
    if (!container || !container.parentElement) return;

    let inviteSection = document.getElementById('invite-collaborator-section');
    
    // If we have a session but no invite section, create it
    if (state.session.id && !inviteSection) {
        inviteSection = document.createElement('div');
        inviteSection.id = 'invite-collaborator-section';
        inviteSection.style.cssText = 'margin: 15px 0; padding: 15px; background-color: #f0f8ff; border-radius: 5px; border: 1px solid #cce5ff;';
        
        // Insert it after the "Publish" controls if they exist, or before cart items container
        const publishingControls = document.getElementById('session-publishing-controls');
        if (publishingControls) {
             publishingControls.insertAdjacentElement('afterend', inviteSection);
        } else {
             container.parentElement.insertBefore(inviteSection, container);
        }

        inviteSection.innerHTML = `
            <h4 style="margin-top: 0; color: #0056b3; font-size: 1em; display: flex; align-items: center; gap: 5px;">&#128236; Invite Collaborator</h4>
            <p style="font-size: 0.85em; color: #666; margin-bottom: 10px; margin-top: 5px;">Share this plan with a friend. They'll sign in with this email.</p>
            <div style="display: flex; gap: 5px; margin-bottom: 10px;">
                <input type="email" id="collab-email" placeholder="Friend's Email" style="flex: 1; padding: 8px; border: 1px solid #ced4da; border-radius: 4px; font-size: 0.9em;" autocomplete="email">
            </div>
            <button id="invite-btn" style="width: 100%; padding: 8px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.9em; transition: background-color 0.2s;">Send Invite</button>
            <div id="invite-status" style="font-size: 0.85em; margin-top: 5px; text-align: center; min-height: 1.2em;"></div>
        `;
        
        // Add hover effect to button
        const btn = inviteSection.querySelector('#invite-btn');
        btn.onmouseover = () => btn.style.backgroundColor = "#0056b3";
        btn.onmouseout = () => btn.style.backgroundColor = "#007bff";
        
        btn.addEventListener('click', handleInvite);
    } else if (!state.session.id && inviteSection) {
        // If no session (e.g. logged out/cleared?), remove it
        inviteSection.remove();
    }
}


/**
 * Verifies that items in the event plan panel are not duplicated
 * This function checks the DOM and logs warnings if duplicates are found
 */
export function verifyNoDuplicateItems() {
    const container = document.getElementById('cart-items-container');
    if (!container) return;

    const itemElements = container.querySelectorAll('.locked-item-card[data-record-id]');
    const seenIds = new Set();
    const duplicates = [];

    itemElements.forEach(element => {
        const recordId = element.dataset.recordId;
        if (seenIds.has(recordId)) {
            duplicates.push(recordId);
            log('Sidebar', `WARNING: Duplicate item found in event plan panel: ${recordId}`);
            // Remove the duplicate element
            element.remove();
        } else {
            seenIds.add(recordId);
        }
    });

    if (duplicates.length > 0) {
        log('Sidebar', `Removed ${duplicates.length} duplicate items from event plan panel`);
        return duplicates;
    } else {
        log('Sidebar', 'Event plan panel verification: No duplicates found');
        return [];
    }
}

export async function updateIdeasCarousel() { 
    log('Sidebar', `Updating ideas carousel with ${state.cart.items.size} items.`);
    const ideasSection = document.getElementById('favorites-section');
    const ideasCarousel = document.getElementById('favorites-carousel');
    if (!ideasSection || !ideasCarousel) return;

    if (state.cart.items.size === 0) {
        ideasSection.style.display = 'none';
        return;
    }
    ideasSection.style.display = 'block';
    ideasCarousel.innerHTML = '';
    const imageCache = new Map();

    for (const [recordId, itemInfo] of state.cart.items.entries()) {
        const record = getRecordById(recordId);
        if (record) {
            try {
                const card = await createFavoriteCardElement(record, itemInfo, imageCache);
                if (card) ideasCarousel.appendChild(card);
            } catch (error) {
                console.error(`Failed to create idea card for ${record.fields.Name}:`, error);
            }
        }
    }
    
    if (typeof ui !== 'undefined' && ui.observeLazyImages) {
         ui.observeLazyImages(ideasCarousel);
    } else {
         console.warn("ui.observeLazyImages not found during carousel update.");
    }
}

export function updateHeader() {
    console.log('[DEBUG updateHeader] ========== HEADER UPDATE DEBUG ==========');
    console.log('[DEBUG updateHeader] state.eventDetails.combined contents:', Object.fromEntries(state.eventDetails.combined));
    console.log('[DEBUG updateHeader] CONSTANTS.DETAIL_TYPES.EVENT_NAME:', CONSTANTS.DETAIL_TYPES.EVENT_NAME);
    console.log('[DEBUG updateHeader] CONSTANTS.DETAIL_TYPES.GOALS:', CONSTANTS.DETAIL_TYPES.GOALS);

    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    console.log('[DEBUG updateHeader] Retrieved eventName:', eventName);

    const activeShop = state.stores.all.find(s => s.id === state.ui.activeShopId);
    const shopName = activeShop?.fields?.Name || '';
    document.title = eventName || (shopName ? `${shopName} WTFun` : 'WTFun');
    const eventNameInput = document.getElementById('header-event-name');
    if (eventNameInput) {
        console.log('[DEBUG updateHeader] Setting header-event-name input to:', eventName);
        eventNameInput.value = eventName;
    } else {
        console.log('[DEBUG updateHeader] WARNING: header-event-name input NOT found!');
    }

    const goalsInput = document.getElementById('header-goals');
    const goalsValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
    console.log('[DEBUG updateHeader] Retrieved goals:', goalsValue);
    if(goalsInput) {
        console.log('[DEBUG updateHeader] Setting header-goals input to:', goalsValue);
        goalsInput.value = goalsValue;
    } else {
        console.log('[DEBUG updateHeader] WARNING: header-goals input NOT found!');
    }
    console.log('[DEBUG updateHeader] ========== END HEADER UPDATE DEBUG ==========');
}

// In: components/sidebar.js
// Action: REPLACE the entire `updateEventHealthScore` function

/**
 * [v1.2] Updates the Plan Health UI in the sidebar with the score and actionable suggestions.
 */
export function updateEventHealthScore() {
    const container = document.getElementById('event-health-score');
    if (!container) return;
    
    const suggestions = calculateMissingCategories();
    const score = 4 - suggestions.length; // Based on 4 pillars
    let html = '';

    // 1. The "Score"
    let scoreText = '🟠 Good Start!';
    let scoreColor = '#fd7e14';
    if (score === 4) {
        scoreText = '✅ Well-Rounded Event!';
        scoreColor = '#28a745';
    } else if (score === 1) {
        scoreText = '🔴 Just Beginning!';
        scoreColor = '#dc3545';
    } else if (score === 0) { // New "Empty" state
        scoreText = 'Start Your Plan!';
        scoreColor = '#6c757d'; // Neutral gray
    } else if (score === 2) {
        scoreText = '🟡 Growing!';
        scoreColor = '#ffc107';
    }

    // --- THIS IS THE FIX (Removed \") ---
    html += `<h5 style="margin: 0 0 5px 0; text-align: center; color: ${scoreColor};">Plan Health: ${scoreText} <span class='beta-tag-subtle'>Beta</span></h5>`;
    // --- END THE FIX ---

    // 2. The "Suggestions"
    if (suggestions.length > 0) {
        // --- THIS IS THE FIX (Removed \") ---
        html += `<p style="font-size: 0.9em; margin: 0; text-align: center;">
            Our experts recommend adding these components for a full experience:
        </p>`;
        
        // Create clickable "suggestion" buttons
        html += `<div style="display: flex; gap: 5px; margin-top: 10px; justify-content: center; flex-wrap: wrap;">`;
        suggestions.forEach(cat => {
            // The display name is the exact key from calculateMissingCategories (e.g., "Food & Drink")
            const displayName = cat; 
            
            // --- VVV FINAL, ROBUST FILTER TAG GENERATION VVV ---
            // Normalize the filter tag consistently with the rest of the app
            let filterTag = displayName.toLowerCase().replace(/\s+/g, ' ');
            // --- ^^^ END FINAL, ROBUST FILTER TAG GENERATION ^^^ ---
            
            // --- THIS IS THE FIX (Removed \") ---
            html += `<button class="filter-btn health-suggestion-btn" data-category-filter="${filterTag}">
                + Add ${displayName}
            </button>`;
        });
        html += `</div>`;
    } else {
        // --- THIS IS THE FIX (Removed \") ---
        html += `<p style="font-size: 0.9em; margin: 0; text-align: center; color: #28a745;">
            You've covered all the core components for a great guest experience!
        </p>`;
    }

    container.innerHTML = html;
}

export function updateTotalCost() {
    const subtotalCostEl = document.getElementById('subtotal-cost');
    const amountPaidCostEl = document.getElementById('amount-paid-cost');
    const amountPaidRowEl = document.querySelector('.amount-paid-row');
    const totalDividerEl = document.querySelector('.total-divider');
    const totalCostEl = document.getElementById('total-cost');
    const checkoutBtn = document.getElementById('checkout-btn');
    const saveShareBtn = document.getElementById('save-share-btn');
    const mobileItemCountEl = document.getElementById('mobile-bar-item-count');
    const mobileTotalCostEl = document.getElementById('mobile-bar-total-cost');
    const statusMessageEl = document.getElementById('payment-status-message'); // Get new element
    if (statusMessageEl) statusMessageEl.innerHTML = ''; // Clear status on each run

    if (!totalCostEl || !subtotalCostEl) return;

    let subtotal = 0;
    state.cart.lockedItems.forEach((itemInfo, recordId) => {
        const record = getRecordById(recordId);
        if (!record) return;

        // Use selections for price if available, otherwise fall back to selectedOptionIndex
        const priceParam = (itemInfo.selections && Object.keys(itemInfo.selections).length > 0)
            ? itemInfo.selections
            : itemInfo.selectedOptionIndex;

        let unitPrice = itemInfo.overridePrice ?? getRecordPrice(record, priceParam);
        if (isNaN(unitPrice)) return;

        // Apply package discount if this item came from a package
        if (itemInfo.packageId && state.session.activePackages) {
            const packageInfo = state.session.activePackages.get(itemInfo.packageId);
            if (packageInfo && packageInfo.discount > 0) {
                unitPrice = unitPrice * (1 - packageInfo.discount / 100);
            }
        }

        // Custom items don't have a min headcount, so default to 1
        const minHeadcount = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        // Use itemInfo.quantity for all items
        const effectiveQuantity = Math.max(parseFloat(itemInfo.quantity) || 1, 1);

        subtotal += unitPrice * effectiveQuantity;
    });
    
    const amountReceived = state.session.user.amountReceived || 0;
    const totalDue = subtotal - amountReceived;
    
    subtotalCostEl.textContent = `$${subtotal.toFixed(2)}`;
    totalCostEl.textContent = `$${totalDue.toFixed(2)}`;
    
    if (typeof backgroundEngine.updateColors === 'function') {
        backgroundEngine.updateColors();
    }
    
    if (amountReceived > 0) {
        const paymentHistory = state.session.user.paymentHistory || [];
        
        if (paymentHistory.length === 1) {
            amountPaidCostEl.innerHTML = `<a href="#" class="receipt-link" data-payment-index="0" title="View Receipt">-$${amountReceived.toFixed(2)}</a>`;
        } else if (paymentHistory.length > 1) {
            // Sort payments by date (oldest first) and create index mapping
            const sortedPayments = paymentHistory
                .map((payment, originalIndex) => ({ ...payment, originalIndex }))
                .sort((a, b) => new Date(a.date) - new Date(b.date));
            
            let paymentsHtml = '<div class="multiple-payments">';
            sortedPayments.forEach((payment, displayIndex) => {
                paymentsHtml += `<div class="payment-item">
                    <a href="#" class="receipt-link" data-payment-index="${payment.originalIndex}" title="View Receipt #${displayIndex + 1}">
                        Payment ${displayIndex + 1}: -$${payment.amount.toFixed(2)}
                    </a>
                </div>`;
            });
            paymentsHtml += '</div>';
            amountPaidCostEl.innerHTML = paymentsHtml;
        } else {
            amountPaidCostEl.textContent = `-$${amountReceived.toFixed(2)}`;
        }
        
        amountPaidRowEl.style.display = 'flex';
        totalDividerEl.style.display = 'block';
    } else {
        amountPaidRowEl.style.display = 'none';
        totalDividerEl.style.display = 'none';
    }

    if (mobileItemCountEl && mobileTotalCostEl) {
        const itemCount = state.cart.lockedItems.size;
        mobileItemCountEl.textContent = `${itemCount} item${itemCount !== 1 ? 's' : ''}`;
        mobileTotalCostEl.textContent = `$${totalDue.toFixed(2)}`;
    }

    // A plan is empty only if there are no locked items AND subtotal is 0
    const isPlanEmpty = state.cart.lockedItems.size === 0 && subtotal === 0;
    // Only consider fully paid if amount has actually been received
    const isFullyPaid = totalDue <= 0.009 && amountReceived > 0;

    // Always show the mobile plan button so users can access event details and
    // other plan panel features regardless of plan state
    document.body.classList.add('mobile-bar-active');

    if (checkoutBtn) {
        checkoutBtn.style.display = 'block';
        document.getElementById('total-breakdown').style.display = 'block';

        if (isFullyPaid) {
            // --- THIS BLOCK IS MODIFIED (and fixed) ---
            checkoutBtn.textContent = 'View Receipt';
            checkoutBtn.disabled = false;
            if (statusMessageEl) {
                statusMessageEl.innerHTML = '<span style="color: #28a745; font-weight: bold; font-size: 1.2em; text-align: center; display: block; margin-bottom: 10px;">✅ Paid in Full</span>';
            }
            // --- END MODIFICATION ---
        } else if (amountReceived > 0) {
            checkoutBtn.textContent = 'Pay Remainder';
            checkoutBtn.disabled = isPlanEmpty;
        } else {
            checkoutBtn.textContent = checkoutBtn.dataset.defaultText || 'Reserve';
            // --- THIS IS THE FIX ---
            checkoutBtn.disabled = isPlanEmpty; // Was `isVIRTUAL_PAD_FINGERPRINT_VENDOR`
            // --- END THE FIX ---
        }
    }
    if (saveShareBtn) {
        saveShareBtn.disabled = isPlanEmpty && state.ui.saveState !== 'SAVING';
    }

    updateEventHealthScore(); // --- ADDED THIS LINE ---
    updateTotalPlanScoreDisplay(calculateTotalPlanScore()); // V3.3: Call to display total score

    // Sync mobile summary bar with current plan state
    updateMobileSummaryBar();
}


export function displayReservedStatus() {
    const checkoutBtn = document.getElementById('checkout-btn');
    const saveShareBtn = document.getElementById('save-share-btn');
    const statusMessageEl = document.getElementById('payment-status-message'); // Get new element
    
    if (statusMessageEl) {
        // --- THIS IS THE FIX (Removed \\\" ) ---
        statusMessageEl.innerHTML = '<span style="color: #28a745; font-weight: bold; font-size: 1.2em; text-align: center; display: block; margin-bottom: 10px;">✅ Event Reserved</span>';
    }
    if (checkoutBtn) {
        // Change text and ensure it's visible
        checkoutBtn.style.display = 'block';
        checkoutBtn.textContent = 'View Receipt';
        checkoutBtn.disabled = false;
    }
    if (saveShareBtn) {
        saveShareBtn.disabled = false;
    }
}
