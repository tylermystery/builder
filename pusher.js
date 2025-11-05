// REPLACE THE ENTIRE CONTENTS of pusher.js

// import Pusher from 'pusher-js'; // --- THIS LINE IS REMOVED (it caused the 404)
import { log } from './utils/debug.js';

export function initializePusher(key, cluster, sessionId) {
    // This check is important.
    if (!window.Pusher) {
        console.error("Pusher library is not loaded. Real-time features will be disabled.");
        return null;
    }

    try {
        // --- THIS IS THE FIX ---
        // Access Pusher from the global 'window' object, not an import
        const pusher = new window.Pusher(key, {
        // --- END FIX ---
            cluster: cluster,
            encrypted: true,
            authEndpoint: '/api/pusher-auth',
            auth: {
                params: { sessionId: sessionId }
            }
        });

        log('Pusher', 'Pusher client initialized.');
        return pusher;

    } catch (error) {
        console.error("Failed to initialize Pusher:", error);
        return null;
    }
}
