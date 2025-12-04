// netlify/functions/parse-review-queue.js
// Human-in-the-Loop Email Parsing - Step 1: Receive SendGrid webhook, queue for review

const fetch = require('node-fetch');
const Busboy = require('busboy');

/**
 * Parse multipart form data from SendGrid Inbound Parse webhook
 * @param {object} event - Netlify function event
 * @returns {Promise<object>} - Parsed form fields
 */
function parseMultipartForm(event) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];

    if (!contentType || !contentType.includes('multipart/form-data')) {
      // Handle JSON payload (for testing)
      try {
        const jsonData = JSON.parse(event.body);
        resolve(jsonData);
        return;
      } catch (e) {
        reject(new Error('Invalid content type. Expected multipart/form-data or JSON.'));
        return;
      }
    }

    const busboy = Busboy({ headers: { 'content-type': contentType } });

    busboy.on('field', (fieldname, val) => {
      fields[fieldname] = val;
    });

    busboy.on('finish', () => {
      resolve(fields);
    });

    busboy.on('error', (err) => {
      reject(err);
    });

    // Handle base64 encoded body
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body);

    busboy.end(body);
  });
}

/**
 * Strip markdown code blocks and extract clean JSON
 * @param {string} text - Raw AI response text
 * @returns {string} - Cleaned JSON string
 */
function cleanJsonResponse(text) {
  let cleaned = text.trim();

  // Remove markdown code blocks
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }

  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }

  return cleaned.trim();
}

exports.handler = async (event) => {
  console.log('--- parse-review-queue Function Invoked ---');

  // Environment variables
  const { AIRTABLE_PAT, BASE_ID, GEMINI_API_KEY, SENDGRID_WEBHOOK_KEY } = process.env;

  // Verify required env vars
  const missingVars = [];
  if (!AIRTABLE_PAT) missingVars.push('AIRTABLE_PAT');
  if (!BASE_ID) missingVars.push('BASE_ID');
  if (!GEMINI_API_KEY) missingVars.push('GEMINI_API_KEY');

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

  // Webhook security: validate secret key in query string
  const webhookKey = event.queryStringParameters?.key;
  if (SENDGRID_WEBHOOK_KEY && webhookKey !== SENDGRID_WEBHOOK_KEY) {
    console.error('Invalid or missing webhook key');
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Forbidden: Invalid webhook key' })
    };
  }

  let queueRecordId = null;

  try {
    // Step 1: Parse the incoming SendGrid webhook (multipart/form-data)
    console.log('Step 1: Parsing incoming SendGrid webhook data');
    const formData = await parseMultipartForm(event);
    console.log('Step 1 SUCCESS. Form fields received:', Object.keys(formData));

    // Extract email data from SendGrid fields
    const senderEmail = formData.from || formData.sender || '';
    const rawBody = formData.text || formData.html || formData.body || '';
    const subject = formData.subject || '';

    console.log(`Sender Email: ${senderEmail}`);
    console.log(`Subject: ${subject}`);
    console.log(`Raw Body Length: ${rawBody.length} characters`);

    if (!senderEmail && !rawBody) {
      console.error('No sender email or body content in webhook');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing email data in webhook' })
      };
    }

    // Step 2: Create initial record in ReviewQueue with 'Pending Review' status
    console.log('Step 2: Creating initial ReviewQueue record in Airtable');

    const createPayload = {
      fields: {
        'Sender Email': senderEmail,
        'Raw Body': rawBody,
        'Status': 'Pending Review'
      }
    };

    const createUrl = `https://api.airtable.com/v0/${BASE_ID}/ReviewQueue`;
    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(createPayload)
    });

    if (!createResponse.ok) {
      const errorBody = await createResponse.text();
      throw new Error(`Failed to create ReviewQueue record: ${createResponse.status} - ${errorBody}`);
    }

    const createResult = await createResponse.json();
    queueRecordId = createResult.id;
    console.log(`Step 2 SUCCESS. ReviewQueue record created: ${queueRecordId}`);

    // Step 3: Return 200 immediately to SendGrid to prevent retries
    // Continue AI processing asynchronously by not awaiting it in the response path
    // Note: In Netlify Functions, we need to complete AI processing before returning
    // as there's no true background processing. We'll handle this with a timeout.

    // Step 4: Call Gemini AI to parse the email content
    console.log('Step 3: Sending email to Gemini AI for parsing');

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

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: aiPrompt },
              { text: `From: ${senderEmail}\nSubject: ${subject}\n\n${rawBody}` }
            ]
          }]
        })
      }
    );

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      console.error(`Gemini API error: ${geminiResponse.status} - ${errorBody}`);
      // Don't throw - still return success to SendGrid, just note the AI failure
      console.log('AI parsing failed, but record was created successfully');
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          queueRecordId,
          aiStatus: 'failed',
          message: 'Email queued for review (AI parsing failed)'
        })
      };
    }

    const geminiResult = await geminiResponse.json();
    console.log('Step 3 SUCCESS. Received Gemini response');

    // Step 5: Parse and clean the AI response
    console.log('Step 4: Parsing Gemini AI response');
    const geminiTextResponse = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!geminiTextResponse) {
      console.error('No text content in Gemini response');
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          queueRecordId,
          aiStatus: 'no_content',
          message: 'Email queued for review (AI returned no content)'
        })
      };
    }

    const cleanedJson = cleanJsonResponse(geminiTextResponse);
    let parsedData;

    try {
      parsedData = JSON.parse(cleanedJson);
      console.log('Step 4 SUCCESS. Parsed AI data:', JSON.stringify(parsedData, null, 2));
    } catch (parseError) {
      console.error('Failed to parse Gemini JSON response:', parseError.message);
      console.error('Raw Gemini response:', geminiTextResponse);
      // Store the raw response as fallback
      parsedData = {
        _rawResponse: geminiTextResponse,
        _parseError: parseError.message
      };
    }

    // Step 6: Update the ReviewQueue record with AI Parsed Data
    console.log('Step 5: Updating ReviewQueue record with AI parsed data');

    const patchPayload = {
      fields: {
        'AI Parsed Data (JSON)': JSON.stringify(parsedData, null, 2)
      }
    };

    const patchUrl = `https://api.airtable.com/v0/${BASE_ID}/ReviewQueue/${queueRecordId}`;
    const patchResponse = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(patchPayload)
    });

    if (!patchResponse.ok) {
      const errorBody = await patchResponse.text();
      console.error(`Failed to update ReviewQueue record: ${patchResponse.status} - ${errorBody}`);
      // Still return success - the record was created, just AI data wasn't saved
    } else {
      console.log('Step 5 SUCCESS. ReviewQueue record updated with AI data');
    }

    console.log('--- parse-review-queue Function Complete ---');
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        queueRecordId,
        aiStatus: 'success',
        message: 'Email queued for review with AI analysis'
      })
    };

  } catch (error) {
    console.error('--- FUNCTION FAILED ---');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);

    // If we created a record but failed later, note it
    if (queueRecordId) {
      console.log(`Note: ReviewQueue record was created: ${queueRecordId}`);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to process email webhook',
        details: error.message,
        queueRecordId: queueRecordId || null
      })
    };
  }
};
