// FILE: utils/onlinePresence.js
// Who is in the plan right now (from the Pusher presence channel), shared so the
// plan header's member chips can show a green "online" dot that survives re-renders.

let onlineIds = new Set();

/** Replace the set of online member ids and refresh any member chips on the page. */
export function setOnlineMembers(ids) {
    onlineIds = new Set(ids || []);
    applyOnlineDots();
}

export function isMemberOnline(id) {
    return onlineIds.has(id);
}

/** Toggle the `online` class on collaborator chips under `root`. */
export function applyOnlineDots(root = document) {
    root.querySelectorAll?.('.collaborator-name-btn[data-collaborator-id]').forEach(btn => {
        const online = onlineIds.has(btn.dataset.collaboratorId);
        btn.classList.toggle('online', online);
        const name = btn.dataset.collaboratorName || btn.textContent.trim();
        btn.title = online ? `${name} · online now` : name;
    });
}
