// FILE: netlify/functions/airtable-backup.js
// PURPOSE: Server-side Airtable data backup using Netlify Blobs.
// - GET: Returns the latest backed-up items + stores from Blobs storage.
// - POST / Scheduled: Fetches fresh data from Airtable and stores it in Blobs.
// This allows the site to load even when Airtable is completely down
// and the user has no localStorage cache (e.g., first visit during outage).

// Lazy-load @netlify/blobs to prevent module-level crash if not installed
let _getStore = null;
let _blobsLoadError = null;
try {
    _getStore = require('@netlify/blobs').getStore;
} catch (err) {
    _blobsLoadError = err.message;
    console.error('[airtable-backup] Failed to load @netlify/blobs:', err.message);
}

const { AIRTABLE_PAT, BASE_ID } = process.env;
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';
const STORES_TABLE = 'Stores';

// Fields fetched for catalog backup (must match client-side fetchAllRecords)
const ITEM_FIELDS = [
    'Name', 'Price', 'Description', 'Options', 'Parent Item', 'Status',
    'Pricing Type', 'Headcount min', 'Media Tags', 'Curated Images',
    'Categories', 'Subcategories', 'iCal URL', 'Lead Time (days)',
    'Item Type', 'Stores', 'RSVPs', 'RSVPMaybe', 'RSVPNo', 'Date', 'Time',
    'Chat Enabled', 'Duration', 'Capacity', 'Location Details',
    'Additional Information', 'Rankings', 'AI_Profile'
];

/**
 * Safely initialize the Netlify Blobs store.
 * Returns null if Blobs context is not available (e.g., missing env vars).
 */
function getBackupStore() {
    if (!_getStore) {
        console.error('[airtable-backup] @netlify/blobs not available:', _blobsLoadError || 'unknown reason');
        return null;
    }
    try {
        const store = _getStore({ name: 'airtable-backup', consistency: 'strong' });
        return store;
    } catch (err) {
        console.error('[airtable-backup] Failed to initialize Blobs store:', err.message);
        return null;
    }
}

/**
 * Fetch with retry for transient Airtable 500 errors.
 * Uses native fetch (Node.js 22+).
 */
async function fetchWithRetry(url, options, maxRetries = 2) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const response = await fetch(url, options);
        if (response.status === 500 && attempt < maxRetries) {
            const backoffMs = 1000 * Math.pow(2, attempt) + Math.random() * 500;
            console.warn(`[airtable-backup] 500 error on attempt ${attempt + 1}/${maxRetries + 1}. Retrying in ${Math.round(backoffMs)}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
        }
        return response;
    }
}

/**
 * Fetch all records from an Airtable table with pagination and retry.
 */
async function fetchAllFromAirtable(tableName, fields) {
    let allRecords = [];
    let offset = null;

    const fieldsQuery = fields
        ? fields.map(f => `fields%5B%5D=${encodeURIComponent(f)}`).join('&')
        : '';
    const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${tableName}?${fieldsQuery}`;

    do {
        const url = offset ? `${baseUrl}&offset=${offset}` : baseUrl;
        const response = await fetchWithRetry(url, {
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Airtable ${tableName} fetch failed: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        allRecords = allRecords.concat(data.records);
        offset = data.offset;
    } while (offset);

    return allRecords;
}

/**
 * Perform the backup: fetch from Airtable and store in Netlify Blobs.
 */
async function performBackup(store) {
    console.log('[airtable-backup] Starting Airtable data backup...');
    const startTime = Date.now();

    const [items, stores] = await Promise.all([
        fetchAllFromAirtable(ITEMS_TABLE, ITEM_FIELDS),
        fetchAllFromAirtable(STORES_TABLE, null)
    ]);

    const filteredItems = items.filter(r => r.fields && r.fields.Name);
    const filteredStores = stores.filter(r => r.fields && r.fields.Name);

    await Promise.all([
        store.setJSON('catalog-items', filteredItems),
        store.setJSON('catalog-stores', filteredStores),
        store.setJSON('backup-meta', {
            timestamp: Date.now(),
            itemCount: filteredItems.length,
            storeCount: filteredStores.length
        })
    ]);

    const elapsed = Date.now() - startTime;
    console.log(`[airtable-backup] Backup complete: ${filteredItems.length} items, ${filteredStores.length} stores in ${elapsed}ms`);

    return { filteredItems, filteredStores, elapsed };
}

exports.handler = async (event) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    // Top-level try/catch to prevent any uncaught exception from returning a raw 500
    try {
        if (event.httpMethod === 'OPTIONS') {
            return { statusCode: 204, headers: corsHeaders, body: '' };
        }

        console.log(`[airtable-backup] ${event.httpMethod || 'SCHEDULED'} request received`);

        // Safely initialize the Blobs store — this can fail if context is missing
        const store = getBackupStore();
        if (!store) {
            const errorMsg = 'Netlify Blobs store could not be initialized (missing context or environment)';
            console.error('[airtable-backup]', errorMsg);
            // For GET requests, return a structured response (not 500) so the client knows backup is unavailable
            if (event.httpMethod === 'GET') {
                return {
                    statusCode: 503,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: errorMsg, blobsAvailable: false })
                };
            }
            return {
                statusCode: 503,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: errorMsg, blobsAvailable: false })
            };
        }

        // --- Scheduled invocation (cron) — no httpMethod present ---
        if (!event.httpMethod) {
            try {
                const result = await performBackup(store);
                console.log(`[airtable-backup] Scheduled backup succeeded: ${result.filteredItems.length} items, ${result.filteredStores.length} stores`);
                return { statusCode: 200, body: 'Scheduled backup complete' };
            } catch (error) {
                console.error('[airtable-backup] Scheduled backup failed:', error.message, error.stack);
                return { statusCode: 500, body: error.message };
            }
        }

        // --- GET: Serve backed-up data from Blobs ---
        if (event.httpMethod === 'GET') {
            try {
                console.log('[airtable-backup] GET: Retrieving backup data from Blobs...');

                // Fetch items, stores, and meta separately with individual error handling
                let items = null, stores = null, meta = null;
                try {
                    items = await store.get('catalog-items', { type: 'json' });
                    console.log(`[airtable-backup] GET: catalog-items retrieved: ${items ? 'yes (' + (Array.isArray(items) ? items.length + ' records' : typeof items) + ')' : 'null/empty'}`);
                } catch (itemErr) {
                    console.error('[airtable-backup] GET: Error reading catalog-items:', itemErr.message);
                }

                try {
                    stores = await store.get('catalog-stores', { type: 'json' });
                    console.log(`[airtable-backup] GET: catalog-stores retrieved: ${stores ? 'yes (' + (Array.isArray(stores) ? stores.length + ' records' : typeof stores) + ')' : 'null/empty'}`);
                } catch (storeErr) {
                    console.error('[airtable-backup] GET: Error reading catalog-stores:', storeErr.message);
                }

                try {
                    meta = await store.get('backup-meta', { type: 'json' });
                    console.log('[airtable-backup] GET: backup-meta retrieved:', meta ? JSON.stringify(meta) : 'null/empty');
                } catch (metaErr) {
                    console.error('[airtable-backup] GET: Error reading backup-meta:', metaErr.message);
                }

                if (!items || !stores) {
                    console.log('[airtable-backup] GET: No backup data found in Blobs (items:', !!items, 'stores:', !!stores, ')');
                    return {
                        statusCode: 404,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            error: 'No backup data available yet. Backup must be seeded first.',
                            hasItems: !!items,
                            hasStores: !!stores,
                            hasMeta: !!meta,
                            blobsAvailable: true
                        })
                    };
                }

                console.log(`[airtable-backup] GET: Returning ${items.length} items, ${stores.length} stores from backup`);
                return {
                    statusCode: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        items,
                        stores,
                        backupTimestamp: meta?.timestamp || null,
                        backupAge: meta?.timestamp ? Date.now() - meta.timestamp : null
                    })
                };
            } catch (error) {
                console.error('[airtable-backup] GET error:', error.message, error.stack);
                return {
                    statusCode: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Failed to retrieve backup data', detail: error.message })
                };
            }
        }

        // --- POST: Trigger a manual backup ---
        if (event.httpMethod === 'POST') {
            try {
                const result = await performBackup(store);
                return {
                    statusCode: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        success: true,
                        itemCount: result.filteredItems.length,
                        storeCount: result.filteredStores.length,
                        elapsed: result.elapsed
                    })
                };
            } catch (error) {
                console.error('[airtable-backup] POST error:', error.message, error.stack);
                return {
                    statusCode: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: error.message })
                };
            }
        }

        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };

    } catch (topLevelError) {
        // Catch-all for any unexpected error (e.g., require() failures, syntax errors in deps)
        console.error('[airtable-backup] UNCAUGHT TOP-LEVEL ERROR:', topLevelError.message, topLevelError.stack);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Internal function error',
                detail: topLevelError.message,
                blobsAvailable: false
            })
        };
    }
};
