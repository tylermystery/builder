// groups.js
//
// Per-store groups directory. Lists the store's groups (each linking to its own
// group page) and, for users who hold publish permission, offers a small form
// to create a new group. The server decides what's visible: visitors see only
// public groups; a publisher additionally sees private ones and gets the
// create form. Self-contained — never touches the main app bundle.

const $ = (id) => document.getElementById(id);
const token = () => localStorage.getItem('jwt');
const storeId = new URLSearchParams(location.search).get('storeId');

function authHeaders(json) {
  const t = token();
  const h = json ? { 'Content-Type': 'application/json' } : {};
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showMsg(text, kind) {
  const el = $('msg');
  el.textContent = text;
  el.className = kind === 'ok' ? 'ok' : 'err';
  if (kind === 'ok') setTimeout(() => { el.className = ''; el.textContent = ''; }, 4000);
}

function colorFor(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h}, 55%, 52%)`;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

function groupPicHtml(g) {
  if (g.imageUrl) {
    return `<img class="gi-pic" src="${escapeHtml(g.imageUrl)}" alt="${escapeHtml(g.name)}" />`;
  }
  return `<div class="gi-pic" style="background:${colorFor(g.slug || g.name)}">${escapeHtml(initials(g.name))}</div>`;
}

function renderList(groups, canManage) {
  const list = $('list');
  if (!groups.length) {
    list.innerHTML = canManage
      ? '<p class="hint">No groups yet. Create your first one above.</p>'
      : '<p class="hint">This store has no public groups yet.</p>';
    return;
  }
  list.innerHTML = groups.map((g) => {
    const n = g.memberCount || 0;
    const visPill = g.visibility === 'private'
      ? '<span class="pill priv">Private</span>'
      : '<span class="pill pub">Public</span>';
    const kind = g.kind ? ` · ${escapeHtml(g.kind)}` : '';
    return `
      <a class="group-item" href="/group.html?slug=${encodeURIComponent(g.slug)}" style="text-decoration:none;color:inherit">
        ${groupPicHtml(g)}
        <div class="gi-main">
          <div class="gi-name">${escapeHtml(g.name)}${visPill}</div>
          <div class="meta">${n} member${n === 1 ? '' : 's'}${kind}</div>
          ${g.description ? `<div class="meta">${escapeHtml(g.description)}</div>` : ''}
        </div>
        <span class="btn secondary tiny">View →</span>
      </a>`;
  }).join('');
}

async function load() {
  if (!storeId) { $('list').innerHTML = '<p class="hint">No store specified.</p>'; return; }
  try {
    const res = await fetch(`/api/groups?storeId=${encodeURIComponent(storeId)}`, {
      headers: authHeaders(false),
    });
    if (!res.ok) { $('list').innerHTML = '<p class="hint">Could not load groups.</p>'; return; }
    const data = await res.json();
    const canManage = !!data.canManage;
    $('createCard').style.display = canManage ? 'block' : 'none';
    $('subhead').textContent = canManage
      ? 'Create and manage member groups for this store.'
      : 'Member groups for this store.';
    renderList(data.groups || [], canManage);
  } catch {
    $('list').innerHTML = '<p class="hint">Network error loading groups.</p>';
  }
}

async function createGroup() {
  const body = {
    storeId,
    name: $('name').value.trim(),
    kind: $('kind').value.trim() || null,
    description: $('description').value.trim(),
    visibility: $('visibility').value,
  };
  if (!body.name) { showMsg('Name is required.', 'err'); return; }
  if (!token()) { showMsg('Sign in first in the main app — this page reads your saved login.', 'err'); return; }
  try {
    const res = await fetch('/api/groups', {
      method: 'POST', headers: authHeaders(true), body: JSON.stringify(body),
    });
    if (res.status === 403) { showMsg('You do not have publish permission for this store.', 'err'); return; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showMsg(err.error || 'Could not create group.', 'err');
      return;
    }
    const data = await res.json();
    // Jump straight to the new group's page so members can be added.
    if (data.group && data.group.slug) {
      location.href = `/group.html?slug=${encodeURIComponent(data.group.slug)}`;
      return;
    }
    ['name', 'kind', 'description'].forEach((id) => { $(id).value = ''; });
    showMsg('Group created.', 'ok');
    await load();
  } catch {
    showMsg('Network error creating group.', 'err');
  }
}

$('createBtn').addEventListener('click', createGroup);
load();
