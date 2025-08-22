/*
Version: 1.9.5
Last Modified: 2025-08-21

Changelog:

v1.9.5 - 2025-08-21
- Defined the quirky MVP favoriting sequence (Heart -> Ring -> Ball & Chain).

v1.9.4 - 2025-08-21
- Updated spec for favorites carousel: Cards are now officially smaller versions of the main catalog cards, maintaining the same aspect ratio for consistency.
- Added note for future animation enhancements.

v1.9.3 - 2025-08-21
- Added "Card Interaction Model" to spec sheet to define user interactions.

v1.9.2 - 2025-08-21
- Simplified UI for MVP: Removed Undo/Redo and Autosave features.
- Documented removed features as potential future enhancements.

v1.9.1 - 2025-08-21
- Updated core layout: Main catalog now scrolls vertically in a responsive grid, while the favorites carousel remains horizontal.

v1.9.0 - 2025-08-19
- Implemented autosave functionality with interval-based saving and debounced saves on state changes.
- Removed pre-MVP beta disclaimer for autosave as the feature is now complete.
*/



Feature Specification Sheet (Final Version)
Summary of Improvements
This document outlines the features of an interactive event catalog with significant architectural and functional improvements. Key upgrades include centralized state management, performance enhancements via image caching and targeted DOM updates, and advanced UI features like a summary toolbar, a vertically scrolling catalog, reaction-based sorting, and a fully implemented interactive image gallery.
The total cost calculation accurately reflects variation-specific pricing multiplied by quantity (hours for per-hour pricing, guests for per-guest pricing).
Event cards are clickable to open a larger detailed editable view (majority of screen, same aspect ratio as tiles) with options to modify details and save changes.
A "Download Source" button is now functional on the bottom right of the summary toolbar for easy access.
The secure serverless back-end is incomplete, as Airtable API requests use a hardcoded token, posing a security risk.
AI Collaboration Guidelines
Core Principles
This section outlines the rules and best practices for our collaborative development process to ensure efficiency, clarity, and consistency.
For the AI (My Responsibilities)

Maintain Functionality: I will ensure that any code modifications do not break existing, working features.
Standard Code Blocks: I will provide all code in standard text blocks (no special UI) for easy copying and pasting.
Provide Complete Files: I will always provide the entire content of any modified file to ensure simple and accurate updates.
Versioning & Logs: I will diligently update the version number and changelog at the top of every file I modify.
Holistic Analysis: I will always review the entire project source to understand the full context before making changes.
Methodical Approach: I will address one primary goal at a time to ensure focused and accurate results.
For the Human (Your Responsibilities)

Provide Complete Source: Always provide the full, updated project source using the built-in export tool.
This ensures I have the complete context.
Provide Last Source After Error: If something goes wrong, please provide the last complete project source file that you were working with.
This helps me diagnose the problem accurately.
Clear, Singular Goal: For each prompt, please define one primary objective (e.g., "Fix this bug," "Implement this feature," "Refactor this file").
This helps me provide a focused and effective response.
Verify and Report: After implementing my changes, please test the application.
If there are any issues or if the build fails, provide the error messages or a description of the problem.
Core Functionality
Airtable Integration: The application's data is powered by an Airtable database.
Secure API Proxy: Intended to handle all Airtable API communication securely via a serverless function to prevent exposing the API token.
Currently, this is incomplete, as client-side code uses a hardcoded token, posing a security risk.
Session Management: User selections and collaborations can be saved and loaded as unique sessions via a separate "Sessions" table.
A dropdown menu displays saved sessions, and selecting one loads the session with UI updates.
Dynamic Catalog Display:

Standard Vertical Layout: Events are displayed in a responsive grid that scrolls vertically with the main page. More items are loaded as the user scrolls toward the bottom ("infinite scroll").
Event Cards: Each event is presented on a "card" that shows its name, image, duration, price, and pricing model. Cards are clickable to open a detailed editable view.
Image Handling:
Dynamic Images: Event images are fetched dynamically from a Cloudinary account based on "Media Tags" from Airtable.
Performance Cache: Fetched image URLs are cached to prevent redundant network requests, speeding up rendering.
Image Galleries: Each card features an interactive image gallery, fetching all images from Cloudinary based on the primary Media Tag.
Left and right arrows appear on hover, allowing users to cycle through images.
Filtering and Sorting
Multi-Faceted Filtering: Users can refine the catalog view using filters for search by name, price, duration, and status.
Unified Sorting: A "Sort by" dropdown controls the order of the main catalog, favorites, and locked-in items simultaneously.
Options include sorting by reactions, price, and name.

Event Customization and Selection
Event Variations & Dynamic Cards:

Airtable Schema: Event variations are defined in the Options field in Airtable.
Each line represents one option and uses a comma-separated key:value format.
Syntax: Option Name, key: "value", key: value
Supported Keys: price (absolute), price change (relative), duration change, description.
Example: 3-piece band, price: 1200, description: "A versatile trio for any occasion."
Dynamic Updates: Event cards in the main catalog dynamically update to reflect the attributes of the selected option.
The card's price, duration, and description change instantly when a new option is selected from the dropdown.
Image Galleries: Each card features an interactive image gallery, with left and right arrows appearing on hover to cycle through all available images fetched from Cloudinary.
Detailed View: Clicking an event card opens a larger modal (majority of screen, same aspect ratio as cards) showing the full description, editable options and quantity, with a save button to apply changes to the cart/state.
Card Interaction Model:

- **Main Card Body Click:** Clicking on the main body of a card (image or text area) that is not another interactive element will open the detailed modal view.
- **Icon/Button Clicks:** Clicking specific icon buttons (`heart`, `edit`, `promote/demote`, emoji reactions, etc.) will perform only their specific actions and will **not** open the modal.
- **Favorites Carousel Scrolling:** Using the mouse wheel while the cursor is over the "Your Selections" carousel will scroll it horizontally.
- **Favoriting & Locking Sequence (MVP):** The buttons on the "Your Selections" cards follow a humorous, relationship-themed sequence:
    - **Promote:** An unlocked item shows a heart (`💘`) that changes to an engagement ring (`💍`) on hover. Clicking it "locks" the item.
    - **Locked State:** A locked item is represented by a ball and chain (`⛓️`).
    - **Demote:** A locked item shows a hammer (`🔨`) to "break" the lock, returning it to an unlocked state.
    - **Remove:** An unlocked item shows a broken heart (`💔`) to remove it from the selections.

Favoriting & Locking:
Users can select an event's specific variation by clicking a heart icon, which adds it to the "Your Selections" carousel. Items in the carousel appear as smaller versions of the main catalog cards, maintaining the same aspect ratio for visual consistency.
The event card in the main catalog will then auto-select the next available variation.
Once all variations of an item have been favorited, the event card is removed from the main catalog.
From the carousel, items can be "locked in" to signify a final decision.
Carousel items are also clickable for editing in the detailed modal.
Quantity Selection: Each event card has a quantity selector linked to the global "Headcount" field in the summary toolbar.
Quantity represents hours for per-hour pricing or guests for per-guest pricing.
Total Cost Calculation: A running total cost is calculated in real-time, accurately reflecting variation-specific pricing multiplied by quantity (hours for per-hour, guests for per-guest, with minimum headcount enforcement), displayed in both the top header and bottom summary toolbar with a breakdown tooltip.
Collaboration and Sharing
User Profiles: The application prompts new users for their name, which is stored locally and used to identify their contributions, such as emoji reactions.
Multi-User Collaboration: Multiple collaborators can be added to a session, with their avatars displayed in the header.
Session Management: A user's complete selection can be saved, generating a unique, shareable URL for collaboration.
A dropdown menu displays previously saved sessions, and selecting one loads the session with UI updates.
User Interface and Experience
Dynamic Header: The sticky header features a centered title that dynamically updates with the event name, with collaborator avatars on the left and session controls on the right. When a user scrolls down, the header collapses to a compact summary view to maximize catalog visibility, and expands when the user scrolls up.
Summary Toolbar: A persistent toolbar at the bottom manages core event details: Event Name, Date, Headcount, and Location, replacing in-catalog "details cards."
Emoji Reactions: Users can leave emoji reactions on any event, used to automatically sort lists.
Code Readiness Assessment
The codebase has a strong, modern foundation but requires improvements in security and completion of features.
State Management: ✅ Completed
Performance: ✅ Completed (Image Caching & Targeted DOM Updates)
Code Readability: ✅ Completed (Constants)
Incomplete Features:

None


Security: ❌ Incomplete (Hardcoded Airtable token in client-side code, bypassing serverless proxy)
Remaining Area for Improvement:

Security: Implement the serverless proxy to secure Airtable API requests.
Feature Completion: None


Future Enhancements (Scope Definition)
Bundle 1: Integrated Scheduling System: Incorporate a calendar and availability system to prevent booking conflicts and assist in selecting valid dates and times based on component availability.
Bundle 2: Real-Time Collaboration Suite: Enhance collaboration with presence indicators and a communication suite (text, audio, video chat) for seamless in-app planning.
Bundle 3: Advanced Itinerary Builder: Develop a dynamic itinerary builder with a visual timeline and drag-and-drop functionality to assign and adjust event component timings.
Bundle 4: Advanced Session Controls: Re-implement Undo/Redo functionality and a robust autosave system.
Bundle 5: Enhanced UI/UX Animations: Incorporate smooth animations for card transitions between the catalog and favorites carousel to provide better user feedback.
