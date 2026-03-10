/**
 * Live Stream Toolbar
 * Manages the live stream toolbar UI, including Go Live, audio/video toggles,
 * end stream, copy link, viewer count, video strip, and stream callbacks.
 * Extracted from presentation.js — Phase 2 modularization.
 */

import { state, setState } from '../../state.js';
import * as api from '../../api.js';
import { log } from '../../utils/debug.js';
import { showToast } from '../../ui.js';
import { showUserModal } from '../../auth.js';
import * as liveStream from '../liveStream.js';
import * as voiceCommands from '../voiceCommands.js';
import * as voiceCommandsUI from './voiceCommandsUI.js';
import { updateUCPVideoArea, updateUCPLiveBadge, populateFocusSelect, updateFocusBarUI } from '../unifiedChatPanel.js';

// DOM element references injected via init()
let liveStreamToolbar = null;
let liveGoLiveBtn = null;
let liveStreamControls = null;
let liveToggleAudioBtn = null;
let liveToggleVideoBtn = null;
let liveEndStreamBtn = null;
let liveCopyLinkBtn = null;
let liveViewerCountEl = null;
let liveAudioIcon = null;
let liveVideoIcon = null;
let liveVideoStrip = null;
let liveLocalVideoEl = null;
let liveRemoteVideosEl = null;
let liveVideoStripToggle = null;
let liveStripViewerBar = null;
let liveStripStatusText = null;
let liveStripViewerCountNum = null;
let presentationLiveBadge = null;
let hostReactionOverlay = null;

// Dependencies injected via init()
let _getChannel = null;

/**
 * Initialize the live stream toolbar module.
 * @param {Object} deps
 * @param {Object} deps.elements - DOM element references
 * @param {Function} deps.getChannel - Returns the Pusher channel for broadcasting stream events
 */
export function init(deps) {
    liveStreamToolbar = deps.elements.liveStreamToolbar;
    liveGoLiveBtn = deps.elements.liveGoLiveBtn;
    liveStreamControls = deps.elements.liveStreamControls;
    liveToggleAudioBtn = deps.elements.liveToggleAudioBtn;
    liveToggleVideoBtn = deps.elements.liveToggleVideoBtn;
    liveEndStreamBtn = deps.elements.liveEndStreamBtn;
    liveCopyLinkBtn = deps.elements.liveCopyLinkBtn;
    liveViewerCountEl = deps.elements.liveViewerCountEl;
    liveAudioIcon = deps.elements.liveAudioIcon;
    liveVideoIcon = deps.elements.liveVideoIcon;
    liveVideoStrip = deps.elements.liveVideoStrip;
    liveLocalVideoEl = deps.elements.liveLocalVideoEl;
    liveRemoteVideosEl = deps.elements.liveRemoteVideosEl;
    liveVideoStripToggle = deps.elements.liveVideoStripToggle;
    liveStripViewerBar = deps.elements.liveStripViewerBar;
    liveStripStatusText = deps.elements.liveStripStatusText;
    liveStripViewerCountNum = deps.elements.liveStripViewerCountNum;
    presentationLiveBadge = deps.elements.presentationLiveBadge;
    hostReactionOverlay = deps.elements.hostReactionOverlay;

    _getChannel = deps.getChannel;
}

/**
 * Cleanup module state.
 */
export function cleanup() {
    cleanupLiveStreamToolbar();

    liveStreamToolbar = null;
    liveGoLiveBtn = null;
    liveStreamControls = null;
    liveToggleAudioBtn = null;
    liveToggleVideoBtn = null;
    liveEndStreamBtn = null;
    liveCopyLinkBtn = null;
    liveViewerCountEl = null;
    liveAudioIcon = null;
    liveVideoIcon = null;
    liveVideoStrip = null;
    liveLocalVideoEl = null;
    liveRemoteVideosEl = null;
    liveVideoStripToggle = null;
    liveStripViewerBar = null;
    liveStripStatusText = null;
    liveStripViewerCountNum = null;
    presentationLiveBadge = null;
    hostReactionOverlay = null;

    _getChannel = null;
}

export function initializeLiveStreamToolbar() {
    if (!liveStreamToolbar) return;

    // Register liveStream callbacks
    liveStream.registerCallbacks({
        onStreamStarted: handleStreamStarted,
        onStreamEnded: handleStreamEnded,
        onRemoteUserJoined: handleRemoteUserJoined,
        onRemoteUserLeft: handleRemoteUserLeft,
        onViewerCountChanged: handleViewerCountChanged,
        onError: handleStreamError,
    });

    // Show toolbar (visible to all users; Go Live button checks auth)
    liveStreamToolbar.style.display = '';

    // Go Live button
    if (liveGoLiveBtn) {
        liveGoLiveBtn.addEventListener('click', handleGoLiveClick);
    }

    // Stream control buttons
    if (liveToggleAudioBtn) {
        liveToggleAudioBtn.addEventListener('click', handleToggleAudio);
    }
    if (liveToggleVideoBtn) {
        liveToggleVideoBtn.addEventListener('click', handleToggleVideo);
    }
    if (liveEndStreamBtn) {
        liveEndStreamBtn.addEventListener('click', handleEndStream);
    }
    if (liveCopyLinkBtn) {
        liveCopyLinkBtn.addEventListener('click', handleCopyStreamLink);
    }

    // Video strip collapse toggle
    if (liveVideoStripToggle) {
        liveVideoStripToggle.addEventListener('click', () => {
            if (liveVideoStrip) {
                liveVideoStrip.classList.toggle('collapsed');
            }
        });
    }

    // v3.8 Phase 4: Transcription toggle button (delegated to voiceCommandsUI module)
    const liveTranscBtnEl = document.getElementById('live-toggle-transcription');
    if (liveTranscBtnEl) {
        liveTranscBtnEl.addEventListener('click', voiceCommandsUI.handleToggleTranscription);
        // Show button only if browser supports speech recognition
        if (voiceCommands.isSpeechRecognitionSupported()) {
            liveTranscBtnEl.style.display = '';
        }
    }

    // v3.8 Phase 4: Voice command undo button (delegated to voiceCommandsUI module)
    const voiceCmdUndoBtnEl = document.getElementById('voice-command-undo-btn');
    if (voiceCmdUndoBtnEl) {
        voiceCmdUndoBtnEl.addEventListener('click', voiceCommandsUI.handleVoiceCommandUndo);
    }

    // v3.8 Phase 4: Register voice command callbacks
    voiceCommands.registerVoiceCallbacks({
        onTranscript: voiceCommandsUI.handleVoiceTranscript,
        onCommand: voiceCommandsUI.handleVoiceCommandExecution,
        onStatus: voiceCommandsUI.handleVoiceStatus,
    });

    // Update toolbar state to match current stream state
    updateLiveStreamToolbarUI();

    log('Presentation', 'Live stream toolbar initialized');
}

/**
 * Update the toolbar UI to reflect the current stream state.
 */
export function updateLiveStreamToolbarUI() {
    if (!liveStreamToolbar) return;

    const isLive = state.stream.isActive;
    const isHost = state.stream.isHost;

    // Toggle between Go Live button and stream controls
    if (liveGoLiveBtn) {
        liveGoLiveBtn.style.display = isLive ? 'none' : '';
    }
    if (liveStreamControls) {
        liveStreamControls.style.display = isLive ? '' : 'none';
    }

    // Update audio/video toggle icons
    if (liveAudioIcon) {
        const audioEnabled = state.stream.localAudioEnabled;
        liveAudioIcon.textContent = audioEnabled ? '\u{1F3A4}' : '\u{1F507}';
        if (liveToggleAudioBtn) {
            liveToggleAudioBtn.classList.toggle('muted', !audioEnabled);
            liveToggleAudioBtn.title = audioEnabled ? 'Mute microphone' : 'Unmute microphone';
        }
    }
    if (liveVideoIcon) {
        const videoEnabled = state.stream.localVideoEnabled;
        liveVideoIcon.textContent = videoEnabled ? '\u{1F4F7}' : '\u{1F6AB}';
        if (liveToggleVideoBtn) {
            liveToggleVideoBtn.classList.toggle('muted', !videoEnabled);
            liveToggleVideoBtn.title = videoEnabled ? 'Turn off camera' : 'Turn on camera';
        }
    }

    // Show/hide controls based on host vs viewer
    if (!isHost && isLive) {
        // Viewers can't toggle audio/video or end stream
        if (liveToggleAudioBtn) liveToggleAudioBtn.style.display = 'none';
        if (liveToggleVideoBtn) liveToggleVideoBtn.style.display = 'none';
        if (liveEndStreamBtn) liveEndStreamBtn.style.display = 'none';
        if (liveCopyLinkBtn) liveCopyLinkBtn.style.display = 'none';
    } else if (isHost && isLive) {
        if (liveToggleAudioBtn) liveToggleAudioBtn.style.display = '';
        if (liveToggleVideoBtn) liveToggleVideoBtn.style.display = '';
        if (liveEndStreamBtn) liveEndStreamBtn.style.display = '';
        // v3.8 Phase 5: Show copy link button for host during active stream
        if (liveCopyLinkBtn) liveCopyLinkBtn.style.display = '';
    }

    // v3.8 Phase 4: Show transcription button when stream is active (host only)
    const liveTranscBtnUI = document.getElementById('live-toggle-transcription');
    if (liveTranscBtnUI && voiceCommands.isSpeechRecognitionSupported()) {
        liveTranscBtnUI.style.display = (isLive && isHost) ? '' : 'none';
    }

    // Update viewer count
    if (liveViewerCountEl) {
        liveViewerCountEl.textContent = state.stream.viewerCount || 0;
    }

    // Show/hide video strip
    if (liveVideoStrip) {
        const joinedFromViewer = state.stream.joinedFromViewer;
        if (isLive || joinedFromViewer) {
            liveVideoStrip.style.display = '';
            // Toggle viewer-mode class for styling
            if (joinedFromViewer && !isHost) {
                liveVideoStrip.classList.add('viewer-mode');
                if (liveStripViewerBar) liveStripViewerBar.style.display = '';
            } else {
                liveVideoStrip.classList.remove('viewer-mode');
                if (liveStripViewerBar) liveStripViewerBar.style.display = 'none';
            }
        } else {
            liveVideoStrip.style.display = 'none';
        }
    }

    // Update viewer bar count
    if (liveStripViewerCountNum) {
        liveStripViewerCountNum.textContent = state.stream.viewerCount || 0;
    }
}

/**
 * v3.8 Phase 2: Update the LIVE badge on the presentation header title.
 * Also updates the UCP live badge and video area.
 */
export function updatePresentationLiveBadge() {
    const isLive = state.stream.isActive;

    // Update presentation header badge
    if (presentationLiveBadge) {
        presentationLiveBadge.style.display = isLive ? '' : 'none';
    }

    // Update UCP live badge
    updateUCPLiveBadge();

    // Update UCP video area visibility
    updateUCPVideoArea();
}

/**
 * Handle "Go Live" button click.
 */
async function handleGoLiveClick() {
    // Check authentication
    if (!state.session.user?.isAuthenticated) {
        showToast('Sign in to go live');
        showUserModal();
        return;
    }

    // Check for session/plan context
    if (!state.session.id) {
        showToast('A plan is required to start a live stream');
        return;
    }

    // Disable button during initialization
    if (liveGoLiveBtn) {
        liveGoLiveBtn.disabled = true;
        const label = liveGoLiveBtn.querySelector('.live-btn-label');
        if (label) label.textContent = 'Starting...';
    }

    try {
        const channelName = `plan-${state.session.id}`;
        const success = await liveStream.startStream({
            channelName,
            videoContainer: liveLocalVideoEl,
        });

        if (!success) {
            showToast('Failed to start stream. Please check camera/mic permissions.');
        }
    } catch (error) {
        console.error('[Presentation] Go Live error:', error);
        showToast('Error starting stream: ' + (error.message || 'Unknown error'));
    } finally {
        // Re-enable button
        if (liveGoLiveBtn) {
            liveGoLiveBtn.disabled = false;
            const label = liveGoLiveBtn.querySelector('.live-btn-label');
            if (label) label.textContent = 'Go Live';
        }
    }
}

async function handleToggleAudio() {
    const enabled = await liveStream.toggleAudio();
    updateLiveStreamToolbarUI();
}

async function handleToggleVideo() {
    const enabled = await liveStream.toggleVideo();
    updateLiveStreamToolbarUI();
}

async function handleEndStream() {
    // v3.8 Phase 4: Stop transcription when stream ends
    if (voiceCommandsUI.isActive()) {
        voiceCommandsUI.stopTranscription();
    }
    await liveStream.endStream();
    // UI update happens via callback
}

// ===== v3.8 Phase 5: Shareable Stream Link =====

async function handleCopyStreamLink() {
    const link = state.stream.shareableLink;
    if (!link) {
        showToast('Stream link not available');
        return;
    }

    try {
        await navigator.clipboard.writeText(link);
        showToast('Stream link copied to clipboard');
        // Brief visual feedback on button
        if (liveCopyLinkBtn) {
            const icon = liveCopyLinkBtn.querySelector('.live-btn-icon');
            if (icon) {
                const original = icon.textContent;
                icon.textContent = '\u2705'; // checkmark
                setTimeout(() => { icon.textContent = original; }, 1500);
            }
        }
    } catch (err) {
        // Fallback for older browsers
        const input = document.createElement('input');
        input.value = link;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('Stream link copied');
    }
}

/**
 * v3.8 Phase 6: Spawn a floating emoji reaction over the host's video area.
 * Used when viewers send reactions.
 */
export function spawnHostReactionOverlay(emoji) {
    if (!hostReactionOverlay) return;
    // Show overlay if hidden
    if (hostReactionOverlay.style.display === 'none') {
        hostReactionOverlay.style.display = '';
    }

    const el = document.createElement('span');
    el.className = 'host-floating-emoji';
    el.textContent = emoji;
    el.style.left = `${60 + Math.random() * 35}%`;
    hostReactionOverlay.appendChild(el);

    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => { if (el.parentNode) el.remove(); }, 3000);
}

function handleStreamStarted(channelName, uid) {
    log('Presentation', `Stream started: channel=${channelName}, uid=${uid}`);
    updateLiveStreamToolbarUI();
    updatePresentationLiveBadge();

    // v3.8 Phase 6: Show reaction overlay
    if (hostReactionOverlay) hostReactionOverlay.style.display = '';

    // v3.8 Phase 3: Show focus bar and populate items
    populateFocusSelect();
    updateFocusBarUI();

    // Clear the placeholder in the local video container
    if (liveLocalVideoEl) {
        const placeholder = liveLocalVideoEl.querySelector('.live-video-placeholder');
        if (placeholder) placeholder.style.display = 'none';
    }

    // Broadcast stream status via Pusher if available
    const presentationChatChannel = _getChannel();
    if (presentationChatChannel) {
        presentationChatChannel.trigger('client-stream-started', {
            channelName,
            hostUserId: state.session.user?.id,
            hostName: state.session.user?.name || 'Someone',
        });
    }

    // v3.8 Phase 2: Persist stream metadata to Airtable (non-blocking)
    const streamStartedIso = new Date().toISOString();
    if (state.session.id) {
        api.updateStreamMetadata(state.session.id, {
            StreamActive: true,
            StreamHostUserId: state.session.user?.id,
            StreamStartedAt: streamStartedIso,
            AgoraChannelName: channelName,
        }).catch(err => console.warn('[Presentation] Stream metadata update failed:', err.message));
    }
    // Store ISO timestamp in stream state so session save can preserve _streamMeta
    setState({ stream: { startedAtIso: streamStartedIso } });

    // v3.8 Phase 5: Generate shareable viewer link
    if (state.session.id) {
        const shareableLink = `${window.location.origin}/watch/${encodeURIComponent(state.session.id)}`;
        setState({ stream: { shareableLink } });
        log('Presentation', `Shareable link: ${shareableLink}`);
    }

    showToast('You are now live!');
}

function handleStreamEnded() {
    log('Presentation', 'Stream ended');
    updateLiveStreamToolbarUI();
    updatePresentationLiveBadge();
    updateFocusBarUI(); // v3.8 Phase 3: Hide focus bar

    // v3.8 Phase 6: Hide reaction overlay
    if (hostReactionOverlay) {
        hostReactionOverlay.style.display = 'none';
        hostReactionOverlay.innerHTML = '';
    }

    // v3.8 Phase 4: Stop transcription when stream ends
    if (voiceCommandsUI.isActive()) {
        voiceCommandsUI.stopTranscription();
    }

    // Clear video containers
    if (liveLocalVideoEl) {
        liveLocalVideoEl.innerHTML = '<div class="live-video-placeholder"><span>\u{1F4F9}</span><span>Camera off</span></div>';
    }
    if (liveRemoteVideosEl) {
        liveRemoteVideosEl.innerHTML = '';
    }

    // Broadcast stream ended via Pusher
    const presentationChatChannel = _getChannel();
    if (presentationChatChannel) {
        presentationChatChannel.trigger('client-stream-ended', {
            hostUserId: state.session.user?.id,
        });
    }

    // v3.8 Phase 2: Clear stream metadata in Airtable (non-blocking)
    if (state.session.id) {
        api.clearStreamMetadata(state.session.id)
            .catch(err => console.warn('[Presentation] Stream metadata clear failed:', err.message));
    }

    showToast('Stream ended');
}

function handleRemoteUserJoined(uid, mediaType, totalRemote) {
    log('Presentation', `Remote user ${uid} joined (${mediaType}), total: ${totalRemote}`);

    if (mediaType === 'video' && liveRemoteVideosEl) {
        // Create a video cell for the remote user if it doesn't exist
        let cell = liveRemoteVideosEl.querySelector(`[data-remote-uid="${uid}"]`);
        if (!cell) {
            cell = document.createElement('div');
            cell.className = 'live-video-cell';
            cell.setAttribute('data-remote-uid', uid);
            liveRemoteVideosEl.appendChild(cell);
        }
        liveStream.playRemoteVideo(uid, cell);
    }

    updateLiveStreamToolbarUI();
}

function handleRemoteUserLeft(uid, totalRemote) {
    log('Presentation', `Remote user ${uid} left, total: ${totalRemote}`);

    if (liveRemoteVideosEl) {
        const cell = liveRemoteVideosEl.querySelector(`[data-remote-uid="${uid}"]`);
        if (cell) cell.remove();
    }

    updateLiveStreamToolbarUI();
}

function handleViewerCountChanged(count) {
    if (liveViewerCountEl) {
        liveViewerCountEl.textContent = count;
    }
    // Also update the viewer bar count in the stream strip
    if (liveStripViewerCountNum) {
        liveStripViewerCountNum.textContent = count;
    }
}

function handleStreamError(errorType, message) {
    console.error(`[Presentation] Stream error (${errorType}):`, message);
    showToast(message || 'Stream error occurred');
}

/**
 * Cleanup live stream resources when leaving presentation view.
 */
export function cleanupLiveStreamToolbar() {
    if (liveGoLiveBtn) {
        liveGoLiveBtn.removeEventListener('click', handleGoLiveClick);
    }
    if (liveToggleAudioBtn) {
        liveToggleAudioBtn.removeEventListener('click', handleToggleAudio);
    }
    if (liveToggleVideoBtn) {
        liveToggleVideoBtn.removeEventListener('click', handleToggleVideo);
    }
    if (liveEndStreamBtn) {
        liveEndStreamBtn.removeEventListener('click', handleEndStream);
    }
    if (liveCopyLinkBtn) {
        liveCopyLinkBtn.removeEventListener('click', handleCopyStreamLink);
    }

    // End any active stream
    if (state.stream.isActive) {
        liveStream.endStream();
    }
}
