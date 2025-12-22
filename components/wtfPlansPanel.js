// FILE: components/wtfPlansPanel.js
// WTF Plans Panel - Master view for all user's plans, RSVPs, favorites, and projects
// Similar UX to chat lists with sorting by most recent

import { state, setState } from '../state.js';
import { log } from '../utils/debug.js';
import * as api from '../api.js';
import { getTempLikes } from '../utils.js';
import { showDetailModal } from './modal.js';

// Filter types for the WTF Plans panel
export const WTF_PLAN_TYPES = {
    ALL: 'all',
    PLANS: 'plans',      // Sessions user is collaborator on
    RSVPS: 'rsvps',      // Public events and guest invites
    FAVORITES: 'favorites', // Liked items
    PROJECTS: 'projects'    // Projects/sessions owned
};

// Local state for the panel
let wtfPlansData = {
    plans: [],
    rsvps: [],
    favorites: [],
    projects: []
};
let currentFilter = WTF_PLAN_TYPES.ALL;
let isLoading = false;

/**
 * Initialize the WTF Plans panel
 * Sets up event listeners for filters, close button, and overlay
 */
export function initializeWtfPlansPanel() {
    log('WtfPlansPanel', 'Initializing WTF Plans panel...');

    const panel = document.getElementById('wtf-plans-panel');
    const closeBtn = document.getElementById('wtf-plans-panel-close');
    const overlay = document.getElementById('wtf-plans-panel-overlay');
    const filterBtns = document.querySelectorAll('.wtf-plans-filter-btn');

    // Close button handler
    if (closeBtn) {
        closeBtn.addEventListener('click', hideWtfPlansPanel);
    }

    // Overlay click handler (close panel)
    if (overlay) {
        overlay.addEventListener('click', hideWtfPlansPanel);
    }

    // Filter button handlers
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const filter = btn.dataset.filter;
            setWtfPlansFilter(filter);

            // Update active state
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel && panel.classList.contains('open')) {
            hideWtfPlansPanel();
        }
    });

    log('WtfPlansPanel', 'WTF Plans panel initialized.');
}

/**
 * Show the WTF Plans panel with slide-in animation
 * Fetches data if authenticated
 */
export async function showWtfPlansPanel() {
    const panel = document.getElementById('wtf-plans-panel');
    const overlay = document.getElementById('wtf-plans-panel-overlay');

    if (panel) {
        panel.style.display = 'flex';
        // Trigger reflow for animation
        panel.offsetHeight;
        panel.classList.add('open');
    }

    if (overlay) {
        overlay.classList.add('visible');
    }

    // Fetch data
    await loadWtfPlansData();

    log('WtfPlansPanel', 'WTF Plans panel opened.');
}

/**
 * Hide the WTF Plans panel with slide-out animation
 */
export function hideWtfPlansPanel() {
    const panel = document.getElementById('wtf-plans-panel');
    const overlay = document.getElementById('wtf-plans-panel-overlay');

    if (panel) {
        panel.classList.remove('open');
        // Wait for animation to complete before hiding
        setTimeout(() => {
            if (!panel.classList.contains('open')) {
                panel.style.display = 'none';
            }
        }, 300);
    }

    if (overlay) {
        overlay.classList.remove('visible');
    }

    log('WtfPlansPanel', 'WTF Plans panel closed.');
}

/**
 * Toggle the WTF Plans panel visibility
 */
export function toggleWtfPlansPanel() {
    const panel = document.getElementById('wtf-plans-panel');
    if (panel && panel.classList.contains('open')) {
        hideWtfPlansPanel();
    } else {
        showWtfPlansPanel();
    }
}

/**
 * Set the current filter and re-render the list
 * @param {string} filter - One of WTF_PLAN_TYPES values
 */
export function setWtfPlansFilter(filter) {
    currentFilter = filter;
    renderWtfPlansList();
    log('WtfPlansPanel', `Filter set to: ${filter}`);
}

/**
 * Load all WTF Plans data from various sources
 */
async function loadWtfPlansData() {
    const container = document.getElementById('wtf-plans-list-container');
    if (!container) return;

    // Show loading state
    isLoading = true;
    container.innerHTML = '<div class="wtf-plans-loading">Loading your plans...</div>';

    try {
        const userId = state.session.user.id;
        const isAuthenticated = state.session.user.isAuthenticated;

        // Fetch data in parallel where possible
        const dataPromises = [];

        // Plans/Collabs (sessions user is collaborator on)
        if (isAuthenticated && userId) {
            dataPromises.push(
                api.fetchPlansForUser(userId, true)
                    .then(plans => { wtfPlansData.plans = plans || []; })
                    .catch(err => {
                        console.error('Error fetching plans:', err);
                        wtfPlansData.plans = [];
                    })
            );

            // Projects (using project hierarchy)
            dataPromises.push(
                api.fetchProjectHierarchy(userId)
                    .then(projects => { wtfPlansData.projects = projects || []; })
                    .catch(err => {
                        console.error('Error fetching projects:', err);
                        wtfPlansData.projects = [];
                    })
            );
        } else {
            wtfPlansData.plans = [];
            wtfPlansData.projects = [];
        }

        // Wait for API calls
        await Promise.all(dataPromises);

        // RSVPs - filter from records (events user has RSVP'd to)
        if (isAuthenticated && userId) {
            wtfPlansData.rsvps = state.records.all.filter(record => {
                if (record.fields['Item Type'] !== 'Event') return false;
                const rsvpYes = record.fields.RSVPs || [];
                const rsvpMaybe = record.fields.RSVPMaybe || [];
                const rsvpNo = record.fields.RSVPNo || [];
                return rsvpYes.includes(userId) || rsvpMaybe.includes(userId) || rsvpNo.includes(userId);
            });
        } else {
            wtfPlansData.rsvps = [];
        }

        // Favorites - get liked items
        let likedIds = new Set();
        if (isAuthenticated) {
            likedIds = state.session.user.likedItemIds || new Set();
        } else {
            likedIds = getTempLikes();
        }
        wtfPlansData.favorites = state.records.all.filter(record => likedIds.has(record.id));

        isLoading = false;
        renderWtfPlansList();

    } catch (error) {
        console.error('Error loading WTF Plans data:', error);
        isLoading = false;
        container.innerHTML = '<div class="wtf-plans-empty">Error loading your plans. Please try again.</div>';
    }
}

/**
 * Refresh the WTF Plans data
 */
export async function refreshWtfPlansData() {
    await loadWtfPlansData();
}

/**
 * Get all items combined and sorted by most recent
 * @returns {Array} - Combined and sorted items
 */
function getCombinedItems() {
    let items = [];

    // Add plans
    if (currentFilter === WTF_PLAN_TYPES.ALL || currentFilter === WTF_PLAN_TYPES.PLANS) {
        wtfPlansData.plans.forEach(plan => {
            items.push({
                type: 'plan',
                id: plan.id,
                name: plan.fields?.Name || 'Untitled Plan',
                date: plan.fields?.Date,
                createdTime: plan.createdTime,
                itemCount: (plan.fields?.Items || []).length,
                totalCost: plan.fields?.TotalCost || 0,
                icon: '📋',
                data: plan
            });
        });
    }

    // Add RSVPs
    if (currentFilter === WTF_PLAN_TYPES.ALL || currentFilter === WTF_PLAN_TYPES.RSVPS) {
        wtfPlansData.rsvps.forEach(event => {
            const userId = state.session.user.id;
            let rsvpStatus = '';
            if ((event.fields.RSVPs || []).includes(userId)) rsvpStatus = 'Going';
            else if ((event.fields.RSVPMaybe || []).includes(userId)) rsvpStatus = 'Maybe';
            else if ((event.fields.RSVPNo || []).includes(userId)) rsvpStatus = 'Not Going';

            items.push({
                type: 'rsvp',
                id: event.id,
                name: event.fields?.Name || 'Untitled Event',
                date: event.fields?.Date,
                time: event.fields?.Time,
                createdTime: event.createdTime,
                rsvpStatus: rsvpStatus,
                icon: '🎟️',
                data: event
            });
        });
    }

    // Add Favorites
    if (currentFilter === WTF_PLAN_TYPES.ALL || currentFilter === WTF_PLAN_TYPES.FAVORITES) {
        wtfPlansData.favorites.forEach(item => {
            items.push({
                type: 'favorite',
                id: item.id,
                name: item.fields?.Name || 'Untitled Item',
                createdTime: item.createdTime,
                price: item.fields?.Price,
                category: item.fields?.Categories,
                icon: '❤️',
                data: item
            });
        });
    }

    // Add Projects (only those not already in plans to avoid duplicates)
    if (currentFilter === WTF_PLAN_TYPES.ALL || currentFilter === WTF_PLAN_TYPES.PROJECTS) {
        const planIds = new Set(wtfPlansData.plans.map(p => p.id));
        wtfPlansData.projects.forEach(project => {
            // Skip if already in plans
            if (planIds.has(project.id)) return;

            items.push({
                type: 'project',
                id: project.id,
                name: project.fields?.Name || 'Untitled Project',
                date: project.fields?.Date,
                createdTime: project.createdTime,
                icon: '📁',
                data: project
            });
        });
    }

    // Sort by most recent (createdTime or date)
    items.sort((a, b) => {
        const dateA = new Date(a.createdTime || a.date || 0);
        const dateB = new Date(b.createdTime || b.date || 0);
        return dateB - dateA; // Most recent first
    });

    return items;
}

/**
 * Render the WTF Plans list
 */
function renderWtfPlansList() {
    const container = document.getElementById('wtf-plans-list-container');
    if (!container) return;

    if (isLoading) {
        container.innerHTML = '<div class="wtf-plans-loading">Loading your plans...</div>';
        return;
    }

    const items = getCombinedItems();

    if (items.length === 0) {
        const emptyMessage = getEmptyMessage();
        container.innerHTML = `<div class="wtf-plans-empty">${emptyMessage}</div>`;
        return;
    }

    container.innerHTML = '';

    items.forEach(item => {
        const itemEl = createWtfPlanItem(item);
        container.appendChild(itemEl);
    });

    // Update counts in filter buttons
    updateFilterCounts();
}

/**
 * Get appropriate empty message based on filter
 * @returns {string} - Empty state message
 */
function getEmptyMessage() {
    const isAuthenticated = state.session.user.isAuthenticated;

    if (!isAuthenticated) {
        return 'Sign in to see your plans, RSVPs, and favorites.';
    }

    switch (currentFilter) {
        case WTF_PLAN_TYPES.PLANS:
            return 'No plans yet. Start collaborating on a plan!';
        case WTF_PLAN_TYPES.RSVPS:
            return 'No RSVPs yet. Browse events and RSVP!';
        case WTF_PLAN_TYPES.FAVORITES:
            return 'No favorites yet. Heart items you love!';
        case WTF_PLAN_TYPES.PROJECTS:
            return 'No projects yet. Create your first project!';
        default:
            return 'Nothing here yet. Start planning something fun!';
    }
}

/**
 * Create a single WTF Plan item element
 * @param {Object} item - The item data
 * @returns {HTMLElement} - The item element
 */
function createWtfPlanItem(item) {
    const itemEl = document.createElement('div');
    itemEl.className = 'wtf-plans-item';
    itemEl.dataset.itemId = item.id;
    itemEl.dataset.itemType = item.type;

    // Build preview text based on type
    let preview = '';
    switch (item.type) {
        case 'plan':
            const dateStr = item.date ? new Date(item.date + 'T00:00:00').toLocaleDateString() : 'No date';
            preview = `${item.itemCount} items • ${dateStr} • $${(item.totalCost || 0).toFixed(2)}`;
            break;
        case 'rsvp':
            const eventDate = item.date ? new Date(item.date + 'T00:00:00').toLocaleDateString() : 'TBD';
            preview = `${item.rsvpStatus} • ${eventDate}${item.time ? ' ' + item.time : ''}`;
            break;
        case 'favorite':
            const price = item.price ? `$${parseFloat(item.price).toFixed(2)}` : '';
            preview = [item.category, price].filter(Boolean).join(' • ') || 'Saved item';
            break;
        case 'project':
            const projDate = item.date ? new Date(item.date + 'T00:00:00').toLocaleDateString() : '';
            preview = projDate || 'Project';
            break;
    }

    // Format time ago
    const timeAgo = formatTimeAgo(item.createdTime);

    itemEl.innerHTML = `
        <div class="wtf-plans-item-icon">${item.icon}</div>
        <div class="wtf-plans-item-content">
            <div class="wtf-plans-item-name">${escapeHtml(item.name)}</div>
            <div class="wtf-plans-item-preview">${escapeHtml(preview)}</div>
        </div>
        <div class="wtf-plans-item-time">${timeAgo}</div>
    `;

    // Click handler
    itemEl.addEventListener('click', () => handleWtfPlanItemClick(item));

    return itemEl;
}

/**
 * Handle click on a WTF Plan item
 * @param {Object} item - The clicked item
 */
function handleWtfPlanItemClick(item) {
    log('WtfPlansPanel', `Clicked ${item.type}: ${item.name} (${item.id})`);

    // Close the panel
    hideWtfPlansPanel();

    switch (item.type) {
        case 'plan':
        case 'project':
            // Navigate to session
            const sessionUrl = new URL(window.location.href);
            sessionUrl.searchParams.set('session', item.id);
            sessionUrl.searchParams.delete('view');
            sessionUrl.searchParams.delete('category');
            window.location.href = sessionUrl.toString();
            break;

        case 'rsvp':
        case 'favorite':
            // Open item detail modal
            const record = item.data;
            if (record) {
                showDetailModal(record);
            } else {
                // Fallback: navigate with openItem param
                const itemUrl = new URL(window.location.href);
                itemUrl.searchParams.set('openItem', item.id);
                window.location.href = itemUrl.toString();
            }
            break;
    }
}

/**
 * Update filter button counts
 */
function updateFilterCounts() {
    const allBtn = document.querySelector('.wtf-plans-filter-btn[data-filter="all"]');
    const plansBtn = document.querySelector('.wtf-plans-filter-btn[data-filter="plans"]');
    const rsvpsBtn = document.querySelector('.wtf-plans-filter-btn[data-filter="rsvps"]');
    const favoritesBtn = document.querySelector('.wtf-plans-filter-btn[data-filter="favorites"]');
    const projectsBtn = document.querySelector('.wtf-plans-filter-btn[data-filter="projects"]');

    const planCount = wtfPlansData.plans.length;
    const rsvpCount = wtfPlansData.rsvps.length;
    const favoriteCount = wtfPlansData.favorites.length;

    // Projects that aren't already in plans
    const planIds = new Set(wtfPlansData.plans.map(p => p.id));
    const projectCount = wtfPlansData.projects.filter(p => !planIds.has(p.id)).length;

    const totalCount = planCount + rsvpCount + favoriteCount + projectCount;

    if (allBtn) updateButtonCount(allBtn, totalCount);
    if (plansBtn) updateButtonCount(plansBtn, planCount);
    if (rsvpsBtn) updateButtonCount(rsvpsBtn, rsvpCount);
    if (favoritesBtn) updateButtonCount(favoritesBtn, favoriteCount);
    if (projectsBtn) updateButtonCount(projectsBtn, projectCount);
}

/**
 * Update count badge on a filter button
 * @param {HTMLElement} btn - The button element
 * @param {number} count - The count
 */
function updateButtonCount(btn, count) {
    let badge = btn.querySelector('.wtf-plans-count');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'wtf-plans-count';
        btn.appendChild(badge);
    }
    badge.textContent = count > 0 ? count : '';
    badge.style.display = count > 0 ? 'inline' : 'none';
}

/**
 * Format a timestamp as relative time
 * @param {string} timestamp - ISO timestamp
 * @returns {string} - Formatted time string
 */
function formatTimeAgo(timestamp) {
    if (!timestamp) return '';

    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now - time;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;

    return time.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
