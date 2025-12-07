// In: store-dashboard.js
// Store Dashboard with AI Strategic Project Manager and Store Settings

import { initAiManager } from './components/aiManager.js';

// --- API Configuration ---
const AIRTABLE_PAT = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';
// Use the *relative* path to the Netlify function
const PROFILE_ENDPOINT = '/api/profile-item';
// Use the relative path to our proxy function
const GET_ITEMS_ENDPOINT = '/api/get-items-for-profiling';
const UPDATE_SETTINGS_ENDPOINT = '/api/update-store-settings';

// Store the current owner dashboard ID for use in settings updates
let currentOwnerDashboardId = null;


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
            statusMessage.textContent = `Error: ${err.message}`;
            bulkProfileBtn.disabled = false;
        }
    });
}

/**
 * Populates the settings form with current store data
 */
function populateSettingsForm(storeFields) {
    // Text inputs
    const textFields = ['Name', 'Shop Title', 'Description', 'LogoTag', 'Marquee Text', 'TermsAndConditions', 'CartLabels'];
    textFields.forEach(fieldName => {
        const inputId = getInputIdForField(fieldName);
        const input = document.getElementById(inputId);
        if (input) {
            input.value = storeFields[fieldName] || '';
        }
    });

    // Select inputs
    const selectFields = {
        'ShopType': 'settings-shop-type',
        'PaymentOptions': 'settings-payment-options',
        'DefaultStatusFilter': 'settings-default-status'
    };
    Object.entries(selectFields).forEach(([fieldName, inputId]) => {
        const select = document.getElementById(inputId);
        if (select && storeFields[fieldName]) {
            select.value = storeFields[fieldName];
        }
    });

    // Checkbox group for EnabledFilters
    const enabledFilters = storeFields.EnabledFilters || ['Date & Time', 'Headcount', 'Location', 'Subcategories'];
    const checkboxes = document.querySelectorAll('#settings-enabled-filters input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = enabledFilters.includes(checkbox.value);
    });
}

/**
 * Maps field names to input element IDs
 */
function getInputIdForField(fieldName) {
    const fieldMap = {
        'Name': 'settings-name',
        'Shop Title': 'settings-shop-title',
        'Description': 'settings-description',
        'LogoTag': 'settings-logo-tag',
        'Marquee Text': 'settings-marquee-text',
        'TermsAndConditions': 'settings-terms',
        'CartLabels': 'settings-cart-labels'
    };
    return fieldMap[fieldName] || fieldName;
}

/**
 * Collects form data and returns settings object
 */
function collectSettingsFromForm() {
    const settings = {};

    // Text inputs
    const textFields = [
        { id: 'settings-name', field: 'Name' },
        { id: 'settings-shop-title', field: 'Shop Title' },
        { id: 'settings-description', field: 'Description' },
        { id: 'settings-logo-tag', field: 'LogoTag' },
        { id: 'settings-marquee-text', field: 'Marquee Text' },
        { id: 'settings-terms', field: 'TermsAndConditions' },
        { id: 'settings-cart-labels', field: 'CartLabels' }
    ];

    textFields.forEach(({ id, field }) => {
        const input = document.getElementById(id);
        if (input) {
            settings[field] = input.value;
        }
    });

    // Select inputs
    const selectFields = [
        { id: 'settings-shop-type', field: 'ShopType' },
        { id: 'settings-payment-options', field: 'PaymentOptions' },
        { id: 'settings-default-status', field: 'DefaultStatusFilter' }
    ];

    selectFields.forEach(({ id, field }) => {
        const select = document.getElementById(id);
        if (select) {
            settings[field] = select.value;
        }
    });

    // Checkbox group for EnabledFilters
    const checkboxes = document.querySelectorAll('#settings-enabled-filters input[type="checkbox"]:checked');
    settings.EnabledFilters = Array.from(checkboxes).map(cb => cb.value);

    return settings;
}

/**
 * Sets up the settings form submission handler
 */
function setupSettingsForm() {
    const form = document.getElementById('store-settings-form');
    const statusMessage = document.getElementById('settings-status-message');
    const saveBtn = document.getElementById('save-settings-btn');

    if (!form || !statusMessage || !saveBtn) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!currentOwnerDashboardId) {
            statusMessage.style.color = '#dc3545';
            statusMessage.textContent = 'Error: No dashboard ID available.';
            return;
        }

        // Validate CartLabels JSON if provided
        const cartLabelsInput = document.getElementById('settings-cart-labels');
        if (cartLabelsInput && cartLabelsInput.value.trim()) {
            try {
                JSON.parse(cartLabelsInput.value);
            } catch (e) {
                statusMessage.style.color = '#dc3545';
                statusMessage.textContent = 'Error: Cart Labels must be valid JSON.';
                return;
            }
        }

        saveBtn.disabled = true;
        statusMessage.style.color = '#666';
        statusMessage.textContent = 'Saving...';

        try {
            const settings = collectSettingsFromForm();

            const response = await fetch(UPDATE_SETTINGS_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ownerDashboardId: currentOwnerDashboardId,
                    settings
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to save settings.');
            }

            statusMessage.style.color = '#28a745';
            statusMessage.textContent = 'Settings saved successfully!';

            // Update the header if the name changed
            if (result.store && result.store.fields && result.store.fields.Name) {
                document.getElementById('store-name-header').textContent = `${result.store.fields.Name} Dashboard`;
            }

            // Clear status after 3 seconds
            setTimeout(() => {
                statusMessage.textContent = '';
            }, 3000);

        } catch (err) {
            statusMessage.style.color = '#dc3545';
            statusMessage.textContent = `Error: ${err.message}`;
        } finally {
            saveBtn.disabled = false;
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

    // Store the owner ID for use in settings updates
    currentOwnerDashboardId = ownerId;

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

        // Populate settings form with current store data
        populateSettingsForm(store.fields);

        // Setup the settings form
        setupSettingsForm();

        // Setup the admin tools
        setupAdminTools();

        // Initialize the AI Strategic Project Manager
        initAiManager();

    } catch (error) {
        document.body.innerHTML = `<h1>Error: ${error.message}</h1>`;
    }
}

initializeDashboard();
