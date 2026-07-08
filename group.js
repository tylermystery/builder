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
const DEBUG_LOG = [];

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

function addDebugLog(event, details = {}) {
  const safe = {
    time: new Date().toISOString(),
    event,
    slug,
    groupId: GROUP?.id || null,
    ...details,
  };
  delete safe.token;
  delete safe.Authorization;
  DEBUG_LOG.push(safe);
  if (DEBUG_LOG.length > 30) DEBUG_LOG.shift();
}

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function copyDebugLog() {
  const payload = {
    page: 'group',
    href: location.href,
    userAgent: navigator.userAgent,
    hasToken: !!token(),
    group: GROUP ? {
      id: GROUP.id,
      storeId: GROUP.storeId,
      slug: GROUP.slug,
      canManageVisible: $('manageCard')?.style.display === 'block',
      memberCount: GROUP.memberCount,
    } : null,
    log: DEBUG_LOG,
  };
  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    $('debugStatus').textContent = 'Debug log copied.';
  } catch {
    $('debugStatus').textContent = text;
  }
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

function safeHttpUrl(url) {
  const value = String(url || '').trim();
  return /^https?:\/\//i.test(value) ? value : '';
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
      ${m.bio ? `<div class="bio">${escapeHtml(m.bio)}</div>` : ''}
      ${m.storeName ? (safeHttpUrl(m.storeUrl) ? `<a class="store-link" href="${escapeHtml(safeHttpUrl(m.storeUrl))}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.storeName)}</a>` : `<div class="store-link">${escapeHtml(m.storeName)}</div>`) : ''}
      ${m.role === 'admin' ? '<div class="role badge-admin">Admin</div>' : '<div class="role">Member</div>'}
      ${m.canEdit ? `<div class="member-actions">
        <button class="btn secondary tiny" data-member-edit="${escapeHtml(m.userId)}" type="button">Edit</button>
        <button class="btn danger tiny" data-member-remove="${escapeHtml(m.userId)}" type="button">Remove</button>
      </div>` : ''}
    </div>`).join('');
  roster.querySelectorAll('button[data-member-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openMemberEditor(btn.dataset.memberEdit));
  });
  roster.querySelectorAll('button[data-member-remove]').forEach((btn) => {
    btn.addEventListener('click', () => removeMember(btn.dataset.memberRemove));
  });
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
    const data = await parseJsonSafe(res);
    addDebugLog('load-store-users', { status: res.status, ok: res.ok, error: data.error });
    if (!res.ok) { picker.textContent = 'Could not load store members.'; return; }
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
    const data = await parseJsonSafe(res);
    addDebugLog('toggle-member', { status: res.status, ok: res.ok, action: adding ? 'add' : 'remove', error: data.error });
    if (!res.ok) { showMsg(data.error || 'Could not update membership.', 'err'); btn.disabled = false; return; }
    showMsg(adding ? 'Member added.' : 'Member removed.', 'ok');
    await reload(); // refresh roster + counts, then re-render picker
  } catch {
    showMsg('Network error.', 'err');
    btn.disabled = false;
  }
}

async function addMemberDetails() {
  const body = {
    groupId: GROUP.id,
    name: $('memberName').value.trim(),
    email: $('memberEmail').value.trim(),
    role: $('memberRole').value,
    photoUrls: $('memberPhotos').value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
    bio: $('memberBio').value.trim(),
    storeName: $('memberStoreName').value.trim(),
    storeUrl: $('memberStoreUrl').value.trim(),
  };
  if (!body.name) { showMsg('Member name is required.', 'err'); return; }
  const btn = $('addMemberBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/groups/create-member', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify(body),
    });
    const data = await parseJsonSafe(res);
    addDebugLog('create-member', {
      status: res.status,
      ok: res.ok,
      error: data.error,
      debug: data.debug,
      fields: {
        hasName: !!body.name,
        hasEmail: !!body.email,
        photoCount: body.photoUrls.length,
        hasBio: !!body.bio,
        hasStoreName: !!body.storeName,
        hasStoreUrl: !!body.storeUrl,
        role: body.role,
      },
    });
    if (!res.ok) {
      showMsg(data.error || 'Could not add member.', 'err');
      btn.disabled = false;
      return;
    }
    ['memberName', 'memberEmail', 'memberPhotos', 'memberBio', 'memberStoreName', 'memberStoreUrl'].forEach((id) => { $(id).value = ''; });
    $('memberRole').value = 'member';
    showMsg('Member added.', 'ok');
    await reload();
    btn.disabled = false;
  } catch {
    showMsg('Network error adding member.', 'err');
    btn.disabled = false;
  }
}

function openMemberEditor(userId) {
  const member = (GROUP._members || []).find((m) => m.userId === userId);
  if (!member) return;
  const existing = $('memberEditPanel');
  if (existing) existing.remove();
  const roster = $('roster');
  const panel = document.createElement('div');
  panel.className = 'member-edit';
  panel.id = 'memberEditPanel';
  panel.dataset.user = userId;
  const photos = Array.isArray(member.imageUrls) ? member.imageUrls.join('\n') : '';
  panel.innerHTML = `
    <h2>Edit member</h2>
    <div class="row">
      <div>
        <label for="editMemberName">Member name</label>
        <input id="editMemberName" value="${escapeHtml(member.name)}" />
      </div>
      <div>
        <label for="editMemberRole">Role</label>
        <select id="editMemberRole">
          <option value="member"${member.role === 'admin' ? '' : ' selected'}>Member</option>
          <option value="admin"${member.role === 'admin' ? ' selected' : ''}>Admin</option>
        </select>
      </div>
    </div>
    <label for="editMemberEmail">Member email</label>
    <input id="editMemberEmail" type="email" value="${escapeHtml(member.email || '')}" autocomplete="email" />
    <label for="editMemberPhotos">Profile photo URL(s)</label>
    <textarea id="editMemberPhotos">${escapeHtml(photos)}</textarea>
    <label for="editMemberBio">Bio</label>
    <textarea id="editMemberBio">${escapeHtml(member.bio || '')}</textarea>
    <div class="row">
      <div>
        <label for="editMemberStoreName">Store name</label>
        <input id="editMemberStoreName" value="${escapeHtml(member.storeName || '')}" />
      </div>
      <div>
        <label for="editMemberStoreUrl">Store link</label>
        <input id="editMemberStoreUrl" value="${escapeHtml(member.storeUrl || '')}" />
      </div>
    </div>
    <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap">
      <button class="btn tiny" id="saveMemberBtn" type="button">Save member</button>
      <button class="btn secondary tiny" id="cancelMemberBtn" type="button">Cancel</button>
    </div>`;
  roster.prepend(panel);
  $('saveMemberBtn').addEventListener('click', saveMemberEdit);
  $('cancelMemberBtn').addEventListener('click', () => panel.remove());
}

async function saveMemberEdit() {
  const panel = $('memberEditPanel');
  if (!panel) return;
  const body = {
    groupId: GROUP.id,
    userId: panel.dataset.user,
    name: $('editMemberName').value.trim(),
    email: $('editMemberEmail').value.trim(),
    role: $('editMemberRole').value,
    photoUrls: $('editMemberPhotos').value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
    bio: $('editMemberBio').value.trim(),
    storeName: $('editMemberStoreName').value.trim(),
    storeUrl: $('editMemberStoreUrl').value.trim(),
  };
  if (!body.name) { showMsg('Member name is required.', 'err'); return; }
  try {
    const res = await fetch('/api/groups/members', {
      method: 'PATCH',
      headers: authHeaders(true),
      body: JSON.stringify(body),
    });
    const data = await parseJsonSafe(res);
    addDebugLog('edit-member', { status: res.status, ok: res.ok, error: data.error, hasEmail: !!body.email });
    if (!res.ok) { showMsg(data.error || 'Could not save member.', 'err'); return; }
    showMsg('Member saved.', 'ok');
    await reload();
  } catch {
    showMsg('Network error saving member.', 'err');
  }
}

async function removeMember(userId) {
  if (!confirm('Remove this member from the group?')) return;
  try {
    const res = await fetch('/api/groups/members', {
      method: 'DELETE',
      headers: authHeaders(true),
      body: JSON.stringify({ groupId: GROUP.id, userId }),
    });
    const data = await parseJsonSafe(res);
    addDebugLog('remove-member', { status: res.status, ok: res.ok, error: data.error, self: GROUP?._currentUserId === userId });
    if (!res.ok) { showMsg(data.error || 'Could not remove member.', 'err'); return; }
    showMsg('Member removed.', 'ok');
    await reload();
  } catch {
    showMsg('Network error removing member.', 'err');
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
    const data = await parseJsonSafe(res);
    addDebugLog('save-group', { status: res.status, ok: res.ok, error: data.error });
    if (!res.ok) { showMsg(data.error || 'Could not save changes.', 'err'); return; }
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
  const data = await parseJsonSafe(res);
  addDebugLog('load-group', { status: res.status, ok: res.ok, error: data.error, private: data.private });

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

  GROUP = { ...data.group, _members: data.members || [], _currentUserId: data.currentUserId || null };

  $('loading').style.display = 'none';
  $('content').style.display = 'block';
  renderHeader(GROUP);
  renderRoster(data.members || []);

  if (data.canManageMembers) {
    $('manageCard').style.display = 'block';
    $('groupSettingsSection').style.display = data.canManage ? 'block' : 'none';
    $('addMemberSection').style.display = data.canManage ? 'block' : 'none';
    $('storeUsersSection').style.display = data.canManage ? 'block' : 'none';
    if (data.canManage) {
      fillEditForm(GROUP);
      await loadPicker();
    }
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
  $('addMemberBtn').addEventListener('click', addMemberDetails);
  $('copyDebugBtn').addEventListener('click', copyDebugLog);
  reload();
}
