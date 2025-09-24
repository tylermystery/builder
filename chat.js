import { state } from './state.js';
import * as api from './api.js';
import { log } from './utils/debug.js';
import { triggerSave } from './events.js';

let currentUser = null;
let channel = null;
let isReplyingTo = null; // State to track which message is being replied to
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

    const messageMap = new Map();
    const topLevelMessages = [];

    records.forEach(record => {
        messageMap.set(record.id, { ...record, replies: [] });
    });

    records.forEach(record => {
        const parentId = record.fields.ParentMessage ? record.fields.ParentMessage[0] : null;
        if (parentId && messageMap.has(parentId)) {
            messageMap.get(parentId).replies.push(messageMap.get(record.id));
        } else {
            topLevelMessages.push(messageMap.get(record.id));
        }
    });

    topLevelMessages.forEach(message => {
        addMessageToUI(message, false);
        message.replies.forEach(reply => addMessageToUI(reply, true));
    });
}

function addMessageToUI(messageRecord, isReply = false) {
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) return;

    const { SenderID, SenderName, Content, Timestamp, Reactions } = messageRecord.fields;
    const isSent = SenderID === currentUser.id;
    const messageId = messageRecord.id;

    let reactionsData = {};
    try { reactionsData = JSON.parse(Reactions || '{}'); } catch (e) {}

    const elementId = `message-${messageId}`;
    if (document.getElementById(elementId)) return;

    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'} ${isReply ? 'is-reply' : ''}`;
    wrapper.id = elementId;
    wrapper.dataset.messageId = messageId;

    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';

    const senderElement = document.createElement('div');
    senderElement.className = 'sender';
    senderElement.innerText = isSent ? 'You' : sender;
    messageElement.appendChild(senderElement);
    messageElement.append(document.createTextNode(Content));

    const timestampElement = document.createElement('div');
    timestampElement.className = 'timestamp';
    timestampElement.innerText = new Date(Timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    const reactionsContainer = document.createElement('div');
    reactionsContainer.className = 'reactions-container';

    const reactButton = document.createElement('button');
    reactButton.className = 'react-btn';
    reactButton.textContent = '😊+';
    reactButton.title = 'Add Reaction';
    messageElement.appendChild(reactButton);

    const replyButton = document.createElement('button');
    replyButton.className = 'reply-btn';
    replyButton.textContent = '↩';
    replyButton.title = 'Reply';
    messageElement.appendChild(replyButton);
    
    wrapper.appendChild(messageElement);
    wrapper.appendChild(reactionsContainer);
    wrapper.appendChild(timestampElement);
    
    const parentContainer = isReply ? document.getElementById(`message-${messageRecord.fields.ParentMessage[0]}`)?.parentElement : messagesList;
    (parentContainer || messagesList).appendChild(wrapper);

    updateReactionsUI(elementId, reactionsData);

    reactButton.addEventListener('click', (e) => {
        e.stopPropagation();
        let picker = document.querySelector('emoji-picker');
        if (!picker) {
            picker = document.createElement('emoji-picker');
            document.body.appendChild(picker);
            picker.style.position = 'fixed';
            picker.style.zIndex = '1100';
        }
        
        const pickerWidth = 350;
        const pickerHeight = 450;
        let newX = e.clientX;
        let newY = e.clientY;

        if (newX + pickerWidth > window.innerWidth) newX = window.innerWidth - pickerWidth - 10;
        if (newY + pickerHeight > window.innerHeight) newY = window.innerHeight - pickerHeight - 10;
        
        picker.style.left = `${newX}px`;
        picker.style.top = `${newY}px`;
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

    replyButton.addEventListener('click', () => {
        isReplyingTo = { id: messageId, author: SenderName };
        updateReplyUI();
    });

    wrapper.scrollIntoView({ behavior: 'smooth' });
}

function updateReplyUI() {
    const replyIndicator = document.getElementById('reply-indicator');
    const messageInput = document.getElementById('message-input');
    if (!replyIndicator || !messageInput) return;

    if (isReplyingTo) {
        replyIndicator.innerHTML = `Replying to <strong>${isReplyingTo.author}</strong> <button id="cancel-reply-btn">×</button>`;
        replyIndicator.style.display = 'flex';
        messageInput.focus();

        document.getElementById('cancel-reply-btn').addEventListener('click', () => {
            isReplyingTo = null;
            updateReplyUI();
        });
    } else {
        replyIndicator.innerHTML = '';
        replyIndicator.style.display = 'none';
    }
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
    channel.bind('pusher:member_added', () => updatePresenceUI(channel.members));
    channel.bind('pusher:member_removed', () => updatePresenceUI(channel.members));
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
        auth: { params: { user_id: currentUser.id, user_name: currentUser.name } }
    });
    
    const channelName = `presence-session-${sessionId}`;
    channel = pusher.subscribe(channelName);

    bindPresenceEvents();

    channel.bind('client-new-message', (data) => {
        if (data.senderId !== currentUser.id) {
            // Find the message in Airtable to see if it's a reply
            // This part is complex; for now, we render all new messages as top-level
            addMessageToUI({ fields: { ...data, SenderID: data.senderId, SenderName: data.senderName, Content: data.content, Timestamp: data.timestamp } });
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
          if (permission === 'granted') log('Chat', 'Notification permission granted.');
        });
      }
    }
}

export async function sendMessage(message) {
    if (!channel || !currentUser) return;
    const sessionId = state.session.id || 'default-session';
    const parentId = isReplyingTo ? isReplyingTo.id : null;

    // Post to Airtable, which will then trigger a reload via Pusher for all clients
    await api.postChatMessage(sessionId, currentUser.id, currentUser.name, message, parentId);
    
    isReplyingTo = null;
    updateReplyUI();

    // Reload the chat history for all to see the new message in its proper thread
    // This is a simple but effective way to handle real-time threading
    pusher.trigger(channel.name, 'reload-chat-history', {});
}

export function getCurrentUser() {
    return currentUser || getSimpleUserIdentity();
}

function showNewMessageNotification(sender, message) {
  if (Notification.permission === 'granted' && !document.hasFocus()) {
    const notification = new Notification(`New message from ${sender}`, { body: message });
    setTimeout(notification.close.bind(notification), 4000);
  }
}
