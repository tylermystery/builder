// promotions-admin.js
//
// Standalone publisher tool for creating and managing store promotions. It is
// deliberately self-contained (no dependency on the main app bundle) so it can
// never affect the customer-facing experience. All writes go through
// /api/promotions with the same Bearer JWT the rest of the app uses; the server
// enforces that the user holds publish permission for the store.

const $ = (id) => document.getElementById(id);
const token = () => localStorage.getItem('jwt');

function showMsg(text, kind) {
  const el = $('msg');
  el.textContent = text;
  el.className = kind === 'ok' ? 'ok' : 'err';
  if (kind === 'ok') setTimeout(() => { el.className = ''; el.textContent = ''; }, 4000);
}

function authHeaders() {
  const t = token();
  return t
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }
    : { 'Content-Type': 'application/json' };
}

function currentStoreId() {
  return ($('storeId').value || '').trim();
}

function fmtMoney(promo) {
  return promo.rewardType === 'amount'
    ? `$${(promo.rewardValue / 100).toFixed(2)} off`
    : `${promo.rewardValue}% off`;
}

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString(); } catch { return String(d); }
}

function describeDates(p) {
  if (p.eligibilityMode === 'rolling') {
    return `Last-minute · event within ${p.windowDays || '?'} days`;
  }
  const parts = [];
  if (p.startsAt) parts.push(`from ${fmtDate(p.startsAt)}`);
  parts.push(p.endsAt ? `until ${fmtDate(p.endsAt)}` : 'no end date');
  return parts.join(' ');
}

function describeScope(p) {
  if (p.scopeType === 'item') return `Item ${p.target || '(unset)'}`;
  if (p.scopeType === 'category') return `Category “${p.target || '(unset)'}”`;
  return 'Whole store';
}

async function loadPromotions() {
  const storeId = currentStoreId();
  if (!storeId) { showMsg('Enter a store record ID first.', 'err'); return; }
  if (!token()) { showMsg('You are not logged in. Open the main app and sign in first (this page reads your saved login).', 'err'); return; }
  localStorage.setItem('promoAdminStoreId', storeId);

  try {
    const res = await fetch(`/api/promotions/manage?storeId=${encodeURIComponent(storeId)}`, {
      headers: authHeaders(),
    });
    if (res.status === 401) { showMsg('Login expired — sign in again in the main app.', 'err'); return; }
    if (res.status === 403) { showMsg('You do not have publish permission for this store.', 'err'); return; }
    if (!res.ok) { showMsg('Could not load promotions.', 'err'); return; }
    const data = await res.json();
    $('formCard').style.display = 'block';
    $('listCard').style.display = 'block';
    renderList(data.promotions || []);
    showMsg(`Loaded ${(data.promotions || []).length} promotion(s).`, 'ok');
  } catch (e) {
    showMsg('Network error loading promotions.', 'err');
  }
}

function renderList(promos) {
  const list = $('list');
  if (!promos.length) {
    list.innerHTML = '<p style="color:#6b7280">No promotions yet. Create one above.</p>';
    return;
  }
  list.innerHTML = '';
  for (const p of promos) {
    const remaining = (p.maxRedemptions == null)
      ? 'unlimited'
      : `${p.remaining ?? 0} of ${p.maxRedemptions} left`;
    const el = document.createElement('div');
    el.className = 'promo';
    el.innerHTML = `
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <span class="pill ${p.active ? 'on' : 'off'}">${p.active ? 'Active' : 'Off'}</span>
        <span class="pill deal">${fmtMoney(p)}</span>
        <div class="meta">${describeScope(p)} · ${describeDates(p)} · ${remaining}</div>
        ${p.description ? `<div class="meta">${escapeHtml(p.description)}</div>` : ''}
      </div>
      <div class="promo-actions">
        <button class="btn tiny secondary" data-act="toggle" data-id="${p.id}" data-active="${p.active ? '1' : '0'}">${p.active ? 'Pause' : 'Activate'}</button>
        <button class="btn tiny" data-act="delete" data-id="${p.id}" style="background:#9aa0a6">Delete</button>
      </div>`;
    list.appendChild(el);
  }
  list.querySelectorAll('button[data-act]').forEach((b) => {
    b.addEventListener('click', () => handleAction(b.dataset.act, Number(b.dataset.id), b.dataset.active === '1'));
  });
}

async function handleAction(act, id, isActive) {
  try {
    if (act === 'toggle') {
      const res = await fetch('/api/promotions', {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ id, active: !isActive }),
      });
      if (!res.ok) return showMsg('Could not update promotion.', 'err');
    } else if (act === 'delete') {
      if (!confirm('Delete this promotion? Past redemptions are removed too.')) return;
      const res = await fetch('/api/promotions', {
        method: 'DELETE', headers: authHeaders(),
        body: JSON.stringify({ id }),
      });
      if (!res.ok) return showMsg('Could not delete promotion.', 'err');
    }
    await loadPromotions();
  } catch (e) {
    showMsg('Network error.', 'err');
  }
}

function localToISO(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function createPromotion() {
  const storeId = currentStoreId();
  if (!storeId) return showMsg('Enter a store record ID first.', 'err');

  const scopeType = $('scopeType').value;
  const eligibilityMode = $('eligibilityMode').value;
  const body = {
    storeId,
    name: $('name').value.trim(),
    description: $('description').value.trim(),
    rewardType: $('rewardType').value,
    rewardValue: Number($('rewardValue').value),
    scopeType,
    target: scopeType === 'store' ? null : ($('target').value.trim() || null),
    eligibilityMode,
    active: true,
  };
  if (body.rewardType === 'amount') body.rewardValue = Math.round(body.rewardValue * 100); // dollars -> cents

  if (eligibilityMode === 'fixed_end') {
    body.startsAt = localToISO($('startsAt').value);
    body.endsAt = localToISO($('endsAt').value);
  } else {
    body.windowDays = Number($('windowDays').value) || null;
  }
  const maxR = $('maxRedemptions').value.trim();
  body.maxRedemptions = maxR ? Number(maxR) : null;

  if (!body.name) return showMsg('Name is required.', 'err');
  if (!body.rewardValue || body.rewardValue <= 0) return showMsg('Enter a reward value.', 'err');
  if (scopeType !== 'store' && !body.target) return showMsg('This scope needs a target (item id or category).', 'err');
  if (eligibilityMode === 'rolling' && !body.windowDays) return showMsg('Rolling deals need a window in days.', 'err');

  try {
    const res = await fetch('/api/promotions', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
    });
    if (res.status === 403) return showMsg('You do not have publish permission for this store.', 'err');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return showMsg(err.error || 'Could not create promotion.', 'err');
    }
    showMsg('Promotion created.', 'ok');
    ['name', 'description', 'rewardValue', 'target', 'windowDays', 'maxRedemptions', 'endsAt', 'startsAt'].forEach((id) => { $(id).value = ''; });
    await loadPromotions();
  } catch (e) {
    showMsg('Network error creating promotion.', 'err');
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- wiring ---------------------------------------------------------------
function syncConditionalFields() {
  const scope = $('scopeType').value;
  $('targetWrap').style.display = scope === 'store' ? 'none' : 'block';
  $('targetLabel').textContent = scope === 'item' ? 'Item record id' : 'Category label (e.g. Venues)';
  $('target').placeholder = scope === 'item' ? 'rec…' : 'Venues';

  const mode = $('eligibilityMode').value;
  $('fixedWrap').style.display = mode === 'fixed_end' ? 'block' : 'none';
  $('rollingWrap').style.display = mode === 'rolling' ? 'block' : 'none';

  $('rewardValueLabel').textContent = $('rewardType').value === 'amount' ? 'Dollars off (e.g. 10)' : 'Percent (e.g. 25)';
}

$('scopeType').addEventListener('change', syncConditionalFields);
$('eligibilityMode').addEventListener('change', syncConditionalFields);
$('rewardType').addEventListener('change', syncConditionalFields);
$('loadBtn').addEventListener('click', loadPromotions);
$('createBtn').addEventListener('click', createPromotion);

// Restore last store id and prefill from ?storeId=.
const urlStore = new URLSearchParams(location.search).get('storeId');
$('storeId').value = urlStore || localStorage.getItem('promoAdminStoreId') || '';
syncConditionalFields();
if ($('storeId').value) loadPromotions();
