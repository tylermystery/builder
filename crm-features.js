const drawer = document.getElementById('crm-tools-backdrop');
const openButton = document.getElementById('crm-tools-open');
const closeButton = document.getElementById('crm-tools-close');
const summary = document.getElementById('crm-summary');
const mailboxesContainer = document.getElementById('crm-mailboxes');
const reviewContainer = document.getElementById('crm-review-list');
const contactsContainer = document.getElementById('crm-contact-list');
const campaignsContainer = document.getElementById('crm-campaign-list');
const campaignStatus = document.getElementById('crm-campaign-status');

let bootstrap = null;
let mailboxes = [];

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function authHeaders(extra = {}) {
    const token = localStorage.getItem('jwt');
    return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function api(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        credentials: 'same-origin',
        headers: authHeaders(options.headers || {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
}

function setCampaignStatus(message, error = false) {
    campaignStatus.hidden = false;
    campaignStatus.textContent = message;
    campaignStatus.classList.toggle('error', error);
}

function openDrawer() {
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    loadAll();
}

function closeDrawer() {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
}

async function loadBootstrap() {
    bootstrap = await api('/api/crm/bootstrap');
    summary.innerHTML = `
        <div class="crm-summary-card"><strong>${escapeHtml(bootstrap.store.name)}</strong><span>${escapeHtml(bootstrap.actor.role)} access</span></div>
        <div class="crm-summary-card"><strong>${bootstrap.counts.contacts}</strong><span>Contacts</span></div>
        <div class="crm-summary-card"><strong>${bootstrap.counts.pendingReview}</strong><span>To review</span></div>
        <div class="crm-summary-card"><strong>${bootstrap.counts.mailboxes}</strong><span>Mailboxes</span></div>`;
    document.getElementById('crm-google-connect').disabled = !bootstrap.googleConfigured;
    if (!bootstrap.googleConfigured) {
        document.getElementById('crm-google-connect').title = 'Google CRM environment configuration is required.';
    }
    if (!bootstrap.marketingConfigured) {
        setCampaignStatus('Marketing remains locked until SendGrid events, the business address, and sender configuration are complete.', true);
    }
}

async function loadMailboxes() {
    const payload = await api('/api/crm/mailboxes');
    mailboxes = payload.mailboxes || [];
    mailboxesContainer.innerHTML = mailboxes.length ? mailboxes.map((mailbox) => `
        <article class="crm-row">
            <div><p class="crm-row-title">${escapeHtml(mailbox.mailboxEmail)}</p><p class="crm-row-meta">${mailbox.sync?.backfillComplete ? 'Continuous sync active' : 'Historical import in progress'} · Last sync ${mailbox.sync?.lastSuccessfulSyncAt ? new Date(mailbox.sync.lastSuccessfulSyncAt).toLocaleString() : 'not yet completed'}</p>${mailbox.lastError ? `<p class="crm-row-meta" style="color:#9a493c">${escapeHtml(mailbox.lastError)}</p>` : ''}</div>
            <button class="crm-action danger" data-revoke-mailbox="${mailbox.id}" type="button">Disconnect</button>
        </article>`).join('') : '<p class="crm-muted">No mailbox is connected. Connect the Tyler’s Mystery Tours Google mailbox to begin a dry-run import.</p>';
}

async function loadReview() {
    const payload = await api('/api/crm/review');
    reviewContainer.innerHTML = payload.review.length ? payload.review.map(({ source, contact, thread }) => `
        <article class="crm-row">
            <div><p class="crm-row-title">${escapeHtml(contact.displayName || contact.normalizedEmail)}</p><p class="crm-row-meta">${escapeHtml(contact.normalizedEmail)} · ${escapeHtml(thread?.subject || 'Email conversation')}</p><span class="crm-pill">Two-way email</span><span class="crm-pill">${source.confidence || 0}% confidence</span></div>
            <div class="crm-actions"><button class="crm-action" data-review="approve" data-contact-id="${contact.id}" type="button">Approve</button><button class="crm-action danger" data-review="reject" data-contact-id="${contact.id}" type="button">Reject</button></div>
        </article>`).join('') : '<p class="crm-muted">No contact candidates are waiting for review.</p>';
}

async function loadContacts() {
    const payload = await api('/api/crm/contacts?status=substantiated_relationship');
    contactsContainer.innerHTML = payload.contacts.length ? payload.contacts.map((contact) => `
        <article class="crm-row"><div><p class="crm-row-title">${escapeHtml(contact.displayName || contact.normalizedEmail)}</p><p class="crm-row-meta">${escapeHtml(contact.normalizedEmail)}${contact.company ? ` · ${escapeHtml(contact.company)}` : ''}</p><span class="crm-pill">${escapeHtml(contact.marketingPermission)}</span></div><time class="crm-row-meta">${contact.lastInteractionAt ? new Date(contact.lastInteractionAt).toLocaleDateString() : ''}</time></article>`).join('') : '<p class="crm-muted">Approved contacts appear here after review.</p>';
}

async function loadCampaigns() {
    const payload = await api('/api/crm/campaigns');
    campaignsContainer.innerHTML = payload.campaigns.length ? payload.campaigns.map((campaign) => `
        <article class="crm-row"><div><p class="crm-row-title">${escapeHtml(campaign.name)}</p><p class="crm-row-meta">${escapeHtml(campaign.subject)} · ${escapeHtml(campaign.status)}</p></div><div class="crm-actions"><button class="crm-action secondary" data-campaign-test="${campaign.id}" type="button">Test</button>${campaign.status === 'draft' ? `<button class="crm-action secondary" data-campaign-approve="${campaign.id}" type="button">Approve audience</button>` : ''}${campaign.status === 'approved' || campaign.status === 'sending' ? `<button class="crm-action" data-campaign-send="${campaign.id}" type="button">Start send</button><button class="crm-action danger" data-campaign-cancel="${campaign.id}" type="button">Cancel</button>` : ''}</div></article>`).join('') : '<p class="crm-muted">No campaign drafts yet.</p>';
}

async function loadAll() {
    try {
        await loadBootstrap();
        await Promise.all([loadMailboxes(), loadReview(), loadContacts(), loadCampaigns()]);
    } catch (error) {
        summary.innerHTML = `<div class="crm-status error">${escapeHtml(error.message)}</div>`;
    }
}

openButton.addEventListener('click', openDrawer);
closeButton.addEventListener('click', closeDrawer);
drawer.addEventListener('click', (event) => { if (event.target === drawer) closeDrawer(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDrawer(); });

document.getElementById('crm-google-connect').addEventListener('click', async () => {
    try {
        const payload = await api('/api/crm/google/start');
        window.location.href = payload.authorizationUrl;
    } catch (error) { setCampaignStatus(error.message, true); }
});

document.getElementById('crm-sync-now').addEventListener('click', async () => {
    if (!mailboxes.length) return setCampaignStatus('Connect a Google mailbox first.', true);
    setCampaignStatus('Sync accepted. The background importer is processing bounded pages.');
    await Promise.all(mailboxes.filter((mailbox) => mailbox.status === 'active').map((mailbox) => api('/api/crm/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectionId: mailbox.id, maxPages: 8 })
    })));
    window.setTimeout(loadAll, 2500);
});

mailboxesContainer.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-revoke-mailbox]');
    if (!button || !confirm('Disconnect this mailbox and stop future synchronization?')) return;
    await api(`/api/crm/mailboxes/${button.dataset.revokeMailbox}`, { method: 'DELETE' });
    await loadAll();
});

reviewContainer.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-review]');
    if (!button) return;
    button.disabled = true;
    try {
        await api('/api/crm/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactId: Number(button.dataset.contactId), action: button.dataset.review }) });
        await Promise.all([loadBootstrap(), loadReview(), loadContacts()]);
    } finally { button.disabled = false; }
});

document.getElementById('crm-refresh-review').addEventListener('click', loadReview);
document.getElementById('crm-refresh-contacts').addEventListener('click', loadContacts);

document.getElementById('crm-campaign-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
        await api('/api/crm/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
        form.reset();
        setCampaignStatus('Draft saved. Review and approve its audience before sending.');
        await loadCampaigns();
    } catch (error) { setCampaignStatus(error.message, true); }
});

campaignsContainer.addEventListener('click', async (event) => {
    const approve = event.target.closest('[data-campaign-approve]');
    const send = event.target.closest('[data-campaign-send]');
    const test = event.target.closest('[data-campaign-test]');
    const cancel = event.target.closest('[data-campaign-cancel]');
    try {
        if (test) {
            await api(`/api/crm/campaigns/${test.dataset.campaignTest}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test' }) });
            setCampaignStatus('A test message was sent only to the signed-in owner.');
        }
        if (approve) {
            if (!confirm('Snapshot all currently eligible, non-suppressed contacts for this campaign?')) return;
            const payload = await api(`/api/crm/campaigns/${approve.dataset.campaignApprove}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) });
            setCampaignStatus(`${payload.recipients} eligible recipients were added to the immutable audience.`);
        }
        if (send) {
            if (!confirm('Start the bounded background send? Unsubscribe and suppression checks run again for every recipient.')) return;
            await api('/api/crm/campaign-send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: Number(send.dataset.campaignSend) }) });
            setCampaignStatus('Campaign send accepted. Delivery events update in the background.');
        }
        if (cancel) {
            if (!confirm('Cancel every recipient that has not been sent yet?')) return;
            await api(`/api/crm/campaigns/${cancel.dataset.campaignCancel}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) });
            setCampaignStatus('Pending campaign recipients were canceled.');
        }
        await loadCampaigns();
    } catch (error) { setCampaignStatus(error.message, true); }
});

window.addEventListener('crm:plan-selected', async (event) => {
    const container = document.getElementById('crm-email-interactions');
    if (!container) return;
    try {
        const payload = await api(`/api/crm/interactions?planId=${encodeURIComponent(event.detail.planId)}`);
        container.innerHTML = `<h3>Email Activity <span class="crm-pill">store private</span></h3>${payload.interactions.length ? payload.interactions.map((interaction) => `<article class="crm-interaction"><strong>${escapeHtml(interaction.interactionType.replace(/_/g, ' '))}</strong><div>${escapeHtml(interaction.summary)}</div><time>${new Date(interaction.occurredAt).toLocaleString()}</time></article>`).join('') : '<p class="crm-muted">No linked email activity yet.</p>'}`;
    } catch (error) {
        container.innerHTML = `<h3>Email Activity</h3><p class="crm-muted">${escapeHtml(error.message)}</p>`;
    }
});

if (new URLSearchParams(location.search).get('google')) openDrawer();
