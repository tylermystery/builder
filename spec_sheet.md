# Feature Specification Sheet (Final Version)

## Summary of Improvements
This document outlines the features of an interactive event catalog. The core application provides a dynamic, hierarchical interface for browsing a catalog and building an event plan. Key features include a consolidated header for event details, a vertically scrolling catalog of "Interactive Cards," and a new Beta Toolkit for advanced features.

## Core Functionality (MVP)

### Airtable Integration
The application's data is powered by an Airtable database. A serverless function is specified for securing the API token, but this is currently deferred.

### Session Management
User selections can be saved, generating a unique, shareable URL. A dropdown menu in the header will display saved sessions, allowing a user to load a previous plan.

### Hierarchical Catalog Display
The catalog is organized as a hierarchy of interactive items. Items can be either **Groupings** or final **Bookable Items**. This structure allows users to navigate from broad categories to specific details.

### The Interactive Card
Every item in the catalog is presented on a versatile "Interactive Card." The card's appearance and functionality adapt based on the item it represents. All cards feature a **Heart (❤️) icon** for universal selection.

### Card Interaction Model
Users can explore the catalog in two main ways:
* **Focused Exploration:** A Grouping card has an **Options Control (⚙️)** that transforms the card to display a selected child item, and a **Parent Button (⬆️)** to navigate back up the hierarchy.
* **Broad Exploration:** A Grouping card features an **Explode (💥) button** which replaces the single card with a grid of its child options. A corresponding **Implode ( اجمع) button** collapses this grid back into the single parent card.

All card-based click interactions are managed by a single, unified event handler that prioritizes specific button clicks (e.g., Heart, Explode) over general card clicks to ensure a non-overlapping and predictable user experience.

### Customizable Bottom Layer
When a card represents a final **Bookable Item**, its **Options Control (⚙️)** switches from navigation to configuration, displaying specific variations (e.g., duration, style). A field for adding custom notes is also available.

### Dynamic Header
A sticky header contains all primary event details and controls, including a static **Tool Name**, an editable **Event Name**, and other controls like Date, Headcount, Total Cost, and the Save & Share button.

### Filtering and Sorting
A simple set of controls allows users to refine the catalog view by **Search by name** and **Price**. A "Sort by" dropdown controls the order of the main catalog.

## Beta Toolkit
A subtle "beta" subscript next to the tool name can be clicked to reveal a toolkit with advanced, toggleable features. These features include **Collab Mode**, **Event Planner Mode**, and **History Mode**.

## Code Readiness Assessment
* **State Management:** ✅ Completed
* **Performance:** ✅ Completed
* **Code Readability:** ✅ Completed
* **Security:** ❌ Incomplete (Hardcoded Airtable token in client-side code).
