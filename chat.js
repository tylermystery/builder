import { state } from './state.js';
import * as api from './api.js'; // Import the api module

let currentUser = null;
let channel = null;

/**
 * Establishes a simple user identity for the chat session by checking local storage
 * or prompting the user for their name.
 */
function getSimpleUserIdentity() {
    if (currentUser) return currentUser;

    let userId = localStorage.getItem('chatUserId');
    if (!userId) {
        userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('chatUserId', userId);
    }

    let userName = localStorage.getItem('chatUserName');
    if (!userName) {
        userName = prompt("Please enter your name for the chat:", "Guest");
        if (!userName) userName = "Guest"; // Default if the user cancels
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
            userElement.innerText = `🟢 ${member.info.name} ${member.id === currentUser.id ? '(You)' : ''}`;
            whosHereList.appendChild(userElement);
        });
    }
}

/**
 * Appends a new message to the chat window UI.
 * @param {string} sender - The name of the message sender.
 * @param {string} message - The content of the message.
 * @param {boolean} isSent - True if the message was sent by the current user.
 */
function addMessageToUI(sender, message, isSent) {
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) return;

    const messageElement = document.createElement('div');
    messageElement.className = isSent ? 'chat-message sent' : 'chat-message received';
    
    const senderElement = document.createElement('div');
    senderElement.className = 'sender';
    senderElement.innerText = isSent ? 'You' : sender;
    
    messageElement.appendChild(senderElement);
    messageElement.append(document.createTextNode(message));
    
    // This appends the new message to the BOTTOM of the list
    messagesList.appendChild(messageElement);
    // Scroll to the bottom to see the new message
    messagesList.parentElement.scrollTop = messagesList.parentElement.scrollHeight;
}

/**
 * Fetches and displays the chat history from Airtable.
 * @param {string} sessionId - The ID of the current session.
 */
async function loadChatHistory(sessionId) {
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) return;
    messagesList.innerHTML = ''; // Clear previous messages

    const records = await api.fetchChatMessages(sessionId);
    // Reverse the records so the oldest messages are first, ensuring correct order
    records.forEach(record => {
        const { SenderID, SenderName, Content } = record.fields;
        const isSent = SenderID === currentUser.id;
        addMessageToUI(SenderName, Content, isSent);
    });
}

/**
 * Binds to the custom 'client-new-message' event to display incoming messages.
 */
function bindMessageEvents() {
    channel.bind('client-new-message', (data) => {
        // Ensure we don't display our own message twice (since we add it instantly on send)
        if (data.senderId !== currentUser.id) {
            addMessageToUI(data.senderName, data.content, false);
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

    // Load existing messages from Airtable first
    await loadChatHistory(sessionId);

    const pusher = new Pusher('236f480714e5001590b5', {
        cluster: 'us3',
        authEndpoint: '/api/pusher-auth',
        auth: {
            params: { 
                user_id: currentUser.id,
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
    
    // 1. Add our own message to our UI immediately for a snappy feel
    addMessageToUI(currentUser.name, message, true);
    
    // 2. Persist the message to Airtable
    await api.postChatMessage(sessionId, currentUser.id, currentUser.name, message);

    // 3. Trigger the event for other clients
    channel.trigger('client-new-message', {
        content: message,
        senderId: currentUser.id,
        senderName: currentUser.name
    });
}
