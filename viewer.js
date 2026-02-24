// FILE: viewer.js
// v3.8 Phase 5+6: Standalone viewer page client script
// Phase 5: Stream connection for unauthenticated viewers via shareable link
// Phase 6: Real-time chat, emoji reactions, captions, focus sync via Pusher

const AGORA_SDK_URL = 'https://download.agora.io/sdk/release/AgoraRTC_N-4.22.0.js';
const PUSHER_SDK_URL = 'https://js.pusher.com/8.2.0/pusher.min.js';
const PUSHER_KEY = '236f480714e5001590b5';
const PUSHER_CLUSTER = 'us3';

// ─── DOM References ─────────────────────────────────────────────────────────

const planNameEl = document.getElementById('viewer-plan-name');
const headerRight = document.getElementById('viewer-header-right');
const viewerCountEl = document.getElementById('viewer-count');
const videoArea = document.getElementById('viewer-video-area');
const videoContainer = document.getElementById('viewer-video-container');
const remoteGrid = document.getElementById('viewer-remote-grid');
const statusLoading = document.getElementById('viewer-status-loading');
const statusEnded = document.getElementById('viewer-status-ended');
const statusError = document.getElementById('viewer-status-error');
const errorMessage = document.getElementById('viewer-error-message');

// Phase 6 DOM
const reactionOverlay = document.getElementById('viewer-reaction-overlay');
const reactionBar = document.getElementById('viewer-reaction-bar');
const chatOverlay = document.getElementById('viewer-chat-overlay');
const chatMessages = document.getElementById('viewer-chat-messages');
const chatForm = document.getElementById('viewer-chat-form');
const chatInput = document.getElementById('viewer-chat-input');
const captionsBar = document.getElementById('viewer-captions-bar');
const focusIndicator = document.getElementById('viewer-focus-indicator');

// ─── State ──────────────────────────────────────────────────────────────────

let agoraClient = null;
let remoteUsers = new Map();
let pollInterval = null;
let pusherInstance = null;
let publicChannel = null;
let currentSessionId = null;
let viewerName = sessionStorage.getItem('viewerName') || '';
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS = [2000, 5000, 10000];

// ─── Initialization ─────────────────────────────────────────────────────────

async function init() {
    const sessionId = getSessionIdFromURL();
    currentSessionId = sessionId;

    if (!sessionId) {
        showError('Invalid stream link. No session ID found in the URL.');
        return;
    }

    try {
        // 1. Check stream status via API
        const streamInfo = await fetchStreamInfo(sessionId);
        console.log('[Viewer] Stream info response:', JSON.stringify(streamInfo));

        if (!streamInfo.streamActive) {
            console.log('[Viewer] Stream not active — showing ended state. streamActive:', streamInfo.streamActive, 'channelName:', streamInfo.channelName);
            showEnded(streamInfo.planName);
            return;
        }

        // 2. Update UI with stream info
        if (planNameEl) planNameEl.textContent = streamInfo.planName || 'Live Stream';
        if (headerRight) headerRight.style.display = '';

        // 3. Load Agora SDK and join as viewer
        await loadAgoraSDK();
        await joinStream(streamInfo.channelName);

        // 4. Start polling for stream status (detect when stream ends)
        startStatusPolling(sessionId);

        // 5. Phase 6: Initialize Pusher for chat, reactions, and state sync
        initPusher(sessionId);

        // 6. Phase 6: Show interactive elements
        showInteractiveUI();

        // 7. Phase 6: Set up reaction and chat handlers
        initReactionBar();
        initChatForm();

    } catch (err) {
        console.error('[Viewer] Init error:', err);
        showError(err.message || 'Failed to connect to stream.');
    }
}

// ─── URL Parsing ────────────────────────────────────────────────────────────

function getSessionIdFromURL() {
    // URL pattern: /watch/{sessionId}
    const path = window.location.pathname;
    const match = path.match(/\/watch\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

// ─── API: Get Stream Info ───────────────────────────────────────────────────

async function fetchStreamInfo(sessionId) {
    const response = await fetch(`/api/get-stream-info?sessionId=${encodeURIComponent(sessionId)}`);

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('This stream link is not valid. The plan may have been deleted.');
        }
        throw new Error('Failed to check stream status. Please try again.');
    }

    return await response.json();
}

// ─── Agora SDK Loading ──────────────────────────────────────────────────────

function loadAgoraSDK() {
    if (window.AgoraRTC) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = AGORA_SDK_URL;
        script.async = true;
        script.onload = () => {
            if (window.AgoraRTC) {
                window.AgoraRTC.setLogLevel(3); // ERROR level — suppress SDK autoplay warnings (handled by our overlay)

                // Handle autoplay policy — browsers block audio/video autoplay
                // without user interaction. Show a "click to unmute" overlay.
                window.AgoraRTC.onAutoplayFailed = () => {
                    console.log('[Viewer] Autoplay blocked — showing click-to-play overlay');
                    showAutoplayOverlay();
                };

                resolve();
            } else {
                reject(new Error('Agora SDK failed to initialize'));
            }
        };
        script.onerror = () => reject(new Error('Failed to load video stream SDK'));
        document.head.appendChild(script);
    });
}

// ─── Autoplay Blocked Overlay ────────────────────────────────────────────────

let autoplayOverlayShown = false;

function showAutoplayOverlay() {
    if (autoplayOverlayShown) return;
    autoplayOverlayShown = true;

    const overlay = document.createElement('div');
    overlay.id = 'viewer-autoplay-overlay';
    overlay.className = 'viewer-autoplay-overlay';
    overlay.innerHTML = `
        <div class="viewer-autoplay-content">
            <div class="viewer-autoplay-icon">&#x1F50A;</div>
            <div class="viewer-autoplay-text">Tap to unmute audio</div>
        </div>
    `;

    overlay.addEventListener('click', () => {
        console.log('[Viewer] User clicked autoplay overlay — resuming media');
        // Resume all remote audio and video tracks after user interaction
        let isFirst = true;
        for (const [uid, tracks] of remoteUsers) {
            if (tracks.audioTrack) {
                try {
                    tracks.audioTrack.play();
                    console.log(`[Viewer] Resumed audio for user ${uid}`);
                } catch (e) {
                    console.warn(`[Viewer] Failed to resume audio for user ${uid}:`, e.message);
                }
            }
            // Re-play video in case browser also blocked muted video autoplay
            if (tracks.videoTrack) {
                try {
                    if (isFirst) {
                        tracks.videoTrack.play(videoContainer);
                    }
                    // For additional users, renderRemoteGrid() handles playback
                    console.log(`[Viewer] Resumed video for user ${uid}`);
                } catch (e) {
                    console.warn(`[Viewer] Failed to resume video for user ${uid}:`, e.message);
                }
            }
            isFirst = false;
        }
        overlay.remove();
        autoplayOverlayShown = false;
    });

    if (videoArea) {
        videoArea.appendChild(overlay);
    }
}

// ─── Agora: Join as Viewer ──────────────────────────────────────────────────

async function joinStream(channelName) {
    if (!channelName) throw new Error('No channel name provided for stream');

    // Fetch audience token
    const tokenResponse = await fetch('/.netlify/functions/agora-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            channelName,
            uid: 0,
            role: 'audience',
            userId: null,
        }),
    });

    if (!tokenResponse.ok) {
        throw new Error('Failed to get stream access token');
    }

    const tokenData = await tokenResponse.json();
    const appId = tokenData.appId;
    const token = tokenData.token || null;

    if (!appId) {
        throw new Error('Stream service not configured');
    }

    // Create Agora client
    agoraClient = window.AgoraRTC.createClient({ codec: 'vp8', mode: 'live' });

    // Register event handlers
    agoraClient.on('user-published', handleUserPublished);
    agoraClient.on('user-unpublished', handleUserUnpublished);
    agoraClient.on('user-joined', handleUserJoined);
    agoraClient.on('user-left', handleUserLeft);
    agoraClient.on('connection-state-change', handleConnectionStateChange);

    // Set audience role
    await agoraClient.setClientRole('audience');

    // Join channel
    await agoraClient.join(appId, channelName, token, null);

    // Switch UI to video mode
    showVideo();
    reconnectAttempts = 0;
    console.log(`[Viewer] Joined channel "${channelName}" as audience`);
}

// ─── Agora Event Handlers ───────────────────────────────────────────────────

async function handleUserPublished(user, mediaType) {
    console.log(`[Viewer] User ${user.uid} published ${mediaType}`);
    await agoraClient.subscribe(user, mediaType);

    if (!remoteUsers.has(user.uid)) {
        remoteUsers.set(user.uid, { audioTrack: null, videoTrack: null });
    }
    const remote = remoteUsers.get(user.uid);

    if (mediaType === 'video') {
        remote.videoTrack = user.videoTrack;
        console.log(`[Viewer] Playing video for user ${user.uid}, remoteUsers count: ${remoteUsers.size}`);

        // First video user (host) goes in main container, others in grid
        if (remoteUsers.size === 1) {
            try {
                console.log(`[Viewer] Video container visible: ${videoContainer?.style.display !== 'none'}, dimensions: ${videoContainer?.offsetWidth}x${videoContainer?.offsetHeight}`);
                user.videoTrack.play(videoContainer);
                console.log(`[Viewer] Video play() called successfully for user ${user.uid}`);
            } catch (e) {
                console.error(`[Viewer] Video play error for user ${user.uid}:`, e);
            }
        } else {
            renderRemoteGrid();
        }
    }
    if (mediaType === 'audio') {
        remote.audioTrack = user.audioTrack;
        console.log(`[Viewer] Playing audio for user ${user.uid}`);
        // Agora SDK's RemoteAudioTrack.play() returns void (not a Promise).
        // Autoplay failures are handled by the AgoraRTC.onAutoplayFailed callback
        // which shows the click-to-unmute overlay.
        try {
            user.audioTrack.play();
        } catch (e) {
            console.log(`[Viewer] Audio play error for user ${user.uid}:`, e.message);
        }
    }

    updateViewerCount();
}

function handleUserUnpublished(user, mediaType) {
    const remote = remoteUsers.get(user.uid);
    if (remote) {
        if (mediaType === 'video') remote.videoTrack = null;
        if (mediaType === 'audio') remote.audioTrack = null;
    }
}

function handleUserJoined() {
    updateViewerCount();
}

function handleUserLeft(user) {
    remoteUsers.delete(user.uid);
    updateViewerCount();
    renderRemoteGrid();

    // If no more publishers, video area is empty
    if (remoteUsers.size === 0) {
        videoContainer.innerHTML = '';
    }
}

function handleConnectionStateChange(curState, prevState) {
    console.log(`[Viewer] Connection state: ${prevState} → ${curState}`);

    if (curState === 'RECONNECTING') {
        if (captionsBar) {
            captionsBar.style.display = '';
            captionsBar.textContent = 'Reconnecting to stream...';
        }
    } else if (curState === 'CONNECTED' && prevState === 'RECONNECTING') {
        reconnectAttempts = 0;
        if (captionsBar) {
            captionsBar.textContent = '';
            captionsBar.style.display = 'none';
        }
    } else if (curState === 'DISCONNECTED' && prevState !== 'DISCONNECTING') {
        console.warn('[Viewer] Disconnected from stream');
        attemptReconnection();
    }
}

// ─── Reconnection Logic ─────────────────────────────────────────────────────

async function attemptReconnection() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn('[Viewer] Max reconnection attempts reached');
        showError('Lost connection to the stream. Please reload the page to try again.');
        return;
    }

    const delay = RECONNECT_DELAYS[reconnectAttempts] || 10000;
    reconnectAttempts++;
    console.log(`[Viewer] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    if (captionsBar) {
        captionsBar.style.display = '';
        captionsBar.textContent = `Reconnecting... (attempt ${reconnectAttempts})`;
    }

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
        const info = await fetchStreamInfo(currentSessionId);
        if (!info.streamActive) {
            handleStreamEnd();
            return;
        }
        if (agoraClient) {
            await agoraClient.leave().catch(() => {});
        }
        await joinStream(info.channelName);
        if (captionsBar) {
            captionsBar.textContent = '';
            captionsBar.style.display = 'none';
        }
    } catch (err) {
        console.error('[Viewer] Reconnection failed:', err);
        attemptReconnection();
    }
}

// ─── Remote Videos Grid ─────────────────────────────────────────────────────

function renderRemoteGrid() {
    if (!remoteGrid) return;

    if (remoteUsers.size <= 1) {
        remoteGrid.classList.remove('has-videos');
        remoteGrid.innerHTML = '';
        return;
    }

    remoteGrid.classList.add('has-videos');
    remoteGrid.innerHTML = '';

    let idx = 0;
    for (const [uid, tracks] of remoteUsers) {
        idx++;
        if (idx === 1) continue;
        if (!tracks.videoTrack) continue;

        const cell = document.createElement('div');
        cell.className = 'viewer-remote-cell';
        cell.setAttribute('data-uid', uid);
        remoteGrid.appendChild(cell);
        tracks.videoTrack.play(cell);
    }
}

// ─── Viewer Count ───────────────────────────────────────────────────────────

function updateViewerCount() {
    if (!viewerCountEl) return;
    const count = remoteUsers.size;
    viewerCountEl.textContent = count > 0 ? `${count} streaming` : '';
}

// ─── Status Polling ─────────────────────────────────────────────────────────

function startStatusPolling(sessionId) {
    pollInterval = setInterval(async () => {
        try {
            const info = await fetchStreamInfo(sessionId);
            if (!info.streamActive) {
                stopStatusPolling();
                handleStreamEnd();
            }
        } catch {
            // Ignore transient errors in polling
        }
    }, 15000);
}

function stopStatusPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

function handleStreamEnd() {
    console.log('[Viewer] handleStreamEnd called — cleaning up Agora + Pusher');
    if (agoraClient) {
        agoraClient.leave().catch(() => {});
        agoraClient.removeAllListeners();
        agoraClient = null;
    }
    remoteUsers.clear();

    if (publicChannel) {
        publicChannel.unbind_all();
        publicChannel = null;
    }
    if (pusherInstance) {
        pusherInstance.disconnect();
        pusherInstance = null;
    }

    showEnded();
}

// ─── UI State Transitions ───────────────────────────────────────────────────

function showVideo() {
    if (statusLoading) statusLoading.style.display = 'none';
    if (statusEnded) statusEnded.style.display = 'none';
    if (statusError) statusError.style.display = 'none';
    if (videoContainer) videoContainer.style.display = '';
}

function showEnded(planName) {
    if (statusLoading) statusLoading.style.display = 'none';
    if (statusError) statusError.style.display = 'none';
    if (videoContainer) videoContainer.style.display = 'none';
    if (statusEnded) statusEnded.style.display = '';
    if (headerRight) headerRight.style.display = 'none';
    if (planName && planNameEl) planNameEl.textContent = planName;
    if (reactionBar) reactionBar.style.display = 'none';
    if (chatOverlay) chatOverlay.style.display = 'none';
    if (captionsBar) captionsBar.style.display = 'none';
    if (focusIndicator) focusIndicator.style.display = 'none';
    stopStatusPolling();
}

function showError(message) {
    if (statusLoading) statusLoading.style.display = 'none';
    if (statusEnded) statusEnded.style.display = 'none';
    if (videoContainer) videoContainer.style.display = 'none';
    if (statusError) statusError.style.display = '';
    if (errorMessage) errorMessage.textContent = message;
    if (headerRight) headerRight.style.display = 'none';
    if (reactionBar) reactionBar.style.display = 'none';
    if (chatOverlay) chatOverlay.style.display = 'none';
    stopStatusPolling();
}

function showInteractiveUI() {
    if (reactionBar) reactionBar.style.display = '';
    if (chatOverlay) chatOverlay.style.display = '';
}

// ─── Phase 6: Pusher Integration ────────────────────────────────────────────

async function initPusher(sessionId) {
    try {
        await loadPusherSDK();

        pusherInstance = new window.Pusher(PUSHER_KEY, {
            cluster: PUSHER_CLUSTER,
            forceTLS: true,
        });

        const channelName = `stream-${sessionId}`;
        publicChannel = pusherInstance.subscribe(channelName);

        publicChannel.bind('viewer-message', handleIncomingMessage);
        publicChannel.bind('viewer-reaction', handleIncomingReaction);
        publicChannel.bind('host-reaction', handleIncomingReaction);
        publicChannel.bind('stream-caption', handleIncomingCaption);
        publicChannel.bind('stream-state-update', handleStateUpdate);
        publicChannel.bind('stream-ended', () => handleStreamEnd());

        pusherInstance.connection.bind('state_change', (states) => {
            console.log(`[Viewer Pusher] ${states.previous} → ${states.current}`);
        });

        console.log(`[Viewer] Subscribed to Pusher channel: ${channelName}`);
    } catch (err) {
        console.warn('[Viewer] Pusher initialization failed (chat/reactions unavailable):', err.message);
    }
}

function loadPusherSDK() {
    if (window.Pusher) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = PUSHER_SDK_URL;
        script.async = true;
        script.onload = () => window.Pusher ? resolve() : reject(new Error('Pusher SDK failed'));
        script.onerror = () => reject(new Error('Failed to load Pusher SDK'));
        document.head.appendChild(script);
    });
}

// ─── Phase 6: Chat ──────────────────────────────────────────────────────────

function initChatForm() {
    if (!chatForm) return;

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = chatInput?.value?.trim();
        if (!text || !currentSessionId) return;

        const name = ensureViewerName();
        if (!name) return; // name prompt is showing

        appendChatMessage(name, text, true);
        chatInput.value = '';

        try {
            await fetch('/api/viewer-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: currentSessionId,
                    senderName: name,
                    content: text,
                    type: 'message',
                }),
            });
        } catch (err) {
            console.warn('[Viewer] Failed to send message:', err.message);
        }
    });
}

function handleIncomingMessage(data) {
    const myName = sessionStorage.getItem('viewerName');
    if (data.senderName === myName && data.isViewer) return;

    const isHost = !data.isViewer;
    appendChatMessage(data.senderName, data.content, false, isHost);
}

function appendChatMessage(senderName, content, isOwn, isHost) {
    if (!chatMessages) return;

    const msg = document.createElement('div');
    msg.className = 'viewer-chat-msg';

    const sender = document.createElement('span');
    sender.className = 'chat-sender' + (isHost ? ' host-badge' : '');
    sender.textContent = isHost ? `${senderName} (Host)` : senderName;

    const text = document.createElement('span');
    text.className = 'chat-text';
    text.textContent = content;

    msg.appendChild(sender);
    msg.appendChild(text);
    chatMessages.appendChild(msg);

    chatMessages.scrollTop = chatMessages.scrollHeight;

    while (chatMessages.children.length > 100) {
        chatMessages.removeChild(chatMessages.firstChild);
    }
}

function ensureViewerName() {
    viewerName = sessionStorage.getItem('viewerName') || '';
    if (viewerName) return viewerName;

    showNamePrompt();
    return null;
}

function showNamePrompt() {
    if (document.getElementById('viewer-name-prompt')) return;

    const prompt = document.createElement('div');
    prompt.id = 'viewer-name-prompt';
    prompt.className = 'viewer-name-prompt';
    prompt.innerHTML = `
        <label>Choose a display name to chat:</label>
        <input type="text" id="viewer-name-input" maxlength="30" placeholder="Your name..." autocomplete="off">
        <button type="button" id="viewer-name-submit">Join Chat</button>
    `;
    videoArea.appendChild(prompt);

    const nameInput = document.getElementById('viewer-name-input');
    const nameSubmit = document.getElementById('viewer-name-submit');

    nameInput.focus();

    const submitName = () => {
        const name = nameInput.value.trim();
        if (!name) return;
        viewerName = name;
        sessionStorage.setItem('viewerName', name);
        prompt.remove();
        if (chatInput?.value?.trim()) {
            chatForm.dispatchEvent(new Event('submit'));
        }
    };

    nameSubmit.addEventListener('click', submitName);
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitName();
    });
}

// ─── Phase 6: Reactions ─────────────────────────────────────────────────────

function initReactionBar() {
    if (!reactionBar) return;

    reactionBar.addEventListener('click', async (e) => {
        const btn = e.target.closest('.viewer-reaction-btn');
        if (!btn || btn.classList.contains('cooldown')) return;

        const emoji = btn.dataset.emoji || btn.textContent.trim();

        btn.classList.add('cooldown');
        setTimeout(() => btn.classList.remove('cooldown'), 500);

        spawnFloatingEmoji(emoji);

        try {
            await fetch('/api/viewer-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: currentSessionId,
                    senderName: viewerName || 'Viewer',
                    content: emoji,
                    type: 'reaction',
                }),
            });
        } catch (err) {
            console.warn('[Viewer] Failed to send reaction:', err.message);
        }
    });
}

function handleIncomingReaction(data) {
    spawnFloatingEmoji(data.emoji);
}

function spawnFloatingEmoji(emoji) {
    if (!reactionOverlay) return;

    const el = document.createElement('span');
    el.className = 'viewer-floating-emoji';
    el.textContent = emoji;
    const leftPct = 60 + Math.random() * 35;
    el.style.left = `${leftPct}%`;

    reactionOverlay.appendChild(el);

    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => { if (el.parentNode) el.remove(); }, 3000);
}

// ─── Phase 6: Captions ─────────────────────────────────────────────────────

function handleIncomingCaption(data) {
    if (!captionsBar) return;
    captionsBar.style.display = '';
    captionsBar.textContent = data.text || '';

    if (data.isFinal) {
        setTimeout(() => {
            if (captionsBar.textContent === data.text) {
                captionsBar.textContent = '';
            }
        }, 4000);
    }
}

// ─── Phase 6: State Sync ───────────────────────────────────────────────────

function handleStateUpdate(data) {
    if (!focusIndicator) return;

    if (data.focusItemName) {
        focusIndicator.style.display = '';
        focusIndicator.textContent = `Discussing: ${data.focusItemName}`;
    } else {
        focusIndicator.style.display = 'none';
        focusIndicator.textContent = '';
    }
}

// ─── Cleanup on Page Unload ─────────────────────────────────────────────────

window.addEventListener('beforeunload', () => {
    stopStatusPolling();
    if (agoraClient) {
        agoraClient.leave().catch(() => {});
    }
    if (pusherInstance) {
        pusherInstance.disconnect();
    }
});

// ─── Start ──────────────────────────────────────────────────────────────────

init();
