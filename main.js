/*
 * Version: 2.4.0
 * Last Modified: 2025-08-23
 *
 * Changelog:
 *
 * v2.4.0 - 2025-08-23
 * - Added getGroupPriceRange function to calculate min/max price of a group's children.
 */

import { state } from './state.js';
import { CONSTANTS } from './config.js';
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

function getDescendantBookableItems(recordId, allRecords) {
    let bookableItems = [];
    const children = allRecords.filter(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]?.[0] === recordId);

    for (const child of children) {
        const rawOptions = ui.parseOptions(child.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
        const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));

        if (isGrouping) {
            bookableItems = bookableItems.concat(getDescendantBookableItems(child.id, allRecords));
        } else {
            bookableItems.push(child);
        }
    }
    return bookableItems;
}

export function getGroupPriceRange(record) {
    const descendants = getDescendantBookableItems(record.id, state.records.all);
    if (descendants.length === 0) return null;

    let minPrice = Infinity;
    let maxPrice = -Infinity;

    descendants.forEach(item => {
        const options = ui.parseOptions(item.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        if (options.length > 0) {
            options.forEach((opt, index) => {
                const price = getRecordPrice(item, index);
                if (price < minPrice) minPrice = price;
                if (price > maxPrice) maxPrice = price;
            });
        } else {
            const price = getRecordPrice(item);
            if (price < minPrice) minPrice = price;
            if (price > maxPrice) maxPrice = price;
        }
    });
    
    return { min: minPrice, max: maxPrice };
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
    document.getElementById('save-share-btn').addEventListener('click', async () => {
        await api.saveSessionToAirtable();
    });

    // --- BETA TOOLKIT LISTENERS ---
    document.getElementById('beta-trigger').addEventListener('click', () => {
        document.getElementById('beta-toolkit').classList.toggle('visible');
    });
    document.getElementById('collab-mode-toggle').addEventListener('change', (e) => {
        document.body.classList.toggle('collab-mode-enabled', e.target.checked);
    });
    document.getElementById('planner-mode-toggle').addEventListener('change', (e) => {
        document.body.classList.toggle('planner-mode-enabled', e.target.checked);
    });
    document.getElementById('history-mode-toggle').addEventListener('change', (e) => {
        document.body.classList.toggle('history-mode-enabled', e.target.checked);
    });
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('redo-btn').addEventListener('click', redo);

    // --- UNIFIED CARD INTERACTION LISTENER ---
    document.body.addEventListener('click', async (e) => {
        const heartIcon = e.target.closest('.heart-icon');
        const parentBtn = e.target.closest('.parent-btn');
        const explodeBtn = e.target.closest('.explode-btn');
        const implodeBtn = e.target.closest('.implode-btn');
        const cardBody = e.target.closest('.event-card');
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
            return;
        }

        if (parentBtn && cardBody) {
            e.stopPropagation();
            const recordId = cardBody.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const parentId = record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM][0];
            const parentRecord = state.records.all.find(r => r.id === parentId);
            
            if (parentRecord) {
                const newCard = await ui.createInteractiveCard(parentRecord, imageCache);
                cardBody.replaceWith(newCard);
            }
            return;
        }
        
        if (explodeBtn && cardBody) {
            e.stopPropagation();
            const recordId = cardBody.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            
            const rawOptions = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const childNames = new Set(rawOptions.map(opt => opt.name));
            const children = state.records.all.filter(r => childNames.has(r.fields.Name));
            
            ui.renderRecords(children, imageCache);
            
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
    });

    document.body.addEventListener('change', async (e) => {
        const card = e.target.closest('.event-card');
        if (!card) return;

        if (e.target.classList.contains('configure-options')) {
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const rawOptions = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const initialPrice = parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
            
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
