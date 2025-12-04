// Import the API functions we are about to add
import * as api from './api.js';

// --- Helper Functions ---
function renderProfileHeader(teammate) {
    const header = document.getElementById('profile-header');
    const avgRating = teammate.averageRating ? `${teammate.averageRating.toFixed(1)} ★` : 'No Ratings Yet';
    header.innerHTML = `
        <img src="${teammate.fields.ProfilePicture?.[0]?.url || 'https://via.placeholder.com/100'}" alt="${teammate.fields.Name}" class="profile-picture" loading="lazy">
        <div class="profile-info">
            <h1>${teammate.fields.Name}</h1>
            <p>${teammate.fields.Role} | Overall Rating: <strong>${avgRating}</strong></p>
        </div>
    `;
}

function renderPerformanceStats(stats) {
    const container = document.querySelector('#performance-stats .stats-grid');
    container.innerHTML = `
        <div class="stat-item">
            <div class="value">${stats.eventsSold}</div>
            <div class="label">Events Sold</div>
        </div>
        <div class="stat-item">
            <div class="value">${stats.eventsHosted}</div>
            <div class="label">Events Hosted</div>
        </div>
        <div class="stat-item">
            <div class="value">${stats.totalHours}</div>
            <div class="label">Hours Worked</div>
        </div>
        <div class="stat-item">
            <div class="value">$${stats.totalSales.toLocaleString()}</div>
            <div class="label">Total Sales Value</div>
        </div>
    `;
}

function renderEventHistory(sessions, ratings) {
    const container = document.getElementById('event-list');
    if (sessions.length === 0) {
        container.innerHTML = '<p>No event or sales history found.</p>';
        return;
    }
    
    let eventHtml = '';
    sessions.forEach(session => {
        const sessionRating = ratings.find(r => r.fields.Session[0] === session.id);
        const ratingDisplay = sessionRating ? `${sessionRating.fields.RatingValue} ★` : 'N/A';
        const role = session.role; // 'Sales' or 'Host'

        eventHtml += `
            <div class="event-item">
                <span class="event-name">${session.fields.Name}</span>
                <span class="event-role">${role}</span>
                <span class="event-rating">${ratingDisplay}</span>
            </div>
        `;
    });
    container.innerHTML = eventHtml;
}

// --- Main Initialization ---
async function initializeProfilePage() {
    const urlParams = new URLSearchParams(window.location.search);
    const teammateId = urlParams.get('id');

    if (!teammateId) {
        document.getElementById('loading-message').textContent = 'Error: No teammate ID provided.';
        return;
    }

    // Fetch all necessary data in parallel
    const [teammate, soldSessions, hostedSessions, ratings] = await Promise.all([
        api.fetchTeammateData(teammateId),
        api.fetchSessionsForTeammate(teammateId, 'SalesLead'),
        api.fetchSessionsForTeammate(teammateId, 'EventHost'),
        api.fetchRatingsForTeammate(teammateId)
    ]);

    // --- Process and Calculate Data ---
    const totalRatings = ratings.reduce((sum, r) => sum + r.fields.RatingValue, 0);
    teammate.averageRating = ratings.length > 0 ? totalRatings / ratings.length : 0;
    
    soldSessions.forEach(s => s.role = 'Sales');
    hostedSessions.forEach(s => s.role = 'Host');
    const allSessions = [...soldSessions, ...hostedSessions].sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));

    const totalSales = soldSessions.reduce((sum, s) => {
        // NOTE: You'll need a "Value" or "Price" field on your Sessions table
        return sum + (s.fields.Value || 0);
    }, 0);
    
    // NOTE: For now, we get total hours from the Teammate table.
    // Later, this would be a sum of `session.fields.HoursWorked`
    const totalHours = teammate.fields.TotalHours || 0;

    const stats = {
        eventsSold: soldSessions.length,
        eventsHosted: hostedSessions.length,
        totalHours: totalHours,
        totalSales: totalSales,
    };

    // --- Render UI Components ---
    renderProfileHeader(teammate);
    renderPerformanceStats(stats);
    renderEventHistory(allSessions, ratings);
}

// Run the initialization function when the page loads
document.addEventListener('DOMContentLoaded', initializeProfilePage);
