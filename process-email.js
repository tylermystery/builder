// In netlify/functions/process-email.js
const fetch = require('node-fetch');

// Securely get your secrets from Netlify environment variables
const { AIRTABLE_PAT, BASE_ID, OPENAI_API_KEY } = process.env;

// The main handler for the serverless function
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const emailData = JSON.parse(event.body);

    // 1. SEND EMAIL TO AI FOR PARSING
    const aiPrompt = `
      You are an expert sales assistant for Tyler's Mystery Tours. Your task is to read an email thread and extract key information about a potential or ongoing event booking. Analyze the entire text and respond ONLY with a valid JSON object.

      The JSON object must have the following fields:
      - "sessionName": The name of the event. If not mentioned, create a name like "Event for [Company Name]". If no company name, use "Event from [Client's Email]".
      - "clientEmail": The email address of the primary client.
      - "status": Determine the current stage. Use one of these values: "Lead", "Planning", "Reserved", "Lost".
      - "value": Extract the total monetary value or budget of the event if mentioned. Should be a number, not a string.
      - "summary": A one-sentence summary of the email's key point.
      - "actionItems": An array of strings listing any next steps for the TMT team.

      If any information is not present, use a value of null for that field.
    `;

    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: aiPrompt },
          { role: 'user', content: `From: ${emailData.from_email}\nSubject: ${emailData.subject}\n\n${emailData.body}` }
        ],
        response_format: { "type": "json_object" }
      })
    });

    if (!openAIResponse.ok) {
      throw new Error('OpenAI API request failed');
    }

    const aiResult = await openAIResponse.json();
    const extractedData = JSON.parse(aiResult.choices[0].message.content);

    // 2. FIND OR CREATE A SESSION IN AIRTABLE
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
              ClientEmail: extractedData.clientEmail, // Make sure you have this field in Airtable
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

    // 3. POST THE EMAIL CONTENT TO THE MESSAGES TABLE
    const messageUrl = `https://api.airtable.com/v0/${BASE_ID}/Messages`;
    const fullEmailContent = `--- EMAIL FROM ${emailData.from_email} ---\nSubject: ${emailData.subject}\n\n${emailData.body}`;
    await fetch(messageUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{
          fields: {
            SessionID: [sessionId], // Link to the session we found/created
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
