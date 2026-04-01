// FILE: netlify/functions/get-project.js
// PURPOSE: Fetches a single project record by ID for debugging/polling enrichment status

const fetch = require('node-fetch');

const { AIRTABLE_PAT, BASE_ID } = process.env;
const SESSIONS_TABLE = 'Sessions';  // Also referred to as "Projects" in the UI

// Debug logging prefix for this module
const DEBUG_PREFIX = '[get-project]';

/**
 * Debug logger for project fetching
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

exports.handler = async (event) => {
  debugLog('Function invoked', { method: event.httpMethod });

  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
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
    // Get project ID from query parameters
    const projectId = event.queryStringParameters?.id;

    if (!projectId) {
      debugLog('Validation failed: Missing project ID');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required parameter: id' })
      };
    }

    // Validate the project ID format (Airtable record IDs start with 'rec')
    if (!projectId.startsWith('rec')) {
      debugLog('Validation failed: Invalid project ID format', { projectId });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid project ID format' })
      };
    }

    debugLog('Fetching project', { projectId });

    // Fetch the project from Airtable
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SESSIONS_TABLE)}/${projectId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      debugLog('Airtable error', { status: response.status, error: errorBody });

      if (response.status === 404) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Project not found' })
        };
      }

      throw new Error(`Airtable API request failed: ${response.status}`);
    }

    const result = await response.json();

    debugLog('Project fetched successfully', {
      projectId,
      hasName: !!result.fields?.Name,
      hasGoals: !!result.fields?.Goals,
      hasDate: !!result.fields?.Date,
      hasPlanType: !!result.fields?.Plan_Type
    });

    // Return only the fields (not the full Airtable wrapper)
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache' // Don't cache - we're polling for updates
      },
      body: JSON.stringify({
        id: result.id,
        ...result.fields
      })
    };

  } catch (error) {
    debugLog('Function failed', { error: error.message, stack: error.stack });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to fetch project',
        details: error.message
      })
    };
  }
};
