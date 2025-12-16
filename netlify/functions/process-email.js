// In netlify/functions/process-email.js

// Version 2.0 - Full implementation with robust error handling
const fetch = require('node-fetch');

exports.handler = async (event) => {
  console.log('--- Function Invoked ---');

  // Variables to store raw data for enhanced error logging
  let rawRequestBody = null;
  let rawGeminiResponse = null;

  // Step 1: Resolve Deployment and Initialization Blockers
  // Verify Environment Variables
  const { AIRTABLE_PAT, BASE_ID, GEMINI_API_KEY } = process.env;

  const missingVars = [];
  if (!AIRTABLE_PAT) missingVars.push('AIRTABLE_PAT');
  if (!BASE_ID) missingVars.push('BASE_ID');
  if (!GEMINI_API_KEY) missingVars.push('GEMINI_API_KEY');

  if (missingVars.length > 0) {
    console.error(`CRITICAL ERROR: Missing required environment variables: ${missingVars.join(', ')}`);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error. Missing required environment variables.' })
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Store raw request body for error logging
    rawRequestBody = event.body;

    console.log('Step 1: Parsing incoming request body from Zapier.');
    const emailData = JSON.parse(event.body);
    console.log('Step 1 SUCCESS. Parsed email data:', JSON.stringify(emailData, null, 2));

    const aiPrompt = `
      You are an expert sales assistant for Tyler's Mystery Tours. Your task is to read an email thread and extract key information about a potential or ongoing event booking. Analyze the entire text and respond ONLY with a valid JSON object. Do not include the markdown specifier \`\`\`json or any text before or after the JSON object.
      The JSON object must have the following fields:
      - "sessionName": The name of the event. If not mentioned, create a name like "Event for [Company Name]". If no company name, use "Event from [Client's Email]".
      - "clientEmail": The email address of the primary client.
      - "status": Determine the current stage. Use one of these values: "Lead", "Planning", "Reserved", "Lost".
      - "value": Extract the total monetary value or budget of the event if mentioned. Should be a number, not a string.
      - "summary": A one-sentence summary of the email's key point.
      - "actionItems": An array of strings listing any next steps for the TMT team.
      If any information is not present, use a value of null for that field.
    `;

    console.log('Step 2: Sending data to Gemini API.');
    console.log('[Debug] ENV CHECK - GEMINI_API_KEY present:', !!GEMINI_API_KEY);
    console.log('[Debug] ENV CHECK - GEMINI_API_KEY length:', GEMINI_API_KEY ? GEMINI_API_KEY.length : 0);

    // IMPORTANT: Use current Gemini model (gemini-pro was deprecated and returns 404)
    const GEMINI_MODEL = 'gemini-1.5-flash';
    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    console.log('[Debug] Using Gemini model:', GEMINI_MODEL);
    console.log('[Debug] API URL (without key):', `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);

    const geminiPayload = {
      contents: [{ parts: [{ text: aiPrompt }, { text: `From: ${emailData.from_email}\nSubject: ${emailData.subject}\n\n${emailData.body}` }] }]
    };
    console.log('[Debug] Payload size:', JSON.stringify(geminiPayload).length, 'bytes');

    console.log('[Debug] Sending request to Gemini API...');
    const startTime = Date.now();
    const geminiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });
    const elapsed = Date.now() - startTime;
    console.log(`[Debug] Gemini response received in ${elapsed}ms`);
    console.log('[Debug] Gemini response status:', geminiResponse.status, geminiResponse.statusText);
    console.log('Step 2 SUCCESS. Received response from Gemini.');

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      throw new Error(`Gemini API request failed with status ${geminiResponse.status}: ${errorBody}`);
    }

    const geminiResult = await geminiResponse.json();

    console.log('Step 3: Attempting to parse Gemini JSON response.');
    const geminiTextResponse = geminiResult.candidates[0].content.parts[0].text;

    // Store raw Gemini response for error logging
    rawGeminiResponse = geminiTextResponse;

    // JSON Parsing Hardening: Strip markdown code blocks if present
    let cleanedJsonString = geminiTextResponse.trim();

    // Remove ```json at the start and ``` at the end
    if (cleanedJsonString.startsWith('```json')) {
      cleanedJsonString = cleanedJsonString.slice(7);
    } else if (cleanedJsonString.startsWith('```')) {
      cleanedJsonString = cleanedJsonString.slice(3);
    }

    if (cleanedJsonString.endsWith('```')) {
      cleanedJsonString = cleanedJsonString.slice(0, -3);
    }

    cleanedJsonString = cleanedJsonString.trim();

    const extractedData = JSON.parse(cleanedJsonString);
    console.log('Step 3 SUCCESS. Parsed Gemini data:', JSON.stringify(extractedData, null, 2));

    // Step 2: Implement Robust Client Lookup Logic
    // Extract clientEmail from AI response
    const clientEmail = extractedData.clientEmail;

    if (!clientEmail) {
      console.warn('Warning: No client email extracted from AI response. Using from_email from original payload.');
    }

    const lookupEmail = clientEmail || emailData.from_email;

    console.log('Step 4: Searching for existing session in Airtable.');
    // Properly encode the email for URL and formula
    const encodedFormula = encodeURIComponent(`{Client Email}='${lookupEmail}'`);
    const findUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions?filterByFormula=${encodedFormula}`;

    const findResponse = await fetch(findUrl, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
    });

    if (!findResponse.ok) {
      const errorBody = await findResponse.text();
      throw new Error(`Airtable lookup failed with status ${findResponse.status}: ${errorBody}`);
    }

    const existingSessions = await findResponse.json();
    console.log('Step 4 SUCCESS. Airtable search complete. Found records:', existingSessions.records?.length || 0);

    // Step 3: Complete Create/Update Logic
    let sessionId;
    let airtableAction;

    // Prepare Goals field content from summary and actionItems
    const goalsContent = formatGoalsField(extractedData.summary, extractedData.actionItems);

    if (existingSessions.records && existingSessions.records.length > 0) {
      // Scenario A: Session Found (UPDATE/PATCH)
      sessionId = existingSessions.records[0].id;
      const existingRecord = existingSessions.records[0];
      airtableAction = 'updated';

      console.log(`Step 5: Session found. Updating record ID: ${sessionId}`);

      // Append new goals to existing goals
      const existingGoals = existingRecord.fields.Goals || '';
      const updatedGoals = existingGoals
        ? `${existingGoals}\n\n--- Update ---\n${goalsContent}`
        : goalsContent;

      const updateFields = {
        fields: {}
      };

      // Only update fields that have values from AI
      if (extractedData.status) {
        updateFields.fields['Status'] = extractedData.status;
      }
      if (extractedData.value !== null && extractedData.value !== undefined) {
        updateFields.fields['Value'] = extractedData.value;
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
        throw new Error(`Airtable update failed with status ${updateResponse.status}: ${errorBody}`);
      }

      const updateResult = await updateResponse.json();
      console.log('Step 5 SUCCESS. Session updated:', updateResult.id);

    } else {
      // Scenario B: Session Not Found (CREATE/POST)
      airtableAction = 'created';
      console.log('Step 5: No session found. Creating new record...');

      const createFields = {
        fields: {
          'Name': extractedData.sessionName || `Event from ${lookupEmail}`,
          'Client Email': lookupEmail,
          'Goals': goalsContent
        }
      };

      // Only add fields that have values from AI
      if (extractedData.status) {
        createFields.fields['Status'] = extractedData.status;
      }
      if (extractedData.value !== null && extractedData.value !== undefined) {
        createFields.fields['Value'] = extractedData.value;
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
        throw new Error(`Airtable create failed with status ${createResponse.status}: ${errorBody}`);
      }

      const createResult = await createResponse.json();
      sessionId = createResult.id;
      console.log('Step 5 SUCCESS. New session created:', sessionId);
    }

    // Step 4: Finalize Logging - Post to Messages table for auditability
    console.log('Step 6: Posting email content to Messages table for audit.');

    const messageFields = {
      fields: {
        'Session Link': [sessionId], // Link to the session record
        'Body': rawRequestBody // Full raw email content
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
      // Log the error but don't fail the entire operation
      const errorBody = await messageResponse.text();
      console.error(`Warning: Failed to log message to Messages table: ${messageResponse.status}: ${errorBody}`);
    } else {
      const messageResult = await messageResponse.json();
      console.log('Step 6 SUCCESS. Message logged:', messageResult.id);
    }

    console.log('--- Function Success ---');
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Email processed successfully.',
        sessionId: sessionId,
        action: airtableAction,
        extractedData: {
          sessionName: extractedData.sessionName,
          clientEmail: lookupEmail,
          status: extractedData.status,
          value: extractedData.value
        }
      })
    };

  } catch (error) {
    // Enhanced Error Handling
    console.error('--- FUNCTION FAILED ---');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);

    // Log raw payloads for debugging
    if (rawRequestBody) {
      console.error('Raw request body (incoming email payload):', rawRequestBody);
    }
    if (rawGeminiResponse) {
      console.error('Raw Gemini API response (before JSON parsing):', rawGeminiResponse);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process email.' })
    };
  }
};

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
