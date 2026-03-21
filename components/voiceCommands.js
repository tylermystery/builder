// FILE: components/voiceCommands.js
// v3.8 Phase 4: AI Transcription Bridge — Ryry voice commands via Web Speech API
// Provides real-time speech recognition during live streams with wake word detection
// and command parsing. Uses the browser's Web Speech API for zero-latency, free transcription.

import { state } from '../state.js';
import { RYRY_CONFIG } from '../config.js';
import { log } from '../utils/debug.js';

// --- Module State ---
let recognition = null;           // SpeechRecognition instance
let isListening = false;          // Whether recognition is active
let isWakeWordActive = false;     // Whether wake word was detected (waiting for command)
let wakeWordTimeout = null;       // Timer to reset wake word if no command follows
let commandBuffer = '';           // Accumulated transcript after wake word
let pendingCommand = null;        // Command awaiting confirmation
let undoTimer = null;             // 5-second undo window timer
let transcriptCallback = null;    // Callback for live transcript updates
let commandCallback = null;       // Callback for command execution
let statusCallback = null;        // Callback for status changes (listening, wake word, etc.)

const WAKE_WORD = RYRY_CONFIG.wakeWord.toLowerCase();
const COMMANDS = RYRY_CONFIG.commands;
const CONFIRMATION_TIMEOUT = RYRY_CONFIG.confirmationTimeoutMs;
const WAKE_WORD_LISTEN_WINDOW = 8000; // 8 seconds to say a command after wake word

/**
 * Check if the Web Speech API is available in this browser.
 * @returns {boolean}
 */
export function isSpeechRecognitionSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Register callbacks for voice command events.
 * @param {Object} callbacks
 * @param {Function} callbacks.onTranscript - Called with { text, isFinal } for each transcript segment
 * @param {Function} callbacks.onCommand - Called with { type, payload, rawText } when a command is recognized
 * @param {Function} callbacks.onStatus - Called with { status, message } for state changes
 */
export function registerVoiceCallbacks(callbacks = {}) {
    if (callbacks.onTranscript) transcriptCallback = callbacks.onTranscript;
    if (callbacks.onCommand) commandCallback = callbacks.onCommand;
    if (callbacks.onStatus) statusCallback = callbacks.onStatus;
}

/**
 * Start speech recognition. Should be called when the stream starts or user enables transcription.
 * @returns {boolean} Whether recognition was started successfully
 */
export function startListening() {
    if (!isSpeechRecognitionSupported()) {
        console.warn('[VoiceCmd] Web Speech API not supported in this browser');
        emitStatus('unsupported', 'Speech recognition is not supported in this browser. Use Chrome or Edge.');
        return false;
    }

    if (isListening) {
        console.warn('[VoiceCmd] Already listening');
        return true;
    }

    try {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();

        // Configuration
        recognition.continuous = true;        // Keep listening until stopped
        recognition.interimResults = true;    // Get partial results for live captions
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 5;      // Get multiple interpretations for better wake word detection

        // Event handlers
        recognition.onstart = handleRecognitionStart;
        recognition.onresult = handleRecognitionResult;
        recognition.onerror = handleRecognitionError;
        recognition.onend = handleRecognitionEnd;

        recognition.start();
        log('VoiceCmd', 'Starting speech recognition');
        return true;

    } catch (error) {
        console.error('[VoiceCmd] Failed to start speech recognition:', error);
        emitStatus('error', `Failed to start: ${error.message}`);
        return false;
    }
}

/**
 * Stop speech recognition.
 */
export function stopListening() {
    if (recognition) {
        try {
            recognition.stop();
        } catch (e) {
            // May throw if already stopped
        }
        recognition = null;
    }
    isListening = false;
    isWakeWordActive = false;
    commandBuffer = '';
    clearTimeout(wakeWordTimeout);
    clearTimeout(undoTimer);
    pendingCommand = null;
    log('VoiceCmd', 'Speech recognition stopped');
    emitStatus('stopped', 'Transcription stopped');
}

/**
 * Cancel a pending command (user clicked "Undo" during confirmation window).
 * @returns {boolean} Whether there was a command to cancel
 */
export function cancelPendingCommand() {
    if (pendingCommand) {
        log('VoiceCmd', `Command cancelled: ${pendingCommand.type}`);
        clearTimeout(undoTimer);
        const cancelled = { ...pendingCommand };
        pendingCommand = null;
        emitStatus('cancelled', `Cancelled: ${cancelled.description}`);
        return true;
    }
    return false;
}

/**
 * Get the current listening/command state.
 * @returns {Object}
 */
export function getVoiceState() {
    return {
        isListening,
        isWakeWordActive,
        hasPendingCommand: !!pendingCommand,
        pendingCommand: pendingCommand ? {
            type: pendingCommand.type,
            description: pendingCommand.description,
            payload: pendingCommand.payload,
        } : null,
        isSupported: isSpeechRecognitionSupported(),
    };
}

// --- Internal Handlers ---

function handleRecognitionStart() {
    isListening = true;
    log('VoiceCmd', 'Speech recognition started');
    console.warn('[VoiceCmd DEBUG] Recognition started — wake word:', WAKE_WORD, '| variations:', WAKE_WORD_VARIATIONS.length, '+ regex pattern');
    console.warn('[VoiceCmd DEBUG] Registered commands:', Object.keys(COMMANDS).join(', '));
    emitStatus('listening', 'Listening for voice commands...');
}

function handleRecognitionResult(event) {
    let interimTranscript = '';
    let finalTranscript = '';
    let allAlternatives = []; // Collect alternatives for wake word detection

    for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;

        if (result.isFinal) {
            finalTranscript += text;

            // Collect all alternatives for this final result (for wake word matching)
            for (let a = 0; a < result.length; a++) {
                allAlternatives.push({
                    transcript: result[a].transcript,
                    confidence: result[a].confidence,
                });
            }
        } else {
            interimTranscript += text;

            // Debug: log interim for wake word debugging
            if (text.toLowerCase().match(/r[aeiouy]/i)) {
                console.warn('[VoiceCmd DEBUG] Interim (potential wake word):', JSON.stringify(text.toLowerCase().trim()));
            }
        }
    }

    // Emit transcript for live captions
    if (interimTranscript) {
        emitTranscript(interimTranscript, false);
    }
    if (finalTranscript) {
        emitTranscript(finalTranscript, true);

        // Log all alternatives for debugging
        if (allAlternatives.length > 1) {
            console.warn('[VoiceCmd DEBUG] All alternatives:', allAlternatives.map(a =>
                `"${a.transcript.trim()}" (${(a.confidence * 100).toFixed(1)}%)`
            ).join(' | '));
        }

        processFinalTranscript(finalTranscript, allAlternatives);
    }
}

function handleRecognitionError(event) {
    console.warn('[VoiceCmd] Recognition error:', event.error, event.message);

    switch (event.error) {
        case 'no-speech':
            // Silence — not an error, just restart
            log('VoiceCmd', 'No speech detected, continuing...');
            break;
        case 'audio-capture':
            emitStatus('error', 'No microphone found. Check your audio settings.');
            break;
        case 'not-allowed':
            emitStatus('error', 'Microphone access denied. Please allow microphone access.');
            break;
        case 'network':
            emitStatus('error', 'Network error during speech recognition.');
            break;
        default:
            emitStatus('error', `Speech recognition error: ${event.error}`);
    }
}

function handleRecognitionEnd() {
    log('VoiceCmd', 'Recognition ended, isListening:', isListening);

    // Auto-restart if we're still supposed to be listening
    // (recognition can stop on its own due to silence or browser limits)
    if (isListening && recognition) {
        log('VoiceCmd', 'Auto-restarting recognition');
        try {
            recognition.start();
        } catch (e) {
            // Small delay before retry (browser may need a moment)
            setTimeout(() => {
                if (isListening && recognition) {
                    try {
                        recognition.start();
                    } catch (err) {
                        console.warn('[VoiceCmd] Failed to restart recognition:', err);
                        isListening = false;
                        emitStatus('stopped', 'Transcription stopped unexpectedly');
                    }
                }
            }, 300);
        }
    }
}

/**
 * Process a final transcript segment for wake word and command detection.
 * Now also checks all speech recognition alternatives for the wake word.
 * @param {string} text
 * @param {Array} alternatives - All recognition alternatives for this utterance
 */
function processFinalTranscript(text, alternatives = []) {
    const lowerText = text.toLowerCase().trim();
    console.warn('[VoiceCmd DEBUG] Final transcript:', JSON.stringify(lowerText), '| isWakeWordActive:', isWakeWordActive, '| commandBuffer:', JSON.stringify(commandBuffer));

    if (isWakeWordActive) {
        // We're in command mode — accumulate and parse
        commandBuffer += ' ' + lowerText;
        const fullBuffer = commandBuffer.trim();
        console.warn('[VoiceCmd DEBUG] Command buffer after accumulate:', JSON.stringify(fullBuffer));
        const parsed = parseCommand(fullBuffer);
        if (parsed) {
            // Command recognized — save rawText before clearing buffer
            const rawText = fullBuffer;
            isWakeWordActive = false;
            commandBuffer = '';
            clearTimeout(wakeWordTimeout);
            console.warn('[VoiceCmd DEBUG] Command parsed successfully:', parsed.type, '| payload:', JSON.stringify(parsed.payload));
            handleParsedCommand(parsed, rawText);
        } else {
            console.warn('[VoiceCmd DEBUG] No command match yet in buffer:', JSON.stringify(fullBuffer));
        }
        // If no command parsed yet, keep accumulating until timeout
        return;
    }

    // Check for wake word in the primary transcript
    let wakeWordIndex = findWakeWord(lowerText);
    let wakeSource = lowerText;

    // If not found in primary, check all alternatives
    if (wakeWordIndex === -1 && alternatives.length > 1) {
        for (let a = 1; a < alternatives.length; a++) {
            const altText = alternatives[a].transcript.toLowerCase().trim();
            const altIndex = findWakeWord(altText);
            if (altIndex !== -1) {
                console.warn('[VoiceCmd DEBUG] Wake word found in alternative #' + a + ':', JSON.stringify(altText), '(confidence: ' + (alternatives[a].confidence * 100).toFixed(1) + '%)');
                wakeWordIndex = altIndex;
                wakeSource = altText;
                break;
            }
        }
    }

    if (wakeWordIndex !== -1) {
        log('VoiceCmd', 'Wake word detected!');
        isWakeWordActive = true;
        emitStatus('wake', `Ryry is listening for a command...`);

        // Check if the command is in the same utterance (e.g., "Ryry log task fix the door")
        const matchedWakeLen = getMatchedWakeWordLength(wakeSource, wakeWordIndex);
        const afterWakeWord = wakeSource.substring(wakeWordIndex + matchedWakeLen).trim();
        if (afterWakeWord) {
            commandBuffer = afterWakeWord;
            console.warn('[VoiceCmd DEBUG] After wake word in same utterance:', JSON.stringify(afterWakeWord));
            const parsed = parseCommand(afterWakeWord);
            if (parsed) {
                isWakeWordActive = false;
                commandBuffer = '';
                handleParsedCommand(parsed, afterWakeWord);
                return;
            }
        }

        // Set timeout — if no command within the window, reset
        clearTimeout(wakeWordTimeout);
        wakeWordTimeout = setTimeout(() => {
            if (isWakeWordActive) {
                console.warn('[VoiceCmd DEBUG] Wake word timeout — buffer was:', JSON.stringify(commandBuffer));
                log('VoiceCmd', 'Wake word timeout — no command recognized');
                isWakeWordActive = false;
                commandBuffer = '';
                emitStatus('listening', 'No command detected. Say "Ryry" again.');
            }
        }, WAKE_WORD_LISTEN_WINDOW);
    }
}

/**
 * Common Web Speech API transcriptions of "ryry" — exhaustive list covering
 * many observed speech recognition outputs across Chrome/Edge/Safari.
 */
const WAKE_WORD_VARIATIONS = [
    // Exact / compact
    'ryry', 'riri', 'rere',
    // Spaced
    'ry ry', 'ri ri', 're re', 'ry ri', 'ri ry',
    // Rye/Ray/Rai
    'rye rye', 'ray ray', 'rai rai', 'rye ry', 'ry rye',
    'ray ry', 'ry ray', 'rai ry', 'ry rai',
    'rayray', 'rairai', 'ryerye',
    // Ree/Rie
    'ree ree', 'rie rie', 'reeree', 'rierie',
    'ree ry', 'ry ree',
    // Hyphenated
    'ry-ry', 'rye-rye', 'ri-ri', 'ray-ray',
    // Common misrecognitions
    'rory', 'rewire', 'lyric',
    // With period/comma (speech API sometimes inserts punctuation)
    'ry. ry', 'ry, ry',
    // Very common misheard as names/words
    'riri', 'rory',
];

/**
 * Regex-based phonetic pattern for "ryry" — catches most "r + vowel(s) + r + vowel(s)" patterns
 * that the speech API might produce. Uses word boundaries to avoid false positives on random words.
 * Patterns: r + (y/i/ie/ye/eye/ai/ay/ee/e/a) + optional space/hyphen + r + same vowel patterns
 */
const WAKE_WORD_REGEX = /\br[aeiouy]{1,3}[\s,.-]*r[aeiouy]{1,3}\b/i;

/**
 * Find the wake word in text, supporting common speech recognition variations.
 * Uses three strategies: exact string matching, list of known variations, and regex phonetic matching.
 * @param {string} text - Lowercase text to search
 * @returns {number} Index of wake word, or -1 if not found
 */
function findWakeWord(text) {
    // Strategy 1: Exact match
    const exactIndex = text.indexOf(WAKE_WORD);
    if (exactIndex !== -1) {
        console.warn('[VoiceCmd DEBUG] Wake word: exact match at', exactIndex);
        return exactIndex;
    }

    // Strategy 2: Known variations list
    for (const variant of WAKE_WORD_VARIATIONS) {
        const idx = text.indexOf(variant);
        if (idx !== -1) {
            console.warn('[VoiceCmd DEBUG] Wake word: variation match "' + variant + '" at', idx);
            return idx;
        }
    }

    // Strategy 3: Regex phonetic pattern (catches novel speech-to-text outputs)
    const regexMatch = text.match(WAKE_WORD_REGEX);
    if (regexMatch) {
        // Validate it's not a common English word that happens to match
        const matched = regexMatch[0].toLowerCase();
        const FALSE_POSITIVES = ['rare', 'rear', 'roar', 'rarer', 'rural', 'error', 'aura', 'euro'];
        if (!FALSE_POSITIVES.includes(matched)) {
            console.warn('[VoiceCmd DEBUG] Wake word: regex match "' + regexMatch[0] + '" at', regexMatch.index);
            return regexMatch.index;
        } else {
            console.warn('[VoiceCmd DEBUG] Wake word: regex matched "' + matched + '" but filtered as false positive');
        }
    }

    console.warn('[VoiceCmd DEBUG] Wake word: NO match in "' + text + '"');
    return -1;
}

/**
 * Get the length of the matched wake word pattern at a given index.
 * @param {string} text
 * @param {number} startIndex
 * @returns {number}
 */
function getMatchedWakeWordLength(text, startIndex) {
    // Try exact + variations first
    const allVariations = [WAKE_WORD, ...WAKE_WORD_VARIATIONS];
    for (const v of allVariations) {
        if (text.substring(startIndex, startIndex + v.length) === v) return v.length;
    }

    // Try regex match from that position
    const substring = text.substring(startIndex);
    const regexMatch = substring.match(WAKE_WORD_REGEX);
    if (regexMatch && regexMatch.index === 0) {
        return regexMatch[0].length;
    }

    return WAKE_WORD.length; // fallback
}

/**
 * Parse a text string against known voice commands.
 * Supports flexible matching — strips filler words like "a", "the", "my" between keyword words.
 * @param {string} text - The text after the wake word
 * @returns {Object|null} Parsed command or null if no match
 */
function parseCommand(text) {
    const lowerText = text.toLowerCase().trim();

    for (const [cmdType, cmdConfig] of Object.entries(COMMANDS)) {
        for (const keyword of cmdConfig.keywords) {
            // Direct match
            const keywordIndex = lowerText.indexOf(keyword);
            if (keywordIndex !== -1) {
                const payload = lowerText.substring(keywordIndex + keyword.length).trim();
                console.warn('[VoiceCmd DEBUG] Direct keyword match:', keyword, '| payload:', JSON.stringify(payload));
                return {
                    type: cmdType,
                    keyword: keyword,
                    description: cmdConfig.description,
                    payload: payload || null,
                    rawText: text,
                };
            }

            // Flexible match: strip filler words between keyword parts
            // e.g., "log a task" matches "log task", "set the priority" matches "set priority"
            const keywordParts = keyword.split(' ');
            if (keywordParts.length >= 2) {
                const flexPattern = keywordParts.join('\\s+(?:a |the |my |this |that |)?');
                const flexRegex = new RegExp(flexPattern, 'i');
                const flexMatch = lowerText.match(flexRegex);
                if (flexMatch) {
                    const matchEnd = flexMatch.index + flexMatch[0].length;
                    const payload = lowerText.substring(matchEnd).trim();
                    console.warn('[VoiceCmd DEBUG] Flexible keyword match:', keyword, '| matched:', JSON.stringify(flexMatch[0]), '| payload:', JSON.stringify(payload));
                    return {
                        type: cmdType,
                        keyword: keyword,
                        description: cmdConfig.description,
                        payload: payload || null,
                        rawText: text,
                    };
                }
            }
        }
    }

    console.warn('[VoiceCmd DEBUG] No command match found in:', JSON.stringify(lowerText));
    return null;
}

/**
 * Handle a recognized voice command — enter confirmation window.
 * @param {Object} parsed
 * @param {string} rawText
 */
function handleParsedCommand(parsed, rawText) {
    log('VoiceCmd', `Command recognized: ${parsed.type}`, parsed);
    console.warn('[VoiceCmd] Command recognized:', parsed);

    // Set as pending — user has CONFIRMATION_TIMEOUT ms to undo
    pendingCommand = {
        type: parsed.type,
        keyword: parsed.keyword,
        description: parsed.description,
        payload: parsed.payload,
        rawText: rawText,
        timestamp: Date.now(),
    };

    emitStatus('confirm', `Command: "${parsed.keyword}"${parsed.payload ? ` — "${parsed.payload}"` : ''}`, pendingCommand);

    // Start the confirmation countdown
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
        if (pendingCommand) {
            executeCommand(pendingCommand);
            pendingCommand = null;
        }
    }, CONFIRMATION_TIMEOUT);
}

/**
 * Execute a confirmed voice command.
 * @param {Object} command
 */
function executeCommand(command) {
    log('VoiceCmd', `Executing command: ${command.type}`, command);
    console.warn('[VoiceCmd] Executing command:', command);

    if (commandCallback) {
        commandCallback({
            type: command.type,
            payload: command.payload,
            rawText: command.rawText,
            description: command.description,
        });
    }

    emitStatus('executed', `Executed: ${command.description}`);
}

// --- Event Emitters ---

function emitTranscript(text, isFinal) {
    if (transcriptCallback) {
        transcriptCallback({ text: text.trim(), isFinal });
    }
}

function emitStatus(status, message, data = null) {
    if (statusCallback) {
        statusCallback({ status, message, data });
    }
}
