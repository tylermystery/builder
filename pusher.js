// FILE: pusher.js
// Phase 5: Real-time updates for Projects and Tasks
// Provides Pusher initialization and project channel subscriptions

import { log } from './utils/debug.js';
import { state, setState } from './state.js';

// Module-level variables for tracking subscriptions
let pusherInstance = null;
let projectChannel = null;
let currentSubscribedProjectId = null;

// Event listeners registry for cleanup
const eventListeners = new Map();

/**
 * Initialize the Pusher client
 * @param {string} key - Pusher app key
 * @param {string} cluster - Pusher cluster
 * @param {string} sessionId - Current session ID for auth
 * @returns {Object|null} - Pusher instance or null on failure
 */
export function initializePusher(key, cluster, sessionId) {
    // This check is important.
    if (!window.Pusher) {
        console.error("Pusher library is not loaded. Real-time features will be disabled.");
        return null;
    }

    try {
        // Access Pusher from the global 'window' object, not an import
        const pusher = new window.Pusher(key, {
            cluster: cluster,
            encrypted: true,
            authEndpoint: '/api/pusher-auth',
            auth: {
                params: { sessionId: sessionId }
            }
        });

        pusherInstance = pusher;
        log('Pusher', 'Pusher client initialized.');
        return pusher;

    } catch (error) {
        console.error("Failed to initialize Pusher:", error);
        return null;
    }
}

/**
 * Get the current Pusher instance
 * @returns {Object|null} - Current Pusher instance
 */
export function getPusherInstance() {
    return pusherInstance;
}

/**
 * Subscribe to a project channel for real-time updates
 * @param {string} projectId - The project ID to subscribe to
 * @param {Object} callbacks - Object containing event handler callbacks
 * @returns {Object|null} - The subscribed channel or null
 */
export function subscribeToProject(projectId, callbacks = {}) {
    if (!pusherInstance) {
        log('Pusher', 'Cannot subscribe to project - Pusher not initialized');
        return null;
    }

    if (!projectId) {
        log('Pusher', 'Cannot subscribe to project - no project ID provided');
        return null;
    }

    // Unsubscribe from previous project if different
    if (currentSubscribedProjectId && currentSubscribedProjectId !== projectId) {
        unsubscribeFromProject();
    }

    // Already subscribed to this project
    if (currentSubscribedProjectId === projectId && projectChannel) {
        log('Pusher', `Already subscribed to project: ${projectId}`);
        return projectChannel;
    }

    try {
        const channelName = `private-project-${projectId}`;
        projectChannel = pusherInstance.subscribe(channelName);
        currentSubscribedProjectId = projectId;

        log('Pusher', `Subscribed to project channel: ${channelName}`);

        // Bind to project-related events
        bindProjectEvents(projectChannel, callbacks);

        return projectChannel;
    } catch (error) {
        console.error('Failed to subscribe to project channel:', error);
        return null;
    }
}

/**
 * Unsubscribe from the current project channel
 */
export function unsubscribeFromProject() {
    if (projectChannel && currentSubscribedProjectId) {
        const channelName = `private-project-${currentSubscribedProjectId}`;

        // Unbind all events
        eventListeners.forEach((handler, eventName) => {
            projectChannel.unbind(eventName, handler);
        });
        eventListeners.clear();

        // Unsubscribe from channel
        if (pusherInstance) {
            pusherInstance.unsubscribe(channelName);
        }

        log('Pusher', `Unsubscribed from project channel: ${channelName}`);

        projectChannel = null;
        currentSubscribedProjectId = null;
    }
}

/**
 * Bind event handlers to project channel
 * @param {Object} channel - Pusher channel
 * @param {Object} callbacks - Event handler callbacks
 */
function bindProjectEvents(channel, callbacks) {
    // Task events
    const taskEvents = [
        { event: 'task-created', handler: callbacks.onTaskCreated },
        { event: 'task-updated', handler: callbacks.onTaskUpdated },
        { event: 'task-deleted', handler: callbacks.onTaskDeleted },
        { event: 'task-reordered', handler: callbacks.onTaskReordered }
    ];

    // Project events
    const projectEvents = [
        { event: 'project-status-changed', handler: callbacks.onProjectStatusChanged },
        { event: 'project-updated', handler: callbacks.onProjectUpdated },
        { event: 'item-added', handler: callbacks.onItemAdded },
        { event: 'item-removed', handler: callbacks.onItemRemoved },
        { event: 'collaborator-joined', handler: callbacks.onCollaboratorJoined }
    ];

    const allEvents = [...taskEvents, ...projectEvents];

    allEvents.forEach(({ event, handler }) => {
        if (handler && typeof handler === 'function') {
            channel.bind(event, handler);
            eventListeners.set(event, handler);
            log('Pusher', `Bound handler for event: ${event}`);
        }
    });

    // Always bind a default handler for logging
    channel.bind_global((eventName, data) => {
        log('Pusher', `Received event: ${eventName}`, data);
    });
}

/**
 * Trigger a client event on the project channel
 * Note: Requires private channel and client events enabled
 * @param {string} eventName - Event name (must start with 'client-')
 * @param {Object} data - Event data
 * @returns {boolean} - Whether the event was triggered successfully
 */
export function triggerProjectEvent(eventName, data) {
    if (!projectChannel) {
        log('Pusher', 'Cannot trigger event - not subscribed to project');
        return false;
    }

    // Client events must start with 'client-'
    const fullEventName = eventName.startsWith('client-') ? eventName : `client-${eventName}`;

    try {
        projectChannel.trigger(fullEventName, {
            ...data,
            userId: state.session.user?.id,
            userName: state.session.user?.name,
            timestamp: new Date().toISOString()
        });
        log('Pusher', `Triggered event: ${fullEventName}`);
        return true;
    } catch (error) {
        console.error('Failed to trigger project event:', error);
        return false;
    }
}

/**
 * Get the currently subscribed project ID
 * @returns {string|null} - Current project ID or null
 */
export function getCurrentSubscribedProjectId() {
    return currentSubscribedProjectId;
}

/**
 * Check if currently subscribed to a project
 * @param {string} projectId - Optional project ID to check against
 * @returns {boolean} - Whether subscribed to the project
 */
export function isSubscribedToProject(projectId = null) {
    if (!projectChannel || !currentSubscribedProjectId) {
        return false;
    }
    if (projectId) {
        return currentSubscribedProjectId === projectId;
    }
    return true;
}
