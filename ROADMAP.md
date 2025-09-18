# Project Roadmap: TMT Event Catalog v2.0 - v6.0

**Version: 1.1**
**Last Modified: 2025-09-17**

This document outlines the phased development plan for enhancing the interactive event catalog. Each version builds upon the last, introducing major new features while leveraging the existing modular architecture.

---

### ## Version 2.0: User Authentication 🔐

**Core Objective:** To replace the temporary user identity system with a robust and secure user authentication system, laying the groundwork for personalized experiences.

#### **Key Design Decisions**
* **Gradual Engagement & Authentication:** The system will support both **Guest** and **Registered Users**. [cite_start]New visitors will begin as guests, assigned a temporary ID and a fun, generated name[cite: 165, 166]. This ensures a frictionless initial experience.
* **Non-Intrusive Prompts:** Instead of disruptive popups, users will be gently prompted to sign up at logical points. This includes a banner in the chat widget and a universal account icon in the main header.
* **Technology:** We'll use **JSON Web Tokens (JWT)** for managing sessions. A JWT will be issued upon login and sent with each API request to authenticate the user. This is a stateless, secure standard that works perfectly with our serverless function architecture.
* **Data Model:** A new `Users` table will be created in Airtable to store permanent user data (ID, name, email, hashed password) and will be linked to the `Sessions` table to establish ownership.

#### **Step-by-Step Development Plan**
1.  **Backend (Airtable & Serverless Functions):**
    * Create the `Users` table in Airtable.
    * Develop three new serverless functions: `/api/register`, `/api/login`, and `/api/update-profile`.
2.  **State Management:**
    * Modify `state.js` to evolve the `state.user` object to support both guest and registered states, including an `isAuthenticated` flag.
3.  **Frontend (UI):**
    * [cite_start]Add a non-intrusive sign-up banner to the chat header (`#chat-header`) in `index.html`[cite: 859].
    * [cite_start]Add a dynamic user account icon and dropdown menu to the main application header (`#header-toolbar`) in `index.html`[cite: 660].
4.  **Frontend (Modals):**
    * Build the necessary modals for the authentication flow: Login, Sign Up, and a simple "Edit Profile" modal for registered users.
5.  **Integration & Refactoring:**
    * Connect all UI prompts and buttons to their respective modals using handlers in `events.js`.
    * Update `api.js` to call the new authentication endpoints.
    * Refactor `chat.js` and other modules to pull user identity from the new, centralized `state.user` object, ensuring a seamless transition from a "fun name" to a registered user's name.

---

### ## Version 3.0: Smart Discounts 💸

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
