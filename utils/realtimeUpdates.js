// FILE: utils/realtimeUpdates.js
// Phase 5: Real-time update handlers for Projects and Tasks
// Handles incoming Pusher events and updates UI accordingly

import { state, setState } from '../state.js';
import { log } from './debug.js';
import { subscribeToProject, unsubscribeFromProject, triggerProjectEvent, getPusherInstance } from '../pusher.js';
import { showToast } from '../ui.js';
import * as api from '../api.js';

// Track if real-time is initialized for the current project
let isInitialized = false;
let currentProjectId = null;

// Callback registry for component updates
const updateCallbacks = {
    taskManager: null,
    projectsDashboard: null
};

/**
 * Show a toast notification for real-time updates
 * @param {string} message - Message to display
 * @param {string} type - Type of notification (info, success, warning)
 */
function showRealtimeToast(message, type = 'info') {
    // Create a styled toast for real-time updates
    const toastContainer = document.getElementById('toast-notification');
    if (toastContainer) {
        // Add a specific class for real-time updates
        toastContainer.classList.add('realtime-toast');
        showToast(message, 4000);

        // Remove the class after animation
        setTimeout(() => {
            toastContainer.classList.remove('realtime-toast');
        }, 4500);
    } else {
        showToast(message, 4000);
    }
}

/**
 * Initialize real-time updates for a project
 * @param {string} projectId - The project ID to monitor
 * @param {Object} options - Configuration options
 */
export function initializeRealtimeUpdates(projectId, options = {}) {
    if (!projectId) {
        log('RealtimeUpdates', 'Cannot initialize - no project ID provided');
        return;
    }

    // Already initialized for this project
    if (isInitialized && currentProjectId === projectId) {
        log('RealtimeUpdates', `Already initialized for project: ${projectId}`);
        return;
    }

    // Wait for Pusher to be available
    if (!getPusherInstance()) {
        log('RealtimeUpdates', 'Pusher not initialized - waiting...');
        // Try again when Pusher is ready
        if (typeof window.waitForPusher === 'function') {
            window.waitForPusher().then(() => {
                initializeRealtimeUpdates(projectId, options);
            }).catch(err => {
                console.error('Failed to wait for Pusher:', err);
            });
        }
        return;
    }

    // Store callbacks
    if (options.onTaskUpdate) {
        updateCallbacks.taskManager = options.onTaskUpdate;
    }
    if (options.onProjectUpdate) {
        updateCallbacks.projectsDashboard = options.onProjectUpdate;
    }

    // Subscribe to project channel with event handlers
    subscribeToProject(projectId, {
        onTaskCreated: handleTaskCreated,
        onTaskUpdated: handleTaskUpdated,
        onTaskDeleted: handleTaskDeleted,
        onTaskReordered: handleTaskReordered,
        onProjectStatusChanged: handleProjectStatusChanged,
        onProjectUpdated: handleProjectUpdated,
        onItemAdded: handleItemAdded,
        onItemRemoved: handleItemRemoved,
        onCollaboratorJoined: handleCollaboratorJoined
    });

    isInitialized = true;
    currentProjectId = projectId;

    log('RealtimeUpdates', `Initialized real-time updates for project: ${projectId}`);
}

/**
 * Cleanup real-time updates when leaving a project
 */
export function cleanupRealtimeUpdates() {
    unsubscribeFromProject();
    isInitialized = false;
    currentProjectId = null;
    updateCallbacks.taskManager = null;
    updateCallbacks.projectsDashboard = null;
    log('RealtimeUpdates', 'Cleaned up real-time updates');
}

/**
 * Register a callback for task manager updates
 * @param {Function} callback - Callback function to call on updates
 */
export function registerTaskManagerCallback(callback) {
    updateCallbacks.taskManager = callback;
}

/**
 * Register a callback for projects dashboard updates
 * @param {Function} callback - Callback function to call on updates
 */
export function registerProjectsDashboardCallback(callback) {
    updateCallbacks.projectsDashboard = callback;
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

/**
 * Handle task-created event
 * @param {Object} data - Event data containing the new task
 */
function handleTaskCreated(data) {
    log('RealtimeUpdates', 'Task created event received', data);

    // Don't process if this is our own action
    if (data.userId === state.session.user?.id) {
        return;
    }

    const { task, userName } = data;

    if (task && task.id) {
        // Add to state
        state.tasks.all.set(task.id, task);

        // Update byProject map
        const projectTasks = state.tasks.byProject.get(currentProjectId) || [];
        projectTasks.push(task);
        state.tasks.byProject.set(currentProjectId, projectTasks);

        // Show notification
        showRealtimeToast(`${userName || 'A collaborator'} created task: "${task.fields?.Name || 'New task'}"`);

        // Trigger UI update
        if (updateCallbacks.taskManager) {
            updateCallbacks.taskManager('created', task);
        }
    }
}

/**
 * Handle task-updated event
 * @param {Object} data - Event data containing the updated task
 */
function handleTaskUpdated(data) {
    log('RealtimeUpdates', 'Task updated event received', data);

    // Don't process if this is our own action
    if (data.userId === state.session.user?.id) {
        return;
    }

    const { task, userName, changes } = data;

    if (task && task.id) {
        // Update in state
        state.tasks.all.set(task.id, task);

        // Update in byProject map
        const projectTasks = state.tasks.byProject.get(currentProjectId) || [];
        const taskIndex = projectTasks.findIndex(t => t.id === task.id);
        if (taskIndex >= 0) {
            projectTasks[taskIndex] = task;
            state.tasks.byProject.set(currentProjectId, projectTasks);
        }

        // Show notification with change details
        let changeDescription = 'updated';
        if (changes) {
            if (changes.Status) {
                changeDescription = `marked as ${changes.Status}`;
            } else if (changes.Name) {
                changeDescription = 'renamed';
            }
        }
        showRealtimeToast(`${userName || 'A collaborator'} ${changeDescription} task: "${task.fields?.Name || 'task'}"`);

        // Trigger UI update
        if (updateCallbacks.taskManager) {
            updateCallbacks.taskManager('updated', task);
        }
    }
}

/**
 * Handle task-deleted event
 * @param {Object} data - Event data containing the deleted task ID
 */
function handleTaskDeleted(data) {
    log('RealtimeUpdates', 'Task deleted event received', data);

    // Don't process if this is our own action
    if (data.userId === state.session.user?.id) {
        return;
    }

    const { taskId, taskName, userName } = data;

    if (taskId) {
        // Remove from state
        state.tasks.all.delete(taskId);

        // Remove from byProject map
        const projectTasks = state.tasks.byProject.get(currentProjectId) || [];
        const filteredTasks = projectTasks.filter(t => t.id !== taskId);
        state.tasks.byProject.set(currentProjectId, filteredTasks);

        // Show notification
        showRealtimeToast(`${userName || 'A collaborator'} deleted task: "${taskName || 'task'}"`);

        // Trigger UI update
        if (updateCallbacks.taskManager) {
            updateCallbacks.taskManager('deleted', { id: taskId });
        }
    }
}

/**
 * Handle task-reordered event
 * @param {Object} data - Event data containing the new task orders
 */
function handleTaskReordered(data) {
    log('RealtimeUpdates', 'Task reordered event received', data);

    // Don't process if this is our own action
    if (data.userId === state.session.user?.id) {
        return;
    }

    const { taskOrders, userName } = data;

    if (taskOrders && Array.isArray(taskOrders)) {
        // Update orders in state
        taskOrders.forEach(({ taskId, order }) => {
            const task = state.tasks.all.get(taskId);
            if (task) {
                task.fields.Order = order;
            }
        });

        // Show notification
        showRealtimeToast(`${userName || 'A collaborator'} reordered tasks`);

        // Trigger UI update
        if (updateCallbacks.taskManager) {
            updateCallbacks.taskManager('reordered', taskOrders);
        }
    }
}

/**
 * Handle project-status-changed event
 * @param {Object} data - Event data containing the new status
 */
function handleProjectStatusChanged(data) {
    log('RealtimeUpdates', 'Project status changed event received', data);

    // Don't process if this is our own action
    if (data.userId === state.session.user?.id) {
        return;
    }

    const { status, userName } = data;

    showRealtimeToast(`${userName || 'A collaborator'} changed project status to: ${status}`);

    // Trigger UI update
    if (updateCallbacks.projectsDashboard) {
        updateCallbacks.projectsDashboard('statusChanged', { status });
    }
}

/**
 * Handle project-updated event
 * @param {Object} data - Event data containing the updated project info
 */
function handleProjectUpdated(data) {
    log('RealtimeUpdates', 'Project updated event received', data);

    // Don't process if this is our own action
    if (data.userId === state.session.user?.id) {
        return;
    }

    const { project, userName, changes } = data;

    showRealtimeToast(`${userName || 'A collaborator'} updated the project`);

    // Trigger UI update
    if (updateCallbacks.projectsDashboard) {
        updateCallbacks.projectsDashboard('projectUpdated', { project, changes });
    }
}

/**
 * Handle item-added event
 * @param {Object} data - Event data containing the added item
 */
function handleItemAdded(data) {
    log('RealtimeUpdates', 'Item added event received', data);

    // Don't process if this is our own action
    if (data.userId === state.session.user?.id) {
        return;
    }

    const { itemId, itemName, userName } = data;

    showRealtimeToast(`${userName || 'A collaborator'} added "${itemName || 'an item'}" to the plan`);
}

/**
 * Handle item-removed event
 * @param {Object} data - Event data containing the removed item
 */
function handleItemRemoved(data) {
    log('RealtimeUpdates', 'Item removed event received', data);

    // Don't process if this is our own action
    if (data.userId === state.session.user?.id) {
        return;
    }

    const { itemId, itemName, userName } = data;

    showRealtimeToast(`${userName || 'A collaborator'} removed "${itemName || 'an item'}" from the plan`);
}

/**
 * Handle collaborator-joined event
 * @param {Object} data - Event data containing the collaborator info
 */
function handleCollaboratorJoined(data) {
    log('RealtimeUpdates', 'Collaborator joined event received', data);

    const { userName, role } = data;

    showRealtimeToast(`${userName || 'Someone'} joined the project as ${role || 'collaborator'}`);
}

// =============================================================================
// BROADCAST FUNCTIONS - Call these when making changes to notify others
// =============================================================================

/**
 * Broadcast that a task was created
 * @param {Object} task - The created task
 */
export function broadcastTaskCreated(task) {
    triggerProjectEvent('client-task-created', {
        task,
        userName: state.session.user?.name
    });
}

/**
 * Broadcast that a task was updated
 * @param {Object} task - The updated task
 * @param {Object} changes - What changed
 */
export function broadcastTaskUpdated(task, changes = {}) {
    triggerProjectEvent('client-task-updated', {
        task,
        changes,
        userName: state.session.user?.name
    });
}

/**
 * Broadcast that a task was deleted
 * @param {string} taskId - The deleted task ID
 * @param {string} taskName - The task name for display
 */
export function broadcastTaskDeleted(taskId, taskName) {
    triggerProjectEvent('client-task-deleted', {
        taskId,
        taskName,
        userName: state.session.user?.name
    });
}

/**
 * Broadcast that tasks were reordered
 * @param {Array} taskOrders - Array of { taskId, order } objects
 */
export function broadcastTaskReordered(taskOrders) {
    triggerProjectEvent('client-task-reordered', {
        taskOrders,
        userName: state.session.user?.name
    });
}

/**
 * Broadcast that an item was added to the plan
 * @param {string} itemId - The item ID
 * @param {string} itemName - The item name
 */
export function broadcastItemAdded(itemId, itemName) {
    triggerProjectEvent('client-item-added', {
        itemId,
        itemName,
        userName: state.session.user?.name
    });
}

/**
 * Broadcast that an item was removed from the plan
 * @param {string} itemId - The item ID
 * @param {string} itemName - The item name
 */
export function broadcastItemRemoved(itemId, itemName) {
    triggerProjectEvent('client-item-removed', {
        itemId,
        itemName,
        userName: state.session.user?.name
    });
}
