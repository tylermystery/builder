# Feature Specification Sheet (Final Version)

## Summary of Improvements
This document outlines the features of an interactive event catalog. The core application provides a dynamic, hierarchical interface for browsing a catalog and building an event plan. Key features include a consolidated header for event details, a vertically scrolling catalog of "Interactive Cards," and a new Beta Toolkit for advanced features.

## Core Functionality (MVP)
### Airtable & Cloudinary Integration
The application's data is powered by an Airtable database and the Cloudinary media library.
* **Secure API Proxy:** All communication with external APIs (Airtable, Cloudinary) is routed through serverless functions. This acts as a secure proxy, ensuring that private API keys and tokens are never exposed in the browser.

### Session Management (Live URL & Fork on Edit)
A unique, shareable URL is automatically generated and updated as a user builds their event plan.
* **Live URL:** The URL in the browser address bar is the canonical link for the event plan. Any change made to the plan (e.g., selecting an item, editing the event name) is automatically saved to the database and reflected in this URL.
* **Sharing:** A user can share their plan at any time by simply copying and sharing the URL from their browser.
* **Fork on Edit:** When a second user opens a shared URL, they see the original plan. The moment this new user makes a change, the system automatically "forks" the plan by creating a brand new session and updating their URL. This prevents collaborators from overwriting each other's work in the MVP and ensures the original shared plan is not altered.

### Catalog Loading Methodology
The catalog loading process is designed for a smooth and predictable user experience.
* The application initially displays a "Loading catalog..." message.
* It fetches all event records from the Airtable database using an asynchronous API call.
* Once the data is loaded successfully, the loading message is hidden and the interactive catalog elements are displayed.
* The initial view shows only the top-level "Grouping" items for the user to begin their exploration.

### Hierarchical Catalog Display
The catalog is organized as a hierarchy of interactive items. Items can be either **Groupings** (e.g., "Activities") or final **Bookable Items** (e.g., "Escape Room"). This structure allows users to navigate from broad categories to specific details.

### The Interactive Card
Every item in the catalog is presented on a versatile "Interactive Card". The card's appearance and functionality adapt based on the item it represents. All cards feature a **Heart (❤️) icon** for universal selection.

#### Automated Image Tagging
Card images are loaded dynamically from a media library (Cloudinary) based on an automated, multi-tag system. All tag matching is case-insensitive and ignores differences between spaces and hyphens.
* **Default Item Image:** The image for an item is found by searching for a single tag generated from its unique name (e.g., "Fort Battle" uses the tag `fort-battle`).
* **Option-Specific Images:** When a user selects an option, the system performs a search for images that contain **both** the item's tag **and** the option's tag (e.g., searching for tags `fort-battle` AND `classic`). If no images matching both tags are found, the application falls back to the default item image.

### Unified Card Interaction Model
All card-based click interactions are managed by a single, unified event handler on the document's body.
* The handler uses event delegation to capture all clicks and identify the target element (e.g., a button or icon).
* It acts as a router, prioritizing specific button clicks (like the Heart, Explode, or Parent buttons) over a general card click to ensure a predictable user experience.
* This methodology ensures that all interactions are handled consistently and efficiently, regardless of where the catalog item is displayed.

### Customizable Bottom Layer
When a card represents a final **Bookable Item**, its **Options Control (⚙️)** switches from navigation to configuration, displaying specific variations. A field for adding custom notes and a quantity selector are also available.

### Dynamic Header
A sticky header contains all primary event details and controls, including a static **Tool Name**, an editable **Event Name**, and other controls like Date, Headcount, Total Cost.

### Filtering and Sorting
A simple set of controls allows users to refine the catalog view by **Search by name** and **Price**. A "Sort by" dropdown controls the order of the main catalog.

## Beta Toolkit
A subtle "beta" subscript next to the tool name can be-clicked to reveal a toolkit with advanced, toggleable features. These features include **Collab Mode**, **Event Planner Mode**, and **History Mode**.
