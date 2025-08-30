Feature Specification Sheet (Final Version)

**Version: 1.2.0**
**Last Modified: 2025-08-30**

### Changelog
* **v1.2.0 (2025-08-30):** Added "State Management Model" section to document the user flow for favorited and locked items.
* **v1.1.0 (2025-08-29):** Added clarification on the data format for multi-value text fields like `Categories` from Airtable.

### Summary of Improvements
This document outlines the features of an interactive event catalog. The core application provides a dynamic, hierarchical interface for browsing a catalog and building an event plan. Key features include a consolidated header for event details, a vertically scrolling catalog of "Interactive Cards," and a new Beta Toolkit for advanced features.

### Core Functionality (MVP)

#### Airtable & Cloudinary Integration
The application's data is powered by an Airtable database and the Cloudinary media library.
* **Data Formatting**: Fields intended to hold multiple values, such as `Categories`, `Subcategories`, and `Media Tags`, are configured as `Single line text` fields in Airtable. Values are stored as a single, comma-separated string (e.g., "Activities, Outdoor"). The application is responsible for parsing these strings into individual tags for filtering and searching.

#### Direct API Communication (Development)
For development purposes, the application communicates directly with the Airtable API from the browser. This method uses a hard-coded Personal Access Token. Note: This approach poses a security risk by exposing the API key and is intended as a temporary measure. The final version should use a secure serverless proxy.

### State Management Model ("One-Way Street")
To ensure a clear and predictable user experience, the application uses a "one-way street" model for managing user selections. An item progresses from a temporary favorite to a permanent part of the event plan.
* **Core Rule**: An item can be either a **Favorite** (in the bottom carousel) or a **Locked Item** (in the right-hand Event Plan), but never both simultaneously.
* **Favoriting**: Clicking a heart icon (❤️) adds an item to the temporary `Favorites` list. It can be un-favorited at any time.
* **Locking In**: Clicking "Add to Plan" moves the item from the `Favorites` list to the `Event Plan`. It disappears from the favorites carousel, and its icon on the main catalog card changes to a disabled checkmark (✅).
* **Editing & Removing**: Once locked, an item can only be modified via the "Edit" button or removed via the "×" button within the Event Plan sidebar.

#### Session Management (Live URL & Fork on Edit)
A unique, shareable URL is automatically generated and updated as a user builds their event plan.
* **Live URL**: The URL in the browser address bar is the canonical link for the event plan.
* **Sharing**: A user can share their plan at any time by simply copying and sharing the URL from their browser.
* **Fork on Edit**: When a second user opens a shared URL, they see the original plan. The moment this new user makes a change, the system automatically "forks" the plan by creating a brand new session and updating their URL. This prevents collaborators from overwriting each other's work and ensures the original shared plan is not altered.

#### Catalog Loading and Display
The catalog loading process is designed for a smooth user experience. The application initially displays a "Loading catalog..." message and fetches all event records. Once loaded, the initial view shows only the top-level "Grouping" items.

#### Hierarchical Catalog Display
The catalog is organized as a hierarchy of interactive items. Items can be either Groupings (e.g., "Activities") or final Bookable Items (e.g., "Escape Room"). This structure allows users to navigate from broad categories to specific details.

### The Interactive Card
Every item in the catalog is presented on a versatile "Interactive Card." The card's appearance and functionality adapt based on the item it represents. All cards feature a Heart (❤️) icon for universal selection, a Parent (⬆️) button for navigation, and an Availability (📅) icon.

### Favorites Carousel
When a user selects one or more items, a horizontally scrolling carousel appears below the main header.
* **Consistent Design**: Cards in the carousel are styled with the same aspect ratio as the main catalog cards for visual consistency.
* **Remove Functionality**: Each favorite card includes a remove (×) button, allowing users to quickly un-favorite an item directly from the carousel.
* **Open Detail View**: Clicking on a favorite card opens the Detailed Item View for that item.

### Search & Filtering
A set of controls allows users to refine and organize the catalog view.
* **Smart Search**: A search bar allows users to filter the catalog by item name, description, categories, and tags. Results are prioritized to show name matches first.
* **Filtering**: Users can filter the catalog by pre-defined price ranges.
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
The application provides real-time event availability at three distinct levels, powered by a JavaScript date picker library (flatpickr) and a serverless function that parses a remote iCal feed. Users specify the event length by selecting a start and end time directly within the date picker.
* **The Header Calendar (Summary View)**: The main date picker shows a color-coded monthly calendar reflecting the combined availability of all favorited items.
* **The Card Icons (Status View)**: After a date range is selected, an icon on every card updates to show its specific availability (✅, 🟠, or ❌).
* **The Item Calendar (Detail View)**: The detail view modal shows the detailed day-by-day availability for that specific item only.

### Payment & Checkout
The application includes a complete checkout flow to finalize and pay for an event plan.
* **Checkout Button**: A "Checkout" button in the header becomes active when the plan total is greater than zero.
* **Checkout Modal**: Clicking the button opens a checkout modal with three sections: an order summary, fields for customer information, and a secure payment form.
* **Secure Payment Processing**: Payment details are handled by integrating Stripe Elements. This ensures sensitive credit card information is sent directly to Stripe and never touches the application's server, providing maximum security and PCI compliance.
