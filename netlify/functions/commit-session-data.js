// netlify/functions/commit-session-data.js
// Human-in-the-Loop Email Parsing - Step 2: Commit human-approved data to Sessions table

const fetch = require('node-fetch');

/**
 * Helper function to format the Goals field content from summary and actionItems
 * @param {string|null} summary - The AI-generated summary
 * @param {string[]|null} actionItems - Array of action items from AI
 * @returns {string} Formatted goals content
 */
function formatGoalsField(summary, actionItems) {
  const parts = [];
  const timestamp = new Date().toISOString();

  parts.push(`[${timestamp}]`);

  if (summary) {
    parts.push(`Summary: ${summary}`);
  }

  if (actionItems && Array.isArray(actionItems) && actionItems.length > 0) {
    parts.push('Action Items:');
    actionItems.forEach((item, index) => {
      parts.push(`  ${index + 1}. ${item}`);
    });
  }

  return parts.join('\n');
}

exports.handler = async (event) => {
  console.log('--- commit-session-data Function Invoked ---');

  // Environment variables
  const { AIRTABLE_PAT, BASE_ID, ADMIN_COMMIT_KEY } = process.env;

  // Verify required env vars
  const missingVars = [];
  if (!AIRTABLE_PAT) missingVars.push('AIRTABLE_PAT');
  if (!BASE_ID) missingVars.push('BASE_ID');

  if (missingVars.length > 0) {
    console.error(`CRITICAL ERROR: Missing required environment variables: ${missingVars.join(', ')}`);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error.' })
    };
  }

  // Only accept POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Admin-level security: Validate admin key in request headers
  const adminKey = event.headers['x-admin-key'] || event.headers['X-Admin-Key'];
  if (ADMIN_COMMIT_KEY && adminKey !== ADMIN_COMMIT_KEY) {
    console.error('Invalid or missing admin key');
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Forbidden: Invalid admin key' })
    };
  }

  try {
    // Parse the request body
    console.log('Step 1: Parsing request body');
    const payload = JSON.parse(event.body);

    const {
      queueId,
      clientEmail,
      sessionName,
      status,
      value,
      summary,
      actionItems,
      rawEmailBody
    } = payload;

    console.log('Received payload:', {
      queueId,
      clientEmail,
      sessionName,
      status,
      value,
      hasRawEmailBody: !!rawEmailBody
    });

    // Validate required fields
    if (!queueId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required field: queueId' })
      };
    }

    if (!clientEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required field: clientEmail' })
      };
    }

    // Step 2: Look up existing session by client email
    console.log('Step 2: Searching for existing session in Airtable');
    const encodedFormula = encodeURIComponent(`{Client Email}='${clientEmail}'`);
    const findUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions?filterByFormula=${encodedFormula}`;

    const findResponse = await fetch(findUrl, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
    });

    if (!findResponse.ok) {
      const errorBody = await findResponse.text();
      throw new Error(`Airtable lookup failed: ${findResponse.status} - ${errorBody}`);
    }

    const existingSessions = await findResponse.json();
    console.log(`Step 2 SUCCESS. Found ${existingSessions.records?.length || 0} existing sessions`);

    // Step 3: Create or Update Session
    let sessionId;
    let airtableAction;

    // Prepare Goals field content
    const goalsContent = formatGoalsField(summary, actionItems);

    if (existingSessions.records && existingSessions.records.length > 0) {
      // Scenario A: Session Found - UPDATE (PATCH)
      sessionId = existingSessions.records[0].id;
      const existingRecord = existingSessions.records[0];
      airtableAction = 'updated';

      console.log(`Step 3: Updating existing session: ${sessionId}`);

      // Append new goals to existing goals
      const existingGoals = existingRecord.fields.Goals || '';
      const updatedGoals = existingGoals
        ? `${existingGoals}\n\n--- Email Update ---\n${goalsContent}`
        : goalsContent;

      const updateFields = { fields: {} };

      // Only update fields that have values
      if (status) {
        updateFields.fields['Status'] = status;
      }
      if (value !== null && value !== undefined) {
        updateFields.fields['Value'] = Number(value);
      }
      updateFields.fields['Goals'] = updatedGoals;

      const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions/${sessionId}`;
      const updateResponse = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateFields)
      });

      if (!updateResponse.ok) {
        const errorBody = await updateResponse.text();
        throw new Error(`Airtable update failed: ${updateResponse.status} - ${errorBody}`);
      }

      const updateResult = await updateResponse.json();
      console.log('Step 3 SUCCESS. Session updated:', updateResult.id);

    } else {
      // Scenario B: Session Not Found - CREATE (POST)
      airtableAction = 'created';
      console.log('Step 3: Creating new session');

      const createFields = {
        fields: {
          'Name': sessionName || `Event from ${clientEmail}`,
          'Client Email': clientEmail,
          'Goals': goalsContent
        }
      };

      // Only add fields that have values
      if (status) {
        createFields.fields['Status'] = status;
      }
      if (value !== null && value !== undefined) {
        createFields.fields['Value'] = Number(value);
      }

      const createUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions`;
      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(createFields)
      });

      if (!createResponse.ok) {
        const errorBody = await createResponse.text();
        throw new Error(`Airtable create failed: ${createResponse.status} - ${errorBody}`);
      }

      const createResult = await createResponse.json();
      sessionId = createResult.id;
      console.log('Step 3 SUCCESS. New session created:', sessionId);
    }

    // Step 4: Log the email to Messages table
    console.log('Step 4: Logging email to Messages table');

    if (rawEmailBody) {
      const messageFields = {
        fields: {
          'Session Link': [sessionId],
          'Body': rawEmailBody
        }
      };

      const messagesUrl = `https://api.airtable.com/v0/${BASE_ID}/Messages`;
      const messageResponse = await fetch(messagesUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(messageFields)
      });

      if (!messageResponse.ok) {
        const errorBody = await messageResponse.text();
        console.error(`Warning: Failed to log message: ${messageResponse.status} - ${errorBody}`);
        // Don't throw - this is not critical
      } else {
        const messageResult = await messageResponse.json();
        console.log('Step 4 SUCCESS. Message logged:', messageResult.id);
      }
    } else {
      console.log('Step 4 SKIPPED. No raw email body provided.');
    }

    // Step 5: Update ReviewQueue status to 'Committed'
    console.log('Step 5: Updating ReviewQueue status to Committed');

    const queuePatchUrl = `https://api.airtable.com/v0/${BASE_ID}/ReviewQueue/${queueId}`;
    const queuePatchResponse = await fetch(queuePatchUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          'Status': 'Committed'
        }
      })
    });

    if (!queuePatchResponse.ok) {
      const errorBody = await queuePatchResponse.text();
      console.error(`Warning: Failed to update ReviewQueue status: ${queuePatchResponse.status} - ${errorBody}`);
      // Don't throw - the main operation succeeded
    } else {
      console.log('Step 5 SUCCESS. ReviewQueue status updated to Committed');
    }

    console.log('--- commit-session-data Function Complete ---');
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        sessionId,
        action: airtableAction,
        message: `Session ${airtableAction} successfully`
      })
    };

  } catch (error) {
    console.error('--- FUNCTION FAILED ---');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to commit session data',
        details: error.message
      })
    };
  }
};
