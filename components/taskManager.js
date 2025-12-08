// FILE: components/taskManager.js
// Phase 3a: Basic Task Operations & UI
// Provides task management interface for a selected project

import { state, setState } from '../state.js';
import { log } from '../utils/debug.js';
import * as api from '../api.js';
import { showToast } from '../ui.js';

// Local component state
let currentProjectId = null;
let currentTasks = [];
let editingTaskId = null;

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
    container.innerHTML = `
        <div class="task-manager">
            <div class="task-manager-header">
                <h3>Tasks</h3>
                <button class="task-add-btn" id="task-add-btn">+ New Task</button>
            </div>
            <div id="task-list-container" class="task-list-container">
                ${renderTaskList(tasks)}
            </div>
        </div>
    `;

    // Attach event listeners
    attachEventListeners(container);
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

    // Group tasks by status
    const pendingTasks = tasks.filter(t =>
        t.fields.Status === api.TASK_STATUS.PENDING ||
        t.fields.Status === api.TASK_STATUS.IN_PROGRESS ||
        t.fields.Status === api.TASK_STATUS.BLOCKED ||
        !t.fields.Status
    );
    const completedTasks = tasks.filter(t => t.fields.Status === api.TASK_STATUS.COMPLETED);

    let html = '';

    // Pending/Active Tasks Section
    if (pendingTasks.length > 0) {
        html += `
            <div class="task-group">
                <h4 class="task-group-header">Active Tasks (${pendingTasks.length})</h4>
                <div class="task-group-list">
                    ${pendingTasks.map(task => renderTaskCard(task)).join('')}
                </div>
            </div>
        `;
    }

    // Completed Tasks Section
    if (completedTasks.length > 0) {
        html += `
            <div class="task-group completed-group">
                <h4 class="task-group-header">Completed (${completedTasks.length})</h4>
                <div class="task-group-list">
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

    // Status badge styling
    const statusBadgeClass = getStatusBadgeClass(status);
    const statusLabel = getStatusLabel(status);

    return `
        <div class="task-card ${isCompleted ? 'task-completed' : ''}" data-task-id="${task.id}">
            <div class="task-card-main">
                <div class="task-checkbox">
                    <input type="checkbox"
                           class="task-complete-checkbox"
                           data-task-id="${task.id}"
                           ${isCompleted ? 'checked' : ''}>
                </div>
                <div class="task-card-content">
                    <span class="task-name ${isCompleted ? 'task-name-completed' : ''}">${escapeHtml(name)}</span>
                    <div class="task-card-meta">
                        <span class="task-status-badge ${statusBadgeClass}">${statusLabel}</span>
                        ${dueDate ? `<span class="task-due-date">${dueDate}</span>` : ''}
                        ${assignee ? `<span class="task-assignee">${escapeHtml(assignee)}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="task-card-actions">
                <button class="task-edit-btn" data-task-id="${task.id}" title="Edit task">
                    <span>Edit</span>
                </button>
                <button class="task-delete-btn" data-task-id="${task.id}" title="Delete task">
                    <span>&times;</span>
                </button>
            </div>
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

    // Task card clicks (edit)
    container.addEventListener('click', handleTaskClick);

    // Checkbox changes (complete/uncomplete)
    container.addEventListener('change', handleCheckboxChange);
}

/**
 * Handle clicks on task cards
 * @param {Event} e - Click event
 */
function handleTaskClick(e) {
    const editBtn = e.target.closest('.task-edit-btn');
    const deleteBtn = e.target.closest('.task-delete-btn');
    const taskCard = e.target.closest('.task-card');

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
        // Clicking on task card opens edit modal
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
 * Handle task form submission
 * @param {HTMLFormElement} form - The form element
 * @param {Function} closeModal - Function to close the modal
 */
async function handleTaskSubmit(form, closeModal) {
    const formData = new FormData(form);
    const taskData = {
        Name: formData.get('name')?.trim(),
        Description: formData.get('description')?.trim(),
        Status: formData.get('status'),
        DueDate: formData.get('dueDate') || null,
        Assignee: formData.get('assignee')?.trim() || null
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
            // Create new task
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

    try {
        const tasks = await api.fetchTasks(currentProjectId);
        currentTasks = tasks;
        updateTasksState(currentProjectId, tasks);

        // Re-render just the task list container
        const listContainer = document.getElementById('task-list-container');
        if (listContainer) {
            listContainer.innerHTML = renderTaskList(tasks);
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

// Expose retry function globally for error state button
window.taskManager = { retry };
