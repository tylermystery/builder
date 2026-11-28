function tally() {
    return { done: 0, total: 0 };
}

function count(tally, done) {
    tally.total++;
    if (done) tally.done++;
}

function summarize(done, total) {
    const status = !total ? 'empty' : done === total ? 'complete' : done ? 'in-progress' : 'open';
    return { done, total, status, percent: total ? Math.floor(done / total * 100) : 0 };
}

export function calculatePlanCompletion(itemIds, completedItems, archivedItems, conversations) {
    const byItem = new Map();
    for (const itemId of itemIds) {
        if (!archivedItems?.has(itemId)) byItem.set(itemId, { done: Number(!!completedItems?.has(itemId)), total: 1 });
    }
    const counts = { items: tally(), tasks: tally(), chats: tally() };
    let done = 0;
    for (const item of byItem.values()) done += item.done;

    for (const entry of conversations) {
        count(counts[entry.type], entry.done);
        if (entry.done) done++;
        for (const itemId of new Set(entry.itemIds)) {
            const item = byItem.get(itemId);
            if (item) count(item, entry.done);
        }
    }
    for (const [itemId, item] of byItem) {
        const summary = summarize(item.done, item.total);
        byItem.set(itemId, summary);
        count(counts.items, summary.status === 'complete');
    }
    return { ...summarize(done, byItem.size + conversations.length), byItem, counts };
}
