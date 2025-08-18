<!--
 * Version: 1.4.0
 * Last Modified: 2025-08-18
 *
 * Changelog:
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
-->

# Feature Specification Sheet (Final Version)

## Summary of Improvements
This document outlines the features of an interactive event catalog that has undergone significant architectural and functional improvements. Key upgrades include a secure serverless back-end, centralized state management, performance enhancements via caching and targeted DOM updates, and the implementation of advanced UI features like a summary toolbar, horizontal "infinite scroll," and reaction-based sorting.

---

## AI Collaboration Guidelines

### Core Principles
This section outlines the rules and best practices for our collaborative development process to ensure efficiency, clarity, and consistency.

#### For the AI (My Responsibilities)
1.  **Maintain Functionality:** I will ensure that any code modifications do not break existing, working features.
2.  **Standard Code Blocks:** I will provide all code in standard text blocks (no special UI) for easy copying and pasting.
3.  **Provide Complete Files:** I will always provide the entire content of any modified file to ensure simple and accurate updates.
4.  **Versioning & Logs:** I will diligently update the version number and changelog at the top of every file I modify.
5.  **Holistic Analysis:** I will always review the entire project source to understand the full context before making changes.
6.  **Methodical Approach:** I will address one primary goal at a time to ensure focused and accurate results.

#### For the Human (Your Responsibilities)
1.  **Provide Complete Source:** Always provide the full, updated project source using the built-in export tool. This ensures I have the complete context.
2.  **Provide Last Source After Error:** If something goes wrong, please provide the last complete project source file that you were working with. This helps me diagnose the problem accurately.
3.  **Clear, Singular Goal:** For each prompt, please define one primary objective (e.g., "Fix this bug," "Implement this feature," "Refactor this file"). This helps me provide a focused and effective response.
4.  **Verify and Report:** After implementing my changes, please test the application. If there are any issues or if the build fails, provide the error messages or a description of the problem.

---

## Core Functionality
**Airtable Integration:** The application's data is powered by an Airtable database.
**Secure API Proxy:** All communication with the Airtable API is handled securely by a serverless function. This prevents the secret API token from ever being exposed to the user's browser.
**Session Management:** User selections and collaborations can be saved and loaded as unique sessions via a separate "Sessions" table in the database.
**Dynamic Catalog Display:**
* **Two-Row Horizontal Layout:** Events are displayed in a two-row, horizontally scrolling layout that loads more items as the user scrolls to the end ("infinite scroll").
* **Event Cards:** Each event is presented on a "card" that shows its name, image, duration, price, and pricing model.
**Image Handling:**
* **Dynamic Images:** Event images are fetched dynamically from a Cloudinary account based on "Media Tags" from Airtable.
* **Performance Cache:** Fetched image URLs are cached to prevent redundant network requests, speeding up rendering.

---

## Filtering and Sorting
**Multi-Faceted Filtering:** Users can refine the catalog view using several filters, including search by name, price, duration, and status.
**Unified Sorting:** A "Sort by" dropdown controls the order of the main catalog, favorites, and locked-in items simultaneously. Options include sorting by reactions, price, and name.

---

## Event Customization and Selection
**Event Variations & Dynamic Cards:**
* **Airtable Schema:** Event variations are defined in the `Options` field in Airtable. Each line represents one option and uses a comma-separated key:value format.
    * **Syntax:** `Option Name, key: "value", key: value`
    * **Supported Keys:** `price` (absolute), `price change` (relative), `duration change`, `description`.
    * **Example:** `3-piece band, price: 1200, description: "A versatile trio for any occasion."`
* **Dynamic Updates:** Event cards in the main catalog dynamically update to reflect the attributes of the selected option. The card's price, duration, and description will change instantly when a new option is selected from the dropdown.
* **Image Galleries:** Each card will feature an interactive image gallery.
    * The system will fetch all images from Cloudinary that are tagged with the item's primary `Media Tag`.
    * Left and right arrows will appear on the card on hover, allowing users to cycle through all available images.

**Favoriting & Locking:**
* Users can select an event's specific variation by clicking a heart icon, which adds it to the "Your Selections" carousel.
* The event card in the main catalog will then auto-select the next available variation.
* Once all variations of an item have been favorited, the event card is removed from the main catalog.
* From the carousel, items can be "locked in" to signify a final decision.
**Quantity Selection:** Each event card has a quantity selector. This is linked to the global "Headcount" field in the new summary toolbar.
**Total Cost Calculation:** A running total cost is calculated in real-time and displayed in both the top header and the bottom summary toolbar.

---

## Collaboration and Sharing
**User Profiles:** The application prompts new users for their name, which is stored locally and used to identify their contributions, such as emoji reactions.
**Multi-User Collaboration:** Multiple collaborators can be added to a session, with their avatars displayed in the header.
**Session Management:** A user's complete selection can be saved, generating a unique, shareable URL that allows others to load the session and collaborate. A dropdown menu provides easy access to previously saved sessions.

---

## User Interface and Experience
**Dynamic Header:** The sticky header now features a centered title that dynamically updates with the event name. It also cleanly organizes collaborator avatars to the left and session controls to the right.
**Summary Toolbar:** A persistent toolbar at the bottom of the screen provides a dedicated GUI for managing core event details: Event Name, Date, Headcount, and Location. This replaces the previous in-catalog "details cards."
**Undo/Redo:** Fully functional Undo and Redo buttons allow users to step through their entire history of changes.
**Emoji Reactions:** Users can leave emoji reactions on any event. These reactions are now used to automatically sort the lists.

---

## Code Readiness Assessment
The codebase has been significantly improved and has a strong, modern foundation.
* **State Management:** ✅ Completed
* **Performance:** ✅ Completed (Image Caching & Targeted DOM Updates)
* **Code Readability:** ✅ Completed (Constants)
* **Incomplete Features:** ✅ Completed (Undo/Redo)
* **Security:** ✅ Completed (Serverless Proxy)
* **Remaining Area for Improvement:**
    * **Code Modularity:** While the logic has been refactored into a modular structure with separate files (api.js, ui.js, etc.), the initial index.html file still contains the core logic that should ideally be in main.js. This is a minor point but represents the final step in the modularization effort.

---

## Future Enhancements (Scope Definition)
**Bundle 1: Integrated Scheduling System:** The application will incorporate a calendar and availability system. Users will be able to see the availability schedules for resources, services, or personnel associated with event items. The system will prevent booking conflicts and help in selecting valid dates and times for the overall event based on the availability of its components.
**Bundle 2: Real-Time Collaboration Suite:** Collaboration will be enhanced with real-time features. This includes presence indicators to show which collaborators are currently active in the session. A full communication suite, including text, audio, and video chat, will be integrated to allow for seamless, in-app planning and discussion.
**Bundle 3: Advanced Itinerary Builder:** A dynamic itinerary builder will be developed. After locking in event components, users will be able to assign specific start and end times to each item within the event's main schedule. This feature will include a visual timeline and support drag-and-drop functionality to easily reorder and adjust the event's flow.
