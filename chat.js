// In chat.js (Updated Version)

import { state } from './state.js';
import * as api from './api.js'; // Import the api module

let currentUser = null;
let channel = null;

function getSimpleUserIdentity() {
    // ... (this function remains unchanged)
}

function updatePresenceUI(members) {
    // ... (this function remains unchanged)
}

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

async function loadChatHistory(sessionId) {
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) return;
    messagesList.innerHTML = ''; // Clear previous messages

    const records = await api.fetchChatMessages(sessionId);
    // Reverse the records so the oldest messages are first
    records.reverse().forEach(record => {
        const { SenderID, SenderName, Content } = record.fields;
        const isSent = SenderID === currentUser.id;
        addMessageToUI(SenderName, Content, isSent);
    });
}

function bindMessageEvents() {
    channel.bind('client-new-message', (data) => {
        if (data.senderId !== currentUser.id) {
            addMessageToUI(data.senderName, data.content, false);
        }
    });
}

function bindPresenceEvents() {
    // ... (this function remains unchanged)
}

export async function initializeChat() {
    currentUser = getSimpleUserIdentity();
    const sessionId = state.session.id || 'default-session';

    // Load existing messages from Airtable first
    await loadChatHistory(sessionId);

    const pusher = new Pusher('YOUR_PUSHER_KEY', {
        cluster: 'YOUR_PUSHER_CLUSTER',
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

export async function sendMessage(message) {
    if (!channel || !currentUser) return;

    const sessionId = state.session.id || 'default-session';
    
    // 1. Persist the message to Airtable
    await api.postChatMessage(sessionId, currentUser.id, currentUser.name, message);

    // 2. Trigger the event for other clients
    channel.trigger('client-new-message', {
        content: message,
        senderId: currentUser.id,
        senderName: currentUser.name
    });
    
    // 3. Add our own message to our UI immediately
    addMessageToUI(currentUser.name, message, true);
}
