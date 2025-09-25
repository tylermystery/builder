// In components/eventHub.js

import { state } from './state.js'; // We'll need state for chat user info
import * as ui from './ui.js'; // For rendering components
import * as api from './api.js'; // For image fetching
import { initializeSessionChat } from './chat.js'; // Re-using chat logic

async function initializeEventHub() {
    const urlParams = new URLSearchParams(window.location.search);
    const slug = urlParams.get('slug');

    if (!slug) {
        document.body.innerHTML = '<h1>Error: No event specified.</h1>';
        return;
    }

    try {
        const response = await fetch(`/api/get-event-by-slug?slug=${slug}`);
        if (!response.ok) {
            throw new Error('Could not load event data.');
        }
        const { event, session } = await response.json();

        // Set the event name
        document.getElementById('event-name').textContent = event.fields.Name;
        
        // --- RENDER EVENT CONTENT (Future Step) ---
        // This is where we will integrate the presentation.js logic
        // For now, we'll just list the items.
        const sessionData = JSON.parse(session.fields['Items with Variations'] || '{}');
        const lockedItems = new Map(Object.entries(sessionData.lockedInItems || {}));
        const itemNames = Array.from(lockedItems.keys()).join(', ');
        document.getElementById('event-content').innerHTML = `
            <h2>Event Plan</h2>
            <p>Items: ${itemNames || 'None'}</p> 
        `;


        // --- INITIALIZE EVENT CHAT ---
        // We can re-use the session chat logic, but point it to a new channel
        // For now, we'll use a placeholder. The full chat integration
        // would require tying it to an Event ID.
        document.getElementById('event-chat').innerHTML = `<h2>Event Chat</h2><p>Chat will be here.</p>`;

    } catch (error) {
        document.body.innerHTML = `<h1>Error: ${error.message}</h1>`;
    }
}

initializeEventHub();
