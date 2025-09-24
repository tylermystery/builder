// FILE: chat.js
import { state, setState } from './state.js';
import * as api from './api.js';
import { log } from './utils/debug.js';
import { triggerSave } from './events.js';

let currentUser = null;
let sessionChatChannel = null;
const itemChatChannels = new Map(); // A new map to hold channels for each item modal
const FUN_ADJECTIVES = ['Happy', 'Clever', 'Sunny', 'Lucky', 'Creative', 'Brave', 'Sparkling', 'Cosmic', 'Witty', 'Zesty'];
const FUN_NOUNS = ['Panda', 'Wombat', 'Explorer', 'Starship', 'Juggler', 'Wizard', 'Dolphin', 'Robot', 'Pineapple', 'Comet'];

// --- Tab Title Notification Logic ---
let originalTitle = document.title;
let isTabActive = true;
window.addEventListener('focus', () => {
  isTabActive = true;
  document.title = originalTitle; // Change title back when tab is viewed
});
window.addEventListener('blur', () => {
  isTabActive = false;
});
// --- End of Tab Title Logic ---

function generateFunName() {
    const adj = FUN_ADJECTIVES[Math.floor(Math.random() * FUN_ADJECTIVES.length)];
    const noun = FUN_NOUNS[Math.floor(Math.random() * FUN_NOUNS.length)];
    return `${adj} ${noun}`;
}

function getSimpleUserIdentity() {
    if (currentUser) return currentUser;

    // Step 1: Always ensure a base "fun name" identity exists for this browser session.
    let userId = localStorage.getItem('chatUserId');
    if (!userId) {
        userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('chatUserId', userId);
    }

    let userName = localStorage.getItem('chatUserName');
    if (!userName || userName.split(' ').length !== 3) {
        userName = generateFunName();
        localStorage.setItem('chatUserName', userName);
    }

    // Step 2: Check if the user is authenticated.
    const authenticatedUser = state.session.user;
    if (authenticatedUser && authenticatedUser.isAuthenticated) {
        const funNameParts = userName.split(' ');
        const realFirstName = authenticatedUser.name.split(' ')[0];

        if (funNameParts.length === 2) {
            const newName = `${funNameParts[0]} ${realFirstName} ${funNameParts[1]}`;
            userName = newName;
            localStorage.setItem('chatUserName', newName);
        }
        currentUser = { id: authenticatedUser.id, name: userName };
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

function addMessageToUI(messagesList, sender, message, isSent, timestamp, isAdmin, messageId, senderId) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'}`;

    const messageElement = document.createElement('div');
    // Check if the sender is flagged or banned
    const isFlagged = state.session.flaggedUsers.has(senderId);
    const isBanned = state.session.bannedUsers.has(senderId);

    // Apply censorship if flagged or banned
    const displayMessage = (isFlagged || isBanned) ? '[CENSORED BY MODERATOR]' : message;
    
    messageElement.className = 'chat-message';
    if (isBanned) messageElement.classList.add('banned');
    if (isFlagged) messageElement.classList.add('flagged');

    const senderElement = document.createElement('div');
    senderElement.className = 'sender';
    senderElement.innerText = isSent ? 'You' : sender;
    
    // Add moderation actions for admins
    if (state.session.user.isOwner && !isSent) {
      const moderationActions = document.createElement('div');
      moderationActions.className = 'moderation-actions';
      const flagBtn = document.createElement('button');
      flagBtn.textContent = isFlagged ? '✅ Un-Flag' : '⚠️ Flag';
      flagBtn.className = 'flag-btn';
      flagBtn.addEventListener('click', async () => {
        // Here, we would call a serverless function to update the user's status.
        // For now, we'll simulate the state change.
        if (isFlagged) {
          state.session.flaggedUsers.delete(senderId);
        } else {
          state.session.flaggedUsers.add(senderId);
        }
        await api.updateUserFlagStatus(senderId, !isFlagged);
        // Re-render chat to reflect changes
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
        updatePresenceUI(members);
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

// --- Main Session Chat Logic (Existing Widget) ---
export async function initializeSessionChat() {
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
      const records = await api.fetchChatMessages(sessionId);
      records.forEach(record => {
          const { SenderID, SenderName, Content, Timestamp } = record.fields;
          const isSent = SenderID === currentUser.id;
          addMessageToUI(messagesList, SenderName, Content, isSent, Timestamp, false, null, SenderID);
      });
    }

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
    sessionChatChannel = pusher.subscribe(channelName);

    bindPresenceEvents();
    sessionChatChannel.bind('client-new-message', (data) => {
        if (data.senderId !== currentUser.id) {
            addMessageToUI(messagesList, data.senderName, data.content, false, data.timestamp, false, null, data.senderId);
            showNewMessageNotification(data.senderName, data.content);
            if (!isTabActive) {
                document.title = 'New Message! - ' + originalTitle;
            }
        }
    });

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

// --- New Item-Specific Chat Logic ---
export async function initializeItemChat(recordId) {
    log('Chat', `Initializing item chat for recordId: ${recordId}`);
    if (!state.session.user.isAuthenticated) {
        // Hide chat or show a message if not authenticated
        document.getElementById('modal-chat-container').style.display = 'none';
        return;
    }
    document.getElementById('modal-chat-container').style.display = 'block';

    currentUser = getCurrentUser();
    const messagesList = document.getElementById('messages-list-item');
    const messageForm = document.getElementById('message-form-item');
    const messageInput = document.getElementById('message-input-item');
    
    // Clear old messages
    messagesList.innerHTML = '';
    
    // Unsubscribe from any previous item chat
    itemChatChannels.forEach((channel) => channel.unsubscribe());
    itemChatChannels.clear();
    
    // Fetch and display chat history
    const records = await api.fetchItemChatMessages(recordId);
    records.forEach(record => {
      const { SenderID, SenderName, Content, Timestamp } = record.fields;
      const isSent = SenderID === currentUser.id;
      addMessageToUI(messagesList, SenderName, Content, isSent, Timestamp, false, null, SenderID);
    });

    // Setup Pusher for the new item channel
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

    // Bind real-time events for the item chat
    channel.bind('client-new-message-item', (data) => {
        if (data.senderId !== currentUser.id) {
            addMessageToUI(messagesList, data.senderName, data.content, false, data.timestamp, false, null, data.senderId);
        }
    });
    
    // Handle form submission
    const handleMessageSubmit = (e) => {
        e.preventDefault();
        const message = messageInput.value;
        if (message.trim() === '') return;
        sendMessage(message, recordId);
        messageInput.value = '';
    };

    messageForm.removeEventListener('submit', handleMessageSubmit);
    messageForm.addEventListener('submit', handleMessageSubmit);
}

// --- Moderation Functions (Client-side stubs for now) ---
// These functions will be called by a new UI in the chat messages
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
    // This function will need to be implemented on the backend to mark a message for review.
    // For now, let's update the state
}
