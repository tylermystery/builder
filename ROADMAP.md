## Version 3.1: Teammate Profiles & AI-Powered CRM (In Progress)
**Core Objective:** To build an internal performance tracking system for teammates and begin automating CRM data entry.

**Phase 1: Backend & Core Logic (✅ COMPLETE)**
- **Airtable Schema Update:**
    - Created `Teammates` table for employee information.
    - Created `Ratings` table for performance feedback.
    - Enhanced `Sessions` table to link to `SalesLead` and `EventHost`.

**Phase 2: Teammate Profile Page (✅ COMPLETE)**
- A new private page (`teammate.html`) has been created to display a teammate's performance snapshot.
- The page shows key metrics like events sold, events hosted, hours worked, total sales value, and average rating.
- The CRM Dashboard now links to these individual profile pages.

**Phase 3: AI Sales Assistant (In Debugging)**
- A serverless function (`/api/process-email`) has been created to parse sales emails using the Gemini AI API.
- A Zapier webhook is configured to securely forward emails to the function.
- **Current Status:** The function is not yet deploying successfully. Debugging is paused.
