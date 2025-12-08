// FILE: components/projectsDashboard.js
// Phase 2: Project Navigation & Dashboard Component
// Provides hierarchical project tree display and filtering capabilities

import { state, setState } from '../state.js';
import { log } from '../utils/debug.js';
import { initTaskManager } from './taskManager.js';

// Project type constants for filtering
export const PROJECT_TYPES = {
    ALL: 'all',
    EVENT_PLANS: 'event-plans',
    SHOPPING_CARTS: 'shopping-carts',
    GENERAL: 'general'
};

// Local state for the projects panel
let projectsData = [];
let currentFilter = PROJECT_TYPES.ALL;
let expandedNodes = new Set();
// Phase 3a: Track if tasks view is active
let tasksViewActive = false;

/**
 * Initialize the projects dashboard panel
 * Sets up event listeners for filters, close button, and overlay
 */
export function initializeProjectsDashboard() {
    log('ProjectsDashboard', 'Initializing projects dashboard...');

    const panel = document.getElementById('projects-panel');
    const closeBtn = document.getElementById('projects-panel-close');
    const overlay = document.getElementById('projects-panel-overlay');
    const filterBtns = document.querySelectorAll('.projects-filter-btn');
    const createBtn = document.getElementById('create-new-project-btn');
    const tasksBtn = document.getElementById('view-tasks-btn');

    // Close button handler
    if (closeBtn) {
        closeBtn.addEventListener('click', hideProjectsPanel);
    }

    // Overlay click handler (close panel)
    if (overlay) {
        overlay.addEventListener('click', hideProjectsPanel);
    }

    // Filter button handlers
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const filter = btn.dataset.filter;
            setProjectFilter(filter);

            // Update active state
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Create new project button
    if (createBtn) {
        createBtn.addEventListener('click', handleCreateNewProject);
    }

    // Phase 3a: View tasks button
    if (tasksBtn) {
        tasksBtn.addEventListener('click', () => {
            showTasksView();
        });
    }

    // Update tasks button visibility based on session state
    updateTasksButtonVisibility();

    log('ProjectsDashboard', 'Projects dashboard initialized.');
}

/**
 * Update the visibility of the "View Tasks" button based on session state
 */
export function updateTasksButtonVisibility() {
    const tasksBtn = document.getElementById('view-tasks-btn');
    if (tasksBtn) {
        // Show button only when there's an active session/project
        if (state.session.id) {
            tasksBtn.style.display = 'block';
        } else {
            tasksBtn.style.display = 'none';
        }
    }
}

/**
 * Show the projects panel with slide-in animation
 */
export function showProjectsPanel() {
    const panel = document.getElementById('projects-panel');
    const overlay = document.getElementById('projects-panel-overlay');

    if (panel) {
        panel.style.display = 'flex';
        // Trigger reflow for animation
        panel.offsetHeight;
        panel.classList.add('open');
    }

    if (overlay) {
        overlay.classList.add('visible');
    }

    log('ProjectsDashboard', 'Projects panel opened.');
}

/**
 * Hide the projects panel with slide-out animation
 */
export function hideProjectsPanel() {
    const panel = document.getElementById('projects-panel');
    const overlay = document.getElementById('projects-panel-overlay');

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

    log('ProjectsDashboard', 'Projects panel closed.');
}

/**
 * Toggle the projects panel visibility
 */
export function toggleProjectsPanel() {
    const panel = document.getElementById('projects-panel');
    if (panel && panel.classList.contains('open')) {
        hideProjectsPanel();
    } else {
        showProjectsPanel();
    }
}

/**
 * Set the current filter and re-render the project tree
 * @param {string} filter - One of PROJECT_TYPES values
 */
export function setProjectFilter(filter) {
    currentFilter = filter;
    renderProjectTree(projectsData);
    log('ProjectsDashboard', `Filter set to: ${filter}`);
}

/**
 * Update projects data and re-render the tree
 * @param {Array} projects - Array of project records from Airtable
 */
export function updateProjectsData(projects) {
    projectsData = projects || [];
    renderProjectTree(projectsData);
    log('ProjectsDashboard', `Updated projects data: ${projectsData.length} projects`);
}

/**
 * Determine the type of a project based on its fields
 * @param {Object} project - Project record
 * @returns {string} - One of PROJECT_TYPES values
 */
function getProjectType(project) {
    const fields = project.fields || {};

    // Check for event-specific fields
    if (fields.Date || fields['Guest Count'] || fields['Event Type']) {
        return PROJECT_TYPES.EVENT_PLANS;
    }

    // Check for shopping cart indicators
    if (fields['Cart Type'] === 'Shopping' || fields.IsShoppingCart) {
        return PROJECT_TYPES.SHOPPING_CARTS;
    }

    // Check items for event-related content
    const itemsData = fields['Items with Variations'];
    if (itemsData) {
        try {
            const parsed = JSON.parse(itemsData);
            if (parsed.lockedInItems && Object.keys(parsed.lockedInItems).length > 0) {
                return PROJECT_TYPES.EVENT_PLANS;
            }
        } catch (e) {
            // Ignore parse errors
        }
    }

    return PROJECT_TYPES.GENERAL;
}

/**
 * Filter projects based on current filter setting
 * @param {Array} projects - Array of projects
 * @returns {Array} - Filtered projects
 */
function filterProjects(projects) {
    if (currentFilter === PROJECT_TYPES.ALL) {
        return projects;
    }

    return projects.filter(project => getProjectType(project) === currentFilter);
}

/**
 * Build a hierarchical structure from flat projects list
 * Projects can have parent-child relationships via Parent_Session field
 * @param {Array} projects - Flat array of projects
 * @returns {Array} - Hierarchical array with children nested
 */
function buildProjectHierarchy(projects) {
    const projectMap = new Map();
    const rootProjects = [];

    // First pass: index all projects
    projects.forEach(project => {
        projectMap.set(project.id, {
            ...project,
            children: []
        });
    });

    // Second pass: build hierarchy
    projects.forEach(project => {
        const parentIds = project.fields?.Parent_Session || project.fields?.['Parent Session'] || [];
        const parentId = Array.isArray(parentIds) ? parentIds[0] : parentIds;

        if (parentId && projectMap.has(parentId)) {
            projectMap.get(parentId).children.push(projectMap.get(project.id));
        } else {
            rootProjects.push(projectMap.get(project.id));
        }
    });

    return rootProjects;
}

/**
 * Render the project tree recursively
 * @param {Array} projects - Array of project records
 */
export function renderProjectTree(projects) {
    const container = document.getElementById('projects-tree-container');
    if (!container) return;

    // Filter projects
    const filteredProjects = filterProjects(projects);

    // Build hierarchy
    const hierarchy = buildProjectHierarchy(filteredProjects);

    // Check if empty
    if (hierarchy.length === 0) {
        container.innerHTML = `
            <div class="projects-empty">
                <p>No projects found.</p>
                <p style="font-size: 0.9em; margin-top: 10px;">
                    ${currentFilter !== PROJECT_TYPES.ALL
                        ? 'Try changing the filter or create a new project.'
                        : 'Create your first project to get started!'}
                </p>
            </div>
        `;
        return;
    }

    // Render tree
    container.innerHTML = '';
    hierarchy.forEach(project => {
        const node = renderProjectNode(project, 0);
        container.appendChild(node);
    });

    log('ProjectsDashboard', `Rendered ${hierarchy.length} root projects.`);
}

/**
 * Render a single project node with its children
 * @param {Object} project - Project object with potential children
 * @param {number} depth - Current depth in the tree
 * @returns {HTMLElement} - The rendered node element
 */
function renderProjectNode(project, depth) {
    const fields = project.fields || {};
    const hasChildren = project.children && project.children.length > 0;
    const isExpanded = expandedNodes.has(project.id);
    const projectType = getProjectType(project);
    const isCurrentSession = state.session.id === project.id;

    // Get display info
    const name = fields.Name || 'Untitled Project';
    const date = fields.Date ? new Date(fields.Date).toLocaleDateString() : '';
    const itemCount = getItemCount(project);

    // Get icon based on type
    let icon = '📄';
    if (projectType === PROJECT_TYPES.EVENT_PLANS) {
        icon = '🎉';
    } else if (projectType === PROJECT_TYPES.SHOPPING_CARTS) {
        icon = '🛒';
    } else if (hasChildren) {
        icon = '📁';
    }

    // Create item container
    const item = document.createElement('div');
    item.className = 'project-tree-item';
    item.dataset.projectId = project.id;

    // Create node
    const node = document.createElement('div');
    node.className = `project-tree-node${isCurrentSession ? ' active' : ''}`;
    node.innerHTML = `
        <span class="project-tree-expand ${hasChildren ? (isExpanded ? 'expanded' : '') : 'no-children'}">▶</span>
        <span class="project-tree-icon">${icon}</span>
        <span class="project-tree-name" title="${name}">${name}</span>
        <span class="project-tree-meta">${date || (itemCount ? `${itemCount} items` : '')}</span>
    `;

    // Click handler for node
    node.addEventListener('click', (e) => {
        const expandBtn = node.querySelector('.project-tree-expand');
        if (e.target === expandBtn || expandBtn.contains(e.target)) {
            // Toggle expand/collapse
            if (hasChildren) {
                toggleNodeExpansion(project.id, item);
            }
        } else {
            // Select project
            handleProjectSelect(project);
        }
    });

    item.appendChild(node);

    // Render children if expanded
    if (hasChildren) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = `project-tree-children${isExpanded ? ' expanded' : ''}`;

        project.children.forEach(child => {
            childrenContainer.appendChild(renderProjectNode(child, depth + 1));
        });

        item.appendChild(childrenContainer);
    }

    return item;
}

/**
 * Toggle the expansion state of a tree node
 * @param {string} projectId - The project ID
 * @param {HTMLElement} itemElement - The DOM element
 */
function toggleNodeExpansion(projectId, itemElement) {
    const expandBtn = itemElement.querySelector('.project-tree-expand');
    const childrenContainer = itemElement.querySelector('.project-tree-children');

    if (expandedNodes.has(projectId)) {
        expandedNodes.delete(projectId);
        expandBtn?.classList.remove('expanded');
        childrenContainer?.classList.remove('expanded');
    } else {
        expandedNodes.add(projectId);
        expandBtn?.classList.add('expanded');
        childrenContainer?.classList.add('expanded');
    }
}

/**
 * Get the count of items in a project
 * @param {Object} project - Project record
 * @returns {number} - Number of items
 */
function getItemCount(project) {
    const itemsData = project.fields?.['Items with Variations'];
    if (!itemsData) return 0;

    try {
        const parsed = JSON.parse(itemsData);
        const lockedCount = parsed.lockedInItems ? Object.keys(parsed.lockedInItems).length : 0;
        const ideasCount = parsed.ideasItems || parsed.favoritedItems
            ? Object.keys(parsed.ideasItems || parsed.favoritedItems || {}).length
            : 0;
        return lockedCount + ideasCount;
    } catch (e) {
        return 0;
    }
}

/**
 * Handle project selection - load the selected project
 * @param {Object} project - The selected project
 */
function handleProjectSelect(project) {
    log('ProjectsDashboard', `Selected project: ${project.fields?.Name} (${project.id})`);

    // Update URL to load the selected session
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('session', project.id);

    // Navigate to the project
    window.location.href = currentUrl.toString();
}

/**
 * Handle create new project button click
 */
function handleCreateNewProject() {
    log('ProjectsDashboard', 'Create new project clicked.');

    // Close the panel
    hideProjectsPanel();

    // Clear session parameter to create a new session
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('session');

    // Reload to create fresh session
    window.location.href = currentUrl.toString();
}

/**
 * Show loading state in the projects tree
 */
export function showProjectsLoading() {
    const container = document.getElementById('projects-tree-container');
    if (container) {
        container.innerHTML = '<p class="projects-loading">Loading projects...</p>';
    }
}

/**
 * Show error state in the projects tree
 * @param {string} message - Error message to display
 */
export function showProjectsError(message) {
    const container = document.getElementById('projects-tree-container');
    if (container) {
        container.innerHTML = `
            <div class="projects-empty">
                <p style="color: #dc3545;">Error loading projects</p>
                <p style="font-size: 0.9em; margin-top: 10px;">${message}</p>
            </div>
        `;
    }
}

// ============================================================================
// PHASE 3a: TASK VIEW INTEGRATION
// ============================================================================

/**
 * Show the task manager view for the current project
 * Hides the catalog and shows the task manager
 */
export async function showTasksView() {
    const projectId = state.session.id;
    if (!projectId) {
        log('ProjectsDashboard', 'Cannot show tasks: no project selected');
        return;
    }

    log('ProjectsDashboard', `Showing tasks view for project: ${projectId}`);

    // Get containers
    const catalogContainer = document.getElementById('catalog-container');
    const taskContainer = document.getElementById('task-manager-container');
    const catalogHeader = document.getElementById('catalog-header');

    if (!taskContainer) {
        console.error('ProjectsDashboard: task-manager-container not found');
        return;
    }

    // Hide catalog, show task manager
    if (catalogContainer) {
        catalogContainer.style.display = 'none';
    }
    if (catalogHeader) {
        catalogHeader.style.display = 'none';
    }
    taskContainer.style.display = 'block';

    // Initialize the task manager
    await initTaskManager('task-manager-container', projectId);

    tasksViewActive = true;

    // Update URL to reflect tasks view
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('view', 'tasks');
    window.history.pushState({}, '', currentUrl.toString());

    // Close projects panel if open
    hideProjectsPanel();
}

/**
 * Hide the task manager view and show the catalog
 */
export function hideTasksView() {
    log('ProjectsDashboard', 'Hiding tasks view');

    const catalogContainer = document.getElementById('catalog-container');
    const taskContainer = document.getElementById('task-manager-container');
    const catalogHeader = document.getElementById('catalog-header');

    // Show catalog, hide task manager
    if (catalogContainer) {
        catalogContainer.style.display = '';
    }
    if (catalogHeader) {
        catalogHeader.style.display = '';
    }
    if (taskContainer) {
        taskContainer.style.display = 'none';
    }

    tasksViewActive = false;

    // Update URL to remove tasks view
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('view');
    window.history.pushState({}, '', currentUrl.toString());
}

/**
 * Toggle between tasks view and catalog view
 */
export function toggleTasksView() {
    if (tasksViewActive) {
        hideTasksView();
    } else {
        showTasksView();
    }
}

/**
 * Check if tasks view is currently active
 * @returns {boolean} - True if tasks view is active
 */
export function isTasksViewActive() {
    return tasksViewActive;
}

/**
 * Initialize tasks view from URL if ?view=tasks is present
 * Call this during app initialization
 */
export function initTasksViewFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'tasks' && state.session.id) {
        showTasksView();
    }
}
