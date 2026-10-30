// Shared saved-plan snapshot for collaboration emails. No browser cache is used.
const fetch = require('node-fetch');
const { parseSessionData, getPlanContext, getCheckoutItems, escapeHtml } = require('./checkout-emails');

async function airtable(path, params = {}, fetcher = fetch) {
  const query = new URLSearchParams(params);
  const url = `https://api.airtable.com/v0/${process.env.BASE_ID}/${path}${query.size ? `?${query}` : ''}`;
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` } });
  if (!response.ok) throw new Error('Unable to load complete plan snapshot');
  return response.json();
}

async function pages(table, params, fetcher) {
  const records = [];
  let offset;
  do {
    const page = await airtable(table, { ...params, ...(offset ? { offset } : {}) }, fetcher);
    if (!Array.isArray(page.records)) throw new Error('Invalid plan snapshot response');
    records.push(...page.records);
    offset = page.offset;
  } while (offset);
  return records;
}

async function loadTasks(sessionId, fetcher) {
  let tasks;
  try {
    tasks = await pages('Tasks', { filterByFormula: `FIND('${sessionId}', ARRAYJOIN({ProjectId}))` }, fetcher);
  } catch {
    // Older bases do not support filtering linked record IDs server-side.
  }
  if (!tasks?.length) tasks = await pages('Tasks', {}, fetcher);
  return [...new Map(tasks.filter(task => Array.isArray(task.fields?.ProjectId) && task.fields.ProjectId.includes(sessionId)).map(task => [task.id, task])).values()]
    .sort((a, b) => (a.fields?.Order ?? Infinity) - (b.fields?.Order ?? Infinity) || String(a.id).localeCompare(String(b.id)));
}

function taskItemIds(task, tasksById, seen = new Set()) {
  if (!task || seen.has(task.id)) return [];
  seen.add(task.id);
  const linked = task.fields?.LinkedItem || [];
  if (linked.length) return linked;
  return (task.fields?.ParentTask || []).flatMap(id => taskItemIds(tasksById.get(id), tasksById, seen));
}

function reactionCounts(data, itemId) {
  const byUser = new Map();
  for (const [key, users] of Object.entries(data.itemReactions || {})) {
    if (key !== itemId && !key.startsWith(`${itemId}::`)) continue;
    for (const [user, emojis] of Object.entries(users || {})) {
      const selected = byUser.get(user) || new Set();
      for (const emoji of Array.isArray(emojis) ? emojis : [emojis]) {
        if (typeof emoji === 'string' && emoji) selected.add(emoji);
      }
      byUser.set(user, selected);
    }
  }
  const counts = new Map();
  for (const emojis of byUser.values()) for (const emoji of emojis) counts.set(emoji, (counts.get(emoji) || 0) + 1);
  return { text: [...counts].map(([emoji, count]) => `${emoji} ${count}`).join(' · '), total: [...counts.values()].reduce((sum, count) => sum + count, 0) };
}

async function loadSelectedVersions(session, data) {
  const entries = Object.entries({ ...data.ideasItems, ...data.lockedInItems });
  const ids = [...new Set(entries.map(([, info]) => info.variationId).filter(id => Number.isInteger(Number(id)) && Number(id) > 0))];
  if (!ids.length) return [];
  const { getDatabase } = require('@netlify/database');
  const db = getDatabase();
  const result = await db.pool.query(
    `SELECT v.id, v.name, v.description, v.price, p.catalog_item_id, p.origin_item_id
       FROM item_variations v JOIN public_items p ON p.id = v.public_item_id
      WHERE v.id = ANY($1::int[]) AND p.store_id = $2 AND p.hidden = false AND v.hidden = false AND v.status = 'approved'`,
    [ids, session.fields?.Stores?.[0] || '']
  );
  return result.rows;
}

async function loadPlanSnapshot(sessionOrId, options = {}) {
  const fetcher = options.fetcher || fetch;
  const session = typeof sessionOrId === 'string' ? await airtable(`Sessions/${encodeURIComponent(sessionOrId)}`, {}, fetcher) : sessionOrId;
  if (!session?.id || !/^rec[A-Za-z0-9]+$/.test(session.id)) throw new Error('Invalid snapshot plan');
  const rawData = session.fields?.['Items with Variations'];
  if (rawData) {
    try { const parsed = JSON.parse(rawData); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); }
    catch { throw new Error('Unable to read saved plan snapshot'); }
  }
  const data = parseSessionData(session);
  const included = { ...(data.ideasItems || data.favoritedItems || {}), ...data.lockedInItems };
  const records = new Map((options.itemRecords || []).map(record => [record.id, record]));
  const [tasks, versions] = await Promise.all([
    loadTasks(session.id, fetcher),
    options.versions || loadSelectedVersions(session, data),
    // Bound concurrent item requests; a missing/deleted item remains visible by its saved name.
    (async () => {
      const ids = Object.keys(included);
      for (let i = 0; i < ids.length; i += 5) {
        await Promise.all(ids.slice(i, i + 5).map(async id => {
          if (data.aiRecords?.[id]) { records.set(id, data.aiRecords[id]); return; }
          if (records.has(id) || !/^rec[A-Za-z0-9]+$/.test(id)) return;
          try { records.set(id, await airtable(`tblUA4uuS8IYlhKpD/${id}`, {}, fetcher)); }
          catch { records.set(id, { id, fields: {}, snapshotUnavailable: true }); }
        }));
      }
    })()
  ]);
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  const linkedItems = new Map(tasks.map(task => [task.id, taskItemIds(task, tasksById)]));
  const items = getCheckoutItems({ ...data, lockedInItems: included }, [...records.values()]).map(item => {
    const info = included[item.id] || {};
    const original = records.get(item.id);
    const record = { id: item.id, fields: { ...(original?.fields || {}) } };
    const version = versions.find(v => String(v.id) === String(info.variationId) && (v.catalog_item_id === item.id || v.origin_item_id === item.id));
    if (version) {
      if (version.name) record.fields.Name = version.name;
      if (version.description) record.fields.Description = version.description;
      if (version.price != null) record.fields.Price = version.price;
    }
    const iteration = data.itemIterations?.[item.id]?.iterations?.[data.activeVariationIndices?.[item.id] || 0];
    if (iteration && Number(data.activeVariationIndices?.[item.id]) > 0) {
      if (iteration.title) record.fields.Name = iteration.title;
      if (iteration.description) record.fields.Description = iteration.description;
    }
    const resolved = getCheckoutItems({ lockedInItems: { [item.id]: info } }, [record])[0];
    const reactions = reactionCounts(data, item.id);
    return { ...resolved, additionalDetails: [record.fields.Location && `Location: ${record.fields.Location}`, record.fields.Address && `Address: ${record.fields.Address}`, record.fields.GoodToKnow && `Good to know: ${record.fields.GoodToKnow}`].filter(Boolean), description: record.fields.Description || '',
      availabilityNote: original?.snapshotUnavailable ? 'Catalog details are unavailable; saved selections are shown where possible.' :
        (info.variationId && !version ? 'Selected version details are unavailable.' : ''),
      status: Object.hasOwn(data.lockedInItems || {}, item.id) ? 'Included' : 'Idea',
      reactions: reactions.text, reactionCount: reactions.total,
      tasks: tasks.filter(task => linkedItems.get(task.id).includes(item.id)) };
  });
  const order = data.planItemOrder || [];
  items.sort((a, b) => {
    const index = id => order.includes(id) ? order.indexOf(id) : order.length;
    return index(a.id) - index(b.id);
  });
  const itemIds = new Set(items.map(item => item.id));
  const planTasks = tasks.filter(task => !linkedItems.get(task.id).length);
  const otherTasks = tasks.filter(task => linkedItems.get(task.id).length && !linkedItems.get(task.id).some(id => itemIds.has(id)));
  return { storeId: session.fields?.Stores?.[0] || null, plan: getPlanContext(session, data), items, tasks, planTasks, otherTasks,
    createdAt: (options.now || new Date()).toISOString(),
    summary: data.eventDetails?.summary || data.eventDetails?.Summary || session.fields?.Summary || '',
    subtotal: items.filter(item => item.status === 'Included').reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) };
}

const STATUS = { pending: 'Pending', in_progress: 'In progress', blocked: 'Blocked', completed: 'Completed' };
const money = value => `$${Number(value || 0).toFixed(2)}`;
function taskLines(task) {
  const f = task.fields || {};
  return [f.Name || 'Untitled task', `Status: ${STATUS[f.Status] || f.Status || 'Pending'}`,
    f.Assignee ? `Assignee: ${Array.isArray(f.Assignee) ? f.Assignee.join(', ') : f.Assignee}` : '',
    f.DueDate ? `Due: ${f.DueDate}` : '', f.Priority ? `Priority: ${f.Priority}` : '', f.Description || ''].filter(Boolean);
}
function taskHtml(tasks) {
  if (!tasks.length) return '<p style="color:#666;font-size:13px">No tasks for this item.</p>';
  return `<ul style="padding-left:20px">${tasks.map(task => `<li style="margin:10px 0;white-space:pre-wrap">${taskLines(task).map(escapeHtml).join('<br>')}</li>`).join('')}</ul>`;
}

function buildSnapshotEmailParts(snapshot) {
  const completed = snapshot.tasks.filter(task => task.fields?.Status === 'completed').length;
  const counts = `${snapshot.items.filter(item => item.status === 'Included').length} included items · ${snapshot.items.filter(item => item.status === 'Idea').length} ideas · ${snapshot.tasks.length} tasks (${completed} completed, ${snapshot.tasks.length - completed} open) · ${snapshot.items.reduce((sum, item) => sum + item.reactionCount, 0)} reactions`;
  const context = [snapshot.plan.goals && `Goals: ${snapshot.plan.goals}`, snapshot.plan.schedule && `Schedule: ${snapshot.plan.schedule}`].filter(Boolean);
  const itemSections = snapshot.items.map(item => {
    const details = [...item.optionLines, ...item.additionalDetails, item.schedule && `Schedule: ${item.schedule}`, item.rsvpType && `RSVP: ${item.rsvpType}`, item.note && `Notes: ${item.note}`, item.availabilityNote].filter(Boolean);
    return `<section style="padding:16px 0;border-top:1px solid #ddd"><h3 style="margin:0 0 8px">${escapeHtml(item.name)}</h3><p>${escapeHtml(item.status)} · Quantity: ${item.quantity} · ${money(item.unitPrice * item.quantity)}</p>${item.description ? `<p style="white-space:pre-wrap">${escapeHtml(item.description)}</p>` : ''}${details.length ? `<p style="white-space:pre-wrap">${details.map(escapeHtml).join('<br>')}</p>` : ''}<p>Reactions: ${escapeHtml(item.reactions || 'No reactions yet')}</p><h4 style="margin-bottom:4px">Tasks</h4>${taskHtml(item.tasks)}</section>`;
  }).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:24px auto;padding:20px;background:#fff;color:#333;line-height:1.5;overflow-wrap:anywhere"><h2>Plan snapshot: ${escapeHtml(snapshot.plan.name || 'Your plan')}</h2><p style="font-size:12px;color:#666">Snapshot as of ${escapeHtml(snapshot.createdAt)}</p><p>${escapeHtml(counts)}</p>${context.map(line => `<p style="white-space:pre-wrap">${escapeHtml(line)}</p>`).join('')}${snapshot.summary ? `<p style="white-space:pre-wrap"><strong>Summary:</strong> ${escapeHtml(snapshot.summary)}</p>` : ''}${itemSections || '<p>No items yet.</p>'}<h3>Plan-wide tasks</h3>${snapshot.planTasks.length ? taskHtml(snapshot.planTasks) : '<p>No plan-wide tasks.</p>'}${snapshot.otherTasks.length ? `<h3>Tasks for items no longer in this plan</h3>${taskHtml(snapshot.otherTasks)}` : ''}<p><strong>Included items subtotal: ${money(snapshot.subtotal)}</strong></p><p style="font-size:12px;color:#666">This is the saved plan at the time of this email. Open the plan for its latest state. Task totals count each task once, including tasks linked to multiple items.</p></div>`;
  const text = [
    `Plan snapshot: ${snapshot.plan.name || 'Your plan'}`, `Snapshot as of ${snapshot.createdAt}`, counts, ...context,
    snapshot.summary && `Summary: ${snapshot.summary}`,
    ...snapshot.items.map(item => [
      `${item.name} (${item.status}) — Quantity: ${item.quantity} — ${money(item.unitPrice * item.quantity)}`,
      item.description, ...item.optionLines, ...item.additionalDetails, item.schedule, item.note, item.rsvpType && `RSVP: ${item.rsvpType}`, item.availabilityNote,
      `Reactions: ${item.reactions || 'No reactions yet'}`, 'Tasks:', ...item.tasks.map(task => taskLines(task).join('\n')),
      !item.tasks.length && 'No tasks for this item.'
    ].filter(Boolean).join('\n')),
    'Plan-wide tasks:', ...snapshot.planTasks.map(task => taskLines(task).join('\n')), !snapshot.planTasks.length && 'No plan-wide tasks.',
    snapshot.otherTasks.length && 'Tasks for items no longer in this plan:', ...snapshot.otherTasks.map(task => taskLines(task).join('\n')),
    `Included items subtotal: ${money(snapshot.subtotal)}`, 'Open the plan for its latest state. Task totals count each task once.'
  ].filter(Boolean).join('\n\n');
  const attachments = Buffer.byteLength(html, 'utf8') > 80000 ? [{ filename: 'complete-plan-snapshot.html', type: 'text/html', disposition: 'attachment', content: Buffer.from(`<!doctype html><meta charset="utf-8"><title>Plan snapshot</title>${html}`).toString('base64') }] : [];
  return { html, text, ...(attachments.length ? { attachments } : {}) };
}

module.exports = { loadPlanSnapshot, buildSnapshotEmailParts };
