import { state } from '../state.js';
import * as api from '../api.js';
import { getTaskDiscussion, messageReactions, taskMessageText } from '../utils/taskDiscussion.js';

const QUICK_REACTIONS = ['👍', '❤️', '🎉', '👀', '❓'];

// Mount independently of the task form so posting a reply never submits task edits.
export function mountTaskDiscussion(container, task, sessionId, getUser, onChange) {
    let records = [];
    let discussion;
    let replyTo = null;
    let busy = false;
    let disposed = false;
    let loading = false;
    const active = () => !disposed && container.isConnected && state.session.id === sessionId;
    const cleanup = () => { disposed = true; };
    const element = (tag, text, className) => {
        const el = document.createElement(tag);
        if (text != null) el.textContent = text;
        if (className) el.className = className;
        return el;
    };
    container.appendChild(element('h4', 'Discussion'));
    const summary = element('p', 'Loading discussion…', 'task-discussion-summary');
    summary.setAttribute('aria-live', 'polite');
    const list = element('div', null, 'task-discussion-messages');
    const status = element('p', '', 'task-discussion-status');
    status.setAttribute('role', 'status');
    const retry = element('button', 'Retry');
    retry.type = 'button';
    retry.hidden = true;
    retry.addEventListener('click', () => load());
    const composer = element('form', null, 'task-discussion-composer');
    const target = element('span', 'Reply to task discussion');
    const cancel = element('button', 'Cancel reply');
    cancel.type = 'button';
    cancel.hidden = true;
    const input = element('textarea');
    input.rows = 2;
    input.placeholder = 'Add a reply…';
    input.setAttribute('aria-label', 'Reply to task discussion');
    input.required = true;
    const send = element('button', 'Send reply');
    send.type = 'submit';
    const taskReactions = element('div', null, 'task-discussion-reactions');
    taskReactions.setAttribute('aria-label', 'React to task');
    composer.append(target, cancel, input, send);
    container.append(summary, taskReactions, list, status, retry, composer);

    function resetTarget() {
        replyTo = null;
        target.textContent = 'Reply to task discussion';
        cancel.hidden = true;
    }
    cancel.addEventListener('click', resetTarget);
    function updateDisabled() {
        const disabled = busy || loading || !discussion || !getUser()?.id || !active();
        container.querySelectorAll('button, textarea').forEach(el => {
            if (el !== retry) el.disabled = disabled;
        });
    }
    function render() {
        discussion = getTaskDiscussion(records, task, state.eventDetails.combined.get('_commentTaskLinks') || {});
        const reactionSummary = discussion.reactions.map(([emoji, count]) => `${emoji} ${count}`).join(' · ');
        summary.textContent = `${discussion.replyCount} ${discussion.replyCount === 1 ? 'reply' : 'replies'} · ${discussion.reactionCount} ${discussion.reactionCount === 1 ? 'reaction' : 'reactions'}${reactionSummary ? ` — ${reactionSummary}` : ''}`;
        taskReactions.replaceChildren();
        addReactions(taskReactions, discussion.roots.find(record => !record.fields?.IsDeleted));
        list.replaceChildren();
        if (!discussion.messages.length) list.appendChild(element('p', 'No discussion yet. Add a reply or reaction to start.'));
        for (const record of discussion.messages) {
            const fields = record.fields || {};
            const article = element('article', null, 'task-discussion-message');
            article.dataset.messageId = record.id;
            const author = fields.SenderName || 'Anonymous';
            article.appendChild(element('strong', author));
            if (fields.Timestamp || record.createdTime) {
                const date = new Date(fields.Timestamp || record.createdTime);
                if (!Number.isNaN(date.getTime())) article.appendChild(element('time', date.toLocaleString()));
            }
            const parent = records.find(item => item.id === fields.ParentMessageID);
            if (parent) article.appendChild(element('small', `Reply to ${parent.fields?.SenderName || 'Anonymous'}`));
            article.appendChild(element('p', fields.IsDeleted ? 'This message was deleted.' : taskMessageText(fields.Content || '')));
            if (!fields.IsDeleted) {
                const actions = element('div', null, 'task-discussion-reactions');
                addReactions(actions, record);
                const reply = element('button', 'Reply');
                reply.type = 'button';
                reply.addEventListener('click', () => {
                    replyTo = record.id;
                    target.textContent = `Replying to ${author}`;
                    cancel.hidden = false;
                    input.focus();
                });
                actions.appendChild(reply);
                article.appendChild(actions);
            }
            list.appendChild(article);
        }
        status.textContent = getUser()?.id ? '' : 'Sign in to reply or react.';
        updateDisabled();
    }
    function addReactions(parent, record) {
        const reactions = messageReactions(record?.fields?.Reactions);
        for (const emoji of new Set([...QUICK_REACTIONS, ...Object.keys(reactions)])) {
            const users = reactions[emoji] || [];
            const selected = users.includes(getUser()?.id);
            const button = element('button', `${emoji}${users.length ? ` ${users.length}` : ''}`);
            button.type = 'button';
            button.setAttribute('aria-label', `${selected ? 'Remove' : 'Add'} ${emoji} reaction (${users.length})`);
            button.setAttribute('aria-pressed', String(selected));
            button.addEventListener('click', () => mutate(async user => {
                const root = record || await ensureRoot(user);
                const result = await api.toggleMessageReaction(root.id, user.id, emoji, !selected);
                if (result === null) throw new Error('Unable to save reaction. Please retry.');
                root.fields.Reactions = result;
            }));
            parent.appendChild(button);
        }
    }
    async function ensureRoot(user) {
        const root = discussion.roots.find(record => !record.fields?.IsDeleted);
        if (root) return root;
        // Persist the task reference in the message itself, so discovery does not
        // depend on a separate session save or a transient client-side mapping.
        const id = await api.postChatMessage(sessionId, user.id, user.name || 'Anonymous',
            `[TASK:${task.id}] Task: ${task.fields?.Name || 'Untitled task'}`, task.fields?.LinkedItem?.[0] || null, { notify: false });
        if (!id) throw new Error('Unable to start task discussion. Please retry.');
        const record = { id, createdTime: new Date().toISOString(), fields: {
            Content: `[TASK:${task.id}] Task: ${task.fields?.Name || 'Untitled task'}`,
            SenderID: user.id, SenderName: user.name || 'Anonymous'
        } };
        records.push(record);
        discussion = getTaskDiscussion(records, task, state.eventDetails.combined.get('_commentTaskLinks') || {});
        return record;
    }
    async function mutate(operation) {
        const user = getUser();
        if (busy || loading || !discussion || !active() || !user?.id) return;
        busy = true;
        status.textContent = '';
        updateDisabled();
        try {
            await operation(user);
            if (active()) render();
            onChange?.();
        } catch (error) {
            if (active()) status.textContent = error.message || 'Unable to save discussion. Please retry.';
        } finally {
            busy = false;
            if (active()) updateDisabled();
        }
    }
    composer.addEventListener('submit', event => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        mutate(async user => {
            const root = replyTo ? records.find(record => record.id === replyTo) : await ensureRoot(user);
            if (!active()) return;
            const result = await api.postReplyMessage(root.id, sessionId, task.fields?.LinkedItem?.[0] || null,
                user.id, user.name || 'Anonymous', text);
            if (!result?.id) throw new Error('Unable to send reply. Your text is preserved; please retry.');
            records.push(result);
            if (active()) { input.value = ''; resetTarget(); }
        });
    });
    async function load() {
        if (loading || !active()) return;
        loading = true;
        retry.hidden = true;
        status.textContent = '';
        updateDisabled();
        try {
            const result = await api.fetchChatMessages(sessionId, { throwOnError: true });
            if (!active()) return;
            records = result;
            render();
        } catch {
            if (active()) {
                summary.textContent = 'Discussion unavailable';
                status.textContent = 'Unable to load replies and reactions.';
                retry.hidden = false;
            }
        } finally {
            loading = false;
            if (active()) updateDisabled();
        }
    }
    load();
    return cleanup;
}
