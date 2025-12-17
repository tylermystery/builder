// FILE: components/projectSelector.js
// Phase 5: Cross-Linking - "Add to Project" functionality
// Allows users to add catalog items to specific projects

import { state, setState } from '../state.js';
import { log } from '../utils/debug.js';
import * as api from '../api.js';
import { showToast, showEventPlanNotification } from '../ui.js';
import { broadcastItemAdded } from '../utils/realtimeUpdates.js';

// Track long-press state
let longPressTimer = null;
let isLongPress = false;
const LONG_PRESS_DURATION = 500; // ms

// Cache for user's projects
let cachedProjects = [];
let projectsCacheTime = null;
const CACHE_DURATION = 60000; // 1 minute

/**
 * Initialize the project selector event listeners
 * Call this once during app initialization
 */
export function initializeProjectSelector() {
    // Add event listeners for long-press detection on Add to Plan buttons
    document.body.addEventListener('mousedown', handleMouseDown);
    document.body.addEventListener('mouseup', handleMouseUp);
    document.body.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.body.addEventListener('touchend', handleTouchEnd);

    log('ProjectSelector', 'Project selector initialized');
}

/**
 * Handle mousedown event for long-press detection
 * @param {MouseEvent} e - The mouse event
 */
function handleMouseDown(e) {
    const addToPlanBtn = e.target.closest('.add-to-plan-btn, #modal-add-to-plan-btn');
    if (!addToPlanBtn) return;

    isLongPress = false;
    longPressTimer = setTimeout(() => {
        isLongPress = true;
        handleLongPress(addToPlanBtn, e);
    }, LONG_PRESS_DURATION);
}

/**
 * Handle mouseup event to cancel long-press
 * @param {MouseEvent} e - The mouse event
 */
function handleMouseUp(e) {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

/**
 * Handle touchstart event for long-press detection
 * @param {TouchEvent} e - The touch event
 */
function handleTouchStart(e) {
    const addToPlanBtn = e.target.closest('.add-to-plan-btn, #modal-add-to-plan-btn');
    if (!addToPlanBtn) return;

    isLongPress = false;
    longPressTimer = setTimeout(() => {
        isLongPress = true;
        e.preventDefault(); // Prevent default touch behavior
        handleLongPress(addToPlanBtn, e);
    }, LONG_PRESS_DURATION);
}

/**
 * Handle touchend event to cancel long-press
 * @param {TouchEvent} e - The touch event
 */
function handleTouchEnd(e) {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

/**
 * Handle long-press on Add to Plan button
 * Shows the project selector modal
 * @param {HTMLElement} button - The Add to Plan button
 * @param {Event} e - The original event
 */
async function handleLongPress(button, e) {
    e.preventDefault();
    e.stopPropagation();

    const recordId = button.closest('[data-record-id]')?.dataset.recordId;
    if (!recordId) return;

    const record = state.records.all.find(r => r.id === recordId);
    if (!record) return;

    log('ProjectSelector', `Long-press detected on item: ${record.fields?.Name}`);

    // Show project selector modal
    await showProjectSelectorModal(recordId, record);
}

/**
 * Check if a long-press action was triggered
 * @returns {boolean} - True if long-press was detected
 */
export function wasLongPress() {
    return isLongPress;
}

/**
 * Reset long-press state
 */
export function resetLongPress() {
    isLongPress = false;
}

/**
 * Fetch user's projects (with caching)
 * @returns {Promise<Array>} - Array of project records
 */
async function fetchUserProjects() {
    const userId = state.session.user?.id;
    if (!userId) {
        log('ProjectSelector', 'No user ID - cannot fetch projects');
        return [];
    }

    // Check cache
    if (cachedProjects.length > 0 && projectsCacheTime &&
        (Date.now() - projectsCacheTime) < CACHE_DURATION) {
        return cachedProjects;
    }

    try {
        const projects = await api.fetchProjectHierarchy(userId);
        cachedProjects = projects || [];
        projectsCacheTime = Date.now();
        return cachedProjects;
    } catch (error) {
        console.error('Error fetching user projects:', error);
        return cachedProjects; // Return cached data if available
    }
}

/**
 * Show the project selector modal
 * @param {string} recordId - The item record ID to add
 * @param {Object} record - The item record
 */
async function showProjectSelectorModal(recordId, record) {
    // Check if modal already exists
    let modal = document.getElementById('project-selector-modal');
    if (modal) {
        modal.remove();
    }

    // Create modal HTML
    const modalHtml = `
        <div id="project-selector-modal" class="project-selector-modal">
            <div class="project-selector-content">
                <div class="project-selector-header">
                    <h3>Add to Project</h3>
                    <button class="project-selector-close" id="project-selector-close">&times;</button>
                </div>
                <div class="project-selector-body">
                    <p style="padding: 0 12px; color: #666; font-size: 0.9em; margin-bottom: 12px;">
                        Adding: <strong>${escapeHtml(record.fields?.Name || 'Item')}</strong>
                    </p>
                    <div class="project-selector-list" id="project-selector-list">
                        <div class="project-selector-loading">
                            <div class="task-loading-spinner"></div>
                            <p>Loading projects...</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Insert modal into DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    modal = document.getElementById('project-selector-modal');

    // Setup close handlers
    const closeBtn = document.getElementById('project-selector-close');
    closeBtn.addEventListener('click', () => hideProjectSelectorModal());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) hideProjectSelectorModal();
    });

    // Show modal with animation
    requestAnimationFrame(() => {
        modal.classList.add('active');
    });

    // Fetch and render projects
    const projects = await fetchUserProjects();
    renderProjectList(projects, recordId, record);
}

/**
 * Hide the project selector modal
 */
function hideProjectSelectorModal() {
    const modal = document.getElementById('project-selector-modal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    }
}

/**
 * Render the list of projects in the modal
 * @param {Array} projects - Array of project records
 * @param {string} recordId - The item to add
 * @param {Object} record - The item record
 */
function renderProjectList(projects, recordId, record) {
    const listContainer = document.getElementById('project-selector-list');
    if (!listContainer) return;

    if (!projects || projects.length === 0) {
        listContainer.innerHTML = `
            <div class="project-selector-empty">
                <p>No projects found.</p>
                <p style="font-size: 0.9em; margin-top: 8px;">
                    Start a new plan to add items to it.
                </p>
            </div>
        `;
        return;
    }

    // Include current session at the top if it exists
    const currentSessionId = state.session.id;
    let html = '';

    // Add "Current Project" option at top if we have one
    if (currentSessionId) {
        const currentProject = projects.find(p => p.id === currentSessionId);
        const currentName = currentProject?.fields?.Name || 'Current Plan';

        html += `
            <div class="project-selector-item active" data-project-id="${currentSessionId}">
                <span class="project-selector-icon">📋</span>
                <span class="project-selector-name">${escapeHtml(currentName)}</span>
                <span class="project-selector-meta">Current</span>
            </div>
        `;
    }

    // Add other projects
    projects.forEach(project => {
        // Skip current session (already added above)
        if (project.id === currentSessionId) return;

        const name = project.fields?.Name || 'Untitled Project';
        const date = project.fields?.Date
            ? new Date(project.fields.Date).toLocaleDateString()
            : '';
        const icon = project.fields?.Date ? '🎉' : '📄';

        html += `
            <div class="project-selector-item" data-project-id="${project.id}">
                <span class="project-selector-icon">${icon}</span>
                <span class="project-selector-name">${escapeHtml(name)}</span>
                ${date ? `<span class="project-selector-meta">${date}</span>` : ''}
            </div>
        `;
    });

    listContainer.innerHTML = html;

    // Add click handlers
    listContainer.querySelectorAll('.project-selector-item').forEach(item => {
        item.addEventListener('click', () => {
            const projectId = item.dataset.projectId;
            addItemToProject(recordId, record, projectId);
        });
    });
}

/**
 * Add an item to a specific project
 * @param {string} recordId - The item record ID
 * @param {Object} record - The item record
 * @param {string} projectId - The target project ID
 */
async function addItemToProject(recordId, record, projectId) {
    log('ProjectSelector', `Adding item ${recordId} to project ${projectId}`);

    hideProjectSelectorModal();

    const isSameProject = projectId === state.session.id;
    const itemName = record.fields?.Name || 'Item';

    if (isSameProject) {
        // Add to current project - trigger the normal add flow
        showToast(`Adding "${itemName}" to current plan...`, 2000);

        // Fire the existing add-to-plan logic by simulating a click
        // Or directly manipulate the cart
        if (state.cart.lockedItems.has(recordId)) {
            showToast(`"${itemName}" is already in your plan`, 3000);
            return;
        }

        // Get item info
        const itemInfo = {
            quantity: 1,
            selectedOptionIndex: 0,
            selections: {},
            note: ''
        };

        // Add to locked items
        state.cart.lockedItems.set(recordId, itemInfo);
        state.cart.items.delete(recordId);

        // Update UI
        if (typeof window.ui?.updateCardIcon === 'function') {
            window.ui.updateCardIcon(recordId);
        }
        if (typeof window.ui?.updateCardButtonText === 'function') {
            window.ui.updateCardButtonText(recordId, true);
        }

        // Broadcast the addition
        broadcastItemAdded(recordId, itemName);

        showEventPlanNotification(`Added "${itemName}" to your plan`);
    } else {
        // Add to different project - need to save via API
        showToast(`Adding "${itemName}" to project...`, 2000);

        try {
            // Load the target project's data
            const targetProject = cachedProjects.find(p => p.id === projectId);
            const targetName = targetProject?.fields?.Name || 'the project';

            // Add item to the project's items data
            // This requires updating the project's "Items with Variations" field
            const success = await api.addItemToSession(projectId, recordId, {
                quantity: 1,
                selectedOptionIndex: 0,
                selections: {},
                note: ''
            });

            if (success) {
                showEventPlanNotification(`Added "${itemName}" to ${targetName}`);
                // Broadcast to that project's channel if we're subscribed
                broadcastItemAdded(recordId, itemName);
            } else {
                showToast('Failed to add item. Please try again.', 3000);
            }
        } catch (error) {
            console.error('Error adding item to project:', error);
            showToast('Failed to add item. Please try again.', 3000);
        }
    }
}

/**
 * Quick add item to current project (no modal)
 * Called when state.session.id is set and it's a normal click
 * @param {string} recordId - The item record ID
 * @param {Object} record - The item record (optional)
 * @returns {boolean} - True if added, false if should show modal
 */
export function quickAddToCurrentProject(recordId, record = null) {
    // If we have a current project, add to it
    if (state.session.id) {
        return true; // Let the normal flow handle it
    }

    // No current project - show selector
    return false;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Clear the project cache
 * Call this when projects are updated
 */
export function clearProjectCache() {
    cachedProjects = [];
    projectsCacheTime = null;
}
