// store-dashboard.js

const AIRTABLE_PAT = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';
const PROFILE_ENDPOINT = '/api/profile-item';
const GET_ITEMS_ENDPOINT = '/api/get-items-for-profiling';

let currentStoreOwnerId = null;
let currentStoreSessions = [];

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
        throw error;
    }
}

async function fetchStoreSessions(storeRecordId) {
    // Sessions link to a store through the multi-record "Stores" field. Airtable
    // formulas can't reliably match a linked field by record id (the formula sees
    // the linked record's primary-field text, not its id), which is why the old
    // `({Store} = 'rec…')` filter always came back empty. Instead we pull the most
    // recent sessions and filter client-side on the Stores link array. This is a
    // best-effort convenience list for the autocomplete only — the store owner can
    // always type/paste any session id by hand.
    const url = `https://api.airtable.com/v0/${BASE_ID}/Sessions?pageSize=100&maxRecords=100`;
    try {
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.records || []).filter(r =>
            Array.isArray(r.fields.Stores) && r.fields.Stores.includes(storeRecordId)
        );
    } catch (e) {
        console.error('Failed to fetch sessions:', e);
        return [];
    }
}

function setupDirectPayment(storeRecord) {
    const section = document.getElementById('direct-payment-section');
    const sessionInput = document.getElementById('dp-session-id');
    const sessionList = document.getElementById('dp-session-list');
    const submitBtn = document.getElementById('dp-submit-btn');
    const statusEl = document.getElementById('dp-status');
    const confirmOverlay = document.getElementById('dp-confirm-overlay');
    const confirmText = document.getElementById('dp-confirm-text');
    const confirmOk = document.getElementById('dp-confirm-ok');
    const confirmCancel = document.getElementById('dp-confirm-cancel');

    if (!section || !sessionInput || !submitBtn) return;

    section.style.display = 'block';

    // Populate the autocomplete with this store's recent sessions, if any can be
    // resolved. Failure here is non-fatal: manual entry still works without it.
    fetchStoreSessions(storeRecord.id).then(sessions => {
        currentStoreSessions = sessions;
        if (!sessionList) return;
        sessionList.innerHTML = '';
        sessions.forEach(s => {
            const name = s.fields.Name || 'Untitled';
            const received = s.fields['Amount Received'] || 0;
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.label = `${name} ($${received.toFixed(2)} received)`;
            sessionList.appendChild(opt);
        });
    });

    submitBtn.addEventListener('click', () => {
        const sessionId = sessionInput.value.trim();
        const amount = parseFloat(document.getElementById('dp-amount').value);
        const method = document.getElementById('dp-method').value;
        const sendReceipt = document.getElementById('dp-send-receipt').checked;
        const customerEmail = document.getElementById('dp-customer-email').value.trim();

        if (!sessionId) { setStatus('Please enter a session ID.', 'error'); return; }
        if (!amount || amount <= 0) { setStatus('Please enter a valid amount.', 'error'); return; }
        // A receipt needs somewhere to go. Require the customer's email when the
        // "email a receipt" box is ticked (the session may have no linked account).
        if (sendReceipt && !customerEmail) {
            setStatus("Enter the customer's email to send a receipt, or untick the receipt box.", 'error');
            document.getElementById('dp-customer-email').focus();
            return;
        }

        const methodLabels = { 'direct-cash': 'Cash', 'direct-check': 'Check', 'direct-etransfer': 'E-Transfer', 'direct-other': 'Other' };
        const session = currentStoreSessions.find(s => s.id === sessionId);
        const sessionName = session?.fields?.Name || 'this session';
        // Only show a projected running total when we actually know the current
        // amount received for the session (i.e. it came from the suggestion list).
        const runningTotalLine = session
            ? `<br><small style="color: #888;">New running total: $${((session.fields['Amount Received'] || 0) + amount).toFixed(2)}</small>`
            : '';

        confirmText.innerHTML = `Record a <strong>${methodLabels[method]}</strong> payment of <strong>$${amount.toFixed(2)}</strong> for <strong>${sessionName}</strong>?${runningTotalLine}`;
        confirmOverlay.classList.add('active');

        confirmOk.onclick = async () => {
            confirmOverlay.classList.remove('active');
            await submitDirectPayment(sessionId, amount, method);
        };
    });

    confirmCancel.addEventListener('click', () => {
        confirmOverlay.classList.remove('active');
    });

    confirmOverlay.addEventListener('click', (e) => {
        if (e.target === confirmOverlay) confirmOverlay.classList.remove('active');
    });

    function setStatus(msg, type) {
        statusEl.textContent = msg;
        statusEl.className = 'status-msg' + (type ? ' ' + type : '');
    }

    async function submitDirectPayment(sessionId, amount, method) {
        submitBtn.disabled = true;
        setStatus('Recording payment...', '');

        try {
            const note = document.getElementById('dp-note').value.trim();
            const sendReceipt = document.getElementById('dp-send-receipt').checked;
            const customerName = document.getElementById('dp-customer-name').value.trim();
            const customerEmail = document.getElementById('dp-customer-email').value.trim();

            const res = await fetch('/api/record-direct-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    amount,
                    method,
                    note: note || undefined,
                    storeOwnerId: currentStoreOwnerId,
                    sendReceipt,
                    customerName: customerName || undefined,
                    customerEmail: customerEmail || undefined,
                }),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to record payment.');
            }

            const result = await res.json();
            setStatus(`Payment recorded. New total: $${result.newTotal.toFixed(2)}`, 'success');

            document.getElementById('dp-amount').value = '';
            document.getElementById('dp-note').value = '';

            // Keep the cached session + its autocomplete label in sync so a second
            // payment for the same session shows the correct running total.
            const session = currentStoreSessions.find(s => s.id === sessionId);
            if (session) {
                session.fields['Amount Received'] = result.newTotal;
                const opt = sessionList && sessionList.querySelector(`option[value="${sessionId}"]`);
                if (opt) {
                    const name = session.fields.Name || 'Untitled';
                    opt.label = `${name} ($${result.newTotal.toFixed(2)} received)`;
                }
            }
        } catch (err) {
            setStatus(`Error: ${err.message}`, 'error');
        } finally {
            submitBtn.disabled = false;
        }
    }
}

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
            const allItems = await fetchItemsForProfiling();

            const itemsToProfile = allItems.filter(item => {
                if (!item.fields.AI_Profile) return true;
                try {
                    const profile = JSON.parse(item.fields.AI_Profile);
                    return !profile.profileSource;
                } catch (e) { return true; }
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

async function initializeDashboard() {
    const urlParams = new URLSearchParams(window.location.search);
    const ownerId = urlParams.get('id');
    currentStoreOwnerId = ownerId;

    if (!ownerId) {
        document.body.innerHTML = '<h1>Error: No dashboard ID provided.</h1>';
        return;
    }

    try {
        // Encode the owner id: dashboard IDs can contain URL-unsafe characters
        // (e.g. '$', '^', '%'). Without encoding, a raw '%' produces an invalid
        // percent sequence that the function runtime fails to parse, yielding a
        // "Missing dashboard ID" 400.
        const response = await fetch(`/api/get-store-data-by-owner-id?id=${encodeURIComponent(ownerId)}`);
        if (!response.ok) {
            const errorData = await response.text();
            console.error("Failed to load store data:", errorData);
            throw new Error('Could not load store data. Check function logs.');
        }
        const { store, items } = await response.json();

        document.getElementById('store-name-header').textContent = `${store.fields.Name} Dashboard`;

        // Point the promotions tool at this store, with its record id pre-filled
        // so the publisher never has to copy/paste it by hand.
        const promoLink = document.getElementById('promotions-admin-link');
        if (promoLink) {
            promoLink.href = `promotions-admin.html?storeId=${encodeURIComponent(store.id)}`;
        }

        let itemsHtml = items.map(item => `<div>${item.fields.Name}</div>`).join('');
        document.getElementById('item-list-container').innerHTML = `<ul>${itemsHtml}</ul>`;

        setupAdminTools();
        setupDirectPayment(store);

    } catch (error) {
        document.body.innerHTML = `<h1>Error: ${error.message}</h1>`;
    }
}

initializeDashboard();
