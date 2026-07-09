/**
 * Item Rendering
 * Card rendering for both list/accordion and board (compact card) views.
 * Extracted from presentation.js — Phase 4A modularization.
 */

import { log } from '../../utils/debug.js';
import { renderRichText } from '../../utils.js';
import { getActiveStorePillars } from '../../availability.js';

// Track loaded images for each item
const itemImagesCache = new Map();
// Expose to window for cross-component updates (e.g., modal cover photo changes)
if (typeof window !== 'undefined') {
    window.itemImagesCache = itemImagesCache;
}

// Show/hide state for archived and completed items
let showArchivedItems = true;
let showCompletedItems = true;

// Debounce timer for coalescing rapid successive render calls
let renderDebounceTimer = null;

// Dependencies injected via init()
let _deps = null;

/**
 * Initialize the item rendering module.
 * @param {Object} deps - All required dependencies
 */
export function init(deps) {
    _deps = deps;
}

/**
 * Cleanup the module.
 */
export function cleanup() {
    if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
    renderDebounceTimer = null;
    itemImagesCache.clear();
    _deps = null;
}

/**
 * Get the item images cache (for use by other modules).
 */
export function getItemImagesCache() {
    return itemImagesCache;
}

export function createMediaCarousel(images, recordId) {
    if (!images || images.length === 0) {
        return '<div class="itinerary-item-no-images">No images available</div>';
    }

    const currentIndex = itemImagesCache.get(recordId)?.currentIndex || 0;

    const thumbnails = images.map((url, index) =>
        `<div class="itinerary-thumbnail ${index === currentIndex ? 'active' : ''}"
              data-record-id="${recordId}"
              data-index="${index}"
              style="background-image: url('${url}')"></div>`
    ).join('');

    return `
        <div class="itinerary-media-carousel" data-record-id="${recordId}">
            <div class="itinerary-main-image" style="background-image: url('${images[currentIndex]}')"></div>
            ${images.length > 1 ? `
                <div class="itinerary-thumbnails">${thumbnails}</div>
            ` : ''}
        </div>
    `;
}

/**
 * Get the selected options text for display.
 */
export function getSelectedOptionsDisplay(record, itemInfo) {
    const rawOptions = record.fields.Options;
    if (!rawOptions) return [];

    const groups = _deps.parseOptions(rawOptions);
    if (!groups || groups.length === 0) return [];

    const results = [];

    if (itemInfo?.selections && typeof itemInfo.selections === 'object' && Object.keys(itemInfo.selections).length > 0) {
        for (const [groupKey, optionValue] of Object.entries(itemInfo.selections)) {
            const groupIndexMatch = groupKey.match(/^group(\d+)$/);
            if (!groupIndexMatch) continue;

            const groupIndex = parseInt(groupIndexMatch[1], 10);
            const group = groups[groupIndex];
            if (!group || !group.options) continue;

            const optionIndices = Array.isArray(optionValue) ? optionValue : [optionValue];

            for (const optionIndex of optionIndices) {
                const option = group.options[optionIndex];
                if (option) {
                    results.push({
                        groupName: group.name || 'Options',
                        optionName: option.name
                    });
                }
            }
        }
        return results;
    }

    if (typeof itemInfo?.selectedOptionIndex === 'number' && itemInfo.selectedOptionIndex >= 0) {
        const flatOptions = _deps.flattenOptionGroups(groups);
        const option = flatOptions[itemInfo.selectedOptionIndex];
        if (option) {
            let groupName = 'Options';
            for (const group of groups) {
                if (group.options && group.options.includes(option)) {
                    groupName = group.name || 'Options';
                    break;
                }
            }
            results.push({
                groupName: groupName,
                optionName: option.name
            });
        }
        return results;
    }

    return results;
}

export function generateItemSummary(record, itemInfo, type) {
    const selectionsOrIndex = itemInfo?.selections || itemInfo?.selectedOptionIndex;
    const price = _deps.getRecordPrice(record, selectionsOrIndex);
    const quantity = itemInfo?.quantity || 1;
    const note = itemInfo?.note || '';

    const selectedOptions = getSelectedOptionsDisplay(record, itemInfo);

    let summary = `<span class="item-summary-price">$${price.toFixed(2)}</span>`;

    if (quantity > 1) {
        summary += ` <span class="item-summary-qty">(×${quantity})</span>`;
    }

    if (selectedOptions.length > 0) {
        const optionNames = selectedOptions.map(opt => opt.optionName).join(', ');
        summary += ` &bull; <span class="item-summary-options">${optionNames}</span>`;
    }

    const category = record.fields.Category || '';
    if (category && selectedOptions.length === 0) {
        summary += ` &bull; <span class="item-summary-category">${category}</span>`;
    }

    if (note) {
        const truncatedNote = note.length > 30 ? note.substring(0, 30) + '...' : note;
        summary += ` &bull; <span class="item-summary-note">"${truncatedNote}"</span>`;
    }

    return summary;
}

export async function renderItineraryItem(item, index) {
    const { recordId, type, itemStatus = 'active' } = item;
    const state = _deps.getState();
    const record = _deps.getRecordById(recordId);

    if (!record) return '';

    if (_deps.isItemCombinedSource(recordId)) return '';

    const itemInfo = type === 'favorites' ? state.cart.items.get(recordId) : state.cart.lockedItems.get(recordId);
    const hybridDataForName = _deps.getCombinedHybridData(recordId);
    const name = hybridDataForName?.hybridName || record.fields.Name || 'Untitled Item';
    const selectionsOrIndex = itemInfo?.selections || itemInfo?.selectedOptionIndex;
    const price = _deps.getRecordPrice(record, selectionsOrIndex);
    const quantity = itemInfo?.quantity || 1;
    const note = itemInfo?.note || '';
    const description = record.fields.Description || '';

    const itemStartTime = itemInfo?.itemStartTime || '';
    const itemDuration = itemInfo?.itemDuration || 0;
    const itemEndTime = itemInfo?.itemEndTime || '';
    const itemDate = itemInfo?.itemDate || '';
    let scheduleHTML = '';
    {
        const parts = [];
        if (itemDate) {
            try {
                const d = new Date(itemDate);
                parts.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
            } catch (e) { /* skip invalid date */ }
        }
        if (itemStartTime) {
            let timePart = itemStartTime;
            if (itemEndTime) timePart += ` – ${itemEndTime}`;
            parts.push(timePart);
        }
        if (itemDuration && itemDuration > 0) {
            const h = Math.floor(itemDuration / 60);
            const m = itemDuration % 60;
            const durStr = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
            parts.push(durStr);
        }
        if (parts.length > 0) {
            scheduleHTML = `
                <div class="itinerary-item-schedule">
                    <span class="schedule-icon">🕐</span>
                    <span class="schedule-text">${parts.join(' · ')}</span>
                </div>
            `;
        }
    }

    // Confidence tier
    const isAIItem = recordId.startsWith('custom-') || recordId.startsWith('ai-search-') || recordId.startsWith('ai-group-') || recordId.startsWith('ai-child-');
    const isSolutionItem = recordId.startsWith('solution-') || record.isSolution === true;
    const isManualItem = recordId.startsWith('manual-add-') || recordId.startsWith('manual-presentation-') || record.isManual === true;
    const needsConfidenceStyling = isAIItem || isSolutionItem || isManualItem;

    let itineraryConfidenceClass = '';
    if (needsConfidenceStyling) {
        let confidence;
        if (record._researchData?.confidence != null) confidence = record._researchData.confidence;
        else if (isAIItem) confidence = record._aiConfidence ?? record.fields?._aiConfidence ?? null;
        else if (isSolutionItem && record.solutionData?.confidence) {
            const solutionConfidenceMap = { high: 0.85, medium: 0.6, low: 0.35 };
            confidence = solutionConfidenceMap[record.solutionData.confidence] ?? 0.6;
        } else if (isManualItem) confidence = 0.5;
        else confidence = null;

        if (confidence === null || confidence === undefined) itineraryConfidenceClass = 'confidence-pencil';
        else if (confidence < 0.5) itineraryConfidenceClass = 'confidence-pencil';
        else if (confidence < 0.75) itineraryConfidenceClass = 'confidence-pen';
        else if (confidence < 0.95) itineraryConfidenceClass = 'confidence-typed';
        else itineraryConfidenceClass = 'confidence-premium';
    }

    const selectedOptions = getSelectedOptionsDisplay(record, itemInfo);

    // Fetch images if not cached
    if (!itemImagesCache.has(recordId)) {
        const { imageUrls } = await _deps.api.fetchImagesForRecord(record, state.records.all, new Map());
        const selectedIndex = itemInfo?.selectedImageIndex ?? 0;
        const validIndex = Math.min(selectedIndex, (imageUrls?.length || 1) - 1);
        itemImagesCache.set(recordId, { images: imageUrls || [], currentIndex: validIndex });
    }

    const cachedImages = itemImagesCache.get(recordId);
    const mediaCarouselHTML = createMediaCarousel(cachedImages.images, recordId);

    let typeLabel = type === 'favorites' ? 'Idea' : 'Confirmed';
    let typeClass = type === 'favorites' ? 'item-type-idea' : 'item-type-confirmed';
    if (itemStatus === 'archived') { typeLabel = 'Archived'; typeClass = 'item-type-archived'; }
    else if (itemStatus === 'completed') { typeLabel = 'Completed'; typeClass = 'item-type-completed'; }

    const statusClass = itemStatus !== 'active' ? `item-status-${itemStatus}` : '';
    const isGoal = state.session.goalItems?.has(recordId);
    const goalClass = isGoal ? 'item-status-goal' : '';
    const itemSummary = generateItemSummary(record, itemInfo, type);

    let selectedOptionsHTML = '';
    if (selectedOptions.length > 0) {
        selectedOptionsHTML = `
            <div class="itinerary-item-options">
                ${selectedOptions.map(opt => `
                    <span class="itinerary-item-option-tag">
                        <span class="option-group-label">${opt.groupName}:</span> ${opt.optionName}
                    </span>
                `).join('')}
            </div>
        `;
    }

    const summaryEmoji = _deps.getItemSummaryEmoji(recordId);
    const reactionCount = _deps.getItemReactionCount(recordId);
    const emojiIndicatorHTML = summaryEmoji && reactionCount > 0
        ? `<span class="item-emoji-indicator has-reactions" data-record-id="${recordId}" style="display: inline-flex;"><span class="emoji-indicator-emoji">${summaryEmoji}</span>${reactionCount > 1 ? `<span class="emoji-indicator-count">${reactionCount}</span>` : ''}</span>`
        : `<span class="item-emoji-indicator no-reactions" data-record-id="${recordId}" style="display: inline-flex;" title="Tap to react"><span class="emoji-indicator-emoji">😊</span><span class="emoji-indicator-prompt">React</span></span>`;

    const combinedSources = _deps.getCombinedSources(recordId);
    const hybridData = _deps.getCombinedHybridData(recordId);
    let combinedIndicatorHTML = '';
    let combinedSourcesHTML = '';
    let combinedClass = '';
    if (combinedSources.length > 0) {
        combinedClass = 'is-combined';
        const sourceNames = combinedSources.map(sourceId => {
            const sourceRecord = _deps.getRecordById(sourceId);
            return sourceRecord?.fields?.Name || 'Item';
        });
        const hybridName = hybridData?.hybridName;
        const hybridDesc = hybridData?.hybridDescription;
        const indicatorLabel = hybridName ? `Hybrid` : `${combinedSources.length + 1} combined`;
        combinedIndicatorHTML = `
            <span class="item-combined-indicator ${hybridName ? 'has-hybrid' : ''}" title="${hybridDesc || `Combined from: ${sourceNames.join(', ')}`}">
                <span class="combined-icon">✨</span>
                <span>${indicatorLabel}</span>
            </span>
        `;
        combinedSourcesHTML = `
            <div class="combined-sources-section">
                <div class="combined-sources-header">
                    <button class="combined-sources-toggle" data-record-id="${recordId}">
                        <span>📋</span>
                        <span>Show ${combinedSources.length} combined item${combinedSources.length > 1 ? 's' : ''}</span>
                        <span class="toggle-arrow">▼</span>
                    </button>
                    <button class="uncombine-all-btn" data-target-id="${recordId}" title="Split all items apart">
                        Split All
                    </button>
                </div>
                <div class="combined-sources-list" data-record-id="${recordId}" style="display: none;">
                    ${hybridDesc ? `<div class="combined-hybrid-description rich-text-description">${renderRichText(hybridDesc)}</div>` : ''}
                    ${sourceNames.map((sourceName, idx) => `
                        <div class="combined-source-item" data-source-id="${combinedSources[idx]}">
                            <span>• ${sourceName}</span>
                            <button class="uncombine-source-btn" data-source-id="${combinedSources[idx]}" data-target-id="${recordId}" title="Remove from hybrid">✕</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    const itemGroup = _deps.getItemGroup(recordId);
    let groupIndicatorHTML = '';
    let groupClass = '';
    if (itemGroup) {
        const groupItems = Array.isArray(itemGroup) ? itemGroup : (itemGroup.items || []);
        const groupName = itemGroup.name || `${groupItems.length} Options`;
        const groupDescription = itemGroup.description || '';
        const groupId = itemGroup.id || '';
        groupClass = 'in-group';
        groupIndicatorHTML = `
            <span class="item-group-indicator" title="${groupDescription || `Part of: ${groupName}`}" data-group-id="${groupId}">
                <span class="group-icon">📂</span>
                <span class="group-name">${groupName}</span>
                <span class="group-count">(${groupItems.length})</span>
                <button class="leave-group-btn" data-record-id="${recordId}" data-group-id="${groupId}" title="Remove from group">✕</button>
            </span>
        `;
    }

    const taskStatusButtonHTML = _deps.renderTaskStatusButton('item', recordId);
    const escapeHtml = _deps.escapeHtml;

    return `
        <section class="itinerary-section itinerary-item-section ${statusClass} ${goalClass} ${combinedClass} ${groupClass} ${itineraryConfidenceClass}" data-section="item-${recordId}" data-item-status="${itemStatus}" data-is-goal="${isGoal}">
            <article class="itinerary-item item-accordion expanded ${itineraryConfidenceClass}" data-record-id="${recordId}" data-index="${index}" data-item-name="${escapeHtml(name)}">
                <div class="item-accordion-header" data-record-id="${recordId}">
                    <div class="item-accordion-title-row">
                        ${taskStatusButtonHTML}
                        <h3 class="item-accordion-title">${name}</h3>
                        ${emojiIndicatorHTML}
                        ${combinedIndicatorHTML}
                        ${groupIndicatorHTML}
                        <span class="itinerary-item-type ${typeClass}">${typeLabel}</span>
                        <span class="item-accordion-icon"></span>
                    </div>
                    <p class="item-accordion-summary">${itemSummary}</p>
                </div>
                <div class="item-accordion-content itinerary-item-clickable">
                    <div class="itinerary-item-content">
                        ${mediaCarouselHTML}
                        <div class="itinerary-item-details">
                            <div class="itinerary-item-price-qty">
                                <span class="itinerary-item-price">$${price.toFixed(2)}</span>
                                ${quantity > 1 ? `<span class="itinerary-item-qty">× ${quantity}</span>` : ''}
                            </div>
                            ${scheduleHTML}
                            ${description ? `<div class="itinerary-item-description rich-text-description">${renderRichText(description)}</div>` : ''}
                            ${selectedOptionsHTML}
                            ${note ? `<div class="itinerary-item-note"><strong>Note:</strong> ${note}</div>` : ''}
                            ${combinedSourcesHTML}
                            <div class="itinerary-item-reactions" data-record-id="${recordId}"></div>
                            <button class="itinerary-item-expand-btn" data-record-id="${recordId}" title="View full details">
                                <span class="expand-btn-icon">↗</span>
                                <span class="expand-btn-text">More Details</span>
                            </button>
                        </div>
                    </div>
                    <div class="component-comments-section" data-component-type="item" data-component-id="${recordId}">
                        <div class="component-comments-header">
                            <button class="component-comments-toggle" data-component-id="${recordId}" title="Show comments">
                                <span class="comments-icon">💬</span>
                                <span class="comments-count" data-component-id="${recordId}">0</span>
                                <span class="comments-label">Add a comment</span>
                                <span class="comments-toggle-icon">▼</span>
                            </button>
                        </div>
                        <div class="component-comments-body" data-component-id="${recordId}" style="display: none;">
                            <div class="component-comments-list" data-component-id="${recordId}"></div>
                            <div class="component-comment-input-wrapper">
                                <div class="comment-image-preview" data-component-id="${recordId}" style="display: none;">
                                    <img class="comment-preview-thumbnail" src="" alt="Preview" />
                                    <button class="comment-preview-remove" data-component-id="${recordId}" title="Remove image">×</button>
                                </div>
                                <div class="comment-input-row">
                                    <input type="file" class="comment-image-input" data-component-id="${recordId}" accept="image/*" style="display: none;" />
                                    <button class="comment-image-btn" data-component-id="${recordId}" title="Attach image"><span>📷</span></button>
                                    <input type="text" class="component-comment-input" data-component-id="${recordId}" placeholder="Add a comment..." />
                                    <button class="component-comment-submit" data-component-id="${recordId}" title="Post comment"><span>→</span></button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </article>
        </section>
    `;
}

export function getCompactCardSourceType(recordId, record) {
    if (recordId.startsWith('custom-') || recordId.startsWith('ai-search-') || recordId.startsWith('ai-group-') || recordId.startsWith('ai-child-')) {
        return { key: 'ai', label: 'AI Suggested', icon: '🤖' };
    }
    if (recordId.startsWith('solution-') || record?.isSolution === true) {
        return { key: 'solution', label: 'Solution', icon: '💡' };
    }
    if (recordId.startsWith('manual-add-') || recordId.startsWith('manual-presentation-') || record?.isManual === true) {
        return { key: 'manual', label: 'Manually Added', icon: '✏️' };
    }
    return { key: 'catalog', label: 'From Catalog', icon: '📋' };
}

export async function renderCompactCard(item) {
    const { recordId, type, itemStatus = 'active' } = item;
    const state = _deps.getState();
    let record = _deps.getRecordById(recordId);
    if (!record) {
        const solutionRec = window._solutionRecords?.get(recordId);
        const cartInfo = state.cart.lockedItems.get(recordId) || state.cart.items.get(recordId);
        if (solutionRec) {
            record = solutionRec;
        } else if (cartInfo && cartInfo._recordSnapshot) {
            record = cartInfo._recordSnapshot;
        } else if (cartInfo) {
            record = {
                id: recordId,
                fields: {
                    Name: cartInfo.name || cartInfo.itemName || 'Custom Item',
                    Description: cartInfo.description || '',
                    _customImages: cartInfo._customImages || [],
                    _hasAIGeneratedImage: cartInfo._hasAIGeneratedImage || false,
                },
                isManual: recordId.startsWith('manual-'),
                isSolution: recordId.startsWith('solution-'),
            };
        }
        if (!record) return '';
    }

    if (_deps.isItemCombinedSource(recordId)) return '';

    const itemInfo = type === 'favorites' ? state.cart.items.get(recordId) : state.cart.lockedItems.get(recordId);
    const hybridDataForName = _deps.getCombinedHybridData(recordId);
    const name = hybridDataForName?.hybridName || record.fields?.Name || 'Untitled Item';

    // Confidence tier
    const isAIItem = recordId.startsWith('custom-') || recordId.startsWith('ai-search-') || recordId.startsWith('ai-group-') || recordId.startsWith('ai-child-');
    const isSolutionItem = recordId.startsWith('solution-') || record.isSolution === true;
    const isManualItem = recordId.startsWith('manual-add-') || recordId.startsWith('manual-presentation-') || record.isManual === true;
    const needsConfidenceStyling = isAIItem || isSolutionItem || isManualItem;

    let confidenceClass = '';
    if (needsConfidenceStyling) {
        let confidence;
        if (record._researchData?.confidence != null) confidence = record._researchData.confidence;
        else if (isAIItem) confidence = record._aiConfidence ?? record.fields?._aiConfidence ?? null;
        else if (isSolutionItem && record.solutionData?.confidence) {
            const solutionConfidenceMap = { high: 0.85, medium: 0.6, low: 0.35 };
            confidence = solutionConfidenceMap[record.solutionData.confidence] ?? 0.6;
        } else if (isManualItem) confidence = 0.5;
        else confidence = null;

        if (confidence === null || confidence === undefined) confidenceClass = 'confidence-pencil';
        else if (confidence < 0.5) confidenceClass = 'confidence-pencil';
        else if (confidence < 0.75) confidenceClass = 'confidence-pen';
        else if (confidence < 0.95) confidenceClass = 'confidence-typed';
        else confidenceClass = 'confidence-premium';
    }

    // Status classes
    const isGoal = state.session.goalItems?.has(recordId);
    const isArchived = state.session.archivedItems?.has(recordId);
    const isCompleted = state.session.completedItems?.has(recordId);
    const isLocked = state.cart.lockedItems.has(recordId);

    let lifecycleClass = 'compact-card-idea';
    if (isArchived) lifecycleClass = 'compact-card-archived';
    else if (isCompleted) lifecycleClass = 'compact-card-completed';
    else if (isLocked) lifecycleClass = 'compact-card-locked';
    else if (isGoal) lifecycleClass = 'compact-card-goal';

    // Photo
    if (!itemImagesCache.has(recordId)) {
        const { imageUrls } = await _deps.api.fetchImagesForRecord(record, state.records.all, new Map());
        const selectedIndex = itemInfo?.selectedImageIndex ?? 0;
        const validIndex = Math.min(selectedIndex, (imageUrls?.length || 1) - 1);
        itemImagesCache.set(recordId, { images: imageUrls || [], currentIndex: validIndex });
    }
    const cachedImages = itemImagesCache.get(recordId);
    const photoUrl = cachedImages?.images?.[cachedImages.currentIndex] || cachedImages?.images?.[0] || '';
    const optimizedPhoto = photoUrl ? _deps.applyCloudinaryTransform(photoUrl, 'w_400,h_250,c_fit,f_auto,q_auto') : '';

    // Task status overlay
    const taskStatus = _deps.getElementTaskStatus('item', recordId);
    const taskConfig = _deps.TASK_STATUS_CONFIG[taskStatus] || _deps.TASK_STATUS_CONFIG[_deps.ELEMENT_TASK_STATUS.NONE];
    const showStatus = taskStatus !== _deps.ELEMENT_TASK_STATUS.NONE;
    const statusOverlayHTML = showStatus
        ? `<span class="compact-card-status ${taskConfig.className}" title="${taskConfig.label}"><span class="task-status-icon">${taskConfig.icon}</span> ${taskConfig.label}</span>`
        : '';

    // Summary emoji overlay
    const summaryEmoji = _deps.getItemSummaryEmoji(recordId);
    const reactionCount = _deps.getItemReactionCount(recordId);
    const rankingTooltip = _deps.reactionRankings.getItemRankingTooltip(recordId);
    const escapeHtml = _deps.escapeHtml;
    const emojiOverlayHTML = summaryEmoji && reactionCount > 0
        ? `<span class="compact-card-emoji item-emoji-indicator has-reactions" data-record-id="${recordId}" title="${escapeHtml(rankingTooltip)}">${summaryEmoji}${reactionCount > 1 ? `<span class="compact-card-emoji-count">${reactionCount}</span>` : ''}</span>`
        : '';

    // Provenance line (combined items)
    const combinedSources = _deps.getCombinedSources(recordId);
    let provenanceHTML = '';
    if (combinedSources.length > 0) {
        const sourceNames = combinedSources.map(sourceId => {
            const sourceRecord = _deps.getRecordById(sourceId);
            return sourceRecord?.fields?.Name || 'Item';
        });
        const sourceTypeBadges = combinedSources.map(sourceId => {
            const sourceRecord = _deps.getRecordById(sourceId);
            const srcType = getCompactCardSourceType(sourceId, sourceRecord);
            return `<span class="provenance-source-badge provenance-source-${srcType.key}" title="${escapeHtml((sourceRecord?.fields?.Name || 'Item') + ' (' + srcType.label + ')')}">${srcType.icon} ${escapeHtml(sourceRecord?.fields?.Name || 'Item')}</span>`;
        });
        const displayBadges = sourceTypeBadges.length <= 3
            ? sourceTypeBadges.join('')
            : sourceTypeBadges.slice(0, 3).join('') + `<span class="provenance-source-badge provenance-source-more">+${sourceTypeBadges.length - 3}</span>`;
        const hybridData = _deps.getCombinedHybridData(recordId);
        const hybridLabel = hybridData?.hybridName ? '<span class="provenance-hybrid-icon" title="Hybrid item">✨</span>' : '';
        provenanceHTML = `<div class="compact-card-provenance" title="${escapeHtml(sourceNames.join(' + '))}">${hybridLabel}<span class="provenance-label">Merged:</span> ${displayBadges}<button class="compact-card-split-btn compact-card-split-hybrid" data-target-id="${recordId}" title="Split hybrid apart">✂</button></div>`;
    }

    // Goal indicator
    const goalBadgeHTML = isGoal ? '<span class="compact-card-goal-badge" title="Goal">⭐</span>' : '';

    // Lifecycle badge
    let lifecycleBadgeIcon = '';
    let lifecycleBadgeLabel = '';
    let lifecycleBadgeClass = '';
    if (isArchived) { lifecycleBadgeIcon = '📦'; lifecycleBadgeLabel = 'Archived'; lifecycleBadgeClass = 'lifecycle-archived'; }
    else if (isCompleted) { lifecycleBadgeIcon = '✓'; lifecycleBadgeLabel = 'Done'; lifecycleBadgeClass = 'lifecycle-completed'; }
    else if (isLocked) { lifecycleBadgeIcon = '🔒'; lifecycleBadgeLabel = 'Confirmed'; lifecycleBadgeClass = 'lifecycle-locked'; }
    else if (isGoal) { lifecycleBadgeIcon = '⭐'; lifecycleBadgeLabel = 'Goal'; lifecycleBadgeClass = 'lifecycle-goal'; }
    const lifecycleBadgeHTML = lifecycleBadgeClass
        ? `<span class="compact-card-lifecycle-badge ${lifecycleBadgeClass}">${lifecycleBadgeIcon} ${lifecycleBadgeLabel}</span>`
        : '';

    // Source type badge
    const sourceType = getCompactCardSourceType(recordId, record);
    const sourceTypeBadgeHTML = sourceType.key !== 'catalog'
        ? `<span class="compact-card-source-badge source-badge-${sourceType.key}" title="${sourceType.label}">${sourceType.icon}</span>`
        : '';

    // Type label
    let typeLabel = type === 'favorites' ? 'Idea' : 'Confirmed';
    if (itemStatus === 'archived') typeLabel = 'Archived';
    else if (itemStatus === 'completed') typeLabel = 'Completed';

    // Variation / option pills
    const itemGroup = _deps.getItemGroup(recordId);
    let pillsHTML = '';
    if (itemGroup) {
        const groupItems = Array.isArray(itemGroup) ? itemGroup : (itemGroup.items || []);
        const otherItems = groupItems.filter(gId => gId !== recordId);
        const pillNames = otherItems.slice(0, 2).map(gId => {
            const gRec = _deps.getRecordById(gId);
            return gRec?.fields?.Name || 'Option';
        });
        const pillElements = pillNames.map(pn => `<span class="compact-card-pill">${escapeHtml(pn)}</span>`).join('');
        const moreCount = otherItems.length - 2;
        const morePill = moreCount > 0 ? `<span class="compact-card-pill compact-card-pill-more">+${moreCount} more</span>` : '';
        pillsHTML = `<div class="compact-card-pills">${pillElements}${morePill}</div>`;
    }

    // Reaction zone summary
    const reactions = _deps.getAggregateReactions(recordId);
    try {
        const commentReactions = _deps.getComponentMessageReactions(recordId);
        if (commentReactions && commentReactions.size > 0) {
            for (const [userId, emojiSet] of commentReactions) {
                if (!reactions.has(userId)) reactions.set(userId, new Set());
                const userSet = reactions.get(userId);
                for (const emoji of emojiSet) userSet.add(emoji);
            }
        }
    } catch (e) { /* comment reactions may not be available during early init */ }

    let reactionZoneSummaryEmoji = '😊';
    let reactionZoneScoreText = '';
    let reactionZoneSummaryText = 'React';
    let rzReactionCount = 0;
    if (reactions && reactions instanceof Map && reactions.size > 0) {
        const { democraticAverage, summaryEmoji: bestEmoji, totalReactions } = _deps.computeDemocraticAverage(reactions);
        rzReactionCount = totalReactions;
        const emojiCounts = {};
        reactions.forEach((emojiData) => {
            const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
            for (const emoji of emojis) {
                emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1;
            }
        });
        reactionZoneSummaryEmoji = bestEmoji;
        reactionZoneScoreText = `${democraticAverage >= 0 ? '+' : ''}${democraticAverage.toFixed(1)}`;
        const sorted = Object.entries(emojiCounts).sort((a, b) => b[1] - a[1]);
        const top3 = sorted.slice(0, 3).map(([emoji, count]) => `${emoji}${count > 1 ? count : ''}`).join(' ');
        reactionZoneSummaryText = `${rzReactionCount} reaction${rzReactionCount !== 1 ? 's' : ''} ${top3}`;
    }

    // Comment count
    const commentCacheKey = `item:${recordId}`;
    const cachedComments = _deps.componentComments.getCache().get(commentCacheKey);
    const commentCount = cachedComments?.length || 0;
    const commentsBtnHTML = `<button class="reaction-zone-comments-btn" data-record-id="${recordId}" data-component-id="${recordId}" title="${commentCount > 0 ? commentCount + ' comment' + (commentCount !== 1 ? 's' : '') : 'Add a comment'}"><span class="reaction-zone-comments-icon">💬</span><span>${commentCount || ''}</span></button>`;

    // Task status badge
    const taskStatusForBadge = _deps.getElementTaskStatus('item', recordId);
    const taskConfigForBadge = _deps.TASK_STATUS_CONFIG[taskStatusForBadge] || _deps.TASK_STATUS_CONFIG[_deps.ELEMENT_TASK_STATUS.NONE];
    const showTaskBadge = taskStatusForBadge !== _deps.ELEMENT_TASK_STATUS.NONE;
    const taskBadgeHTML = showTaskBadge
        ? `<span class="compact-badge-pill compact-badge-task ${taskConfigForBadge.className}" title="${taskConfigForBadge.label}"><span class="compact-badge-icon">${taskConfigForBadge.icon}</span><span class="compact-badge-label">${taskConfigForBadge.label}</span></span>`
        : '';

    // Time badge
    let timeBadgeHTML = '';
    if (itemInfo) {
        const startT = itemInfo.itemStartTime;
        const endT = itemInfo.itemEndTime;
        const dur = itemInfo.itemDuration;
        const itemDateVal = itemInfo.itemDate;
        const catalogDurHours = parseFloat(record.fields?.['Duration (hours)'] || 0);
        const catalogDurMin = Math.round(catalogDurHours * 60);
        const effectiveDur = dur || catalogDurMin;

        const fmtDate = (iso) => {
            if (!iso) return '';
            try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; }
        };

        let dateCtx = '';
        if (itemDateVal) dateCtx = fmtDate(itemDateVal);

        if (startT || effectiveDur) {
            let timeText = '';
            let timeTooltip = '';
            if (startT && endT) {
                timeText = `${startT} - ${endT}`;
                timeTooltip = dateCtx ? `${dateCtx}: ${startT} - ${endT}` : `${startT} - ${endT}`;
            } else if (startT) {
                timeText = startT;
                timeTooltip = dateCtx ? `${dateCtx} at ${startT}` : `Starts ${startT}`;
            } else if (effectiveDur) {
                const hrs = Math.floor(effectiveDur / 60);
                const mins = effectiveDur % 60;
                timeText = hrs > 0 ? `${hrs}h${mins > 0 ? `${mins}m` : ''}` : `${mins}m`;
                timeTooltip = `Duration: ${timeText}${dur ? ' (custom)' : ''}`;
            }
            if (timeText) {
                timeBadgeHTML = `<span class="compact-badge-pill compact-badge-time" title="${escapeHtml(timeTooltip)}"><span class="compact-badge-icon">🕐</span><span class="compact-badge-label">${escapeHtml(timeText)}</span></span>`;
            }
        }
    }

    // Photo section
    const photoStyle = optimizedPhoto ? `background-image: url('${optimizedPhoto}')` : '';
    const noPhotoClass = !optimizedPhoto ? 'compact-card-no-photo' : '';

    // Price badge
    let priceBadgeHTML = '';
    if (itemInfo) {
        const priceParam = (itemInfo.selections && Object.keys(itemInfo.selections).length > 0) ? itemInfo.selections : itemInfo.selectedOptionIndex;
        let unitPrice = itemInfo.overridePrice ?? _deps.getRecordPrice(record, priceParam);
        if (!isNaN(unitPrice) && unitPrice > 0) {
            const effectiveQuantity = Math.max(parseFloat(itemInfo.quantity) || 1, 1);
            const totalPrice = unitPrice * effectiveQuantity;
            const priceText = effectiveQuantity > 1
                ? `$${totalPrice.toFixed(0)} (${effectiveQuantity}x)`
                : `$${unitPrice % 1 === 0 ? unitPrice.toFixed(0) : unitPrice.toFixed(2)}`;
            priceBadgeHTML = `<span class="compact-card-price">${priceText}</span>`;
        } else if (unitPrice === 0) {
            priceBadgeHTML = `<span class="compact-card-price price-free">Free</span>`;
        }
    }

    // Vitality emoji
    const compactVitalityScores = state.vitality?.itemScores?.get(recordId);
    const compactVitalityEmoji = compactVitalityScores?.goodnessEmoji || compactVitalityScores?.netEmoji || '';
    const compactGoodnessLabel = compactVitalityScores?.goodnessLabel || compactVitalityScores?.netLabel || 'Neutral';
    const compactVitalityHTML = compactVitalityEmoji ? `<span class="compact-card-vitality" title="Goodness: ${compactGoodnessLabel} (click for details)">${compactVitalityEmoji}</span>` : '';

    return `
        <div class="compact-card ${lifecycleClass} ${confidenceClass} ${noPhotoClass}" data-record-id="${recordId}" data-item-type="${type}" data-item-status="${itemStatus}" role="article" tabindex="0" aria-label="${escapeHtml(name)}${showStatus ? ', ' + taskConfig.label : ''}">
            <div class="compact-card-photo" style="${photoStyle}">
                ${statusOverlayHTML}
                ${emojiOverlayHTML}
                ${lifecycleBadgeHTML}
                <span class="compact-card-valuation">${priceBadgeHTML}${compactVitalityHTML}</span>
            </div>
            <div class="compact-card-body">
                <div class="compact-card-title-row">
                    ${goalBadgeHTML}
                    <h4 class="compact-card-name" title="${escapeHtml(name)}">${escapeHtml(name)}</h4>
                    ${sourceTypeBadgeHTML}
                </div>
                ${provenanceHTML}
                ${pillsHTML}
                <div class="compact-card-reaction-zone" data-record-id="${recordId}">
                    <div class="reaction-zone-hint">
                        <div class="reaction-zone-summary" data-record-id="${recordId}">
                            <span class="reaction-zone-summary-emoji">${reactionZoneSummaryEmoji}</span>
                            <span class="reaction-zone-summary-text">${reactionZoneSummaryText}</span>
                            ${reactionZoneScoreText ? `<span class="reaction-zone-summary-score">${reactionZoneScoreText}</span>` : ''}
                        </div>
                        <div class="reaction-zone-actions">
                            ${timeBadgeHTML}
                            ${taskBadgeHTML}
                            ${commentsBtnHTML}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export async function renderCompactGroupCard(group) {
    const state = _deps.getState();
    const groupItems = Array.isArray(group) ? group : (group.items || []);
    const groupName = group.name || `${groupItems.length} Options`;
    const groupId = group.id || '';
    const escapeHtml = _deps.escapeHtml;

    const firstItemId = groupItems[0];
    const firstRecord = _deps.getRecordById(firstItemId);
    if (!firstRecord) return '';

    if (!itemImagesCache.has(firstItemId)) {
        const { imageUrls } = await _deps.api.fetchImagesForRecord(firstRecord, state.records.all, new Map());
        itemImagesCache.set(firstItemId, { images: imageUrls || [], currentIndex: 0 });
    }
    const cachedImages = itemImagesCache.get(firstItemId);
    const photoUrl = cachedImages?.images?.[0] || '';
    const optimizedPhoto = photoUrl ? _deps.applyCloudinaryTransform(photoUrl, 'w_400,h_250,c_fit,f_auto,q_auto') : '';

    // Member name pills
    const maxPills = Math.min(groupItems.length, 4);
    const memberPills = groupItems.slice(0, maxPills).map(gId => {
        const gRec = _deps.getRecordById(gId);
        const memberName = escapeHtml(gRec?.fields?.Name || 'Option');
        const isGoal = state.session.goalItems?.has(gId);
        const isArchived = state.session.archivedItems?.has(gId);
        const isCompleted = state.session.completedItems?.has(gId);
        const isLocked = state.cart.lockedItems.has(gId);
        let pillStateClass = '';
        let pillIcon = '';
        if (isArchived) { pillStateClass = 'pill-archived'; pillIcon = '📦 '; }
        else if (isCompleted) { pillStateClass = 'pill-completed'; pillIcon = '✓ '; }
        else if (isLocked) { pillStateClass = 'pill-locked'; pillIcon = '🔒 '; }
        else if (isGoal) { pillStateClass = 'pill-goal'; pillIcon = '⭐ '; }
        return `<span class="compact-card-pill ${pillStateClass}">${pillIcon}${memberName}</span>`;
    }).join('');
    const moreCount = groupItems.length - maxPills;
    const morePill = moreCount > 0 ? `<span class="compact-card-pill compact-card-pill-more">+${moreCount} more</span>` : '';

    // Aggregate lifecycle
    let lockedCount = 0, goalCount = 0, archivedCount = 0, completedCount = 0;
    for (const gId of groupItems) {
        if (state.session.archivedItems?.has(gId)) archivedCount++;
        else if (state.session.completedItems?.has(gId)) completedCount++;
        else if (state.cart.lockedItems.has(gId)) lockedCount++;
        else if (state.session.goalItems?.has(gId)) goalCount++;
    }
    let groupStatusHTML = '';
    const statusParts = [];
    if (lockedCount > 0) statusParts.push(`<span class="group-status-chip group-chip-locked">🔒 ${lockedCount}</span>`);
    if (goalCount > 0) statusParts.push(`<span class="group-status-chip group-chip-goal">⭐ ${goalCount}</span>`);
    if (completedCount > 0) statusParts.push(`<span class="group-status-chip group-chip-completed">✓ ${completedCount}</span>`);
    if (archivedCount > 0) statusParts.push(`<span class="group-status-chip group-chip-archived">📦 ${archivedCount}</span>`);
    if (statusParts.length > 0) groupStatusHTML = `<div class="compact-card-group-status">${statusParts.join('')}</div>`;

    const firstItemType = state.cart.lockedItems.has(firstItemId) ? 'locked' : 'favorites';

    let groupLifecycleClass = '';
    if (lockedCount === groupItems.length) groupLifecycleClass = 'compact-card-locked';
    else if (completedCount === groupItems.length) groupLifecycleClass = 'compact-card-completed';
    else if (archivedCount === groupItems.length) groupLifecycleClass = 'compact-card-archived';
    else if (goalCount > 0 && lockedCount === 0) groupLifecycleClass = 'compact-card-goal';

    // Aggregate comment count
    let groupCommentCount = 0;
    for (const gId of groupItems) {
        const memberComments = _deps.componentComments.getCache().get(`item:${gId}`);
        groupCommentCount += memberComments?.length || 0;
    }
    const groupCommentBadgeHTML = groupCommentCount > 0
        ? `<span class="compact-badge-pill compact-badge-comment" title="${groupCommentCount} comment${groupCommentCount !== 1 ? 's' : ''} across group"><span class="compact-badge-icon">💬</span><span class="compact-badge-count">${groupCommentCount}</span></span>`
        : '';

    // Aggregate task status
    const taskStatusCounts = {};
    for (const gId of groupItems) {
        const memberTaskStatus = _deps.getElementTaskStatus('item', gId);
        if (memberTaskStatus !== _deps.ELEMENT_TASK_STATUS.NONE) {
            taskStatusCounts[memberTaskStatus] = (taskStatusCounts[memberTaskStatus] || 0) + 1;
        }
    }
    let groupTaskBadgeHTML = '';
    const taskEntries = Object.entries(taskStatusCounts);
    if (taskEntries.length > 0) {
        groupTaskBadgeHTML = taskEntries.map(([status, count]) => {
            const config = _deps.TASK_STATUS_CONFIG[status] || _deps.TASK_STATUS_CONFIG[_deps.ELEMENT_TASK_STATUS.NONE];
            return `<span class="compact-badge-pill compact-badge-task ${config.className}" title="${config.label}: ${count}"><span class="compact-badge-icon">${config.icon}</span><span class="compact-badge-count">${count}</span></span>`;
        }).join('');
    }

    // Aggregate reactions
    const groupMergedReactions = new Map();
    const groupEmojiCounts = {};
    let groupTotalReactions = 0;
    for (const gId of groupItems) {
        const memberReactions = _deps.getAggregateReactions(gId);
        if (memberReactions && memberReactions.size > 0) {
            for (const [userId, emojiSet] of memberReactions) {
                if (!groupMergedReactions.has(userId)) groupMergedReactions.set(userId, new Set());
                const userSet = groupMergedReactions.get(userId);
                for (const emoji of emojiSet) {
                    userSet.add(emoji);
                    groupEmojiCounts[emoji] = (groupEmojiCounts[emoji] || 0) + 1;
                    groupTotalReactions++;
                }
            }
        }
        try {
            const memberCommentReactions = _deps.getComponentMessageReactions(gId);
            if (memberCommentReactions && memberCommentReactions.size > 0) {
                for (const [userId, emojiSet] of memberCommentReactions) {
                    if (!groupMergedReactions.has(userId)) groupMergedReactions.set(userId, new Set());
                    const userSet = groupMergedReactions.get(userId);
                    for (const emoji of emojiSet) {
                        userSet.add(emoji);
                        groupEmojiCounts[emoji] = (groupEmojiCounts[emoji] || 0) + 1;
                        groupTotalReactions++;
                    }
                }
            }
        } catch (e) { /* comment reactions may not be available */ }
    }

    let groupSummaryEmoji = '';
    let groupSummaryScore = '';
    if (groupMergedReactions.size > 0) {
        const { democraticAverage, summaryEmoji } = _deps.computeDemocraticAverage(groupMergedReactions);
        groupSummaryEmoji = summaryEmoji;
        groupSummaryScore = `${democraticAverage >= 0 ? '+' : ''}${democraticAverage.toFixed(1)}`;
    }

    let groupReactionBarHTML = '';
    if (groupTotalReactions > 0) {
        const sortedGroupEmoji = Object.entries(groupEmojiCounts).sort((a, b) => b[1] - a[1]);
        const top3Group = sortedGroupEmoji.slice(0, 3).map(([emoji, count]) =>
            `<span class="compact-reaction-pill" title="${emoji} ${count}">${emoji}<span class="compact-reaction-count">${count}</span></span>`
        ).join('');
        const moreGroupReactions = sortedGroupEmoji.length > 3 ? `<span class="compact-reaction-pill compact-reaction-overflow">+${sortedGroupEmoji.length - 3}</span>` : '';
        const summaryPill = groupSummaryEmoji
            ? `<span class="compact-reaction-pill compact-reaction-summary" title="Group sentiment: ${groupSummaryEmoji} (${groupSummaryScore})">${groupSummaryEmoji}<span class="compact-reaction-score">${groupSummaryScore}</span></span>`
            : '';
        groupReactionBarHTML = `<span class="compact-card-reactions" title="${groupTotalReactions} reaction${groupTotalReactions !== 1 ? 's' : ''} across group">${summaryPill}${top3Group}${moreGroupReactions}</span>`;
    }

    const hasGroupMeta = groupReactionBarHTML || groupTaskBadgeHTML || groupCommentBadgeHTML;
    const groupMetaHTML = hasGroupMeta ? `
                <div class="compact-card-meta">
                    ${groupReactionBarHTML}
                    <span class="compact-card-badges">
                        ${groupTaskBadgeHTML}
                        ${groupCommentBadgeHTML}
                    </span>
                </div>` : '';

    const photoStyle = optimizedPhoto ? `background-image: url('${optimizedPhoto}')` : '';
    const noPhotoClass = !optimizedPhoto ? 'compact-card-no-photo' : '';

    return `
        <div class="compact-card compact-card-group ${groupLifecycleClass} ${noPhotoClass}" data-group-id="${groupId}" data-item-type="${firstItemType}" role="article" tabindex="0" aria-label="${escapeHtml(groupName)}, ${groupItems.length} options">
            <div class="compact-card-photo" style="${photoStyle}">
                <span class="compact-card-group-badge">${groupItems.length} options</span>
            </div>
            <div class="compact-card-body">
                <div class="compact-card-title-row">
                    <h4 class="compact-card-name" title="${escapeHtml(groupName)}">${escapeHtml(groupName)}</h4>
                    <button class="compact-card-split-btn" data-group-id="${groupId}" title="Split group apart">✂</button>
                </div>
                ${groupStatusHTML}
                <div class="compact-card-pills">${memberPills}${morePill}</div>
                ${groupMetaHTML}
            </div>
        </div>
    `;
}

export function scheduleRenderAllItems() {
    if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
    renderDebounceTimer = setTimeout(() => {
        renderDebounceTimer = null;
        renderAllItems();
    }, 150);
}

export async function renderAllItems() {
    const state = _deps.getState();
    const PRES_DEBUG = typeof window !== 'undefined' && window.__PRES_DEBUG__;

    const itineraryItemsListEl = _deps.getItineraryItemsListEl();
    if (!itineraryItemsListEl) return;

    const favorites = Array.from(state.cart.items.keys()).map(id => ({ recordId: id, type: 'favorites' }));
    const locked = Array.from(state.cart.lockedItems.keys()).map(id => ({ recordId: id, type: 'locked' }));
    let combinedList = [...locked, ...favorites];

    const archivedItems = state.session.archivedItems || new Set();
    const completedItems = state.session.completedItems || new Set();

    combinedList = combinedList.map(item => {
        let itemStatus = 'active';
        if (archivedItems.has(item.recordId)) itemStatus = 'archived';
        else if (completedItems.has(item.recordId)) itemStatus = 'completed';
        return { ...item, itemStatus };
    });

    combinedList = combinedList.filter(item => {
        if (item.itemStatus === 'archived' && !showArchivedItems) return false;
        if (item.itemStatus === 'completed' && !showCompletedItems) return false;
        return true;
    });

    const customOrder = state.session.planItemOrder || [];
    if (customOrder.length > 0) {
        const orderMap = new Map(customOrder.map((id, index) => [id, index]));
        combinedList.sort((a, b) => {
            const orderA = orderMap.has(a.recordId) ? orderMap.get(a.recordId) : Infinity;
            const orderB = orderMap.has(b.recordId) ? orderMap.get(b.recordId) : Infinity;
            return orderA - orderB;
        });
    }

    const archivedCount = archivedItems.size;
    const completedCount = completedItems.size;
    updateStatusToggles(archivedCount, completedCount);

    if (combinedList.length === 0) {
        // Surface the store's recommended pillars as browse suggestions when defined;
        // otherwise fall back to the original default component set.
        const storePillars = getActiveStorePillars();
        const allCategories = storePillars.length > 0
            ? storePillars
            : ["Activities", "Food & Drink", "Venues", "Extras"];
        const categoryIcons = { "Activities": "🎯", "Food & Drink": "🍽️", "Venues": "📍", "Extras": "✨" };
        let emptyStateHTML = `
            <section class="itinerary-section itinerary-empty-section" data-section="empty" role="status" aria-label="Empty plan board">
                <div class="presentation-empty-state board-empty-state">
                    <div class="board-empty-icon" aria-hidden="true">📋</div>
                    <p class="itinerary-empty-title">Your Plan Board is Empty</p>
                    <p class="itinerary-empty-subtitle">Start by browsing items from a category below, or use the search to find something specific.</p>
                    <div class="presentation-suggestions" role="group" aria-label="Category suggestions">
        `;
        allCategories.forEach(cat => {
            const filterTag = cat.toLowerCase().replace(/\s+/g, ' ');
            const icon = categoryIcons[cat] || '📦';
            emptyStateHTML += `
                <button class="filter-btn presentation-suggestion-btn" data-category-filter="${filterTag}" aria-label="Browse ${cat}">
                    <span class="suggestion-btn-icon" aria-hidden="true">${icon}</span>
                    <span class="suggestion-btn-text">${cat}</span>
                </button>
            `;
        });
        emptyStateHTML += `
                    </div>
                    <p class="board-empty-hint">Tip: Swipe horizontally on any card to access quick actions</p>
                </div>
            </section>
        `;
        itineraryItemsListEl.innerHTML = emptyStateHTML;
        return;
    }

    const showSingleItemNudge = combinedList.length === 1;
    itineraryItemsListEl.classList.add('board-view');
    itineraryItemsListEl.setAttribute('role', 'list');
    itineraryItemsListEl.setAttribute('aria-label', 'Plan board items');

    // Pre-fetch all uncached images in parallel before rendering cards
    const uncachedItems = [];
    const relatedGroups = state.session.relatedGroups || [];
    const itemToGroupMap = new Map();
    for (const g of relatedGroups) {
        const gItems = Array.isArray(g) ? g : (g.items || []);
        for (const gId of gItems) itemToGroupMap.set(gId, g);
    }

    // Collect all record IDs that need image fetching (items + group lead images)
    const seenGroupIds = new Set();
    for (const item of combinedList) {
        const group = itemToGroupMap.get(item.recordId);
        if (group && group.id && !seenGroupIds.has(group.id)) {
            seenGroupIds.add(group.id);
            const groupItems = Array.isArray(group) ? group : (group.items || []);
            const firstItemId = groupItems[0];
            if (firstItemId && !itemImagesCache.has(firstItemId)) {
                const firstRecord = _deps.getRecordById(firstItemId);
                if (firstRecord) {
                    uncachedItems.push({ recordId: firstItemId, record: firstRecord, selectedImageIndex: 0 });
                }
            }
        } else if (!group || !group.id) {
            if (!itemImagesCache.has(item.recordId)) {
                const record = _deps.getRecordById(item.recordId);
                if (record) {
                    const itemInfo = item.type === 'favorites' ? state.cart.items.get(item.recordId) : state.cart.lockedItems.get(item.recordId);
                    uncachedItems.push({ recordId: item.recordId, record, selectedImageIndex: itemInfo?.selectedImageIndex ?? 0 });
                }
            }
        }
    }

    // Fetch all uncached images in parallel (batch of up to 10 concurrent)
    if (uncachedItems.length > 0) {
        const BATCH_SIZE = 10;
        for (let i = 0; i < uncachedItems.length; i += BATCH_SIZE) {
            const batch = uncachedItems.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async ({ recordId, record, selectedImageIndex }) => {
                try {
                    const { imageUrls } = await _deps.api.fetchImagesForRecord(record, state.records.all, new Map());
                    const validIndex = Math.min(selectedImageIndex, (imageUrls?.length || 1) - 1);
                    itemImagesCache.set(recordId, { images: imageUrls || [], currentIndex: validIndex });
                } catch (err) {
                    itemImagesCache.set(recordId, { images: [], currentIndex: 0 });
                }
            }));
        }
    }

    const renderedGroupIds = new Set();
    const itemsHTML = [];

    let lastSection = null;
    const activeLockedItems = combinedList.filter(item => item.itemStatus === 'active' && item.type === 'locked');
    const activeIdeaItems = combinedList.filter(item => item.itemStatus === 'active' && item.type === 'favorites');
    const archivedVisibleItems = combinedList.filter(item => item.itemStatus === 'archived');
    const completedVisibleItems = combinedList.filter(item => item.itemStatus === 'completed');

    for (let i = 0; i < combinedList.length; i++) {
        const item = combinedList[i];
        const itemGroup = itemToGroupMap.get(item.recordId);

        let currentSection;
        if (item.itemStatus === 'archived') currentSection = 'archived';
        else if (item.itemStatus === 'completed') currentSection = 'completed';
        else if (item.type === 'locked') currentSection = 'confirmed';
        else currentSection = 'ideas';

        if (currentSection !== lastSection) {
            const hasMixedSections = (activeLockedItems.length > 0 && activeIdeaItems.length > 0) || archivedVisibleItems.length > 0 || completedVisibleItems.length > 0;
            if (hasMixedSections) {
                const sectionLabels = {
                    confirmed: { label: 'Confirmed', count: activeLockedItems.length },
                    ideas: { label: 'Ideas', count: activeIdeaItems.length },
                    archived: { label: 'Archived', count: archivedVisibleItems.length },
                    completed: { label: 'Completed', count: completedVisibleItems.length }
                };
                const sec = sectionLabels[currentSection];
                if (sec && sec.count > 0) {
                    itemsHTML.push(`
                        <div class="board-section-divider" role="separator">
                            <span class="board-section-divider-line"></span>
                            <span class="board-section-divider-label">${sec.label}<span class="board-section-divider-count">(${sec.count})</span></span>
                            <span class="board-section-divider-line"></span>
                        </div>
                    `);
                }
            }
            lastSection = currentSection;
        }

        if (itemGroup && itemGroup.id && !renderedGroupIds.has(itemGroup.id)) {
            renderedGroupIds.add(itemGroup.id);
            try {
                const html = await renderCompactGroupCard(itemGroup);
                if (html) itemsHTML.push(html);
            } catch (groupErr) {
                console.warn('[Presentation] Failed to render group card for', itemGroup.id, groupErr);
            }
        } else if (itemGroup && itemGroup.id && renderedGroupIds.has(itemGroup.id)) {
            continue;
        } else {
            try {
                const html = await renderCompactCard(item);
                if (html) itemsHTML.push(html);
            } catch (cardErr) {
                console.warn('[Presentation] Failed to render compact card for', item.recordId, cardErr);
            }
        }
    }

    if (showSingleItemNudge) {
        itemsHTML.push(`
            <div class="board-single-item-nudge" role="status" aria-label="Add more items suggestion">
                <div class="single-item-nudge-content">
                    <span class="nudge-icon" aria-hidden="true">💡</span>
                    <p class="nudge-text">Add more items to compare options, merge ideas, and build your perfect plan.</p>
                </div>
            </div>
        `);
    }

    const welcomeTipKey = `welcomeTipShown_${state.session.id}`;
    const hasShownWelcomeTip = sessionStorage.getItem(welcomeTipKey);
    if (!hasShownWelcomeTip && combinedList.length > 0) {
        sessionStorage.setItem(welcomeTipKey, 'true');
        itemsHTML.unshift(`
            <div class="board-welcome-tip" role="status" aria-label="Welcome tip">
                <div class="welcome-tip-content">
                    <span class="welcome-tip-icon" aria-hidden="true">👋</span>
                    <div class="welcome-tip-text">
                        <p class="welcome-tip-title">Welcome to the plan!</p>
                        <p class="welcome-tip-body">Tap the <strong>React</strong> badge on any item to share your opinion, or expand an item to leave a comment.</p>
                    </div>
                    <button class="welcome-tip-dismiss" aria-label="Dismiss tip" title="Dismiss">×</button>
                </div>
            </div>
        `);
    }

    itineraryItemsListEl.innerHTML = itemsHTML.join('');

    // Use rAF to defer the settled class until after paint, then apply with stagger
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const cards = itineraryItemsListEl.querySelectorAll('.compact-card');
            cards.forEach(card => card.classList.add('settled'));
        });
    });

    // Post-render hooks (delegated back to presentation.js)
    _deps.onAfterRenderAllItems();
}

export function updateStatusToggles(archivedCount, completedCount) {
    const itineraryItemsListEl = _deps.getItineraryItemsListEl();
    if (!itineraryItemsListEl) return;
    const modal = itineraryItemsListEl.closest('#presentation-modal-overlay');
    if (!modal) return;

    const archivedToggle = modal.querySelector('.toggle-archived-btn');
    const completedToggle = modal.querySelector('.toggle-completed-btn');

    if (archivedToggle) {
        archivedToggle.style.display = archivedCount > 0 ? '' : 'none';
        archivedToggle.textContent = showArchivedItems ? `Hide Archived (${archivedCount})` : `Show Archived (${archivedCount})`;
        archivedToggle.onclick = toggleArchivedItems;
    }
    if (completedToggle) {
        completedToggle.style.display = completedCount > 0 ? '' : 'none';
        completedToggle.textContent = showCompletedItems ? `Hide Completed (${completedCount})` : `Show Completed (${completedCount})`;
        completedToggle.onclick = toggleCompletedItems;
    }
}

export function toggleArchivedItems() {
    showArchivedItems = !showArchivedItems;
    renderAllItems();
}

export function toggleCompletedItems() {
    showCompletedItems = !showCompletedItems;
    renderAllItems();
}

/**
 * Add an image to an item's carousel (called from comment image uploads).
 */
export function addImageToItemCarousel(recordId, imageUrl) {
    if (!itemImagesCache.has(recordId)) {
        itemImagesCache.set(recordId, { images: [], currentIndex: 0 });
    }
    const cache = itemImagesCache.get(recordId);
    if (!cache.images.includes(imageUrl)) {
        cache.images.push(imageUrl);
    }
}
