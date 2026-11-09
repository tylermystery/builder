import { state } from '../state.js';

const pendingLoads = new Map();
const loadedProjects = new Set();
const loadErrors = new Map();

function notify(projectId) {
    window.dispatchEvent(new CustomEvent('tasks-state-updated', { detail: { projectId } }));
}

export function upsertProjectTask(task, projectId) {
    if (!task?.id) return;
    state.tasks.all.set(task.id, task);
    const projects = new Set(task.fields?.ProjectId || []);
    if (projectId) projects.add(projectId);
    for (const [id, tasks] of state.tasks.byProject) {
        if (tasks.some(existing => existing.id === task.id)) projects.add(id);
    }
    for (const id of projects) {
        const tasks = new Map((state.tasks.byProject.get(id) || []).map(existing => [existing.id, existing]));
        tasks.set(task.id, task);
        state.tasks.byProject.set(id, [...tasks.values()]);
        notify(id);
    }
}

export function removeProjectTask(taskId) {
    state.tasks.all.delete(taskId);
    for (const [projectId, tasks] of state.tasks.byProject) {
        if (!tasks.some(task => task.id === taskId)) continue;
        state.tasks.byProject.set(projectId, tasks.filter(task => task.id !== taskId));
        notify(projectId);
    }
}

export function getProjectTaskLoadState(projectId) {
    return { loading: pendingLoads.has(projectId), loaded: loadedProjects.has(projectId), error: loadErrors.get(projectId) };
}

// Share in-flight reads between the presentation and conversations views. Local
// saves that finish during a read take precedence over its older response.
export function loadProjectTasks(projectId, fetchTasks, { force = false } = {}) {
    if (!projectId) return Promise.resolve([]);
    if (pendingLoads.has(projectId)) return pendingLoads.get(projectId);
    if (!force && loadedProjects.has(projectId)) return Promise.resolve(state.tasks.byProject.get(projectId) || []);
    const before = new Map(state.tasks.all);
    loadErrors.delete(projectId);
    const request = Promise.resolve().then(() => fetchTasks(projectId, { throwOnError: true })).then(records => {
        if (!Array.isArray(records)) throw new Error('Unable to load tasks');
        const tasks = new Map();
        for (const task of records) {
            if (before.has(task.id) && !state.tasks.all.has(task.id)) continue;
            const current = state.tasks.all.get(task.id);
            tasks.set(task.id, current && current !== before.get(task.id) ? current : task);
        }
        for (const task of state.tasks.byProject.get(projectId) || []) {
            const current = state.tasks.all.get(task.id);
            if (current && current !== before.get(task.id)) tasks.set(task.id, current);
        }
        const result = [...tasks.values()];
        result.forEach(task => state.tasks.all.set(task.id, task));
        state.tasks.byProject.set(projectId, result);
        loadedProjects.add(projectId);
        return result;
    }).catch(error => {
        loadErrors.set(projectId, error);
        throw error;
    }).finally(() => {
        pendingLoads.delete(projectId);
        notify(projectId);
    });
    pendingLoads.set(projectId, request);
    notify(projectId);
    return request;
}
