// group.js
//
// Standalone public page for one member group: a header (name, kind/label,
// description, picture) plus a roster of members rendered with their profile
// pictures, falling back to colored initials when a member has no photo.
//
// Visibility is enforced server-side: a private group returns 403 unless the
// viewer is a store publisher or one of the group's own members. When the
// server reports the viewer can manage the group (a store publisher), a
// management panel is revealed for editing the group and changing membership.
// Everything here is self-contained — it never touches the main app bundle.

const $ = (id) => document.getElementById(id);
const token = () => localStorage.getItem('jwt');
const slug = new URLSearchParams(location.search).get('slug');

let GROUP = null; // the loaded group (set after fetch)

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

// Deterministic pleasant color from a string, so initial-avatars are stable.
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

// One avatar: a photo when present, otherwise a colored initials circle.
function avatarHtml(member, cls) {
  if (member.imageUrl) {
    return `<img class="${cls}" src="${escapeHtml(member.imageUrl)}" alt="${escapeHtml(member.name)}" />`;
  }
  return `<div class="${cls}" style="background:${colorFor(member.userId || member.name)}">${escapeHtml(initials(member.name))}</div>`;
}

function renderHeader(g) {
  $('groupName').textContent = g.name;
  if (g.imageUrl) {
    $('heroPic').innerHTML = `<img src="${escapeHtml(g.imageUrl)}" alt="${escapeHtml(g.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:18px" />`;
  } else {
    $('heroPic').textContent = initials(g.name);
  }
  if (g.kind) { $('groupKind').textContent = g.kind; $('groupKind').style.display = 'inline-block'; }
  $('groupVis').textContent = g.visibility === 'private' ? '🔒 Private' : '🌐 Public';
  $('groupVis').style.display = 'inline-block';
  if (g.description) { $('groupDesc').textContent = g.description; $('groupDesc').style.display = 'block'; }
  const n = g.memberCount || 0;
  $('groupCount').textContent = `${n} member${n === 1 ? '' : 's'}`;
  document.title = `${g.name} · WhatTheFun`;
}

function renderRoster(members) {
  const roster = $('roster');
  if (!members.length) {
    roster.innerHTML = '';
    $('rosterEmpty').style.display = 'block';
    return;
  }
  $('rosterEmpty').style.display = 'none';
  roster.innerHTML = members.map((m) => `
    <div class="member">
      ${avatarHtml(m, 'avatar')}
      <div class="name">${escapeHtml(m.name)}</div>
      ${m.role === 'admin' ? '<div class="role badge-admin">Admin</div>' : '<div class="role">Member</div>'}
    </div>`).join('');
}

// ---- Management (publishers only) ----------------------------------------
function fillEditForm(g) {
  $('editName').value = g.name || '';
  $('editKind').value = g.kind || '';
  $('editDesc').value = g.description || '';
  $('editVis').value = g.visibility || 'public';
  $('editImage').value = g.imageUrl || '';
}

async function loadPicker() {
  const picker = $('picker');
  try {
    const res = await fetch(`/api/groups/store-users?storeId=${encodeURIComponent(GROUP.storeId)}`, {
      headers: authHeaders(false),
    });
    if (!res.ok) { picker.textContent = 'Could not load store members.'; return; }
    const data = await res.json();
    const users = data.users || [];
    if (!users.length) { picker.innerHTML = '<p class="empty">No people are linked to this store yet.</p>'; return; }

    // Current membership set, to mark who is already in the group.
    const memberIds = new Set((GROUP._members || []).map((m) => m.userId));
    picker.innerHTML = users.map((u) => {
      const inGroup = memberIds.has(u.id);
      return `
        <div class="picker-row" data-user="${escapeHtml(u.id)}">
          ${avatarHtml({ userId: u.id, name: u.name, imageUrl: u.imageUrl }, 'avatar')}
          <span class="name">${escapeHtml(u.name)}</span>
          <button class="btn tiny ${inGroup ? 'danger' : ''}" data-act="${inGroup ? 'remove' : 'add'}">
            ${inGroup ? 'Remove' : 'Add'}
          </button>
        </div>`;
    }).join('');

    picker.querySelectorAll('button[data-act]').forEach((b) => {
      b.addEventListener('click', () => toggleMember(b));
    });
  } catch {
    picker.textContent = 'Network error loading store members.';
  }
}

async function toggleMember(btn) {
  const row = btn.closest('.picker-row');
  const userId = row.dataset.user;
  const adding = btn.dataset.act === 'add';
  btn.disabled = true;
  try {
    const res = await fetch('/api/groups/members', {
      method: adding ? 'POST' : 'DELETE',
      headers: authHeaders(true),
      body: JSON.stringify({ groupId: GROUP.id, userId }),
    });
    if (!res.ok) { showMsg('Could not update membership.', 'err'); btn.disabled = false; return; }
    showMsg(adding ? 'Member added.' : 'Member removed.', 'ok');
    await reload(); // refresh roster + counts, then re-render picker
  } catch {
    showMsg('Network error.', 'err');
    btn.disabled = false;
  }
}

async function saveChanges() {
  const body = {
    id: GROUP.id,
    name: $('editName').value.trim(),
    kind: $('editKind').value.trim() || null,
    description: $('editDesc').value.trim(),
    visibility: $('editVis').value,
    imageUrl: $('editImage').value.trim() || null,
  };
  if (!body.name) { showMsg('Name is required.', 'err'); return; }
  try {
    const res = await fetch('/api/groups', {
      method: 'PATCH', headers: authHeaders(true), body: JSON.stringify(body),
    });
    if (!res.ok) { showMsg('Could not save changes.', 'err'); return; }
    showMsg('Saved.', 'ok');
    await reload();
  } catch {
    showMsg('Network error.', 'err');
  }
}

async function deleteGroup() {
  if (!confirm('Delete this group? Its membership list is removed too. This cannot be undone.')) return;
  try {
    const res = await fetch('/api/groups', {
      method: 'DELETE', headers: authHeaders(true), body: JSON.stringify({ id: GROUP.id }),
    });
    if (!res.ok) { showMsg('Could not delete group.', 'err'); return; }
    // Back to the store's groups directory.
    location.href = `/groups.html?storeId=${encodeURIComponent(GROUP.storeId)}`;
  } catch {
    showMsg('Network error.', 'err');
  }
}

// ---- Load / reload --------------------------------------------------------
async function reload() {
  const res = await fetch(`/api/groups/by-slug?slug=${encodeURIComponent(slug)}`, {
    headers: authHeaders(false),
  });

  if (res.status === 403) {
    $('loading').style.display = 'none';
    $('content').style.display = 'none';
    $('private-note').style.display = 'block';
    return;
  }
  if (res.status === 404) {
    $('loading').textContent = 'Group not found.';
    return;
  }
  if (!res.ok) {
    $('loading').textContent = 'Could not load this group.';
    return;
  }

  const data = await res.json();
  GROUP = { ...data.group, _members: data.members || [] };

  $('loading').style.display = 'none';
  $('content').style.display = 'block';
  renderHeader(GROUP);
  renderRoster(data.members || []);

  if (data.canManage) {
    $('manageCard').style.display = 'block';
    fillEditForm(GROUP);
    await loadPicker();
  } else {
    $('manageCard').style.display = 'none';
  }
}

// ---- init -----------------------------------------------------------------
if (!slug) {
  $('loading').textContent = 'No group specified.';
} else {
  $('saveBtn').addEventListener('click', saveChanges);
  $('deleteBtn').addEventListener('click', deleteGroup);
  reload();
}
