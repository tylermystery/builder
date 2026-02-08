Feature Specification Sheet (Final Version)

**Version: 1.2.4**
**Last Modified: 2025-09-09**

### Changelog
* **v1.2.4 (2025-09-09):** Finalized UI polishes.
Renamed the main header title to "Tyler's Mystery Tours Shop."
Reorganized the event plan sidebar to use a clickable "Event Plan" title that opens the itinerary builder.
Changed the checkout button text to "Reserve." Implemented dynamic availability displays for individual plan items and the overall event date.
* **v1.2.3 (2025-09-08):** Implemented dynamic calendar and availability updates.
Corrected modularity issues with event handlers and global libraries.
Fixed logic for `updateHeaderCalendarAvailability` to correctly display combined availability.
* **v1.2.2 (2025-08-31):** Updated filter layout description, making Categories buttons at the top.
* **v1.2.1 (2025-08-31):** Added "Status Filter" to the Search & Filtering section.
* **v1.2.0 (2025-08-30):** Added "State Management Model" section to document the user flow for favorited and locked items.
* **v1.1.0 (2025-08-29):** Added clarification on the data format for multi-value text fields like `Categories` from Airtable.
### Summary of Improvements
This document outlines the features of an interactive event catalog.
The core application provides a dynamic, hierarchical interface for browsing a catalog and building an event plan.
Key features include a consolidated header for event details, a vertically scrolling catalog of "Interactive Cards," and a new Beta Toolkit for advanced features.
### Core Functionality (MVP)

#### Airtable & Cloudinary Integration
The application's data is powered by an Airtable database and the Cloudinary media library.
* **Data Formatting**: Fields intended to hold multiple values, such as `Categories`, `Subcategories`, and `Media Tags`, are configured as `Single line text` fields in Airtable.
Values are stored as a single, comma-separated string (e.g., "Activities, Outdoor").
The application is responsible for parsing these strings into individual tags for filtering and searching.
* **Direct API Communication (Development)**: For development purposes, the application communicates directly with the Airtable API from the browser.
This method uses a hard-coded Personal Access Token. Note: This approach poses a security risk by exposing the API key and is intended as a temporary measure.
The final version should use a secure serverless proxy.

### State Management Model ("One-Way Street")
To ensure a clear and predictable user experience, the application uses a "one-way street" model for managing user selections.
An item progresses from a temporary favorite to a permanent part of the event plan.
* **Core Rule**: An item can be either a **Favorite** (in the bottom carousel) or a **Locked Item** (in the right-hand Event Plan), but never both simultaneously.
* **Favoriting**: Clicking a heart icon (❤️) adds an item to the temporary `Favorites` list.
It can be un-favorited at any time.
* **Locking In**: Clicking "Add to Plan" moves the item from the `Favorites` list to the `Event Plan`.
It disappears from the favorites carousel, and its icon on the main catalog card changes to a disabled checkmark (✅).
* **Editing & Removing**: Once locked, an item can only be modified via the "Edit" button or removed via the "×" button within the Event Plan sidebar.
#### Session Management (Live URL & Fork on Edit)
A unique, shareable URL is automatically generated and updated as a user builds their event plan.
* **Live URL**: The URL in the browser address bar is the canonical link for the event plan.
* **Sharing**: A user can share their plan at any time by simply copying and sharing the URL from their browser.
* **Fork on Edit**: When a second user opens a shared URL, they see the original plan.
The moment this new user makes a change, the system automatically "forks" the plan by creating a brand new session and updating their URL.
This prevents collaborators from overwriting each other's work and ensures the original shared plan is not altered.
#### Catalog Loading and Display
The catalog loading process is designed for a smooth user experience.
The application initially displays a "Loading catalog..." message and fetches all event records.
Once loaded, the initial view shows only the top-level "Grouping" items.
#### Hierarchical Catalog Display
The catalog is organized as a hierarchy of interactive items.
Items can be either Groupings (e.g., "Activities") or final Bookable Items (e.g., "Escape Room").
This structure allows users to navigate from broad categories to specific details.
### The Interactive Card
Every item in the catalog is presented on a versatile "Interactive Card."
The card's appearance and functionality adapt based on the item it represents.
All cards feature a Heart (❤️) icon for universal selection, a Parent (⬆️) button for navigation, and an Availability (📅) icon.
### Favorites Carousel
When a user selects one or more items, a horizontally scrolling carousel appears below the main header.
* **Consistent Design**: Cards in the carousel are styled with the same aspect ratio as the main catalog cards for visual consistency.
* **Remove Functionality**: Each favorite card includes a remove (×) button, allowing users to quickly un-favorite an item directly from the carousel.
* **Open Detail View**: Clicking on a favorite card opens the Detailed Item View for that item.
### Search & Filtering
A set of controls allows users to refine and organize the catalog view.
* **Category Buttons**: Multi-select buttons at the top of the panel allow users to filter by one or more categories.
* **Smart Search**: A search bar allows users to filter the catalog by item name, description, categories, and tags.
Results are prioritized to show name matches first.
* **Filtering**: Users can filter the catalog by pre-defined price ranges and other attributes like headcount and location.
* **Status Filter**: A dropdown allows filtering by item status (e.g., "Available", "Coming Soon").
The catalog defaults to showing only "Available" items on page load.
* **Sorting**: A dropdown menu controls the sort order of the catalog (e.g., Price Low to High, Name A-Z).
* **Reset**: A "Reset" button clears all active search terms and filters, returning the catalog to its default view.
### Detailed Item View
Clicking on a catalog card opens a large modal overlay with comprehensive information.
* **Layout**: The view uses a two-column layout, with an image gallery on the left and item details on the right.
* **Image Gallery**: Displays all available images for an item from Cloudinary, with a main image and clickable thumbnails.
* **Interactive Options**: For items with choices, options are displayed as clickable buttons showing any price modifications.
* **In-Modal Navigation**: The modal includes a Parent (⬆️) button for navigating up the hierarchy and supports clicking on navigational options to drill down, all without closing the modal.
* **Controls**: The Heart (❤️), Explode (💥), and Quantity Selector controls are available directly within the modal.
* **Availability**: An inline, read-only calendar is displayed, showing the specific day-by-day availability for that item.
### Date Availability System
The application provides real-time event availability at three distinct levels, powered by a JavaScript date picker library (flatpickr) and a serverless function that parses a remote iCal feed.
Users specify the event length by selecting a start and end time directly within the date picker.
* **The Header Calendar (Summary View)**: The main date picker shows a color-coded monthly calendar reflecting the combined availability of all favorited items.
* **The Card Icons (Status View)**: After a date range is selected, an icon on every card updates to show its specific availability (✅, 🟠, or ❌).
* **The Item Calendar (Detail View)**: The detail view modal shows the detailed day-by-day availability for that specific item only.
### Payment & Checkout
The application includes a complete checkout flow to finalize and pay for an event plan.
* **Checkout Button**: A "Checkout" button in the header becomes active when the plan total is greater than zero.
* **Checkout Modal**: Clicking the button opens a checkout modal with three sections: an order summary, fields for customer information, and a secure payment form.
* **Secure Payment Processing**: Payment details are handled by integrating Stripe Elements.
This ensures sensitive credit card information is sent directly to Stripe and never touches the application's server, providing maximum security and PCI compliance.

### Multi-Shop Customization
The application has been upgraded to support different types of storefronts (e.g., event-based vs. general stores) with UIs that adapt dynamically based on settings controlled in the Airtable `Stores` table.

* **Shop-Specific Settings (Airtable):** The `Stores` table now acts as a "control panel." New fields like `ShopType`, `EnabledFilters` (Multiple Select), and `CartLabels` (JSON) allow for per-store configuration without changing the application's code.

* **Dynamic Filter Display:** The filter panel on the main catalog page is no longer static. It reads the `EnabledFilters` setting for the active store and shows or hides filter groups like "Headcount" and "Location" accordingly.

* **Customizable UI Text:** Text labels, placeholders, and button text in the right-hand cart panel are now dynamic. This is driven by a JSON object stored in the `CartLabels` field, allowing text like "Event Plan" to be changed to "Cart" for different shop types.

* **Flexible Checkout Flow:** The checkout process can be customized per-store. A `PaymentOptions` field in Airtable determines whether customers can pay a deposit only, or choose between a deposit and the full amount. The "Simplified Terms" displayed in the modal are also populated from a store-specific field.

### Session Management
The application supports both guest and authenticated users with a robust, database-driven session model.

* **Database-Driven "My Plans":** For authenticated users, the application provides a "My Plans" dropdown in the main header. This list is populated by fetching all sessions from Airtable where the user is listed as a collaborator. This replaces the previous reliance on browser `localStorage`, ensuring a user's plans are available on any device.
* **Anonymous Sessions:** Unauthenticated users can fully build, edit, and share an event plan. The session is saved to Airtable automatically but is not linked to a permanent user.
* **Session "Claiming":** When a guest user signs in while working on a plan, the application automatically associates their active session with their new authenticated account. The plan immediately appears in their "My Plans" list without requiring a page reload.
* **Fork on Edit:** The "fork on edit" model is preserved for shared links. When a user opens a shared URL and makes a change, a new copy of the session is created and assigned to them, protecting the original plan from being overwritten.

### User Accounts & Notifications
The application features a user account system with customizable preferences.

* **Authentication:** Users can create an account or sign in using a passwordless "magic link" system.
* **My Account Modal:** Logged-in users can access a "My Account" modal to view their information and set preferences.
* **SMS Notifications:** Users can add their phone number and choose a notification frequency (e.g., "Real-Time"). When another collaborator sends a message in the session chat, a serverless function is triggered, sending a real-time SMS alert via Twilio to opted-in users.

### Plan Board View (v3.6)
The presentation view renders all plan items as compact card tiles in a responsive CSS Grid, providing an at-a-glance overview of the entire plan.

* **Compact Card Tiles:** Each item is rendered as a fixed-size tile showing: hero photo (with Cloudinary optimization), item name, merged-entry provenance line, variation/option pills, reaction summary, and comment count badges.
* **Floating Overlays on Photo:** The task status badge (GTG/Check/Needs Attention/etc.) floats at the top-left of the photo. The summary emoji (representing average reaction sentiment) floats at the top-right, with a tooltip preserving the full ranking, score, and emoji spread breakdown.
* **Responsive Grid Layout:** Cards are arranged in a CSS Grid (`repeat(auto-fill, minmax(260px, 1fr))`) that adapts from 1 column on mobile to 4 columns on large desktops. Cards auto-size based on available space.
* **Two-Level Navigation:** The board view shows all items at a glance. Clicking any card opens the full detail modal directly — no accordion expand step. This keeps the experience focused: overview → detail.
* **Entry Provenance:** Combined/hybrid items display a provenance row with color-coded source-type badges showing which entries were merged. Each source badge indicates the origin type (AI with robot icon, Solution with lightbulb, Manual with pencil, or Catalog) alongside the source name. Hybrid items show a sparkle icon. Source entries are not rendered as separate cards.
* **Visual Lifecycle Indicators:** Cards visually distinguish item states through multiple signals: border colors and subtle body gradients for goal (golden) and locked (green) states, reduced opacity and grayscale for archived items, and a checkmark overlay for completed items. A floating lifecycle badge on the photo's bottom-right corner labels the state explicitly (Goal, Confirmed, Archived, Done). Ideas show no badge as the default state.
* **Entry Source Type Badge:** Non-catalog items display a small source-type icon next to the title — AI-suggested items show a robot icon, solutions show a lightbulb, and manually-added items show a pencil. Catalog items omit the badge as they are the standard source.
* **Lifecycle-Aware Group Cards:** Option group cards now show aggregate lifecycle status chips (counts of locked, goal, completed, and archived members) and member pills with lifecycle-specific styling (colored borders, strikethrough for completed, muted for archived).
* **Confidence Tier Styling:** AI-sourced, solution, and manual items display confidence-tier border accents (pencil/pen/typed/premium) matching the existing system.
* **Compact Reaction Bar:** The bottom meta bar of each card displays the top 3 emoji reactions as styled pill badges. Each pill shows the emoji and its count on a semi-transparent background with a subtle border. Additional reactions beyond the top 3 show an overflow count. Pills scale slightly on hover. Reaction data is aggregated across group card members, so group cards surface the combined emoji sentiment.
* **Task Status Meta Badge:** A color-coded task status pill appears in the meta bar alongside comment badges. The pill shows the status icon and label (Good to Go in green, Check in amber, Needs Attention in red, No Action in gray). This supplements the floating photo overlay, giving users two points of reference for task status. Group cards aggregate task statuses across members, showing per-status counts.
* **Comment Count Badge:** Comments are displayed as a styled pill badge with a speech bubble icon and count. The badge uses a blue-tinted background that brightens on hover. Group cards aggregate comment counts across all member items and display a single combined count.
* **Grid Drag-and-Drop Reordering:** Compact card tiles are directly draggable within the CSS Grid using SortableJS. Cards can be picked up with a long press (300ms delay on touch) and repositioned anywhere in the grid. The ghost placeholder uses a dashed blue border with reduced opacity, while the dragged card elevates with a shadow and slight rotation. Custom ordering is persisted to `state.session.planItemOrder` and restored on subsequent loads.
* **Radial Action Menu:** Horizontal swipe or long-press on any card activates a radial menu centered on the card. The menu displays action buckets arranged in a circle (200px radius on desktop, 160px on mobile) for lifecycle changes (goal, lock, archive, complete, demote, delete), reactions, and comments. The menu constrains itself to the viewport and supports both compact card tiles and legacy list items.
* **Card-to-Card Merge Detection:** During a drag, hovering over another card for 250ms activates merge mode with zone-aware visual feedback. The card's photo area maps to a "hybrid" merge (purple highlight with sparkle icon) that combines two items into one, while the body area maps to an "options" merge (green highlight with folder icon) that creates a related options group. The merge indicator follows the cursor and updates its label and color based on which zone is being hovered. Both merge types trigger background AI estimation for naming and description.
* **Empty Board State:** When no items are on the board, a centered empty state displays a floating icon, clear messaging, and four category suggestion buttons (Activities, Food & Drink, Venues, Extras) with icons. Each button navigates to the corresponding catalog category. A contextual hint about swipe actions is shown below the suggestions.
* **Single-Item Nudge:** When only one card is on the board, a subtle dashed-border nudge card spans the full grid width below it, encouraging the user to add more items for comparison and merging.
* **Card Entrance Animations:** Cards animate in with a staggered fade-and-slide-up effect (0.3s duration, 40ms stagger per card up to 8 cards, then all remaining cards share a final delay). The animation uses `opacity` and `translateY` transforms for GPU acceleration.
* **Performance Optimizations:** Cards use `will-change: transform` during entrance animations, which is automatically removed after 600ms via a `settled` class to free GPU memory. During drag-and-drop, non-dragged cards have pointer-events disabled via an `is-sorting` class on the grid container, preventing accidental interactions.
* **Keyboard Accessibility:** All compact cards have `role="article"`, `tabindex="0"`, and descriptive `aria-label` attributes. Cards respond to Enter and Space key presses to open detail modals. The grid container has `role="list"` and `aria-label`. Focus-visible outlines use a purple ring with shadow for clear keyboard navigation feedback, while mouse focus shows no outline.
* **Responsive Touch Targets:** On mobile (under 480px), touch targets for badges, pills, and suggestion buttons are enlarged to meet the 44px minimum, with adjusted padding and font sizes. The single-item nudge stacks vertically on mobile for better readability.
* **Reduced Motion Support:** All board entrance animations, floating empty-state icon animation, and nudge entrance animation are disabled when `prefers-reduced-motion: reduce` is active, respecting users with vestibular disorders.
* **High Contrast Support:** Under `forced-colors: active`, compact cards receive solid borders using system colors, focus outlines use the Highlight color, and badges use explicit system-color borders for visibility.

