// REPLACE THE ENTIRE CONTENTS OF: chat.js

import { state, setState } from './state.js';
import * as api from './api.js';
import { log } from './utils/debug.js';
import { triggerSave, openChatWidget } from './events.js';

let currentUser = null;
let pusher = null;
let sessionChatChannel = null;
const itemChatChannels = new Map();
const FUN_ADJECTIVES = ['Happy', 'Clever', 'Sunny', 'Lucky', 'Creative', 'Brave', 'Sparkling', 'Cosmic', 'Witty', 'Zesty'];
const FUN_NOUNS = ['Panda', 'Wombat', 'Explorer', 'Starship', 'Juggler', 'Wizard', 'Dolphin', 'Robot', 'Pineapple', 'Comet'];
let originalTitle = document.title;
let isTabActive = true;

window.addEventListener('focus', () => {
  isTabActive = true;
  document.title = originalTitle;
});
window.addEventListener('blur', () => {
  isTabActive = false;
});

function requestNotificationPermissionIfNeeded() {
    if ('Notification' in window) {
      if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            log('Chat', 'Notification permission granted.');
          }
        });
      }
    }
}

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
    const authenticatedUser = state.session.user;
    if (authenticatedUser && authenticatedUser.isAuthenticated) {
        currentUser = { id: authenticatedUser.id, name: authenticatedUser.name };
    } else {
        currentUser = { id: userId, name: userName };
    }
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
            const profileId = state.session.user.isAuthenticated ? state.session.user.id : member.id;
            const profileName = state.session.user.isAuthenticated ? state.session.user.name : member.info.name;
            if (!state.session.userProfiles.has(profileId)) {
                state.session.userProfiles.set(profileId, profileName);
                triggerSave();
            }
 
            const userElement = document.createElement('div');
            const displayName = member.id === currentUser.id ? currentUser.name : member.info.name;
            userElement.innerText = `🟢 ${displayName} ${member.id === currentUser.id ? '(You)' : ''}`;
            whosHereList.appendChild(userElement);
        });
    }
}
function addMessageToUI(messagesList, sender, message, isSent, timestamp, isAdmin, messageId, senderId) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'}`;
    const messageElement = document.createElement('div');
    const isFlagged = state.session.flaggedUsers.has(senderId);
    const isBanned = state.session.bannedUsers.has(senderId);
    const displayMessage = (isFlagged || isBanned) ? '[CENSORED BY MODERATOR]' : message;
    messageElement.className = 'chat-message';
    if (isBanned) messageElement.classList.add('banned');
    if (isFlagged) messageElement.classList.add('flagged');
    const senderElement = document.createElement('div');
    senderElement.className = 'sender';
    senderElement.innerText = isSent ? 'You' : sender;
    if (state.session.user.isOwner && !isSent) {
      const moderationActions = document.createElement('div');
      moderationActions.className = 'moderation-actions';
      const flagBtn = document.createElement('button');
      flagBtn.textContent = isFlagged ? '✅ Un-Flag' : '⚠️ Flag';
      flagBtn.className = 'flag-btn';
      flagBtn.addEventListener('click', async () => {
        if (isFlagged) {
          state.session.flaggedUsers.delete(senderId);
        } else {
          state.session.flaggedUsers.add(senderId);
        }
        await api.updateUserFlagStatus(senderId, !isFlagged);
        const currentModalRecordId = document.getElementById('detail-modal-overlay')?.dataset.recordId;
        if (currentModalRecordId) {
            initializeItemChat(currentModalRecordId);
     
        }
      });
      const banBtn = document.createElement('button');
      banBtn.textContent = '⛔ Ban';
      banBtn.className = 'ban-btn';
      banBtn.addEventListener('click', async () => {
        await api.banUser(senderId);
      });
      moderationActions.appendChild(flagBtn);
      moderationActions.appendChild(banBtn);
      messageElement.appendChild(moderationActions);
    }
    messageElement.appendChild(senderElement);
    messageElement.append(document.createTextNode(displayMessage));
    const timestampElement = document.createElement('div');
    timestampElement.className = 'timestamp';
    const date = timestamp ? new Date(timestamp) : new Date();
    timestampElement.innerText = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    wrapper.appendChild(messageElement);
    wrapper.appendChild(timestampElement);
    messagesList.appendChild(wrapper);
    wrapper.scrollIntoView({ behavior: 'smooth' });
}

function bindPresenceEvents() {
    sessionChatChannel.bind('pusher:subscription_succeeded', (members) => {
        const messageInput = document.getElementById('message-input');
        const messageForm = document.getElementById('message-form');
        if (messageInput && messageForm) {
            messageInput.disabled = false;
            messageForm.querySelector('button').disabled = false;
            messageInput.placeholder = 'Type a message...';
        }
        updatePresenceUI(members);
        
        // --- THIS IS THE FIX ---
        // If there's more than one person in the channel, auto-open the chat.
        if (members.count > 1) {
            openChatWidget(true); // passing true keeps it open
        }
        // --- END FIX ---
    });
    sessionChatChannel.bind('pusher:member_added', (member) => {
        updatePresenceUI(sessionChatChannel.members);
    });
    sessionChatChannel.bind('pusher:member_removed', (member) => {
        updatePresenceUI(sessionChatChannel.members);
    });
}
export function getCurrentUser() {
    return currentUser || getSimpleUserIdentity();
}
function showNewMessageNotification(sender, message) {
  if (Notification.permission === 'granted' && !document.hasFocus()) {
    const notification = new Notification(`New message from ${sender}`, {
      body: message,
    });
    setTimeout(notification.close.bind(notification), 4000);
  }
}

// --- NEW DEBUG FUNCTION ---
function displayDebugMessage(message) {
    if (console.log) { // Check if debug is theoretically possible
        const messagesList = document.getElementById('messages-list');
        if (messagesList) {
            const debugEl = document.createElement('div');
            debugEl.className = 'chat-message received'; // Use a standard message style
            debugEl.style.color = '#dc3545';
            debugEl.style.fontSize = '0.7em';
            debugEl.innerHTML = `<strong>[DEBUG]</strong> ${message}`;
            messagesList.appendChild(debugEl);
            debugEl.scrollIntoView({ behavior: 'smooth' });
        }
    }
}
// --- END NEW DEBUG FUNCTION ---

export async function initializeSessionChat() {
    if (pusher) {
        pusher.disconnect();
        log('Chat', 'Disconnected from previous Pusher instance.');
    }

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
                updatePresenceUI(sessionChatChannel.members);
                triggerSave();
            } else {
                e.target.value = currentUser.name;
            }
   
        });
    }

    const messagesList = document.getElementById('messages-list');
    if (messagesList) {
        messagesList.innerHTML = '';
        //displayDebugMessage(`Loading history for Session ID: ${sessionId}`); // <-- ADD THIS
        const records = await api.fetchChatMessages(sessionId);
        
        if (records.length > 0) {
            //displayDebugMessage(`Found ${records.length} past messages.`); // <-- ADD THIS
            records.forEach(record => {
                const { SenderID, SenderName, Content, Timestamp } = record.fields;
                const isSent = SenderID === currentUser.id;
                addMessageToUI(messagesList, SenderName, Content, isSent, Timestamp, false, null, SenderID);
            });
        } else {
            //displayDebugMessage("No historical messages found for this session."); // <-- ADD THIS
        }
    }
  
    pusher = new Pusher('236f480714e5001590b5', {
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
    log('Chat', `Subscribing to Pusher channel: ${channelName}`);
    sessionChatChannel = pusher.subscribe(channelName);
    bindPresenceEvents();
    sessionChatChannel.bind('client-new-message', (data) => {
        if (data.senderId !== currentUser.id) {
            requestNotificationPermissionIfNeeded();
            addMessageToUI(messagesList, data.senderName, data.content, false, data.timestamp, false, null, data.senderId);
            showNewMessageNotification(data.senderName, data.content);
            if (!isTabActive) {
                document.title = 'New Message! - ' + originalTitle;
    
            }
        }
    });
}

export async function sendMessage(message, recordId = null) {
    if (recordId) {
        const channel = itemChatChannels.get(recordId);
        if (!channel || !currentUser) return;
        const timestamp = new Date().toISOString();
        const messagesList = document.getElementById('messages-list-item');
        addMessageToUI(messagesList, currentUser.name, message, true, timestamp, false, null, currentUser.id);
        await api.postItemChatMessage(recordId, currentUser.id, currentUser.name, message);
        channel.trigger('client-new-message-item', {
            content: message,
            senderId: currentUser.id,
            senderName: currentUser.name,
            timestamp: timestamp
        });
    } else {
        if (!sessionChatChannel || !currentUser) return;
        
        requestNotificationPermissionIfNeeded();
        const sessionId = state.session.id || 'default-session';
        const timestamp = new Date().toISOString();
        const messagesList = document.getElementById('messages-list');
        addMessageToUI(messagesList, currentUser.name, message, true, timestamp, false, null, currentUser.id);
        await api.postChatMessage(sessionId, currentUser.id, currentUser.name, message);
        sessionChatChannel.trigger('client-new-message', {
            content: message,
            senderId: currentUser.id,
            senderName: currentUser.name,
            timestamp: timestamp
        });
    }
}

export async function initializeItemChat(recordId) {
    log('Chat', `Initializing item chat for recordId: ${recordId}`);
    const chatContainer = document.getElementById('modal-chat-container');
    if (chatContainer) chatContainer.style.display = 'block';

    currentUser = getCurrentUser();
    const messagesList = document.getElementById('messages-list-item');
    const messageForm = document.getElementById('message-form-item');
    const messageInput = document.getElementById('message-input-item');

    // Guard against missing elements
    if (!messagesList) {
        console.warn('Chat: messages-list-item element not found');
        return;
    }
    if (!messageForm || !messageForm.parentNode) {
        console.warn('Chat: message-form-item element not found or not in DOM');
        return;
    }

    messagesList.innerHTML = '';
    itemChatChannels.forEach((channel) => channel.unsubscribe());
    itemChatChannels.clear();
    const records = await api.fetchItemChatMessages(recordId);
    records.forEach(record => {
      const { SenderID, SenderName, Content, Timestamp } = record.fields;
      const isSent = SenderID === currentUser.id;
      addMessageToUI(messagesList, SenderName, Content, isSent, Timestamp, false, null, SenderID);
    });
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
    const channelName = `presence-item-${recordId}`;
    const channel = pusher.subscribe(channelName);
    itemChatChannels.set(recordId, channel);
    channel.bind('client-new-message-item', (data) => {
        if (data.senderId !== currentUser.id) {
            addMessageToUI(messagesList, data.senderName, data.content, false, data.timestamp, false, null, data.senderId);
        }
    });
    const newForm = messageForm.cloneNode(true);
    messageForm.parentNode.replaceChild(newForm, messageForm);
    const newMessageInput = document.getElementById('message-input-item');
    newForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = newMessageInput.value;
        if (message.trim() === '') return;
        sendMessage(message, recordId);
        newMessageInput.value = '';
    });
}
export async function banUser(userId) {
    if (!state.session.user.isOwner) {
        log('Moderation', 'Permission denied: Not an owner.');
        return;
    }
    log('Moderation', `Banning user: ${userId}`);
    await api.banUser(userId);
}
export async function flagMessage(messageId) {
    if (!state.session.user.isOwner) {
        log('Moderation', 'Permission denied: Not an owner.');
        return;
    }
    log('Moderation', `Flagging message: ${messageId}`);
}
