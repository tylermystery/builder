// FILE: components/collab/communityComments.js
//
// Community comments as collab targets, for the conversations panel's combined
// timeline: each comment's superscript opens one-click reactions under it.
// id = "<recordId>::<commentId>"
import { state, getRecordById } from '../../state.js';
import * as api from '../../api.js';
import { togglePendingReaction } from '../../utils/pendingCollab.js';
import { getCommunityRowForRecord, COLLAB_GUEST_ID } from '../publicCatalog.js';
import { registerCollabKind } from './collabControl.js';

function me() {
    const u = state.session?.user || {};
    return { id: u.id || null, name: u.name || 'You', signedIn: !!u.isAuthenticated };
}

// Community comments (id = "<recordId>::<commentId>").
const splitComment = (id) => {
    const at = String(id).lastIndexOf('::');
    return { recordId: String(id).slice(0, at), commentId: Number(String(id).slice(at + 2)) };
};
const findCommunityComment = (id) => {
    const { recordId, commentId } = splitComment(id);
    const row = getCommunityRowForRecord(getRecordById(recordId));
    return { row, comment: (row?.comments || []).find(c => c.id === commentId) || null };
};
const communityCommentMap = (comment) => {
    const map = new Map();
    for (const [emoji, data] of Object.entries(comment?.reactions || {})) {
        for (const userId of data?.users || []) {
            if (!map.has(userId)) map.set(userId, new Set());
            map.get(userId).add(emoji);
        }
    }
    return map;
};

registerCollabKind('ccomment', {
    title: (id) => `${findCommunityComment(id).comment?.authorName || 'Someone'}'s comment`,
    sources: (id) => [{ scope: 'community', label: 'community', icon: '🌐', map: communityCommentMap(findCommunityComment(id).comment) }],
    scopes: (id) => (findCommunityComment(id).comment ? ['community'] : []),
    mine: (id) => communityCommentMap(findCommunityComment(id).comment).get(me().id || COLLAB_GUEST_ID) || new Set(),
    toggle: async (id, scope, emoji) => {
        const { row, comment } = findCommunityComment(id);
        if (!row || !comment) return null;
        const result = me().signedIn
            ? await api.togglePublicReaction(row.id, emoji, null, { commentId: comment.id })
            : { reacted: togglePendingReaction(row.id, emoji, null, { commentId: comment.id }) };
        if (!result) return null;
        const who = me().id || COLLAB_GUEST_ID;
        comment.reactions = comment.reactions || {};
        const entry = comment.reactions[emoji] || { count: 0, users: [] };
        if (result.reacted && !entry.users.includes(who)) { entry.users.push(who); entry.count++; }
        if (!result.reacted) { entry.users = entry.users.filter(u => u !== who); entry.count = Math.max(0, entry.count - 1); }
        if (entry.count > 0) comment.reactions[emoji] = entry; else delete comment.reactions[emoji];
        return !!result.reacted;
    },
    openCount: (id) => {
        const { row, comment } = findCommunityComment(id);
        return (row?.comments || []).filter(c => comment && c.parentCommentId === comment.id).length;
    }
});

