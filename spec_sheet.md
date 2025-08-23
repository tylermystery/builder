/*
Version: 2.2.0
Last Modified: 2025-08-22

Changelog:

v2.2.0 - 2025-08-22

Added Category and Subcategory filtering to the specification.

v2.1.0 - 2025-08-22

Re-integrated Undo/Redo as a toggleable feature in the new "Beta Toolkit".

v2.0.0 - 2025-08-21

Major Revision: Defined a stripped-down MVP and a new "Beta Toolkit".

Documented "Collab Mode" (emoji reactions) and "Event Planner Mode" (quirky favoriting sequence) as toggleable beta features.

v1.9.5 - 2025-08-21

Defined the quirky MVP favoriting sequence (Heart -> Ring -> Ball & Chain).

v1.9.4 - 2025-08-21

Updated spec for favorites carousel: Cards are now officially smaller versions of the main catalog cards, maintaining the same aspect ratio for consistency.

Added note for future animation enhancements.

v1.9.3 - 2025-08-21

Added "Card Interaction Model" to spec sheet to define user interactions.

v1.9.2 - 2025-08-21

Simplified UI for MVP: Removed Undo/Redo and Autosave features.

Documented removed features as potential future enhancements.

v1.9.1 - 2025-08-21

Updated core layout: Main catalog now scrolls vertically in a responsive grid, while the favorites carousel remains horizontal.

v1.9.0 - 2025-08-19

Implemented autosave functionality with interval-based saving and debounced saves on state changes.

Removed pre-MVP beta disclaimer for autosave as the feature is now complete.
*/

Feature Specification Sheet (Final Version)
Summary of Improvements
This document outlines the features of an interactive event catalog. The core application provides a stable, minimalist interface for browsing a catalog and selecting items for an event. Key upgrades include a consolidated header for all event details, centralized state management, and a vertically scrolling, responsive catalog.

A new Beta Toolkit, accessible via a subtle trigger, allows users to enable advanced features for collaboration and planning.

AI Collaboration Guidelines
Core Principles
(Guidelines remain the same)

Core Functionality (MVP)
Airtable Integration: The application's data is powered by an Airtable database.
Secure API Proxy: The spec requires a serverless function to secure the API token, but this is currently incomplete.
Session Management: User selections can be saved, generating a unique, shareable URL. A dropdown menu displays saved sessions, and selecting one loads the session.

Hierarchical Catalog Display:
The catalog is organized as a hierarchy of interactive items. Items can be either Groupings (e.g., "Activities," which contain other items) or final Bookable Items (e.g., "Escape Room," which can be configured and added to an event). This structure allows users to navigate from broad categories to specific details.

The Interactive Card
Every item in the catalog is presented on a versatile "Interactive Card." The card's appearance and functionality adapt based on the item it represents. All cards feature a Heart (❤️) icon for universal selection, allowing a user to add any item or grouping to their plan at any level of detail.

Card Interaction Model
Users can explore the catalog in two main ways:

Focused Exploration: Users navigate the hierarchy within a single card. A Grouping card has an Options Control (⚙️) that transforms the card to display a selected child item, and a Parent Button (⬆️) to navigate back up the hierarchy.

Broad Exploration: A Grouping card features an Explode (💥) button, which replaces the single card with a grid of new cards for each of its child options. A corresponding Implode ( اجمع) button collapses this grid back into the single parent card.

Customizable Bottom Layer
When a card represents a final Bookable Item, its Options Control (⚙️) switches from navigation to configuration. It displays specific variations (e.g., duration, style) that modify the item's price and details. A field for adding custom notes is also available on these cards.


Standard Vertical Layout: Events are displayed in a responsive grid that scrolls vertically with the main page. More items are loaded as the user scrolls.

Event Cards: Each event is presented on a card showing its name, image, and price.

Simple Favoriting: Users can select an event by clicking a heart icon, which adds it to the "Your Selections" carousel. Selected items have a simple "Remove" button.

Dynamic Header: A sticky header contains all primary event details and controls. A static Tool Name ("Event Builder") is positioned in the top-left and includes the trigger for the Beta Toolkit. The main title is a large, editable Event Name input field that dictates the browser's page title. Other controls include Date, Headcount, Event Goals, Collaborators, Total Cost, and the Save & Share button.


Filtering and Sorting
Multi-Faceted Filtering: Users can refine the catalog view using filters for search, price, duration, status, category, and subcategory.
Unified Sorting: A "Sort by" dropdown controls the order of the main catalog, favorites, and locked-in items simultaneously.
Options include sorting by price and name.

Beta Toolkit
A subtle "beta" subscript next to the main title can be clicked to reveal a toolkit with advanced, toggleable features.

Collab Mode:

Enables an emoji reaction bar on all cards, allowing users to vote on items.

Adds a "Sort by Reactions" option to the sorting dropdown.

Event Planner Mode:

Replaces the simple "Remove" button on selected items with a fun, multi-state sequence for tracking an item's status.

Promote: An unlocked item shows a heart (💘) that changes to an engagement ring (💍) on hover. Clicking it "locks" the item.

Locked State: A locked item is represented by a ball and chain (⛓️).

Demote: A locked item shows a hammer (🔨) to "break" the lock.

Remove: An unlocked item shows a broken heart (💔) to remove it.

History Mode:

Enables Undo (↩️) and Redo (↪️) buttons in the header, allowing users to step backward and forward through their changes.

Code Readiness Assessment
The codebase has a strong, modern foundation but requires improvements in security.
State Management: ✅ Completed
Performance: ✅ Completed
Code Readability: ✅ Completed
Security: ❌ Incomplete (Hardcoded Airtable token in client-side code).
