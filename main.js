/*
 * Version: 2.5.0 (Polished)
 * Last Modified: 2025-08-23
 * This is the main application entry point and orchestrator.
 * It initializes the app, sets up the main event listeners, and manages the overall flow.
 * It imports from specialist modules (api.js, ui.js) but is not imported by them.
 */
import { state } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { getStoredSessions, storeSession } from './session.js';

const imageCache = new Map();

// --- CORE LOGIC ---
function renderTopLevel() {
    const topLevelRecords = state.records.all.filter(r => !r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]);
    ui.renderRecords(topLevelRecords, imageCache);
}

// --- INITIALIZATION & MAIN FLOW ---
async function initialize() {
    ui.toggleLoading(true);
    try {
        state.records.all = await api.fetchAllRecords();
    } catch (error) {
        console.error("Failed to load records:", error);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please try again later.</p>`;
        return;
    }
    
    ui.toggleLoading(false);
    setupEventListeners();
    renderTopLevel();
    ui.updateFavoritesCarousel();
}

function setupEventListeners() {
    ui.headerEventNameInput.addEventListener('change', () => { ui.updateHeader(); });
    document.getElementById('save-share-btn').addEventListener('click', async () => {
        await api.saveSessionToAirtable();
    });

    // --- BETA TOOLKIT LISTENERS ---
    document.getElementById('beta-trigger').addEventListener('click', () => {
        document.getElementById('beta-toolkit').classList.toggle('visible');
    });

    // --- UNIFIED CARD INTERACTION LISTENER ---
    // This single listener on the document body handles all clicks via event delegation.
    document.body.addEventListener('click', async (e) => {
        const removeBtn = e.target.closest('.remove-btn');
        const heartIcon = e.target.closest('.heart-icon');
        const parentBtn = e.target.closest('.parent-btn');
        const explodeBtn = e.target.closest('.explode-btn');
        const implodeBtn = e.target.closest('.implode-btn');

        // ROUTER: Checks for the most specific click target first.
        if (removeBtn) {
            // ACTION: Remove an item from the favorites carousel.
            e.stopPropagation();
            const recordId = removeBtn.dataset.compositeId;
            state.cart.items.delete(recordId);
            await ui.updateFavoritesCarousel();

        } else if (heartIcon) {
            // ACTION: Heart/unheart an item in the catalog.
            e.stopPropagation();
            const currentCard = heartIcon.closest('.event-card, .favorite-item');
            if (!currentCard) return; 
            const recordId = currentCard.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            
            const rawOptions = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const childRecordNames = new Set(state.records.all.map(r => r.fields.Name));
            const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));
            
            let itemInfo = { quantity: 1, selectedOptionIndex: null, note: '' };
            if (!isGrouping) {
                const noteEl = currentCard.querySelector('.item-note');
                const quantityEl = currentCard.querySelector('.quantity-input');
                if (rawOptions.length > 0) {
                    itemInfo.selectedOptionIndex = parseInt(currentCard.querySelector('.configure-options').value, 10);
                }
                if (noteEl) itemInfo.note = noteEl.value;
                if (quantityEl) itemInfo.quantity = parseInt(quantityEl.value, 10);
            }

            if (state.cart.items.has(recordId)) {
                state.cart.items.delete(recordId);
                heartIcon.classList.remove('hearted');
            } else {
                state.cart.items.set(recordId, itemInfo);
                heartIcon.classList.add('hearted');
            }
            await ui.updateFavoritesCarousel();

        } else if (parentBtn) {
            // ACTION: Navigate up to the parent item.
            e.stopPropagation();
            const card = parentBtn.closest('.event-card');
            if (!card) return;

            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);

            const parentRecord = state.records.all.find(p => {
                const options = ui.parseOptions(p.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
                return options.some(opt => opt.name === record.fields.Name);
            });

            if (parentRecord) {
                const newCard = await ui.createInteractiveCard(parentRecord, imageCache);
                card.replaceWith(newCard);
            } else {
                const implodeContainer = document.getElementById('implode-container');
                if (implodeContainer) implodeContainer.remove();
                renderTopLevel();
            }
        
        } else if (explodeBtn) {
            // ACTION: Show all children of a grouping.
            e.stopPropagation();
            const card = explodeBtn.closest('.event-card');
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            
            const rawOptions = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const childNames = new Set(rawOptions.map(opt => opt.name));
            const children = state.records.all.filter(r => childNames.has(r.fields.Name));
            
            ui.renderRecords(children, imageCache);
            
            const implodeButton = document.createElement('div');
            implodeButton.id = 'implode-container';
            implodeButton.innerHTML = `<button class="card-btn implode-btn" title="Implode"> اجمع </button>`;
            document.querySelector('#catalog-container').insertAdjacentElement('beforebegin', implodeButton);
        
        } else if (implodeBtn) {
            // ACTION: Collapse the exploded view and return to the top level.
            e.stopPropagation();
            implodeBtn.closest('#implode-container').remove();
            renderTopLevel();
        }
    });

    // This listener handles the dropdowns on the interactive cards.
    document.body.addEventListener('change', async (e) => {
        const card = e.target.closest('.event-card');
        if (!card) return;

        // Handles configuration changes on Bookable Items.
        if (e.target.classList.contains('configure-options')) {
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const rawOptions = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const initialPrice = parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]/g, ""));
            
            const selectedIndex = parseInt(e.target.value, 10);
            const selectedOption = rawOptions[selectedIndex];
            
            let newPrice = initialPrice;
            if (selectedOption) {
                if (selectedOption.absolutePrice != null) {
                    newPrice = selectedOption.absolutePrice;
                } else if (selectedOption.priceChange != null) {
                    newPrice += selectedOption.priceChange;
                }
            }
            card.querySelector('.price').textContent = `$${newPrice.toFixed(2)}`;
            card.querySelector('.description').textContent = selectedOption.description || record.fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || '';
        }

        // Handles navigation changes on Grouping Items.
        if (e.target.classList.contains('navigate-options')) {
            const childName = e.target.value;
            if (!childName) return;
            const childRecord = state.records.all.find(r => r.fields.Name === childName);
            if (childRecord) {
                const newCard = await ui.createInteractiveCard(childRecord, imageCache);
                card.replaceWith(newCard);
            }
        }
    });
}

initialize();
