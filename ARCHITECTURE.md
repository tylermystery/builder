# Application Architecture Overview
This document outlines the technical architecture of the interactive event catalog.
The application is built on a modular architecture to ensure maintainability and scalability. Each JavaScript file has a distinct responsibility, separating concerns like data management, API communication, user interaction, and UI rendering.

## Core Modules
- **main.js:** The primary entry point for the public-facing application. Orchestrates initial setup, data fetching, event listeners, and the first UI render.
- **teammate.js:** The primary entry point for the internal teammate profile page. Fetches and renders performance data for a specific teammate.
- **events.js:** A centralized module that handles all user interactions, containing event listeners for clicks, form inputs, and other user-driven events.
- **filtering.js:** Contains the complete logic for filtering and sorting the catalog based on user selections.
- **api.js:** Manages all communication with external services like Airtable and Cloudinary.
- **state.js:** Acts as a centralized, in-memory database for the application's current state.
- **config.js:** A simple module for storing global constants and configuration values.
- **session.js:** A minimal module, formerly used for managing session history in `localStorage`. This functionality has been deprecated in favor of a database-driven approach.

## UI Modules
- **ui.js:** The central "hub" for the user interface, importing and re-exporting functions from component modules. It also contains general-purpose UI functions.
- **components/card.js:** Responsible for creating and rendering all card-based elements.
- **components/modal.js:** Manages the functionality of the detail and checkout modals.
- **components/presentation.js:** The presentation/plan view module. Renders items as a responsive CSS Grid of compact card tiles. Each card shows a hero photo with floating status badge (top-left), summary emoji (top-right), and lifecycle state badge (bottom-right for goal/locked/archived/completed). The card body displays the item name with an entry source-type badge (AI/solution/manual), merged-entry provenance as color-coded source pills, variation pills with lifecycle-aware styling, and a bottom meta bar. The meta bar contains a compact reaction bar showing the top 3 emojis as styled pill badges with counts, a task status badge (GTG/Check/Needs Attention/No Action) as a color-coded pill, and a comment count badge. Option group cards aggregate member lifecycle states via status chips, and also surface aggregate comment counts, combined reaction bars, and task status summaries across all group members. Clicking any card opens the detail modal directly. Drag-and-drop is powered by SortableJS with compact cards as direct draggable elements in grid mode. Cards can be reordered by dragging within the grid, with custom order persisted to session state. A radial menu appears on horizontal swipe or long-press, positioning itself around the card center with action buckets for lifecycle changes, reactions, comments, and deletion. Card-to-card merge detection uses dwell-time tracking — hovering a dragged card over another for 250ms activates merge mode with zone-aware visual feedback: dragging over the photo area triggers a hybrid merge (purple highlight), while the body area triggers an options merge (green highlight). The board features an enhanced empty state with category icons and a single-item nudge, staggered card entrance animations, ARIA accessibility (roles, labels, keyboard navigation), responsive touch targets, GPU-accelerated transforms with automatic cleanup, and support for prefers-reduced-motion and forced-colors media queries.
- **components/sidebar.js:** Controls the right-hand "Event Plan" panel and the "Favorites" carousel.
- **components/backgroundEngine.js:** The central engine that manages the animated WebGL canvas background and its reactive "energy" state.
- **components/effects/fluid.js:** The WebGL shader plugin that renders the "Fluid Energy" vortex.

## Serverless Functions (`netlify/functions/`)
- **/api/process-email:** Receives email data from a webhook, uses the Gemini AI API to parse for sales information, and creates or updates records in the Airtable CRM.
- **/api/auth-start & /api/auth-verify:** Handle the passwordless "magic link" authentication flow.
- **/api/update-user-prefs:** Updates an authenticated user's record in Airtable with their notification preferences, such as phone number.
- **/api/send-notification:** Triggered when a new chat message is posted. It fetches collaborators for the session and sends real-time SMS alerts via Twilio to users who have opted in.
- **Other Functions:** Proxies for Calendar, Cloudinary, Payments, and Chat services.

## Utility Modules
- **utils/debug.js:** Provides a simple, toggleable logging system for development.
- **utils/shader.js:** A minimal helper class to compile and run WebGL shader programs.
