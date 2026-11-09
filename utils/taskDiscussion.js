// Task discussions reuse persisted plan messages and their existing reply/reaction fields.
export function taskMessageId(content = '') {
    return content.replace(/^\[PLAN_COMMENT:item:[^\]]+\]\s*/, '').match(/^\[TASK:([^\]]+)\]\s*/)?.[1] || null;
}

export function taskMessageText(content = '') {
    return content.replace(/^\[PLAN_COMMENT:item:[^\]]+\]\s*/, '').replace(/^\[TASK:[^\]]+\]\s*/, '');
}

export function messageReactions(value) {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Object.fromEntries(Object.entries(parsed || {}).filter(([, users]) => Array.isArray(users)));
    } catch { return {}; }
}

export function getTaskDiscussion(records, task, links = {}) {
    const roots = new Set(Object.entries(links).filter(([, id]) => id === task.id).map(([id]) => id));
    if (task.fields?.SourceCommentId) roots.add(task.fields.SourceCommentId);
    for (const record of records) {
        if (taskMessageId(record.fields?.Content) === task.id) roots.add(record.id);
    }
    const selected = new Set(roots);
    // Include nested replies regardless of response order; cycle-safe.
    let added;
    do {
        added = false;
        for (const record of records) {
            if (!selected.has(record.id) && selected.has(record.fields?.ParentMessageID)) {
                selected.add(record.id);
                added = true;
            }
        }
    } while (added);
    const messages = records.filter(record => selected.has(record.id));
    messages.sort((a, b) => String(a.fields?.Timestamp || a.createdTime || '').localeCompare(String(b.fields?.Timestamp || b.createdTime || '')));
    const counts = new Map();
    for (const record of messages) {
        if (record.fields?.IsDeleted) continue;
        for (const [emoji, users] of Object.entries(messageReactions(record.fields?.Reactions))) {
            counts.set(emoji, (counts.get(emoji) || 0) + users.length);
        }
    }
    return {
        messages,
        roots: messages.filter(record => roots.has(record.id)),
        replyCount: messages.filter(record => !roots.has(record.id) && !record.fields?.IsDeleted).length,
        reactions: [...counts],
        reactionCount: [...counts.values()].reduce((sum, count) => sum + count, 0)
    };
}
