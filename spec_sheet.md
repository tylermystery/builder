/*

Version: 1.9.1
Last Modified: 2025-08-20

Changelog:

v1.9.1 - 2025-08-20
- [cite_start]Implemented dynamic collapsing header that hides the "Your Selections" carousel on scroll-down, maximizing catalog visibility. [cite: 17, 70]

v1.9.0 - 2025-08-19


[cite_start]Implemented autosave functionality with interval-based saving and debounced saves on state changes. [cite: 1]
[cite_start]Removed pre-MVP beta disclaimer for autosave as the feature is now complete. [cite: 2]
v1.8.2 - 2025-08-18 06:15 PM PDT


[cite_start]Moved "Download Source" button to the bottom right of the summary toolbar with a JavaScript listener to trigger download. [cite: 3]
v1.8.1 - 2025-08-18 05:40 PM PDT


[cite_start]Fixed "Download Source" button to be clickable in the summary toolbar by using an  tag with download attribute. [cite: 4]
v1.8.0 - 2025-08-18


[cite_start]Made event cards clickable to open a larger detailed editable modal view (majority of screen, same aspect ratio as tiles). [cite: 5]
[cite_start]Added save button in modal to apply edits to state/cart. [cite: 6]
v1.7.0 - 2025-08-18


[cite_start]Fixed total cost calculation to correctly multiply variation price by quantity (hours for per-hour, guests for per-guest). [cite: 7]
[cite_start]Moved pre-MVP beta disclaimer to tooltips on autosave-toggle and sessions-dropdown. [cite: 8]
v1.6.0 - 2025-08-18


[cite_start]Enhanced total cost calculation to accurately handle variation pricing and quantity. [cite: 9]
[cite_start]Added pre-MVP beta disclaimer to UI noting incomplete autosave and session loading. [cite: 10]



v1.5.0 - 2025-08-18


[cite_start]Confirmed completion of image gallery functionality. [cite: 11]
[cite_start]Clarified status of secure API proxy (incomplete due to hardcoded token). [cite: 11]




Noted incomplete session dropdown and autosave functionality.
v1.4.0 - 2025-08-18


[cite_start]Fully defined dynamic card details and image gallery functionality in the core spec. [cite: 12]
[cite_start]Added a detailed schema for the Airtable 'Options' field. [cite: 13]



v1.3.0 - 2025-08-18


[cite_start]Updated spec sheet to reflect new variation-based favoriting logic. [cite: 14]
v1.2.1 - 2025-08-17


[cite_start]Added guideline for the Human to always provide the last complete project source. [cite: 15]
v1.2.0 - 2025-08-17


Added guideline for the AI to always provide complete files.



v1.1.0 - 2025-08-17


[cite_start]Added AI Collaboration Guidelines section. [cite: 16]
v1.0.0 - 2025-08-17


Initial versioning and changelog added.
*/



Feature Specification Sheet (Final Version)
Summary of Improvements
This document outlines the features of an interactive event catalog with significant architectural and functional improvements.
[cite_start]Key upgrades include centralized state management, performance enhancements via image caching and targeted DOM updates, and advanced UI features like a summary toolbar, horizontal "infinite scroll," reaction-based sorting, and a fully implemented interactive image gallery. [cite: 17]
[cite_start]The total cost calculation accurately reflects variation-specific pricing multiplied by quantity (hours for per-hour pricing, guests for per-guest pricing). [cite: 18]
[cite_start]Event cards are clickable to open a larger detailed editable view (majority of screen, same aspect ratio as tiles) with options to modify details and save changes. [cite: 19]
[cite_start]A "Download Source" button is now functional on the bottom right of the summary toolbar for easy access. [cite: 20]
[cite_start]A pre-MVP beta disclaimer as tooltips on the sessions dropdown informs users of incomplete features. [cite: 21]
[cite_start]The secure serverless back-end is incomplete, as Airtable API requests use a hardcoded token, posing a security risk. [cite: 22]
AI Collaboration Guidelines
Core Principles
[cite_start]This section outlines the rules and best practices for our collaborative development process to ensure efficiency, clarity, and consistency. [cite: 23]
For the AI (My Responsibilities)

[cite_start]Maintain Functionality: I will ensure that any code modifications do not break existing, working features. [cite: 24]
[cite_start]Standard Code Blocks: I will provide all code in standard text blocks (no special UI) for easy copying and pasting. [cite: 25]
[cite_start]Provide Complete Files: I will always provide the entire content of any modified file to ensure simple and accurate updates. [cite: 26]
[cite_start]Versioning & Logs: I will diligently update the version number and changelog at the top of every file I modify. [cite: 27]
[cite_start]Holistic Analysis: I will always review the entire project source to understand the full context before making changes. [cite: 28]
[cite_start]Methodical Approach: I will address one primary goal at a time to ensure focused and accurate results. [cite: 29]
For the Human (Your Responsibilities)

[cite_start]Provide Complete Source: Always provide the full, updated project source using the built-in export tool. [cite: 30]
[cite_start]This ensures I have the complete context. [cite: 31]
[cite_start]Provide Last Source After Error: If something goes wrong, please provide the last complete project source file that you were working with. [cite: 32]
[cite_start]This helps me diagnose the problem accurately. [cite: 32]
[cite_start]Clear, Singular Goal: For each prompt, please define one primary objective (e.g., "Fix this bug," "Implement this feature," "Refactor this file"). [cite: 33]
[cite_start]This helps me provide a focused and effective response. [cite: 33]
[cite_start]Verify and Report: After implementing my changes, please test the application. [cite: 34]
[cite_start]If there are any issues or if the build fails, provide the error messages or a description of the problem. [cite: 35]
Core Functionality
[cite_start]Airtable Integration: The application's data is powered by an Airtable database. [cite: 36]
[cite_start]Secure API Proxy: Intended to handle all Airtable API communication securely via a serverless function to prevent exposing the API token. [cite: 37]
[cite_start]Currently, this is incomplete, as client-side code uses a hardcoded token, posing a security risk. [cite: 38]
[cite_start]Session Management: User selections and collaborations can be saved and loaded as unique sessions via a separate "Sessions" table. [cite: 39]
[cite_start]A dropdown menu displays saved sessions, and selecting one loads the session with UI updates. [cite: 40]
Dynamic Catalog Display:

[cite_start]Two-Row Horizontal Layout: Events are displayed in a two-row, horizontally scrolling layout that loads more items as the user scrolls to the end ("infinite scroll"). [cite: 41]
[cite_start]Event Cards: Each event is presented on a "card" that shows its name, image, duration, price, and pricing model. [cite: 42]
[cite_start]Cards are clickable to open a detailed editable view. [cite: 42]
Image Handling:
[cite_start]Dynamic Images: Event images are fetched dynamically from a Cloudinary account based on "Media Tags" from Airtable. [cite: 43]
[cite_start]Performance Cache: Fetched image URLs are cached to prevent redundant network requests, speeding up rendering. [cite: 44]
[cite_start]Image Galleries: Each card features an interactive image gallery, fetching all images from Cloudinary based on the primary Media Tag. [cite: 45]
[cite_start]Left and right arrows appear on hover, allowing users to cycle through images. [cite: 46]
Filtering and Sorting
[cite_start]Multi-Faceted Filtering: Users can refine the catalog view using filters for search by name, price, duration, and status. [cite: 47]
[cite_start]Unified Sorting: A "Sort by" dropdown controls the order of the main catalog, favorites, and locked-in items simultaneously. [cite: 48]
[cite_start]Options include sorting by reactions, price, and name. [cite: 48]

Event Customization and Selection
Event Variations & Dynamic Cards:

[cite_start]Airtable Schema: Event variations are defined in the Options field in Airtable. [cite: 49]
[cite_start]Each line represents one option and uses a comma-separated key:value format. [cite: 50]
Syntax: Option Name, key: "value", key: value
[cite_start]Supported Keys: price (absolute), price change (relative), duration change, description. [cite: 51]
[cite_start]Example: 3-piece band, price: 1200, description: "A versatile trio for any occasion." [cite: 52]
[cite_start]Dynamic Updates: Event cards in the main catalog dynamically update to reflect the attributes of the selected option. [cite: 53]
[cite_start]The card's price, duration, and description change instantly when a new option is selected from the dropdown. [cite: 54]
[cite_start]Image Galleries: Each card features an interactive image gallery, with left and right arrows appearing on hover to cycle through all available images fetched from Cloudinary. [cite: 55]
[cite_start]Detailed View: Clicking an event card opens a larger modal (majority of screen, same aspect ratio as cards) showing the full description, editable options and quantity, with a save button to apply changes to the cart/state. [cite: 56]
Favoriting & Locking:
[cite_start]Users can select an event's specific variation by clicking a heart icon, which adds it to the "Your Selections" carousel. [cite: 57]
[cite_start]The event card in the main catalog will then auto-select the next available variation. [cite: 58]
[cite_start]Once all variations of an item have been favorited, the event card is removed from the main catalog. [cite: 59]
[cite_start]From the carousel, items can be "locked in" to signify a final decision. [cite: 60]
[cite_start]Carousel items are also clickable for editing in the detailed modal. [cite: 61]
[cite_start]Quantity Selection: Each event card has a quantity selector linked to the global "Headcount" field in the summary toolbar. [cite: 62]
[cite_start]Quantity represents hours for per-hour pricing or guests for per-guest pricing. [cite: 63]
[cite_start]Total Cost Calculation: A running total cost is calculated in real-time, accurately reflecting variation-specific pricing multiplied by quantity (hours for per-hour, guests for per-guest, with minimum headcount enforcement), displayed in both the top header and bottom summary toolbar with a breakdown tooltip. [cite: 64]
Collaboration and Sharing
[cite_start]User Profiles: The application prompts new users for their name, which is stored locally and used to identify their contributions, such as emoji reactions. [cite: 65]
[cite_start]Multi-User Collaboration: Multiple collaborators can be added to a session, with their avatars displayed in the header. [cite: 66]
[cite_start]Session Management: A user's complete selection can be saved, generating a unique, shareable URL for collaboration. [cite: 67]
[cite_start]A dropdown menu displays previously saved sessions, and selecting one loads the session with UI updates. [cite: 68]
[cite_start]Autosave is implemented with a UI toggle that enables automatic saving every 30 seconds and debounced saves on state changes. [cite: 69]
User Interface and Experience
[cite_start]Dynamic Header: The sticky header features a centered title that dynamically updates with the event name, with collaborator avatars on the left and session controls on the right. [cite: 70] When a user scrolls down, the header collapses to a compact summary view to maximize catalog visibility, and expands when the user scrolls up.
[cite_start]Summary Toolbar: A persistent toolbar at the bottom manages core event details: Event Name, Date, Headcount, and Location, with a "Download Source" button on the bottom right for easy access, replacing in-catalog "details cards." [cite: 71]
[cite_start]Undo/Redo: Fully functional Undo and Redo buttons allow users to step through their history of changes. [cite: 72]
[cite_start]Emoji Reactions: Users can leave emoji reactions on any event, used to automatically sort lists. [cite: 73]
[cite_start]Pre-MVP Disclaimer: Tooltips on the sessions dropdown note that these features are incomplete, setting expectations for the beta release. [cite: 74]
Code Readiness Assessment
[cite_start]The codebase has a strong, modern foundation but requires improvements in security and completion of features. [cite: 75]
State Management: ✅ Completed
Performance: ✅ Completed (Image Caching & Targeted DOM Updates)
Code Readability: ✅ Completed (Constants)
Incomplete Features:

None


Security: ❌ Incomplete (Hardcoded Airtable token in client-side code, bypassing serverless proxy)
Remaining Area for Improvement:

Code Modularity: The index.html file contains core logic (CSS and static HTML) that should ideally be moved to main.js or ui.js for better modularity.
[cite_start]Security: Implement the serverless proxy to secure Airtable API requests. [cite: 77]
Feature Completion: None




Future Enhancements (Scope Definition)
[cite_start]Bundle 1: Integrated Scheduling System: Incorporate a calendar and availability system to prevent booking conflicts and assist in selecting valid dates and times based on component availability. [cite: 78]
[cite_start]Bundle 2: Real-Time Collaboration Suite: Enhance collaboration with presence indicators and a communication suite (text, audio, video chat) for seamless in-app planning. [cite: 79]
[cite_start]Bundle 3: Advanced Itinerary Builder: Develop a dynamic itinerary builder with a visual timeline and drag-and-drop functionality to assign and adjust event component timings. [cite: 80]
