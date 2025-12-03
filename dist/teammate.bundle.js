// api.js
var PERSONAL_ACCESS_TOKEN = "patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57";
var BASE_ID = "app5yTznb3R5YNUFw";
var SESSIONS_TABLE_NAME = "Sessions";
window.debugFetchSession = async function(sessionId) {
  var _a, _b, _c, _d, _e, _f;
  console.log("[DEBUG] Manually fetching session:", sessionId);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
  try {
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
    });
    if (!response.ok) {
      console.error("[DEBUG] Failed to fetch session:", response.status, response.statusText);
      return null;
    }
    const data = await response.json();
    console.log("[DEBUG] Session data from Airtable:", data);
    console.log("[DEBUG] Session Name:", (_a = data.fields) == null ? void 0 : _a.Name);
    console.log("[DEBUG] Session Date:", (_b = data.fields) == null ? void 0 : _b.Date);
    console.log("[DEBUG] Session Stores:", (_c = data.fields) == null ? void 0 : _c.Stores);
    console.log("[DEBUG] Stores type:", typeof ((_d = data.fields) == null ? void 0 : _d.Stores));
    console.log("[DEBUG] Stores is array?", Array.isArray((_e = data.fields) == null ? void 0 : _e.Stores));
    console.log("[DEBUG] Stores value:", JSON.stringify((_f = data.fields) == null ? void 0 : _f.Stores));
    return data;
  } catch (error) {
    console.error("[DEBUG] Error fetching session:", error);
    return null;
  }
};

// teammate.js
function renderProfileHeader(teammate) {
  var _a, _b;
  const header = document.getElementById("profile-header");
  const avgRating = teammate.averageRating ? `${teammate.averageRating.toFixed(1)} ★` : "No Ratings Yet";
  header.innerHTML = `
        <img src="${((_b = (_a = teammate.fields.ProfilePicture) == null ? void 0 : _a[0]) == null ? void 0 : _b.url) || "https://via.placeholder.com/100"}" alt="${teammate.fields.Name}" class="profile-picture">
        <div class="profile-info">
            <h1>${teammate.fields.Name}</h1>
            <p>${teammate.fields.Role} | Overall Rating: <strong>${avgRating}</strong></p>
        </div>
    `;
}
function renderPerformanceStats(stats) {
  const container = document.querySelector("#performance-stats .stats-grid");
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
  const container = document.getElementById("event-list");
  if (sessions.length === 0) {
    container.innerHTML = "<p>No event or sales history found.</p>";
    return;
  }
  let eventHtml = "";
  sessions.forEach((session) => {
    const sessionRating = ratings.find((r) => r.fields.Session[0] === session.id);
    const ratingDisplay = sessionRating ? `${sessionRating.fields.RatingValue} ★` : "N/A";
    const role = session.role;
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
async function initializeProfilePage() {
  const urlParams = new URLSearchParams(window.location.search);
  const teammateId = urlParams.get("id");
  if (!teammateId) {
    document.getElementById("loading-message").textContent = "Error: No teammate ID provided.";
    return;
  }
  const [teammate, soldSessions, hostedSessions, ratings] = await Promise.all([
    (void 0)(teammateId),
    (void 0)(teammateId, "SalesLead"),
    (void 0)(teammateId, "EventHost"),
    (void 0)(teammateId)
  ]);
  const totalRatings = ratings.reduce((sum, r) => sum + r.fields.RatingValue, 0);
  teammate.averageRating = ratings.length > 0 ? totalRatings / ratings.length : 0;
  soldSessions.forEach((s) => s.role = "Sales");
  hostedSessions.forEach((s) => s.role = "Host");
  const allSessions = [...soldSessions, ...hostedSessions].sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
  const totalSales = soldSessions.reduce((sum, s) => {
    return sum + (s.fields.Value || 0);
  }, 0);
  const totalHours = teammate.fields.TotalHours || 0;
  const stats = {
    eventsSold: soldSessions.length,
    eventsHosted: hostedSessions.length,
    totalHours,
    totalSales
  };
  renderProfileHeader(teammate);
  renderPerformanceStats(stats);
  renderEventHistory(allSessions, ratings);
}
document.addEventListener("DOMContentLoaded", initializeProfilePage);
//# sourceMappingURL=teammate.bundle.js.map
