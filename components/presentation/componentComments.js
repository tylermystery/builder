/**
 * Component Comments
 * Comment system for plan elements (items, headers) with nested replies,
 * reactions, image attachments, and task creation from comments.
 * Extracted from presentation.js — Phase 2 modularization.
 */

import { state } from '../../state.js';
import * as api from '../../api.js';
import { log } from '../../utils/debug.js';
import { getCurrentUser } from '../../chat.js';
import { showToast } from '../../ui.js';
import { applyCloudinaryTransform } from '../../utils/imageOptimizer.js';
import { resizeImageForUpload } from '../../utils/imageResizer.js';

// Quick reaction emojis for comment reaction picker
const QUICK_REACTIONS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F389}'];

// Task status options for plan elements
const ELEMENT_TASK_STATUS = {
    NONE: 'none',           // Default - no status set
    GTG: 'gtg',             // Good to go / confirmed
    NO_ACTION: 'no-action', // No action needed
    CHECK: 'check',         // Needs checking
    NEEDS_ATTENTION: 'needs-attention' // Needs attention
};

// Task status labels and icons
const TASK_STATUS_CONFIG = {
    [ELEMENT_TASK_STATUS.NONE]: { label: 'Set Status', icon: '\u25CB', className: 'task-status-none' },
    [ELEMENT_TASK_STATUS.GTG]: { label: 'Good to Go', icon: '\u2713', className: 'task-status-gtg' },
    [ELEMENT_TASK_STATUS.NO_ACTION]: { label: 'No Action', icon: '\u2014', className: 'task-status-no-action' },
    [ELEMENT_TASK_STATUS.CHECK]: { label: 'Check', icon: '?', className: 'task-status-check' },
    [ELEMENT_TASK_STATUS.NEEDS_ATTENTION]: { label: 'Needs Attention', icon: '!', className: 'task-status-attention' }
};

// Cache for component comments - keyed by componentType:componentId
const componentCommentsCache = new Map();

// Track component comment reply state (separate from chat reply)
let componentCommentReplyingTo = null;

// Dependencies injected via init()
let getRecordById = null;
let escapeHtml = null;
let addImageToItemCarousel = null;
let addPresentationMessageToUI = null;
let getChannel = null;
let getChatMessagesEl = null;
let saveCommentTaskLink = null;

/**
 * Initialize the component comments module.
 * @param {Object} deps
 * @param {Function} deps.getRecordById - Function to get record by ID
 * @param {Function} deps.escapeHtml - Function to escape HTML
 * @param {Function} deps.addImageToItemCarousel - Function to add image to item carousel
 * @param {Function} deps.addPresentationMessageToUI - Function to add message to chat UI
 * @param {Function} deps.getChannel - Function to get Pusher channel
 * @param {Function} deps.getChatMessagesEl - Function to get chatMessagesEl DOM element
 * @param {Function} deps.saveCommentTaskLink - Function to persist comment-task links
 */
export function init(deps) {
    getRecordById = deps.getRecordById;
    escapeHtml = deps.escapeHtml;
    addImageToItemCarousel = deps.addImageToItemCarousel;
    addPresentationMessageToUI = deps.addPresentationMessageToUI;
    getChannel = deps.getChannel;
    getChatMessagesEl = deps.getChatMessagesEl;
    saveCommentTaskLink = deps.saveCommentTaskLink;
}

/**
 * Cleanup module state.
 */
export function cleanup() {
    componentCommentsCache.clear();
    componentCommentReplyingTo = null;
}

/**
 * Get the comments cache (for read access from presentation.js RSB panel).
 * @returns {Map}
 */
export function getCache() {
    return componentCommentsCache;
}

/**
 * Handle click events for component comments
 */
export function handleComponentCommentsClick(e) {
    // Handle toggle button clicks
    const toggleBtn = e.target.closest('.component-comments-toggle');
    if (toggleBtn) {
        e.stopPropagation();
        const componentId = toggleBtn.dataset.componentId;
        toggleComponentComments(componentId);
        return;
    }

    // Handle submit button clicks
    const submitBtn = e.target.closest('.component-comment-submit');
    if (submitBtn) {
        e.stopPropagation();
        const componentId = submitBtn.dataset.componentId;
        submitComponentComment(componentId);
        return;
    }

    // Handle image button clicks (trigger file input)
    const imageBtn = e.target.closest('.comment-image-btn');
    if (imageBtn) {
        e.stopPropagation();
        const componentId = imageBtn.dataset.componentId;
        console.log('[CommentImage DEBUG] Camera button clicked for componentId:', componentId);
        const fileInput = document.querySelector(`.comment-image-input[data-component-id="${componentId}"]`);
        console.log('[CommentImage DEBUG] fileInput found:', !!fileInput);
        if (fileInput) {
            fileInput.click();
            console.log('[CommentImage DEBUG] fileInput.click() triggered');
        }
        return;
    }

    // Handle image preview remove button
    const removeBtn = e.target.closest('.comment-preview-remove');
    if (removeBtn) {
        e.stopPropagation();
        const componentId = removeBtn.dataset.componentId;
        console.log('[CommentImage DEBUG] Remove button clicked for componentId:', componentId);
        clearCommentImagePreview(componentId);
        return;
    }

    // Handle comment action buttons (edit, delete, react)
    const actionBtn = e.target.closest('.comment-action-btn');
    if (actionBtn) {
        e.stopPropagation();
        e.preventDefault();
        const action = actionBtn.dataset.action;
        const commentId = actionBtn.closest('.component-comment').dataset.commentId;
        console.log('[ComponentComment DEBUG] Comment action button clicked:', action, commentId);
        handleCommentAction(action, commentId);
        return;
    }

    // Handle reaction badge clicks on comments
    const reactionBadge = e.target.closest('.comment-reaction-badge');
    if (reactionBadge) {
        e.stopPropagation();
        const commentId = reactionBadge.closest('.component-comment').dataset.commentId;
        const emoji = reactionBadge.dataset.emoji;
        toggleCommentReaction(commentId, emoji);
        return;
    }
}

/**
 * Handle keydown events for component comment inputs
 */
export function handleComponentCommentsKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        const input = e.target.closest('.component-comment-input');
        if (input) {
            e.preventDefault();
            const componentId = input.dataset.componentId;
            submitComponentComment(componentId);
        }
    }
}

/**
 * Handle file input change for comment image attachments
 */
export function handleCommentImageInputChange(e) {
    const fileInput = e.target;
    if (!fileInput.classList.contains('comment-image-input')) return;

    const componentId = fileInput.dataset.componentId;
    const file = fileInput.files?.[0];

    console.log('[CommentImage DEBUG] File input change triggered');
    console.log('[CommentImage DEBUG] componentId:', componentId);
    console.log('[CommentImage DEBUG] file:', file ? { name: file.name, type: file.type, size: file.size } : null);

    if (!file) {
        console.log('[CommentImage DEBUG] No file selected, returning');
        return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
        console.log('[CommentImage DEBUG] Invalid file type:', file.type);
        showToast('Please select an image file', 'error');
        fileInput.value = '';
        return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
        console.log('[CommentImage DEBUG] File too large:', file.size);
        showToast('Image must be less than 10MB', 'error');
        fileInput.value = '';
        return;
    }

    console.log('[CommentImage DEBUG] File validation passed, resizing if needed and creating preview');

    // Resize image if needed (handles large mobile photos), then show preview
    resizeImageForUpload(file).then(dataUrl => {
        console.log('[CommentImage DEBUG] Image processed, showing preview');
        const previewContainer = document.querySelector(`.comment-image-preview[data-component-id="${componentId}"]`);
        const thumbnail = previewContainer?.querySelector('.comment-preview-thumbnail');
        const removeBtn = previewContainer?.querySelector('.comment-preview-remove');

        console.log('[CommentImage DEBUG] previewContainer found:', !!previewContainer);
        console.log('[CommentImage DEBUG] thumbnail found:', !!thumbnail);
        console.log('[CommentImage DEBUG] removeBtn found:', !!removeBtn);

        if (previewContainer && thumbnail) {
            thumbnail.src = dataUrl;
            previewContainer.style.display = 'flex';
            // Store the resized data URL on the file input for later upload
            fileInput.dataset.resizedDataUrl = dataUrl;

            console.log('[CommentImage DEBUG] Preview displayed');
        } else {
            console.log('[CommentImage DEBUG] Could not find previewContainer or thumbnail');
        }
    }).catch(err => {
        console.error('[CommentImage DEBUG] Error processing image:', err);
        showToast('Error processing image. Please try again.', 'error');
    });
}

/**
 * Clear the comment image preview and file input
 */
function clearCommentImagePreview(componentId) {
    console.log('[CommentImage DEBUG] clearCommentImagePreview called for componentId:', componentId);
    const fileInput = document.querySelector(`.comment-image-input[data-component-id="${componentId}"]`);
    const previewContainer = document.querySelector(`.comment-image-preview[data-component-id="${componentId}"]`);
    const thumbnail = previewContainer?.querySelector('.comment-preview-thumbnail');

    console.log('[CommentImage DEBUG] Found elements - fileInput:', !!fileInput, 'previewContainer:', !!previewContainer, 'thumbnail:', !!thumbnail);

    if (fileInput) {
        fileInput.value = '';
        delete fileInput.dataset.resizedDataUrl;
        console.log('[CommentImage DEBUG] File input cleared');
    }
    if (previewContainer) {
        previewContainer.style.display = 'none';
        console.log('[CommentImage DEBUG] Preview container hidden');
    }
    if (thumbnail) {
        thumbnail.src = '';
        console.log('[CommentImage DEBUG] Thumbnail src cleared');
    }
}

/**
 * Toggle the visibility of comments for a component
 */
async function toggleComponentComments(componentId) {
    const body = document.querySelector(`.component-comments-body[data-component-id="${componentId}"]`);
    const toggle = document.querySelector(`.component-comments-toggle[data-component-id="${componentId}"]`);
    const icon = toggle?.querySelector('.comments-toggle-icon');

    if (!body || !toggle) return;

    const isHidden = body.style.display === 'none';

    if (isHidden) {
        // Show comments
        body.style.display = 'block';
        if (icon) icon.textContent = '\u25B2';
        toggle.classList.add('expanded');

        // Load comments if not cached
        await loadComponentComments(componentId);

        // Auto-focus the comment input for quick engagement
        setTimeout(() => {
            const input = body.querySelector(`.component-comment-input[data-component-id="${componentId}"]`);
            if (input) input.focus();
        }, 150);
    } else {
        // Hide comments
        body.style.display = 'none';
        if (icon) icon.textContent = '\u25BC';
        toggle.classList.remove('expanded');
    }
}

/**
 * Load and render comments for a component
 */
export async function loadComponentComments(componentId) {
    console.log('[ComponentComment DEBUG] loadComponentComments called for:', componentId);
    const sessionId = state.session.id;
    console.log('[ComponentComment DEBUG] sessionId:', sessionId);

    if (!sessionId) {
        console.log('[ComponentComment DEBUG] \u274C No sessionId - aborting');
        return;
    }

    const cacheKey = `item:${componentId}`;
    const commentsList = document.querySelector(`.component-comments-list[data-component-id="${componentId}"]`);
    console.log('[ComponentComment DEBUG] commentsList element found:', !!commentsList);

    if (!commentsList) {
        console.log('[ComponentComment DEBUG] \u274C No commentsList element - aborting');
        return;
    }

    // Show loading state
    commentsList.innerHTML = '<div class="comments-loading">Loading comments...</div>';

    try {
        console.log('[ComponentComment DEBUG] Calling api.fetchComponentComments with:', {
            sessionId,
            componentType: api.COMPONENT_TYPES.ITEM,
            componentId
        });
        // Fetch comments from API
        const comments = await api.fetchComponentComments(sessionId, api.COMPONENT_TYPES.ITEM, componentId);
        console.log('[ComponentComment DEBUG] fetchComponentComments returned:', comments?.length, 'comments');

        // Cache comments
        componentCommentsCache.set(cacheKey, comments);

        // Extract images from comments and add to carousel
        // This ensures images from previously posted comments appear in the item's carousel
        extractAndAddCommentImages(componentId, comments);

        // Render comments
        renderComponentComments(componentId, comments);

        // Update count
        updateCommentCount(componentId, comments.length);

        log('Presentation', `Loaded ${comments.length} comments for component ${componentId}`);
    } catch (error) {
        console.log('[ComponentComment DEBUG] \u274C Error loading comments:', error);
        log('Presentation', `Error loading comments: ${error.message}`);
        commentsList.innerHTML = '<div class="comments-error">Failed to load comments</div>';
    }
}

/**
 * Extract images from comments and add them to the item's carousel.
 * This ensures images uploaded via comments appear in the item's image gallery.
 * @param {string} componentId - The item/component ID
 * @param {Array} comments - Array of comment records
 */
function extractAndAddCommentImages(componentId, comments) {
    if (!comments || comments.length === 0) return;

    let imagesAdded = 0;

    comments.forEach(comment => {
        const content = comment.fields?.Content || '';

        // Parse attachments from Content field (embedded as [ATTACHMENTS:...])
        const attachmentMatch = content.match(/\[ATTACHMENTS:(.*?)\]$/);
        if (attachmentMatch) {
            try {
                const attachments = JSON.parse(attachmentMatch[1]);
                if (Array.isArray(attachments)) {
                    attachments.forEach(attachment => {
                        if (attachment.type === 'image' && attachment.url) {
                            addImageToItemCarousel(componentId, attachment.url);
                            imagesAdded++;
                        }
                    });
                }
            } catch (e) {
                console.warn('[ComponentComment] Failed to parse attachments for carousel:', e);
            }
        }
    });

    if (imagesAdded > 0) {
        console.log('[ComponentComment DEBUG] Extracted and added', imagesAdded, 'images from comments to carousel for:', componentId);
    }
}

/**
 * Render comments for a component with nested replies
 */
function renderComponentComments(componentId, comments) {
    const commentsList = document.querySelector(`.component-comments-list[data-component-id="${componentId}"]`);
    if (!commentsList) return;

    const currentUser = getCurrentUser();

    if (comments.length === 0) {
        commentsList.innerHTML = '<div class="comments-empty">No comments yet. Be the first to comment!</div>';
        return;
    }

    // Get project tasks to check for linked tasks
    const projectId = state.session.id;
    const projectTasks = state.tasks.byProject.get(projectId) || [];

    // Separate parent comments from replies and build a map
    const parentComments = [];
    const repliesByParent = new Map();

    comments.forEach(comment => {
        const parentId = comment.fields?.ParentMessageID;
        if (parentId) {
            // This is a reply
            if (!repliesByParent.has(parentId)) {
                repliesByParent.set(parentId, []);
            }
            repliesByParent.get(parentId).push(comment);
        } else {
            // This is a parent comment
            parentComments.push(comment);
        }
    });

    console.log('[ComponentComment DEBUG] Rendering nested comments:', {
        total: comments.length,
        parents: parentComments.length,
        repliesMap: repliesByParent.size
    });

    /**
     * Render a single comment HTML
     */
    const renderSingleComment = (comment, isReply = false) => {
        const fields = comment.fields;
        const isOwn = fields.SenderID === currentUser?.id;
        const isDeleted = fields.IsDeleted;
        const isEdited = fields.IsEdited;
        const reactions = fields.Reactions ? JSON.parse(fields.Reactions) : {};
        const timestamp = new Date(comment.createdTime || fields.Timestamp || Date.now());
        const timeAgo = getTimeAgo(timestamp);

        if (isDeleted) {
            return `
                <div class="component-comment deleted ${isReply ? 'comment-reply' : ''}" data-comment-id="${comment.id}">
                    <em class="deleted-comment-text">This comment was deleted</em>
                </div>
            `;
        }

        // Check if this comment has a linked task
        const linkedTask = projectTasks.find(t => t.fields?.SourceCommentId === comment.id);
        const hasLinkedTask = !!linkedTask;
        const taskBtnHtml = hasLinkedTask
            ? `<button class="comment-action-btn comment-task-btn has-task" data-action="task" data-linked-task-id="${linkedTask.id}" title="View affiliated task">\u{1F4CB}\u2713</button>`
            : `<button class="comment-action-btn comment-task-btn" data-action="task" title="Create task from comment">\u{1F4CB}</button>`;

        // Build reactions HTML
        let reactionsHTML = '';
        if (Object.keys(reactions).length > 0) {
            reactionsHTML = '<div class="comment-reactions">';
            for (const [emoji, users] of Object.entries(reactions)) {
                if (users.length > 0) {
                    const hasReacted = users.includes(currentUser?.id);
                    reactionsHTML += `
                        <button class="comment-reaction-badge ${hasReacted ? 'user-reacted' : ''}" data-emoji="${emoji}">
                            ${emoji} <span class="reaction-count">${users.length}</span>
                        </button>
                    `;
                }
            }
            reactionsHTML += '</div>';
        }

        // Parse attachments from Content field (embedded as [ATTACHMENTS:...])
        // This is because the Messages table doesn't have a separate Attachments field
        let displayContent = fields.Content || '';
        let attachments = [];

        // Strip out [PLAN_COMMENT:xxx] or [PLAN_COMMENT:item:componentId] prefix from display content
        // The pattern now handles both formats: [PLAN_COMMENT:type] and [PLAN_COMMENT:item:manual-presentation-xxx]
        displayContent = displayContent.replace(/^\[PLAN_COMMENT:[^\]]+\]\s*/i, '');

        // Check for embedded attachments in content
        const attachmentMatch = displayContent.match(/\[ATTACHMENTS:(.*?)\]$/);
        if (attachmentMatch) {
            try {
                attachments = JSON.parse(attachmentMatch[1]);
                // Remove the attachment marker from display content
                displayContent = displayContent.replace(/\[ATTACHMENTS:.*?\]$/, '').trim();
            } catch (e) {
                console.warn('[ComponentComment] Failed to parse embedded attachments:', e);
            }
        }

        // Build attachments HTML
        let attachmentsHTML = '';
        if (Array.isArray(attachments) && attachments.length > 0) {
            attachmentsHTML = '<div class="comment-attachments">';
            attachments.forEach(attachment => {
                if (attachment.type === 'image' && attachment.url) {
                    // Apply Cloudinary transformations for optimized display
                    const optimizedUrl = applyCloudinaryTransform(attachment.url, 'w_400,h_300,c_limit,f_auto,q_auto');
                    attachmentsHTML += `
                        <a href="${escapeHtml(attachment.url)}" target="_blank" class="comment-attachment comment-attachment-image">
                            <img src="${escapeHtml(optimizedUrl)}" alt="Attached image" loading="lazy" />
                        </a>
                    `;
                }
            });
            attachmentsHTML += '</div>';
        }

        // Get reply count for parent comments
        const replies = repliesByParent.get(comment.id) || [];
        const replyCountHtml = !isReply && replies.length > 0
            ? `<span class="comment-reply-count">${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}</span>`
            : '';

        // Only show content div if there's actual text content (after removing attachment marker)
        const contentHTML = displayContent && displayContent.trim()
            ? `<div class="comment-content">${escapeHtml(displayContent)}</div>`
            : '';

        return `
            <div class="component-comment ${isOwn ? 'own-comment' : ''} ${isReply ? 'comment-reply' : ''}" data-comment-id="${comment.id}" data-sender-name="${escapeHtml(fields.SenderName)}" data-content="${escapeHtml(displayContent || '')}">
                <div class="comment-header">
                    <span class="comment-author">${escapeHtml(fields.SenderName)}${isOwn ? ' (You)' : ''}</span>
                    <span class="comment-time" title="${timestamp.toLocaleString()}">${timeAgo}</span>
                    ${isEdited ? '<span class="comment-edited">(edited)</span>' : ''}
                    ${replyCountHtml}
                </div>
                ${contentHTML}
                ${attachmentsHTML}
                ${reactionsHTML}
                <div class="comment-actions">
                    <button class="comment-action-btn" data-action="reply" title="Reply to this comment">\u21A9</button>
                    <button class="comment-action-btn" data-action="react" title="Add reaction">\u{1F60A}</button>
                    ${taskBtnHtml}
                    ${isOwn ? `
                        <button class="comment-action-btn" data-action="edit" title="Edit comment">\u270F\uFE0F</button>
                        <button class="comment-action-btn" data-action="delete" title="Delete comment">\u{1F5D1}\uFE0F</button>
                    ` : ''}
                </div>
            </div>
        `;
    };

    // Build the full HTML with nested structure
    let commentsHTML = '';

    parentComments.forEach(parentComment => {
        // Render the parent comment
        commentsHTML += renderSingleComment(parentComment, false);

        // Render nested replies
        const replies = repliesByParent.get(parentComment.id) || [];
        if (replies.length > 0) {
            commentsHTML += '<div class="comment-replies-container">';
            replies.forEach(reply => {
                commentsHTML += renderSingleComment(reply, true);
            });
            commentsHTML += '</div>';
        }
    });

    // Also render any orphan replies (replies without visible parent - rare edge case)
    // These would be replies to deleted comments or comments not in current view
    const renderedParentIds = new Set(parentComments.map(c => c.id));
    repliesByParent.forEach((replies, parentId) => {
        if (!renderedParentIds.has(parentId)) {
            // These are orphan replies - render them at top level
            replies.forEach(reply => {
                commentsHTML += renderSingleComment(reply, false);
            });
        }
    });

    commentsList.innerHTML = commentsHTML;
}

/**
 * Submit a new comment for a component
 */
async function submitComponentComment(componentId) {
    console.log('[ComponentComment DEBUG] submitComponentComment called for:', componentId);

    const input = document.querySelector(`.component-comment-input[data-component-id="${componentId}"]`);
    if (!input) {
        console.log('[ComponentComment DEBUG] \u274C No input element found');
        return;
    }

    let content = input.value.trim();
    console.log('[ComponentComment DEBUG] Content:', content?.substring(0, 50) + (content?.length > 50 ? '...' : ''));

    // Check for attached image
    const fileInput = document.querySelector(`.comment-image-input[data-component-id="${componentId}"]`);
    const hasImage = fileInput?.files?.[0];

    // Require either content or image
    if (!content && !hasImage) {
        console.log('[ComponentComment DEBUG] \u274C Empty content and no image - aborting');
        return;
    }

    const sessionId = state.session.id;
    const currentUser = getCurrentUser();
    console.log('[ComponentComment DEBUG] sessionId:', sessionId);
    console.log('[ComponentComment DEBUG] currentUser:', currentUser ? { id: currentUser.id, name: currentUser.name } : null);

    if (!sessionId || !currentUser) {
        console.log('[ComponentComment DEBUG] \u274C No session or user - aborting');
        log('Presentation', 'Cannot submit comment - no session or user');
        return;
    }

    // Check if this is a reply - prepend @mention if so
    const isReply = componentCommentReplyingTo && componentCommentReplyingTo.componentId === componentId;
    const parentCommentId = isReply ? componentCommentReplyingTo.commentId : null;
    if (isReply) {
        console.log('[ComponentComment DEBUG] This is a reply to:', componentCommentReplyingTo.senderName, 'parentId:', parentCommentId);
        // Prepend @mention to the content for display
        content = `@${componentCommentReplyingTo.senderName}: ${content}`;
    }

    // Disable input while submitting
    input.disabled = true;
    const submitBtn = document.querySelector(`.component-comment-submit[data-component-id="${componentId}"]`);
    const imageBtn = document.querySelector(`.comment-image-btn[data-component-id="${componentId}"]`);
    if (submitBtn) submitBtn.disabled = true;
    if (imageBtn) imageBtn.disabled = true;

    // Show loading state on input wrapper
    const inputWrapper = input.closest('.component-comment-input-wrapper');
    if (inputWrapper) inputWrapper.classList.add('uploading');

    let attachments = [];

    try {
        // Upload image if attached
        if (hasImage) {
            console.log('[ComponentComment DEBUG] Uploading attached image...');

            // Use pre-resized data URL from the preview step, or resize now as fallback
            let base64Data = fileInput.dataset.resizedDataUrl;
            if (!base64Data && fileInput.files[0]) {
                base64Data = await resizeImageForUpload(fileInput.files[0]);
            }

            // Upload to Cloudinary via serverless function
            const uploadResponse = await fetch('/.netlify/functions/cloudinary-upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageData: base64Data,
                    sessionId: sessionId,
                    itemId: componentId
                })
            });

            if (!uploadResponse.ok) {
                // Try to parse JSON error, but handle plain text errors gracefully
                let errorMessage = 'Image upload failed';
                const responseText = await uploadResponse.text();
                try {
                    const errorData = JSON.parse(responseText);
                    errorMessage = errorData.error || errorData.message || errorMessage;
                } catch (parseErr) {
                    // Response wasn't JSON, use the text or status as the error
                    // Netlify returns "Internal Error. ID: xxx" for crashed functions
                    if (responseText.startsWith('Internal Error')) {
                        errorMessage = 'Image upload service error. Please try again or use a smaller image.';
                    } else {
                        errorMessage = responseText || `Upload failed with status ${uploadResponse.status}`;
                    }
                }
                console.error('[ComponentComment DEBUG] Upload error:', errorMessage);
                throw new Error(errorMessage);
            }

            const uploadResult = await uploadResponse.json();
            console.log('[ComponentComment DEBUG] Image uploaded:', uploadResult.secure_url);

            attachments = [{ url: uploadResult.secure_url, type: 'image' }];
        }

        console.log('[ComponentComment DEBUG] Calling api.postComponentComment...');
        // Post comment via API with parent comment ID if this is a reply
        const newComment = await api.postComponentComment(
            sessionId,
            api.COMPONENT_TYPES.ITEM,
            componentId,
            currentUser.id,
            currentUser.name,
            content,
            parentCommentId,
            attachments
        );
        console.log('[ComponentComment DEBUG] postComponentComment result:', newComment ? 'SUCCESS (id: ' + newComment.id + ')' : 'FAILED');

        if (newComment) {
            // Clear input and reply state
            input.value = '';
            input.placeholder = 'Add a comment...';

            // Clear image preview if an image was attached
            clearCommentImagePreview(componentId);

            // If an image was attached, add it to the item's image carousel
            if (attachments.length > 0) {
                attachments.forEach(attachment => {
                    if (attachment.type === 'image' && attachment.url) {
                        addImageToItemCarousel(componentId, attachment.url);
                    }
                });
            }

            // Clear reply state if this was a reply
            if (isReply) {
                cancelCommentReply(componentId);
            }

            // Reload comments to show the new one in the component's comment section
            console.log('[ComponentComment DEBUG] Reloading comments...');
            await loadComponentComments(componentId);

            // Also add to the chat area with @component tag
            const chatMessagesEl = getChatMessagesEl ? getChatMessagesEl() : null;
            if (chatMessagesEl) {
                const componentRecord = getRecordById(componentId);
                const componentInfo = {
                    id: componentId,
                    name: componentRecord?.fields?.Name || 'Unknown Item'
                };

                // Remove empty state if present
                const emptyMsg = chatMessagesEl.querySelector('.chat-empty');
                if (emptyMsg) emptyMsg.remove();

                addPresentationMessageToUI(
                    currentUser.name,
                    content,
                    true,
                    new Date().toISOString(),
                    currentUser.id,
                    {
                        messageId: newComment.id,
                        componentInfo
                    }
                );
            }

            // Broadcast via Pusher if available
            const presentationChatChannel = getChannel ? getChannel() : null;
            if (presentationChatChannel) {
                console.log('[ComponentComment DEBUG] Broadcasting via Pusher...');
                presentationChatChannel.trigger('client-component-comment', {
                    componentType: api.COMPONENT_TYPES.ITEM,
                    componentId,
                    comment: newComment,
                    senderId: currentUser.id
                });
            }

            console.log('[ComponentComment DEBUG] \u2705 Comment posted successfully');
            log('Presentation', `Comment posted to component ${componentId}`);
        } else {
            console.log('[ComponentComment DEBUG] \u274C postComponentComment returned null/false');
            showToast('Failed to post comment', 'error');
        }
    } catch (error) {
        console.log('[ComponentComment DEBUG] \u274C Exception:', error);
        log('Presentation', `Error posting comment: ${error.message}`);
        showToast(error.message || 'Failed to post comment', 'error');
    } finally {
        // Re-enable inputs and remove loading state
        input.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
        if (imageBtn) imageBtn.disabled = false;
        if (inputWrapper) inputWrapper.classList.remove('uploading');
        input.focus();
    }
}

/**
 * Handle comment actions (edit, delete, react, reply, task)
 */
async function handleCommentAction(action, commentId) {
    console.log('[ComponentComment DEBUG] handleCommentAction called:', action, commentId);
    const currentUser = getCurrentUser();
    if (!currentUser) {
        console.log('[ComponentComment DEBUG] \u274C No current user for action');
        return;
    }

    switch (action) {
        case 'reply':
            startCommentReply(commentId);
            break;
        case 'edit':
            startCommentEdit(commentId);
            break;
        case 'delete':
            await deleteComment(commentId);
            break;
        case 'react':
            console.log('[ComponentComment DEBUG] About to call showCommentReactionPicker');
            showCommentReactionPicker(commentId);
            break;
        case 'task':
            console.log('[ComponentComment DEBUG] Creating task from comment');
            await handleCreateTaskFromComment(commentId);
            break;
    }
}

/**
 * Handle creating a task from a comment or opening existing linked task
 * @param {string} commentId - The comment record ID
 */
async function handleCreateTaskFromComment(commentId) {
    console.log('[CreateTaskFromComment DEBUG] handleCreateTaskFromComment called:', commentId);

    const commentEl = document.querySelector(`.component-comment[data-comment-id="${commentId}"]`);
    if (!commentEl) {
        console.log('[CreateTaskFromComment DEBUG] \u274C Comment element not found for task creation');
        return;
    }

    // Check if this comment already has a linked task (from data attribute or from state)
    const taskBtn = commentEl.querySelector('.comment-task-btn');
    const linkedTaskId = taskBtn?.dataset.linkedTaskId;

    if (linkedTaskId) {
        console.log('[CreateTaskFromComment DEBUG] Comment already has linked task:', linkedTaskId);
        // Open the existing task
        const task = state.tasks.all.get(linkedTaskId);
        if (task) {
            showLinkedTaskPopup(task, commentId);
            return;
        } else {
            console.log('[CreateTaskFromComment DEBUG] Linked task not found in state, allowing new task creation');
        }
    }

    // Check if any existing task has this comment as its source
    const projectId = state.session.id;
    const projectTasks = state.tasks.byProject.get(projectId) || [];
    const existingTask = projectTasks.find(t => t.fields?.SourceCommentId === commentId);

    if (existingTask) {
        console.log('[CreateTaskFromComment DEBUG] Found existing task for this comment:', existingTask.id);
        // Update the button and show the task
        if (taskBtn) {
            taskBtn.dataset.linkedTaskId = existingTask.id;
            taskBtn.innerHTML = '\u{1F4CB}\u2713';
            taskBtn.title = 'View affiliated task';
            taskBtn.classList.add('has-task');
        }
        showLinkedTaskPopup(existingTask, commentId);
        return;
    }

    const commentContent = commentEl.dataset.content || '';
    const componentSection = commentEl.closest('.component-comments-section');
    const componentId = componentSection?.dataset.componentId || null;
    const componentType = componentSection?.dataset.componentType || 'item';

    console.log('[CreateTaskFromComment DEBUG] Comment data:', { commentContent, componentId, componentType });

    // Get the element name for display in the popup
    let elementName = 'Unknown';
    if (componentType === 'item') {
        // Try to find the item name from the accordion
        const accordion = commentEl.closest('.itinerary-item-accordion');
        if (accordion) {
            elementName = accordion.dataset.itemName || 'Unknown Item';
        } else {
            // Fallback: try to get from locked/cart items
            const itemRecord = getRecordById(componentId);
            if (itemRecord) {
                elementName = itemRecord.fields?.Name || itemRecord.fields?.['Item Name'] || 'Unknown Item';
            }
        }
    } else if (componentType === 'header') {
        // Header/detail component
        elementName = componentId === 'goals' ? 'Goals/Notes' :
                      componentId === 'date' ? 'Event Date' :
                      'Event Detail';
    }

    console.log('[CreateTaskFromComment DEBUG] Element name resolved:', elementName);

    // Show the task creation popup instead of directly creating the task
    showCreateTaskFromCommentPopup(commentId, commentContent, componentId, componentType, elementName);
}

/**
 * Show popup for viewing a linked task from a comment
 * @param {Object} task - The task object
 * @param {string} sourceCommentId - The source comment ID
 */
function showLinkedTaskPopup(task, sourceCommentId) {
    console.log('[LinkedTaskPopup DEBUG] showLinkedTaskPopup called:', { taskId: task.id, taskName: task.fields?.Name, sourceCommentId });

    // Check if user can edit
    const currentRole = state.permissions?.currentRole;
    const isLoading = state.permissions?.isLoading !== false;
    const canEditByRole = api.canEdit(currentRole);
    const canEditByOwnership = state.session.isOwned === true;
    const canUserEdit = (!isLoading && canEditByRole) || canEditByOwnership;

    const taskName = task.fields?.Name || 'Unnamed Task';
    const taskDescription = task.fields?.Description || '';
    const taskStatus = task.fields?.Status || 'pending';
    const statusConfig = TASK_STATUS_CONFIG[taskStatus] || TASK_STATUS_CONFIG.pending;

    // Create modal HTML
    const modalHTML = `
        <div id="linked-task-modal-overlay" class="task-detail-modal-overlay">
            <div class="task-detail-modal">
                <div class="task-detail-modal-header">
                    <h3>\u{1F4CB} Linked Task</h3>
                    <button class="task-detail-modal-close" id="linked-task-modal-close">&times;</button>
                </div>
                <div class="task-detail-modal-body">
                    <div class="task-detail-section">
                        <label>Task Name</label>
                        <div class="linked-task-name">${escapeHtml(taskName)}</div>
                    </div>

                    ${taskDescription ? `
                        <div class="task-detail-section">
                            <label>Description</label>
                            <div class="linked-task-description">${escapeHtml(taskDescription)}</div>
                        </div>
                    ` : ''}

                    <div class="task-detail-section">
                        <label>Status</label>
                        <div class="task-status-options">
                            ${Object.entries(TASK_STATUS_CONFIG).map(([statusValue, cfg]) => `
                                <button class="task-status-option-btn ${cfg.className} ${statusValue === taskStatus ? 'active' : ''}"
                                        data-status="${statusValue}"
                                        ${!canUserEdit ? 'disabled' : ''}>
                                    <span class="option-icon">${cfg.icon}</span>
                                    <span class="option-label">${cfg.label}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>

                    <div class="linked-task-info">
                        <span class="info-label">Task ID:</span> ${task.id}
                    </div>
                </div>
                <div class="task-detail-modal-footer">
                    <button class="task-detail-done-btn" id="linked-task-done-btn">Done</button>
                </div>
            </div>
        </div>
    `;

    console.log('[LinkedTaskPopup DEBUG] Inserting modal HTML');

    // Insert modal
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const overlay = document.getElementById('linked-task-modal-overlay');
    const closeBtn = document.getElementById('linked-task-modal-close');
    const doneBtn = document.getElementById('linked-task-done-btn');

    const closeModal = () => {
        console.log('[LinkedTaskPopup DEBUG] Closing modal');
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 200);
    };

    // Attach event listeners
    closeBtn.addEventListener('click', closeModal);
    doneBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // Handle status option clicks
    if (canUserEdit) {
        overlay.querySelectorAll('.task-status-option-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const newStatus = btn.dataset.status;
                console.log('[LinkedTaskPopup DEBUG] Status change requested:', newStatus);

                // Update the task status
                const updatedTask = await api.updateTask(task.id, { Status: newStatus });

                if (updatedTask) {
                    console.log('[LinkedTaskPopup DEBUG] Task status updated successfully');
                    // Update local state
                    state.tasks.all.set(task.id, updatedTask);
                    const projectId = state.session.id;
                    const projectTasks = state.tasks.byProject.get(projectId) || [];
                    const taskIndex = projectTasks.findIndex(t => t.id === task.id);
                    if (taskIndex >= 0) {
                        projectTasks[taskIndex] = updatedTask;
                        state.tasks.byProject.set(projectId, [...projectTasks]);
                    }

                    // Update active state in modal
                    overlay.querySelectorAll('.task-status-option-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    showToast('Task status updated', 2000);
                } else {
                    showToast('Failed to update task status', 3000);
                }
            });
        });
    }

    // Show modal with animation
    console.log('[LinkedTaskPopup DEBUG] Showing modal with animation');
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });
}

/**
 * Show popup for creating a task from a comment
 * @param {string} commentId - The comment record ID
 * @param {string} commentContent - The comment text content
 * @param {string} componentId - The component/item ID
 * @param {string} componentType - The component type ('item' or 'header')
 * @param {string} elementName - Display name of the element
 */
function showCreateTaskFromCommentPopup(commentId, commentContent, componentId, componentType, elementName) {
    console.log('[CreateTaskFromComment DEBUG] showCreateTaskFromCommentPopup called:', {
        commentId,
        commentContent: commentContent?.substring(0, 50) + '...',
        componentId,
        componentType,
        elementName
    });

    // Check if user can edit
    const currentRole = state.permissions?.currentRole;
    const isLoading = state.permissions?.isLoading !== false;
    const canEditByRole = api.canEdit(currentRole);
    const canEditByOwnership = state.session.isOwned === true;
    const canUserEdit = (!isLoading && canEditByRole) || canEditByOwnership;

    console.log('[CreateTaskFromComment DEBUG] Permission check:', {
        currentRole,
        canEditByRole,
        canEditByOwnership,
        canUserEdit
    });

    if (!canUserEdit) {
        showToast('You do not have permission to create tasks', 3000);
        return;
    }

    // Truncate comment content for task name (max 100 chars)
    const suggestedTaskName = commentContent.substring(0, 100) + (commentContent.length > 100 ? '...' : '');

    // Build affiliated tasks list for the dropdown
    const projectTasks = state.tasks.byProject.get(state.session.id) || [];
    const affiliatableTasksHTML = projectTasks.length > 0 ? `
        <div class="task-detail-section">
            <label>Affiliate with Existing Task</label>
            <select id="create-task-affiliate-select" class="task-affiliate-select">
                <option value="">-- No affiliation --</option>
                ${projectTasks.map(t => `
                    <option value="${t.id}">${escapeHtml(t.fields?.Name || 'Unnamed Task')}</option>
                `).join('')}
            </select>
        </div>
    ` : '';

    // Create modal HTML
    const modalHTML = `
        <div id="create-task-modal-overlay" class="task-detail-modal-overlay">
            <div class="task-detail-modal">
                <div class="task-detail-modal-header">
                    <h3>\u{1F4CB} Create Task from Comment</h3>
                    <button class="task-detail-modal-close" id="create-task-modal-close">&times;</button>
                </div>
                <div class="task-detail-modal-body">
                    <div class="task-detail-element-name">
                        <span class="element-label">${componentType === 'item' ? 'Item' : 'Detail'}:</span>
                        <span class="element-name">${escapeHtml(elementName)}</span>
                    </div>

                    <div class="task-detail-section">
                        <label>Task Name</label>
                        <input type="text"
                               id="create-task-name-input"
                               class="create-task-name-input"
                               value="${escapeHtml(suggestedTaskName)}"
                               placeholder="Enter task name..." />
                    </div>

                    <div class="task-detail-section">
                        <label>Description</label>
                        <textarea id="create-task-description-input"
                                  class="create-task-description-input"
                                  rows="3"
                                  placeholder="Task description...">${escapeHtml(commentContent)}</textarea>
                    </div>

                    <div class="task-detail-section">
                        <label>Status</label>
                        <div class="task-status-options">
                            ${Object.entries(TASK_STATUS_CONFIG).map(([statusValue, cfg]) => `
                                <button class="task-status-option-btn ${cfg.className} ${statusValue === 'pending' ? 'active' : ''}"
                                        data-status="${statusValue}">
                                    <span class="option-icon">${cfg.icon}</span>
                                    <span class="option-label">${cfg.label}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>

                    ${affiliatableTasksHTML}

                    <div class="task-detail-section create-task-source-info">
                        <label>Source Comment</label>
                        <div class="source-comment-preview">"${escapeHtml(commentContent.substring(0, 200))}${commentContent.length > 200 ? '...' : ''}"</div>
                    </div>
                </div>
                <div class="task-detail-modal-footer">
                    <button class="task-detail-cancel-btn" id="create-task-cancel-btn">Cancel</button>
                    <button class="task-detail-done-btn create-task-submit-btn" id="create-task-submit-btn">Create Task</button>
                </div>
            </div>
        </div>
    `;

    console.log('[CreateTaskFromComment DEBUG] Inserting modal HTML');

    // Insert modal
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const overlay = document.getElementById('create-task-modal-overlay');
    const closeBtn = document.getElementById('create-task-modal-close');
    const cancelBtn = document.getElementById('create-task-cancel-btn');
    const submitBtn = document.getElementById('create-task-submit-btn');
    const nameInput = document.getElementById('create-task-name-input');
    const descriptionInput = document.getElementById('create-task-description-input');

    console.log('[CreateTaskFromComment DEBUG] Modal elements:', {
        overlay: !!overlay,
        closeBtn: !!closeBtn,
        cancelBtn: !!cancelBtn,
        submitBtn: !!submitBtn,
        nameInput: !!nameInput,
        descriptionInput: !!descriptionInput
    });

    let selectedStatus = 'pending';

    const closeModal = () => {
        console.log('[CreateTaskFromComment DEBUG] Closing modal');
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 200);
    };

    // Attach event listeners
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // Handle status option clicks
    overlay.querySelectorAll('.task-status-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const newStatus = btn.dataset.status;
            console.log('[CreateTaskFromComment DEBUG] Status selected:', newStatus);
            selectedStatus = newStatus;

            // Update active state
            overlay.querySelectorAll('.task-status-option-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Handle submit button click
    submitBtn.addEventListener('click', async () => {
        console.log('[CreateTaskFromComment DEBUG] Submit button clicked');

        const taskName = nameInput.value.trim();
        const taskDescription = descriptionInput.value.trim();
        const affiliateSelect = document.getElementById('create-task-affiliate-select');
        const affiliatedTaskId = affiliateSelect?.value || null;

        console.log('[CreateTaskFromComment DEBUG] Task data:', {
            taskName,
            taskDescription: taskDescription?.substring(0, 50) + '...',
            selectedStatus,
            affiliatedTaskId
        });

        if (!taskName) {
            showToast('Please enter a task name', 3000);
            return;
        }

        // Disable submit button while creating
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';

        try {
            const projectId = state.session.id;
            const projectTasks = state.tasks.byProject.get(projectId) || [];
            const maxOrder = projectTasks.reduce((max, t) => Math.max(max, t.fields?.Order || 0), 0);

            // Build task data
            const taskData = {
                Name: taskName,
                Description: taskDescription,
                Status: selectedStatus,
                Order: maxOrder + 1
            };

            // Handle item linking - only link if it's a valid Airtable record ID
            if (componentId && componentId.startsWith('rec')) {
                taskData.LinkedItem = componentId;
            } else if (componentId) {
                // For AI-generated items, include the item name in the task name
                const itemRecord = getRecordById(componentId);
                if (itemRecord) {
                    const itemName = itemRecord.fields?.Name || itemRecord.fields?.['Item Name'] || 'AI Item';
                    if (!taskName.includes(`[${itemName}]`)) {
                        taskData.Name = `[${itemName}] ${taskName}`;
                    }
                    console.log('[CreateTaskFromComment DEBUG] Task linked to AI item:', itemName);
                }
            }

            // Store the source comment ID so we can track which tasks came from comments
            taskData.SourceCommentId = commentId;

            console.log('[CreateTaskFromComment DEBUG] Creating task with data:', taskData);

            const newTask = await api.createTask(projectId, taskData);

            if (newTask) {
                console.log('[CreateTaskFromComment DEBUG] \u2705 Task created successfully:', newTask.id);

                // Update local state
                state.tasks.all.set(newTask.id, newTask);
                const existingTasks = state.tasks.byProject.get(projectId) || [];
                state.tasks.byProject.set(projectId, [...existingTasks, newTask]);

                // IMPORTANT: Persist the comment-to-task link so it survives page refresh
                // Since Airtable Tasks table doesn't have SourceCommentId field, we store this mapping in session data
                if (saveCommentTaskLink) {
                    saveCommentTaskLink(commentId, newTask.id);
                }

                // Also apply the SourceCommentId to the in-memory task object
                if (!newTask.fields) {
                    newTask.fields = {};
                }
                newTask.fields.SourceCommentId = commentId;

                // Update the task button to show "View Task" instead of "Create Task"
                const commentEl = document.querySelector(`.component-comment[data-comment-id="${commentId}"]`);
                if (commentEl) {
                    const taskBtn = commentEl.querySelector('.comment-task-btn');
                    if (taskBtn) {
                        taskBtn.dataset.linkedTaskId = newTask.id;
                        taskBtn.innerHTML = '\u{1F4CB}\u2713';
                        taskBtn.title = 'View affiliated task';
                        taskBtn.classList.add('has-task');
                        console.log('[CreateTaskFromComment DEBUG] Updated task button to show linked task');
                    }
                }

                showToast('Task created successfully!', 2000);
                closeModal();
            } else {
                console.log('[CreateTaskFromComment DEBUG] \u274C Failed to create task');
                showToast('Failed to create task', 3000);
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create Task';
            }
        } catch (error) {
            console.error('[CreateTaskFromComment DEBUG] Error creating task:', error);
            showToast('Failed to create task', 3000);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Task';
        }
    });

    // Show modal with animation
    console.log('[CreateTaskFromComment DEBUG] Showing modal with animation');
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });

    // Focus on the name input
    setTimeout(() => {
        nameInput.focus();
        nameInput.select();
    }, 100);
}

/**
 * Start replying to a comment
 */
function startCommentReply(commentId) {
    console.log('[ComponentComment DEBUG] startCommentReply called for:', commentId);
    const commentEl = document.querySelector(`.component-comment[data-comment-id="${commentId}"]`);
    if (!commentEl) {
        console.log('[ComponentComment DEBUG] \u274C Comment element not found');
        return;
    }

    const senderName = commentEl.dataset.senderName || 'Unknown';
    const commentContent = commentEl.dataset.content || '';
    const componentSection = commentEl.closest('.component-comments-section');
    const componentId = componentSection?.dataset.componentId;

    if (!componentId) {
        console.log('[ComponentComment DEBUG] \u274C No componentId found');
        return;
    }

    console.log('[ComponentComment DEBUG] Replying to:', { commentId, senderName, componentId, preview: commentContent.substring(0, 30) });

    // Set the reply state
    componentCommentReplyingTo = {
        commentId,
        senderName,
        preview: commentContent,
        componentId
    };

    // Find the comment input for this component
    const inputContainer = document.querySelector(`.component-comment-form[data-component-id="${componentId}"]`) ||
                          document.querySelector(`.component-comments-body[data-component-id="${componentId}"]`);
    const input = document.querySelector(`.component-comment-input[data-component-id="${componentId}"]`);

    if (!inputContainer || !input) {
        console.log('[ComponentComment DEBUG] \u274C Input elements not found');
        return;
    }

    // Remove existing reply indicator if any
    const existingIndicator = inputContainer.querySelector('.comment-reply-indicator');
    if (existingIndicator) existingIndicator.remove();

    // Create and insert the reply indicator
    const replyIndicator = document.createElement('div');
    replyIndicator.className = 'comment-reply-indicator';
    const truncatedPreview = commentContent.length > 40 ? commentContent.substring(0, 40) + '...' : commentContent;
    replyIndicator.innerHTML = `
        <span class="reply-indicator-text">\u21A9 Replying to <strong>${escapeHtml(senderName)}</strong>: ${escapeHtml(truncatedPreview)}</span>
        <button class="cancel-reply-btn" type="button" title="Cancel reply">\u2715</button>
    `;

    // Add cancel handler
    replyIndicator.querySelector('.cancel-reply-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        cancelCommentReply(componentId);
    });

    // Insert the indicator before the input
    input.parentElement.insertBefore(replyIndicator, input);

    // Update placeholder and focus
    input.placeholder = `Reply to ${senderName}...`;
    input.focus();

    console.log('[ComponentComment DEBUG] \u2705 Reply indicator added');
}

/**
 * Cancel the current comment reply
 */
function cancelCommentReply(componentId) {
    console.log('[ComponentComment DEBUG] cancelCommentReply called for:', componentId);
    componentCommentReplyingTo = null;

    // Remove reply indicator
    const indicator = document.querySelector(`.component-comments-body[data-component-id="${componentId}"] .comment-reply-indicator`);
    if (indicator) indicator.remove();

    // Reset placeholder
    const input = document.querySelector(`.component-comment-input[data-component-id="${componentId}"]`);
    if (input) {
        input.placeholder = 'Add a comment...';
    }
}

/**
 * Start editing a comment
 */
function startCommentEdit(commentId) {
    console.log('[ComponentComment DEBUG] startCommentEdit called for:', commentId);
    const commentEl = document.querySelector(`.component-comment[data-comment-id="${commentId}"]`);
    if (!commentEl) {
        console.log('[ComponentComment DEBUG] \u274C Comment element not found');
        return;
    }

    const contentEl = commentEl.querySelector('.comment-content');
    if (!contentEl) {
        console.log('[ComponentComment DEBUG] \u274C Content element not found');
        return;
    }

    const currentContent = contentEl.textContent;
    console.log('[ComponentComment DEBUG] Current content:', currentContent?.substring(0, 30));

    // Replace content with edit input
    contentEl.innerHTML = `
        <input type="text" class="comment-edit-input" value="${escapeHtml(currentContent)}">
        <div class="comment-edit-actions">
            <button class="comment-edit-save" data-comment-id="${commentId}">Save</button>
            <button class="comment-edit-cancel" data-comment-id="${commentId}">Cancel</button>
        </div>
    `;

    const input = contentEl.querySelector('.comment-edit-input');
    const saveBtn = contentEl.querySelector('.comment-edit-save');
    const cancelBtn = contentEl.querySelector('.comment-edit-cancel');

    input.focus();
    input.select();

    const saveEdit = async () => {
        const newContent = input.value.trim();
        console.log('[ComponentComment DEBUG] Saving edit - new content:', newContent?.substring(0, 30));
        if (newContent && newContent !== currentContent) {
            const currentUser = getCurrentUser();
            console.log('[ComponentComment DEBUG] Calling api.updateComponentComment...');
            const result = await api.updateComponentComment(commentId, newContent, currentUser.id);
            console.log('[ComponentComment DEBUG] Update result:', result ? 'SUCCESS' : 'FAILED');
            if (result) {
                contentEl.textContent = newContent;

                // Add edited indicator
                const header = commentEl.querySelector('.comment-header');
                if (header && !header.querySelector('.comment-edited')) {
                    const editedSpan = document.createElement('span');
                    editedSpan.className = 'comment-edited';
                    editedSpan.textContent = '(edited)';
                    header.appendChild(editedSpan);
                }

                // Also update the data attribute for future replies
                commentEl.dataset.content = newContent;
                console.log('[ComponentComment DEBUG] \u2705 Edit saved successfully');
            } else {
                console.log('[ComponentComment DEBUG] \u274C Edit failed - reverting');
                contentEl.textContent = currentContent;
            }
        } else {
            console.log('[ComponentComment DEBUG] No changes or empty - canceling');
            contentEl.textContent = currentContent;
        }
    };

    const cancelEdit = () => {
        console.log('[ComponentComment DEBUG] Edit canceled');
        contentEl.textContent = currentContent;
    };

    saveBtn.addEventListener('click', saveEdit);
    cancelBtn.addEventListener('click', cancelEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') cancelEdit();
    });
}

/**
 * Delete a comment
 */
async function deleteComment(commentId) {
    console.log('[ComponentComment DEBUG] deleteComment called for:', commentId);

    if (!confirm('Delete this comment?')) {
        console.log('[ComponentComment DEBUG] Delete canceled by user');
        return;
    }

    const currentUser = getCurrentUser();
    console.log('[ComponentComment DEBUG] Calling api.deleteComponentComment...');
    const result = await api.deleteComponentComment(commentId, currentUser.id);
    console.log('[ComponentComment DEBUG] Delete result:', result ? 'SUCCESS' : 'FAILED');

    if (result) {
        const commentEl = document.querySelector(`.component-comment[data-comment-id="${commentId}"]`);
        if (commentEl) {
            commentEl.classList.add('deleted');
            commentEl.innerHTML = '<em class="deleted-comment-text">This comment was deleted</em>';
            console.log('[ComponentComment DEBUG] \u2705 Comment marked as deleted in UI');
        }

        // Update count
        const componentSection = commentEl?.closest('.component-comments-section');
        if (componentSection) {
            const componentId = componentSection.dataset.componentId;
            const countEl = document.querySelector(`.comments-count[data-component-id="${componentId}"]`);
            if (countEl) {
                const currentCount = parseInt(countEl.textContent) || 0;
                countEl.textContent = Math.max(0, currentCount - 1);
                console.log('[ComponentComment DEBUG] Updated count from', currentCount, 'to', Math.max(0, currentCount - 1));
            }
        }
    } else {
        console.log('[ComponentComment DEBUG] \u274C Delete failed - no UI changes made');
    }
}

/**
 * Show reaction picker for a comment
 */
function showCommentReactionPicker(commentId) {
    console.log('[CommentReactionPicker DEBUG] showCommentReactionPicker called');
    console.log('[CommentReactionPicker DEBUG] commentId:', commentId);
    console.log('[CommentReactionPicker DEBUG] QUICK_REACTIONS:', QUICK_REACTIONS);

    const commentEl = document.querySelector(`.component-comment[data-comment-id="${commentId}"]`);
    console.log('[CommentReactionPicker DEBUG] commentEl found:', commentEl);
    if (!commentEl) {
        console.log('[CommentReactionPicker DEBUG] \u274C No comment element found, returning early');
        return;
    }

    // Find the react button to position near it
    const reactBtn = commentEl.querySelector('.comment-action-btn[data-action="react"]');
    console.log('[CommentReactionPicker DEBUG] reactBtn found:', reactBtn);
    if (!reactBtn) {
        console.log('[CommentReactionPicker DEBUG] \u274C No react button found, returning early');
        return;
    }

    // Remove existing picker
    const existingPicker = document.querySelector('.comment-reaction-picker');
    console.log('[CommentReactionPicker DEBUG] Existing picker found:', existingPicker);
    if (existingPicker) existingPicker.remove();

    const picker = document.createElement('div');
    picker.className = 'comment-reaction-picker';
    console.log('[CommentReactionPicker DEBUG] Created picker element:', picker);

    QUICK_REACTIONS.forEach((emoji, index) => {
        console.log(`[CommentReactionPicker DEBUG] Adding emoji ${index}:`, emoji, 'type:', typeof emoji);
        const btn = document.createElement('button');
        btn.className = 'reaction-picker-btn';
        btn.textContent = emoji;
        console.log(`[CommentReactionPicker DEBUG] Button ${index} textContent:`, btn.textContent);
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            console.log('[CommentReactionPicker DEBUG] Emoji button clicked:', emoji);
            picker.remove();
            await toggleCommentReaction(commentId, emoji);
        });
        picker.appendChild(btn);
    });

    console.log('[CommentReactionPicker DEBUG] Picker innerHTML:', picker.innerHTML);
    console.log('[CommentReactionPicker DEBUG] Picker children count:', picker.children.length);

    // Append to body to avoid overflow clipping issues in presentation view
    document.body.appendChild(picker);
    console.log('[CommentReactionPicker DEBUG] \u2705 Picker appended to document.body');

    // Position the picker near the react button
    const rect = reactBtn.getBoundingClientRect();
    console.log('[CommentReactionPicker DEBUG] Button rect:', rect);

    picker.style.position = 'fixed';
    picker.style.zIndex = '10001'; // Higher than presentation modal (z-index: 1000)

    // Position above the button if there's room, otherwise below
    const pickerHeight = 50; // Approximate height
    if (rect.top > pickerHeight + 10) {
        picker.style.top = `${rect.top - pickerHeight - 8}px`;
    } else {
        picker.style.top = `${rect.bottom + 8}px`;
    }
    picker.style.left = `${Math.max(10, rect.left - 50)}px`;

    console.log('[CommentReactionPicker DEBUG] Final picker styles:', {
        position: picker.style.position,
        top: picker.style.top,
        left: picker.style.left,
        zIndex: picker.style.zIndex
    });

    // Verify picker is in DOM
    setTimeout(() => {
        const verifyPicker = document.querySelector('.comment-reaction-picker');
        console.log('[CommentReactionPicker DEBUG] Verify picker in DOM after append:', verifyPicker);
        if (verifyPicker) {
            const computedStyle = window.getComputedStyle(verifyPicker);
            console.log('[CommentReactionPicker DEBUG] Picker computed styles:', {
                display: computedStyle.display,
                visibility: computedStyle.visibility,
                opacity: computedStyle.opacity,
                position: computedStyle.position,
                zIndex: computedStyle.zIndex,
                width: computedStyle.width,
                height: computedStyle.height
            });
        }
    }, 10);

    // Close picker on outside click
    const closePicker = (e) => {
        console.log('[CommentReactionPicker DEBUG] closePicker triggered, target:', e.target);
        if (!picker.contains(e.target)) {
            console.log('[CommentReactionPicker DEBUG] Click outside picker, removing');
            picker.remove();
            document.removeEventListener('click', closePicker);
        }
    };
    setTimeout(() => document.addEventListener('click', closePicker), 0);
}

/**
 * Toggle a reaction on a comment
 */
async function toggleCommentReaction(commentId, emoji) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const commentEl = document.querySelector(`.component-comment[data-comment-id="${commentId}"]`);
    if (!commentEl) return;

    // Check if user already reacted
    const existingBadge = commentEl.querySelector(`.comment-reaction-badge[data-emoji="${emoji}"]`);
    const hasReacted = existingBadge?.classList.contains('user-reacted');

    const result = await api.toggleComponentCommentReaction(commentId, currentUser.id, emoji, !hasReacted);

    if (result) {
        // Update the reactions display
        updateCommentReactionsDisplay(commentEl, result);

        // Broadcast via Pusher if available
        const presentationChatChannel = getChannel ? getChannel() : null;
        if (presentationChatChannel) {
            presentationChatChannel.trigger('client-component-comment-reaction', {
                commentId,
                reactions: result,
                senderId: currentUser.id
            });
        }
    }
}

/**
 * Update the reactions display on a comment
 */
export function updateCommentReactionsDisplay(commentEl, reactions) {
    const currentUser = getCurrentUser();

    // Remove existing reactions container
    let reactionsContainer = commentEl.querySelector('.comment-reactions');
    if (reactionsContainer) reactionsContainer.remove();

    // Create new reactions container if there are any
    if (reactions && Object.keys(reactions).length > 0) {
        reactionsContainer = document.createElement('div');
        reactionsContainer.className = 'comment-reactions';

        for (const [emoji, users] of Object.entries(reactions)) {
            if (users.length > 0) {
                const hasReacted = users.includes(currentUser?.id);
                const badge = document.createElement('button');
                badge.className = `comment-reaction-badge ${hasReacted ? 'user-reacted' : ''}`;
                badge.dataset.emoji = emoji;
                badge.innerHTML = `${emoji} <span class="reaction-count">${users.length}</span>`;
                reactionsContainer.appendChild(badge);
            }
        }

        // Insert before actions
        const actions = commentEl.querySelector('.comment-actions');
        if (actions) {
            commentEl.insertBefore(reactionsContainer, actions);
        } else {
            commentEl.appendChild(reactionsContainer);
        }
    }
}

/**
 * Update the comment count badge for a component
 */
function updateCommentCount(componentId, count) {
    const countEl = document.querySelector(`.comments-count[data-component-id="${componentId}"]`);
    if (countEl) {
        countEl.textContent = count;
        if (count > 0) {
            countEl.classList.add('has-comments');
        } else {
            countEl.classList.remove('has-comments');
        }
    }
    // Update the label text to be more inviting when comments exist
    const toggle = document.querySelector(`.component-comments-toggle[data-component-id="${componentId}"]`);
    if (toggle) {
        const label = toggle.querySelector('.comments-label');
        if (label) {
            label.textContent = count > 0 ? `Comment${count !== 1 ? 's' : ''}` : 'Add a comment';
        }
    }
}

/**
 * Get time ago string from a date
 */
export function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

/**
 * Load initial comment counts for all items (lightweight)
 */
export async function loadAllCommentCounts() {
    console.log('[ComponentComment DEBUG] loadAllCommentCounts called');
    const sessionId = state.session.id;
    console.log('[ComponentComment DEBUG] sessionId for counts:', sessionId);

    if (!sessionId) {
        console.log('[ComponentComment DEBUG] \u274C No sessionId - skipping comment counts');
        return;
    }

    try {
        console.log('[ComponentComment DEBUG] Calling api.fetchAllComponentComments...');
        // Fetch all component comments for the session in one call
        const allComments = await api.fetchAllComponentComments(sessionId);
        console.log('[ComponentComment DEBUG] fetchAllComponentComments returned:', allComments?.length, 'comments');

        // Group by componentId and count
        // Also collect comments by component for image extraction
        const countsByComponent = new Map();
        const commentsByComponent = new Map();

        allComments.forEach(comment => {
            let componentId = null;

            // Check for Item Link field (regular items starting with 'rec')
            const itemLinks = comment.fields['Item Link'];
            if (itemLinks && itemLinks.length > 0) {
                componentId = itemLinks[0]; // Get the first linked item ID
            }

            // Check for custom items via content prefix [PLAN_COMMENT:item:componentId]
            // Matches all custom ID formats: manual-presentation-*, manual-add-*, ai-child-*, ai-presentation-*, solution-*
            if (!componentId) {
                const content = comment.fields?.Content || '';
                const manualItemMatch = content.match(/^\[PLAN_COMMENT:item:([^\]]+)\]/);
                if (manualItemMatch) {
                    componentId = manualItemMatch[1];
                }
            }

            if (componentId) {
                // Update count
                const current = countsByComponent.get(componentId) || 0;
                countsByComponent.set(componentId, current + 1);

                // Collect comments for image extraction
                if (!commentsByComponent.has(componentId)) {
                    commentsByComponent.set(componentId, []);
                }
                commentsByComponent.get(componentId).push(comment);
            }
        });

        console.log('[ComponentComment DEBUG] Comment counts by component:', Object.fromEntries(countsByComponent));

        // Update all count badges
        countsByComponent.forEach((count, componentId) => {
            updateCommentCount(componentId, count);
        });

        // Extract images from comments and add to carousels
        commentsByComponent.forEach((comments, componentId) => {
            extractAndAddCommentImages(componentId, comments);
        });

        console.log('[ComponentComment DEBUG] \u2705 Updated badges for', countsByComponent.size, 'components');
        log('Presentation', `Loaded comment counts for ${countsByComponent.size} components`);
    } catch (error) {
        console.log('[ComponentComment DEBUG] \u274C Error loading comment counts:', error);
        log('Presentation', `Error loading comment counts: ${error.message}`);
    }
}
