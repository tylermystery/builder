// In: store-dashboard.js
// Store Dashboard with AI Strategic Project Manager

import { initAiManager } from './components/aiManager.js';

// --- API Configuration ---
const AIRTABLE_PAT = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';
// Use the *relative* path to the Netlify function
const PROFILE_ENDPOINT = '/api/profile-item';
// Use the relative path to our proxy function
const GET_ITEMS_ENDPOINT = '/api/get-items-for-profiling';


/**
 * [FIX] Fetches all item records via our Netlify proxy.
 * This function must be defined here so setupAdminTools can find it.
 */
async function fetchItemsForProfiling() {
    console.log(`Fetching all items for profiling via ${GET_ITEMS_ENDPOINT}...`);
    
    try {
        const response = await fetch(GET_ITEMS_ENDPOINT);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error fetching items from proxy:`, errorText);
            throw new Error(`Failed to fetch items. Status: ${response.status}`);
        }
        
        const allRecords = await response.json();
        console.log(`Total item records fetched via proxy: ${allRecords.length}`);
        return allRecords;

    } catch (error) {
        console.error("Error in fetchItemsForProfiling:", error);
        throw error; // This will be caught by the button's click handler
    }
}

/**
 * Wires up the new admin button
 */
function setupAdminTools() {
    const bulkProfileBtn = document.getElementById('admin-bulk-profile-btn');
    const statusMessage = document.getElementById('admin-status-message');

    if (!bulkProfileBtn || !statusMessage) return;

    bulkProfileBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to run the bulk profiler? This will call the AI API for all un-profiled items.')) {
            return;
        }

        bulkProfileBtn.disabled = true;
        statusMessage.style.color = '#333';
        statusMessage.textContent = 'Fetching item list...';

        try {
            // This call was failing because fetchItemsForProfiling was missing
            const allItems = await fetchItemsForProfiling();
            
            const itemsToProfile = allItems.filter(item => {
                if (!item.fields.AI_Profile) return true; // Needs profiling if empty
                try {
                    const profile = JSON.parse(item.fields.AI_Profile);
                    return !profile.profileSource; // Needs profiling if it's old
                } catch (e) { return true; } // Needs profiling if JSON is invalid
            });

            if (itemsToProfile.length === 0) {
                statusMessage.style.color = '#28a745';
                statusMessage.textContent = 'Success! All items are already profiled.';
                bulkProfileBtn.disabled = false;
                return;
            }

            statusMessage.textContent = `Profiling ${itemsToProfile.length} items. Please keep this tab open...`;
            
            let successCount = 0;
            let failCount = 0;

            // Simple sequential loop to avoid rate limits
            for (const item of itemsToProfile) {
                try {
                    const response = await fetch(PROFILE_ENDPOINT, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ recordId: item.id })
                    });
                    
                    if (!response.ok) {
                        const errText = await response.text();
                        console.error(`Failed to profile ${item.fields.Name}:`, errText);
                        throw new Error(`API Error ${response.status}`);
                    }
                    
                    successCount++;
                    statusMessage.textContent = `Profiling... (${successCount}/${itemsToProfile.length})`;
                } catch (err) {
                    failCount++;
                    console.error(`Failed to profile ${item.fields.Name}:`, err.message);
                }
            }

            statusMessage.style.color = '#28a745';
            statusMessage.textContent = `Complete! Success: ${successCount}, Failed: ${failCount}.`;
            bulkProfileBtn.disabled = false;

        } catch (err) {
            statusMessage.style.color = '#dc3545';
            statusMessage.textContent = `Error: ${err.message}`;\n            bulkProfileBtn.disabled = false;
        }
    });
}

/**
 * Main initialization for the dashboard
 */
async function initializeDashboard() {
    const urlParams = new URLSearchParams(window.location.search);
    const ownerId = urlParams.get('id');

    if (!ownerId) {
        document.body.innerHTML = '<h1>Error: No dashboard ID provided.</h1>';
        return;
    }

    try {
        // Use relative path for the API call
        const response = await fetch(`/api/get-store-data-by-owner-id?id=${ownerId}`);
        if (!response.ok) {
            const errorData = await response.text();
            console.error("Failed to load store data:", errorData);
            throw new Error('Could not load store data. Check function logs.');
        }
        const { store, items } = await response.json();
        
        document.getElementById('store-name-header').textContent = `${store.fields.Name} Dashboard`;
        
        let itemsHtml = items.map(item => `<div>${item.fields.Name}</div>`).join('');
        document.getElementById('item-list-container').innerHTML = `<ul>${itemsHtml}</ul>`;

        // Setup the admin tools
        setupAdminTools();

        // Initialize the AI Strategic Project Manager
        initAiManager();

    } catch (error) {
        document.body.innerHTML = `<h1>Error: ${error.message}</h1>`;
    }
}

initializeDashboard();
