// FILE: chat.js
import { state } from './state.js';
import * as api from './api.js';
import { log } from './utils/debug.js';

let currentUser = null;
let channel = null;

// --- NEW: Arrays for generating fun names ---
const FUN_ADJECTIVES = ['Happy', 'Clever', 'Sunny', 'Lucky', 'Creative', 'Brave', 'Sparkling', 'Cosmic', 'Witty', 'Zesty'];
const FUN_NOUNS = ['Panda', 'Wombat', 'Explorer', 'Starship', 'Juggler', 'Wizard', 'Dolphin', 'Robot', 'Pineapple', 'Comet'];

// --- NEW: Function to generate a random name ---
function generateFunName() {
    const adj = FUN_ADJECTIVES[Math.floor(Math.random() * FUN_ADJECTIVES.length)];
    const noun = FUN_NOUNS[Math.floor(Math.random() * FUN_NOUNS.length)];
    return `${adj} ${noun}`;
}

/**
 * Establishes a simple user identity for the chat session by checking local storage
 * or generating a new fun name.
 */
function getSimpleUserIdentity() {
    if (currentUser) return currentUser;

    let userId = localStorage.getItem('chatUserId');
    if (!userId) {
        userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('chatUserId', userId);
    }

    let userName = localStorage.getItem('chatUserName');
    // --- FIX: Replaced prompt with fun name generator ---
    if (!userName) {
        userName = generateFunName();
        localStorage.setItem('chatUserName', userName);
    }
    
    currentUser = { id: userId, name: userName };
    return currentUser;
}

/**
 * Updates the UI elements related to presence (online user count and list).
 * @param {object} members - Pusher's members object from a presence channel.
 */
function updatePresenceUI(members) {
    const presenceCounter = document.getElementById('presence-counter');
    const whosHereCount = document.getElementById('whos-here-count');
    const whosHereList = document.getElementById('whos-here-list');
    const count = members.count;
    if (presenceCounter) presenceCounter.innerText = count;
    if (whosHereCount) whosHereCount.innerText = count;
    if (whosHereList) {
        whosHereList.innerHTML = ''; // Clear the current list
        members.each((member) => {
            const userElement = document.createElement('div');
            // Use the most current name for the local user
            const displayName = member.id === currentUser.id ? currentUser.name : member.info.name;
            userElement.innerText = `🟢 ${displayName} ${member.id === currentUser.id ? '(You)' : ''}`;
            whosHereList.appendChild(userElement);
        });
    }
}

/**
 * Appends a new message to the chat window UI.
 * @param {string} sender - The name of the message sender.
 * @param {string} message - The content of the message.
 * @param {boolean} isSent - True if the message was sent by the current user.
 * @param {string|Date} timestamp - The timestamp of the message.
 */
function addMessageToUI(sender, message, isSent, timestamp) {
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) return;

    const wrapper = document.createElement('div');
    wrapper.className = isSent ? 'message-wrapper sent' : 'message-wrapper received';

    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    
    const senderElement = document.createElement('div');
    senderElement.className = 'sender';
    senderElement.innerText = isSent ? 'You' : sender;
    
    messageElement.appendChild(senderElement);
    messageElement.append(document.createTextNode(message));
    
    const timestampElement = document.createElement('div');
    timestampElement.className = 'timestamp';
    const date = timestamp ? new Date(timestamp) : new Date();
    timestampElement.innerText = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    wrapper.appendChild(messageElement);
    wrapper.appendChild(timestampElement);
    messagesList.appendChild(wrapper);

    messagesList.parentElement.scrollTop = messagesList.parentElement.scrollHeight;
}

/**
 * Fetches and displays the chat history from Airtable.
 * @param {string} sessionId - The ID of the current session.
 */
async function loadChatHistory(sessionId) {
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) return;
    messagesList.innerHTML = '';
    const records = await api.fetchChatMessages(sessionId);
    // Airtable API returns records sorted oldest to newest (asc), so we don't need to reverse.
    records.forEach(record => {
        const { SenderID, SenderName, Content, Timestamp } = record.fields;
        const isSent = SenderID === currentUser.id;
        addMessageToUI(SenderName, Content, isSent, Timestamp);
    });
}

/**
 * Binds to the custom 'client-new-message' event to display incoming messages.
 */
function bindMessageEvents() {
    channel.bind('client-new-message', (data) => {
        if (data.senderId !== currentUser.id) {
            addMessageToUI(data.senderName, data.content, false, data.timestamp);
        }
    });
}

/**
 * Binds to Pusher's presence events to update the UI when users join or leave.
 */
function bindPresenceEvents() {
    channel.bind('pusher:subscription_succeeded', (members) => {
        updatePresenceUI(members);
    });
    channel.bind('pusher:member_added', (member) => {
        updatePresenceUI(channel.members);
    });
    channel.bind('pusher:member_removed', (member) => {
        updatePresenceUI(channel.members);
    });
}

/**
 * Initializes the Pusher client, loads history, subscribes to the channel, and binds all events.
 */
export async function initializeChat() {
    currentUser = getSimpleUserIdentity();
    const sessionId = state.session.id || 'default-session';

    // --- NEW: Set up the user name input and its event listener ---
    const chatUserNameInput = document.getElementById('chat-user-name');
    if (chatUserNameInput) {
        chatUserNameInput.value = currentUser.name;
        chatUserNameInput.addEventListener('change', (e) => {
            const newName = e.target.value.trim();
            if (newName && newName !== currentUser.name) {
                currentUser.name = newName;
                localStorage.setItem('chatUserName', newName);
                log('Chat', `User name changed to: ${newName}`);
                // Refresh the presence list to show the new name immediately.
                updatePresenceUI(channel.members);
                // Note: Other users will see the new name on the next message sent or after a refresh.
            } else {
                // Revert to the current name if the input is empty
                e.target.value = currentUser.name;
            }
        });
    }

    await loadChatHistory(sessionId);
    const pusher = new Pusher('236f480714e5001590b5', {
        cluster: 'us3',
        authEndpoint: '/api/pusher-auth',
        auth: {
            params: { 
                user_id: currentUser.id,
                // Pass the most current name during authentication
                user_name: currentUser.name
            }
        }
    });

    const channelName = `presence-session-${sessionId}`;
    channel = pusher.subscribe(channelName);

    bindPresenceEvents();
    bindMessageEvents();
}

/**
 * Sends a message by persisting it to Airtable and then triggering a Pusher event.
 * @param {string} message - The message content to send.
 */
export async function sendMessage(message) {
    if (!channel || !currentUser) return;

    const sessionId = state.session.id || 'default-session';
    const timestamp = new Date().toISOString();
    
    addMessageToUI(currentUser.name, message, true, timestamp);
    
    await api.postChatMessage(sessionId, currentUser.id, currentUser.name, message);
    channel.trigger('client-new-message', {
        content: message,
        senderId: currentUser.id,
        senderName: currentUser.name,
        timestamp: timestamp
    });
}

export function getCurrentUser() {
    return currentUser || getSimpleUserIdentity();
}

