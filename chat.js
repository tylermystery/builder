import { state } from './state.js';
import * as api from './api.js';
import { log } from './utils/debug.js';
import { triggerSave } from './events.js';

let currentUser = null;
let channel = null;
const FUN_ADJECTIVES = ['Happy', 'Clever', 'Sunny', 'Lucky', 'Creative', 'Brave', 'Sparkling', 'Cosmic', 'Witty', 'Zesty'];
const FUN_NOUNS = ['Panda', 'Wombat', 'Explorer', 'Starship', 'Juggler', 'Wizard', 'Dolphin', 'Robot', 'Pineapple', 'Comet'];

// --- Tab Title Notification Logic ---
let originalTitle = document.title;
let isTabActive = true;
window.addEventListener('focus', () => {
  isTabActive = true;
  document.title = originalTitle;
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
    
    let userId = localStorage.getItem('chatUserId');
    if (!userId) {
        userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('chatUserId', userId);
    }

    let userName = localStorage.getItem('chatUserName');
    if (!userName || userName.split(' ').length > 3) {
        userName = generateFunName();
        localStorage.setItem('chatUserName', userName);
    }

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

async function loadChatHistory(sessionId) {
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) return;
    messagesList.innerHTML = ''; 
    const records = await api.fetchChatMessages(sessionId);
    records.forEach(record => {
        const { SenderID, SenderName, Content, Timestamp, Reactions } = record.fields;
        const isSent = SenderID === currentUser.id;
        let reactionsData = {};
        try { reactionsData = JSON.parse(Reactions || '{}'); } catch(e) {}
        addMessageToUI(SenderName, Content, isSent, Timestamp, record.id, reactionsData);
    });
}

function addMessageToUI(sender, message, isSent, timestamp, messageId, reactionsData) {
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) return;

    const elementId = `message-${messageId || Date.now()}`;
    if (document.getElementById(elementId)) return;

    const wrapper = document.createElement('div');
    wrapper.className = isSent ? 'message-wrapper sent' : 'message-wrapper received';
    wrapper.id = elementId;
    wrapper.dataset.messageId = messageId;

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

    const reactionsContainer = document.createElement('div');
    reactionsContainer.className = 'reactions-container';
    
    const reactButton = document.createElement('button');
    reactButton.className = 'react-btn';
    reactButton.textContent = '😊+';
    reactButton.title = 'Add Reaction';
    messageElement.appendChild(reactButton);

    wrapper.appendChild(messageElement);
    wrapper.appendChild(reactionsContainer);
    wrapper.appendChild(timestampElement);
    messagesList.appendChild(wrapper);

    updateReactionsUI(elementId, reactionsData);

    reactButton.addEventListener('click', (e) => {
        e.stopPropagation();
        let picker = document.querySelector('emoji-picker');
        if (!picker) {
            picker = document.createElement('emoji-picker');
            document.body.appendChild(picker);
            picker.style.position = 'absolute';
            picker.style.zIndex = '1100';
        }
        
        picker.style.left = `${e.pageX}px`;
        picker.style.top = `${e.pageY}px`;
        picker.style.display = 'block';

        const emojiSelectedHandler = async (event) => {
            const currentUser = getCurrentUser();
            await fetch('/api/update-message-reaction', {
                method: 'POST',
                body: JSON.stringify({
                    messageId: messageId,
                    emoji: event.detail.emoji.unicode,
                    userId: currentUser.id,
                    sessionId: state.session.id
                })
            });
            picker.style.display = 'none';
            picker.removeEventListener('emoji-click', emojiSelectedHandler);
        };
        
        picker.addEventListener('emoji-click', emojiSelectedHandler);
    });

    wrapper.scrollIntoView({ behavior: 'smooth' });
}

function updateReactionsUI(elementId, reactionsData) {
    const messageWrapper = document.getElementById(elementId);
    if (!messageWrapper) return;
    const reactionsContainer = messageWrapper.querySelector('.reactions-container');
    
    reactionsContainer.innerHTML = '';
    if (reactionsData && Object.keys(reactionsData).length > 0) {
        for (const [emoji, users] of Object.entries(reactionsData)) {
            if (users.length > 0) {
                const reactionChip = document.createElement('span');
                reactionChip.className = 'reaction-chip';
                reactionChip.textContent = `${emoji} ${users.length}`;
                reactionsContainer.appendChild(reactionChip);
            }
        }
    }
}

function bindPresenceEvents() {
    channel.bind('pusher:subscription_succeeded', (members) => updatePresenceUI(members));
    channel.bind('pusher:member_added', (member) => updatePresenceUI(channel.members));
    channel.bind('pusher:member_removed', (member) => updatePresenceUI(channel.members));
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
            showNewMessageNotification(data.senderName, data.content);
            if (!isTabActive) {
                document.title = 'New Message! - ' + originalTitle;
            }
        }
    });

    channel.bind('reaction-updated', (data) => {
        const elementId = `message-${data.messageId}`;
        updateReactionsUI(elementId, data.reactions);
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

function showNewMessageNotification(sender, message) {
  if (Notification.permission === 'granted' && !document.hasFocus()) {
    const notification = new Notification(`New message from ${sender}`, {
      body: message,
    });
    setTimeout(notification.close.bind(notification), 4000);
  }
}
