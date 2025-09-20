Project Roadmap: TMT Event Catalog v3.0 - v7.0
Version: 3.0
Last Modified: 2025-09-20

This document outlines the phased development plan for enhancing the interactive event catalog. Each version builds upon the last, introducing major new features while leveraging the existing modular architecture.

## Version 2.1: Live Chat & CRM Dashboard (MVP) - ✅ COMPLETE
Core Objective: To integrate real-time communication for users and provide an internal tool for monitoring session activity.

Key Features Delivered
Real-Time Chat: A persistent chat widget has been added to the main catalog view, allowing users in the same session to communicate in real-time.

Browser & Tab Notifications: The catalog now provides both system-level browser notifications and dynamic tab title updates to alert users of new messages.

CRM Dashboard (Draft v1): A password-protected internal dashboard (crm.html) has been created with features for live monitoring, direct messaging, and session archiving.

## Version 3.0: User Authentication & Notification Preferences
Core Objective: To replace the temporary user identity system with a robust and secure user authentication system, laying the groundwork for personalized experiences and multi-channel notifications.

Guiding Principles (Lean & Intuitive)
Frictionless Start: Users will never be forced to sign up. The current "fun name" guest system will remain the default, allowing anyone to browse, create a plan, and share it without an account.

Value-Driven Sign-Up: We will only prompt users to sign up when there is a clear benefit, such as saving their event plans to their account to access them across different devices.

Passwordless Login: We will use a "magic link" system for authentication. This is a secure and user-friendly method that doesn't require users to create or remember a password.

Unified Profile: A single "My Account" area will be the central hub for users to manage their details and, eventually, their notification preferences.

Phase 1: Backend & Core Logic (The MVP)
Airtable Schema Update:

Create a new Users table with the following fields:

UserID (Primary Key, Autonumber or Formula)

Email (Email type, marked as unique)

Name (Single line text)

Sessions (Link to Sessions table, allow linking to multiple records)

CreatedAt (Created time)

Future-Proofing: Also add the following fields now so we don't have to migrate the database later:

PhoneNumber (Phone number type, for future SMS notifications)

NotificationPreferences (Single line text, to store JSON like {"email": true, "sms": false})

Create a new AuthTokens table to temporarily store magic link tokens. Fields: Token (Single line text), Email (Email type), ExpiresAt (Date time).

Develop Serverless Functions:

/api/auth-start: A function that accepts an email address. It will:

Generate a secure, single-use token.

Store the token, email, and a 15-minute expiration date in the AuthTokens table.

Email the user a "magic link" containing the token (e.g., yoursite.com/?loginToken=...).

/api/auth-verify: A function that accepts the token from the magic link. It will:

Find the token in the AuthTokens table and verify it hasn't expired.

Find or create a user in the Users table with the corresponding email.

Generate a long-lived JSON Web Token (JWT) containing the UserID.

Return the JWT to the client.

Delete the single-use token from AuthTokens.

Phase 2: Frontend Integration
Create the "My Account" Modal:

Build a single modal that handles both guest and registered user states.

Guest View: A simple form with one field: "Enter your email to sign in or create an account." Submitting this form calls the /api/auth-start function.

Logged-In View: Displays the user's name and email, an input to edit their name, and a "Sign Out" button. This is also where the UI for managing notification preferences will eventually be added.

Integrate UI Triggers:

Add a user/account icon to the main header of the application.

When a guest clicks the icon, it opens the "My Account" modal to the guest view.

When a logged-in user clicks the icon, it opens the modal to the logged-in profile view.

Update State Management:

Modify state.js to store the JWT and user information (ID, name, email).

When the application loads, it will check for a valid JWT in local storage to automatically sign the user in.

The chat widget will be updated to use the registered user's name instead of the "fun name" when a user is logged in.

## Version 4.0: Smart Discounts 💸
**Core Objective:** To implement a flexible system for applying discounts to an event plan, from simple promo codes to more complex, rule-based rewards.

#### **Key Design Decisions**
* **Data Model:** Create a new `Discounts` table in Airtable with fields like: `Code`, `Type` ("Percentage," "Fixed"), `Value`, `Rules` (JSON), and `IsActive`.
* **Application Logic:** Discount validation and calculation will occur **server-side** to prevent client-side manipulation.
* **"Quirky" Discounts:** The `Rules` field will store a JSON object, providing the flexibility to define complex conditions later (e.g., contributing to a cause).

#### **Step-by-Step Development Plan**
1.  **Backend (Airtable & Serverless Functions):**
    * Create the `Discounts` table in Airtable.
    * Develop a new serverless function: `/api/apply-discount` to validate a code and return the discounted total.
2.  **Frontend (UI & Logic):**
    * Add a "Promo Code" input field to the checkout modal (`components/modal.js`).
    * Update `ui.js` and `events.js` to handle the application of the discount code and update the UI accordingly.
3.  **State Management:**
    * Update `state.js` to include `state.cart.appliedDiscount` to store the details of any active discount.

---

### ## Version 4.0: RSVPs & Itinerary View 🎉

**Core Objective:** To evolve a saved session into a shareable event splash page where guests can view details and RSVP, and planners can manage the event.

#### **Key Design Decisions**
* **URL Routing:** Introduce a new public-facing "Event View" via a `?event=[session_id]` URL parameter. The app will detect this and render the appropriate view.
* **Data Model:**
    * Create a new `RSVPs` table in Airtable, linked to `Sessions` and `Users`.
    * Add a `IsJoinable` checkbox field to the main catalog items table.
* **UX - The Splash Page:** A new, full-page component that replaces the catalog view for guests. It will feature event details, a read-only itinerary, an RSVP form, and the session chat.

#### **Step-by-Step Development Plan**
1.  **Backend (Airtable & Serverless Functions):**
    * Create the `RSVPs` table and update the items table schema.
    * Develop new serverless functions: `/api/get-event-details` (for the public page) and `/api/submit-rsvp`.
2.  **Frontend (UI & Logic):**
    * Refactor `main.js` to handle the new `event` vs. `session` URL routing.
    * Design and build the **Event Splash Page** component.
    * Enhance the planner's Itinerary view (`components/itinerary.js`) to display RSVP data.

---

### ## Version 5.0: Rich Media Chat 🎥

**Core Objective:** To upgrade the text-based chat to support real-time audio and video, enhancing collaboration.

#### **Key Design Decisions**
* **Technology (WebRTC):** Use a **third-party service** like Twilio Video to manage the complexity of real-time video networking and provide a robust SDK.
* **User Interface:** Integrate video/audio controls and video stream displays directly into the existing chat widget (`#chat-window`).
* **Transcription Services:** Integrate an API like AssemblyAI or Google Speech-to-Text for audio/video-to-text features.

#### **Step-by-Step Development Plan**
1.  **Backend (Serverless Functions):**
    * Develop a new secure serverless function, `/api/get-video-token`, to generate and return an access token from the chosen video provider.
2.  **Frontend (UI & Logic):**
    * Integrate the chosen video provider's JavaScript SDK.
    * Overhaul `chat.js` and `index.html` to include UI elements for video calls (video windows, mute/unmute buttons, etc.).
    * Implement the client-side logic to request a token, connect to the video service, and manage media streams.

---

### ## Version 6.0: AI Agent Assist 🤖

**Core Objective:** To introduce an AI assistant into the chat to provide instant answers, summarize conversations, and facilitate seamless handoffs to human support.

#### **Key Design Decisions**
* **AI Provider:** Use a major Large Language Model (LLM) provider (e.g., OpenAI, Google Gemini).
* **Agent Persona & Knowledge:** Define the AI's role as a "TMT Event Assistant" via a system prompt. Its knowledge base will be the context of the current session (items, notes, date).
* **Interaction Model:** Users will explicitly tag the agent (e.g., `@TMT-bot`) to ask a question.
* **Human Handoff:** The AI will trigger a serverless function to send a notification (email, Slack) when it cannot answer a question.

#### **Step-by-Step Development Plan**
1.  **Backend (Serverless Functions):**
    * Develop a new serverless function, `/api/ai-assist`, that takes the chat history, constructs a request to the LLM API, and returns the response.
    * Develop a function, `/api/notify-specialist`, to handle the human handoff notifications.
2.  **Frontend (UI & Logic):**
    * Modify `chat.js` and `events.js` to detect when the AI agent is tagged in a message.
    * Send the prompt to the `/api/ai-assist` endpoint.
    * Display the AI's response in the chat UI, visually distinguishing it from user messages.
