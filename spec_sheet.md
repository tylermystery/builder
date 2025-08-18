/*
 * Version: 1.8.0
 * Last Modified: 2025-08-18
 *
 * Changelog:
 *
 * v1.8.0 - 2025-08-18
 * - Made event cards clickable to open a larger detailed editable modal view (majority of screen, same aspect ratio as tiles).
 * - Added save button in modal to apply edits to state/cart.
 *
 * v1.7.0 - 2025-08-18
 * - Fixed total cost calculation to correctly multiply variation price by quantity (hours for per-hour, guests for per-guest).
 * - Moved pre-MVP beta disclaimer to tooltips on autosave-toggle and sessions-dropdown.
 *
 * v1.6.0 - 2025-08-18
 * - Enhanced total cost calculation to accurately handle variation pricing and quantity.
 * - Added pre-MVP beta disclaimer to UI noting incomplete autosave and session loading.
 *
 * v1.5.0 - 2025-08-18
 * - Confirmed completion of image gallery functionality.
 * - Clarified status of secure API proxy (incomplete due to hardcoded token).
 * - Noted incomplete session dropdown and autosave functionality.
 *
 * v1.4.0 - 2025-08-18
 * - Fully defined dynamic card details and image gallery functionality in the core spec.
 * - Added a detailed schema for the Airtable 'Options' field.
 *
 * v1.3.0 - 2025-08-18
 * - Updated spec sheet to reflect new variation-based favoriting logic.
 *
 * v1.2.1 - 2025-08-17
 * - Added guideline for the Human to always provide the last complete project source.
 *
 * v1.2.0 - 2025-08-17
 * - Added guideline for the AI to always provide complete files.
 *
 * v1.1.0 - 2025-08-17
 * - Added AI Collaboration Guidelines section.
 *
 * v1.0.0 - 2025-08-17
 * - Initial versioning and changelog added.
 */

# Feature Specification Sheet (Final Version)

## Summary of Improvements
This document outlines the features of an interactive event catalog with significant architectural and functional improvements. Key upgrades include centralized state management, performance enhancements via image caching and targeted DOM updates, and advanced UI features like a summary toolbar, horizontal "infinite scroll," reaction-based sorting, and a fully implemented interactive image gallery. The total cost calculation accurately reflects variation-specific pricing multiplied by quantity (hours for per-hour pricing, guests for per-guest pricing). Event cards are clickable to open a larger detailed editable view (majority of screen, same aspect ratio as tiles) with options to modify details and save changes. A pre-MVP beta disclaimer as tooltips on autosave and session dropdown informs users of incomplete features. The secure serverless back-end is incomplete, as Airtable API requests use a hardcoded token, posing a security risk.

---

## AI Collaboration Guidelines

### Core Principles
This section outlines the rules and best practices for our collaborative development process to ensure efficiency, clarity, and consistency.

#### For the AI (My Responsibilities)
1. **Maintain Functionality:** I will ensure that any code modifications do not break existing, working features.
2. **Standard Code Blocks:** I will provide all code in standard text blocks (no special UI) for easy copying and pasting.
3. **Provide Complete Files:** I will always provide the entire content of any modified file to ensure simple and accurate updates.
4. **Versioning & Logs:** I will diligently update the version number and changelog at the top of every file I modify.
5. **Holistic Analysis:** I will always review the entire project source to understand the full context before making changes.
6. **Methodical Approach:** I will address one primary goal at a time to ensure focused and accurate results.

#### For the Human (Your Responsibilities)
1. **Provide Complete Source:** Always provide the full, updated project source using the built-in export tool. This ensures I have the complete context.
2. **Provide Last Source After Error:** If something goes wrong, please provide the last complete project source file that you were working with. This helps me diagnose the problem accurately.
3. **Clear, Singular Goal:** For each prompt, please define one primary objective (e.g., "Fix this bug," "Implement this feature," "Refactor this file"). This helps me provide a focused and effective response.
4. **Verify and Report:** After implementing my changes, please test the application. If there are any issues or if the build fails, provide the error messages or a description of the problem.

---

## Core Functionality
**Airtable Integration:** The application's data is powered by an Airtable database.
**Secure API Proxy:** Intended to handle all Airtable API communication securely via a serverless function to prevent exposing the API token. Currently, this is incomplete, as client-side code uses a hardcoded token, posing a security risk.
**Session Management:** User selections and collaborations can be saved and loaded as unique sessions via a separate "Sessions" table. A dropdown menu displays saved sessions, and selecting one loads the session with UI updates.
**Dynamic Catalog Display:**
* **Two-Row Horizontal Layout:** Events are displayed in a two-row, horizontally scrolling layout that loads more items as the user scrolls to the end ("infinite scroll").
* **Event Cards:** Each event is presented on a "card" that shows its name, image, duration, price, and pricing model. Cards are clickable to open a detailed editable view.
**Image Handling:**
* **Dynamic Images:** Event images are fetched dynamically from a Cloudinary account based on "Media Tags" from Airtable.
* **Performance Cache:** Fetched image URLs are cached to prevent redundant network requests, speeding up rendering.
* **Image Galleries:** Each card features an interactive image gallery, fetching all images from Cloudinary based on the primary `Media Tag`. Left and right arrows appear on hover, allowing users to cycle through images.

---

## Filtering and Sorting
**Multi-Faceted Filtering:** Users can refine the catalog view using filters for search by name, price, duration, and status.
**Unified Sorting:** A "Sort by" dropdown controls the order of the main catalog, favorites, and locked-in items simultaneously. Options include sorting by reactions, price, and name.

---

## Event Customization and Selection
**Event Variations & Dynamic Cards:**
* **Airtable Schema:** Event variations are defined in the `Options` field in Airtable. Each line represents one option and uses a comma-separated key:value format.
    * **Syntax:** `Option Name, key: "value", key: value`
    * **Supported Keys:** `price` (absolute), `price change` (relative), `duration change`, `description`.
    * **Example:** `3-piece band, price: 1200, description: "A versatile trio for any occasion."`
* **Dynamic Updates:** Event cards in the main catalog dynamically update to reflect the attributes of the selected option. The card's price, duration, and description change instantly when a new option is selected from the dropdown.
* **Image Galleries:** Each card features an interactive image gallery, with left and right arrows appearing on hover to cycle through all available images fetched from Cloudinary.
* **Detailed View:** Clicking an event card opens a larger modal (majority of screen, same aspect ratio as cards) showing the full description, editable options and quantity, with a save button to apply changes to the cart/state.
**Favoriting & Locking:**
* Users can select an event's specific variation by clicking a heart icon, which adds it to the "Your Selections" carousel.
* The event card in the main catalog will then auto-select the next available variation.
* Once all variations of an item have been favorited, the event card is removed from the main catalog.
* From the carousel, items can be "locked in" to signify a final decision. Carousel items are also clickable for editing in the detailed modal.
**Quantity Selection:** Each event card has a quantity selector linked to the global "Headcount" field in the summary toolbar. Quantity represents hours for per-hour pricing or guests for per-guest pricing.
**Total Cost Calculation:** A running total cost is calculated in real-time, accurately reflecting variation-specific pricing multiplied by quantity (hours for per-hour, guests for per-guest, with minimum headcount enforcement), displayed in both the top header and bottom summary toolbar with a breakdown tooltip.

---

## Collaboration and Sharing
**User Profiles:** The application prompts new users for their name, which is stored locally and used to identify their contributions, such as emoji reactions.
**Multi-User Collaboration:** Multiple collaborators can be added to a session, with their avatars displayed in the header.
**Session Management:** A user's complete selection can be saved, generating a unique, shareable URL for collaboration. A dropdown menu displays previously saved sessions, and selecting one loads the session with UI updates. Autosave is not implemented, despite a UI toggle with a disclaimer tooltip.

---

## User Interface and Experience
**Dynamic Header:** The sticky header features a centered title that dynamically updates with the event name, with collaborator avatars on the left and session controls on the right.
**Summary Toolbar:** A persistent toolbar at the bottom manages core event details: Event Name, Date, Headcount, and Location, replacing in-catalog "details cards."
**Undo/Redo:** Fully functional Undo and Redo buttons allow users to step through their history of changes.
**Emoji Reactions:** Users can leave emoji reactions on any event, used to automatically sort lists.
**Pre-MVP Disclaimer:** Tooltips on the autosave toggle and sessions dropdown note that these features are incomplete, setting expectations for the beta release.

---

## Code Readiness Assessment
The codebase has a strong, modern foundation but requires improvements in security and completion of features.
* **State Management:** ✅ Completed
* **Performance:** ✅ Completed (Image Caching & Targeted DOM Updates)
* **Code Readability:** ✅ Completed (Constants)
* **Incomplete Features:** 
  - ❌ Autosave functionality is not implemented, despite an autosave toggle with a disclaimer tooltip.
* **Security:** ❌ Incomplete (Hardcoded Airtable token in client-side code, bypassing serverless proxy)
* **Remaining Area for Improvement:**
    * **Code Modularity:** The `index.html` file contains core logic (CSS and static HTML) that should ideally be moved to `main.js` or `ui.js` for better modularity.
    * **Security:** Implement the serverless proxy to secure Airtable API requests.
    * **Feature Completion:** Add autosave functionality.

---

## Future Enhancements (Scope Definition)
**Bundle 1: Integrated Scheduling System:** Incorporate a calendar and availability system to prevent booking conflicts and assist in selecting valid dates and times based on component availability.
**Bundle 2: Real-Time Collaboration Suite:** Enhance collaboration with presence indicators and a communication suite (text, audio, video chat) for seamless in-app planning.
**Bundle 3: Advanced Itinerary Builder:** Develop a dynamic itinerary builder with a visual timeline and drag-and-drop functionality to assign and adjust event component timings.
