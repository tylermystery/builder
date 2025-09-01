Application Architecture Overview
This document outlines the technical architecture of the interactive event catalog. The application is built on a modular architecture to ensure maintainability and scalability. Each JavaScript file has a distinct responsibility, separating concerns like data management, API communication, user interaction, and UI rendering.

Core Modules
main.js: The primary entry point for the application. It orchestrates the initial setup by fetching data, initializing event listeners, and triggering the first render of the catalog.

events.js: A centralized module that handles all user interactions. It contains the event listeners for clicks, form inputs, scrolling, and other user-driven events, along with the helper functions that respond to those events.

filtering.js: Contains the complete logic for filtering and sorting the catalog based on user selections like category, status, search terms, and price.

api.js: Manages all communication with external services. It contains the functions for fetching data from the Airtable API and Cloudinary.

state.js: Acts as a centralized, in-memory database for the application's current state, including the list of all records, the contents of the user's cart, and session details.

config.js: A simple module for storing global constants and configuration values, such as API field names and application settings.

UI Modules
ui.js: Acts as the central "hub" for the user interface. It imports functions from the individual component modules and re-exports them for the rest of the application to use. It also contains general-purpose UI functions and shared helpers.

components/card.js: Responsible for creating and rendering all card-based elements, including the main catalog cards and the smaller cards in the favorites carousel.

components/modal.js: Manages the functionality of the detail and checkout modals, including showing, hiding, and populating them with the correct data.

components/sidebar.js: Controls the right-hand "Event Plan" panel and the "Favorites" carousel at the bottom of the page, handling all updates to these areas.

Utility Modules
utils/debug.js: Provides a simple, toggleable logging system. This allows for detailed console messages during development and testing, which can be disabled for production.
