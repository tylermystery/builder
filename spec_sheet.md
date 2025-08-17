# Project Builder Spec Sheet

*Last Updated: 2025-08-16*

## 1. Overview

This document outlines the specifications for the "Builder" application. It serves as a single source of truth for UI components, user interaction models, and core functionalities.

## 2. Component Library

This section details the reusable components that form the building blocks of the application.

### 2.1. Item Card Component

**Description:** The `Item Card` is a tile-based component used to display a summary of an item. It is the primary interface for browsing and quick interactions.

**Structure:**
- **Header:** Contains the item's name and price.
- **Body:** Contains the item's description.
- **Footer:** Contains the user interaction toolbar.

**User Interactions:**
The primary user actions are arranged in a single horizontal toolbar located in the card's footer. This provides a consistent and easy-to-access interaction pattern.

-   **Layout:** The actions are displayed in a `flex` row. The container for these actions is `.actions-toolbar`.
-   **Order:** The standard order of actions from left to right is:
    1.  **Edit Button:** Allows the user to modify the item.
    2.  **Heart Button:** Allows the user to "favorite" or "like" the item.
    3.  **Emoji React Panel:** Provides a set of emoji reactions. This panel is aligned to the far right of the toolbar.

---
