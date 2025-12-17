/**
 * Tile Sizing Debug Utility
 *
 * This module provides extensive debugging for catalog tile sizing across all views
 * and tile types (bookable items, events, groupings, carousels, etc.)
 *
 * Usage:
 *   - Enable debug mode via console: window.enableTileSizingDebug()
 *   - Disable debug mode: window.disableTileSizingDebug()
 *   - Run sizing audit: window.auditTileSizing()
 *   - Get sizing report: window.getTileSizingReport()
 */

const TILE_DEBUG_PREFIX = '[TileSizing]';
let tileSizingDebugEnabled = false;

// CSS sizing constants (should match CSS files)
const EXPECTED_SIZES = {
    desktop: {
        gridCard: { minWidth: 320, maxWidth: '1fr' },
        carouselCard: { width: 320, minWidth: 320, maxWidth: 320 },
        imageContainer: { height: 200, aspectRatio: '3 / 2.6' },
        gap: 25,
        carouselGap: 20
    },
    tablet: {
        carouselCard: { width: 280, minWidth: 280, maxWidth: 280 }
    },
    mobile: {
        carouselCard: { width: 'calc(100vw - 70px)', minWidth: 280 }
    }
};

/**
 * Enable tile sizing debug mode
 */
export function enableTileSizingDebug() {
    tileSizingDebugEnabled = true;
    console.log(`${TILE_DEBUG_PREFIX} Debug mode ENABLED`);
    console.log(`${TILE_DEBUG_PREFIX} Available commands:`);
    console.log(`  - window.auditTileSizing() - Run full sizing audit`);
    console.log(`  - window.getTileSizingReport() - Get detailed report`);
    console.log(`  - window.debugTile(recordId) - Debug specific tile`);
    console.log(`  - window.disableTileSizingDebug() - Disable debug mode`);
    return true;
}

/**
 * Disable tile sizing debug mode
 */
export function disableTileSizingDebug() {
    tileSizingDebugEnabled = false;
    console.log(`${TILE_DEBUG_PREFIX} Debug mode DISABLED`);
    return false;
}

/**
 * Check if debug mode is enabled
 */
export function isTileSizingDebugEnabled() {
    return tileSizingDebugEnabled;
}

/**
 * Log tile sizing debug message
 */
export function logTileSizing(category, message, data = null) {
    if (!tileSizingDebugEnabled) return;

    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    const prefix = `${TILE_DEBUG_PREFIX}[${category}][${timestamp}]`;

    if (data) {
        console.log(prefix, message, data);
    } else {
        console.log(prefix, message);
    }
}

/**
 * Get viewport information
 */
export function getViewportInfo() {
    return {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        breakpoint: window.innerWidth <= 768 ? 'mobile' :
                    window.innerWidth <= 1024 ? 'tablet' : 'desktop',
        orientation: window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
    };
}

/**
 * Get computed sizing for an element
 */
export function getElementSizing(element) {
    if (!element) return null;

    const computed = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return {
        // Computed dimensions
        width: computed.width,
        height: computed.height,
        minWidth: computed.minWidth,
        maxWidth: computed.maxWidth,
        minHeight: computed.minHeight,
        maxHeight: computed.maxHeight,

        // Bounding rect (actual rendered size)
        renderedWidth: rect.width,
        renderedHeight: rect.height,

        // Flex properties
        flex: computed.flex,
        flexBasis: computed.flexBasis,
        flexGrow: computed.flexGrow,
        flexShrink: computed.flexShrink,

        // Grid properties
        gridColumn: computed.gridColumn,
        gridRow: computed.gridRow,

        // Box model
        padding: computed.padding,
        margin: computed.margin,
        boxSizing: computed.boxSizing,

        // Position
        position: computed.position,
        display: computed.display,

        // Aspect ratio
        aspectRatio: computed.aspectRatio
    };
}

/**
 * Debug a specific tile by record ID
 */
export function debugTile(recordId) {
    const tile = document.querySelector(`.event-card[data-record-id="${recordId}"]`);
    if (!tile) {
        console.warn(`${TILE_DEBUG_PREFIX} Tile not found for record ID: ${recordId}`);
        return null;
    }

    const sizing = getElementSizing(tile);
    const imageContainer = tile.querySelector('.event-card-image-container');
    const content = tile.querySelector('.event-card-content');
    const footer = tile.querySelector('.card-footer');

    const report = {
        recordId,
        tileType: getTileType(tile),
        inCarousel: isInCarousel(tile),
        viewport: getViewportInfo(),
        tile: sizing,
        imageContainer: imageContainer ? getElementSizing(imageContainer) : null,
        content: content ? getElementSizing(content) : null,
        footer: footer ? getElementSizing(footer) : null,
        issues: detectSizingIssues(tile, sizing)
    };

    console.log(`${TILE_DEBUG_PREFIX} Tile Debug Report:`, report);
    return report;
}

/**
 * Get tile type from element
 */
function getTileType(element) {
    if (element.classList.contains('grouping-card')) return 'Grouping';
    if (element.classList.contains('event-type-card')) return 'Event';
    if (element.classList.contains('skeleton-card')) return 'Skeleton';
    return 'BookableItem';
}

/**
 * Check if tile is in a carousel
 */
function isInCarousel(element) {
    return !!element.closest('.grouping-carousel-container');
}

/**
 * Detect sizing issues for a tile
 */
function detectSizingIssues(tile, sizing) {
    const issues = [];
    const viewport = getViewportInfo();
    const inCarousel = isInCarousel(tile);

    // Check for zero or negative dimensions
    if (sizing.renderedWidth <= 0) {
        issues.push({ severity: 'error', message: 'Tile has zero or negative width' });
    }
    if (sizing.renderedHeight <= 0) {
        issues.push({ severity: 'error', message: 'Tile has zero or negative height' });
    }

    // Check carousel card sizing
    if (inCarousel) {
        const expectedWidth = viewport.breakpoint === 'mobile' ? 280 :
                              viewport.breakpoint === 'tablet' ? 280 : 320;

        if (Math.abs(sizing.renderedWidth - expectedWidth) > 5) {
            issues.push({
                severity: 'warning',
                message: `Carousel card width (${sizing.renderedWidth}px) differs from expected (${expectedWidth}px)`,
                expected: expectedWidth,
                actual: sizing.renderedWidth
            });
        }
    }

    // Check image container
    const imageContainer = tile.querySelector('.event-card-image-container');
    if (imageContainer) {
        const imgSizing = getElementSizing(imageContainer);
        if (imgSizing.renderedHeight < 180 || imgSizing.renderedHeight > 220) {
            issues.push({
                severity: 'warning',
                message: `Image container height (${imgSizing.renderedHeight}px) outside expected range (180-220px)`,
                actual: imgSizing.renderedHeight
            });
        }
    }

    // Check for overflow issues
    if (tile.scrollWidth > tile.clientWidth) {
        issues.push({
            severity: 'warning',
            message: 'Tile has horizontal overflow',
            scrollWidth: tile.scrollWidth,
            clientWidth: tile.clientWidth
        });
    }

    return issues;
}

/**
 * Audit all tiles in the catalog
 */
export function auditTileSizing() {
    console.log(`${TILE_DEBUG_PREFIX} ========== TILE SIZING AUDIT ==========`);

    const viewport = getViewportInfo();
    console.log(`${TILE_DEBUG_PREFIX} Viewport:`, viewport);

    // Audit catalog container
    const catalogContainer = document.getElementById('catalog-container');
    if (catalogContainer) {
        console.log(`${TILE_DEBUG_PREFIX} Catalog Container:`, getElementSizing(catalogContainer));
        console.log(`${TILE_DEBUG_PREFIX} Catalog Container has carousel sections:`,
            catalogContainer.querySelector('.grouping-carousel-section') !== null);
    }

    // Audit all tiles
    const allTiles = document.querySelectorAll('.event-card');
    const tileAudit = {
        total: allTiles.length,
        byType: {
            BookableItem: 0,
            Event: 0,
            Grouping: 0,
            Skeleton: 0
        },
        inCarousel: 0,
        inGrid: 0,
        withIssues: 0,
        issues: []
    };

    allTiles.forEach((tile, index) => {
        const tileType = getTileType(tile);
        tileAudit.byType[tileType]++;

        if (isInCarousel(tile)) {
            tileAudit.inCarousel++;
        } else {
            tileAudit.inGrid++;
        }

        const sizing = getElementSizing(tile);
        const issues = detectSizingIssues(tile, sizing);

        if (issues.length > 0) {
            tileAudit.withIssues++;
            tileAudit.issues.push({
                index,
                recordId: tile.dataset.recordId,
                tileType,
                inCarousel: isInCarousel(tile),
                sizing: {
                    width: sizing.renderedWidth,
                    height: sizing.renderedHeight
                },
                issues
            });
        }
    });

    console.log(`${TILE_DEBUG_PREFIX} Tile Audit Summary:`, tileAudit);

    // Audit carousel sections
    const carouselSections = document.querySelectorAll('.grouping-carousel-section');
    console.log(`${TILE_DEBUG_PREFIX} Carousel Sections: ${carouselSections.length}`);

    carouselSections.forEach((section, index) => {
        const container = section.querySelector('.grouping-carousel-container');
        const cards = section.querySelectorAll('.event-card');
        console.log(`${TILE_DEBUG_PREFIX} Carousel ${index}:`, {
            groupingId: section.dataset.groupingId,
            categoryName: section.dataset.categoryName,
            cardCount: cards.length,
            containerSizing: container ? getElementSizing(container) : null,
            hasOverflow: container ? container.scrollWidth > container.clientWidth : false
        });
    });

    // Audit ungrouped items section
    const ungroupedSection = document.querySelector('.ungrouped-items-section');
    if (ungroupedSection) {
        const cards = ungroupedSection.querySelectorAll('.event-card');
        console.log(`${TILE_DEBUG_PREFIX} Ungrouped Items Section:`, {
            cardCount: cards.length,
            sizing: getElementSizing(ungroupedSection)
        });
    }

    console.log(`${TILE_DEBUG_PREFIX} ========== END AUDIT ==========`);

    return tileAudit;
}

/**
 * Generate comprehensive tile sizing report
 */
export function getTileSizingReport() {
    const report = {
        timestamp: new Date().toISOString(),
        viewport: getViewportInfo(),
        expectedSizes: EXPECTED_SIZES,
        catalogContainer: null,
        tiles: [],
        carousels: [],
        issues: []
    };

    // Catalog container
    const catalogContainer = document.getElementById('catalog-container');
    if (catalogContainer) {
        report.catalogContainer = {
            sizing: getElementSizing(catalogContainer),
            hasCarouselLayout: catalogContainer.querySelector('.grouping-carousel-section') !== null,
            childCount: catalogContainer.children.length
        };
    }

    // All tiles
    const allTiles = document.querySelectorAll('.event-card');
    allTiles.forEach(tile => {
        const sizing = getElementSizing(tile);
        const issues = detectSizingIssues(tile, sizing);

        report.tiles.push({
            recordId: tile.dataset.recordId,
            tileType: getTileType(tile),
            inCarousel: isInCarousel(tile),
            sizing: {
                width: sizing.renderedWidth,
                height: sizing.renderedHeight,
                flex: sizing.flex,
                minWidth: sizing.minWidth,
                maxWidth: sizing.maxWidth
            },
            hasIssues: issues.length > 0
        });

        if (issues.length > 0) {
            report.issues.push({
                recordId: tile.dataset.recordId,
                issues
            });
        }
    });

    // Carousels
    const carouselSections = document.querySelectorAll('.grouping-carousel-section');
    carouselSections.forEach(section => {
        const container = section.querySelector('.grouping-carousel-container');
        report.carousels.push({
            groupingId: section.dataset.groupingId,
            categoryName: section.dataset.categoryName,
            sizing: getElementSizing(section),
            containerSizing: container ? getElementSizing(container) : null,
            cardCount: section.querySelectorAll('.event-card').length
        });
    });

    console.log(`${TILE_DEBUG_PREFIX} Full Report:`, report);
    return report;
}

/**
 * Log when a card is created (call from createInteractiveCard)
 */
export function logCardCreation(recordId, itemType, context = {}) {
    logTileSizing('CardCreate', `Creating ${itemType} card`, {
        recordId,
        itemType,
        ...context,
        viewport: getViewportInfo()
    });
}

/**
 * Log when cards are rendered (call from renderRecords)
 */
export function logRenderStart(recordCount, options = {}) {
    logTileSizing('Render', `Starting render of ${recordCount} records`, {
        recordCount,
        append: options.append || false,
        viewport: getViewportInfo(),
        catalogContainer: document.getElementById('catalog-container') ?
            getElementSizing(document.getElementById('catalog-container')) : null
    });
}

/**
 * Log when render completes
 */
export function logRenderComplete(recordCount, timeTaken = null) {
    logTileSizing('Render', `Completed rendering ${recordCount} records`, {
        recordCount,
        timeTaken: timeTaken ? `${timeTaken}ms` : 'unknown',
        viewport: getViewportInfo()
    });

    // Auto-audit if debug mode is on
    if (tileSizingDebugEnabled) {
        setTimeout(() => {
            console.log(`${TILE_DEBUG_PREFIX} Post-render audit:`);
            auditTileSizing();
        }, 100);
    }
}

/**
 * Log carousel section creation
 */
export function logCarouselCreation(groupingName, childCount, context = {}) {
    logTileSizing('Carousel', `Creating carousel for "${groupingName}"`, {
        groupingName,
        childCount,
        ...context,
        viewport: getViewportInfo()
    });
}

/**
 * Log layout mode changes
 */
export function logLayoutMode(mode, reason = '') {
    logTileSizing('Layout', `Layout mode: ${mode}`, {
        mode,
        reason,
        viewport: getViewportInfo()
    });
}

/**
 * Monitor resize events and log sizing changes
 */
let resizeDebounceTimer = null;
export function setupResizeMonitoring() {
    window.addEventListener('resize', () => {
        if (!tileSizingDebugEnabled) return;

        clearTimeout(resizeDebounceTimer);
        resizeDebounceTimer = setTimeout(() => {
            logTileSizing('Resize', 'Window resized', getViewportInfo());

            // Check if breakpoint changed
            const viewport = getViewportInfo();
            logTileSizing('Resize', `Current breakpoint: ${viewport.breakpoint}`);
        }, 250);
    });
}

// Expose functions to window for console access
if (typeof window !== 'undefined') {
    window.enableTileSizingDebug = enableTileSizingDebug;
    window.disableTileSizingDebug = disableTileSizingDebug;
    window.auditTileSizing = auditTileSizing;
    window.getTileSizingReport = getTileSizingReport;
    window.debugTile = debugTile;
    window.getViewportInfo = getViewportInfo;

    // Setup resize monitoring
    setupResizeMonitoring();
}

export default {
    enableTileSizingDebug,
    disableTileSizingDebug,
    isTileSizingDebugEnabled,
    logTileSizing,
    logCardCreation,
    logRenderStart,
    logRenderComplete,
    logCarouselCreation,
    logLayoutMode,
    auditTileSizing,
    getTileSizingReport,
    debugTile,
    getViewportInfo,
    getElementSizing
};
