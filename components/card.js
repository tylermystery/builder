import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS } from '../config.js';
import { parseOptions } from '../utils.js';
import { log } from '../utils/debug.js';

function getPlaceholderImage(imageUrls) {
    if (!imageUrls || imageUrls.length === 0) {
        return `https://res.cloudinary.com/${CONSTANTS.CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg`;
    }
    const randomIndex = Math.floor(Math.random() * imageUrls.length);
    return imageUrls[randomIndex];
}

export function updateCardIcon(recordId) {
    const isLocked = state.cart.lockedItems.has(recordId);
    const isHearted = state.cart.items.has(recordId);
    const heartSVG = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>`;
    const checkSVG = `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg>`;
    document.querySelectorAll(`.event-card[data-record-id="${recordId}"] .heart-icon, #modal-heart-btn[data-record-id="${recordId}"]`).forEach(icon => {
        if (!icon) return;
        if (isLocked) {
            icon.className = 'heart-icon locked';
            icon.innerHTML = checkSVG;
        } else if (isHearted) {
            icon.className = 'heart-icon hearted';
            icon.innerHTML = heartSVG;
        } else {
            icon.className = 'heart-icon';
            icon.innerHTML = heartSVG;
        }
        icon.style.display = 'block';
    });
}

// --- THIS IS THE CORRECTED FUNCTION WRAPPER ---
export async function createInteractiveCard(record, allRecords, imageCache) {
    const eventCard = document.createElement('div');
    eventCard.dataset.recordId = record.id;
    const fields = record.fields;

    const { imageUrls } = await api.fetchImagesForRecord(record, allRecords, imageCache);
    const imageUrlToLoad = getPlaceholderImage(imageUrls);

    if (fields['Item Type'] === 'Grouping') {
        const groupingCard = eventCard; // Re-use the created element
        groupingCard.className = 'event-card grouping-card';
        groupingCard.dataset.categoryName = fields.Name;

        const groupingNameForFilter = fields.Name.toLowerCase();
        const childItems = allRecords.filter(r => {
            if (r.fields['Item Type'] !== 'Bookable Item') return false;
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

// --- LOGIC FOR EVENT CARDS ---
    if (fields['Item Type'] === 'Event') {
        eventCard.className = 'event-card event-type-card';

        // Date Display Logic
        const eventDate = fields.Date ? new Date(fields.Date) : null;
        const month = eventDate ? eventDate.toLocaleString('default', { month: 'short' }).toUpperCase() : 'TBD';
        const day = eventDate ? eventDate.getDate() : '??';

        // RSVP Button Logic
        const hasRsvpd = (record.fields.RSVPs || []).includes(state.session.user.id);
        const buttonText = hasRsvpd ? "You're Going! ✅" : 'RSVP';
        const rsvpButtonHTML = `<button class="card-action-btn rsvp-btn" ${hasRsvpd ? 'disabled' : ''}>${buttonText}</button>`;

        eventCard.innerHTML = `
            <div class="event-card-image-container lazy-load" data-bg-image="${imageUrlToLoad}">
                <div class="heart-icon" data-record-id="${record.id}"></div>
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
        return eventCard; // This is the crucial missing line
    }

    // --- LOGIC FOR BOOKABLE ITEM CARDS (DEFAULT) ---
    eventCard.className = 'event-card';
    const itemState = ui.getItemState(record.id);
    const headcountMin = fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const isLocked = state.cart.lockedItems.has(record.id);
    const quantitySelectorHTML = `<div class="quantity-selector"><button class="quantity-btn minus">-</button><input type="number" class="quantity-input" value="${itemState.quantity}" min="${headcountMin}"><button class="quantity-btn plus">+</button></div>`;
    const displayPrice = ui.getRecordPrice(record, itemState.selectedOptionIndex);
    const pricingType = fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const pricingTypeHTML = pricingType ? `<span class="pricing-type">/ ${pricingType.toLowerCase()}</span>` : '';
    const priceHTML = `$${displayPrice.toFixed(2)} ${pricingTypeHTML}`;
    const addToPlanBtnHTML = `<button class="card-action-btn add-to-plan-btn" ${isLocked ? 'disabled' : ''}>${isLocked ? 'In Plan' : 'Add to Plan'}</button>`;
    
    eventCard.innerHTML = `
        <div class="event-card-image-container lazy-load" data-bg-image="${imageUrlToLoad}">
            <div class="heart-icon" data-record-id="${record.id}"></div>
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
