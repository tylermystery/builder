import { state } from './state.js';
import { log } from './utils/debug.js';
import { postChatMessage, fetchChatMessages } from './api.js';

// Current user (set during auth or session load)
let currentUser = { id: null, name: null };
let isReplyingTo = null;

// Initialize Pusher for real-time chat (using global Pusher from script tag)
const pusherClient = window.Pusher ? new window.Pusher('YOUR_PUSHER_KEY', {
    cluster: 'YOUR_PUSHER_CLUSTER',
    authEndpoint: '/api/pusher-auth'
}) : null;

// Initialize chat system
export async function initializeChat(sessionId, userId, userName) {
    log('Chat', `Initializing chat for session ${sessionId}, user ${userName}`);
    if (!pusherClient) {
        log('Chat', 'Pusher not available; real-time updates disabled');
    }
    currentUser = { id: userId, name: userName };
    state.session.id = sessionId;

    // Subscribe to Pusher channel if available
    if (pusherClient) {
        const channel = pusherClient.subscribe(`chat-${sessionId}`);
        channel.bind('new-message', (data) => {
            log('Chat', `Received new message via Pusher: ${data.messageId}`);
            fetchAndRenderSingleMessage(data.messageId);
        });
    }

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
                if (pusherClient) {
                    pusherClient.trigger(`chat-${sessionId}`, 'new-message', { messageId: newMessage.id });
                }
            } else {
                log('Chat', 'Failed to post message; not adding to UI');
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
    const url = `https://api.airtable.com/v0/app5yTznb3R5YNUFw/Messages/${messageId}`; // Use BASE_ID directly
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57` }
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
    // Use Timestamp field if available, else fall back to createdTime
    const timestamp = messageRecord.fields.Timestamp || messageRecord.createdTime;
    timestampElement.innerText = new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

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
    
    if (parentContainer || messagesList) {
        (parentContainer || messagesList).appendChild(wrapper);
    } else {
        log('Chat', `Parent container ${parentId} not found; appending to messagesList`);
        messagesList.appendChild(wrapper);
    }

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

// Update reactions UI
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

// Update reply UI
function updateReplyUI() {
    const replyContainer = document.getElementById('reply-container');
    if (!replyContainer) {
        log('Chat', 'Reply container not found in DOM');
        return;
    }
    if (isReplyingTo) {
        replyContainer.style.display = 'block';
        replyContainer.innerText = `Replying to ${isReplyingTo.author}`;
    } else {
        replyContainer.style.display = 'none';
        replyContainer.innerText = '';
    }
}
