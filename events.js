import {
    debounce
} from './utils/utils.js';
import * as ui from './ui.js';
import * as state from './state.js';
import {
    triggerSave
} from './main.js';

/**
 * Initializes all event listeners for the application.
 * @param {HTMLDivElement} bodyEl - The main body element of the page.
 */
export function eventListeners(bodyEl) {

    // Global event listener for clicks
    document.addEventListener('click', async (e) => {
        const card = e.target.closest('.record-card');
        const lockedItemCard = e.target.closest('.locked-item-card');
        const favoriteItem = e.target.closest('.favorite-item');
        const addToCartBtn = e.target.closest('.add-to-cart-btn');
        const removeCartItemBtn = e.target.closest('.remove-cart-item-btn');
        const detailModalBtn = e.target.closest('.detail-modal-btn');
        const parentLink = e.target.closest('.parent-link');
        const heartIcon = e.target.closest('.heart-icon');
        const addToPlanBtn = e.target.closest('.add-to-plan-btn');
        const demoteBtn = e.target.closest('.demote-btn');
        const removeBtn = e.target.closest('.remove-btn');

        // Add this line to target the "reserve" button by its class
        const reserveBtn = e.target.closest('.reserve-btn');

        // Add this line to target the "pay remainder" button by its id
        const payRemainderBtn = document.getElementById('pay-remainder-button');


        // If an element with a quantity selector was clicked
        if (e.target.closest('.quantity-selector')) {
            e.stopPropagation();
        } else if (e.target.closest('.quantity-up-btn')) {
            const card = e.target.closest('.record-card');
            const recordId = card.dataset.recordId;
            const quantitySpan = card.querySelector('.quantity');
            let currentQuantity = parseInt(quantitySpan.textContent, 10);
            const newQuantity = currentQuantity + 1;
            ui.updateQuantity(recordId, newQuantity);
        } else if (e.target.closest('.quantity-down-btn')) {
            const card = e.target.closest('.record-card');
            const recordId = card.dataset.recordId;
            const quantitySpan = card.querySelector('.quantity');
            let currentQuantity = parseInt(quantitySpan.textContent, 10);
            if (currentQuantity > 1) {
                const newQuantity = currentQuantity - 1;
                ui.updateQuantity(recordId, newQuantity);
            }
        } else if (addToCartBtn) {
            e.stopPropagation();
            const recordId = addToCartBtn.closest('[data-record-id]').dataset.recordId;
            ui.addItemToCart(recordId);
        } else if (removeCartItemBtn) {
            e.stopPropagation();
            const recordId = removeCartItemBtn.closest('[data-record-id]').dataset.recordId;
            ui.removeItemFromCart(recordId);
        } else if (detailModalBtn) {
            e.stopPropagation();
            const recordId = detailModalBtn.closest('[data-record-id]').dataset.recordId;
            ui.showDetailModal(recordId);
        } else if (parentLink) {
            e.preventDefault();
            const recordId = e.target.closest('[data-record-id]').dataset.recordId;
            ui.showDetailModal(recordId);
        } else if (heartIcon) {
            e.stopPropagation();
            const recordId = heartIcon.closest('[data-record-id]').dataset.recordId;
            state.toggleFavorite(recordId);
            ui.updateCardIcon(recordId);
            await debounce(ui.updateFavoritesCarousel, 300)();
        } else if (addToPlanBtn || reserveBtn) {
            e.stopPropagation();
            const recordId = (addToPlanBtn || reserveBtn).closest('[data-record-id]').dataset.recordId;
            if (state.cart.lockedItems.has(recordId)) {
                ui.hideDetailModal();
                return;
            }
            const itemInfo = ui.getItemState(recordId);
            state.cart.lockedItems.set(recordId, itemInfo);
            state.cart.items.delete(recordId);
            ui.updateCardIcon(recordId);
            await debounce(ui.updateFavoritesCarousel, 300)();
            await ui.updateEventPlanSection();
            ui.updateTotalCost();
            triggerSave();
        } else if (demoteBtn) {
            e.stopPropagation();
            const recordId = demoteBtn.closest('[data-record-id]').dataset.recordId;
            const itemInfo = state.cart.lockedItems.get(recordId);
            state.cart.items.set(recordId, itemInfo);
            state.cart.lockedItems.delete(recordId);
            ui.updateCardIcon(recordId);
            await debounce(ui.updateFavoritesCarousel, 300)();
            await ui.updateEventPlanSection();
            ui.updateTotalCost();
            triggerSave();
        } else if (removeBtn && e.target === removeBtn) {
            e.stopPropagation();
            const recordId = removeBtn.closest('[data-record-id]').dataset.recordId;
            state.cart.lockedItems.delete(recordId);
            ui.updateCardIcon(recordId);
            await debounce(ui.updateFavoritesCarousel, 300)();
            await ui.updateEventPlanSection();
            ui.updateTotalCost();
            triggerSave();
        } else if (card && !e.target.closest('.quantity-selector')) {
            const recordId = card.dataset.recordId;
            ui.showDetailModal(recordId);
        } else if (lockedItemCard) {
            const recordId = lockedItemCard.dataset.recordId;
            ui.showDetailModal(recordId);
        } else if (favoriteItem && !e.target.closest('.add-to-plan-btn, .remove-btn')) {
            const recordId = favoriteItem.dataset.recordId;
            ui.showDetailModal(recordId);
        } else if (payRemainderBtn && e.target === payRemainderBtn) {
            e.preventDefault();
            ui.showCheckoutModal();
        }

    });

    // Event listener for the search input
    document.getElementById('search-input').addEventListener('input', (e) => {
        state.filters.search = e.target.value;
        debounce(ui.renderCards, 300)();
    });

    // Event listeners for filter checkboxes
    document.querySelectorAll('.filter-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            state.filters[checkbox.name] = checkbox.checked;
            ui.renderCards();
        });
    });

    // Event listeners for clearing filters
    document.getElementById('clear-filters-btn').addEventListener('click', () => {
        document.getElementById('search-input').value = '';
        state.filters.search = '';
        document.querySelectorAll('.filter-checkbox').forEach(checkbox => {
            checkbox.checked = false;
            state.filters[checkbox.name] = false;
        });
        ui.renderCards();
    });

    // Event listener to show/hide the sidebar on mobile
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        bodyEl.classList.toggle('sidebar-open');
    });

    // Event listener for the 'plan it' button
    document.getElementById('plan-it-button').addEventListener('click', () => {
        ui.showEventPlanModal();
    });

    // Event listener for the modal close button
    bodyEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal') && !e.target.closest('.modal-content')) {
            ui.hideDetailModal();
            ui.hideEventPlanModal();
            ui.hideCheckoutModal();
        }
    });

    // Event listener for exporting the file
    document.getElementById('export-plan-btn').addEventListener('click', async () => {
        ui.exportPlan();
    });
}
