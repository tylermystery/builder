// FILE: chat.js
import { state } from './state.js';
import * as api from './api.js';
import { log } from './utils/debug.js';
import { triggerSave } from './events.js';

let currentUser = null;
let channel = null;
const FUN_ADJECTIVES = ['Happy', 'Clever', 'Sunny', 'Lucky', 'Creative', 'Brave', 'Sparkling', 'Cosmic', 'Witty', 'Zesty'];
const FUN_NOUNS = ['Panda', 'Wombat', 'Explorer', 'Starship', 'Juggler', 'Wizard', 'Dolphin', 'Robot', 'Pineapple', 'Comet'];

function generateFunName() {
    const adj = FUN_ADJECTIVES[Math.floor(Math.random() * FUN_ADJECTIVES.length)];
    const noun = FUN_NOUNS[Math.floor(Math.random() * FUN_NOUNS.length)];
    return `${adj} ${noun}`;
}

function getSimpleUserIdentity() {
    if (currentUser) return currentUser;

    let userId = localStorage.getItem('chatUserId');
    if (!userId) {
        userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('chatUserId', userId);
    }

    let userName = localStorage.getItem('chatUserName');
    if (!userName) {
        userName = generateFunName();
        localStorage.setItem('chatUserName', userName);
    }
    
    currentUser = { id: userId, name: userName };
    return currentUser;
}

function updatePresenceUI(members) {
    const presenceCounter = document.getElementById('presence-counter');
    const whosHereCount = document.getElementById('whos-here-count');
    const whosHereList = document.getElementById('whos-here-list');
    const count = members.count;
    if (presenceCounter) presenceCounter.innerText = count;
    if (whosHereCount) whosHereCount.innerText = count;
    if (whosHereList) {
        whosHereList.innerHTML = '';
        members.each((member) => {
            if (!state.session.userProfiles.has(member.id)) {
                state.session.userProfiles.set(member.id, member.info.name);
                triggerSave();
            }
            const userElement = document.createElement('div');
            const displayName = member.id === currentUser.id ? currentUser.name : member.info.name;
            userElement.innerText = `🟢 ${displayName} ${member.id === currentUser.id ? '(You)' : ''}`;
            whosHereList.appendChild(userElement);
        });
    }
}

async function loadChatHistory(sessionId) {
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) return;
    messagesList.innerHTML = '';
    const records = await api.fetchChatMessages(sessionId);
    records.forEach(record => {
        const { SenderID, SenderName, Content, Timestamp } = record.fields;
        const isSent = SenderID === currentUser.id;
        addMessageToUI(SenderName, Content, isSent, Timestamp);
    });
}

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

    // FIX: Replace the old scrolling logic with this more reliable method.
    wrapper.scrollIntoView({ behavior: 'smooth' });
}

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

export async function initializeChat() {
    currentUser = getSimpleUserIdentity();
    if (!state.session.userProfiles.has(currentUser.id)) {
        state.session.userProfiles.set(currentUser.id, currentUser.name);
    }
    
    const sessionId = state.session.id || 'default-session';
    const chatUserNameInput = document.getElementById('chat-user-name');
    if (chatUserNameInput) {
        chatUserNameInput.value = currentUser.name;
        chatUserNameInput.addEventListener('change', (e) => {
            const newName = e.target.value.trim();
            if (newName && newName !== currentUser.name) {
                currentUser.name = newName;
                localStorage.setItem('chatUserName', newName);
                state.session.userProfiles.set(currentUser.id, newName);
                log('Chat', `User name changed to: ${newName}`);
                updatePresenceUI(channel.members);
                triggerSave();
            } else {
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
                user_name: currentUser.name
            }
        }
    });
    const channelName = `presence-session-${sessionId}`;
    channel = pusher.subscribe(channelName);

    bindPresenceEvents();
    channel.bind('client-new-message', (data) => {
        if (data.senderId !== currentUser.id) {
            addMessageToUI(data.senderName, data.content, false, data.timestamp);
        }
    });
}

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
