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
## Version 3.6: Plan Board View (✅ COMPLETE)
**Core Objective:** To transform the presentation view from a vertical accordion list into a full "Plan Board" where all entries are visible as compact card tiles in a responsive grid, with key metadata always surfaced.

**Design Decisions:**
- **Layout:** Responsive CSS Grid with no inline card expansion. Two levels only: board overview → detail modal.
- **Entry Model:** Implicit promotion — all entries start as "ideas" and can be changed to goal/locked/archived/completed. Existing `combinedItems` and `relatedGroups` structures handle merging and grouping.
- **Drag Behavior:** Draggable comments and tasks skipped for initial release.
- **Card Layout:** Status badge floating top-left over photo, summary emoji floating top-right. Tooltip preserved with full ranking/score/emoji spread breakdown.
- **Source Visibility:** Merged source entries shown as provenance text on parent card (badges/pills), not as separate cards.

**Development Phases:**
1. **Phase 1: Compact Card Component (Foundation)** ✅ — New `renderCompactCard()` function, grid layout container as the sole rendering path, card click → detail modal
2. **Phase 2: Entry Provenance and Visual Type Indicators** ✅ — Merged-entry provenance as source-type badges, lifecycle state badges on photo, entry source-type indicators, lifecycle-aware group card rendering
3. **Phase 3: Comment/Task Badges and Reactions Bar** ✅ — Styled reaction pill bar, task status meta badges, comment count badges, aggregate group card badges
4. **Phase 4: Drag-and-Drop for Grid Mode** ✅ — SortableJS grid support with compact card draggables, radial menu repositioning for grid cards, card-to-card merge detection with zone-aware visual feedback
5. **Phase 5: Polish, Responsiveness, and Edge Cases** ✅ — Enhanced empty/single-item states, staggered card entrance animations, responsive touch optimizations, GPU performance tuning, keyboard navigation with focus-visible, ARIA roles and labels, reduced-motion and high-contrast support

---
## Version 3.7: Emoji Reaction System Overhaul (✅ COMPLETE)
**Core Objective:** To overhaul the emoji reaction system with a multi-emoji democratic model, hierarchical summary aggregation, and real-time synchronization — delivered in a six-phase plan.

**Completed Phases:**
1. **Phase 1: Foundation — Data Model Migration** ✅ — Migrated reactions from single-emoji to multi-emoji model using `Map<userId, Set<emoji>>`. Fixed nine bugs across reaction summary displays (RSB emoji button state, radial grid scoring, modal summary badges), real-time Pusher sync (broadcast from modal and action menu), and save/load cycle (key serialization mismatch). Added 20 `[REACTIONS-DEBUG]` diagnostic statements across the full reaction lifecycle.
2. **Phase 2: Emoji-Based Summary Layer** ✅ — Implemented hierarchical summary emojis for threads, items, and plans using democratic averaging. Added `convertMessageReactions()` bridge utility to unify reaction formats. Thread-level summaries aggregate parent + reply reactions. Item-level summaries aggregate direct reactions + variations + comment thread reactions. Group-level and plan-level summaries use the same hierarchical model. Added 21 `[SUMMARY-DEBUG]` diagnostic statements.

**Remaining Phases (Not Yet Started):**
- **Phase 3: Chat-to-Task Promotion with Grayed Action Menu** — Action menu on chat messages with grayed-out task actions that promote chats to tasks on selection
- **Phase 4: Plan Items as Implicit Ideas** — Custom items default to "idea" status, manual add button says "add idea"
- **Phase 5: Photo-Level Reactions** — Uses compound key infrastructure built in Phase 1
- **Phase 6: Layered Scroll Interaction** — Distance-based layer navigation for deeper content

**Files Modified in This Version:**
- `config.js` — `convertMessageReactions()` bridge utility
- `api.js` — Reaction deserialization/serialization with key repair logic
- `components/presentation.js` — Hierarchical `getItemSummaryEmoji()`, `getItemReactionCount()`, `getEventSummaryEmoji()`, group-level democratic averaging, `broadcastReactionUpdate()` helper
- `components/forumPanel.js` — `getThreadSummaryEmoji()`, `getComponentMessageReactions()`
- `components/actionMenu.js` — Hierarchical `getReactionSummary()`, Pusher broadcast
- `components/modal.js` — Hierarchical RSB panel, radial grid, summary content
- `utils/planStateSync.js` — Plan-level reaction summary data in `getPlanSummary()`
- `css/deferred.css` — Styles for `.compact-reaction-summary`, `.compact-reaction-score`, `.thread-summary-emoji`

---
## Version 3.8: Real-World Live Integration (Phase 1 IN PROGRESS)
**Core Objective:** Integrate a live video/audio communication layer that interacts with the Airtable-backed project hierarchy and the Pusher-based chat system. This module brings real-world synchronization into the Warehouse OS.

**Design Decisions (Finalized):**

| # | Decision | Resolution |
|---|----------|------------|
| 1 | WebRTC Provider | **Agora** — lower-level API control, custom UI flexibility aligned with Warehouse OS aesthetic |
| 2 | State Model | **Plan = Project = Session.** Auto-created top-level plan serves as default workspace |
| 3 | Vitality UI | **Keep dormant.** Emoji reactions/summaries serve as the vitality/score layer for now |
| 4 | Transcription Pipeline | **Agora Real-Time Transcription (RTT)** — provider-side transcription forwarded to Netlify Function |
| 5 | Video Layout | **Video chat toolbar in presentation header** with collapsible video strip below header. Current plan board layout preserved |
| 6 | Authentication | **Authenticated users start streams** (always tied to a plan). **Viewers don't need auth** |
| 7 | Voice Commands | **"Ryry"** wake word with confirmation toast + 5-second undo window |
| 8 | Top-Level Plan | **Auto-created** on first login — serves as default workspace for video sessions |
| 9 | Viewer Access | **Shareable link + in-plan LIVE indicator** (both mechanisms) |

**Phase 1: Foundation — Agora SDK & Basic Video (IN PROGRESS)**
- Added Agora SDK lazy-loading via CDN (`components/liveStream.js`)
- Created Agora token generation Netlify Function (`netlify/functions/agora-token.js`)
- Added video chat toolbar to presentation header (Go Live, Mute, Camera, End Stream)
- Added collapsible video preview strip below header for local/remote video
- Extended `state.js` with stream state (`state.stream.*`) and top-level plan (`state.topLevelPlan.*`)
- Added Agora + Ryry configuration to `config.js`
- Integrated toolbar with `presentation.js` (init, cleanup, event handlers)
- Added auto top-level plan creation in `auth.js` login flow via `api.ensureTopLevelPlan()`

**Remaining Phases:**
- **Phase 2:** Chat panel full-screen mode & stream-plan association
- **Phase 3:** Contextual tagging (pin messages to plan items during streams)
- **Phase 4:** AI Transcription Bridge (Ryry voice commands via Agora RTT)
- **Phase 5:** Shareable stream links & viewer experience
- **Phase 6:** Polish, state sync, & real-time reactions during streams

**Design Constraint:** Maintain the "Authenticity" ethos — the UI should feel like a "Warehouse OS," not a corporate meeting tool.
