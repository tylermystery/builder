/* REPLACE THE ENTIRE CONTENTS OF: components/presentation.js */

import { state } from '../state.js';
import * as api from '../api.js';
import * as ui from '../ui.js';
import { CONSTANTS } from '../config.js';
import { log } from '../utils/debug.js';

const modal = document.getElementById('presentation-modal-overlay');
const closeBtn = document.getElementById('presentation-close-btn');
let presentationBody = null; // Will be assigned when modal is shown

/**
 * NEW HELPER: Creates a single item tile for the dashboard.
 * @param {object} record - The Airtable record for the item.
 * @returns {HTMLElement} The generated tile element.
 */
async function createDashboardTile(record) {
    const tile = document.createElement('div');
    tile.className = 'item-tile';
    tile.dataset.recordId = record.id;
    
    // Fetch a representative image for the tile background
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    if (imageUrls && imageUrls.length > 0) {
        tile.style.backgroundImage = `url('${imageUrls[0]}')`;
    }
    
    tile.innerHTML = `<span class="item-tile-name">${record.fields.Name}</span>`;
    return tile;
}

/**
 * REFACTORED: This function now builds and displays the main dashboard view.
 */
export async function showPresentationView() {
    log('Presentation', `Showing new Visual Event Dashboard`);

    if (state.cart.items.size === 0 && state.cart.lockedItems.size === 0) {
        alert(`Add items to your plan or ideas to present them.`);
        return;
    }

    modal.innerHTML = `
        <button id="presentation-close-btn" class="modal-close-btn" title="Close">×</button>
        <div class="presentation-body">
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
        </div>
    `;

    // Re-assign element variables now that the innerHTML is set
    presentationBody = modal.querySelector('.presentation-body');
    const planGrid = modal.querySelector('#plan-grid');
    const ideasCarousel = modal.querySelector('#ideas-carousel');
    
    // Show modal
    modal.classList.add('active');
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');

    // Asynchronously render tiles for locked-in items
    if (state.cart.lockedItems.size > 0) {
        for (const [recordId] of state.cart.lockedItems.entries()) {
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                const tile = await createDashboardTile(record);
                planGrid.appendChild(tile);
            }
        }
    } else {
        modal.querySelector('#plan-section').style.display = 'none';
    }

    // Asynchronously render tiles for idea items
    if (state.cart.items.size > 0) {
        for (const [recordId] of state.cart.items.entries()) {
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                const tile = await createDashboardTile(record);
                ideasCarousel.appendChild(tile);
            }
        }
    } else {
        modal.querySelector('#ideas-section').style.display = 'none';
    }
    
    // Setup event listeners for the modal itself
    setupPresentationEventListeners();
}

function hidePresentationView() {
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        modal.innerHTML = ''; // Clear content to ensure a fresh state
    }, 300);
    document.body.classList.remove('modal-open');
}

export function setupPresentationEventListeners() {
    // Use event delegation on the modal for close actions
    modal.addEventListener('click', (e) => {
        if (e.target.id === 'presentation-close-btn' || e.target === modal) {
            hidePresentationView();
        }
    });
}
