// FILE: netlify/functions/create-quick-plan.js
// PURPOSE: Creates a new Plan (Projects record) from a single text input
// Used by the /start-a-plan.html quick entry page

const fetch = require('node-fetch');

// Environment variables for Airtable access
const { AIRTABLE_PAT, BASE_ID } = process.env;

// Target the existing Projects table
const PROJECTS_TABLE = 'Projects';

// Debug logging prefix for this module
const DEBUG_PREFIX = '[create-quick-plan]';

/**
 * Debug logger for plan creation - focused logging for this feature
 * @param {string} action - The action being performed
 * @param {any} data - Data to log (optional)
 */
function debugLog(action, data = null) {
  const timestamp = new Date().toISOString();
  if (data !== null) {
    console.log(`${DEBUG_PREFIX} [${timestamp}] ${action}:`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${DEBUG_PREFIX} [${timestamp}] ${action}`);
  }
}

/**
 * Triggers background AI enrichment of the newly created plan
 * This is fire-and-forget - we don't await the result
 * @param {string} projectId - The Airtable record ID of the new project
 * @param {string} ideaText - The original idea text for AI analysis
 */
function triggerBackgroundEnrichment(projectId, ideaText) {
  // Get the base URL from the environment or construct it
  // In Netlify Functions, we can call other functions via their path
  const enrichmentUrl = process.env.URL
    ? `${process.env.URL}/.netlify/functions/enrich-quick-plan`
    : '/.netlify/functions/enrich-quick-plan';

  debugLog('Triggering background AI enrichment', { projectId, enrichmentUrl });

  // Fire and forget - don't await
  fetch(enrichmentUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: projectId,
      ideaText: ideaText
    })
  })
    .then(response => {
      if (response.ok) {
        debugLog('Background enrichment triggered successfully', { projectId });
      } else {
        debugLog('Background enrichment returned non-OK status', { projectId, status: response.status });
      }
    })
    .catch(error => {
      // Log but don't fail - enrichment is optional
      debugLog('Background enrichment failed (non-critical)', { projectId, error: error.message });
    });
}

exports.handler = async (event) => {
  debugLog('Function invoked', { method: event.httpMethod });

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  // Validate environment variables
  if (!AIRTABLE_PAT || !BASE_ID) {
    debugLog('ERROR: Missing required environment variables');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  try {
    // Parse the incoming request body
    const requestData = JSON.parse(event.body || '{}');
    const { idea } = requestData;

    // Validate the idea text
    if (!idea || typeof idea !== 'string' || idea.trim().length === 0) {
      debugLog('Validation failed: Missing or empty idea');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required field: idea' })
      };
    }

    const ideaText = idea.trim();
    debugLog('Creating plan', {
      ideaLength: ideaText.length,
      ideaPreview: ideaText.substring(0, 100) + (ideaText.length > 100 ? '...' : '')
    });

    // Prepare the record fields
    // Name: First 50 characters of the idea text (will be updated by AI enrichment)
    // Description: Full idea text (preserved for reference)
    const planName = ideaText.length > 50
      ? ideaText.substring(0, 50)
      : ideaText;

    const airtableFields = {
      'Name': planName,
      'Description': ideaText
    };

    debugLog('Creating Airtable record', {
      name: planName,
      descriptionLength: ideaText.length
    });

    // Create the record in Airtable
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROJECTS_TABLE)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: airtableFields })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      debugLog('Airtable error', { status: response.status, error: errorBody });
      throw new Error(`Airtable API request failed: ${response.status}`);
    }

    const result = await response.json();
    const newRecordId = result.id;

    debugLog('Plan created successfully', { planId: newRecordId });

    // Trigger background AI enrichment (fire-and-forget)
    // This will extract structured data (date, goals, name, items) and create initial Tasks
    triggerBackgroundEnrichment(newRecordId, ideaText);

    // Return success response with the new record ID
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        newPlanId: newRecordId
      })
    };

  } catch (error) {
    debugLog('Function failed', { error: error.message, stack: error.stack });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to create plan',
        details: error.message
      })
    };
  }
};
