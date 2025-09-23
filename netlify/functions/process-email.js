// In netlify/functions/process-email.js
const fetch = require('node-fetch');

// --- MODIFIED: Uses GEMINI_API_KEY now ---
const { AIRTABLE_PAT, BASE_ID, GEMINI_API_KEY } = process.env;

// The main handler for the serverless function
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const emailData = JSON.parse(event.body);

    // 1. SEND EMAIL TO GEMINI AI FOR PARSING
    // --- MODIFIED: Prompt is more explicit for Gemini to ensure JSON output ---
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

    // --- MODIFIED: This is the new fetch request for Google Gemini API ---
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: aiPrompt },
            { text: `From: ${emailData.from_email}\nSubject: ${emailData.subject}\n\n${emailData.body}` }
          ]
        }]
      })
    });

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      throw new Error(`Gemini API request failed: ${errorBody}`);
    }

    const geminiResult = await geminiResponse.json();
    // --- MODIFIED: How we get the text and parse it is different for Gemini ---
    const extractedData = JSON.parse(geminiResult.candidates[0].content.parts[0].text);

    // 2. FIND OR CREATE A SESSION IN AIRTABLE (This logic remains the same)
    const findUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions?filterByFormula=({ClientEmail}='${extractedData.clientEmail}')`;
    const findResponse = await fetch(findUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    const existingSessions = await findResponse.json();

    let sessionId;
    if (existingSessions.records && existingSessions.records.length > 0) {
      // Session exists, update it
      sessionId = existingSessions.records[0].id;
      const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions/${sessionId}`;
      await fetch(updateUrl, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { Name: extractedData.sessionName, Value: extractedData.value, Stage: extractedData.status } })
      });
    } else {
      // Session does not exist, create it
      const createUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions`;
      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: [{
            fields: {
              Name: extractedData.sessionName,
              ClientEmail: extractedData.clientEmail,
              Value: extractedData.value,
              Stage: extractedData.status,
              Goals: extractedData.summary
            }
          }]
        })
      });
      const newSessionData = await createResponse.json();
      sessionId = newSessionData.records[0].id;
    }

    // 3. POST THE EMAIL CONTENT TO THE MESSAGES TABLE (This logic remains the same)
    const messageUrl = `https://api.airtable.com/v0/${BASE_ID}/Messages`;
    const fullEmailContent = `--- EMAIL FROM ${emailData.from_email} ---\nSubject: ${emailData.subject}\n\n${emailData.body}`;
    await fetch(messageUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{
          fields: {
            SessionID: [sessionId],
            SenderName: emailData.from_email,
            Content: fullEmailContent
          }
        }]
      })
    });

    return { statusCode: 200, body: JSON.stringify({ message: 'Email processed successfully.' }) };

  } catch (error) {
    console.error('Error processing email:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to process email.' }) };
  }
};
