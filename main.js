/*
 * Version: 1.5.0
 * Last Modified: 2025-08-18
 *
 * Changelog:
 *
 * v1.5.0 - 2025-08-18
 * - Added event listener to handle clicks on the new image gallery arrows.
 *
 * v1.4.0 - 2025-08-18
 * - Updated `getRecordPrice` to correctly handle absolute vs. relative price changes for variations.
 *
 * v1.3.0 - 2025-08-18
 * - Implemented logic to remove event cards from the catalog only after all their variations have been favorited.
 * - Event cards now auto-select the next available variation after one is favorited.
 *
 * v1.2.1 - 2025-08-17
 * - Fixed a critical HTML structure error in index.html.
 *
 * v1.2.0 - 2025-08-17
 * - Fixed broken filters by adding event listeners.
 * - Implemented a unified sorting system controlled by a new dropdown.
 * - Refactored `applyFilters` to handle both filtering and sorting.
 *
 * v1.0.0 - 2025-08-17
 * - Initial versioning and changelog added.
 */

// ... (top of the file is unchanged) ...

function setupEventListeners() {
    // ... (other listeners are unchanged) ...

    ui.catalogContainer.addEventListener('click', async function(e) {
        // Handle Image Gallery Arrows
        const arrow = e.target.closest('.card-arrow');
        if (arrow) {
            e.stopPropagation();
            const card = arrow.closest('.event-card');
            const recordId = card.dataset.recordId;
            const imageUrls = JSON.parse(card.dataset.imageUrls);
            let currentIndex = state.ui.cardImageIndexes.get(recordId) || 0;

            if (arrow.classList.contains('right')) {
                currentIndex = (currentIndex + 1) % imageUrls.length;
            } else {
                currentIndex = (currentIndex - 1 + imageUrls.length) % imageUrls.length;
            }
            
            state.ui.cardImageIndexes.set(recordId, currentIndex);
            card.querySelector('.card-image-container').style.backgroundImage = `url('${imageUrls[currentIndex]}')`;
            return;
        }

        const heart = e.target.closest('.heart-icon');
        if (heart) {
            e.stopPropagation();
            recordStateForUndo();
            
            const card = heart.closest('.event-card');
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const options = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            
            const compositeId = heart.dataset.compositeId;
            if (state.cart.items.has(compositeId) || state.cart.lockedItems.has(compositeId)) {
                return;
            }

            const quantity = card.querySelector('.quantity-input').value;
            const itemInfo = { quantity: parseInt(quantity), requests: '' };
            state.cart.items.set(compositeId, itemInfo);

            const allOptionsFavorited = options.every((opt, index) => {
                const id = `${recordId}-${index}`;
                return state.cart.items.has(id) || state.cart.lockedItems.has(id);
            });

            if (options.length > 0 && allOptionsFavorited) {
                card.remove();
            } else if (options.length === 0) {
                card.remove();
            } else {
                const newCard = await ui.createEventCardElement(record, imageCache);
                card.replaceWith(newCard);
            }
            
            await ui.updateFavoritesCarousel();
            return;
        }
        
        const editBtn = e.target.closest('.edit-card-btn');
        if (editBtn) {
            const card = editBtn.closest('.event-card');
            const compositeId = card.querySelector('.heart-icon').dataset.compositeId;
            await ui.openDetailModal(compositeId, imageCache);
        }
    });
    
    // ... (rest of the file is unchanged) ...
}

// --- INITIALIZATION ---
// ... (initialize function is unchanged) ...
