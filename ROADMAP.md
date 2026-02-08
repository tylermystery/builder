## Version 3.1: Teammate Profiles (✅ COMPLETE)
**Core Objective:** To build an internal performance tracking system for teammates.
**Key Features Delivered:**
- **Airtable Schema Update:** Created `Teammates` and `Ratings` tables and linked them to `Sessions`.
- **Teammate Profile Page:** A new private page (`teammate.html`) now displays a teammate's performance snapshot, including metrics for events sold/hosted, hours, sales value, and average rating.
- **CRM Integration:** The main CRM Dashboard now links to individual teammate profile pages.
---
## Version 3.2: UMW MVP & Dynamic Shop UI (✅ COMPLETE)
**Core Objective:** To adapt the UI and functionality for non-event-based shops, controlled by a centralized settings system.
**Key Features Delivered:**
- **Store-Specific Settings:** The `Stores` table in Airtable now acts as a control panel with new fields (`ShopType`, `EnabledFilters`, `CartLabels`, `PaymentOptions`, `TermsAndConditions`) to manage each storefront's behavior.
- **Dynamic Filter Display:** The filter panel on the main page now dynamically shows or hides filters based on the settings for the active shop.
- **Dynamic UI Text:** Labels and placeholders in the cart/sidebar now update based on the `CartLabels` JSON field for the active shop.
- **Flexible Checkout:** The checkout modal now supports different payment options controlled by the `PaymentOptions` setting.
- **Session Persistence:** Session links now open in the correct store, and refreshing the page correctly remembers the last-viewed shop.
---
## Version 3.3: Advanced Authentication & Owner Portal Access (✅ COMPLETE)
**Core Objective:** To replace the basic login system with a secure, real-time "magic link" flow and provide a dedicated access point for store owners.
**Key Features Delivered:**
- **Real-Time "Confirmation Click" Login:** Implemented a Pusher-based authentication flow where clicking an email link logs the user in on their original browser tab.
- **Airtable Schema for Authentication:** Added `Users` and `Magic Links` tables to the Airtable base to manage user identities and temporary login tokens.
- **Store Owner Identification:** The system now links records in the `Users` table to records in the `Stores` table for role-based permissions.
- **Conditional UI for Owners:** The "My Account" popup now dynamically displays a "Store Dashboard" button exclusively for logged-in store owners.
---
## Version 3.4: AI Sales Assistant (On Hold)
**Core Objective:** To automate CRM data entry by parsing sales emails with an AI assistant.
- **Current Status:** A serverless function (`/api/process-email`) and a Zapier webhook have been built. The function is not yet deploying successfully and debugging is paused.
---
## Version 3.5: Database-Driven Plans & UI Polish (✅ COMPLETE)
**Core Objective:** To refactor session management to be database-driven, removing the reliance on local storage and improving the user experience for both guests and authenticated users.
**Key Features Delivered:**
- **Database-Driven "My Plans":** The user's list of saved plans is now dynamically fetched from Airtable by querying for sessions where the user is a collaborator, rather than relying on browser `localStorage`.
- **Guest Session "Claiming":** Anonymous users can build a plan, and when they sign in, their active session is automatically associated with their user account and added to their "My Plans" list.
- **Streamlined Header UI:** A new global header was created to house the shop title, the "My Plans" dropdown, and the user profile button, creating a cleaner and more intuitive user experience.
- **Bug Fixes & Cleanup:** Resolved a series of complex bugs related to Airtable queries and UI event listeners. Removed obsolete UI elements and their corresponding JavaScript.
---
## Version 3.6: Plan Board View (🔄 IN PROGRESS)
**Core Objective:** To transform the presentation view from a vertical accordion list into a full "Plan Board" where all entries are visible as compact card tiles in a responsive grid, with key metadata always surfaced.

**Design Decisions:**
- **Layout:** Responsive CSS Grid with no inline card expansion. Two levels only: board overview → detail modal.
- **Entry Model:** Implicit promotion — all entries start as "ideas" and can be changed to goal/locked/archived/completed. Existing `combinedItems` and `relatedGroups` structures handle merging and grouping.
- **Drag Behavior:** Draggable comments and tasks skipped for initial release.
- **Card Layout:** Status badge floating top-left over photo, summary emoji floating top-right. Tooltip preserved with full ranking/score/emoji spread breakdown.
- **Source Visibility:** Merged source entries shown as provenance text on parent card (badges/pills), not as separate cards.

**Development Phases:**
1. **Phase 1: Compact Card Component (Foundation)** — New `renderCompactCard()` function, grid layout container, view mode toggle, card click → detail modal
2. **Phase 2: Grid Layout and View Mode** — Responsive CSS Grid, view toggle (board ▦ / list ☰), localStorage persistence
3. **Phase 3: Entry Provenance and Visual Type Indicators** — Merged-entry provenance display, options group rendering, visual lifecycle indicators (idea/goal/locked/archived/completed)
4. **Phase 4: Comment/Task Badges and Reactions Bar** — Batch comment counts, task status badges, compact reaction bar on cards
5. **Phase 5: Drag-and-Drop for Grid Mode** — SortableJS grid support, radial menu repositioning, card-to-card merge detection
6. **Phase 6: Polish, Responsiveness, and Edge Cases** — Empty/single item states, animations, responsive touch, performance, accessibility
