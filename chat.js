import { state } from './state.js';
import { log } from './utils/debug.js';
import { postChatMessage, fetchChatMessages } from './api.js';
import Pusher from 'https://js.pusher.com/8.2.0/pusher.min.js';

// Current user (set during auth or session load)
let currentUser = { id: null, name: null };
let isReplyingTo = null;

// Initialize Pusher for real-time chat
const pusherClient = new Pusher('YOUR_PUSHER_KEY', {
    cluster: 'YOUR_PUSHER_CLUSTER',
    authEndpoint: '/api/pusher-auth'
});

// Initialize chat system
export async function initializeChat(sessionId, userId, userName) {
    log('Chat', `Initializing chat for session ${sessionId}, user ${userName}`);
    currentUser = { id: userId, name: userName };
    state.session.id = sessionId;

    // Subscribe to Pusher channel
    const channel = pusherClient.subscribe(`chat-${sessionId}`);
    channel.bind('new-message', (data) => {
        log('Chat', `Received new message via Pusher: ${data.messageId}`);
        fetchAndRenderSingleMessage(data.messageId);
    });

    // Load and render chat history
    await loadChatHistory();

    // Setup form submit listener
    const chatForm = document.getElementById('chat-form');
    if (chatForm) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('message-input');
            const content = input.value.trim();
            if (!content) return;

            const parentMessageId = isReplyingTo ? isReplyingTo.id : null;
            const newMessage = await postChatMessage(state.session.id, currentUser.id, currentUser.name, content, parentMessageId);
            
            if (newMessage) {
                addMessageToUI(newMessage, !!parentMessageId); // Add locally for instant feedback
            }

            input.value = '';
            if (isReplyingTo) {
                isReplyingTo = null;
                updateReplyUI();
            }
        });
    } else {
        log('Chat', 'Chat form not found in DOM');
    }
}

// Fetch and render a single message (used for real-time updates)
async function fetchAndRenderSingleMessage(messageId) {
    const url = `https://api.airtable.com/v0/${state.airtable.baseId}/Messages/${messageId}`;
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${state.airtable.token}` }
        });
        if (!response.ok) throw new Error('Failed to fetch single message');
        const messageRecord = await response.json();
        const isReply = !!messageRecord.fields.ParentMessage;
        addMessageToUI(messageRecord, isReply);
    } catch (error) {
        log('Chat', `Error fetching single message ${messageId}: ${error.message}`);
    }
}

// Load and render chat history
async function loadChatHistory() {
    log('Chat', `Loading chat history for session ${state.session.id}`);
    const messages = await fetchChatMessages(state.session.id);
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) {
        log('Chat', 'Messages list container not found in DOM');
        return;
    }
    messagesList.innerHTML = ''; // Clear existing messages
    messages.forEach(message => {
        const isReply = !!message.fields.ParentMessage;
        addMessageToUI(message, isReply);
    });
    messagesList.scrollTop = messagesList.scrollHeight; // Scroll to bottom
}

// Add a message to the UI
function addMessageToUI(messageRecord, isReply = false) {
    const messagesList = document.getElementById('messages-list');
    if (!messagesList || !messageRecord.fields) {
        log('Chat', 'Messages list or message fields missing');
        return;
    }

    const { SenderID, SenderName, Content, Reactions } = messageRecord.fields;
    const isSent = SenderID === currentUser.id;
    const messageId = messageRecord.id;

    let reactionsData = {};
    try { reactionsData = JSON.parse(Reactions || '{}'); } catch (e) {
        log('Chat', `Failed to parse reactions for message ${messageId}: ${e.message}`);
    }

    const elementId = `message-${messageId}`;
    if (document.getElementById(elementId)) {
        updateReactionsUI(elementId, reactionsData);
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'} ${isReply ? 'is-reply' : ''}`;
    wrapper.id = elementId;
    wrapper.dataset.messageId = messageId;

    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';

    const senderElement = document.createElement('div');
    senderElement.className = 'sender';
    senderElement.innerText = isSent ? 'You' : SenderName;
    messageElement.appendChild(senderElement);
    messageElement.append(document.createTextNode(Content));

    const timestampElement = document.createElement('div');
    timestampElement.className = 'timestamp';
    timestampElement.innerText = new Date(messageRecord.createdTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    const reactionsContainer = document.createElement('div');
    reactionsContainer.className = 'reactions-container';
    
    const reactButton = document.createElement('button');
    reactButton.className = 'react-btn';
    reactButton.textContent = '😊+';
    reactButton.title = 'Add Reaction';
    messageElement.appendChild(reactButton);

    if (!isReply) {
        const replyButton = document.createElement('button');
        replyButton.className = 'reply-btn';
        replyButton.textContent = '↩';
        replyButton.title = 'Reply';
        messageElement.appendChild(replyButton);
        replyButton.addEventListener('click', () => {
            isReplyingTo = { id: messageId, author: SenderName };
            updateReplyUI();
        });
    }
    
    wrapper.appendChild(messageElement);
    wrapper.appendChild(reactionsContainer);
    wrapper.appendChild(timestampElement);
    
    const parentId = isReply && messageRecord.fields.ParentMessage ? messageRecord.fields.ParentMessage[0] : null;
    const parentContainer = parentId ? document.getElementById(`message-${parentId}`) : messagesList;
    
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
        
        const pickerWidth = 350, pickerHeight = 450;
        let newX = e.clientX, newY = e.clientY;
        if (newX + pickerWidth > window.innerWidth) newX = window.innerWidth - pickerWidth - 10;
        if (newY + pickerHeight > window.innerHeight) newY = window.innerHeight - pickerHeight - 10;
        picker.style.left = `${newX}px`;
        picker.style.top = `${newY}px`;
        picker.style.display = 'block';

        const emojiSelectedHandler = async (event) => {
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

    if (!isReply) wrapper.scrollIntoView({ behavior: 'smooth' });
}

// Update reactions UI (stub; implement as needed)
function updateReactionsUI(elementId, reactionsData) {
    const container = document.querySelector(`#${elementId} .reactions-container`);
    if (!container) return;
    container.innerHTML = '';
    Object.entries(reactionsData).forEach(([emoji, users]) => {
        const span = document.createElement('span');
        span.textContent = `${emoji} ${users.length}`;
        span.className = 'reaction';
        span.style.marginRight = '5px';
        container.appendChild(span);
    });
}

// Update reply UI (stub; implement based on your UI)
function updateReplyUI() {
    const replyContainer = document.getElementById('reply-container');
    if (!replyContainer) return;
    if (isReplyingTo) {
        replyContainer.style.display = 'block';
        replyContainer.innerText = `Replying to ${isReplyingTo.author}`;
    } else {
        replyContainer.style.display = 'none';
        replyContainer.innerText = '';
    }
}
