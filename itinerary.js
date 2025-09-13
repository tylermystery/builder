<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Event Itinerary Builder</title>
    <link rel="stylesheet" href="styles/itinerary.css">
    <link rel="stylesheet" href="styles/main.css">
</head>
<body>
    <div class="itinerary-view">
        <header class="global-header">
            <h1 contenteditable="true">Event Title</h1>
            <div class="header-details">
                <span class="location">Location</span>
                <span class="date-range">Date Range</span>
            </div>
            <div class="header-actions">
                <button class="action-btn">Save</button>
                <button class="action-btn">Share</button>
                <button class="action-btn">Export</button>
            </div>
        </header>

        <main class="itinerary-container">
            <aside class="left-panel palette">
                <h2>Inspiration Hub</h2>
                <input type="search" placeholder="Search...">
                <div class="tabs">
                    <button class="tab active">Activities</button>
                    <button class="tab">Food & Drink</button>
                    <button class="tab">Transport</button>
                </div>
                <div class="recommendations">
                    <p>AI recommendations will appear here.</p>
                </div>
            </aside>

            <section class="center-panel timeline">
                <h2>Your Itinerary</h2>
                <div id="timeline-container" class="sortable-list">
                    <p class="placeholder">Drag items from the left to start building your itinerary.</p>
                </div>
            </section>

            <aside class="right-panel inspector">
                <h2>Item Details</h2>
                <p class="placeholder">Select an item from the timeline to see details here.</p>
                </aside>
        </main>

        <footer class="global-footer stat-bar">
            <span>💰 Total Cost: $0.00</span>
            <span>⏳ Activity Time: 0 hrs</span>
            <span>🚗 Travel Time: 0 hrs</span>
            <span>⚠️ Alerts: (0)</span>
        </footer>
    </div>
</body>
</html>
