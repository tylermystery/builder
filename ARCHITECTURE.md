# Application Architecture Overview
This document outlines the technical architecture of the interactive event catalog. The application is built on a modular architecture to ensure maintainability and scalability. Each JavaScript file has a distinct responsibility, separating concerns like data management, API communication, user interaction, and UI rendering.

## Core Modules
- **main.js:** The primary entry point for the public-facing application. Orchestrates initial setup, data fetching, event listeners, and the first UI render.
- **teammate.js:** The primary entry point for the internal teammate profile page. Fetches and renders performance data for a specific teammate.
- **events.js:** A centralized module that handles all user interactions, containing event listeners for clicks, form inputs, and other user-driven events.
- **filtering.js:** Contains the complete logic for filtering and sorting the catalog based on user selections.
- **api.js:** Manages all communication with external services like Airtable and Cloudinary.
- **state.js:** Acts as a centralized, in-memory database for the application's current state.
- **config.js:** A simple module for storing global constants and configuration values.

## UI Modules
- **ui.js:** The central "hub" for the user interface, importing and re-exporting functions from component modules. It also contains general-purpose UI functions.
- **components/card.js:** Responsible for creating and rendering all card-based elements.
- **components/modal.js:** Manages the functionality of the detail and checkout modals.
- **components/sidebar.js:** Controls the right-hand "Event Plan" panel and the "Favorites" carousel.

## Serverless Functions (`netlify/functions/`)
- **/api/process-email:** Receives email data from a webhook, uses the Gemini AI API to parse for sales information, and creates or updates records in the Airtable CRM.
- **/api/auth-start & /api/auth-verify:** Handle the passwordless "magic link" authentication flow.
- **Other Functions:** Proxies for Calendar, Cloudinary, Payments, and Chat services.

## Utility Modules
- **utils/debug.js:** Provides a simple, toggleable logging system for development.
