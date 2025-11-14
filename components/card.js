// REPLACE THE ENTIRE CONTENTS of components/card.js

import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
// VVV FINAL IMPORT FIX VVV
import { buildGoalBucket, calculateRecommendationScore } from '../availability.js'; 
// ^^^ END FINAL IMPORT FIX ^^^
import { CONSTANTS } from '../config.js';
import { getRecordPrice } from '../utils.js';
import { log } from '../utils/debug.js';

// --- THIS IS THE FIX ---
// Added "export" so other modules (like modal.js) can use it
export function getPlaceholderImage(imageUrls) {
// --- END THE FIX ---
    if (!imageUrls || imageUrls.length === 0) {
        return `https://res.cloudinary.com/${CONSTANTS.CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg`;
    }
    const randomIndex = Math.floor(Math.random() * imageUrls.length);
    return imageUrls[randomIndex];
}

export function updateCardIcon(recordId) {
    console.log(`[Card] ========== UPDATE CARD ICON DEBUG START ==========`);
    console.log(`[Card] Updating icon for record: ${recordId}`);
    console.log(`[Card] User authenticated:`, state.session.user.isAuthenticated);
    
    let isLiked = false;

    if (state.session.user.isAuthenticated) {
        isLiked = state.session.user.likedItemIds.has(recordId);
        console.log(`[Card] User is authenticated, checking liked items`);
        console.log(`[Card] Total liked items:`, state.session.user.likedItemIds.size);
        console.log(`[Card] All liked item IDs:`, Array.from(state.session.user.likedItemIds));
        console.log(`[Card] Is ${recordId} liked?`, isLiked);
    } else {
        console.log(`[Card] User is not authenticated, checking tempLikes`);
        try {
            const tempLikes = new Set(JSON.parse(localStorage.getItem('tempLikes') || '[]'));
            isLiked = tempLikes.has(recordId);
            console.log(`[Card] TempLikes:`, Array.from(tempLikes));
            console.log(`[Card] Is ${recordId} in tempLikes?`, isLiked);
        } catch (e) {
            console.error('[Card] Error reading tempLikes for icon update:', e);
            isLiked = false;
        }
    }

    // VVV Resilient SVG definition VVV
    const heartSVG = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>`;
    // ^^^ End resilient SVG definition ^^^

    // Query for all instances of the icon (card and modal)
    const elements = document.querySelectorAll(`.event-card[data-record-id="${recordId}"] .heart-icon, #modal-heart-btn[data-record-id="${recordId}"]`);
    console.log(`[Card] Found ${elements.length} icon elements to update for ${recordId}`);
    
    elements.forEach(icon => {
        if (!icon) return;

        const isInModal = icon.id === 'modal-heart-btn';
        const isInCard = icon.closest('.event-card');

        if (isLiked) {
            icon.className = 'heart-icon hearted';
            icon.title = 'Unlike this item';
            console.log(`[Card] Set icon to HEARTED for ${recordId}`);
            icon.innerHTML = heartSVG;
            icon.style.display = 'block';
            icon.style.pointerEvents = 'auto';
        } else {
            icon.className = 'heart-icon';
            icon.title = 'Like this item';
            console.log(`[Card] Set icon to UNHEARTED for ${recordId}`);
            
            if (isInModal) {
                icon.innerHTML = heartSVG;
                icon.style.display = 'block';
                icon.style.pointerEvents = 'auto';
            } else if (isInCard) {
                icon.style.display = 'none';
                icon.style.pointerEvents = 'none';
            }
        }
    });
    console.log(`[Card] ========== UPDATE CARD ICON DEBUG END ==========`);
}

export async function createInteractiveCard(record, allRecords, imageCache) {
    log('Card', `Creating card for "${record.fields.Name}"`);
    const eventCard = document.createElement('div');
    eventCard.dataset.recordId = record.id;
    const fields = record.fields;

    // --- ADD THIS "PARTNER" BADGE LOGIC ---
    let partnerBadge = '';
    if (fields.ServiceType === 'Partner Activity') {
        partnerBadge = '<span class="partner-badge">Partner</span>';
    }
    // --- END NEW LOGIC ---

    // --- VVV SCORE LOGIC REMOVED VVV ---
    // The scoreBanner variable is now always empty
    const scoreBanner = '';
    // --- ^^^ END SCORE LOGIC REMOVAL ^^^

    // --- This block handles custom items (from your previous step) ---
    let imageUrlToLoad;
    if (record.id.startsWith('custom-') || record.id.startsWith('ai-search-')) {
        imageUrlToLoad = getPlaceholderImage([]);
    } else {
        const { imageUrls } = await api.fetchImagesForRecord(record, allRecords, imageCache);
        imageUrlToLoad = getPlaceholderImage(imageUrls);
    }
    // --- END BLOCK ---

    if (fields['Item Type'] === 'Grouping') {
        const groupingCard = eventCard;
        groupingCard.className = 'event-card grouping-card';
        groupingCard.dataset.categoryName = fields.Name;
        const groupingNameForFilter = fields.Name.toLowerCase();
        const childItems = allRecords.filter(r => {
            if (r.fields['Item Type'] !== 'Bookable Item' && r.fields['Item Type'] !== 'Event') return false;
            const itemCategories = (r.fields.Categories || '')
                .split(',')
                .map(cat => cat.trim().toLowerCase());
            return itemCategories.includes(groupingNameForFilter);
        });

        const imagePromises = childItems.slice(0, 4).map(item => api.fetchImagesForRecord(item, allRecords, new Map()));
        const imageResults = await Promise.all(imagePromises);
        const collageImages = imageResults.flatMap(res => res.imageUrls);

        let imageContainerHTML = `<div class="event-card-image-container collage-container">`;
        if (collageImages.length > 0) {
            imageContainerHTML += collageImages.slice(0, 4).map(url => `<div class="collage-image lazy-load" data-bg-image="${url}"></div>`).join('');
        } else {
            imageContainerHTML += `<div class="collage-image lazy-load" data-bg-image="${imageUrlToLoad}"></div>`;
        }
        imageContainerHTML += `</div>`;
        groupingCard.innerHTML = `
            ${imageContainerHTML}
            <div class="event-card-content">
                <h3>${fields.Name || 'Untitled Category'}</h3>
                <p class="description">${fields.Description || ''}</p>
            </div>
            <div class="card-footer">
                <button class="card-action-btn view-options-btn">View Collection (${childItems.length})</button>
            </div>
        `;
        return groupingCard;
    }

    if (fields['Item Type'] === 'Event') {
        eventCard.className = 'event-card event-type-card';
        const eventDate = fields.Date ? new Date(fields.Date) : null;
        const month = eventDate ? eventDate.toLocaleString('default', { month: 'short' }).toUpperCase() : 'TBD';
        const day = eventDate ? eventDate.getDate() : '??';
        const hasRsvpd = (record.fields.RSVPs || []).includes(state.session.user.id);
        const buttonText = hasRsvpd ? "You're Going! ✅" : 'RSVP';
        const rsvpButtonHTML = `<button class="card-action-btn rsvp-btn" ${hasRsvpd ? 'disabled' : ''}>${buttonText}</button>`;

        eventCard.innerHTML = `
            <div class="event-card-image-container lazy-load" data-bg-image="${imageUrlToLoad}">
                <div class="heart-icon" data-record-id="${record.id}" style="display: none;"></div>
                ${partnerBadge} 
                ${scoreBanner} 
            </div>
            <div class="event-card-content">
                <div class="event-date-display">
                    <span class="month">${month}</span>
                    <span class="day">${day}</span>
                </div>
                <div class="event-details">
                    <h3>${fields.Name || 'Untitled Event'}</h3>
                    <p class="description">${fields.Description || ''}</p>
                </div>
            </div>
            <div class="card-footer">
                ${rsvpButtonHTML}
            </div>
        `;
        setTimeout(() => updateCardIcon(record.id), 0);
        return eventCard;
    }

    eventCard.className = 'event-card';
    const itemState = ui.getItemState(record.id);
    const headcountMin = fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const isLocked = state.cart.lockedItems.has(record.id);
    const quantitySelectorHTML = `<div class="quantity-selector"><button class="quantity-btn minus">-</button><input type="number" class="quantity-input" value="${itemState.quantity}" min="${headcountMin}"><button class="quantity-btn plus">+</button></div>`;
    const displayPrice = getRecordPrice(record, itemState.selectedOptionIndex);
    const pricingType = fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const pricingTypeHTML = pricingType ? `<span class="pricing-type">/ ${pricingType.toLowerCase()}</span>` : '';
    const priceHTML = `$${displayPrice.toFixed(2)} ${pricingTypeHTML}`;
    const addToPlanBtnHTML = `<button class="card-action-btn add-to-plan-btn" ${isLocked ? 'disabled' : ''}>${isLocked ? 'In Plan' : 'Add to Plan'}</button>`;
    eventCard.innerHTML = `
        <div class="event-card-image-container lazy-load" data-bg-image="${imageUrlToLoad}">
            <div class="heart-icon" data-record-id="${record.id}" style="display: none;"></div>
            ${partnerBadge} 
            ${scoreBanner} 
            </div>
        <div class="event-card-content">
            <h3>${fields.Name || 'Untitled Event'}</h3>
            <p class="description">${fields.Description || ''}</p>
        </div>
        <div class="card-footer">
            <div class="price-wrapper"><div class="price">${priceHTML}</div></div>
            <div class="actions-wrapper">${quantitySelectorHTML}${addToPlanBtnHTML}</div>
        </div>
    `;
    const plusBtn = eventCard.querySelector('.quantity-btn.plus');
    const minusBtn = eventCard.querySelector('.quantity-btn.minus');
    const quantityInput = eventCard.querySelector('.quantity-input');
    if (plusBtn && minusBtn && quantityInput) {
        plusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            quantityInput.stepUp();
            quantityInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        minusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            quantityInput.stepDown();
            quantityInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    setTimeout(() => updateCardIcon(record.id), 0);
    return eventCard;
}
