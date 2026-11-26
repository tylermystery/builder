/**
 * Reaction Summary Bar (RSB) — retired.
 *
 * Tiles used to carry their own reaction popup (React / Summary tabs, several
 * emoji layouts and a ⚙ layout switcher). That's all gone: an item's reactions,
 * sentiment summary and chats live in the conversations panel, opened from the
 * sentiment superscript after the tile title (see collab/collabControl.js).
 *
 * This module keeps the hooks other presentation modules call, so a reaction
 * change still updates the tile's superscript.
 */

import { refreshCollabSups } from '../collab/collabControl.js';

export function init() {}

export function cleanup() {}

/** Clear the old layout switcher and its body flag, if an earlier version left them. */
export function initializeReactionZones() {
    document.querySelectorAll('.rsb-layout-toggle-fab, .rsb-layout-popup').forEach(el => el.remove());
    delete document.body.dataset.rsbLayout;
}

/** A tile's reactions changed: refresh its title superscript (summary emoji + open count). */
export function updateReactionZoneSummary(recordId) {
    if (recordId) refreshCollabSups('item', recordId);
}
