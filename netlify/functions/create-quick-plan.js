// FILE: netlify/functions/create-quick-plan.js
// PURPOSE: Creates a new Plan (Projects record) from a single text input
// Used by the /start-a-plan.html quick entry page

const fetch = require('node-fetch');

// Environment variables for Airtable access
const { AIRTABLE_PAT, BASE_ID } = process.env;

// Target the existing Sessions table (also referred to as "Projects" in the UI)
const SESSIONS_TABLE = 'Sessions';

// Debug logging prefix for this module
const DEBUG_PREFIX = '[QUICK-PLAN-CREATE]';

/**
 * Debug logger for plan creation - focused logging for this feature
 * @param {string} action - The action being performed
 * @param {any} data - Data to log (optional)
 */
function debugLog(action, data = null) {
  const timestamp = new Date().toISOString();
  const logData = data !== null ? `: ${JSON.stringify(data)}` : '';
  console.log(`${DEBUG_PREFIX} ${action}${logData}`);
}

/**
 * Posts a plan event to the Messages table for history tracking
 * Fire-and-forget - we don't await the result
 * @param {string} sessionId - The session/plan ID
 * @param {string} eventType - The type of event
 * @param {object} eventData - Additional data about the event
 */
function postPlanEvent(sessionId, eventType, eventData) {
  const eventUrl = process.env.URL
    ? `${process.env.URL}/.netlify/functions/post-plan-event`
    : '/.netlify/functions/post-plan-event';

  debugLog('Posting plan event', { sessionId, eventType, eventUrl, eventDataKeys: Object.keys(eventData || {}) });

  fetch(eventUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, eventType, eventData })
  })
    .then(async response => {
      if (response.ok) {
        const result = await response.json();
        debugLog('Plan event posted successfully', { sessionId, eventType, recordId: result.recordId });
      } else {
        const errorText = await response.text();
        debugLog('Plan event posting returned non-OK status', { sessionId, eventType, status: response.status, error: errorText });
      }
    })
    .catch(error => {
      debugLog('Plan event posting failed (non-critical)', { sessionId, eventType, error: error.message });
    });
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

  debugLog('Triggering background AI enrichment', { projectId, enrichmentUrl, ideaLength: ideaText.length });

  const requestBody = JSON.stringify({
    projectId: projectId,
    ideaText: ideaText
  });

  debugLog('Enrichment request payload', { projectId, ideaTextPreview: ideaText.substring(0, 100) });

  // Fire and forget - don't await
  fetch(enrichmentUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody
  })
    .then(async response => {
      if (response.ok) {
        const result = await response.json();
        debugLog('Background enrichment triggered successfully', {
          projectId,
          responseSuccess: result.success,
          enriched: result.enriched,
          planName: result.planName,
          planType: result.planType,
          tasksCreated: result.tasksCreated
        });
      } else {
        const errorText = await response.text();
        debugLog('Background enrichment returned non-OK status', { projectId, status: response.status, error: errorText });
      }
    })
    .catch(error => {
      // Log but don't fail - enrichment is optional
      debugLog('Background enrichment failed (non-critical)', { projectId, error: error.message, stack: error.stack });
    });
}

exports.handler = async (event) => {
  console.log(`${DEBUG_PREFIX} ========== FUNCTION START ==========`);
  debugLog('Handler invoked', { httpMethod: event.httpMethod, hasBody: !!event.body });

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    debugLog('Rejected: not a POST request', { method: event.httpMethod });
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  // Validate environment variables
  if (!AIRTABLE_PAT || !BASE_ID) {
    console.error(`${DEBUG_PREFIX} ERROR: Missing AIRTABLE_PAT or BASE_ID`);
    debugLog('Config error', { hasAirtablePat: !!AIRTABLE_PAT, hasBaseId: !!BASE_ID });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  debugLog('Environment validated', { hasAirtablePat: true, hasBaseId: true });

  try {
    // Parse the incoming request body
    const requestData = JSON.parse(event.body || '{}');
    const { idea } = requestData;

    debugLog('Request body parsed', { hasIdea: !!idea, ideaType: typeof idea });

    // Validate the idea text
    if (!idea || typeof idea !== 'string' || idea.trim().length === 0) {
      console.error(`${DEBUG_PREFIX} Validation failed: Missing or empty idea`);
      debugLog('Validation failed', { idea: idea, type: typeof idea });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required field: idea' })
      };
    }

    const ideaText = idea.trim();
    console.log(`${DEBUG_PREFIX} Idea received: "${ideaText.substring(0, 50)}..." (${ideaText.length} chars)`);
    debugLog('Idea validated', { length: ideaText.length, preview: ideaText.substring(0, 100) });

    // Prepare the record fields
    const planName = ideaText.length > 50 ? ideaText.substring(0, 50) : ideaText;

    const airtableFields = {
      'Name': planName,
      'Goals': ideaText
    };

    console.log(`${DEBUG_PREFIX} Creating Airtable record with Name="${planName}"`);
    debugLog('Airtable fields prepared', { fields: airtableFields });

    // Create the record in Airtable
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SESSIONS_TABLE)}`;
    debugLog('Airtable API call', { url: url.replace(BASE_ID, 'BASE_ID'), table: SESSIONS_TABLE });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: airtableFields })
    });

    debugLog('Airtable response received', { status: response.status, ok: response.ok });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`${DEBUG_PREFIX} Airtable error: ${response.status}`, errorBody);
      debugLog('Airtable error', { status: response.status, error: errorBody });
      throw new Error(`Airtable API request failed: ${response.status}`);
    }

    const result = await response.json();
    const newRecordId = result.id;

    console.log(`${DEBUG_PREFIX} ✅ Plan created: ${newRecordId}`);
    debugLog('Plan record created in Airtable', { recordId: newRecordId, createdTime: result.createdTime });

    // Post the plan_created event to show in chat history
    console.log(`${DEBUG_PREFIX} Posting plan_created event for ${newRecordId}...`);
    debugLog('Posting plan_created event', { recordId: newRecordId });
    postPlanEvent(newRecordId, 'plan_created', {
      originalInput: ideaText,
      initialName: planName
    });

    // Trigger background AI enrichment (fire-and-forget)
    console.log(`${DEBUG_PREFIX} Triggering background AI enrichment for ${newRecordId}...`);
    debugLog('Triggering AI enrichment (fire-and-forget)', { recordId: newRecordId, ideaLength: ideaText.length });
    triggerBackgroundEnrichment(newRecordId, ideaText);

    console.log(`${DEBUG_PREFIX} ========== FUNCTION END (success) ==========`);
    debugLog('Function completed successfully', { newPlanId: newRecordId });

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
    console.error(`${DEBUG_PREFIX} FUNCTION FAILED:`, error.message);
    debugLog('Function error', { error: error.message, stack: error.stack });
    console.log(`${DEBUG_PREFIX} ========== FUNCTION END (error) ==========`);

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
