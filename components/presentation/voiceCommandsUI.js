/**
 * Voice Commands UI
 * Voice command toast, transcription toggling, and command execution UI.
 * Wraps the existing voiceCommands.js module with presentation-specific UI.
 * Extracted from presentation.js — Phase 1 modularization.
 */

import * as voiceCommands from '../voiceCommands.js';
import { state } from '../../state.js';
import * as api from '../../api.js';
import { getCurrentUser } from '../../chat.js';
import { log } from '../../utils/debug.js';
import { showToast } from '../../ui.js';

// DOM element caches
let liveTranscriptionBtn = null;
let liveCaptionsBar = null;
let liveCaptionsText = null;
let liveCaptionsStatusText = null;
let liveCaptionsStatus = null;
let voiceCommandToast = null;
let voiceCommandToastTitle = null;
let voiceCommandToastDesc = null;
let voiceCommandToastCountdown = null;
let voiceCommandToastProgress = null;
let voiceCommandUndoBtn = null;

// Module state
let isTranscriptionActive = false;
let voiceCmdCountdownInterval = null;
let _lastCaptionRelayTime = 0;

/**
 * Initialize the voice commands UI module.
 * Caches DOM elements. Call after ensureDOMElements.
 * @param {Object} deps
 * @param {Object} deps.elements - Pre-cached DOM elements
 */
export function init({ elements }) {
    if (elements) {
        liveTranscriptionBtn = elements.liveTranscriptionBtn;
        liveCaptionsBar = elements.liveCaptionsBar;
        liveCaptionsText = elements.liveCaptionsText;
        liveCaptionsStatusText = elements.liveCaptionsStatusText;
        liveCaptionsStatus = elements.liveCaptionsStatus;
        voiceCommandToast = elements.voiceCommandToast;
        voiceCommandToastTitle = elements.voiceCommandToastTitle;
        voiceCommandToastDesc = elements.voiceCommandToastDesc;
        voiceCommandToastCountdown = elements.voiceCommandToastCountdown;
        voiceCommandToastProgress = elements.voiceCommandToastProgress;
        voiceCommandUndoBtn = elements.voiceCommandUndoBtn;
    }
}

/**
 * Whether transcription is currently active.
 * @returns {boolean}
 */
export function isActive() {
    return isTranscriptionActive;
}

/**
 * Toggle transcription on/off.
 */
export function handleToggleTranscription() {
    if (isTranscriptionActive) {
        stopTranscription();
    } else {
        startTranscription();
    }
}

/**
 * Start transcription / voice commands.
 */
export function startTranscription() {
    if (!state.stream?.isActive) {
        showToast('Start a stream before enabling voice commands');
        return;
    }

    const started = voiceCommands.startListening();
    if (started) {
        isTranscriptionActive = true;
        if (liveTranscriptionBtn) {
            liveTranscriptionBtn.classList.add('transcription-active');
            liveTranscriptionBtn.title = 'Ryry is listening (click to stop)';
        }
        if (liveCaptionsBar) {
            liveCaptionsBar.style.display = '';
        }
        log('Presentation', 'Transcription started');
    }
}

/**
 * Stop transcription / voice commands.
 */
export function stopTranscription() {
    voiceCommands.stopListening();
    isTranscriptionActive = false;
    if (liveTranscriptionBtn) {
        liveTranscriptionBtn.classList.remove('transcription-active');
        liveTranscriptionBtn.title = 'Toggle Ryry voice commands';
    }
    if (liveCaptionsBar) {
        liveCaptionsBar.style.display = 'none';
    }
    hideVoiceCommandToast();
    log('Presentation', 'Transcription stopped');
}

/**
 * Handle live transcript updates — display as captions.
 * Also relays final transcripts to viewers via server.
 * @param {{ text: string, isFinal: boolean }} param
 */
export function handleVoiceTranscript({ text, isFinal }) {
    if (!liveCaptionsText) return;
    liveCaptionsText.textContent = text;
    liveCaptionsText.className = isFinal ? 'live-captions-text final' : 'live-captions-text';
    if (isFinal) {
        setTimeout(() => {
            if (liveCaptionsText.textContent === text) {
                liveCaptionsText.textContent = '';
            }
        }, 4000);
    }

    // Relay final transcripts to viewer public channel (throttled)
    if (isFinal && state.stream?.isActive && state.stream?.isHost && state.session?.id) {
        const now = Date.now();
        if (now - _lastCaptionRelayTime > 500) {
            _lastCaptionRelayTime = now;
            fetch('/api/viewer-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: state.session.id,
                    senderName: 'host',
                    content: text,
                    type: 'caption',
                    isFinal: true,
                }),
            }).catch(() => {}); // Non-blocking
        }
    }
}

/**
 * Handle voice status changes — update captions bar status indicator.
 * @param {{ status: string, message: string, data: Object }} param
 */
export function handleVoiceStatus({ status, message, data }) {
    console.warn('[VoiceCmd UI] Status:', status, message);

    if (liveCaptionsStatusText) {
        liveCaptionsStatusText.textContent = message;
    }
    if (liveCaptionsStatus) {
        liveCaptionsStatus.classList.toggle('wake-active', status === 'wake');
    }

    if (status === 'confirm' && data) {
        showVoiceCommandToast(data);
    } else if (status === 'executed') {
        hideVoiceCommandToast();
        showToast(message);
    } else if (status === 'cancelled') {
        hideVoiceCommandToast();
        showToast(message);
    } else if (status === 'error' || status === 'unsupported') {
        showToast(message);
    }
}

/**
 * Show the voice command confirmation toast with countdown.
 * @param {Object} command
 */
export function showVoiceCommandToast(command) {
    if (!voiceCommandToast) return;

    if (voiceCommandToastTitle) {
        voiceCommandToastTitle.textContent = `Ryry: "${command.keyword}"`;
    }
    if (voiceCommandToastDesc) {
        voiceCommandToastDesc.textContent = command.payload
            ? `"${command.payload}" \u2014 ${command.description}`
            : command.description;
    }

    voiceCommandToast.style.display = '';

    let secondsLeft = 5;
    if (voiceCommandToastCountdown) {
        voiceCommandToastCountdown.textContent = secondsLeft;
    }
    if (voiceCommandToastProgress) {
        voiceCommandToastProgress.style.width = '100%';
        voiceCommandToastProgress.style.transition = 'none';
        voiceCommandToastProgress.offsetHeight;
        voiceCommandToastProgress.style.transition = `width ${secondsLeft}s linear`;
        voiceCommandToastProgress.style.width = '0%';
    }

    clearInterval(voiceCmdCountdownInterval);
    voiceCmdCountdownInterval = setInterval(() => {
        secondsLeft--;
        if (voiceCommandToastCountdown) {
            voiceCommandToastCountdown.textContent = Math.max(0, secondsLeft);
        }
        if (secondsLeft <= 0) {
            clearInterval(voiceCmdCountdownInterval);
            hideVoiceCommandToast();
        }
    }, 1000);
}

/**
 * Hide the voice command confirmation toast.
 */
export function hideVoiceCommandToast() {
    if (voiceCommandToast) {
        voiceCommandToast.style.display = 'none';
    }
    clearInterval(voiceCmdCountdownInterval);
}

/**
 * Handle undo button click on voice command toast.
 */
export function handleVoiceCommandUndo() {
    voiceCommands.cancelPendingCommand();
    hideVoiceCommandToast();
    showToast('Voice command cancelled');
}

/**
 * Execute a confirmed voice command.
 * @param {{ type: string, payload: string, rawText: string, description: string }} param
 */
export async function handleVoiceCommandExecution({ type, payload, rawText, description }) {
    const currentUser = getCurrentUser();
    const sessionId = state.session?.id;

    console.warn('[VoiceCmd] Executing command:', { type, payload, rawText });

    switch (type) {
        case 'LOG_TASK': {
            const taskName = payload || 'Voice task';
            try {
                const result = await api.createTask(sessionId, {
                    Name: taskName,
                    Description: `Created via Ryry voice command: "${rawText}"`,
                });
                if (result) {
                    showToast(`Task created: ${taskName}`);
                    log('Presentation', `Voice command created task: ${taskName}`);
                } else {
                    showToast('Failed to create task');
                }
            } catch (err) {
                console.error('[VoiceCmd] Failed to create task:', err);
                showToast('Error creating task');
            }
            break;
        }

        case 'SET_PRIORITY': {
            const priority = payload || 'high';
            const normalizedPriority = normalizePriority(priority);
            try {
                const tasks = state.tasks?.all;
                if (tasks && tasks.size > 0) {
                    let latestTask = null;
                    let latestTime = 0;
                    tasks.forEach((task) => {
                        const createdTime = new Date(task.createdTime || 0).getTime();
                        if (createdTime > latestTime) {
                            latestTime = createdTime;
                            latestTask = task;
                        }
                    });

                    if (latestTask) {
                        await api.updateTask(latestTask.id, { Priority: normalizedPriority });
                        showToast(`Priority set to ${normalizedPriority} on: ${latestTask.fields?.Name || 'task'}`);
                    } else {
                        showToast('No tasks found to set priority on');
                    }
                } else {
                    showToast('No tasks found to set priority on');
                }
            } catch (err) {
                console.error('[VoiceCmd] Failed to set priority:', err);
                showToast('Error setting priority');
            }
            break;
        }

        case 'PROJECT_UPDATE': {
            const message = payload || rawText;
            try {
                if (sessionId && currentUser) {
                    await api.postChatMessage(
                        sessionId,
                        currentUser.id,
                        currentUser.name,
                        `[PROJECT UPDATE] ${message}`,
                        null
                    );
                    showToast('Project update posted');
                    log('Presentation', `Voice command posted project update: ${message}`);
                } else {
                    showToast('Cannot post update: no active session');
                }
            } catch (err) {
                console.error('[VoiceCmd] Failed to post project update:', err);
                showToast('Error posting update');
            }
            break;
        }

        default:
            console.warn('[VoiceCmd] Unknown command type:', type);
            showToast(`Unknown command: ${type}`);
    }
}

/**
 * Normalize priority text from voice input to a standard value.
 * @param {string} text
 * @returns {string}
 */
function normalizePriority(text) {
    const lower = text.toLowerCase().trim();
    if (lower.includes('high') || lower.includes('urgent') || lower.includes('critical')) return 'high';
    if (lower.includes('medium') || lower.includes('normal') || lower.includes('moderate')) return 'medium';
    if (lower.includes('low') || lower.includes('minor')) return 'low';
    return 'medium';
}

export function cleanup() {
    stopTranscription();
    clearInterval(voiceCmdCountdownInterval);
    liveTranscriptionBtn = null;
    liveCaptionsBar = null;
    liveCaptionsText = null;
    liveCaptionsStatusText = null;
    liveCaptionsStatus = null;
    voiceCommandToast = null;
    voiceCommandToastTitle = null;
    voiceCommandToastDesc = null;
    voiceCommandToastCountdown = null;
    voiceCommandToastProgress = null;
    voiceCommandUndoBtn = null;
    isTranscriptionActive = false;
    _lastCaptionRelayTime = 0;
}
