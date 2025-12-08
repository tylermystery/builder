// FILE: components/taskManager.js
// Phase 3b: Advanced Interactions - Drag-and-Drop Reordering & Item Linking
// Phase 4: Permissions & Security - UI Guarding for read-only views
// Provides task management interface for a selected project

import { state, setState } from '../state.js';
import { log } from '../utils/debug.js';
import * as api from '../api.js';
import { showToast } from '../ui.js';

// Local component state
let currentProjectId = null;
let currentTasks = [];
let editingTaskId = null;
let sortableInstances = []; // Track SortableJS instances for cleanup

/**
 * Initialize the Task Manager for a specific project
 * Main entry point for the component
 * @param {string} containerId - The DOM element ID to mount the task UI
 * @param {string} projectId - The project/session ID to manage tasks for
 */
export async function initTaskManager(containerId, projectId) {
    log('TaskManager', `Initializing task manager for project: ${projectId}`);

    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`TaskManager: Container with ID "${containerId}" not found`);
        return;
    }

    if (!projectId) {
        console.error('TaskManager: projectId is required');
        renderEmptyState(container, 'No project selected');
        return;
    }

    currentProjectId = projectId;

    // Show loading state
    renderLoadingState(container);

    try {
        // Fetch tasks for this project
        const tasks = await api.fetchTasks(projectId);

        // Update local and global state
        currentTasks = tasks;
        updateTasksState(projectId, tasks);

        // Render the task UI
        renderTaskManager(container, tasks);

        log('TaskManager', `Loaded ${tasks.length} tasks for project ${projectId}`);
    } catch (error) {
        console.error('TaskManager: Error initializing:', error);
        renderErrorState(container, 'Failed to load tasks');
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
    // Cleanup existing Sortable instances before re-rendering
    cleanupSortables();

    // Phase 4: Check user permissions - default to read-only while loading
    const currentRole = state.permissions?.currentRole;
    const isLoading = state.permissions?.isLoading !== false;
    const canUserEdit = !isLoading && api.canEdit(currentRole);
    const isUserViewer = !isLoading && api.isViewer(currentRole);

    // Add a class to the container for permission-based styling
    const permissionClass = isLoading ? 'permissions-loading' : (canUserEdit ? 'can-edit' : 'read-only');

    container.innerHTML = `
        <div class="task-manager ${permissionClass}">
            <div class="task-manager-header">
                <h3>Tasks</h3>
                ${canUserEdit ? '<button class="task-add-btn" id="task-add-btn">+ New Task</button>' : ''}
                ${isUserViewer ? '<span class="task-viewer-badge">View Only</span>' : ''}
            </div>
            <div id="task-list-container" class="task-list-container">
                ${renderTaskList(tasks)}
            </div>
        </div>
    `;

    // Attach event listeners
    attachEventListeners(container);

    // Initialize drag-and-drop only if user can edit
    if (canUserEdit) {
        initializeSortable();
    }
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
    const assignee = fields.Assignee || '';
    const isCompleted = status === api.TASK_STATUS.COMPLETED;
    const linkedItemId = fields.LinkedItem ? fields.LinkedItem[0] : null;

    // Phase 4: Check user permissions for task actions
    const currentRole = state.permissions?.currentRole;
    const isLoading = state.permissions?.isLoading !== false;
    const canUserEdit = !isLoading && api.canEdit(currentRole);

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
                        ${assignee ? `<span class="task-assignee">${escapeHtml(assignee)}</span>` : ''}
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
 * @param {string} itemId - The catalog item ID
 * @returns {string} - HTML string for linked item display
 */
function renderLinkedItemSnippet(itemId) {
    // Try to get item from state.records.all
    const item = state.records.all.find(r => r.id === itemId);

    if (!item) {
        return `
            <div class="task-linked-item task-linked-item-missing" data-item-id="${itemId}">
                <span class="linked-item-icon">📦</span>
                <span class="linked-item-name">Linked Item</span>
            </div>
        `;
    }

    const itemName = item.fields?.Name || 'Unnamed Item';
    const thumbnail = item.fields?.Attachments?.[0]?.thumbnails?.small?.url || '';

    return `
        <div class="task-linked-item" data-item-id="${itemId}" title="Click to view item details">
            ${thumbnail
                ? `<img src="${thumbnail}" alt="${escapeHtml(itemName)}" class="linked-item-thumb" loading="lazy">`
                : `<span class="linked-item-icon">📦</span>`
            }
            <span class="linked-item-name">${escapeHtml(itemName)}</span>
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
    const canUserEdit = !isLoading && api.canEdit(currentRole);

    const editBtn = e.target.closest('.task-edit-btn');
    const deleteBtn = e.target.closest('.task-delete-btn');
    const linkedItem = e.target.closest('.task-linked-item');
    const dragHandle = e.target.closest('.task-card-drag-handle');
    const taskCard = e.target.closest('.task-card');

    // Handle linked item click - open item detail (always allowed)
    if (linkedItem) {
        e.stopPropagation();
        const itemId = linkedItem.dataset.itemId;
        if (itemId && typeof window.showItemDetail === 'function') {
            window.showItemDetail(itemId);
        } else {
            log('TaskManager', `Item detail view not available for item: ${itemId}`);
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
    const canUserEdit = !isLoading && api.canEdit(currentRole);

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
function showTaskModal(task = null) {
    editingTaskId = task ? task.id : null;
    const isEditing = !!task;
    const fields = task?.fields || {};
    const linkedItemId = fields.LinkedItem ? fields.LinkedItem[0] : '';

    // Build catalog items dropdown options
    const catalogItemsOptions = buildCatalogItemsOptions(linkedItemId);

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
                            <select id="task-status" name="status">
                                <option value="${api.TASK_STATUS.PENDING}" ${fields.Status === api.TASK_STATUS.PENDING || !fields.Status ? 'selected' : ''}>Pending</option>
                                <option value="${api.TASK_STATUS.IN_PROGRESS}" ${fields.Status === api.TASK_STATUS.IN_PROGRESS ? 'selected' : ''}>In Progress</option>
                                <option value="${api.TASK_STATUS.BLOCKED}" ${fields.Status === api.TASK_STATUS.BLOCKED ? 'selected' : ''}>Blocked</option>
                                <option value="${api.TASK_STATUS.COMPLETED}" ${fields.Status === api.TASK_STATUS.COMPLETED ? 'selected' : ''}>Completed</option>
                            </select>
                        </div>
                        <div class="task-form-group">
                            <label for="task-due-date">Due Date</label>
                            <input type="date" id="task-due-date" name="dueDate"
                                   value="${fields.DueDate || ''}">
                        </div>
                    </div>
                    <div class="task-form-group">
                        <label for="task-assignee">Assignee</label>
                        <input type="text" id="task-assignee" name="assignee"
                               value="${escapeHtml(fields.Assignee || '')}"
                               placeholder="Assign to someone (optional)">
                    </div>
                    <div class="task-form-group">
                        <label for="task-linked-item">Link Catalog Item</label>
                        <div class="task-linked-item-select-wrapper">
                            <select id="task-linked-item" name="linkedItem">
                                <option value="">-- No linked item --</option>
                                ${catalogItemsOptions}
                            </select>
                            <input type="text" id="task-linked-item-search"
                                   placeholder="Search items..."
                                   class="task-linked-item-search">
                        </div>
                        <small class="task-form-hint">Associate a catalog item/product with this task</small>
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
    const linkedItemSelect = document.getElementById('task-linked-item');
    const linkedItemSearch = document.getElementById('task-linked-item-search');

    // Setup linked item search/filter
    setupLinkedItemSearch(linkedItemSelect, linkedItemSearch);

    // Close modal handlers
    const closeModal = () => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
        editingTaskId = null;
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

    // Show modal with animation
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });

    // Focus on name input
    document.getElementById('task-name').focus();
}

/**
 * Build catalog items dropdown options HTML
 * @param {string} selectedItemId - Currently selected item ID
 * @returns {string} - HTML string for dropdown options
 */
function buildCatalogItemsOptions(selectedItemId = '') {
    const items = state.records.all || [];

    if (items.length === 0) {
        return '<option value="" disabled>No catalog items available</option>';
    }

    // Sort items alphabetically by name
    const sortedItems = [...items].sort((a, b) => {
        const nameA = (a.fields?.Name || '').toLowerCase();
        const nameB = (b.fields?.Name || '').toLowerCase();
        return nameA.localeCompare(nameB);
    });

    return sortedItems.map(item => {
        const itemId = item.id;
        const itemName = item.fields?.Name || 'Unnamed Item';
        const itemType = item.fields?.['Item Type'] || '';
        const isSelected = itemId === selectedItemId ? 'selected' : '';
        const displayName = itemType ? `${itemName} (${itemType})` : itemName;

        return `<option value="${itemId}" ${isSelected}>${escapeHtml(displayName)}</option>`;
    }).join('');
}

/**
 * Setup linked item search filtering
 * @param {HTMLSelectElement} selectEl - The select element
 * @param {HTMLInputElement} searchEl - The search input element
 */
function setupLinkedItemSearch(selectEl, searchEl) {
    if (!selectEl || !searchEl) return;

    // Store original options
    const originalOptions = Array.from(selectEl.options).map(opt => ({
        value: opt.value,
        text: opt.text,
        selected: opt.selected
    }));

    searchEl.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();

        // Clear and repopulate select
        selectEl.innerHTML = '';

        // Always add the "no linked item" option
        const noItemOption = document.createElement('option');
        noItemOption.value = '';
        noItemOption.textContent = '-- No linked item --';
        selectEl.appendChild(noItemOption);

        // Filter and add matching options
        originalOptions.forEach(opt => {
            if (opt.value === '') return; // Skip the empty option we already added

            if (!searchTerm || opt.text.toLowerCase().includes(searchTerm)) {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.text;
                option.selected = opt.selected;
                selectEl.appendChild(option);
            }
        });
    });
}

/**
 * Handle task form submission
 * @param {HTMLFormElement} form - The form element
 * @param {Function} closeModal - Function to close the modal
 */
async function handleTaskSubmit(form, closeModal) {
    const formData = new FormData(form);
    const linkedItemValue = formData.get('linkedItem');

    const taskData = {
        Name: formData.get('name')?.trim(),
        Description: formData.get('description')?.trim(),
        Status: formData.get('status'),
        DueDate: formData.get('dueDate') || null,
        Assignee: formData.get('assignee')?.trim() || null,
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

            closeModal();
            showToast(editingTaskId ? 'Task updated!' : 'Task created!', 2000);
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
 * Refresh the task list by fetching from API
 */
async function refreshTaskList() {
    if (!currentProjectId) return;

    // Cleanup existing Sortable instances before re-rendering
    cleanupSortables();

    try {
        const tasks = await api.fetchTasks(currentProjectId);
        currentTasks = tasks;
        updateTasksState(currentProjectId, tasks);

        // Re-render just the task list container
        const listContainer = document.getElementById('task-list-container');
        if (listContainer) {
            listContainer.innerHTML = renderTaskList(tasks);
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
    const container = document.querySelector('.task-manager')?.parentElement;
    if (container && currentProjectId) {
        await initTaskManager(container.id, currentProjectId);
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

// Expose retry function globally for error state button
window.taskManager = { retry };
