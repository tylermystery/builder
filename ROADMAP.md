## Version 3.1: Teammate Profiles (✅ COMPLETE)
**Core Objective:** To build an internal performance tracking system for teammates.
**Key Features Delivered:**
- **Airtable Schema Update:** Created `Teammates` and `Ratings` tables and linked them to `Sessions`.
- **Teammate Profile Page:** A new private page (`teammate.html`) now displays a teammate's performance snapshot, including metrics for events sold/hosted, hours, sales value, and average rating.
- **CRM Integration:** The main CRM Dashboard now links to individual teammate profile pages.
---
## Version 3.2: UMW MVP & Dynamic Shop UI (✅ COMPLETE)
**Core Objective:** To adapt the UI and functionality for non-event-based shops, controlled by a centralized settings system.
**Key Features Delivered:**
- **Store-Specific Settings:** The `Stores` table in Airtable now acts as a control panel with new fields (`ShopType`, `EnabledFilters`, `CartLabels`, `PaymentOptions`, `TermsAndConditions`) to manage each storefront's behavior.
- **Dynamic Filter Display:** The filter panel on the main page now dynamically shows or hides filters (Subcategories, Headcount, Location) based on the settings for the active shop.
- **Dynamic UI Text:** Labels and placeholders in the cart/sidebar now update based on the `CartLabels` JSON field for the active shop (e.g., "Event Plan" becomes "Cart").
- **Flexible Checkout:** The checkout modal now supports different payment options (Deposit vs. Full Amount) controlled by the `PaymentOptions` setting.
- **Session Persistence:** Session links now open in the correct store, and refreshing the page correctly remembers the last-viewed shop.
---
## Version 3.3: Advanced Authentication & Owner Portal Access (✅ COMPLETE)
**Core Objective:** To replace the basic login system with a secure, real-time "magic link" flow and provide a dedicated access point for store owners.
**Key Features Delivered:**
- **Real-Time "Confirmation Click" Login:** Implemented a Pusher-based authentication flow. Users receive a confirmation link in their email, and clicking it logs them in on their original browser tab without needing to open a new window.
- **Airtable Schema for Authentication:** Added `Users` and `Magic Links` tables to the Airtable base to manage user identities and temporary login tokens securely.
- **Store Owner Identification:** The system now links records in the `Users` table to records in the `Stores` table, allowing for role-based permissions and access.
- **Conditional UI for Owners:** The "My Account" popup now dynamically displays a "Store Dashboard" button that appears exclusively for logged-in store owners, providing a clear, user-initiated path to their dashboard.
---
## Version 3.4: AI Sales Assistant (On Hold)
**Core Objective:** To automate CRM data entry by parsing sales emails with an AI assistant.
- **Current Status:** A serverless function (`/api/process-email`) and a Zapier webhook have been built. The function is not yet deploying successfully. **Debugging is paused** to focus on UI features.
