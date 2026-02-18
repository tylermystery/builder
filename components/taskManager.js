// FILE: components/taskManager.js
// Phase 3b: Advanced Interactions - Drag-and-Drop Reordering & Item Linking
// Phase 4: Permissions & Security - UI Guarding for read-only views
// Phase 5: Real-time updates integration
// Provides task management interface for a selected project

import { state, setState } from '../state.js';
import { log } from '../utils/debug.js';
import * as api from '../api.js';
import { showToast } from '../ui.js';
import { triggerSave } from '../events.js';
import { showDetailModal } from './modal.js';
import {
    initializeRealtimeUpdates,
    cleanupRealtimeUpdates,
    registerTaskManagerCallback,
    broadcastTaskCreated,
    broadcastTaskUpdated,
    broadcastTaskDeleted,
    broadcastTaskReordered
} from '../utils/realtimeUpdates.js';

// Local component state
let currentProjectId = null;
let currentTasks = [];
let editingTaskId = null;
let sortableInstances = []; // Track SortableJS instances for cleanup
let sourceMessageId = null; // Track the message ID that triggered task creation from chat

/**
 * Initialize the Task Manager for a specific project
 * Main entry point for the component
 * @param {string} containerId - The DOM element ID to mount the task UI
 * @param {string} projectId - The project/session ID to manage tasks for
 */
export async function initTaskManager(containerId, projectId) {
    // DEBUG: Always log task manager initialization to console for debugging
    console.log('[TaskManager DEBUG] initTaskManager called with:', { containerId, projectId });
    log('TaskManager', `Initializing task manager for project: ${projectId}`);

    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`[TaskManager DEBUG] Container with ID "${containerId}" not found`);
        console.error(`TaskManager: Container with ID "${containerId}" not found`);
        return;
    }
    console.log('[TaskManager DEBUG] Container found:', container);

    if (!projectId) {
        console.error('[TaskManager DEBUG] projectId is missing or falsy:', projectId);
        console.error('TaskManager: projectId is required');
        renderEmptyState(container, 'No project selected');
        return;
    }

    currentProjectId = projectId;

    // Show loading state
    console.log('[TaskManager DEBUG] Rendering loading state...');
    renderLoadingState(container);

    try {
        // Fetch tasks for this project
        console.log('[TaskManager DEBUG] Starting api.fetchTasks() call...');
        const fetchStartTime = performance.now();
        const tasks = await api.fetchTasks(projectId);
        const fetchEndTime = performance.now();
        console.log(`[TaskManager DEBUG] api.fetchTasks() completed in ${(fetchEndTime - fetchStartTime).toFixed(2)}ms`);
        console.log('[TaskManager DEBUG] Tasks fetched:', { count: tasks?.length ?? 'null/undefined', tasks });

        // Ensure tasks is an array (defensive programming)
        const taskArray = Array.isArray(tasks) ? tasks : [];
        console.log('[TaskManager DEBUG] Task array after validation:', { count: taskArray.length });

        // Update local and global state
        currentTasks = taskArray;
        updateTasksState(projectId, taskArray);
        console.log('[TaskManager DEBUG] State updated with tasks');

        // Render the task UI
        console.log('[TaskManager DEBUG] Calling renderTaskManager...');
        console.log('[TaskManager DEBUG] Container BEFORE render:', {
            innerHTML: container.innerHTML.substring(0, 200),
            hasLoadingSpinner: container.innerHTML.includes('task-loading-spinner'),
            childElementCount: container.childElementCount
        });

        renderTaskManager(container, taskArray);

        console.log('[TaskManager DEBUG] renderTaskManager completed');
        console.log('[TaskManager DEBUG] Container AFTER render:', {
            innerHTML: container.innerHTML.substring(0, 200),
            hasTaskManager: container.innerHTML.includes('task-manager'),
            hasLoadingSpinner: container.innerHTML.includes('task-loading-spinner'),
            hasTaskListEmpty: container.innerHTML.includes('task-list-empty'),
            childElementCount: container.childElementCount
        });

        // Verify expected elements are in DOM
        const taskManagerEl = container.querySelector('.task-manager');
        const addBtn = container.querySelector('#task-add-btn');
        const taskListContainer = container.querySelector('#task-list-container');
        console.log('[TaskManager DEBUG] DOM verification:', {
            taskManagerFound: !!taskManagerEl,
            addButtonFound: !!addBtn,
            taskListContainerFound: !!taskListContainer,
            containerDisplay: window.getComputedStyle(container).display,
            containerVisibility: window.getComputedStyle(container).visibility,
            containerOpacity: window.getComputedStyle(container).opacity
        });

        // Add MutationObserver to track if anything changes the container
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                console.warn('[TaskManager DEBUG] MUTATION DETECTED after render!', {
                    type: mutation.type,
                    target: mutation.target.className || mutation.target.id,
                    addedNodes: mutation.addedNodes.length,
                    removedNodes: mutation.removedNodes.length
                });
                if (mutation.type === 'childList') {
                    console.warn('[TaskManager DEBUG] Container innerHTML after mutation:', container.innerHTML.substring(0, 200));
                }
            });
        });
        observer.observe(container, { childList: true, subtree: true, characterData: true });
        // Auto-disconnect after 5 seconds to avoid memory issues
        setTimeout(() => {
            observer.disconnect();
            console.log('[TaskManager DEBUG] MutationObserver disconnected after 5s');
        }, 5000);

        // Phase 5: Initialize real-time updates for this project
        console.log('[TaskManager DEBUG] Initializing real-time updates...');
        initializeRealtimeUpdates(projectId, {
            onTaskUpdate: handleRealtimeTaskUpdate
        });

        // Register callback for real-time updates
        registerTaskManagerCallback(handleRealtimeTaskUpdate);

        console.log(`[TaskManager DEBUG] Task manager fully initialized with ${taskArray.length} tasks`);
        log('TaskManager', `Loaded ${taskArray.length} tasks for project ${projectId}`);
    } catch (error) {
        console.error('[TaskManager DEBUG] Error in initTaskManager:', error);
        console.error('[TaskManager DEBUG] Error stack:', error?.stack);
        console.error('TaskManager: Error initializing:', error);
        renderErrorState(container, 'Failed to load tasks. Check console for details.');
    }
}

/**
 * Update the global state with task data
 * @param {string} projectId - The project ID
 * @param {Array} tasks - Array of task records
 */
function updateTasksState(projectId, tasks) {
    // Update tasks.all map
    tasks.forEach(task => {
        state.tasks.all.set(task.id, task);
    });

    // Update tasks.byProject map
    state.tasks.byProject.set(projectId, tasks);

    // Notify listeners (e.g. UCP badges) that tasks are now available
    window.dispatchEvent(new CustomEvent('tasks-state-updated'));
}

/**
 * Render loading state
 * @param {HTMLElement} container - The container element
 */
function renderLoadingState(container) {
    container.innerHTML = `
        <div class="task-manager-loading">
            <div class="task-loading-spinner"></div>
            <p>Loading tasks...</p>
        </div>
    `;
}

/**
 * Render error state
 * @param {HTMLElement} container - The container element
 * @param {string} message - Error message to display
 */
function renderErrorState(container, message) {
    container.innerHTML = `
        <div class="task-manager-error">
            <p>${message}</p>
            <button class="task-retry-btn" onclick="window.taskManager?.retry()">Retry</button>
        </div>
    `;
}

/**
 * Render empty state when no project is selected
 * @param {HTMLElement} container - The container element
 * @param {string} message - Message to display
 */
function renderEmptyState(container, message) {
    container.innerHTML = `
        <div class="task-manager-empty">
            <p>${message}</p>
        </div>
    `;
}

/**
 * Render the main task manager UI
 * @param {HTMLElement} container - The container element
 * @param {Array} tasks - Array of task records
 */
function renderTaskManager(container, tasks) {
    console.log('[TaskManager DEBUG] renderTaskManager called with', { tasksCount: tasks?.length ?? 'null/undefined' });
    console.log('[TaskManager DEBUG] renderTaskManager container reference:', {
        id: container?.id,
        tagName: container?.tagName,
        exists: !!container
    });

    // Cleanup existing Sortable instances before re-rendering
    cleanupSortables();

    // Phase 4: Check user permissions - default to read-only while loading
    const currentRole = state.permissions?.currentRole;
    const isLoading = state.permissions?.isLoading !== false;
    const canEditByRole = api.canEdit(currentRole);
    // Fallback: If permissions weren't loaded (direct URL access), use session.isOwned
    const canEditByOwnership = state.session.isOwned === true;
    const canUserEdit = (!isLoading && canEditByRole) || canEditByOwnership;
    const isUserViewer = !isLoading && api.isViewer(currentRole) && !canEditByOwnership;

    console.log('[TaskManager DEBUG] Permission state:', { currentRole, isLoading, canEditByRole, canEditByOwnership, canUserEdit, isUserViewer });

    // Add a class to the container for permission-based styling
    const permissionClass = isLoading ? 'permissions-loading' : (canUserEdit ? 'can-edit' : 'read-only');

    // Build the HTML string first for debugging
    const taskListHtml = renderTaskList(tasks);
    console.log('[TaskManager DEBUG] taskListHtml preview:', taskListHtml.substring(0, 150));

    const fullHtml = `
        <div class="task-manager ${permissionClass}">
            <div class="task-manager-header">
                <h3>Tasks</h3>
                <div class="task-manager-header-actions">
                    ${canUserEdit ? '<button class="task-add-btn" id="task-add-btn">+ New Task</button>' : ''}
                    ${canUserEdit ? '<button class="task-archive-completed-btn" id="task-archive-completed-btn" title="Archive completed tasks">🗑 Clear Done</button>' : ''}
                    ${isUserViewer ? '<span class="task-viewer-badge">View Only</span>' : ''}
                </div>
            </div>
            <div id="task-list-container" class="task-list-container">
                ${taskListHtml}
            </div>
        </div>
    `;

    console.log('[TaskManager DEBUG] About to set innerHTML, fullHtml preview:', fullHtml.substring(0, 200));
    console.log('[TaskManager DEBUG] container.innerHTML BEFORE:', container.innerHTML.substring(0, 100));

    container.innerHTML = fullHtml;

    console.log('[TaskManager DEBUG] container.innerHTML AFTER:', container.innerHTML.substring(0, 200));
    console.log('[TaskManager DEBUG] Container innerHTML set, attaching event listeners...');

    // Attach event listeners
    attachEventListeners(container);

    // Initialize drag-and-drop only if user can edit
    if (canUserEdit) {
        initializeSortable();
    }

    console.log('[TaskManager DEBUG] renderTaskManager completed successfully');
}

/**
 * Render the task list grouped by status
 * @param {Array} tasks - Array of task records
 * @returns {string} - HTML string for the task list
 */
function renderTaskList(tasks) {
    if (!tasks || tasks.length === 0) {
        return `
            <div class="task-list-empty">
                <p>No tasks yet. Click "+ New Task" to create one.</p>
            </div>
        `;
    }

    // Sort tasks by Order field if available, otherwise by creation time
    const sortedTasks = [...tasks].sort((a, b) => {
        const orderA = a.fields.Order ?? Infinity;
        const orderB = b.fields.Order ?? Infinity;
        if (orderA !== orderB) return orderA - orderB;
        return new Date(a.createdTime) - new Date(b.createdTime);
    });

    // Group tasks by status for Kanban-style display
    const statusGroups = {
        [api.TASK_STATUS.PENDING]: [],
        [api.TASK_STATUS.IN_PROGRESS]: [],
        [api.TASK_STATUS.BLOCKED]: [],
        [api.TASK_STATUS.COMPLETED]: []
    };

    sortedTasks.forEach(task => {
        const status = task.fields.Status || api.TASK_STATUS.PENDING;
        if (statusGroups[status]) {
            statusGroups[status].push(task);
        } else {
            statusGroups[api.TASK_STATUS.PENDING].push(task);
        }
    });

    // Combine active statuses (pending, in_progress, blocked) for drag-drop
    const activeTasks = [
        ...statusGroups[api.TASK_STATUS.PENDING],
        ...statusGroups[api.TASK_STATUS.IN_PROGRESS],
        ...statusGroups[api.TASK_STATUS.BLOCKED]
    ];
    const completedTasks = statusGroups[api.TASK_STATUS.COMPLETED];

    let html = '';

    // Active Tasks Section (sortable)
    if (activeTasks.length > 0 || completedTasks.length === 0) {
        html += `
            <div class="task-group" data-status-group="active">
                <h4 class="task-group-header">Active Tasks (${activeTasks.length})</h4>
                <div class="task-group-list task-sortable" data-status="active">
                    ${activeTasks.map(task => renderTaskCard(task)).join('')}
                </div>
            </div>
        `;
    }

    // Completed Tasks Section (sortable)
    if (completedTasks.length > 0) {
        html += `
            <div class="task-group completed-group" data-status-group="completed">
                <h4 class="task-group-header">Completed (${completedTasks.length})</h4>
                <div class="task-group-list task-sortable" data-status="completed">
                    ${completedTasks.map(task => renderTaskCard(task)).join('')}
                </div>
            </div>
        `;
    }

    return html;
}

/**
 * Render a single task card
 * @param {Object} task - Task record
 * @returns {string} - HTML string for the task card
 */
function renderTaskCard(task) {
    const fields = task.fields || {};
    const name = fields.Name || 'Untitled Task';
    const status = fields.Status || api.TASK_STATUS.PENDING;
    const dueDate = fields.DueDate ? formatDate(fields.DueDate) : '';
    const assigneeRaw = fields.Assignee || '';
    const collaborators = assigneeRaw ? assigneeRaw.split(',').map(c => c.trim()).filter(Boolean) : [];
    const isCompleted = status === api.TASK_STATUS.COMPLETED;
    const linkedItemId = fields.LinkedItem ? fields.LinkedItem[0] : null;

    // Phase 4: Check user permissions for task actions
    const currentRole = state.permissions?.currentRole;
    const isLoading = state.permissions?.isLoading !== false;
    const canEditByRole = api.canEdit(currentRole);
    // Fallback: If permissions weren't loaded (direct URL access), use session.isOwned
    const canEditByOwnership = state.session.isOwned === true;
    const canUserEdit = (!isLoading && canEditByRole) || canEditByOwnership;

    // Status badge styling
    const statusBadgeClass = getStatusBadgeClass(status);
    const statusLabel = getStatusLabel(status);

    // Get linked item info
    const linkedItemHtml = linkedItemId ? renderLinkedItemSnippet(linkedItemId) : '';

    // Only show drag handle and actions if user can edit
    const dragHandleHtml = canUserEdit ? `
            <div class="task-card-drag-handle">
                <span class="drag-icon">⋮⋮</span>
            </div>` : '';

    const actionsHtml = canUserEdit ? `
            <div class="task-card-actions">
                <button class="task-edit-btn" data-task-id="${task.id}" title="Edit task">
                    <span>Edit</span>
                </button>
                <button class="task-delete-btn" data-task-id="${task.id}" title="Delete task">
                    <span>&times;</span>
                </button>
            </div>` : '';

    return `
        <div class="task-card ${isCompleted ? 'task-completed' : ''} ${canUserEdit ? '' : 'task-card-readonly'}" data-task-id="${task.id}" data-status="${status}">
            ${dragHandleHtml}
            <div class="task-card-main">
                <div class="task-checkbox">
                    <input type="checkbox"
                           class="task-complete-checkbox"
                           data-task-id="${task.id}"
                           ${isCompleted ? 'checked' : ''}
                           ${canUserEdit ? '' : 'disabled'}>
                </div>
                <div class="task-card-content">
                    <span class="task-name ${isCompleted ? 'task-name-completed' : ''}">${escapeHtml(name)}</span>
                    <div class="task-card-meta">
                        <span class="task-status-badge ${statusBadgeClass}">${statusLabel}</span>
                        ${dueDate ? `<span class="task-due-date">${dueDate}</span>` : ''}
                        ${collaborators.length > 0 ? `<span class="task-collaborators">${collaborators.map(c => `<span class="task-collaborator-tag">${escapeHtml(c)}</span>`).join('')}</span>` : ''}
                    </div>
                    ${linkedItemHtml}
                </div>
            </div>
            ${actionsHtml}
        </div>
    `;
}

/**
 * Render linked item snippet for task card
 * Shows the linked plan item with thumbnail and name
 * @param {string} itemId - The plan item ID
 * @returns {string} - HTML string for linked item display
 */
function renderLinkedItemSnippet(itemId) {
    // Try to get item from state.records.all
    const item = state.records.all.find(r => r.id === itemId);

    if (!item) {
        return `
            <div class="task-linked-item task-linked-item-missing" data-item-id="${itemId}">
                <span class="linked-item-icon">📋</span>
                <span class="linked-item-name">Linked Item</span>
            </div>
        `;
    }

    const itemName = item.fields?.Name || 'Unnamed Item';
    const thumbnail = item.fields?.Attachments?.[0]?.thumbnails?.small?.url || '';
    const isLocked = state.cart.lockedItems?.has(itemId);
    const isIdea = state.cart.items?.has(itemId);
    const typeLabel = isLocked ? 'Plan' : (isIdea ? 'Idea' : 'Item');

    return `
        <div class="task-linked-item" data-item-id="${itemId}" title="Click to view item details">
            ${thumbnail
                ? `<img src="${thumbnail}" alt="${escapeHtml(itemName)}" class="linked-item-thumb" loading="lazy">`
                : `<span class="linked-item-icon">📋</span>`
            }
            <span class="linked-item-name">${escapeHtml(itemName)}</span>
            <span class="linked-item-type-badge">${typeLabel}</span>
        </div>
    `;
}

/**
 * Get CSS class for status badge
 * @param {string} status - Task status
 * @returns {string} - CSS class name
 */
function getStatusBadgeClass(status) {
    switch (status) {
        case api.TASK_STATUS.PENDING:
            return 'status-pending';
        case api.TASK_STATUS.IN_PROGRESS:
            return 'status-in-progress';
        case api.TASK_STATUS.BLOCKED:
            return 'status-blocked';
        case api.TASK_STATUS.COMPLETED:
            return 'status-completed';
        default:
            return 'status-pending';
    }
}

/**
 * Get human-readable label for status
 * @param {string} status - Task status
 * @returns {string} - Human-readable label
 */
function getStatusLabel(status) {
    switch (status) {
        case api.TASK_STATUS.PENDING:
            return 'Pending';
        case api.TASK_STATUS.IN_PROGRESS:
            return 'In Progress';
        case api.TASK_STATUS.BLOCKED:
            return 'Blocked';
        case api.TASK_STATUS.COMPLETED:
            return 'Completed';
        default:
            return 'Pending';
    }
}

/**
 * Format date for display
 * @param {string} dateString - ISO date string
 * @returns {string} - Formatted date string
 */
function formatDate(dateString) {
    if (!dateString) return '';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (e) {
        return dateString;
    }
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
 * Attach event listeners to the task manager
 * @param {HTMLElement} container - The container element
 */
function attachEventListeners(container) {
    // Add task button
    const addBtn = container.querySelector('#task-add-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => showTaskModal());
    }

    // Archive completed tasks button
    const archiveBtn = container.querySelector('#task-archive-completed-btn');
    if (archiveBtn) {
        archiveBtn.addEventListener('click', handleArchiveCompletedTasks);
    }

    // Task card clicks (edit, linked item)
    container.addEventListener('click', handleTaskClick);

    // Checkbox changes (complete/uncomplete)
    container.addEventListener('change', handleCheckboxChange);
}

/**
 * Handle clicks on task cards
 * @param {Event} e - Click event
 */
function handleTaskClick(e) {
    // Phase 4: Check user permissions before allowing edit actions
    const currentRole = state.permissions?.currentRole;
    const isLoading = state.permissions?.isLoading !== false;
    const canEditByRole = api.canEdit(currentRole);
    // Fallback: If permissions weren't loaded (direct URL access), use session.isOwned
    const canEditByOwnership = state.session.isOwned === true;
    const canUserEdit = (!isLoading && canEditByRole) || canEditByOwnership;

    const editBtn = e.target.closest('.task-edit-btn');
    const deleteBtn = e.target.closest('.task-delete-btn');
    const linkedItem = e.target.closest('.task-linked-item');
    const dragHandle = e.target.closest('.task-card-drag-handle');
    const taskCard = e.target.closest('.task-card');

    // Handle linked item click - open item detail (always allowed)
    if (linkedItem) {
        e.stopPropagation();
        const itemId = linkedItem.dataset.itemId;
        if (itemId) {
            // Find the item record and open the detail modal
            const record = state.records.all.find(r => r.id === itemId);
            if (record) {
                showDetailModal(record);
                log('TaskManager', `Opening item detail for: ${record.fields?.Name}`);
            } else {
                log('TaskManager', `Item not found in records: ${itemId}`);
                showToast('Item not found in catalog', 3000);
            }
        }
        return;
    }

    // Ignore clicks on drag handle
    if (dragHandle) {
        return;
    }

    // Block edit/delete actions for viewers
    if (!canUserEdit) {
        if (editBtn || deleteBtn) {
            e.stopPropagation();
            showToast('You have view-only access to this project', 3000);
            return;
        }
        // Still allow clicking on task card to view details but not edit
        return;
    }

    if (editBtn) {
        e.stopPropagation();
        const taskId = editBtn.dataset.taskId;
        const task = state.tasks.all.get(taskId);
        if (task) {
            showTaskModal(task);
        }
    } else if (deleteBtn) {
        e.stopPropagation();
        const taskId = deleteBtn.dataset.taskId;
        handleDeleteTask(taskId);
    } else if (taskCard && !e.target.closest('.task-checkbox')) {
        // Clicking on task card opens edit modal (if user can edit)
        const taskId = taskCard.dataset.taskId;
        const task = state.tasks.all.get(taskId);
        if (task) {
            showTaskModal(task);
        }
    }
}

/**
 * Handle checkbox changes for completing tasks
 * @param {Event} e - Change event
 */
async function handleCheckboxChange(e) {
    if (!e.target.classList.contains('task-complete-checkbox')) return;

    // Phase 4: Check user permissions before allowing status change
    const currentRole = state.permissions?.currentRole;
    const isLoading = state.permissions?.isLoading !== false;
    const canEditByRole = api.canEdit(currentRole);
    // Fallback: If permissions weren't loaded (direct URL access), use session.isOwned
    const canEditByOwnership = state.session.isOwned === true;
    const canUserEdit = (!isLoading && canEditByRole) || canEditByOwnership;

    if (!canUserEdit) {
        e.preventDefault();
        e.target.checked = !e.target.checked; // Revert the checkbox
        showToast('You have view-only access to this project', 3000);
        return;
    }

    const taskId = e.target.dataset.taskId;
    const isChecked = e.target.checked;
    const newStatus = isChecked ? api.TASK_STATUS.COMPLETED : api.TASK_STATUS.PENDING;

    try {
        const updatedTask = await api.updateTask(taskId, { Status: newStatus });
        if (updatedTask) {
            // Update local state
            state.tasks.all.set(taskId, updatedTask);

            // Re-render the task list
            refreshTaskList();

            showToast(isChecked ? 'Task completed!' : 'Task reopened', 2000);
        }
    } catch (error) {
        console.error('Error updating task status:', error);
        // Revert checkbox state
        e.target.checked = !isChecked;
        showToast('Failed to update task', 3000);
    }
}

/**
 * Show the task modal for creating or editing a task
 * @param {Object|null} task - Task to edit, or null for new task
 */
export function showTaskModal(task = null, projectId = null, messageId = null) {
    editingTaskId = task ? task.id : null;
    sourceMessageId = messageId; // Store message ID for linking after creation
    const isEditing = !!editingTaskId;
    const fields = task?.fields || {};
    const linkedItemId = fields.LinkedItem ? fields.LinkedItem[0] : '';

    console.log('[UCP-TASK DEBUG] showTaskModal called:', {
        isEditing,
        projectId,
        messageId,
        currentProjectId,
        taskFields: fields
    });

    // Allow external callers to specify project context
    if (projectId && !currentProjectId) {
        currentProjectId = projectId;
    }

    // Build plan items dropdown options (locked items + ideas from the current plan)
    const planItemsOptions = buildPlanItemsOptions(linkedItemId);

    // Parse existing collaborators from comma-separated Assignee field
    const existingCollaborators = fields.Assignee
        ? fields.Assignee.split(',').map(c => c.trim()).filter(Boolean)
        : [];

    // Create modal HTML
    const modalHtml = `
        <div id="task-modal-overlay" class="task-modal-overlay">
            <div class="task-modal">
                <div class="task-modal-header">
                    <h3>${isEditing ? 'Edit Task' : 'New Task'}</h3>
                    <button class="task-modal-close" id="task-modal-close">&times;</button>
                </div>
                <form id="task-form" class="task-form">
                    <div class="task-form-group">
                        <label for="task-name">Task Name *</label>
                        <input type="text" id="task-name" name="name"
                               value="${escapeHtml(fields.Name || '')}"
                               placeholder="Enter task name" required>
                    </div>
                    <div class="task-form-group">
                        <label for="task-description">Description</label>
                        <textarea id="task-description" name="description"
                                  placeholder="Add a description (optional)"
                                  rows="3">${escapeHtml(fields.Description || '')}</textarea>
                    </div>
                    <div class="task-form-row">
                        <div class="task-form-group">
                            <label for="task-status">Status</label>
                            <div class="task-status-select-wrapper">
                                <span class="task-status-indicator" id="task-status-indicator"></span>
                                <select id="task-status" name="status">
                                    <option value="${api.TASK_STATUS.PENDING}" ${fields.Status === api.TASK_STATUS.PENDING || !fields.Status ? 'selected' : ''}>Pending</option>
                                    <option value="${api.TASK_STATUS.IN_PROGRESS}" ${fields.Status === api.TASK_STATUS.IN_PROGRESS ? 'selected' : ''}>In Progress</option>
                                    <option value="${api.TASK_STATUS.BLOCKED}" ${fields.Status === api.TASK_STATUS.BLOCKED ? 'selected' : ''}>Blocked</option>
                                    <option value="${api.TASK_STATUS.COMPLETED}" ${fields.Status === api.TASK_STATUS.COMPLETED ? 'selected' : ''}>Completed</option>
                                </select>
                            </div>
                        </div>
                        <div class="task-form-group">
                            <label for="task-due-date">Due Date</label>
                            <input type="date" id="task-due-date" name="dueDate"
                                   value="${fields.DueDate || ''}">
                        </div>
                    </div>
                    <div class="task-form-group">
                        <label>Collaborators</label>
                        <div class="task-collaborators-container" id="task-collaborators-container">
                            <div class="task-collaborator-chips" id="task-collaborator-chips">
                                ${existingCollaborators.map(name => `
                                    <span class="task-collaborator-chip" data-name="${escapeHtml(name)}">
                                        ${escapeHtml(name)}
                                        <button type="button" class="task-collaborator-remove" title="Remove">&times;</button>
                                    </span>
                                `).join('')}
                            </div>
                            <input type="text" id="task-collaborator-input"
                                   placeholder="${existingCollaborators.length > 0 ? 'Add another...' : 'Add collaborator name and press Enter'}"
                                   class="task-collaborator-input"
                                   autocomplete="off">
                        </div>
                        <small class="task-form-hint">Press Enter or comma to add. Multiple collaborators can work on this task.</small>
                    </div>
                    <div class="task-form-group">
                        <label for="task-linked-item">Link Plan Item</label>
                        <select id="task-linked-item" name="linkedItem">
                            <option value="">-- No linked item --</option>
                            ${planItemsOptions}
                        </select>
                        <small class="task-form-hint">Associate a plan item with this task</small>
                    </div>
                    <div class="task-form-actions">
                        <button type="button" class="task-cancel-btn" id="task-cancel-btn">Cancel</button>
                        <button type="submit" class="task-save-btn">${isEditing ? 'Save Changes' : 'Create Task'}</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    // Insert modal into DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Attach modal event listeners
    const overlay = document.getElementById('task-modal-overlay');
    const closeBtn = document.getElementById('task-modal-close');
    const cancelBtn = document.getElementById('task-cancel-btn');
    const form = document.getElementById('task-form');

    // Setup collaborator chip input
    setupCollaboratorInput();

    // Close modal handlers
    const closeModal = () => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
        editingTaskId = null;
        sourceMessageId = null;
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // Form submit handler
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleTaskSubmit(form, closeModal);
    });

    // Setup status indicator color sync
    const statusSelect = document.getElementById('task-status');
    const statusIndicator = document.getElementById('task-status-indicator');
    if (statusSelect && statusIndicator) {
        const STATUS_COLORS = {
            'pending': '#ffc107',
            'in_progress': '#007bff',
            'blocked': '#dc3545',
            'completed': '#28a745'
        };
        const updateIndicator = () => {
            statusIndicator.style.background = STATUS_COLORS[statusSelect.value] || STATUS_COLORS['pending'];
        };
        updateIndicator(); // Set initial color
        statusSelect.addEventListener('change', updateIndicator);
    }

    // Show modal with animation
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });

    // Focus on name input
    document.getElementById('task-name').focus();
}

/**
 * Build plan items dropdown options HTML
 * Uses items from the current plan (locked items + ideas) instead of full catalog
 * @param {string} selectedItemId - Currently selected item ID
 * @returns {string} - HTML string for dropdown options
 */
function buildPlanItemsOptions(selectedItemId = '') {
    // Gather plan items: locked items (confirmed) + ideas (favorites)
    const planItemIds = new Set();
    if (state.cart.lockedItems) {
        state.cart.lockedItems.forEach((info, id) => planItemIds.add(id));
    }
    if (state.cart.items) {
        state.cart.items.forEach((info, id) => planItemIds.add(id));
    }

    if (planItemIds.size === 0) {
        return '<option value="" disabled>No plan items available</option>';
    }

    // Build option entries from plan item IDs
    const planItems = [];
    planItemIds.forEach(itemId => {
        const record = state.records.all.find(r => r.id === itemId);
        if (record) {
            planItems.push(record);
        }
    });

    // Sort items alphabetically by name
    planItems.sort((a, b) => {
        const nameA = (a.fields?.Name || '').toLowerCase();
        const nameB = (b.fields?.Name || '').toLowerCase();
        return nameA.localeCompare(nameB);
    });

    return planItems.map(item => {
        const itemId = item.id;
        const itemName = item.fields?.Name || 'Unnamed Item';
        const isLocked = state.cart.lockedItems.has(itemId);
        const typeLabel = isLocked ? 'Plan' : 'Idea';
        const isSelected = itemId === selectedItemId ? 'selected' : '';
        const displayName = `${itemName} (${typeLabel})`;

        return `<option value="${itemId}" ${isSelected}>${escapeHtml(displayName)}</option>`;
    }).join('');
}

/**
 * Setup the collaborator chip input behavior
 * Handles adding/removing collaborator names as tags
 */
function setupCollaboratorInput() {
    const input = document.getElementById('task-collaborator-input');
    const chipsContainer = document.getElementById('task-collaborator-chips');
    if (!input || !chipsContainer) return;

    // Add collaborator on Enter or comma
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const name = input.value.replace(/,/g, '').trim();
            if (name) {
                addCollaboratorChip(chipsContainer, name, input);
                input.value = '';
            }
        }
        // Remove last chip on Backspace when input is empty
        if (e.key === 'Backspace' && input.value === '') {
            const lastChip = chipsContainer.querySelector('.task-collaborator-chip:last-of-type');
            if (lastChip) {
                lastChip.remove();
            }
        }
    });

    // Also add on blur (when user clicks away)
    input.addEventListener('blur', () => {
        const name = input.value.replace(/,/g, '').trim();
        if (name) {
            addCollaboratorChip(chipsContainer, name, input);
            input.value = '';
        }
    });

    // Handle remove button clicks on existing chips
    chipsContainer.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.task-collaborator-remove');
        if (removeBtn) {
            removeBtn.closest('.task-collaborator-chip').remove();
        }
    });
}

/**
 * Add a collaborator chip to the container
 * @param {HTMLElement} container - The chips container
 * @param {string} name - The collaborator name
 * @param {HTMLInputElement} input - The input element (to update placeholder)
 */
function addCollaboratorChip(container, name, input) {
    // Prevent duplicates
    const existing = container.querySelectorAll('.task-collaborator-chip');
    for (const chip of existing) {
        if (chip.dataset.name.toLowerCase() === name.toLowerCase()) {
            return; // Already exists
        }
    }

    const chip = document.createElement('span');
    chip.className = 'task-collaborator-chip';
    chip.dataset.name = name;
    chip.innerHTML = `${escapeHtml(name)}<button type="button" class="task-collaborator-remove" title="Remove">&times;</button>`;
    container.appendChild(chip);

    // Update placeholder
    if (input) {
        input.placeholder = 'Add another...';
    }
}

/**
 * Get all collaborator names from the chips container
 * @returns {string[]} - Array of collaborator names
 */
function getCollaboratorNames() {
    const chips = document.querySelectorAll('#task-collaborator-chips .task-collaborator-chip');
    return Array.from(chips).map(chip => chip.dataset.name).filter(Boolean);
}

/**
 * Handle task form submission
 * @param {HTMLFormElement} form - The form element
 * @param {Function} closeModal - Function to close the modal
 */
async function handleTaskSubmit(form, closeModal) {
    const formData = new FormData(form);
    const linkedItemValue = formData.get('linkedItem');

    // Collect collaborators from chip input
    const collaborators = getCollaboratorNames();
    // Also check if there's text in the input that wasn't submitted as a chip
    const pendingInput = document.getElementById('task-collaborator-input');
    if (pendingInput && pendingInput.value.trim()) {
        const pending = pendingInput.value.trim();
        if (!collaborators.includes(pending)) {
            collaborators.push(pending);
        }
    }

    const taskData = {
        Name: formData.get('name')?.trim(),
        Description: formData.get('description')?.trim(),
        Status: formData.get('status'),
        DueDate: formData.get('dueDate') || null,
        Assignee: collaborators.length > 0 ? collaborators.join(', ') : null,
        LinkedItem: linkedItemValue || null
    };

    if (!taskData.Name) {
        showToast('Task name is required', 3000);
        return;
    }

    // Disable form while saving
    const saveBtn = form.querySelector('.task-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        let result;
        if (editingTaskId) {
            // Update existing task
            result = await api.updateTask(editingTaskId, taskData);
        } else {
            // Create new task - assign order at end of list
            const maxOrder = currentTasks.reduce((max, t) => {
                const order = t.fields.Order ?? 0;
                return Math.max(max, order);
            }, 0);
            taskData.Order = maxOrder + 1;
            result = await api.createTask(currentProjectId, taskData);
        }

        if (result) {
            // Update local state
            state.tasks.all.set(result.id, result);

            // Refresh the task list
            await refreshTaskList();

            // Bidirectional link: sync task's LinkedItem to the linked comment's Item Link
            const linkedItemId = result.fields?.LinkedItem?.[0] || null;
            const commentTaskLinks = state.eventDetails.combined.get('_commentTaskLinks') || {};

            // Phase 5: Broadcast the change to other collaborators
            if (editingTaskId) {
                broadcastTaskUpdated(result, taskData);

                // Dispatch event so UCP badges update with new name/status
                window.dispatchEvent(new CustomEvent('task-updated-in-chat', {
                    detail: { taskId: result.id, task: result }
                }));

                // Bidirectional: if this task has a linked comment, sync the Item Link
                const linkedMessageId = Object.keys(commentTaskLinks).find(
                    msgId => commentTaskLinks[msgId] === result.id
                );
                if (linkedMessageId && linkedItemId) {
                    api.updateChatMessageItemLink(linkedMessageId, linkedItemId).catch(err =>
                        console.warn('[TaskManager] Failed to sync comment Item Link:', err)
                    );
                }
            } else {
                broadcastTaskCreated(result);

                // Save comment-to-task link if this task was created from a chat message
                if (sourceMessageId) {
                    console.log('[UCP-TASK DEBUG] Saving comment-task link:', {
                        messageId: sourceMessageId,
                        taskId: result.id,
                        taskName: result.fields?.Name
                    });
                    const linksObj = state.eventDetails.combined.get('_commentTaskLinks') || {};
                    linksObj[sourceMessageId] = result.id;
                    state.eventDetails.combined.set('_commentTaskLinks', linksObj);

                    // Apply SourceCommentId to the in-memory task object
                    if (!result.fields) result.fields = {};
                    result.fields.SourceCommentId = sourceMessageId;

                    // Persist the link to Airtable via session save
                    triggerSave();

                    console.log('[UCP-TASK DEBUG] Comment-task link saved. All links:', linksObj);

                    // Bidirectional: sync task's LinkedItem to the comment's Item Link
                    if (linkedItemId) {
                        api.updateChatMessageItemLink(sourceMessageId, linkedItemId).catch(err =>
                            console.warn('[TaskManager] Failed to sync comment Item Link:', err)
                        );
                    }

                    // Dispatch a custom event so the UCP can update its UI
                    window.dispatchEvent(new CustomEvent('task-created-from-message', {
                        detail: { messageId: sourceMessageId, taskId: result.id, task: result }
                    }));

                    sourceMessageId = null; // Reset after use
                }
            }

            const wasEditing = !!editingTaskId;
            closeModal();
            showToast(wasEditing ? 'Task updated!' : 'Task created!', 2000);
        } else {
            throw new Error('Failed to save task');
        }
    } catch (error) {
        console.error('Error saving task:', error);
        showToast('Failed to save task. Please try again.', 3000);
        saveBtn.disabled = false;
        saveBtn.textContent = editingTaskId ? 'Save Changes' : 'Create Task';
    }
}

/**
 * Handle task deletion
 * @param {string} taskId - The task ID to delete
 */
async function handleDeleteTask(taskId) {
    const task = state.tasks.all.get(taskId);
    const taskName = task?.fields?.Name || 'this task';

    if (!confirm(`Are you sure you want to delete "${taskName}"?`)) {
        return;
    }

    try {
        const success = await api.deleteTask(taskId);
        if (success) {
            // Remove from local state
            state.tasks.all.delete(taskId);

            // Phase 5: Broadcast the deletion to other collaborators
            broadcastTaskDeleted(taskId, taskName);

            // Refresh the task list
            await refreshTaskList();

            showToast('Task deleted', 2000);
        } else {
            throw new Error('Failed to delete task');
        }
    } catch (error) {
        console.error('Error deleting task:', error);
        showToast('Failed to delete task. Please try again.', 3000);
    }
}

/**
 * Handle archiving (deleting) all completed tasks
 */
async function handleArchiveCompletedTasks() {
    const completedTasks = currentTasks.filter(t => t.fields?.Status === api.TASK_STATUS.COMPLETED);

    if (completedTasks.length === 0) {
        showToast('No completed tasks to clear', 2000);
        return;
    }

    const confirmed = confirm(
        `Remove ${completedTasks.length} completed task${completedTasks.length !== 1 ? 's' : ''}?\n\nThis cannot be undone.`
    );

    if (!confirmed) return;

    showToast('Clearing completed tasks...', 2000);

    try {
        const result = await api.archiveCompletedTasks(currentProjectId);

        if (result.success > 0) {
            // Remove from local state
            completedTasks.forEach(task => {
                state.tasks.all.delete(task.id);
            });

            // Refresh the task list
            await refreshTaskList();

            showToast(`Cleared ${result.success} completed task${result.success !== 1 ? 's' : ''}`, 3000);
        } else if (result.failed > 0) {
            showToast('Failed to clear some tasks', 3000);
        } else {
            showToast('No completed tasks to clear', 2000);
        }
    } catch (error) {
        console.error('Error archiving completed tasks:', error);
        showToast('Failed to clear completed tasks', 3000);
    }
}

/**
 * Refresh the task list by fetching from API
 */
async function refreshTaskList() {
    if (!currentProjectId) return;

    // Cleanup existing Sortable instances before re-rendering
    cleanupSortables();

    try {
        const apiTasks = await api.fetchTasks(currentProjectId);

        // Merge API results with locally-known tasks to prevent data loss
        // This handles the case where the server-side filter fails or returns incomplete results
        const apiTaskIds = new Set(apiTasks.map(t => t.id));
        const mergedTasks = [...apiTasks];

        // Preserve any locally-created/updated tasks that the API didn't return
        for (const [taskId, task] of state.tasks.all) {
            if (!apiTaskIds.has(taskId)) {
                // Check if this task belongs to the current project
                const taskProjectIds = task.fields?.ProjectId;
                const belongsToProject = Array.isArray(taskProjectIds) && taskProjectIds.includes(currentProjectId);
                if (belongsToProject) {
                    mergedTasks.push(task);
                }
            }
        }

        currentTasks = mergedTasks;
        updateTasksState(currentProjectId, mergedTasks);

        // Re-render just the task list container
        const listContainer = document.getElementById('task-list-container');
        if (listContainer) {
            listContainer.innerHTML = renderTaskList(mergedTasks);
            // Reinitialize drag-and-drop
            initializeSortable();
        }
    } catch (error) {
        console.error('Error refreshing task list:', error);
    }
}

/**
 * Retry loading tasks (for error state)
 */
export async function retry() {
    console.log('[TaskManager DEBUG] retry() called');
    const container = document.querySelector('.task-manager')?.parentElement;
    console.log('[TaskManager DEBUG] retry container:', container?.id, 'currentProjectId:', currentProjectId);
    if (container && currentProjectId) {
        await initTaskManager(container.id, currentProjectId);
    } else {
        console.error('[TaskManager DEBUG] retry failed - container or projectId missing');
    }
}

/**
 * Get the current project ID
 * @returns {string|null} - Current project ID or null
 */
export function getCurrentProjectId() {
    return currentProjectId;
}

/**
 * Get the current tasks
 * @returns {Array} - Current tasks array
 */
export function getCurrentTasks() {
    return currentTasks;
}

// =============================================================================
// DRAG-AND-DROP FUNCTIONALITY (SortableJS)
// =============================================================================

/**
 * Initialize SortableJS on task list groups
 * Enables drag-and-drop reordering within and between groups
 */
function initializeSortable() {
    // Check if Sortable is available (loaded globally via CDN)
    if (typeof Sortable === 'undefined') {
        log('TaskManager', 'SortableJS not available - drag-and-drop disabled');
        return;
    }

    const sortableLists = document.querySelectorAll('.task-sortable');

    sortableLists.forEach(list => {
        const statusGroup = list.dataset.status; // 'active' or 'completed'

        const instance = new Sortable(list, {
            group: 'tasks', // Enable cross-group dragging
            animation: 150,
            ghostClass: 'task-sortable-ghost',
            chosenClass: 'task-sortable-chosen',
            dragClass: 'task-sortable-drag',
            handle: '.task-card-drag-handle', // Only drag via handle
            forceFallback: false,
            fallbackOnBody: true,
            swapThreshold: 0.65,

            // Called when dragging ends
            onEnd: async (evt) => {
                await handleDragEnd(evt, statusGroup);
            }
        });

        sortableInstances.push(instance);
    });

    log('TaskManager', `Initialized ${sortableInstances.length} Sortable instances`);
}

/**
 * Cleanup SortableJS instances
 */
function cleanupSortables() {
    sortableInstances.forEach(instance => {
        if (instance && typeof instance.destroy === 'function') {
            instance.destroy();
        }
    });
    sortableInstances = [];
}

/**
 * Handle drag end event - update order and status in API
 * @param {Object} evt - SortableJS event object
 * @param {string} originalStatusGroup - The original status group ('active' or 'completed')
 */
async function handleDragEnd(evt, originalStatusGroup) {
    const taskId = evt.item.dataset.taskId;
    const newIndex = evt.newIndex;
    const fromList = evt.from;
    const toList = evt.to;
    const targetStatusGroup = toList.dataset.status;

    log('TaskManager', `Task ${taskId} moved to index ${newIndex} in ${targetStatusGroup} group`);

    // Store the original DOM state for potential revert
    const originalHTML = evt.from.innerHTML;
    const toOriginalHTML = evt.to.innerHTML;

    // Determine if status needs to change
    const movedToCompleted = targetStatusGroup === 'completed' && originalStatusGroup !== 'completed';
    const movedFromCompleted = targetStatusGroup === 'active' && originalStatusGroup === 'completed';

    try {
        // Prepare task orders for all tasks in the target list
        const taskCards = toList.querySelectorAll('.task-card');
        const taskOrders = [];

        taskCards.forEach((card, index) => {
            taskOrders.push({
                taskId: card.dataset.taskId,
                order: index + 1
            });
        });

        // If task moved between groups, also update orders in the source list
        if (fromList !== toList) {
            const fromTaskCards = fromList.querySelectorAll('.task-card');
            fromTaskCards.forEach((card, index) => {
                // Only add if not already in taskOrders
                if (!taskOrders.find(t => t.taskId === card.dataset.taskId)) {
                    taskOrders.push({
                        taskId: card.dataset.taskId,
                        order: index + 1
                    });
                }
            });
        }

        // Determine new status based on target group
        let newStatus = null;
        if (movedToCompleted) {
            newStatus = api.TASK_STATUS.COMPLETED;
        } else if (movedFromCompleted) {
            newStatus = api.TASK_STATUS.PENDING;
        }

        // If status changed, update it first
        if (newStatus) {
            const updatedTask = await api.updateTask(taskId, { Status: newStatus });
            if (updatedTask) {
                state.tasks.all.set(taskId, updatedTask);
                showToast(newStatus === api.TASK_STATUS.COMPLETED ? 'Task completed!' : 'Task reopened', 2000);
            }
        }

        // Update orders in background (non-blocking for UI responsiveness)
        api.updateTaskOrder(taskOrders).then(success => {
            if (success) {
                log('TaskManager', 'Task orders updated successfully');
                // Update local state with new orders
                taskOrders.forEach(({ taskId: tid, order }) => {
                    const task = state.tasks.all.get(tid);
                    if (task) {
                        task.fields.Order = order;
                    }
                });

                // Phase 5: Broadcast the reorder to other collaborators
                broadcastTaskReordered(taskOrders);
            } else {
                console.error('Failed to update task orders');
                showToast('Failed to save task order', 3000);
                // Revert DOM on failure
                revertDragDOM(fromList, toList, originalHTML, toOriginalHTML);
            }
        }).catch(error => {
            console.error('Error updating task orders:', error);
            showToast('Failed to save task order', 3000);
            revertDragDOM(fromList, toList, originalHTML, toOriginalHTML);
        });

    } catch (error) {
        console.error('Error handling drag end:', error);
        showToast('Failed to update task', 3000);
        // Revert DOM on error
        revertDragDOM(fromList, toList, originalHTML, toOriginalHTML);
    }
}

/**
 * Revert DOM to original state after failed drag operation
 * @param {HTMLElement} fromList - Original source list
 * @param {HTMLElement} toList - Original target list
 * @param {string} fromHTML - Original source list HTML
 * @param {string} toHTML - Original target list HTML
 */
function revertDragDOM(fromList, toList, fromHTML, toHTML) {
    if (fromList === toList) {
        fromList.innerHTML = fromHTML;
    } else {
        fromList.innerHTML = fromHTML;
        toList.innerHTML = toHTML;
    }
    // Reinitialize Sortable after revert
    cleanupSortables();
    initializeSortable();
}

// =============================================================================
// END DRAG-AND-DROP FUNCTIONALITY
// =============================================================================

// =============================================================================
// PHASE 5: REAL-TIME UPDATE HANDLERS
// =============================================================================

/**
 * Handle real-time task updates from other collaborators
 * @param {string} action - The action type (created, updated, deleted, reordered)
 * @param {Object} data - The event data
 */
function handleRealtimeTaskUpdate(action, data) {
    log('TaskManager', `Real-time update received: ${action}`, data);

    // Check if we're currently viewing this project
    if (!currentProjectId) return;

    const listContainer = document.getElementById('task-list-container');
    if (!listContainer) return;

    switch (action) {
        case 'created':
            // A new task was created by another user
            if (data && data.id) {
                // Check if task already exists (avoid duplicates)
                if (!currentTasks.find(t => t.id === data.id)) {
                    currentTasks.push(data);
                    // Smooth re-render without full page refresh
                    rerenderTaskListSmooth(listContainer);
                }
            }
            break;

        case 'updated':
            // A task was updated by another user
            if (data && data.id) {
                const taskIndex = currentTasks.findIndex(t => t.id === data.id);
                if (taskIndex >= 0) {
                    currentTasks[taskIndex] = data;
                    // Update just the specific task card if possible
                    updateTaskCardInPlace(data.id, data);
                }
            }
            break;

        case 'deleted':
            // A task was deleted by another user
            if (data && data.id) {
                const taskIndex = currentTasks.findIndex(t => t.id === data.id);
                if (taskIndex >= 0) {
                    currentTasks.splice(taskIndex, 1);
                    // Remove the task card with animation
                    removeTaskCardWithAnimation(data.id);
                }
            }
            break;

        case 'reordered':
            // Tasks were reordered by another user
            if (data && Array.isArray(data)) {
                // Update local orders
                data.forEach(({ taskId, order }) => {
                    const task = currentTasks.find(t => t.id === taskId);
                    if (task) {
                        task.fields.Order = order;
                    }
                });
                // Re-render to reflect new order
                rerenderTaskListSmooth(listContainer);
            }
            break;

        default:
            log('TaskManager', `Unknown real-time action: ${action}`);
    }
}

/**
 * Smoothly re-render the task list without jarring layout shifts
 * @param {HTMLElement} container - The task list container
 */
function rerenderTaskListSmooth(container) {
    // Cleanup existing Sortable instances
    cleanupSortables();

    // Add a transition class for smooth update
    container.classList.add('updating');

    // Re-render after a brief delay for animation
    setTimeout(() => {
        container.innerHTML = renderTaskList(currentTasks);
        container.classList.remove('updating');

        // Reinitialize drag-and-drop if user can edit
        const currentRole = state.permissions?.currentRole;
        const isLoading = state.permissions?.isLoading !== false;
        const canEditByRole = api.canEdit(currentRole);
        // Fallback: If permissions weren't loaded (direct URL access), use session.isOwned
        const canEditByOwnership = state.session.isOwned === true;
        const canUserEdit = (!isLoading && canEditByRole) || canEditByOwnership;
        if (canUserEdit) {
            initializeSortable();
        }
    }, 150);
}

/**
 * Update a single task card in place without full re-render
 * @param {string} taskId - The task ID to update
 * @param {Object} task - The updated task data
 */
function updateTaskCardInPlace(taskId, task) {
    const taskCard = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
    if (!taskCard) {
        // Card not found, do a full re-render
        const listContainer = document.getElementById('task-list-container');
        if (listContainer) {
            rerenderTaskListSmooth(listContainer);
        }
        return;
    }

    // Update task name
    const nameEl = taskCard.querySelector('.task-name');
    if (nameEl) {
        nameEl.textContent = task.fields?.Name || 'Untitled Task';
        nameEl.classList.toggle('task-name-completed', task.fields?.Status === api.TASK_STATUS.COMPLETED);
    }

    // Update status badge
    const statusBadge = taskCard.querySelector('.task-status-badge');
    if (statusBadge) {
        statusBadge.className = `task-status-badge ${getStatusBadgeClass(task.fields?.Status)}`;
        statusBadge.textContent = getStatusLabel(task.fields?.Status);
    }

    // Update checkbox
    const checkbox = taskCard.querySelector('.task-complete-checkbox');
    if (checkbox) {
        checkbox.checked = task.fields?.Status === api.TASK_STATUS.COMPLETED;
    }

    // Update completed state on card
    taskCard.classList.toggle('task-completed', task.fields?.Status === api.TASK_STATUS.COMPLETED);

    // Add a brief highlight animation
    taskCard.classList.add('realtime-updated');
    setTimeout(() => {
        taskCard.classList.remove('realtime-updated');
    }, 2000);
}

/**
 * Remove a task card with a fade-out animation
 * @param {string} taskId - The task ID to remove
 */
function removeTaskCardWithAnimation(taskId) {
    const taskCard = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
    if (taskCard) {
        taskCard.classList.add('removing');
        setTimeout(() => {
            taskCard.remove();

            // Check if the group is now empty
            const groups = document.querySelectorAll('.task-group-list');
            groups.forEach(group => {
                if (group.children.length === 0) {
                    // Re-render to show empty state if needed
                    const listContainer = document.getElementById('task-list-container');
                    if (listContainer && currentTasks.length === 0) {
                        listContainer.innerHTML = renderTaskList([]);
                    }
                }
            });
        }, 300);
    }
}

// =============================================================================
// END REAL-TIME UPDATE HANDLERS
// =============================================================================

// Expose retry function globally for error state button
window.taskManager = { retry };
