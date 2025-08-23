/*
 * Version: 2.1.1
 * Last Modified: 2025-08-23
 *
 * Changelog:
 *
 * v2.1.1 - 2025-08-23
 * - Restored missing storeSession and getStoredSessions functions.
 */

import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD, REACTION_SCORES } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
const imageCache = new Map();

// --- STATE & HISTORY ---
export function recordStateForUndo() { /* ...logic... */ }
async function restoreState(newState) { /* ...logic... */ }
function undo() { /* ...logic... */ }
function redo() { /* ...logic... */ }

// --- CORE LOGIC ---
export function getStoredSessions() { return JSON.parse(localStorage.getItem('savedSessions') || '{}'); }

export function storeSession(id, name) { 
    const sessions = getStoredSessions(); 
    sessions[id] = name;
    localStorage.setItem('savedSessions', JSON.stringify(sessions)); 
}

export function getRecordPrice(record, optionIndex = null) {
    let price = parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
    if (optionIndex !== null) {
        const options = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const variation = options[optionIndex];
        if (variation) {
            if (variation.absolutePrice !== null) {
                return variation.absolutePrice;
            }
            if (variation.priceChange !== null) {
                price += variation.priceChange;
            }
        }
    }
    return price;
}

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
    
    document.body.addEventListener('click', async (e) => {
        const heartIcon = e.target.closest('.heart-icon');
        const parentBtn = e.target.closest('.parent-btn');
        const explodeBtn = e.target.closest('.explode-btn');
        const implodeBtn = e.target.closest('.implode-btn');
        const cardBody = e.target.closest('.event-card');
        const favoriteItem = e.target.closest('.favorite-item');
        const removeBtn = e.target.closest('.remove-btn');

        if (removeBtn) {
            e.stopPropagation();
            const recordId = removeBtn.dataset.compositeId;
            state.cart.items.delete(recordId);
            await ui.updateFavoritesCarousel();
            return;
        }

        if (heartIcon) {
            e.stopPropagation();
            const card = heartIcon.closest('.event-card, .favorite-item');
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            
            const rawOptions = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const childRecordNames = new Set(state.records.all.map(r => r.fields.Name));
            const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));
            
            let itemInfo = { quantity: 1, selectedOptionIndex: null, note: '' };

            if (!isGrouping && rawOptions.length > 0) {
                const selectedIndex = card.querySelector('.configure-options').value;
                const note = card.querySelector('.item-note').value;
                itemInfo.selectedOptionIndex = parseInt(selectedIndex, 10);
                itemInfo.note = note;
            }

            if (state.cart.items.has(recordId)) {
                state.cart.items.delete(recordId);
                heartIcon.classList.remove('hearted');
            } else {
                state.cart.items.set(recordId, itemInfo);
                heartIcon.classList.add('hearted');
            }
            await ui.updateFavoritesCarousel();
            return;
        }

        if (parentBtn) {
            e.stopPropagation();
            const card = parentBtn.closest('.event-card');
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const parentId = record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM][0];
            const parentRecord = state.records.all.find(r => r.id === parentId);
            
            if (parentRecord) {
                const newCard = await ui.createInteractiveCard(parentRecord, imageCache);
                card.replaceWith(newCard);
            }
            return;
        }
        
        if (explodeBtn) {
            e.stopPropagation();
            const card = explodeBtn.closest('.event-card');
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);

            const rawOptions = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const childNames = new Set(rawOptions.map(opt => opt.name));
            const children = state.records.all.filter(r => childNames.has(r.fields.Name));

            ui.catalogContainer.innerHTML = '';
            for (const child of children) {
                const childCard = await ui.createInteractiveCard(child, imageCache);
                ui.catalogContainer.appendChild(childCard);
            }
            const implodeButton = document.createElement('div');
            implodeButton.id = 'implode-container';
            implodeButton.innerHTML = `<button class="card-btn implode-btn" data-parent-id="${recordId}" title="Implode"> اجمع </button>`;
            document.querySelector('#catalog-container').insertAdjacentElement('beforebegin', implodeButton);
            return;
        }

        if (implodeBtn) {
            e.stopPropagation();
            implodeBtn.closest('#implode-container').remove();
            renderTopLevel();
            return;
        }

        if (cardBody) {
            const recordId = cardBody.dataset.recordId;
            await ui.openDetailModal(recordId, imageCache);
            return;
        }

        if (favoriteItem) {
            const recordId = favoriteItem.dataset.recordId;
            await ui.openDetailModal(recordId, imageCache);
            return;
        }
    });

    document.body.addEventListener('change', (e) => {
        if (e.target.classList.contains('configure-options')) {
            const card = e.target.closest('.event-card');
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const rawOptions = ui.parseOptions(record.fields.Options);
            const initialPrice = parseFloat(String(record.fields.Price || '0').replace(/[^0-9.-]+/g, ""));
            
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
            card.querySelector('.description').textContent = selectedOption.description || record.fields.Description || '';
        }
    });
}

initialize();
