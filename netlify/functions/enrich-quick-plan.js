// FILE: netlify/functions/enrich-quick-plan.js
// PURPOSE: AI enrichment for quick plans - parses user input to extract plan fields,
// suggests Plan_Type, and creates initial Tasks
// This function is called asynchronously after a quick plan is created

const fetch = require('node-fetch');

const { AIRTABLE_PAT, BASE_ID, GEMINI_API_KEY } = process.env;

// Table names
const SESSIONS_TABLE = 'Sessions';  // Also referred to as "Projects" in the UI
const TASKS_TABLE = 'Tasks';

// Debug logging prefix for this module
const DEBUG_PREFIX = '[QUICK-PLAN-ENRICH]';

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

  console.log(`${DEBUG_PREFIX} Posting ${eventType} event for ${sessionId}...`);

  fetch(eventUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, eventType, eventData })
  })
    .then(response => {
      if (response.ok) {
        console.log(`${DEBUG_PREFIX} ✅ ${eventType} event posted successfully`);
      } else {
        console.error(`${DEBUG_PREFIX} ⚠️ ${eventType} event posting returned ${response.status}`);
      }
    })
    .catch(error => {
      console.error(`${DEBUG_PREFIX} ⚠️ ${eventType} event posting failed: ${error.message}`);
    });
}

/**
 * Debug logger for plan parsing - only logs parsing-related information
 * @param {string} action - The action being performed
 * @param {any} data - Data to log (optional)
 */
function debugLog(action, data = null) {
  const logData = data !== null ? `: ${JSON.stringify(data)}` : '';
  console.log(`${DEBUG_PREFIX} ${action}${logData}`);
}

/**
 * Cleans and parses JSON from Gemini response (handles markdown code blocks)
 * @param {string} text - Raw text from Gemini
 * @returns {object} Parsed JSON object
 */
function cleanAndParseGeminiJson(text) {
  let cleanedText = text.trim();

  // Remove markdown code blocks if present
  if (cleanedText.startsWith('```json')) {
    cleanedText = cleanedText.slice(7);
  } else if (cleanedText.startsWith('```')) {
    cleanedText = cleanedText.slice(3);
  }

  if (cleanedText.endsWith('```')) {
    cleanedText = cleanedText.slice(0, -3);
  }

  cleanedText = cleanedText.trim();

  // Find JSON object in text
  const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No valid JSON object found in AI response');
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Calls Gemini AI to analyze the plan idea and extract structured data
 * @param {string} ideaText - The user's plan idea text
 * @returns {Promise<object>} AI analysis with extracted fields and next_steps
 */
async function analyzeWithGemini(ideaText) {
  console.log(`${DEBUG_PREFIX} Starting AI analysis (${ideaText.length} chars)`);

  if (!GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY environment variable');
  }

  const systemPrompt = `
You are an expert event and project planner assistant. Your task is to analyze a user's plan idea and extract structured information.

## USER'S PLAN INPUT
"${ideaText}"

## YOUR TASK
Parse the input and extract:
1. **plan_name**: A clear, concise title for the plan (if mentioned or can be inferred)
2. **plan_type**: What type of plan this is
3. **event_date**: Any date mentioned (in YYYY-MM-DD format if possible, or natural language if specific date not given)
4. **goals**: Any goals, objectives, themes, or desired outcomes mentioned
5. **guest_count**: Estimated number of guests/attendees if mentioned
6. **location**: Any location or venue mentioned
7. **items_components**: List of specific items, services, activities, or components mentioned
8. **next_steps**: 1-3 actionable tasks to get started

## OUTPUT FORMAT
Respond ONLY with a valid JSON object. Do not include markdown code blocks or any text before/after the JSON.

{
  "plan_name": "Clear title for the plan (null if not determinable)",
  "plan_type": "Project|Event|Task List|Other",
  "event_date": "YYYY-MM-DD or descriptive string (null if not mentioned)",
  "goals": "Extracted goals, themes, or objectives (null if not mentioned)",
  "guest_count": number or null,
  "location": "Location or venue name (null if not mentioned)",
  "items_components": [
    {
      "name": "Item or component name",
      "category": "Food & Drink|Entertainment|Venue|Decor|Activity|Service|Equipment|Other",
      "notes": "Any additional details mentioned"
    }
  ],
  "next_steps": [
    {
      "name": "Clear, actionable task name (max 50 chars)",
      "description": "Detailed description of what needs to be done"
    }
  ],
  "reasoning": "Brief explanation of the analysis"
}

## EXTRACTION GUIDELINES

### Plan Name
- Look for explicit mentions: "planning a...", "organizing...", "for my...", "my...party/event/project"
- If not explicit, infer from context (e.g., "birthday party for mom" -> "Mom's Birthday Party")

### Event Date
- Look for specific dates: "March 15", "3/15/2025", "next Saturday"
- Look for relative dates: "in 2 weeks", "this weekend"
- Look for months/seasons: "sometime in June", "this summer"
- Return null if no date reference found

### Goals
- Look for desired outcomes: "want to...", "hoping to...", "should be..."
- Look for themes: "casual", "elegant", "fun", "memorable"
- Look for constraints: "on a budget", "small and intimate"

### Items/Components
- Extract any specific items mentioned: "DJ", "catering", "bounce house", "photographer"
- Categorize each item appropriately
- Include any specific requirements noted

### Plan Type Guidelines
- "Event": Time-bound gatherings (birthday party, wedding, conference, team outing)
- "Project": Long-term initiatives (website redesign, product launch, home renovation)
- "Task List": Collection of related tasks (weekly errands, shopping list, checklist)
- "Other": Anything that doesn't fit the above categories

Generate your analysis now.
`;

  const payload = {
    contents: [
      {
        parts: [{ text: systemPrompt }]
      }
    ],
    generationConfig: {
      temperature: 0.3, // Lower temperature for more consistent extraction
      maxOutputTokens: 2048
    }
  };

  const modelId = 'gemini-2.0-flash';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`${DEBUG_PREFIX} Gemini API error: ${response.status}`);
    throw new Error(`Gemini API call failed with status ${response.status}`);
  }

  const result = await response.json();
  const jsonText = result.candidates[0].content.parts[0].text;

  console.log(`${DEBUG_PREFIX} AI response received (${jsonText.length} chars)`);

  const parsed = cleanAndParseGeminiJson(jsonText);

  console.log(`${DEBUG_PREFIX} ✅ AI analysis complete: name="${parsed.plan_name}", type="${parsed.plan_type}", items=${parsed.items_components?.length || 0}, steps=${parsed.next_steps?.length || 0}`);

  return parsed;
}

/**
 * Parses a date string and converts to YYYY-MM-DD format if possible
 * @param {string} dateStr - Date string from AI analysis
 * @returns {string|null} Formatted date or null
 */
function parseAndFormatDate(dateStr) {
  if (!dateStr) return null;

  // If already in YYYY-MM-DD format, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Try to parse the date string
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    // Only return if the date is in the future or recent past (within 1 year)
    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    if (parsed >= oneYearAgo) {
      return parsed.toISOString().split('T')[0];
    }
  }

  // Return null for unparseable or descriptive dates
  // The description will still be stored elsewhere
  return null;
}

/**
 * Updates the Project record with all extracted fields from AI analysis
 * @param {string} projectId - Airtable record ID
 * @param {object} analysis - Full analysis object from AI
 * @returns {Promise<object>} Updated record
 */
async function updateProjectWithExtractedFields(projectId, analysis) {
  console.log(`${DEBUG_PREFIX} Updating project ${projectId} with extracted fields...`);

  // Build the fields object with all extracted data
  const updateFields = {};

  // Plan Type (always update if present)
  if (analysis.plan_type) {
    updateFields['Plan_Type'] = analysis.plan_type;
  }

  // Plan Name - only update if AI extracted a better name
  if (analysis.plan_name) {
    updateFields['Name'] = analysis.plan_name.substring(0, 100); // Max 100 chars
  }

  // Event Date - parse and format
  const formattedDate = parseAndFormatDate(analysis.event_date);
  if (formattedDate) {
    updateFields['Date'] = formattedDate;
  }

  // Goals - extracted themes, objectives, desired outcomes
  if (analysis.goals) {
    updateFields['Goals'] = analysis.goals;
  }

  // Guest Count
  if (analysis.guest_count && typeof analysis.guest_count === 'number') {
    updateFields['Guest Count'] = analysis.guest_count;
  }

  // Location
  if (analysis.location) {
    updateFields['Location'] = analysis.location;
  }

  // If no fields to update, skip the API call
  if (Object.keys(updateFields).length === 0) {
    console.log(`${DEBUG_PREFIX} No fields to update, skipping`);
    return null;
  }

  console.log(`${DEBUG_PREFIX} Fields to update: ${Object.keys(updateFields).join(', ')}`);

  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SESSIONS_TABLE)}/${projectId}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields: updateFields })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`${DEBUG_PREFIX} Failed to update project fields: ${response.status}`);
    // Don't throw - this is a non-critical update
    return null;
  }

  const record = await response.json();
  console.log(`${DEBUG_PREFIX} ✅ Project fields updated: ${Object.keys(updateFields).join(', ')}`);
  return record;
}

/**
 * Creates task records linked to the project
 * @param {string} projectId - Airtable record ID of the parent project
 * @param {Array} nextSteps - Array of task objects from AI
 * @returns {Promise<Array>} Created task records
 */
async function createLinkedTasks(projectId, nextSteps) {
  if (!nextSteps || nextSteps.length === 0) {
    return [];
  }

  console.log(`${DEBUG_PREFIX} Creating ${nextSteps.length} linked tasks for ${projectId}...`);

  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TASKS_TABLE)}`;

  // Prepare records for batch creation
  const records = nextSteps.map((step, index) => ({
    fields: {
      'Name': step.name.substring(0, 50), // Ensure max 50 chars
      'Description': step.description || '',
      'Project': [projectId], // Link to parent project
      'Status': 'Not Started',
      'Priority': index === 0 ? 'High' : 'Medium', // First task is high priority
      'AI_Generated': true
    }
  }));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ records })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`${DEBUG_PREFIX} Failed to create tasks: ${response.status}`);
    // Don't throw - task creation is optional enhancement
    return [];
  }

  const result = await response.json();
  console.log(`${DEBUG_PREFIX} ✅ Created ${result.records?.length || 0} tasks`);
  return result.records || [];
}

/**
 * Creates item/component records linked to the project (future use)
 * For now, just logs the items - will be expanded later
 * @param {string} projectId - Airtable record ID of the parent project
 * @param {Array} items - Array of item/component objects from AI
 */
function logExtractedItems(projectId, items) {
  if (!items || items.length === 0) {
    return;
  }

  console.log(`${DEBUG_PREFIX} Extracted ${items.length} items/components: ${items.map(i => i.name).join(', ')}`);

  // Future: Create linked item records in a PlanItems table
  // For now, these can be used by the frontend to suggest catalog items
}

/**
 * Main handler for the AI enrichment function
 */
exports.handler = async (event) => {
  console.log(`${DEBUG_PREFIX} ========== FUNCTION START ==========`);

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
    console.error(`${DEBUG_PREFIX} ERROR: Missing AIRTABLE_PAT or BASE_ID`);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  // GEMINI_API_KEY is optional - if missing, we skip AI enrichment
  if (!GEMINI_API_KEY) {
    console.log(`${DEBUG_PREFIX} GEMINI_API_KEY not configured - skipping AI enrichment`);
    console.log(`${DEBUG_PREFIX} ========== FUNCTION END (no API key) ==========`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'AI enrichment skipped - API key not configured',
        enriched: false
      })
    };
  }

  try {
    // Parse incoming request
    const { projectId, ideaText } = JSON.parse(event.body || '{}');

    if (!projectId || !ideaText) {
      console.error(`${DEBUG_PREFIX} Missing projectId or ideaText`);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required fields: projectId and ideaText' })
      };
    }

    console.log(`${DEBUG_PREFIX} Enriching project ${projectId}: "${ideaText.substring(0, 50)}..."`);

    // Step 1: Call AI to analyze the idea and extract structured data
    const analysis = await analyzeWithGemini(ideaText);

    // Step 2: Update project with all extracted fields
    await updateProjectWithExtractedFields(projectId, analysis);

    // Step 3: Create linked tasks from next_steps
    let createdTasks = [];
    if (analysis.next_steps && analysis.next_steps.length > 0) {
      createdTasks = await createLinkedTasks(projectId, analysis.next_steps);
    }

    // Step 4: Log extracted items for future use
    if (analysis.items_components && analysis.items_components.length > 0) {
      logExtractedItems(projectId, analysis.items_components);
    }

    console.log(`${DEBUG_PREFIX} ✅ Enrichment complete: name="${analysis.plan_name}", type="${analysis.plan_type}", tasks=${createdTasks.length}`);

    // Post the AI interpretation event to show in chat history
    postPlanEvent(projectId, 'ai_interpretation', {
      planName: analysis.plan_name,
      planType: analysis.plan_type,
      eventDate: analysis.event_date,
      goals: analysis.goals,
      guestCount: analysis.guest_count,
      location: analysis.location,
      itemsExtracted: analysis.items_components?.map(item => item.name) || [],
      tasksCreated: createdTasks.map(t => t.fields?.Name || 'Unnamed task'),
      reasoning: analysis.reasoning
    });

    console.log(`${DEBUG_PREFIX} ========== FUNCTION END (success) ==========`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        enriched: true,
        planName: analysis.plan_name,
        planType: analysis.plan_type,
        eventDate: analysis.event_date,
        goals: analysis.goals,
        guestCount: analysis.guest_count,
        location: analysis.location,
        itemsExtracted: analysis.items_components?.length || 0,
        tasksCreated: createdTasks.length,
        reasoning: analysis.reasoning
      })
    };

  } catch (error) {
    console.error(`${DEBUG_PREFIX} FUNCTION FAILED:`, error.message);
    console.log(`${DEBUG_PREFIX} ========== FUNCTION END (error) ==========`);

    // Return success even on error - enrichment is optional
    // The plan was already created successfully
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        enriched: false,
        error: error.message
      })
    };
  }
};
