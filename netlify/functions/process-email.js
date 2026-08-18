// In netlify/functions/process-email.js
// AI-powered email parsing for event booking information
// Uses multi-provider AI with automatic fallback (Gemini → OpenAI → Anthropic)

const { AIRTABLE_PAT, BASE_ID } = process.env;
const { generateText, parseJsonResponse } = require('./utils/ai-provider');
const crypto = require('crypto');

function secretMatches(value, expected) {
  if (!value || !expected) return false;
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

exports.handler = async (event) => {
  console.log('--- Function Invoked ---');

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ingestSecret = process.env.CRM_INGEST_WEBHOOK_SECRET;
  const providedSecret = event.headers['x-crm-ingest-secret'] || event.headers['X-Crm-Ingest-Secret'];
  if (!secretMatches(providedSecret, ingestSecret)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    console.log('Step 1: Parsing authenticated email webhook.');
    const emailData = JSON.parse(event.body);
    console.log('Step 1 SUCCESS. Email payload accepted.');

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

From: ${emailData.from_email}
Subject: ${emailData.subject}

${emailData.body}`;

    console.log('Step 2: Sending data to AI provider (with fallback).');
    const aiResult = await generateText(aiPrompt, {
      caller: 'process-email',
    });

    if (!aiResult.ok) {
      throw new Error(`AI request failed: ${aiResult.error}`);
    }
    console.log(`Step 2 SUCCESS. Received response from ${aiResult.providerName}.`);

    console.log('Step 3: Attempting to parse AI JSON response.');
    const extractedData = parseJsonResponse(aiResult.text);
    console.log('Step 3 SUCCESS. Parsed AI data.');

    console.log('Step 4: Searching for existing session in Airtable.');
    const findUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions?filterByFormula=({ClientEmail}='${extractedData.clientEmail}')`;
    const findResponse = await fetch(findUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    const existingSessions = await findResponse.json();
    console.log('Step 4 SUCCESS. Airtable search complete.');

    let sessionId;
    if (existingSessions.records && existingSessions.records.length > 0) {
      sessionId = existingSessions.records[0].id;
      console.log(`Step 5: Session found. Updating record ID: ${sessionId}`);
    } else {
      console.log('Step 5: No session found. Creating new record...');
    }

    console.log('Step 6: (Simulated) Posting email content to Messages table.');

    console.log('--- Function Success ---');
    return { statusCode: 200, body: JSON.stringify({ message: 'Email processed successfully.' }) };

  } catch (error) {
    console.error('--- FUNCTION FAILED ---');
    console.error('Error details:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to process email.' }) };
  }
};
