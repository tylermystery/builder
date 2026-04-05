// FILE: components/liveStream.js
// v3.8: Agora WebRTC live stream integration
// Handles SDK lifecycle, video/audio tracks, and stream state management

import { state, setState } from '../state.js';
import { AGORA_APP_ID, AGORA_SDK_URL, LIVE_STREAM_CONFIG } from '../config.js';
import { log } from '../utils/debug.js';

// --- Module State ---
let agoraClient = null;
let localAudioTrack = null;
let localVideoTrack = null;
let isSDKLoaded = false;
let sdkLoadPromise = null;
let remoteUsers = new Map(); // uid -> { audioTrack, videoTrack }

// Callbacks registered by the presentation layer
let onStreamStarted = null;
let onStreamEnded = null;
let onRemoteUserJoined = null;
let onRemoteUserLeft = null;
let onViewerCountChanged = null;
let onError = null;

/**
 * Lazy-load the Agora RTC SDK via CDN.
 * Returns a promise that resolves when the SDK is ready.
 */
function loadAgoraSDK() {
    if (isSDKLoaded && window.AgoraRTC) {
        return Promise.resolve();
    }

    if (sdkLoadPromise) {
        return sdkLoadPromise;
    }

    sdkLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = AGORA_SDK_URL;
        script.async = true;
        script.onload = () => {
            if (window.AgoraRTC) {
                isSDKLoaded = true;
                log('LiveStream', 'Agora SDK loaded successfully');
                // Disable Agora's verbose logging in production
                window.AgoraRTC.setLogLevel(2); // WARNING level
                resolve();
            } else {
                reject(new Error('AgoraRTC not available after script load'));
            }
        };
        script.onerror = () => {
            sdkLoadPromise = null;
            reject(new Error('Failed to load Agora SDK'));
        };
        document.head.appendChild(script);
    });

    return sdkLoadPromise;
}

/**
 * Initialize the Agora client. Must be called after SDK is loaded.
 */
function createClient() {
    if (agoraClient) return agoraClient;

    agoraClient = window.AgoraRTC.createClient({
        codec: LIVE_STREAM_CONFIG.codec,
        mode: LIVE_STREAM_CONFIG.mode,
    });

    // Register event handlers
    agoraClient.on('user-published', handleUserPublished);
    agoraClient.on('user-unpublished', handleUserUnpublished);
    agoraClient.on('user-joined', handleUserJoined);
    agoraClient.on('user-left', handleUserLeft);
    agoraClient.on('connection-state-change', handleConnectionStateChange);

    log('LiveStream', 'Agora client created');
    return agoraClient;
}

/**
 * Fetch an Agora RTC token from our Netlify function.
 * @param {string} channelName
 * @param {number} uid - Agora numeric UID (0 for auto-assign)
 * @param {string} role - 'host' or 'audience'
 */
async function fetchToken(channelName, uid = 0, role = 'host') {
    try {
        const response = await fetch('/.netlify/functions/agora-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channelName,
                uid,
                role,
                userId: state.session.user?.id || null,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Token request failed: ${response.status}`);
        }

        const data = await response.json();
        return data.token;
    } catch (error) {
        console.error('[LiveStream] Token fetch error:', error);
        throw error;
    }
}

// --- Agora Event Handlers ---

async function handleUserPublished(user, mediaType) {
    log('LiveStream', `Remote user ${user.uid} published ${mediaType}`);
    await agoraClient.subscribe(user, mediaType);

    if (!remoteUsers.has(user.uid)) {
        remoteUsers.set(user.uid, { audioTrack: null, videoTrack: null });
    }
    const remote = remoteUsers.get(user.uid);

    if (mediaType === 'video') {
        remote.videoTrack = user.videoTrack;
    }
    if (mediaType === 'audio') {
        remote.audioTrack = user.audioTrack;
        user.audioTrack.play();
    }

    if (onRemoteUserJoined) {
        onRemoteUserJoined(user.uid, mediaType, remoteUsers.size);
    }
    updateViewerCount();
}

function handleUserUnpublished(user, mediaType) {
    log('LiveStream', `Remote user ${user.uid} unpublished ${mediaType}`);
    const remote = remoteUsers.get(user.uid);
    if (remote) {
        if (mediaType === 'video') remote.videoTrack = null;
        if (mediaType === 'audio') remote.audioTrack = null;
    }
}

function handleUserJoined(user) {
    log('LiveStream', `Remote user ${user.uid} joined channel`);
    updateViewerCount();
}

function handleUserLeft(user, reason) {
    log('LiveStream', `Remote user ${user.uid} left channel: ${reason}`);
    remoteUsers.delete(user.uid);
    if (onRemoteUserLeft) {
        onRemoteUserLeft(user.uid, remoteUsers.size);
    }
    updateViewerCount();
}

function handleConnectionStateChange(curState, prevState, reason) {
    log('LiveStream', `Connection: ${prevState} → ${curState} (${reason || 'n/a'})`);

    if (curState === 'DISCONNECTED' && state.stream.isActive) {
        console.warn('[LiveStream] Disconnected while stream was active');
        if (onError) {
            onError('connection_lost', 'Connection to the stream was lost. Attempting to reconnect...');
        }
    }

    if (curState === 'CONNECTED' && prevState === 'RECONNECTING') {
        log('LiveStream', 'Successfully reconnected');
    }
}

function updateViewerCount() {
    const count = remoteUsers.size;
    setState({ stream: { viewerCount: count } });
    if (onViewerCountChanged) {
        onViewerCountChanged(count);
    }
}

// --- Public API ---

/**
 * Register callbacks for stream events.
 * @param {Object} callbacks
 */
export function registerCallbacks(callbacks = {}) {
    if (callbacks.onStreamStarted) onStreamStarted = callbacks.onStreamStarted;
    if (callbacks.onStreamEnded) onStreamEnded = callbacks.onStreamEnded;
    if (callbacks.onRemoteUserJoined) onRemoteUserJoined = callbacks.onRemoteUserJoined;
    if (callbacks.onRemoteUserLeft) onRemoteUserLeft = callbacks.onRemoteUserLeft;
    if (callbacks.onViewerCountChanged) onViewerCountChanged = callbacks.onViewerCountChanged;
    if (callbacks.onError) onError = callbacks.onError;
}

/**
 * Start a live stream as the host.
 * Loads the SDK if needed, creates local tracks, joins the channel, and publishes.
 *
 * @param {Object} options
 * @param {string} options.channelName - Agora channel name (defaults to session ID)
 * @param {HTMLElement} options.videoContainer - DOM element to render local video into
 * @returns {Promise<boolean>} Success status
 */
export async function startStream(options = {}) {
    const channelName = options.channelName || state.session.id;
    const videoContainer = options.videoContainer;

    if (!channelName) {
        console.error('[LiveStream] Cannot start stream: no channel name / session ID');
        return false;
    }

    if (!state.session.user?.isAuthenticated) {
        console.error('[LiveStream] Cannot start stream: user not authenticated');
        if (onError) onError('auth_required', 'You must be signed in to go live.');
        return false;
    }

    try {
        // 1. Load SDK
        await loadAgoraSDK();

        // 2. Create client
        createClient();

        // 3. Set role to host
        await agoraClient.setClientRole('host');

        // 4. Create local audio and video tracks
        [localAudioTrack, localVideoTrack] = await window.AgoraRTC.createMicrophoneAndCameraTracks(
            { encoderConfig: LIVE_STREAM_CONFIG.audioProfile },
            {
                encoderConfig: {
                    width: LIVE_STREAM_CONFIG.videoProfile.width,
                    height: LIVE_STREAM_CONFIG.videoProfile.height,
                    frameRate: LIVE_STREAM_CONFIG.videoProfile.frameRate,
                    bitrateMin: LIVE_STREAM_CONFIG.videoProfile.bitrateMin,
                    bitrateMax: LIVE_STREAM_CONFIG.videoProfile.bitrateMax,
                },
            }
        );

        // 5. Fetch token
        const appId = AGORA_APP_ID || window.__AGORA_APP_ID__ || '';
        const token = appId ? await fetchToken(channelName, 0, 'host') : null;

        // 6. Join channel
        const uid = await agoraClient.join(appId, channelName, token, null);
        log('LiveStream', `Joined channel "${channelName}" as host (uid: ${uid})`);

        // 7. Publish local tracks
        await agoraClient.publish([localAudioTrack, localVideoTrack]);

        // 8. Render local video if container provided
        if (videoContainer && localVideoTrack) {
            localVideoTrack.play(videoContainer);
        }

        // 9. Update state
        setState({
            stream: {
                isActive: true,
                isHost: true,
                hostUserId: state.session.user.id,
                channelName: channelName,
                startedAt: Date.now(),
                localAudioEnabled: true,
                localVideoEnabled: true,
                viewerCount: 0,
            }
        });

        if (onStreamStarted) onStreamStarted(channelName, uid);
        log('LiveStream', 'Stream started successfully');
        return true;

    } catch (error) {
        console.error('[LiveStream] Failed to start stream:', error);
        // Cleanup partial state
        await cleanupTracks();
        if (onError) onError('start_failed', error.message || 'Failed to start stream');
        return false;
    }
}

/**
 * Join an existing stream as an audience member (viewer).
 *
 * @param {Object} options
 * @param {string} options.channelName - Agora channel name
 * @param {HTMLElement} options.videoContainer - DOM element for remote host video
 * @returns {Promise<boolean>}
 */
export async function joinAsViewer(options = {}) {
    const channelName = options.channelName || state.stream.channelName || state.session.id;

    if (!channelName) {
        console.error('[LiveStream] Cannot join: no channel name');
        return false;
    }

    try {
        await loadAgoraSDK();
        createClient();

        // Audience role - no publishing
        await agoraClient.setClientRole('audience');

        const appId = AGORA_APP_ID || window.__AGORA_APP_ID__ || '';
        const token = appId ? await fetchToken(channelName, 0, 'audience') : null;

        const uid = await agoraClient.join(appId, channelName, token, null);
        log('LiveStream', `Joined channel "${channelName}" as viewer (uid: ${uid})`);

        setState({
            stream: {
                isActive: true,
                isHost: false,
                channelName: channelName,
            }
        });

        return true;

    } catch (error) {
        console.error('[LiveStream] Failed to join as viewer:', error);
        if (onError) onError('join_failed', error.message || 'Failed to join stream');
        return false;
    }
}

/**
 * End the current stream (host) or leave (viewer).
 */
export async function endStream() {
    log('LiveStream', 'Ending stream...');

    try {
        await cleanupTracks();

        if (agoraClient) {
            await agoraClient.leave();
            log('LiveStream', 'Left Agora channel');
        }

        // Clear remote users
        remoteUsers.clear();

        // Reset state
        setState({
            stream: {
                isActive: false,
                isHost: false,
                hostUserId: null,
                channelName: null,
                startedAt: null,
                viewerCount: 0,
                localAudioEnabled: true,
                localVideoEnabled: true,
                shareableLink: null,
            }
        });

        if (onStreamEnded) onStreamEnded();
        log('LiveStream', 'Stream ended');

    } catch (error) {
        console.error('[LiveStream] Error ending stream:', error);
    }
}

/**
 * Toggle local microphone on/off.
 * @returns {boolean} New mute state (true = enabled)
 */
export async function toggleAudio() {
    if (!localAudioTrack) return state.stream.localAudioEnabled;

    const newEnabled = !state.stream.localAudioEnabled;
    await localAudioTrack.setEnabled(newEnabled);
    setState({ stream: { localAudioEnabled: newEnabled } });
    log('LiveStream', `Microphone ${newEnabled ? 'enabled' : 'muted'}`);
    return newEnabled;
}

/**
 * Toggle local camera on/off.
 * @returns {boolean} New camera state (true = enabled)
 */
export async function toggleVideo() {
    if (!localVideoTrack) return state.stream.localVideoEnabled;

    const newEnabled = !state.stream.localVideoEnabled;
    await localVideoTrack.setEnabled(newEnabled);
    setState({ stream: { localVideoEnabled: newEnabled } });
    log('LiveStream', `Camera ${newEnabled ? 'enabled' : 'disabled'}`);
    return newEnabled;
}

/**
 * Play a remote user's video track into a DOM container.
 * @param {number} uid - Remote user's Agora UID
 * @param {HTMLElement} container - DOM element to render into
 */
export function playRemoteVideo(uid, container) {
    const remote = remoteUsers.get(uid);
    if (remote && remote.videoTrack && container) {
        remote.videoTrack.play(container);
    }
}

/**
 * Get the current list of remote user UIDs.
 * @returns {number[]}
 */
export function getRemoteUserIds() {
    return Array.from(remoteUsers.keys());
}

/**
 * Check if the Agora SDK has been loaded.
 * @returns {boolean}
 */
export function isAgoraLoaded() {
    return isSDKLoaded && !!window.AgoraRTC;
}

/**
 * Check if an Agora App ID is configured.
 * @returns {boolean}
 */
export function isAgoraConfigured() {
    return !!(AGORA_APP_ID || window.__AGORA_APP_ID__);
}

/**
 * Cleanup local tracks and release camera/microphone.
 */
async function cleanupTracks() {
    if (localAudioTrack) {
        localAudioTrack.stop();
        localAudioTrack.close();
        localAudioTrack = null;
    }
    if (localVideoTrack) {
        localVideoTrack.stop();
        localVideoTrack.close();
        localVideoTrack = null;
    }
}

/**
 * Full cleanup - call when leaving the presentation view.
 */
export async function cleanup() {
    await endStream();
    if (agoraClient) {
        agoraClient.removeAllListeners();
        agoraClient = null;
    }
    remoteUsers.clear();
    isSDKLoaded = false;
    sdkLoadPromise = null;
}
