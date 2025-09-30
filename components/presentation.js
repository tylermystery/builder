/* REPLACE THE ENTIRE CONTENTS OF: components/presentation.js */

import { state } from '../state.js';
import * as api from '../api.js';
import * as ui from '../ui.js';
import { CONSTANTS } from '../config.js';
import { log } from '../utils/debug.js';

const modal = document.getElementById('presentation-modal-overlay');
let presentationBody = null;

// --- Module-level state for the presentation view ---
let currentItemRecord = null;
let currentImages = [];
let currentImageIndex = 0;


/**
 * Renders the main dashboard grid view inside the presentation modal.
 */
async function renderDashboard() {
    const dashboardHTML = `
        <div class="presentation-dashboard">
            <div class="dashboard-section" id="plan-section">
                <h3>Your Event Plan</h3>
                <div class="dashboard-grid" id="plan-grid"></div>
            </div>
            <div class="dashboard-section" id="ideas-section">
                <h3>More Ideas</h3>
                <div class="ideas-carousel" id="ideas-carousel"></div>
            </div>
        </div>
    `;
    if (presentationBody) presentationBody.innerHTML = dashboardHTML;

    const planGrid = modal.querySelector('#plan-grid');
    const ideasCarousel = modal.querySelector('#ideas-carousel');

    // Render Locked Items
    if (state.cart.lockedItems.size > 0) {
        for (const [recordId] of state.cart.lockedItems.entries()) {
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                const tile = await createDashboardTile(record, 'plan');
                planGrid.appendChild(tile);
            }
        }
    } else {
        modal.querySelector('#plan-section').style.display = 'none';
    }

    // Render Idea Items
    if (state.cart.items.size > 0) {
        for (const [recordId] of state.cart.items.entries()) {
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                const tile = await createDashboardTile(record, 'idea');
                ideasCarousel.appendChild(tile);
            }
        }
    } else {
        modal.querySelector('#ideas-section').style.display = 'none';
    }
}

/**
 * Renders the detailed, single-item view.
 * @param {object} record - The Airtable record to display.
 */
async function renderDetailedItemView(record) {
    currentItemRecord = record;
    const itemInfo = state.cart.lockedItems.get(record.id) || state.cart.items.get(record.id) || {};
    const price = ui.getRecordPrice(record, itemInfo.selectedOptionIndex);

    const detailHTML = `
        <div class="detailed-item-view">
            <div id="presentation-gallery-column">
                <div id="presentation-main-image"></div>
                <div id="presentation-thumbnail-strip"></div>
            </div>
            <div id="presentation-details-column">
                <button id="back-to-summary-btn">← Back to Summary</button>
                <h3 id="presentation-item-name">${record.fields.Name || ''}</h3>
                <p id="presentation-item-price">$${price.toFixed(2)}</p>
                <p id="presentation-item-description">${record.fields.Description || ''}</p>
                </div>
        </div>
    `;
    if (presentationBody) presentationBody.innerHTML = detailHTML;

    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    currentImages = imageUrls || [];
    currentImageIndex = 0;
    renderCurrentImage();
}

/**
 * Renders the current image in the detail view's gallery.
 */
function renderCurrentImage() {
    const mainImageEl = modal.querySelector('#presentation-main-image');
    const thumbStripEl = modal.querySelector('#presentation-thumbnail-strip');

    if (!mainImageEl || !thumbStripEl) return;

    if (currentImages.length === 0) {
        mainImageEl.style.backgroundImage = '';
        thumbStripEl.innerHTML = '<p>No images.</p>';
        return;
    }
    
    mainImageEl.style.backgroundImage = `url('${currentImages[currentImageIndex]}')`;
    
    thumbStripEl.innerHTML = '';
    currentImages.forEach((url, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail-img';
        thumb.style.backgroundImage = `url('${url}')`;
        if (index === currentImageIndex) thumb.classList.add('active');
        thumb.addEventListener('click', () => {
            currentImageIndex = index;
            renderCurrentImage();
        });
        thumbStripEl.appendChild(thumb);
    });
}

/**
 * Creates a single item tile for the dashboard.
 * @param {object} record - The Airtable record for the item.
 * @param {string} type - 'plan' or 'idea'.
 * @returns {HTMLElement} The generated tile element.
 */
async function createDashboardTile(record, type) {
    const tile = document.createElement('div');
    tile.className = 'item-tile';
    tile.dataset.recordId = record.id;
    tile.dataset.listType = type;
    
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    if (imageUrls && imageUrls.length > 0) {
        tile.style.backgroundImage = `url('${imageUrls[0]}')`;
    }
    
    tile.innerHTML = `<span class="item-tile-name">${record.fields.Name}</span>`;
    return tile;
}

/**
 * Main function to open and initialize the presentation view.
 */
export async function showPresentationView() {
    log('Presentation', `Showing Visual Event Dashboard`);

    if (state.cart.items.size === 0 && state.cart.lockedItems.size === 0) {
        alert(`Add items to your plan or ideas to present them.`);
        return;
    }

    modal.innerHTML = `<button id="presentation-close-btn" class="modal-close-btn" title="Close">×</button><div class="presentation-body"></div>`;
    presentationBody = modal.querySelector('.presentation-body');
    
    modal.classList.add('active');
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    
    await renderDashboard();
    setupPresentationEventListeners();
}

function hidePresentationView() {
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        modal.innerHTML = '';
    }, 300);
    document.body.classList.remove('modal-open');
}

export function setupPresentationEventListeners() {
    modal.addEventListener('click', (e) => {
        // Handle closing the modal
        if (e.target.id === 'presentation-close-btn' || e.target === modal) {
            hidePresentationView();
            return;
        }

        // Handle clicking a tile to drill down
        const tile = e.target.closest('.item-tile');
        if (tile) {
            const recordId = tile.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                renderDetailedItemView(record);
            }
            return;
        }

        // Handle clicking the back button
        const backBtn = e.target.closest('#back-to-summary-btn');
        if (backBtn) {
            renderDashboard();
            return;
        }
    });
}
